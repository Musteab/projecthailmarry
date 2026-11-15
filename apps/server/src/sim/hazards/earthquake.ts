import type { HazardSpec, SeismicClass } from '@bastion/shared';
import { distanceM } from '../../geo';
import type { OperationRuntime, System } from '../runtime';

type QuakeSpec = Extract<HazardSpec, { kind: 'earthquake' }>;
type BridgeSeverity = 'restricted' | 'closed' | 'collapsed';
interface BridgeFragility {
  damageAt: number;
  worseAt: number;
  damage: BridgeSeverity;
  worse: BridgeSeverity;
}

/** Tunables. Plausible and readable on the map; not a ground-motion model. */
export const QUAKE = {
  /** Apparent speed of the shaking front across the map. Slowed so the wave is visible. */
  waveSpeedMps: 400,
  /** cells below this intensity are not reported */
  minReportedMMI: 4,
  /** intensity at which each bridge class is damaged, and at which it fares worse */
  bridge: {
    vulnerable: { damageAt: 7, worseAt: 8.5, damage: 'closed', worse: 'collapsed' },
    standard: { damageAt: 8.5, worseAt: 9.3, damage: 'restricted', worse: 'closed' },
    retrofitted: { damageAt: 9.8, worseAt: 99, damage: 'restricted', worse: 'restricted' },
  } satisfies Record<SeismicClass, BridgeFragility>,
  /** chance per intensity unit above the threshold */
  powerLoss: { from: 6.5, perUnit: 0.18 },
  collapse: { from: 7.2, perUnitPer100People: 0.02, max: 6 },
  debris: { from: 7.8, perUnit: 0.03, max: 8 },
  gridFault: { from: 7.5, perUnit: 0.25 },
} as const;

/** Modified Mercalli intensity at a distance from the epicentre. Clamped to 1..10. */
export function intensityAt(magnitude: number, depthKm: number, distanceM_: number): number {
  const hypocentralKm = Math.hypot(distanceM_ / 1000, depthKm);
  const mmi = 2 + 1.25 * magnitude - 3 * Math.log10(Math.max(1, hypocentralKm));
  return Math.min(10, Math.max(1, mmi));
}

/**
 * Earthquake: a shaking front expands from the epicentre. As it reaches each cell the cell gets
 * its intensity; as it reaches each asset the asset may be damaged. Bridges fail by fixed
 * thresholds per seismic class; everything else uses the operation's seeded random stream.
 * An asset the scenario has already put in a non-normal state is left alone.
 */
export function createEarthquakeSystem(rt: OperationRuntime, specs: QuakeSpec[]): System {
  const { region } = rt.index;
  const random = rt.prng.fork('earthquake');

  const quakes = specs.map((spec) => {
    const at = (position: [number, number]) => {
      const dist = distanceM(spec.epicenter, position);
      return {
        arrival: spec.originSimTime + dist / (spec.tuning?.waveSpeedMps ?? QUAKE.waveSpeedMps),
        mmi: Math.min(
          10,
          Math.max(
            1,
            intensityAt(spec.magnitude, spec.depthKm, dist) + (spec.tuning?.intensityOffset ?? 0),
          ),
        ),
      };
    };
    const byArrival = <T>(items: T[], position: (item: T) => [number, number]) =>
      items.map((item) => ({ item, ...at(position(item)) })).sort((a, b) => a.arrival - b.arrival);

    return {
      spec,
      cells: byArrival(region.cells, (cell) => cell.center),
      bridges: byArrival(region.bridges, (bridge) => {
        const edge = rt.index.edgeById.get(bridge.edgeIds[0]!)!;
        return edge.geometry[Math.floor(edge.geometry.length / 2)]!;
      }),
      facilities: byArrival(
        region.facilities.filter((facility) => facility.kind !== 'substation'),
        (facility) => facility.position,
      ),
      edges: byArrival(
        region.edges.filter((edge) => !edge.bridgeId),
        (edge) => edge.geometry[0]!,
      ),
      sections: byArrival(region.grid.sections, (section) => section.path[0]!),
      cursor: { cells: 0, bridges: 0, facilities: 0, edges: 0, sections: 0 },
      collapses: 0,
      debris: 0,
      announced: false,
    };
  });

  const chance = (mmi: number, rule: { from: number; perUnit: number }) =>
    mmi > rule.from && random.chance((mmi - rule.from) * rule.perUnit);

  return {
    name: 'earthquake',
    update(runtime) {
      const now = runtime.simTime;
      for (const quake of quakes) {
        if (now < quake.spec.originSimTime) continue;
        if (!quake.announced) {
          quake.announced = true;
          runtime.event({
            kind: 'hazard.earthquake',
            severity: 'critical',
            title: `Magnitude ${quake.spec.magnitude.toFixed(1)} earthquake`,
            detail: quake.spec.label,
            position: quake.spec.epicenter,
          });
        }
        const { cursor } = quake;

        for (
          ;
          cursor.cells < quake.cells.length && quake.cells[cursor.cells]!.arrival <= now;
          cursor.cells++
        ) {
          const { item: cell, mmi } = quake.cells[cursor.cells]!;
          if (mmi < QUAKE.minReportedMMI) continue;
          const existing = runtime.world.cells[cell.id];
          const rounded = Math.round(mmi * 10) / 10;
          if ((existing?.shakeMMI ?? 0) < rounded) {
            runtime.world.setCell(cell.id, { ...existing, shakeMMI: rounded });
          }
          // Buildings: a handful of collapses where shaking is severe and people live.
          const rule = QUAKE.collapse;
          if (
            mmi > rule.from &&
            quake.collapses < rule.max &&
            random.chance((mmi - rule.from) * rule.perUnitPer100People * (cell.population / 100))
          ) {
            quake.collapses++;
            runtime.applyInject({
              kind: 'spawn_incident',
              incident: {
                kind: 'structure_collapse',
                title: 'Building collapse with people trapped',
                position: cell.center,
                cellId: cell.id,
                severity: mmi >= 8.5 ? 5 : 4,
                peopleAffected: 2 + random.int(9),
                status: 'suspected',
                confidence: 0.6,
              },
            });
          }
        }

        for (
          ;
          cursor.bridges < quake.bridges.length && quake.bridges[cursor.bridges]!.arrival <= now;
          cursor.bridges++
        ) {
          const { item: bridge, mmi } = quake.bridges[cursor.bridges]!;
          const fragility = QUAKE.bridge[bridge.seismicClass];
          if (mmi < fragility.damageAt) continue;
          if (bridge.edgeIds.some((edgeId) => runtime.world.roads[edgeId])) continue; // scenario decided
          runtime.applyInject({
            kind: 'damage_bridge',
            bridgeId: bridge.id,
            severity: mmi >= fragility.worseAt ? fragility.worse : fragility.damage,
          });
        }

        for (
          ;
          cursor.facilities < quake.facilities.length &&
          quake.facilities[cursor.facilities]!.arrival <= now;
          cursor.facilities++
        ) {
          const { item: facility, mmi } = quake.facilities[cursor.facilities]!;
          const state = runtime.world.facilities[facility.id];
          if (!state || state.status !== 'normal' || state.power !== 'grid') continue;
          if (chance(mmi, QUAKE.powerLoss)) {
            runtime.applyInject({ kind: 'facility_power_loss', facilityId: facility.id });
          }
        }

        for (
          ;
          cursor.edges < quake.edges.length && quake.edges[cursor.edges]!.arrival <= now;
          cursor.edges++
        ) {
          const { item: edge, mmi } = quake.edges[cursor.edges]!;
          if (quake.debris >= QUAKE.debris.max || runtime.world.roads[edge.id]) continue;
          if (chance(mmi, QUAKE.debris)) {
            quake.debris++;
            runtime.applyInject({
              kind: 'set_road_status',
              edgeIds: [edge.id],
              status: 'blocked',
              reason: 'Building debris on the roadway',
              estCrewHours: 2 + random.int(4),
            });
          }
        }

        for (
          ;
          cursor.sections < quake.sections.length &&
          quake.sections[cursor.sections]!.arrival <= now;
          cursor.sections++
        ) {
          const { item: section, mmi } = quake.sections[cursor.sections]!;
          if (runtime.world.gridSections[section.id]?.status !== 'energized') continue;
          if (chance(mmi, QUAKE.gridFault)) {
            runtime.applyInject({ kind: 'grid_fault', sectionId: section.id });
          }
        }
      }
    },
  };
}

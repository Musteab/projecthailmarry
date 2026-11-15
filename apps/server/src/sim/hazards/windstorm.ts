import type { HazardSpec, LngLat } from '@bastion/shared';
import { distanceM } from '../../geo';
import type { OperationRuntime, System } from '../runtime';

type WindSpec = Extract<HazardSpec, { kind: 'tornado' | 'hurricane' }>;

/**
 * How each kind of windstorm damages what it passes over. A tornado is narrow and violent; a
 * hurricane is wide, weaker at any one spot, and hardest on the power grid. Chances are per
 * asset, applied once, the first time the storm reaches it.
 */
export const WINDSTORM = {
  tornado: {
    debris: 0.45,
    collapsePer100People: 0.1,
    powerLoss: 0.5,
    gridFault: 0.7,
    maxDebris: 12,
    maxCollapses: 5,
  },
  hurricane: {
    debris: 0.04,
    collapsePer100People: 0.004,
    powerLoss: 0.15,
    gridFault: 0.35,
    maxDebris: 14,
    maxCollapses: 3,
  },
  /** cells below this wind are not reported */
  minReportedKph: 40,
  /** share of the radius inside which the wind is at full strength */
  coreShare: 0.25,
} as const;

/** Where the storm centre is at a sim time, or null before it forms and after it has passed. */
export function stormCentre(track: [number, LngLat][], simTime: number): LngLat | null {
  if (track.length === 0 || simTime < track[0]![0] || simTime > track[track.length - 1]![0]) {
    return null;
  }
  for (let i = 1; i < track.length; i++) {
    const [t1, p1] = track[i]!;
    if (simTime <= t1) {
      const [t0, p0] = track[i - 1]!;
      const f = t1 === t0 ? 1 : (simTime - t0) / (t1 - t0);
      return [p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f];
    }
  }
  return track[track.length - 1]![1];
}

/** Wind speed at a distance from the centre: full strength in the core, fading to the edge. */
export function windAt(peakKph: number, radiusM: number, distance: number): number {
  if (distance >= radiusM) return 0;
  const core = radiusM * WINDSTORM.coreShare;
  if (distance <= core) return peakKph;
  return peakKph * (1 - (distance - core) / (radiusM - core));
}

/**
 * Tornadoes and hurricanes: a wind field that travels along the scenario's track. Each cell keeps
 * the strongest wind it has seen, which leaves the damage swath on the map after the storm has
 * moved on. Assets inside the field may be damaged, using the operation's seeded random stream.
 */
export function createWindstormSystem(rt: OperationRuntime, specs: WindSpec[]): System {
  const { region } = rt.index;
  const random = rt.prng.fork('windstorm');

  const storms = specs.map((spec) => ({
    spec,
    rates: WINDSTORM[spec.kind],
    cellsHit: new Set<string>(),
    edgesHit: new Set<string>(),
    facilitiesHit: new Set<string>(),
    sectionsHit: new Set<string>(),
    debris: 0,
    collapses: 0,
  }));
  const edgeMid = new Map(
    region.edges
      .filter((edge) => !edge.bridgeId)
      .map((edge) => [edge.id, edge.geometry[Math.floor(edge.geometry.length / 2)]!]),
  );

  return {
    name: 'windstorm',
    update(runtime) {
      let moved = false;
      const hazards = runtime.world.hazards.map((hazard) => {
        const storm = storms.find((candidate) => candidate.spec.id === hazard.id);
        if (!storm) return hazard;
        const centre = stormCentre(storm.spec.track, runtime.simTime);
        if (!centre) {
          if (hazard.position === undefined) return hazard;
          moved = true;
          const { position: _gone, ...rest } = hazard;
          return rest;
        }
        moved = true;
        return { ...hazard, position: centre };
      });
      if (moved) runtime.world.setHazards(hazards);

      for (const storm of storms) {
        const { spec, rates } = storm;
        const centre = stormCentre(spec.track, runtime.simTime);
        if (!centre) continue;
        const reach = spec.radiusM;

        for (const cell of region.cells) {
          const wind = windAt(spec.peakWindKph, reach, distanceM(centre, cell.center));
          if (wind < WINDSTORM.minReportedKph) continue;
          const existing = runtime.world.cells[cell.id];
          const rounded = Math.round(wind);
          if ((existing?.windKph ?? 0) < rounded - 4) {
            runtime.world.setCell(cell.id, { ...existing, windKph: rounded });
          }
          if (storm.cellsHit.has(cell.id)) continue;
          storm.cellsHit.add(cell.id);
          if (
            storm.collapses < rates.maxCollapses &&
            wind >= spec.peakWindKph * 0.6 &&
            random.chance(rates.collapsePer100People * (cell.population / 100))
          ) {
            storm.collapses++;
            runtime.applyInject({
              kind: 'spawn_incident',
              incident: {
                kind: 'structure_collapse',
                title: 'Building destroyed by wind, people trapped',
                position: cell.center,
                cellId: cell.id,
                severity: 5,
                peopleAffected: 1 + random.int(6),
                status: 'suspected',
                confidence: 0.6,
              },
            });
          }
        }

        for (const [edgeId, mid] of edgeMid) {
          if (storm.edgesHit.has(edgeId) || distanceM(centre, mid) > reach * 0.8) continue;
          storm.edgesHit.add(edgeId);
          if (storm.debris >= rates.maxDebris || runtime.world.roads[edgeId]) continue;
          if (!random.chance(rates.debris)) continue;
          storm.debris++;
          runtime.applyInject({
            kind: 'set_road_status',
            edgeIds: [edgeId],
            status: 'blocked',
            reason: 'Trees and debris blown onto the roadway',
            estCrewHours: 1 + random.int(3),
          });
        }

        for (const facility of region.facilities) {
          if (storm.facilitiesHit.has(facility.id) || distanceM(centre, facility.position) > reach)
            continue;
          storm.facilitiesHit.add(facility.id);
          const state = runtime.world.facilities[facility.id];
          if (
            facility.kind === 'substation' ||
            !state ||
            state.status !== 'normal' ||
            state.power !== 'grid'
          )
            continue;
          if (random.chance(rates.powerLoss)) {
            runtime.applyInject({ kind: 'facility_power_loss', facilityId: facility.id });
          }
        }

        for (const section of region.grid.sections) {
          if (storm.sectionsHit.has(section.id)) continue;
          if (!section.path.some((point) => distanceM(centre, point) <= reach)) continue;
          storm.sectionsHit.add(section.id);
          if (runtime.world.gridSections[section.id]?.status !== 'energized') continue;
          if (random.chance(rates.gridFault)) {
            runtime.applyInject({ kind: 'grid_fault', sectionId: section.id });
          }
        }
      }
    },
  };
}

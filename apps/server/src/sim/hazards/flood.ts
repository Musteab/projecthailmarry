import type { HazardSpec } from '@bastion/shared';
import { distanceM, pointAlong, pathLengthM } from '../../geo';
import type { OperationRuntime, System } from '../runtime';

type FloodSpec = Extract<HazardSpec, { kind: 'flash_flood' }>;

/** Tunables. Chosen so a flood reads clearly on the map; not a hydraulic model. */
export const FLOOD = {
  /** cells farther than this from every channel are never wet */
  maxReachM: 700,
  /** metres of water lost per metre of distance from the channel */
  distanceLoss: 0.006,
  /** a road closes when the water over it reaches this depth, and reopens below `roadClearM` */
  roadFloodM: 0.3,
  roadClearM: 0.12,
  /** depths below this are treated as dry */
  minDepthM: 0.03,
  /** a cell is re-sent to clients only when its depth changed by at least this much */
  patchEpsilonM: 0.05,
  /** seconds for the water to close most of the gap to its target, rising and falling */
  riseTauSec: 6,
  fallTauSec: 14,
  /** chance that a road is left blocked by debris, per metre of peak depth, capped */
  debrisChancePerM: 0.06,
  debrisChanceMax: 0.25,
} as const;

const SAMPLE_EVERY_M = 40;
const BED_SEARCH_M = 90;
const EDGE_SAMPLE_M = 25;

/** Linear interpolation over [simTime, stage] points; flat before the first and after the last. */
export function stageAt(curve: [number, number][], simTime: number): number {
  if (curve.length === 0) return 0;
  if (simTime <= curve[0]![0]) return curve[0]![1];
  for (let i = 1; i < curve.length; i++) {
    const [t1, s1] = curve[i]!;
    if (simTime <= t1) {
      const [t0, s0] = curve[i - 1]!;
      return t1 === t0 ? s1 : s0 + ((s1 - s0) * (simTime - t0)) / (t1 - t0);
    }
  }
  return curve[curve.length - 1]![1];
}

interface Reach {
  cell: number;
  /** distance to the channel in metres */
  dist: number;
  /** height of the cell above the channel bed at that point */
  rise: number;
}

/**
 * Flash flood: water rises out of the scenario's channels following its stage curve, spreads to
 * nearby low ground, closes the roads it covers, and may leave debris behind when it recedes.
 */
export function createFloodSystem(rt: OperationRuntime, specs: FloodSpec[]): System {
  const { region } = rt.index;
  const cells = region.cells;
  const cellIndex = new Map(cells.map((cell, i) => [cell.id, i]));
  const random = rt.prng.fork('flood-debris');
  /** A scenario can fix the debris chance (0 turns random debris off so only scripted debris appears). */
  const scriptedDebrisChance = specs.find((spec) => spec.tuning?.debrisChance !== undefined)?.tuning
    ?.debrisChance;

  // For each hazard, which cells its water can reach and how high they sit above the bed.
  const reaches: { spec: FloodSpec; cells: Reach[]; loss: number }[] = specs.map((spec) => {
    const samples: { position: [number, number]; bed: number }[] = [];
    for (const path of spec.sourcePaths) {
      const steps = Math.max(1, Math.ceil(pathLengthM(path) / SAMPLE_EVERY_M));
      for (let s = 0; s <= steps; s++) {
        const { position } = pointAlong(path, s / steps);
        let bed = Infinity;
        for (const cell of cells) {
          if (distanceM(cell.center, position) <= BED_SEARCH_M) bed = Math.min(bed, cell.elevM);
        }
        if (bed !== Infinity) samples.push({ position, bed });
      }
    }
    const reach: Reach[] = [];
    cells.forEach((cell, index) => {
      let dist = Infinity;
      let bed = 0;
      for (const sample of samples) {
        const d = distanceM(cell.center, sample.position);
        if (d < dist) {
          dist = d;
          bed = sample.bed;
        }
      }
      if (dist <= (spec.tuning?.maxReachM ?? FLOOD.maxReachM))
        reach.push({ cell: index, dist, rise: cell.elevM - bed });
    });
    return { spec, cells: reach, loss: spec.tuning?.distanceLossPerM ?? FLOOD.distanceLoss };
  });

  const wettable = [...new Set(reaches.flatMap((reach) => reach.cells.map((c) => c.cell)))];
  const wettableSet = new Set(wettable);
  const target = new Float64Array(cells.length);
  const depth = new Float64Array(cells.length);
  const sent = new Float64Array(cells.length);

  // Roads that cross wettable ground, with the cells each one passes through. Bridges stay dry.
  const floodable: { edgeId: string; cells: number[] }[] = [];
  for (const edge of region.edges) {
    if (edge.bridgeId) continue;
    const along = new Set<number>();
    const steps = Math.max(1, Math.ceil(edge.lengthM / EDGE_SAMPLE_M));
    for (let s = 0; s <= steps; s++) {
      const cell = cellIndex.get(
        rt.index.nearestCellId(pointAlong(edge.geometry, s / steps).position),
      );
      if (cell !== undefined && wettableSet.has(cell)) along.add(cell);
    }
    if (along.size > 0) floodable.push({ edgeId: edge.id, cells: [...along] });
  }
  /** Roads this system flooded, with the deepest water seen over each. */
  const floodedByUs = new Map<string, number>();

  const writeCell = (index: number, value: number) => {
    const id = cells[index]!.id;
    const existing = rt.world.cells[id];
    if (value === 0) {
      if (!existing) return;
      const { floodDepthM: _removed, ...rest } = existing;
      rt.world.setCell(id, Object.keys(rest).length === 0 ? null : rest);
    } else {
      rt.world.setCell(id, { ...existing, floodDepthM: Math.round(value * 100) / 100 });
    }
  };

  return {
    name: 'flood',
    update(runtime, dt) {
      target.fill(0);
      let anyStage = false;
      for (const reach of reaches) {
        const stage = stageAt(reach.spec.stageCurve, runtime.simTime);
        if (stage <= 0) continue;
        anyStage = true;
        for (const c of reach.cells) {
          const t = stage - c.rise - reach.loss * c.dist;
          if (t > target[c.cell]!) target[c.cell] = t;
        }
      }

      let anyWater = false;
      for (const index of wettable) {
        const goal = target[index]!;
        let d = depth[index]!;
        if (d === 0 && goal === 0) continue;
        const tau = goal > d ? FLOOD.riseTauSec : FLOOD.fallTauSec;
        d += (goal - d) * (1 - Math.exp(-dt / tau));
        if (d < FLOOD.minDepthM && goal === 0) d = 0;
        depth[index] = d;
        if (d > 0) anyWater = true;

        const last = sent[index]!;
        if ((d === 0 && last !== 0) || Math.abs(d - last) >= FLOOD.patchEpsilonM) {
          writeCell(index, d);
          sent[index] = d;
        }
      }
      if (!anyStage && !anyWater && floodedByUs.size === 0) return;

      let newlyFlooded = 0;
      let firstFlooded: string | undefined;
      for (const { edgeId, cells: along } of floodable) {
        let deepest = 0;
        for (const cell of along) deepest = Math.max(deepest, depth[cell]!);
        const current = runtime.world.roads[edgeId];
        const ours = floodedByUs.has(edgeId);

        // Something else (a scenario inject, structural damage) took the road over.
        if (ours && current?.status !== 'flooded') {
          floodedByUs.delete(edgeId);
          continue;
        }
        if (deepest >= FLOOD.roadFloodM) {
          if (!current) {
            runtime.setRoadState(edgeId, {
              status: 'flooded',
              reason: 'Water over the roadway',
              closurePublished: false,
            });
            newlyFlooded++;
            firstFlooded ??= edgeId;
          }
          if (ours || !current) {
            floodedByUs.set(edgeId, Math.max(floodedByUs.get(edgeId) ?? 0, deepest));
          }
        } else if (ours && deepest < FLOOD.roadClearM) {
          const peak = floodedByUs.get(edgeId)!;
          floodedByUs.delete(edgeId);
          const edge = runtime.index.edgeById.get(edgeId)!;
          const debris = random.chance(
            scriptedDebrisChance ?? Math.min(FLOOD.debrisChanceMax, FLOOD.debrisChancePerM * peak),
          );
          if (!debris) {
            runtime.setRoadState(edgeId, null);
            continue;
          }
          runtime.setRoadState(edgeId, {
            status: 'blocked',
            reason: 'Flood debris and silt on the roadway',
            closurePublished: current?.closurePublished ?? false,
          });
          runtime.addRepairCandidate({
            kind: 'debris_clearance',
            label: `Clear debris on ${edge.name ?? edge.id}`,
            edgeIds: [edgeId],
            position: edge.geometry[Math.floor(edge.geometry.length / 2)]!,
            estCrewHours: 1 + random.int(3),
            crewsRequired: 1,
          });
          runtime.event({
            kind: 'road.status',
            severity: 'warn',
            title: `${edge.name ?? edge.id}: blocked by flood debris`,
            position: edge.geometry[0]!,
            refs: { edgeId },
          });
        }
      }
      if (newlyFlooded > 0 && firstFlooded) {
        const edge = runtime.index.edgeById.get(firstFlooded)!;
        runtime.event({
          kind: 'road.flooded',
          severity: 'warn',
          title:
            newlyFlooded === 1
              ? `${edge.name ?? edge.id} is under water`
              : `${newlyFlooded} more road segments are under water`,
          position: edge.geometry[0]!,
          refs: { edgeId: firstFlooded },
        });
      }
    },
  };
}

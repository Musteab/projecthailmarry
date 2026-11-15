import type { Operation, Scenario } from '@bastion/shared';
import { applyWorldPatch, WorldSnapshotSchema } from '@bastion/shared';
import {
  loadRegionMini,
  loadScenarioMini,
  MINI,
  MINI_CREEK_PATH,
  miniEdgeH,
  miniEdgeV,
  miniLattice,
  miniPoint,
} from '@bastion/shared/fixtures';
import { describe, expect, it } from 'vitest';
import { buildRegionIndex } from '../../region/index';
import { OperationRuntime } from '../runtime';
import { scenarioRunner } from '../scenarioRunner';
import { intensityAt, QUAKE } from './earthquake';
import { FLOOD, stageAt } from './flood';
import { hazardSystem } from './index';

const index = buildRegionIndex(loadRegionMini());
const operation: Operation = {
  id: 'op-hazard',
  regionId: 'region-mini',
  scenarioId: 'test',
  mode: 'exercise',
  name: 'Hazard test',
  status: 'running',
  createdBy: 'user-operator',
  createdAt: '2026-11-15T12:00:00.000Z',
};

const run = (scenario: Scenario) =>
  new OperationRuntime({ operation, index, scenario, systems: [scenarioRunner, hazardSystem] });

/** A flood on the mini creek with nothing else going on. */
function floodScenario(stageCurve: [number, number][], seed = 7): Scenario {
  return {
    ...loadScenarioMini(),
    id: 'flood-only',
    seed,
    durationSimSec: 600,
    hazards: [
      {
        id: 'hz',
        kind: 'flash_flood',
        label: 'Creek flood',
        sourcePaths: [MINI_CREEK_PATH],
        stageCurve,
      },
    ],
    timeline: [],
    beats: [],
  };
}

function quakeScenario(magnitude: number, epicenterCol = 3, seed = 11): Scenario {
  return {
    ...loadScenarioMini(),
    id: 'quake-only',
    hazard: 'earthquake',
    seed,
    durationSimSec: 300,
    hazards: [
      {
        id: 'hz',
        kind: 'earthquake',
        label: 'Test fault rupture',
        epicenter: miniPoint(epicenterCol, 2.5),
        magnitude,
        depthKm: 10,
        originSimTime: 5,
      },
    ],
    timeline: [],
    beats: [],
  };
}

const depthAt = (rt: OperationRuntime, col: number, row: number) =>
  rt.world.cells[index.nearestCellId(miniPoint(col, row))]?.floodDepthM ?? 0;
const wetCells = (rt: OperationRuntime) =>
  Object.values(rt.world.cells).filter((cell) => (cell.floodDepthM ?? 0) > 0).length;

describe('stage curve', () => {
  const curve: [number, number][] = [
    [10, 0],
    [20, 2],
    [40, 2],
    [60, 0],
  ];
  it('interpolates and holds flat outside the curve', () => {
    expect(stageAt(curve, 0)).toBe(0);
    expect(stageAt(curve, 15)).toBeCloseTo(1, 9);
    expect(stageAt(curve, 30)).toBe(2);
    expect(stageAt(curve, 50)).toBeCloseTo(1, 9);
    expect(stageAt(curve, 999)).toBe(0);
    expect(stageAt([], 5)).toBe(0);
  });
});

describe('flash flood', () => {
  const rising: [number, number][] = [
    [0, 0],
    [60, 3.4],
    [200, 3.4],
    [320, 0],
  ];

  it('stays dry while the stage is zero', () => {
    const rt = run(
      floodScenario([
        [0, 0],
        [100, 0],
      ]),
    );
    rt.advance(100);
    expect(rt.world.cells).toEqual({});
    expect(rt.world.roads).toEqual({});
    expect(rt.world.hasPendingPatch()).toBe(false);
  });

  it('spreads outward from the channel: nearer and lower ground floods first and deepest', () => {
    const rt = run(floodScenario(rising));
    rt.advance(30);
    const early = wetCells(rt);
    expect(early).toBeGreaterThan(0);
    rt.advance(120);
    expect(wetCells(rt)).toBeGreaterThan(early);

    // Along Avenue E: on the creek, at the next street 125 m away, and farther up the bank.
    const onCreek = depthAt(rt, 4, 2.5);
    const street = depthAt(rt, 4, 3);
    const upBank = depthAt(rt, 4, 3.6);
    expect(onCreek).toBeGreaterThan(street);
    expect(street).toBeGreaterThan(0);
    expect(street).toBeGreaterThanOrEqual(upBank);
    expect(depthAt(rt, 4, 5)).toBe(0);
    expect(depthAt(rt, 0, 2.5)).toBe(0); // the west bank is not on this creek

    // Every wet cell lies inside the creek's reach.
    for (const [id, state] of Object.entries(rt.world.cells)) {
      if (!state.floodDepthM) continue;
      const { row } = miniLattice(index.cellById.get(id)!.center);
      expect(Math.abs(row - 2.5) * 250).toBeLessThan(FLOOD.maxReachM);
    }
  });

  it('rises with the stage and never exceeds it', () => {
    const rt = run(floodScenario(rising));
    let previous = 0;
    for (let t = 0; t < 150; t += 10) {
      rt.advance(10);
      const depth = depthAt(rt, 4, 2.5);
      expect(depth).toBeGreaterThanOrEqual(previous - FLOOD.patchEpsilonM);
      expect(depth).toBeLessThanOrEqual(3.4);
      previous = depth;
    }
    expect(previous).toBeGreaterThan(2);
  });

  it('floods the creek crossings, spares the bridges, and cuts the east bank in two', () => {
    const rt = run(floodScenario(rising));
    rt.advance(150);
    for (let col = 3; col <= 6; col++) {
      expect(rt.world.roads[miniEdgeV(col, 2)], `Avenue ${col}`).toMatchObject({
        status: 'flooded',
      });
      expect(rt.network.isEdgePassable(miniEdgeV(col, 2))).toBe(false);
    }
    expect(rt.world.roads[miniEdgeH(2, 1)]).toBeUndefined();
    expect(rt.world.roads[miniEdgeH(2, 4)]).toBeUndefined();
    expect(rt.world.timeline.some((event) => event.kind === 'road.flooded')).toBe(true);

    // South of the creek, the only hospital still reachable is across the south bridge.
    const hospitals = [MINI.facilities.hospitalWest, MINI.facilities.hospitalEast].map(
      (id) => index.facilityById.get(id)!.nodeId,
    );
    expect(rt.network.nearest('n-5-2', hospitals)?.nodeId).toBe('n-1-1');
  });

  it('recedes completely, reopening roads or leaving debris with a repair candidate', () => {
    const rt = run(floodScenario(rising));
    rt.advance(600);
    expect(wetCells(rt)).toBe(0);
    expect(Object.values(rt.world.roads).some((road) => road.status === 'flooded')).toBe(false);

    const blocked = Object.entries(rt.world.roads).filter(([, road]) => road.status === 'blocked');
    expect(blocked.length).toBe(rt.repairCandidates.size);
    for (const [edgeId, road] of blocked) {
      const candidate = rt.repairCandidates.get(road.repairCandidateId!)!;
      expect(candidate).toMatchObject({ kind: 'debris_clearance', edgeIds: [edgeId] });
      expect(rt.network.isEdgePassable(edgeId)).toBe(false);
    }
    expect(() => WorldSnapshotSchema.parse(rt.world.toSnapshot())).not.toThrow();
  });

  it('leaves debris on some seeds and not others, reproducibly', () => {
    const debrisFor = (seed: number) => {
      const rt = run(floodScenario(rising, seed));
      rt.advance(600);
      return Object.entries(rt.world.roads)
        .filter(([, road]) => road.status === 'blocked')
        .map(([id]) => id);
    };
    const outcomes = [1, 2, 3, 4, 5, 6].map(debrisFor);
    expect(debrisFor(3)).toEqual(outcomes[2]);
    expect(new Set(outcomes.map((edges) => edges.join(','))).size).toBeGreaterThan(1);
  });

  it('lets the scenario force debris, and does not undo it when the water goes down', () => {
    const scenario = floodScenario(rising);
    scenario.timeline = [
      {
        at: 150,
        type: 'inject',
        inject: {
          kind: 'set_road_status',
          edgeIds: [miniEdgeV(4, 2)],
          status: 'blocked',
          reason: 'Scripted debris',
          estCrewHours: 2,
        },
      },
    ];
    const rt = run(scenario);
    rt.advance(600);
    expect(rt.world.roads[miniEdgeV(4, 2)]).toMatchObject({
      status: 'blocked',
      reason: 'Scripted debris',
    });
  });

  it('sends a cell again only when its depth has moved, so patches stay small', () => {
    const rt = run(floodScenario(rising));
    rt.advance(120); // well into the plateau
    rt.world.drainPatch();
    let resent = 0;
    for (let i = 0; i < 60; i++) {
      rt.step();
      resent += Object.keys(rt.world.drainPatch().cells ?? {}).length;
    }
    expect(resent).toBeLessThan(wetCells(rt)); // far fewer than one update per wet cell per step
  });

  it('patches rebuild the flooded world exactly', () => {
    const rt = run(floodScenario(rising));
    let mirror = rt.world.toSnapshot();
    for (let i = 0; i < 400; i++) {
      rt.step();
      mirror = applyWorldPatch(mirror, rt.world.drainPatch(), rt.world.clock);
    }
    expect(mirror).toEqual(rt.world.toSnapshot());
  });

  it('runs the fixture scenario with water and scripted events together', () => {
    const rt = run(loadScenarioMini());
    rt.advance(150);
    expect(depthAt(rt, 4, 2.5)).toBeGreaterThan(1);
    rt.advance(150);
    expect(rt.finished).toBe(true);
    expect(rt.world.roads[miniEdgeV(4, 2)]?.status).toBe('blocked');
  });
});

describe('earthquake', () => {
  it('intensity falls with distance and grows with magnitude', () => {
    expect(intensityAt(6.8, 10, 0)).toBeGreaterThan(intensityAt(6.8, 10, 20_000));
    expect(intensityAt(7.5, 10, 5000)).toBeGreaterThan(intensityAt(6.0, 10, 5000));
    expect(intensityAt(9.5, 1, 0)).toBe(10);
    expect(intensityAt(2, 50, 500_000)).toBe(1);
    expect(intensityAt(6.8, 10, 1000)).toBeGreaterThan(7);
    expect(intensityAt(6.8, 10, 1000)).toBeLessThan(8.5);
  });

  it('does nothing before the origin time, then sweeps outward from the epicentre', () => {
    const rt = run(quakeScenario(6.8));
    rt.advance(4);
    expect(rt.world.cells).toEqual({});

    rt.advance(2); // one second after the rupture
    const early = Object.keys(rt.world.cells);
    expect(early.length).toBeGreaterThan(0);
    for (const id of early) {
      const dist = Math.hypot(
        ...(() => {
          const { col, row } = miniLattice(index.cellById.get(id)!.center);
          return [(col - 3) * 250, (row - 2.5) * 250] as const;
        })(),
      );
      expect(dist).toBeLessThanOrEqual(QUAKE.waveSpeedMps * 2);
    }

    rt.advance(20);
    expect(Object.keys(rt.world.cells).length).toBe(index.region.cells.length);
    const first = rt.world.timeline.find((event) => event.kind === 'hazard.earthquake');
    expect(first).toMatchObject({ severity: 'critical', title: 'Magnitude 6.8 earthquake' });
  });

  it('at M6.8 closes the vulnerable bridge and spares the retrofitted one', () => {
    const rt = run(quakeScenario(6.8));
    rt.advance(60);
    expect(rt.world.roads[miniEdgeH(2, 4)]).toMatchObject({ status: 'closed' }); // North Bridge
    expect(rt.world.roads[miniEdgeH(2, 1)]).toBeUndefined(); // South Bridge
    expect(rt.network.isEdgePassable(miniEdgeH(2, 4))).toBe(false);
    expect([...rt.repairCandidates.values()].some((c) => c.kind === 'inspection')).toBe(true);
  });

  it('orders bridge damage by seismic class as the magnitude grows', () => {
    const state = (magnitude: number) => {
      const rt = run(quakeScenario(magnitude));
      rt.advance(60);
      return {
        vulnerable: rt.world.roads[miniEdgeH(2, 4)]?.status ?? 'open',
        retrofitted: rt.world.roads[miniEdgeH(2, 1)]?.status ?? 'open',
      };
    };
    expect(state(5.0)).toEqual({ vulnerable: 'open', retrofitted: 'open' });
    expect(state(6.8)).toEqual({ vulnerable: 'closed', retrofitted: 'open' });
    expect(state(8.6).vulnerable).toBe('damaged'); // collapsed
    expect(state(8.6).retrofitted).toBe('open');
    expect(state(9.2).retrofitted).not.toBe('open');
  });

  it('a scripted bridge state wins over the model', () => {
    const scenario = quakeScenario(6.8);
    scenario.timeline = [
      {
        at: 5,
        type: 'inject',
        inject: { kind: 'damage_bridge', bridgeId: MINI.bridges.north, severity: 'restricted' },
      },
    ];
    const rt = run(scenario);
    rt.advance(60);
    expect(rt.world.roads[miniEdgeH(2, 4)]).toMatchObject({ status: 'damaged', speedFactor: 0.4 });
  });

  it('is reproducible, and produces damage a responder would recognise', () => {
    const outcome = (seed: number) => {
      const rt = run(quakeScenario(7.4, 3, seed));
      rt.advance(120);
      return rt;
    };
    expect(JSON.stringify(outcome(5).world.toSnapshot())).toBe(
      JSON.stringify(outcome(5).world.toSnapshot()),
    );

    // Across a few seeds a strong quake always hurts something, within the caps.
    for (const seed of [1, 2, 3]) {
      const rt = outcome(seed);
      const collapses = Object.values(rt.world.incidents).filter(
        (incident) => incident.kind === 'structure_collapse',
      );
      expect(collapses.length).toBeLessThanOrEqual(QUAKE.collapse.max);
      const blocked = Object.values(rt.world.roads).filter((road) => road.status === 'blocked');
      expect(blocked.length).toBeLessThanOrEqual(QUAKE.debris.max);
      const onBackup = Object.values(rt.world.facilities).filter((f) => f.power === 'backup');
      const faulted = Object.values(rt.world.gridSections).filter((s) => s.status === 'faulted');
      expect(collapses.length + blocked.length + onBackup.length + faulted.length).toBeGreaterThan(
        0,
      );
      expect(() => WorldSnapshotSchema.parse(rt.world.toSnapshot())).not.toThrow();
    }
  });
});

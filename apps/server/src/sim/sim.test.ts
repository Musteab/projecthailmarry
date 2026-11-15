import type { Inject, Operation, WorldSnapshot } from '@bastion/shared';
import {
  applyWorldPatch,
  makeInitialWorld,
  MAX_SIGNALS,
  WorldSnapshotSchema,
} from '@bastion/shared';
import {
  loadRegionMini,
  loadScenarioMini,
  MINI,
  miniEdgeH,
  miniEdgeV,
  miniNodeId,
  miniPoint,
} from '@bastion/shared/fixtures';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../errors';
import { buildRegionIndex } from '../region/index';
import { WorldState } from '../world/WorldState';
import { Prng } from './prng';
import type { SystemFactory } from './runtime';
import { OperationRuntime } from './runtime';
import { scenarioRunner } from './scenarioRunner';
import { defaultSystems } from './systems';

const operation: Operation = {
  id: 'op-test',
  regionId: 'region-mini',
  scenarioId: 'scenario-mini',
  mode: 'exercise',
  name: 'Test',
  status: 'running',
  createdBy: 'user-operator',
  createdAt: '2026-11-15T12:00:00.000Z',
};
const index = buildRegionIndex(loadRegionMini());

/** By default only the scenario runner, so these tests see the screenplay and nothing else. */
function makeRuntime(systems: SystemFactory[] = [scenarioRunner], errors: string[] = []) {
  return new OperationRuntime({
    operation,
    index,
    scenario: loadScenarioMini(),
    systems,
    logger: { error: (message) => errors.push(message) },
  });
}

describe('WorldState', () => {
  const fresh = () => new WorldState(makeInitialWorld(operation, loadRegionMini()));

  it('starts with nothing pending and records only what changes', () => {
    const world = fresh();
    expect(world.hasPendingPatch()).toBe(false);

    world.setCell('c1', { floodDepthM: 0.4 });
    world.setRoad('e1', { status: 'flooded', closurePublished: false });
    expect(world.drainPatch()).toEqual({
      cells: { c1: { floodDepthM: 0.4 } },
      roads: { e1: { status: 'flooded', closurePublished: false } },
    });
    expect(world.hasPendingPatch()).toBe(false);
  });

  it('records removals, and ignores removing something that is not there', () => {
    const world = fresh();
    world.setCell('ghost', null);
    expect(world.hasPendingPatch()).toBe(false);

    world.setCell('c1', { floodDepthM: 0.4 });
    world.drainPatch();
    world.setCell('c1', null);
    expect(world.cells).toEqual({});
    expect(world.drainPatch()).toEqual({ cells: { c1: null } });
  });

  it('does not report metrics that did not change', () => {
    const world = fresh();
    world.setMetrics({ ...world.metrics });
    expect(world.hasPendingPatch()).toBe(false);
    world.setMetrics({ ...world.metrics, peopleRescued: 4 });
    expect(world.drainPatch().metrics?.peopleRescued).toBe(4);
  });

  it('caps signals and hands out deterministic ids', () => {
    const world = fresh();
    for (let i = 0; i < MAX_SIGNALS + 5; i++) {
      world.addSignal({
        id: world.nextId('sig'),
        source: 'sensor',
        simTime: i,
        title: 't',
        body: 'b',
        reliability: 1,
      });
    }
    expect(world.signals).toHaveLength(MAX_SIGNALS);
    expect(world.signals[0]!.id).toBe('sig-6');
    expect(world.nextId('inc')).toBe('inc-1');
    expect(world.nextId('inc')).toBe('inc-2');
  });

  it('drained patches rebuild the snapshot through the shared applyWorldPatch', () => {
    const world = fresh();
    let mirror: WorldSnapshot = world.toSnapshot();
    const sync = () => {
      mirror = applyWorldPatch(mirror, world.drainPatch(), world.clock);
    };

    world.setCell('a', { floodDepthM: 0.2 });
    world.setUnit({ ...world.units[MINI.units.medic1]!, status: 'en_route' });
    sync();
    world.setCell('a', null);
    world.setCell('b', { shakeMMI: 7 });
    world.setFacility(MINI.facilities.ems, {
      status: 'degraded',
      power: 'backup',
      backupFuelMin: 30,
    });
    world.setOperation({ ...world.operation, status: 'paused' });
    world.setRestoration(null);
    sync();

    expect(mirror).toEqual(world.toSnapshot());
    expect(() => WorldSnapshotSchema.parse(mirror)).not.toThrow();
  });

  it('toSnapshot is a copy', () => {
    const world = fresh();
    const copy = world.toSnapshot();
    copy.units = {};
    expect(Object.keys(world.units)).toHaveLength(8);
  });
});

describe('Prng', () => {
  it('is reproducible from its seed', () => {
    const a = new Prng(42);
    const b = new Prng(42);
    const c = new Prng(43);
    const draw = (prng: Prng) => Array.from({ length: 20 }, () => prng.next());
    const fromA = draw(a);
    expect(draw(b)).toEqual(fromA);
    expect(draw(c)).not.toEqual(fromA);
    expect(fromA.every((value) => value >= 0 && value < 1)).toBe(true);
  });

  it('stays inside the requested bounds', () => {
    const prng = new Prng(7);
    for (let i = 0; i < 500; i++) {
      expect(prng.int(6)).toBeLessThan(6);
      const value = prng.range(2, 5);
      expect(value).toBeGreaterThanOrEqual(2);
      expect(value).toBeLessThan(5);
    }
    expect(['a', 'b']).toContain(prng.pick(['a', 'b']));
    expect(() => prng.pick([])).toThrow();
  });

  it('forks independent, reproducible streams', () => {
    const flood = new Prng(1).fork('flood').next();
    expect(new Prng(1).fork('flood').next()).toBe(flood);
    expect(new Prng(1).fork('quake').next()).not.toBe(flood);
  });
});

describe('OperationRuntime', () => {
  it('starts from the region at T0 with the scenario hazards forecast', () => {
    const rt = makeRuntime();
    expect(rt.simTime).toBe(0);
    expect(rt.world.clock).toEqual({ simTime: 0, speed: 5, durationSimSec: 300 });
    expect(rt.world.hazards).toHaveLength(1);
    expect(rt.world.hazards[0]).toMatchObject({ kind: 'flash_flood', phase: 'forecast' });
    expect(rt.world.hazards[0]!.sourcePaths).toHaveLength(1);
    expect(Object.keys(rt.world.units)).toHaveLength(8);
    expect(rt.world.hasPendingPatch()).toBe(false);
    expect(rt.sandboxed).toBe(true);
  });

  it('plays scenario-mini to the end, firing every event', () => {
    const rt = makeRuntime();
    const beats: string[] = [];
    while (!rt.finished) {
      rt.step();
      beats.push(...rt.drainBeats().map((beat) => beat.id));
    }
    const { world } = rt;

    expect(rt.simTime).toBe(300);
    expect(world.hazards[0]!.phase).toBe('ended');
    expect(world.signals).toHaveLength(8);
    expect(beats).toEqual(['beat-warning', 'beat-rescue', 'beat-grid', 'beat-restore']);

    // injects
    for (const edge of [miniEdgeV(4, 2), miniEdgeV(5, 2), miniEdgeH(4, 2)]) {
      expect(world.roads[edge]).toMatchObject({ status: 'blocked' });
      expect(rt.network.isEdgePassable(edge)).toBe(false);
    }
    const northBridge = miniEdgeH(2, 4);
    expect(world.roads[northBridge]).toMatchObject({ status: 'damaged', speedFactor: 0.4 });
    expect(rt.network.isEdgePassable(northBridge)).toBe(true);
    expect(world.facilities[MINI.facilities.ems]).toMatchObject({
      power: 'backup',
      backupFuelMin: 45,
      status: 'degraded',
    });
    expect(world.facilities[MINI.facilities.shelterEast]).toMatchObject({
      status: 'offline',
      power: 'none',
    });
    expect(world.units[MINI.units.engine1]!.status).toBe('out_of_service');
    expect(world.gridSections[MINI.sections.southeast]).toEqual({
      status: 'faulted',
      threatened: false,
      customersOut: 800,
    });
    const incidents = Object.values(world.incidents);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({
      kind: 'shelter_need',
      status: 'confirmed',
      openedAt: 130,
    });

    // repair candidates created for the debris and the damaged bridge, and linked to the roads
    const candidates = [...rt.repairCandidates.values()];
    expect(candidates.map((candidate) => candidate.kind).sort()).toEqual([
      'debris_clearance',
      'inspection',
    ]);
    expect(world.roads[miniEdgeV(4, 2)]!.repairCandidateId).toBe(
      candidates.find((candidate) => candidate.kind === 'debris_clearance')!.id,
    );

    const kinds = new Set(world.timeline.map((event) => event.kind));
    for (const kind of ['signal.received', 'hazard.phase', 'road.status', 'bridge.damaged']) {
      expect(kinds.has(kind), kind).toBe(true);
    }
    expect(() => WorldSnapshotSchema.parse(world.toSnapshot())).not.toThrow();
  });

  it('is deterministic: the same scenario and seed give the same run', () => {
    const run = () => {
      const rt = makeRuntime();
      rt.advance(300);
      return JSON.stringify(rt.world.toSnapshot());
    };
    expect(run()).toBe(run());
  });

  it('gives the same result whatever the speed or tick rhythm', () => {
    const reference = makeRuntime();
    reference.advance(300);

    const fast = makeRuntime();
    fast.setSpeed(60);
    while (!fast.finished) fast.wallTick(1000);

    const jittery = makeRuntime();
    jittery.setSpeed(5);
    const rhythm = [250, 30, 410, 250, 990, 5];
    for (let i = 0; !jittery.finished; i++) jittery.wallTick(rhythm[i % rhythm.length]!);

    const comparable = (rt: OperationRuntime) => {
      const snapshot = rt.world.toSnapshot();
      return JSON.stringify({ ...snapshot, clock: { ...snapshot.clock, speed: 0 } });
    };
    expect(comparable(fast)).toBe(comparable(reference));
    expect(comparable(jittery)).toBe(comparable(reference));
  });

  it('converts wall time to sim steps at the current speed', () => {
    const rt = makeRuntime();
    rt.setSpeed(1);
    expect([rt.wallTick(250), rt.wallTick(250), rt.wallTick(250), rt.wallTick(250)]).toEqual([
      0, 0, 0, 1,
    ]);
    rt.setSpeed(20);
    expect(rt.wallTick(250)).toBe(5);
    rt.setSpeed(0);
    expect(rt.wallTick(5000)).toBe(0);
    expect(rt.simTime).toBe(6);
  });

  it('keeps running when a system throws, and reports the fault without flooding the timeline', () => {
    const errors: string[] = [];
    let healthyRuns = 0;
    const broken: SystemFactory = () => ({
      name: 'broken',
      update: () => {
        throw new Error('kaboom');
      },
    });
    const healthy: SystemFactory = () => ({ name: 'healthy', update: () => void healthyRuns++ });
    const rt = makeRuntime([broken, healthy], errors);

    rt.advance(120);
    expect(rt.simTime).toBe(120);
    expect(healthyRuns).toBe(120);
    expect(errors).toHaveLength(120);
    const faults = rt.world.timeline.filter((event) => event.kind === 'engine.error');
    expect(faults).toHaveLength(2); // one per 60 sim seconds, not one per step
    expect(faults[0]!.detail).toBe('kaboom');
  });

  it('hands signals received between steps to the next step', () => {
    const seen: string[][] = [];
    const probe: SystemFactory = () => ({
      name: 'probe',
      update: (rt) => void seen.push(rt.newSignals.map((signal) => signal.title)),
    });
    const rt = makeRuntime([probe]);
    rt.step();
    rt.ingestSignal({ source: 'field_report', title: 'Tree down', body: '...', reliability: 0.7 });
    rt.step();
    rt.step();
    expect(seen).toEqual([[], ['Tree down'], []]);
    expect(rt.world.signals[0]).toMatchObject({ id: 'sig-1', simTime: 1, title: 'Tree down' });
  });

  it('keeps the world and the routing network in step when a road changes', () => {
    const rt = makeRuntime([]);
    const edge = miniEdgeH(0, 0);
    rt.setRoadState(edge, { status: 'flooded', closurePublished: true });
    expect(rt.network.isEdgePassable(edge)).toBe(false);
    expect(rt.network.route(miniNodeId(0, 0), miniNodeId(1, 0))!.edgeIds).not.toContain(edge);

    rt.setRoadState(edge, { status: 'open', closurePublished: false });
    expect(rt.world.roads[edge]).toBeUndefined();
    expect(rt.network.isEdgePassable(edge)).toBe(true);
  });
});

describe('default pipeline', () => {
  it('runs the scenario first, then the hazard models', () => {
    const rt = makeRuntime(defaultSystems());
    rt.advance(150);
    expect(Object.keys(rt.world.cells).length).toBeGreaterThan(0);
    expect(rt.world.signals.length).toBeGreaterThan(0);
  });
});

describe('injects', () => {
  const rt = () => makeRuntime([]);

  it('set_road_status blocks, creates a repair candidate, and reopens', () => {
    const runtime = rt();
    const edges = [miniEdgeV(3, 2), miniEdgeV(4, 2)];
    runtime.applyInject({
      kind: 'set_road_status',
      edgeIds: edges,
      status: 'blocked',
      reason: 'Debris',
      estCrewHours: 3,
    });
    const [candidate] = [...runtime.repairCandidates.values()];
    expect(candidate).toMatchObject({
      kind: 'debris_clearance',
      edgeIds: edges,
      estCrewHours: 3,
      crewsRequired: 1,
    });
    expect(runtime.world.roads[edges[0]!]).toMatchObject({
      status: 'blocked',
      reason: 'Debris',
      repairCandidateId: candidate!.id,
    });

    runtime.applyInject({
      kind: 'set_road_status',
      edgeIds: edges,
      status: 'open',
      reason: 'Cleared',
    });
    expect(runtime.world.roads[edges[0]!]).toBeUndefined();
    expect(runtime.network.isEdgePassable(edges[1]!)).toBe(true);
  });

  it.each([
    ['restricted', true, 'inspection'],
    ['closed', false, 'inspection'],
    ['collapsed', false, 'bridge_repair'],
  ] as const)('damage_bridge %s', (severity, passable, repair) => {
    const runtime = rt();
    runtime.applyInject({ kind: 'damage_bridge', bridgeId: MINI.bridges.south, severity });
    expect(runtime.network.isEdgePassable(miniEdgeH(2, 1))).toBe(passable);
    expect([...runtime.repairCandidates.values()][0]!.kind).toBe(repair);
    expect(runtime.world.timeline.at(-1)!.kind).toBe('bridge.damaged');
  });

  it('spawn_incident fills in sensible defaults', () => {
    const runtime = rt();
    runtime.advance(7);
    runtime.applyInject({
      kind: 'spawn_incident',
      incident: {
        kind: 'water_rescue',
        title: 'Car in water',
        position: miniPoint(4, 2.3),
        severity: 5,
      },
    });
    const incident = Object.values(runtime.world.incidents)[0]!;
    expect(incident).toMatchObject({
      id: 'inc-1',
      status: 'confirmed',
      confidence: 1,
      requiredCapabilities: ['swift_water'],
      assignedUnitIds: [],
      openedAt: 7,
    });
    expect(index.cellById.has(incident.cellId)).toBe(true);
  });

  it('a hospital losing power is critical and defaults to two hours of fuel', () => {
    const runtime = rt();
    runtime.applyInject({ kind: 'facility_power_loss', facilityId: MINI.facilities.hospitalEast });
    expect(runtime.world.facilities[MINI.facilities.hospitalEast]).toMatchObject({
      status: 'degraded',
      power: 'backup',
      backupFuelMin: 120,
      onDivert: false,
    });
    expect(runtime.world.timeline.at(-1)!.severity).toBe('critical');
  });

  it.each([
    { kind: 'set_road_status', edgeIds: ['nope'], status: 'blocked', reason: 'x' },
    { kind: 'damage_bridge', bridgeId: 'nope', severity: 'closed' },
    { kind: 'facility_power_loss', facilityId: 'nope' },
    { kind: 'facility_offline', facilityId: 'nope' },
    { kind: 'grid_fault', sectionId: 'nope' },
    { kind: 'unit_out_of_service', unitId: 'nope' },
  ] satisfies Inject[])('rejects $kind aimed at something that does not exist', (inject) => {
    const runtime = rt();
    expect(() => runtime.applyInject(inject)).toThrow(ApiError);
    expect(runtime.world.hasPendingPatch()).toBe(false);
  });
});

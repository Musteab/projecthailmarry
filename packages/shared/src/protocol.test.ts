import { describe, expect, it } from 'vitest';
import type { Action } from './actions';
import { ActionPayloadSchema } from './actions';
import { ApiErrorBodySchema, apiPaths, ControlRequestSchema } from './api';
import { loadRegionMini, loadScenarioMini, MINI } from './fixtures';
import type { ServerMessage, WorldPatch, WorldSnapshot } from './protocol';
import {
  applyWorldPatch,
  ClientMessageSchema,
  makeEmptyWorld,
  makeInitialWorld,
  MAX_SIGNALS,
  ServerMessageSchema,
  WorldPatchSchema,
  WorldSnapshotSchema,
} from './protocol';
import type { Operation, Signal } from './world';

const operation: Operation = {
  id: 'op-1',
  regionId: 'region-mini',
  scenarioId: 'scenario-mini',
  mode: 'exercise',
  name: 'Test exercise',
  status: 'running',
  createdBy: 'user-1',
  createdAt: '2026-11-15T10:00:00.000Z',
};

const action: Action = {
  id: 'act-1',
  operationId: 'op-1',
  kind: 'dispatch_unit',
  authority: 'fire_rescue',
  status: 'executed',
  payload: { kind: 'dispatch_unit', unitId: MINI.units.rescue2, incidentId: 'inc-1' },
  initiator: 'platform',
  ruleId: 'rule-auto-dispatch',
  explain: {
    headline: 'Rescue 2 -> Water rescue, ETA 1:40',
    factors: [{ label: 'ETA', value: '1 min 40 s', weight: 0.6 }],
    alternatives: [
      { label: 'Rescue 1', score: 0.4, rejectedBecause: 'Across the river: 3 min longer' },
    ],
    confidence: 0.92,
  },
  sandboxed: true,
  proposedAt: 90,
  decidedBy: 'auto',
  decidedAt: 90,
  executedAt: 91,
};

const signal = (n: number): Signal => ({
  id: `sig-${n}`,
  source: 'sensor',
  simTime: n,
  title: `Reading ${n}`,
  body: 'Gauge reading',
  reliability: 0.9,
});

describe('world construction', () => {
  it('makeEmptyWorld is a valid, empty snapshot', () => {
    const world = makeEmptyWorld(operation);
    expect(() => WorldSnapshotSchema.parse(world)).not.toThrow();
    expect(world.clock).toEqual({ simTime: 0, speed: 0, durationSimSec: null });
    expect(Object.keys(world.units)).toHaveLength(0);
  });

  it('makeInitialWorld places every unit at home with facilities and grid nominal', () => {
    const region = loadRegionMini();
    const world = makeInitialWorld(operation, region, { durationSimSec: 300 });
    expect(() => WorldSnapshotSchema.parse(world)).not.toThrow();

    expect(Object.keys(world.units)).toHaveLength(region.units.length);
    const rescue = world.units[MINI.units.rescue1]!;
    const home = region.facilities.find((facility) => facility.id === rescue.homeFacilityId)!;
    expect(rescue.status).toBe('available');
    expect(rescue.position).toEqual(home.position);

    expect(world.facilities[MINI.facilities.hospitalEast]).toEqual({
      status: 'normal',
      power: 'grid',
      onDivert: false,
    });
    expect(world.facilities[MINI.facilities.shelterEast]?.activated).toBe(false);
    expect(Object.values(world.gridSections).every((s) => s.status === 'energized')).toBe(true);
    expect(world.clock.durationSimSec).toBe(300);
  });

  it('rejects a region whose unit has no home', () => {
    const region = loadRegionMini();
    region.units[0]!.homeFacilityId = 'missing';
    expect(() => makeInitialWorld(operation, region)).toThrow(/unknown home facility/);
  });
});

describe('messages', () => {
  const world = makeInitialWorld(operation, loadRegionMini());
  const samples: ServerMessage[] = [
    { t: 'snapshot', world },
    {
      t: 'tick',
      clock: { simTime: 91, speed: 5, durationSimSec: 300 },
      patch: {
        actions: { [action.id]: action },
        cells: { '8a28f00a1b2ffff': { floodDepthM: 0.6 }, '8a28f00a1b37fff': null },
        roads: { 'e-v-4-2': { status: 'flooded', closurePublished: true } },
        signals: [signal(91)],
        restoration: null,
      },
    },
    { t: 'beat', beat: loadScenarioMini().beats[0]! },
    { t: 'error', code: 'unknown_operation', message: 'No such operation' },
  ];

  it.each(samples)('round-trips a $t message through JSON', (message) => {
    const wire = JSON.parse(JSON.stringify(message)) as unknown;
    expect(ServerMessageSchema.parse(wire)).toEqual(message);
  });

  it('rejects malformed messages', () => {
    expect(ServerMessageSchema.safeParse({ t: 'nope' }).success).toBe(false);
    expect(ServerMessageSchema.safeParse({ t: 'tick', patch: {} }).success).toBe(false);
    expect(ClientMessageSchema.safeParse({ t: 'subscribe' }).success).toBe(false);
    expect(ClientMessageSchema.parse({ t: 'subscribe', operationId: 'op-1' })).toBeTruthy();
  });

  it('accepts an empty patch and rejects a patch entry of the wrong shape', () => {
    expect(WorldPatchSchema.parse({})).toEqual({});
    expect(WorldPatchSchema.safeParse({ roads: { e1: { status: 'melted' } } }).success).toBe(false);
  });
});

describe('applyWorldPatch', () => {
  const base = makeInitialWorld(operation, loadRegionMini());

  it('upserts entities, removes null ids and leaves the input untouched', () => {
    const withCells = applyWorldPatch(base, {
      cells: { a: { floodDepthM: 0.4 }, b: { floodDepthM: 1.2 } },
      actions: { [action.id]: action },
    });
    expect(withCells.cells).toEqual({ a: { floodDepthM: 0.4 }, b: { floodDepthM: 1.2 } });
    expect(base.cells).toEqual({});

    const receded = applyWorldPatch(withCells, { cells: { a: null, b: { floodDepthM: 0.9 } } });
    expect(receded.cells).toEqual({ b: { floodDepthM: 0.9 } });
    expect(receded.actions[action.id]).toEqual(action);
  });

  it('replaces an entity wholesale rather than merging fields', () => {
    const flooded = applyWorldPatch(base, {
      roads: { e1: { status: 'flooded', reason: 'Creek overtopped', closurePublished: true } },
    });
    const reopened = applyWorldPatch(flooded, {
      roads: { e1: { status: 'blocked', closurePublished: false } },
    });
    expect(reopened.roads.e1).toEqual({ status: 'blocked', closurePublished: false });
  });

  it('keeps the reference of every collection the patch did not touch', () => {
    const patch: WorldPatch = { units: { [MINI.units.medic1]: null } };
    const next = applyWorldPatch(base, patch);
    expect(next.units).not.toBe(base.units);
    expect(next.facilities).toBe(base.facilities);
    expect(next.signals).toBe(base.signals);
    expect(next.metrics).toBe(base.metrics);
  });

  it('appends signals and timeline events and caps their length', () => {
    let world = base;
    for (let start = 0; start < MAX_SIGNALS + 50; start += 25) {
      world = applyWorldPatch(world, {
        signals: Array.from({ length: 25 }, (_, i) => signal(start + i)),
      });
    }
    expect(world.signals).toHaveLength(MAX_SIGNALS);
    expect(world.signals[0]!.id).toBe('sig-50');
    expect(world.signals.at(-1)!.id).toBe(`sig-${MAX_SIGNALS + 49}`);
  });

  it('distinguishes "no change" from "cleared" for the restoration analysis', () => {
    const analysis = {
      computedAt: 240,
      accessThresholdMin: 15,
      baseline: { isolatedPop: 0, noHospitalAccessPop: 3200, noShelterAccessPop: 0 },
      candidates: [],
      options: [],
      recommendedOptionId: null,
    };
    const analysed = applyWorldPatch(base, { restoration: analysis });
    expect(applyWorldPatch(analysed, { metrics: base.metrics }).restoration).toEqual(analysis);
    expect(applyWorldPatch(analysed, { restoration: null }).restoration).toBeNull();
  });

  it('takes the clock from the tick', () => {
    const clock = { simTime: 12, speed: 20, durationSimSec: 300 };
    expect(applyWorldPatch(base, {}, clock).clock).toEqual(clock);
    expect(applyWorldPatch(base, {}).clock).toBe(base.clock);
  });

  it('reproduces a snapshot from the initial world plus a sequence of patches', () => {
    const patches: WorldPatch[] = [
      { cells: { a: { floodDepthM: 0.2 } }, signals: [signal(1)] },
      { cells: { a: { floodDepthM: 0.8 }, b: { floodDepthM: 0.3 } }, signals: [signal(2)] },
      { cells: { a: null }, actions: { [action.id]: action } },
    ];
    const replayed = patches.reduce<WorldSnapshot>(
      (world, patch) => applyWorldPatch(world, patch),
      base,
    );
    expect(replayed).toEqual({
      ...base,
      cells: { b: { floodDepthM: 0.3 } },
      signals: [signal(1), signal(2)],
      actions: { [action.id]: action },
    });
    expect(() => WorldSnapshotSchema.parse(replayed)).not.toThrow();
  });
});

describe('request schemas', () => {
  it('validates transport commands', () => {
    expect(ControlRequestSchema.safeParse({ command: 'start' }).success).toBe(true);
    expect(ControlRequestSchema.safeParse({ command: 'speed', speed: 20 }).success).toBe(true);
    expect(ControlRequestSchema.safeParse({ command: 'speed', speed: 3 }).success).toBe(false);
    expect(ControlRequestSchema.safeParse({ command: 'speed' }).success).toBe(false);
    expect(ControlRequestSchema.safeParse({ command: 'rewind' }).success).toBe(false);
  });

  it('discriminates action payloads by kind', () => {
    expect(ActionPayloadSchema.safeParse(action.payload).success).toBe(true);
    expect(ActionPayloadSchema.safeParse({ kind: 'dispatch_unit', unitId: 'u1' }).success).toBe(
      false,
    );
    expect(
      ActionPayloadSchema.safeParse({ kind: 'isolate_grid_section', sectionId: 'sec-1' }).success,
    ).toBe(true);
    expect(ActionPayloadSchema.safeParse({ kind: 'launch_missiles' }).success).toBe(false);
  });

  it('describes errors and builds encoded paths', () => {
    const body = { error: { code: 'forbidden', message: 'Not allowed' } };
    expect(ApiErrorBodySchema.parse(body)).toEqual(body);
    expect(apiPaths.operationControl('op 1')).toBe('/api/operations/op%201/control');
    expect(apiPaths.restorationImpact('op-1', 'opt/a')).toBe(
      '/api/operations/op-1/restoration/options/opt%2Fa/impact',
    );
  });
});

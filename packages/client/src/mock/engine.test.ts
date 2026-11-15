import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ServerMessageSchema,
  WorldSnapshotSchema,
  applyWorldPatch,
  apiPaths,
} from '@bastion/shared';
import type { ServerMessage, WorldSnapshot, Action, Rule } from '@bastion/shared';
import { MINI } from '@bastion/shared/fixtures';
import { MockTransport } from '../transport/mock';
import { routeBetween } from './routing';
import { createBastionClient } from '../runtime';

afterEach(() => vi.useRealTimers());
async function launch(id = 'mock-flood') {
  const mock = new MockTransport();
  await mock.request('POST', apiPaths.operations, {
    regionId: mock.region.config.id,
    scenarioId: id,
    mode: 'exercise',
  });
  await mock.request('POST', apiPaths.operationControl(mock.world.operation.id), {
    command: 'start',
  });
  return mock;
}
describe('scripted stories', () => {
  it.each(['mock-flood', 'mock-quake'])(
    '%s completes with all surfaces populated and exact patch replay',
    async (id) => {
      vi.useFakeTimers();
      const mock = await launch(id);
      const messages: ServerMessage[] = [];
      const stop = mock.connect(mock.world.operation.id, (message) => messages.push(message));
      mock.advance(76);
      stop();
      expect(mock.world.operation.status).toBe('ended');
      let replay: WorldSnapshot | undefined;
      const beats: string[] = [];
      for (const message of messages) {
        expect(ServerMessageSchema.safeParse(message).success).toBe(true);
        if (message.t === 'snapshot') replay = message.world;
        if (message.t === 'tick') replay = applyWorldPatch(replay!, message.patch, message.clock);
        if (message.t === 'beat') beats.push(message.beat.id);
      }
      expect(replay).toEqual(mock.world);
      expect(WorldSnapshotSchema.safeParse(mock.world).success).toBe(true);
      expect(beats).toEqual(mock.scenario.beats.map((b) => b.id));
      expect(mock.world.signals.length).toBeGreaterThan(4);
      expect(Object.keys(mock.world.incidents)).toHaveLength(2);
      expect(Object.values(mock.world.actions).map((a) => a.status)).toEqual(
        expect.arrayContaining(['executed', 'awaiting_approval', 'rejected']),
      );
      expect(Object.values(mock.world.actions).filter((a) => a.status === 'failed')).toEqual([]);
      expect(Object.values(mock.world.workOrders).some((w) => w.status === 'reopened')).toBe(true);
      expect(mock.world.restoration?.options.length).toBeGreaterThan(0);
      expect(mock.world.metrics.sheltersOpen).toBeGreaterThan(0);
      expect(mock.world.metrics.customersOut).toBeGreaterThan(0);
      expect(
        messages.some((m) => m.t === 'tick' && Object.values(m.patch.cells ?? {}).some(Boolean)),
      ).toBe(true);
      expect(mock.world.cells).toEqual({});
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it('is deterministic across frame sizes and a clean reset', async () => {
    const a = await launch(),
      b = await launch();
    a.advance(76);
    for (let i = 0; i < 304; i++) b.advance(0.25);
    expect(a.world).toEqual(b.world);
    const final = structuredClone(a.world);
    await a.request('POST', apiPaths.operationControl(a.world.operation.id), { command: 'reset' });
    expect(a.world.clock.simTime).toBe(0);
    expect(a.world.actions).toEqual({});
    expect(a.world.workOrders).toEqual({});
    await a.request('POST', apiPaths.operationControl(a.world.operation.id), { command: 'start' });
    a.advance(76);
    expect(a.world).toEqual(final);
  });
  it('pauses without new events, honors speed, ends explicitly, and rejects resume after end', async () => {
    const mock = await launch();
    const path = apiPaths.operationControl(mock.world.operation.id);
    await mock.request('POST', path, { command: 'speed', speed: 20 });
    mock.advance(1);
    expect(mock.world.clock.simTime).toBe(20);
    await mock.request('POST', path, { command: 'pause' });
    const paused = structuredClone(mock.world);
    mock.advance(100);
    expect(mock.world).toEqual(paused);
    await mock.request('POST', path, { command: 'resume' });
    mock.advance(1);
    expect(mock.world.clock.simTime).toBe(40);
    await mock.request('POST', path, { command: 'end' });
    mock.advance(100);
    expect(mock.world.clock.simTime).toBe(40);
    await expect(mock.request('POST', path, { command: 'resume' })).rejects.toMatchObject({
      code: 'illegal_transition',
    });
  });
  it('uses different response crews and repair priorities for each disaster', async () => {
    const flood = await launch(),
      quake = await launch('mock-quake');
    flood.advance(42);
    quake.advance(42);
    expect(flood.world.actions['flood-dispatch'].payload).toMatchObject({
      unitId: MINI.units.rescue1,
    });
    expect(quake.world.actions['quake-dispatch'].payload).toMatchObject({
      unitId: MINI.units.usar1,
    });
    expect(quake.world.facilities[MINI.facilities.hospitalEast]).toMatchObject({
      power: 'backup',
      onDivert: true,
    });
    expect(flood.world.restoration?.recommendedOptionId).not.toBe(
      quake.world.restoration?.recommendedOptionId,
    );
  });
});
describe('operator interventions', () => {
  it('rejects a pending action without dispatch and overrides an executed dispatch with a different crew', async () => {
    const mock = await launch();
    mock.advance(8);
    await mock.request('POST', apiPaths.actionReject('flood-backup'), { reason: 'Hold reserve' });
    expect(mock.world.actions['flood-backup'].status).toBe('rejected');
    expect(mock.world.units[MINI.units.rescue2].status).toBe('available');
    const result = await mock.request<{ replacement: Action }>(
      'POST',
      apiPaths.actionOverride('flood-dispatch'),
      {
        reason: 'Swap crew',
        replacement: {
          kind: 'dispatch_unit',
          unitId: MINI.units.rescue2,
          incidentId: 'flood-rescue',
        },
      },
    );
    expect(mock.world.units[MINI.units.rescue1].status).toBe('available');
    expect(mock.world.units[MINI.units.rescue2].status).toBe('en_route');
    expect(mock.world.incidents['flood-rescue'].assignedUnitIds).toEqual([MINI.units.rescue2]);
    expect(result.replacement.status).toBe('executed');
    const before = structuredClone(mock.world);
    await expect(
      mock.request('POST', apiPaths.actionOverride(result.replacement.id), {
        reason: 'Invalid crew',
        replacement: { kind: 'dispatch_unit', unitId: 'missing', incidentId: 'flood-rescue' },
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(mock.world).toEqual(before);
  });
  it('reroutes around an injected closure using valid open edges and waits if all roads are blocked', async () => {
    const mock = await launch();
    mock.advance(5);
    const unit = mock.world.units[MINI.units.rescue1];
    expect(unit.assignment!.routeEdgeIds.length).toBeGreaterThan(0);
    const blocked = unit.assignment!.routeEdgeIds[1];
    await mock.request('POST', apiPaths.operationInjects(mock.world.operation.id), {
      kind: 'set_road_status',
      edgeIds: [blocked],
      status: 'closed',
      reason: 'Exercise blockage',
    });
    expect(unit.assignment!.routeEdgeIds).not.toContain(blocked);
    for (const edgeId of unit.assignment!.routeEdgeIds)
      expect(mock.world.roads[edgeId]).toBeUndefined();
    await mock.request('POST', apiPaths.operationInjects(mock.world.operation.id), {
      kind: 'set_road_status',
      edgeIds: mock.region.edges.map((e) => e.id),
      status: 'closed',
      reason: 'All roads blocked',
    });
    expect(unit.assignment).toBeUndefined();
    expect(unit.status).toBe('dispatched');
    const position = unit.position;
    mock.advance(0.2);
    expect(unit.position).toEqual(position);
  });
  it('honors utility autonomy and supplies real per-cell fixture comparisons', async () => {
    const mock = await launch();
    await mock.request<Rule>('PATCH', apiPaths.rule('mock-utility'), { autonomy: 'approve' });
    mock.advance(12);
    expect(mock.world.actions['flood-isolate'].status).toBe('awaiting_approval');
    expect(mock.world.gridSections[MINI.sections.creekside].status).toBe('energized');
    await mock.request('POST', apiPaths.actionApprove('flood-isolate'), {});
    expect(mock.world.gridSections[MINI.sections.hospitalEast].status).toBe('isolated');
    mock.advance(30);
    const option = mock.world.restoration!.options[0];
    const impact = await mock.request<{ cells: unknown[] }>(
      'GET',
      apiPaths.restorationImpact(mock.world.operation.id, option.id),
    );
    expect(impact.cells).toHaveLength(mock.region.cells.length);
  });
  it('respects one-way roads', () => {
    const mock = new MockTransport(),
      edge = mock.region.edges[0];
    const region = {
      ...mock.region,
      nodes: mock.region.nodes.filter((n) => [edge.from, edge.to].includes(n.id)),
      edges: [{ ...edge, oneway: true }],
    };
    expect(routeBetween(region, {}, edge.geometry[0], edge.geometry.at(-1)!)).toBeDefined();
    expect(routeBetween(region, {}, edge.geometry.at(-1)!, edge.geometry[0])).toBeUndefined();
  });
  it('switches scenarios, follows beats, preserves captions after commands and seeks through the director', async () => {
    vi.useFakeTimers();
    const client = createBastionClient({ mock: true });
    await client.start();
    expect(client.data.getState().scenarios.map((s) => s.id)).toEqual(['mock-flood', 'mock-quake']);
    await client.launch({ scenarioId: 'mock-quake', mode: 'exercise' });
    await client.control('start');
    vi.advanceTimersByTime(6000);
    expect(client.world.getState().beat?.simTime).toBe(30);
    await client.control('pause');
    expect(client.world.getState().beat?.simTime).toBe(30);
    client.demoCommands.goto(4);
    expect(client.world.getState().world.clock.simTime).toBe(205);
    expect(client.world.getState().world.restoration).not.toBeNull();
    client.demoCommands.goto(0);
    expect(client.world.getState().world.workOrders).toEqual({});
    client.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});

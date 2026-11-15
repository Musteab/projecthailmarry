import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyWorldPatch, WorldSnapshotSchema } from '@bastion/shared';
import type { ServerMessage, Unit, WorldPatch } from '@bastion/shared';
import { anchorClock, simTimeNow, unitPositionAt } from './helpers';
import { createSession } from './session';
import { createWorldStore } from './store';
import { MockTransport } from './transport/mock';
import { createBastionClient } from './runtime';
import { HttpWsTransport } from './transport';

afterEach(() => vi.useRealTimers());

describe('world store', () => {
  it('replays upserts, null deletes, replacements, appends and clearing like the shared reference', () => {
    const store = createWorldStore(),
      world = new MockTransport().world;
    store.receive({ t: 'snapshot', world }, 1000);
    const unitId = Object.keys(world.units)[0];
    const patch: WorldPatch = {
      units: { [unitId]: null },
      roads: { r: { status: 'blocked', closurePublished: false } },
      signals: Array.from({ length: 205 }, (_, i) => ({
        id: `s${i}`,
        source: 'sensor',
        simTime: i,
        title: 'Gauge',
        body: '',
        reliability: 1,
      })),
      timeline: Array.from({ length: 505 }, (_, i) => ({
        id: `e${i}`,
        simTime: i,
        kind: 'test',
        title: '',
        severity: 'info',
      })),
      restoration: null,
      hazards: [],
      metrics: { ...world.metrics, roadsClosed: 1 },
    };
    const clock = { ...world.clock, simTime: 10, speed: 5 };
    store.receive({ t: 'tick', clock, patch }, 2000);
    const next = store.getState().world;
    expect(next).toEqual({
      ...applyWorldPatch(world, patch, clock),
      clock: anchorClock(clock, 2000),
    });
    expect(next.units[unitId]).toBeUndefined();
    expect(next.signals).toHaveLength(200);
    expect(next.signals[0].id).toBe('s5');
    expect(next.timeline).toHaveLength(500);
    expect(next.timeline[0].id).toBe('e5');
    expect(next.facilities).toBe(world.facilities);
    expect(world.units[unitId]).toBeDefined();
    store.receive({ t: 'tick', clock, patch: { roads: { r: null } } });
    expect(store.getState().world.roads).toEqual({});
  });
  it('preserves untouched collections through clock-only ticks', () => {
    const store = createWorldStore(),
      world = new MockTransport().world;
    store.receive({ t: 'snapshot', world });
    store.receive({ t: 'tick', clock: { ...world.clock, simTime: 1 }, patch: {} });
    expect(store.getState().world.units).toBe(world.units);
    expect(store.getState().world.signals).toBe(world.signals);
  });
});

describe('interpolation', () => {
  const seed = Object.values(new MockTransport().world.units)[0];
  const unit: Unit = {
    ...seed,
    status: 'en_route',
    assignment: {
      targetType: 'incident',
      targetId: 'i',
      destination: [3, 0],
      route: [
        [0, 0],
        [1, 0],
        [3, 0],
      ],
      routeEdgeIds: [],
      departedSimTime: 0,
      etaSimTime: 30,
    },
  };
  it.each([
    [0, 0],
    [15, 1.5],
    [30, 3],
    [50, 3],
  ])('interpolates by distance at %s seconds', (time, longitude) => {
    const p = unitPositionAt(unit, { simTime: time, speed: 0, durationSimSec: null }, 0);
    expect(p.position[0]).toBeCloseTo(longitude);
    expect(p.heading).toBeCloseTo(90);
  });
  it('anchors time, clamps backwards wall time and duration, and freezes paused/unanchored clocks', () => {
    const clock = anchorClock({ simTime: 10, speed: 5, durationSimSec: 30 }, 1000);
    expect(simTimeNow(clock, 2000)).toBe(15);
    expect(simTimeNow(clock, 0)).toBe(10);
    expect(simTimeNow(clock, 9000)).toBe(30);
    expect(simTimeNow({ ...clock, speed: 0 }, 9000)).toBe(10);
    expect(simTimeNow({ simTime: 5, speed: 5, durationSimSec: null }, 100000)).toBe(5);
  });
  it('handles missing routes, duplicate points and units out of service', () => {
    expect(
      unitPositionAt(
        { ...unit, assignment: undefined },
        { simTime: 20, speed: 0, durationSimSec: null },
        0,
      ).position,
    ).toBe(unit.position);
    const stationary = {
      ...unit,
      assignment: {
        ...unit.assignment!,
        route: [
          [1, 2],
          [1, 2],
        ] as [number, number][],
      },
    };
    expect(
      unitPositionAt(stationary, { simTime: 10, speed: 0, durationSimSec: null }, 0).position,
    ).toEqual([1, 2]);
    expect(
      unitPositionAt(
        { ...unit, status: 'out_of_service' },
        { simTime: 20, speed: 0, durationSimSec: null },
        0,
      ).position,
    ).toBe(unit.position);
  });
});

describe('session', () => {
  it('persists only to session storage, restores and uses the shared permission matrix', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    };
    const session = createSession(storage);
    session.set({
      token: 'test',
      user: {
        id: 'u',
        name: 'Utility',
        email: 'u@test',
        role: 'utility_operator',
        authority: 'utility',
      },
    });
    expect(session.can('approve', 'utility')).toBe(true);
    expect(session.can('approve', 'ems')).toBe(false);
    expect(session.can('operate')).toBe(false);
    expect(createSession(storage).token()).toBe('test');
    session.set();
    expect(values.size).toBe(0);
    expect(session.can('approve')).toBe(false);
  });
  it('works when storage access throws', () => {
    const session = createSession({
      getItem: () => {
        throw Error('blocked');
      },
      setItem: () => {
        throw Error('blocked');
      },
      removeItem: () => {},
    });
    expect(session.getState().status).toBe('anonymous');
    session.set();
    expect(session.token()).toBeUndefined();
  });
});

describe('mock and runtime', () => {
  it('boots offline, moves units, pauses/resumes and cleans up timers', async () => {
    vi.useFakeTimers();
    const client = createBastionClient({ mock: true });
    await client.start();
    expect(client.data.getState().error).toBeUndefined();
    expect(client.world.getState().connection).toBe('mock');
    vi.advanceTimersByTime(8000);
    const world = client.world.getState().world;
    expect(WorldSnapshotSchema.safeParse(world).success).toBe(true);
    const moving = Object.values(world.units).filter((u) => u.assignment);
    expect(moving.length).toBeGreaterThan(0);
    vi.advanceTimersByTime(1000);
    expect(client.world.getState().world.units[moving[0].id].position).not.toEqual(
      moving[0].position,
    );
    await client.control('pause');
    const paused = client.world.getState().world.clock.simTime;
    vi.advanceTimersByTime(1000);
    expect(client.world.getState().world.clock.simTime).toBe(paused);
    await client.control('resume');
    vi.advanceTimersByTime(1000);
    expect(client.world.getState().world.clock.simTime).toBeGreaterThan(paused);
    client.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('executes approval, rejects repeated approval, supports overrides and resets the exercise', async () => {
    vi.useFakeTimers();
    const client = createBastionClient({ mock: true });
    await client.start();
    await client.actionCommands.create({
      kind: 'isolate_grid_section',
      sectionId: Object.keys(client.world.getState().world.gridSections)[0],
    });
    const action = Object.values(client.world.getState().world.actions)[0];
    await client.actionCommands.approve(action.id);
    expect(client.world.getState().world.actions[action.id].status).toBe('executed');
    expect(Object.values(client.world.getState().world.gridSections)[0].status).toBe('isolated');
    await expect(client.actionCommands.approve(action.id)).rejects.toMatchObject({ status: 409 });
    await client.actionCommands.override(action.id, 'Cancel exercise decision');
    expect(client.world.getState().world.actions[action.id].status).toBe('overridden');
    await client.control('reset');
    expect(client.world.getState().world.clock.simTime).toBe(0);
    expect(Object.values(client.world.getState().world.gridSections)[0].status).toBe('energized');
    client.stop();
  });
  it('supports inject → restoration option → work order → reopening', async () => {
    vi.useFakeTimers();
    const client = createBastionClient({ mock: true });
    await client.start();
    const edgeId = client.data.getState().region!.edges[0].id;
    await client.inject({
      kind: 'set_road_status',
      edgeIds: [edgeId],
      status: 'blocked',
      reason: 'Exercise debris',
    });
    await client.restorationCommands.analyze();
    const optionId = client.world.getState().world.restoration!.options[0].id;
    const order = await client.restorationCommands.createWorkOrder(optionId);
    await expect(client.restorationCommands.transition(order.id, 'reopened')).rejects.toMatchObject(
      { status: 409 },
    );
    for (const status of ['assigned', 'in_progress', 'inspection', 'reopened'] as const)
      await client.restorationCommands.transition(order.id, status);
    expect(client.world.getState().world.roads[edgeId]).toBeUndefined();
    expect(WorldSnapshotSchema.safeParse(client.world.getState().world).success).toBe(true);
    await client.refreshBriefing();
    expect(client.data.getState().briefing?.headline).toContain('Mock');
    await client.ask('Status?');
    expect(client.data.getState().history).toHaveLength(1);
    client.stop();
  });
  it('does not reconnect or retain a mock session after logout', async () => {
    vi.useFakeTimers();
    const client = createBastionClient({ mock: true });
    await client.start();
    client.logout();
    expect(client.session.token()).toBeUndefined();
    expect(client.world.getState().world.operation.id).toBe('');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('survives the React strict-mode start-stop-start lifecycle with one subscription', async () => {
    vi.useFakeTimers();
    const client = createBastionClient({ mock: true });
    const first = client.start();
    client.stop();
    const second = client.start();
    await Promise.all([first, second]);
    expect(client.data.getState().error).toBeUndefined();
    expect(client.world.getState().connection).toBe('mock');
    expect(vi.getTimerCount()).toBe(1);
    client.stop();
  });
  it('rejects a mock live operation and preserves its world', async () => {
    const mock = new MockTransport(),
      before = mock.world;
    await expect(
      mock.request('POST', '/api/operations', {
        regionId: mock.region.config.id,
        scenarioId: mock.scenario.id,
        mode: 'live',
      }),
    ).rejects.toMatchObject({ code: 'mock_exercise_only' });
    expect(mock.world).toBe(before);
  });
});

describe('HTTP / websocket', () => {
  it('sends the current bearer token and preserves structured API errors', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: 'forbidden', message: 'Utility authority required' } }),
          { status: 403 },
        ),
      );
    const transport = new HttpWsTransport({
      apiUrl: 'https://api.test/',
      getToken: () => 'jwt',
      fetch: fetcher,
    });
    await expect(transport.request('POST', '/api/actions/a/approve', {})).rejects.toMatchObject({
      code: 'forbidden',
      status: 403,
    });
    expect(fetcher.mock.calls[0][0]).toBe('https://api.test/api/actions/a/approve');
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer jwt' });
  });
  it('subscribes, validates messages, reconnects with fresh tokens, and stops retrying on cleanup', () => {
    vi.useFakeTimers();
    const sockets: Array<{
      onopen?: () => void;
      onclose?: () => void;
      onmessage?: (e: { data: string }) => void;
      send: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    }> = [];
    const urls: string[] = [];
    let token = 'first';
    const transport = new HttpWsTransport({
      apiUrl: 'https://api.test',
      getToken: () => token,
      webSocket: (url) => {
        urls.push(url);
        const socket = { send: vi.fn(), close: vi.fn() };
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
    });
    const messages: ServerMessage[] = [],
      connection = vi.fn();
    const stop = transport.connect('operation', (message) => messages.push(message), connection);
    sockets[0].onopen?.();
    expect(sockets[0].send).toHaveBeenCalledWith(
      JSON.stringify({ t: 'subscribe', operationId: 'operation' }),
    );
    sockets[0].onmessage?.({ data: '{bad' });
    expect(messages[0].t).toBe('error');
    sockets[0].onmessage?.({
      data: JSON.stringify({ t: 'snapshot', world: new MockTransport().world }),
    });
    expect(connection).toHaveBeenLastCalledWith('live');
    token = 'second';
    sockets[0].onclose?.();
    vi.advanceTimersByTime(1000);
    expect(urls).toEqual(['wss://api.test/ws?token=first', 'wss://api.test/ws?token=second']);
    stop();
    vi.advanceTimersByTime(30000);
    expect(sockets).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});

import { join } from 'node:path';
import type { Operation, ServerMessage, WorldSnapshot } from '@bastion/shared';
import {
  ApiErrorBodySchema,
  apiPaths,
  applyWorldPatch,
  OperationSchema,
  ServerMessageSchema,
  WorldSnapshotSchema,
} from '@bastion/shared';
import { loadRegionMini, MINI, miniEdgeH, miniPoint } from '@bastion/shared/fixtures';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import type { AppContext } from '../context';
import { findOperation } from '../db/operations';
import {
  authHeader,
  cleanupTempDirs,
  makeTempDir,
  makeTestContext,
  writeRegionPack,
} from '../testing';

const errorCode = (body: unknown) => ApiErrorBodySchema.parse(body).error.code;
const MINI_OP = { regionId: 'region-mini', scenarioId: 'scenario-mini', mode: 'exercise' };

describe('operations', () => {
  let ctx: AppContext;
  let app: FastifyInstance;
  let operator: { authorization: string };

  const post = (url: string, payload: unknown, headers = operator) =>
    app.inject({ method: 'POST', url, payload: payload as object, headers });
  const create = async (body: object = MINI_OP): Promise<Operation> => {
    const response = await post(apiPaths.operations, body);
    expect(response.statusCode, response.body).toBe(201);
    return OperationSchema.parse(response.json());
  };
  const control = (id: string, body: object) => post(apiPaths.operationControl(id), body);
  const snapshot = async (id: string): Promise<WorldSnapshot> => {
    const response = await app.inject({
      method: 'GET',
      url: apiPaths.operation(id),
      headers: operator,
    });
    expect(response.statusCode).toBe(200);
    return WorldSnapshotSchema.parse(response.json());
  };

  beforeEach(async () => {
    ctx = makeTestContext();
    app = await buildApp(ctx);
    operator = await authHeader(ctx, 'operator');
  });
  afterEach(async () => {
    await app.close();
    cleanupTempDirs();
  });

  describe('creating', () => {
    it('creates a ready operation, persists it and serves its snapshot', async () => {
      const operation = await create();
      expect(operation).toMatchObject({
        regionId: 'region-mini',
        scenarioId: 'scenario-mini',
        mode: 'exercise',
        status: 'ready',
        createdBy: 'user-operator',
      });
      expect(operation.name).toContain('exercise');
      expect(findOperation(ctx.db, operation.id)).toEqual(operation);

      const world = await snapshot(operation.id);
      expect(world.clock).toEqual({ simTime: 0, speed: 5, durationSimSec: 300 });
      expect(Object.keys(world.units)).toHaveLength(8);

      const list = await app.inject({ method: 'GET', url: apiPaths.operations, headers: operator });
      expect(OperationSchema.array().parse(list.json())).toEqual([operation]);
    });

    it('is limited to roles that may operate', async () => {
      for (const [role, expected] of [
        ['admin', 201],
        ['coordinator', 201],
        ['utility_operator', 403],
        ['observer', 403],
      ] as const) {
        const response = await post(apiPaths.operations, MINI_OP, await authHeader(ctx, role));
        expect(response.statusCode, role).toBe(expected);
      }
      expect((await app.inject({ method: 'POST', url: apiPaths.operations })).statusCode).toBe(401);
    });

    it('lets read-only roles watch', async () => {
      const operation = await create();
      const response = await app.inject({
        method: 'GET',
        url: apiPaths.operation(operation.id),
        headers: await authHeader(ctx, 'observer'),
      });
      expect(response.statusCode).toBe(200);
    });

    it.each([
      ['an unknown region', { ...MINI_OP, regionId: 'atlantis' }, /Unknown region/],
      ['an unknown scenario', { ...MINI_OP, scenarioId: 'nope' }, /Unknown scenario/],
      ['a malformed body', { regionId: 'region-mini' }, /Invalid request/],
    ])('rejects %s with 400', async (_label, body, message) => {
      const response = await post(apiPaths.operations, body);
      expect(response.statusCode).toBe(400);
      expect(ApiErrorBodySchema.parse(response.json()).error.message).toMatch(message);
    });

    it('allows an operation without a scenario', async () => {
      const operation = await create({ regionId: 'region-mini', scenarioId: null, mode: 'live' });
      const world = await snapshot(operation.id);
      expect(world.hazards).toEqual([]);
      expect(world.clock.durationSimSec).toBeNull();
    });

    it('caps the number of active operations', async () => {
      for (let i = 0; i < 12; i++) await create();
      const response = await post(apiPaths.operations, MINI_OP);
      expect(response.statusCode).toBe(409);
      expect(errorCode(response.json())).toBe('too_many_operations');
    });

    it('answers 404 for an operation that does not exist', async () => {
      const response = await app.inject({
        method: 'GET',
        url: apiPaths.operation('op-missing'),
        headers: operator,
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('transport controls', () => {
    it('walks the lifecycle and rejects illegal transitions with 409', async () => {
      const { id } = await create();
      const status = async (body: object) => {
        const response = await control(id, body);
        return response.statusCode === 200
          ? OperationSchema.parse(response.json()).status
          : response.statusCode;
      };

      expect(await status({ command: 'pause' })).toBe(409);
      expect(await status({ command: 'start' })).toBe('running');
      expect(await status({ command: 'start' })).toBe(409);
      expect(await status({ command: 'resume' })).toBe(409);
      expect(await status({ command: 'pause' })).toBe('paused');
      expect(await status({ command: 'resume' })).toBe('running');
      expect(await status({ command: 'end' })).toBe('ended');
      expect(await status({ command: 'end' })).toBe(409);
      expect(await status({ command: 'speed', speed: 20 })).toBe(409);
      expect(findOperation(ctx.db, id)?.status).toBe('ended');

      const illegal = await control(id, { command: 'start' });
      expect(errorCode(illegal.json())).toBe('illegal_transition');
    });

    it('only advances while running, at the chosen speed', async () => {
      const { id } = await create();
      ctx.operations.tick(1000);
      expect((await snapshot(id)).clock.simTime).toBe(0); // ready, not started

      await control(id, { command: 'start' });
      ctx.operations.tick(1000);
      expect((await snapshot(id)).clock.simTime).toBe(5); // default speed 5

      await control(id, { command: 'speed', speed: 20 });
      ctx.operations.tick(1000);
      expect((await snapshot(id)).clock).toMatchObject({ simTime: 25, speed: 20 });

      await control(id, { command: 'pause' });
      ctx.operations.tick(5000);
      expect((await snapshot(id)).clock.simTime).toBe(25);
    });

    it('rejects a speed that is not on the dial', async () => {
      const { id } = await create();
      expect((await control(id, { command: 'speed', speed: 7 })).statusCode).toBe(400);
      expect((await control(id, { command: 'warp' })).statusCode).toBe(400);
    });

    it('ends by itself when the scenario runs out', async () => {
      const { id } = await create();
      await control(id, { command: 'start' });
      await control(id, { command: 'speed', speed: 60 });
      for (let i = 0; i < 6; i++) ctx.operations.tick(1000);

      const world = await snapshot(id);
      expect(world.clock.simTime).toBe(300);
      expect(world.operation.status).toBe('ended');
      expect(findOperation(ctx.db, id)?.status).toBe('ended');
    });

    it('reset rebuilds the world from the same scenario', async () => {
      const { id } = await create();
      const initial = await snapshot(id);
      await control(id, { command: 'start' });
      await control(id, { command: 'speed', speed: 60 });
      for (let i = 0; i < 3; i++) ctx.operations.tick(1000);
      expect((await snapshot(id)).signals.length).toBeGreaterThan(0);

      const response = await control(id, { command: 'reset' });
      expect(OperationSchema.parse(response.json()).status).toBe('ready');
      expect(await snapshot(id)).toEqual(initial);
      expect(findOperation(ctx.db, id)?.status).toBe('ready');
    });

    it('needs the operate permission', async () => {
      const { id } = await create();
      const response = await control(id, { command: 'start' });
      expect(response.statusCode).toBe(200);
      const denied = await post(
        apiPaths.operationControl(id),
        { command: 'pause' },
        await authHeader(ctx, 'observer'),
      );
      expect(denied.statusCode).toBe(403);
    });
  });

  describe('injects and signals', () => {
    it('applies a what-if inject to an exercise at once', async () => {
      const { id } = await create();
      const bridge = miniEdgeH(2, 1);
      const response = await post(apiPaths.operationInjects(id), {
        kind: 'damage_bridge',
        bridgeId: MINI.bridges.south,
        severity: 'closed',
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
      expect((await snapshot(id)).roads[bridge]).toMatchObject({ status: 'closed' });
      expect(ctx.operations.require(id).network.isEdgePassable(bridge)).toBe(false);
    });

    it('refuses injects in a live operation', async () => {
      const live = await create({ ...MINI_OP, mode: 'live' });
      const response = await post(apiPaths.operationInjects(live.id), {
        kind: 'grid_fault',
        sectionId: MINI.sections.ems,
      });
      expect(response.statusCode).toBe(409);
      expect(
        Object.values((await snapshot(live.id)).gridSections).every(
          (s) => s.status === 'energized',
        ),
      ).toBe(true);
    });

    it('validates injects', async () => {
      const { id } = await create();
      const malformed = await post(apiPaths.operationInjects(id), { kind: 'summon_kraken' });
      expect(malformed.statusCode).toBe(400);
      const unknownTarget = await post(apiPaths.operationInjects(id), {
        kind: 'unit_out_of_service',
        unitId: 'u-ghost',
      });
      expect(unknownTarget.statusCode).toBe(400);
    });

    it('accepts a field report as a signal', async () => {
      const { id } = await create();
      const response = await post(apiPaths.operationSignals(id), {
        source: 'field_report',
        title: 'Water over the road',
        body: 'About knee deep at 3rd Street and Avenue E.',
        position: miniPoint(4, 2),
        reliability: 0.8,
      });
      expect(response.statusCode).toBe(201);
      const world = await snapshot(id);
      expect(world.signals).toHaveLength(1);
      expect(world.signals[0]).toMatchObject({ id: 'sig-1', simTime: 0, source: 'field_report' });
      expect(world.timeline.at(-1)!.kind).toBe('signal.received');
    });
  });

  describe('message stream', () => {
    it('snapshot plus tick patches reconstructs the world, and every message is valid', async () => {
      const { id } = await create();
      let mirror = ctx.operations.snapshot(id);
      const beats: string[] = [];
      const messages: ServerMessage[] = [];
      const off = ctx.operations.subscribe(id, (message) => {
        messages.push(message);
        if (message.t === 'tick') mirror = applyWorldPatch(mirror, message.patch, message.clock);
        if (message.t === 'snapshot') mirror = message.world;
        if (message.t === 'beat') beats.push(message.beat.id);
      });

      await control(id, { command: 'start' });
      await post(apiPaths.operationInjects(id), {
        kind: 'unit_out_of_service',
        unitId: MINI.units.usar1,
      });
      await control(id, { command: 'speed', speed: 20 });
      for (let i = 0; i < 20; i++) ctx.operations.tick(1000);

      expect(mirror).toEqual(ctx.operations.snapshot(id));
      expect(mirror.operation.status).toBe('ended');
      expect(beats).toEqual(['beat-warning', 'beat-rescue', 'beat-grid', 'beat-restore']);
      for (const message of messages) {
        expect(() => ServerMessageSchema.parse(JSON.parse(JSON.stringify(message)))).not.toThrow();
      }

      off();
      const count = messages.length;
      await control(id, { command: 'reset' });
      expect(messages).toHaveLength(count);
    });

    it('sends a fresh snapshot to subscribers on reset', async () => {
      const { id } = await create();
      const received: ServerMessage[] = [];
      ctx.operations.subscribe(id, (message) => received.push(message));
      await control(id, { command: 'start' });
      ctx.operations.tick(2000);
      await control(id, { command: 'reset' });

      const last = received.at(-1)!;
      expect(last.t).toBe('snapshot');
      expect(last.t === 'snapshot' && last.world.clock.simTime).toBe(0);
    });

    it('refuses to subscribe to an unknown operation', () => {
      expect(() => ctx.operations.subscribe('op-missing', () => undefined)).toThrow(/not found/);
    });
  });
});

describe('operations across restarts and regions', () => {
  afterEach(cleanupTempDirs);

  it('marks operations cut short by a restart as ended', async () => {
    const databasePath = join(makeTempDir(), 'bastion.sqlite');
    const first = makeTestContext({ DATABASE_PATH: databasePath });
    const admin = first.auth.authenticateToken(
      await first.auth.tokens.issue({
        id: 'user-admin',
        name: 'x',
        email: 'x',
        role: 'admin',
        authority: 'ema',
      }),
    );
    const operation = first.operations.create(
      { regionId: 'region-mini', scenarioId: 'scenario-mini', mode: 'exercise' },
      await admin,
    );
    first.operations.control(operation.id, { command: 'start' });
    first.close();

    const second = makeTestContext({ DATABASE_PATH: databasePath });
    expect(findOperation(second.db, operation.id)?.status).toBe('ended');
    expect(second.operations.get(operation.id)).toBeUndefined();
    second.close();
  });

  it('refuses a scenario written for another region', async () => {
    const dataDir = makeTempDir();
    const region = loadRegionMini();
    region.config.id = 'testville';
    writeRegionPack(dataDir, region);
    const ctx = makeTestContext({ DATA_DIR: dataDir });
    const app = await buildApp(ctx);

    const response = await app.inject({
      method: 'POST',
      url: apiPaths.operations,
      headers: await authHeader(ctx, 'operator'),
      payload: { regionId: 'testville', scenarioId: 'scenario-mini', mode: 'exercise' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toMatch(/written for region/);
    await app.close();
  });
});

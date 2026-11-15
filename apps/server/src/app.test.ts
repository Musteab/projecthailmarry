import {
  ApiErrorBodySchema,
  apiPaths,
  LoginRequestSchema,
  RegionStaticSchema,
  ScenarioSummarySchema,
} from '@bastion/shared';
import { MINI_REGION_ID, SCENARIO_MINI_ID } from '@bastion/shared/fixtures';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildApp } from './app';
import type { AppContext } from './context';
import { conflict } from './errors';
import { checkContract, parseInput } from './http';
import { authHeader, cleanupTempDirs, makeTestContext } from './testing';

/** Routes added by a test are public so they exercise one thing at a time. */
const open = { config: { public: true } };

describe('server foundation', () => {
  let ctx: AppContext;
  let app: FastifyInstance;
  let headers: { authorization: string };

  beforeEach(async () => {
    ctx = makeTestContext();
    app = await buildApp(ctx);
    headers = await authHeader(ctx, 'operator');
  });
  afterEach(async () => {
    await app.close();
    cleanupTempDirs();
  });

  it('answers the health check without credentials', async () => {
    const response = await app.inject({ method: 'GET', url: apiPaths.health });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('lists scenarios as contract summaries, including the fixture outside production', async () => {
    const response = await app.inject({ method: 'GET', url: apiPaths.scenarios, headers });
    expect(response.statusCode).toBe(200);
    const summaries = ScenarioSummarySchema.array().parse(response.json());
    expect(summaries.map((summary) => summary.id)).toContain(SCENARIO_MINI_ID);
    expect(summaries[0]).not.toHaveProperty('timeline');
  });

  it('serves a region pack that matches the RegionStatic contract', async () => {
    const response = await app.inject({
      method: 'GET',
      url: apiPaths.regionStatic(MINI_REGION_ID),
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    const region = RegionStaticSchema.parse(response.json());
    expect(region.config.id).toBe(MINI_REGION_ID);
    expect(region.nodes).toHaveLength(42);
  });

  it('allows the configured web origin and no other', async () => {
    const allowed = await app.inject({
      method: 'GET',
      url: apiPaths.health,
      headers: { origin: 'http://localhost:5173' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');

    const other = await app.inject({
      method: 'GET',
      url: apiPaths.health,
      headers: { origin: 'https://evil.example' },
    });
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers a CORS preflight for a protected route without a token', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: apiPaths.scenarios,
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-headers']).toMatch(/authorization/i);
  });

  describe('error contract', () => {
    const expectError = (body: unknown, code: string) => {
      const parsed = ApiErrorBodySchema.parse(body);
      expect(parsed.error.code).toBe(code);
      return parsed.error;
    };

    it('unknown route -> 404 not_found', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/nope' });
      expect(response.statusCode).toBe(404);
      expectError(response.json(), 'not_found');
    });

    it('unknown region -> 404 not_found', async () => {
      const response = await app.inject({
        method: 'GET',
        url: apiPaths.regionStatic('atlantis'),
        headers,
      });
      expect(response.statusCode).toBe(404);
      expect(expectError(response.json(), 'not_found').message).toContain('atlantis');
    });

    it('malformed JSON body -> 400 in the contract shape', async () => {
      app.post('/api/test/echo', open, async (request) => request.body);
      const response = await app.inject({
        method: 'POST',
        url: '/api/test/echo',
        headers: { 'content-type': 'application/json' },
        payload: '{ not json',
      });
      expect(response.statusCode).toBe(400);
      expectError(response.json(), 'bad_request');
    });

    it('schema validation failure -> 400 validation_failed with every problem listed', async () => {
      app.post('/api/test/login', open, async (request) =>
        parseInput(LoginRequestSchema, request.body),
      );
      const response = await app.inject({
        method: 'POST',
        url: '/api/test/login',
        payload: { email: 'x' },
      });
      expect(response.statusCode).toBe(400);
      const error = expectError(response.json(), 'validation_failed');
      const paths = (error.details as { path: string }[]).map((detail) => detail.path);
      expect(paths).toEqual(expect.arrayContaining(['email', 'password']));
    });

    it('ApiError keeps its status and code', async () => {
      app.get('/api/test/conflict', open, async () => {
        throw conflict('Work order is already reopened');
      });
      const response = await app.inject({ method: 'GET', url: '/api/test/conflict' });
      expect(response.statusCode).toBe(409);
      expectError(response.json(), 'illegal_transition');
    });

    it('unexpected errors -> 500 internal_error without leaking details', async () => {
      app.get('/api/test/boom', open, async () => {
        throw new Error('database password is hunter2');
      });
      const response = await app.inject({ method: 'GET', url: '/api/test/boom' });
      expect(response.statusCode).toBe(500);
      expectError(response.json(), 'internal_error');
      expect(response.body).not.toContain('hunter2');
    });

    it('a response that breaks the contract is refused, not sent', async () => {
      app.get('/api/test/drift', open, async () =>
        checkContract(z.object({ ok: z.literal(true) }), { ok: false } as never, 'health'),
      );
      const response = await app.inject({ method: 'GET', url: '/api/test/drift' });
      expect(response.statusCode).toBe(500);
      expectError(response.json(), 'contract_violation');
    });
  });
});

describe('production mode', () => {
  afterEach(cleanupTempDirs);

  it('hides the test fixtures', async () => {
    const ctx = makeTestContext({
      NODE_ENV: 'production',
      LOG_LEVEL: 'silent',
      JWT_SECRET: 'a-production-secret-that-is-long-enough-0123',
    });
    const app = await buildApp(ctx);
    const headers = await authHeader(ctx, 'admin');

    const scenarios = await app.inject({ method: 'GET', url: apiPaths.scenarios, headers });
    expect(scenarios.json()).toEqual([]);
    const region = await app.inject({
      method: 'GET',
      url: apiPaths.regionStatic(MINI_REGION_ID),
      headers,
    });
    expect(region.statusCode).toBe(404);
    await app.close();
  });
});

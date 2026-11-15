import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { ApiErrorBodySchema, apiPaths, RegionStaticSchema } from '@bastion/shared';
import { MINI_REGION_ID } from '@bastion/shared/fixtures';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import type { AppContext } from './context';
import { findRule, listRules, updateRule } from './db/rules';
import { DEFAULT_RULES } from './db/seed';
import { authHeader, cleanupTempDirs, demoUser, makeTempDir, makeTestContext } from './testing';

/** A stand-in for apps/web/dist. */
function fakeWebBuild(): string {
  const dir = makeTempDir();
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
  writeFileSync(join(dir, 'assets', 'index-abc123.js'), 'console.log("app")');
  writeFileSync(join(dir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  return dir;
}

describe('serving the web app from the server', () => {
  let app: FastifyInstance;
  let ctx: AppContext;
  const start = async (env: Record<string, string>) => {
    ctx = makeTestContext(env);
    app = await buildApp(ctx);
  };
  const get = (url: string, headers: Record<string, string> = {}) =>
    app.inject({ method: 'GET', url, headers });

  afterEach(async () => {
    await app.close();
    cleanupTempDirs();
  });

  it('serves the page, its assets and their cache headers', async () => {
    await start({ SERVE_WEB: 'true', WEB_DIST_DIR: fakeWebBuild() });

    const page = await get('/');
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.body).toContain('<div id="root">');
    expect(page.headers['cache-control']).toBe('no-cache');

    const asset = await get('/assets/index-abc123.js');
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await get('/favicon.svg')).statusCode).toBe(200);
  });

  it('gives the app its own routes and query strings', async () => {
    await start({ SERVE_WEB: 'true', WEB_DIST_DIR: fakeWebBuild() });
    for (const url of ['/?backend=server', '/ops/op-123', '/login']) {
      const response = await get(url);
      expect(response.statusCode, url).toBe(200);
      expect(response.body, url).toContain('<div id="root">');
    }
  });

  it('never answers for the API, the socket path, public feeds or missing files', async () => {
    await start({ SERVE_WEB: 'true', WEB_DIST_DIR: fakeWebBuild() });
    for (const url of [
      '/api/nope',
      '/api',
      '/public/portland/nope.geojson',
      '/assets/missing.js',
    ]) {
      const response = await get(url);
      expect(response.statusCode, url).toBe(404);
      expect(ApiErrorBodySchema.parse(response.json()).error.code, url).toBe('not_found');
    }
    // The API keeps its rules: protected routes still need a token, health is still public.
    expect((await get(apiPaths.scenarios)).statusCode).toBe(401);
    expect((await get(apiPaths.health)).json()).toEqual({ ok: true });
    const posted = await app.inject({ method: 'POST', url: '/some/page' });
    expect(posted.statusCode).toBe(404);
  });

  it('is off in development, and survives a missing build', async () => {
    await start({ WEB_DIST_DIR: fakeWebBuild() });
    expect(ctx.config.serveWeb).toBe(false);
    expect((await get('/')).statusCode).toBe(404);
    await app.close();

    await start({ SERVE_WEB: 'true', WEB_DIST_DIR: join(makeTempDir(), 'not-built') });
    expect((await get('/')).statusCode).toBe(404);
    expect((await get(apiPaths.health)).statusCode).toBe(200);
  });

  it('is on by default in production', async () => {
    await start({
      NODE_ENV: 'production',
      LOG_LEVEL: 'silent',
      JWT_SECRET: 'a-production-secret-that-is-long-enough-0123',
      WEB_DIST_DIR: fakeWebBuild(),
    });
    expect(ctx.config.serveWeb).toBe(true);
    expect((await get('/')).statusCode).toBe(200);
  });
});

describe('region pack over the wire', () => {
  afterEach(cleanupTempDirs);

  it('is sent gzipped when the client accepts it, and plain otherwise', async () => {
    const ctx = makeTestContext();
    const app = await buildApp(ctx);
    const headers = await authHeader(ctx, 'observer');
    const url = apiPaths.regionStatic(MINI_REGION_ID);

    const plain = await app.inject({ method: 'GET', url, headers });
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(plain.headers.vary).toContain('accept-encoding');

    const zipped = await app.inject({
      method: 'GET',
      url,
      headers: { ...headers, 'accept-encoding': 'gzip, deflate, br' },
    });
    expect(zipped.statusCode).toBe(200);
    expect(zipped.headers['content-encoding']).toBe('gzip');
    expect(zipped.rawPayload.length).toBeLessThan(plain.rawPayload.length / 3);
    const region = RegionStaticSchema.parse(JSON.parse(gunzipSync(zipped.rawPayload).toString()));
    expect(region).toEqual(plain.json());
    expect(ctx.regions.getJsonGzip(MINI_REGION_ID)).toBe(ctx.regions.getJsonGzip(MINI_REGION_ID));
    await app.close();
  });
});

describe('demo reset', () => {
  afterEach(cleanupTempDirs);

  it('ends every operation and restores accounts and rules, for the administrator only', async () => {
    const ctx = makeTestContext();
    const app = await buildApp(ctx);
    const request = {
      regionId: 'region-mini',
      scenarioId: 'scenario-mini',
      mode: 'exercise',
    } as const;
    const running = ctx.operations.create(request, demoUser('operator'));
    ctx.operations.control(running.id, { command: 'start' });
    ctx.operations.create(request, demoUser('operator'));
    updateRule(ctx.db, 'rule-fire-dispatch', { autonomy: 'off', params: { minSeverity: 1 } });
    ctx.db.prepare("UPDATE users SET name = 'Changed' WHERE id = 'user-observer'").run();

    for (const role of ['operator', 'coordinator', 'utility_operator', 'observer'] as const) {
      const denied = await app.inject({
        method: 'POST',
        url: apiPaths.adminDemoReset,
        headers: await authHeader(ctx, role),
      });
      expect(denied.statusCode, role).toBe(403);
    }
    expect(ctx.operations.list()).toHaveLength(2);

    const reset = await app.inject({
      method: 'POST',
      url: apiPaths.adminDemoReset,
      headers: await authHeader(ctx, 'admin'),
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toEqual({ ok: true, operationsEnded: 2 });

    expect(ctx.operations.list()).toEqual([]);
    expect(ctx.operations.get(running.id)).toBeUndefined();
    expect(findRule(ctx.db, 'rule-fire-dispatch')).toMatchObject({
      autonomy: 'auto',
      params: { minSeverity: 4, minConfidence: 0.7 },
    });
    expect(listRules(ctx.db)).toHaveLength(DEFAULT_RULES.length);
    expect(ctx.db.prepare("SELECT name FROM users WHERE id = 'user-observer'").get()?.name).toBe(
      'Jordan Lee',
    );
    const statuses = ctx.db
      .prepare('SELECT status FROM operations')
      .all()
      .map((row) => row.status);
    expect(statuses).toEqual(['ended', 'ended']);
    expect(
      ctx.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE verb = 'demo.reset'").get()?.n,
    ).toBe(1);

    // The server is immediately usable again.
    const again = ctx.operations.create(request, demoUser('operator'));
    expect(again.status).toBe('ready');
    await app.close();
  });
});

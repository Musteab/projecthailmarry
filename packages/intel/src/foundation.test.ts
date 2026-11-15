import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import Fastify from 'fastify';
import { loadRegionMini } from '@bastion/shared/fixtures';
import { makeInitialWorld } from '@bastion/shared';
import type { IntelHost, IntelContext } from '@bastion/shared';
import { FakeProvider } from './llm';
import { IntelService } from './port/service';
import { createIntel } from './port';
import { cacheKey } from './cache';
import { intelPlugin } from './plugin';
const directories: string[] = [];
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'bastion-intel-'));
  directories.push(path);
  return path;
}
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(directories.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
const schema = z.object({ value: z.number() });
it('retries schema failures once then falls back', async () => {
  const provider = new FakeProvider(() => ({ value: 'bad' }));
  const service = new IntelService({ mode: 'live', provider, cacheDir: await directory() });
  expect(
    await service.run('test', 'v1', 'model', 'system', {}, schema, () => ({ value: 7 })),
  ).toEqual({ value: 7 });
  expect(provider.calls).toHaveLength(2);
});
it('reads through live cache, uses no network in cache mode, and bypasses cache in off mode', async () => {
  const path = await directory(),
    provider = new FakeProvider(() => ({ value: 42 }));
  const live = new IntelService({ mode: 'live', provider, cacheDir: path });
  const invoke = (s: IntelService) =>
    s.run('test', 'v1', 'model', 'system', { a: 1 }, schema, () => ({ value: 0 }));
  expect(await invoke(live)).toEqual({ value: 42 });
  expect(await invoke(live)).toEqual({ value: 42 });
  expect(provider.calls).toHaveLength(1);
  expect(await invoke(new IntelService({ mode: 'cache', provider, cacheDir: path }))).toEqual({
    value: 42,
  });
  expect(await invoke(new IntelService({ mode: 'off', provider, cacheDir: path }))).toEqual({
    value: 0,
  });
  expect(provider.calls).toHaveLength(1);
  const miss = new IntelService({ mode: 'cache', provider, cacheDir: await directory() });
  expect(await invoke(miss)).toEqual({ value: 0 });
  expect(provider.calls).toHaveLength(1);
  expect(cacheKey({ a: 1, b: 2 })).toBe(cacheKey({ b: 2, a: 1 }));
});
it('bounds a hanging provider and aborts it', async () => {
  const provider = new FakeProvider(() => new Promise(() => {}));
  const service = new IntelService({
    mode: 'live',
    provider,
    timeoutMs: 30,
    cacheDir: await directory(),
  });
  const start = Date.now();
  expect(
    await service.run('test', 'v1', 'model', 'system', {}, schema, () => ({ value: 9 })),
  ).toEqual({ value: 9 });
  expect(Date.now() - start).toBeLessThan(1000);
  expect(provider.calls[0].signal?.aborted).toBe(true);
});
it('answers every port method deterministically with no key and mounts through IntelHost', async () => {
  const region = loadRegionMini();
  const world = makeInitialWorld(
    {
      id: 'op',
      regionId: region.config.id,
      scenarioId: null,
      mode: 'exercise',
      name: 'Test',
      status: 'running',
      createdBy: 'u',
      createdAt: '2026-01-01',
    },
    region,
  );
  const ctx: IntelContext = {
    operation: world.operation,
    clock: world.clock,
    region: region.config,
    incidents: [],
    hazards: [],
    metrics: world.metrics,
  };
  const port = createIntel({ mode: 'off' });
  const call = {
    id: 'call',
    source: 'call_911' as const,
    simTime: 0,
    title: 'Chest pain',
    body: 'An adult reports chest pain',
    position: region.cells[0].center,
    reliability: 0.9,
  };
  expect(await port.fuse([call], ctx)).toEqual(await port.fuse([call], ctx));
  expect((await port.triage(call, ctx)).recommendedUnit).toBe('als_ambulance');
  expect(
    await port.narrateRestoration(
      {
        computedAt: 0,
        accessThresholdMin: 15,
        baseline: { isolatedPop: 0, noHospitalAccessPop: 0, noShelterAccessPop: 0 },
        candidates: [],
        options: [],
        recommendedOptionId: null,
      },
      ctx,
    ),
  ).toEqual({});
  const host: IntelHost = {
    getWorld: () => world,
    getRegion: () => region,
    listLiveOperations: () => [],
    ingestSignal: (_id, s) => ({ ...s, id: 's', simTime: 0 }),
    authenticate: async () => {},
  };
  const app = Fastify();
  await app.register(intelPlugin, { host, config: { mode: 'off' } });
  expect((await app.inject('/api/intel/health')).statusCode).toBe(200);
  await app.close();
});

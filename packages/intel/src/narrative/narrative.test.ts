import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify from 'fastify';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { BriefingSchema, makeInitialWorld } from '@bastion/shared';
import type { Action, IntelHost } from '@bastion/shared';
import { loadRegionMini } from '@bastion/shared/fixtures';
import { numbersGrounded, grounded, explain } from './index';
import { FakeProvider } from '../llm';
import { IntelService } from '../port/service';
import { fusionSchema } from '../fusion';
import { validRefs } from '../briefing';
import { intelPlugin } from '../plugin';
it('rejects invented figures and keeps model output schemas serializable', () => {
  expect(numbersGrounded('Restore access for 1,021 people', { people: 1021 })).toBe(true);
  expect(numbersGrounded('Restore access for 999 people', { people: 1021 })).toBe(false);
  expect(() => zodOutputFormat(fusionSchema)).not.toThrow();
  expect(() => zodOutputFormat(grounded(BriefingSchema, {}))).not.toThrow();
});
it('retries an invented narrative then returns the factual decision headline', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'narrative-'));
  try {
    const provider = new FakeProvider(() => ({ text: '999 people rescued' }));
    const service = new IntelService({ mode: 'live', provider, cacheDir });
    const action = {
      explain: {
        headline: 'Dispatch Rescue 2; ETA 4 min',
        factors: [{ label: 'ETA', value: '4 min' }],
        alternatives: [],
      },
      status: 'proposed',
      authority: 'fire_rescue',
    } as unknown as Action;
    expect(await explain(service, action)).toBe(action.explain.headline);
    expect(provider.calls).toHaveLength(2);
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});
it('authenticates briefing/copilot routes and rejects invalid entity references', async () => {
  const region = loadRegionMini();
  const world = makeInitialWorld(
    {
      id: 'op',
      regionId: region.config.id,
      scenarioId: null,
      mode: 'exercise',
      name: 'test',
      status: 'running',
      createdBy: 'u',
      createdAt: '2026-01-01',
    },
    region,
  );
  const host: IntelHost = {
    getWorld: (id) => (id === 'op' ? world : undefined),
    getRegion: () => region,
    listLiveOperations: () => [],
    ingestSignal: (_id, s) => ({ ...s, id: 's', simTime: 0 }),
    authenticate: async (req: { headers: Record<string, string> }) => {
      if (req.headers.authorization !== 'Bearer test')
        throw Object.assign(new Error('Sign in'), { statusCode: 401 });
    },
  };
  const app = Fastify();
  await app.register(intelPlugin, { host, config: { mode: 'off' } });
  try {
    expect(
      (await app.inject({ method: 'POST', url: '/api/intel/operations/op/briefing', payload: {} }))
        .statusCode,
    ).toBe(401);
    const auth = { authorization: 'Bearer test' };
    const response = await app.inject({
      method: 'POST',
      url: '/api/intel/operations/op/briefing',
      headers: auth,
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(BriefingSchema.safeParse(response.json()).success).toBe(true);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/intel/operations/missing/briefing',
          headers: auth,
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/intel/operations/op/copilot',
          headers: auth,
          payload: { question: '' },
        })
      ).statusCode,
    ).toBe(400);
    expect(validRefs([{ actionId: 'invented' }], world, region)).toBe(false);
    expect(validRefs([{ unitId: Object.keys(world.units)[0] }], world, region)).toBe(true);
  } finally {
    await app.close();
  }
});

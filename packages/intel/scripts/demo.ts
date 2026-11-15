import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import type { Operation, RestorationAnalysis, WorkOrder } from '@bastion/shared';
import { apiPaths, ScenarioSchema } from '@bastion/shared';
import {
  makeTestContext,
  demoUser,
  TEST_PASSWORD,
  cleanupTempDirs,
} from '../../../apps/server/src/testing';
import { buildApp } from '../../../apps/server/src/app';
import { readRegionPack } from '../../../apps/server/src/region/pack';
import { createIntel } from '../src/port';
import { intelPlugin } from '../src/plugin';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const scenarios = ['flash-flood-johnson-creek', 'earthquake-portland-hills'];
readRegionPack(root + 'data/regions', 'portland');
for (const id of scenarios)
  ScenarioSchema.parse(JSON.parse(await readFile(root + 'data/scenarios/' + id + '.json', 'utf8')));
if (process.argv[2] === 'prewarm') {
  for (const id of scenarios) {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'scripts/scenario-check.ts', id, '--warm'],
      { cwd: root + 'packages/intel', encoding: 'utf8' },
    );
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  }
  const files = (await readdir(root + 'data/fixtures/ai-cache')).filter((f) =>
    /^[a-f0-9]{64}\.json$/.test(f),
  );
  for (const file of files)
    JSON.parse(await readFile(root + 'data/fixtures/ai-cache/' + file, 'utf8'));
  console.log(
    JSON.stringify({
      region: 'portland',
      scenarios,
      cacheFiles: files.length,
      cacheSource: 'labelled deterministic rehearsal fixtures',
      mapboxTokenPresent: !!process.env.VITE_MAPBOX_TOKEN,
      mapboxRequired: false,
    }),
  );
} else if (process.argv[2] !== 'check-once') {
  const results = [];
  for (let run = 0; run < 3; run++) {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'scripts/demo.ts', 'check-once'],
      { cwd: root + 'packages/intel', encoding: 'utf8' },
    );
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
    results.push(JSON.parse(result.stdout));
  }
  console.log(
    JSON.stringify({ runsPerScenario: 3, isolatedBackendPerRun: true, results }, null, 2),
  );
} else {
  const failures: unknown[] = [];
  const ctx = makeTestContext(
    { DATA_DIR: root + 'data' },
    {
      intel: { port: createIntel({ mode: 'cache' }), plugin: intelPlugin, source: 'package' },
      logger: { error: (message, error) => failures.push({ message, error }) },
    },
  );
  const app = await buildApp(ctx);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  let token = '';
  const request = async <T>(path: string, body: unknown): Promise<T> => {
    const r = await fetch(base + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
    return r.json() as Promise<T>;
  };
  const login = async (role: 'operator' | 'coordinator') => {
    token = (
      await request<{ token: string }>(apiPaths.login, {
        email: demoUser(role).email,
        password: TEST_PASSWORD,
      })
    ).token;
  };
  const results = [];
  try {
    for (let run = 0; run < 1; run++)
      for (const id of scenarios) {
        await login('operator');
        const operation = await request<Operation>(apiPaths.operations, {
          regionId: 'portland',
          scenarioId: id,
          mode: 'exercise',
        });
        await request(apiPaths.operationControl(operation.id), { command: 'speed', speed: 60 });
        await request(apiPaths.operationControl(operation.id), { command: 'start' });
        const rt = ctx.operations.require(operation.id);
        let order: WorkOrder | undefined;
        let topLabel = '';
        while (!rt.finished) {
          await rt.advanceSettled(1);
          if (rt.simTime >= 700 && id === scenarios[0] && !order)
            for (const a of Object.values(rt.world.actions))
              if (a.kind === 'activate_shelter' && a.status === 'awaiting_approval')
                await request(apiPaths.actionApprove(a.id), {});
          if (!order && rt.simTime >= (id === scenarios[0] ? 1110 : 490)) {
            await login('coordinator');
            const analysis = await request<RestorationAnalysis>(
              apiPaths.restorationAnalyze(operation.id),
              {},
            );
            assert(analysis.recommendedOptionId);
            topLabel = analysis.options.find((o) => o.id === analysis.recommendedOptionId)!.label;
            order = await request<WorkOrder>(apiPaths.workOrders(operation.id), {
              optionId: analysis.recommendedOptionId,
            });
          }
        }
        assert(order);
        assert.equal(
          rt.world.workOrders[order.id].status,
          'reopened',
          `${id}: work order did not reopen before the exercise ended`,
        );
        const executed = Object.values(rt.world.actions).filter((a) => a.status === 'executed');
        const dispatch = executed.find((a) => a.payload.kind === 'dispatch_unit')!.payload;
        const ambulance = executed.find((a) => a.payload.kind === 'assign_ambulance')!.payload;
        assert.equal(dispatch.kind, 'dispatch_unit');
        assert.equal(ambulance.kind, 'assign_ambulance');
        results.push({
          run,
          scenario: id,
          crew: 'unitId' in dispatch ? dispatch.unitId : '',
          hospital: 'hospitalId' in ambulance ? ambulance.hospitalId : '',
          topRepair: topLabel,
          workOrder: 'reopened',
        });
        await login('operator');
        await request(apiPaths.operationControl(operation.id), { command: 'end' });
      }
    assert.equal(failures.length, 0, JSON.stringify(failures));
    for (let i = 0; i < results.length; i += 2) {
      assert.notEqual(results[i].crew, results[i + 1].crew);
      assert.notEqual(results[i].hospital, results[i + 1].hospital);
      assert.notEqual(results[i].topRepair, results[i + 1].topRepair);
    }
    console.log(JSON.stringify({ configuredSpeed: 60, runsPerScenario: 1, results }, null, 2));
  } finally {
    await app.close();
    cleanupTempDirs();
  }
}

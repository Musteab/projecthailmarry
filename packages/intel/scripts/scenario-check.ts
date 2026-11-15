/** Integration harness: reads server exports but never modifies server code. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { ScenarioSchema } from '@bastion/shared';
import type { IntelContext, Signal } from '@bastion/shared';
import { readRegionPack } from '../../../apps/server/src/region/pack';
import { buildRegionIndex } from '../../../apps/server/src/region';
import { OperationRuntime } from '../../../apps/server/src/sim/runtime';
import { defaultSystems } from '../../../apps/server/src/sim/systems';
import { createIntel } from '../src/port';
import { FakeProvider } from '../src/llm';
import { fallbackCluster } from '../src/fusion';
import { fallbackTriage } from '../src/triage';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const scenarioId = process.argv[2] ?? 'flash-flood-johnson-creek';
const warm = process.argv.includes('--warm');
const scenario = ScenarioSchema.parse(
  JSON.parse(await readFile(join(root, 'data/scenarios', scenarioId + '.json'), 'utf8')),
);
const region = readRegionPack(join(root, 'data/regions'), scenario.regionId);
const index = buildRegionIndex(region);
const provider = new FakeProvider((request) => {
  const input = JSON.parse(request.user);
  if (input.call) return fallbackTriage(input.call);
  const ctx = { region: input.region, incidents: input.incidents } as IntelContext;
  return {
    candidates: (input.clusters as Signal[][]).flatMap((g) => {
      const c = fallbackCluster(g, ctx);
      return c ? [c] : [];
    }),
  };
});
const results = [];
for (let run = 0; run < (warm ? 1 : 3); run++) {
  const failures: unknown[] = [];
  const rt = new OperationRuntime({
    operation: {
      id: 'check-' + run,
      regionId: scenario.regionId,
      scenarioId: scenario.id,
      mode: 'exercise',
      name: 'Scenario check',
      status: 'running',
      createdBy: 'check',
      createdAt: '2026-01-01T00:00:00Z',
    },
    index,
    scenario,
    systems: defaultSystems(
      createIntel({
        mode: warm ? 'live' : 'cache',
        provider,
        cacheDir: join(root, 'data/fixtures/ai-cache'),
      }),
    ),
    logger: { error: (message, error) => failures.push({ message, error }) },
  });
  let maxWet = 0,
    maxRoads = 0;
  const beats: string[] = [];
  for (let t = 0; t < scenario.durationSimSec; t++) {
    await rt.advanceSettled(1);
    maxWet = Math.max(maxWet, Object.keys(rt.world.cells).length);
    maxRoads = Math.max(maxRoads, Object.keys(rt.world.roads).length);
    beats.push(...rt.drainBeats().map((b) => b.id));
  }
  assert.equal(failures.length, 0, JSON.stringify(failures));
  const snapshot = rt.world.toSnapshot();
  assert.equal(beats.length, scenario.beats.length);
  const incidents = Object.values(snapshot.incidents);
  if (scenario.hazard === 'flash_flood') {
    assert(maxWet > 0);
    assert(maxRoads > 0);
    const rescue = incidents.find((i) => i.kind === 'water_rescue');
    assert(rescue);
    assert.equal(rescue.sourceSignalIds.length, 3);
    assert(rescue.confidence >= 0.85);
    assert(
      incidents.some((i) => i.kind === 'medical' && i.triage?.recommendedUnit === 'als_ambulance'),
    );
    assert.equal(snapshot.roads['way-5293984-8']?.status, 'blocked');
  }
  results.push({
    scenario: scenario.id,
    maxWet,
    maxRoads,
    beats: beats.length,
    incidents: incidents.map((i) => ({
      kind: i.kind,
      sources: i.sourceSignalIds.length,
      confidence: i.confidence,
    })),
    actions: Object.values(snapshot.actions).length,
    restoration: !!snapshot.restoration,
  });
}
if (!warm) assert.equal(provider.calls.length, 0, 'cache mode attempted a model call');
if (warm) {
  await mkdir(join(root, 'data/fixtures/ai-cache'), { recursive: true });
  await writeFile(
    join(root, 'data/fixtures/ai-cache', scenarioId + '.provenance.json'),
    JSON.stringify(
      {
        scenarioId,
        source: 'deterministic-rule-fallback',
        modelGenerated: false,
        entries: provider.calls.length,
        note: 'Rehearsal fixtures, not claimed Claude responses.',
      },
      null,
      2,
    ) + '\n',
  );
}
console.log(JSON.stringify({ warm, providerCalls: provider.calls.length, results }, null, 2));

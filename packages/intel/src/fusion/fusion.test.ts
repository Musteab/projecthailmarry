import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeInitialWorld } from '@bastion/shared';
import type { IntelContext, Signal } from '@bastion/shared';
import { loadRegionMini } from '@bastion/shared/fixtures';
import { clusterSignals, fallbackCluster, fuse, fusionSchema, guardCandidates } from './index';
import { IntelService } from '../port/service';
import { FakeProvider } from '../llm';
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
const signals: Signal[] = (['field_report', 'call_911', 'imagery'] as const).map((source, i) => ({
  id: `s${i}`,
  source,
  simTime: i * 10,
  position: region.cells[0].center,
  title: 'Family stranded by rising water',
  body: 'People trapped on the upper floor',
  reliability: 0.9,
}));
it('combines corroboration while separating a medical call and distant times', async () => {
  const medical: Signal = {
    ...signals[0],
    id: 'medical',
    title: 'Chest pain',
    body: 'Adult with chest pain',
  };
  const groups = clusterSignals(
    [...signals, medical, { ...signals[0], id: 'late', simTime: 500 }],
    ctx,
  );
  expect(groups).toHaveLength(3);
  const result = await fuse(new IntelService({ mode: 'off' }), [...signals, medical], ctx);
  expect(result).toHaveLength(2);
  const rescue = result.find((c) => c.kind === 'water_rescue')!;
  expect(rescue.sourceSignalIds).toEqual(['s0', 's1', 's2']);
  expect(rescue.severity).toBeGreaterThanOrEqual(4);
  expect(rescue.confidence).toBeGreaterThanOrEqual(0.85);
});
it('reduces confidence for contradiction and drops weak evidence', () => {
  const baseline = fallbackCluster(signals, ctx)!;
  const conflict = {
    ...signals[0],
    id: 'rumor',
    source: 'social' as const,
    body: 'No one trapped; false report',
    reliability: 0.2,
  };
  expect(fallbackCluster([...signals, conflict], ctx)!.confidence).toBeLessThan(
    baseline.confidence,
  );
  expect(fallbackCluster([conflict], ctx)).toBeUndefined();
  expect(
    fallbackCluster([{ ...signals[0], source: 'social', reliability: 0.2 }], ctx),
  ).toBeUndefined();
});
it('rejects invented identifiers, locations, merge targets and clamps numeric output', () => {
  const baseline = fallbackCluster(signals, ctx)!;
  const hostile = {
    ...baseline,
    sourceSignalIds: ['made-up'],
    position: [0, 0] as [number, number],
    mergeWithIncidentId: 'invented',
  };
  expect(guardCandidates([hostile], [signals], ctx)).toEqual([baseline]);
  const parsed = fusionSchema.parse({ candidates: [{ ...baseline, severity: 99, confidence: 2 }] });
  expect(parsed.candidates[0].severity).toBe(5);
  expect(parsed.candidates[0].confidence).toBe(1);
  expect(clusterSignals([{ ...signals[0], position: [0, 0] }], ctx)).toEqual([]);
});
it('replays the validated golden response without invoking a provider', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'fusion-'));
  try {
    const golden = { candidates: [fallbackCluster(signals, ctx)!] };
    const provider = new FakeProvider(() => golden);
    const live = await fuse(new IntelService({ mode: 'live', provider, cacheDir }), signals, ctx);
    const cached = await fuse(new IntelService({ mode: 'cache', provider, cacheDir }), signals, {
      ...ctx,
      operation: { ...ctx.operation, id: 'another-run' },
    });
    expect(cached).toEqual(live);
    expect(provider.calls).toHaveLength(1);
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

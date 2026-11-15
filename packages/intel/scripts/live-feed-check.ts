/** Explicit opt-in network smoke check against official public feeds. */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeTestContext, demoUser, cleanupTempDirs } from '../../../apps/server/src/testing';
import { createIntelHost } from '../../../apps/server/src/intel/host';
import { FeedScheduler, createFeedAdapters } from '../src/feeds';
const ctx = makeTestContext({
  DATA_DIR: fileURLToPath(new URL('../../../data/', import.meta.url)),
});
try {
  const operation = ctx.operations.create(
    { regionId: 'portland', scenarioId: null, mode: 'live', name: 'Isolated feed verification' },
    demoUser('admin'),
  );
  const host = createIntelHost({
    operations: ctx.operations,
    regions: ctx.regions,
    auth: ctx.auth,
  });
  const feeds = new FeedScheduler(host, (region) => createFeedAdapters(region), true, console.warn);
  const start = Date.now();
  await feeds.pollOnce();
  feeds.stop();
  const signals = host.getWorld(operation.id)!.signals;
  assert(
    signals.some((s) => s.data?.feed === 'usgs-gauge'),
    'No gauge observation reached the live operation',
  );
  assert(Date.now() - start < 60000);
  console.log(
    JSON.stringify({
      signals: signals.map((s) => ({ source: s.source, title: s.title })),
      elapsedMs: Date.now() - start,
    }),
  );
} finally {
  ctx.close();
  cleanupTempDirs();
}

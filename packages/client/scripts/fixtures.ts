import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { apiPaths } from '@bastion/shared';
import { MockTransport } from '../src/transport/mock';
import type { RecordedFrame } from '../src/mock/recording';

// These are generated MOCK captures. They are not recordings of the real server.
const directory = fileURLToPath(new URL('../../../data/fixtures/', import.meta.url));
mkdirSync(directory, { recursive: true });
for (const scenarioId of ['mock-flood', 'mock-quake']) {
  const mock = new MockTransport();
  await mock.request('POST', apiPaths.operations, {
    regionId: mock.region.config.id,
    scenarioId,
    mode: 'exercise',
  });
  const frames: RecordedFrame[] = [];
  let elapsedMs = 0;
  const stop = mock.connect(mock.world.operation.id, (message) =>
    frames.push({ elapsedMs, message }),
  );
  await mock.request('POST', apiPaths.operationControl(mock.world.operation.id), {
    command: 'start',
  });
  // One sim-second tick per frame, captured on a deterministic 5x wall clock.
  while (mock.world.operation.status !== 'ended') {
    elapsedMs += 200;
    mock.advance(0.2);
  }
  stop();
  writeFileSync(
    `${directory}${scenarioId}.ndjson`,
    frames.map((frame) => JSON.stringify(frame)).join('\n') + '\n',
  );
  console.log(`${scenarioId}: ${frames.length} messages`);
}

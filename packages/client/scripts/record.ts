import { appendFileSync, mkdirSync, writeFileSync, linkSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { captureRun } from '../src/mock/capture';

async function main() {
  const { values } = parseArgs({
    options: {
      url: { type: 'string', default: 'ws://127.0.0.1:8787/ws' },
      operation: { type: 'string' },
      out: { type: 'string' },
      seconds: { type: 'string', default: '60' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(
      'pnpm --filter @bastion/client record --operation <id> [--url ws://127.0.0.1:8787/ws] [--seconds 60] [--out data/fixtures/run.ndjson]\nReads BASTION_TOKEN from the environment. Output paths are relative to the repository root. Existing files are never overwritten.',
    );
    return;
  }
  if (!values.operation) throw new Error('--operation is required');
  const seconds = Number(values.seconds);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 3600)
    throw new Error('--seconds must be between 0 and 3600');
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const output = resolve(root, values.out ?? `data/fixtures/run-${Date.now()}.ndjson`);
  mkdirSync(dirname(output), { recursive: true });
  const temporary = `${output}.${randomUUID()}.partial`;
  writeFileSync(temporary, '', { flag: 'wx', mode: 0o600 });
  try {
    const count = await captureRun({
      url: values.url,
      operationId: values.operation,
      seconds,
      token: process.env.BASTION_TOKEN,
      onFrame: (frame) => appendFileSync(temporary, JSON.stringify(frame) + '\n'),
    });
    // A hard link publishes the completed file atomically and fails if the destination exists.
    linkSync(temporary, output);
    console.log(`Recorded ${count} messages to ${output}`);
  } finally {
    unlinkSync(temporary);
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Recording failed');
  process.exitCode = 1;
});

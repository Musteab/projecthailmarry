import { expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { buildApp } from '../../../../apps/server/src/app';
import {
  makeTestContext,
  cleanupTempDirs,
  TEST_PASSWORD,
  demoUser,
} from '../../../../apps/server/src/testing';
import { apiPaths } from '@bastion/shared';
import type { Operation, ServerMessage } from '@bastion/shared';
import { HttpWsTransport } from './index';
const until = async (test: () => boolean) => {
  const deadline = Date.now() + 6000;
  while (!test()) {
    if (Date.now() > deadline) throw new Error('Timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};
it('uses real login, commands, snapshots and reconnects to a fresh server', async () => {
  const ctx = makeTestContext();
  let app = await buildApp(ctx);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const port = (app.server.address() as AddressInfo).port;
  let token: string | undefined;
  const diagnostics: unknown[] = [];
  const transport = new HttpWsTransport({
    apiUrl: `http://127.0.0.1:${port}`,
    getToken: () => token,
    onContractError: (e) => diagnostics.push(e),
  });
  const messages: ServerMessage[] = [];
  let stop: () => void = () => {};
  try {
    const login = await transport.request<{ token: string }>('POST', apiPaths.login, {
      email: demoUser('admin').email,
      password: TEST_PASSWORD,
    });
    token = login.token;
    const op = await transport.request<Operation>('POST', apiPaths.operations, {
      regionId: 'region-mini',
      scenarioId: 'scenario-mini',
      mode: 'exercise',
    });
    stop = transport.connect(op.id, (m) => messages.push(m));
    await until(() => messages.some((m) => m.t === 'snapshot'));
    await transport.request('POST', apiPaths.operationControl(op.id), { command: 'start' });
    await until(() => messages.some((m) => m.t === 'tick'));
    await app.close();
    const fresh = makeTestContext();
    app = await buildApp(fresh);
    await app.listen({ host: '127.0.0.1', port });
    // Recreate the operation after process loss; persisted operations are a server responsibility.
    token = (
      await transport.request<{ token: string }>('POST', apiPaths.login, {
        email: demoUser('admin').email,
        password: TEST_PASSWORD,
      })
    ).token;
    await until(() => messages.some((m) => m.t === 'error' && m.code !== 'invalid_message'));
    stop();
    const replacement = await transport.request<Operation>('POST', apiPaths.operations, {
      regionId: 'region-mini',
      scenarioId: 'scenario-mini',
      mode: 'exercise',
    });
    stop = transport.connect(replacement.id, (m) => messages.push(m));
    await until(() => messages.filter((m) => m.t === 'snapshot').length >= 2);
    token = (
      await transport.request<{ token: string }>('POST', apiPaths.login, {
        email: demoUser('observer').email,
        password: TEST_PASSWORD,
      })
    ).token;
    await expect(
      transport.request('POST', apiPaths.operationControl(replacement.id), { command: 'start' }),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
    expect(diagnostics).toEqual([]);
  } finally {
    stop();
    await app.close();
    cleanupTempDirs();
  }
}, 15000);

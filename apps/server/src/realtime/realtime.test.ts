import type { AddressInfo } from 'node:net';
import type { ClientMessage, Operation, ServerMessage, WorldSnapshot } from '@bastion/shared';
import { apiPaths, applyWorldPatch, ServerMessageSchema } from '@bastion/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { buildApp } from '../app';
import type { AppContext } from '../context';
import { cleanupTempDirs, demoUser, makeTestContext } from '../testing';

/** A real WebSocket client that records what it receives and mirrors the world. */
class Client {
  readonly messages: ServerMessage[] = [];
  world: WorldSnapshot | undefined;
  private waiters: Array<() => void> = [];

  private constructor(readonly socket: WebSocket) {
    socket.on('message', (raw) => {
      // Every frame must satisfy the contract.
      const message = ServerMessageSchema.parse(JSON.parse(raw.toString()));
      this.messages.push(message);
      if (message.t === 'snapshot') this.world = message.world;
      if (message.t === 'tick' && this.world) {
        this.world = applyWorldPatch(this.world, message.patch, message.clock);
      }
      for (const wake of this.waiters.splice(0)) wake();
    });
  }

  static connect(port: number, token?: string): Promise<Client> {
    const query = token === undefined ? '' : `?token=${encodeURIComponent(token)}`;
    const socket = new WebSocket(`ws://127.0.0.1:${port}${apiPaths.ws}${query}`);
    return new Promise((resolve, reject) => {
      socket.once('open', () => resolve(new Client(socket)));
      socket.once('error', reject);
    });
  }

  send(message: ClientMessage | string): void {
    this.socket.send(typeof message === 'string' ? message : JSON.stringify(message));
  }

  /** Resolves with the first message (already received or yet to come) matching `test`. */
  async waitFor<T extends ServerMessage>(
    test: (message: ServerMessage) => message is T,
    fromIndex = 0,
  ): Promise<T> {
    const deadline = Date.now() + 3000;
    let cursor = fromIndex;
    for (;;) {
      for (; cursor < this.messages.length; cursor++) {
        const message = this.messages[cursor]!;
        if (test(message)) return message;
      }
      if (Date.now() > deadline) throw new Error('Timed out waiting for a WebSocket message');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 50);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  untilSimTime(simTime: number) {
    return this.waitFor(
      (message): message is Extract<ServerMessage, { t: 'tick' }> =>
        message.t === 'tick' && message.clock.simTime >= simTime,
    );
  }

  close(): void {
    this.socket.close();
  }
}

const isSnapshot = (m: ServerMessage): m is Extract<ServerMessage, { t: 'snapshot' }> =>
  m.t === 'snapshot';
const isError = (m: ServerMessage): m is Extract<ServerMessage, { t: 'error' }> => m.t === 'error';

describe('realtime WebSocket', () => {
  let ctx: AppContext;
  let app: FastifyInstance;
  let port: number;
  let token: string;
  let operation: Operation;
  const clients: Client[] = [];

  const connect = async (withToken: string | undefined = token) => {
    const client = await Client.connect(port, withToken);
    clients.push(client);
    return client;
  };

  beforeEach(async () => {
    ctx = makeTestContext();
    app = await buildApp(ctx);
    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as AddressInfo).port;
    token = await ctx.auth.tokens.issue(demoUser('operator'));
    operation = ctx.operations.create(
      { regionId: 'region-mini', scenarioId: 'scenario-mini', mode: 'exercise' },
      demoUser('operator'),
    );
  });
  afterEach(async () => {
    for (const client of clients.splice(0)) client.close();
    await app.close();
    cleanupTempDirs();
  });

  it('refuses the handshake without a valid token', async () => {
    await expect(connect('')).rejects.toThrow(/401/);
    await expect(connect('not-a-token')).rejects.toThrow(/401/);
    await expect(Client.connect(port)).rejects.toThrow(/401/);
  });

  it('answers subscribe with a snapshot of the current world', async () => {
    const client = await connect();
    client.send({ t: 'subscribe', operationId: operation.id });
    const snapshot = await client.waitFor(isSnapshot);
    expect(snapshot.world).toEqual(ctx.operations.snapshot(operation.id));
    expect(snapshot.world.operation.id).toBe(operation.id);
  });

  it('reports unknown operations and unreadable messages without dropping the connection', async () => {
    const client = await connect();
    client.send({ t: 'subscribe', operationId: 'op-missing' });
    expect((await client.waitFor(isError)).code).toBe('unknown_operation');

    client.send('{ definitely not json');
    expect((await client.waitFor(isError, 1)).code).toBe('bad_message');

    client.send({ t: 'ping' });
    client.send({ t: 'subscribe', operationId: operation.id });
    await client.waitFor(isSnapshot);
  });

  it('streams ticks whose patches rebuild exactly what GET returns', async () => {
    const client = await connect();
    client.send({ t: 'subscribe', operationId: operation.id });
    await client.waitFor(isSnapshot);

    ctx.operations.control(operation.id, { command: 'start' });
    ctx.operations.control(operation.id, { command: 'speed', speed: 20 });
    for (let i = 0; i < 15; i++) ctx.operations.tick(1000);
    await client.untilSimTime(300);

    const viaRest = await app.inject({
      method: 'GET',
      url: apiPaths.operation(operation.id),
      headers: { authorization: `Bearer ${token}` },
    });
    expect(client.world).toEqual(viaRest.json());
    expect(client.world!.operation.status).toBe('ended');

    const beats = client.messages.filter((message) => message.t === 'beat');
    expect(beats).toHaveLength(4);
    expect(client.messages.some((message) => message.t === 'error')).toBe(false);
  });

  it('keeps two clients in sync, including one that joins mid-run', async () => {
    const early = await connect();
    early.send({ t: 'subscribe', operationId: operation.id });
    await early.waitFor(isSnapshot);

    ctx.operations.control(operation.id, { command: 'start' });
    for (let i = 0; i < 20; i++) ctx.operations.tick(1000); // 100 sim seconds at speed 5
    await early.untilSimTime(100);

    const late = await connect(await ctx.auth.tokens.issue(demoUser('observer')));
    late.send({ t: 'subscribe', operationId: operation.id });
    const joined = await late.waitFor(isSnapshot);
    expect(joined.world.clock.simTime).toBe(100);
    expect(joined.world).toEqual(early.world);

    for (let i = 0; i < 20; i++) ctx.operations.tick(1000);
    await Promise.all([early.untilSimTime(200), late.untilSimTime(200)]);
    expect(late.world).toEqual(early.world);
    expect(late.world).toEqual(ctx.operations.snapshot(operation.id));
  });

  it('pushes the effect of a command straight away, and a new snapshot on reset', async () => {
    const client = await connect();
    client.send({ t: 'subscribe', operationId: operation.id });
    await client.waitFor(isSnapshot);

    ctx.operations.inject(operation.id, { kind: 'unit_out_of_service', unitId: 'u-usar-1' });
    await client.waitFor(
      (message): message is Extract<ServerMessage, { t: 'tick' }> =>
        message.t === 'tick' && message.patch.units?.['u-usar-1']?.status === 'out_of_service',
    );
    expect(client.world!.units['u-usar-1']!.status).toBe('out_of_service');

    const before = client.messages.length;
    ctx.operations.control(operation.id, { command: 'reset' });
    const fresh = await client.waitFor(isSnapshot, before);
    expect(fresh.world.units['u-usar-1']!.status).toBe('available');
  });

  it('stops sending after a client leaves and survives a reconnect', async () => {
    const first = await connect();
    first.send({ t: 'subscribe', operationId: operation.id });
    await first.waitFor(isSnapshot);
    ctx.operations.control(operation.id, { command: 'start' });
    ctx.operations.tick(2000);
    await first.untilSimTime(10);

    first.close();
    await new Promise((resolve) => first.socket.once('close', resolve));
    ctx.operations.tick(2000); // must not throw with no subscribers

    const second = await connect();
    second.send({ t: 'subscribe', operationId: operation.id });
    const snapshot = await second.waitFor(isSnapshot);
    expect(snapshot.world.clock.simTime).toBe(20);
    expect(snapshot.world).toEqual(ctx.operations.snapshot(operation.id));
  });
});

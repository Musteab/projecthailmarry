import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { apiPaths, applyWorldPatch } from '@bastion/shared';
import type { ServerMessage } from '@bastion/shared';
import { RecordingPlayer, parseRecording } from './recording';
import { captureRun } from './capture';
import { MockTransport } from '../transport/mock';

afterEach(() => vi.useRealTimers());
const fixture = (name: string) =>
  readFileSync(new URL(`../../../../data/fixtures/${name}.ndjson`, import.meta.url), 'utf8');

it.each(['mock-flood', 'mock-quake'])(
  'replays every %s golden message exactly and reconstructs the final snapshot',
  (name) => {
    const frames = parseRecording(fixture(name));
    const player = new RecordingPlayer(frames);
    const emitted: ServerMessage[] = [];
    player.advance(1000, (message) => emitted.push(message));
    expect(emitted).toEqual(frames.slice(1).map((f) => f.message));
    expect(player.complete).toBe(true);
    let expected = frames[0].message.t === 'snapshot' ? frames[0].message.world : undefined;
    for (const { message } of frames.slice(1)) {
      if (message.t === 'snapshot') expected = message.world;
      if (message.t === 'tick') expected = applyWorldPatch(expected!, message.patch, message.clock);
    }
    expect(player.world).toEqual(expected);
    player.reset();
    player.advance(1000, () => {});
    expect(player.world).toEqual(expected);
  },
);
it('rejects malformed, out-of-order, missing-snapshot and mixed-operation recordings', () => {
  const frames = parseRecording(fixture('mock-flood'));
  expect(() => parseRecording('bad')).toThrow('JSON');
  expect(() => parseRecording([])).toThrow('empty');
  expect(() => parseRecording(frames.slice(2))).toThrow('snapshot');
  expect(() => parseRecording([frames[0], { ...frames[1], elapsedMs: -1 }])).toThrow('time');
  const other = structuredClone(frames[0]);
  if (other.message.t === 'snapshot') other.message.world.operation.id = 'different';
  expect(() => parseRecording([frames[0], other])).toThrow('operation');
});
it('exposes recording playback through MockTransport and rejects changing recorded decisions', async () => {
  vi.useFakeTimers();
  const mock = new MockTransport({ recording: fixture('mock-flood') });
  const emitted: ServerMessage[] = [];
  const stop = mock.connect(mock.world.operation.id, (m) => emitted.push(m));
  const path = apiPaths.operationControl(mock.world.operation.id);
  await mock.request('POST', path, { command: 'start' });
  mock.advance(8);
  expect(mock.world.incidents['flood-rescue']).toBeDefined();
  await mock.request('POST', path, { command: 'pause' });
  expect(mock.world.operation.status).toBe('paused');
  const paused = structuredClone(mock.world);
  mock.advance(10);
  expect(mock.world).toEqual(paused);
  await expect(
    mock.request('POST', apiPaths.actionApprove('flood-backup'), {}),
  ).rejects.toMatchObject({ code: 'replay_read_only' });
  await mock.request('POST', path, { command: 'speed', speed: 5 });
  await mock.request('POST', path, { command: 'resume' });
  mock.advance(1);
  expect(mock.world.clock.simTime).toBe(65);
  expect(mock.world.operation.status).toBe('running');
  expect(mock.world.clock.speed).toBe(25);
  mock.seek(205);
  expect(mock.world.restoration).not.toBeNull();
  expect(mock.world.clock.speed).toBe(0);
  await mock.request('POST', path, { command: 'reset' });
  expect(mock.world.clock.simTime).toBe(0);
  expect(mock.world.workOrders).toEqual({});
  stop();
  expect(vi.getTimerCount()).toBe(0);
  expect(emitted.length).toBeGreaterThan(10);
});
it('records a server subscription without persisting credentials and closes cleanly at the deadline', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  const source = parseRecording(fixture('mock-flood'))[0].message;
  const frames: unknown[] = [];
  const socket = {
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    send: vi.fn(),
    close: vi.fn(),
  } as unknown as WebSocket;
  let connectedUrl = '';
  const result = captureRun({
    url: 'ws://localhost:8787/ws',
    token: 'private-token',
    operationId: 'mock-operation-2',
    seconds: 1,
    socketFactory: (url) => {
      connectedUrl = url;
      return socket;
    },
    onFrame: (frame) => frames.push(frame),
  });
  socket.onopen?.({} as Event);
  expect(socket.send).toHaveBeenCalledWith(
    JSON.stringify({ t: 'subscribe', operationId: 'mock-operation-2' }),
  );
  socket.onmessage?.({ data: JSON.stringify(source) } as MessageEvent);
  vi.advanceTimersByTime(1000);
  expect(await result).toBe(1);
  expect(socket.close).toHaveBeenCalled();
  expect(connectedUrl).toContain('token=private-token');
  expect(JSON.stringify(frames)).not.toContain('private-token');
  expect(parseRecording(JSON.stringify(frames[0]))).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});
it('fails and cleans up when a server never sends a snapshot or disconnects early', async () => {
  vi.useFakeTimers();
  const socket = {
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    send: vi.fn(),
    close: vi.fn(),
  } as unknown as WebSocket;
  const result = captureRun({
    url: 'ws://localhost/ws',
    operationId: 'x',
    seconds: 1,
    socketFactory: () => socket,
    onFrame: () => {},
  });
  const failure = expect(result).rejects.toThrow('snapshot');
  vi.advanceTimersByTime(10000);
  await failure;
  expect(vi.getTimerCount()).toBe(0);
  const disconnected = captureRun({
    url: 'ws://localhost/ws',
    operationId: 'x',
    seconds: 1,
    socketFactory: () => socket,
    onFrame: () => {},
  });
  const closeFailure = expect(disconnected).rejects.toThrow('closed');
  socket.onclose?.({} as CloseEvent);
  await closeFailure;
  expect(vi.getTimerCount()).toBe(0);
});

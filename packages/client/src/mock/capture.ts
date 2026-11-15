import { ServerMessageSchema } from '@bastion/shared';
import type { RecordedFrame } from './recording';

export interface CaptureOptions {
  url: string;
  operationId: string;
  token?: string;
  seconds: number;
  onFrame: (frame: RecordedFrame) => void;
  socketFactory?: (url: string) => WebSocket;
  now?: () => number;
}
/** Captures protocol messages only. Credentials and socket URLs are never written into frames. */
export function captureRun(options: CaptureOptions): Promise<number> {
  if (!options.operationId || !Number.isFinite(options.seconds) || options.seconds <= 0)
    return Promise.reject(new Error('Supply an operation id and positive recording duration'));
  const url = new URL(options.url);
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password)
    return Promise.reject(new Error('Use a ws/wss URL without embedded credentials'));
  if (options.token) url.searchParams.set('token', options.token);
  return new Promise((resolve, reject) => {
    const now = options.now ?? Date.now;
    const socket = (options.socketFactory ?? ((address) => new WebSocket(address)))(url.href);
    let started: number | undefined,
      count = 0,
      done = false;
    let deadline: ReturnType<typeof setTimeout>;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close();
      if (error) reject(error);
      else resolve(count);
    };
    deadline = setTimeout(
      () => finish(new Error('No initial snapshot received within 10 seconds')),
      10000,
    );
    socket.onopen = () =>
      socket.send(JSON.stringify({ t: 'subscribe', operationId: options.operationId }));
    socket.onmessage = (event) => {
      try {
        const receivedAt = now();
        const message = ServerMessageSchema.parse(JSON.parse(String(event.data)));
        if (message.t === 'error') {
          finish(new Error('Server rejected recording subscription'));
          return;
        }
        if (started === undefined) {
          if (message.t !== 'snapshot') throw new Error('First server message must be a snapshot');
          if (message.world.operation.id !== options.operationId)
            throw new Error('Snapshot belongs to a different operation');
          started = receivedAt;
          clearTimeout(deadline);
          deadline = setTimeout(() => finish(), options.seconds * 1000);
        }
        if (message.t === 'snapshot' && message.world.operation.id !== options.operationId)
          throw new Error('Recording switched operation');
        if (
          message.t === 'tick' &&
          message.patch.operation &&
          message.patch.operation.id !== options.operationId
        )
          throw new Error('Recording switched operation');
        options.onFrame({ elapsedMs: Math.max(0, receivedAt - started), message });
        count++;
        const ended =
          message.t === 'snapshot'
            ? message.world.operation.status === 'ended'
            : message.t === 'tick' && message.patch.operation?.status === 'ended';
        if (ended) finish();
      } catch {
        finish(new Error('Invalid server message or recording write failure'));
      }
    };
    socket.onerror = () => finish(new Error('Recording connection failed'));
    socket.onclose = () => finish(new Error('Recording connection closed before completion'));
  });
}

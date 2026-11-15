import websocket from '@fastify/websocket';
import type { ServerMessage } from '@bastion/shared';
import { apiPaths, ClientMessageSchema, ServerMessageSchema } from '@bastion/shared';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { AppContext } from '../context';

const HEARTBEAT_MS = 20_000;
/** A client this far behind is dropped; it reconnects and resubscribes for a fresh snapshot. */
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;
const CLOSE_SLOW_CONSUMER = 4408;

interface Channel {
  sockets: Set<WebSocket>;
  /** removes the channel's listener from the operation manager */
  off: () => void;
}

/**
 * The realtime side of the contract: GET /ws?token=<jwt>.
 * A client sends `subscribe` and receives one `snapshot`, then a `tick` per engine tick with the
 * diff since the previous one, plus `beat` messages. Each message is serialized once per
 * operation and fanned out to every subscriber.
 */
export async function registerRealtime(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const channels = new Map<string, Channel>();

  const serialize = (message: ServerMessage): string => {
    if (ctx.config.validateResponses) {
      const result = ServerMessageSchema.safeParse(message);
      if (!result.success) {
        // Contract drift is a server bug. Shout about it, but keep the stream alive.
        app.log.error(
          { issues: result.error.issues.slice(0, 5) },
          `outbound "${message.t}" message does not match the contract`,
        );
      }
    }
    return JSON.stringify(message);
  };

  const deliver = (socket: WebSocket, payload: string): void => {
    if (socket.readyState !== socket.OPEN) return;
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      socket.close(CLOSE_SLOW_CONSUMER, 'Not keeping up; reconnect for a fresh snapshot');
      return;
    }
    socket.send(payload);
  };

  const leave = (socket: WebSocket, operationId: string | undefined): void => {
    if (!operationId) return;
    const channel = channels.get(operationId);
    if (!channel) return;
    channel.sockets.delete(socket);
    if (channel.sockets.size === 0) {
      channel.off();
      channels.delete(operationId);
    }
  };

  const join = (socket: WebSocket, operationId: string): void => {
    let channel = channels.get(operationId);
    if (!channel) {
      const sockets = new Set<WebSocket>();
      const off = ctx.operations.subscribe(operationId, (message) => {
        const payload = serialize(message);
        for (const member of sockets) deliver(member, payload);
      });
      channel = { sockets, off };
      channels.set(operationId, channel);
    }
    channel.sockets.add(socket);
  };

  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  app.get(
    apiPaths.ws,
    {
      websocket: true,
      // Runs before the upgrade: a missing or invalid token fails the handshake with a 401.
      preValidation: async (request) => {
        const { token } = request.query as { token?: string };
        request.user = await ctx.auth.authenticateToken(token);
      },
    },
    (socket) => {
      let subscribedTo: string | undefined;
      let alive = true;

      const heartbeat = setInterval(() => {
        if (!alive) {
          socket.terminate();
          return;
        }
        alive = false;
        socket.ping();
      }, HEARTBEAT_MS);
      heartbeat.unref();
      socket.on('pong', () => {
        alive = true;
      });

      socket.on('message', (raw) => {
        alive = true;
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw.toString());
        } catch {
          parsed = undefined;
        }
        const message = ClientMessageSchema.safeParse(parsed);
        if (!message.success) {
          deliver(
            socket,
            serialize({ t: 'error', code: 'bad_message', message: 'Unrecognised message' }),
          );
          return;
        }
        if (message.data.t === 'ping') return;

        const { operationId } = message.data;
        if (!ctx.operations.get(operationId)) {
          deliver(
            socket,
            serialize({
              t: 'error',
              code: 'unknown_operation',
              message: `Operation "${operationId}" not found`,
            }),
          );
          return;
        }
        leave(socket, subscribedTo);
        // Snapshot first, then join: both happen in this turn of the event loop, so no tick
        // can slip in between and the patches that follow apply cleanly to the snapshot.
        deliver(socket, serialize({ t: 'snapshot', world: ctx.operations.snapshot(operationId) }));
        join(socket, operationId);
        subscribedTo = operationId;
      });

      const cleanup = () => {
        clearInterval(heartbeat);
        leave(socket, subscribedTo);
        subscribedTo = undefined;
      };
      socket.on('close', cleanup);
      socket.on('error', cleanup);
    },
  );
}

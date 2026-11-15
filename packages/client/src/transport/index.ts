import { ApiErrorBodySchema, ServerMessageSchema } from '@bastion/shared';
import type { ServerMessage } from '@bastion/shared';

export type Connection = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'mock';
export type Method = 'GET' | 'POST' | 'PATCH';
export interface Transport {
  request<T>(method: Method, path: string, body?: unknown): Promise<T>;
  connect(
    operationId: string,
    onMessage: (message: ServerMessage) => void,
    onConnection?: (state: Connection) => void,
  ): () => void;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface HttpWsConfig {
  apiUrl?: string;
  wsUrl?: string;
  getToken?: () => string | undefined;
  fetch?: typeof fetch;
  webSocket?: (url: string) => WebSocket;
}

export class HttpWsTransport implements Transport {
  constructor(private readonly config: HttpWsConfig = {}) {}

  async request<T>(method: Method, path: string, body?: unknown): Promise<T> {
    const token = this.config.getToken?.();
    const response = await (this.config.fetch ?? fetch)(
      `${(this.config.apiUrl ?? '').replace(/\/$/, '')}${path}`,
      {
        method,
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    );
    if (response.status === 204) return undefined as T;
    const data: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const parsed = ApiErrorBodySchema.safeParse(data);
      throw new ApiError(
        response.status,
        parsed.success ? parsed.data.error.code : 'http_error',
        parsed.success ? parsed.data.error.message : `Request failed (${response.status})`,
        parsed.success ? parsed.data.error.details : undefined,
      );
    }
    return data as T;
  }

  connect(
    operationId: string,
    onMessage: (message: ServerMessage) => void,
    onConnection: (state: Connection) => void = () => {},
  ) {
    let stopped = false;
    let attempt = 0;
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      if (stopped) return;
      onConnection(attempt ? 'reconnecting' : 'connecting');
      const base = this.config.apiUrl || globalThis.location?.origin || 'http://localhost:3001';
      const url = new URL(this.config.wsUrl || '/ws', base);
      url.protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:';
      const token = this.config.getToken?.();
      if (token) url.searchParams.set('token', token);
      const reconnect = () => {
        if (stopped) return;
        onConnection('reconnecting');
        retry = setTimeout(open, Math.min(1000 * 2 ** attempt++, 15000));
      };
      try {
        socket = (this.config.webSocket ?? ((address) => new WebSocket(address)))(url.href);
      } catch {
        reconnect();
        return;
      }
      const current = socket;
      current.onopen = () => {
        if (!stopped && socket === current)
          current.send(JSON.stringify({ t: 'subscribe', operationId }));
      };
      current.onmessage = (event) => {
        if (stopped || socket !== current) return;
        let message: ServerMessage;
        try {
          message = ServerMessageSchema.parse(JSON.parse(String(event.data)));
        } catch {
          onMessage({ t: 'error', code: 'invalid_message', message: 'Invalid server message' });
          return;
        }
        if (message.t === 'snapshot') {
          attempt = 0;
          onConnection('live');
        }
        onMessage(message);
      };
      current.onclose = () => {
        current.onmessage = null;
        current.onopen = null;
        current.onerror = null;
        current.onclose = null;
        if (socket === current) reconnect();
      };
      current.onerror = () => current.close();
    };
    open();
    return () => {
      stopped = true;
      clearTimeout(retry);
      if (socket) {
        socket.onclose = null;
        socket.onmessage = null;
        socket.onopen = null;
        socket.onerror = null;
        socket.close();
      }
      onConnection('idle');
    };
  }
}

/**
 * Smoke test for a running Bastion server: local, in a container, or deployed.
 *
 *   pnpm smoke                              # http://127.0.0.1:8787
 *   pnpm smoke https://your-app.example     # a deployed URL
 *
 * Signs in with SMOKE_EMAIL / SMOKE_PASSWORD (default: the demo administrator and
 * SEED_DEMO_PASSWORD), then checks the path the demo depends on: the web app is served, the
 * catalogue loads, an exercise can be created and started, the WebSocket delivers a snapshot and
 * ticks, and the exercise can be ended. Exits non-zero on the first failure.
 */
// Top-level await below: this file must be a module.
export {};

const base = (process.argv[2] ?? process.env.SMOKE_URL ?? 'http://127.0.0.1:8787').replace(
  /\/$/,
  '',
);
const email = process.env.SMOKE_EMAIL ?? 'admin@bastion.demo';
const password = process.env.SMOKE_PASSWORD ?? process.env.SEED_DEMO_PASSWORD ?? 'bastion-demo';

let token = '';
const started = Date.now();

async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  const at = Date.now();
  try {
    const result = await run();
    console.log(`  ok    ${name}  (${Date.now() - at} ms)`);
    return result;
  } catch (error) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(`${method} ${path} -> ${response.status} ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

interface TickLike {
  t: string;
  clock?: { simTime: number };
  world?: { operation: { id: string } };
}

console.log(`Smoke test against ${base}`);

await step('health', async () => {
  const health = await api<{ ok: boolean }>('GET', '/api/health');
  if (!health.ok) throw new Error('health did not report ok');
});

await step('web app is served', async () => {
  const response = await fetch(`${base}/`);
  const html = await response.text();
  if (!response.ok || !html.includes('<div id="root">')) {
    throw new Error(`GET / -> ${response.status}; the built web app is not being served`);
  }
});

await step('sign in', async () => {
  const login = await api<{ token: string; user: { role: string } }>('POST', '/api/auth/login', {
    email,
    password,
  });
  token = login.token;
});

const scenario = await step('scenario catalogue', async () => {
  const scenarios = await api<{ id: string; regionId: string }[]>('GET', '/api/scenarios');
  if (scenarios.length === 0) throw new Error('no scenarios available');
  return scenarios.find((item) => item.id.includes('flood')) ?? scenarios[0]!;
});

await step(`region pack "${scenario.regionId}"`, async () => {
  const response = await fetch(`${base}/api/regions/${scenario.regionId}/static`, {
    headers: { authorization: `Bearer ${token}`, 'accept-encoding': 'gzip' },
  });
  const region = (await response.json()) as { nodes: unknown[]; cells: unknown[] };
  if (!response.ok || region.nodes.length === 0) throw new Error(`region -> ${response.status}`);
});

const operation = await step(`create exercise on "${scenario.id}"`, () =>
  api<{ id: string }>('POST', '/api/operations', {
    regionId: scenario.regionId,
    scenarioId: scenario.id,
    mode: 'exercise',
    name: 'Smoke test',
  }),
);

await step('websocket: snapshot, then ticks after start', async () => {
  const url = `${base.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`;
  const socket = new WebSocket(url);
  let sawSnapshot = false;
  let lastSimTime = 0;
  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(new Error(`timed out (snapshot: ${sawSnapshot}, sim time reached: ${lastSimTime})`)),
      20_000,
    );
    socket.addEventListener('error', () => reject(new Error('the WebSocket connection failed')));
    socket.addEventListener('open', () =>
      socket.send(JSON.stringify({ t: 'subscribe', operationId: operation.id })),
    );
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as TickLike;
      if (message.t === 'error') reject(new Error(`server sent an error: ${String(event.data)}`));
      if (message.t === 'snapshot') {
        sawSnapshot = true;
        void api('POST', `/api/operations/${operation.id}/control`, { command: 'start' })
          .then(() =>
            api('POST', `/api/operations/${operation.id}/control`, { command: 'speed', speed: 20 }),
          )
          .catch(reject);
      }
      if (message.t === 'tick' && message.clock) {
        lastSimTime = message.clock.simTime;
        if (sawSnapshot && lastSimTime >= 20) {
          clearTimeout(timer);
          resolve();
        }
      }
    });
  });
  try {
    await done;
  } finally {
    socket.close();
  }
});

await step('end the exercise', () =>
  api('POST', `/api/operations/${operation.id}/control`, { command: 'end' }),
);

console.log(`All checks passed in ${((Date.now() - started) / 1000).toFixed(1)} s`);

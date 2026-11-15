# @bastion/client — MUS-001 / MUS-002

The shared data layer for Thant's UI. Contract dependency: DOM-002 (PR #1).

## Integration

Wrap the web app once with `BastionProvider` from `@bastion/client`. Pass
`config={{ mock: true }}` for the local preview, or use the existing `pnpm dev:mock`
script (`VITE_MOCK=1`). The provider automatically signs into the **local mock**,
loads region-mini and launches the `mock-flood` story. Units depart as dispatch
events occur (first rescue at T+25 sim seconds). The web
app still needs Thant to mount the provider and consume the hooks; this package
does not modify `apps/web`.

For the real server, pass `config={{ apiUrl, wsUrl, mock: false }}`. `apiUrl` is
the server origin (without `/api`); `wsUrl` is the optional full WebSocket URL.
With no URLs, requests use the web app's same-origin proxy. Use `useSession()`
to sign in, then `useScenarios()` and `useOperation().launch(...)`. Server auth,
endpoints, and simulation integration are supplied by Dominic.

Configuration is captured on mount; remount the provider with a different React
key to change it. Never use the mock token against the real API. Mock sessions
are memory-only; real sessions use memory and `sessionStorage`. The server remains
the authority for permissions; `useSession().can` mirrors the shared matrix.

## Hooks and behavior

All hooks in the agreed client contract are exported. Selectors use shallow
reference comparison; `useUnits`, `useActions`, `useIncidents`, and `useWorkOrders`
do not allocate a new visible array for unrelated ticks. Before launch, `useWorld`
selects from an empty exercise snapshot; `useOperation().operation` is undefined.

`useOperation().clock` includes client-local `receivedAtMs`. Pass that same clock
and **Date.now()** to `unitPositionAt(unit, clock, nowMs)` on animation frames.
Clock receipt timestamps use epoch milliseconds, not `performance.now()`.
`simTimeNow` freezes an unanchored raw server clock at its last known time. For
standalone use, call `anchorClock(serverClock, receivedAtMs)` first.

`useBeat()` exposes the latest beat; `useOnBeat(callback)` subscribes to changes.
Outside React, `createBastionClient()` exposes the same commands and
`client.onBeat(callback)` (returns an unsubscribe function). Call `start()` and
`stop()` to manage its lifecycle. React's provider does this automatically.

Command promises reject on server errors. `ApiError` carries `status`, `code`,
and optional `details`. UI controls should catch and display those failures.
Authentication failures clear the session. Connection state reports reconnects;
a successful reconnect receives a fresh authoritative snapshot. Disconnects
cancel retry timers. The store exposes the latest protocol error to advanced
consumers through `useBastionClient().world`.

## Scripted scenarios

`useScenarios()` lists `mock-flood` and `mock-quake`. Select with
`useOperation().launch({ scenarioId: 'mock-quake', mode: 'exercise' })`, then call
`control('start')`. Each story lasts 380 simulation seconds (76 wall seconds at
its default 5x speed). Pause, resume, supported speeds, reset and end work offline.

Every surface receives schema-validated snapshots, tick patches and beats:
cell hazard intensity, corroborating signals, incidents, dispatches, road closures,
hospital power/diversion, grid sections, shelter occupancy, ranked restoration
options, per-cell hospital access, work orders, timeline and metrics.

- Road routes use the actual **fixture edges**, respect one-way roads and avoid
  closed/flooded/blocked/damaged edges. Closure injects reroute units. An unreachable
  unit waits; it never drives through a blocked edge. Rerouting snaps a moving unit
  to its nearest graph node, a deliberate preview simplification.
- Approval executes; rejection leaves a declined audit card without dispatching.
  Overriding a dispatch releases the previous unit and executes the replacement.
  Invalid replacements roll back. Overriding an executed grid action records the
  override; use a separate restoration action to reverse its physical effect.
- Utility/rescue autonomy updates affect subsequent scripted decisions. An `off`
  rule suppresses its action; `approve` waits for an operator.
- Work orders progress through assignment, work, inspection and reopening. Manual
  cancellation is respected by the remaining story beats. Reopening removes road
  blocks and allows waiting units to reroute.
- `useDemoDirector().goto(i)` rebuilds the mock to that beat and pauses, including
  backward jumps. It discards earlier manual interventions, retaining current rules.
  Beat captions survive pause and command refreshes.

The geography is synthetic region-mini, not Portland streets. Hazards are scripted
keyframes rather than physics or forecasts. Access comparisons are computed on the
fixture graph; shelter-access benefits remain zero. Briefing/copilot text is a
local summary, not an AI call. All scripted actions are sandboxed; live launch is
rejected. Thant still owns mounting the hooks and rendering the 3D UI.

## Recording and replay

Record an existing server operation once Dominic's WebSocket operation endpoints
are available:

```sh
pnpm --filter @bastion/client record --operation <id> --seconds 90 --out data/fixtures/server-run.ndjson
```

The recorder reads `BASTION_TOKEN` from the environment; it never writes the token
or connection URL into the recording. `--url` defaults to `ws://127.0.0.1:8787/ws`.
Paths are relative to the repo root. It waits for a matching initial snapshot,
validates messages, and publishes the file only on successful completion. It fails
on early disconnect or missing snapshot and refuses to overwrite an existing file.

Each NDJSON line is `{ elapsedMs, message }`; the first is a snapshot at elapsed 0.
`parseRecording` rejects malformed, unordered and mixed-operation captures.

```ts
const client = createBastionClient({
  mock: true,
  transport: new MockTransport({ recording: ndjsonText }),
});
```

Supply `region` alongside `recording` for captures outside region-mini. Pass this
client to `BastionProvider` via its `client` prop. Recorded actions are read-only;
playback supports start/pause/speed/reset and director seeking. Playback speeds
multiply the recorded rate. `RecordingPlayer` emits the exact original stream at
1x; `MockTransport` additionally supplies control snapshots, scales display clocks,
and freezes the display clock at the end of a capture. Those playback messages do
not alter the saved recording.

`pnpm --filter @bastion/client fixtures` deterministically regenerates the two
committed **mock-generated** captures in `data/fixtures`. They are not captures of
the real server. No cloud keys or network are needed to play either exercise.

## Validation

`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` from the workspace root.
Client tests cover snapshot/patch replay and caps, stable React selectors, route
interpolation, session permissions, HTTP errors, WebSocket reconnect cleanup,
Strict Mode lifecycle, offline motion and local command effects.

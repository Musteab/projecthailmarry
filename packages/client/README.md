# @bastion/client — MUS-001

The shared data layer for Thant's UI. Contract dependency: DOM-002 (PR #1).

## Integration

Wrap the web app once with `BastionProvider` from `@bastion/client`. Pass
`config={{ mock: true }}` for the local preview, or use the existing `pnpm dev:mock`
script (`VITE_MOCK=1`). The provider automatically signs into the **local mock**,
loads region-mini, launches its exercise, and starts three units moving. The web
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

## Mock v0 limits

- Synthetic region-mini geometry; initial three routes loop on fixture edges.
  Later operator dispatches use straight preview routes, not road routing.
- One rescue incident and an approval-gated utility action. Approval, rejection,
  override, operation controls, injects, rules, and work-order transitions update
  the local world. All actions are sandboxed. Live-mode launch is rejected.
- Restoration options are UI fixtures with zero claimed population benefit;
  impact cells are empty. Briefing and copilot responses are explicitly mock text.
- The director's steps expose region-mini scenario beats and navigate captions;
  jumping a step does not fast-forward the engine. Automatic scenario playback,
  flood/quake physics and scripted demo acts belong to MUS-002; the final stage
  director belongs to MUS-013.
- Overriding an executed action records the override; it does not reverse its
  physical effect. Submit and approve the corresponding restoration action.

No cloud keys, browser tokens, or environment changes are needed for mock v0.

## Validation

`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` from the workspace root.
Client tests cover snapshot/patch replay and caps, stable React selectors, route
interpolation, session permissions, HTTP errors, WebSocket reconnect cleanup,
Strict Mode lifecycle, offline motion and local command effects.

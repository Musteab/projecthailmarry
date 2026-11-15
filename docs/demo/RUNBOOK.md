# BASTION stage runbook

## Before the room opens

Use Node 22+ and the repository-pinned pnpm 10. Run `pnpm install`, then `pnpm --filter @bastion/intel demo:prewarm` and `pnpm --filter @bastion/intel demo:check`. The first validates Portland/scenarios and regenerates labelled deterministic rehearsal cache entries. The second boots an isolated backend, configures 60×, and drives both exercises three times through real command routes and the simulation engine, including work-order reopening. It does not modify the normal demo database.

Start the app with `INTEL_MODE=cache FEEDS_ENABLED=0 pnpm dev`. Open `http://localhost:5173/?backend=server` for the real backend/Portland journey. The default URL uses Thant's bundled Sunway/Sri Muda mock scenes. Those have authored building geometry; the server region fallback currently has roads/cells but no building mesh. Both paths are exercises, with no real utility or dispatch adapter.

Default seeded credentials use `operator@bastion.demo` or `coordinator@bastion.demo`, password `bastion-demo`. A custom `SEED_DEMO_PASSWORD` must match the client's optional `demoCredentials.password`. Never put production credentials in the director. The local Three.js view does not need Mapbox; prewarm reports token presence without printing it.

## Five-minute flood, then three-minute earthquake

1. Sign in as operator, select Johnson Creek and launch in exercise mode at 5×.
2. Explain the warning, rising gauge and affected roads. At the rescue scene, show the field/caller/imagery evidence and automatic swift-water dispatch.
3. Show the separate cardiac call, ALS assignment and reachable hospital. Explain that grid isolation follows the utility's configured rule and can precede its camera beat. Approve the proposed shelter as the operator.
4. When recession debris appears, switch to recovery coordinator. Analyze the options, compare access gains, and issue the recommended work order. Watch assignment, work, inspection and reopening.
5. Switch back to operator and launch Portland Hills. Show the closed Ross Island crossing, west-side USAR reserve, hospital diversion and different clearance priority.
6. Use the briefing to explain recorded decisions. Do not describe a cached or rule-based answer as a live Claude inference.

Population, crews, grid topology, damage and reported casualties are synthetic exercise data. Streets and the creek use attributed OpenStreetMap geometry; the flood and quake engines are illustrative models, not forecasts. See the scenario notes for exact IDs and source assumptions.

## Director keys

The provider registers headless shortcuts once. Inputs/textareas are excluded; repeated keydown events do not repeat an action.

- **Alt/Option + N:** execute the next workflow step.
- **Alt/Option + 1–8:** execute a specific step: operator sign-in, flood launch, response briefing, coordinator sign-in, restoration analysis, recommended work order, earthquake launch, earthquake briefing.
- **Alt/Option + R:** reset the workflow cursor. It does not erase or rewind an operation.

`useDemoDirector().workflow` exposes steps, current, busy, error, next, goto and reset for a visual cue. Existing beat controls remain compatible. A failed step keeps the cursor in place for retry. Persona changes reselect the existing operation. Real-server beat navigation changes the camera; it does not skip future simulation events. Use the speed control to advance a rehearsal.

## Failure playbook

- **Network missing:** leave `INTEL_MODE=cache`; the scenarios and geography are committed. Use the default bundled mock scene if the server is unavailable.
- **AI slow or key missing:** cache mode uses deterministic fallbacks. No model call is required for the show.
- **Live feeds unavailable:** leave `FEEDS_ENABLED=0` for the exercise. For a separate live-data demonstration use `FEEDS_ENABLED=1`, or `FEEDS_REPLAY=1` for labelled historical samples.
- **Permission denied:** operator handles response; coordinator handles restoration; utility operator handles manual electrical switching. Agency rules govern automatic actions.
- **No repair recommendation yet:** wait for the debris scene, analyze again, then retry the work-order step.
- **WebGL fails:** use the UI's 2D fallback. If the browser itself fails, play a pre-recorded backup.

Record a backup video on the presentation laptop before leaving for the venue. Rehearse with the exact projector resolution and browser; automated checks cannot verify the room's equipment.

## Team integration

Package commands are available now. Dominic owns root aliases and CI: add root `demo:prewarm` / `demo:check` aliases if desired. Thant can display `useDemoDirector().workflow.error` and the current workflow title; existing timeline controls require no changes. The pure hook `useDemoHotkeys()` is idempotent with the provider registration.

Known backend issue: [action/work-order IDs collide across retained operations](https://github.com/Musteab/projecthailmarry/issues/23). Repeat rehearsals currently use a fresh backend per flood/quake pair. Until Dominic fixes the lookup, restart between repeated stage runs; the isolated harness does not claim to resolve that application bug. All six isolated runs now reach reopening with distinct flood/quake crews, hospitals and top repair roads.

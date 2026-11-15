## Dominic's tasks

Order of attack: DOM-001 → 002 → 003 → (004, 005) → 006 → 007 → 008 → 009 → 010 → 011 → 012 → 013 → 014, then P1, then P2. DOM-001 and DOM-002 are the contract freeze that unblocks Thant and Muste; finish them before anything else.

### DOM-001 · Repository bootstrap and workspace scaffold
**Owner** Dominic · **Priority** P0 · **Complexity** Medium · **Branch** initial commits on `main` (the only exception to the branch rule) · **Depends on** nothing

**Objective.** A cloneable monorepo in which `pnpm install && pnpm dev` starts a placeholder server and a placeholder web page, so three people can branch immediately.

**Implementation.**
- `git init`, pnpm workspace (`apps/*`, `packages/*`, `tools/*`), `.nvmrc` (22+), `tsconfig.base.json` (strict, ESM, bundler resolution), ESLint + Prettier, `.gitignore` (`.env`, `.data/`, `node_modules`, `dist`), `.env.example` with every variable from the environment table.
- Skeleton packages with manifest, tsconfig and placeholder entry: `@bastion/shared`, `@bastion/server`, `@bastion/web` (Vite + React, renders "Bastion"), `@bastion/client`, `@bastion/intel`, `@bastion/region-pack`. Internal packages set `"main"`/`"exports"` to `src/index.ts`.
- Root scripts: `dev` (server + web concurrently), `dev:mock` (web only with `VITE_MOCK=1`), `typecheck`, `lint`, `test`, `build`. Vite dev proxy for `/api` and `/ws` is in Thant's `vite.config.ts`; seed it once here, then it is Thant's.
- `.github/workflows/ci.yml` (install, typecheck, lint, test, build) and `.github/CODEOWNERS` matching the ownership table. Commit `docs/plan/**`.
- Create the GitHub repository, push, protect `main` (PR required, CI required), invite Thant and Muste.

**Files.** Repo root, `.github/**`, skeleton `package.json` + `src/index.ts` in every workspace.
**Acceptance.** Fresh clone: `corepack enable && pnpm install && pnpm dev` shows the placeholder page and `GET /api/health` returns `{ok:true}`. CI is green on `main`. CODEOWNERS routes each path to the right person.
**Tests.** CI run itself; a trivial Vitest in `shared` to prove the runner works.
**Commits.** `chore: initialise pnpm workspace and tooling` → `chore: add package skeletons for server, web, shared, client, intel, region-pack` → `ci: add typecheck/lint/test/build workflow and CODEOWNERS` → `docs: add master plan and developer briefs`

### DOM-002 · Shared contracts package
**Owner** Dominic · **Priority** P0 · **Complexity** Medium · **Branch** `feat/dominic-shared-contracts` · **Depends on** DOM-001

**Objective.** Turn the agreed contracts into code: zod schemas with inferred types for every entity, message and request, so all three workstreams compile against the same source.

**Implementation.**
- `packages/shared/src/{primitives,region,world,actions,restoration,scenario,protocol,api,intel,permissions}.ts`, re-exported from `index.ts`. Schema names `XSchema`, types `X`.
- `permissions.ts`: the role → capability matrix as data plus `can(user, verb, authority?)`, used by server and client.
- `fixtures/region-mini/`: a hand-made synthetic region (about 40 nodes on a lattice inside the Portland bounding box, a river crossed by 2 bridges, 2 hospitals, 2 shelters, 3 stations, 1 substation with 4 grid sections, about 150 H3 cells with elevation sloping to the river, 8 units). Export `loadRegionMini()` and `makeEmptyWorld(operation)`.
- `fixtures/scenario-mini.json`: a 5-minute flood on region-mini that exercises every event type.

**Files.** `packages/shared/**`.
**Acceptance.** Every type in the contracts section exists and is exported. `region-mini` and `scenario-mini` parse with their schemas. No runtime dependency other than `zod`.
**Tests.** Vitest: fixtures parse; a round-trip of sample `ServerMessage`s; `can()` truth table.
**Commits.** `feat(shared): add primitive and region schemas` → `feat(shared): add world, action and rule schemas` → `feat(shared): add restoration, scenario and protocol schemas` → `feat(shared): add permission matrix` → `feat(shared): add region-mini and scenario-mini fixtures` → `test(shared): schema and permission tests`

### DOM-003 · Server foundation, database schema, migrations, seed
**Owner** Dominic · **Priority** P0 · **Complexity** Medium · **Branch** `feat/dominic-server-foundation` · **Depends on** DOM-002

**Objective.** A running Fastify service with configuration, error handling, persistence and seeded reference data.

**Implementation.**
- `config.ts` (zod-validated env), `app.ts` (Fastify instance, CORS, error handler mapping to the contract error shape, zod request validation helper, dev-mode response validation), `main.ts`.
- `db/`: `node:sqlite` `DatabaseSync`, numbered `.sql` migrations applied at boot, tables `users`, `rules`, `operations`, `actions`, `audit_log`, `work_orders`, `signals_log`. Small typed repository functions; no ORM.
- `db/seed.ts`: five demo users (one per role, password from `SEED_DEMO_PASSWORD`, hashed with `scrypt`), default rule set (see DOM-011) with sensible autonomy per authority.
- `GET /api/health`, `GET /api/scenarios` (reads `data/scenarios/*.json`, validates, returns summaries), `GET /api/regions/:id/static`.

**Files.** `apps/server/src/{config,app,main}.ts`, `apps/server/src/db/**`, `apps/server/src/routes/{health,scenarios,regions}.ts`.
**Acceptance.** Server boots from an empty `.data/` and seeds itself idempotently. Invalid env fails fast with a readable message. Unknown route and validation errors return the contract error shape.
**Tests.** Vitest with Fastify `inject`: health, error shape, migrations idempotent, seed idempotent.
**Commits.** `feat(server): config and fastify app with error contract` → `feat(server): sqlite migrations and repositories` → `feat(server): seed demo users and default rules` → `feat(server): scenarios and region static routes` → `test(server): foundation tests`

### DOM-004 · Authentication and role-based authorization
**Owner** Dominic · **Priority** P0 · **Complexity** Medium · **Branch** `feat/dominic-auth` · **Depends on** DOM-003

**Objective.** Seeded users can sign in; every route and the WebSocket know who is calling and what they may do.

**Implementation.**
- `POST /api/auth/login` (scrypt verify, constant-time compare, 8-hour JWT with `sub`, `role`, `authority`), `GET /api/auth/me`.
- `authenticate` preHandler, `requireCan(verb, authorityResolver?)` guard built on `can()` from shared.
- WebSocket token check on `/ws?token=`.
- Basic login rate limit (in-memory) and no user enumeration in error messages.

**Files.** `apps/server/src/auth/**`.
**Acceptance.** Wrong password → 401 with generic message. A `utility_operator` approving an `ems` action → 403. Expired or tampered token → 401. `authenticate` is exported for the intel plugin's `IntelHost`.
**Tests.** Login success and failure, guard truth table across all five roles, tampered token.
**Commits.** `feat(auth): login endpoint and jwt issuing` → `feat(auth): authenticate and permission guards` → `feat(auth): websocket token verification` → `test(auth): role matrix tests`

### DOM-005 · Region loader, road graph and routing service
**Owner** Dominic · **Priority** P0 · **Complexity** Large · **Branch** `feat/dominic-routing` · **Depends on** DOM-002. Real region pack (MUS-003) is not blocking; use `region-mini`.

**Objective.** Fast shortest-path and travel-time queries over the region's road network that respect live road status. This is the substrate for dispatch, EMS and restoration.

**Implementation.**
- `region/loader.ts`: load and validate a pack from `data/regions/<id>` (fall back to `region-mini`), build indexes (edges by id, facility → node, cell → nearest node, bridge → edges).
- `routing/graph.ts`: compact adjacency (typed arrays), per-edge base travel time, a mutable `blocked` bitset derived from `RoadState` (anything not `open` is impassable; `damaged` bridges with severity `restricted` get a time penalty).
- `routing/dijkstra.ts`: binary-heap Dijkstra, `route(fromNode, toNode)` → `{edgeIds, geometry, seconds}`, `travelTimesFrom(sources[])` multi-source one-to-all (used for hospital and shelter access), `nearestReachable(from, candidates[])`.
- Support a *hypothetical* overlay: `withUnblocked(edgeIds, fn)` so restoration can ask "what if these edges were open" without mutating the world.

**Files.** `apps/server/src/region/**`, `apps/server/src/routing/**`.
**Acceptance.** Routes avoid blocked edges and return `null` when disconnected. One-to-all on a 15k-node graph under 30 ms. Overlay queries leave the real mask untouched.
**Tests.** Hand-checkable routes on `region-mini`; closing both bridges disconnects the banks; overlay isolation; a micro-benchmark asserting the time budget on a generated 15k-node lattice.
**Commits.** `feat(region): pack loader and indexes` → `feat(routing): adjacency graph with status mask` → `feat(routing): dijkstra route and one-to-all` → `feat(routing): hypothetical overlay` → `test(routing): correctness and perf budget`

### DOM-006 · World state, operations and simulation engine core
**Owner** Dominic · **Priority** P0 · **Complexity** Large · **Branch** `feat/dominic-sim-engine` · **Depends on** DOM-003, DOM-005

**Objective.** The heart of the product: an operation owns an in-memory world, a clock and a scenario runner, and advances deterministically tick by tick, producing patches.

**Implementation.**
- `world/WorldState.ts`: typed collections matching `WorldSnapshot`, mutation helpers that record dirty keys, `toSnapshot()`, `drainPatch()`.
- `sim/clock.ts` (speeds 0/1/5/20/60, fixed sim step per tick so results do not depend on wall-clock jitter), `sim/prng.ts` (seeded), `sim/engine.ts` (ordered system pipeline; each system is `(world, ctx, dt) => void` wrapped in try/catch that logs and emits an `error` timeline event).
- `sim/scenarioRunner.ts`: emits due `ScenarioEvent`s and beats; `sim/injects.ts`: applies every `Inject` kind.
- `operations/`: registry of live operations, create / start / pause / resume / speed / reset / end, persisted metadata. Reset rebuilds the world from the scenario and seed. Exercise mode sets `sandboxed` on all actions.
- Routes: `POST /operations`, `GET /operations/:id`, `POST /operations/:id/control`, `POST /operations/:id/injects`, `POST /operations/:id/signals`.
- Systems from later tasks plug into the pipeline through a small `registerSystem(order, fn)` API.

**Files.** `apps/server/src/world/**`, `apps/server/src/sim/**`, `apps/server/src/operations/**`, `apps/server/src/routes/operations.ts`.
**Acceptance.** `scenario-mini` runs to completion at 60x. Two runs with the same seed produce byte-identical timelines. Pause freezes `simTime`. Reset returns to the initial snapshot. A throwing system does not stop the loop.
**Tests.** Determinism (hash of the event log), control state machine, every inject kind, patch contains only changed keys.
**Commits.** `feat(world): world state with dirty tracking and patches` → `feat(sim): clock, seeded prng and system pipeline` → `feat(sim): scenario runner and injects` → `feat(operations): lifecycle and control routes` → `test(sim): determinism and control tests`

### DOM-007 · Realtime WebSocket hub
**Owner** Dominic · **Priority** P0 · **Complexity** Small · **Branch** `feat/dominic-realtime` · **Depends on** DOM-004, DOM-006

**Objective.** Push world state to browsers using the agreed protocol.

**Implementation.** `/ws` with token auth; `subscribe` → `snapshot`, then one `tick` per engine tick with the drained patch; `beat` messages; 20-second ping; drop slow consumers and let them resubscribe for a fresh snapshot; dev-mode schema validation of every outbound message. A patch larger than a threshold (first flood frames) is fine; do not batch across ticks.

**Files.** `apps/server/src/realtime/**`.
**Acceptance.** Two browsers on one operation stay in sync. Reconnecting yields a correct snapshot. Subscribing to an unknown operation returns an `error` message, not a crash.
**Tests.** Integration test with a real `ws` client against `scenario-mini`: snapshot plus patches reconstruct exactly `GET /operations/:id`.
**Commits.** `feat(realtime): websocket hub with snapshot and tick patches` → `feat(realtime): beats, heartbeat and slow-consumer handling` → `test(realtime): snapshot-plus-patch equivalence`

**→ Milestone M1 after this task: tell Muste the real transport can be pointed at the server.**

### DOM-008 · Hazard models: flash flood, earthquake, damage
**Owner** Dominic · **Priority** P0 · **Complexity** Large · **Branch** `feat/dominic-hazards` · **Depends on** DOM-006

**Objective.** Hazards that look convincing on a 3D map and drive everything downstream.

**Implementation.**
- `sim/hazards/flood.ts`: per cell, `depth = max(0, stage(t) − (cell.elevM − channelElev) − k·distanceToChannel)`, with temporal smoothing so water rises and recedes fluidly. Edges whose cells exceed 0.3 m become `flooded`; when water recedes below the threshold a seeded subset becomes `blocked` (debris) with `estCrewHours`, the rest reopen. Scenario can force specific debris edges.
- `sim/hazards/earthquake.ts`: MMI per cell from magnitude, depth and distance (simple attenuation), expanding wavefront timed from `originSimTime` so the client can animate the shockwave. Bridge damage from `seismicClass` fragility × MMI with the seeded PRNG; facility power loss and building-collapse incidents likewise. All overridable by scenario injects, which take precedence.
- `sim/damage.ts`: converts damage into `RoadState`, `FacilityState`, `RepairCandidate`s and synthetic signals (for example a sensor signal when a gauge cell crosses flood stage), and updates `peopleAtRisk` from cell populations.
- Emit `TimelineEvent`s for phase changes and notable damage.

**Files.** `apps/server/src/sim/hazards/**`, `apps/server/src/sim/damage.ts`.
**Acceptance.** On `region-mini` the flood visibly spreads outward from the channel and recedes; low-lying edges flood first. The quake damages the `vulnerable` bridge at M6.8 and spares the `retrofitted` one unless forced. Scenario overrides always win. Cells patch only when the value changes by more than a small epsilon.
**Tests.** Monotonic depth vs stage; road status thresholds; fragility ordering; overrides; patch-size sanity.
**Commits.** `feat(hazards): flood depth field and road flooding` → `feat(hazards): recession, debris and repair candidates` → `feat(hazards): earthquake intensity field and wavefront` → `feat(hazards): bridge, facility and structure damage` → `test(hazards): flood and quake model tests`

### DOM-009 · Signals to incidents, unit movement, metrics
**Owner** Dominic · **Priority** P0 · **Complexity** Medium · **Branch** `feat/dominic-incidents-units` · **Depends on** DOM-006 (DOM-005 for movement)

**Objective.** Turn signals into incidents through the intel port, and make units physically move and work.

**Implementation.**
- `intel/NullIntel.ts`: rule-based `IntelPort` (keyword and proximity clustering, fixed triage table) used when `@bastion/intel` is absent, slow or in `off` mode. `intel/bridge.ts`: batches new signals every tick, calls `fuse` asynchronously with a 4-second timeout, merges candidates on a later tick, deduplicates by proximity + kind, promotes `suspected` → `confirmed` at confidence ≥ 0.7 or two independent sources. `call_911` signals also go through `triage`.
- `units/`: seed units at home facilities; state machine `available → dispatched → en_route → on_scene → (transporting) → returning → available`; movement along the route by sim time; automatic re-route when an edge on the route closes; on-scene duration by incident kind and severity; resolution updates `peopleRescued`.
- `metrics.ts`: recompute `Metrics` each tick.
- `IntelHost` implementation for Muste's plugin, and mount `intelPlugin` in `app.ts` behind a try/catch dynamic import so the server still boots if the package is a stub.

**Files.** `apps/server/src/intel/**`, `apps/server/src/incidents/**`, `apps/server/src/units/**`, `apps/server/src/metrics.ts`.
**Acceptance.** Three nearby signals about the same event become one incident. A unit given a route arrives at `etaSimTime` ± one tick. Closing an edge mid-route produces a new route or a `failed` event. A hanging `fuse` never stalls the tick.
**Tests.** Dedup and promotion rules; unit state machine; re-route; timeout fallback with a fake slow intel.
**Commits.** `feat(intel): null intel and async bridge with timeout` → `feat(incidents): candidate merge and confirmation` → `feat(units): state machine and route following` → `feat(units): reroute on closure and on-scene resolution` → `feat(metrics): live operation metrics` → `test: incidents and units`

### DOM-010 · Decision engine: dispatch and EMS assignment
**Owner** Dominic · **Priority** P0 · **Complexity** Large · **Branch** `feat/dominic-dispatch` · **Depends on** DOM-005, DOM-009

**Objective.** The most impressive backend feature: explainable, contention-aware assignment of crews and ambulances that changes its answer when the world changes.

**Implementation.**
- Capability matching (`requiredCapabilities` vs `UnitKind`), ETA matrix through the live routing graph.
- Assignment by priority-weighted cost (severity, people affected, acuity, wait time, ETA). Solve globally each time the incident set or road graph changes (Hungarian or greedy with swap improvement; the set is small). Hold-back logic: do not send the last swift-water crew to a severity-2 incident while a severity-5 is `suspected` nearby.
- EMS: ambulance choice by acuity, destination hospital = nearest *functioning* hospital by travel time (skip `offline` and `onDivert`), `transporting` leg included.
- Every proposal carries a `DecisionExplain`: headline, factors (ETA, capability, severity, unreachable-because), and at least two alternatives with `rejectedBecause` ("nearest by distance, but the Ross Island Bridge is closed: +11 min").
- Re-optimise on bridge closure or hospital outage and emit a superseding proposal when the best answer changes.
- Output is a list of proposed `Action`s handed to DOM-011; this module never executes.

**Files.** `apps/server/src/decision/**`.
**Acceptance.** Two incidents competing for one crew: the higher-priority one wins and the explanation says so. Closing a bridge changes the chosen unit. A hospital on backup power stops receiving new ambulances. Proposals are deterministic for a given world.
**Tests.** Table-driven scenarios on `region-mini` for each acceptance case; property test that no unit is double-assigned.
**Commits.** `feat(decision): capability matching and eta matrix` → `feat(decision): priority-weighted assignment with hold-back` → `feat(decision): ems assignment and hospital selection` → `feat(decision): explanations and alternatives` → `feat(decision): reoptimise on network change` → `test(decision): contention, closure and diversion cases`

### DOM-011 · Rules engine and action pipeline
**Owner** Dominic · **Priority** P0 · **Complexity** Large · **Branch** `feat/dominic-action-pipeline` · **Depends on** DOM-004, DOM-010

**Objective.** "Under agency-approved rules the platform acts; authorized operators can override." One pipeline for every action, with authority, autonomy, approval, execution and audit.

**Implementation.**
- `policy/rules.ts`: evaluate the matching `Rule` for a proposal → `auto`, `approve` or `off`, using `params` thresholds (for example auto-dispatch when `severity ≥ minSeverity` and `confidence ≥ minConfidence`).
- `actions/pipeline.ts`: `proposed → (awaiting_approval | approved) → executing → executed`, plus `rejected`, `overridden`, `expired` (stale proposals), `failed`.
- `actions/executors/*`: one executor per `ActionKind` mutating the world (dispatch unit, assign ambulance, recall, activate shelter, publish closure, divert hospital, public alert). Additional proposers here: shelter activation when displaced population in range exceeds a threshold; road-closure publication for confirmed `flooded`/`damaged` edges; hospital diversion on power loss.
- `actions/outbox.ts`: in live mode each executed action writes a connector message (CAD dispatch, public closure, alert); in exercise mode it is recorded as sandboxed and never published.
- Routes: `POST /operations/:id/actions`, `POST /actions/:id/approve|reject|override`. Override of an executed dispatch recalls the unit and executes the replacement.
- `audit/`: append-only log of every transition with actor; `GET /operations/:id/audit`.

**Files.** `apps/server/src/policy/**`, `apps/server/src/actions/**`, `apps/server/src/audit/**`, `apps/server/src/routes/actions.ts`.
**Acceptance.** With default rules the flood rescue is auto-dispatched and a low-severity dispatch waits for approval. Approve, reject and override work with correct permissions and all appear in the audit trail. Nothing reaches the outbox in exercise mode. Illegal transitions return 409.
**Tests.** Rule evaluation table; full lifecycle; permission failures; override of executed action; sandbox guarantee.
**Commits.** `feat(policy): rule evaluation and autonomy levels` → `feat(actions): pipeline state machine` → `feat(actions): executors for dispatch, ems and recall` → `feat(actions): shelter, closure, diversion and alert proposers and executors` → `feat(actions): approve, reject and override routes` → `feat(audit): audit log and query route` → `test(actions): lifecycle, permissions and sandbox`

### DOM-012 · Grid model and utility isolation
**Owner** Dominic · **Priority** P0 · **Complexity** Medium · **Branch** `feat/dominic-grid` · **Depends on** DOM-008, DOM-011

**Objective.** The utility, under its own rules, isolates endangered grid sections; the consequences ripple into facilities.

**Implementation.**
- `grid/model.ts`: section tree per feeder (`upstreamSectionId`), state `energized | isolated | faulted`, `threatened` flag when the max flood depth or MMI across `cellIds` approaches the rule threshold.
- Proposer: `isolate_grid_section` under authority `utility` with an explanation (depth, trend, time-to-threshold, customers affected, critical facilities affected and their backup status). Isolation de-energises downstream sections. `restore_grid_section` proposed when the threat has passed.
- Effects: `customersOut`, critical facilities switch to `backup` with a fuel countdown, then `none` → `offline`; hospital on backup triggers a diversion proposal (DOM-011).
- `grid_fault` inject for earthquake damage.

**Files.** `apps/server/src/grid/**`.
**Acceptance.** In the flood on `region-mini` the low-lying section is flagged `threatened`, then isolated automatically; its downstream section loses power too; the hospital on that feeder shows `backup` and a decreasing `backupFuelMin`. Only `utility_operator` or `admin` can approve or override.
**Tests.** Downstream cascade; threshold and trend; facility power transitions; authority enforcement.
**Commits.** `feat(grid): section tree and state` → `feat(grid): threat evaluation and isolation proposals` → `feat(grid): outage effects on facilities` → `test(grid): cascade and authority tests`

### DOM-013 · Restoration prioritization engine
**Owner** Dominic · **Priority** P0 · **Complexity** Large · **Branch** `feat/dominic-restoration` · **Depends on** DOM-005, DOM-008

**Objective.** Rank repairs by who regains access to hospitals, shelters and the outside world. This is the closing argument of the demo.

**Implementation.**
- Baseline: multi-source travel time from all functioning hospitals and from all activated shelters to every cell's node on the current (damaged) graph. A cell is *without access* when time exceeds `accessThresholdMin` (default 15) or is unreachable; *isolated* when unreachable from the largest connected component.
- For each `RepairCandidate` (and the best pairs when cheap enough): re-run with the candidate's edges hypothetically open (routing overlay) and compute `impact`. Score = weighted population gain ÷ `estHours`, with weights from a rule's `params` so the coordinator's priorities are configurable.
- Output `RestorationAnalysis` with ranked options, `recommendedOptionId` and a plain-language `rationale` per option; call `IntelPort.narrateRestoration` asynchronously to add `narrative`.
- Recompute when the road graph, hospital status or shelter set changes (debounced), and on `POST /restoration/analyze`. `GET …/impact` returns the per-cell before/after for the map.

**Files.** `apps/server/src/restoration/**`, `apps/server/src/routes/restoration.ts`.
**Acceptance.** After the flood recedes on `region-mini`, the top option is the debris clearance that reconnects the cut-off neighbourhood. With the same debris plus a hospital outage, the ranking changes. Analysis of 30 candidates on the real pack completes in under 1.5 s and never blocks a tick (run between ticks in slices or on a `setImmediate` chain).
**Tests.** Hand-computed impacts on `region-mini`; ranking changes with hospital status; overlay leaves world untouched; time budget.
**Commits.** `feat(restoration): baseline access analysis` → `feat(restoration): candidate impact and scoring` → `feat(restoration): ranked options, rationale and recompute triggers` → `feat(restoration): analysis and impact routes` → `test(restoration): impact and ranking tests`

### DOM-014 · Work orders
**Owner** Dominic · **Priority** P0 · **Complexity** Medium · **Branch** `feat/dominic-work-orders` · **Depends on** DOM-011, DOM-013

**Objective.** A selected repair becomes a tracked work order that ends with the road reopening on the map.

**Implementation.** `POST /operations/:id/work-orders` creates the order through the action pipeline (`create_work_order`), assigns the best available `public_works` crew via the decision engine, crew drives to site, `progress` advances with sim time against `estCrewHours` (scenario time-compression factor so it completes on stage), then `inspection`, then `reopened`: edges return to `open`, closure is unpublished, restoration re-analyses. `POST /work-orders/:id/transition` for manual steps including `failed_inspection` (returns to `in_progress`). Persist and audit every transition.

**Files.** `apps/server/src/workorders/**`, `apps/server/src/routes/workOrders.ts`.
**Acceptance.** Creating an order from the recommended option leads, without further input, to the edge reopening and the affected cells regaining access. Illegal transitions return 409. Only `coordinator` and `admin` may create or transition.
**Tests.** Full lifecycle; failed inspection loop; permissions; graph reopened and analysis refreshed.
**Commits.** `feat(workorders): creation from restoration option` → `feat(workorders): crew assignment and progress` → `feat(workorders): inspection, reopening and graph update` → `test(workorders): lifecycle tests`

### DOM-015 · Rules administration and inject hardening
**Owner** Dominic · **Priority** P1 · **Complexity** Small · **Branch** `feat/dominic-rules-admin` · **Depends on** DOM-011

**Objective.** Let the UI show and tune agency rules live. **Implementation.** `GET /rules`, `PATCH /rules/:id` (authority-scoped permission, param validation per `actionKind`, audit entry, takes effect on the next tick); validate inject targets and return helpful 400s. **Files.** `apps/server/src/routes/rules.ts`, `apps/server/src/policy/**`. **Acceptance.** Switching a rule from `auto` to `approve` mid-operation makes the next matching proposal wait for approval. **Tests.** Permission and validation cases; live effect. **Commits.** `feat(rules): list and update routes` → `feat(injects): target validation` → `test(rules): admin tests`

### DOM-016 · Deployment
**Owner** Dominic · **Priority** P1 · **Complexity** Medium · **Branch** `feat/dominic-deploy` · **Depends on** M2

**Objective.** One URL the judges can open, and a one-command local production run. **Implementation.** Multi-stage `Dockerfile` (build web, run server with `tsx`), server serves `apps/web/dist` with SPA fallback, `render.yaml` (or Fly config) with a persistent disk for SQLite, health check, WebSocket verified through the host's proxy, `pnpm start:prod`. Admin-only `POST /api/admin/demo-reset` that ends all operations and reseeds. **Files.** `Dockerfile`, `render.yaml`, `apps/server/src/static.ts`, `apps/server/src/routes/admin.ts`. **Acceptance.** Deployed URL plays the flood scenario end to end; cold start under 20 s; local `docker run` works offline except for map tiles. **Tests.** Smoke script hitting health, login, create operation, WebSocket snapshot. **Commits.** `feat(server): serve built web app` → `chore: dockerfile and deploy config` → `feat(admin): demo reset endpoint` → `test: deployment smoke script`

### DOM-017 · Golden-run determinism and performance tests
**Owner** Dominic · **Priority** P1 (do before demo lock) · **Complexity** Medium · **Branch** `feat/dominic-golden-runs` · **Depends on** MUS-007, MUS-008

**Objective.** Prove both demo scenarios play identically every time. **Implementation.** Headless runner executes each real scenario at max speed with `INTEL_MODE=cache`, records the ordered list of key events (incidents opened, actions executed, isolation, recommended option, work order reopened) and compares with a committed golden file; asserts tick time p95 under 50 ms and patch size bounds. `pnpm golden:update` to refresh intentionally. **Files.** `apps/server/test/golden/**`. **Acceptance.** Both scenarios pass ten consecutive runs; CI runs them. **Commits.** `test(golden): headless scenario runner` → `test(golden): flood golden run` → `test(golden): earthquake golden run` → `perf: tick and patch budgets`

### DOM-018 · Tornado hazard model
**Owner** Dominic · **Priority** P1 · **Complexity** Medium · **Branch** `feat/dominic-tornado` · **Depends on** DOM-008

**Objective.** A third playable hazard for the simulation lab. **Implementation.** Moving damage swath along `track` with `radiusM`; `windKph` per cell; structure-collapse incidents, debris-blocked edges and grid faults inside the swath from the seeded PRNG. **Files.** `apps/server/src/sim/hazards/tornado.ts`. **Acceptance.** Swath advances with sim time and leaves a debris corridor that the restoration engine ranks. **Tests.** Swath geometry and determinism. **Commits.** `feat(hazards): tornado swath and wind field` → `feat(hazards): tornado damage` → `test(hazards): tornado`

### DOM-019 · Hurricane hazard model
**Owner** Dominic · **Priority** P2 · **Complexity** Medium · **Branch** `feat/dominic-hurricane` · **Depends on** DOM-018

Wide wind field moving along a track plus a surge term reusing the flood depth model from a coastline or river source; widespread grid faults. Files `apps/server/src/sim/hazards/hurricane.ts`. Acceptance: runs on the region and produces both wind and flood cells. Commits: `feat(hazards): hurricane wind and surge` → `test(hazards): hurricane`.

### DOM-020 · Operation recording, rewind and export
**Owner** Dominic · **Priority** P2 · **Complexity** Medium · **Branch** `feat/dominic-op-replay` · **Depends on** DOM-007

Record snapshots every N ticks plus patches; `POST /operations/:id/control {command:'seek', simTime}` restores the nearest snapshot and fast-forwards; `GET /operations/:id/export` returns the event log for the after-action report. Acceptance: seeking back and replaying reproduces the same timeline. Commits: `feat(sim): snapshot recording` → `feat(sim): seek and fast-forward` → `feat(operations): export endpoint`.

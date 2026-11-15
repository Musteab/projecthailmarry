## Muste's tasks

Order of attack: MUS-001 → 002 (unblocks Thant) → 003 (unblocks real scenarios) → 004 → 005 → 006 → 007 → 009 → 008, then P1, then P2. MUS-001, MUS-003 and MUS-004 are fully independent of each other and of the backend; if Muste runs two sessions, split along those lines with separate clones or worktrees.

### MUS-001 · Client core: transport, world store, provider, hooks (with mock v0)
**Owner** Muste · **Priority** P0 · **Complexity** Large · **Branch** `feat/muste-client-core` · **Depends on** DOM-002 (contracts)

**Objective.** The typed data layer the whole UI is built on, usable within hours through a first, simple mock.

**Implementation.**
- `Transport` interface (`request(method, path, body)`, `connect(operationId, onMessage)`) with two implementations selected by provider config: `HttpWsTransport` and `MockTransport`.
- World store (zustand, vanilla store + React bindings): applies `snapshot`, then `tick` patches with the contract's upsert / null-delete / append semantics; keeps `clock` with the wall time it was received for interpolation.
- `BastionProvider` and every hook listed in the client contract. Selectors are memoised and return stable references so 60 fps map layers do not re-render needlessly.
- Pure helpers `simTimeNow` and `unitPositionAt` (interpolate along `assignment.route` by sim time, compute heading).
- Session: token in memory + `sessionStorage`, `can()` from shared.
- **Mock v0** inside `MockTransport`: `region-mini`, a static world, three units driving looped routes, one incident, one action awaiting approval, commands that mutate local state. Enough for Thant to start map and panel work.

**Files.** `packages/client/src/{transport,store,hooks,session,helpers}/**`, `packages/client/src/index.ts`.
**Acceptance.** `pnpm dev:mock` gives Thant moving units and working hooks with no server. Every hook in the contract exists with the documented signature. Applying a recorded snapshot + patches reproduces the server snapshot exactly. No JSX beyond the provider, no CSS.
**Tests.** Vitest: patch semantics, selector stability, interpolation at route start / middle / end, session and `can`.
**Commits.** `feat(client): transport interface and http/ws implementation` → `feat(client): world store with patch application` → `feat(client): provider and world hooks` → `feat(client): command hooks` → `feat(client): interpolation helpers` → `feat(client): mock transport v0` → `test(client): store and helper tests`

**→ Announce "mock v0 available" to Thant as soon as this merges.**

### MUS-002 · Mock engine: both demo scenarios in the browser
**Owner** Muste · **Priority** P0 · **Complexity** Large · **Branch** `feat/muste-mock-engine` · **Depends on** MUS-001

**Objective.** A convincing, contract-exact simulation of both demo scenarios running entirely in the browser, so the UI can be finished and even demoed without the backend.

**Implementation.**
- A scripted mock engine (not a physics model): reads a mock script describing the story (hazard growth as cell-depth keyframes or an expanding ring, signals, incidents, actions with explanations, unit routes along real edges, grid isolation, restoration options with per-cell impact, work-order progression, beats) and emits `tick` messages on a sim clock that honours start / pause / speed / reset.
- Commands behave plausibly: approve executes, reject removes, override swaps the unit, inject closes a road and reroutes, work-order transitions advance, rules update.
- Two scripts, `mock-flood` and `mock-quake`, mirroring the acts of the stage demo; switch from `region-mini` to the Portland pack when MUS-003 lands.
- A recorder (`pnpm --filter @bastion/client record`) that captures a real server run into `data/fixtures/*.ndjson` and a replay path in `MockTransport`, so later the mock can be an exact recording of the real engine.
- Every emitted message is validated against the shared schemas in dev.

**Files.** `packages/client/src/mock/**`, `data/fixtures/**`.
**Acceptance.** Both mock scenarios play start to finish with every UI surface fed: cells, roads, units, incidents, signals, actions in several statuses, grid, facilities, restoration, work orders, metrics, beats. Reset is clean. Message shapes are indistinguishable from the server's.
**Tests.** Vitest: every emitted message parses with `ServerMessageSchema`; command effects; determinism of a mock run.
**Commits.** `feat(mock): scripted engine and sim clock` → `feat(mock): hazards, signals and incidents` → `feat(mock): actions, units and commands` → `feat(mock): grid, restoration and work orders` → `feat(mock): flood script` → `feat(mock): earthquake script` → `feat(mock): record and replay of real runs` → `test(mock): schema conformance`

### MUS-003 · Region pack builder and the Portland pack
**Owner** Muste · **Priority** P0 · **Complexity** Large · **Branch** `feat/muste-region-pack` · **Depends on** DOM-002

**Objective.** "Each region configures the platform": a repeatable CLI that builds a region pack from open data, and the committed Portland demo pack.

**Implementation.**
- CLI `pnpm region:build --id portland --bbox <w,s,e,n>`. Starting bounding box to verify on a map and adjust: roughly `-122.70,45.44,-122.56,45.54`. It must contain Johnson Creek through Sellwood / Lents, at least three Willamette bridges, at least three hospitals and several fire stations.
- **Roads.** Overpass API query for drivable `highway` ways; build a node / edge graph, split at intersections, contract degree-2 nodes, keep the largest connected component, map OSM classes and `maxspeed` to `class` and `speedKph`, honour `oneway`. Tag bridges over the river from `bridge=yes` + name and group their edges into `Bridge` records; assign `seismicClass` from a small hand-maintained table in the tool's config. Target under about 15k nodes; drop `service` roads if needed.
- **Facilities.** Hospitals, fire stations, ambulance stations, schools / community centres as shelters, substations, a public-works yard; snap each to the nearest graph node; curate with an overrides file (rename, remove, add, set capacities).
- **Cells.** H3 resolution 10 cover of the bbox; `elevM` sampled from open terrain tiles (AWS Terrain Tiles "terrarium" PNGs are a keyless option; verify the URL and decoding; Mapbox Terrain-RGB is the alternative); `population` distributed from OSM building footprint area per cell, normalised to the region total.
- **Grid (synthetic but plausible).** From each substation grow two to four feeders along arterials; cut into sections of a few hundred metres; assign `customers` from cell population, `cellIds` along the path, `criticalFacilityIds` for hospitals, shelters and pump stations on the route, and `upstreamSectionId` to form the tree.
- **Units.** Seed from stations: engines, swift-water and USAR teams at selected fire stations, ALS / BLS ambulances at EMS stations and hospitals, public-works and utility crews at yards, a few police units.
- Cache raw downloads outside git, write the six pack files, validate with the shared schemas, print a summary (counts, graph connectivity, cells without a reachable node).
- Document any hand-curation in `data/regions/portland/README.md`. Attribute OpenStreetMap in `docs/demo/ATTRIBUTION.md`.

**Files.** `tools/region-pack/**`, `data/regions/portland/**`.
**Acceptance.** `data/regions/portland` validates against `RegionStatic`, loads in the server and in mock mode, and the graph is one connected component. Every facility and cell maps to a node. The pack is under about 15 MB uncompressed. Re-running the CLI reproduces it.
**Tests.** Vitest on small recorded Overpass samples: graph build, degree-2 contraction, bridge grouping, cell population sums to the configured total.
**Commits.** `feat(region-pack): cli and overpass download with cache` → `feat(region-pack): road graph build and simplification` → `feat(region-pack): bridges and facilities with overrides` → `feat(region-pack): h3 cells with elevation and population` → `feat(region-pack): synthetic grid and unit seeding` → `feat(data): portland region pack` → `test(region-pack): graph and cell tests`

**Fallback.** If Overpass or elevation sampling fights back for more than about two hours, hand-curate: a coarser arterial-only graph, elevation approximated by distance to the river and creek. The contract does not change.

### MUS-004 · Intel foundation: LLM provider, cache, fallback, plugin
**Owner** Muste · **Priority** P0 · **Complexity** Medium · **Branch** `feat/muste-intel-foundation` · **Depends on** DOM-002

**Objective.** The safe plumbing every AI feature uses.

**Implementation.**
- `LLMProvider` interface (`completeJson<T>({model, system, user, schema, images?, timeoutMs})`) with an Anthropic implementation (structured JSON output validated with zod, one retry, abort on timeout) and a `FakeProvider` for tests.
- `cache.ts`: content-hash keyed JSON files under `data/fixtures/ai-cache/`, read-through in `live` mode, read-only in `cache` mode, bypass in `off` mode. Never store API keys or headers.
- `createIntel(config): IntelPort` returning an implementation whose methods are wrapped by `withFallback(fn, ruleBasedFn, timeoutMs)`; start with rule-based fallbacks for all four methods so the port is complete on day one.
- `intelPlugin` (Fastify): mounts `/api/intel/*` and `/public/*` route groups using `IntelHost`; routes are added by later tasks.
- Usage and latency logging per call for the demo runbook.

**Files.** `packages/intel/src/{llm,cache,fallback,port,plugin}/**`, `packages/intel/src/index.ts`.
**Acceptance.** With no API key and `INTEL_MODE=off` the port answers every method deterministically. With `cache`, zero network calls are made. A provider that hangs returns the fallback within the timeout. Dominic can mount `intelPlugin` with one line.
**Tests.** Vitest with `FakeProvider`: timeout fallback, schema-failure retry then fallback, cache hit / miss in each mode.
**Commits.** `feat(intel): llm provider interface and anthropic implementation` → `feat(intel): content-hash response cache` → `feat(intel): fallback wrapper and rule-based port` → `feat(intel): fastify plugin scaffold` → `test(intel): provider, cache and fallback tests`

### MUS-005 · Signal fusion
**Owner** Muste · **Priority** P0 · **Complexity** Large · **Branch** `feat/muste-signal-fusion` · **Depends on** MUS-004

**Objective.** The headline AI capability: several messy signals in, one confident, located, explained incident out.

**Implementation.**
- Pre-cluster signals in code by space (H3 neighbourhood) and time window, so the model reasons over small groups, not the whole feed.
- For each cluster call the fast model with the signals (alert text, sensor reading and trend, imagery description, field-report text, 911 transcript), nearby open incidents and hazard context; ask for `IncidentCandidate[]`: kind, title, best position, severity, confidence that reflects source agreement and reliability, people affected, a two-sentence summary citing which signals support it, required capabilities, and `mergeWithIncidentId` when it is the same event as an open incident.
- Guardrails in code: clamp severity and confidence, reject positions outside the region, never invent signal ids, drop candidates supported only by one low-reliability social signal.
- Rule-based fallback that produces a reasonable candidate from keywords and source types.
- Prompt and few-shot examples live in versioned files; the prompt version is part of the cache key.

**Files.** `packages/intel/src/fusion/**`.
**Acceptance.** The flood scenario's three signals about the stranded family (field report, 911 call, imagery) come back as one `water_rescue` candidate, severity ≥ 4, confidence ≥ 0.85, citing all three. An unrelated medical call is not merged into it. A contradictory low-reliability report lowers confidence rather than creating a duplicate. Median latency under 2.5 s live, instant from cache.
**Tests.** Golden tests on recorded signal sets using cached responses; guardrail unit tests; fallback output shape.
**Commits.** `feat(fusion): spatial-temporal pre-clustering` → `feat(fusion): model prompt and candidate schema` → `feat(fusion): merge logic and guardrails` → `feat(fusion): rule-based fallback` → `test(fusion): golden signal sets`

### MUS-006 · 911 call triage
**Owner** Muste · **Priority** P0 · **Complexity** Medium · **Branch** `feat/muste-triage` · **Depends on** MUS-004

**Objective.** "Assign ambulances to medically triaged calls": turn a call transcript into an acuity and a unit recommendation.

**Implementation.** `triage(call, ctx)` with the fast model: extract chief complaint, age and key findings; return acuity 1 to 5, category, `recommendedUnit` (`als_ambulance` or `bls_ambulance`), and a one-sentence rationale. A conservative rule layer on top (red-flag terms such as not breathing, unconscious, chest pain, drowning always force acuity ≤ 2). A lookup-table fallback. A visible disclaimer string constant for the UI that this is decision support in a demonstration, not a certified triage protocol.

**Files.** `packages/intel/src/triage/**`.
**Acceptance.** The scenario's cardiac call returns acuity 1 or 2 with ALS; a minor-injury call returns 4 or 5 with BLS. Red-flag override cannot be talked down by the transcript. Fallback returns a valid `TriageResult`.
**Tests.** Table-driven transcripts with cached responses; red-flag override; fallback.
**Commits.** `feat(triage): transcript triage prompt and schema` → `feat(triage): red-flag safety rules` → `feat(triage): fallback table` → `test(triage): transcript cases`

### MUS-007 · Flash-flood demo scenario
**Owner** Muste · **Priority** P0 · **Complexity** Medium · **Branch** `feat/muste-scenario-flood` · **Depends on** MUS-003; DOM-006 and DOM-008 to play it for real (author against the mock before that)

**Objective.** Act 1 of the stage demo as a scenario file that plays the same way every time.

**Implementation.** `data/scenarios/flash-flood-johnson-creek.json`, about five minutes of stage time at the default speed:
1. Official flash-flood warning signal; forecast phase; opening beat and camera.
2. Creek gauges climb past flood stage (sensor signals); hazard `active`; water rises; closures are published.
3. Three signals within a minute about a family trapped by water: a field report, a 911 call, an imagery detection. They fuse into one water rescue; a swift-water crew is auto-dispatched; beat explains the fusion.
4. A 911 cardiac call from a street the water has cut off; triage; ambulance routed around flooded roads to the nearest functioning hospital.
5. A feeder section along the creek becomes threatened; the utility rule isolates it; a shelter or clinic on the feeder switches to backup power.
6. A shelter is activated as displaced population grows.
7. Water recedes; forced debris on chosen edges cuts a neighbourhood off from its hospital; restoration analysis recommends one clearance; closing beat.
- Choose concrete edge, facility, section and unit ids from the Portland pack; write the signal texts realistically (they are read by the model and shown in the UI); place `ScenarioBeat`s with titles, captions and camera poses for every step.
- Tune `stageCurve` and timings with Dominic's engine until every step is visible and unhurried. Warm and commit the AI cache for the scenario.

**Files.** `data/scenarios/flash-flood-johnson-creek.json`, `data/fixtures/ai-cache/**`, notes in `docs/demo/flood.md`.
**Acceptance.** Validates against `ScenarioSchema`. Played on the real server in `cache` mode, all seven steps occur in order within the time budget, three runs in a row. The recommended restoration option is the intended one.
**Tests.** Schema validation test; a checklist run recorded in `docs/demo/flood.md`; feeds DOM-017's golden run.
**Commits.** `feat(scenario): flood hazard spec and warning phase` → `feat(scenario): rescue fusion and medical call signals` → `feat(scenario): grid threat, shelter and recession debris` → `feat(scenario): beats and camera choreography` → `chore(data): warmed ai cache for flood scenario`

### MUS-008 · Earthquake demo scenario
**Owner** Muste · **Priority** P0 · **Complexity** Medium · **Branch** `feat/muste-scenario-quake` · **Depends on** MUS-003, MUS-007 (reuse structure); DOM-008, DOM-010, DOM-013 to play it for real

**Objective.** Act 2: the same region, a different hazard, and visibly different decisions.

**Implementation.** `data/scenarios/earthquake-portland-hills.json`, about three minutes of stage time:
1. Earthquake early-warning signal, then the shock: hazard spec with epicentre and magnitude; shockwave beat.
2. Forced injects: one named Willamette bridge `closed`, one hospital loses grid power (backup with limited fuel, goes on divert), two or three structure collapses, a grid fault, debris on selected arterials.
3. Signals describing a collapse with trapped occupants; fusion; the nearest USAR team is across the damaged bridge, so a farther but reachable team is dispatched; the decision card must say so.
4. A medical call near the affected hospital; the ambulance is sent to a different hospital than it would have been in Act 1.
5. Restoration analysis ranks a different road first than in the flood (the clearance that reconnects the cut-off bank to a functioning hospital); closing beat contrasts the two acts.
- Pick ids so the contrast with Act 1 is unmistakable; write beats that say what changed and why. Warm and commit the AI cache.

**Files.** `data/scenarios/earthquake-portland-hills.json`, `data/fixtures/ai-cache/**`, `docs/demo/quake.md`.
**Acceptance.** Validates; plays three times in a row in `cache` mode; chosen crew, destination hospital and top restoration option all differ from the flood scenario, and each difference is explained in a decision card or rationale.
**Tests.** Schema validation; checklist run in `docs/demo/quake.md`; feeds DOM-017.
**Commits.** `feat(scenario): earthquake hazard spec and forced damage` → `feat(scenario): collapse and medical signals` → `feat(scenario): beats contrasting flood and quake` → `chore(data): warmed ai cache for earthquake scenario`

### MUS-009 · Live transport integration and hardening
**Owner** Muste · **Priority** P0 · **Complexity** Medium · **Branch** `feat/muste-client-live` · **Depends on** MUS-001, DOM-007 (milestone M1)

**Objective.** The same hooks, now driven by the real server, reliably.

**Implementation.** Point `HttpWsTransport` at Dominic's server; login flow and token on REST and WebSocket; auto-reconnect with backoff and resubscribe for a fresh snapshot; `connection` state transitions; typed errors from the contract error shape surfaced through command hooks (`ApiError` with `code`); dev-mode validation of inbound messages with a loud console report on contract drift; region static cached in memory and `Cache Storage`; clock-drift handling so interpolation stays smooth at every speed. Raise any contract mismatch with Dominic immediately rather than adapting silently.

**Files.** `packages/client/src/transport/**`, `packages/client/src/store/**`.
**Acceptance.** `pnpm dev` runs the UI against the real server with no component changes. Killing and restarting the server recovers within seconds. A 403 from an approve call reaches the UI as a typed error. No schema warnings during a full `scenario-mini` run.
**Tests.** Integration test against a locally started server with `scenario-mini`; reconnect test; error mapping.
**Commits.** `feat(client): authenticated rest and websocket against live server` → `feat(client): reconnect and resubscribe` → `feat(client): typed api errors` → `feat(client): inbound contract validation in dev` → `test(client): live integration tests`

### MUS-010 · Briefing, narratives and copilot
**Owner** Muste · **Priority** P1 · **Complexity** Medium · **Branch** `feat/muste-briefing-copilot` · **Depends on** MUS-004, DOM-009 (plugin mounted)

**Objective.** Let the AI explain the situation and the platform's choices in plain language. **Implementation.** `explain(action)` and `narrateRestoration(analysis)` with the deep model: short, factual, grounded only in the supplied factors and impacts (no invented numbers; validate that every number in the text appears in the input). Routes in the plugin: `POST /api/intel/operations/:id/briefing` (headline, situation, priorities, risks, recommended actions from a compact world summary) and `POST /api/intel/operations/:id/copilot` (question answering over the world summary, recent timeline and audit; returns entity refs for map highlighting). Prompt-cache the static system and region context. Client hooks `useBriefing` and `useCopilot` wired to them, with mock responses in mock mode. **Files.** `packages/intel/src/{narrative,briefing,copilot}/**`, `packages/client/src/hooks/intel.ts`. **Acceptance.** Briefing under 6 s live, instant from cache; narratives contain no number absent from their input; copilot answers "why was that crew chosen" from the action's explanation. **Tests.** Number-grounding validator; cached golden outputs; fallback strings. **Commits.** `feat(intel): decision and restoration narratives` → `feat(intel): situation briefing route` → `feat(intel): copilot route` → `feat(client): briefing and copilot hooks` → `test(intel): grounding and fallback tests`

### MUS-011 · Live feed adapters
**Owner** Muste · **Priority** P1 · **Complexity** Medium · **Branch** `feat/muste-live-feeds` · **Depends on** MUS-004, DOM-009

**Objective.** Prove the live side is real: actual public data arriving as signals. **Implementation.** `FeedAdapter` interface (`poll(): Promise<Signal-like[]>`). Adapters: US National Weather Service active alerts for the region (`api.weather.gov`, requires a generic User-Agent), USGS earthquake GeoJSON feed filtered to a radius, USGS water services gauge heights for creek gauges near the region (look up the site ids). Normalise to `Signal` (source, title, body, position, `data`, reliability), de-duplicate by upstream id, push into live-mode operations through `IntelHost.ingestSignal`. Polling scheduler enabled by `FEEDS_ENABLED`, with backoff and a recorded-response replay mode for offline demos. **Files.** `packages/intel/src/feeds/**`. **Acceptance.** With feeds enabled, a live operation shows real current alerts or gauge readings as signals within a minute; with them disabled, nothing is called. Upstream failure never surfaces as an error to the user. **Tests.** Adapter parsing on recorded payloads; dedup; replay mode. **Commits.** `feat(feeds): adapter interface and scheduler` → `feat(feeds): nws alerts adapter` → `feat(feeds): usgs earthquake adapter` → `feat(feeds): usgs stream gauge adapter` → `test(feeds): recorded payload tests`

### MUS-012 · Public outputs and connector formatters
**Owner** Muste · **Priority** P1 · **Complexity** Small · **Branch** `feat/muste-public-outputs` · **Depends on** MUS-004, DOM-011

**Objective.** Show that published actions reach the outside world in standard formats. **Implementation.** `GET /public/:regionId/closures.geojson` (published closures of live operations only, never exercise), `GET /public/:regionId/alerts.cap` (Common Alerting Protocol XML for issued public alerts), and pure formatters for a CAD-style dispatch message that Dominic's outbox can call. Strict escaping; cache headers. **Files.** `packages/intel/src/publish/**`. **Acceptance.** A closure published in a live operation appears in the GeoJSON feed; the same action in an exercise does not. CAP output validates against the CAP 1.2 structure. **Tests.** Snapshot tests of both feeds; exercise exclusion. **Commits.** `feat(publish): closures geojson feed` → `feat(publish): cap alert feed` → `feat(publish): cad dispatch formatter` → `test(publish): feed snapshots`

### MUS-013 · Demo director and runbook
**Owner** Muste · **Priority** P1 · **Complexity** Medium · **Branch** `feat/muste-demo-director` · **Depends on** MUS-007, MUS-008, MUS-009

**Objective.** One person can run the whole stage demo with a few keys, and recover from anything. **Implementation.** `useDemoDirector()` in the client: an ordered list of steps (sign in as operator, launch flood, jump to beat N, switch persona to coordinator, issue work order, launch earthquake, …) with `next`, `goto`, `reset`; a headless `useDemoHotkeys()` Thant mounts once. `pnpm demo:prewarm` (warms and verifies the AI cache, checks region pack, scenarios and map token), `pnpm demo:check` (boots the server, plays both scenarios headless at 60x, asserts the key events). `docs/demo/RUNBOOK.md`: setup, the script with timings and talking points, hotkeys, failure playbook (no network → mock mode; server down → mock mode; AI slow → cache mode), and a reminder to record a backup video. **Files.** `packages/client/src/demo/**`, `scripts` in `packages/client` and `packages/intel`, `docs/demo/**`. **Acceptance.** A teammate who has never run the demo completes it from the runbook. `demo:check` passes on a clean clone. **Tests.** The check script itself; unit tests for the step machine. **Commits.** `feat(demo): director step machine and hotkeys hook` → `feat(demo): prewarm and check scripts` → `docs(demo): runbook and failure playbook`

### MUS-014 · End-to-end smoke tests
**Owner** Muste · **Priority** P1 · **Complexity** Medium · **Branch** `feat/muste-e2e` · **Depends on** M2 (flood) and M3 (earthquake)

**Objective.** Catch integration breakage before a human does. **Implementation.** Playwright against the real stack in `cache` mode at high sim speed: sign in, launch the flood, assert via stable `data-testid` attributes (agree the list with Thant by change request) that an incident appears, an action executes, a grid section is isolated, a restoration option is recommended, a work order reaches reopened; then the earthquake with its distinct assertions. A second project runs the same journey in mock mode. Wire into CI as a non-blocking job first, blocking after M4. **Files.** `e2e/**`. **Acceptance.** Both journeys pass locally and in CI three times in a row. **Commits.** `test(e2e): playwright setup and auth helper` → `test(e2e): flood journey` → `test(e2e): earthquake journey` → `ci: run e2e smoke job` (the CI file change goes through Dominic)

### MUS-015 · After-action report
**Owner** Muste · **Priority** P2 · **Complexity** Medium · **Branch** `feat/muste-aar` · **Depends on** MUS-010, DOM-020 (export) or the audit route

`GET /api/intel/operations/:id/aar`: the deep model writes a structured after-action report (timeline, decisions and overrides, response times, what the exercise revealed, recommendations) grounded in the audit log and metrics; returned as markdown; hook `useAfterActionReport()`. Acceptance: every figure traces to the log. Commits: `feat(intel): after-action report generation` → `feat(client): aar hook`.

### MUS-016 · Field report intake with image understanding
**Owner** Muste · **Priority** P2 · **Complexity** Medium · **Branch** `feat/muste-field-reports`· **Depends on** MUS-005

A hook `useFieldReport().submit({text, photo?, position})` posting to the signals endpoint; in `@bastion/intel`, a vision call that describes an attached photo (water depth cues, structural damage, people visible) and attaches the description and a reliability estimate to the signal before fusion. Acceptance: a submitted flood photo raises confidence of the matching incident. Commits: `feat(intel): image description for field reports` → `feat(client): field report submit hook`.

### MUS-017 · Tornado and hurricane scenarios
**Owner** Muste · **Priority** P2 · **Complexity** Small · **Branch** `feat/muste-scenarios-extra` · **Depends on** DOM-018 (tornado), DOM-019 (hurricane)

Short scenario files with track, signals and beats so the launcher's other two hazards are playable. Acceptance: each validates and plays for two minutes with visible response. Commits: `feat(scenario): tornado scenario` → `feat(scenario): hurricane scenario`.

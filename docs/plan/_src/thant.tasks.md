## Thant's tasks

Order of attack: THA-001 → 002 → 003 → 004 → 006 → 005 → 007 → 008 → 009 → 011 → 010 → 012, then P1, then P2. Every task is developed against `pnpm dev:mock`. Until Muste's first mock lands (MUS-001, expected within the first hours), use the `region-mini` fixture exported by `@bastion/shared` and a throwaway local mock in `apps/web/src/dev/`.

### THA-001 · Visual direction and design system foundation
**Owner** Thant · **Priority** P0 · **Complexity** Medium · **Branch** `feat/thant-design-system` · **Depends on** DOM-001

**Objective.** Lock the look before building screens, so everything after is assembly.

**Implementation.**
- Tokens as CSS variables: neutral scale, the semantic colour ramps from the visual brief (water, seismic, life-safety, utility, access, platform accent, five authority colours), spacing, radii, elevation, z-layers, motion durations and easings.
- Self-hosted fonts, a type scale, tabular-figure telemetry style, micro-label style.
- Primitives built from scratch on accessible unstyled parts: `Panel`, `Button`, `IconButton`, `Tag`, `AuthorityBadge`, `Meter`, `Stat` (animated number), `Tabs`, `Tooltip`, `Dialog`, `Drawer`, `Toast`, `Skeleton`, `Kbd`, `Sparkline`.
- An icon set with one consistent stroke weight, including unit-kind and incident-kind glyphs usable on the map.
- `/dev/gallery` route showing every token and primitive in both modes.

**Files.** `apps/web/src/design/**`, `apps/web/src/dev/gallery/**`, `apps/web/public/fonts/**`.
**Acceptance.** Gallery renders every primitive in exercise and live themes. Colour contrast for text meets WCAG AA on the dark base. No primitive resembles an out-of-the-box component library. Thant has signed off the direction.
**Tests.** Visual check in the gallery at 1440, 1024 and 390 px; keyboard focus visible on every interactive primitive.
**Commits.** `feat(design): colour, spacing and motion tokens` → `feat(design): typography and self-hosted fonts` → `feat(design): panel, button, tag and badge primitives` → `feat(design): meter, stat, tabs, tooltip, dialog, drawer, toast` → `feat(design): icon set and map glyphs` → `feat(dev): component gallery`

### THA-002 · App shell, routing and mode theming
**Owner** Thant · **Priority** P0 · **Complexity** Medium · **Branch** `feat/thant-app-shell` · **Depends on** THA-001

**Objective.** The frame every screen lives in.

**Implementation.** `main.tsx` with `BastionProvider` (config from `VITE_*`), router (`/login`, `/` launcher, `/ops/:operationId`, `/dev/gallery`), auth gate using `useSession()`. The ops shell: status strip, left rail, right drawer, bottom timeline frame, centre map slot, all collapsible with remembered state. Exercise vs live theming driven by `operation.mode` (frame, marker, accent). Connection indicator from `useOperation().connection`. UI store for selection, hover and panel state. Global keyboard map (`?` shows shortcuts).

**Files.** `apps/web/src/app/**`, `apps/web/src/state/**`, `apps/web/index.html`, `apps/web/vite.config.ts`.
**Acceptance.** Navigating between routes keeps the map mounted. Switching mode re-themes instantly. Panels collapse and restore. Works from 1280 px wide upward with no overlap.
**Tests.** Manual route walk in mock mode; reload restores panel state; no console errors.
**Commits.** `feat(app): provider wiring and router` → `feat(app): ops shell layout regions` → `feat(app): exercise and live mode theming` → `feat(app): ui store and keyboard shortcuts`

### THA-003 · 3D map scene foundation
**Owner** Thant · **Priority** P0 · **Complexity** Large · **Branch** `feat/thant-map-scene` · **Depends on** THA-002

**Objective.** The hero: a beautiful, performant 3D city that everything else is drawn on.

**Implementation.**
- `MapScene`: Mapbox GL v3 Standard style, terrain, 3D buildings, fog, `lightPreset` switchable (dawn / day / dusk / night), initial pose from `region.config.defaultCamera`, bounds from `bbox`.
- deck.gl `MapboxOverlay` (interleaved) with a **layer registry**: each feature registers a function `(ctx) => Layer[]` with an order and a visibility key, so layer code stays isolated per feature.
- Camera controller: `flyTo(pose, duration)`, `focus(entity)`, slow idle orbit, scripted moves from scenario beats, user input always wins and pauses choreography.
- Picking bridge: hover and click on any deck object or map feature writes `{type,id}` to the UI store.
- A render clock (`requestAnimationFrame`) exposing `simTimeNow` for smooth animation between ticks.
- Layer toggle control and a compact legend driven by the registry.

**Files.** `apps/web/src/map/{MapScene,camera,registry,picking,clock}.*`.
**Acceptance.** 60 fps on a laptop with buildings and terrain at pitch 60. Light preset changes without reload. Clicking any registered layer selects the entity. Missing Mapbox token shows a designed error state, not a blank screen.
**Tests.** Performance panel check with an empty and a full registry; resize and device-pixel-ratio changes; token-missing state.
**Commits.** `feat(map): mapbox standard scene with terrain and lighting` → `feat(map): deck overlay and layer registry` → `feat(map): camera controller` → `feat(map): picking bridge and render clock` → `feat(map): layer toggles and legend`

### THA-004 · Static region layers
**Owner** Thant · **Priority** P0 · **Complexity** Medium · **Branch** `feat/thant-region-layers` · **Depends on** THA-003

**Objective.** Show what the region *has* before anything goes wrong.

**Implementation.** From `useRegion()`: facility markers with kind glyphs and labels that declutter by zoom (hospitals and shelters always prominent); road network emphasis for arterials and bridges (subtle glow on bridges); grid sections as thin elevated lines with substations; unit home stations. Hover tooltips; click opens the context drawer.

**Files.** `apps/web/src/map/layers/region/**`.
**Acceptance.** On the Portland pack the hospitals, shelters, stations, bridges and feeders are legible at city zoom and precise at street zoom, with no label collisions. Layers toggle independently.
**Tests.** Mock mode at three zoom levels; 10k+ edges render without frame drops.
**Commits.** `feat(map): facility markers and labels` → `feat(map): road and bridge emphasis` → `feat(map): grid network layer` → `feat(map): region layer tooltips and selection`

### THA-005 · Hazard layers: flood and earthquake
**Owner** Thant · **Priority** P0 · **Complexity** Large · **Branch** `feat/thant-hazard-layers` · **Depends on** THA-003

**Objective.** The moments the audience remembers: water filling streets and a shockwave crossing the city.

**Implementation.**
- **Flood.** From `useCells()` (`floodDepthM` per H3 cell): a water surface that reads as water, not as blue hexagons. Smooth cell edges (blend neighbours or render as a filled, slightly extruded surface with animated normals or scrolling highlights), depth-based colour and opacity, eased transitions between ticks, a wet-street look on `flooded` roads. Enable Mapbox rain and a darker light preset while the hazard is `active`; fade out on `receding`. Gauge sensor markers with live sparkline.
- **Earthquake.** From `useHazards()` and `useCells()` (`shakeMMI`): expanding wavefront ring(s) from `epicenter` timed by `originSimTime`, an intensity field that fades in behind the front, building tint by intensity, a short camera shake (skipped under reduced motion), damage markers on bridges and facilities.
- Hazard legend and intensity scale in the status strip.

**Files.** `apps/web/src/map/layers/hazard/**`.
**Acceptance.** Flood: water visibly rises outward from the creek and recedes, at 60 fps with about 8k cells. Earthquake: the ring reaches each neighbourhood when its cells receive intensity. Both look intentional in a screenshot.
**Tests.** Mock both scenarios at 1x and 20x; reduced-motion pass; frame-time check during peak flood.
**Commits.** `feat(map): flood water surface from cell depths` → `feat(map): rain, lighting and flooded street treatment` → `feat(map): earthquake wavefront and intensity field` → `feat(map): building tint, damage markers and camera shake` → `feat(map): hazard legend`

### THA-006 · Live operations layers
**Owner** Thant · **Priority** P0 · **Complexity** Large · **Branch** `feat/thant-ops-layers` · **Depends on** THA-003

**Objective.** Make the response visible: who is going where, what is closed, what is dark.

**Implementation.**
- **Units.** Icon or small 3D model per `UnitKind`, coloured by authority, positioned every frame with `unitPositionAt(unit, clock, now)`; route line ahead (animated dashes) and fading trail behind; status ring; callsign label on hover and when selected.
- **Incidents.** Marker per `IncidentKind`, size and pulse rate by severity, `suspected` drawn hollow, `resolved` fades out; lines from source signals converging on the incident when it is created.
- **Signals.** Small typed blips (alert, sensor, imagery, field report, 911) that appear, then either join an incident or fade.
- **Roads.** `flooded`, `blocked`, `damaged`, `closed` each with a distinct treatment; published closures get a barrier glyph.
- **Grid.** Section colour and animation by `energized / isolated / faulted`, a warning shimmer when `threatened`, darkened building footprints for areas without power if feasible.
- **Facilities.** State badges: backup power with fuel countdown, shelter activated with occupancy, hospital on divert or offline.

**Files.** `apps/web/src/map/layers/ops/**`.
**Acceptance.** In the mock flood you can follow the rescue crew from station to scene without reading any text. A unit never teleports between ticks. Selecting a unit highlights its route and target; selecting an incident highlights its units.
**Tests.** Mock both scenarios; 30 simultaneous units at 60 fps; selection sync both ways with the panels.
**Commits.** `feat(map): unit markers with interpolated motion` → `feat(map): routes and trails` → `feat(map): incident markers and severity pulses` → `feat(map): signal blips and fusion convergence` → `feat(map): road status and closures` → `feat(map): grid section states` → `feat(map): facility state badges`

### THA-007 · Scenario launcher, transport and timeline
**Owner** Thant · **Priority** P0 · **Complexity** Medium · **Branch** `feat/thant-launcher-timeline` · **Depends on** THA-002

**Objective.** Start a scenario with drama and control time.

**Implementation.** Launcher at `/`: the region's 3D map slowly orbiting behind four hazard choices (flash flood, earthquake, tornado, hurricane; unavailable ones visibly "coming soon"), scenario description, exercise / live selector, a launch transition that flies into the operation. Transport in the timeline frame: start, pause, resume, speed (1x, 5x, 20x, 60x), reset, sim clock, progress along `durationSimSec`. Timeline ribbon: event ticks from `useTimeline()` coloured by severity, hover preview, click focuses the map on the event; hazard phase bands.

**Files.** `apps/web/src/features/launcher/**`, `apps/web/src/features/timeline/**`.
**Acceptance.** From login to a running flood in two clicks. Speed changes are reflected in motion immediately. The ribbon stays readable with 300 events.
**Tests.** Mock: launch each scenario in both modes; pause / resume / reset; keyboard shortcuts for transport.
**Commits.** `feat(launcher): hazard selection and mode choice` → `feat(launcher): launch transition` → `feat(timeline): transport controls and sim clock` → `feat(timeline): event ribbon with phase bands`

### THA-008 · Action stream and decision cards
**Owner** Thant · **Priority** P0 · **Complexity** Large · **Branch** `feat/thant-action-stream` · **Depends on** THA-002

**Objective.** Show the platform acting under rules, and humans staying in control.

**Implementation.** Left-rail stream from `useActions()`, newest first, grouped by status: *needs approval* pinned at the top, then *executing*, then history. Each decision card: authority badge, action kind glyph, `explain.headline`, the rule that allowed it and its autonomy, confidence, sandbox badge in exercise mode, time. Expanding shows factors as a compact visual breakdown, alternatives with `rejectedBecause`, the AI narrative when present, and related map focus. Controls gated by `useSession().can`: approve, reject (reason), override (pick a replacement unit or cancel). Optimistic UI with rollback on error. Entry animation distinguishes auto-executed (stamp) from awaiting approval (breathing outline). Filters by authority and kind.

**Files.** `apps/web/src/features/actions/**`.
**Acceptance.** A judge can read why Rescue 3 was sent instead of Rescue 1 in under five seconds. Approve / reject / override round-trip in mock mode. Users without permission see the card but not the controls. Hovering a card highlights the unit, route and incident on the map.
**Tests.** Mock both scenarios; each role; error path (mock a 403 and a 409).
**Commits.** `feat(actions): stream layout and status grouping` → `feat(actions): decision card with explanation` → `feat(actions): approve, reject and override flows` → `feat(actions): map linkage and entry animations` → `feat(actions): filters and permission gating`

### THA-009 · Context drawer: incidents, units, facilities, signals
**Owner** Thant · **Priority** P0 · **Complexity** Medium · **Branch** `feat/thant-context-drawer` · **Depends on** THA-002

**Objective.** One place that explains whatever is selected.

**Implementation.** Right drawer driven by the UI store selection. Incident view: status stepper, severity, people affected, AI summary, triage result for medical calls (acuity, complaint, recommended unit, rationale), contributing signals rendered by type (alert text, sensor reading with sparkline, imagery thumbnail, field report quote, 911 transcript), assigned units with live ETA. Unit view: status, assignment, ETA countdown, recall control. Facility view: status, power, fuel, occupancy, the feeder serving it. Road view: status, closure, linked repair candidate. A compact incident list and a signals feed as drawer tabs.

**Files.** `apps/web/src/features/{incidents,units,facilities,signals}/**`.
**Acceptance.** Every selectable map entity has a designed drawer view. The fused incident clearly shows the three signals it came from. ETAs count down smoothly.
**Tests.** Mock: select each entity type from map and from lists; empty selection state.
**Commits.** `feat(drawer): selection-driven drawer shell` → `feat(incidents): incident detail with signals and triage` → `feat(units): unit detail with live eta` → `feat(facilities): facility and road detail` → `feat(signals): signals feed and incident list tabs`

### THA-010 · Restoration view and work orders
**Owner** Thant · **Priority** P0 · **Complexity** Large · **Branch** `feat/thant-restoration` · **Depends on** THA-003, THA-002

**Objective.** The closing act: a visual argument for which road to reopen first.

**Implementation.** A restoration mode of the ops screen. Baseline banner (people without hospital access, isolated population). Ranked options from `useRestoration()` as comparable rows: label, estimated hours, people regaining hospital access, shelter access, isolated population reconnected, visual bars so the winner is obvious, the recommended option marked, rationale and AI narrative. Selecting or hovering an option calls `loadImpact` and paints a per-cell before / after access choropleth on the map with an animated wipe, highlights the repair location and the hospital it reconnects, and draws the restored route. "Issue work order" creates one; a work-order tracker shows status steps (created, assigned, in progress, inspection, reopened), crew, progress, with manual transition controls for the coordinator. On `reopened`: the road animates back to open and the cells turn green.

**Files.** `apps/web/src/features/restoration/**`, `apps/web/src/features/workorders/**`, `apps/web/src/map/layers/restoration/**`.
**Acceptance.** In the mock flood, the difference between option A and option B is obvious from the map alone. Creating a work order and watching it reach `reopened` needs no explanation. In the earthquake a different option is on top and the UI makes the reason visible.
**Tests.** Mock both scenarios; coordinator vs operator permissions; analysis `null` and empty-options states.
**Commits.** `feat(restoration): options comparison panel` → `feat(restoration): access impact choropleth` → `feat(restoration): repair and route highlights` → `feat(workorders): creation and tracker` → `feat(restoration): reopening animation`

### THA-011 · Status strip, metrics, beat captions and cinematic camera
**Owner** Thant · **Priority** P0 · **Complexity** Medium · **Branch** `feat/thant-status-beats` · **Depends on** THA-003

**Objective.** Tell the story for the audience at the back of the room.

**Implementation.** Status strip with animated `useMetrics()` values (people at risk, rescued, active incidents, units deployed, customers out, roads closed, shelters open, no hospital access), each with a trend sparkline. Beat captions from `useBeat()`: large title and one-line caption with tasteful entrance, auto-dismiss. Camera moves from `beat.camera`, focus highlight from `beat.focus`. Presentation mode (hotkey) hides rails and enlarges captions and key metrics. Mount `useDemoDirector()` hotkeys (provided by Muste) in one place.

**Files.** `apps/web/src/features/status/**`, `apps/web/src/features/beats/**`.
**Acceptance.** Playing the mock flood in presentation mode tells the whole story without anyone touching the mouse. Manual camera input cancels the current scripted move.
**Tests.** Mock both scenarios in presentation mode at 1080p; reduced-motion.
**Commits.** `feat(status): metrics strip with animated values` → `feat(beats): caption overlay` → `feat(beats): scripted camera and focus` → `feat(app): presentation mode and demo hotkeys`

### THA-012 · Sign-in screen and persona switch
**Owner** Thant · **Priority** P0 · **Complexity** Small · **Branch** `feat/thant-login` · **Depends on** THA-001

**Objective.** A first impression, and quick role changes during the demo. **Implementation.** Designed sign-in over the slowly orbiting map with `useSession().login`; error and loading states; quick-pick demo personas (operator, coordinator, utility operator, admin) that fill the email (password still typed or supplied by the dev env); user chip in the status strip with role, authority and sign-out. **Files.** `apps/web/src/features/session/**`. **Acceptance.** Wrong password shows a designed error; switching persona re-gates controls without reload. **Tests.** Mock login success and failure. **Commits.** `feat(session): sign-in screen` → `feat(session): persona quick-pick and user chip`

### THA-013 · Utility panel and rules console
**Owner** Thant · **Priority** P1 · **Complexity** Medium · **Branch** `feat/thant-grid-rules` · **Depends on** THA-008

**Objective.** Show that agencies own their rules. **Implementation.** Grid panel: feeders and sections with state, customers out, threatened sections with time-to-threshold, critical facilities on backup with fuel. Rules console from `useRules()`: rules grouped by authority, each with a three-position autonomy control (auto / approve / off) and editable thresholds, gated by permission, with a visible "approved by" line. **Files.** `apps/web/src/features/{grid,rules}/**`. **Acceptance.** Flipping a rule to `approve` makes the next matching action appear as awaiting approval. **Tests.** Mock as admin, utility operator and operator. **Commits.** `feat(grid): utility panel` → `feat(rules): rules console with autonomy controls`

### THA-014 · What-if inject tools
**Owner** Thant · **Priority** P1 · **Complexity** Medium · **Branch** `feat/thant-injects` · **Depends on** THA-006

**Objective.** Let the presenter break things live. **Implementation.** An inject toolbar in exercise mode only: close a road or bridge by clicking it, cut a facility's power, take a unit out of service, spawn an incident at a clicked point (kind and severity), fault a grid section. Confirmation with a clear "exercise only" treatment; each inject is echoed in the timeline. Calls `useOperation().inject`. **Files.** `apps/web/src/features/injects/**`. **Acceptance.** Closing a bridge on the map visibly re-routes a unit and reshuffles the action stream. Toolbar is absent in live mode. **Tests.** Each inject kind in mock mode. **Commits.** `feat(injects): toolbar and map targeting` → `feat(injects): inject forms and confirmation`

### THA-015 · AI briefing and copilot panel
**Owner** Thant · **Priority** P1 · **Complexity** Medium · **Branch** `feat/thant-briefing` · **Depends on** THA-002, MUS-010 for real data (mock available earlier)

**Objective.** Give the AI a face that is not a chat bubble. **Implementation.** Briefing panel from `useBriefing()`: headline, situation, priorities, risks, recommended actions, with a refresh control and a generated-at stamp; reveal text progressively. Copilot input from `useCopilot()` with suggested questions ("Why was Rescue 3 chosen?", "What happens if the Sellwood Bridge closes?"); answers can reference entities that highlight on the map. **Files.** `apps/web/src/features/briefing/**`. **Acceptance.** Briefing is readable in presentation mode; loading and failure states are designed. **Tests.** Mock responses, slow response, error. **Commits.** `feat(briefing): situation briefing panel` → `feat(briefing): copilot input and answers`

### THA-016 · States, responsiveness and accessibility pass
**Owner** Thant · **Priority** P1 · **Complexity** Medium · **Branch** `feat/thant-states-responsive` · **Depends on** THA-007 to THA-011

**Objective.** No screen ever looks broken. **Implementation.** Designed loading (skeletons, progressive map reveal), empty (no incidents yet, no restoration analysis yet) and error states (connection lost with auto-retry indicator, command failed toast) everywhere. Tablet layout (rails become sheets) and a phone layout focused on map, metrics and the action stream. Reduced-motion variants, focus order, ARIA labels on controls, colour-blind-safe checks on the semantic ramps. **Files.** across `apps/web/src/**`. **Acceptance.** Killing the server mid-run shows the reconnecting state and recovers. Usable at 390 px, 820 px and 1920 px. **Tests.** Throttled network, offline toggle, three viewports, keyboard-only walkthrough. **Commits.** `feat(ui): loading and empty states` → `feat(ui): error and reconnect states` → `feat(ui): tablet and phone layouts` → `fix(a11y): focus, labels and reduced motion`

### THA-017 · Demo polish
**Owner** Thant · **Priority** P1 · **Complexity** Small · **Branch** `feat/thant-demo-polish` · **Depends on** M3

**Objective.** The last ten percent that reads as ninety. **Implementation.** Opening title sequence, scenario-switch transition from flood to earthquake (time-of-day shift, palette shift), end-of-scenario summary overlay with outcome metrics, optional subtle sound cues with a mute control, final pass on spacing, timing and copy with the real scenarios. **Files.** `apps/web/src/features/{intro,summary}/**` and touch-ups. **Acceptance.** Three full rehearsals on the projector resolution with no visual glitch. **Commits.** `feat(demo): title sequence` → `feat(demo): scenario switch transition` → `feat(demo): outcome summary overlay` → `style: final timing and spacing pass`

### THA-018 · Optional visual extensions
**Owner** Thant · **Priority** P2 · **Complexity** Medium · **Branch** `feat/thant-extras` · **Depends on** DOM-018 and MUS-017 (tornado, hurricane), MUS-012 (public feed), MUS-015 (after-action report), as relevant

Pick in this order if time allows: tornado funnel and damage-swath layer; hurricane wind-field layer; public closure map page (read-only, phone-first, fed by the public feed); after-action report view; marketing-style landing page. Each is its own small branch and PR.

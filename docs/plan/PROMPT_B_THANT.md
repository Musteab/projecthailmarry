# THANT — UI/UX & FRONTEND IMPLEMENTATION

You are working as Thant's frontend development assistant. Thant is the lead frontend developer, UI/UX designer and visual experience owner on a three-developer hackathon team (Dominic: backend and architecture; Thant: all UI; Muste: data layer, AI and integrations).

The architecture, contracts, ownership boundaries and task list below are already agreed. Do not re-plan the project or change the stack outside `apps/web`. Inside `apps/web`, Thant has the final say on everything visual.

**Your role in one paragraph.** You own `apps/web` completely: the visual direction, design system, typography, colour, layout, navigation, every page and component, the 3D map scene and all of its layers, animation and micro-interactions, loading / empty / error states, responsiveness and polish. You build against typed hooks from `@bastion/client` (Muste) and types from `@bastion/shared` (Dominic). You never wait for the backend: run `pnpm dev:mock` and everything works on Muste's in-browser mock engine.

**What you must not touch.**

- `apps/server/**`, `packages/shared/**`, root config, CI, lockfile by hand: Dominic's.
- `packages/client/**`, `packages/intel/**`, `tools/**`, `data/**`, `e2e/**`: Muste's.
- No `fetch`, no `WebSocket`, no API URLs in `apps/web`. If a hook is missing or returns the wrong shape, send a change request to Muste and meanwhile derive what you need locally with `useWorld(selector)` or a temporary local mock inside `apps/web/src/dev/`.
- You may add dependencies only to `apps/web/package.json`.

In return, nobody else edits `apps/web/**`. If Dominic's or Muste's session proposes a change to a component, a style or a layout, the answer is a change request to you.

## The visual brief

**This UI is a major priority and must not look like a generic AI-generated dashboard.** Judges will decide in the first ten seconds whether this is a real operations product. The existing placeholder page is to be thrown away; design from a blank canvas.

**The one idea: the map is the product.** A full-bleed, living 3D city fills the screen. The interface is a set of thin, precise instruments floating over it, like the glass of a cockpit or the wall of an emergency operations centre. Nothing is a "card grid". Nothing sits in a white content area.

**Recommended direction ("night-ops cartography"); Thant may evolve it, but must stay this bold.**

- **Atmosphere.** The city at dusk or night with lit 3D buildings (Mapbox Standard `lightPreset`), terrain, fog on the horizon. Flood scenario: real rain, darker sky, water with a reflective, moving surface that rises through the streets. Earthquake: a visible shockwave ring crossing the city, buildings tinting by shaking intensity, a brief camera tremor.
- **Typography.** Two families, self-hosted. A characterful condensed or technical grotesque for labels and headings, and a monospaced face with tabular figures for all telemetry (times, counts, ETAs, coordinates). Uppercase micro-labels with generous tracking. No default system stack, no Inter-at-defaults.
- **Colour means something.** A near-black, slightly warm neutral base. Colour is reserved for semantics and never decorative: water (cold cyan-blue ramp by depth), seismic (amber to magenta ramp by intensity), life safety (signal red), utility (electric yellow), access restored (clear green), platform / AI action (one distinct accent used nowhere else), each authority (`ema`, `fire_rescue`, `ems`, `utility`, `public_works`) with its own small stripe or glyph. Define ramps as tokens and use the same ramp on the map and in the panels.
- **Two unmistakable modes.** *Exercise*: an amber hazard-stripe frame, a persistent `EXERCISE · EXERCISE · EXERCISE` marker, sandbox badges on every action. *Live*: clean frame, a red live indicator, real-time clock. Nobody should ever confuse them from across a room.
- **Motion with purpose.** Units glide along their routes with a fading trail. New incidents arrive with a sonar-style pulse. When AI fuses signals, the individual signal markers visibly converge into the incident. Auto-executed actions "stamp" into the action stream; actions awaiting approval breathe. Water eases upward. Numbers tick, never jump. The camera is choreographed by scenario beats. Target 60 fps with the full scene; honour `prefers-reduced-motion`.
- **Layout.** Top: a thin status strip (mode, clock, hazard, headline metrics). Left: the action and decision stream. Right: a context drawer for the selected incident, unit, facility, road or restoration option. Bottom: a timeline ribbon with transport controls and event ticks. Centre: clear for the map. Every panel collapses; a presentation mode hides everything except captions.
- **Explainability is a visual feature.** Every platform decision shows *why* at a glance: chosen unit, ETA, the alternatives it rejected and the reason, the authority and rule that allowed it, and the approve / reject / override controls for those with permission.

**Banned.** Default shadcn / MUI / Ant look. Purple-to-blue gradients. Glassmorphism on everything. A left sidebar with icon + label navigation and a grid of rounded stat cards. Emoji as icons. Stock illustration. Lorem ipsum. A light-grey admin background. Spinners where a skeleton or progressive reveal would do.

**Technical defaults (Thant may substitute equivalents).** React + Vite + TypeScript. `mapbox-gl` v3 with the Standard style; `deck.gl` v9 through `@deck.gl/mapbox` `MapboxOverlay` in interleaved mode; `h3-js` to turn cell ids into hexagons. CSS variables for tokens with Tailwind v4 or CSS modules. Unstyled accessible primitives (Radix) restyled from scratch. `motion` for UI animation. `react-router`. A small zustand store in `apps/web/src/state` for UI-only state (selection, hovered entity, open panels, camera mode). Verify Mapbox v3 APIs (`setConfigProperty('basemap','lightPreset',…)`, `setRain`, terrain, `MapboxOverlay`) against current documentation before relying on them. If the Mapbox token or network is a problem, the fallback is MapLibre GL with free vector tiles and deck.gl for extrusions.

**Suggested structure inside `apps/web/src`.**

```
design/        tokens.css, typography, colour ramps, motion presets, primitives (Button, Panel, Tag, Meter, …)
app/           main.tsx, router, shell (status strip, rails, drawer, timeline frame), mode theming
map/           MapScene, camera controller, layer registry, layers/{region,hazard,ops,restoration}/…
features/      launcher, actions, incidents, units, signals, restoration, workorders, grid, rules, briefing, injects
state/         ui store (selection, panels, camera)
dev/           component gallery, temporary local mocks
```

---

# SHARED PROJECT CONTEXT (identical in all three developer briefs)

## 1. The application

**Working codename: BASTION** (display name is Thant's call; package scope stays `@bastion/*`).

**Pitch.** A 3D disaster operations platform that lets government emergency teams simulate the hazards their region faces, dispatch responders and coordinate protective actions during a real emergency, and prioritize which roads and services to restore first.

**Users.** Emergency-operations-centre staff of a regional government:

| Persona | Role key | What they do in the product |
|---|---|---|
| EOC operator | `operator` | Watches the 3D map, approves / overrides dispatches, shelters, closures |
| Recovery coordinator | `coordinator` | Compares restoration options, issues and tracks work orders |
| Utility operator | `utility_operator` | Owns grid-isolation rules and utility actions |
| Administrator | `admin` | Configures rules and autonomy levels, everything else |
| Observer | `observer` | Read-only (judges, elected officials) |

**Three pillars.**

1. **Simulate (training).** Launch a flash flood, earthquake, tornado or hurricane on the region's real 3D map. Inject what-ifs: close a bridge, cut a hospital's power, make two incidents compete for one crew. Everything runs in an *exercise* operation; actions are sandboxed and never leave it.
2. **Act (live).** Signals (official alerts, sensors, imagery, field reports, 911 calls) are fused by AI into incidents. Under agency-approved rules the platform dispatches rescue crews, assigns ambulances to triaged calls, activates shelters and publishes confirmed road closures. The utility's own rules can isolate endangered grid sections. Every action is explainable, audited and overridable by an authorized operator.
3. **Restore.** The platform ranks road-clearance and repair options by who regains access to hospitals, shelters and cut-off neighbourhoods. A coordinator turns an option into a work order and tracks it through inspection and reopening.

**Stage demo (the thing we are actually building toward).**

- *Act 1, flash flood.* Warning arrives, creek gauges climb, water rises across the 3D city. Three separate signals are fused into one water-rescue incident and a swift-water crew is auto-dispatched. A 911 medical call is triaged and an ambulance is routed around flooded streets. The utility rule isolates a threatened feeder section. Water recedes; debris has cut a neighbourhood off from its hospital; the platform recommends the one road clearance that restores access; a work order runs to reopening.
- *Act 2, earthquake, same region.* A bridge is damaged and a hospital loses grid power. The same engine now sends *different* crews (the nearest one cannot cross the river), diverts ambulances to a different hospital, and ranks a *different* road first.

**Guiding principle.** Looking impressive on stage beats realism. The simulation core is deterministic and seeded so the demo plays identically every time; AI sits on top of it with cached fallbacks so a network hiccup never breaks the show.

## 2. Architecture

One TypeScript monorepo, one server process, one web app. No microservices, no message broker, no cloud database.

```
Browser (apps/web, Thant)
  React + Vite + TS · Mapbox GL JS v3 (Standard 3D style) + deck.gl overlay
        │ consumes typed hooks only
        ▼
@bastion/client (packages/client, Muste)
  REST client · WebSocket client · zustand world store · mock engine
        │ HTTP /api/*  +  WS /ws
        ▼
@bastion/server (apps/server, Dominic)                      @bastion/intel (packages/intel, Muste)
  Fastify · SQLite · in-memory world per operation   ◄────►  Claude-backed fusion / triage / briefing,
  sim engine → hazards → incidents → decision engine          live feed adapters, public outputs,
  → rules/policy → action pipeline → audit                    mounted as a Fastify plugin
  routing graph · grid model · restoration · work orders
        ▲
        │ loads at boot
data/regions/* , data/scenarios/*  (Muste)        @bastion/shared (packages/shared, Dominic) = the contracts
```

| Concern | Decision |
|---|---|
| Language / runtime | TypeScript everywhere, Node ≥ 22 (team machine has 24), ESM |
| Workspace | pnpm 10 workspaces (`npm install -g pnpm@10`; `corepack enable` needs an administrator terminal on Windows). Internal packages export TS source directly; no build step between packages. Server runs with `tsx`. |
| Frontend | React + Vite. Mapbox GL JS v3 Standard style (3D buildings, terrain, dusk/night light presets, built-in rain) + deck.gl via `MapboxOverlay`. Styling stack is Thant's choice. Fallback map: MapLibre + free tiles if the Mapbox token is a problem. |
| Backend | Fastify 5 + `@fastify/websocket`. Single process holds the live world of each operation in memory and ticks it. |
| Database | SQLite through built-in `node:sqlite` (`DatabaseSync`), plain SQL migrations. Persists users, rules, operations, actions, audit log, work orders. Fallback: `better-sqlite3` (same API shape). World state itself is in memory. |
| Auth | Email + password for seeded demo accounts, JWT bearer (`Authorization: Bearer`, `?token=` on the WebSocket), role + authority in the token, permission guard per route. |
| API style | REST for commands and static data, one WebSocket for world state (`snapshot` then per-tick `patch`). Every payload is a zod schema in `@bastion/shared`. |
| AI | Claude via the Anthropic SDK behind an `LLMProvider` interface. `INTEL_MODE=live|cache|off`. Fast model for fusion and triage, deep model for briefings and narratives. Deterministic rule-based fallback always available. |
| Spatial index | H3 resolution 10 hex cells (about 66 m edge) carry hazard intensity and population. |
| Region | A *region pack* (static JSON) makes the platform configurable per region. Demo pack: **Portland, Oregon** (Johnson Creek flash flood; Willamette bridges for the earthquake). Swappable. |
| State management (web) | Server state only through `@bastion/client` hooks. UI-local state (selection, panels, camera) in Thant's own store. |
| Deployment | One container: Fastify serves the API, the WebSocket and the built web app. Host on Render / Fly / Railway. Demo can always run from a laptop. |
| Tests | Vitest unit tests per package, golden-run determinism tests for the two demo scenarios, Playwright smoke test of both demo journeys. CI: typecheck, lint, test, build. |

**Core runtime loop (server, every tick, default 1 Hz wall-clock, sim speed 1x to 60x):**

1. Scenario runner emits due timeline events (signals, injects, hazard phases, beats).
2. Hazard models update per-cell intensity (flood depth, shaking) and derive damage: flooded or blocked roads, bridge states, facility power.
3. New signals go to `IntelPort.fuse` → incident candidates → incident manager confirms / merges.
4. Decision engine proposes actions (dispatch, ambulance, shelter, closure, grid isolation), each with an explanation and alternatives.
5. Rules engine decides per action: auto-execute, hold for approval, or drop. Executor applies approved actions to the world (sandboxed in exercise mode) and writes the audit log.
6. Units advance along routes; incidents progress; metrics update; restoration analysis recomputes when the road graph changes.
7. The diff since the last tick is broadcast as one `tick` message.

## 3. Repository layout and file ownership

```
/                                   owner
├─ package.json, pnpm-workspace.yaml, pnpm-lock.yaml, tsconfig.base.json     Dominic
├─ .gitignore, .editorconfig, .prettierrc, eslint.config.js, .nvmrc          Dominic
├─ .env.example, Dockerfile, render.yaml, .github/** (CI, CODEOWNERS)        Dominic
├─ docs/plan/**                                                              Dominic
├─ packages/shared/     @bastion/shared   contracts: zod schemas, types      Dominic
├─ apps/server/         @bastion/server   backend                            Dominic
├─ apps/web/            @bastion/web      all UI, map, styling               Thant
├─ packages/client/     @bastion/client   data layer for the web app         Muste
├─ packages/intel/      @bastion/intel    AI, feeds, public outputs          Muste
├─ tools/region-pack/   @bastion/region-pack   OSM → region pack CLI         Muste
├─ data/regions/**      generated region packs (committed)                   Muste
├─ data/scenarios/**    scenario scripts (schema owned by Dominic)           Muste
├─ data/fixtures/**     mock fixtures, cached AI responses                   Muste
├─ e2e/**               Playwright smoke tests                               Muste
└─ docs/demo/**         demo runbook                                         Muste
```

| Shared / hot file | Single owner | Rule |
|---|---|---|
| `packages/shared/**` (all contracts) | Dominic | Additive-only after the contract freeze. Anyone may *request* a change; only Dominic edits. |
| Root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, lint config, CI | Dominic | Request changes. |
| `pnpm-lock.yaml` | Dominic (nominal) | Everyone regenerates it by running `pnpm install`. **Never hand-merge.** On conflict: take `main`'s copy, run `pnpm install`, commit. |
| `apps/web/package.json`, `apps/web/src/main.tsx`, router, global CSS, design tokens, `vite.config.ts`, `index.html` | Thant | Dominic and Muste do not touch `apps/web/**` at all. |
| `packages/client/package.json`, `packages/intel/package.json`, `tools/region-pack/package.json` | Muste | Each package has its own manifest, so adding a dependency never touches another developer's file. |
| `apps/server/package.json`, `apps/server/src/app.ts` (plugin mounting) | Dominic | Muste's intel plugin is mounted by Dominic with one line. |
| `.env.example` | Dominic | Send the variable name and a one-line description. |
| `data/scenarios/*.json` content | Muste | The `Scenario` schema is in `@bastion/shared` (Dominic). |

**Presentation / logic boundary on the frontend.** `apps/web` never calls `fetch` or opens a WebSocket. It imports hooks from `@bastion/client`. `@bastion/client` never imports a component, never contains JSX markup beyond its provider, and never ships CSS.

**Requesting a change outside your boundary.**

1. Post in the team channel: `CHANGE REQUEST → <owner>: <file or contract>, <what>, <why>, <blocking? y/n>`.
2. The owner makes the change on a small branch of their own and merges it, target within 30 minutes when it is blocking.
3. Until it lands, work against a local shim inside your own package (a local type extension, a mock field). Never edit the owner's file "just this once".
4. Breaking contract changes need a thumbs-up from all three before merge.

## 4. Environment variables

| Variable | Used by | Purpose |
|---|---|---|
| `API_PORT` (default 8787), `CORS_ORIGIN` | server | HTTP listen, dev CORS. Deliberately not `PORT`, which dev tools set for the web app. |
| `DATABASE_PATH` (default `./.data/bastion.sqlite`) | server | SQLite file |
| `JWT_SECRET` | server | Token signing |
| `SEED_DEMO_PASSWORD` | server seed | Password for the seeded demo accounts |
| `REGION_ID` (default `portland`) | server | Region pack loaded at boot |
| `ANTHROPIC_API_KEY` | intel | Claude API key |
| `INTEL_MODE` = `live` \| `cache` \| `off` | intel | Call the API, serve cached responses only, or use rule-based fallback |
| `INTEL_MODEL_FAST`, `INTEL_MODEL_DEEP` | intel | Model ids (defaults `claude-sonnet-5-5`, `claude-fable-5-2`) |
| `FEEDS_ENABLED` | intel | Turn real NWS / USGS polling on |
| `VITE_MAPBOX_TOKEN` | web | Mapbox public token |
| `VITE_API_URL`, `VITE_WS_URL` | web → client | Backend location (empty = same origin) |
| `VITE_MOCK` = `1` | web → client | Run entirely on the in-browser mock engine |

Secrets live in a git-ignored `.env`. Never commit a real key.

## 5. Contracts (the agreement all three workstreams build against)

The canonical source is `packages/shared/src` (zod schemas with inferred types), owned by Dominic. This section is the frozen v1 of that package. If the code and this text disagree, the code wins and the discrepancy is reported to Dominic.

Conventions: ids are opaque strings. `simTime` is seconds since scenario T0. Wall-clock timestamps are ISO strings. Coordinates are `[lng, lat]`. Money, units of measure: metres, kph, minutes as named in the field.

### 5.1 Primitives and static region data

```ts
type LngLat = [number, number];
type Mode = 'exercise' | 'live';
type HazardKind = 'flash_flood' | 'earthquake' | 'tornado' | 'hurricane';
type Authority = 'ema' | 'fire_rescue' | 'ems' | 'utility' | 'public_works';
type Role = 'admin' | 'operator' | 'coordinator' | 'utility_operator' | 'observer';

interface User { id: string; name: string; email: string; role: Role; authority: Authority }

interface CameraPose { center: LngLat; zoom: number; pitch: number; bearing: number }

interface RegionConfig {
  id: string; name: string; bbox: [number, number, number, number]; // w,s,e,n
  defaultCamera: CameraPose; hazards: HazardKind[]; h3Resolution: number; population: number;
}
interface RoadNode { id: string; position: LngLat }
interface RoadEdge {
  id: string; from: string; to: string; geometry: LngLat[]; lengthM: number; speedKph: number;
  class: 'motorway' | 'arterial' | 'collector' | 'local'; name?: string; oneway: boolean; bridgeId?: string;
}
interface Bridge { id: string; name: string; edgeIds: string[]; seismicClass: 'retrofitted' | 'standard' | 'vulnerable' }
type FacilityKind = 'hospital' | 'shelter' | 'fire_station' | 'ems_station' | 'eoc' | 'substation' | 'public_works_yard';
interface Facility { id: string; kind: FacilityKind; name: string; position: LngLat; nodeId: string; capacity?: number }
interface Cell { id: string /* H3 index */; center: LngLat; elevM: number; population: number }
interface GridSection {
  id: string; feederId: string; substationId: string; upstreamSectionId: string | null;
  path: LngLat[]; cellIds: string[]; customers: number; criticalFacilityIds: string[];
}
type UnitKind = 'swift_water' | 'usar' | 'engine' | 'als_ambulance' | 'bls_ambulance'
              | 'public_works' | 'utility_crew' | 'police';
interface UnitSeed { id: string; callsign: string; kind: UnitKind; authority: Authority; homeFacilityId: string }

interface RegionStatic {
  config: RegionConfig; nodes: RoadNode[]; edges: RoadEdge[]; bridges: Bridge[];
  facilities: Facility[]; cells: Cell[]; grid: { sections: GridSection[] }; units: UnitSeed[];
}
```

Region pack on disk: `data/regions/<id>/{region,roads,facilities,cells,grid,units}.json`. `roads.json` holds `{ nodes, edges, bridges }`. A tiny synthetic pack `region-mini` ships in `packages/shared/fixtures/` for tests and early mocks.

### 5.2 Dynamic world

```ts
interface Operation {
  id: string; regionId: string; scenarioId: string | null; mode: Mode; name: string;
  status: 'ready' | 'running' | 'paused' | 'ended'; createdBy: string; createdAt: string;
}
interface Clock { simTime: number; speed: number /* 0,1,5,20,60 */; durationSimSec: number | null }

interface HazardState {
  id: string; kind: HazardKind; label: string;
  phase: 'forecast' | 'active' | 'receding' | 'ended';
  epicenter?: LngLat; magnitude?: number; originSimTime?: number;   // earthquake
  track?: LngLat[]; radiusM?: number;                               // tornado / hurricane
  sourcePaths?: LngLat[][];                                         // flood source channels
}
interface CellState { floodDepthM?: number; shakeMMI?: number; windKph?: number }

type RoadStatus = 'open' | 'flooded' | 'blocked' | 'damaged' | 'closed';
interface RoadState { status: RoadStatus; reason?: string; closurePublished: boolean; repairCandidateId?: string }

interface FacilityState {
  status: 'normal' | 'degraded' | 'offline';
  power: 'grid' | 'backup' | 'none'; backupFuelMin?: number;
  activated?: boolean; occupancy?: number;      // shelters
  onDivert?: boolean;                           // hospitals
}

type UnitStatus = 'available' | 'dispatched' | 'en_route' | 'on_scene' | 'transporting' | 'returning' | 'out_of_service';
interface Unit extends UnitSeed {
  position: LngLat; heading: number; status: UnitStatus;
  assignment?: {
    targetType: 'incident' | 'work_order' | 'facility'; targetId: string; destination: LngLat;
    route: LngLat[]; routeEdgeIds: string[]; departedSimTime: number; etaSimTime: number;
  };
}

type SignalSource = 'official_alert' | 'sensor' | 'imagery' | 'field_report' | 'call_911' | 'utility_scada' | 'social';
interface Signal {
  id: string; source: SignalSource; simTime: number; position?: LngLat;
  title: string; body: string; data?: Record<string, unknown>; mediaUrl?: string; reliability: number; // 0..1
}

interface TriageResult {
  acuity: 1 | 2 | 3 | 4 | 5;          // 1 = immediate
  category: string; chiefComplaint: string; recommendedUnit: UnitKind; rationale: string;
}
type IncidentKind = 'water_rescue' | 'medical' | 'structure_collapse' | 'fire' | 'road_blockage'
                  | 'power_hazard' | 'shelter_need' | 'isolated_population';
interface Incident {
  id: string; kind: IncidentKind; title: string; position: LngLat; cellId: string;
  severity: 1 | 2 | 3 | 4 | 5;        // 5 = most severe
  status: 'suspected' | 'confirmed' | 'assigned' | 'in_progress' | 'resolved' | 'closed';
  confidence: number; peopleAffected?: number; triage?: TriageResult; aiSummary?: string;
  sourceSignalIds: string[]; requiredCapabilities: UnitKind[]; assignedUnitIds: string[];
  openedAt: number; resolvedAt?: number;
}
```

### 5.3 Decisions, actions, rules

```ts
type ActionKind = 'dispatch_unit' | 'assign_ambulance' | 'recall_unit' | 'activate_shelter'
                | 'publish_road_closure' | 'isolate_grid_section' | 'restore_grid_section'
                | 'divert_hospital' | 'issue_public_alert' | 'create_work_order';

type ActionPayload =
  | { kind: 'dispatch_unit' | 'assign_ambulance'; unitId: string; incidentId: string; hospitalId?: string }
  | { kind: 'recall_unit'; unitId: string }
  | { kind: 'activate_shelter'; facilityId: string }
  | { kind: 'publish_road_closure'; edgeIds: string[]; reason: string }
  | { kind: 'isolate_grid_section' | 'restore_grid_section'; sectionId: string }
  | { kind: 'divert_hospital'; facilityId: string; toFacilityId?: string }
  | { kind: 'issue_public_alert'; headline: string; body: string; cellIds: string[] }
  | { kind: 'create_work_order'; optionId: string };

interface DecisionExplain {
  headline: string;                                              // "Rescue 3 → Water rescue, ETA 4:10"
  factors: { label: string; value: string; weight?: number }[];
  alternatives: { label: string; score: number; rejectedBecause: string }[];
  confidence: number; narrative?: string;                        // narrative is AI-written, optional
}
type ActionStatus = 'proposed' | 'awaiting_approval' | 'approved' | 'executing' | 'executed'
                  | 'rejected' | 'overridden' | 'failed' | 'expired';
interface Action {
  id: string; operationId: string; kind: ActionKind; authority: Authority; status: ActionStatus;
  payload: ActionPayload; initiator: 'platform' | 'operator'; ruleId?: string;
  explain: DecisionExplain; sandboxed: boolean;                  // true in exercise mode
  proposedAt: number; decidedBy?: string /* userId | 'auto' */; decidedAt?: number; executedAt?: number;
  overrideOf?: string; rejectReason?: string;
}
interface Rule {
  id: string; authority: Authority; name: string; description: string; actionKind: ActionKind;
  autonomy: 'auto' | 'approve' | 'off';
  params: Record<string, number | string | boolean>;             // e.g. { minSeverity: 4, floodDepthM: 0.3 }
  approvedBy: string; updatedAt: string;
}
```

Permission matrix (enforced by the server, mirrored by the UI to enable or disable controls):

| Role | Approve / reject / override actions of authority | Rules | Restoration and work orders | Operations and injects |
|---|---|---|---|---|
| `admin` | all | edit all | yes | yes |
| `operator` | `ema`, `fire_rescue`, `ems` | read | read | yes |
| `coordinator` | `public_works` | read | yes | yes |
| `utility_operator` | `utility` | edit `utility` | read | no |
| `observer` | none | read | read | no |

### 5.4 Restoration and work orders

```ts
interface RepairCandidate {
  id: string; kind: 'debris_clearance' | 'washout_repair' | 'bridge_repair' | 'inspection';
  label: string; edgeIds: string[]; position: LngLat; estCrewHours: number; crewsRequired: number;
}
interface RestorationOption {
  id: string; candidateIds: string[]; label: string; rank: number; score: number; estHours: number;
  impact: {
    hospitalAccessPop: number;        // people regaining a hospital within the access threshold
    shelterAccessPop: number; isolatedPopReconnected: number;
    avgHospitalMinBefore: number | null; avgHospitalMinAfter: number | null;
    facilitiesReconnected: string[];
  };
  rationale: string; narrative?: string;
}
interface RestorationAnalysis {
  computedAt: number; accessThresholdMin: number;
  baseline: { isolatedPop: number; noHospitalAccessPop: number; noShelterAccessPop: number };
  candidates: RepairCandidate[]; options: RestorationOption[]; recommendedOptionId: string | null;
}
interface AccessImpact { optionId: string; cells: { cellId: string; beforeMin: number | null; afterMin: number | null }[] }

type WorkOrderStatus = 'created' | 'assigned' | 'in_progress' | 'inspection' | 'reopened' | 'failed_inspection' | 'cancelled';
interface WorkOrder {
  id: string; operationId: string; optionId: string; candidateId: string; title: string;
  status: WorkOrderStatus; assignedUnitIds: string[]; progress: number; // 0..1
  history: { status: WorkOrderStatus; at: number; by: string }[];
}
```

### 5.5 World snapshot, patches, WebSocket protocol

```ts
interface Metrics {
  peopleAtRisk: number; peopleRescued: number; activeIncidents: number; unitsDeployed: number;
  customersOut: number; roadsClosed: number; sheltersOpen: number; shelterOccupancy: number;
  isolatedPop: number; noHospitalAccessPop: number;
}
interface TimelineEvent {
  id: string; simTime: number; kind: string;          // 'signal.received' | 'incident.opened' | 'action.executed' | ...
  severity: 'info' | 'warn' | 'critical'; title: string; detail?: string; position?: LngLat;
  refs?: { incidentId?: string; actionId?: string; unitId?: string; edgeId?: string; facilityId?: string; sectionId?: string };
}
interface ScenarioBeat {
  id: string; simTime: number; title: string; caption: string;
  camera?: CameraPose & { durationMs: number }; focus?: TimelineEvent['refs'];
}
interface WorldSnapshot {
  operation: Operation; clock: Clock; hazards: HazardState[]; metrics: Metrics;
  cells: Record<string, CellState>;                    // only cells with non-zero hazard
  roads: Record<string, RoadState>;                    // only edges that are not plain 'open'
  facilities: Record<string, FacilityState>; units: Record<string, Unit>;
  incidents: Record<string, Incident>; actions: Record<string, Action>;
  gridSections: Record<string, { status: 'energized' | 'isolated' | 'faulted'; threatened: boolean; customersOut: number }>;
  signals: Signal[];                                   // most recent 200
  timeline: TimelineEvent[];                           // most recent 500
  restoration: RestorationAnalysis | null; workOrders: Record<string, WorkOrder>;
}
// Patch = same keyed collections, upsert semantics. A null value deletes / resets that id.
// `signals` and `timeline` in a patch are appended. Absent key = unchanged.
type WorldPatch = Partial<Omit<WorldSnapshot, 'operation' | 'clock'>> & { operation?: Operation };

type ServerMessage =
  | { t: 'snapshot'; world: WorldSnapshot }
  | { t: 'tick'; clock: Clock; patch: WorldPatch }
  | { t: 'beat'; beat: ScenarioBeat }
  | { t: 'error'; code: string; message: string };
type ClientMessage = { t: 'subscribe'; operationId: string } | { t: 'ping' };
```

WebSocket: `GET /ws?token=<jwt>`. Client sends `subscribe`; server answers with one `snapshot`, then `tick` messages. Clients animate unit motion themselves by interpolating along `assignment.route` between `departedSimTime` and `etaSimTime` using the latest `clock`; the per-tick `position` is the authoritative correction.

### 5.6 Scenarios and injects

```ts
type Inject =
  | { kind: 'set_road_status'; edgeIds: string[]; status: RoadStatus; reason: string; estCrewHours?: number }
  | { kind: 'damage_bridge'; bridgeId: string; severity: 'restricted' | 'closed' | 'collapsed' }
  | { kind: 'facility_power_loss'; facilityId: string; backupFuelMin?: number }
  | { kind: 'facility_offline'; facilityId: string }
  | { kind: 'grid_fault'; sectionId: string }
  | { kind: 'unit_out_of_service'; unitId: string }
  | { kind: 'spawn_incident'; incident: Pick<Incident, 'kind' | 'title' | 'position' | 'severity'> & Partial<Incident> };

type HazardSpec =
  | { id: string; kind: 'flash_flood'; label: string; sourcePaths: LngLat[][]; stageCurve: [number, number][] /* [simTime, stageM] */ }
  | { id: string; kind: 'earthquake'; label: string; epicenter: LngLat; magnitude: number; depthKm: number; originSimTime: number }
  | { id: string; kind: 'tornado' | 'hurricane'; label: string; track: [number, LngLat][]; radiusM: number; peakWindKph: number };

type ScenarioEvent = { at: number } & (
  | { type: 'signal'; signal: Omit<Signal, 'id' | 'simTime'> }
  | { type: 'inject'; inject: Inject }
  | { type: 'hazard_phase'; hazardId: string; phase: HazardState['phase'] });

interface Scenario {
  id: string; name: string; hazard: HazardKind; regionId: string; description: string;
  seed: number; durationSimSec: number; defaultSpeed: number;
  hazards: HazardSpec[]; timeline: ScenarioEvent[]; beats: ScenarioBeat[];
}
```

### 5.7 REST API

All routes are under `/api`, JSON in and out, `Authorization: Bearer <jwt>` unless marked public. Errors: `{ "error": { "code": string, "message": string, "details"?: unknown } }` with 400 (validation), 401, 403, 404, 409 (illegal state transition), 500.

| Method and path | Purpose | Body → response | Owner | Consumer |
|---|---|---|---|---|
| `POST /auth/login` (public) | Sign in | `{email,password}` → `{token,user}` | Dominic | client |
| `GET /auth/me` | Current user | → `User` | Dominic | client |
| `GET /regions/:id/static` | Region pack | → `RegionStatic` | Dominic | client |
| `GET /scenarios` | Scenario catalogue | → `Pick<Scenario,'id'|'name'|'hazard'|'description'|'durationSimSec'>[]` | Dominic | client |
| `POST /operations` | Create an operation | `{regionId,scenarioId,mode,name?}` → `Operation` | Dominic | client |
| `GET /operations/:id` | Full state | → `WorldSnapshot` | Dominic | client |
| `POST /operations/:id/control` | Transport | `{command:'start'|'pause'|'resume'|'reset'|'end'}` or `{command:'speed',speed}` → `Operation` | Dominic | client |
| `POST /operations/:id/injects` | What-if | `Inject` → `{ok:true}` | Dominic | client |
| `POST /operations/:id/actions` | Operator-initiated action | `{payload:ActionPayload}` → `Action` | Dominic | client |
| `POST /actions/:id/approve` | Approve | `{}` → `Action` | Dominic | client |
| `POST /actions/:id/reject` | Reject | `{reason}` → `Action` | Dominic | client |
| `POST /actions/:id/override` | Override (replace or cancel) | `{reason,replacement?:ActionPayload}` → `{overridden:Action,replacement?:Action}` | Dominic | client |
| `GET /rules` · `PATCH /rules/:id` | Rules console | `{autonomy?,params?}` → `Rule` | Dominic | client |
| `POST /operations/:id/restoration/analyze` | Force recompute | → `RestorationAnalysis` | Dominic | client |
| `GET /operations/:id/restoration/options/:optionId/impact` | Per-cell before/after | → `AccessImpact` | Dominic | client |
| `POST /operations/:id/work-orders` | Create from option | `{optionId}` → `WorkOrder` | Dominic | client |
| `POST /work-orders/:id/transition` | Advance lifecycle | `{to:WorkOrderStatus}` → `WorkOrder` | Dominic | client |
| `GET /operations/:id/audit` | Audit trail | → `AuditEntry[]` (`{id,at,simTime,actor,verb,actionId?,detail}`) | Dominic | client |
| `POST /operations/:id/signals` | Submit a field report | `Omit<Signal,'id'|'simTime'>` → `Signal` | Dominic | client |
| `POST /intel/operations/:id/briefing` | AI situation briefing | → `Briefing` | **Muste** | client |
| `POST /intel/operations/:id/copilot` | Ask the copilot | `{question}` → `{answer,refs?}` | **Muste** | client |
| `GET /intel/operations/:id/aar` | After-action report (P2) | → `{markdown}` | **Muste** | client |
| `GET /public/:regionId/closures.geojson` (public) | Published closures feed | → GeoJSON | **Muste** | anyone |
| `GET /public/:regionId/alerts.cap` (public) | CAP alerts feed | → XML | **Muste** | anyone |

### 5.8 Intel port (server ↔ `@bastion/intel`)

```ts
interface IntelContext { operation: Operation; clock: Clock; region: RegionConfig; incidents: Incident[]; hazards: HazardState[]; metrics: Metrics }
interface IncidentCandidate {
  kind: IncidentKind; title: string; position: LngLat; severity: 1|2|3|4|5; confidence: number;
  peopleAffected?: number; summary: string; sourceSignalIds: string[];
  requiredCapabilities: UnitKind[]; mergeWithIncidentId?: string;
}
interface Briefing { generatedAt: number; headline: string; situation: string; priorities: string[]; risks: string[]; recommendedActions: string[] }

interface IntelPort {                       // implemented by Muste, called by Dominic's server
  fuse(signals: Signal[], ctx: IntelContext): Promise<IncidentCandidate[]>;
  triage(call: Signal, ctx: IntelContext): Promise<TriageResult>;
  explain(action: Action, ctx: IntelContext): Promise<string>;
  narrateRestoration(analysis: RestorationAnalysis, ctx: IntelContext): Promise<Record<string, string>>;
}
interface IntelHost {                       // implemented by Dominic, handed to Muste's Fastify plugin
  getWorld(operationId: string): WorldSnapshot | undefined;
  getRegion(regionId: string): RegionStatic;
  ingestSignal(operationId: string, signal: Omit<Signal, 'id' | 'simTime'>): Signal;
  listLiveOperations(): Operation[];
  authenticate: unknown;                    // Fastify preHandler that enforces a valid JWT
}
// @bastion/intel exports:
//   createIntel(config): IntelPort
//   intelPlugin: FastifyPluginAsync<{ host: IntelHost }>   // mounts /api/intel/* and /public/*
```

Rules of the port: every method must resolve within 4 seconds or fall back internally; it must never throw into the tick loop; results are cached by content hash so a replayed scenario is identical. Dominic ships a rule-based `NullIntel` so the server works before `@bastion/intel` exists.

### 5.9 Client data layer (`@bastion/client` → `apps/web`)

```ts
<BastionProvider config={{ apiUrl?: string; wsUrl?: string; mock?: boolean }}>…</BastionProvider>

useSession(): { status: 'anonymous'|'loading'|'authenticated'; user?: User;
                login(email: string, password: string): Promise<void>; logout(): void;
                can(verb: 'approve'|'rules'|'restoration'|'operate', authority?: Authority): boolean }
useRegion(): { region?: RegionStatic; loading: boolean; error?: Error }
useScenarios(): { scenarios: ScenarioSummary[]; loading: boolean }
useOperation(): { operation?: Operation; clock?: Clock; connection: 'idle'|'connecting'|'live'|'reconnecting'|'mock';
                  launch(input: { scenarioId: string; mode: Mode }): Promise<Operation>;
                  control(cmd: 'start'|'pause'|'resume'|'reset'|'end'): Promise<void>;
                  setSpeed(speed: number): Promise<void>; inject(inject: Inject): Promise<void> }
useWorld<T>(selector: (w: WorldSnapshot) => T): T        // escape hatch, memoised
useUnits(): Unit[]            useIncidents(): Incident[]      useSignals(): Signal[]
useActions(): Action[]        useTimeline(): TimelineEvent[]  useMetrics(): Metrics
useCells(): Record<string, CellState>                         useRoadStates(): Record<string, RoadState>
useFacilityStates(): Record<string, FacilityState>            useGridSections(): WorldSnapshot['gridSections']
useHazards(): HazardState[]   useRestoration(): RestorationAnalysis | null   useWorkOrders(): WorkOrder[]
useBeat(): ScenarioBeat | null                                // latest beat; also onBeat(cb)
useActionCommands(): { approve(id): Promise<void>; reject(id, reason): Promise<void>;
                       override(id, reason, replacement?: ActionPayload): Promise<void>;
                       create(payload: ActionPayload): Promise<void> }
useRestorationCommands(): { analyze(): Promise<void>; loadImpact(optionId): Promise<AccessImpact>;
                            createWorkOrder(optionId): Promise<WorkOrder>;
                            transition(workOrderId, to: WorkOrderStatus): Promise<void> }
useRules(): { rules: Rule[]; update(id, patch): Promise<void> }
useBriefing(): { briefing?: Briefing; loading: boolean; refresh(): Promise<void> }
useCopilot(): { ask(question: string): Promise<string>; history: { q: string; a: string }[] }
useDemoDirector(): { steps: DemoStep[]; current: number; next(): void; goto(i: number): void; reset(): void }
// pure helpers
unitPositionAt(unit: Unit, clock: Clock, nowMs: number): { position: LngLat; heading: number }
simTimeNow(clock: Clock, nowMs: number): number
```

With `mock: true` (or `VITE_MOCK=1`) every hook works with no server: the mock engine plays both demo scenarios against the region pack and honours every command.

---

# YOUR WORK

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

---

## GitHub collaboration protocol (mandatory for all three developers and their Claude sessions)

**Workspaces.** One clone per developer. If two sessions ever share a machine, use separate clones or `git worktree`; never let two sessions write to the same working directory.

**Main is always demo-able.** Nobody develops on `main`. The only commits made directly on `main` are Dominic's initial bootstrap (DOM-001), because the repository does not exist before it.

**Branches.** Short-lived, one per task, cut from the latest `main`:

```
feat/dominic-<feature>     e.g. feat/dominic-routing
feat/thant-<feature>       e.g. feat/thant-map-scene
feat/muste-<feature>       e.g. feat/muste-signal-fusion
```

Use the branch name given in each task. A branch lives hours, not days. No personal mega-branch.

**Starting a task.**

```bash
git switch main
git pull origin main
git switch -c feat/<you>-<feature>
pnpm install
```

**Commits: small, atomic, conventional. This is not optional.**

- One logical step per commit: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, `style:`, `perf:`.
- A task is several commits (each task lists suggested milestones). Never one giant commit at the end.
- Before every commit run `git status` and `git diff --staged`. Stage explicit paths (`git add apps/web/src/map`). **Never `git add -A` or `git add .`** when anything outside your ownership shows as changed.
- A commit must typecheck. Do not commit generated junk, `.env`, `.data/`, `node_modules`, or build output.
- No drive-by refactors or reformatting of files you were not asked to change.

**Staying current.** Sync by merging, never by rewriting history:

```bash
git fetch origin
git merge origin/main
```

No force-push, on any branch, ever. No `git reset --hard` on pushed work. No rebasing pushed branches.

**Lockfile.** If `pnpm-lock.yaml` conflicts: `git checkout origin/main -- pnpm-lock.yaml`, then `pnpm install`, then commit the result. Never edit it by hand.

**Pull requests.** Every task merges through a PR into `main`. Keep it small (aim for under about 400 changed lines excluding data and lockfile). The description states:

- What was implemented, with task id(s) in the title, for example `DOM-005: road graph and routing service`.
- Files and areas touched.
- How it was tested (commands run and their result).
- Configuration or environment changes.
- Known limitations.
- What other developers need to do to integrate.

**Merging.**

- CI must be green: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- If the PR touches only paths you own, you merge it yourself once CI passes. Do not wait for a reviewer; waiting is how hackathons die.
- If it touches anything owned by someone else (it should not), that owner must approve. `CODEOWNERS` enforces this.
- Use a normal merge commit (not squash) so the atomic commits survive. Delete the branch after merging.
- Never bypass failing checks or resolve a conflict by discarding someone else's side.

**Conflicts.** If a conflict appears in a file you do not own, stop and ping the owner; do not guess. If it is in your own file, resolve it, rerun the checks, commit.

**Shared files and contracts.** See the ownership table: one owner per shared file, change requests go to the owner, contracts are additive-only after the freeze.

**After every merge to `main`**, the person who merged pulls `main`, runs `pnpm install && pnpm dev`, and confirms the app still boots and the mock demo still plays. If `main` is broken, fixing it is the top priority for whoever broke it.

---

## Integration expectations (Thant)

- **M0, contract freeze.** Dominic lands the workspace and `@bastion/shared`. You branch and start THA-001.
- **Mock v0 (first hours).** Muste lands `@bastion/client` with the mock engine. Delete your throwaway mocks and switch to the hooks.
- **M1, walking skeleton.** The same UI runs against the real server with `pnpm dev`. You change nothing: the provider config decides mock or live. If something differs between mock and live, report it to Muste (hook or mock problem) or Dominic (server data problem); do not patch around it in components.
- **M2, flood vertical slice** and **M3, restoration and earthquake.** Sit with the other two for ten minutes after each, play the scenario, list visual defects, fix them before starting the next task.
- **M4, feature freeze.** Only polish and fixes afterwards.
- **M5, demo lock.** Rehearse on the actual display resolution.

When you need data that does not exist (a new field, a new selector, a camera cue in a scenario): change request to Dominic (contract or server), to Muste (hook, mock, scenario content). Describe the visual purpose; they decide the shape.

## Your first actions

1. Read this brief once, fully. Confirm with Thant whether to follow the recommended visual direction or a variation; capture the decision in `apps/web/src/design/README.md`.
2. Wait for Dominic's announcement that the repository and contracts are on `main` (DOM-001, DOM-002). While waiting: gather references, choose fonts and the semantic colour ramps, obtain a Mapbox public token and put it in your local `.env` as `VITE_MAPBOX_TOKEN` (never commit it).
3. Clone, `npm install -g pnpm@10`, `pnpm install`, `pnpm dev:mock`.
4. THA-001 on `feat/thant-design-system`, committing at each listed milestone; PR; merge when CI is green.
5. Continue in the stated order. One task per branch, one PR per task.
6. At the end of each task, report what was built, how it was checked (viewports, scenarios, frame rate), and any change requests raised.

# BASTION — MASTER DEVELOPMENT PLAN

Regional Disaster Operations Platform · three developers: Dominic (architecture and backend), Thant (UI/UX and frontend), Muste (features and integrations).

Planning document only. No application code exists yet. Developer prompts: `PROMPT_A_DOMINIC.md`, `PROMPT_B_THANT.md`, `PROMPT_C_MUSTE.md` in this folder.

# PART 1 · APPLICATION UNDERSTANDING

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


### Essential versus optional

| Essential for the stage demo | Makes it complete | Optional |
|---|---|---|
| Real 3D city map with hazard, unit, incident, closure and grid layers | Rules console with live autonomy changes | Hurricane hazard |
| Flash-flood and earthquake scenarios, deterministic | What-if inject tools on the map | Rewind / seek |
| AI fusion of signals into incidents; 911 triage | AI briefing and copilot | After-action report |
| Explainable dispatch and ambulance assignment that reacts to bridge and hospital status | Tornado hazard | Field reports with photo analysis |
| Rules, approval, override, audit; exercise sandbox | Real NWS / USGS feeds in live mode | Public closure map page |
| Utility-owned grid isolation | Public closure and CAP feeds | Landing page |
| Restoration ranking by access regained; work orders through to reopening | Deployment to a public URL, E2E smoke tests, demo director | |
| Sign-in with roles | Responsive and accessibility pass | |

### Assumptions (labelled, because the brief left them open)

| # | Assumption | If wrong |
|---|---|---|
| A1 | No existing repository: the working folder is empty and not a git repo. Everything is built from scratch. | n/a (verified) |
| A2 | Hackathon length about 48 hours. Milestones are given as hours from start; scale proportionally. | Cut P1 from the bottom, keep the milestone order. |
| A3 | No mandated stack. TypeScript monorepo chosen for shared types and speed. | If a platform is mandated (the folder name suggests a Kiro event), the plan and briefs transfer as-is; they can be dropped into steering / spec files. |
| A4 | Demo region is Portland, Oregon, because one map can host both a creek flash flood and a bridge-breaking earthquake. Region is a data pack, so it is swappable. | Change the bounding box in MUS-003; nothing else moves. |
| A5 | A free Mapbox token and an Anthropic API key are obtainable. | MapLibre fallback; `INTEL_MODE=off` rule-based fallback. |
| A6 | "Real emergency" side is demonstrated with simulated connectors (dispatch, SCADA, alerting write to an outbox) plus real read-only public feeds. No real agency systems are contacted. | n/a |
| A7 | Hazard and grid models are plausible, not validated engineering models; grid topology is synthetic. Stated openly if judges ask. | n/a |
| A8 | Each developer drives their own Claude Code session in their own clone. | Use git worktrees on a shared machine. |

# PART 2 · TECHNICAL ARCHITECTURE

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

Region pack on disk: `data/regions/<id>/{region,roads,facilities,cells,grid,units}.json`. `roads.json` holds `{ nodes, edges, bridges }`. A tiny synthetic region and a five-minute scenario ship as test fixtures for tests and early mocks: `import { loadRegionMini, loadScenarioMini, MINI } from '@bastion/shared/fixtures'` (`MINI` holds the stable ids of its bridges, facilities, grid sections and units).

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
interface RoadState {
  status: RoadStatus; reason?: string; closurePublished: boolean; repairCandidateId?: string;
  speedFactor?: number; // v1.1: a non-open edge that is still passable at this fraction of normal speed
}

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
// Patch = the diff since the previous tick. Absent key = unchanged.
// Keyed collections are upserts: each entry is the COMPLETE new value of that entity (no field
// merging) and `null` removes the id. `signals` and `timeline` are appended (capped at 200 / 500).
// `hazards`, `metrics`, `operation` replace. `restoration: null` clears the analysis.
// The reference implementation is exported: applyWorldPatch(world, patch, clock) -> WorldSnapshot.
// Also exported: makeEmptyWorld(operation) and makeInitialWorld(operation, region) (units at home,
// facilities normal, grid energized).
type WorldPatch = Partial<{
  operation: Operation; hazards: HazardState[]; metrics: Metrics;
  cells: Record<string, CellState | null>; roads: Record<string, RoadState | null>;
  facilities: Record<string, FacilityState | null>; units: Record<string, Unit | null>;
  incidents: Record<string, Incident | null>; actions: Record<string, Action | null>;
  gridSections: Record<string, GridSectionState | null>; workOrders: Record<string, WorkOrder | null>;
  signals: Signal[]; timeline: TimelineEvent[]; restoration: RestorationAnalysis | null;
}>;

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

All routes are under `/api`, JSON in and out, `Authorization: Bearer <jwt>` unless marked public. Errors: `{ "error": { "code": string, "message": string, "details"?: unknown } }` with 400 (validation), 401, 403, 404, 409 (illegal state transition), 500. Every path below is available as a builder in `apiPaths` from `@bastion/shared` (for example `apiPaths.operationControl(id)`); use it on both sides instead of string literals. Request bodies have schemas too (`LoginRequestSchema`, `ControlRequestSchema`, `OverrideActionRequestSchema`, …).

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

# PART 3 · MVP FEATURE LIST

**P0, critical (the stage demo fails without it)**

1. Monorepo, contracts, CI (DOM-001, 002).
2. Server foundation, auth and roles (DOM-003, 004; THA-012).
3. Region pack for Portland and the road graph with live routing (MUS-003; DOM-005).
4. Simulation engine, operations in exercise / live mode, WebSocket streaming (DOM-006, 007; MUS-001, 009).
5. Flood and earthquake hazard models with damage (DOM-008).
6. AI signal fusion and 911 triage with safe fallbacks (MUS-004, 005, 006; DOM-009).
7. Explainable dispatch and EMS assignment (DOM-010).
8. Rules engine, approval, override, audit, shelters, closures (DOM-011).
9. Utility grid isolation (DOM-012).
10. Restoration ranking and work orders (DOM-013, 014).
11. The two demo scenarios (MUS-007, 008) and the in-browser mock engine (MUS-002).
12. The whole operations UI: design system, shell, 3D scene, region / hazard / ops layers, launcher and timeline, action stream, context drawer, restoration view, status and beats (THA-001 to 011).

**P1, important (completeness and polish)**

Rules administration (DOM-015, THA-013) · what-if injects UI (THA-014) · briefing and copilot (MUS-010, THA-015) · live NWS / USGS feeds (MUS-011) · public outputs (MUS-012) · deployment (DOM-016) · golden-run tests (DOM-017) · tornado (DOM-018) · demo director and runbook (MUS-013) · E2E smoke (MUS-014) · states, responsive, accessibility (THA-016) · demo polish (THA-017).

**P2, optional (drop without regret)**

Hurricane (DOM-019) · rewind and export (DOM-020) · after-action report (MUS-015) · photo field reports (MUS-016) · extra scenarios (MUS-017) · visual extensions (THA-018).

**If we fall behind, simplify in this order:** (1) drop all P2; (2) drop tornado, live feeds, public outputs, copilot; (3) replace the dispatch optimiser with nearest-reachable-capable-unit while keeping the explanation card; (4) force more of each scenario through injects instead of emergent behaviour; (5) as a last resort run the stage demo on the mock engine, which is why MUS-002 is P0.

# PART 4 · THREE-DEVELOPER RESPONSIBILITY MATRIX

| Area | Dominic (me) | Thant | Muste |
|---|---|---|---|
| Architecture, contracts, repo, CI | **Owns** | consumes | consumes |
| Database, auth, permissions | **Owns** | mirrors gating in UI | `can()` in client |
| Simulation engine, hazard models | **Owns** | visualises | supplies scenarios |
| Road graph, routing | **Owns** | draws routes | supplies graph data |
| Dispatch / EMS decision engine | **Owns** | decision cards | narratives |
| Rules, action pipeline, audit | **Owns** | action stream, rules console | hooks |
| Grid model and isolation | **Owns** | grid layers and panel | synthetic grid data |
| Restoration and work orders | **Owns** | restoration view | narratives, hooks |
| WebSocket and REST server | **Owns** | none | client transport |
| Visual direction, design system | none | **Owns** | none |
| Pages, layout, components, animation | none | **Owns** | none |
| 3D map scene and every layer | none | **Owns** | none |
| Client data layer and mock engine | none | consumes | **Owns** |
| AI: fusion, triage, briefing, copilot | port definition, fallback stub | panels | **Owns** |
| External feeds and public outputs | mounts plugin | optional public page | **Owns** |
| Region data pipeline and packs | loader | renders | **Owns** |
| Scenario scripts, beats, camera cues | schema and runner | renders beats | **Owns** |
| Demo director, runbook, E2E | golden runs | presentation mode | **Owns** |
| Deployment | **Owns** | build config of web | smoke check |

**Why it is split this way.**

- **Dominic takes the long, coupled backend chain** (engine → hazards → incidents → decisions → rules → grid → restoration → work orders). These modules share one in-memory world and one tick loop; splitting them between people would mean constant edits to the same files. Fourteen of my twenty tasks are P0 and I am the critical path, which is deliberate: it is the part that needs one architectural head.
- **Thant owns a whole application directory**, not a slice of files inside shared ones. The UI is judged first and hardest, so it gets a full-time owner who is never blocked: every screen is built against the mock engine. Twelve P0 tasks, all independent of backend progress.
- **Muste owns four self-contained packages**, each a real feature with its own manifest: the data layer that decouples Thant from me, the AI that is our headline claim, the data pipeline and screenplay that everything else renders, and the demo safety net. None of them requires editing a file owned by someone else. Nine P0 tasks, three of which can start in parallel in the first minute after the contract freeze.
- Balance is by complexity and risk, not count: Dominic 20 tasks (6 Large), Thant 18 (5 Large), Muste 17 (4 Large).

# PART 5 · COMPLETE DEVELOPMENT TASK BACKLOG

Every task lists owner, priority, complexity, branch, dependencies, objective, implementation, files, acceptance criteria, tests and commit milestones. 55 tasks: 35 P0, 14 P1, 6 P2.

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
**Acceptance.** Fresh clone: `npm install -g pnpm@10 && pnpm install && pnpm dev` shows the placeholder page and `GET /api/health` returns `{ok:true}`. CI is green on `main`. CODEOWNERS routes each path to the right person.
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

**Objective.** One URL the judges can open, and a one-command local production run. **Implementation.** Multi-stage `Dockerfile` (build web, run server with `tsx`), server serves `apps/web/dist` with SPA fallback, `render.yaml` (or Fly config) with a persistent disk for SQLite, health check, WebSocket verified through the host's proxy, `pnpm start:prod`. The container start command maps the host's injected `PORT` to `API_PORT`. Admin-only `POST /api/admin/demo-reset` that ends all operations and reseeds. **Files.** `Dockerfile`, `render.yaml`, `apps/server/src/static.ts`, `apps/server/src/routes/admin.ts`. **Acceptance.** Deployed URL plays the flood scenario end to end; cold start under 20 s; local `docker run` works offline except for map tiles. **Tests.** Smoke script hitting health, login, create operation, WebSocket snapshot. **Commits.** `feat(server): serve built web app` → `chore: dockerfile and deploy config` → `feat(admin): demo reset endpoint` → `test: deployment smoke script`

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

# PART 6 · FILE OWNERSHIP MATRIX

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


### Conflict hotspots and how each is defused

| Hotspot | Why it is risky | Defusal |
|---|---|---|
| `pnpm-lock.yaml` | Everyone adds dependencies | Per-package manifests; never hand-merge; take `main` and reinstall. |
| `packages/shared` | Everyone wants "one more field" | Single owner, additive-only, 30-minute change-request turnaround. |
| `apps/web` data fetching | UI and data logic tend to mix | No `fetch` in `apps/web`; hooks only; Muste never writes JSX. |
| `apps/server/src/app.ts` | Muste's routes need mounting | Muste ships a Fastify plugin; Dominic mounts it once. |
| Scenario files vs engine behaviour | Tuning happens on both sides | Content (timings, ids, text) is Muste's; behaviour (thresholds, models) is Dominic's; thresholds are exposed as scenario or rule params so tuning stays in Muste's files. |
| `data-testid` for E2E | Tests need hooks into Thant's markup | Muste requests ids; Thant adds them. |
| Root scripts and CI | New commands (`demo:check`, e2e job) | Requested from Dominic; package-level scripts stay with the package owner. |
| `.env.example` | New variables | Requested from Dominic. |

# PART 7 · DEPENDENCIES & PARALLEL EXECUTION

**Contracts that must exist first:** everything in `packages/shared` (DOM-002). That is the only hard gate for the whole team, and it is the first thing I build. Until it is on `main`, Thant and Muste do no-repo preparation (tokens, API keys, references, bounding box, Overpass queries).

**First tasks, immediately after the contract freeze:**

| Developer | Starts | In parallel if capacity allows |
|---|---|---|
| Dominic | DOM-003 server foundation | then DOM-004 and DOM-005 |
| Thant | THA-001 design system | THA-012 sign-in |
| Muste | MUS-001 client core with mock v0 | MUS-003 region pack, MUS-004 intel foundation |

**Dependency matrix (cross-developer dependencies only; everything else is internal to one person).**

| Task | Needs from another developer | Can it be mocked meanwhile? |
|---|---|---|
| All THA tasks | `@bastion/client` hooks (MUS-001) | Yes: `region-mini` + local mock until mock v0, then mock engine |
| THA-004 and later, on real geography | Portland pack (MUS-003) | Yes: `region-mini` |
| THA-015 | MUS-010 | Yes: mock responses |
| MUS-001, 003, 004 | DOM-002 only | n/a, independent |
| MUS-009 | DOM-007 (M1) | Yes: mock transport |
| MUS-007, 008 played for real | DOM-006, 008, 010, 013 | Yes: authored and rehearsed on the mock engine |
| MUS-010, 011 | plugin mounted (DOM-009) | Yes: unit tests with fake host |
| MUS-012 | outbox / action data (DOM-011) | Yes: fixtures |
| MUS-014 | M2, M3; `data-testid` from Thant | No (integration by nature) |
| DOM-005 and later, on real data | Portland pack (MUS-003) | Yes: `region-mini` |
| DOM-009 | `IntelPort` implementation (MUS-004 to 006) | Yes: `NullIntel` |
| DOM-017 | real scenarios (MUS-007, 008) | Partly: `scenario-mini` |

**Fully independent from hour one:** THA-001, 002, 003, 012 · MUS-001, 003, 004 · DOM-003, 004, 005.

**Critical path:** DOM-001 → 002 → 003 → 005 → 006 → 007 → 008 → 009 → 010 → 011 → 012 → 013 → 014, joined by MUS-003 → MUS-007 → MUS-008 for real content. Thant is deliberately off the critical path. Nobody is ever blocked on me: the mock engine carries the UI, `region-mini` and `NullIntel` carry the backend, and the scenarios are authored against the mock.

**Execution sequence (hours for a 48-hour event).**

| Window | Dominic | Thant | Muste |
|---|---|---|---|
| 0–2 h | DOM-001, 002 → **M0** | prep: references, fonts, Mapbox token | prep: API key, bbox, Overpass queries |
| 2–8 h | DOM-003, 004, 005 | THA-001, 002, start 003 | MUS-001 → **mock v0**, start MUS-003 |
| 8–14 h | DOM-006, 007 → **M1** | THA-003, 004, 006 | MUS-003, 004, MUS-009 |
| 14–24 h | DOM-008, 009, 010 | THA-005, 007, 008 | MUS-002, 005, 006, MUS-007 |
| 24–30 h | DOM-011, 012 → **M2** | THA-009, 011, 012 | MUS-007 tuning, MUS-008 |
| 30–36 h | DOM-013, 014 → **M3** | THA-010 | MUS-008 tuning, MUS-010 |
| 36–42 h | DOM-015, 016, 018 | THA-013, 014, 015, 016 | MUS-011, 012, 013, 014 → **M4** |
| 42–48 h | DOM-017, fixes | THA-017, fixes | rehearsal, cache warm, backup video → **M5** |

# PART 8 · GITHUB COLLABORATION PROTOCOL

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

# PART 9 · INTEGRATION MILESTONES

Integration is continuous: every task merges to `main` when green. The milestones below are the moments all three sit together for ten minutes, run the real app, and write down what is broken.

| Milestone | When (48 h) | What must be true | Who verifies |
|---|---|---|---|
| **M0 Contract freeze** | 2 h | Repo on GitHub, CI green, `@bastion/shared` complete, `region-mini` fixture available | Dominic |
| **Mock v0** | about 6 h | `pnpm dev:mock` shows moving units through real hooks | Muste hands to Thant |
| **M1 Walking skeleton** | 14 h | Sign in → launch `scenario-mini` → real server streams over WebSocket → units move on the 3D map. Same UI works in mock and live. | All three; Muste owns client ↔ server fit |
| **M2 Flood vertical slice** | 30 h | Portland pack, flood scenario on the real engine: water, fused incident, auto-dispatch, triaged ambulance, grid isolation, shelter, closures, action stream with approve / override | All three; Dominic owns behaviour, Muste content, Thant visuals |
| **M3 Restoration and earthquake** | 36 h | Restoration options, work order to reopening; earthquake scenario with different crew, hospital and top road | All three |
| **M4 Feature freeze** | 42 h | P1s that made it are merged; deployed URL works; E2E smoke green; AI caches committed | Dominic (deploy), Muste (E2E) |
| **M5 Demo lock** | 46 h | Golden runs green; three clean rehearsals from the runbook on the demo machine and display; backup video recorded; `main` tagged `demo` | Muste runs, all watch |

**Integration ownership.**

- Frontend ↔ backend fit is Muste's (`@bastion/client` is the seam). Thant reports a symptom; Muste decides whether it is a hook, a mock or a server issue and routes it.
- Contract questions are Dominic's. Answer within 30 minutes, additive only.
- Each developer validates their own PR (checks green, app boots, mock demo plays) and merges it themselves when it touches only their own paths. Dominic does not gatekeep merges.
- Merge conflicts are resolved by the owner of the conflicting file. A conflict in someone else's file means stop and ask.
- Order of integration: contracts → client + mock → server streaming → hazards and ops → AI → restoration → second scenario → deployment → rehearsal.

# PART 10 · RISKS & FALLBACK STRATEGIES

| # | Risk | Likelihood / impact | Mitigation | Fallback |
|---|---|---|---|---|
| R1 | Dominic's backend chain is long and sequential; a slip delays M2 and M3 | High / High | Tasks ordered so a demo-able slice exists after each; `region-mini` and `scenario-mini` for fast tests; scenario injects can force outcomes | Stage demo on the mock engine (MUS-002), which mirrors both acts |
| R2 | 3D scene performance (8k cells, 10k+ edges, 30 units, buildings) | Medium / High | Performance budget in THA-003; cells patched only on change; client-side interpolation; deck.gl instancing | Lower cell resolution, hide local roads, reduce building extrusion |
| R3 | Venue network: map tiles, API calls | Medium / High | Region pack, scenarios and AI cache are committed; `INTEL_MODE=cache`; browser tile cache pre-warmed by a rehearsal on the demo machine | Phone hotspot; backup video |
| R4 | LLM latency or malformed output on stage | Medium / High | 4 s timeout, schema validation, cache keyed by content hash, rule-based fallback | `INTEL_MODE=cache` for the pitch by default |
| R5 | OSM / elevation pipeline takes too long | Medium / Medium | Time-box to about 2 hours beyond the estimate | Hand-curated arterial graph, elevation from distance to water |
| R6 | Non-determinism makes the demo vary | Medium / High | Seeded PRNG, fixed sim step, forced injects, golden-run tests (DOM-017) | Record the good run and replay it through the mock transport |
| R7 | Merge conflicts and broken `main` | Medium / Medium | Package-level ownership, CODEOWNERS, small PRs, CI gate, post-merge boot check | Revert the offending merge commit immediately, fix on a branch |
| R8 | Contract drift between mock and server | Medium / Medium | zod validation of every message on both sides in dev; record-and-replay of real runs into the mock | Server is the truth; regenerate fixtures |
| R9 | Mapbox token limits or licensing concerns | Low / Medium | Free tier is ample for a hackathon | MapLibre + free tiles, deck.gl extrusions |
| R10 | WebSocket blocked by the deployment proxy | Low / Medium | Verified in DOM-016 on the chosen host | Run locally for the pitch; deployed URL is for judges afterwards |
| R11 | Scope creep toward realism | High / Medium | "Plausible and tunable" rule; P2 list is explicit | Cut order in Part 3 |
| R12 | `node:sqlite` unavailable on a teammate's Node | Low / Low | `.nvmrc` pins Node 22+ | Swap to `better-sqlite3` behind the same repository functions |
| R13 | AI decision support mistaken for certified triage or engineering | Low / Medium | UI disclaimer string; humans can override everything; assumptions stated | n/a |

# PART 11 · THREE INDEPENDENT CLAUDE CODE PROMPTS

Each prompt is a separate, self-contained file. It embeds the application overview, architecture, ownership table, the full contracts and the Git protocol, so the receiving session needs nothing else. Open the file, copy all of it, paste it as the first message of that developer's Claude Code session.

| Prompt | File | Paste into |
|---|---|---|
| **PROMPT A: DOMINIC** — Backend & Architecture Implementation | `docs/plan/PROMPT_A_DOMINIC.md` | Dominic's session |
| **PROMPT B: THANT** — UI/UX & Frontend Implementation | `docs/plan/PROMPT_B_THANT.md` | Thant's session |
| **PROMPT C: MUSTE** — Features & Integrations Implementation | `docs/plan/PROMPT_C_MUSTE.md` | Muste's session |

The prompts are generated from the same source fragments as this document (`docs/plan/_src`, rebuilt with `bash docs/plan/_src/build.sh`), so the contracts and task ids cannot diverge between them.

# PART 12 · MASTER DEVELOPMENT CHECKLIST

Status legend: ☐ not started · ◐ in progress · ☑ merged to `main`.

| Status | ID | Task | Owner | Pri | Depends on | Milestone |
|---|---|---|---|---|---|---|
| ☐ | DOM-001 | Repository bootstrap and workspace scaffold | Dominic | P0 | none | M0 |
| ☐ | DOM-002 | Shared contracts package | Dominic | P0 | DOM-001 | M0 |
| ☐ | DOM-003 | Server foundation, DB schema, seed | Dominic | P0 | DOM-002 | M1 |
| ☐ | DOM-004 | Authentication and RBAC | Dominic | P0 | DOM-003 | M1 |
| ☐ | DOM-005 | Region loader, road graph, routing | Dominic | P0 | DOM-002 | M1 |
| ☐ | DOM-006 | World state, operations, sim engine | Dominic | P0 | DOM-003, 005 | M1 |
| ☐ | DOM-007 | Realtime WebSocket hub | Dominic | P0 | DOM-004, 006 | M1 |
| ☐ | DOM-008 | Hazard models: flood, earthquake, damage | Dominic | P0 | DOM-006 | M2 |
| ☐ | DOM-009 | Signals → incidents, unit movement, metrics | Dominic | P0 | DOM-006 | M2 |
| ☐ | DOM-010 | Dispatch and EMS decision engine | Dominic | P0 | DOM-005, 009 | M2 |
| ☐ | DOM-011 | Rules engine and action pipeline | Dominic | P0 | DOM-004, 010 | M2 |
| ☐ | DOM-012 | Grid model and utility isolation | Dominic | P0 | DOM-008, 011 | M2 |
| ☐ | DOM-013 | Restoration prioritization engine | Dominic | P0 | DOM-005, 008 | M3 |
| ☐ | DOM-014 | Work orders | Dominic | P0 | DOM-011, 013 | M3 |
| ☐ | DOM-015 | Rules administration, inject hardening | Dominic | P1 | DOM-011 | M4 |
| ☐ | DOM-016 | Deployment | Dominic | P1 | M2 | M4 |
| ☐ | DOM-017 | Golden-run determinism and perf tests | Dominic | P1 | MUS-007, 008 | M5 |
| ☐ | DOM-018 | Tornado hazard model | Dominic | P1 | DOM-008 | M4 |
| ☐ | DOM-019 | Hurricane hazard model | Dominic | P2 | DOM-018 | after M4 |
| ☐ | DOM-020 | Operation recording, rewind, export | Dominic | P2 | DOM-007 | after M4 |
| ☐ | THA-001 | Visual direction and design system | Thant | P0 | DOM-001 | M1 |
| ☐ | THA-002 | App shell, routing, mode theming | Thant | P0 | THA-001 | M1 |
| ☐ | THA-003 | 3D map scene foundation | Thant | P0 | THA-002 | M1 |
| ☐ | THA-004 | Static region layers | Thant | P0 | THA-003 | M2 |
| ☐ | THA-005 | Hazard layers: flood and earthquake | Thant | P0 | THA-003 | M2 |
| ☐ | THA-006 | Live operations layers | Thant | P0 | THA-003 | M2 |
| ☐ | THA-007 | Scenario launcher, transport, timeline | Thant | P0 | THA-002 | M2 |
| ☐ | THA-008 | Action stream and decision cards | Thant | P0 | THA-002 | M2 |
| ☐ | THA-009 | Context drawer: incidents, units, facilities, signals | Thant | P0 | THA-002 | M2 |
| ☐ | THA-010 | Restoration view and work orders | Thant | P0 | THA-002, 003 | M3 |
| ☐ | THA-011 | Status strip, metrics, beats, camera | Thant | P0 | THA-003 | M2 |
| ☐ | THA-012 | Sign-in screen and persona switch | Thant | P0 | THA-001 | M1 |
| ☐ | THA-013 | Utility panel and rules console | Thant | P1 | THA-008 | M4 |
| ☐ | THA-014 | What-if inject tools | Thant | P1 | THA-006 | M4 |
| ☐ | THA-015 | AI briefing and copilot panel | Thant | P1 | THA-002, MUS-010 | M4 |
| ☐ | THA-016 | States, responsiveness, accessibility | Thant | P1 | THA-007 to 011 | M4 |
| ☐ | THA-017 | Demo polish | Thant | P1 | M3 | M5 |
| ☐ | THA-018 | Optional visual extensions | Thant | P2 | DOM-018, MUS-012/015/017 | after M4 |
| ☐ | MUS-001 | Client core with mock v0 | Muste | P0 | DOM-002 | Mock v0 |
| ☐ | MUS-002 | Mock engine: both scenarios | Muste | P0 | MUS-001 | M2 |
| ☐ | MUS-003 | Region pack builder and Portland pack | Muste | P0 | DOM-002 | M2 |
| ☐ | MUS-004 | Intel foundation: provider, cache, fallback, plugin | Muste | P0 | DOM-002 | M2 |
| ☐ | MUS-005 | Signal fusion | Muste | P0 | MUS-004 | M2 |
| ☐ | MUS-006 | 911 call triage | Muste | P0 | MUS-004 | M2 |
| ☐ | MUS-007 | Flash-flood demo scenario | Muste | P0 | MUS-003; DOM-006, 008 | M2 |
| ☐ | MUS-008 | Earthquake demo scenario | Muste | P0 | MUS-003, 007; DOM-008, 010, 013 | M3 |
| ☐ | MUS-009 | Live transport integration and hardening | Muste | P0 | MUS-001, DOM-007 | M1 |
| ☐ | MUS-010 | Briefing, narratives, copilot | Muste | P1 | MUS-004, DOM-009 | M4 |
| ☐ | MUS-011 | Live feed adapters (NWS, USGS) | Muste | P1 | MUS-004, DOM-009 | M4 |
| ☐ | MUS-012 | Public outputs and connector formatters | Muste | P1 | MUS-004, DOM-011 | M4 |
| ☐ | MUS-013 | Demo director and runbook | Muste | P1 | MUS-007, 008, 009 | M5 |
| ☐ | MUS-014 | End-to-end smoke tests | Muste | P1 | M2, M3 | M4 |
| ☐ | MUS-015 | After-action report | Muste | P2 | MUS-010 | after M4 |
| ☐ | MUS-016 | Field report intake with image understanding | Muste | P2 | MUS-005 | after M4 |
| ☐ | MUS-017 | Tornado and hurricane scenarios | Muste | P2 | DOM-018, 019 | after M4 |

**Milestone gates:** ☐ M0 contract freeze · ☐ Mock v0 · ☐ M1 walking skeleton · ☐ M2 flood vertical slice · ☐ M3 restoration and earthquake · ☐ M4 feature freeze · ☐ M5 demo lock

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
  position?: LngLat;                                                // v1.3: storm centre now
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
  | { id: string; kind: 'flash_flood'; label: string; sourcePaths: LngLat[][]; stageCurve: [number, number][] /* [simTime, stageM] */;
      tuning?: { distanceLossPerM?: number; maxReachM?: number; debrisChance?: number } /* v1.2 */ }
  | { id: string; kind: 'earthquake'; label: string; epicenter: LngLat; magnitude: number; depthKm: number; originSimTime: number;
      tuning?: { waveSpeedMps?: number; intensityOffset?: number } /* v1.2 */ }
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
| `GET /operations` | Operations currently held by the server (added in v1.1) | → `Operation[]` | Dominic | client |
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
| `POST /admin/demo-reset` | Administrator only (v1.4): end every operation, restore demo accounts and default rules | → `{ok:true,operationsEnded}` | Dominic | demo runbook |
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

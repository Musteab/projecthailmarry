import { z } from 'zod';
import { ActionSchema } from './actions';
import type { RegionStatic } from './region';
import { RestorationAnalysisSchema, WorkOrderSchema } from './restoration';
import { ScenarioBeatSchema } from './scenario';
import type { Clock, FacilityState, GridSectionState, Metrics, Operation, Unit } from './world';
import {
  CellStateSchema,
  ClockSchema,
  FacilityStateSchema,
  GridSectionStateSchema,
  HazardStateSchema,
  IncidentSchema,
  MetricsSchema,
  OperationSchema,
  RoadStateSchema,
  SignalSchema,
  TimelineEventSchema,
  UnitSchema,
} from './world';

/**
 * World snapshot, patches and the WebSocket protocol.
 *
 * WebSocket: GET /ws?token=<jwt>. The client sends `subscribe`; the server answers with one
 * `snapshot`, then one `tick` per engine tick carrying the diff since the previous tick.
 */

/** The snapshot keeps only the most recent signals and timeline events. */
export const MAX_SIGNALS = 200;
export const MAX_TIMELINE = 500;

const record = <T extends z.ZodType>(value: T) => z.record(z.string(), value);

export const WorldSnapshotSchema = z.object({
  operation: OperationSchema,
  clock: ClockSchema,
  hazards: z.array(HazardStateSchema),
  metrics: MetricsSchema,
  /** keyed by H3 cell id; only cells with non-zero hazard */
  cells: record(CellStateSchema),
  /** keyed by edge id; only edges that are not plainly open */
  roads: record(RoadStateSchema),
  facilities: record(FacilityStateSchema),
  units: record(UnitSchema),
  incidents: record(IncidentSchema),
  actions: record(ActionSchema),
  gridSections: record(GridSectionStateSchema),
  workOrders: record(WorkOrderSchema),
  /** most recent MAX_SIGNALS, oldest first */
  signals: z.array(SignalSchema),
  /** most recent MAX_TIMELINE, oldest first */
  timeline: z.array(TimelineEventSchema),
  restoration: RestorationAnalysisSchema.nullable(),
});
export type WorldSnapshot = z.infer<typeof WorldSnapshotSchema>;

const patchRecord = <T extends z.ZodType>(value: T) => z.record(z.string(), value.nullable());

/**
 * The diff since the previous tick. An absent key means "unchanged".
 * - Keyed collections are upserts: each entry is the complete new value of that entity,
 *   and `null` removes the id (a cell with no hazard left, a road that is open again).
 * - `signals` and `timeline` are appended.
 * - `hazards`, `metrics` and `operation` replace the previous value.
 * - `restoration` replaces the previous analysis; `null` clears it.
 * `applyWorldPatch` is the reference implementation of these rules.
 */
export const WorldPatchSchema = z
  .object({
    operation: OperationSchema,
    hazards: z.array(HazardStateSchema),
    metrics: MetricsSchema,
    cells: patchRecord(CellStateSchema),
    roads: patchRecord(RoadStateSchema),
    facilities: patchRecord(FacilityStateSchema),
    units: patchRecord(UnitSchema),
    incidents: patchRecord(IncidentSchema),
    actions: patchRecord(ActionSchema),
    gridSections: patchRecord(GridSectionStateSchema),
    workOrders: patchRecord(WorkOrderSchema),
    signals: z.array(SignalSchema),
    timeline: z.array(TimelineEventSchema),
    restoration: RestorationAnalysisSchema.nullable(),
  })
  .partial();
export type WorldPatch = z.infer<typeof WorldPatchSchema>;

export const ServerMessageSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('snapshot'), world: WorldSnapshotSchema }),
  z.object({ t: z.literal('tick'), clock: ClockSchema, patch: WorldPatchSchema }),
  z.object({ t: z.literal('beat'), beat: ScenarioBeatSchema }),
  z.object({ t: z.literal('error'), code: z.string(), message: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

export const ClientMessageSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('subscribe'), operationId: z.string() }),
  z.object({ t: z.literal('ping') }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export function makeEmptyMetrics(): Metrics {
  return {
    peopleAtRisk: 0,
    peopleRescued: 0,
    activeIncidents: 0,
    unitsDeployed: 0,
    customersOut: 0,
    roadsClosed: 0,
    sheltersOpen: 0,
    shelterOccupancy: 0,
    isolatedPop: 0,
    noHospitalAccessPop: 0,
  };
}

/** A world with nothing in it: no hazard, no units, no facilities. */
export function makeEmptyWorld(operation: Operation, clock?: Partial<Clock>): WorldSnapshot {
  return {
    operation,
    clock: { simTime: 0, speed: 0, durationSimSec: null, ...clock },
    hazards: [],
    metrics: makeEmptyMetrics(),
    cells: {},
    roads: {},
    facilities: {},
    units: {},
    incidents: {},
    actions: {},
    gridSections: {},
    workOrders: {},
    signals: [],
    timeline: [],
    restoration: null,
  };
}

/**
 * The world at T0 for a region: every facility normal and on grid power, every unit available at
 * its home facility, every grid section energized.
 */
export function makeInitialWorld(
  operation: Operation,
  region: RegionStatic,
  clock?: Partial<Clock>,
): WorldSnapshot {
  const world = makeEmptyWorld(operation, clock);
  const facilityById = new Map(region.facilities.map((facility) => [facility.id, facility]));

  for (const facility of region.facilities) {
    const state: FacilityState = { status: 'normal', power: 'grid' };
    if (facility.kind === 'shelter') {
      state.activated = false;
      state.occupancy = 0;
    }
    if (facility.kind === 'hospital') state.onDivert = false;
    world.facilities[facility.id] = state;
  }

  for (const seed of region.units) {
    const home = facilityById.get(seed.homeFacilityId);
    if (!home) throw new Error(`Unit ${seed.id} has unknown home facility ${seed.homeFacilityId}`);
    const unit: Unit = { ...seed, position: home.position, heading: 0, status: 'available' };
    world.units[unit.id] = unit;
  }

  for (const section of region.grid.sections) {
    const state: GridSectionState = { status: 'energized', threatened: false, customersOut: 0 };
    world.gridSections[section.id] = state;
  }

  return world;
}

function mergeRecord<T>(
  base: Record<string, T>,
  patch: Record<string, T | null> | undefined,
): Record<string, T> {
  if (!patch) return base;
  const next = { ...base };
  for (const [id, value] of Object.entries(patch)) {
    if (value === null) delete next[id];
    else next[id] = value;
  }
  return next;
}

function appendCapped<T>(base: T[], added: T[] | undefined, max: number): T[] {
  if (!added || added.length === 0) return base;
  const next = base.concat(added);
  return next.length > max ? next.slice(next.length - max) : next;
}

/**
 * Reference implementation of the patch rules. Pure: returns a new snapshot and reuses every
 * collection the patch did not touch, so reference equality tells you what changed.
 */
export function applyWorldPatch(
  world: WorldSnapshot,
  patch: WorldPatch,
  clock: Clock = world.clock,
): WorldSnapshot {
  return {
    operation: patch.operation ?? world.operation,
    clock,
    hazards: patch.hazards ?? world.hazards,
    metrics: patch.metrics ?? world.metrics,
    cells: mergeRecord(world.cells, patch.cells),
    roads: mergeRecord(world.roads, patch.roads),
    facilities: mergeRecord(world.facilities, patch.facilities),
    units: mergeRecord(world.units, patch.units),
    incidents: mergeRecord(world.incidents, patch.incidents),
    actions: mergeRecord(world.actions, patch.actions),
    gridSections: mergeRecord(world.gridSections, patch.gridSections),
    workOrders: mergeRecord(world.workOrders, patch.workOrders),
    signals: appendCapped(world.signals, patch.signals, MAX_SIGNALS),
    timeline: appendCapped(world.timeline, patch.timeline, MAX_TIMELINE),
    restoration: patch.restoration === undefined ? world.restoration : patch.restoration,
  };
}

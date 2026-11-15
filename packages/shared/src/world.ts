import { z } from 'zod';
import {
  HazardKindSchema,
  LngLatSchema,
  ModeSchema,
  SeveritySchema,
  UnitIntervalSchema,
} from './primitives';
import { UnitKindSchema, UnitSeedSchema } from './region';

/**
 * Dynamic world entities. `simTime` is seconds since scenario T0; wall-clock values are ISO strings.
 */

export const OperationStatusSchema = z.enum(['ready', 'running', 'paused', 'ended']);
export type OperationStatus = z.infer<typeof OperationStatusSchema>;

export const OperationSchema = z.object({
  id: z.string(),
  regionId: z.string(),
  scenarioId: z.string().nullable(),
  mode: ModeSchema,
  name: z.string(),
  status: OperationStatusSchema,
  createdBy: z.string(),
  createdAt: z.string(),
});
export type Operation = z.infer<typeof OperationSchema>;

/** Sim speeds the transport controls offer. 0 is paused. */
export const SIM_SPEEDS = [0, 1, 5, 20, 60] as const;
export type SimSpeed = (typeof SIM_SPEEDS)[number];

export const ClockSchema = z.object({
  simTime: z.number().nonnegative(),
  /** sim seconds per wall second; one of SIM_SPEEDS */
  speed: z.number().nonnegative(),
  durationSimSec: z.number().positive().nullable(),
});
export type Clock = z.infer<typeof ClockSchema>;

export const HazardPhaseSchema = z.enum(['forecast', 'active', 'receding', 'ended']);
export type HazardPhase = z.infer<typeof HazardPhaseSchema>;

export const HazardStateSchema = z.object({
  id: z.string(),
  kind: HazardKindSchema,
  label: z.string(),
  phase: HazardPhaseSchema,
  // earthquake
  epicenter: LngLatSchema.optional(),
  magnitude: z.number().optional(),
  originSimTime: z.number().optional(),
  // tornado / hurricane
  track: z.array(LngLatSchema).optional(),
  radiusM: z.number().optional(),
  // flood source channels
  sourcePaths: z.array(z.array(LngLatSchema)).optional(),
});
export type HazardState = z.infer<typeof HazardStateSchema>;

/** Hazard intensity in one H3 cell. A cell with no hazard is absent from the world. */
export const CellStateSchema = z.object({
  floodDepthM: z.number().optional(),
  shakeMMI: z.number().optional(),
  windKph: z.number().optional(),
});
export type CellState = z.infer<typeof CellStateSchema>;

export const RoadStatusSchema = z.enum(['open', 'flooded', 'blocked', 'damaged', 'closed']);
export type RoadStatus = z.infer<typeof RoadStatusSchema>;

/** State of a road edge. An edge that is plainly open is absent from the world. */
export const RoadStateSchema = z.object({
  status: RoadStatusSchema,
  reason: z.string().optional(),
  closurePublished: z.boolean(),
  repairCandidateId: z.string().optional(),
  /**
   * Set when an edge that is not open can still be driven at reduced speed, as a fraction of
   * normal speed (a restricted bridge). Absent on a non-open edge means impassable.
   */
  speedFactor: z.number().positive().max(1).optional(),
});
export type RoadState = z.infer<typeof RoadStateSchema>;

export const FacilityStateSchema = z.object({
  status: z.enum(['normal', 'degraded', 'offline']),
  power: z.enum(['grid', 'backup', 'none']),
  backupFuelMin: z.number().optional(),
  // shelters
  activated: z.boolean().optional(),
  occupancy: z.number().int().nonnegative().optional(),
  // hospitals
  onDivert: z.boolean().optional(),
});
export type FacilityState = z.infer<typeof FacilityStateSchema>;

export const UnitStatusSchema = z.enum([
  'available',
  'dispatched',
  'en_route',
  'on_scene',
  'transporting',
  'returning',
  'out_of_service',
]);
export type UnitStatus = z.infer<typeof UnitStatusSchema>;

export const UnitAssignmentSchema = z.object({
  targetType: z.enum(['incident', 'work_order', 'facility']),
  targetId: z.string(),
  destination: LngLatSchema,
  /** polyline the unit follows; clients interpolate along it between departure and ETA */
  route: z.array(LngLatSchema),
  routeEdgeIds: z.array(z.string()),
  departedSimTime: z.number(),
  etaSimTime: z.number(),
});
export type UnitAssignment = z.infer<typeof UnitAssignmentSchema>;

export const UnitSchema = UnitSeedSchema.extend({
  position: LngLatSchema,
  /** degrees clockwise from north */
  heading: z.number(),
  status: UnitStatusSchema,
  assignment: UnitAssignmentSchema.optional(),
});
export type Unit = z.infer<typeof UnitSchema>;

export const SignalSourceSchema = z.enum([
  'official_alert',
  'sensor',
  'imagery',
  'field_report',
  'call_911',
  'utility_scada',
  'social',
]);
export type SignalSource = z.infer<typeof SignalSourceSchema>;

export const SignalSchema = z.object({
  id: z.string(),
  source: SignalSourceSchema,
  simTime: z.number(),
  position: LngLatSchema.optional(),
  title: z.string(),
  body: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
  mediaUrl: z.string().optional(),
  reliability: UnitIntervalSchema,
});
export type Signal = z.infer<typeof SignalSchema>;

/** A signal before the server stamps it with an id and sim time. */
export const SignalInputSchema = SignalSchema.omit({ id: true, simTime: true });
export type SignalInput = z.infer<typeof SignalInputSchema>;

export const TriageResultSchema = z.object({
  /** 1 = immediate, 5 = non-urgent */
  acuity: SeveritySchema,
  category: z.string(),
  chiefComplaint: z.string(),
  recommendedUnit: UnitKindSchema,
  rationale: z.string(),
});
export type TriageResult = z.infer<typeof TriageResultSchema>;

export const IncidentKindSchema = z.enum([
  'water_rescue',
  'medical',
  'structure_collapse',
  'fire',
  'road_blockage',
  'power_hazard',
  'shelter_need',
  'isolated_population',
]);
export type IncidentKind = z.infer<typeof IncidentKindSchema>;

export const IncidentStatusSchema = z.enum([
  'suspected',
  'confirmed',
  'assigned',
  'in_progress',
  'resolved',
  'closed',
]);
export type IncidentStatus = z.infer<typeof IncidentStatusSchema>;

export const IncidentSchema = z.object({
  id: z.string(),
  kind: IncidentKindSchema,
  title: z.string(),
  position: LngLatSchema,
  cellId: z.string(),
  severity: SeveritySchema,
  status: IncidentStatusSchema,
  confidence: UnitIntervalSchema,
  peopleAffected: z.number().int().nonnegative().optional(),
  triage: TriageResultSchema.optional(),
  aiSummary: z.string().optional(),
  sourceSignalIds: z.array(z.string()),
  requiredCapabilities: z.array(UnitKindSchema),
  assignedUnitIds: z.array(z.string()),
  openedAt: z.number(),
  resolvedAt: z.number().optional(),
});
export type Incident = z.infer<typeof IncidentSchema>;

export const GridSectionStateSchema = z.object({
  status: z.enum(['energized', 'isolated', 'faulted']),
  threatened: z.boolean(),
  customersOut: z.number().int().nonnegative(),
});
export type GridSectionState = z.infer<typeof GridSectionStateSchema>;

export const MetricsSchema = z.object({
  peopleAtRisk: z.number(),
  peopleRescued: z.number(),
  activeIncidents: z.number(),
  unitsDeployed: z.number(),
  customersOut: z.number(),
  roadsClosed: z.number(),
  sheltersOpen: z.number(),
  shelterOccupancy: z.number(),
  isolatedPop: z.number(),
  noHospitalAccessPop: z.number(),
});
export type Metrics = z.infer<typeof MetricsSchema>;

/** Pointers from an event, beat or answer to entities the UI can focus on. */
export const EntityRefsSchema = z.object({
  incidentId: z.string().optional(),
  actionId: z.string().optional(),
  unitId: z.string().optional(),
  edgeId: z.string().optional(),
  facilityId: z.string().optional(),
  sectionId: z.string().optional(),
});
export type EntityRefs = z.infer<typeof EntityRefsSchema>;

export const TimelineEventSchema = z.object({
  id: z.string(),
  simTime: z.number(),
  /** dotted name, e.g. `signal.received`, `incident.opened`, `action.executed`, `hazard.phase` */
  kind: z.string(),
  severity: z.enum(['info', 'warn', 'critical']),
  title: z.string(),
  detail: z.string().optional(),
  position: LngLatSchema.optional(),
  refs: EntityRefsSchema.optional(),
});
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;

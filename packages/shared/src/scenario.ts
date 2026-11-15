import { z } from 'zod';
import { CameraPoseSchema, HazardKindSchema, LngLatSchema } from './primitives';
import {
  EntityRefsSchema,
  HazardPhaseSchema,
  IncidentSchema,
  RoadStatusSchema,
  SignalInputSchema,
} from './world';

/** Scenario scripts and what-if injects. A scenario file is the screenplay of a demo run. */

export const InjectSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('set_road_status'),
    edgeIds: z.array(z.string()).min(1),
    status: RoadStatusSchema,
    reason: z.string(),
    /** when set, the edges become a repair candidate needing this much work */
    estCrewHours: z.number().positive().optional(),
  }),
  z.object({
    kind: z.literal('damage_bridge'),
    bridgeId: z.string(),
    severity: z.enum(['restricted', 'closed', 'collapsed']),
  }),
  z.object({
    kind: z.literal('facility_power_loss'),
    facilityId: z.string(),
    backupFuelMin: z.number().nonnegative().optional(),
  }),
  z.object({ kind: z.literal('facility_offline'), facilityId: z.string() }),
  z.object({ kind: z.literal('grid_fault'), sectionId: z.string() }),
  z.object({ kind: z.literal('unit_out_of_service'), unitId: z.string() }),
  z.object({
    kind: z.literal('spawn_incident'),
    incident: IncidentSchema.partial().required({
      kind: true,
      title: true,
      position: true,
      severity: true,
    }),
  }),
]);
export type Inject = z.infer<typeof InjectSchema>;
export type InjectKind = Inject['kind'];

export const HazardSpecSchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.string(),
    kind: z.literal('flash_flood'),
    label: z.string(),
    /** channels the water rises from */
    sourcePaths: z.array(z.array(LngLatSchema).min(2)).min(1),
    /** [simTime, stage in metres above the channel bed], linearly interpolated */
    stageCurve: z.array(z.tuple([z.number(), z.number()])).min(2),
    /** Optional overrides of the flood model defaults, so a scenario can be tuned from its file. */
    tuning: z
      .object({
        /** metres of water lost per metre of distance from the channel (default 0.006) */
        distanceLossPerM: z.number().positive().optional(),
        /** cells farther than this from the channel never flood (default 700) */
        maxReachM: z.number().positive().optional(),
        /** chance a flooded road is left blocked by debris; 0 leaves only scripted debris */
        debrisChance: z.number().min(0).max(1).optional(),
      })
      .optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal('earthquake'),
    label: z.string(),
    epicenter: LngLatSchema,
    magnitude: z.number(),
    depthKm: z.number(),
    originSimTime: z.number(),
    /** Optional overrides of the earthquake model defaults. */
    tuning: z
      .object({
        /** apparent speed of the shaking front across the map (default 400) */
        waveSpeedMps: z.number().positive().optional(),
        /** added to the computed intensity everywhere, to make a quake hit harder or softer */
        intensityOffset: z.number().optional(),
      })
      .optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal('tornado'),
    label: z.string(),
    /** [simTime, position] waypoints of the vortex */
    track: z.array(z.tuple([z.number(), LngLatSchema])).min(2),
    radiusM: z.number().positive(),
    peakWindKph: z.number().positive(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal('hurricane'),
    label: z.string(),
    track: z.array(z.tuple([z.number(), LngLatSchema])).min(2),
    radiusM: z.number().positive(),
    peakWindKph: z.number().positive(),
  }),
]);
export type HazardSpec = z.infer<typeof HazardSpecSchema>;

/** `at` is the sim time (seconds) the event fires. */
export const ScenarioEventSchema = z.discriminatedUnion('type', [
  z.object({ at: z.number().nonnegative(), type: z.literal('signal'), signal: SignalInputSchema }),
  z.object({ at: z.number().nonnegative(), type: z.literal('inject'), inject: InjectSchema }),
  z.object({
    at: z.number().nonnegative(),
    type: z.literal('hazard_phase'),
    hazardId: z.string(),
    phase: HazardPhaseSchema,
  }),
]);
export type ScenarioEvent = z.infer<typeof ScenarioEventSchema>;

/** A narrative beat: a caption for the audience and an optional scripted camera move. */
export const ScenarioBeatSchema = z.object({
  id: z.string(),
  simTime: z.number().nonnegative(),
  title: z.string(),
  caption: z.string(),
  camera: CameraPoseSchema.extend({ durationMs: z.number().nonnegative() }).optional(),
  focus: EntityRefsSchema.optional(),
});
export type ScenarioBeat = z.infer<typeof ScenarioBeatSchema>;

export const ScenarioSchema = z.object({
  id: z.string(),
  name: z.string(),
  hazard: HazardKindSchema,
  regionId: z.string(),
  description: z.string(),
  /** seed of the operation's PRNG; same seed, same run */
  seed: z.number().int(),
  durationSimSec: z.number().positive(),
  defaultSpeed: z.number().positive(),
  hazards: z.array(HazardSpecSchema),
  timeline: z.array(ScenarioEventSchema),
  beats: z.array(ScenarioBeatSchema),
});
export type Scenario = z.infer<typeof ScenarioSchema>;

/** What GET /api/scenarios returns for each scenario. */
export const ScenarioSummarySchema = ScenarioSchema.pick({
  id: true,
  name: true,
  hazard: true,
  regionId: true,
  description: true,
  durationSimSec: true,
});
export type ScenarioSummary = z.infer<typeof ScenarioSummarySchema>;

import { z } from 'zod';
import { LngLatSchema, UnitIntervalSchema } from './primitives';

/** Restoration prioritisation and work orders. */

export const RepairKindSchema = z.enum([
  'debris_clearance',
  'washout_repair',
  'bridge_repair',
  'inspection',
]);
export type RepairKind = z.infer<typeof RepairKindSchema>;

export const RepairCandidateSchema = z.object({
  id: z.string(),
  kind: RepairKindSchema,
  label: z.string(),
  edgeIds: z.array(z.string()).min(1),
  position: LngLatSchema,
  estCrewHours: z.number().positive(),
  crewsRequired: z.number().int().positive(),
});
export type RepairCandidate = z.infer<typeof RepairCandidateSchema>;

export const RestorationImpactSchema = z.object({
  /** people regaining a hospital within the access threshold */
  hospitalAccessPop: z.number(),
  shelterAccessPop: z.number(),
  isolatedPopReconnected: z.number(),
  avgHospitalMinBefore: z.number().nullable(),
  avgHospitalMinAfter: z.number().nullable(),
  facilitiesReconnected: z.array(z.string()),
});
export type RestorationImpact = z.infer<typeof RestorationImpactSchema>;

export const RestorationOptionSchema = z.object({
  id: z.string(),
  candidateIds: z.array(z.string()).min(1),
  label: z.string(),
  /** 1 = best */
  rank: z.number().int().positive(),
  score: z.number(),
  estHours: z.number(),
  impact: RestorationImpactSchema,
  rationale: z.string(),
  /** AI-written; optional and added asynchronously */
  narrative: z.string().optional(),
});
export type RestorationOption = z.infer<typeof RestorationOptionSchema>;

export const RestorationAnalysisSchema = z.object({
  computedAt: z.number(),
  accessThresholdMin: z.number(),
  baseline: z.object({
    isolatedPop: z.number(),
    noHospitalAccessPop: z.number(),
    noShelterAccessPop: z.number(),
  }),
  candidates: z.array(RepairCandidateSchema),
  options: z.array(RestorationOptionSchema),
  recommendedOptionId: z.string().nullable(),
});
export type RestorationAnalysis = z.infer<typeof RestorationAnalysisSchema>;

/** Per-cell travel time to the nearest functioning hospital before and after an option. */
export const AccessImpactSchema = z.object({
  optionId: z.string(),
  cells: z.array(
    z.object({
      cellId: z.string(),
      /** minutes; null = unreachable */
      beforeMin: z.number().nullable(),
      afterMin: z.number().nullable(),
    }),
  ),
});
export type AccessImpact = z.infer<typeof AccessImpactSchema>;

export const WorkOrderStatusSchema = z.enum([
  'created',
  'assigned',
  'in_progress',
  'inspection',
  'reopened',
  'failed_inspection',
  'cancelled',
]);
export type WorkOrderStatus = z.infer<typeof WorkOrderStatusSchema>;

export const WorkOrderSchema = z.object({
  id: z.string(),
  operationId: z.string(),
  optionId: z.string(),
  candidateId: z.string(),
  title: z.string(),
  status: WorkOrderStatusSchema,
  assignedUnitIds: z.array(z.string()),
  progress: UnitIntervalSchema,
  history: z.array(z.object({ status: WorkOrderStatusSchema, at: z.number(), by: z.string() })),
});
export type WorkOrder = z.infer<typeof WorkOrderSchema>;

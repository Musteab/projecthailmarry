import { z } from 'zod';
import { AuthoritySchema, UnitIntervalSchema } from './primitives';

/**
 * Decisions, actions and rules. One pipeline carries every action the platform or an operator takes:
 * proposed -> (awaiting_approval | approved) -> executing -> executed, with rejected, overridden,
 * expired and failed as terminal side exits.
 */

export const ActionKindSchema = z.enum([
  'dispatch_unit',
  'assign_ambulance',
  'recall_unit',
  'activate_shelter',
  'publish_road_closure',
  'isolate_grid_section',
  'restore_grid_section',
  'divert_hospital',
  'issue_public_alert',
  'create_work_order',
]);
export type ActionKind = z.infer<typeof ActionKindSchema>;

export const ActionPayloadSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('dispatch_unit'), unitId: z.string(), incidentId: z.string() }),
  z.object({
    kind: z.literal('assign_ambulance'),
    unitId: z.string(),
    incidentId: z.string(),
    /** destination hospital for the transport leg */
    hospitalId: z.string().optional(),
  }),
  z.object({ kind: z.literal('recall_unit'), unitId: z.string() }),
  z.object({ kind: z.literal('activate_shelter'), facilityId: z.string() }),
  z.object({
    kind: z.literal('publish_road_closure'),
    edgeIds: z.array(z.string()).min(1),
    reason: z.string(),
  }),
  z.object({ kind: z.literal('isolate_grid_section'), sectionId: z.string() }),
  z.object({ kind: z.literal('restore_grid_section'), sectionId: z.string() }),
  z.object({
    kind: z.literal('divert_hospital'),
    facilityId: z.string(),
    toFacilityId: z.string().optional(),
  }),
  z.object({
    kind: z.literal('issue_public_alert'),
    headline: z.string(),
    body: z.string(),
    cellIds: z.array(z.string()),
  }),
  z.object({ kind: z.literal('create_work_order'), optionId: z.string() }),
]);
export type ActionPayload = z.infer<typeof ActionPayloadSchema>;

/** Why the platform chose this action. Shown on every decision card. */
export const DecisionExplainSchema = z.object({
  /** e.g. "Rescue 3 -> Water rescue, ETA 4:10" */
  headline: z.string(),
  factors: z.array(
    z.object({ label: z.string(), value: z.string(), weight: z.number().optional() }),
  ),
  alternatives: z.array(
    z.object({ label: z.string(), score: z.number(), rejectedBecause: z.string() }),
  ),
  confidence: UnitIntervalSchema,
  /** AI-written plain-language explanation; optional and added asynchronously */
  narrative: z.string().optional(),
});
export type DecisionExplain = z.infer<typeof DecisionExplainSchema>;

export const ActionStatusSchema = z.enum([
  'proposed',
  'awaiting_approval',
  'approved',
  'executing',
  'executed',
  'rejected',
  'overridden',
  'failed',
  'expired',
]);
export type ActionStatus = z.infer<typeof ActionStatusSchema>;

export const ActionSchema = z.object({
  id: z.string(),
  operationId: z.string(),
  kind: ActionKindSchema,
  authority: AuthoritySchema,
  status: ActionStatusSchema,
  payload: ActionPayloadSchema,
  initiator: z.enum(['platform', 'operator']),
  ruleId: z.string().optional(),
  explain: DecisionExplainSchema,
  /** true in exercise mode: the action never leaves the training environment */
  sandboxed: z.boolean(),
  proposedAt: z.number(),
  /** user id, or 'auto' when a rule executed it */
  decidedBy: z.string().optional(),
  decidedAt: z.number().optional(),
  executedAt: z.number().optional(),
  /** id of the action this one replaced */
  overrideOf: z.string().optional(),
  rejectReason: z.string().optional(),
});
export type Action = z.infer<typeof ActionSchema>;

/** `auto` = platform executes, `approve` = waits for a human, `off` = never proposed. */
export const AutonomySchema = z.enum(['auto', 'approve', 'off']);
export type Autonomy = z.infer<typeof AutonomySchema>;

export const RuleParamsSchema = z.record(
  z.string(),
  z.union([z.number(), z.string(), z.boolean()]),
);
export type RuleParams = z.infer<typeof RuleParamsSchema>;

export const RuleSchema = z.object({
  id: z.string(),
  authority: AuthoritySchema,
  name: z.string(),
  description: z.string(),
  actionKind: ActionKindSchema,
  autonomy: AutonomySchema,
  /** thresholds, e.g. { minSeverity: 4, floodDepthM: 0.3 } */
  params: RuleParamsSchema,
  approvedBy: z.string(),
  updatedAt: z.string(),
});
export type Rule = z.infer<typeof RuleSchema>;

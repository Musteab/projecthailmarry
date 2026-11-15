import { z } from 'zod';
import { ActionPayloadSchema, ActionSchema, AutonomySchema, RuleParamsSchema } from './actions';
import { ModeSchema, UserSchema } from './primitives';
import { WorkOrderStatusSchema } from './restoration';
import { EntityRefsSchema, SIM_SPEEDS } from './world';

/**
 * REST request and response bodies that are not already an entity schema.
 * All routes are JSON, under /api, and need `Authorization: Bearer <jwt>` unless marked public.
 */

/** Every non-2xx response has this body. */
export const ApiErrorBodySchema = z.object({
  error: z.object({
    /** stable machine-readable code, e.g. `validation_failed`, `forbidden`, `illegal_transition` */
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;

export const LoginRequestSchema = z.object({
  email: z.string().min(3),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const LoginResponseSchema = z.object({ token: z.string(), user: UserSchema });
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const CreateOperationRequestSchema = z.object({
  regionId: z.string(),
  scenarioId: z.string().nullable(),
  mode: ModeSchema,
  name: z.string().optional(),
});
export type CreateOperationRequest = z.infer<typeof CreateOperationRequestSchema>;

export const ControlCommandSchema = z.enum(['start', 'pause', 'resume', 'reset', 'end']);
export type ControlCommand = z.infer<typeof ControlCommandSchema>;

export const ControlRequestSchema = z.union([
  z.object({ command: ControlCommandSchema }),
  z.object({
    command: z.literal('speed'),
    speed: z.number().refine((value) => (SIM_SPEEDS as readonly number[]).includes(value), {
      message: `speed must be one of ${SIM_SPEEDS.join(', ')}`,
    }),
  }),
]);
export type ControlRequest = z.infer<typeof ControlRequestSchema>;

export const CreateActionRequestSchema = z.object({ payload: ActionPayloadSchema });
export type CreateActionRequest = z.infer<typeof CreateActionRequestSchema>;

export const RejectActionRequestSchema = z.object({ reason: z.string().min(1) });
export type RejectActionRequest = z.infer<typeof RejectActionRequestSchema>;

export const OverrideActionRequestSchema = z.object({
  reason: z.string().min(1),
  /** omit to cancel the action without a replacement */
  replacement: ActionPayloadSchema.optional(),
});
export type OverrideActionRequest = z.infer<typeof OverrideActionRequestSchema>;

export const OverrideActionResponseSchema = z.object({
  overridden: ActionSchema,
  replacement: ActionSchema.optional(),
});
export type OverrideActionResponse = z.infer<typeof OverrideActionResponseSchema>;

export const UpdateRuleRequestSchema = z.object({
  autonomy: AutonomySchema.optional(),
  params: RuleParamsSchema.optional(),
});
export type UpdateRuleRequest = z.infer<typeof UpdateRuleRequestSchema>;

export const CreateWorkOrderRequestSchema = z.object({ optionId: z.string() });
export type CreateWorkOrderRequest = z.infer<typeof CreateWorkOrderRequestSchema>;

export const TransitionWorkOrderRequestSchema = z.object({ to: WorkOrderStatusSchema });
export type TransitionWorkOrderRequest = z.infer<typeof TransitionWorkOrderRequestSchema>;

export const OkResponseSchema = z.object({ ok: z.literal(true) });
export type OkResponse = z.infer<typeof OkResponseSchema>;

export const AuditEntrySchema = z.object({
  id: z.string(),
  /** wall-clock ISO timestamp */
  at: z.string(),
  simTime: z.number(),
  /** user id, or 'platform' */
  actor: z.string(),
  /** e.g. `action.approved`, `rule.updated`, `work_order.transitioned` */
  verb: z.string(),
  actionId: z.string().optional(),
  detail: z.string(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const CopilotRequestSchema = z.object({ question: z.string().min(1) });
export type CopilotRequest = z.infer<typeof CopilotRequestSchema>;

export const CopilotResponseSchema = z.object({
  answer: z.string(),
  refs: z.array(EntityRefsSchema).optional(),
});
export type CopilotResponse = z.infer<typeof CopilotResponseSchema>;

export const AfterActionReportSchema = z.object({ markdown: z.string() });
export type AfterActionReport = z.infer<typeof AfterActionReportSchema>;

const id = encodeURIComponent;

/** One place for every route, so the server and the client cannot drift apart. */
export const apiPaths = {
  health: '/api/health',
  login: '/api/auth/login',
  me: '/api/auth/me',
  regionStatic: (regionId: string) => `/api/regions/${id(regionId)}/static`,
  scenarios: '/api/scenarios',
  operations: '/api/operations',
  operation: (operationId: string) => `/api/operations/${id(operationId)}`,
  operationControl: (operationId: string) => `/api/operations/${id(operationId)}/control`,
  operationInjects: (operationId: string) => `/api/operations/${id(operationId)}/injects`,
  operationSignals: (operationId: string) => `/api/operations/${id(operationId)}/signals`,
  operationActions: (operationId: string) => `/api/operations/${id(operationId)}/actions`,
  operationAudit: (operationId: string) => `/api/operations/${id(operationId)}/audit`,
  actionApprove: (actionId: string) => `/api/actions/${id(actionId)}/approve`,
  actionReject: (actionId: string) => `/api/actions/${id(actionId)}/reject`,
  actionOverride: (actionId: string) => `/api/actions/${id(actionId)}/override`,
  rules: '/api/rules',
  rule: (ruleId: string) => `/api/rules/${id(ruleId)}`,
  /** administrator only: end every operation and restore demo accounts and rules (v1.4) */
  adminDemoReset: '/api/admin/demo-reset',
  restorationAnalyze: (operationId: string) =>
    `/api/operations/${id(operationId)}/restoration/analyze`,
  restorationImpact: (operationId: string, optionId: string) =>
    `/api/operations/${id(operationId)}/restoration/options/${id(optionId)}/impact`,
  workOrders: (operationId: string) => `/api/operations/${id(operationId)}/work-orders`,
  workOrderTransition: (workOrderId: string) => `/api/work-orders/${id(workOrderId)}/transition`,
  // owned by @bastion/intel (Muste)
  intelBriefing: (operationId: string) => `/api/intel/operations/${id(operationId)}/briefing`,
  intelCopilot: (operationId: string) => `/api/intel/operations/${id(operationId)}/copilot`,
  intelAfterAction: (operationId: string) => `/api/intel/operations/${id(operationId)}/aar`,
  publicClosures: (regionId: string) => `/public/${id(regionId)}/closures.geojson`,
  publicAlerts: (regionId: string) => `/public/${id(regionId)}/alerts.cap`,
  ws: '/ws',
} as const;

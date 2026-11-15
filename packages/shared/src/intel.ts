import { z } from 'zod';
import type { Action } from './actions';
import { LngLatSchema, SeveritySchema, UnitIntervalSchema } from './primitives';
import type { WorldSnapshot } from './protocol';
import type { RegionStatic } from './region';
import { RegionConfigSchema, UnitKindSchema } from './region';
import type { RestorationAnalysis } from './restoration';
import type { Operation, Signal, SignalInput, TriageResult } from './world';
import {
  ClockSchema,
  HazardStateSchema,
  IncidentKindSchema,
  IncidentSchema,
  MetricsSchema,
  OperationSchema,
} from './world';

/**
 * The port between the server (Dominic) and @bastion/intel (Muste).
 *
 * Rules of the port: every method resolves within 4 seconds or falls back internally, never
 * throws into the tick loop, and caches by content hash so a replayed scenario is identical.
 */

/** Hard ceiling for any IntelPort call before the caller falls back. */
export const INTEL_TIMEOUT_MS = 4000;

/** The compact situation summary handed to every intel call. */
export const IntelContextSchema = z.object({
  operation: OperationSchema,
  clock: ClockSchema,
  region: RegionConfigSchema,
  incidents: z.array(IncidentSchema),
  hazards: z.array(HazardStateSchema),
  metrics: MetricsSchema,
});
export type IntelContext = z.infer<typeof IntelContextSchema>;

/** What signal fusion proposes; the server's incident manager confirms or merges it. */
export const IncidentCandidateSchema = z.object({
  kind: IncidentKindSchema,
  title: z.string(),
  position: LngLatSchema,
  severity: SeveritySchema,
  confidence: UnitIntervalSchema,
  peopleAffected: z.number().int().nonnegative().optional(),
  summary: z.string(),
  sourceSignalIds: z.array(z.string()).min(1),
  requiredCapabilities: z.array(UnitKindSchema),
  /** set when this is the same event as an already open incident */
  mergeWithIncidentId: z.string().optional(),
});
export type IncidentCandidate = z.infer<typeof IncidentCandidateSchema>;

export const BriefingSchema = z.object({
  generatedAt: z.number(),
  headline: z.string(),
  situation: z.string(),
  priorities: z.array(z.string()),
  risks: z.array(z.string()),
  recommendedActions: z.array(z.string()),
});
export type Briefing = z.infer<typeof BriefingSchema>;

/** Implemented by @bastion/intel, called by the server. */
export interface IntelPort {
  /** Turn a batch of new signals into incident candidates. */
  fuse(signals: Signal[], ctx: IntelContext): Promise<IncidentCandidate[]>;
  /** Triage a 911 call transcript. */
  triage(call: Signal, ctx: IntelContext): Promise<TriageResult>;
  /** Plain-language explanation of a platform decision. */
  explain(action: Action, ctx: IntelContext): Promise<string>;
  /** Narrative per restoration option, keyed by option id. */
  narrateRestoration(
    analysis: RestorationAnalysis,
    ctx: IntelContext,
  ): Promise<Record<string, string>>;
}

/** Implemented by the server, handed to the Fastify plugin exported by @bastion/intel. */
export interface IntelHost {
  getWorld(operationId: string): WorldSnapshot | undefined;
  getRegion(regionId: string): RegionStatic;
  /** Feed a signal (live feed, field report) into an operation. Returns the stamped signal. */
  ingestSignal(operationId: string, signal: SignalInput): Signal;
  listLiveOperations(): Operation[];
  /**
   * Fastify preHandler that rejects requests without a valid JWT. Typed as unknown so this
   * package does not depend on Fastify; cast it at the call site.
   */
  authenticate: unknown;
}

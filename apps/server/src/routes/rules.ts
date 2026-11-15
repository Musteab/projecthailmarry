import type { Rule, RuleParams } from '@bastion/shared';
import { apiPaths, RuleSchema, UpdateRuleRequestSchema } from '@bastion/shared';
import type { FastifyInstance } from 'fastify';
import { currentUser } from '../auth/service';
import type { AppContext } from '../context';
import { insertAudit } from '../db/audit';
import { findRule, listRules, updateRule } from '../db/rules';
import { badRequest, notFound } from '../errors';
import { parseInput } from '../http';

/** Bounds for the numeric thresholds agencies can tune. Anything else must already exist on the rule. */
const BOUNDS: Record<string, [number, number]> = {
  minSeverity: [1, 5],
  maxAcuity: [1, 5],
  minConfidence: [0, 1],
  floodDepthM: [0.05, 5],
  shakeMMI: [1, 10],
  leadTimeMin: [0, 120],
  clearForMin: [0, 240],
  displacedThreshold: [1, 100_000],
  maxTravelMin: [1, 240],
  accessThresholdMin: [1, 240],
  hospitalWeight: [0, 100],
  shelterWeight: [0, 100],
  isolationWeight: [0, 100],
  workSecondsPerCrewHour: [1, 3600],
};

/**
 * Checks a params patch against the rule it is for: a key must be one the rule already has or a
 * known threshold, keep its type, and stay inside its bounds. Returns every problem found.
 */
export function validateRuleParams(rule: Rule, patch: RuleParams): string[] {
  const problems: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    const existing = rule.params[key];
    if (existing === undefined && !(key in BOUNDS)) {
      problems.push(`${key}: not a parameter of this rule`);
      continue;
    }
    const expected = existing === undefined ? 'number' : typeof existing;
    if (typeof value !== expected) {
      problems.push(`${key}: must be a ${expected}`);
      continue;
    }
    const bounds = BOUNDS[key];
    if (bounds && typeof value === 'number' && (value < bounds[0] || value > bounds[1])) {
      problems.push(`${key}: must be between ${bounds[0]} and ${bounds[1]}`);
    }
  }
  return problems;
}

/**
 * The rules console: every signed-in user can read the agency rules; an agency's rules can only
 * be changed by someone who holds the `rules` permission for that agency. A change is audited
 * and takes effect in every running operation on its next step.
 */
export function registerRuleRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, auth, operations, respond } = ctx;

  app.get(apiPaths.rules, async () => respond(RuleSchema.array(), listRules(db), 'rule list'));

  app.patch<{ Params: { ruleId: string } }>('/api/rules/:ruleId', async (request) => {
    const patch = parseInput(UpdateRuleRequestSchema, request.body);
    const user = currentUser(request);
    const rule = findRule(db, request.params.ruleId);
    if (!rule) throw notFound(`Rule "${request.params.ruleId}"`);
    auth.assertCan(user, 'rules', rule.authority);

    if (patch.autonomy === undefined && patch.params === undefined) {
      throw badRequest('Nothing to change: send autonomy, params or both');
    }
    const problems = patch.params ? validateRuleParams(rule, patch.params) : [];
    if (problems.length > 0) throw badRequest('Invalid rule parameters', problems);

    const updated = updateRule(db, rule.id, patch)!;
    const changes = [
      patch.autonomy && patch.autonomy !== rule.autonomy
        ? `autonomy ${rule.autonomy} -> ${patch.autonomy}`
        : undefined,
      ...Object.entries(patch.params ?? {})
        .filter(([key, value]) => rule.params[key] !== value)
        .map(([key, value]) => `${key} ${String(rule.params[key] ?? 'unset')} -> ${String(value)}`),
    ].filter(Boolean);
    insertAudit(db, {
      operationId: null,
      simTime: 0,
      actor: user.id,
      verb: 'rule.updated',
      detail: `${rule.name}: ${changes.length > 0 ? changes.join(', ') : 'no effective change'}`,
    });
    operations.refreshRules();
    return respond(RuleSchema, updated, 'rule');
  });
}

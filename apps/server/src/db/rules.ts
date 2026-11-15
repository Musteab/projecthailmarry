import type { ActionKind, Authority, Rule } from '@bastion/shared';
import { RuleSchema } from '@bastion/shared';
import type { Database } from './database';

function toRule(row: Record<string, unknown>): Rule {
  return RuleSchema.parse({
    id: row.id,
    authority: row.authority,
    name: row.name,
    description: row.description,
    actionKind: row.action_kind,
    autonomy: row.autonomy,
    params: JSON.parse(String(row.params)) as unknown,
    approvedBy: row.approved_by,
    updatedAt: row.updated_at,
  });
}

export function listRules(db: Database): Rule[] {
  return db.prepare('SELECT * FROM rules ORDER BY authority, id').all().map(toRule);
}

export function findRule(db: Database, id: string): Rule | undefined {
  const row = db.prepare('SELECT * FROM rules WHERE id = ?').get(id);
  return row ? toRule(row) : undefined;
}

/** The rule governing an action kind for an authority, if the agency has one. */
export function findRuleFor(
  db: Database,
  actionKind: ActionKind,
  authority: Authority,
): Rule | undefined {
  const row = db
    .prepare('SELECT * FROM rules WHERE action_kind = ? AND authority = ? ORDER BY id LIMIT 1')
    .get(actionKind, authority);
  return row ? toRule(row) : undefined;
}

/** Inserts the rule only if its id is new. Returns whether a row was inserted. */
export function insertRuleIfAbsent(db: Database, rule: Rule): boolean {
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO rules
         (id, authority, name, description, action_kind, autonomy, params, approved_by, updated_at)
       VALUES
         (:id, :authority, :name, :description, :actionKind, :autonomy, :params, :approvedBy, :updatedAt)`,
    )
    .run({ ...rule, params: JSON.stringify(rule.params) });
  return Number(result.changes) > 0;
}

/** Changes a rule's autonomy and/or thresholds. Returns the updated rule, or undefined if absent. */
export function updateRule(
  db: Database,
  id: string,
  patch: Partial<Pick<Rule, 'autonomy' | 'params'>>,
): Rule | undefined {
  const current = findRule(db, id);
  if (!current) return undefined;
  const next: Rule = {
    ...current,
    autonomy: patch.autonomy ?? current.autonomy,
    params: patch.params ? { ...current.params, ...patch.params } : current.params,
    updatedAt: new Date().toISOString(),
  };
  db.prepare(
    'UPDATE rules SET autonomy = :autonomy, params = :params, updated_at = :updatedAt WHERE id = :id',
  ).run({
    id,
    autonomy: next.autonomy,
    params: JSON.stringify(next.params),
    updatedAt: next.updatedAt,
  });
  return next;
}

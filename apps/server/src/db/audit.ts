import { randomUUID } from 'node:crypto';
import type { AuditEntry } from '@bastion/shared';
import { AuditEntrySchema } from '@bastion/shared';
import type { Database } from './database';

export interface AuditInput {
  /** null for changes that are not part of an operation, such as editing a rule */
  operationId: string | null;
  simTime: number;
  /** user id, or 'platform' / 'auto' */
  actor: string;
  /** e.g. `action.approved`, `rule.updated` */
  verb: string;
  actionId?: string;
  detail: string;
}

/** Appends to the audit trail. Entries are never updated or deleted. */
export function insertAudit(db: Database, input: AuditInput): void {
  db.prepare(
    `INSERT INTO audit_log (id, operation_id, at, sim_time, actor, verb, action_id, detail)
     VALUES (:id, :operationId, :at, :simTime, :actor, :verb, :actionId, :detail)`,
  ).run({
    id: `aud-${randomUUID().slice(0, 12)}`,
    operationId: input.operationId,
    at: new Date().toISOString(),
    simTime: input.simTime,
    actor: input.actor,
    verb: input.verb,
    actionId: input.actionId ?? null,
    detail: input.detail,
  });
}

/** The audit trail of an operation, oldest first. */
export function listAudit(db: Database, operationId: string): AuditEntry[] {
  return db
    .prepare('SELECT * FROM audit_log WHERE operation_id = ? ORDER BY seq')
    .all(operationId)
    .map((row) =>
      AuditEntrySchema.parse({
        id: row.id,
        at: row.at,
        simTime: row.sim_time,
        actor: row.actor,
        verb: row.verb,
        ...(row.action_id === null ? {} : { actionId: row.action_id }),
        detail: row.detail,
      }),
    );
}

import type { Operation, OperationStatus } from '@bastion/shared';
import { OperationSchema } from '@bastion/shared';
import type { Database } from './database';

function toOperation(row: Record<string, unknown>): Operation {
  return OperationSchema.parse({
    id: row.id,
    regionId: row.region_id,
    scenarioId: row.scenario_id,
    mode: row.mode,
    name: row.name,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
  });
}

export function insertOperation(db: Database, operation: Operation): void {
  db.prepare(
    `INSERT INTO operations (id, region_id, scenario_id, mode, name, status, created_by, created_at)
     VALUES (:id, :regionId, :scenarioId, :mode, :name, :status, :createdBy, :createdAt)`,
  ).run({ ...operation });
}

export function updateOperationStatus(db: Database, id: string, status: OperationStatus): void {
  db.prepare(
    `UPDATE operations
        SET status = :status,
            ended_at = CASE WHEN :status = 'ended' THEN :now ELSE NULL END
      WHERE id = :id`,
  ).run({ id, status, now: new Date().toISOString() });
}

export function findOperation(db: Database, id: string): Operation | undefined {
  const row = db.prepare('SELECT * FROM operations WHERE id = ?').get(id);
  return row ? toOperation(row) : undefined;
}

/**
 * The live world of an operation exists only in memory, so anything still marked as active
 * when the server starts was cut short by a restart. Marks those as ended.
 */
export function endInterruptedOperations(db: Database): number {
  const result = db
    .prepare("UPDATE operations SET status = 'ended', ended_at = ? WHERE status != 'ended'")
    .run(new Date().toISOString());
  return Number(result.changes);
}

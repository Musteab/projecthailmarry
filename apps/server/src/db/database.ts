import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

export type Database = DatabaseSync;

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

/** Opens (and creates if needed) the SQLite database. Pass ':memory:' for tests. */
export function openDatabase(path: string): Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  return db;
}

/** Runs `fn` inside a transaction; rolls back if it throws. */
export function transaction<T>(db: Database, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export interface Migration {
  id: string;
  sql: string;
}

/** Numbered .sql files in the migrations folder, in order. */
export function readMigrations(dir = MIGRATIONS_DIR): Migration[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => ({
      id: file.replace(/\.sql$/, ''),
      sql: readFileSync(join(dir, file), 'utf8'),
    }));
}

/**
 * Applies every migration that has not been applied yet, each in its own transaction.
 * Safe to call on every boot. Returns the ids applied by this call.
 */
export function migrate(db: Database, migrations: Migration[] = readMigrations()): string[] {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
  );
  const applied = new Set(
    db
      .prepare('SELECT id FROM schema_migrations')
      .all()
      .map((row) => String(row.id)),
  );

  const ran: string[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    transaction(db, () => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(
        migration.id,
        new Date().toISOString(),
      );
    });
    ran.push(migration.id);
  }
  return ran;
}

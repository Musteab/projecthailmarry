import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupTempDirs, makeTempDir } from '../testing';
import { migrate, openDatabase, readMigrations, transaction } from './database';

const TABLES = [
  'actions',
  'audit_log',
  'operations',
  'rules',
  'signals_log',
  'users',
  'work_orders',
];

const tableNames = (db: ReturnType<typeof openDatabase>) =>
  db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((row) => String(row.name))
    .sort();

describe('database', () => {
  afterEach(cleanupTempDirs);

  it('ships migrations in order', () => {
    const ids = readMigrations().map((migration) => migration.id);
    expect(ids[0]).toBe('001_init');
    expect(ids).toEqual([...ids].sort());
  });

  it('creates every table on a fresh database', () => {
    const db = openDatabase(':memory:');
    const applied = migrate(db);
    expect(applied).toContain('001_init');
    expect(tableNames(db)).toEqual([...TABLES, 'schema_migrations'].sort());
    db.close();
  });

  it('is idempotent: a second run applies nothing', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    expect(migrate(db)).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get()?.n).toBe(
      readMigrations().length,
    );
    db.close();
  });

  it('creates the database file and its folder, and remembers migrations across restarts', () => {
    const path = join(makeTempDir(), 'nested', 'bastion.sqlite');
    const first = openDatabase(path);
    expect(migrate(first).length).toBeGreaterThan(0);
    first.close();
    expect(existsSync(path)).toBe(true);

    const second = openDatabase(path);
    expect(migrate(second)).toEqual([]);
    second.close();
  });

  it('applies only new migrations and rolls a failing one back completely', () => {
    const db = openDatabase(':memory:');
    migrate(db, [{ id: '001_a', sql: 'CREATE TABLE a (id TEXT)' }]);

    const broken = [
      { id: '001_a', sql: 'CREATE TABLE a (id TEXT)' },
      { id: '002_b', sql: 'CREATE TABLE b (id TEXT); CREATE TABLE a (id TEXT);' },
    ];
    expect(() => migrate(db, broken)).toThrow();
    expect(tableNames(db)).toEqual(['a', 'schema_migrations']);

    const fixed = [broken[0]!, { id: '002_b', sql: 'CREATE TABLE b (id TEXT)' }];
    expect(migrate(db, fixed)).toEqual(['002_b']);
    db.close();
  });

  it('rolls back a failed transaction', () => {
    const db = openDatabase(':memory:');
    db.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');
    expect(() =>
      transaction(db, () => {
        db.prepare('INSERT INTO t (id) VALUES (?)').run('a');
        throw new Error('nope');
      }),
    ).toThrow('nope');
    expect(db.prepare('SELECT COUNT(*) AS n FROM t').get()?.n).toBe(0);
    expect(transaction(db, () => 42)).toBe(42);
    db.close();
  });

  it('enforces foreign keys', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    expect(() =>
      db
        .prepare(
          `INSERT INTO actions (id, operation_id, kind, authority, status, data, updated_at)
           VALUES ('a1', 'missing-operation', 'dispatch_unit', 'ems', 'proposed', '{}', 'now')`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY/i);
    db.close();
  });
});

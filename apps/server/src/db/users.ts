import type { User } from '@bastion/shared';
import { UserSchema } from '@bastion/shared';
import type { Database } from './database';

/** A user as stored: the public profile plus the password hash, which never leaves the server. */
export interface StoredUser extends User {
  passwordHash: string;
}

function toStoredUser(row: Record<string, unknown>): StoredUser {
  const user = UserSchema.parse({
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    authority: row.authority,
  });
  return { ...user, passwordHash: String(row.password_hash) };
}

/** Strips the password hash. Use this before a user goes anywhere near a response. */
export function toPublicUser(user: StoredUser): User {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    authority: user.authority,
  };
}

export function findUserByEmail(db: Database, email: string): StoredUser | undefined {
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim());
  return row ? toStoredUser(row) : undefined;
}

export function findUserById(db: Database, id: string): StoredUser | undefined {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return row ? toStoredUser(row) : undefined;
}

export function listUsers(db: Database): StoredUser[] {
  return db.prepare('SELECT * FROM users ORDER BY id').all().map(toStoredUser);
}

/** Inserts the user, or updates every field if the id already exists. */
export function upsertUser(db: Database, user: StoredUser): void {
  db.prepare(
    `INSERT INTO users (id, email, name, role, authority, password_hash, created_at)
     VALUES (:id, :email, :name, :role, :authority, :passwordHash, :createdAt)
     ON CONFLICT (id) DO UPDATE SET
       email = excluded.email,
       name = excluded.name,
       role = excluded.role,
       authority = excluded.authority,
       password_hash = excluded.password_hash`,
  ).run({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    authority: user.authority,
    passwordHash: user.passwordHash,
    createdAt: new Date().toISOString(),
  });
}

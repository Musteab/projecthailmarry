import { RoleSchema, RuleSchema } from '@bastion/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../auth/password';
import type { Database } from './database';
import { migrate, openDatabase } from './database';
import { findRule, findRuleFor, listRules, updateRule } from './rules';
import { DEFAULT_RULES, DEMO_USERS, seed } from './seed';
import { findUserByEmail, findUserById, listUsers, toPublicUser } from './users';

const PASSWORD = 'correct horse battery';

describe('password hashing', () => {
  it('verifies the right password and rejects the wrong one', () => {
    const hash = hashPassword(PASSWORD);
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(hash).not.toContain(PASSWORD);
    expect(verifyPassword(PASSWORD, hash)).toBe(true);
    expect(verifyPassword('wrong', hash)).toBe(false);
  });

  it('salts: the same password hashes differently each time', () => {
    expect(hashPassword(PASSWORD)).not.toBe(hashPassword(PASSWORD));
  });

  it('returns false for malformed stored hashes instead of throwing', () => {
    for (const stored of [
      '',
      'plain',
      'scrypt$x$8$1$AAAA$AAAA',
      'bcrypt$1$2$3$4$5',
      'scrypt$$$$$',
    ]) {
      expect(verifyPassword(PASSWORD, stored)).toBe(false);
    }
  });
});

describe('seed', () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
    migrate(db);
  });

  it('creates one demo account per role', () => {
    const result = seed(db, PASSWORD);
    expect(result).toEqual({ usersWritten: 5, rulesInserted: DEFAULT_RULES.length });

    const users = listUsers(db);
    expect(users.map((user) => user.role).sort()).toEqual([...RoleSchema.options].sort());
    for (const user of users) expect(verifyPassword(PASSWORD, user.passwordHash)).toBe(true);
  });

  it('is idempotent: a second run writes nothing', () => {
    seed(db, PASSWORD);
    const hashes = listUsers(db).map((user) => user.passwordHash);

    expect(seed(db, PASSWORD)).toEqual({ usersWritten: 0, rulesInserted: 0 });
    expect(listUsers(db).map((user) => user.passwordHash)).toEqual(hashes);
    expect(listUsers(db)).toHaveLength(DEMO_USERS.length);
    expect(listRules(db)).toHaveLength(DEFAULT_RULES.length);
  });

  it('rewrites the accounts when the demo password changes', () => {
    seed(db, PASSWORD);
    expect(seed(db, 'a new password').usersWritten).toBe(5);
    const operator = findUserByEmail(db, 'operator@bastion.demo')!;
    expect(verifyPassword('a new password', operator.passwordHash)).toBe(true);
    expect(verifyPassword(PASSWORD, operator.passwordHash)).toBe(false);
  });

  it('finds users by email case-insensitively and never exposes the hash publicly', () => {
    seed(db, PASSWORD);
    const user = findUserByEmail(db, '  Utility@Bastion.Demo ')!;
    expect(user.id).toBe('user-utility');
    expect(findUserById(db, 'user-utility')?.email).toBe('utility@bastion.demo');
    expect(findUserByEmail(db, 'nobody@bastion.demo')).toBeUndefined();

    const visible = toPublicUser(user);
    expect(visible).toEqual({
      id: 'user-utility',
      name: 'Priya Nair',
      email: 'utility@bastion.demo',
      role: 'utility_operator',
      authority: 'utility',
    });
    expect(JSON.stringify(visible)).not.toContain('scrypt');
  });

  it('seeds valid rules, one per authority and action kind', () => {
    seed(db, PASSWORD);
    const rules = listRules(db);
    for (const rule of rules) expect(() => RuleSchema.parse(rule)).not.toThrow();

    const keys = rules.map((rule) => `${rule.authority}/${rule.actionKind}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(findRuleFor(db, 'isolate_grid_section', 'utility')?.autonomy).toBe('auto');
    expect(findRuleFor(db, 'isolate_grid_section', 'ema')).toBeUndefined();
  });

  it('keeps the utility in charge of grid rules and people in charge of public alerts', () => {
    const gridRules = DEFAULT_RULES.filter((rule) => rule.actionKind.includes('grid_section'));
    expect(gridRules.every((rule) => rule.authority === 'utility')).toBe(true);
    expect(DEFAULT_RULES.find((rule) => rule.actionKind === 'issue_public_alert')?.autonomy).toBe(
      'approve',
    );
  });

  it('preserves rule edits across a reseed', () => {
    seed(db, PASSWORD);
    const updated = updateRule(db, 'rule-fire-dispatch', {
      autonomy: 'approve',
      params: { minSeverity: 5 },
    })!;
    expect(updated.autonomy).toBe('approve');
    expect(updated.params).toEqual({ minSeverity: 5, minConfidence: 0.7 });

    seed(db, PASSWORD);
    expect(findRule(db, 'rule-fire-dispatch')).toEqual(updated);
    expect(updateRule(db, 'rule-missing', { autonomy: 'off' })).toBeUndefined();
  });
});

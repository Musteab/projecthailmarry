import { describe, expect, it } from 'vitest';
import { can, PERMISSIONS } from './permissions';
import type { Authority, Role } from './primitives';
import { AuthoritySchema, RoleSchema } from './primitives';

const AUTHORITIES = AuthoritySchema.options;

/** The agreed matrix, written out independently of the implementation. */
const EXPECTED: Record<
  Role,
  { approve: Authority[]; rules: Authority[]; restoration: boolean; operate: boolean }
> = {
  admin: { approve: [...AUTHORITIES], rules: [...AUTHORITIES], restoration: true, operate: true },
  operator: {
    approve: ['ema', 'fire_rescue', 'ems'],
    rules: [],
    restoration: false,
    operate: true,
  },
  coordinator: { approve: ['public_works'], rules: [], restoration: true, operate: true },
  utility_operator: {
    approve: ['utility'],
    rules: ['utility'],
    restoration: false,
    operate: false,
  },
  observer: { approve: [], rules: [], restoration: false, operate: false },
};

describe('permission matrix', () => {
  it('covers every role', () => {
    expect(Object.keys(PERMISSIONS).sort()).toEqual([...RoleSchema.options].sort());
  });

  describe.each(RoleSchema.options)('%s', (role) => {
    const user = { role };

    it.each(AUTHORITIES)('approve and rules for %s', (authority) => {
      expect(can(user, 'approve', authority)).toBe(EXPECTED[role].approve.includes(authority));
      expect(can(user, 'rules', authority)).toBe(EXPECTED[role].rules.includes(authority));
    });

    it('restoration and operate', () => {
      expect(can(user, 'restoration')).toBe(EXPECTED[role].restoration);
      expect(can(user, 'operate')).toBe(EXPECTED[role].operate);
    });

    it('without an authority, answers "for at least one authority"', () => {
      expect(can(user, 'approve')).toBe(EXPECTED[role].approve.length > 0);
      expect(can(user, 'rules')).toBe(EXPECTED[role].rules.length > 0);
    });
  });

  it('keeps the separations the pitch depends on', () => {
    // The utility controls its own grid actions; the EOC operator does not.
    expect(can({ role: 'utility_operator' }, 'approve', 'utility')).toBe(true);
    expect(can({ role: 'operator' }, 'approve', 'utility')).toBe(false);
    // The utility operator cannot approve an ambulance assignment.
    expect(can({ role: 'utility_operator' }, 'approve', 'ems')).toBe(false);
    // Observers can never act.
    expect(can({ role: 'observer' }, 'operate')).toBe(false);
  });
});

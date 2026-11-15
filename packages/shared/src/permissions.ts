import type { Authority, Role, User } from './primitives';
import { AuthoritySchema } from './primitives';

/**
 * Who may do what. Enforced by the server and mirrored by the UI to enable or disable controls.
 *
 * Verbs:
 * - `approve`     approve, reject or override an action of the given authority
 * - `rules`       edit the rules of the given authority (everyone may read rules)
 * - `restoration` run restoration analysis, create and transition work orders
 * - `operate`     create and control operations, send injects
 */
export type PermissionVerb = 'approve' | 'rules' | 'restoration' | 'operate';

export interface RolePermissions {
  approve: readonly Authority[];
  rules: readonly Authority[];
  restoration: boolean;
  operate: boolean;
}

const ALL_AUTHORITIES: readonly Authority[] = AuthoritySchema.options;

export const PERMISSIONS: Record<Role, RolePermissions> = {
  admin: { approve: ALL_AUTHORITIES, rules: ALL_AUTHORITIES, restoration: true, operate: true },
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

/**
 * Returns whether the user may perform the verb.
 *
 * For `approve` and `rules`, pass the authority of the action or rule. If it is omitted the
 * answer is "for at least one authority", which is only suitable for showing or hiding a whole
 * section of UI; the server always passes the authority.
 */
export function can(
  user: Pick<User, 'role'>,
  verb: PermissionVerb,
  authority?: Authority,
): boolean {
  const permissions = PERMISSIONS[user.role];
  if (verb === 'restoration' || verb === 'operate') return permissions[verb];

  const allowed = permissions[verb];
  return authority === undefined ? allowed.length > 0 : allowed.includes(authority);
}

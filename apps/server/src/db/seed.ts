import type { Rule, User } from '@bastion/shared';
import { hashPassword, verifyPassword } from '../auth/password';
import type { Database } from './database';
import { transaction } from './database';
import { insertRuleIfAbsent } from './rules';
import { findUserById, upsertUser } from './users';

/** One demo account per role. They all share the password from SEED_DEMO_PASSWORD. */
export const DEMO_USERS: User[] = [
  {
    id: 'user-admin',
    name: 'Morgan Reyes',
    email: 'admin@bastion.demo',
    role: 'admin',
    authority: 'ema',
  },
  {
    id: 'user-operator',
    name: 'Dana Okafor',
    email: 'operator@bastion.demo',
    role: 'operator',
    authority: 'ema',
  },
  {
    id: 'user-coordinator',
    name: 'Sam Whitfield',
    email: 'coordinator@bastion.demo',
    role: 'coordinator',
    authority: 'public_works',
  },
  {
    id: 'user-utility',
    name: 'Priya Nair',
    email: 'utility@bastion.demo',
    role: 'utility_operator',
    authority: 'utility',
  },
  {
    id: 'user-observer',
    name: 'Jordan Lee',
    email: 'observer@bastion.demo',
    role: 'observer',
    authority: 'ema',
  },
];

type RuleSeed = Omit<Rule, 'updatedAt'>;

/**
 * The agency-approved rule set the platform starts with. One rule per (authority, action kind).
 *
 * `autonomy: 'auto'` lets the platform execute a proposal that meets the thresholds in `params`;
 * a proposal that falls short of them waits for a human instead. `approve` always waits.
 */
export const DEFAULT_RULES: RuleSeed[] = [
  {
    id: 'rule-fire-dispatch',
    authority: 'fire_rescue',
    name: 'Dispatch rescue to life-safety incidents',
    description:
      'Send the best available capable crew automatically when an incident is severe and well corroborated. Lower-severity or uncertain incidents wait for an operator.',
    actionKind: 'dispatch_unit',
    autonomy: 'auto',
    params: { minSeverity: 4, minConfidence: 0.7 },
    approvedBy: 'Regional Fire Chief, standing order FR-12',
  },
  {
    id: 'rule-fire-recall',
    authority: 'fire_rescue',
    name: 'Recall a dispatched unit',
    description: 'Recalling a unit that is already en route always needs an operator.',
    actionKind: 'recall_unit',
    autonomy: 'approve',
    params: {},
    approvedBy: 'Regional Fire Chief, standing order FR-12',
  },
  {
    id: 'rule-ems-ambulance',
    authority: 'ems',
    name: 'Assign ambulances to triaged calls',
    description:
      'Assign the nearest suitable ambulance automatically for the most urgent triage levels. Less urgent calls wait for the EMS dispatcher.',
    actionKind: 'assign_ambulance',
    autonomy: 'auto',
    params: { maxAcuity: 2, minConfidence: 0.6 },
    approvedBy: 'EMS Medical Director, protocol EMS-7',
  },
  {
    id: 'rule-ems-divert',
    authority: 'ems',
    name: 'Divert from a hospital on backup power',
    description:
      'Stop sending new patients to a hospital that has lost grid power or gone offline, and route them to the nearest functioning hospital.',
    actionKind: 'divert_hospital',
    autonomy: 'auto',
    params: { onBackupPower: true, onOffline: true },
    approvedBy: 'EMS Medical Director, protocol EMS-9',
  },
  {
    id: 'rule-ema-shelter',
    authority: 'ema',
    name: 'Activate a shelter',
    description:
      'Propose opening the nearest reachable shelter when displaced residents nearby exceed the threshold. The EOC operator confirms.',
    actionKind: 'activate_shelter',
    autonomy: 'approve',
    params: { displacedThreshold: 100, maxTravelMin: 15 },
    approvedBy: 'Emergency Management Director, plan annex ESF-6',
  },
  {
    id: 'rule-ema-alert',
    authority: 'ema',
    name: 'Issue a public alert',
    description: 'Public alerts are drafted by the platform and always released by a person.',
    actionKind: 'issue_public_alert',
    autonomy: 'approve',
    params: {},
    approvedBy: 'Emergency Management Director, plan annex ESF-15',
  },
  {
    id: 'rule-pw-closure',
    authority: 'public_works',
    name: 'Publish confirmed road closures',
    description:
      'Publish a closure automatically once a road is confirmed flooded past the depth threshold or structurally damaged.',
    actionKind: 'publish_road_closure',
    autonomy: 'auto',
    params: { floodDepthM: 0.3, requireConfirmed: true },
    approvedBy: 'Public Works Director, policy PW-3',
  },
  {
    id: 'rule-pw-work-order',
    authority: 'public_works',
    name: 'Issue a repair work order',
    description:
      'Work orders are created from a restoration option chosen by the recovery coordinator. The weights set how access gains are scored.',
    actionKind: 'create_work_order',
    autonomy: 'approve',
    params: { accessThresholdMin: 15, hospitalWeight: 1, shelterWeight: 0.5, isolationWeight: 1.5 },
    approvedBy: 'Public Works Director, policy PW-8',
  },
  {
    id: 'rule-utility-isolate',
    authority: 'utility',
    name: 'Isolate an endangered grid section',
    description:
      'De-energize a section automatically when water at its equipment or shaking along it reaches the threshold or is seconds from it. A section forecast to reach it within the lead time is flagged as threatened.',
    actionKind: 'isolate_grid_section',
    autonomy: 'auto',
    params: { floodDepthM: 0.5, shakeMMI: 8, leadTimeMin: 5 },
    approvedBy: 'Utility Operations Manager, switching rule SW-21',
  },
  {
    id: 'rule-utility-restore',
    authority: 'utility',
    name: 'Re-energize an isolated section',
    description:
      'Propose restoring a section once the threat has been clear for the hold period. A utility operator confirms.',
    actionKind: 'restore_grid_section',
    autonomy: 'approve',
    params: { clearForMin: 10 },
    approvedBy: 'Utility Operations Manager, switching rule SW-22',
  },
];

export interface SeedResult {
  usersWritten: number;
  rulesInserted: number;
}

/**
 * Makes sure the demo accounts and default rules exist. Safe to run on every boot:
 * - a user is rewritten only when missing, changed, or when the demo password changed;
 * - a rule is inserted only when its id is new, so edits made in the rules console survive.
 */
export function seed(db: Database, demoPassword: string): SeedResult {
  return transaction(db, () => {
    let usersWritten = 0;
    for (const user of DEMO_USERS) {
      const existing = findUserById(db, user.id);
      const unchanged =
        existing !== undefined &&
        existing.email === user.email &&
        existing.name === user.name &&
        existing.role === user.role &&
        existing.authority === user.authority &&
        verifyPassword(demoPassword, existing.passwordHash);
      if (unchanged) continue;
      upsertUser(db, { ...user, passwordHash: hashPassword(demoPassword) });
      usersWritten++;
    }

    const updatedAt = new Date().toISOString();
    let rulesInserted = 0;
    for (const rule of DEFAULT_RULES) {
      if (insertRuleIfAbsent(db, { ...rule, updatedAt })) rulesInserted++;
    }

    return { usersWritten, rulesInserted };
  });
}

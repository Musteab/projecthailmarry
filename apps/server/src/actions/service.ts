import type {
  Action,
  ActionKind,
  ActionPayload,
  ActionStatus,
  Authority,
  DecisionExplain,
  Rule,
  User,
} from '@bastion/shared';
import { badRequest, conflict, notFound } from '../errors';
import type { OperationRuntime, System } from '../sim/runtime';

/** A proposal waiting for a human is withdrawn after this long with no decision. */
const APPROVAL_TTL_SEC = 600;
/** After a person turns a proposal down, the platform does not make the same one again this soon. */
const REPROPOSE_AFTER_SEC = 300;

/** What the rule thresholds are checked against. */
export interface ProposalFacts {
  severity?: number;
  confidence?: number;
  /** triage acuity, 1 = most urgent */
  acuity?: number;
}

export interface ActionDraft {
  kind: ActionKind;
  payload: ActionPayload;
  explain: DecisionExplain;
  facts?: ProposalFacts;
  /**
   * Identifies what the proposal is for (e.g. `dispatch:inc-3:swift_water`). While a proposal
   * with this key is waiting, a second one is not created.
   */
  key: string;
}

/** A message the platform would send to an outside system. Only produced in live operations. */
export interface OutboxMessage {
  simTime: number;
  channel: 'cad' | 'public' | 'scada';
  actionId: string;
  summary: string;
}

export interface AuditRecord {
  simTime: number;
  actor: string;
  verb: string;
  actionId?: string;
  detail: string;
}

type Executor = (rt: OperationRuntime, action: Action) => string | null;

const OUTBOX_CHANNEL: Partial<Record<ActionKind, OutboxMessage['channel']>> = {
  dispatch_unit: 'cad',
  assign_ambulance: 'cad',
  recall_unit: 'cad',
  divert_hospital: 'cad',
  activate_shelter: 'public',
  publish_road_closure: 'public',
  issue_public_alert: 'public',
  isolate_grid_section: 'scada',
  restore_grid_section: 'scada',
};

/** Which agency an action belongs to. */
export function authorityOf(rt: OperationRuntime, payload: ActionPayload): Authority {
  switch (payload.kind) {
    case 'dispatch_unit':
    case 'assign_ambulance':
    case 'recall_unit': {
      const unit = rt.world.units[payload.unitId];
      if (!unit) throw badRequest(`Unknown unit "${payload.unitId}"`);
      return unit.authority;
    }
    case 'activate_shelter':
    case 'issue_public_alert':
      return 'ema';
    case 'publish_road_closure':
    case 'create_work_order':
      return 'public_works';
    case 'isolate_grid_section':
    case 'restore_grid_section':
      return 'utility';
    case 'divert_hospital':
      return 'ems';
  }
}

/**
 * How a rule treats a proposal: `auto` lets the platform act, `approve` holds it for a person,
 * `off` means the agency does not want it proposed at all. An `auto` rule still holds a
 * proposal that falls short of its thresholds.
 */
export function decideAutonomy(
  rule: Rule | undefined,
  facts: ProposalFacts = {},
): 'auto' | 'approve' | 'off' {
  if (!rule) return 'approve';
  if (rule.autonomy !== 'auto') return rule.autonomy;

  const { minSeverity, minConfidence, maxAcuity } = rule.params;
  if (typeof minSeverity === 'number' && (facts.severity ?? 0) < minSeverity) return 'approve';
  if (typeof minConfidence === 'number' && (facts.confidence ?? 0) < minConfidence)
    return 'approve';
  if (typeof maxAcuity === 'number') {
    // Without a triage result, only the most severe calls are treated as urgent enough.
    const acuity = facts.acuity ?? ((facts.severity ?? 0) >= 4 ? 2 : 5);
    if (acuity > maxAcuity) return 'approve';
  }
  return 'auto';
}

const EXECUTORS: Partial<Record<ActionKind, Executor>> = {
  dispatch_unit: (rt, action) => {
    const p = action.payload as Extract<ActionPayload, { kind: 'dispatch_unit' }>;
    return rt.units.dispatchToIncident(p.unitId, p.incidentId)
      ? null
      : 'The unit is no longer available or cannot reach the incident';
  },
  assign_ambulance: (rt, action) => {
    const p = action.payload as Extract<ActionPayload, { kind: 'assign_ambulance' }>;
    return rt.units.dispatchToIncident(p.unitId, p.incidentId, p.hospitalId)
      ? null
      : 'The ambulance is no longer available or cannot reach the patient';
  },
  recall_unit: (rt, action) => {
    const p = action.payload as Extract<ActionPayload, { kind: 'recall_unit' }>;
    if (!rt.world.units[p.unitId]) return 'Unknown unit';
    rt.units.release(p.unitId);
    return null;
  },
  activate_shelter: (rt, action) => {
    const p = action.payload as Extract<ActionPayload, { kind: 'activate_shelter' }>;
    const state = rt.world.facilities[p.facilityId];
    const facility = rt.index.facilityById.get(p.facilityId);
    if (!state || facility?.kind !== 'shelter') return 'Not a shelter';
    if (state.status === 'offline') return 'The shelter is offline';
    rt.world.setFacility(p.facilityId, {
      ...state,
      activated: true,
      occupancy: state.occupancy ?? 0,
    });
    return null;
  },
  publish_road_closure: (rt, action) => {
    const p = action.payload as Extract<ActionPayload, { kind: 'publish_road_closure' }>;
    let published = 0;
    for (const edgeId of p.edgeIds) {
      const state = rt.world.roads[edgeId];
      if (!state || state.closurePublished) continue;
      rt.setRoadState(edgeId, { ...state, closurePublished: true });
      published++;
    }
    return published > 0 ? null : 'None of these roads is closed any more';
  },
  divert_hospital: (rt, action) => {
    const p = action.payload as Extract<ActionPayload, { kind: 'divert_hospital' }>;
    const state = rt.world.facilities[p.facilityId];
    if (!state || rt.index.facilityById.get(p.facilityId)?.kind !== 'hospital')
      return 'Not a hospital';
    rt.world.setFacility(p.facilityId, { ...state, onDivert: true });
    return null;
  },
  issue_public_alert: () => null,
  isolate_grid_section: (rt, action) => {
    const p = action.payload as Extract<ActionPayload, { kind: 'isolate_grid_section' }>;
    return rt.grid.isolate(p.sectionId);
  },
  restore_grid_section: (rt, action) => {
    const p = action.payload as Extract<ActionPayload, { kind: 'restore_grid_section' }>;
    return rt.grid.restore(p.sectionId);
  },
  create_work_order: (rt, action) => {
    const p = action.payload as Extract<ActionPayload, { kind: 'create_work_order' }>;
    const created = rt.workOrders.createFromOption(p.optionId, action.decidedBy ?? 'platform');
    return typeof created === 'string' ? created : null;
  },
};

/**
 * The one pipeline every action goes through:
 * proposed -> (awaiting_approval | approved) -> executed, or rejected / overridden / expired / failed.
 * It applies the agency rules, executes, records an audit entry for every transition, and in a
 * live operation writes the message an outside system would receive. In an exercise nothing
 * leaves the sandbox.
 */
export class ActionService {
  readonly outbox: OutboxMessage[] = [];
  private readonly waitingByKey = new Map<string, string>();
  private readonly keyByAction = new Map<string, string>();
  private rules: Rule[] = [];
  /** Proposal keys a person has just said no to, and when they may be raised again. */
  private readonly declinedUntil = new Map<string, number>();

  constructor(
    private readonly rt: OperationRuntime,
    private readonly audit: (record: AuditRecord) => void,
  ) {}

  /** The rules in force. Replaced whenever an agency edits one. */
  setRules(rules: Rule[]): void {
    this.rules = rules;
  }

  ruleFor(kind: ActionKind, authority: Authority): Rule | undefined {
    return this.rules.find((rule) => rule.actionKind === kind && rule.authority === authority);
  }

  /** The proposal with this key that is still waiting for a decision, if any. */
  waiting(key: string): Action | undefined {
    const id = this.waitingByKey.get(key);
    return id ? this.rt.world.actions[id] : undefined;
  }

  private record(action: Action, verb: string, actor: string, detail: string): void {
    this.audit({ simTime: this.rt.simTime, actor, verb, actionId: action.id, detail });
  }

  private save(action: Action): Action {
    this.rt.world.setAction(action);
    if (action.status !== 'awaiting_approval') {
      const key = this.keyByAction.get(action.id);
      if (key && this.waitingByKey.get(key) === action.id) this.waitingByKey.delete(key);
    }
    return action;
  }

  private create(
    payload: ActionPayload,
    explain: DecisionExplain,
    initiator: Action['initiator'],
    extra: Partial<Action> = {},
  ): Action {
    const { rt } = this;
    return {
      id: rt.world.nextId('act'),
      operationId: rt.operation.id,
      kind: payload.kind,
      authority: authorityOf(rt, payload),
      status: 'proposed',
      payload,
      initiator,
      explain,
      sandboxed: rt.sandboxed,
      proposedAt: rt.simTime,
      ...extra,
    };
  }

  private execute(action: Action, decidedBy: string): Action {
    const { rt } = this;
    const executor = EXECUTORS[action.kind];
    const failure = executor
      ? executor(rt, { ...action, decidedBy })
      : `No executor for ${action.kind}`;
    const done: Action = {
      ...action,
      status: failure ? 'failed' : 'executed',
      decidedBy,
      decidedAt: action.decidedAt ?? rt.simTime,
      ...(failure ? { rejectReason: failure } : { executedAt: rt.simTime }),
    };
    this.save(done);

    if (failure) {
      this.record(done, 'action.failed', decidedBy, failure);
      rt.event({
        kind: 'action.failed',
        severity: 'warn',
        title: `Could not carry out: ${action.explain.headline}`,
        detail: failure,
        refs: { actionId: action.id },
      });
      return done;
    }

    this.record(done, 'action.executed', decidedBy, action.explain.headline);
    rt.event({
      kind: 'action.executed',
      severity: 'info',
      title: `${decidedBy === 'auto' ? 'Auto' : 'Approved'}: ${action.explain.headline}`,
      refs: { actionId: action.id },
    });
    const channel = OUTBOX_CHANNEL[action.kind];
    if (channel && !action.sandboxed) {
      this.outbox.push({
        simTime: rt.simTime,
        channel,
        actionId: action.id,
        summary: action.explain.headline,
      });
    }
    return done;
  }

  /**
   * Called by the platform's own engines. Applies the agency rule: executes straight away, holds
   * the proposal for a person, or drops it. Returns null when dropped or already waiting.
   */
  propose(draft: ActionDraft): Action | null {
    if (this.waiting(draft.key)) return null;
    if ((this.declinedUntil.get(draft.key) ?? -Infinity) > this.rt.simTime) return null;
    let action = this.create(draft.payload, draft.explain, 'platform');
    const rule = this.ruleFor(action.kind, action.authority);
    const autonomy = decideAutonomy(rule, draft.facts);
    if (autonomy === 'off') return null;
    if (rule) action = { ...action, ruleId: rule.id };

    if (autonomy === 'auto') {
      this.keyByAction.set(action.id, draft.key);
      return this.execute(action, 'auto');
    }

    const held = this.save({ ...action, status: 'awaiting_approval' });
    this.waitingByKey.set(draft.key, held.id);
    this.keyByAction.set(held.id, draft.key);
    this.record(held, 'action.awaiting_approval', 'platform', held.explain.headline);
    this.rt.event({
      kind: 'action.awaiting_approval',
      severity: 'warn',
      title: `Needs approval: ${held.explain.headline}`,
      refs: { actionId: held.id },
    });
    return held;
  }

  private decline(actionId: string): void {
    const key = this.keyByAction.get(actionId);
    if (key) this.declinedUntil.set(key, this.rt.simTime + REPROPOSE_AFTER_SEC);
  }

  private require(actionId: string, ...allowed: ActionStatus[]): Action {
    const action = this.rt.world.actions[actionId];
    if (!action) throw notFound(`Action "${actionId}"`);
    if (!allowed.includes(action.status)) {
      throw conflict(
        `This action is ${action.status.replace('_', ' ')} and cannot be changed that way`,
        {
          status: action.status,
        },
      );
    }
    return action;
  }

  approve(actionId: string, user: User): Action {
    const action = this.require(actionId, 'awaiting_approval');
    this.record(action, 'action.approved', user.id, action.explain.headline);
    return this.execute({ ...action, status: 'approved', decidedAt: this.rt.simTime }, user.id);
  }

  reject(actionId: string, user: User, reason: string): Action {
    const action = this.require(actionId, 'awaiting_approval');
    const rejected = this.save({
      ...action,
      status: 'rejected',
      decidedBy: user.id,
      decidedAt: this.rt.simTime,
      rejectReason: reason,
    });
    this.decline(action.id);
    this.record(rejected, 'action.rejected', user.id, reason);
    this.rt.event({
      kind: 'action.rejected',
      severity: 'info',
      title: `Rejected: ${action.explain.headline}`,
      detail: reason,
      refs: { actionId },
    });
    return rejected;
  }

  /**
   * An operator overrules the platform: the action is undone where it can be (a dispatched unit
   * is recalled, a published closure withdrawn, an isolated section restored) and, optionally,
   * replaced by the operator's own choice, which executes at once.
   */
  override(
    actionId: string,
    user: User,
    reason: string,
    replacement?: ActionPayload,
  ): { overridden: Action; replacement?: Action } {
    const { rt } = this;
    const action = this.require(actionId, 'awaiting_approval', 'executed');

    if (action.status === 'executed') {
      const p = action.payload;
      if (p.kind === 'dispatch_unit' || p.kind === 'assign_ambulance') rt.units.release(p.unitId);
      if (p.kind === 'isolate_grid_section') rt.grid.restore(p.sectionId);
      if (p.kind === 'divert_hospital') {
        const state = rt.world.facilities[p.facilityId];
        if (state) rt.world.setFacility(p.facilityId, { ...state, onDivert: false });
      }
      if (p.kind === 'activate_shelter') {
        const state = rt.world.facilities[p.facilityId];
        if (state) rt.world.setFacility(p.facilityId, { ...state, activated: false });
      }
      if (p.kind === 'publish_road_closure') {
        for (const edgeId of p.edgeIds) {
          const state = rt.world.roads[edgeId];
          if (state) rt.setRoadState(edgeId, { ...state, closurePublished: false });
        }
      }
    }

    const overridden = this.save({
      ...action,
      status: 'overridden',
      decidedBy: user.id,
      decidedAt: rt.simTime,
      rejectReason: reason,
    });
    this.decline(action.id);
    this.record(overridden, 'action.overridden', user.id, reason);
    rt.event({
      kind: 'action.overridden',
      severity: 'warn',
      title: `Overridden by ${user.name}: ${action.explain.headline}`,
      detail: reason,
      refs: { actionId },
    });
    if (!replacement) return { overridden };

    const created = this.byOperator(replacement, user, { overrideOf: action.id });
    return { overridden, replacement: created };
  }

  /** An action an operator takes on their own initiative. Executes at once. */
  byOperator(payload: ActionPayload, user: User, extra: Partial<Action> = {}): Action {
    const explain: DecisionExplain = {
      headline: describe(this.rt, payload),
      factors: [{ label: 'Decided by', value: `${user.name} (${user.role})` }],
      alternatives: [],
      confidence: 1,
    };
    const action = this.create(payload, explain, 'operator', {
      ...extra,
      decidedAt: this.rt.simTime,
    });
    this.record(action, 'action.created', user.id, explain.headline);
    return this.execute(action, user.id);
  }

  /** Withdraws a waiting proposal because it no longer makes sense. */
  withdraw(actionId: string, reason: string): void {
    const action = this.rt.world.actions[actionId];
    if (!action || action.status !== 'awaiting_approval') return;
    const expired = this.save({ ...action, status: 'expired', decidedAt: this.rt.simTime });
    this.record(expired, 'action.expired', 'platform', reason);
  }

  /** Withdraws proposals nobody decided in time or whose reason has gone away. */
  system(): System {
    return {
      name: 'actions',
      update: (rt) => {
        for (const [key, id] of [...this.waitingByKey]) {
          const action = rt.world.actions[id];
          if (!action || action.status !== 'awaiting_approval') {
            this.waitingByKey.delete(key);
            continue;
          }
          const stale = rt.simTime - action.proposedAt > APPROVAL_TTL_SEC;
          const moot = isMoot(rt, action);
          if (!stale && !moot) continue;
          const expired = this.save({ ...action, status: 'expired', decidedAt: rt.simTime });
          this.record(
            expired,
            'action.expired',
            'platform',
            moot ? 'No longer needed' : 'No decision in time',
          );
        }
      },
    };
  }
}

/** A waiting proposal whose subject has been dealt with, or whose unit has gone elsewhere. */
function isMoot(rt: OperationRuntime, action: Action): boolean {
  const p = action.payload;
  if (p.kind === 'dispatch_unit' || p.kind === 'assign_ambulance') {
    const incident = rt.world.incidents[p.incidentId];
    const unit = rt.world.units[p.unitId];
    if (!incident || incident.status === 'resolved' || incident.status === 'closed') return true;
    return !unit || !rt.units.isAvailable(unit);
  }
  if (p.kind === 'publish_road_closure')
    return p.edgeIds.every((edgeId) => !rt.world.roads[edgeId]);
  if (p.kind === 'isolate_grid_section') {
    return rt.world.gridSections[p.sectionId]?.status !== 'energized';
  }
  return false;
}

function describe(rt: OperationRuntime, payload: ActionPayload): string {
  const unit = 'unitId' in payload ? rt.world.units[payload.unitId]?.callsign : undefined;
  const facility =
    'facilityId' in payload ? rt.index.facilityById.get(payload.facilityId)?.name : undefined;
  switch (payload.kind) {
    case 'dispatch_unit':
    case 'assign_ambulance':
      return `${unit ?? payload.unitId} sent to ${rt.world.incidents[payload.incidentId]?.title ?? payload.incidentId}`;
    case 'recall_unit':
      return `${unit ?? payload.unitId} recalled`;
    case 'activate_shelter':
      return `Shelter activated: ${facility ?? payload.facilityId}`;
    case 'divert_hospital':
      return `Ambulances diverted from ${facility ?? payload.facilityId}`;
    case 'publish_road_closure':
      return `Road closure published (${payload.edgeIds.length} segments): ${payload.reason}`;
    case 'isolate_grid_section':
      return `Grid section ${payload.sectionId} isolated`;
    case 'restore_grid_section':
      return `Grid section ${payload.sectionId} re-energized`;
    case 'issue_public_alert':
      return `Public alert: ${payload.headline}`;
    case 'create_work_order':
      return `Work order issued for ${payload.optionId}`;
  }
}

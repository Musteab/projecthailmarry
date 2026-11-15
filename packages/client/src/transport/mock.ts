import {
  ActionPayloadSchema,
  ControlRequestSchema,
  CreateOperationRequestSchema,
  InjectSchema,
  LoginRequestSchema,
  UpdateRuleRequestSchema,
  makeInitialWorld,
  ScenarioSummarySchema,
} from '@bastion/shared';
import type {
  Action,
  ActionPayload,
  Authority,
  Briefing,
  Inject,
  LngLat,
  Operation,
  Rule,
  ServerMessage,
  Unit,
  WorldSnapshot,
  WorkOrder,
  WorkOrderStatus,
  RestorationAnalysis,
} from '@bastion/shared';
import { loadRegionMini, loadScenarioMini } from '@bastion/shared/fixtures';
import { unitPositionAt } from '../helpers';
import { ApiError } from './index';
import type { Connection, Method, Transport } from './index';

/** A local UI fixture, not the hazard/routing engine. Never calls an external service. */
export class MockTransport implements Transport {
  readonly region = loadRegionMini();
  readonly scenario = loadScenarioMini();
  world: WorldSnapshot;
  private sequence = 0;
  private listeners = new Set<(message: ServerMessage) => void>();
  private timer?: ReturnType<typeof setInterval>;
  private lastTick = 0;
  private speed = 5;
  private rules: Rule[] = [
    {
      id: 'mock-utility',
      authority: 'utility',
      name: 'Mock feeder protection',
      description: 'Exercise-only approval rule',
      actionKind: 'isolate_grid_section',
      autonomy: 'approve',
      params: { floodDepthM: 0.3 },
      approvedBy: 'mock-admin',
      updatedAt: new Date(0).toISOString(),
    },
  ];

  constructor() {
    this.world = this.seed(this.operation());
  }
  private id(prefix: string) {
    return `mock-${prefix}-${++this.sequence}`;
  }
  private operation(): Operation {
    return {
      id: this.id('operation'),
      regionId: this.region.config.id,
      scenarioId: this.scenario.id,
      mode: 'exercise',
      name: 'Mock v0 · Portland exercise',
      status: 'ready',
      createdBy: 'mock-admin',
      createdAt: new Date(0).toISOString(),
    };
  }
  private seed(operation: Operation): WorldSnapshot {
    const world = makeInitialWorld(operation, this.region, {
      durationSimSec: this.scenario.durationSimSec,
    });
    const incidentId = 'mock-rescue';
    world.incidents[incidentId] = {
      id: incidentId,
      kind: 'water_rescue',
      title: 'Exercise: residents stranded by rising water',
      position: this.region.cells[0].center,
      cellId: this.region.cells[0].id,
      severity: 4,
      status: 'confirmed',
      confidence: 0.92,
      peopleAffected: 12,
      sourceSignalIds: [],
      requiredCapabilities: ['swift_water'],
      assignedUnitIds: [],
      openedAt: 0,
    };
    Object.values(world.units)
      .slice(0, 3)
      .forEach((unit, i) => {
        const edge = this.region.edges[i];
        const route: LngLat[] = [...edge.geometry, ...edge.geometry.slice(0, -1).reverse()];
        world.units[unit.id] = {
          ...unit,
          position: route[0],
          status: 'en_route',
          assignment: {
            targetType: 'incident',
            targetId: incidentId,
            destination: route.at(-1)!,
            route,
            routeEdgeIds: [edge.id],
            departedSimTime: 0,
            etaSimTime: 60 + i * 20,
          },
        };
      });
    const sectionId = this.region.grid.sections[0].id;
    world.gridSections[sectionId].threatened = true;
    const payload: ActionPayload = { kind: 'isolate_grid_section', sectionId };
    const action = this.action(payload, world);
    world.actions[action.id] = action;
    world.metrics = { ...world.metrics, activeIncidents: 1, peopleAtRisk: 12, unitsDeployed: 3 };
    return world;
  }
  private action(payload: ActionPayload, world = this.world): Action {
    const authority: Authority = payload.kind.includes('grid')
      ? 'utility'
      : payload.kind === 'assign_ambulance'
        ? 'ems'
        : payload.kind === 'dispatch_unit'
          ? 'fire_rescue'
          : payload.kind === 'create_work_order'
            ? 'public_works'
            : 'ema';
    return {
      id: this.id('action'),
      operationId: world.operation.id,
      kind: payload.kind,
      payload,
      authority,
      status: 'awaiting_approval',
      initiator: 'operator',
      sandboxed: true,
      proposedAt: world.clock.simTime,
      explain: {
        headline: 'Mock exercise action',
        factors: [{ label: 'Source', value: 'Local fixture' }],
        alternatives: [],
        confidence: 1,
      },
    };
  }
  private snapshot() {
    for (const listener of this.listeners)
      listener({ t: 'snapshot', world: structuredClone(this.world) });
  }
  private event(title: string) {
    this.world.timeline = [
      ...this.world.timeline,
      {
        id: this.id('event'),
        simTime: this.world.clock.simTime,
        kind: 'mock.command',
        severity: 'info' as const,
        title,
      },
    ].slice(-500);
  }
  /** Advance explicitly in tests; connected previews advance every 250 ms. */
  advance(seconds: number) {
    if (this.world.operation.status !== 'running') return;
    const clock = this.world.clock;
    const simTime = Math.min(
      clock.simTime + Math.max(0, seconds) * clock.speed,
      clock.durationSimSec ?? Infinity,
    );
    this.world.clock = { ...clock, simTime };
    const units: Record<string, Unit> = {};
    for (const unit of Object.values(this.world.units)) {
      if (!unit.assignment || !['en_route', 'returning', 'transporting'].includes(unit.status))
        continue;
      const assignment = { ...unit.assignment };
      const duration = assignment.etaSimTime - assignment.departedSimTime;
      if (duration > 0 && simTime >= assignment.etaSimTime) {
        const loops = Math.floor((simTime - assignment.departedSimTime) / duration);
        assignment.departedSimTime += loops * duration;
        assignment.etaSimTime += loops * duration;
      }
      const moving = { ...unit, assignment };
      units[unit.id] = { ...moving, ...unitPositionAt(moving, this.world.clock, 0) };
    }
    this.world.units = { ...this.world.units, ...units };
    if (simTime === clock.durationSimSec) {
      this.world.clock = { ...this.world.clock, speed: 0 };
      this.world.operation = { ...this.world.operation, status: 'ended' };
    }
    for (const listener of this.listeners)
      listener({
        t: 'tick',
        clock: { ...this.world.clock },
        patch: { units: structuredClone(units), operation: { ...this.world.operation } },
      });
  }
  connect(
    operationId: string,
    onMessage: (message: ServerMessage) => void,
    onConnection?: (state: Connection) => void,
  ) {
    if (operationId !== this.world.operation.id)
      throw new ApiError(404, 'not_found', 'Unknown mock operation');
    this.listeners.add(onMessage);
    onConnection?.('mock');
    onMessage({ t: 'snapshot', world: structuredClone(this.world) });
    if (!this.timer) {
      this.lastTick = Date.now();
      this.timer = setInterval(() => {
        const now = Date.now();
        this.advance((now - this.lastTick) / 1000);
        this.lastTick = now;
      }, 250);
    }
    return () => {
      this.listeners.delete(onMessage);
      if (!this.listeners.size) {
        clearInterval(this.timer);
        this.timer = undefined;
      }
      onConnection?.('idle');
    };
  }
  private required<T>(value: T | undefined): T {
    if (!value) throw new ApiError(404, 'not_found', 'Mock entity does not exist');
    return value;
  }
  private applyPayload(payload: ActionPayload) {
    const w = this.world;
    switch (payload.kind) {
      case 'isolate_grid_section':
      case 'restore_grid_section': {
        const state = this.required(w.gridSections[payload.sectionId]);
        const section = this.required(
          this.region.grid.sections.find((s) => s.id === payload.sectionId),
        );
        const isolated = payload.kind === 'isolate_grid_section';
        w.gridSections[payload.sectionId] = {
          ...state,
          status: isolated ? 'isolated' : 'energized',
          customersOut: isolated ? section.customers : 0,
        };
        break;
      }
      case 'activate_shelter':
      case 'divert_hospital': {
        const state = this.required(w.facilities[payload.facilityId]);
        w.facilities[payload.facilityId] = {
          ...state,
          ...(payload.kind === 'activate_shelter' ? { activated: true } : { onDivert: true }),
        };
        break;
      }
      case 'publish_road_closure':
        for (const id of payload.edgeIds) this.required(this.region.edges.find((e) => e.id === id));
        for (const id of payload.edgeIds)
          w.roads[id] = { status: 'closed', reason: payload.reason, closurePublished: true };
        break;
      case 'dispatch_unit':
      case 'assign_ambulance': {
        const unit = this.required(w.units[payload.unitId]);
        const incident = this.required(w.incidents[payload.incidentId]);
        w.units[unit.id] = {
          ...unit,
          status: 'en_route',
          assignment: {
            targetType: 'incident',
            targetId: incident.id,
            destination: incident.position,
            route: [unit.position, incident.position],
            routeEdgeIds: [],
            departedSimTime: w.clock.simTime,
            etaSimTime: w.clock.simTime + 120,
          },
        };
        w.incidents[incident.id] = {
          ...incident,
          status: 'assigned',
          assignedUnitIds: [...new Set([...incident.assignedUnitIds, unit.id])],
        };
        break;
      }
      case 'recall_unit': {
        const unit = this.required(w.units[payload.unitId]);
        w.units[unit.id] = { ...unit, assignment: undefined, status: 'available' };
        break;
      }
      case 'create_work_order':
        this.createWorkOrder(payload.optionId);
        break;
      case 'issue_public_alert':
        this.event(`Exercise alert: ${payload.headline}`);
        break;
    }
    w.metrics = {
      ...w.metrics,
      customersOut: Object.values(w.gridSections).reduce((sum, s) => sum + s.customersOut, 0),
      roadsClosed: Object.keys(w.roads).length,
      sheltersOpen: Object.values(w.facilities).filter((f) => f.activated).length,
    };
  }
  private inject(input: Inject) {
    const w = this.world;
    switch (input.kind) {
      case 'set_road_status':
        for (const id of input.edgeIds) this.required(this.region.edges.find((e) => e.id === id));
        for (const id of input.edgeIds) {
          if (input.status === 'open') delete w.roads[id];
          else
            w.roads[id] = { status: input.status, reason: input.reason, closurePublished: false };
        }
        break;
      case 'damage_bridge': {
        const bridge = this.required(this.region.bridges.find((b) => b.id === input.bridgeId));
        for (const id of bridge.edgeIds)
          w.roads[id] = {
            status: input.severity === 'restricted' ? 'damaged' : 'closed',
            closurePublished: false,
          };
        break;
      }
      case 'facility_offline':
      case 'facility_power_loss': {
        const state = this.required(w.facilities[input.facilityId]);
        w.facilities[input.facilityId] = {
          ...state,
          ...(input.kind === 'facility_offline'
            ? { status: 'offline' as const }
            : {
                power: input.backupFuelMin ? ('backup' as const) : ('none' as const),
                backupFuelMin: input.backupFuelMin,
              }),
        };
        break;
      }
      case 'grid_fault': {
        const section = this.required(w.gridSections[input.sectionId]);
        w.gridSections[input.sectionId] = { ...section, status: 'faulted' };
        break;
      }
      case 'unit_out_of_service': {
        const unit = this.required(w.units[input.unitId]);
        w.units[input.unitId] = { ...unit, status: 'out_of_service', assignment: undefined };
        break;
      }
      case 'spawn_incident': {
        const incident = {
          id: this.id('incident'),
          cellId: this.region.cells[0].id,
          confidence: 1,
          status: 'confirmed' as const,
          sourceSignalIds: [],
          requiredCapabilities: [],
          assignedUnitIds: [],
          openedAt: w.clock.simTime,
          ...input.incident,
        };
        w.incidents[incident.id] = incident;
        break;
      }
    }
  }
  private analyze(): RestorationAnalysis {
    const edgeIds = Object.keys(this.world.roads);
    const candidates = edgeIds.map((id, i) => ({
      id: `mock-candidate-${i}`,
      kind: 'debris_clearance' as const,
      label: `Exercise clearance ${i + 1}`,
      edgeIds: [id],
      position: this.region.edges.find((e) => e.id === id)!.geometry[0],
      estCrewHours: 2,
      crewsRequired: 1,
    }));
    return {
      computedAt: this.world.clock.simTime,
      accessThresholdMin: 15,
      baseline: { isolatedPop: 0, noHospitalAccessPop: 0, noShelterAccessPop: 0 },
      candidates,
      options: candidates.map((c, i) => ({
        id: `mock-option-${i}`,
        candidateIds: [c.id],
        label: c.label,
        rank: i + 1,
        score: 0,
        estHours: 2,
        rationale: 'Mock option; access analysis is supplied by the server.',
        impact: {
          hospitalAccessPop: 0,
          shelterAccessPop: 0,
          isolatedPopReconnected: 0,
          avgHospitalMinBefore: null,
          avgHospitalMinAfter: null,
          facilitiesReconnected: [],
        },
      })),
      recommendedOptionId: candidates.length ? 'mock-option-0' : null,
    };
  }
  private createWorkOrder(optionId: string): WorkOrder {
    const option = this.required(this.world.restoration?.options.find((o) => o.id === optionId));
    const order: WorkOrder = {
      id: this.id('work-order'),
      operationId: this.world.operation.id,
      optionId,
      candidateId: option.candidateIds[0],
      title: option.label,
      status: 'created',
      assignedUnitIds: [],
      progress: 0,
      history: [{ status: 'created', at: this.world.clock.simTime, by: 'mock-admin' }],
    };
    this.world.workOrders[order.id] = order;
    return order;
  }
  async request<T>(method: Method, path: string, body?: unknown): Promise<T> {
    const result = this.handle(method, path, body);
    if (method !== 'GET' && path !== '/api/auth/login') {
      this.event(`${method} ${path}`);
      this.snapshot();
    }
    return structuredClone(result) as T;
  }
  private handle(method: Method, path: string, body?: unknown): unknown {
    const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
    const [_, resource, id, verb] = parts;
    const input = (body ?? {}) as Record<string, unknown>;
    if (path === '/api/auth/login' && method === 'POST') {
      const credentials = LoginRequestSchema.parse(body);
      return {
        token: 'mock-local-only',
        user: {
          id: 'mock-admin',
          name: 'Exercise operator',
          email: credentials.email,
          role: 'admin',
          authority: 'ema',
        },
      };
    }
    if (path === '/api/auth/me' && method === 'GET')
      return {
        id: 'mock-admin',
        name: 'Exercise operator',
        email: 'demo@bastion.test',
        role: 'admin',
        authority: 'ema',
      };
    if (
      resource === 'regions' &&
      method === 'GET' &&
      id === this.region.config.id &&
      verb === 'static'
    )
      return this.region;
    if (path === '/api/scenarios' && method === 'GET')
      return [ScenarioSummarySchema.parse(this.scenario)];
    if (resource === 'operations') {
      if (method === 'POST' && !id) {
        const data = CreateOperationRequestSchema.parse(body);
        if (data.mode !== 'exercise')
          throw new ApiError(
            400,
            'mock_exercise_only',
            'The mock supports exercise operations only',
          );
        if (data.regionId !== this.region.config.id || data.scenarioId !== this.scenario.id)
          throw new ApiError(404, 'not_found', 'Unknown mock region or scenario');
        this.world = this.seed({
          ...this.operation(),
          ...data,
          name: data.name || 'Mock v0 · Portland exercise',
        });
        return this.world.operation;
      }
      if (id !== this.world.operation.id)
        throw new ApiError(404, 'not_found', 'Unknown mock operation');
      if (!verb && method === 'GET') return this.world;
      if (verb === 'control' && method === 'POST') {
        const control = ControlRequestSchema.parse(body);
        if (control.command === 'reset')
          this.world = this.seed({ ...this.world.operation, status: 'ready' });
        else if (control.command === 'speed') {
          this.speed = control.speed;
          this.world.clock.speed = this.world.operation.status === 'running' ? control.speed : 0;
        } else {
          this.world.operation.status =
            control.command === 'end'
              ? 'ended'
              : control.command === 'pause'
                ? 'paused'
                : 'running';
          this.world.clock.speed = this.world.operation.status === 'running' ? this.speed : 0;
        }
        this.lastTick = Date.now();
        return this.world.operation;
      }
      if (verb === 'injects' && method === 'POST') {
        this.inject(InjectSchema.parse(body));
        return { ok: true };
      }
      if (verb === 'actions' && method === 'POST') {
        const action = this.action(ActionPayloadSchema.parse(input.payload));
        this.world.actions[action.id] = action;
        return action;
      }
      if (verb === 'restoration' && parts[4] === 'analyze' && method === 'POST')
        return (this.world.restoration = this.analyze());
      if (verb === 'restoration' && parts[4] === 'options' && method === 'GET') {
        this.required(this.world.restoration?.options.find((o) => o.id === parts[5]));
        return { optionId: parts[5], cells: [] };
      }
      if (verb === 'work-orders' && method === 'POST')
        return this.createWorkOrder(String(input.optionId));
      if (verb === 'audit' && method === 'GET') return [];
    }
    if (resource === 'actions' && method === 'POST') {
      const action = this.required(this.world.actions[id]);
      if (verb === 'approve') {
        if (action.status !== 'awaiting_approval')
          throw new ApiError(409, 'illegal_transition', 'Action is no longer awaiting approval');
        this.applyPayload(action.payload);
        action.status = 'executed';
        action.executedAt = this.world.clock.simTime;
      } else if (verb === 'reject' || verb === 'override') {
        if (typeof input.reason !== 'string' || !input.reason.trim())
          throw new ApiError(400, 'validation_failed', 'A reason is required');
        if (verb === 'reject' && action.status !== 'awaiting_approval')
          throw new ApiError(409, 'illegal_transition', 'Action is no longer awaiting approval');
        const replacementPayload =
          input.replacement === undefined
            ? undefined
            : ActionPayloadSchema.parse(input.replacement);
        action.status = verb === 'reject' ? 'rejected' : 'overridden';
        action.rejectReason = input.reason;
        if (verb === 'override') {
          let replacement: Action | undefined;
          if (replacementPayload) {
            replacement = this.action(replacementPayload);
            replacement.overrideOf = action.id;
            this.world.actions[replacement.id] = replacement;
          }
          action.decidedBy = 'mock-admin';
          action.decidedAt = this.world.clock.simTime;
          return { overridden: action, replacement };
        }
      } else throw new ApiError(404, 'not_found', 'Unknown action command');
      action.decidedBy = 'mock-admin';
      action.decidedAt = this.world.clock.simTime;
      return action;
    }
    if (resource === 'rules') {
      if (method === 'GET' && !id) return this.rules;
      if (method === 'PATCH') {
        const rule = this.required(this.rules.find((r) => r.id === id));
        Object.assign(rule, UpdateRuleRequestSchema.parse(body));
        return rule;
      }
    }
    if (resource === 'work-orders' && verb === 'transition' && method === 'POST') {
      const order = this.required(this.world.workOrders[id]);
      const allowed: Record<WorkOrderStatus, WorkOrderStatus[]> = {
        created: ['assigned', 'cancelled'],
        assigned: ['in_progress', 'cancelled'],
        in_progress: ['inspection', 'cancelled'],
        inspection: ['reopened', 'failed_inspection'],
        failed_inspection: ['in_progress', 'cancelled'],
        reopened: [],
        cancelled: [],
      };
      const to = input.to as WorkOrderStatus;
      if (!allowed[order.status].includes(to))
        throw new ApiError(409, 'illegal_transition', 'Invalid work-order transition');
      order.status = to;
      order.progress = to === 'reopened' ? 1 : order.progress;
      order.history.push({ status: to, at: this.world.clock.simTime, by: 'mock-admin' });
      if (to === 'reopened') {
        const candidate = this.world.restoration?.candidates.find(
          (c) => c.id === order.candidateId,
        );
        for (const edgeId of candidate?.edgeIds ?? []) delete this.world.roads[edgeId];
      }
      return order;
    }
    if (resource === 'intel' && parts[2] === 'operations' && parts[3] === this.world.operation.id) {
      if (parts[4] === 'briefing' && method === 'POST')
        return {
          generatedAt: this.world.clock.simTime,
          headline: 'Mock exercise briefing',
          situation: 'Synthetic incidents and moving units for UI development.',
          priorities: ['Review the pending utility action'],
          risks: ['Exercise data only'],
          recommendedActions: [],
        } satisfies Briefing;
      if (parts[4] === 'copilot' && method === 'POST')
        return {
          answer:
            'Mock v0: inspect the incident, unit and action panels. Live intelligence is not connected.',
        };
    }
    throw new ApiError(404, 'not_found', `Mock v0 does not implement ${method} ${path}`);
  }
}

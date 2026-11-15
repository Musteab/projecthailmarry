import {
  apiPaths,
  ActionPayloadSchema,
  ControlRequestSchema,
  CreateOperationRequestSchema,
  InjectSchema,
  LoginRequestSchema,
  UpdateRuleRequestSchema,
  makeInitialWorld,
  ScenarioSummarySchema,
  SignalInputSchema,
} from '@bastion/shared';
import type {
  Action,
  ActionPayload,
  Authority,
  Briefing,
  Inject,
  Operation,
  Rule,
  ServerMessage,
  WorldSnapshot,
  WorkOrder,
  WorkOrderStatus,
  RestorationAnalysis,
  AccessImpact,
  RegionStatic,
  Scenario,
  UnitAssignment,
  AuditEntry,
} from '@bastion/shared';
import { loadRegionMini } from '@bastion/shared/fixtures';
import { createMockScripts } from '../mock/scripts';
import type { StoryEvent } from '../mock/scripts';
import { ScriptedEngine, copy, diffWorld, validatedMessage } from '../mock/engine';
import { analyzeAccess, routeBetween, nearestNode } from '../mock/routing';
import { unitPositionAt } from '../helpers';
import { ApiError } from './index';
import { RecordingPlayer } from '../mock/recording';
import type { RecordedFrame } from '../mock/recording';
import type { Connection, Method, Transport } from './index';

export interface MockOptions {
  recording?: string | RecordedFrame[];
  region?: RegionStatic;
}
/** Scripted exercise or recorded-run replay. Never calls an external service. */
export class MockTransport implements Transport {
  readonly region: RegionStatic;
  readonly scripts: ReturnType<typeof createMockScripts>;
  private selected: ReturnType<typeof createMockScripts>[number];
  private replay?: RecordingPlayer;
  private replayRunning = false;
  private replayRate = 1;
  get scenario() {
    if (this.replay) {
      const world = this.replay.world;
      return {
        ...this.selected.scenario,
        id: world.operation.scenarioId ?? 'recorded-run',
        regionId: world.operation.regionId,
        name: `Recorded: ${world.operation.name}`,
        description: 'Captured server messages; controls change playback only.',
        durationSimSec:
          world.clock.durationSimSec ??
          Math.max(
            1,
            ...this.replay.frames.flatMap((f) =>
              f.message.t === 'tick' ? [f.message.clock.simTime] : [],
            ),
          ),
        hazard: world.hazards[0]?.kind ?? 'flash_flood',
        beats: this.replay.beats,
      } satisfies Scenario;
    }
    return this.selected.scenario;
  }
  private engine!: ScriptedEngine;
  private impacts: Record<string, AccessImpact> = {};
  private destinations = new Map<string, string>();
  private blockedRoutes = new Map<string, UnitAssignment>();
  private audit: AuditEntry[] = [];
  private scriptWorkOrder?: string;
  world: WorldSnapshot;
  private sequence = 0;
  private operationSequence = 0;
  private listeners = new Set<(message: ServerMessage) => void>();
  private timer?: ReturnType<typeof setInterval>;
  private lastTick = 0;
  private speed = 5;
  private rules: Rule[] = [
    {
      id: 'mock-dispatch',
      authority: 'fire_rescue',
      name: 'Exercise rescue dispatch',
      description: 'Dispatch the scripted specialist crew',
      actionKind: 'dispatch_unit',
      autonomy: 'auto',
      params: {},
      approvedBy: 'mock-admin',
      updatedAt: new Date(0).toISOString(),
    },
    {
      id: 'mock-utility',
      authority: 'utility',
      name: 'Mock feeder protection',
      description: 'Exercise-only approval rule',
      actionKind: 'isolate_grid_section',
      autonomy: 'auto',
      params: { floodDepthM: 0.3 },
      approvedBy: 'mock-admin',
      updatedAt: new Date(0).toISOString(),
    },
  ];

  constructor(options: MockOptions = {}) {
    this.region = options.region ?? loadRegionMini();
    this.scripts = createMockScripts(this.region);
    this.selected = this.scripts[0];
    if (options.recording) {
      this.replay = new RecordingPlayer(options.recording);
      if (this.replay.world.operation.regionId !== this.region.config.id)
        throw new Error('Supply the region pack matching the recording');
      this.world = copy(this.replay.world);
      return;
    }
    this.world = this.seed(this.operation());
    this.resetEngine();
  }
  private id(prefix: string) {
    return `mock-${prefix}-${++this.sequence}`;
  }
  private operation(): Operation {
    return {
      id: `mock-operation-${++this.operationSequence}`,
      regionId: this.region.config.id,
      scenarioId: this.scenario.id,
      mode: 'exercise',
      name: this.scenario.name,
      status: 'ready',
      createdBy: 'mock-admin',
      createdAt: new Date(0).toISOString(),
    };
  }
  private seed(operation: Operation): WorldSnapshot {
    const world = makeInitialWorld(operation, this.region, {
      durationSimSec: this.scenario.durationSimSec,
    });
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
        headline: `Exercise: ${payload.kind.replaceAll('_', ' ')}`,
        factors: [{ label: 'Source', value: 'Local fixture' }],
        alternatives: [],
        confidence: 1,
      },
    };
  }
  private emit(message: ServerMessage) {
    const parsed = validatedMessage(message);
    for (const listener of this.listeners) listener(copy(parsed));
  }
  private snapshot() {
    this.emit({ t: 'snapshot', world: this.world });
  }
  private resetEngine() {
    this.sequence = 0;
    this.impacts = {};
    this.destinations.clear();
    this.blockedRoutes.clear();
    this.audit = [];
    this.scriptWorkOrder = undefined;
    this.speed = this.scenario.defaultSpeed;
    this.engine = new ScriptedEngine(this.selected, {
      world: () => this.world,
      region: this.region,
      inject: (value) => this.inject(value),
      propose: (event) => this.propose(event),
      moveUnits: () => this.moveUnits(),
      resolve: (id) => this.resolve(id),
      recovery: () => {
        this.world.restoration = this.analyze();
        this.event('Recovery options ranked by hospital access');
      },
      work: (status) => this.scriptWork(status),
      metrics: () => this.metrics(),
      event: (title) => this.event(title),
      emit: (message) => this.emit(message),
    });
    this.engine.initialize();
  }
  private propose(event: Extract<StoryEvent, { type: 'action' }>) {
    const rule = event.ruleId ? this.rules.find((r) => r.id === event.ruleId) : undefined;
    if (rule?.autonomy === 'off') {
      this.event(`Rule disabled: ${event.headline}`);
      return;
    }
    const action = this.action(event.payload);
    action.id = event.id;
    action.ruleId = event.ruleId;
    action.initiator = 'platform';
    action.explain = {
      headline: event.headline,
      confidence: 0.94,
      factors: [
        { label: 'Scenario', value: this.scenario.name },
        { label: 'Routing', value: 'Open fixture edges only' },
      ],
      alternatives: [
        {
          label: 'Direct route',
          score: 0,
          rejectedBecause: 'Road closures and specialist capability must be respected',
        },
      ],
      narrative: 'Deterministic exercise decision; no live agency action.',
    };
    const disposition = rule?.autonomy ?? event.disposition;
    if (disposition === 'reject') {
      action.status = 'rejected';
      action.rejectReason = 'Duplicate or unsuitable capability';
    } else if (disposition === 'auto') {
      try {
        this.applyPayload(action.payload);
        action.status = 'executed';
        action.executedAt = this.world.clock.simTime;
        action.decidedBy = 'auto';
        action.decidedAt = this.world.clock.simTime;
      } catch (error) {
        action.status = 'failed';
        action.rejectReason = error instanceof Error ? error.message : String(error);
      }
    }
    this.world.actions[action.id] = action;
    this.event(`${event.headline} · ${action.status}`);
  }
  private metrics() {
    const w = this.world;
    const active = Object.values(w.incidents).filter(
      (i) => !['resolved', 'closed'].includes(i.status),
    );
    const threatened = new Set(Object.keys(w.cells));
    w.metrics = {
      ...w.metrics,
      activeIncidents: active.length,
      peopleAtRisk: this.region.cells
        .filter((c) => threatened.has(c.id))
        .reduce((sum, c) => sum + c.population, 0),
      peopleRescued: Object.values(w.incidents)
        .filter((i) => i.status === 'resolved')
        .reduce((sum, i) => sum + (i.peopleAffected ?? 0), 0),
      unitsDeployed: Object.values(w.units).filter(
        (u) => !['available', 'out_of_service'].includes(u.status),
      ).length,
      customersOut: Object.values(w.gridSections).reduce((sum, s) => sum + s.customersOut, 0),
      roadsClosed: Object.keys(w.roads).length,
      sheltersOpen: Object.values(w.facilities).filter((f) => f.activated).length,
      shelterOccupancy: Object.values(w.facilities).reduce((sum, f) => sum + (f.occupancy ?? 0), 0),
      isolatedPop: w.restoration?.baseline.isolatedPop ?? 0,
      noHospitalAccessPop: w.restoration?.baseline.noHospitalAccessPop ?? 0,
    };
  }
  private resolve(id: string) {
    const incident = this.world.incidents[id];
    if (!incident || incident.status === 'resolved' || !incident.assignedUnitIds.length) return;
    if (!incident.assignedUnitIds.some((unitId) => this.world.units[unitId]?.status === 'on_scene'))
      return;
    incident.status = 'resolved';
    incident.resolvedAt = this.world.clock.simTime;
    for (const unitId of incident.assignedUnitIds) {
      const unit = this.world.units[unitId];
      if (unit) {
        unit.status = 'available';
        unit.assignment = undefined;
        this.blockedRoutes.delete(unitId);
      }
    }
    this.event(`Resolved: ${incident.title}`);
  }
  private routeUnit(unitId: string, assignment: UnitAssignment) {
    const unit = this.required(this.world.units[unitId]);
    const route = routeBetween(
      this.region,
      this.world.roads,
      unit.position,
      assignment.destination,
    );
    if (!route) {
      this.blockedRoutes.set(unitId, assignment);
      unit.assignment = undefined;
      unit.status = 'dispatched';
      return false;
    }
    unit.assignment = {
      ...assignment,
      route: route.route,
      routeEdgeIds: route.routeEdgeIds,
      departedSimTime: this.world.clock.simTime,
      etaSimTime: this.world.clock.simTime + route.seconds,
    };
    unit.position = route.route[0];
    unit.status = assignment.targetType === 'facility' ? 'transporting' : 'en_route';
    this.blockedRoutes.delete(unitId);
    return true;
  }
  private reroute() {
    for (const unit of Object.values(this.world.units)) {
      const assignment = unit.assignment ?? this.blockedRoutes.get(unit.id);
      if (!assignment || unit.status === 'out_of_service' || unit.status === 'on_scene') continue;
      if (
        this.blockedRoutes.has(unit.id) ||
        assignment.routeEdgeIds.some(
          (id) => this.world.roads[id] && this.world.roads[id].status !== 'open',
        )
      ) {
        const routed = this.routeUnit(unit.id, assignment);
        this.event(
          `${unit.callsign}: ${routed ? 'rerouted around closure' : 'waiting for an open route'}`,
        );
      }
    }
  }
  private moveUnits() {
    for (const unit of Object.values(this.world.units)) {
      if (!unit.assignment || !['en_route', 'transporting', 'returning'].includes(unit.status))
        continue;
      Object.assign(unit, unitPositionAt(unit, this.world.clock, 0));
      if (this.world.clock.simTime < unit.assignment.etaSimTime) continue;
      const assignment = unit.assignment;
      if (assignment.targetType === 'incident') {
        const incident = this.world.incidents[assignment.targetId];
        if (incident) incident.status = 'in_progress';
        const hospitalId = this.destinations.get(unit.id);
        if (hospitalId) {
          const hospital = this.region.facilities.find((f) => f.id === hospitalId)!;
          this.routeUnit(unit.id, {
            ...assignment,
            targetType: 'facility',
            targetId: hospitalId,
            destination: hospital.position,
          });
          this.destinations.delete(unit.id);
        } else {
          unit.status = 'on_scene';
          unit.assignment = undefined;
        }
      } else {
        unit.status = 'available';
        unit.assignment = undefined;
        for (const incident of Object.values(this.world.incidents))
          if (incident.kind === 'medical' && incident.assignedUnitIds.includes(unit.id)) {
            incident.status = 'resolved';
            incident.resolvedAt = this.world.clock.simTime;
          }
      }
    }
  }
  private scriptWork(status: WorkOrderStatus) {
    if (status === 'created') {
      const option = this.world.restoration?.recommendedOptionId;
      if (!option) return;
      this.scriptWorkOrder = this.createWorkOrder(option).id;
    } else if (this.scriptWorkOrder) {
      const order = this.world.workOrders[this.scriptWorkOrder];
      if (!order || ['cancelled', 'reopened'].includes(order.status)) return;
      try {
        this.transitionWork(order.id, status);
      } catch {
        return;
      }
    }
    this.event(`Recovery work: ${status}`);
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
  /** Wall seconds; the script clock applies the selected simulation speed. */
  advance(seconds: number) {
    if (this.replay) {
      if (!this.replayRunning) return;
      this.replay.advance(
        seconds,
        (message) => {
          this.world = copy(this.replay!.world);
          this.world.clock.speed *= this.replayRate;
          this.emit(this.replayMessage(message));
        },
        this.replayRate,
      );
      if (this.replay.complete) {
        this.replayRunning = false;
        this.world.clock.speed = 0;
        this.world.operation.status = 'ended';
        this.emit({
          t: 'tick',
          clock: copy(this.world.clock),
          patch: { operation: copy(this.world.operation) },
        });
      }
      return;
    }
    this.engine.advance(seconds);
  }
  /** Rebuild a scripted exercise to a beat; no wall-clock timer is needed. */
  private replayMessage(message: ServerMessage): ServerMessage {
    if (message.t === 'tick')
      return {
        ...message,
        clock: { ...message.clock, speed: message.clock.speed * this.replayRate },
      };
    if (message.t === 'snapshot')
      return {
        ...message,
        world: {
          ...message.world,
          clock: { ...message.world.clock, speed: message.world.clock.speed * this.replayRate },
        },
      };
    return message;
  }
  seek(simTime: number) {
    if (this.replay) {
      this.replay.seek(simTime, (message) => {
        this.world = copy(this.replay!.world);
        this.emit(message);
      });
      this.replayRunning = false;
      this.world.clock.speed = 0;
      this.world.operation.status = 'paused';
      this.emit({
        t: 'tick',
        clock: copy(this.world.clock),
        patch: { operation: copy(this.world.operation) },
      });
      return;
    }
    if (!Number.isFinite(simTime) || simTime < 0 || simTime > this.scenario.durationSimSec)
      throw new ApiError(400, 'invalid_time', 'Invalid exercise time');
    this.world = this.seed({ ...this.world.operation, status: 'running' });
    this.resetEngine();
    this.world.clock.speed = 1;
    this.snapshot();
    this.engine.announceInitialBeat();
    this.engine.advance(simTime);
    this.world.operation.status = simTime === this.scenario.durationSimSec ? 'ended' : 'paused';
    this.world.clock.speed = 0;
    this.emit({
      t: 'tick',
      clock: copy(this.world.clock),
      patch: { operation: copy(this.world.operation) },
    });
    this.lastTick = Date.now();
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
    onMessage(validatedMessage({ t: 'snapshot', world: this.world }));
    if (this.replay?.latestBeat)
      onMessage(validatedMessage({ t: 'beat', beat: this.replay.latestBeat }));
    else if (this.replay) {
      /* initial snapshot supplied above */
    } else if (this.engine.latestBeat)
      onMessage(validatedMessage({ t: 'beat', beat: this.engine.latestBeat }));
    else this.engine.announceInitialBeat();
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
        this.required(w.gridSections[payload.sectionId]);
        const isolated = payload.kind === 'isolate_grid_section';
        const affected = new Set([payload.sectionId]);
        for (let pass = 0; pass < this.region.grid.sections.length; pass++)
          for (const section of this.region.grid.sections)
            if (section.upstreamSectionId && affected.has(section.upstreamSectionId))
              affected.add(section.id);
        for (const id of affected) {
          const section = this.region.grid.sections.find((s) => s.id === id)!;
          w.gridSections[id] = {
            ...w.gridSections[id],
            status: isolated ? 'isolated' : 'energized',
            threatened: isolated,
            customersOut: isolated ? section.customers : 0,
          };
          for (const facilityId of section.criticalFacilityIds) {
            const state = w.facilities[facilityId];
            if (!state) continue;
            w.facilities[facilityId] = {
              ...state,
              power: isolated ? 'backup' : 'grid',
              backupFuelMin: isolated ? 45 : undefined,
            };
          }
        }
        break;
      }
      case 'activate_shelter':
      case 'divert_hospital': {
        const state = this.required(w.facilities[payload.facilityId]);
        w.facilities[payload.facilityId] = {
          ...state,
          ...(payload.kind === 'activate_shelter'
            ? { activated: true, occupancy: 48 }
            : { onDivert: true }),
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
        if (unit.status === 'out_of_service')
          throw new ApiError(409, 'unit_unavailable', 'Unit is out of service');
        if (
          incident.requiredCapabilities.length &&
          !incident.requiredCapabilities.includes(unit.kind)
        )
          throw new ApiError(409, 'capability_mismatch', 'Unit lacks the required capability');
        const route = routeBetween(this.region, w.roads, unit.position, incident.position);
        if (!route) throw new ApiError(409, 'no_route', 'No open road route to the incident');
        let hospitalId: string | undefined;
        if (payload.kind === 'assign_ambulance') {
          const candidates = this.region.facilities.filter(
            (f) =>
              f.kind === 'hospital' &&
              w.facilities[f.id].status !== 'offline' &&
              !w.facilities[f.id].onDivert &&
              w.facilities[f.id].power !== 'none',
          );
          const ranked = candidates
            .map((f) => ({
              facility: f,
              route: routeBetween(this.region, w.roads, incident.position, f.position),
            }))
            .filter((c) => c.route)
            .sort((a, b) => a.route!.seconds - b.route!.seconds);
          hospitalId =
            ranked.find((c) => c.facility.id === payload.hospitalId)?.facility.id ??
            ranked[0]?.facility.id;
          if (!hospitalId)
            throw new ApiError(409, 'no_hospital', 'No reachable functioning hospital');
        }
        this.releaseUnit(unit.id);
        this.routeUnit(unit.id, {
          targetType: 'incident',
          targetId: incident.id,
          destination: nearestNode(this.region, incident.position).position,
          route: route.route,
          routeEdgeIds: route.routeEdgeIds,
          departedSimTime: w.clock.simTime,
          etaSimTime: w.clock.simTime + route.seconds,
        });
        if (hospitalId) this.destinations.set(unit.id, hospitalId);
        w.incidents[incident.id] = {
          ...incident,
          status: 'assigned',
          assignedUnitIds: [...new Set([...incident.assignedUnitIds, unit.id])],
        };
        break;
      }
      case 'recall_unit': {
        this.releaseUnit(payload.unitId);
        break;
      }
      case 'create_work_order':
        this.createWorkOrder(payload.optionId);
        break;
      case 'issue_public_alert':
        this.event(`Exercise alert: ${payload.headline}`);
        break;
    }
    this.reroute();
    w.metrics = {
      ...w.metrics,
      customersOut: Object.values(w.gridSections).reduce((sum, s) => sum + s.customersOut, 0),
      roadsClosed: Object.keys(w.roads).length,
      sheltersOpen: Object.values(w.facilities).filter((f) => f.activated).length,
    };
  }
  private releaseUnit(unitId: string) {
    const unit = this.required(this.world.units[unitId]);
    unit.assignment = undefined;
    unit.status = 'available';
    this.blockedRoutes.delete(unitId);
    this.destinations.delete(unitId);
    for (const incident of Object.values(this.world.incidents))
      if (incident.assignedUnitIds.includes(unitId)) {
        incident.assignedUnitIds = incident.assignedUnitIds.filter((id) => id !== unitId);
        if (!incident.assignedUnitIds.length && !['resolved', 'closed'].includes(incident.status))
          incident.status = 'confirmed';
      }
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
        w.gridSections[input.sectionId] = {
          ...section,
          status: 'faulted',
          customersOut: this.region.grid.sections.find((s) => s.id === input.sectionId)!.customers,
        };
        break;
      }
      case 'unit_out_of_service': {
        const unit = this.required(w.units[input.unitId]);
        this.releaseUnit(unit.id);
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
    this.reroute();
  }
  private analyze(): RestorationAnalysis {
    const result = analyzeAccess(this.region, this.world);
    this.impacts = result.impacts;
    return result.analysis;
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
  private transitionWork(id: string, to: WorkOrderStatus): WorkOrder {
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
    if (!allowed[order.status].includes(to))
      throw new ApiError(409, 'illegal_transition', 'Invalid work-order transition');
    order.status = to;
    order.progress = (
      {
        created: 0,
        assigned: 0.1,
        in_progress: 0.5,
        inspection: 0.9,
        reopened: 1,
        failed_inspection: 0.7,
        cancelled: 0,
      } as const
    )[to];
    if (to === 'assigned') {
      const crew = Object.values(this.world.units).find(
        (u) => u.kind === 'public_works' && u.status === 'available',
      );
      if (crew) {
        order.assignedUnitIds = [crew.id];
        crew.status = 'on_scene';
      }
    }
    if (to === 'reopened' || to === 'cancelled')
      for (const id of order.assignedUnitIds) this.world.units[id].status = 'available';
    order.history.push({ status: to, at: this.world.clock.simTime, by: 'mock-admin' });
    if (to === 'reopened') {
      const candidate = this.world.restoration?.candidates.find((c) => c.id === order.candidateId);
      for (const edgeId of candidate?.edgeIds ?? []) delete this.world.roads[edgeId];
      this.reroute();
    }
    return order;
  }
  async request<T>(method: Method, path: string, body?: unknown): Promise<T> {
    if (this.replay) return copy(this.handleReplay(method, path, body)) as T;
    const original = this.world;
    const before = copy(this.world);
    let result: unknown;
    const destinations = new Map(this.destinations),
      blocked = new Map(this.blockedRoutes);
    try {
      result = this.handle(method, path, body);
    } catch (error) {
      this.world = JSON.stringify(original) === JSON.stringify(before) ? original : before;
      this.destinations = destinations;
      this.blockedRoutes = blocked;
      throw error;
    }
    if (method !== 'GET' && path !== '/api/auth/login') {
      this.event(
        path === '/api/operations' || (body as { command?: string })?.command === 'reset'
          ? 'Exercise ready'
          : `${method} ${path}`,
      );
      this.audit.push({
        id: this.id('audit'),
        at: new Date(this.world.clock.simTime * 1000).toISOString(),
        simTime: this.world.clock.simTime,
        actor: 'mock-admin',
        verb: path,
        detail: method,
      });
      this.metrics();
      if (
        before.operation.id !== this.world.operation.id ||
        (body as { command?: string })?.command === 'reset'
      )
        this.snapshot();
      else
        this.emit({
          t: 'tick',
          clock: copy(this.world.clock),
          patch: diffWorld(before, this.world),
        });
      if ((body as { command?: string })?.command === 'start') this.engine.announceInitialBeat();
    }
    return structuredClone(result) as T;
  }
  private handleReplay(method: Method, path: string, body?: unknown): unknown {
    const replay = this.replay!;
    if (path === apiPaths.scenarios && method === 'GET')
      return [ScenarioSummarySchema.parse(this.scenario)];
    if (path === apiPaths.operations && method === 'POST') {
      const input = CreateOperationRequestSchema.parse(body);
      if (input.mode !== 'exercise')
        throw new ApiError(400, 'mock_exercise_only', 'Replay cannot create a live operation');
      if (input.regionId !== this.region.config.id || input.scenarioId !== this.scenario.id)
        throw new ApiError(404, 'not_found', 'Unknown recording');
      replay.reset();
      this.replayRunning = false;
      this.replayRate = 1;
      this.world = copy(replay.world);
      this.world.clock.speed = 0;
      this.world.operation.status = 'ready';
      this.snapshot();
      return this.world.operation;
    }
    if (path === apiPaths.operationControl(this.world.operation.id) && method === 'POST') {
      const input = ControlRequestSchema.parse(body);
      if (input.command === 'reset') {
        replay.reset();
        this.replayRate = 1;
        this.replayRunning = false;
        this.world = copy(replay.world);
      } else if (input.command === 'start' || input.command === 'resume') this.replayRunning = true;
      else if (input.command === 'pause' || input.command === 'end') this.replayRunning = false;
      else if (input.command === 'speed') this.replayRate = input.speed;
      if (input.command === 'reset') this.world.operation.status = 'ready';
      else if (input.command === 'start' || input.command === 'resume')
        this.world.operation.status = 'running';
      else if (input.command === 'pause') this.world.operation.status = 'paused';
      else if (input.command === 'end') this.world.operation.status = 'ended';
      this.world.clock.speed = this.replayRunning ? replay.world.clock.speed * this.replayRate : 0;
      this.lastTick = Date.now();
      this.snapshot();
      return this.world.operation;
    }
    const permitted = method === 'GET' || path === apiPaths.login;
    if (!permitted)
      throw new ApiError(
        409,
        'replay_read_only',
        'Recorded actions cannot be edited; launch a scripted exercise to intervene',
      );
    return this.handle(method, path, body);
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
      return this.scripts.map((script) => ScenarioSummarySchema.parse(script.scenario));
    if (resource === 'operations') {
      if (method === 'POST' && !id) {
        const data = CreateOperationRequestSchema.parse(body);
        if (data.mode !== 'exercise')
          throw new ApiError(
            400,
            'mock_exercise_only',
            'The mock supports exercise operations only',
          );
        const selected = this.scripts.find((script) => script.scenario.id === data.scenarioId);
        if (data.regionId !== this.region.config.id || !selected)
          throw new ApiError(404, 'not_found', 'Unknown mock region or scenario');
        this.selected = selected;
        this.world = this.seed({
          ...this.operation(),
          ...data,
          name: data.name || this.scenario.name,
        });
        this.resetEngine();
        return this.world.operation;
      }
      if (id !== this.world.operation.id)
        throw new ApiError(404, 'not_found', 'Unknown mock operation');
      if (!verb && method === 'GET') return this.world;
      if (verb === 'control' && method === 'POST') {
        const control = ControlRequestSchema.parse(body);
        if (control.command === 'reset') {
          this.world = this.seed({ ...this.world.operation, status: 'ready' });
          this.resetEngine();
        } else if (this.world.operation.status === 'ended' && control.command !== 'end')
          throw new ApiError(409, 'illegal_transition', 'Reset the ended operation first');
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
        return this.required(this.impacts[parts[5]]);
      }
      if (verb === 'work-orders' && method === 'POST')
        return this.createWorkOrder(String(input.optionId));
      if (verb === 'audit' && method === 'GET') return this.audit;
      if (verb === 'signals' && method === 'POST') {
        const signal = {
          ...SignalInputSchema.parse(body),
          id: this.id('signal'),
          simTime: this.world.clock.simTime,
        };
        this.world.signals = [...this.world.signals, signal].slice(-200);
        return signal;
      }
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
        if (!['awaiting_approval', 'approved', 'executed'].includes(action.status))
          throw new ApiError(409, 'illegal_transition', 'Cannot override this terminal action');
        if (
          verb === 'override' &&
          ['dispatch_unit', 'assign_ambulance'].includes(action.payload.kind)
        )
          this.releaseUnit((action.payload as { unitId: string }).unitId);
        action.status = verb === 'reject' ? 'rejected' : 'overridden';
        action.rejectReason = input.reason;
        if (verb === 'override') {
          let replacement: Action | undefined;
          if (replacementPayload) {
            replacement = this.action(replacementPayload);
            replacement.overrideOf = action.id;
            this.applyPayload(replacement.payload);
            replacement.status = 'executed';
            replacement.executedAt = this.world.clock.simTime;
            replacement.decidedAt = this.world.clock.simTime;
            replacement.decidedBy = 'mock-admin';
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
      return this.transitionWork(id, input.to as WorkOrderStatus);
    }

    if (resource === 'intel' && parts[2] === 'operations' && parts[3] === this.world.operation.id) {
      if (parts[4] === 'briefing' && method === 'POST')
        return {
          generatedAt: this.world.clock.simTime,
          headline: 'Mock exercise briefing',
          situation: `${this.scenario.name}: ${this.world.metrics.activeIncidents} active incidents and ${this.world.metrics.customersOut} customers without grid power.`,
          priorities: Object.values(this.world.actions)
            .filter((a) => a.status === 'awaiting_approval')
            .map((a) => a.explain.headline),
          risks: ['Exercise data only'],
          recommendedActions: [],
        } satisfies Briefing;
      if (parts[4] === 'copilot' && method === 'POST')
        return {
          answer: `Scripted ${this.scenario.hazard} exercise: ${this.world.metrics.activeIncidents} active incidents, ${this.world.metrics.unitsDeployed} units deployed and ${this.world.metrics.roadsClosed} roads closed. This response uses local exercise data.`,
        };
    }
    throw new ApiError(404, 'not_found', `Mock does not implement ${method} ${path}`);
  }
}

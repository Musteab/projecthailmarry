import type {
  Inject,
  Operation,
  OperationStatus,
  RepairCandidate,
  RoadState,
  Scenario,
  ScenarioBeat,
  Signal,
  SignalInput,
  TimelineEvent,
} from '@bastion/shared';
import { makeInitialWorld } from '@bastion/shared';
import type { RegionIndex } from '../region/index';
import { RoadNetwork } from '../routing/network';
import { WorldState } from '../world/WorldState';
import { applyInject } from './injects';
import type { AuditRecord } from '../actions/service';
import { ActionService } from '../actions/service';
import { GridService } from '../grid/grid';
import { RestorationService } from '../restoration/service';
import { WorkOrderService } from '../workorders/service';
import { UnitService } from '../units/units';
import { Prng } from './prng';

/** The simulation always advances in steps of this many sim seconds, whatever the speed. */
export const SIM_STEP_SEC = 1;
/** How often the scheduler wakes up, in wall-clock milliseconds. */
export const TICK_MS = 250;
/** Never run more than this many steps in one wake-up, so a stall cannot snowball. */
const MAX_STEPS_PER_TICK = 240;

/**
 * One stage of the per-step pipeline (scenario, hazards, incidents, decisions, ...).
 * `update` runs once per sim step and must be synchronous and fast.
 */
export interface System {
  name: string;
  update(rt: OperationRuntime, dt: number): void;
}
export type SystemFactory = (rt: OperationRuntime) => System;

export interface RuntimeLogger {
  error(message: string, error?: unknown): void;
}

export interface RuntimeOptions {
  operation: Operation;
  /** Incremented on reset so old command links cannot mutate the new exercise. */
  commandGeneration?: number;
  index: RegionIndex;
  scenario: Scenario | null;
  /** in pipeline order */
  systems: SystemFactory[];
  logger?: RuntimeLogger;
  /** receives an entry for every action transition; the manager writes it to the database */
  audit?: (record: AuditRecord) => void;
}

/**
 * Everything that makes up one running operation: its world, clock, road network, random
 * stream and system pipeline. Deterministic: stepping it never reads the wall clock.
 */
export class OperationRuntime {
  readonly world: WorldState;
  readonly network: RoadNetwork;
  readonly prng: Prng;
  readonly index: RegionIndex;
  readonly scenario: Scenario | null;
  /** Repairs the restoration engine can choose from, keyed by candidate id. */
  readonly repairCandidates = new Map<string, RepairCandidate>();
  /** Moves units; the decision engine and work orders send them through this. */
  readonly units: UnitService;
  /** The pipeline every action goes through: rules, approval, execution, audit. */
  readonly actions: ActionService;
  /** The distribution grid: threat detection, isolation and its consequences. */
  readonly grid: GridService;
  /** Ranks repairs by who regains access to hospitals and shelters. */
  readonly restoration: RestorationService;
  /** Tracks repairs from work order to reopened road. */
  readonly workOrders: WorkOrderService;
  /** Writes an entry to the audit trail. */
  readonly audit: (record: AuditRecord) => void;
  /** Running totals that are not derivable from the current world. */
  readonly stats = { peopleRescued: 0 };
  /** Signals that arrived since the previous step, for systems that react to them. */
  newSignals: Signal[] = [];

  private readonly systems: System[];
  private readonly logger: RuntimeLogger;
  private pendingSignals: Signal[] = [];
  private beats: ScenarioBeat[] = [];
  private owedSimSec = 0;
  private stepping = false;
  private readonly background: Promise<unknown>[] = [];
  private readonly lastFailureAt = new Map<string, number>();

  constructor(options: RuntimeOptions) {
    const { operation, index, scenario } = options;
    this.index = index;
    this.scenario = scenario;
    this.logger = options.logger ?? { error: () => undefined };
    this.prng = new Prng(scenario?.seed ?? 1);
    this.network = new RoadNetwork(index.topology);

    const initial = makeInitialWorld(operation, index.region, {
      durationSimSec: scenario?.durationSimSec ?? null,
      speed: scenario?.defaultSpeed ?? 1,
    });
    initial.hazards = (scenario?.hazards ?? []).map((spec) => ({
      id: spec.id,
      kind: spec.kind,
      label: spec.label,
      phase: 'forecast' as const,
      ...(spec.kind === 'flash_flood' ? { sourcePaths: spec.sourcePaths } : {}),
      ...(spec.kind === 'earthquake'
        ? {
            epicenter: spec.epicenter,
            magnitude: spec.magnitude,
            originSimTime: spec.originSimTime,
          }
        : {}),
      ...(spec.kind === 'tornado' || spec.kind === 'hurricane'
        ? { track: spec.track.map(([, position]) => position), radiusM: spec.radiusM }
        : {}),
    }));
    this.world = new WorldState(initial, options.commandGeneration);
    this.units = new UnitService(this);
    this.audit = options.audit ?? (() => undefined);
    this.actions = new ActionService(this, this.audit);
    this.grid = new GridService(this);
    this.restoration = new RestorationService(this);
    this.workOrders = new WorkOrderService(this);
    this.systems = options.systems.map((create) => create(this));
  }

  get operation(): Operation {
    return this.world.operation;
  }
  get simTime(): number {
    return this.world.clock.simTime;
  }
  /** Exercise operations never act outside the training environment. */
  get sandboxed(): boolean {
    return this.operation.mode === 'exercise';
  }
  get finished(): boolean {
    const { durationSimSec, simTime } = this.world.clock;
    return durationSimSec !== null && simTime >= durationSimSec;
  }

  setStatus(status: OperationStatus): void {
    if (this.operation.status !== status) this.world.setOperation({ ...this.operation, status });
  }

  setSpeed(speed: number): void {
    this.world.setClock({ ...this.world.clock, speed });
  }

  /** Advances the simulation by exactly one step. */
  step(): void {
    this.stepping = true;
    this.newSignals = this.pendingSignals;
    this.pendingSignals = [];
    this.world.setClock({ ...this.world.clock, simTime: this.simTime + SIM_STEP_SEC });

    for (const system of this.systems) {
      try {
        system.update(this, SIM_STEP_SEC);
      } catch (error) {
        // A broken system must never stop the clock or the other systems.
        this.logger.error(`system "${system.name}" failed at t=${this.simTime}`, error);
        const last = this.lastFailureAt.get(system.name);
        if (last === undefined || this.simTime - last >= 60) {
          this.lastFailureAt.set(system.name, this.simTime);
          this.event({
            kind: 'engine.error',
            severity: 'warn',
            title: `Subsystem "${system.name}" reported a fault`,
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    this.stepping = false;
  }

  /** Runs whole steps until `simSeconds` have passed or the scenario ends. For tests and tools. */
  advance(simSeconds: number): void {
    const steps = Math.floor(simSeconds / SIM_STEP_SEC);
    for (let i = 0; i < steps && !this.finished; i++) this.step();
  }

  /**
   * Called by the scheduler with the wall time that has passed. Converts it to sim time at the
   * current speed and runs the whole steps that are owed. Returns how many steps ran.
   */
  wallTick(wallMs: number): number {
    this.owedSimSec += (wallMs / 1000) * this.world.clock.speed;
    let steps = 0;
    while (this.owedSimSec >= SIM_STEP_SEC && steps < MAX_STEPS_PER_TICK && !this.finished) {
      this.step();
      this.owedSimSec -= SIM_STEP_SEC;
      steps++;
    }
    if (steps === MAX_STEPS_PER_TICK || this.finished) this.owedSimSec = 0;
    return steps;
  }

  /** Adds an entry to the timeline, stamped with an id and the current sim time. */
  event(input: Omit<TimelineEvent, 'id' | 'simTime'>): TimelineEvent {
    const event: TimelineEvent = { id: this.world.nextId('evt'), simTime: this.simTime, ...input };
    this.world.addEvent(event);
    return event;
  }

  /** Accepts a signal from the scenario, a feed or an operator and queues it for the systems. */
  ingestSignal(input: SignalInput): Signal {
    const signal: Signal = { ...input, id: this.world.nextId('sig'), simTime: this.simTime };
    this.world.addSignal(signal);
    (this.stepping ? this.newSignals : this.pendingSignals).push(signal);
    this.event({
      kind: 'signal.received',
      severity: 'info',
      title: signal.title,
      ...(signal.position ? { position: signal.position } : {}),
    });
    return signal;
  }

  /** The one place a road changes: keeps the world and the routing network in step. */
  setRoadState(edgeId: string, state: RoadState | null): void {
    const normalised = state && state.status === 'open' && !state.closurePublished ? null : state;
    this.world.setRoad(edgeId, normalised);
    this.network.applyRoadState(edgeId, normalised);
  }

  /** Registers a repair the restoration engine may choose and links it to its road edges. */
  addRepairCandidate(candidate: Omit<RepairCandidate, 'id'>): RepairCandidate {
    const created: RepairCandidate = { ...candidate, id: this.world.nextId('rc') };
    this.repairCandidates.set(created.id, created);
    for (const edgeId of created.edgeIds) {
      const state = this.world.roads[edgeId];
      if (state) this.setRoadState(edgeId, { ...state, repairCandidateId: created.id });
    }
    return created;
  }

  applyInject(inject: Inject): void {
    applyInject(this, inject);
  }

  emitBeat(beat: ScenarioBeat): void {
    this.beats.push(beat);
  }

  /** Registers background work (an AI call) whose result a later step will pick up. */
  track(work: Promise<unknown>): void {
    this.background.push(work);
    void work.finally(() => {
      const at = this.background.indexOf(work);
      if (at !== -1) this.background.splice(at, 1);
    });
  }

  /** Resolves once all background work started so far has finished. */
  async settle(): Promise<void> {
    while (this.background.length > 0) await Promise.allSettled([...this.background]);
  }

  /**
   * Like `advance`, but lets background work finish between steps. With an asynchronous intel
   * provider this is what makes a headless run reproducible.
   */
  async advanceSettled(simSeconds: number): Promise<void> {
    const steps = Math.floor(simSeconds / SIM_STEP_SEC);
    for (let i = 0; i < steps && !this.finished; i++) {
      this.step();
      await this.settle();
    }
  }

  drainBeats(): ScenarioBeat[] {
    const drained = this.beats;
    this.beats = [];
    return drained;
  }
}

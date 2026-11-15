import { randomUUID } from 'node:crypto';
import type {
  Action,
  ControlRequest,
  CreateOperationRequest,
  Inject,
  IntelPort,
  Operation,
  ServerMessage,
  Signal,
  SignalInput,
  User,
  WorldSnapshot,
} from '@bastion/shared';
import { insertAudit } from '../db/audit';
import type { Database } from '../db/database';
import { endInterruptedOperations, insertOperation, updateOperationStatus } from '../db/operations';
import { listRules } from '../db/rules';
import { ApiError, badRequest, conflict, notFound } from '../errors';
import type { RegionRegistry } from '../region/pack';
import type { ScenarioCatalog } from '../scenarios/catalog';
import type { RuntimeLogger, SystemFactory } from '../sim/runtime';
import { OperationRuntime, TICK_MS } from '../sim/runtime';
import { defaultSystems } from '../sim/systems';

export type OperationListener = (message: ServerMessage) => void;

/** Operations that are not ended. Each holds a world in memory and is stepped on every tick. */
const MAX_ACTIVE_OPERATIONS = 12;
/** Ended operations stay readable for a while, then the oldest are dropped. */
const MAX_ENDED_OPERATIONS = 10;

export interface OperationManagerOptions {
  db: Database;
  regions: RegionRegistry;
  scenarios: ScenarioCatalog;
  /** defaults to the standard pipeline */
  systems?: () => SystemFactory[];
  /** the AI behind signal fusion and triage; defaults to the rule-based fallback */
  intel?: IntelPort;
  logger?: RuntimeLogger;
}

/**
 * Owns every live operation: creates them, drives their clocks, applies commands, and tells
 * subscribers what changed. Everything that mutates an operation ends with a flush, so the
 * stream of tick messages always reconstructs the current snapshot.
 */
export class OperationManager {
  private readonly runtimes = new Map<string, OperationRuntime>();
  private readonly listeners = new Map<string, Set<OperationListener>>();
  private timer: NodeJS.Timeout | undefined;
  private lastTickAt = 0;

  constructor(private readonly options: OperationManagerOptions) {
    endInterruptedOperations(options.db);
  }

  // ---- lifecycle -----------------------------------------------------------------------
  private buildRuntime(operation: Operation, commandGeneration = 0): OperationRuntime {
    const index = this.options.regions.index(operation.regionId);
    if (!index) throw badRequest(`Unknown region "${operation.regionId}"`);
    const scenario = operation.scenarioId ? this.options.scenarios.get(operation.scenarioId) : null;
    if (operation.scenarioId && !scenario) {
      throw badRequest(`Unknown scenario "${operation.scenarioId}"`);
    }
    if (scenario && scenario.regionId !== operation.regionId) {
      throw badRequest(
        `Scenario "${scenario.id}" is written for region "${scenario.regionId}", not "${operation.regionId}"`,
      );
    }
    const runtime = new OperationRuntime({
      operation,
      commandGeneration,
      index,
      scenario: scenario ?? null,
      systems: this.options.systems?.() ?? defaultSystems(this.options.intel),
      logger: this.options.logger,
      audit: (record) => insertAudit(this.options.db, { operationId: operation.id, ...record }),
    });
    runtime.actions.setRules(listRules(this.options.db));
    return runtime;
  }

  create(request: CreateOperationRequest, user: User): Operation {
    const active = [...this.runtimes.values()].filter((rt) => rt.operation.status !== 'ended');
    if (active.length >= MAX_ACTIVE_OPERATIONS) {
      throw new ApiError(
        409,
        'too_many_operations',
        `There are already ${active.length} active operations. End one before starting another.`,
      );
    }

    const scenarioName = request.scenarioId
      ? this.options.scenarios.get(request.scenarioId)?.name
      : undefined;
    const operation: Operation = {
      id: `op-${randomUUID()}`,
      regionId: request.regionId,
      scenarioId: request.scenarioId,
      mode: request.mode,
      name: request.name ?? `${scenarioName ?? 'Operation'} (${request.mode})`,
      status: 'ready',
      createdBy: user.id,
      createdAt: new Date().toISOString(),
    };
    const runtime = this.buildRuntime(operation); // validates region and scenario
    insertOperation(this.options.db, operation);
    this.runtimes.set(operation.id, runtime);
    this.evictEnded();
    return operation;
  }

  private evictEnded(): void {
    const ended = [...this.runtimes.values()].filter((rt) => rt.operation.status === 'ended');
    for (const rt of ended.slice(0, Math.max(0, ended.length - MAX_ENDED_OPERATIONS))) {
      this.runtimes.delete(rt.operation.id);
      this.listeners.delete(rt.operation.id);
    }
  }

  get(operationId: string): OperationRuntime | undefined {
    return this.runtimes.get(operationId);
  }

  require(operationId: string): OperationRuntime {
    const runtime = this.runtimes.get(operationId);
    if (!runtime) throw notFound(`Operation "${operationId}"`);
    return runtime;
  }

  list(): Operation[] {
    return [...this.runtimes.values()].map((rt) => rt.operation);
  }

  snapshot(operationId: string): WorldSnapshot {
    return this.require(operationId).world.toSnapshot();
  }

  // ---- commands ------------------------------------------------------------------------
  private setStatus(runtime: OperationRuntime, status: Operation['status']): void {
    runtime.setStatus(status);
    updateOperationStatus(this.options.db, runtime.operation.id, status);
  }

  control(operationId: string, request: ControlRequest): Operation {
    let runtime = this.require(operationId);
    const { status } = runtime.operation;
    const illegal = () =>
      conflict(`Cannot ${request.command} an operation that is ${status}`, { status });

    switch (request.command) {
      case 'start':
        if (status !== 'ready') throw illegal();
        this.setStatus(runtime, 'running');
        break;
      case 'pause':
        if (status !== 'running') throw illegal();
        this.setStatus(runtime, 'paused');
        break;
      case 'resume':
        if (status !== 'paused') throw illegal();
        this.setStatus(runtime, 'running');
        break;
      case 'end':
        if (status === 'ended') throw illegal();
        this.setStatus(runtime, 'ended');
        break;
      case 'speed':
        if (status === 'ended') throw illegal();
        runtime.setSpeed(request.speed);
        break;
      case 'reset': {
        // A fresh world from the same scenario and seed; subscribers get a new snapshot.
        runtime = this.buildRuntime(
          { ...runtime.operation, status: 'ready' },
          runtime.world.commandGeneration + 1,
        );
        this.runtimes.set(operationId, runtime);
        updateOperationStatus(this.options.db, operationId, 'ready');
        this.emit(operationId, { t: 'snapshot', world: runtime.world.toSnapshot() });
        return runtime.operation;
      }
    }
    this.flush(runtime);
    return runtime.operation;
  }

  inject(operationId: string, inject: Inject): void {
    const runtime = this.require(operationId);
    if (!runtime.sandboxed) {
      throw conflict('What-if injects are only allowed in exercise operations');
    }
    if (runtime.operation.status === 'ended') throw conflict('The operation has ended');
    runtime.applyInject(inject);
    this.flush(runtime);
  }

  ingestSignal(operationId: string, input: SignalInput): Signal {
    const runtime = this.require(operationId);
    if (runtime.operation.status === 'ended') throw conflict('The operation has ended');
    const signal = runtime.ingestSignal(input);
    this.flush(runtime);
    return signal;
  }

  /** Finds an action by id in whichever operation holds it. */
  findAction(actionId: string): { runtime: OperationRuntime; action: Action } {
    for (const runtime of this.runtimes.values()) {
      const action = runtime.world.actions[actionId];
      if (action) return { runtime, action };
    }
    throw notFound(`Action "${actionId}"`);
  }

  /** Runs a command against an operation and sends its effects to subscribers at once. */
  act<T>(operationId: string, command: (runtime: OperationRuntime) => T): T {
    const runtime = this.require(operationId);
    if (runtime.operation.status === 'ended') throw conflict('The operation has ended');
    try {
      return command(runtime);
    } finally {
      this.flush(runtime);
    }
  }

  /** Ends every operation and forgets them all. Returns how many were still active. */
  endAll(): number {
    let ended = 0;
    for (const runtime of this.runtimes.values()) {
      if (runtime.operation.status === 'ended') continue;
      this.setStatus(runtime, 'ended');
      this.flush(runtime);
      ended++;
    }
    this.runtimes.clear();
    this.listeners.clear();
    return ended;
  }

  /** Finds the operation that holds a work order. */
  findWorkOrder(workOrderId: string): OperationRuntime {
    for (const runtime of this.runtimes.values()) {
      if (runtime.world.workOrders[workOrderId]) return runtime;
    }
    throw notFound(`Work order "${workOrderId}"`);
  }

  /** Reloads the agency rules into every live operation after one is edited. */
  refreshRules(): void {
    const rules = listRules(this.options.db);
    for (const runtime of this.runtimes.values()) runtime.actions.setRules(rules);
  }

  // ---- time ----------------------------------------------------------------------------
  /** Advances every running operation by `wallMs` of wall-clock time. */
  tick(wallMs: number): void {
    for (const runtime of this.runtimes.values()) {
      if (runtime.operation.status !== 'running') continue;
      const steps = runtime.wallTick(wallMs);
      if (runtime.finished) this.setStatus(runtime, 'ended');
      if (steps > 0 || runtime.world.hasPendingPatch()) this.flush(runtime);
    }
  }

  /** Starts the wall-clock scheduler. Tests drive `tick` directly instead. */
  start(): void {
    if (this.timer) return;
    this.lastTickAt = performance.now();
    this.timer = setInterval(() => {
      const now = performance.now();
      // Cap the catch-up after a stall (laptop sleep, debugger) at one second.
      const elapsed = Math.min(1000, now - this.lastTickAt);
      this.lastTickAt = now;
      try {
        this.tick(elapsed);
      } catch (error) {
        this.options.logger?.error('operation tick failed', error);
      }
    }, TICK_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  // ---- subscribers ---------------------------------------------------------------------
  /** Registers a listener for an operation's messages. Returns the function that removes it. */
  subscribe(operationId: string, listener: OperationListener): () => void {
    this.require(operationId);
    let set = this.listeners.get(operationId);
    if (!set) this.listeners.set(operationId, (set = new Set()));
    set.add(listener);
    return () => set.delete(listener);
  }

  private emit(operationId: string, message: ServerMessage): void {
    for (const listener of this.listeners.get(operationId) ?? []) {
      try {
        listener(message);
      } catch (error) {
        this.options.logger?.error('operation listener failed', error);
      }
    }
  }

  /** Sends everything that changed since the last flush, then any narrative beats. */
  private flush(runtime: OperationRuntime): void {
    const { id } = runtime.operation;
    this.emit(id, {
      t: 'tick',
      clock: { ...runtime.world.clock },
      patch: runtime.world.drainPatch(),
    });
    for (const beat of runtime.drainBeats()) this.emit(id, { t: 'beat', beat });
  }
}

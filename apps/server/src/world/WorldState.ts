import type {
  Action,
  CellState,
  Clock,
  FacilityState,
  GridSectionState,
  HazardState,
  Incident,
  Metrics,
  Operation,
  RestorationAnalysis,
  RoadState,
  Signal,
  TimelineEvent,
  Unit,
  WorkOrder,
  WorldPatch,
  WorldSnapshot,
} from '@bastion/shared';
import { MAX_SIGNALS, MAX_TIMELINE } from '@bastion/shared';

type KeyedCollection =
  | 'cells'
  | 'roads'
  | 'facilities'
  | 'units'
  | 'incidents'
  | 'actions'
  | 'gridSections'
  | 'workOrders';

/**
 * The live world of one operation, with change tracking.
 *
 * Every mutation goes through a method here, which records it in the pending patch. Entities
 * are treated as immutable values: to change a unit, pass a new object to `setUnit`. That keeps
 * the snapshot, the patch stream and anything holding a reference consistent.
 */
export class WorldState {
  private readonly snap: WorldSnapshot;
  private patch: WorldPatch = {};
  private readonly counters = new Map<string, number>();

  constructor(initial: WorldSnapshot) {
    this.snap = initial;
  }

  // ---- reading -------------------------------------------------------------------------
  get operation(): Operation {
    return this.snap.operation;
  }
  get clock(): Clock {
    return this.snap.clock;
  }
  get hazards(): readonly HazardState[] {
    return this.snap.hazards;
  }
  get metrics(): Metrics {
    return this.snap.metrics;
  }
  get cells(): Readonly<Record<string, CellState>> {
    return this.snap.cells;
  }
  get roads(): Readonly<Record<string, RoadState>> {
    return this.snap.roads;
  }
  get facilities(): Readonly<Record<string, FacilityState>> {
    return this.snap.facilities;
  }
  get units(): Readonly<Record<string, Unit>> {
    return this.snap.units;
  }
  get incidents(): Readonly<Record<string, Incident>> {
    return this.snap.incidents;
  }
  get actions(): Readonly<Record<string, Action>> {
    return this.snap.actions;
  }
  get gridSections(): Readonly<Record<string, GridSectionState>> {
    return this.snap.gridSections;
  }
  get workOrders(): Readonly<Record<string, WorkOrder>> {
    return this.snap.workOrders;
  }
  get signals(): readonly Signal[] {
    return this.snap.signals;
  }
  get timeline(): readonly TimelineEvent[] {
    return this.snap.timeline;
  }
  get restoration(): RestorationAnalysis | null {
    return this.snap.restoration;
  }

  /** Deterministic ids: inc-1, inc-2, ... per prefix. */
  nextId(prefix: string): string {
    const next = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, next);
    return `${prefix}-${next}`;
  }

  // ---- writing -------------------------------------------------------------------------
  private setIn<K extends KeyedCollection>(
    collection: K,
    id: string,
    value: WorldSnapshot[K][string] | null,
  ): void {
    const record = this.snap[collection] as Record<string, unknown>;
    if (value === null) {
      if (!(id in record)) return;
      delete record[id];
    } else {
      record[id] = value;
    }
    const pending = (this.patch[collection] ??= {}) as Record<string, unknown>;
    pending[id] = value;
  }

  /** `null` clears the cell (no hazard left there). */
  setCell(id: string, state: CellState | null): void {
    this.setIn('cells', id, state);
  }
  /** `null` means the road is plainly open again. */
  setRoad(edgeId: string, state: RoadState | null): void {
    this.setIn('roads', edgeId, state);
  }
  setFacility(id: string, state: FacilityState): void {
    this.setIn('facilities', id, state);
  }
  setUnit(unit: Unit): void {
    this.setIn('units', unit.id, unit);
  }
  setIncident(incident: Incident): void {
    this.setIn('incidents', incident.id, incident);
  }
  setAction(action: Action): void {
    this.setIn('actions', action.id, action);
  }
  setGridSection(id: string, state: GridSectionState): void {
    this.setIn('gridSections', id, state);
  }
  setWorkOrder(workOrder: WorkOrder): void {
    this.setIn('workOrders', workOrder.id, workOrder);
  }

  setOperation(operation: Operation): void {
    this.snap.operation = operation;
    this.patch.operation = operation;
  }

  /** The clock travels with every tick message, so it is not part of the patch. */
  setClock(clock: Clock): void {
    this.snap.clock = clock;
  }

  setHazards(hazards: HazardState[]): void {
    this.snap.hazards = hazards;
    this.patch.hazards = hazards;
  }

  /** Records the metrics only if a value actually changed. */
  setMetrics(metrics: Metrics): void {
    const current = this.snap.metrics;
    const changed = (Object.keys(metrics) as (keyof Metrics)[]).some(
      (key) => metrics[key] !== current[key],
    );
    if (!changed) return;
    this.snap.metrics = metrics;
    this.patch.metrics = metrics;
  }

  setRestoration(analysis: RestorationAnalysis | null): void {
    this.snap.restoration = analysis;
    this.patch.restoration = analysis;
  }

  addSignal(signal: Signal): void {
    this.snap.signals.push(signal);
    if (this.snap.signals.length > MAX_SIGNALS) {
      this.snap.signals.splice(0, this.snap.signals.length - MAX_SIGNALS);
    }
    (this.patch.signals ??= []).push(signal);
  }

  addEvent(event: TimelineEvent): void {
    this.snap.timeline.push(event);
    if (this.snap.timeline.length > MAX_TIMELINE) {
      this.snap.timeline.splice(0, this.snap.timeline.length - MAX_TIMELINE);
    }
    (this.patch.timeline ??= []).push(event);
  }

  // ---- output --------------------------------------------------------------------------
  hasPendingPatch(): boolean {
    return Object.keys(this.patch).length > 0;
  }

  /** Everything that changed since the last drain. Applying it to the previous snapshot with
   * `applyWorldPatch` gives the current one. */
  drainPatch(): WorldPatch {
    const drained = this.patch;
    this.patch = {};
    return drained;
  }

  /** A deep copy, safe to hand to anyone. */
  toSnapshot(): WorldSnapshot {
    return structuredClone(this.snap);
  }
}

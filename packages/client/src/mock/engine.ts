import type {
  RegionStatic,
  ScenarioBeat,
  ServerMessage,
  WorldSnapshot,
  WorldPatch,
  WorkOrderStatus,
  Inject,
} from '@bastion/shared';
import { ServerMessageSchema } from '@bastion/shared';
import { cellsAt, intensityAt } from './scripts';
import type { MockScript, StoryEvent } from './scripts';

export const copy = <T>(value: T): T => structuredClone(value);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Whole-entity upserts/null deletes, with signal and timeline appends. */
export function diffWorld(before: WorldSnapshot, after: WorldSnapshot): WorldPatch {
  const patch: WorldPatch = {};
  for (const key of [
    'cells',
    'roads',
    'facilities',
    'units',
    'incidents',
    'actions',
    'gridSections',
    'workOrders',
  ] as const) {
    const entries: Record<string, unknown> = {};
    for (const id of new Set([...Object.keys(before[key]), ...Object.keys(after[key])])) {
      if (!same(before[key][id], after[key][id])) entries[id] = after[key][id] ?? null;
    }
    if (Object.keys(entries).length) Object.assign(patch, { [key]: entries });
  }
  for (const key of ['operation', 'hazards', 'metrics', 'restoration'] as const) {
    if (!same(before[key], after[key])) Object.assign(patch, { [key]: copy(after[key]) });
  }
  for (const key of ['signals', 'timeline'] as const) {
    const ids = new Set(before[key].map((entry) => entry.id));
    const added = after[key].filter((entry) => !ids.has(entry.id));
    if (added.length) Object.assign(patch, { [key]: copy(added) });
  }
  return patch;
}
export interface StoryHost {
  world(): WorldSnapshot;
  region: RegionStatic;
  inject(value: Inject): void;
  propose(event: Extract<StoryEvent, { type: 'action' }>): void;
  moveUnits(): void;
  resolve(id: string): void;
  recovery(): void;
  work(status: WorkOrderStatus): void;
  metrics(): void;
  event(title: string): void;
  emit(message: ServerMessage): void;
}
/** Fixed simulation boundaries make event ordering independent of wall-clock frame size. */
export class ScriptedEngine {
  private eventIndex = 0;
  private beatIndex = 0;
  latestBeat: ScenarioBeat | null = null;
  constructor(
    readonly script: MockScript,
    private host: StoryHost,
  ) {}
  initialize() {
    this.atTime(0);
  }
  private atTime(time: number) {
    const world = this.host.world();
    world.clock.simTime = time;
    world.cells = cellsAt(this.script, this.host.region, time);
    const intensity = intensityAt(this.script.intensity, time);
    world.hazards = [
      {
        ...this.script.hazard,
        phase:
          time === 0
            ? this.script.hazard.phase
            : intensity === 0
              ? 'ended'
              : this.script.scenario.hazard === 'flash_flood' && time >= 120
                ? 'receding'
                : 'active',
      },
    ];
    this.host.moveUnits();
    while (
      this.eventIndex < this.script.events.length &&
      this.script.events[this.eventIndex].at <= time
    ) {
      const event = this.script.events[this.eventIndex++];
      switch (event.type) {
        case 'signal':
          world.signals = [
            ...world.signals,
            { ...event.signal, id: event.id, simTime: event.at },
          ].slice(-200);
          this.host.event(event.signal.title);
          break;
        case 'incident':
          world.incidents[event.incident.id] = { ...copy(event.incident), openedAt: event.at };
          this.host.event(event.incident.title);
          break;
        case 'inject':
          this.host.inject(event.inject);
          this.host.event(`Exercise disruption: ${event.inject.kind}`);
          break;
        case 'action':
          this.host.propose(event);
          break;
        case 'resolve':
          this.host.resolve(event.incidentId);
          break;
        case 'recovery':
          this.host.recovery();
          break;
        case 'work':
          this.host.work(event.status);
          break;
      }
    }
    this.host.metrics();
  }
  private beats() {
    while (
      this.beatIndex < this.script.scenario.beats.length &&
      this.script.scenario.beats[this.beatIndex].simTime <= this.host.world().clock.simTime
    ) {
      this.latestBeat = this.script.scenario.beats[this.beatIndex++];
      this.host.emit({ t: 'beat', beat: this.latestBeat });
    }
  }
  announceInitialBeat() {
    this.beats();
  }
  advance(wallSeconds: number) {
    const world = this.host.world();
    if (world.operation.status !== 'running' || world.clock.speed === 0 || wallSeconds <= 0) return;
    const target = Math.min(
      world.clock.simTime + wallSeconds * world.clock.speed,
      this.script.scenario.durationSimSec,
    );
    while (world.clock.simTime < target) {
      const before = copy(world);
      this.atTime(Math.min(target, Math.floor(world.clock.simTime + 1e-8) + 1));
      if (world.clock.simTime >= this.script.scenario.durationSimSec) {
        world.operation.status = 'ended';
        world.clock.speed = 0;
      }
      this.host.emit({ t: 'tick', clock: copy(world.clock), patch: diffWorld(before, world) });
      this.beats();
    }
  }
}
/** Validation is cheap for the fixture and intentionally enabled in every build. */
export function validatedMessage(message: ServerMessage): ServerMessage {
  return ServerMessageSchema.parse(message);
}

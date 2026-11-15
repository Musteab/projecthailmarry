import { applyWorldPatch, ServerMessageSchema } from '@bastion/shared';
import type { ScenarioBeat, ServerMessage, WorldSnapshot } from '@bastion/shared';

export interface RecordedFrame {
  elapsedMs: number;
  message: ServerMessage;
}
export function parseRecording(input: string | RecordedFrame[]): RecordedFrame[] {
  const raw: unknown[] =
    typeof input === 'string'
      ? input
          .split(/\r?\n/)
          .filter((line) => line.trim())
          .map((line, i) => {
            try {
              return JSON.parse(line) as unknown;
            } catch {
              throw new Error(`Invalid recording JSON at line ${i + 1}`);
            }
          })
      : input;
  let previous = -1;
  let operationId: string | undefined;
  const frames = raw.map((item, i) => {
    if (!item || typeof item !== 'object') throw new Error(`Invalid recording frame ${i + 1}`);
    const { elapsedMs, message } = item as Record<string, unknown>;
    if (
      typeof elapsedMs !== 'number' ||
      !Number.isFinite(elapsedMs) ||
      elapsedMs < 0 ||
      elapsedMs < previous
    )
      throw new Error(`Invalid recording time at frame ${i + 1}`);
    const parsed = ServerMessageSchema.parse(message);
    if (i === 0 && (parsed.t !== 'snapshot' || elapsedMs !== 0))
      throw new Error('Recording must begin with a snapshot at elapsedMs 0');
    if (parsed.t === 'snapshot') {
      if (operationId && parsed.world.operation.id !== operationId)
        throw new Error('Recording switches operation');
      operationId = parsed.world.operation.id;
    }
    if (parsed.t === 'tick' && parsed.patch.operation && parsed.patch.operation.id !== operationId)
      throw new Error('Recording switches operation');
    previous = elapsedMs;
    return { elapsedMs, message: parsed };
  });
  if (!frames.length) throw new Error('Recording is empty');
  return frames;
}
/** Pure replay cursor. Default playback emits the exact recorded messages, in recorded order. */
export class RecordingPlayer {
  readonly frames: RecordedFrame[];
  world!: WorldSnapshot;
  latestBeat: ScenarioBeat | null = null;
  elapsedMs = 0;
  index = 1;
  constructor(input: string | RecordedFrame[]) {
    this.frames = parseRecording(input);
    this.reset();
  }
  get durationMs() {
    return this.frames.at(-1)!.elapsedMs;
  }
  get complete() {
    return this.index >= this.frames.length;
  }
  get beats() {
    return this.frames.flatMap((frame) => (frame.message.t === 'beat' ? [frame.message.beat] : []));
  }
  reset() {
    this.world = structuredClone(
      (this.frames[0].message as Extract<ServerMessage, { t: 'snapshot' }>).world,
    );
    this.elapsedMs = 0;
    this.index = 1;
    this.latestBeat = null;
  }
  private apply(message: ServerMessage) {
    if (message.t === 'snapshot') this.world = structuredClone(message.world);
    if (message.t === 'tick')
      this.world = applyWorldPatch(
        this.world,
        structuredClone(message.patch),
        structuredClone(message.clock),
      );
    if (message.t === 'beat') this.latestBeat = message.beat;
  }
  advance(wallSeconds: number, onMessage: (message: ServerMessage) => void, rate = 1) {
    if (!Number.isFinite(wallSeconds) || wallSeconds < 0 || !Number.isFinite(rate) || rate < 0)
      throw new Error('Invalid replay advance');
    this.elapsedMs = Math.min(this.durationMs, this.elapsedMs + wallSeconds * 1000 * rate);
    while (this.index < this.frames.length && this.frames[this.index].elapsedMs <= this.elapsedMs) {
      const message = structuredClone(this.frames[this.index++].message);
      this.apply(message);
      onMessage(message);
    }
  }
  seek(simTime: number, onMessage: (message: ServerMessage) => void) {
    if (!Number.isFinite(simTime) || simTime < 0) throw new Error('Invalid replay seek time');
    this.reset();
    onMessage({ t: 'snapshot', world: structuredClone(this.world) });
    let end = 0;
    for (const frame of this.frames) {
      const message = frame.message;
      const time =
        message.t === 'snapshot'
          ? message.world.clock.simTime
          : message.t === 'tick'
            ? message.clock.simTime
            : message.t === 'beat'
              ? message.beat.simTime
              : undefined;
      if (time !== undefined && time > simTime) break;
      end = frame.elapsedMs;
    }
    this.advance(end / 1000, onMessage);
  }
}

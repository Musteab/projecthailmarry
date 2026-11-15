import type { Clock, LngLat, Unit } from '@bastion/shared';

/** Client-local receipt time; never written into the wire contract. Use Date.now(), not performance.now(). */
export type AnchoredClock = Clock & { receivedAtMs: number };
export const anchorClock = (clock: Clock, receivedAtMs: number): AnchoredClock => ({
  ...clock,
  receivedAtMs,
});

/** Unanchored wire clocks stay at their last known sim time. */
export function simTimeNow(clock: Clock, nowMs: number): number {
  const received = (clock as Partial<AnchoredClock>).receivedAtMs ?? nowMs;
  const time = clock.simTime + (Math.min(2000, Math.max(0, nowMs - received)) / 1000) * clock.speed;
  return Math.min(time, clock.durationSimSec ?? Infinity);
}

const radians = (degrees: number) => (degrees * Math.PI) / 180;
function distance(a: LngLat, b: LngLat) {
  const lat = radians(b[1] - a[1]),
    lon = radians(b[0] - a[0]);
  const h =
    Math.sin(lat / 2) ** 2 +
    Math.cos(radians(a[1])) * Math.cos(radians(b[1])) * Math.sin(lon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function unitPositionAt(
  unit: Unit,
  clock: Clock,
  nowMs: number,
): { position: LngLat; heading: number } {
  const a = unit.assignment;
  if (
    !a ||
    !['dispatched', 'en_route', 'transporting', 'returning'].includes(unit.status) ||
    !a.route.length
  )
    return { position: unit.position, heading: unit.heading };
  if (a.route.length === 1) return { position: a.route[0], heading: unit.heading };
  const lengths = a.route.slice(1).map((point, i) => distance(a.route[i], point));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (!total) return { position: a.route[0], heading: unit.heading };
  const time = simTimeNow(clock, nowMs);
  const fraction =
    a.etaSimTime <= a.departedSimTime
      ? Number(time >= a.etaSimTime)
      : Math.max(0, Math.min(1, (time - a.departedSimTime) / (a.etaSimTime - a.departedSimTime)));
  let remaining = fraction * total;
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i];
    if (!length) continue;
    if (remaining <= length || i === lengths.length - 1) {
      const from = a.route[i],
        to = a.route[i + 1];
      const progress = Math.min(1, remaining / length);
      const y = Math.sin(radians(to[0] - from[0])) * Math.cos(radians(to[1]));
      const x =
        Math.cos(radians(from[1])) * Math.sin(radians(to[1])) -
        Math.sin(radians(from[1])) * Math.cos(radians(to[1])) * Math.cos(radians(to[0] - from[0]));
      return {
        position: [from[0] + (to[0] - from[0]) * progress, from[1] + (to[1] - from[1]) * progress],
        heading: ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360,
      };
    }
    remaining -= length;
  }
  return { position: a.route.at(-1)!, heading: unit.heading };
}

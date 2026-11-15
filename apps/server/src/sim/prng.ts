/**
 * The only source of randomness inside the simulation. Seeded from the scenario, so the same
 * scenario and seed always produce the same run. Never use Math.random() in sim code.
 */
export class Prng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform in [0, 1). mulberry32. */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Prng.pick: empty list');
    return items[this.int(items.length)]!;
  }

  /**
   * An independent stream for one subsystem, derived from this seed and a label. Adding draws
   * to one subsystem then does not shift the numbers every other subsystem sees.
   */
  fork(label: string): Prng {
    let hash = this.state ^ 0x9e3779b9;
    for (let i = 0; i < label.length; i++) {
      hash = Math.imul(hash ^ label.charCodeAt(i), 0x01000193) >>> 0;
    }
    return new Prng(hash);
  }
}

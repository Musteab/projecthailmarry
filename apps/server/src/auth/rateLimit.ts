/**
 * Counts failed attempts per key inside a sliding window, in memory.
 * Enough to blunt password guessing on a single-process server; it resets on restart.
 */
export class AttemptLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly maxFailures: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  private recent(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const kept = (this.failures.get(key) ?? []).filter((at) => at > cutoff);
    if (kept.length === 0) this.failures.delete(key);
    else this.failures.set(key, kept);
    return kept;
  }

  /** Seconds until the key may try again; 0 when it is not blocked. */
  retryAfterSec(key: string): number {
    const recent = this.recent(key);
    if (recent.length < this.maxFailures) return 0;
    // Blocked until the oldest failure that still counts leaves the window.
    const oldest = recent[recent.length - this.maxFailures]!;
    return Math.max(1, Math.ceil((oldest + this.windowMs - this.now()) / 1000));
  }

  recordFailure(key: string): void {
    this.failures.set(key, [...this.recent(key), this.now()]);
  }

  reset(key: string): void {
    this.failures.delete(key);
  }

  /** Number of keys currently tracked (for tests and for bounding memory). */
  get size(): number {
    return this.failures.size;
  }

  /** Drops keys whose failures have all expired. */
  prune(): void {
    for (const key of [...this.failures.keys()]) this.recent(key);
  }
}

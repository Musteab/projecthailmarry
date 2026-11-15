import type { IntelHost, RegionConfig } from '@bastion/shared';
import type { FeedAdapter } from './adapters';
export * from './adapters';
/** One poll per feed/region; a separate bounded dedup set for every live operation. */
export class FeedScheduler {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private stopped = false;
  private feeds = new Map<string, { adapter: FeedAdapter; next: number; failures: number }[]>();
  private seen = new Map<string, Set<string>>();
  constructor(
    private host: IntelHost,
    private factory: (region: RegionConfig) => FeedAdapter[],
    private enabled = false,
    private log: (message: string) => void = () => {},
  ) {}
  async pollOnce(now = Date.now()) {
    if (!this.enabled || this.stopped || this.busy) return;
    this.busy = true;
    try {
      const operations = this.host
        .listLiveOperations()
        .filter((o) => o.mode === 'live' && o.status !== 'ended');
      const active = new Set(operations.map((o) => o.id));
      for (const id of this.seen.keys()) if (!active.has(id)) this.seen.delete(id);
      const regions = new Set(operations.map((o) => o.regionId));
      for (const id of this.feeds.keys()) if (!regions.has(id)) this.feeds.delete(id);
      for (const regionId of regions) {
        if (!this.feeds.has(regionId))
          this.feeds.set(
            regionId,
            this.factory(this.host.getRegion(regionId).config).map((adapter) => ({
              adapter,
              next: 0,
              failures: 0,
            })),
          );
        for (const state of this.feeds.get(regionId)!) {
          if (now < state.next) continue;
          try {
            const values = await state.adapter.poll();
            if (this.stopped) return;
            for (const operation of operations.filter((o) => o.regionId === regionId)) {
              const seen = this.seen.get(operation.id) ?? new Set<string>();
              this.seen.set(operation.id, seen);
              for (const value of values) {
                const key = state.adapter.id + ':' + value.upstreamId;
                if (seen.has(key)) continue;
                this.host.ingestSignal(operation.id, value.signal);
                seen.add(key);
                if (seen.size > 2000) seen.delete(seen.values().next().value!);
              }
            }
            state.failures = 0;
            state.next = now + 60000;
          } catch {
            state.failures++;
            state.next = now + Math.min(900000, 60000 * 2 ** state.failures);
            try {
              this.log(`Feed ${state.adapter.id} temporarily unavailable; retry scheduled`);
            } catch {
              /* telemetry must not affect polling */
            }
          }
        }
      }
    } finally {
      this.busy = false;
    }
  }
  start() {
    if (!this.enabled || this.timer) return;
    this.stopped = false;
    void this.pollOnce().catch(() => {});
    this.timer = setInterval(() => {
      void this.pollOnce().catch(() => {});
    }, 1000);
    this.timer.unref?.();
  }
  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    this.timer = undefined;
  }
}

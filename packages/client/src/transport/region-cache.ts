import { RegionStaticSchema } from '@bastion/shared';
import type { RegionStatic } from '@bastion/shared';
import { ApiError } from './index';
/** Static geography only. Never stores tokens, signals, operations or user details. */
export class RegionCache {
  private memory = new Map<string, Promise<RegionStatic>>();
  constructor(private storage: CacheStorage | undefined = globalThis.caches) {}
  load(url: string, fetchRegion: () => Promise<unknown>): Promise<RegionStatic> {
    const prior = this.memory.get(url);
    if (prior) return prior;
    const task = (async () => {
      const cache = await this.storage?.open('bastion-region-v1').catch(() => undefined);
      try {
        const region = RegionStaticSchema.parse(await fetchRegion());
        await cache
          ?.put(
            url,
            new Response(JSON.stringify(region), {
              headers: { 'Content-Type': 'application/json' },
            }),
          )
          .catch(() => {});
        return region;
      } catch (error) {
        // Authorization failures and contract drift must never be hidden by offline data.
        if (!(error instanceof ApiError) && error instanceof TypeError) {
          const saved = await cache?.match(url).catch(() => undefined);
          if (saved) {
            const parsed = RegionStaticSchema.safeParse(await saved.json().catch(() => undefined));
            if (parsed.success) return parsed.data;
          }
        }
        throw error;
      }
    })();
    this.memory.set(url, task);
    void task.catch(() => this.memory.delete(url));
    return task;
  }
  clear() {
    this.memory.clear();
  }
}

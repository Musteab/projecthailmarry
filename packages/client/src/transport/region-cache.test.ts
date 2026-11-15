import { expect, it, vi } from 'vitest';
import { loadRegionMini } from '@bastion/shared/fixtures';
import { RegionCache } from './region-cache';
import { ApiError } from './index';
import { anchorClock, simTimeNow } from '../helpers';
it('deduplicates static requests and validates offline cache while preserving authorization errors', async () => {
  const saved = new Map<string, Response>();
  const storage = {
    open: async () => ({
      put: async (url: string, response: Response) => {
        saved.set(url, response);
      },
      match: async (url: string) => saved.get(url)?.clone(),
    }),
  } as unknown as CacheStorage;
  const cache = new RegionCache(storage);
  const load = vi.fn(async () => loadRegionMini());
  const url = 'https://api.test/api/regions/mini/static';
  await Promise.all([cache.load(url, load), cache.load(url, load)]);
  expect(load).toHaveBeenCalledTimes(1);
  const offline = new RegionCache(storage);
  expect(
    (
      await offline.load(url, async () => {
        throw new TypeError('Network unavailable');
      })
    ).config.id,
  ).toBe('region-mini');
  const unauthorized = new RegionCache(storage);
  await expect(
    unauthorized.load(url, async () => {
      throw new ApiError(401, 'unauthorized', 'Sign in');
    }),
  ).rejects.toMatchObject({ status: 401 });
});
it('caps extrapolation after a stalled connection at every supported speed', () => {
  for (const speed of [1, 5, 20, 60]) {
    const clock = anchorClock({ simTime: 10, speed, durationSimSec: null }, 1000);
    expect(simTimeNow(clock, 100000)).toBe(10 + 2 * speed);
  }
});

import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadRegionMini } from '@bastion/shared/fixtures';
import type { IntelHost, Operation } from '@bastion/shared';
import { createFeedAdapters, parseGauge, parseQuakes, parseNws } from './adapters';
import { FeedScheduler } from './index';
import { classify } from '../fusion';
const fixture = (id: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../../data/fixtures/feeds/${id}.json`, import.meta.url), 'utf8'),
  );
it('normalizes recorded gauge/earthquake payloads, handles no alerts, and filters earthquake radius', () => {
  const gauge = parseGauge(fixture('usgs-gauge'));
  expect(gauge[0].signal.data?.gaugeHeightM).toBeCloseTo(23.99 * 0.3048);
  expect(gauge[0].signal.body).toContain('not water depth');
  const quakes = fixture('usgs-earthquake');
  const center = quakes.features[0].geometry.coordinates.slice(0, 2) as [number, number];
  expect(parseQuakes(quakes, center)).not.toHaveLength(0);
  expect(parseQuakes(quakes, [0, 0], 1000)).toEqual([]);
  expect(parseNws(fixture('nws'), [-122.64, 45.49])).toEqual([]);
  expect(
    classify({ ...gauge[0].signal, id: 's', simTime: 0, title: 'Warning: injuries possible' }),
  ).toBeUndefined();
});
it('replay never invokes fetch, and normalized warnings retain upstream ids', async () => {
  const fetcher = vi.fn<typeof fetch>();
  const region = { ...loadRegionMini().config, id: 'portland' };
  const adapters = createFeedAdapters(region, fetcher, { 'usgs-gauge': fixture('usgs-gauge') });
  await Promise.all(adapters.map((a) => a.poll()));
  expect(fetcher).not.toHaveBeenCalled();
  expect(
    parseNws(
      {
        features: [
          {
            id: 'alert-1',
            properties: {
              headline: 'Test warning',
              description: 'Synthetic adapter test',
              event: 'Flood Warning',
            },
          },
        ],
      },
      [-122.64, 45.49],
    )[0].upstreamId,
  ).toBe('alert-1');
});
it('polls only when enabled, ingests live operations only, deduplicates per operation and backs off', async () => {
  const region = loadRegionMini();
  const operations: Operation[] = [
    {
      id: 'live',
      regionId: region.config.id,
      scenarioId: null,
      mode: 'live',
      name: 'live',
      status: 'running',
      createdAt: '2026-01-01',
      createdBy: 'u',
    },
    {
      id: 'exercise',
      regionId: region.config.id,
      scenarioId: null,
      mode: 'exercise',
      name: 'training',
      status: 'running',
      createdAt: '2026-01-01',
      createdBy: 'u',
    },
  ];
  const ingest = vi.fn((id: string, s: Parameters<IntelHost['ingestSignal']>[1]) => ({
    ...s,
    id,
    simTime: 0,
  }));
  const host: IntelHost = {
    getWorld: () => undefined,
    getRegion: () => region,
    listLiveOperations: () => operations,
    ingestSignal: ingest,
    authenticate: () => {},
  };
  const poll = vi.fn(async () => parseGauge(fixture('usgs-gauge')));
  const factory = () => [{ id: 'gauge', poll }];
  await new FeedScheduler(host, factory, false).pollOnce(0);
  expect(poll).not.toHaveBeenCalled();
  const scheduler = new FeedScheduler(host, factory, true);
  await scheduler.pollOnce(0);
  await scheduler.pollOnce(60000);
  expect(ingest).toHaveBeenCalledTimes(1);
  expect(ingest.mock.calls[0][0]).toBe('live');
  operations.push({ ...operations[0], id: 'second' });
  await scheduler.pollOnce(120000);
  expect(ingest).toHaveBeenCalledTimes(2);
  poll.mockRejectedValueOnce(new Error('upstream unavailable'));
  await scheduler.pollOnce(180000);
  const count = poll.mock.calls.length;
  await scheduler.pollOnce(240000);
  expect(poll).toHaveBeenCalledTimes(count);
  scheduler.stop();
});

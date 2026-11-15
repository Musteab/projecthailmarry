import { z } from 'zod';
import type { RegionConfig, SignalInput } from '@bastion/shared';
export interface FeedSignal {
  upstreamId: string;
  signal: SignalInput;
}
export interface FeedAdapter {
  id: string;
  poll(): Promise<FeedSignal[]>;
}
const collection = z.object({
  features: z.array(
    z.object({
      id: z.union([z.string(), z.number()]).optional(),
      geometry: z.object({ type: z.string(), coordinates: z.unknown() }).nullable().optional(),
      properties: z.record(z.string(), z.unknown()),
    }),
  ),
});
const point = (value: unknown): [number, number] | undefined => {
  const v = z.array(z.number()).safeParse(value);
  return v.success && v.data.length >= 2 && Math.abs(v.data[0]) <= 180 && Math.abs(v.data[1]) <= 90
    ? [v.data[0], v.data[1]]
    : undefined;
};
const str = (v: unknown) => (typeof v === 'string' ? v : '');
function distance(a: [number, number], b: [number, number]) {
  const rad = Math.PI / 180;
  const x = (b[0] - a[0]) * rad * Math.cos(((a[1] + b[1]) * rad) / 2),
    y = (b[1] - a[1]) * rad;
  return Math.hypot(x, y) * 6371000;
}
export function parseNws(payload: unknown, center: [number, number]): FeedSignal[] {
  return collection.parse(payload).features.flatMap((f) => {
    const p = f.properties,
      id = str(p.id) || String(f.id ?? '');
    if (!id) return [];
    return [
      {
        upstreamId: id,
        signal: {
          source: 'official_alert',
          title: str(p.headline) || str(p.event) || 'NWS alert',
          body: [str(p.description), str(p.instruction)].filter(Boolean).join('\n'),
          position: center,
          reliability: 0.98,
          data: {
            feed: 'nws',
            upstreamId: id,
            spatialScope: 'region-alert-reference-point',
            sent: p.sent,
            event: p.event,
          },
        },
      },
    ];
  });
}
export function parseQuakes(
  payload: unknown,
  center: [number, number],
  radiusM = 250000,
): FeedSignal[] {
  return collection.parse(payload).features.flatMap((f) => {
    const position = point(f.geometry?.coordinates),
      p = f.properties,
      id = String(f.id ?? '');
    if (!position || !id || distance(position, center) > radiusM || typeof p.mag !== 'number')
      return [];
    return [
      {
        upstreamId: `${id}:${p.updated ?? p.time}`,
        signal: {
          source: 'official_alert',
          title: str(p.title) || `USGS earthquake magnitude ${p.mag}`,
          body: `USGS reports an earthquake near ${str(p.place)}. Review regional impact; this feed is not an emergency dispatch instruction.`,
          position,
          reliability: 0.98,
          data: {
            feed: 'usgs-earthquake',
            upstreamId: id,
            magnitude: p.mag,
            observedAt: p.time,
            url: p.url,
          },
        },
      },
    ];
  });
}
export function parseGauge(payload: unknown): FeedSignal[] {
  return collection.parse(payload).features.flatMap((f) => {
    const p = f.properties,
      position = point(f.geometry?.coordinates),
      value = Number(p.value),
      at = str(p.time),
      site = str(p.monitoring_location_id),
      unit = str(p.unit_of_measure);
    if (
      !position ||
      p.parameter_code !== '00065' ||
      p.value === null ||
      p.value === '' ||
      !Number.isFinite(value) ||
      !at ||
      !site ||
      !['ft', 'm'].includes(unit)
    )
      return [];
    const id = `${p.time_series_id}:${at}`;
    return [
      {
        upstreamId: id,
        signal: {
          source: 'sensor',
          title: `USGS gauge ${site}`,
          body: `Gauge height ${value} ${unit}, observed ${at}. This is gauge datum height, not water depth over a road.`,
          position,
          reliability: 0.95,
          data: {
            feed: 'usgs-gauge',
            upstreamId: id,
            site,
            observedAt: at,
            gaugeHeightM: unit === 'ft' ? value * 0.3048 : value,
            originalValue: value,
            originalUnit: unit,
            approval: p.approval_status,
          },
        },
      },
    ];
  });
}
export async function fetchFeed(url: string, fetcher: typeof fetch = fetch) {
  const response = await fetcher(url, {
    headers: {
      'User-Agent': 'bastion-hackathon-demo',
      Accept: 'application/geo+json, application/json',
    },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Feed HTTP ${response.status}`);
  return response.json() as Promise<unknown>;
}
export function createFeedAdapters(
  region: RegionConfig,
  fetcher: typeof fetch = fetch,
  replay?: Record<string, unknown>,
): FeedAdapter[] {
  const [w, s, e, n] = region.bbox,
    center: [number, number] = [(w + e) / 2, (s + n) / 2];
  const read = (id: string, url: string) =>
    replay ? Promise.resolve(replay[id] ?? { features: [] }) : fetchFeed(url, fetcher);
  const adapters: FeedAdapter[] = [
    {
      id: 'nws',
      poll: async () =>
        parseNws(
          await read(
            'nws',
            `https://api.weather.gov/alerts/active?point=${center[1]},${center[0]}`,
          ),
          center,
        ),
    },
    {
      id: 'usgs-earthquake',
      poll: async () =>
        parseQuakes(
          await read(
            'usgs-earthquake',
            'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
          ),
          center,
        ),
    },
  ];
  if (region.id === 'portland')
    adapters.push({
      id: 'usgs-gauge',
      poll: async () =>
        parseGauge(
          await read(
            'usgs-gauge',
            'https://api.waterdata.usgs.gov/ogcapi/v0/collections/latest-continuous/items?f=json&monitoring_location_id=USGS-14211550&parameter_code=00065&limit=10',
          ),
        ),
    });
  return adapters;
}

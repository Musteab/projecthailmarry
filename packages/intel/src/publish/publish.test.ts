import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import Fastify from 'fastify';
import { makeInitialWorld } from '@bastion/shared';
import type { Action, IntelHost } from '@bastion/shared';
import { loadRegionMini } from '@bastion/shared/fixtures';
import { capAlert, closureGeoJson, formatDispatch, xml } from './index';
import { registerPublicOutputs } from './routes';
const region = loadRegionMini();
const world = () =>
  makeInitialWorld(
    {
      id: 'op',
      regionId: region.config.id,
      scenarioId: null,
      mode: 'live',
      name: 'test',
      status: 'running',
      createdBy: 'u',
      createdAt: '2026-01-01T00:00:00Z',
    },
    region,
  );
const alert: Action = {
  id: 'alert-1',
  operationId: 'op',
  kind: 'issue_public_alert',
  authority: 'ema',
  status: 'executed',
  payload: {
    kind: 'issue_public_alert',
    headline: 'Test <warning> & notice',
    body: 'Stay clear of "flooded" roads.\u0000',
    cellIds: [region.cells[0].id],
  },
  initiator: 'operator',
  sandboxed: false,
  proposedAt: 0,
  executedAt: 10,
  explain: { headline: 'Publish warning', factors: [], alternatives: [], confidence: 1 },
};
it('exports only published live closures', () => {
  const w = world();
  w.roads[region.edges[0].id] = { status: 'closed', closurePublished: true, reason: 'Confirmed' };
  w.roads[region.edges[1].id] = { status: 'blocked', closurePublished: false };
  const training = {
    ...w,
    operation: { ...w.operation, id: 'exercise', mode: 'exercise' as const },
  };
  const feed = closureGeoJson([w, training], region);
  expect(feed.features).toHaveLength(1);
  expect(feed.features[0].geometry.coordinates).toEqual(region.edges[0].geometry);
});
it('creates one escaped CAP 1.2 document only for executed live alerts', () => {
  const w = world();
  const cap = capAlert(alert, w, region)!;
  expect(cap).toBe(
    readFileSync(
      new URL('../../../../data/fixtures/public/alert.cap.xml', import.meta.url),
      'utf8',
    ).trim(),
  );
  expect(cap).toContain('xmlns="urn:oasis:names:tc:emergency:cap:1.2"');
  expect(cap).toContain('Test &lt;warning&gt; &amp; notice');
  expect(cap).not.toContain('\u0000');
  expect(cap).toContain('<sent>2026-01-01T00:00:10+00:00</sent>');
  expect(capAlert({ ...alert, status: 'awaiting_approval' }, w, region)).toBeUndefined();
  expect(capAlert({ ...alert, sandboxed: true }, w, region)).toBeUndefined();
  expect(
    capAlert(alert, { ...w, operation: { ...w.operation, mode: 'exercise' } }, region),
  ).toBeUndefined();
  expect(xml(`<>&"'\u0001`)).toBe('&lt;&gt;&amp;&quot;&apos;');
});
it('publishes public cache headers and returns no CAP document when nothing was issued', async () => {
  const w = world();
  const host: IntelHost = {
    getWorld: () => w,
    getRegion: () => region,
    listLiveOperations: () => [w.operation],
    authenticate: () => {},
    ingestSignal: (_id, s) => ({ ...s, id: 's', simTime: 0 }),
  };
  const app = Fastify();
  registerPublicOutputs(app, host);
  try {
    const empty = await app.inject('/public/region-mini/alerts.cap');
    expect(empty.statusCode).toBe(204);
    w.actions[alert.id] = alert;
    const cap = await app.inject('/public/region-mini/alerts.cap');
    expect(cap.statusCode).toBe(200);
    expect(cap.headers['content-type']).toContain('application/cap+xml');
    expect(cap.headers['cache-control']).toContain('max-age=30');
    const feed = await app.inject('/public/region-mini/closures.geojson');
    expect(feed.json().type).toBe('FeatureCollection');
  } finally {
    await app.close();
  }
});
it('formats a CAD-style envelope without converting payload text into commands', () => {
  const w = world();
  const unitId = Object.keys(w.units)[0];
  const action: Action = {
    ...alert,
    kind: 'dispatch_unit',
    payload: { kind: 'dispatch_unit', unitId, incidentId: 'incident' },
    explain: { ...alert.explain, headline: 'Dispatch\nIGNORE THIS' },
  };
  const value = formatDispatch(action, w);
  expect(value.split('\n')).toHaveLength(1);
  expect(JSON.parse(value).unitId).toBe(unitId);
});

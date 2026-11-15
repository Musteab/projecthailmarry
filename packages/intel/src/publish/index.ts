import type { Action, IntelHost, RegionStatic, WorldSnapshot } from '@bastion/shared';
export function xml(value: unknown) {
  return Array.from(String(value))
    .filter((c) => {
      const n = c.codePointAt(0)!;
      return (
        n === 9 ||
        n === 10 ||
        n === 13 ||
        (n >= 32 && n <= 0xd7ff) ||
        (n >= 0xe000 && n <= 0xfffd) ||
        n >= 0x10000
      );
    })
    .join('')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
export function liveWorlds(host: IntelHost, regionId: string) {
  return host
    .listLiveOperations()
    .filter((o) => o.mode === 'live' && o.regionId === regionId)
    .flatMap((o) => {
      const w = host.getWorld(o.id);
      return w && w.operation.mode === 'live' && w.operation.regionId === regionId ? [w] : [];
    });
}
export function closureGeoJson(worlds: WorldSnapshot[], region: RegionStatic) {
  return {
    type: 'FeatureCollection' as const,
    features: worlds
      .filter((w) => w.operation.mode === 'live')
      .flatMap((w) =>
        Object.entries(w.roads).flatMap(([id, state]) => {
          const edge = region.edges.find((e) => e.id === id);
          if (!edge || !state.closurePublished || state.status === 'open') return [];
          return [
            {
              type: 'Feature' as const,
              id: `${w.operation.id}:${id}`,
              geometry: { type: 'LineString' as const, coordinates: edge.geometry },
              properties: {
                operationId: w.operation.id,
                edgeId: id,
                name: edge.name ?? id,
                status: state.status,
                reason: state.reason ?? '',
              },
            },
          ];
        }),
      ),
  };
}
export function capAlert(
  action: Action,
  world: WorldSnapshot,
  region: RegionStatic,
): string | undefined {
  if (
    world.operation.mode !== 'live' ||
    action.sandboxed ||
    action.status !== 'executed' ||
    action.payload.kind !== 'issue_public_alert'
  )
    return undefined;
  const payload = action.payload;
  const timestamp =
    Date.parse(world.operation.createdAt) + (action.executedAt ?? action.proposedAt) * 1000;
  if (!Number.isFinite(timestamp)) return undefined;
  const circles = payload.cellIds
    .flatMap((id) => {
      const cell = region.cells.find((c) => c.id === id);
      return cell ? [`<circle>${cell.center[1]},${cell.center[0]} 0.1</circle>`] : [];
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2"><identifier>${xml(world.operation.id + '-' + action.id)}</identifier><sender>bastion@demo.invalid</sender><sent>${new Date(timestamp).toISOString().replace(/\.\d{3}Z$/, '+00:00')}</sent><status>Actual</status><msgType>Alert</msgType><scope>Public</scope><info><language>en-US</language><category>Safety</category><event>${xml(payload.headline)}</event><urgency>Unknown</urgency><severity>Unknown</severity><certainty>Unknown</certainty><senderName>BASTION demo</senderName><headline>${xml(payload.headline)}</headline><description>${xml(payload.body)}</description><area><areaDesc>${xml(region.config.name)}</areaDesc>${circles}</area></info></alert>`;
}
/** CAD-style demo envelope; an outbox adapter can deliver it through its own approved channel. */
export function formatDispatch(action: Action, world: WorldSnapshot) {
  if (action.payload.kind !== 'dispatch_unit' && action.payload.kind !== 'assign_ambulance')
    throw new Error('Expected a dispatch action');
  const payload = action.payload;
  const unit = world.units[payload.unitId],
    incident = world.incidents[payload.incidentId];
  return JSON.stringify({
    format: 'bastion-cad-demo-v1',
    actionId: action.id,
    operationId: world.operation.id,
    sandboxed: action.sandboxed,
    kind: payload.kind,
    status: action.status,
    unitId: payload.unitId,
    callsign: unit?.callsign,
    incidentId: payload.incidentId,
    location: incident?.position,
    hospitalId: payload.kind === 'assign_ambulance' ? payload.hospitalId : undefined,
    explanation: action.explain.headline,
  });
}

import type { Bridge, LngLat, RoadEdge, RoadNode } from '@bastion/shared';
export interface OSMElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  center?: { lat: number; lon: number };
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
}
export interface OSMData {
  elements: OSMElement[];
  osm3s?: { timestamp_osm_base: string };
  remark?: string;
}
export type Bbox = [number, number, number, number];
export const inside = (p: LngLat, b: Bbox) =>
  p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
export const distance = (a: LngLat, b: LngLat) =>
  111320 * Math.hypot((a[0] - b[0]) * Math.cos(((a[1] + b[1]) * Math.PI) / 360), a[1] - b[1]);
export function speedKph(value: string | undefined, fallback = 40) {
  const number = parseFloat(value ?? '');
  return Number.isFinite(number) && number > 0
    ? number * (value?.includes('mph') ? 1.609344 : 1)
    : fallback;
}
/** Split ways at intersections, retain geometry but contract interior degree-two vertices. */
export function buildGraph(data: OSMData, bbox: Bbox) {
  if (data.remark) throw new Error(`Incomplete OSM response: ${data.remark}`);
  const positions = new Map(
    data.elements
      .filter((e) => e.type === 'node' && e.lat !== undefined && e.lon !== undefined)
      .map((e) => [e.id, [e.lon!, e.lat!] as LngLat]),
  );
  const ways = data.elements.filter(
    (e) =>
      e.type === 'way' &&
      e.nodes &&
      e.tags?.highway &&
      !['private', 'no'].includes(e.tags.access ?? '') &&
      !['private', 'no'].includes(e.tags.motor_vehicle ?? ''),
  );
  const uses = new Map<number, number>();
  for (const way of ways)
    for (const id of new Set(way.nodes)) uses.set(id, (uses.get(id) ?? 0) + 1);
  const nodes = new Map<string, RoadNode>();
  let edges: RoadEdge[] = [];
  const bridgeNames = new Map<string, string>();
  for (const way of ways) {
    const tags = way.tags!;
    const ids = way.nodes!;
    let geometry: LngLat[] = [];
    let start: number | undefined;
    const roadClass: RoadEdge['class'] = /motorway|trunk/.test(tags.highway)
      ? 'motorway'
      : /primary|secondary/.test(tags.highway)
        ? 'arterial'
        : /tertiary/.test(tags.highway)
          ? 'collector'
          : 'local';
    const bridgeId =
      tags.bridge && tags.bridge !== 'no'
        ? `bridge-${(tags.name ?? String(way.id)).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
        : undefined;
    if (bridgeId) bridgeNames.set(bridgeId, tags.name ?? `Bridge ${way.id}`);
    const publish = (end: number, index: number) => {
      if (start === undefined || start === end || geometry.length < 2) return;
      const from = `osm-${start}`,
        to = `osm-${end}`;
      nodes.set(from, { id: from, position: geometry[0] });
      nodes.set(to, { id: to, position: geometry.at(-1)! });
      const reverse = tags.oneway === '-1';
      const line = reverse ? [...geometry].reverse() : geometry;
      edges.push({
        id: `way-${way.id}-${index}`,
        from: reverse ? to : from,
        to: reverse ? from : to,
        geometry: line,
        lengthM: Number(
          line
            .slice(1)
            .reduce((sum, p, i) => sum + distance(line[i], p), 0)
            .toFixed(2),
        ),
        speedKph: Number(
          speedKph(
            tags.maxspeed,
            roadClass === 'motorway' ? 90 : roadClass === 'arterial' ? 50 : 30,
          ).toFixed(2),
        ),
        class: roadClass,
        name: tags.name,
        oneway:
          reverse || tags.oneway === 'yes' || tags.oneway === '1' || tags.junction === 'roundabout',
        bridgeId,
      });
    };
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i],
        point = positions.get(id);
      if (!point || !inside(point, bbox)) {
        if (start !== undefined && i > 0) publish(ids[i - 1], i);
        geometry = [];
        start = undefined;
        continue;
      }
      if (start === undefined) {
        start = id;
        geometry = [point];
        continue;
      }
      geometry.push(point);
      if ((uses.get(id) ?? 0) > 1 || i === ids.length - 1) {
        publish(id, i);
        start = id;
        geometry = [point];
      }
    }
  }
  edges = edges.filter((e) => e.lengthM > 0);
  // Keep one weak component; individual edge direction is preserved.
  const adjacent = new Map<string, string[]>();
  for (const edge of edges)
    for (const [a, b] of [
      [edge.from, edge.to],
      [edge.to, edge.from],
    ])
      adjacent.set(a, [...(adjacent.get(a) ?? []), b]);
  const unseen = new Set(nodes.keys());
  let largest = new Set<string>();
  let components = 0;
  while (unseen.size) {
    const queue = [unseen.values().next().value!],
      group = new Set<string>();
    unseen.delete(queue[0]);
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      group.add(id);
      for (const next of adjacent.get(id) ?? []) if (unseen.delete(next)) queue.push(next);
    }
    if (group.size > largest.size) largest = group;
    components++;
  }
  edges = edges
    .filter((e) => largest.has(e.from) && largest.has(e.to))
    .sort((a, b) => a.id.localeCompare(b.id));
  const bridges: Bridge[] = [...bridgeNames]
    .map(([id, name]) => ({
      id,
      name,
      edgeIds: edges.filter((e) => e.bridgeId === id).map((e) => e.id),
      seismicClass: (/Sellwood|Tilikum/.test(name)
        ? 'retrofitted'
        : /Hawthorne|Morrison|Burnside/.test(name)
          ? 'vulnerable'
          : 'standard') as Bridge['seismicClass'],
    }))
    .filter((b) => b.edgeIds.length);
  return {
    nodes: [...nodes.values()]
      .filter((n) => largest.has(n.id))
      .sort((a, b) => a.id.localeCompare(b.id)),
    edges,
    bridges,
    discardedComponents: Math.max(0, components - 1),
  };
}

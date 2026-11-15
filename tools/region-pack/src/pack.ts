import type { Facility, GridSection, RegionStatic, UnitSeed, LngLat } from '@bastion/shared';
import { RegionStaticSchema } from '@bastion/shared';
import { buildGraph, distance, inside } from './graph';
import type { OSMData, Bbox } from './graph';
import { buildCells } from './cells';
export interface FacilityOverride {
  id: string;
  name?: string;
  capacity?: number;
  remove?: boolean;
  kind?: Facility['kind'];
  position?: LngLat;
}
export function makePack(
  id: string,
  bbox: Bbox,
  population: number,
  roads: OSMData,
  facilities: OSMData,
  buildings: OSMData,
  overrides: FacilityOverride[] = [],
): RegionStatic {
  const graph = buildGraph(roads, bbox);
  if (!graph.nodes.length) throw new Error('Road graph is empty');
  const nearest = (p: LngLat) =>
    graph.nodes.reduce((a, b) => (distance(a.position, p) < distance(b.position, p) ? a : b)).id;
  const candidates: Facility[] = [];
  for (const e of facilities.elements) {
    const tags = e.tags ?? {},
      p = e.center ?? e;
    if (p.lat === undefined || p.lon === undefined) continue;
    const position: LngLat = [p.lon, p.lat];
    if (!inside(position, bbox)) continue;
    const kind: Facility['kind'] | undefined =
      tags.amenity === 'hospital'
        ? 'hospital'
        : tags.amenity === 'fire_station'
          ? 'fire_station'
          : tags.emergency === 'ambulance_station'
            ? 'ems_station'
            : tags.power === 'substation'
              ? 'substation'
              : tags.amenity === 'school' || tags.amenity === 'community_centre'
                ? 'shelter'
                : undefined;
    if (kind)
      candidates.push({
        id: `${e.type}-${e.id}`,
        name: tags.name ?? `${kind} ${e.id}`,
        kind,
        position,
        nodeId: nearest(position),
        capacity: kind === 'shelter' ? 250 : kind === 'hospital' ? 200 : undefined,
      });
  }
  candidates.sort((a, b) => a.id.localeCompare(b.id));
  let fs = candidates.filter(
    (f, i) =>
      !candidates
        .slice(0, i)
        .some((prior) => prior.kind === f.kind && distance(prior.position, f.position) < 60),
  );
  fs = fs.filter(
    (f) =>
      !['shelter', 'substation'].includes(f.kind) ||
      fs.filter((x) => x.kind === f.kind).indexOf(f) < (f.kind === 'shelter' ? 10 : 4),
  );
  for (const override of overrides) {
    const index = fs.findIndex((f) => f.id === override.id);
    if (override.remove) {
      if (index >= 0) fs.splice(index, 1);
      continue;
    }
    if (index >= 0) {
      const { remove: _, ...patch } = override;
      fs[index] = { ...fs[index], ...patch };
      fs[index].nodeId = nearest(fs[index].position);
    } else if (override.position && override.kind)
      fs.push({
        id: override.id,
        name: override.name ?? override.id,
        kind: override.kind,
        position: override.position,
        nodeId: nearest(override.position),
        capacity: override.capacity,
      });
  }
  // Explicit synthetic staging facilities, co-located with an accessible station.
  const staging = fs.find((f) => f.kind === 'fire_station') ?? fs[0];
  if (!staging) throw new Error('No facilities in region');
  fs.push(
    { ...staging, id: 'demo-eoc', name: 'Exercise EOC (synthetic)', kind: 'eoc' },
    {
      ...staging,
      id: 'demo-yard',
      name: 'Exercise public works staging yard (synthetic)',
      kind: 'public_works_yard',
    },
  );
  const cells = buildCells(bbox, buildings, population);
  const sections: GridSection[] = [];
  for (const substation of fs.filter((f) => f.kind === 'substation')) {
    // Follow actual connected edges. Each feeder is a synthetic utility topology.
    for (let feeder = 0; feeder < 2; feeder++) {
      let node = substation.nodeId;
      const visited = new Set<string>();
      let upstream: string | null = null;
      for (let part = 0; part < 4; part++) {
        const edges = graph.edges
          .filter((e) => (e.from === node || e.to === node) && !visited.has(e.id))
          .sort((a, b) => a.id.localeCompare(b.id));
        const edge = edges[(feeder + part) % edges.length];
        if (!edge) break;
        visited.add(edge.id);
        const path = edge.from === node ? edge.geometry : [...edge.geometry].reverse();
        node = edge.from === node ? edge.to : edge.from;
        const sid = `grid-${substation.id}-${feeder}-${part}`;
        sections.push({
          id: sid,
          feederId: `feeder-${substation.id}-${feeder}`,
          substationId: substation.id,
          upstreamSectionId: upstream,
          path,
          cellIds: [],
          customers: 0,
          criticalFacilityIds: [],
        });
        upstream = sid;
      }
    }
  }
  if (!sections.length)
    throw new Error('No usable substations; supply an explicit facility override');
  for (const cell of cells) {
    const nearestSection = sections.reduce((a, b) =>
      Math.min(...a.path.map((p) => distance(p, cell.center))) <
      Math.min(...b.path.map((p) => distance(p, cell.center)))
        ? a
        : b,
    );
    nearestSection.cellIds.push(cell.id);
    nearestSection.customers += Math.round(cell.population / 2.5);
  }
  for (const facility of fs.filter((f) => ['hospital', 'shelter'].includes(f.kind)))
    sections
      .reduce((a, b) =>
        distance(a.path.at(-1)!, facility.position) < distance(b.path.at(-1)!, facility.position)
          ? a
          : b,
      )
      .criticalFacilityIds.push(facility.id);
  const units: UnitSeed[] = [];
  const add = (f: Facility, kind: UnitSeed['kind'], authority: UnitSeed['authority']) =>
    units.push({
      id: `unit-${kind}-${f.id}`,
      callsign: `${kind.replaceAll('_', ' ')} ${units.length + 1}`,
      kind,
      authority,
      homeFacilityId: f.id,
    });
  for (const f of fs) {
    if (f.kind === 'fire_station') {
      add(f, 'engine', 'fire_rescue');
      if (units.filter((u) => u.kind === 'swift_water').length < 3)
        add(f, 'swift_water', 'fire_rescue');
      if (units.filter((u) => u.kind === 'usar').length < 3) add(f, 'usar', 'fire_rescue');
    }
    if (f.kind === 'hospital' || f.kind === 'ems_station') {
      add(f, 'als_ambulance', 'ems');
      add(f, 'bls_ambulance', 'ems');
    }
    if (f.kind === 'public_works_yard') add(f, 'public_works', 'public_works');
    if (f.kind === 'substation') add(f, 'utility_crew', 'utility');
    if (f.kind === 'eoc') add(f, 'police', 'ema');
  }
  // Preserve the initial crews, then add a western reserve for river-crossing exercises.
  const western = fs
    .filter((f) => f.kind === 'fire_station' && f.position[0] < -122.68)
    .sort((a, b) => b.position[1] - a.position[1])[0];
  if (western && !units.some((u) => u.kind === 'usar' && u.homeFacilityId === western.id))
    add(western, 'usar', 'fire_rescue');
  const westStaging = fs
    .filter((f) => f.kind === 'fire_station' && f.position[0] < -122.68)
    .sort((a, b) => a.position[1] - b.position[1])[0];
  if (westStaging) add(westStaging, 'public_works', 'public_works');
  return RegionStaticSchema.parse({
    config: {
      id,
      name: 'Portland exercise region',
      bbox,
      defaultCamera: { center: [-122.641, 45.49], zoom: 12.4, pitch: 55, bearing: -15 },
      hazards: ['flash_flood', 'earthquake', 'tornado', 'hurricane'],
      h3Resolution: 10,
      population,
    },
    nodes: graph.nodes,
    edges: graph.edges,
    bridges: graph.bridges,
    facilities: fs,
    cells,
    grid: { sections },
    units,
  });
}

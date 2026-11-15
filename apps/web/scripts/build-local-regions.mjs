import fs from 'node:fs';
import console from 'node:console';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { polygonToCells, cellToLatLng, cellToBoundary } from 'h3-js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const configs = [
  {
    id: 'sunway',
    name: 'Sunway City',
    bbox: [101.594, 3.058, 101.621, 3.08],
    center: [101.6073, 3.0682],
  },
  {
    id: 'srimuda',
    name: 'Taman Sri Muda',
    bbox: [101.524, 3.019, 101.551, 3.046],
    center: [101.537, 3.033],
  },
];
const distance = (a, b) => Math.hypot((a[0] - b[0]) * 111150, (a[1] - b[1]) * 111320);
for (const config of configs) {
  const raw = JSON.parse(fs.readFileSync(path.join(root, `work/${config.id}-osm.json`), 'utf8'));
  if (raw.remark) throw Error(raw.remark);
  const nodes = new Map(
    raw.elements.filter((e) => e.type === 'node').map((e) => [e.id, [e.lon, e.lat]]),
  );
  const inside = (p) =>
    p &&
    p[0] >= config.bbox[0] &&
    p[0] <= config.bbox[2] &&
    p[1] >= config.bbox[1] &&
    p[1] <= config.bbox[3];
  const ways = raw.elements.filter((e) => e.type === 'way' && e.nodes),
    roads = ways.filter(
      (w) =>
        /^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|service)(_link)?$/.test(
          w.tags?.highway ?? '',
        ) && !['private', 'no'].includes(w.tags?.access),
    );
  let edges = [],
    graphNodes = new Map();
  for (const w of roads)
    for (let i = 1; i < w.nodes.length; i++) {
      const a = nodes.get(w.nodes[i - 1]),
        b = nodes.get(w.nodes[i]);
      if (!inside(a) || !inside(b) || distance(a, b) < 0.1) continue;
      const rev = w.tags.oneway === '-1',
        from = String(w.nodes[rev ? i : i - 1]),
        to = String(w.nodes[rev ? i - 1 : i]);
      graphNodes.set(from, { id: from, position: nodes.get(Number(from)) });
      graphNodes.set(to, { id: to, position: nodes.get(Number(to)) });
      edges.push({
        id: `osm-${w.id}-${i}`,
        from,
        to,
        geometry: rev ? [b, a] : [a, b],
        lengthM: distance(a, b),
        speedKph: Math.min(90, parseInt(w.tags.maxspeed) || 30),
        class: /motorway|trunk/.test(w.tags.highway)
          ? 'motorway'
          : /primary|secondary/.test(w.tags.highway)
            ? 'arterial'
            : /tertiary/.test(w.tags.highway)
              ? 'collector'
              : 'local',
        name: w.tags.name ?? 'Local access road',
        oneway: ['yes', '1', '-1'].includes(w.tags.oneway) || w.tags.junction === 'roundabout',
        ...(w.tags.bridge ? { bridgeId: `bridge-${w.id}` } : {}),
      });
    }
  // Retain the largest strongly connected drivable component: clipping can leave
  // one-way motorway stubs with no route back into the region.
  const forward = new Map([...graphNodes.keys()].map((id) => [id, []])),
    backward = new Map([...graphNodes.keys()].map((id) => [id, []]));
  for (const e of edges) {
    forward.get(e.from).push(e.to);
    backward.get(e.to).push(e.from);
    if (!e.oneway) {
      forward.get(e.to).push(e.from);
      backward.get(e.from).push(e.to);
    }
  }
  const visited = new Set(),
    order = [];
  for (const id of graphNodes.keys()) {
    if (visited.has(id)) continue;
    const stack = [[id, false]];
    while (stack.length) {
      const [at, done] = stack.pop();
      if (done) {
        order.push(at);
        continue;
      }
      if (visited.has(at)) continue;
      visited.add(at);
      stack.push([at, true]);
      for (const next of forward.get(at)) if (!visited.has(next)) stack.push([next, false]);
    }
  }
  visited.clear();
  let largest = [];
  for (const id of order.reverse()) {
    if (visited.has(id)) continue;
    const group = [id];
    visited.add(id);
    for (let i = 0; i < group.length; i++)
      for (const next of backward.get(group[i]))
        if (!visited.has(next)) {
          visited.add(next);
          group.push(next);
        }
    if (group.length > largest.length) largest = group;
  }
  const keep = new Set(largest);
  edges = edges.filter((e) => keep.has(e.from) && keep.has(e.to));
  const graph = [...graphNodes.values()].filter((n) => keep.has(n.id));
  const nearest = (p) =>
    graph.reduce((a, b) => (distance(a.position, p) < distance(b.position, p) ? a : b));
  const surfaces = [],
    landmarks = [];
  for (const w of ways) {
    const t = w.tags ?? {},
      polygon = w.nodes.map((id) => nodes.get(id)).filter(Boolean);
    if (polygon.length < 3 || !polygon.some(inside)) continue;
    const kind = t.building
      ? 'building'
      : t.natural === 'water' || t.water
        ? 'water'
        : t.leisure === 'park'
          ? 'park'
          : t.waterway
            ? 'channel'
            : null;
    if (!kind) continue;
    const h = parseFloat(t.height),
      levels = parseInt(t['building:levels']);
    surfaces.push({
      id: `osm-way-${w.id}`,
      kind,
      polygon,
      height: Math.min(
        150,
        Number.isFinite(h)
          ? h
          : Number.isFinite(levels)
            ? levels * 3.2
            : /hospital|university|commercial|apartments/.test(t.building ?? '')
              ? 24
              : 7 + (w.id % 4) * 3,
      ),
      estimated: !Number.isFinite(h) && !Number.isFinite(levels),
      name: t.name ?? '',
      landmark: /Sunway Pyramid|Sunway Medical|Universiti Sunway/.test(t.name ?? ''),
    });
    if (t.name && (t.amenity || /Pyramid|Lagoon/.test(t.name)))
      landmarks.push({
        name: t.name,
        position: polygon.reduce(
          (a, b) => [a[0] + b[0] / polygon.length, a[1] + b[1] / polygon.length],
          [0, 0],
        ),
        osmId: w.id,
      });
  }
  const find = (re, fallback) => landmarks.find((l) => re.test(l.name))?.position ?? fallback;
  const spec =
    config.id === 'sunway'
      ? [
          [
            'hospitalWest',
            'hospital',
            'Sunway Medical Centre',
            find(/Sunway Medical/, [101.6092, 3.0657]),
          ],
          ['hospitalEast', 'hospital', 'Exercise field medical post', [101.6028, 3.067]],
          [
            'shelterWest',
            'shelter',
            'Sunway University · exercise shelter',
            find(/Universiti Sunway/, [101.6032, 3.0673]),
          ],
          [
            'shelterEast',
            'shelter',
            'Sunway Pyramid · exercise assembly',
            find(/^Sunway Pyramid$/, [101.6073, 3.0731]),
          ],
          ['fireWest', 'fire_station', 'Rescue staging · campus', [101.6035, 3.0663]],
          ['fireEast', 'fire_station', 'Rescue staging · east', [101.6138, 3.0681]],
          ['ems', 'ems_station', 'Exercise medical staging', [101.6093, 3.0653]],
          ['eoc', 'eoc', 'Sunway exercise command', [101.6053, 3.0676]],
          ['substation', 'substation', 'Exercise feeder S-01', [101.6102, 3.0707]],
          ['yard', 'public_works_yard', 'Exercise works staging', [101.5987, 3.064]],
        ]
      : [
          ['hospitalWest', 'hospital', 'Exercise receiving medical post', [101.527, 3.039]],
          ['hospitalEast', 'hospital', 'Exercise east medical post', [101.546, 3.038]],
          ['shelterWest', 'shelter', 'Exercise west assembly', [101.53, 3.033]],
          ['shelterEast', 'shelter', 'Exercise neighbourhood shelter', [101.542, 3.031]],
          ['fireWest', 'fire_station', 'Rescue staging · west', [101.527, 3.027]],
          ['fireEast', 'fire_station', 'Rescue staging · east', [101.545, 3.028]],
          ['ems', 'ems_station', 'Exercise ambulance staging', [101.533, 3.039]],
          ['eoc', 'eoc', 'Sri Muda exercise command', [101.538, 3.038]],
          ['substation', 'substation', 'Exercise feeder S-01', [101.537, 3.029]],
          ['yard', 'public_works_yard', 'Exercise works staging', [101.529, 3.035]],
        ];
  const aliases = {};
  const facilities = spec.map(([alias, kind, name, p]) => {
    const node = nearest(p),
      id = `${config.id}-${alias}`;
    aliases[alias] = id;
    return {
      id,
      kind,
      name,
      position: node.position,
      nodeId: node.id,
      ...(kind === 'shelter' ? { capacity: 200 } : {}),
    };
  });
  const b = config.bbox,
    cells = polygonToCells(
      [
        [b[1], b[0]],
        [b[1], b[2]],
        [b[3], b[2]],
        [b[3], b[0]],
      ],
      9,
    ).map((id) => ({ id, center: cellToLatLng(id).reverse(), elevM: 0, population: 40 }));
  const sections = [0, 1, 2, 3].map((i) => ({
    id: `${config.id}-section-${i}`,
    feederId: `${config.id}-feeder`,
    substationId: aliases.substation,
    upstreamSectionId: i ? `${config.id}-section-0` : null,
    path: [facilities[8].position, facilities[i].position],
    cellIds: cells.filter((_, j) => j % 4 === i).map((c) => c.id),
    customers: 120 + i * 40,
    criticalFacilityIds: [facilities[i].id],
  }));
  const seeds = [
    ['rescue1', 'RSC-01', 'swift_water', 'fire_rescue', 'fireWest'],
    ['rescue2', 'RSC-02', 'swift_water', 'fire_rescue', 'fireEast'],
    ['engine1', 'ENG-01', 'engine', 'fire_rescue', 'fireWest'],
    ['usar1', 'USAR-01', 'usar', 'fire_rescue', 'fireWest'],
    ['medic1', 'MED-01', 'als_ambulance', 'ems', 'ems'],
    ['medic2', 'MED-02', 'als_ambulance', 'ems', 'hospitalWest'],
    ['works1', 'PW-01', 'public_works', 'public_works', 'yard'],
    ['utility1', 'UTL-01', 'utility_crew', 'utility', 'substation'],
  ];
  const units = seeds.map(([alias, callsign, kind, authority, home]) => {
    const id = `${config.id}-${alias}`;
    aliases[alias] = id;
    return { id, callsign, kind, authority, homeFacilityId: aliases[home] };
  });
  const bridges = [...new Set(edges.flatMap((e) => (e.bridgeId ? [e.bridgeId] : [])))].map(
    (id) => ({
      id,
      name: edges.find((e) => e.bridgeId === id).name,
      edgeIds: edges.filter((e) => e.bridgeId === id).map((e) => e.id),
      seismicClass: 'standard',
    }),
  );
  const region = {
    config: {
      id: config.id,
      name: config.name,
      bbox: config.bbox,
      defaultCamera: { center: config.center, zoom: 14.7, pitch: 55, bearing: -20 },
      hazards: ['flash_flood', 'earthquake'],
      h3Resolution: 9,
      population: cells.reduce((a, b) => a + b.population, 0),
    },
    nodes: graph,
    edges,
    bridges,
    facilities,
    cells,
    grid: { sections },
    units,
  };
  const data = {
    region,
    surfaces,
    landmarks,
    aliases,
    cellPolygons: Object.fromEntries(cells.map((c) => [c.id, cellToBoundary(c.id, true)])),
    provenance: {
      source: 'OpenStreetMap contributors',
      license: 'ODbL 1.0',
      retrieved: raw.osm3s?.timestamp_osm_base,
      bounds: config.bbox,
      notes:
        'Real OSM street/building geometry. Heights estimated where absent. Flat terrain, population, utility network, staging and hazards are exercise data. Landmark models are stylised.',
    },
  };
  fs.writeFileSync(path.join(root, `apps/web/src/data/${config.id}.json`), JSON.stringify(data));
  console.log(config.name, {
    roads: edges.length,
    nodes: graph.length,
    buildings: surfaces.filter((s) => s.kind === 'building').length,
    cells: cells.length,
  });
}

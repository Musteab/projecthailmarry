import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { RegionStaticSchema } from '@bastion/shared';
import { makePack } from './pack';
import type { FacilityOverride } from './pack';
import type { Bbox, OSMData } from './graph';
import { distance } from './graph';
import { tilePixel, decodeTerrarium } from './cells';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const { values } = parseArgs({
  options: {
    id: { type: 'string', default: 'portland' },
    bbox: { type: 'string', default: '-122.70,45.44,-122.56,45.54' },
    population: { type: 'string', default: '250000' },
    cache: { type: 'string', default: '.data/region-cache' },
    offline: { type: 'boolean' },
    help: { type: 'boolean' },
  },
});
if (values.help) {
  console.log(
    'pnpm --filter @bastion/region-pack build --id portland --bbox=-122.70,45.44,-122.56,45.54 [--offline] [--cache path]',
  );
  process.exit(0);
}
const bbox = values.bbox.split(',').map(Number) as Bbox,
  population = Number(values.population);
if (
  !/^[a-z0-9-]+$/.test(values.id) ||
  bbox.length !== 4 ||
  bbox.some((x) => !Number.isFinite(x)) ||
  bbox[0] >= bbox[2] ||
  bbox[1] >= bbox[3] ||
  !Number.isSafeInteger(population) ||
  population < 0
)
  throw new Error('Invalid region parameters');
const cache = resolve(root, values.cache),
  output = resolve(root, 'data/regions', values.id);
await mkdir(cache, { recursive: true });
await mkdir(output, { recursive: true });
const cacheParameters = resolve(cache, 'parameters.json');
try {
  const previous = JSON.parse(await readFile(cacheParameters, 'utf8'));
  if (JSON.stringify(previous.bbox) !== JSON.stringify(bbox))
    throw new Error(
      'Cache belongs to a different bounding box; choose a separate --cache directory',
    );
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  await writeFile(cacheParameters, JSON.stringify({ bbox }) + '\n');
}
const hashes: Record<string, string> = {};
async function cached(name: string, url: string, init?: RequestInit) {
  const path = resolve(cache, name);
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch {
    if (values.offline) throw new Error(`Offline cache missing: ${name}`);
    const response = await fetch(url, {
      ...init,
      headers: { 'User-Agent': 'bastion-hackathon-demo', ...init?.headers },
      signal: AbortSignal.timeout(110000),
    });
    if (!response.ok) throw new Error(`Download failed (${response.status}): ${name}`);
    bytes = Buffer.from(await response.arrayBuffer());
    await writeFile(path, bytes);
  }
  hashes[name] = createHash('sha256').update(bytes).digest('hex');
  return bytes;
}
const [w, s, e, n] = bbox,
  area = `${s},${w},${n},${e}`;
const queries = {
  roads: `way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"]["area"!="yes"];(._;>;);out body;`,
  facilities:
    '(nwr["amenity"~"^(hospital|fire_station|school|community_centre)$"];nwr["emergency"="ambulance_station"];nwr["power"="substation"];);out center tags;',
  buildings: 'way["building"];out geom;',
};
const downloads: Record<string, OSMData> = {};
for (const [name, query] of Object.entries(queries)) {
  downloads[name] = JSON.parse(
    (
      await cached(`${name}.json`, 'https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: new URLSearchParams({ data: `[out:json][timeout:90][bbox:${area}];${query}` }),
      })
    ).toString(),
  );
  if (downloads[name].remark) throw new Error(`${name}: incomplete Overpass response`);
}
let overrides: FacilityOverride[] = [];
try {
  overrides = JSON.parse(await readFile(resolve(output, 'overrides.json'), 'utf8'));
} catch {
  /* Optional curation file. */
}
const pack = makePack(
  values.id,
  bbox,
  population,
  downloads.roads,
  downloads.facilities,
  downloads.buildings,
  overrides,
);
const tiles = new Map<string, PNG>();
for (const cell of pack.cells) {
  const tile = tilePixel(cell.center),
    key = `terrain-${tile.z}-${tile.x}-${tile.y}.png`;
  let image = tiles.get(key);
  if (!image) {
    image = PNG.sync.read(
      await cached(
        key,
        `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${tile.z}/${tile.x}/${tile.y}.png`,
      ),
    );
    tiles.set(key, image);
  }
  const offset = (tile.py * image.width + tile.px) * 4;
  cell.elevM = Number(
    decodeTerrarium(image.data[offset], image.data[offset + 1], image.data[offset + 2]).toFixed(2),
  );
}
RegionStaticSchema.parse(pack);
for (const [name, value] of Object.entries({
  region: pack.config,
  roads: { nodes: pack.nodes, edges: pack.edges, bridges: pack.bridges },
  facilities: pack.facilities,
  cells: pack.cells,
  grid: pack.grid,
  units: pack.units,
}))
  await writeFile(resolve(output, `${name}.json`), JSON.stringify(value) + '\n');
const mapping = Object.fromEntries(
  pack.cells.map((cell) => [
    cell.id,
    pack.nodes.reduce((a, b) =>
      distance(a.position, cell.center) < distance(b.position, cell.center) ? a : b,
    ).id,
  ]),
);
await writeFile(resolve(output, 'cell-nodes.json'), JSON.stringify(mapping) + '\n');
await writeFile(
  resolve(output, 'sources.json'),
  JSON.stringify(
    {
      bbox,
      population,
      osmSnapshot: downloads.roads.osm3s?.timestamp_osm_base,
      hashes,
      elevation: 'AWS Terrain Tiles Terrarium, zoom 12',
      populationMethod: 'OSM building footprint weights; synthetic planning total',
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify(
    {
      region: pack.config.id,
      nodes: pack.nodes.length,
      edges: pack.edges.length,
      bridges: pack.bridges.length,
      facilities: pack.facilities.length,
      cells: pack.cells.length,
      gridSections: pack.grid.sections.length,
      units: pack.units.length,
      cellsMapped: Object.keys(mapping).length,
      bytes: JSON.stringify(pack).length,
    },
    null,
    2,
  ),
);

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { RegionStatic } from '@bastion/shared';
import { RegionStaticSchema } from '@bastion/shared';
import { loadRegionMini, MINI_REGION_ID } from '@bastion/shared/fixtures';
import type { RegionIndex } from './index';
import { buildRegionIndex } from './index';

/** The six files of a region pack. */
type PackFile = 'region' | 'roads' | 'facilities' | 'cells' | 'grid' | 'units';

export class RegionPackError extends Error {
  constructor(regionId: string, problem: string) {
    super(`Region pack "${regionId}": ${problem}`);
    this.name = 'RegionPackError';
  }
}

/** Reads and validates data/regions/<id>/{region,roads,facilities,cells,grid,units}.json. */
export function readRegionPack(regionsDir: string, regionId: string): RegionStatic {
  const dir = join(regionsDir, regionId);
  const read = (name: PackFile): unknown => {
    const file = join(dir, `${name}.json`);
    if (!existsSync(file)) throw new RegionPackError(regionId, `missing ${name}.json`);
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as unknown;
    } catch (error) {
      throw new RegionPackError(regionId, `${name}.json is not valid JSON (${String(error)})`);
    }
  };

  const roads = read('roads') as Record<string, unknown>;
  const result = RegionStaticSchema.safeParse({
    config: read('region'),
    nodes: roads?.nodes,
    edges: roads?.edges,
    bridges: roads?.bridges,
    facilities: read('facilities'),
    cells: read('cells'),
    grid: read('grid'),
    units: read('units'),
  });
  if (!result.success) {
    const first = result.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new RegionPackError(regionId, `does not match the RegionStatic contract (${first})`);
  }
  if (result.data.config.id !== regionId) {
    throw new RegionPackError(regionId, `region.json has id "${result.data.config.id}"`);
  }
  return result.data;
}

/**
 * Loads region packs on demand and keeps them in memory, together with their JSON text so the
 * (large) static payload is serialized once.
 */
export class RegionRegistry {
  private readonly loaded = new Map<
    string,
    { region: RegionStatic; json: string; gzip?: Buffer }
  >();
  private readonly indexes = new Map<string, RegionIndex>();

  constructor(
    private readonly regionsDir: string,
    private readonly includeFixtures: boolean,
  ) {}

  /** Ids of every region that can be loaded. */
  list(): string[] {
    const onDisk = existsSync(this.regionsDir)
      ? readdirSync(this.regionsDir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
          .filter((entry) => existsSync(join(this.regionsDir, entry.name, 'region.json')))
          .map((entry) => entry.name)
      : [];
    return this.includeFixtures ? [...onDisk, MINI_REGION_ID] : onDisk;
  }

  has(regionId: string): boolean {
    return this.list().includes(regionId);
  }

  private entry(regionId: string) {
    const cached = this.loaded.get(regionId);
    if (cached) return cached;
    if (!this.has(regionId)) return undefined;

    const region =
      regionId === MINI_REGION_ID && !existsSync(join(this.regionsDir, regionId))
        ? loadRegionMini()
        : readRegionPack(this.regionsDir, regionId);
    const entry: { region: RegionStatic; json: string; gzip?: Buffer } = {
      region,
      json: JSON.stringify(region),
    };
    this.loaded.set(regionId, entry);
    return entry;
  }

  /** The region, or undefined when there is no such pack. Throws RegionPackError if it is broken. */
  get(regionId: string): RegionStatic | undefined {
    return this.entry(regionId)?.region;
  }

  /** The region with its lookups and road topology, built once and shared by every operation. */
  index(regionId: string): RegionIndex | undefined {
    const cached = this.indexes.get(regionId);
    if (cached) return cached;
    const region = this.get(regionId);
    if (!region) return undefined;
    const built = buildRegionIndex(region);
    this.indexes.set(regionId, built);
    return built;
  }

  /** The region as JSON text, serialized once. */
  getJson(regionId: string): string | undefined {
    return this.entry(regionId)?.json;
  }

  /** The same, gzipped once. A city-sized pack is several megabytes of JSON. */
  getJsonGzip(regionId: string): Buffer | undefined {
    const entry = this.entry(regionId);
    if (!entry) return undefined;
    return (entry.gzip ??= gzipSync(entry.json));
  }

  /**
   * The region the server should run: the preferred one when its pack exists, otherwise the
   * first available. Lets the server boot before the real region pack has been built.
   */
  resolveDefault(preferredId: string): string | undefined {
    if (this.has(preferredId)) return preferredId;
    return this.list()[0];
  }
}

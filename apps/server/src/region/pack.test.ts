import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRegionMini, loadScenarioMini, MINI_REGION_ID } from '@bastion/shared/fixtures';
import { afterEach, describe, expect, it } from 'vitest';
import { ScenarioCatalog } from '../scenarios/catalog';
import { cleanupTempDirs, makeTempDir, writeRegionPack, writeScenarioFile } from '../testing';
import { readRegionPack, RegionPackError, RegionRegistry } from './pack';

afterEach(cleanupTempDirs);

/** region-mini saved to disk under another id, standing in for a real region pack. */
function packOnDisk(id = 'testville') {
  const dataDir = makeTempDir();
  const region = loadRegionMini();
  region.config.id = id;
  const dir = writeRegionPack(dataDir, region);
  return { dataDir, regionsDir: join(dataDir, 'regions'), dir, region };
}

describe('readRegionPack', () => {
  it('reassembles the six files into a RegionStatic', () => {
    const { regionsDir, region } = packOnDisk();
    expect(readRegionPack(regionsDir, 'testville')).toEqual(region);
  });

  it('names the missing file', () => {
    const { regionsDir, dir } = packOnDisk();
    rmSync(join(dir, 'cells.json'));
    expect(() => readRegionPack(regionsDir, 'testville')).toThrow(/missing cells\.json/);
  });

  it('rejects broken JSON and contract violations with a RegionPackError', () => {
    const { regionsDir, dir } = packOnDisk();
    writeFileSync(join(dir, 'units.json'), '[{ nope');
    expect(() => readRegionPack(regionsDir, 'testville')).toThrow(RegionPackError);

    writeFileSync(join(dir, 'units.json'), JSON.stringify([{ id: 'u1', kind: 'submarine' }]));
    expect(() => readRegionPack(regionsDir, 'testville')).toThrow(/RegionStatic contract/);
  });

  it('rejects a pack whose region.json id does not match its folder', () => {
    const dataDir = makeTempDir();
    writeRegionPack(dataDir, loadRegionMini(), 'wrong-folder');
    expect(() => readRegionPack(join(dataDir, 'regions'), 'wrong-folder')).toThrow(/has id/);
  });
});

describe('RegionRegistry', () => {
  it('lists packs on disk plus the fixture, and loads both', () => {
    const { regionsDir, region } = packOnDisk();
    const registry = new RegionRegistry(regionsDir, true);
    expect(registry.list().sort()).toEqual([MINI_REGION_ID, 'testville'].sort());
    expect(registry.get('testville')).toEqual(region);
    expect(registry.get(MINI_REGION_ID)?.nodes).toHaveLength(42);
    expect(registry.get('atlantis')).toBeUndefined();
  });

  it('serializes a region once and reuses it', () => {
    const registry = new RegionRegistry(makeTempDir(), true);
    const json = registry.getJson(MINI_REGION_ID)!;
    expect(registry.getJson(MINI_REGION_ID)).toBe(json);
    expect(JSON.parse(json)).toEqual(loadRegionMini());
  });

  it('hides the fixture when fixtures are off', () => {
    const { regionsDir } = packOnDisk();
    const registry = new RegionRegistry(regionsDir, false);
    expect(registry.list()).toEqual(['testville']);
    expect(registry.get(MINI_REGION_ID)).toBeUndefined();
  });

  it('falls back to an available region when the preferred pack is missing', () => {
    const { regionsDir } = packOnDisk();
    expect(new RegionRegistry(regionsDir, true).resolveDefault('testville')).toBe('testville');
    expect(new RegionRegistry(makeTempDir(), true).resolveDefault('portland')).toBe(MINI_REGION_ID);
    expect(new RegionRegistry(makeTempDir(), false).resolveDefault('portland')).toBeUndefined();
  });

  it('ignores folders that are not region packs', () => {
    const registry = new RegionRegistry(makeTempDir(), false);
    expect(registry.list()).toEqual([]);
    expect(new RegionRegistry(join(makeTempDir(), 'does-not-exist'), false).list()).toEqual([]);
  });
});

describe('ScenarioCatalog', () => {
  it('offers the fixture when the folder is empty or missing', () => {
    const catalog = new ScenarioCatalog(join(makeTempDir(), 'scenarios'), true);
    expect(catalog.summaries().map((summary) => summary.id)).toEqual(['scenario-mini']);
    expect(catalog.problems).toEqual([]);
    expect(new ScenarioCatalog(join(makeTempDir(), 'scenarios'), false).summaries()).toEqual([]);
  });

  it('loads valid files and reports broken ones without failing', () => {
    const dataDir = makeTempDir();
    const flood = { ...loadScenarioMini(), id: 'flood-a', name: 'Flood A' };
    writeScenarioFile(dataDir, 'a-flood.json', flood);
    writeScenarioFile(dataDir, 'b-broken.json', '{ not json');
    writeScenarioFile(dataDir, 'c-invalid.json', { id: 'x', name: 'No timeline' });
    writeScenarioFile(dataDir, 'd-duplicate.json', flood);
    writeScenarioFile(dataDir, 'notes.txt', 'ignored');

    const catalog = new ScenarioCatalog(join(dataDir, 'scenarios'), false);
    expect(catalog.summaries().map((summary) => summary.id)).toEqual(['flood-a']);
    expect(catalog.problems.map((problem) => problem.file)).toEqual([
      'b-broken.json',
      'c-invalid.json',
      'd-duplicate.json',
    ]);
    expect(catalog.problems[1]!.problem).toMatch(/Scenario contract/);
    expect(catalog.problems[2]!.problem).toMatch(/duplicate scenario id/);
  });

  it('hands out copies so a running operation cannot change the catalogue', () => {
    const catalog = new ScenarioCatalog(join(makeTempDir(), 'scenarios'), true);
    const copy = catalog.get('scenario-mini')!;
    copy.timeline.length = 0;
    expect(catalog.get('scenario-mini')!.timeline.length).toBeGreaterThan(0);
    expect(catalog.get('missing')).toBeUndefined();
  });
});

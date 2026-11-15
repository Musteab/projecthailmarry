import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RegionStatic } from '@bastion/shared';
import type { Config } from './config';
import { loadConfig } from './config';
import type { AppContext } from './context';
import { createContext } from './context';

/** Test helpers. Not imported by production code. */

const tempDirs: string[] = [];

/** A fresh temporary directory, removed by `cleanupTempDirs`. */
export function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bastion-test-'));
  tempDirs.push(dir);
  return dir;
}

/** Call from `afterEach`. */
export function cleanupTempDirs(): void {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** Configuration for tests: in-memory database, an empty temporary data directory, no logging. */
export function makeTestConfig(env: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_PATH: ':memory:',
    DATA_DIR: makeTempDir(),
    ...env,
  });
}

export function makeTestContext(env: Record<string, string> = {}): AppContext {
  return createContext(makeTestConfig(env));
}

/** Writes a region as the six files of a region pack under <dataDir>/regions/<id>/. */
export function writeRegionPack(dataDir: string, region: RegionStatic, id = region.config.id) {
  const dir = join(dataDir, 'regions', id);
  mkdirSync(dir, { recursive: true });
  const write = (name: string, value: unknown) =>
    writeFileSync(join(dir, `${name}.json`), JSON.stringify(value));
  write('region', region.config);
  write('roads', { nodes: region.nodes, edges: region.edges, bridges: region.bridges });
  write('facilities', region.facilities);
  write('cells', region.cells);
  write('grid', region.grid);
  write('units', region.units);
  return dir;
}

export function writeScenarioFile(dataDir: string, file: string, content: unknown | string) {
  const dir = join(dataDir, 'scenarios');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), typeof content === 'string' ? content : JSON.stringify(content));
}

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RegionStatic, Role } from '@bastion/shared';
import { apiPaths } from '@bastion/shared';
import type { FastifyInstance } from 'fastify';
import type { Config } from './config';
import { loadConfig } from './config';
import type { AppContext, ContextOptions } from './context';
import { createContext } from './context';
import { DEMO_USERS } from './db/seed';

/** Test helpers. Not imported by production code. */

/** Password of the seeded demo accounts in tests. */
export const TEST_PASSWORD = 'test-password-123';

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
    SEED_DEMO_PASSWORD: TEST_PASSWORD,
    ...env,
  });
}

export function makeTestContext(
  env: Record<string, string> = {},
  options: ContextOptions = {},
): AppContext {
  return createContext(makeTestConfig(env), options);
}

/** The seeded demo account for a role. */
export function demoUser(role: Role) {
  const user = DEMO_USERS.find((candidate) => candidate.role === role);
  if (!user) throw new Error(`No demo user with role ${role}`);
  return user;
}

/** Authorization header for a role, minted directly (no password hashing; fast). */
export async function authHeader(ctx: AppContext, role: Role): Promise<{ authorization: string }> {
  return { authorization: `Bearer ${await ctx.auth.tokens.issue(demoUser(role))}` };
}

/** Authorization header obtained through the real login route. */
export async function loginAs(
  app: FastifyInstance,
  role: Role,
): Promise<{ authorization: string }> {
  const response = await app.inject({
    method: 'POST',
    url: apiPaths.login,
    payload: { email: demoUser(role).email, password: TEST_PASSWORD },
  });
  if (response.statusCode !== 200) {
    throw new Error(`Login as ${role} failed: ${response.statusCode} ${response.body}`);
  }
  return { authorization: `Bearer ${response.json<{ token: string }>().token}` };
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

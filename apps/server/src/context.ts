import { join } from 'node:path';
import type { Config } from './config';
import type { Database } from './db/database';
import { migrate, openDatabase } from './db/database';
import type { SeedResult } from './db/seed';
import { seed } from './db/seed';
import type { Responder } from './http';
import { makeResponder } from './http';
import { RegionRegistry } from './region/pack';
import { ScenarioCatalog } from './scenarios/catalog';

/** Everything a route or service needs. Built once at boot and passed down explicitly. */
export interface AppContext {
  config: Config;
  db: Database;
  regions: RegionRegistry;
  scenarios: ScenarioCatalog;
  /** validates an outgoing payload against the contract outside production */
  respond: Responder;
  /** what happened while the context was being built, for the boot log */
  boot: {
    migrationsApplied: string[];
    seed: SeedResult;
    /** region the server will run, after falling back if the preferred pack is missing */
    defaultRegionId: string | undefined;
  };
  close(): void;
}

/** Opens the database, migrates and seeds it, and loads the scenario catalogue. */
export function createContext(config: Config): AppContext {
  const db = openDatabase(config.databasePath);
  const migrationsApplied = migrate(db);
  const seedResult = seed(db, config.seedDemoPassword);

  const regions = new RegionRegistry(join(config.dataDir, 'regions'), config.includeFixtures);
  const scenarios = new ScenarioCatalog(join(config.dataDir, 'scenarios'), config.includeFixtures);

  return {
    config,
    db,
    regions,
    scenarios,
    respond: makeResponder(config.validateResponses),
    boot: {
      migrationsApplied,
      seed: seedResult,
      defaultRegionId: regions.resolveDefault(config.regionId),
    },
    close: () => db.close(),
  };
}

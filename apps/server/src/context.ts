import { join } from 'node:path';
import type { AuthService } from './auth/service';
import { createAuth } from './auth/service';
import type { Config } from './config';
import type { Database } from './db/database';
import { migrate, openDatabase } from './db/database';
import type { SeedResult } from './db/seed';
import { seed } from './db/seed';
import type { Responder } from './http';
import { makeResponder } from './http';
import { OperationManager } from './operations/manager';
import { RegionRegistry } from './region/pack';
import { ScenarioCatalog } from './scenarios/catalog';
import type { RuntimeLogger } from './sim/runtime';

/** Everything a route or service needs. Built once at boot and passed down explicitly. */
export interface AppContext {
  config: Config;
  db: Database;
  auth: AuthService;
  regions: RegionRegistry;
  scenarios: ScenarioCatalog;
  operations: OperationManager;
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

export interface ContextOptions {
  /** injectable wall clock (tests) */
  now?: () => number;
  /** receives faults from the simulation loop */
  logger?: RuntimeLogger;
}

/** Opens the database, migrates and seeds it, and loads the scenario catalogue. */
export function createContext(config: Config, options: ContextOptions = {}): AppContext {
  const db = openDatabase(config.databasePath);
  const migrationsApplied = migrate(db);
  const seedResult = seed(db, config.seedDemoPassword);

  const regions = new RegionRegistry(join(config.dataDir, 'regions'), config.includeFixtures);
  const scenarios = new ScenarioCatalog(join(config.dataDir, 'scenarios'), config.includeFixtures);

  const operations = new OperationManager({
    db,
    regions,
    scenarios,
    logger: options.logger,
  });

  return {
    config,
    db,
    auth: createAuth({ db, jwtSecret: config.jwtSecret, now: options.now }),
    regions,
    scenarios,
    operations,
    respond: makeResponder(config.validateResponses),
    boot: {
      migrationsApplied,
      seed: seedResult,
      defaultRegionId: regions.resolveDefault(config.regionId),
    },
    close: () => {
      operations.stop();
      db.close();
    },
  };
}

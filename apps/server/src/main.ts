import { buildApp } from './app';
import { ConfigError, loadConfig } from './config';
import { createContext } from './context';
import { loadIntel } from './intel/loader';

async function main(): Promise<void> {
  const config = loadConfig();
  // The simulation loop reports faults through the same logger as the HTTP server.
  const faults: { log?: (message: string, error?: unknown) => void } = {};
  const intel = await loadIntel();
  const ctx = createContext(config, {
    intel,
    logger: { error: (message, error) => faults.log?.(message, error) },
  });
  const app = await buildApp(ctx);

  faults.log = (message, error) => app.log.error({ err: error }, message);

  if (intel.source === 'fallback') {
    app.log.warn(`intel: using the rule-based fallback (${intel.note})`);
  } else {
    app.log.info('intel: @bastion/intel loaded');
  }

  const { boot } = ctx;
  if (boot.migrationsApplied.length > 0) {
    app.log.info({ migrations: boot.migrationsApplied }, 'database migrated');
  }
  if (boot.seed.usersWritten > 0 || boot.seed.rulesInserted > 0) {
    app.log.info(boot.seed, 'database seeded');
  }
  for (const { file, problem } of ctx.scenarios.problems) {
    app.log.warn({ file }, `scenario skipped: ${problem}`);
  }
  if (boot.defaultRegionId === undefined) {
    app.log.warn(`no region pack available (wanted "${config.regionId}")`);
  } else if (boot.defaultRegionId !== config.regionId) {
    app.log.warn(
      `region pack "${config.regionId}" not found in ${config.dataDir}; using "${boot.defaultRegionId}"`,
    );
  }

  const shutdown = (signal: string) => {
    app.log.info(`${signal} received, shutting down`);
    void app.close().then(() => process.exit(0));
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  await app.listen({ port: config.port, host: config.host });
  ctx.operations.start();
}

main().catch((error: unknown) => {
  // A configuration problem is the operator's to fix: print it plainly, without a stack trace.
  console.error(error instanceof ConfigError ? error.message : error);
  process.exit(1);
});

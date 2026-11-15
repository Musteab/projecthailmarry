import { buildApp } from './app';
import { ConfigError, loadConfig } from './config';
import { createContext } from './context';

async function main(): Promise<void> {
  const config = loadConfig();
  const ctx = createContext(config);
  const app = await buildApp(ctx);

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
}

main().catch((error: unknown) => {
  // A configuration problem is the operator's to fix: print it plainly, without a stack trace.
  console.error(error instanceof ConfigError ? error.message : error);
  process.exit(1);
});

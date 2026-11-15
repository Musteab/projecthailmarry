import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AppContext } from './context';
import { installErrorHandling } from './errors';
import { registerHealthRoutes } from './routes/health';
import { registerRegionRoutes } from './routes/regions';
import { registerScenarioRoutes } from './routes/scenarios';

/**
 * Builds the Fastify instance without starting it, so tests can drive it with `app.inject`.
 * Closing the app also closes the context (database).
 */
export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const { config } = ctx;
  const app = Fastify({
    logger: config.logLevel === 'silent' ? false : { level: config.logLevel },
    // Region static payloads and world snapshots are large; request bodies never are.
    bodyLimit: 1024 * 1024,
  });

  installErrorHandling(app);
  await app.register(cors, {
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  });

  registerHealthRoutes(app);
  registerScenarioRoutes(app, ctx);
  registerRegionRoutes(app, ctx);

  app.addHook('onClose', async () => ctx.close());

  return app;
}

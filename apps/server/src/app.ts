import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AppContext } from './context';
import { installErrorHandling } from './errors';
import { createIntelHost } from './intel/host';
import { registerRealtime } from './realtime/hub';
import { registerActionRoutes } from './routes/actions';
import { registerAuthRoutes } from './routes/auth';
import { registerHealthRoutes } from './routes/health';
import { registerOperationRoutes } from './routes/operations';
import { registerRegionRoutes } from './routes/regions';
import { registerRestorationRoutes } from './routes/restoration';
import { registerRuleRoutes } from './routes/rules';
import { registerScenarioRoutes } from './routes/scenarios';

/**
 * Builds the Fastify instance without starting it, so tests can drive it with `app.inject`.
 * Closing the app also closes the context (database).
 *
 * Every route under /api requires a valid token unless it is registered with
 * `{ config: { public: true } }`. Protection is the default, not something a route opts into.
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

  // Clients often send `Content-Type: application/json` on a POST that has no body (approve,
  // analyse). Fastify would reject that as malformed JSON, so treat it as having no body.
  app.addHook('onRequest', async (request) => {
    const length = request.headers['content-length'];
    if (length === '0' || (length === undefined && !request.headers['transfer-encoding'])) {
      delete request.headers['content-type'];
    }
  });

  app.decorateRequest('user', null);
  app.addHook('onRequest', (request) => ctx.auth.gate(request));

  registerHealthRoutes(app);
  registerAuthRoutes(app, ctx);
  registerScenarioRoutes(app, ctx);
  registerRegionRoutes(app, ctx);
  registerOperationRoutes(app, ctx);
  registerActionRoutes(app, ctx);
  registerRestorationRoutes(app, ctx);
  registerRuleRoutes(app, ctx);
  await registerRealtime(app, ctx);

  // Routes owned by @bastion/intel (/api/intel/*, /public/*), when the package provides them.
  if (ctx.intel?.plugin) {
    await app.register(ctx.intel.plugin, {
      host: createIntelHost({ operations: ctx.operations, regions: ctx.regions, auth: ctx.auth }),
    });
  }

  app.addHook('onClose', async () => ctx.close());

  return app;
}

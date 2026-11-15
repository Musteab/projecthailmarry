import Fastify, { type FastifyInstance } from 'fastify';

export interface AppOptions {
  /** Disable request logging (tests). */
  quiet?: boolean;
}

/** Builds the Fastify instance without starting it, so tests can use `app.inject`. */
export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.quiet ? false : { level: process.env.LOG_LEVEL ?? 'info' },
  });

  app.get('/api/health', async () => ({ ok: true }));

  return app;
}

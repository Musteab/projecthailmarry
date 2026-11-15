import { apiPaths } from '@bastion/shared';
import type { FastifyInstance } from 'fastify';

export function registerHealthRoutes(app: FastifyInstance): void {
  // Public: uptime checks and the deploy platform call this without credentials.
  app.get(apiPaths.health, { config: { public: true } }, async () => ({ ok: true }));
}

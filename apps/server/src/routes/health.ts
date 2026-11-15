import { apiPaths } from '@bastion/shared';
import type { FastifyInstance } from 'fastify';

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get(apiPaths.health, async () => ({ ok: true }));
}

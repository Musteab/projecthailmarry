import { apiPaths } from '@bastion/shared';
import type { FastifyInstance } from 'fastify';
import { currentUser } from '../auth/service';
import type { AppContext } from '../context';
import { insertAudit } from '../db/audit';
import { resetDemoData } from '../db/seed';
import { forbidden } from '../errors';

/**
 * Housekeeping for whoever runs the demo. Administrator only.
 */
export function registerAdminRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Puts the server back to a clean slate between rehearsals and before the pitch: ends every
  // operation, restores the demo accounts and puts the agency rules back to their defaults.
  app.post(apiPaths.adminDemoReset, async (request) => {
    const user = currentUser(request);
    if (user.role !== 'admin') throw forbidden('Only an administrator may reset the demo');

    const operationsEnded = ctx.operations.endAll();
    resetDemoData(ctx.db, ctx.config.seedDemoPassword);
    ctx.operations.refreshRules();
    insertAudit(ctx.db, {
      operationId: null,
      simTime: 0,
      actor: user.id,
      verb: 'demo.reset',
      detail: `Ended ${operationsEnded} operation(s); demo accounts and rules restored to defaults`,
    });
    return { ok: true as const, operationsEnded };
  });
}

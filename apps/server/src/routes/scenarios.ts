import { apiPaths, ScenarioSummarySchema } from '@bastion/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';

export function registerScenarioRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get(apiPaths.scenarios, async () =>
    ctx.respond(ScenarioSummarySchema.array(), ctx.scenarios.summaries(), 'scenario list'),
  );
}

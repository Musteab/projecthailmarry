import { readFile } from 'node:fs/promises';
import { FeedScheduler, createFeedAdapters } from '../feeds';
import { CopilotRequestSchema } from '@bastion/shared';
import { IntelService } from '../port/service';
import { briefing, copilot } from '../briefing';
import type { FastifyPluginAsync, preHandlerHookHandler } from 'fastify';
import type { IntelHost } from '@bastion/shared';
import { createIntel } from '../port';
import type { IntelConfig } from '../port/service';
/** Mount once with app.register(intelPlugin,{host,config}). Routes are added by the feature tasks. */
export const intelPlugin: FastifyPluginAsync<{ host: IntelHost; config?: IntelConfig }> = async (
  app,
  { host, config },
) => {
  if (typeof host.authenticate !== 'function')
    throw new Error('IntelHost.authenticate must be a Fastify preHandler');
  const port = createIntel(config);
  const service = new IntelService(config);
  app.decorate('bastionIntel', port);
  app.get(
    '/api/intel/health',
    { preHandler: host.authenticate as preHandlerHookHandler },
    async () => ({ ok: true }),
  );
  const replayEnabled = process.env.FEEDS_REPLAY === '1';
  const replay: Record<string, unknown> | undefined = replayEnabled
    ? Object.fromEntries(
        await Promise.all(
          ['nws', 'usgs-earthquake', 'usgs-gauge'].map(async (id) => [
            id,
            JSON.parse(
              await readFile(
                new URL(`../../../../data/fixtures/feeds/${id}.json`, import.meta.url),
                'utf8',
              ),
            ),
          ]),
        ),
      )
    : undefined;
  const feeds = new FeedScheduler(
    host,
    (region) => createFeedAdapters(region, fetch, replay),
    process.env.FEEDS_ENABLED === '1' && (service.mode !== 'cache' || replayEnabled),
    (message) => app.log.warn(message),
  );
  app.addHook('onReady', async () => {
    feeds.start();
  });
  app.addHook('onClose', async () => {
    feeds.stop();
  });
  const secured = { preHandler: host.authenticate as preHandlerHookHandler };
  app.post<{ Params: { id: string } }>(
    '/api/intel/operations/:id/briefing',
    secured,
    async (request, reply) => {
      const world = host.getWorld(request.params.id);
      if (!world)
        return reply
          .code(404)
          .send({ error: { code: 'not_found', message: 'Operation not found' } });
      return briefing(service, world);
    },
  );
  app.post<{ Params: { id: string } }>(
    '/api/intel/operations/:id/copilot',
    secured,
    async (request, reply) => {
      const body = CopilotRequestSchema.extend({
        question: CopilotRequestSchema.shape.question.max(2000),
      }).safeParse(request.body);
      if (!body.success)
        return reply.code(400).send({
          error: {
            code: 'validation_failed',
            message: 'A question of 1–2000 characters is required',
          },
        });
      const world = host.getWorld(request.params.id);
      if (!world)
        return reply
          .code(404)
          .send({ error: { code: 'not_found', message: 'Operation not found' } });
      return copilot(service, world, host.getRegion(world.operation.regionId), body.data.question);
    },
  );
};

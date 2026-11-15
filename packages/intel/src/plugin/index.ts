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
  app.decorate('bastionIntel', port);
  app.get(
    '/api/intel/health',
    { preHandler: host.authenticate as preHandlerHookHandler },
    async () => ({ ok: true }),
  );
};

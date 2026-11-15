import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { ApiError, notFound } from '../errors';
import { RegionPackError } from '../region/pack';

export function registerRegionRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Matches apiPaths.regionStatic(id). The payload is large, so it is serialized once by the
  // registry (which validated it on load) and sent as text.
  app.get<{ Params: { regionId: string } }>(
    '/api/regions/:regionId/static',
    async (request, reply) => {
      const { regionId } = request.params;
      let json: string | undefined;
      try {
        json = ctx.regions.getJson(regionId);
      } catch (error) {
        if (error instanceof RegionPackError) {
          request.log.error(error);
          throw new ApiError(500, 'region_pack_invalid', error.message);
        }
        throw error;
      }
      if (json === undefined) throw notFound(`Region "${regionId}"`);
      void reply
        .type('application/json; charset=utf-8')
        .header('vary', 'accept-encoding')
        .header('cache-control', 'private, max-age=300');
      if (String(request.headers['accept-encoding'] ?? '').includes('gzip')) {
        return reply.header('content-encoding', 'gzip').send(ctx.regions.getJsonGzip(regionId));
      }
      return reply.send(json);
    },
  );
}

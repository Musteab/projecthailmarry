import type { FastifyInstance } from 'fastify';
import type { IntelHost } from '@bastion/shared';
import { capAlert, closureGeoJson, liveWorlds } from './index';
export function registerPublicOutputs(app: FastifyInstance, host: IntelHost) {
  app.get<{ Params: { regionId: string } }>(
    '/public/:regionId/closures.geojson',
    { config: { public: true } },
    async (request, reply) => {
      let region;
      try {
        region = host.getRegion(request.params.regionId);
      } catch {
        return reply.code(404).send({ error: { code: 'not_found', message: 'Region not found' } });
      }
      reply.header('Cache-Control', 'public, max-age=30').type('application/geo+json');
      return closureGeoJson(liveWorlds(host, region.config.id), region);
    },
  );
  app.get<{ Params: { regionId: string } }>(
    '/public/:regionId/alerts.cap',
    { config: { public: true } },
    async (request, reply) => {
      let region;
      try {
        region = host.getRegion(request.params.regionId);
      } catch {
        return reply.code(404).send({ error: { code: 'not_found', message: 'Region not found' } });
      }
      const alerts = liveWorlds(host, region.config.id)
        .flatMap((world) =>
          Object.values(world.actions).flatMap((action) => {
            const body = capAlert(action, world, region);
            return body
              ? [
                  {
                    body,
                    at:
                      Date.parse(world.operation.createdAt) +
                      (action.executedAt ?? action.proposedAt) * 1000,
                  },
                ]
              : [];
          }),
        )
        .sort((a, b) => b.at - a.at);
      reply.header('Cache-Control', 'public, max-age=30');
      if (!alerts[0]) return reply.code(204).send();
      // A CAP document contains exactly one alert; return the most recently issued one.
      return reply.type('application/cap+xml').send(alerts[0].body);
    },
  );
}

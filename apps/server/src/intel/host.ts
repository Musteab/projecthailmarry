import type { IntelHost } from '@bastion/shared';
import type { AuthService } from '../auth/service';
import { notFound } from '../errors';
import type { OperationManager } from '../operations/manager';
import type { RegionRegistry } from '../region/pack';

/** What the server exposes to the Fastify plugin exported by @bastion/intel. */
export function createIntelHost(deps: {
  operations: OperationManager;
  regions: RegionRegistry;
  auth: AuthService;
}): IntelHost {
  return {
    getWorld: (operationId) => deps.operations.get(operationId)?.world.toSnapshot(),
    getRegion: (regionId) => {
      const region = deps.regions.get(regionId);
      if (!region) throw notFound(`Region "${regionId}"`);
      return region;
    },
    ingestSignal: (operationId, signal) => deps.operations.ingestSignal(operationId, signal),
    listLiveOperations: () =>
      deps.operations
        .list()
        .filter((operation) => operation.mode === 'live' && operation.status !== 'ended'),
    authenticate: deps.auth.authenticate,
  };
}

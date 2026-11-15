import { expect, it } from 'vitest';
import { loadPortlandRegion, createPortlandMockTransport } from './portland';
import { apiPaths, WorldSnapshotSchema } from '@bastion/shared';
import { analyzeAccess } from './routing';
it('loads the real region in mock mode with valid references and practical access analysis', async () => {
  const region = await loadPortlandRegion();
  expect(region.config.id).toBe('portland');
  const mock = await createPortlandMockTransport();
  await mock.request('POST', apiPaths.operationControl(mock.world.operation.id), {
    command: 'start',
  });
  mock.advance(8);
  expect(WorldSnapshotSchema.safeParse(mock.world).success).toBe(true);
  for (const action of Object.values(mock.world.actions))
    if ('unitId' in action.payload) expect(mock.world.units[action.payload.unitId]).toBeDefined();
  const comparison = analyzeAccess(mock.region, mock.world);
  expect(comparison.analysis.candidates.length).toBeGreaterThan(0);
}, 20000);

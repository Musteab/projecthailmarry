import { RegionStaticSchema } from '@bastion/shared';
import { MockTransport } from '../transport/mock';
/** Lazy loading keeps the 8 MB real region out of the default mini preview bundle. */
export async function loadPortlandRegion() {
  const [region, roads, facilities, cells, grid, units] = await Promise.all([
    import('../../../../data/regions/portland/region.json'),
    import('../../../../data/regions/portland/roads.json'),
    import('../../../../data/regions/portland/facilities.json'),
    import('../../../../data/regions/portland/cells.json'),
    import('../../../../data/regions/portland/grid.json'),
    import('../../../../data/regions/portland/units.json'),
  ]);
  return RegionStaticSchema.parse({
    config: region.default,
    ...roads.default,
    facilities: facilities.default,
    cells: cells.default,
    grid: grid.default,
    units: units.default,
  });
}
export async function createPortlandMockTransport() {
  return new MockTransport({ region: await loadPortlandRegion() });
}

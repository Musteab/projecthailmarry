import type {
  Bridge,
  Cell,
  Facility,
  GridSection,
  LngLat,
  RegionStatic,
  RoadEdge,
} from '@bastion/shared';
import { PointIndex } from '../geo';
import { RoadTopology } from '../routing/topology';
import { RegionPackError } from './pack';

/**
 * A region pack with the lookups the engines need. Immutable and shared by every operation
 * on the region.
 */
export interface RegionIndex {
  region: RegionStatic;
  topology: RoadTopology;
  edgeById: Map<string, RoadEdge>;
  facilityById: Map<string, Facility>;
  cellById: Map<string, Cell>;
  bridgeById: Map<string, Bridge>;
  sectionById: Map<string, GridSection>;
  /** the road node nearest to each cell's centre */
  nodeIdByCell: Map<string, string>;
  /** the road node nearest to any position */
  nearestNodeId(position: LngLat): string;
  /** the cell whose centre is nearest to any position */
  nearestCellId(position: LngLat): string;
}

const byId = <T extends { id: string }>(items: T[], what: string, regionId: string) => {
  const map = new Map<string, T>();
  for (const item of items) {
    if (map.has(item.id)) throw new RegionPackError(regionId, `duplicate ${what} id "${item.id}"`);
    map.set(item.id, item);
  }
  return map;
};

/** Builds the indexes and checks that every cross-reference in the pack resolves. */
export function buildRegionIndex(region: RegionStatic): RegionIndex {
  const regionId = region.config.id;
  if (region.nodes.length === 0) throw new RegionPackError(regionId, 'has no road nodes');
  if (region.cells.length === 0) throw new RegionPackError(regionId, 'has no cells');

  let topology: RoadTopology;
  try {
    topology = new RoadTopology(region);
  } catch (error) {
    throw new RegionPackError(regionId, error instanceof Error ? error.message : String(error));
  }

  const edgeById = byId(region.edges, 'edge', regionId);
  const facilityById = byId(region.facilities, 'facility', regionId);
  const cellById = byId(region.cells, 'cell', regionId);
  const bridgeById = byId(region.bridges, 'bridge', regionId);
  const sectionById = byId(region.grid.sections, 'grid section', regionId);

  const fail = (problem: string): never => {
    throw new RegionPackError(regionId, problem);
  };
  for (const facility of region.facilities) {
    if (topology.nodeIndex(facility.nodeId) === undefined) {
      fail(`facility "${facility.id}" refers to unknown node "${facility.nodeId}"`);
    }
  }
  for (const bridge of region.bridges) {
    for (const edgeId of bridge.edgeIds) {
      if (!edgeById.has(edgeId)) fail(`bridge "${bridge.id}" refers to unknown edge "${edgeId}"`);
    }
  }
  for (const unit of region.units) {
    if (!facilityById.has(unit.homeFacilityId)) {
      fail(`unit "${unit.id}" has unknown home facility "${unit.homeFacilityId}"`);
    }
  }
  for (const section of region.grid.sections) {
    if (section.upstreamSectionId !== null && !sectionById.has(section.upstreamSectionId)) {
      fail(`grid section "${section.id}" has unknown upstream "${section.upstreamSectionId}"`);
    }
  }

  const nodePoints = new PointIndex(region.nodes.map((node) => node.position));
  const cellPoints = new PointIndex(
    region.cells.map((cell) => cell.center),
    150,
  );
  const nearestNodeId = (position: LngLat) => region.nodes[nodePoints.nearest(position)]!.id;
  const nearestCellId = (position: LngLat) => region.cells[cellPoints.nearest(position)]!.id;

  const nodeIdByCell = new Map<string, string>();
  for (const cell of region.cells) nodeIdByCell.set(cell.id, nearestNodeId(cell.center));

  return {
    region,
    topology,
    edgeById,
    facilityById,
    cellById,
    bridgeById,
    sectionById,
    nodeIdByCell,
    nearestNodeId,
    nearestCellId,
  };
}

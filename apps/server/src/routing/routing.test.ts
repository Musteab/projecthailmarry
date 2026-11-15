import type { LngLat, RegionStatic, RoadEdge, RoadNode } from '@bastion/shared';
import {
  loadRegionMini,
  MINI,
  miniEdgeH,
  miniEdgeV,
  miniNodeId,
  miniPoint,
} from '@bastion/shared/fixtures';
import { describe, expect, it } from 'vitest';
import {
  bearingDeg,
  distanceM,
  distanceToPathM,
  pathLengthM,
  pointAlong,
  PointIndex,
} from '../geo';
import { buildRegionIndex } from '../region/index';
import { RegionPackError } from '../region/pack';
import { isPassable, RoadNetwork } from './network';
import { RoadTopology } from './topology';

const mini = () => new RoadNetwork(new RoadTopology(loadRegionMini()));
const SOUTH_BRIDGE = miniEdgeH(2, 1);
const NORTH_BRIDGE = miniEdgeH(2, 4);

/** A tiny hand-built graph: nodes in a row 100 m apart, edges as given. */
function line(edges: Array<[string, string, boolean?]>, names = ['a', 'b', 'c', 'd']) {
  const nodes: RoadNode[] = names.map((id, i) => ({ id, position: [i * 0.001, 0] }));
  const position = (id: string) => nodes.find((node) => node.id === id)!.position;
  const roadEdges: RoadEdge[] = edges.map(([from, to, oneway = false]) => ({
    id: `${from}${to}`,
    from,
    to,
    geometry: [position(from), position(to)],
    lengthM: 100,
    speedKph: 36, // 10 m/s, so 100 m = 10 s
    class: 'local',
    oneway,
  }));
  return new RoadNetwork(new RoadTopology({ nodes, edges: roadEdges }));
}

describe('geo helpers', () => {
  it('measures distance and bearing on the mini lattice', () => {
    expect(distanceM(miniPoint(0, 0), miniPoint(1, 0))).toBeCloseTo(250, 0);
    expect(distanceM(miniPoint(0, 0), miniPoint(0, 2))).toBeCloseTo(500, 0);
    expect(bearingDeg(miniPoint(0, 0), miniPoint(0, 1))).toBeCloseTo(0, 5);
    expect(bearingDeg(miniPoint(0, 0), miniPoint(1, 0))).toBeCloseTo(90, 5);
    expect(bearingDeg(miniPoint(0, 1), miniPoint(0, 0))).toBeCloseTo(180, 5);
    expect(bearingDeg(miniPoint(1, 0), miniPoint(0, 0))).toBeCloseTo(270, 5);
  });

  it('walks along a polyline', () => {
    const path = [miniPoint(0, 0), miniPoint(1, 0), miniPoint(1, 1)];
    expect(pathLengthM(path)).toBeCloseTo(500, 0);
    expect(pointAlong(path, 0).position).toEqual(path[0]);
    expect(pointAlong(path, 1).position).toEqual(path[2]);
    const middle = pointAlong(path, 0.5);
    expect(distanceM(middle.position, miniPoint(1, 0))).toBeLessThan(1);
    const threeQuarters = pointAlong(path, 0.75);
    expect(distanceM(threeQuarters.position, miniPoint(1, 0.5))).toBeLessThan(1);
    expect(threeQuarters.heading).toBeCloseTo(0, 3);
  });

  it('measures distance to a path', () => {
    const creek = [miniPoint(2.5, 2.5), miniPoint(6, 2.5)];
    expect(distanceToPathM(miniPoint(4, 3), creek)).toBeCloseTo(125, 0);
    expect(distanceToPathM(miniPoint(4, 2.5), creek)).toBeCloseTo(0, 0);
    expect(distanceToPathM(miniPoint(1.5, 2.5), creek)).toBeCloseTo(250, 0);
  });

  it('PointIndex agrees with brute force', () => {
    let seed = 42;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const points: LngLat[] = Array.from({ length: 400 }, () => [
      -122.7 + random() * 0.14,
      45.44 + random() * 0.1,
    ]);
    const index = new PointIndex(points);
    for (let i = 0; i < 200; i++) {
      const query: LngLat = [-122.72 + random() * 0.18, 45.43 + random() * 0.12];
      let best = 0;
      for (let p = 1; p < points.length; p++) {
        if (distanceM(query, points[p]!) < distanceM(query, points[best]!)) best = p;
      }
      expect(index.nearest(query)).toBe(best);
    }
    expect(new PointIndex([]).nearest([0, 0])).toBe(-1);
  });
});

describe('routing on region-mini', () => {
  it('finds the direct edge and its travel time', () => {
    const route = mini().route(miniNodeId(0, 0), miniNodeId(0, 1))!;
    expect(route.edgeIds).toEqual([miniEdgeV(0, 0)]);
    expect(route.lengthM).toBe(250);
    expect(route.seconds).toBeCloseTo(250 / (40 / 3.6), 6); // collector, 40 km/h
    expect(route.nodeIds).toEqual([miniNodeId(0, 0), miniNodeId(0, 1)]);
  });

  it('returns a continuous polyline in travel order, in both directions', () => {
    const network = mini();
    for (const [from, to] of [
      [miniNodeId(0, 0), miniNodeId(6, 5)],
      [miniNodeId(6, 5), miniNodeId(0, 0)],
    ] as const) {
      const route = network.route(from, to)!;
      expect(route.geometry[0]).toEqual(
        network.topology.nodes[network.topology.requireNode(from)]!.position,
      );
      expect(route.geometry.at(-1)).toEqual(
        network.topology.nodes[network.topology.requireNode(to)]!.position,
      );
      expect(pathLengthM(route.geometry)).toBeCloseTo(route.lengthM, -1);
      expect(route.nodeIds).toHaveLength(route.edgeIds.length + 1);
    }
  });

  it('a route to the same node is empty', () => {
    const route = mini().route(miniNodeId(3, 3), miniNodeId(3, 3))!;
    expect(route).toMatchObject({ edgeIds: [], seconds: 0, lengthM: 0 });
    expect(route.geometry).toHaveLength(1);
  });

  it('crosses the river on a bridge and detours when one is closed', () => {
    const network = mini();
    const direct = network.route(miniNodeId(2, 1), miniNodeId(3, 1))!;
    expect(direct.edgeIds).toEqual([SOUTH_BRIDGE]);

    network.setEdge(SOUTH_BRIDGE, false);
    const detour = network.route(miniNodeId(2, 1), miniNodeId(3, 1))!;
    expect(detour.edgeIds).toContain(NORTH_BRIDGE);
    expect(detour.edgeIds).not.toContain(SOUTH_BRIDGE);
    expect(detour.seconds).toBeGreaterThan(direct.seconds);
  });

  it('reports disconnection when both bridges are out', () => {
    const network = mini();
    network.setEdge(SOUTH_BRIDGE, false);
    network.setEdge(NORTH_BRIDGE, false);
    const region = loadRegionMini();
    const node = (facilityId: string) =>
      region.facilities.find((facility) => facility.id === facilityId)!.nodeId;

    expect(network.route(miniNodeId(0, 0), miniNodeId(6, 5))).toBeNull();
    expect(network.secondsBetween(miniNodeId(0, 0), miniNodeId(6, 5))).toBe(Infinity);
    expect(network.nearest(miniNodeId(6, 0), [node(MINI.facilities.hospitalWest)])).toBeNull();

    const fromWestHospital = network.travelTimes([node(MINI.facilities.hospitalWest)]);
    const reachable = [...fromWestHospital].filter((seconds) => seconds !== Infinity);
    expect(reachable).toHaveLength(18); // the west bank
  });

  it('picks the hospital that can be reached soonest, not the nearest on the map', () => {
    const region = loadRegionMini();
    const hospitals = region.facilities.filter((facility) => facility.kind === 'hospital');
    const hospitalNodes = hospitals.map((hospital) => hospital.nodeId);
    const network = mini();

    // From the east bank just south of the creek the east hospital is closest...
    const origin = miniNodeId(5, 2);
    expect(network.nearest(origin, hospitalNodes)?.nodeId).toBe(miniNodeId(5, 4));
    // ...until every creek crossing floods; then it is the west hospital over the south bridge.
    for (let col = 3; col <= 6; col++) network.setEdge(miniEdgeV(col, 2), false);
    expect(network.nearest(origin, hospitalNodes)?.nodeId).toBe(miniNodeId(1, 1));
  });

  it('travelTimes is the minimum over the sources', () => {
    const network = mini();
    const a = network.travelTimes([miniNodeId(1, 1)]);
    const b = network.travelTimes([miniNodeId(5, 4)]);
    const both = network.travelTimes([miniNodeId(1, 1), miniNodeId(5, 4)]);
    both.forEach((seconds, i) => expect(seconds).toBeCloseTo(Math.min(a[i]!, b[i]!), 9));
    expect(both[network.topology.requireNode(miniNodeId(1, 1))]).toBe(0);
  });
});

describe('road status', () => {
  it('maps world road states onto passability', () => {
    expect(isPassable(null)).toBe(true);
    expect(isPassable({ status: 'open', closurePublished: false })).toBe(true);
    for (const status of ['flooded', 'blocked', 'damaged', 'closed'] as const) {
      expect(isPassable({ status, closurePublished: false })).toBe(false);
    }
    expect(isPassable({ status: 'damaged', closurePublished: false, speedFactor: 0.4 })).toBe(true);
  });

  it('a restricted bridge is passable but slower', () => {
    const network = mini();
    const normal = network.secondsBetween(miniNodeId(2, 1), miniNodeId(3, 1));
    network.applyRoadState(SOUTH_BRIDGE, {
      status: 'damaged',
      closurePublished: false,
      speedFactor: 0.4,
    });
    expect(network.isEdgePassable(SOUTH_BRIDGE)).toBe(true);
    expect(network.secondsBetween(miniNodeId(2, 1), miniNodeId(3, 1))).toBeCloseTo(normal / 0.4, 6);

    network.applyRoadState(SOUTH_BRIDGE, { status: 'flooded', closurePublished: true });
    expect(network.isEdgePassable(SOUTH_BRIDGE)).toBe(false);
    network.applyRoadState(SOUTH_BRIDGE, null);
    expect(network.secondsBetween(miniNodeId(2, 1), miniNodeId(3, 1))).toBeCloseTo(normal, 9);
  });

  it('a flooded street stops road vehicles but not a swift-water crew', () => {
    const network = mini();
    const normal = network.secondsBetween(miniNodeId(2, 1), miniNodeId(3, 1));
    network.applyRoadState(SOUTH_BRIDGE, { status: 'flooded', closurePublished: false });
    network.applyRoadState(NORTH_BRIDGE, { status: 'flooded', closurePublished: false });

    expect(network.isEdgePassable(SOUTH_BRIDGE)).toBe(false);
    expect(network.isEdgePassable(SOUTH_BRIDGE, 'water')).toBe(true);
    expect(network.route(miniNodeId(2, 1), miniNodeId(3, 1))).toBeNull();
    const byWater = network.route(miniNodeId(2, 1), miniNodeId(3, 1), 'water')!;
    expect(byWater.edgeIds).toEqual([SOUTH_BRIDGE]);
    expect(byWater.seconds).toBeGreaterThan(normal * 2); // slow going

    const index = (id: string) => network.topology.requireNode(id);
    const east = miniNodeId(5, 4);
    expect(network.travelTimes([miniNodeId(0, 0)])[index(east)]).toBe(Infinity);
    expect(network.travelTimes([miniNodeId(0, 0)], { profile: 'water' })[index(east)]).not.toBe(
      Infinity,
    );

    // Damage that is not water stops everyone.
    network.applyRoadState(SOUTH_BRIDGE, { status: 'closed', closurePublished: false });
    expect(network.isEdgePassable(SOUTH_BRIDGE, 'water')).toBe(false);
  });

  it('bumps the version only when something actually changes', () => {
    const network = mini();
    network.setEdge(SOUTH_BRIDGE, true);
    expect(network.version).toBe(0);
    network.setEdge(SOUTH_BRIDGE, false);
    network.setEdge(SOUTH_BRIDGE, false);
    expect(network.version).toBe(1);
  });

  it('answers hypothetical questions without changing the network', () => {
    const network = mini();
    network.setEdge(SOUTH_BRIDGE, false);
    network.setEdge(NORTH_BRIDGE, false);
    const version = network.version;
    const from = miniNodeId(0, 0);
    const to = miniNodeId(6, 5);

    const hypothetical = network.withUnblocked([NORTH_BRIDGE, 'no-such-edge'], () =>
      network.route(from, to),
    );
    expect(hypothetical?.edgeIds).toContain(NORTH_BRIDGE);
    expect(network.route(from, to)).toBeNull();
    expect(network.version).toBe(version);

    expect(() =>
      network.withUnblocked([SOUTH_BRIDGE], () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(network.isEdgePassable(SOUTH_BRIDGE)).toBe(false);
  });
});

describe('one-way streets', () => {
  it('are only driven in their direction', () => {
    const network = line([
      ['a', 'b', true],
      ['b', 'c'],
    ]);
    expect(network.route('a', 'c')?.seconds).toBeCloseTo(20, 9);
    expect(network.route('c', 'a')).toBeNull();
    expect(network.route('c', 'b')?.edgeIds).toEqual(['bc']);
  });

  it('distinguishes time from the sources and time toward them', () => {
    const network = line([
      ['a', 'b', true],
      ['b', 'c', true],
      ['c', 'a', true],
    ]); // a one-way triangle a -> b -> c -> a
    const index = (id: string) => network.topology.requireNode(id);
    const fromA = network.travelTimes(['a']);
    const towardA = network.travelTimes(['a'], { toward: true });
    expect(fromA[index('b')]).toBeCloseTo(10, 9);
    expect(towardA[index('b')]).toBeCloseTo(20, 9); // b -> c -> a
    expect(fromA[index('c')]).toBeCloseTo(20, 9);
    expect(towardA[index('c')]).toBeCloseTo(10, 9);
  });

  it('rejects unknown node ids loudly', () => {
    expect(() => line([['a', 'b']]).route('a', 'zz')).toThrow(/Unknown road node/);
  });
});

describe('RegionIndex', () => {
  it('snaps positions to nodes and cells', () => {
    const index = buildRegionIndex(loadRegionMini());
    expect(index.nearestNodeId(miniPoint(3, 2))).toBe(miniNodeId(3, 2));
    expect(index.nearestNodeId(miniPoint(3.1, 1.9))).toBe(miniNodeId(3, 2));
    expect(index.nearestNodeId(miniPoint(40, 40))).toBe(miniNodeId(6, 5));

    const cell = index.region.cells[10]!;
    expect(index.nearestCellId(cell.center)).toBe(cell.id);
    expect(index.nodeIdByCell.size).toBe(index.region.cells.length);
    expect(index.facilityById.get(MINI.facilities.hospitalEast)?.nodeId).toBe(miniNodeId(5, 4));
  });

  it.each<[string, (region: RegionStatic) => void, RegExp]>([
    ['an edge to a missing node', (r) => (r.edges[0]!.to = 'ghost'), /unknown node/],
    ['a facility on a missing node', (r) => (r.facilities[0]!.nodeId = 'ghost'), /unknown node/],
    ['a bridge over a missing edge', (r) => r.bridges[0]!.edgeIds.push('ghost'), /unknown edge/],
    ['a unit without a home', (r) => (r.units[0]!.homeFacilityId = 'ghost'), /unknown home/],
    ['a duplicate cell id', (r) => (r.cells[1]!.id = r.cells[0]!.id), /duplicate cell/],
    [
      'a section with a missing upstream',
      (r) => (r.grid.sections[1]!.upstreamSectionId = 'ghost'),
      /unknown upstream/,
    ],
  ])('rejects %s', (_label, corrupt, message) => {
    const region = loadRegionMini();
    corrupt(region);
    expect(() => buildRegionIndex(region)).toThrow(RegionPackError);
    expect(() => buildRegionIndex(region)).toThrow(message);
  });
});

describe('performance budget', () => {
  it('one-to-all on a 15,000-node street grid takes under 30 ms', () => {
    const cols = 125;
    const rows = 120;
    const nodes: RoadNode[] = [];
    const edges: RoadEdge[] = [];
    const id = (c: number, r: number) => `${c}:${r}`;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        nodes.push({ id: id(c, r), position: [c * 0.001, r * 0.001] });
        const add = (to: string, n: number) =>
          edges.push({
            id: `${id(c, r)}>${to}`,
            from: id(c, r),
            to,
            geometry: [
              [c * 0.001, r * 0.001],
              [c * 0.001, r * 0.001],
            ],
            lengthM: 80 + ((c * 31 + r * 17 + n) % 60),
            speedKph: 30 + ((c + r) % 3) * 10,
            class: 'local',
            oneway: false,
          });
        if (c + 1 < cols) add(id(c + 1, r), 0);
        if (r + 1 < rows) add(id(c, r + 1), 1);
      }
    }
    const network = new RoadNetwork(new RoadTopology({ nodes, edges }));
    expect(network.topology.nodeCount).toBe(15_000);

    network.travelTimes([id(0, 0)]); // warm up the JIT
    let best = Infinity;
    for (let run = 0; run < 5; run++) {
      const started = performance.now();
      const times = network.travelTimes([id(60, 60)]);
      best = Math.min(best, performance.now() - started);
      expect(times[network.topology.requireNode(id(124, 119))]).toBeGreaterThan(0);
    }
    expect(best).toBeLessThan(30);
  });
});

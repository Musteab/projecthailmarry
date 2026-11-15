import type {
  LngLat,
  RegionStatic,
  RoadState,
  WorldSnapshot,
  AccessImpact,
  RestorationAnalysis,
} from '@bastion/shared';

export function distance(a: LngLat, b: LngLat) {
  const x = (a[0] - b[0]) * Math.cos(((a[1] + b[1]) * Math.PI) / 360);
  return Math.hypot(x, a[1] - b[1]) * 111320;
}
export function nearestNode(region: RegionStatic, position: LngLat) {
  return region.nodes.reduce((best, node) =>
    distance(node.position, position) < distance(best.position, position) ? node : best,
  );
}
export interface MockRoute {
  route: LngLat[];
  routeEdgeIds: string[];
  seconds: number;
}
type Hop = { from: string; edge: RegionStatic['edges'][number]; reverse: boolean };
type Arc = { next: string; edge: RegionStatic['edges'][number]; reverse: boolean };
const graphs = new WeakMap<
  RegionStatic,
  { forward: Map<string, Arc[]>; backward: Map<string, Arc[]> }
>();
function graph(region: RegionStatic) {
  let result = graphs.get(region);
  if (result) return result;
  result = { forward: new Map(), backward: new Map() };
  for (const node of region.nodes) {
    result.forward.set(node.id, []);
    result.backward.set(node.id, []);
  }
  for (const edge of region.edges) {
    result.forward.get(edge.from)?.push({ next: edge.to, edge, reverse: false });
    result.backward.get(edge.to)?.push({ next: edge.from, edge, reverse: false });
    if (!edge.oneway) {
      result.forward.get(edge.to)?.push({ next: edge.from, edge, reverse: true });
      result.backward.get(edge.from)?.push({ next: edge.to, edge, reverse: true });
    }
  }
  graphs.set(region, result);
  return result;
}
/** Binary-heap Dijkstra. Reverse multi-source search computes access to all hospitals once. */
function search(
  region: RegionStatic,
  roads: Record<string, RoadState>,
  starts: string[],
  reverse = false,
  end?: string,
) {
  const adjacency = graph(region)[reverse ? 'backward' : 'forward'];
  const costs = new Map(starts.map((id) => [id, 0]));
  const previous = new Map<string, Hop>();
  const heap: { id: string; cost: number }[] = [];
  const push = (item: { id: string; cost: number }) => {
    let i = heap.length;
    heap.push(item);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent].cost <= item.cost) break;
      heap[i] = heap[parent];
      i = parent;
    }
    heap[i] = item;
  };
  for (const id of starts) push({ id, cost: 0 });
  while (heap.length) {
    const current = heap[0],
      last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1].cost < heap[child].cost) child++;
        if (last.cost <= heap[child].cost) break;
        heap[i] = heap[child];
        i = child;
      }
      heap[i] = last;
    }
    if (current.cost !== costs.get(current.id)) continue;
    if (current.id === end) break;
    for (const arc of adjacency.get(current.id) ?? []) {
      const state = roads[arc.edge.id];
      if (state && state.status !== 'open' && !state.speedFactor) continue;
      const candidate =
        current.cost + arc.edge.lengthM / ((arc.edge.speedKph / 3.6) * (state?.speedFactor ?? 1));
      if (candidate < (costs.get(arc.next) ?? Infinity)) {
        costs.set(arc.next, candidate);
        previous.set(arc.next, { from: current.id, edge: arc.edge, reverse: arc.reverse });
        push({ id: arc.next, cost: candidate });
      }
    }
  }
  return { costs, previous };
}
/** One-way-aware routing on the supplied road graph, excluding impassable roads. */
export function routeBetween(
  region: RegionStatic,
  roads: Record<string, RoadState>,
  from: LngLat,
  to: LngLat,
): MockRoute | undefined {
  const start = nearestNode(region, from).id,
    end = nearestNode(region, to).id;
  const { costs, previous } = search(region, roads, [start], false, end);
  if (!costs.has(end)) return undefined;
  const hops: Hop[] = [];
  for (let node = end; node !== start;) {
    const step = previous.get(node)!;
    hops.push(step);
    node = step.from;
  }
  hops.reverse();
  const route: LngLat[] = [];
  for (const { edge, reverse } of hops) {
    const geometry = reverse ? [...edge.geometry].reverse() : edge.geometry;
    route.push(...(route.length ? geometry.slice(1) : geometry));
  }
  if (!route.length) route.push(nearestNode(region, from).position);
  return { route, routeEdgeIds: hops.map((h) => h.edge.id), seconds: Math.max(1, costs.get(end)!) };
}

/** Fixture access comparisons: graph travel time only, not an operational travel forecast. */
export function analyzeAccess(
  region: RegionStatic,
  world: WorldSnapshot,
): { analysis: RestorationAnalysis; impacts: Record<string, AccessImpact> } {
  const hospitals = region.facilities.filter(
    (f) =>
      f.kind === 'hospital' &&
      world.facilities[f.id]?.status !== 'offline' &&
      !world.facilities[f.id]?.onDivert,
  );
  const travel = (roads: WorldSnapshot['roads']) => {
    const { costs } = search(
      region,
      roads,
      hospitals.map((f) => f.nodeId),
      true,
    );
    return new Map(region.nodes.map((n) => [n.id, costs.has(n.id) ? costs.get(n.id)! / 60 : null]));
  };
  const cellNodes = new Map(region.cells.map((c) => [c.id, nearestNode(region, c.center).id]));
  const before = travel(world.roads);
  const candidates = Object.keys(world.roads)
    .filter((id) => world.roads[id].status !== 'open' && region.edges.some((e) => e.id === id))
    .sort()
    .map((id) => {
      const edge = region.edges.find((e) => e.id === id)!;
      return {
        id: `repair-${id}`,
        kind: edge.bridgeId ? ('bridge_repair' as const) : ('debris_clearance' as const),
        label: `${edge.bridgeId ? 'Inspect and repair' : 'Clear'} ${edge.name ?? id}`,
        edgeIds: [id],
        position: edge.geometry[0],
        estCrewHours: edge.bridgeId ? 6 : 2,
        crewsRequired: 1,
      };
    });
  const impacts: Record<string, AccessImpact> = {};
  const options = candidates
    .map((candidate) => {
      const roads = { ...world.roads };
      for (const id of candidate.edgeIds) delete roads[id];
      const after = travel(roads);
      const cells = region.cells.map((cell) => {
        const node = cellNodes.get(cell.id)!;
        return { cellId: cell.id, beforeMin: before.get(node)!, afterMin: after.get(node)! };
      });
      const optionId = `option-${candidate.id}`;
      impacts[optionId] = { optionId, cells };
      let regained = 0,
        reconnected = 0,
        improvement = 0;
      cells.forEach((cell, i) => {
        const pop = region.cells[i].population;
        if (
          (cell.beforeMin === null || cell.beforeMin > 15) &&
          cell.afterMin !== null &&
          cell.afterMin <= 15
        )
          regained += pop;
        if (cell.beforeMin === null && cell.afterMin !== null) reconnected += pop;
        if (cell.afterMin !== null)
          improvement += Math.max(0, (cell.beforeMin ?? 60) - cell.afterMin) * pop;
      });
      const mean = (key: 'beforeMin' | 'afterMin') => {
        const values = cells.flatMap((c) => (c[key] === null ? [] : [c[key]!]));
        return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
      };
      return {
        id: optionId,
        candidateIds: [candidate.id],
        label: candidate.label,
        rank: 1,
        score: (regained + reconnected + improvement) / candidate.estCrewHours,
        estHours: candidate.estCrewHours,
        impact: {
          hospitalAccessPop: regained,
          shelterAccessPop: 0,
          isolatedPopReconnected: reconnected,
          avgHospitalMinBefore: mean('beforeMin'),
          avgHospitalMinAfter: mean('afterMin'),
          facilitiesReconnected: [],
        },
        rationale: 'Ranked by modeled hospital access and travel minutes recovered per crew-hour.',
        narrative: `Reopens ${candidate.label}; comparison uses the supplied road graph and exercise closures.`,
      };
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  options.forEach((option, i) => (option.rank = i + 1));
  const noAccess = region.cells
    .filter((c) => before.get(cellNodes.get(c.id)!) === null)
    .reduce((sum, c) => sum + c.population, 0);
  const outsideThreshold = region.cells
    .filter((c) => (before.get(cellNodes.get(c.id)!) ?? Infinity) > 15)
    .reduce((sum, c) => sum + c.population, 0);
  return {
    impacts,
    analysis: {
      computedAt: world.clock.simTime,
      accessThresholdMin: 15,
      baseline: {
        isolatedPop: noAccess,
        noHospitalAccessPop: outsideThreshold,
        noShelterAccessPop: 0,
      },
      candidates,
      options,
      recommendedOptionId: options[0]?.id ?? null,
    },
  };
}

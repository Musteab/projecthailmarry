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
const snapCache = new WeakMap<RegionStatic, Map<string, RegionStatic['nodes'][number]>>();
export function nearestNode(region: RegionStatic, position: LngLat) {
  let cache = snapCache.get(region);
  if (!cache) {
    cache = new Map();
    snapCache.set(region, cache);
  }
  const key = position.join(',');
  const saved = cache.get(key);
  if (saved) return saved;
  const cos = Math.cos((position[1] * Math.PI) / 180);
  let best = region.nodes[0],
    cost = Infinity;
  for (const node of region.nodes) {
    const d = ((node.position[0] - position[0]) * cos) ** 2 + (node.position[1] - position[1]) ** 2;
    if (d < cost) {
      best = node;
      cost = d;
    }
  }
  cache.set(key, best);
  return best;
}
type Arc = { to: string; edge: RegionStatic['edges'][number]; reverse: boolean };
const graphCache = new WeakMap<
  RegionStatic,
  { forward: Map<string, Arc[]>; backward: Map<string, Arc[]> }
>();
function graph(region: RegionStatic) {
  let cached = graphCache.get(region);
  if (cached) return cached;
  cached = { forward: new Map(), backward: new Map() };
  const add = (from: string, to: string, edge: RegionStatic['edges'][number], reverse: boolean) => {
    cached!.forward.set(from, [...(cached!.forward.get(from) ?? []), { to, edge, reverse }]);
    cached!.backward.set(to, [...(cached!.backward.get(to) ?? []), { to: from, edge, reverse }]);
  };
  for (const edge of region.edges) {
    add(edge.from, edge.to, edge, false);
    if (!edge.oneway) add(edge.to, edge.from, edge, true);
  }
  graphCache.set(region, cached);
  return cached;
}
function shortest(
  region: RegionStatic,
  roads: Record<string, RoadState>,
  starts: string[],
  backward = false,
  end?: string,
) {
  const costs = new Map(starts.map((id) => [id, 0])),
    previous = new Map<
      string,
      { from: string; edge: RegionStatic['edges'][number]; reverse: boolean }
    >();
  const heap: [number, string][] = [];
  const push = (item: [number, string]) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= item[0]) break;
      heap[i] = heap[p];
      i = p;
    }
    heap[i] = item;
  };
  const pop = () => {
    const first = heap[0],
      last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let c = i * 2 + 1;
        if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++;
        if (last[0] <= heap[c][0]) break;
        heap[i] = heap[c];
        i = c;
      }
      heap[i] = last;
    }
    return first;
  };
  starts.forEach((id) => push([0, id]));
  const adjacency = graph(region)[backward ? 'backward' : 'forward'];
  while (heap.length) {
    const [cost, current] = pop();
    if (cost !== costs.get(current)) continue;
    if (current === end) break;
    for (const arc of adjacency.get(current) ?? []) {
      if (roads[arc.edge.id] && roads[arc.edge.id].status !== 'open') continue;
      const next = cost + arc.edge.lengthM / (arc.edge.speedKph / 3.6);
      if (next < (costs.get(arc.to) ?? Infinity)) {
        costs.set(arc.to, next);
        previous.set(arc.to, { from: current, edge: arc.edge, reverse: arc.reverse });
        push([next, arc.to]);
      }
    }
  }
  return { costs, previous };
}
export interface MockRoute {
  route: LngLat[];
  routeEdgeIds: string[];
  seconds: number;
}
/** Small-fixture Dijkstra; respects one-way edges and every non-open road state. */
export function routeBetween(
  region: RegionStatic,
  roads: Record<string, RoadState>,
  from: LngLat,
  to: LngLat,
): MockRoute | undefined {
  const start = nearestNode(region, from).id,
    end = nearestNode(region, to).id;
  const { costs, previous } = shortest(region, roads, [start], false, end);
  if (!costs.has(end)) return undefined;
  const hops = [];
  for (let node = end; node !== start;) {
    const step = previous.get(node)!;
    hops.unshift(step);
    node = step.from;
  }
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
    const costs = shortest(
      region,
      roads,
      hospitals.map((f) => f.nodeId),
      true,
    ).costs;
    return new Map(
      region.nodes.map((node) => [
        node.id,
        costs.has(node.id) ? Math.max(1, costs.get(node.id)!) / 60 : null,
      ]),
    );
  };
  const before = travel(world.roads);
  const candidates = Object.keys(world.roads)
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
        const node = nearestNode(region, cell.center).id;
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
        rationale: 'Ranked by fixture hospital access and travel minutes recovered per crew-hour.',
        narrative: `Reopens ${candidate.label}; comparison uses the synthetic road graph.`,
      };
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  options.forEach((option, i) => (option.rank = i + 1));
  const noAccess = region.cells
    .filter((c) => before.get(nearestNode(region, c.center).id) === null)
    .reduce((sum, c) => sum + c.population, 0);
  const outsideThreshold = region.cells
    .filter((c) => (before.get(nearestNode(region, c.center).id) ?? Infinity) > 15)
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

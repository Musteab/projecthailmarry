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
/** Small-fixture Dijkstra; respects one-way edges and every non-open road state. */
export function routeBetween(
  region: RegionStatic,
  roads: Record<string, RoadState>,
  from: LngLat,
  to: LngLat,
): MockRoute | undefined {
  const start = nearestNode(region, from).id,
    end = nearestNode(region, to).id;
  const costs = new Map([[start, 0]]),
    visited = new Set<string>();
  const previous = new Map<
    string,
    { from: string; edge: RegionStatic['edges'][number]; reverse: boolean }
  >();
  while (true) {
    let current: string | undefined,
      cost = Infinity;
    for (const [id, value] of costs)
      if (!visited.has(id) && value < cost) {
        current = id;
        cost = value;
      }
    if (!current || current === end) break;
    visited.add(current);
    for (const edge of region.edges) {
      if (roads[edge.id] && roads[edge.id].status !== 'open') continue;
      const reverse = edge.to === current && !edge.oneway;
      if (edge.from !== current && !reverse) continue;
      const next = reverse ? edge.from : edge.to;
      const candidate = cost + edge.lengthM / (edge.speedKph / 3.6);
      if (candidate < (costs.get(next) ?? Infinity)) {
        costs.set(next, candidate);
        previous.set(next, { from: current, edge, reverse });
      }
    }
  }
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
  const travel = (position: LngLat, roads: WorldSnapshot['roads']) => {
    const times = hospitals.flatMap((f) => {
      const route = routeBetween(region, roads, position, f.position);
      return route ? [route.seconds / 60] : [];
    });
    return times.length ? Math.min(...times) : null;
  };
  const before = new Map(region.nodes.map((node) => [node.id, travel(node.position, world.roads)]));
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
      const after = new Map(region.nodes.map((node) => [node.id, travel(node.position, roads)]));
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

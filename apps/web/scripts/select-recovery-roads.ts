import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeInitialWorld } from '@bastion/shared';
import { routeBetween, analyzeAccess } from '../../../packages/client/src/mock/routing';
import type { LocalRegion } from '../src/data/regions';
for (const name of ['sunway', 'srimuda']) {
  const file = fileURLToPath(new URL(`../src/data/${name}.json`, import.meta.url));
  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as LocalRegion;
  const region = data.region,
    hospitals = region.facilities.filter((f) => f.kind === 'hospital');
  const counts = new Map<string, number>();
  for (const cell of region.cells)
    for (const hospital of hospitals) {
      const route = routeBetween(region, {}, cell.center, hospital.position);
      for (const id of route?.routeEdgeIds ?? [])
        counts.set(id, (counts.get(id) ?? 0) + cell.population);
    }
  const candidates = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 70);
  const world = makeInitialWorld(
    {
      id: 'selection',
      regionId: name,
      scenarioId: null,
      mode: 'exercise',
      name: 'Exercise closure selection',
      status: 'ready',
      createdBy: 'local-builder',
      createdAt: new Date(0).toISOString(),
    },
    region,
  );
  const ranked = candidates
    .map(([id]) => {
      world.roads = { [id]: { status: 'blocked', closurePublished: false } };
      const analysis = analyzeAccess(region, world).analysis;
      return { id, score: analysis.options[0]?.score ?? 0, impact: analysis.options[0]?.impact };
    })
    .sort((a, b) => b.score - a.score);
  const chosen: typeof ranked = [];
  for (const candidate of ranked) {
    const edge = region.edges.find((e) => e.id === candidate.id)!;
    if (
      chosen.some((c) => {
        const other = region.edges.find((e) => e.id === c.id)!;
        return (
          edge.id.split('-')[1] === other.id.split('-')[1] ||
          edge.from === other.from ||
          edge.from === other.to ||
          edge.to === other.from ||
          edge.to === other.to
        );
      })
    )
      continue;
    chosen.push(candidate);
    if (chosen.length === 3) break;
  }
  Object.assign(data, { exerciseRoadClosures: chosen.map((c) => c.id) });
  fs.writeFileSync(file, JSON.stringify(data));
  console.log(name, chosen);
}

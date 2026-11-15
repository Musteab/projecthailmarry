import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { RegionStaticSchema } from '@bastion/shared';
const read = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../data/regions/portland/${name}.json`, import.meta.url), 'utf8'),
  );
it('committed Portland pack is valid, connected, bounded in size, and maps every facility/cell', () => {
  const p = RegionStaticSchema.parse({
    config: read('region'),
    ...read('roads'),
    facilities: read('facilities'),
    cells: read('cells'),
    grid: read('grid'),
    units: read('units'),
  });
  const nodes = new Set(p.nodes.map((n) => n.id)),
    adj = new Map<string, string[]>();
  for (const e of p.edges) {
    expect(nodes.has(e.from) && nodes.has(e.to)).toBe(true);
    for (const [a, b] of [
      [e.from, e.to],
      [e.to, e.from],
    ])
      adj.set(a, [...(adj.get(a) ?? []), b]);
  }
  const seen = new Set([p.nodes[0].id]),
    queue = [p.nodes[0].id];
  for (let i = 0; i < queue.length; i++)
    for (const next of adj.get(queue[i]) ?? [])
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
  expect(seen.size).toBe(nodes.size);
  expect(p.nodes.length).toBeLessThan(15000);
  expect(JSON.stringify(p).length).toBeLessThan(15000000);
  for (const f of p.facilities) expect(nodes.has(f.nodeId)).toBe(true);
  const mapped = read('cell-nodes');
  for (const c of p.cells) expect(nodes.has(mapped[c.id])).toBe(true);
  expect(p.cells.reduce((s, c) => s + c.population, 0)).toBe(p.config.population);
  expect(p.facilities.filter((f) => f.kind === 'hospital').length).toBeGreaterThanOrEqual(3);
  expect(p.facilities.filter((f) => f.kind === 'fire_station').length).toBeGreaterThanOrEqual(3);
  expect(
    p.bridges.filter((b) =>
      ['Hawthorne Bridge', 'Sellwood Bridge', 'Morrison Bridge'].includes(b.name),
    ),
  ).toHaveLength(3);
});

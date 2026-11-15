import { expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { ScenarioSchema } from '@bastion/shared';
const root = fileURLToPath(new URL('../../../data/', import.meta.url));
const read = (file: string) => JSON.parse(readFileSync(join(root, file), 'utf8'));
const roads = read('regions/portland/roads.json');
const ids = {
  edgeId: new Set(roads.edges.map((e: { id: string }) => e.id)),
  bridgeId: new Set(roads.bridges.map((e: { id: string }) => e.id)),
  facilityId: new Set(read('regions/portland/facilities.json').map((e: { id: string }) => e.id)),
  sectionId: new Set(read('regions/portland/grid.json').sections.map((e: { id: string }) => e.id)),
  unitId: new Set(read('regions/portland/units.json').map((e: { id: string }) => e.id)),
};
for (const file of readdirSync(join(root, 'scenarios')).filter((f) => f.endsWith('.json'))) {
  it(`validates ${file} and its Portland entity references`, () => {
    const raw = read('scenarios/' + file);
    const scenario = ScenarioSchema.parse(raw);
    expect(scenario).toEqual(raw);
    if (scenario.regionId !== 'portland') return;
    const inspect = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      for (const [key, v] of Object.entries(value)) {
        if (key in ids)
          expect(ids[key as keyof typeof ids].has(v as string), `${key}: ${v}`).toBe(true);
        if (key === 'edgeIds')
          for (const id of v as string[]) expect(ids.edgeId.has(id)).toBe(true);
        if (typeof v === 'object') inspect(v);
      }
    };
    inspect(scenario.timeline);
    inspect(scenario.beats);
    expect(scenario.timeline.every((e) => e.at <= scenario.durationSimSec)).toBe(true);
    expect(scenario.beats.every((b) => b.simTime <= scenario.durationSimSec)).toBe(true);
  });
}

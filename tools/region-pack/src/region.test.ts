import { expect, it } from 'vitest';
import { buildGraph, speedKph } from './graph';
import type { OSMData } from './graph';
import { buildCells, decodeTerrarium, tilePixel } from './cells';
const roads: OSMData = {
  elements: [
    { type: 'node', id: 1, lon: 0, lat: 0 },
    { type: 'node', id: 2, lon: 0.001, lat: 0 },
    { type: 'node', id: 3, lon: 0.002, lat: 0 },
    { type: 'node', id: 4, lon: 0.002, lat: 0.001 },
    { type: 'node', id: 10, lon: 0.01, lat: 0.01 },
    { type: 'node', id: 11, lon: 0.011, lat: 0.01 },
    {
      type: 'way',
      id: 20,
      nodes: [1, 2, 3],
      tags: {
        highway: 'primary',
        bridge: 'yes',
        name: 'Test Bridge',
        oneway: '-1',
        maxspeed: '30 mph',
      },
    },
    { type: 'way', id: 21, nodes: [3, 4], tags: { highway: 'residential' } },
    { type: 'way', id: 22, nodes: [10, 11], tags: { highway: 'residential' } },
  ],
};
it('contracts interior nodes, preserves one-way geometry and removes disconnected components', () => {
  const graph = buildGraph(roads, [-1, -1, 1, 1]);
  expect(graph.nodes.map((n) => n.id)).toEqual(['osm-1', 'osm-3', 'osm-4']);
  expect(graph.edges[0]).toMatchObject({
    from: 'osm-3',
    to: 'osm-1',
    oneway: true,
    speedKph: 48.28,
  });
  expect(graph.edges[0].geometry).toHaveLength(3);
  expect(graph.bridges).toHaveLength(1);
  expect(graph.bridges[0].edgeIds).toHaveLength(1);
  expect(graph.discardedComponents).toBe(1);
  expect(speedKph('none', 50)).toBe(50);
});
it('preserves intersection nodes and rejects incomplete upstream responses', () => {
  const graph = buildGraph(
    {
      elements: [
        ...roads.elements,
        { type: 'way', id: 30, nodes: [2, 4], tags: { highway: 'primary' } },
      ],
    },
    [-1, -1, 1, 1],
  );
  expect(graph.nodes.some((n) => n.id === 'osm-2')).toBe(true);
  expect(() => buildGraph({ ...roads, remark: 'timeout' }, [-1, -1, 1, 1])).toThrow('Incomplete');
});
it('normalizes integer cell population exactly and decodes documented terrain values', () => {
  const cells = buildCells([-122.65, 45.46, -122.64, 45.47], { elements: [] }, 12345);
  expect(cells.length).toBeGreaterThan(0);
  expect(cells.reduce((s, c) => s + c.population, 0)).toBe(12345);
  expect(decodeTerrarium(137, 219, 68)).toBe(2523.265625);
  expect(tilePixel([-122.64, 45.47]).px).toBeGreaterThanOrEqual(0);
});

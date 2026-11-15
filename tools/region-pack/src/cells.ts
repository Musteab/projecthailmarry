import { polygonToCells, cellToLatLng, latLngToCell } from 'h3-js';
import type { Cell, LngLat } from '@bastion/shared';
import type { Bbox, OSMData } from './graph';
export function buildingArea(points: { lat: number; lon: number }[]) {
  const mean = points.reduce((s, p) => s + p.lat, 0) / points.length;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    sum += a.lon * b.lat - b.lon * a.lat;
  }
  return Math.abs(sum) * 0.5 * 111320 ** 2 * Math.cos((mean * Math.PI) / 180);
}
export function buildCells(bbox: Bbox, buildings: OSMData, population: number): Cell[] {
  const [w, s, e, n] = bbox;
  const ids = polygonToCells(
    [
      [
        [w, s],
        [e, s],
        [e, n],
        [w, n],
        [w, s],
      ],
    ],
    10,
    true,
  ).sort();
  const area = new Map<string, number>();
  for (const building of buildings.elements) {
    const g = building.geometry;
    if (!g || g.length < 3) continue;
    const latitude = g.reduce((sum, p) => sum + p.lat, 0) / g.length,
      longitude = g.reduce((sum, p) => sum + p.lon, 0) / g.length;
    const id = latLngToCell(latitude, longitude, 10);
    area.set(id, (area.get(id) ?? 0) + buildingArea(g));
  }
  const total = ids.reduce((sum, id) => sum + (area.get(id) ?? 0), 0);
  const cells = ids.map((id) => {
    const [lat, lon] = cellToLatLng(id);
    const exact = population * (total ? (area.get(id) ?? 0) / total : 1 / ids.length);
    return {
      id,
      center: [lon, lat] as LngLat,
      elevM: 0,
      population: Math.floor(exact),
      fraction: exact % 1,
    };
  });
  let remaining = population - cells.reduce((sum, c) => sum + c.population, 0);
  for (const cell of [...cells].sort((a, b) => b.fraction - a.fraction || a.id.localeCompare(b.id)))
    if (remaining-- > 0) cell.population++;
  return cells.map(({ fraction: _, ...cell }) => cell);
}
export function tilePixel(position: LngLat, z = 12) {
  const [lon, lat] = position,
    scale = 2 ** z;
  const x = ((lon + 180) / 360) * scale,
    y = ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * scale;
  return {
    z,
    x: Math.floor(x),
    y: Math.floor(y),
    px: Math.floor((x % 1) * 256),
    py: Math.floor((y % 1) * 256),
  };
}
export const decodeTerrarium = (r: number, g: number, b: number) => r * 256 + g + b / 256 - 32768;

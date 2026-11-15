import type { LngLat, RegionStatic } from '@bastion/shared';
import sunway from './sunway.json';
import srimuda from './srimuda.json';

export type Surface = {
  id: string;
  kind: string;
  polygon: LngLat[];
  height: number;
  estimated: boolean;
  name: string;
  landmark: boolean;
};
export type LocalRegion = {
  exerciseRoadClosures?: string[];
  region: RegionStatic;
  surfaces: Surface[];
  landmarks: { name: string; position: LngLat; osmId: number }[];
  aliases: Record<string, string>;
  cellPolygons: Record<string, LngLat[]>;
  provenance: { source: string; license: string; retrieved: string; notes: string };
};
export const regions = {
  sunway: sunway as unknown as LocalRegion,
  srimuda: srimuda as unknown as LocalRegion,
};
export type RegionKey = keyof typeof regions;
export const closestNode = (data: LocalRegion, p: LngLat) =>
  data.region.nodes.reduce((a, b) =>
    Math.hypot(a.position[0] - p[0], a.position[1] - p[1]) <
    Math.hypot(b.position[0] - p[0], b.position[1] - p[1])
      ? a
      : b,
  );
export function project(data: LocalRegion, p: LngLat): [number, number, number] {
  const c = data.region.config.defaultCamera.center;
  return [(p[0] - c[0]) * 11115, 0, -(p[1] - c[1]) * 11132];
}

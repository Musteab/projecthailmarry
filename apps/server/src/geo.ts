import type { LngLat } from '@bastion/shared';

const M_PER_DEG_LAT = 111_320;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Ground distance in metres. Equirectangular: accurate to well under 1% at city scale. */
export function distanceM(a: LngLat, b: LngLat): number {
  const x = (b[0] - a[0]) * Math.cos(toRad((a[1] + b[1]) / 2)) * M_PER_DEG_LAT;
  const y = (b[1] - a[1]) * M_PER_DEG_LAT;
  return Math.hypot(x, y);
}

/** Compass bearing from a to b in degrees, 0 = north, clockwise. */
export function bearingDeg(a: LngLat, b: LngLat): number {
  const x = (b[0] - a[0]) * Math.cos(toRad((a[1] + b[1]) / 2));
  const y = b[1] - a[1];
  if (x === 0 && y === 0) return 0;
  return (Math.atan2(x, y) * 180) / Math.PI + (x < 0 ? 360 : 0);
}

/** Length of a polyline in metres. */
export function pathLengthM(path: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += distanceM(path[i - 1]!, path[i]!);
  return total;
}

/** The point a fraction (0..1) of the way along a polyline, and the heading there. */
export function pointAlong(
  path: LngLat[],
  fraction: number,
): { position: LngLat; heading: number } {
  if (path.length === 0) throw new Error('pointAlong: empty path');
  if (path.length === 1) return { position: path[0]!, heading: 0 };

  const total = pathLengthM(path);
  let remaining = Math.min(1, Math.max(0, fraction)) * total;
  for (let i = 1; i < path.length; i++) {
    const from = path[i - 1]!;
    const to = path[i]!;
    const length = distanceM(from, to);
    if (remaining <= length || i === path.length - 1) {
      const t = length === 0 ? 0 : Math.min(1, remaining / length);
      return {
        position: [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t],
        heading: bearingDeg(from, to),
      };
    }
    remaining -= length;
  }
  return { position: path[path.length - 1]!, heading: 0 };
}

/** Shortest distance in metres from a point to a polyline. */
export function distanceToPathM(point: LngLat, path: LngLat[]): number {
  const scale = Math.cos(toRad(point[1])) * M_PER_DEG_LAT;
  const px = point[0] * scale;
  const py = point[1] * M_PER_DEG_LAT;
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const ax = path[i - 1]![0] * scale;
    const ay = path[i - 1]![1] * M_PER_DEG_LAT;
    const bx = path[i]![0] * scale;
    const by = path[i]![1] * M_PER_DEG_LAT;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    const t =
      lengthSq === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
    best = Math.min(best, Math.hypot(px - (ax + dx * t), py - (ay + dy * t)));
  }
  return path.length === 1 ? distanceM(point, path[0]!) : best;
}

/**
 * Nearest-point lookup over a fixed set of points, using a uniform grid.
 * Used to snap incidents, cells and facilities to road nodes and cells.
 */
export class PointIndex {
  private readonly buckets = new Map<number, number[]>();
  private readonly originLng: number;
  private readonly originLat: number;
  private readonly mPerDegLng: number;
  private readonly cols: number;
  private readonly rows: number;

  constructor(
    private readonly points: LngLat[],
    private readonly cellSizeM = 250,
  ) {
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    for (const [lng, lat] of points) {
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
    this.originLng = points.length ? minLng : 0;
    this.originLat = points.length ? minLat : 0;
    this.mPerDegLng = M_PER_DEG_LAT * Math.cos(toRad(points.length ? (minLat + maxLat) / 2 : 0));
    this.cols = points.length ? this.col(maxLng) + 1 : 1;
    this.rows = points.length ? this.row(maxLat) + 1 : 1;

    points.forEach(([lng, lat], index) => {
      const key = this.key(this.col(lng), this.row(lat));
      const bucket = this.buckets.get(key);
      if (bucket) bucket.push(index);
      else this.buckets.set(key, [index]);
    });
  }

  private col(lng: number): number {
    return Math.floor(((lng - this.originLng) * this.mPerDegLng) / this.cellSizeM);
  }
  private row(lat: number): number {
    return Math.floor(((lat - this.originLat) * M_PER_DEG_LAT) / this.cellSizeM);
  }
  private key(col: number, row: number): number {
    return col * 1_000_003 + row;
  }

  /** Index of the nearest point, or -1 when the index is empty. */
  nearest(position: LngLat): number {
    if (this.points.length === 0) return -1;
    const col = Math.min(this.cols - 1, Math.max(0, this.col(position[0])));
    const row = Math.min(this.rows - 1, Math.max(0, this.row(position[1])));

    let best = -1;
    let bestDistance = Infinity;
    const maxRing = Math.max(this.cols, this.rows);
    for (let ring = 0; ring <= maxRing; ring++) {
      for (let c = col - ring; c <= col + ring; c++) {
        for (let r = row - ring; r <= row + ring; r++) {
          // Only the cells on the edge of the ring; the inside was covered by smaller rings.
          if (Math.max(Math.abs(c - col), Math.abs(r - row)) !== ring) continue;
          const bucket = this.buckets.get(this.key(c, r));
          if (!bucket) continue;
          for (const index of bucket) {
            const distance = distanceM(position, this.points[index]!);
            if (distance < bestDistance) {
              bestDistance = distance;
              best = index;
            }
          }
        }
      }
      // Anything in a farther ring is at least (ring * cellSize) away.
      if (best !== -1 && bestDistance <= ring * this.cellSizeM) break;
    }
    return best;
  }
}

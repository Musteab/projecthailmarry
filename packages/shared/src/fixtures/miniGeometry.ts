import type { LngLat } from '../primitives';

/**
 * Geometry of region-mini, the synthetic test region.
 *
 * A 7 x 6 street lattice, 250 m between intersections, laid inside the Portland bounding box
 * (it does not follow real streets). A river runs north-south between columns 2 and 3 and is
 * crossed by two bridges. A creek flows west into the river between rows 2 and 3 on the east bank.
 *
 *   row 5   o--o--o  ~  o--o--o--o          ~ = river
 *   row 4   o--o--o==~==o--o--o--o          = = North Bridge (vulnerable)
 *   row 3   o--o--o  ~  o--o--o--o
 *                    ~ <------------ creek  (east bank only, between rows 2 and 3)
 *   row 2   o--o--o  ~  o--o--o--o
 *   row 1   o--o--o==~==o--o--o--o          = = South Bridge (retrofitted)
 *   row 0   o--o--o  ~  o--o--o--o
 *          c0 c1 c2    c3 c4 c5 c6
 */

export const MINI_REGION_ID = 'region-mini';
export const MINI_ORIGIN: LngLat = [-122.64, 45.47];
export const MINI_COLS = 7;
export const MINI_ROWS = 6;
export const MINI_STEP_M = 250;
export const MINI_H3_RESOLUTION = 10;

/** The river runs along this (fractional) column. */
export const MINI_RIVER_COL = 2.5;
/** The creek runs along this (fractional) row, from the east edge to the river. */
export const MINI_CREEK_ROW = 2.5;
export const MINI_CREEK_EAST_COL = 6.4;
/** Rows whose street crosses the river on a bridge. */
export const MINI_BRIDGE_ROWS = { south: 1, north: 4 } as const;

const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG = M_PER_DEG_LAT * Math.cos((MINI_ORIGIN[1] * Math.PI) / 180);

const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

/** Position of a lattice coordinate. Columns and rows may be fractional. */
export function miniPoint(col: number, row: number): LngLat {
  return [
    round6(MINI_ORIGIN[0] + (col * MINI_STEP_M) / M_PER_DEG_LNG),
    round6(MINI_ORIGIN[1] + (row * MINI_STEP_M) / M_PER_DEG_LAT),
  ];
}

/** Inverse of miniPoint: lattice coordinates (fractional) of a position. */
export function miniLattice(position: LngLat): { col: number; row: number } {
  return {
    col: ((position[0] - MINI_ORIGIN[0]) * M_PER_DEG_LNG) / MINI_STEP_M,
    row: ((position[1] - MINI_ORIGIN[1]) * M_PER_DEG_LAT) / MINI_STEP_M,
  };
}

export const miniNodeId = (col: number, row: number) => `n-${col}-${row}`;
/** Edge from (col,row) east to (col+1,row). */
export const miniEdgeH = (col: number, row: number) => `e-h-${col}-${row}`;
/** Edge from (col,row) north to (col,row+1). */
export const miniEdgeV = (col: number, row: number) => `e-v-${col}-${row}`;

/** The creek channel, east to west, ending at the river. */
export const MINI_CREEK_PATH: LngLat[] = [
  miniPoint(MINI_CREEK_EAST_COL, MINI_CREEK_ROW),
  miniPoint(4.5, MINI_CREEK_ROW),
  miniPoint(MINI_RIVER_COL, MINI_CREEK_ROW),
];

/** Stable ids of the things tests and scenario-mini refer to. */
export const MINI = {
  bridges: { north: 'br-north', south: 'br-south' },
  facilities: {
    hospitalWest: 'fac-hospital-west',
    hospitalEast: 'fac-hospital-east',
    shelterWest: 'fac-shelter-west',
    shelterEast: 'fac-shelter-east',
    fireWest: 'fac-fire-west',
    fireEast: 'fac-fire-east',
    ems: 'fac-ems-south',
    eoc: 'fac-eoc',
    substation: 'fac-substation',
    yard: 'fac-yard',
  },
  sections: {
    /** runs along the north bank of the creek: the first to be threatened by a flood */
    creekside: 'sec-1',
    /** downstream of sec-1, feeds the east hospital */
    hospitalEast: 'sec-2',
    /** crosses the creek southward, feeds the east shelter */
    southeast: 'sec-3',
    /** downstream of sec-3, feeds the EMS station */
    ems: 'sec-4',
  },
  units: {
    rescue1: 'u-rescue-1',
    rescue2: 'u-rescue-2',
    engine1: 'u-engine-1',
    usar1: 'u-usar-1',
    medic1: 'u-medic-1',
    medic2: 'u-medic-2',
    works1: 'u-works-1',
    utility1: 'u-utility-1',
  },
} as const;

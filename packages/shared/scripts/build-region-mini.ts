/**
 * Generates src/fixtures/regionMini.data.ts, the synthetic test region.
 * Deterministic: running it twice produces the same file.
 *
 *   pnpm --filter @bastion/shared gen:region-mini
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cellToLatLng, latLngToCell, polygonToCells } from 'h3-js';
import {
  MINI,
  MINI_BRIDGE_ROWS,
  MINI_COLS,
  MINI_CREEK_EAST_COL,
  MINI_CREEK_ROW,
  MINI_H3_RESOLUTION,
  MINI_REGION_ID,
  MINI_RIVER_COL,
  MINI_ROWS,
  MINI_STEP_M,
  miniEdgeH,
  miniEdgeV,
  miniLattice,
  miniNodeId,
  miniPoint,
} from '../src/fixtures/miniGeometry';
import type { LngLat } from '../src/primitives';
import type {
  Bridge,
  Cell,
  Facility,
  FacilityKind,
  GridSection,
  RegionStatic,
  RoadEdge,
  RoadNode,
  UnitSeed,
} from '../src/region';
import { RegionStaticSchema } from '../src/region';

const TOTAL_POPULATION = 12_000;
const MARGIN = 0.4; // lattice steps of padding around the street grid
const RIVER_HALF_WIDTH_M = 40;
const RIVER_ELEV_M = 5;

/** Small seeded PRNG (mulberry32) so the fixture is reproducible. */
function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(1337);
const round1 = (value: number) => Math.round(value * 10) / 10;

// ---------------------------------------------------------------- roads
const nodes: RoadNode[] = [];
for (let row = 0; row < MINI_ROWS; row++) {
  for (let col = 0; col < MINI_COLS; col++) {
    nodes.push({ id: miniNodeId(col, row), position: miniPoint(col, row) });
  }
}

const bridgeRows: number[] = [MINI_BRIDGE_ROWS.south, MINI_BRIDGE_ROWS.north];
const riverWestCol = Math.floor(MINI_RIVER_COL); // the street from this column to the next crosses the river
const edges: RoadEdge[] = [];

for (let row = 0; row < MINI_ROWS; row++) {
  for (let col = 0; col < MINI_COLS - 1; col++) {
    const crossesRiver = col === riverWestCol;
    if (crossesRiver && !bridgeRows.includes(row)) continue;
    const arterial = bridgeRows.includes(row);
    const edge: RoadEdge = {
      id: miniEdgeH(col, row),
      from: miniNodeId(col, row),
      to: miniNodeId(col + 1, row),
      geometry: [miniPoint(col, row), miniPoint(col + 1, row)],
      lengthM: MINI_STEP_M,
      speedKph: arterial ? 50 : 30,
      class: arterial ? 'arterial' : 'local',
      name: `${row + 1}${['st', 'nd', 'rd'][row] ?? 'th'} Street`,
      oneway: false,
    };
    if (crossesRiver) {
      edge.bridgeId = row === MINI_BRIDGE_ROWS.north ? MINI.bridges.north : MINI.bridges.south;
    }
    edges.push(edge);
  }
}

for (let col = 0; col < MINI_COLS; col++) {
  for (let row = 0; row < MINI_ROWS - 1; row++) {
    const collector = col === 0 || col === MINI_COLS - 1;
    edges.push({
      id: miniEdgeV(col, row),
      from: miniNodeId(col, row),
      to: miniNodeId(col, row + 1),
      geometry: [miniPoint(col, row), miniPoint(col, row + 1)],
      lengthM: MINI_STEP_M,
      speedKph: collector ? 40 : 30,
      class: collector ? 'collector' : 'local',
      name: `Avenue ${String.fromCharCode(65 + col)}`,
      oneway: false,
    });
  }
}

const bridges: Bridge[] = [
  {
    id: MINI.bridges.north,
    name: 'North Bridge',
    edgeIds: [miniEdgeH(riverWestCol, MINI_BRIDGE_ROWS.north)],
    seismicClass: 'vulnerable',
  },
  {
    id: MINI.bridges.south,
    name: 'South Bridge',
    edgeIds: [miniEdgeH(riverWestCol, MINI_BRIDGE_ROWS.south)],
    seismicClass: 'retrofitted',
  },
];

// ---------------------------------------------------------------- facilities
function facility(
  id: string,
  kind: FacilityKind,
  name: string,
  col: number,
  row: number,
  capacity?: number,
): Facility {
  const base = { id, kind, name, position: miniPoint(col, row), nodeId: miniNodeId(col, row) };
  return capacity === undefined ? base : { ...base, capacity };
}

const F = MINI.facilities;
const facilities: Facility[] = [
  facility(F.hospitalWest, 'hospital', 'Westbank General Hospital', 1, 1, 200),
  facility(F.hospitalEast, 'hospital', 'Eastside Medical Center', 5, 4, 150),
  facility(F.shelterWest, 'shelter', 'Westbank Community Center', 0, 4, 300),
  facility(F.shelterEast, 'shelter', 'Creekside High School', 6, 1, 250),
  facility(F.fireWest, 'fire_station', 'Fire Station 1', 1, 3),
  facility(F.fireEast, 'fire_station', 'Fire Station 2', 4, 4),
  facility(F.ems, 'ems_station', 'EMS Station South', 3, 1),
  facility(F.eoc, 'eoc', 'Emergency Operations Center', 0, 2),
  facility(F.substation, 'substation', 'Creek Substation', 6, 3),
  facility(F.yard, 'public_works_yard', 'Public Works Yard', 2, 5),
];

// ---------------------------------------------------------------- cells
function terrain(position: LngLat): { elevM: number; inRiver: boolean } {
  const { col, row } = miniLattice(position);
  const riverDistM = Math.abs(col - MINI_RIVER_COL) * MINI_STEP_M;
  if (riverDistM < RIVER_HALF_WIDTH_M) return { elevM: RIVER_ELEV_M, inRiver: true };

  // Ground rises away from the river...
  let elevM = RIVER_ELEV_M + 0.02 * riverDistM;
  // ...and the creek cuts a shallow valley into the east bank.
  if (col > MINI_RIVER_COL && col <= MINI_CREEK_EAST_COL + 0.2) {
    const creekDistM = Math.abs(row - MINI_CREEK_ROW) * MINI_STEP_M;
    const bedElevM = RIVER_ELEV_M + (col - MINI_RIVER_COL) * MINI_STEP_M * 0.002;
    elevM = Math.min(elevM, bedElevM + 0.025 * creekDistM);
  }
  return { elevM, inRiver: false };
}

const west = miniPoint(-MARGIN, 0)[0];
const east = miniPoint(MINI_COLS - 1 + MARGIN, 0)[0];
const south = miniPoint(0, -MARGIN)[1];
const north = miniPoint(0, MINI_ROWS - 1 + MARGIN)[1];

// h3-js takes [lat, lng] pairs here.
const cellIds = polygonToCells(
  [
    [south, west],
    [south, east],
    [north, east],
    [north, west],
  ],
  MINI_H3_RESOLUTION,
).sort();

const drafts = cellIds.map((id) => {
  const [lat, lng] = cellToLatLng(id);
  const center: LngLat = [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6];
  const { elevM, inRiver } = terrain(center);
  return {
    id,
    center,
    elevM: round1(elevM + (inRiver ? 0 : (random() - 0.5) * 0.4)),
    weight: inRiver ? 0 : 0.6 + random() * 0.8,
  };
});

const totalWeight = drafts.reduce((sum, draft) => sum + draft.weight, 0);
const cells: Cell[] = drafts.map(({ id, center, elevM, weight }) => ({
  id,
  center,
  elevM,
  population: Math.floor((weight / totalWeight) * TOTAL_POPULATION),
}));
// Give the rounding remainder to the most populous cell so the total is exact.
const remainder = TOTAL_POPULATION - cells.reduce((sum, cell) => sum + cell.population, 0);
cells.reduce((best, cell) => (cell.population > best.population ? cell : best)).population +=
  remainder;

// ---------------------------------------------------------------- grid
const knownCells = new Set(cellIds);

/** Cells a path passes through, sampled every 25 m. */
function cellsAlong(lattice: [number, number][]): string[] {
  const found = new Set<string>();
  for (let i = 0; i < lattice.length - 1; i++) {
    const [c0, r0] = lattice[i]!;
    const [c1, r1] = lattice[i + 1]!;
    const steps = Math.max(1, Math.round((Math.hypot(c1 - c0, r1 - r0) * MINI_STEP_M) / 25));
    for (let s = 0; s <= steps; s++) {
      const [lng, lat] = miniPoint(c0 + ((c1 - c0) * s) / steps, r0 + ((r1 - r0) * s) / steps);
      const cell = latLngToCell(lat, lng, MINI_H3_RESOLUTION);
      if (knownCells.has(cell)) found.add(cell);
    }
  }
  return [...found].sort();
}

function section(
  id: string,
  feederId: string,
  upstreamSectionId: string | null,
  lattice: [number, number][],
  customers: number,
  criticalFacilityIds: string[],
): GridSection {
  return {
    id,
    feederId,
    substationId: F.substation,
    upstreamSectionId,
    path: lattice.map(([col, row]) => miniPoint(col, row)),
    cellIds: cellsAlong(lattice),
    customers,
    criticalFacilityIds,
  };
}

const S = MINI.sections;
const sections: GridSection[] = [
  // Feeder 1 follows 4th Street west along the north bank of the creek, then turns north.
  section(
    S.creekside,
    'feeder-1',
    null,
    [
      [6, 3],
      [5, 3],
      [4, 3],
    ],
    900,
    [],
  ),
  section(
    S.hospitalEast,
    'feeder-1',
    S.creekside,
    [
      [4, 3],
      [4, 4],
      [5, 4],
    ],
    1100,
    [F.hospitalEast, F.fireEast],
  ),
  // Feeder 2 crosses the creek southward, then runs west along 2nd Street.
  section(
    S.southeast,
    'feeder-2',
    null,
    [
      [6, 3],
      [6, 2],
      [6, 1],
    ],
    800,
    [F.shelterEast],
  ),
  section(
    S.ems,
    'feeder-2',
    S.southeast,
    [
      [6, 1],
      [5, 1],
      [4, 1],
      [3, 1],
    ],
    1000,
    [F.ems],
  ),
];

// ---------------------------------------------------------------- units
const U = MINI.units;
const units: UnitSeed[] = [
  {
    id: U.rescue1,
    callsign: 'Rescue 1',
    kind: 'swift_water',
    authority: 'fire_rescue',
    homeFacilityId: F.fireWest,
  },
  {
    id: U.rescue2,
    callsign: 'Rescue 2',
    kind: 'swift_water',
    authority: 'fire_rescue',
    homeFacilityId: F.fireEast,
  },
  {
    id: U.engine1,
    callsign: 'Engine 1',
    kind: 'engine',
    authority: 'fire_rescue',
    homeFacilityId: F.fireWest,
  },
  {
    id: U.usar1,
    callsign: 'USAR 1',
    kind: 'usar',
    authority: 'fire_rescue',
    homeFacilityId: F.fireEast,
  },
  {
    id: U.medic1,
    callsign: 'Medic 1',
    kind: 'als_ambulance',
    authority: 'ems',
    homeFacilityId: F.ems,
  },
  {
    id: U.medic2,
    callsign: 'Medic 2',
    kind: 'bls_ambulance',
    authority: 'ems',
    homeFacilityId: F.ems,
  },
  {
    id: U.works1,
    callsign: 'Works 1',
    kind: 'public_works',
    authority: 'public_works',
    homeFacilityId: F.yard,
  },
  {
    id: U.utility1,
    callsign: 'Line 1',
    kind: 'utility_crew',
    authority: 'utility',
    homeFacilityId: F.substation,
  },
];

// ---------------------------------------------------------------- assemble
const region: RegionStatic = RegionStaticSchema.parse({
  config: {
    id: MINI_REGION_ID,
    name: 'Mini District (test fixture)',
    bbox: [west, south, east, north],
    defaultCamera: {
      center: miniPoint((MINI_COLS - 1) / 2, (MINI_ROWS - 1) / 2),
      zoom: 14.6,
      pitch: 55,
      bearing: -15,
    },
    hazards: ['flash_flood', 'earthquake'],
    h3Resolution: MINI_H3_RESOLUTION,
    population: TOTAL_POPULATION,
  },
  nodes,
  edges,
  bridges,
  facilities,
  cells,
  grid: { sections },
  units,
});

const output = `// GENERATED by scripts/build-region-mini.ts. Do not edit by hand.
// Regenerate with: pnpm --filter @bastion/shared gen:region-mini
import type { RegionStatic } from '../region';

export const regionMiniData: RegionStatic = ${JSON.stringify(region, null, 2)};
`;

const target = fileURLToPath(new URL('../src/fixtures/regionMini.data.ts', import.meta.url));
writeFileSync(target, output);

console.log(
  `region-mini: ${nodes.length} nodes, ${edges.length} edges, ${bridges.length} bridges, ` +
    `${facilities.length} facilities, ${cells.length} cells, ${sections.length} grid sections, ` +
    `${units.length} units -> ${target}`,
);

import type {
  ActionPayload,
  HazardState,
  Incident,
  Inject,
  Scenario,
  SignalInput,
  WorkOrderStatus,
  CellState,
  RegionStatic,
} from '@bastion/shared';
import { MINI, MINI_CREEK_PATH, miniEdgeH, miniEdgeV, miniPoint } from '@bastion/shared/fixtures';

export type StoryEvent = { at: number } & (
  | { type: 'signal'; id: string; signal: SignalInput }
  | { type: 'incident'; incident: Incident }
  | { type: 'inject'; inject: Inject }
  | {
      type: 'action';
      id: string;
      payload: ActionPayload;
      headline: string;
      disposition: 'auto' | 'approve' | 'reject';
      ruleId?: string;
    }
  | { type: 'resolve'; incidentId: string }
  | { type: 'recovery' }
  | { type: 'work'; status: WorkOrderStatus }
);
export interface MockScript {
  scenario: Scenario;
  hazard: HazardState;
  events: StoryEvent[];
  /** [simulation seconds, scalar intensity]; geography weights give every cell its own value. */
  intensity: [number, number][];
}
export function intensityAt(frames: [number, number][], time: number) {
  if (time <= frames[0][0]) return frames[0][1];
  for (let i = 1; i < frames.length; i++) {
    const [at, value] = frames[i],
      [previousAt, previousValue] = frames[i - 1];
    if (time <= at)
      return previousValue + ((value - previousValue) * (time - previousAt)) / (at - previousAt);
  }
  return frames.at(-1)![1];
}
export function cellsAt(
  script: MockScript,
  region: RegionStatic,
  time: number,
): Record<string, CellState> {
  const intensity = intensityAt(script.intensity, time);
  if (intensity <= 0) return {};
  const center = miniPoint(4.5, 2.5),
    cells: Record<string, CellState> = {};
  for (const cell of region.cells) {
    if (script.scenario.hazard === 'flash_flood') {
      const weight = Math.max(0, 1 - Math.abs(cell.center[1] - center[1]) / 0.0035);
      if (cell.center[0] >= miniPoint(2.5, 0)[0] && weight > 0.05)
        cells[cell.id] = { floodDepthM: Number((intensity * weight).toFixed(3)) };
    } else {
      const weight = Math.max(
        0,
        1 - Math.hypot((cell.center[0] - center[0]) * 0.7, cell.center[1] - center[1]) / 0.025,
      );
      if (weight > 0) cells[cell.id] = { shakeMMI: Number((intensity * weight).toFixed(2)) };
    }
  }
  return cells;
}
function incident(
  region: RegionStatic,
  id: string,
  kind: Incident['kind'],
  title: string,
  position: Incident['position'],
  sources: string[],
  capabilities: Incident['requiredCapabilities'],
): Incident {
  const closest = region.cells.reduce((a, b) =>
    Math.hypot(a.center[0] - position[0], a.center[1] - position[1]) <
    Math.hypot(b.center[0] - position[0], b.center[1] - position[1])
      ? a
      : b,
  );
  return {
    id,
    kind,
    title,
    position,
    cellId: closest.id,
    severity: 4,
    status: 'confirmed',
    confidence: 0.94,
    peopleAffected: kind === 'medical' ? 1 : 12,
    sourceSignalIds: sources,
    requiredCapabilities: capabilities,
    assignedUnitIds: [],
    openedAt: 20,
    aiSummary: 'Scripted fusion of corroborating exercise reports.',
  };
}
const signal = (
  at: number,
  id: string,
  source: SignalInput['source'],
  title: string,
  body: string,
  position = miniPoint(4, 2),
): StoryEvent => ({
  at,
  type: 'signal',
  id,
  signal: { source, title, body, position, reliability: source === 'social' ? 0.3 : 0.95 },
});
const action = (
  at: number,
  id: string,
  payload: ActionPayload,
  headline: string,
  disposition: 'auto' | 'approve' | 'reject' = 'auto',
  ruleId?: string,
): StoryEvent => ({ at, type: 'action', id, payload, headline, disposition, ruleId });
const inject = (at: number, value: Inject): StoryEvent => ({ at, type: 'inject', inject: value });

export function createMockScripts(region: RegionStatic): MockScript[] {
  const rescue = incident(
    region,
    'flood-rescue',
    'water_rescue',
    'Twelve residents stranded at the creek',
    miniPoint(4, 2),
    ['flood-field', 'flood-call', 'flood-image'],
    ['swift_water'],
  );
  const medical = incident(
    region,
    'flood-medical',
    'medical',
    '911: acute chest pain south of the creek',
    miniPoint(5, 1),
    ['flood-medical-call'],
    ['als_ambulance'],
  );
  medical.triage = {
    acuity: 1,
    category: 'Immediate',
    chiefComplaint: 'Chest pain and shortness of breath',
    recommendedUnit: 'als_ambulance',
    rationale: 'Scripted time-critical medical call.',
  };
  const collapse = incident(
    region,
    'quake-collapse',
    'structure_collapse',
    'Building collapse on the east bank',
    miniPoint(4, 4),
    ['quake-field', 'quake-image'],
    ['usar'],
  );
  const quakeMedical = incident(
    region,
    'quake-medical',
    'medical',
    'Injuries near the damaged bridge',
    miniPoint(3, 4),
    ['quake-call'],
    ['bls_ambulance'],
  );
  const recovery: StoryEvent[] = [
    { at: 205, type: 'recovery' },
    ...(['created', 'assigned', 'in_progress', 'inspection', 'reopened'] as const).map(
      (status, i): StoryEvent => ({ at: 210 + i * 35, type: 'work', status }),
    ),
  ];
  const makeScenario = (
    id: string,
    hazard: 'flash_flood' | 'earthquake',
    titles: [number, string, string][],
  ): Scenario => ({
    id,
    name:
      hazard === 'flash_flood'
        ? 'Flash flood · detect, act, restore'
        : 'Earthquake · bridges, hospitals, recovery',
    hazard,
    regionId: region.config.id,
    description: 'Offline scripted exercise on synthetic region-mini geography.',
    seed: 20261115,
    durationSimSec: 380,
    defaultSpeed: 5,
    hazards: [],
    timeline: [],
    beats: titles.map(([simTime, title, caption], i) => ({
      id: `${id}-beat-${i}`,
      simTime,
      title,
      caption,
      camera: {
        center: miniPoint(4, 2.5),
        zoom: 15.5,
        pitch: 55,
        bearing: i * 15,
        durationMs: 1800,
      },
    })),
  });
  const floodScenario = makeScenario('mock-flood', 'flash_flood', [
    [0, 'Flash-flood warning', 'Gauges and field reports describe rapidly rising water.'],
    [20, 'Three reports, one rescue', 'Field, 911 and camera reports are fused into one incident.'],
    [40, 'Rescue and medical response', 'Teams follow open streets around the flood closure.'],
    [
      60,
      'Protect the electricity network',
      'A utility-approved exercise rule isolates the threatened feeder.',
    ],
    [180, 'Water recedes; debris remains', 'The flood has left blocked creek crossings.'],
    [
      205,
      'Choose the first road to clear',
      'Compare per-cell hospital access before and after a repair.',
    ],
    [350, 'Inspect and reopen', 'The work order reaches inspection and the road reopens.'],
  ]);
  floodScenario.hazards = [
    {
      id: 'mock-flood-hazard',
      kind: 'flash_flood',
      label: 'Creek flash flood',
      sourcePaths: [MINI_CREEK_PATH],
      stageCurve: [
        [0, 0],
        [60, 2.4],
        [120, 3],
        [180, 0.3],
        [200, 0],
      ],
    },
  ];
  const flood: MockScript = {
    scenario: floodScenario,
    hazard: {
      id: 'mock-flood-hazard',
      kind: 'flash_flood',
      label: 'Creek flash flood',
      phase: 'forecast',
      sourcePaths: [MINI_CREEK_PATH],
    },
    intensity: [
      [0, 0],
      [20, 0.4],
      [60, 1.8],
      [120, 2.4],
      [180, 0.2],
      [200, 0],
    ],
    events: [
      signal(
        0,
        'flood-warning',
        'official_alert',
        'Flash-flood warning',
        'Exercise warning: low-lying creek streets are at risk.',
      ),
      signal(
        5,
        'flood-gauge',
        'sensor',
        'Gauge exceeds flood stage',
        'Water level is rising rapidly.',
      ),
      signal(
        10,
        'flood-field',
        'field_report',
        'Residents trapped near creek',
        'Patrol confirms twelve people stranded.',
      ),
      signal(
        14,
        'flood-call',
        'call_911',
        '911: stranded residents',
        'Caller reports the same group at the creek.',
      ),
      signal(
        18,
        'flood-image',
        'imagery',
        'Camera confirms people in floodwater',
        'Local traffic-camera image corroborates the reports.',
      ),
      { at: 20, type: 'incident', incident: rescue },
      inject(22, {
        kind: 'set_road_status',
        edgeIds: [miniEdgeV(4, 2)],
        status: 'flooded',
        reason: 'Unsafe creek crossing',
      }),
      action(
        25,
        'flood-dispatch',
        { kind: 'dispatch_unit', unitId: MINI.units.rescue1, incidentId: rescue.id },
        'Swift-water crew routed around the flooded crossing',
        'auto',
        'mock-dispatch',
      ),
      signal(
        30,
        'flood-medical-call',
        'call_911',
        '911: chest pain',
        'An adult reports chest pain; ambulance response required.',
        medical.position,
      ),
      { at: 32, type: 'incident', incident: medical },
      action(
        35,
        'flood-ambulance',
        {
          kind: 'assign_ambulance',
          unitId: MINI.units.medic1,
          incidentId: medical.id,
          hospitalId: MINI.facilities.hospitalWest,
        },
        'ALS ambulance to the medical call',
      ),
      action(
        40,
        'flood-backup',
        { kind: 'dispatch_unit', unitId: MINI.units.rescue2, incidentId: rescue.id },
        'Request a second rescue crew',
        'approve',
      ),
      signal(
        55,
        'flood-scada',
        'utility_scada',
        'Water reaches feeder equipment',
        'Moisture sensors confirm threatened creekside equipment.',
      ),
      action(
        60,
        'flood-isolate',
        { kind: 'isolate_grid_section', sectionId: MINI.sections.creekside },
        'Utility rule isolates threatened feeder and downstream sections',
        'auto',
        'mock-utility',
      ),
      action(
        65,
        'flood-shelter',
        { kind: 'activate_shelter', facilityId: MINI.facilities.shelterWest },
        'Open the west-bank shelter',
      ),
      action(
        70,
        'flood-closure',
        { kind: 'publish_road_closure', edgeIds: [miniEdgeV(4, 2)], reason: 'Floodwater' },
        'Publish confirmed road closure',
      ),
      action(
        75,
        'flood-duplicate',
        { kind: 'dispatch_unit', unitId: MINI.units.engine1, incidentId: rescue.id },
        'Duplicate request declined: specialist rescue already assigned',
        'reject',
      ),
      { at: 150, type: 'resolve', incidentId: rescue.id },
      { at: 160, type: 'resolve', incidentId: medical.id },
      inject(180, {
        kind: 'set_road_status',
        edgeIds: [miniEdgeV(4, 2), miniEdgeV(5, 2), miniEdgeH(4, 2)],
        status: 'blocked',
        reason: 'Debris after flood recession',
        estCrewHours: 2,
      }),
      ...recovery,
      action(
        365,
        'flood-grid-restore',
        { kind: 'restore_grid_section', sectionId: MINI.sections.creekside },
        'Utility inspection complete: restore feeder',
        'approve',
      ),
    ],
  };
  const quakeScenario = makeScenario('mock-quake', 'earthquake', [
    [0, 'Earthquake detected', 'Shaking spreads across the district.'],
    [
      10,
      'Bridge and hospital disrupted',
      'The north bridge closes and the east hospital switches to backup power.',
    ],
    [
      30,
      'Different disaster, different response',
      'Urban search-and-rescue crosses the remaining open bridge.',
    ],
    [
      55,
      'Divert medical transport',
      'Ambulances avoid the damaged crossing and the unavailable hospital.',
    ],
    [205, 'Restore cross-river access', 'Rank bridge repair against debris clearance.'],
    [350, 'Inspection before reopening', 'Crews finish the repair and reopen the route.'],
  ]);
  quakeScenario.hazards = [
    {
      id: 'mock-quake-hazard',
      kind: 'earthquake',
      label: 'District earthquake',
      epicenter: miniPoint(4.5, 2.5),
      magnitude: 6.5,
      depthKm: 10,
      originSimTime: 0,
    },
  ];
  const quake: MockScript = {
    scenario: quakeScenario,
    hazard: {
      id: 'mock-quake-hazard',
      kind: 'earthquake',
      label: 'District earthquake',
      phase: 'active',
      epicenter: miniPoint(4.5, 2.5),
      magnitude: 6.5,
      originSimTime: 0,
    },
    intensity: [
      [0, 1],
      [8, 7.8],
      [20, 6],
      [45, 0],
    ],
    events: [
      signal(
        0,
        'quake-alert',
        'official_alert',
        'Earthquake detected',
        'Exercise seismic alert: magnitude 6.5 near the district.',
      ),
      signal(
        5,
        'quake-sensor',
        'sensor',
        'Strong ground motion',
        'Accelerometers report severe shaking.',
      ),
      inject(10, { kind: 'damage_bridge', bridgeId: MINI.bridges.north, severity: 'closed' }),
      inject(10, {
        kind: 'facility_power_loss',
        facilityId: MINI.facilities.hospitalEast,
        backupFuelMin: 45,
      }),
      action(
        12,
        'quake-divert',
        {
          kind: 'divert_hospital',
          facilityId: MINI.facilities.hospitalEast,
          toFacilityId: MINI.facilities.hospitalWest,
        },
        'Divert east-hospital arrivals to west hospital',
      ),
      signal(
        15,
        'quake-field',
        'field_report',
        'Building collapse confirmed',
        'Rescuers report a partial structural collapse.',
        collapse.position,
      ),
      signal(
        18,
        'quake-image',
        'imagery',
        'Drone view confirms collapse',
        'Exercise drone imagery confirms the field location.',
        collapse.position,
      ),
      { at: 20, type: 'incident', incident: collapse },
      action(
        25,
        'quake-dispatch',
        { kind: 'dispatch_unit', unitId: MINI.units.usar1, incidentId: collapse.id },
        'USAR crew uses the south bridge',
        'auto',
        'mock-dispatch',
      ),
      signal(
        30,
        'quake-call',
        'call_911',
        '911: injuries by north bridge',
        'Multiple patients need assessment near the closed crossing.',
        quakeMedical.position,
      ),
      { at: 32, type: 'incident', incident: quakeMedical },
      action(
        35,
        'quake-ambulance',
        {
          kind: 'assign_ambulance',
          unitId: MINI.units.medic2,
          incidentId: quakeMedical.id,
          hospitalId: MINI.facilities.hospitalWest,
        },
        'Ambulance routes to patients and the functioning hospital',
      ),
      action(
        40,
        'quake-backup',
        { kind: 'dispatch_unit', unitId: MINI.units.engine1, incidentId: collapse.id },
        'Request fire-engine support',
        'approve',
      ),
      action(
        50,
        'quake-close',
        {
          kind: 'publish_road_closure',
          edgeIds: [miniEdgeH(2, 4)],
          reason: 'Bridge inspection required',
        },
        'Publish north-bridge closure',
      ),
      inject(55, { kind: 'grid_fault', sectionId: MINI.sections.hospitalEast }),
      action(
        60,
        'quake-grid',
        { kind: 'isolate_grid_section', sectionId: MINI.sections.hospitalEast },
        'Isolate damaged hospital feeder',
        'auto',
        'mock-utility',
      ),
      action(
        65,
        'quake-shelter',
        { kind: 'activate_shelter', facilityId: MINI.facilities.shelterEast },
        'Open shelter for displaced residents',
      ),
      action(
        70,
        'quake-duplicate',
        { kind: 'dispatch_unit', unitId: MINI.units.rescue1, incidentId: collapse.id },
        'Water-rescue request declined for structural collapse',
        'reject',
      ),
      { at: 170, type: 'resolve', incidentId: collapse.id },
      { at: 175, type: 'resolve', incidentId: quakeMedical.id },
      inject(180, {
        kind: 'set_road_status',
        edgeIds: [miniEdgeH(4, 4)],
        status: 'blocked',
        reason: 'Fallen masonry',
        estCrewHours: 2,
      }),
      ...recovery,
    ],
  };
  const scripts = [flood, quake].map((script) => ({
    ...script,
    events: script.events.sort((a, b) => a.at - b.at),
  }));
  if (region.config.id === 'region-mini') return scripts;
  const ids: Record<string, string> = {};
  const byLongitude = [...region.facilities].sort((a, b) => a.position[0] - b.position[0]);
  const facility = (kind: RegionStatic['facilities'][number]['kind'], east = false) => {
    const list = byLongitude.filter((f) => f.kind === kind);
    return (east ? list.at(-1) : list[0])?.id;
  };
  for (const [mini, real] of [
    [MINI.facilities.hospitalWest, facility('hospital')],
    [MINI.facilities.hospitalEast, facility('hospital', true)],
    [MINI.facilities.shelterWest, facility('shelter')],
    [MINI.facilities.shelterEast, facility('shelter', true)],
  ] as const)
    if (real) ids[mini] = real;
  for (const [mini, kind, index] of [
    [MINI.units.rescue1, 'swift_water', 0],
    [MINI.units.rescue2, 'swift_water', 1],
    [MINI.units.usar1, 'usar', 0],
    [MINI.units.engine1, 'engine', 0],
    [MINI.units.medic1, 'als_ambulance', 0],
    [MINI.units.medic2, 'bls_ambulance', 1],
  ] as const) {
    const units = region.units.filter((u) => u.kind === kind);
    if (units.length) ids[mini] = (units[index] ?? units[0]).id;
  }
  const north = region.bridges.find((b) => b.name === 'Hawthorne Bridge') ?? region.bridges[0];
  if (north) {
    ids[MINI.bridges.north] = north.id;
    ids[miniEdgeH(2, 4)] = north.edgeIds[0];
  }
  for (const [i, mini] of [MINI.sections.creekside, MINI.sections.hospitalEast].entries())
    ids[mini] = region.grid.sections[i]?.id ?? region.grid.sections[0].id;
  const target = miniPoint(4, 2);
  const roads = [...region.edges].sort(
    (a, b) =>
      Math.hypot(a.geometry[0][0] - target[0], a.geometry[0][1] - target[1]) -
      Math.hypot(b.geometry[0][0] - target[0], b.geometry[0][1] - target[1]),
  );
  [miniEdgeV(4, 2), miniEdgeV(5, 2), miniEdgeH(4, 2), miniEdgeH(4, 4)].forEach(
    (id, i) => (ids[id] = roads[i].id),
  );
  return JSON.parse(
    JSON.stringify(scripts, (_key, value) =>
      typeof value === 'string' ? (ids[value] ?? value) : value,
    ),
  ) as MockScript[];
}

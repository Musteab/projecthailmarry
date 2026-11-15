import type { ActionPayload, Incident, LngLat, Scenario } from '@bastion/shared';
import type { MockScript, StoryEvent } from '@bastion/client';
import { closestNode, type LocalRegion } from './regions';

/** These are authored exercises, not flood forecasts or current reports about either place. */
export function localScripts(data: LocalRegion): MockScript[] {
  const { region, aliases: a } = data;
  const center = region.config.defaultCamera.center;
  const point = (dx: number, dy: number): LngLat =>
    closestNode(data, [center[0] + dx, center[1] + dy]).position;
  const rescuePoint = point(0.003, 0.001),
    medicalPoint = point(0.001, -0.002);
  const nearestEdges = [...region.edges]
    .filter((e) => e.class !== 'motorway')
    .sort(
      (x, y) =>
        Math.hypot(x.geometry[0][0] - center[0], x.geometry[0][1] - center[1]) -
        Math.hypot(y.geometry[0][0] - center[0], y.geometry[0][1] - center[1]),
    );
  const responseRoad = nearestEdges[0].id;
  const blocked = data.exerciseRoadClosures ?? [
    nearestEdges[0].id,
    nearestEdges[8].id,
    nearestEdges[16].id,
  ];
  const incident = (
    id: string,
    kind: Incident['kind'],
    title: string,
    position: LngLat,
    sources: string[],
    requiredCapabilities: Incident['requiredCapabilities'],
  ): Incident => ({
    id,
    kind,
    title,
    position,
    cellId: region.cells.reduce((x, y) =>
      Math.hypot(x.center[0] - position[0], x.center[1] - position[1]) <
      Math.hypot(y.center[0] - position[0], y.center[1] - position[1])
        ? x
        : y,
    ).id,
    severity: 4,
    status: 'confirmed',
    confidence: 0.94,
    peopleAffected: kind === 'medical' ? 1 : 12,
    sourceSignalIds: sources,
    requiredCapabilities,
    assignedUnitIds: [],
    openedAt: 20,
    aiSummary:
      'Three scripted reports corroborate this exercise incident. Confidence is an authored scenario value.',
  });
  const signal = (
    at: number,
    id: string,
    source: 'official_alert' | 'sensor' | 'field_report' | 'imagery' | 'call_911' | 'utility_scada',
    title: string,
    body: string,
    position = rescuePoint,
  ): StoryEvent => ({
    at,
    type: 'signal',
    id,
    signal: { source, title, body, position, reliability: 0.95 },
  });
  const action = (
    at: number,
    id: string,
    payload: ActionPayload,
    headline: string,
    disposition: 'auto' | 'approve' | 'reject' = 'auto',
    ruleId?: string,
  ): StoryEvent => ({ at, type: 'action', id, payload, headline, disposition, ruleId });
  return (['flash_flood', 'earthquake'] as const).map((hazard) => {
    const flood = hazard === 'flash_flood',
      key = flood ? 'flood' : 'quake';
    const rescue = incident(
      `${key}-rescue`,
      flood ? 'water_rescue' : 'structure_collapse',
      flood
        ? '12 residents stranded above rising water'
        : 'Partial collapse · 12 people require rescue',
      rescuePoint,
      [`${key}-field`, `${key}-call`, `${key}-image`],
      [flood ? 'swift_water' : 'usar'],
    );
    const medical = incident(
      `${key}-medical`,
      'medical',
      flood ? '999 call · acute chest pain' : '999 call · injured resident',
      medicalPoint,
      [`${key}-medical-call`],
      ['als_ambulance'],
    );
    medical.triage = {
      acuity: 1,
      category: 'Immediate',
      chiefComplaint: flood
        ? 'Chest pain and shortness of breath'
        : 'Injury following structural damage',
      recommendedUnit: 'als_ambulance',
      rationale: 'Authored exercise triage. Clinical assessment remains with the responding team.',
    };
    const beats: [number, string, string][] = [
      [
        0,
        flood ? 'Rainfall warning received' : 'Regional shaking exercise',
        flood
          ? 'Rain gauge and water-level alerts initiate the scenario. All incoming feeds are simulated.'
          : 'A hypothetical earthquake tests coordination; this is not a local earthquake prediction.',
      ],
      [
        20,
        'Corroborate. Locate. Respond.',
        'Field report, emergency call and camera evidence combine into one incident.',
      ],
      [
        40,
        'The response is already moving',
        'Specialist rescue and an ambulance follow the real street graph. A second crew awaits approval.',
      ],
      [
        60,
        'Protect critical services',
        'A simulated SCADA alert triggers the exercise utility rule. The feeder isolates and facilities switch to backup.',
      ],
      [
        180,
        'Response becomes recovery',
        'Debris now obstructs access. Compare road clearance by hospital travel-time improvement.',
      ],
      [
        205,
        'Restore access where it matters',
        'Ranked repairs use actual street connectivity and synthetic population. Create and track a work order.',
      ],
      [
        350,
        'Inspect before reopening',
        'The exercise crew completes its inspection and reopens the first cleared road.',
      ],
    ];
    const path: LngLat[] = [
      [center[0] - 0.009, center[1]],
      center,
      [center[0] + 0.01, center[1] + 0.002],
    ];
    const scenario: Scenario = {
      id: `${region.config.id}-${key}`,
      name: `${region.config.name} · ${flood ? 'Flash flood' : 'Earthquake stress test'}`,
      hazard,
      regionId: region.config.id,
      description:
        'Real OSM streets and footprints; scripted hazards, dispatch, utility network and population. No live agency connections.',
      seed: 20261115,
      durationSimSec: 380,
      defaultSpeed: 5,
      timeline: [],
      hazards: flood
        ? [
            {
              id: `${key}-hazard`,
              kind: hazard,
              label: 'Exercise inundation corridor',
              sourcePaths: [path],
              stageCurve: [
                [0, 0],
                [120, 2.4],
                [200, 0],
              ],
            },
          ]
        : [
            {
              id: `${key}-hazard`,
              kind: hazard,
              label: 'Hypothetical regional shaking',
              epicenter: center,
              magnitude: 6.5,
              depthKm: 10,
              originSimTime: 0,
            },
          ],
      beats: beats.map(([simTime, title, caption], i) => ({
        id: `${key}-beat-${i}`,
        simTime,
        title,
        caption,
        camera: {
          center:
            i === 3
              ? region.facilities.find((f) => f.id === a.substation)!.position
              : i === 2
                ? rescuePoint
                : center,
          zoom: 15.5,
          pitch: 55,
          bearing: -20 + i * 7,
          durationMs: 1800,
        },
      })),
    };
    const events: StoryEvent[] = [
      signal(
        0,
        `${key}-warning`,
        'official_alert',
        flood ? 'Intense rainfall · exercise alert' : 'Seismic alert · exercise',
        'Scripted official alert. No live METMalaysia or satellite connection.',
      ),
      signal(
        5,
        `${key}-sensor`,
        'sensor',
        flood ? 'Water-level threshold crossed' : 'Strong ground motion recorded',
        'Simulated local sensor evidence, timestamped in exercise time.',
      ),
      ...(!flood
        ? [
            {
              at: 10,
              type: 'inject',
              inject: {
                kind: 'facility_power_loss',
                facilityId: a.hospitalEast,
                backupFuelMin: 45,
              },
            } as StoryEvent,
            action(
              12,
              'quake-divert',
              { kind: 'divert_hospital', facilityId: a.hospitalEast, toFacilityId: a.hospitalWest },
              'Divert medical arrivals away from the disrupted field post',
            ),
          ]
        : []),
      signal(
        10,
        `${key}-field`,
        'field_report',
        'Patrol confirms residents need rescue',
        'Twelve residents located. Position corroborated by patrol.',
      ),
      signal(
        14,
        `${key}-call`,
        'call_911',
        '999 call · same location confirmed',
        'Exercise emergency call corroborates the patrol report.',
      ),
      signal(
        18,
        `${key}-image`,
        'imagery',
        flood
          ? 'Traffic camera corroborates rising water'
          : 'Drone view corroborates structural damage',
        'Scripted imagery observation; no live image was analyzed.',
      ),
      { at: 20, type: 'incident', incident: rescue },
      {
        at: 22,
        type: 'inject',
        inject: {
          kind: 'set_road_status',
          edgeIds: [responseRoad],
          status: flood ? 'flooded' : 'damaged',
          reason: flood ? 'Exercise floodwater closure' : 'Exercise structural debris',
        },
      },
      action(
        25,
        `${key}-dispatch`,
        { kind: 'dispatch_unit', unitId: a[flood ? 'rescue1' : 'usar1'], incidentId: rescue.id },
        'Specialist rescue dispatched on open streets',
        'auto',
        'mock-dispatch',
      ),
      signal(
        30,
        `${key}-medical-call`,
        'call_911',
        medical.title,
        'Time-critical medical response required.',
        medicalPoint,
      ),
      { at: 32, type: 'incident', incident: medical },
      action(
        35,
        `${key}-ambulance`,
        {
          kind: 'assign_ambulance',
          unitId: a.medic1,
          incidentId: medical.id,
          hospitalId: a.hospitalWest,
        },
        'Ambulance assigned · receiving facility selected',
      ),
      action(
        40,
        `${key}-backup`,
        { kind: 'dispatch_unit', unitId: a[flood ? 'rescue2' : 'engine1'], incidentId: rescue.id },
        'Second crew requested · commander decision',
        'approve',
      ),
      signal(
        55,
        `${key}-scada`,
        'utility_scada',
        'Threat confirmed at exercise feeder',
        'Simulated equipment alarm corroborates the hazard; the utility rule is pre-authorized.',
      ),
      action(
        60,
        `${key}-isolate`,
        { kind: 'isolate_grid_section', sectionId: region.grid.sections[0].id },
        'Isolate threatened feeder · preserve backup power',
        'auto',
        'mock-utility',
      ),
      action(
        65,
        `${key}-shelter`,
        { kind: 'activate_shelter', facilityId: a.shelterWest },
        'Activate the designated exercise shelter',
      ),
      action(
        70,
        `${key}-closure`,
        {
          kind: 'publish_road_closure',
          edgeIds: [responseRoad],
          reason: 'Confirmed exercise hazard',
        },
        'Publish the confirmed road closure',
      ),
      { at: 150, type: 'resolve', incidentId: rescue.id },
      { at: 160, type: 'resolve', incidentId: medical.id },
      ...[220, 280, 340, 379].map((at): StoryEvent => ({
        at,
        type: 'resolve',
        incidentId: rescue.id,
      })),
      {
        at: 179,
        type: 'inject',
        inject: {
          kind: 'set_road_status',
          edgeIds: [responseRoad],
          status: 'open',
          reason: 'Exercise response corridor cleared',
        },
      },
      {
        at: 180,
        type: 'inject',
        inject: {
          kind: 'set_road_status',
          edgeIds: blocked,
          status: 'blocked',
          reason: 'Debris remaining after impact',
          estCrewHours: 2,
        },
      },
      { at: 205, type: 'recovery' },
      ...(['created', 'assigned', 'in_progress', 'inspection', 'reopened'] as const).map(
        (status, i): StoryEvent => ({ at: 210 + i * 35, type: 'work', status }),
      ),
      action(
        365,
        `${key}-restore`,
        { kind: 'restore_grid_section', sectionId: region.grid.sections[0].id },
        'Inspection complete · request feeder restoration',
        'approve',
      ),
    ];
    events.sort((x, y) => x.at - y.at);
    return {
      scenario,
      hazard: {
        id: `${key}-hazard`,
        kind: hazard,
        label: flood ? 'Exercise inundation corridor' : 'Hypothetical shaking',
        phase: 'forecast',
        ...(flood
          ? { sourcePaths: [path] }
          : { epicenter: center, magnitude: 6.5, originSimTime: 0 }),
      },
      intensity: flood
        ? [
            [0, 0],
            [20, 0.4],
            [60, 1.8],
            [120, 2.4],
            [180, 0.2],
            [200, 0],
          ]
        : [
            [0, 1],
            [8, 7.8],
            [20, 6],
            [45, 0],
          ],
      events,
    };
  });
}

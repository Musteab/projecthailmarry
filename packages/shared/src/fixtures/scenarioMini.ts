import type { Scenario } from '../scenario';
import {
  MINI,
  MINI_CREEK_PATH,
  MINI_REGION_ID,
  miniEdgeH,
  miniEdgeV,
  miniPoint,
} from './miniGeometry';

/**
 * scenario-mini: a five-minute creek flash flood on region-mini.
 *
 * It is a test fixture, not a demo: it deliberately uses every signal source, every hazard
 * phase and every inject kind at least once so engines and mocks can be exercised end to end.
 * The story: the creek floods the east bank, a family is trapped (three signals that should fuse
 * into one water rescue), a cardiac call comes in south of the creek, the creekside feeder is
 * threatened, and debris is left on the creek crossings when the water recedes.
 */
export const SCENARIO_MINI_ID = 'scenario-mini';

const trappedFamily = miniPoint(4.02, 2.22);
const cardiacCall = miniPoint(5, 1.6);

export const scenarioMini: Scenario = {
  id: SCENARIO_MINI_ID,
  name: 'Mini creek flash flood (test fixture)',
  hazard: 'flash_flood',
  regionId: MINI_REGION_ID,
  description:
    'A five-minute creek flood on the synthetic mini district that exercises every event type.',
  seed: 20261115,
  durationSimSec: 300,
  defaultSpeed: 5,
  hazards: [
    {
      id: 'hz-creek-flood',
      kind: 'flash_flood',
      label: 'Mill Creek flash flood',
      sourcePaths: [MINI_CREEK_PATH],
      // metres above the channel bed
      stageCurve: [
        [0, 0],
        [30, 0.4],
        [90, 3.2],
        [150, 3.6],
        [210, 1.5],
        [270, 0.2],
        [300, 0],
      ],
    },
  ],
  timeline: [
    {
      at: 0,
      type: 'signal',
      signal: {
        source: 'official_alert',
        title: 'Flash Flood Warning: Mill Creek',
        body: 'The weather service has issued a Flash Flood Warning for Mill Creek and adjacent low-lying streets until further notice. Rapid rises are expected within the hour.',
        reliability: 0.98,
      },
    },
    { at: 0, type: 'hazard_phase', hazardId: 'hz-creek-flood', phase: 'forecast' },
    { at: 30, type: 'hazard_phase', hazardId: 'hz-creek-flood', phase: 'active' },
    {
      at: 40,
      type: 'signal',
      signal: {
        source: 'sensor',
        title: 'Stream gauge MC-2 above flood stage',
        body: 'Gauge MC-2 at Avenue E reads 2.1 m and is rising 0.4 m per 10 minutes. Flood stage is 1.8 m.',
        position: miniPoint(4, 2.5),
        data: { gaugeId: 'MC-2', stageM: 2.1, floodStageM: 1.8, trendMPer10Min: 0.4 },
        reliability: 0.95,
      },
    },
    {
      at: 70,
      type: 'signal',
      signal: {
        source: 'field_report',
        title: 'Vehicle stranded in rising water',
        body: 'Patrol unit reports a sedan stalled in moving water on Avenue E just south of the creek. Two adults and two children are on the roof. Water is about waist deep and rising.',
        position: trappedFamily,
        reliability: 0.9,
      },
    },
    {
      at: 78,
      type: 'signal',
      signal: {
        source: 'call_911',
        title: '911: family trapped on car roof',
        body: 'Caller: "We are stuck on top of our car on Avenue E near the creek, the water is coming up fast, I have my two kids with me, please hurry." Line is poor; caller is shouting over water noise.',
        position: miniPoint(4, 2.25),
        reliability: 0.8,
      },
    },
    {
      at: 85,
      type: 'signal',
      signal: {
        source: 'imagery',
        title: 'Traffic camera 14: people on vehicle roof',
        body: 'Camera analytics detect a partially submerged passenger vehicle with four people on the roof. Estimated water depth 0.9 m.',
        position: miniPoint(4.03, 2.2),
        data: { cameraId: 'CAM-14', peopleDetected: 4, estWaterDepthM: 0.9 },
        reliability: 0.85,
      },
    },
    {
      at: 100,
      type: 'signal',
      signal: {
        source: 'call_911',
        title: '911: chest pain, 68-year-old male',
        body: 'Caller: "My husband has crushing chest pain and is sweating a lot, he is 68 and had a heart attack two years ago. He is awake but short of breath." Address is on 2nd Street south of the creek.',
        position: cardiacCall,
        reliability: 0.9,
      },
    },
    {
      at: 110,
      type: 'signal',
      signal: {
        source: 'utility_scada',
        title: 'Feeder 1: water at pad-mount equipment',
        body: 'Moisture sensors on feeder 1 section 1 report standing water at two pad-mounted transformers along 4th Street.',
        position: miniPoint(5, 3),
        data: { feederId: 'feeder-1', sectionId: MINI.sections.creekside },
        reliability: 0.92,
      },
    },
    {
      at: 120,
      type: 'signal',
      signal: {
        source: 'social',
        title: 'Social post: "whole street is a river"',
        body: 'Unverified post with a blurry photo claims 4th Street is completely under water and cars are floating. No location metadata.',
        reliability: 0.3,
      },
    },
    {
      at: 130,
      type: 'inject',
      inject: {
        kind: 'spawn_incident',
        incident: {
          kind: 'shelter_need',
          title: 'Residents displaced along 3rd Street',
          position: miniPoint(5.5, 2),
          severity: 3,
          peopleAffected: 120,
        },
      },
    },
    {
      at: 140,
      type: 'inject',
      inject: { kind: 'facility_power_loss', facilityId: MINI.facilities.ems, backupFuelMin: 45 },
    },
    {
      at: 150,
      type: 'inject',
      inject: { kind: 'unit_out_of_service', unitId: MINI.units.engine1 },
    },
    {
      at: 160,
      type: 'inject',
      inject: { kind: 'grid_fault', sectionId: MINI.sections.southeast },
    },
    {
      at: 170,
      type: 'inject',
      inject: { kind: 'damage_bridge', bridgeId: MINI.bridges.north, severity: 'restricted' },
    },
    { at: 200, type: 'hazard_phase', hazardId: 'hz-creek-flood', phase: 'receding' },
    {
      at: 240,
      type: 'inject',
      inject: {
        kind: 'set_road_status',
        // debris left on two of the four creek crossings and on 3rd Street
        edgeIds: [miniEdgeV(4, 2), miniEdgeV(5, 2), miniEdgeH(4, 2)],
        status: 'blocked',
        reason: 'Flood debris and silt on the roadway',
        estCrewHours: 2,
      },
    },
    {
      at: 250,
      type: 'inject',
      inject: { kind: 'facility_offline', facilityId: MINI.facilities.shelterEast },
    },
    { at: 290, type: 'hazard_phase', hazardId: 'hz-creek-flood', phase: 'ended' },
  ],
  beats: [
    {
      id: 'beat-warning',
      simTime: 0,
      title: 'Flash Flood Warning',
      caption: 'A warning is issued for Mill Creek. The platform starts watching the gauges.',
      camera: { center: miniPoint(4.5, 2.5), zoom: 15, pitch: 55, bearing: -20, durationMs: 3000 },
    },
    {
      id: 'beat-rescue',
      simTime: 88,
      title: 'Three signals, one incident',
      caption: 'A field report, a 911 call and a traffic camera describe the same trapped family.',
      camera: { center: trappedFamily, zoom: 16.5, pitch: 60, bearing: 10, durationMs: 2500 },
    },
    {
      id: 'beat-grid',
      simTime: 115,
      title: 'Utility isolates a threatened feeder',
      caption: 'Water reaches equipment on feeder 1. The utility rule isolates the section.',
      camera: { center: miniPoint(5, 3), zoom: 16, pitch: 50, bearing: -40, durationMs: 2500 },
      focus: { sectionId: MINI.sections.creekside },
    },
    {
      id: 'beat-restore',
      simTime: 245,
      title: 'What to reopen first',
      caption: 'The water recedes and leaves debris on the creek crossings.',
      camera: { center: miniPoint(4.5, 2.4), zoom: 15.2, pitch: 45, bearing: 0, durationMs: 3000 },
    },
  ],
};

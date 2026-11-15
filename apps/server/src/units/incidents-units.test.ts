import type {
  IncidentCandidate,
  IntelContext,
  IntelPort,
  Operation,
  Scenario,
  Signal,
  TriageResult,
} from '@bastion/shared';
import { WorldSnapshotSchema } from '@bastion/shared';
import {
  loadRegionMini,
  loadScenarioMini,
  MINI,
  miniEdgeH,
  miniEdgeV,
  miniPoint,
} from '@bastion/shared/fixtures';
import { afterEach, describe, expect, it } from 'vitest';
import { distanceM } from '../geo';
import { applyCandidates } from '../incidents/manager';
import { buildIntelContext, createIntelSystem, INTEL_LATENCY_SEC } from '../intel/bridge';
import { createIntelHost } from '../intel/host';
import { loadIntel } from '../intel/loader';
import { NullIntel } from '../intel/NullIntel';
import { buildRegionIndex } from '../region/index';
import { metricsSystem } from '../sim/metrics';
import type { SystemFactory } from '../sim/runtime';
import { OperationRuntime } from '../sim/runtime';
import { scenarioRunner } from '../sim/scenarioRunner';
import { defaultSystems } from '../sim/systems';
import { cleanupTempDirs, demoUser, makeTestContext } from '../testing';
import { sceneDurationSec } from './units';

const index = buildRegionIndex(loadRegionMini());
const operation: Operation = {
  id: 'op-units',
  regionId: 'region-mini',
  scenarioId: 'scenario-mini',
  mode: 'exercise',
  name: 'Units test',
  status: 'running',
  createdBy: 'user-operator',
  createdAt: '2026-11-15T12:00:00.000Z',
};
const quiet: Scenario = {
  ...loadScenarioMini(),
  id: 'quiet',
  durationSimSec: 100_000,
  hazards: [],
  timeline: [],
  beats: [],
};

const runtime = (scenario: Scenario | null, systems: SystemFactory[]) =>
  new OperationRuntime({ operation, index, scenario, systems });
/** No hazards and no script: just units and metrics, for movement tests. */
const calm = () => runtime(quiet, [(rt) => rt.units.system(), metricsSystem]);

const signal = (overrides: Partial<Signal>): Signal => ({
  id: 'sig-x',
  source: 'field_report',
  simTime: 0,
  title: '',
  body: '',
  reliability: 0.9,
  ...overrides,
});
const family = miniPoint(4, 2.2);
const familySignals: Signal[] = [
  signal({
    id: 's1',
    source: 'field_report',
    position: family,
    title: 'Vehicle stranded in rising water',
    body: 'Two adults and two children are on the roof of a stalled sedan.',
  }),
  signal({
    id: 's2',
    source: 'call_911',
    position: miniPoint(4, 2.25),
    reliability: 0.8,
    title: '911: family trapped on car roof',
    body: 'We are stuck on top of our car, the water is coming up fast, I have my two kids.',
  }),
  signal({
    id: 's3',
    source: 'imagery',
    position: miniPoint(4.03, 2.2),
    reliability: 0.85,
    title: 'Traffic camera: people on vehicle roof',
    body: 'Partially submerged passenger vehicle with people on the roof.',
    data: { peopleDetected: 4 },
  }),
];
const cardiac = signal({
  id: 's4',
  source: 'call_911',
  position: miniPoint(5, 1.6),
  title: '911: chest pain, 68-year-old male',
  body: 'My husband has crushing chest pain and is short of breath.',
});

describe('NullIntel (rule-based fallback)', () => {
  const intel = new NullIntel();
  const ctx = (): IntelContext => buildIntelContext(runtime(quiet, []));

  it('fuses three reports of one event into a single confident candidate', () => {
    const candidates = intel.fuseSync(familySignals, ctx());
    expect(candidates).toHaveLength(1);
    const [candidate] = candidates;
    expect(candidate).toMatchObject({
      kind: 'water_rescue',
      severity: 5,
      peopleAffected: 4,
      requiredCapabilities: ['swift_water'],
    });
    expect(candidate!.sourceSignalIds).toEqual(['s1', 's2', 's3']);
    expect(candidate!.confidence).toBeGreaterThanOrEqual(0.85);
    expect(distanceM(candidate!.position, family)).toBeLessThan(30);
  });

  it('keeps an unrelated medical call separate', () => {
    const kinds = intel.fuseSync([...familySignals, cardiac], ctx()).map((c) => c.kind);
    expect(kinds.sort()).toEqual(['medical', 'water_rescue']);
  });

  it('treats alerts, sensors, SCADA and unlocated chatter as context, not incidents', () => {
    const context = [
      signal({
        source: 'official_alert',
        title: 'Flash Flood Warning',
        body: 'Rising water expected.',
      }),
      signal({
        source: 'sensor',
        position: family,
        title: 'Gauge',
        body: 'Rising water at 2.1 m.',
      }),
      signal({
        source: 'utility_scada',
        position: family,
        title: 'Feeder',
        body: 'Submerged pad.',
      }),
      signal({ source: 'social', title: 'Post', body: 'People stranded, cars submerged!' }),
    ];
    expect(intel.fuseSync(context, ctx())).toEqual([]);
  });

  it('a single weak report gives low confidence', () => {
    const [candidate] = intel.fuseSync(
      [signal({ source: 'social', position: family, reliability: 0.3, body: 'someone stranded' })],
      ctx(),
    );
    expect(candidate!.confidence).toBeLessThan(0.3);
  });

  it.each([
    ['He is not breathing and unconscious', 1, 'als_ambulance'],
    ['Crushing chest pain, short of breath', 2, 'als_ambulance'],
    ['She twisted her ankle, a minor sprain', 4, 'bls_ambulance'],
    ['My neighbour feels unwell and dizzy', 3, 'bls_ambulance'],
  ] as const)('triages "%s" as acuity %i', (body, acuity, unit) => {
    expect(intel.triageSync(signal({ source: 'call_911', body }))).toMatchObject({
      acuity,
      recommendedUnit: unit,
    });
  });

  it('red-flag words cannot be talked down by the rest of the call', () => {
    const body = 'It is probably nothing, just a minor sprain, but he is not breathing right now.';
    expect(intel.triageSync(signal({ source: 'call_911', body })).acuity).toBe(1);
  });
});

describe('signals to incidents through the pipeline', () => {
  it('scenario-mini: three signals become one confirmed rescue; the cardiac call is triaged', () => {
    const rt = runtime(loadScenarioMini(), defaultSystems());

    rt.advance(70 + INTEL_LATENCY_SEC - 1);
    expect(Object.values(rt.world.incidents)).toHaveLength(0); // fusion has not landed yet
    rt.advance(1);
    expect(Object.values(rt.world.incidents)).toHaveLength(1);

    rt.advance(30);
    const incidents = Object.values(rt.world.incidents);
    const rescue = incidents.filter((incident) => incident.kind === 'water_rescue');
    expect(rescue).toHaveLength(1);
    expect(rescue[0]).toMatchObject({ status: 'confirmed', severity: 5, peopleAffected: 4 });
    expect(rescue[0]!.sourceSignalIds).toHaveLength(3);
    expect(rescue[0]!.confidence).toBeGreaterThanOrEqual(0.85);
    expect(rescue[0]!.aiSummary).toMatch(/report/);

    const medical = incidents.find((incident) => incident.kind === 'medical')!;
    expect(medical).toMatchObject({
      status: 'confirmed',
      severity: 4,
      requiredCapabilities: ['als_ambulance'],
    });
    expect(medical.triage).toMatchObject({ acuity: 2, recommendedUnit: 'als_ambulance' });

    const kinds = rt.world.timeline.map((event) => event.kind);
    for (const kind of ['incident.opened', 'incident.updated', 'incident.triaged']) {
      expect(kinds, kind).toContain(kind);
    }
    expect(() => WorldSnapshotSchema.parse(rt.world.toSnapshot())).not.toThrow();
  });

  it('is reproducible end to end', () => {
    const run = () => {
      const rt = runtime(loadScenarioMini(), defaultSystems());
      rt.advance(300);
      return JSON.stringify(rt.world.toSnapshot());
    };
    expect(run()).toBe(run());
  });

  it('holds a weak report as suspected until a second kind of source agrees', () => {
    const rt = runtime(quiet, defaultSystems());
    const report = (source: Signal['source'], reliability: number) =>
      rt.ingestSignal({
        source,
        position: family,
        reliability,
        title: 'Car in water',
        body: 'People stranded on the roof of a car.',
      });

    report('social', 0.4);
    rt.advance(INTEL_LATENCY_SEC + 1);
    const [first] = Object.values(rt.world.incidents);
    expect(first).toMatchObject({ status: 'suspected' });

    report('field_report', 0.4);
    rt.advance(INTEL_LATENCY_SEC + 1);
    const incidents = Object.values(rt.world.incidents);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ status: 'confirmed' });
    expect(rt.world.timeline.some((event) => event.kind === 'incident.confirmed')).toBe(true);
  });

  it('drops candidates outside the region or citing signals that do not exist', () => {
    const rt = runtime(quiet, []);
    const real = rt.ingestSignal({ source: 'field_report', title: 't', body: 'b', reliability: 1 });
    const base: IncidentCandidate = {
      kind: 'fire',
      title: 'Fire',
      position: family,
      severity: 4,
      confidence: 0.9,
      summary: 's',
      sourceSignalIds: [real.id],
      requiredCapabilities: ['engine'],
    };
    applyCandidates(rt, [
      { ...base, position: [0, 0] },
      { ...base, sourceSignalIds: ['invented-by-a-model'] },
    ]);
    expect(rt.world.incidents).toEqual({});
    applyCandidates(rt, [base]);
    expect(Object.values(rt.world.incidents)).toHaveLength(1);
  });
});

describe('asynchronous intel providers', () => {
  const candidate = (signals: Signal[]): IncidentCandidate => ({
    kind: 'fire',
    title: 'Model says: fire',
    position: family,
    severity: 4,
    confidence: 0.9,
    summary: 'from the model',
    sourceSignalIds: signals.map((s) => s.id),
    requiredCapabilities: ['engine'],
  });
  const provider = (fuse: IntelPort['fuse']): IntelPort => ({
    fuse,
    triage: () => Promise.reject(new Error('down')),
    explain: () => Promise.resolve(''),
    narrateRestoration: () => Promise.resolve({}),
  });
  const withIntel = (intel: IntelPort, timeoutMs = 4000) =>
    runtime(quiet, [createIntelSystem(intel, { timeoutMs })]);
  const stranded = {
    source: 'field_report',
    position: family,
    reliability: 0.9,
    title: 'Car in water',
    body: 'People stranded on the roof.',
  } as const;

  it('applies a model result at a fixed delay, however quickly it answered', async () => {
    const rt = withIntel(provider((signals) => Promise.resolve([candidate(signals)])));
    rt.ingestSignal(stranded);
    await rt.advanceSettled(INTEL_LATENCY_SEC); // request made on step 1, due on step 1 + latency
    expect(rt.world.incidents).toEqual({});
    await rt.advanceSettled(1);
    expect(Object.values(rt.world.incidents)[0]).toMatchObject({ title: 'Model says: fire' });
  });

  it('never blocks a step, and falls back when the model hangs', async () => {
    const rt = withIntel(
      provider(() => new Promise(() => undefined)),
      20,
    );
    rt.ingestSignal(stranded);
    const started = performance.now();
    rt.step();
    expect(performance.now() - started).toBeLessThan(15);
    expect(rt.world.incidents).toEqual({});

    await rt.advanceSettled(INTEL_LATENCY_SEC + 1);
    expect(Object.values(rt.world.incidents)[0]).toMatchObject({ kind: 'water_rescue' });
  });

  it('falls back when the model fails, including for triage', async () => {
    const rt = withIntel(provider(() => Promise.reject(new Error('503'))));
    rt.ingestSignal({ ...cardiac, position: cardiac.position! });
    await rt.advanceSettled(INTEL_LATENCY_SEC + 2);
    const [incident] = Object.values(rt.world.incidents);
    expect(incident).toMatchObject({ kind: 'medical' });
    expect(incident!.triage?.acuity).toBe(2);
  });

  it('loads the fallback while @bastion/intel is still a placeholder', async () => {
    const loaded = await loadIntel({});
    expect(loaded.port).toBeDefined();
    if (loaded.source === 'fallback') expect(loaded.note).toMatch(/intel/);
    const triage: TriageResult = await loaded.port.triage(cardiac, buildIntelContext(calm()));
    expect(triage.acuity).toBeLessThanOrEqual(2);
  });
});

describe('unit movement', () => {
  const spawn = (
    rt: OperationRuntime,
    kind: 'water_rescue' | 'medical',
    col: number,
    row: number,
  ) => {
    rt.applyInject({
      kind: 'spawn_incident',
      incident: {
        kind,
        title: `${kind} test`,
        position: miniPoint(col, row),
        severity: 4,
        peopleAffected: 3,
      },
    });
    return Object.values(rt.world.incidents).at(-1)!;
  };
  const unit = (rt: OperationRuntime, id: string) => rt.world.units[id]!;

  it('drives to the scene, works it, resolves the incident and returns home', () => {
    const rt = calm();
    const incident = spawn(rt, 'water_rescue', 5, 2);
    const id = MINI.units.rescue2; // based at Fire Station 2, n-4-4
    const home = unit(rt, id).position;

    const route = rt.units.dispatchToIncident(id, incident.id)!;
    expect(route.edgeIds.length).toBeGreaterThan(0);
    expect(unit(rt, id).status).toBe('dispatched');
    expect(rt.world.incidents[incident.id]).toMatchObject({
      status: 'assigned',
      assignedUnitIds: [id],
    });
    const { departedSimTime, etaSimTime } = unit(rt, id).assignment!;
    expect(departedSimTime).toBe(15); // turnout

    rt.advance(10);
    expect(unit(rt, id).position).toEqual(home); // still turning out

    // En route: never teleports, and gets steadily closer.
    let previous = unit(rt, id).position;
    let remaining = Infinity;
    while (rt.simTime < etaSimTime - 1) {
      rt.step();
      const now = unit(rt, id);
      expect(distanceM(previous, now.position)).toBeLessThan(40);
      if (rt.simTime > departedSimTime) expect(now.status).toBe('en_route');
      previous = now.position;
      remaining = distanceM(now.position, incident.position);
    }
    expect(remaining).toBeLessThan(60);

    rt.advance(1);
    expect(unit(rt, id)).toMatchObject({ status: 'on_scene', position: incident.position });
    expect(rt.simTime).toBe(etaSimTime);
    expect(rt.world.incidents[incident.id]!.status).toBe('in_progress');
    expect(rt.world.metrics).toMatchObject({ unitsDeployed: 1, activeIncidents: 1 });

    rt.advance(sceneDurationSec(incident));
    expect(rt.world.incidents[incident.id]).toMatchObject({ status: 'resolved' });
    expect(unit(rt, id).status).toBe('returning');
    expect(rt.world.metrics).toMatchObject({ peopleRescued: 3, activeIncidents: 0 });

    rt.advance(300);
    expect(unit(rt, id)).toMatchObject({ status: 'available', position: home });
    expect(unit(rt, id).assignment).toBeUndefined();
    expect(rt.world.metrics.unitsDeployed).toBe(0);
  });

  it('an ambulance transports the patient to the chosen hospital, which closes the incident', () => {
    const rt = calm();
    const incident = spawn(rt, 'medical', 5, 1);
    const id = MINI.units.medic1;
    rt.units.dispatchToIncident(id, incident.id, MINI.facilities.hospitalEast);

    const seen = new Set<string>();
    for (let i = 0; i < 900 && unit(rt, id).status !== 'available'; i++) {
      rt.step();
      seen.add(unit(rt, id).status);
      if (unit(rt, id).status === 'transporting') {
        expect(unit(rt, id).assignment).toMatchObject({
          targetType: 'facility',
          targetId: MINI.facilities.hospitalEast,
        });
      }
    }
    expect([...seen]).toEqual(
      expect.arrayContaining([
        'dispatched',
        'en_route',
        'on_scene',
        'transporting',
        'returning',
        'available',
      ]),
    );
    expect(rt.world.incidents[incident.id]!.status).toBe('closed');
    expect(rt.world.timeline.some((event) => event.kind === 'unit.transporting')).toBe(true);
  });

  it('re-routes when a road ahead closes, without jumping', () => {
    const rt = calm();
    const incident = spawn(rt, 'water_rescue', 5, 4); // east bank
    const id = MINI.units.rescue1; // west bank: must cross a bridge
    const first = rt.units.dispatchToIncident(id, incident.id)!;
    const bridge = first.edgeIds.find(
      (edge) => edge === miniEdgeH(2, 4) || edge === miniEdgeH(2, 1),
    )!;
    expect(bridge).toBeDefined();

    rt.advance(25);
    const before = unit(rt, id).position;
    rt.setRoadState(bridge, { status: 'closed', closurePublished: false });
    rt.step();
    const after = unit(rt, id);
    expect(after.assignment!.routeEdgeIds).not.toContain(bridge);
    expect(after.assignment!.route[0]).toEqual(before);
    expect(distanceM(before, after.position)).toBeLessThan(40);

    rt.advance(600);
    expect(rt.world.incidents[incident.id]!.status).toBe('resolved');
  });

  it('gives the assignment up when every route is closed', () => {
    const rt = calm();
    const incident = spawn(rt, 'water_rescue', 5, 4);
    const id = MINI.units.rescue1;
    rt.units.dispatchToIncident(id, incident.id);
    rt.advance(30);
    rt.setRoadState(miniEdgeH(2, 1), { status: 'closed', closurePublished: false });
    rt.setRoadState(miniEdgeH(2, 4), { status: 'closed', closurePublished: false });
    rt.step();

    expect(unit(rt, id)).toMatchObject({ status: 'available' });
    expect(unit(rt, id).assignment).toBeUndefined();
    expect(rt.world.incidents[incident.id]).toMatchObject({
      status: 'confirmed',
      assignedUnitIds: [],
    });
    expect(rt.world.timeline.at(-1)!.kind).toBe('unit.route_failed');
  });

  it('refuses a busy unit and an unreachable incident, leaving the world untouched', () => {
    const rt = calm();
    const near = spawn(rt, 'water_rescue', 1, 2);
    const far = spawn(rt, 'water_rescue', 5, 4);
    const id = MINI.units.rescue1;
    expect(rt.units.dispatchToIncident(id, near.id)).not.toBeNull();
    expect(rt.units.dispatchToIncident(id, far.id)).toBeNull();

    for (let col = 3; col <= 6; col++)
      rt.setRoadState(miniEdgeV(col, 3), { status: 'closed', closurePublished: false });
    for (let col = 3; col <= 5; col++)
      rt.setRoadState(miniEdgeH(col, 4), { status: 'closed', closurePublished: false });
    rt.setRoadState(miniEdgeH(2, 4), { status: 'closed', closurePublished: false });
    rt.setRoadState(miniEdgeV(5, 4), { status: 'closed', closurePublished: false });
    rt.world.drainPatch();
    expect(rt.units.dispatchToIncident(MINI.units.engine1, far.id)).toBeNull();
    expect(rt.world.hasPendingPatch()).toBe(false);
    expect(rt.units.dispatchToIncident('u-ghost', far.id)).toBeNull();
  });

  it('a unit taken out of service mid-route is detached from its incident', () => {
    const rt = calm();
    const incident = spawn(rt, 'water_rescue', 5, 2);
    rt.units.dispatchToIncident(MINI.units.rescue2, incident.id);
    rt.advance(20);
    rt.applyInject({ kind: 'unit_out_of_service', unitId: MINI.units.rescue2 });
    rt.step();
    expect(rt.world.incidents[incident.id]).toMatchObject({
      status: 'confirmed',
      assignedUnitIds: [],
    });
    expect(unit(rt, MINI.units.rescue2).status).toBe('out_of_service');
  });

  it('holds a crew at a work site until it is released', () => {
    const rt = calm();
    const id = MINI.units.works1;
    expect(rt.units.sendToSite(id, 'wo-1', miniPoint(4, 2.5))).not.toBeNull();
    rt.advance(400);
    expect(rt.units.isOnSite(id)).toBe(true);
    expect(unit(rt, id)).toMatchObject({ status: 'on_scene' });
    expect(unit(rt, id).assignment).toMatchObject({ targetType: 'work_order', targetId: 'wo-1' });

    rt.units.release(id);
    expect(unit(rt, id).status).toBe('returning');
    rt.advance(400);
    expect(unit(rt, id).status).toBe('available');
  });
});

describe('metrics', () => {
  it('counts people at risk and closed roads during the flood', () => {
    const rt = runtime(loadScenarioMini(), defaultSystems());
    rt.advance(150);
    const { metrics } = rt.world;
    expect(metrics.peopleAtRisk).toBeGreaterThan(0);
    expect(metrics.peopleAtRisk).toBeLessThan(index.region.config.population);
    expect(metrics.roadsClosed).toBeGreaterThan(3);
    expect(metrics.activeIncidents).toBeGreaterThanOrEqual(2);

    rt.advance(150);
    expect(rt.world.metrics.peopleAtRisk).toBe(0); // the water is gone
    expect(rt.world.metrics.customersOut).toBe(800); // the scripted grid fault
  });

  it('a restricted bridge does not count as a closed road', () => {
    const rt = runtime(quiet, [scenarioRunner, metricsSystem]);
    rt.applyInject({ kind: 'damage_bridge', bridgeId: MINI.bridges.north, severity: 'restricted' });
    rt.step();
    expect(rt.world.metrics.roadsClosed).toBe(0);
    rt.applyInject({ kind: 'damage_bridge', bridgeId: MINI.bridges.south, severity: 'closed' });
    rt.step();
    expect(rt.world.metrics.roadsClosed).toBe(1);
  });
});

describe('IntelHost', () => {
  afterEach(cleanupTempDirs);

  it('gives the intel plugin read access, signal intake and the list of live operations', () => {
    const ctx = makeTestContext();
    const host = createIntelHost({
      operations: ctx.operations,
      regions: ctx.regions,
      auth: ctx.auth,
    });
    const request = { regionId: 'region-mini', scenarioId: 'scenario-mini' } as const;
    const exercise = ctx.operations.create({ ...request, mode: 'exercise' }, demoUser('operator'));
    const live = ctx.operations.create({ ...request, mode: 'live' }, demoUser('operator'));

    expect(host.listLiveOperations().map((op) => op.id)).toEqual([live.id]);
    expect(host.getWorld(exercise.id)?.operation.id).toBe(exercise.id);
    expect(host.getWorld('op-missing')).toBeUndefined();
    expect(host.getRegion('region-mini').config.id).toBe('region-mini');
    expect(() => host.getRegion('atlantis')).toThrow(/not found/);

    const stamped = host.ingestSignal(live.id, {
      source: 'official_alert',
      title: 'Flash Flood Warning',
      body: 'From a live feed.',
      reliability: 0.98,
    });
    expect(stamped.id).toBe('sig-1');
    expect(host.getWorld(live.id)?.signals).toHaveLength(1);
    expect(typeof host.authenticate).toBe('function');
    ctx.close();
  });
});

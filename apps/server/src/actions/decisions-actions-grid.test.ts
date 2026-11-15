import type { Action, Incident, Operation, Rule, Scenario, WorldSnapshot } from '@bastion/shared';
import {
  ApiErrorBodySchema,
  apiPaths,
  AuditEntrySchema,
  WorldSnapshotSchema,
} from '@bastion/shared';
import {
  loadRegionMini,
  loadScenarioMini,
  MINI,
  MINI_CREEK_PATH,
  miniEdgeH,
  miniPoint,
} from '@bastion/shared/fixtures';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import type { AppContext } from '../context';
import { DEFAULT_RULES } from '../db/seed';
import { buildRegionIndex } from '../region/index';
import { OperationRuntime } from '../sim/runtime';
import { defaultSystems } from '../sim/systems';
import { authHeader, cleanupTempDirs, demoUser, makeTestContext } from '../testing';
import { decideAutonomy } from './service';

const index = buildRegionIndex(loadRegionMini());
const RULES: Rule[] = DEFAULT_RULES.map((rule) => ({
  ...rule,
  updatedAt: '2026-11-15T00:00:00.000Z',
}));
const rule = (id: string, patch: Partial<Rule>): Rule[] =>
  RULES.map((r) => (r.id === id ? { ...r, ...patch } : r));
const quiet: Scenario = {
  ...loadScenarioMini(),
  id: 'quiet',
  durationSimSec: 100_000,
  hazards: [],
  timeline: [],
  beats: [],
};
const flood: Scenario = {
  ...quiet,
  id: 'flood',
  hazards: [
    {
      id: 'hz',
      kind: 'flash_flood',
      label: 'Creek flood',
      sourcePaths: [MINI_CREEK_PATH],
      stageCurve: [
        [0, 0],
        [60, 3.6],
        [200, 3.6],
        [320, 0],
      ],
      tuning: { debrisChance: 0 },
    },
  ],
};

function makeRuntime(
  scenario: Scenario = quiet,
  rules: Rule[] = RULES,
  mode: Operation['mode'] = 'exercise',
) {
  const audit: string[] = [];
  const rt = new OperationRuntime({
    operation: {
      id: 'op-actions',
      regionId: 'region-mini',
      scenarioId: scenario.id,
      mode,
      name: 'Actions test',
      status: 'running',
      createdBy: 'user-operator',
      createdAt: '2026-11-15T12:00:00.000Z',
    },
    index,
    scenario,
    systems: defaultSystems(),
    audit: (record) => audit.push(`${record.verb} by ${record.actor}`),
  });
  rt.actions.setRules(rules);
  return { rt, audit };
}

function spawn(
  rt: OperationRuntime,
  incident: Partial<Incident> & Pick<Incident, 'kind' | 'severity'>,
  col: number,
  row: number,
) {
  rt.applyInject({
    kind: 'spawn_incident',
    incident: {
      title: `${incident.kind} at ${col},${row}`,
      position: miniPoint(col, row),
      ...incident,
    },
  });
  return Object.values(rt.world.incidents).at(-1)!;
}
const actionsOf = (rt: OperationRuntime, kind?: Action['kind']) =>
  Object.values(rt.world.actions).filter((action) => !kind || action.kind === kind);
const operator = demoUser('operator');
const utility = demoUser('utility_operator');

describe('rule evaluation', () => {
  const dispatch = RULES.find((r) => r.id === 'rule-fire-dispatch')!;
  const ambulance = RULES.find((r) => r.id === 'rule-ems-ambulance')!;

  it.each([
    [{ severity: 5, confidence: 0.9 }, 'auto'],
    [{ severity: 4, confidence: 0.7 }, 'auto'],
    [{ severity: 3, confidence: 0.9 }, 'approve'],
    [{ severity: 5, confidence: 0.5 }, 'approve'],
    [{}, 'approve'],
  ] as const)('dispatch rule with %j -> %s', (facts, expected) => {
    expect(decideAutonomy(dispatch, facts)).toBe(expected);
  });

  it('ambulance rule automates only the most urgent acuities', () => {
    expect(decideAutonomy(ambulance, { acuity: 2, confidence: 0.8 })).toBe('auto');
    expect(decideAutonomy(ambulance, { acuity: 3, confidence: 0.8 })).toBe('approve');
    expect(decideAutonomy(ambulance, { severity: 5, confidence: 0.8 })).toBe('auto'); // no triage yet
    expect(decideAutonomy(ambulance, { severity: 2, confidence: 0.8 })).toBe('approve');
  });

  it('respects approve and off, and holds anything without a rule', () => {
    expect(
      decideAutonomy({ ...dispatch, autonomy: 'approve' }, { severity: 5, confidence: 1 }),
    ).toBe('approve');
    expect(decideAutonomy({ ...dispatch, autonomy: 'off' }, { severity: 5, confidence: 1 })).toBe(
      'off',
    );
    expect(decideAutonomy(undefined, { severity: 5, confidence: 1 })).toBe('approve');
  });
});

describe('dispatch decisions', () => {
  it('auto-dispatches the fastest capable crew to a severe incident and explains the choice', () => {
    const { rt, audit } = makeRuntime();
    const incident = spawn(rt, { kind: 'water_rescue', severity: 5, peopleAffected: 4 }, 5, 2);
    rt.step();

    const [action] = actionsOf(rt, 'dispatch_unit');
    expect(action).toMatchObject({
      status: 'executed',
      authority: 'fire_rescue',
      initiator: 'platform',
      ruleId: 'rule-fire-dispatch',
      decidedBy: 'auto',
      sandboxed: true,
      payload: { kind: 'dispatch_unit', unitId: MINI.units.rescue2, incidentId: incident.id },
    });
    expect(action!.explain.headline).toMatch(/^Rescue 2 to .*ETA \d+:\d\d$/);
    expect(action!.explain.factors.map((f) => f.label)).toEqual(
      expect.arrayContaining(['ETA', 'Capability', 'Severity', 'People involved']),
    );
    const alternative = action!.explain.alternatives.find((a) => a.label === 'Rescue 1')!;
    expect(alternative.rejectedBecause).toMatch(/later|longer/);

    expect(rt.world.units[MINI.units.rescue2]!.status).toBe('dispatched');
    expect(rt.world.incidents[incident.id]).toMatchObject({ status: 'assigned' });
    expect(audit).toContain('action.executed by auto');
    expect(rt.actions.outbox).toEqual([]); // exercise: nothing leaves the sandbox
  });

  it('writes to the outbox only in a live operation', () => {
    const { rt } = makeRuntime(quiet, RULES, 'live');
    spawn(rt, { kind: 'water_rescue', severity: 5 }, 5, 2);
    rt.step();
    expect(actionsOf(rt)[0]!.sandboxed).toBe(false);
    expect(rt.actions.outbox).toHaveLength(1);
    expect(rt.actions.outbox[0]).toMatchObject({ channel: 'cad' });
  });

  it('holds a low-severity dispatch for approval, then carries it out when approved', () => {
    const { rt, audit } = makeRuntime();
    const incident = spawn(rt, { kind: 'water_rescue', severity: 2 }, 5, 2);
    rt.advance(3);

    const waiting = actionsOf(rt, 'dispatch_unit');
    expect(waiting).toHaveLength(1); // proposed once, not once per step
    expect(waiting[0]).toMatchObject({ status: 'awaiting_approval' });
    expect(rt.world.units[MINI.units.rescue2]!.status).toBe('available');

    const approved = rt.actions.approve(waiting[0]!.id, operator);
    expect(approved).toMatchObject({ status: 'executed', decidedBy: operator.id });
    expect(rt.world.incidents[incident.id]!.assignedUnitIds).toEqual([MINI.units.rescue2]);
    expect(audit).toEqual(expect.arrayContaining(['action.approved by user-operator']));
    expect(() => rt.actions.approve(waiting[0]!.id, operator)).toThrow(/cannot be changed/);
  });

  it('does not immediately re-propose what a person has just rejected', () => {
    const { rt } = makeRuntime();
    spawn(rt, { kind: 'water_rescue', severity: 2 }, 5, 2);
    rt.step();
    const [first] = actionsOf(rt, 'dispatch_unit');
    rt.actions.reject(first!.id, operator, 'Hold this crew for the creek');
    rt.advance(120);
    expect(actionsOf(rt, 'dispatch_unit')).toHaveLength(1);
    expect(rt.world.actions[first!.id]).toMatchObject({
      status: 'rejected',
      rejectReason: 'Hold this crew for the creek',
    });
    rt.advance(300);
    expect(actionsOf(rt, 'dispatch_unit')).toHaveLength(2); // raised again after the cool-down
  });

  it('gives the one free crew to the higher-priority incident and says why the other waits', () => {
    const { rt } = makeRuntime();
    rt.applyInject({ kind: 'unit_out_of_service', unitId: MINI.units.rescue1 });
    const minor = spawn(rt, { kind: 'water_rescue', severity: 4, peopleAffected: 1 }, 5, 3);
    const major = spawn(rt, { kind: 'water_rescue', severity: 5, peopleAffected: 6 }, 5, 1);
    rt.step();

    const dispatched = actionsOf(rt, 'dispatch_unit');
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]!.payload).toMatchObject({
      unitId: MINI.units.rescue2,
      incidentId: major.id,
    });
    expect(rt.world.incidents[minor.id]!.assignedUnitIds).toEqual([]);

    const note = rt.world.timeline.find((event) => event.kind === 'decision.waiting')!;
    expect(note.refs?.incidentId).toBe(minor.id);
    expect(note.detail).toMatch(/Rescue 2 is committed to higher-priority/);
  });

  it('a closed bridge changes which crew is chosen', () => {
    // An incident at the west end of the North Bridge. Rescue 2 is across the river but its
    // route is fast arterial road; Rescue 1 is closer on the map but on slow local streets.
    const chosen = (bridgeClosed: boolean) => {
      const { rt } = makeRuntime();
      if (bridgeClosed) {
        rt.applyInject({ kind: 'damage_bridge', bridgeId: MINI.bridges.north, severity: 'closed' });
      }
      spawn(rt, { kind: 'water_rescue', severity: 5 }, 2, 4);
      rt.step();
      return actionsOf(rt, 'dispatch_unit')[0]!;
    };

    const open = chosen(false);
    expect(open.payload).toMatchObject({ unitId: MINI.units.rescue2 });
    expect(open.explain.alternatives.find((a) => a.label === 'Rescue 1')!.rejectedBecause).toMatch(
      /Closer on the map, but the open route takes/,
    );

    const closed = chosen(true);
    expect(closed.payload).toMatchObject({ unitId: MINI.units.rescue1 });
    expect(
      closed.explain.alternatives.find((a) => a.label === 'Rescue 2')!.rejectedBecause,
    ).toMatch(/later/);
  });

  it('withdraws a waiting proposal and chooses again when the road network changes', () => {
    const { rt } = makeRuntime();
    spawn(rt, { kind: 'water_rescue', severity: 2 }, 2, 4);
    rt.step();
    const [first] = actionsOf(rt, 'dispatch_unit');
    expect(first!.payload).toMatchObject({ unitId: MINI.units.rescue2 });

    rt.applyInject({ kind: 'damage_bridge', bridgeId: MINI.bridges.north, severity: 'closed' });
    rt.step();
    expect(rt.world.actions[first!.id]!.status).toBe('expired');
    const second = actionsOf(rt, 'dispatch_unit').find((a) => a.status === 'awaiting_approval')!;
    expect(second.payload).toMatchObject({ unitId: MINI.units.rescue1 });
  });

  it('says so when the only capable crew has no open route', () => {
    const { rt } = makeRuntime();
    rt.applyInject({ kind: 'unit_out_of_service', unitId: MINI.units.rescue2 });
    for (const bridgeId of [MINI.bridges.north, MINI.bridges.south]) {
      rt.applyInject({ kind: 'damage_bridge', bridgeId, severity: 'closed' });
    }
    spawn(rt, { kind: 'water_rescue', severity: 5 }, 5, 4);
    rt.step();
    expect(actionsOf(rt, 'dispatch_unit')).toHaveLength(0);
    expect(rt.world.timeline.find((event) => event.kind === 'decision.waiting')!.detail).toMatch(
      /busy, out of service or cut off/,
    );
  });

  it('sends an ambulance with a destination, and avoids a hospital that has lost power', () => {
    const triage = {
      acuity: 2,
      category: 'Emergent',
      chiefComplaint: 'Chest pain',
      recommendedUnit: 'als_ambulance',
      rationale: 'r',
    } as const;
    const destination = (prepare: (rt: OperationRuntime) => void) => {
      const { rt } = makeRuntime();
      prepare(rt);
      rt.advance(2); // lets the diversion be decided first
      spawn(
        rt,
        { kind: 'medical', severity: 4, triage, requiredCapabilities: ['als_ambulance'] },
        5,
        1,
      );
      rt.step();
      return { rt, action: actionsOf(rt, 'assign_ambulance')[0]! };
    };

    const normal = destination(() => undefined);
    expect(normal.action).toMatchObject({
      status: 'executed',
      authority: 'ems',
      ruleId: 'rule-ems-ambulance',
      payload: { unitId: MINI.units.medic1, hospitalId: MINI.facilities.hospitalWest },
    });
    expect(normal.action.explain.factors.find((f) => f.label === 'Destination')!.value).toBe(
      'Westbank General Hospital',
    );

    const diverted = destination((rt) =>
      rt.applyInject({ kind: 'facility_power_loss', facilityId: MINI.facilities.hospitalWest }),
    );
    const divert = actionsOf(diverted.rt, 'divert_hospital')[0]!;
    expect(divert).toMatchObject({ status: 'executed', authority: 'ems', decidedBy: 'auto' });
    expect(diverted.rt.world.facilities[MINI.facilities.hospitalWest]!.onDivert).toBe(true);
    expect(diverted.action.payload).toMatchObject({ hospitalId: MINI.facilities.hospitalEast });
  });

  it('never assigns one unit to two incidents, and is reproducible', () => {
    const run = () => {
      const { rt } = makeRuntime();
      const spots: [number, number][] = [
        [5, 2],
        [1, 4],
        [4, 0],
        [0, 1],
        [6, 5],
        [3, 3],
      ];
      spots.forEach(([col, row], i) =>
        spawn(rt, { kind: i % 2 ? 'structure_collapse' : 'water_rescue', severity: 5 }, col, row),
      );
      rt.advance(5);
      return rt;
    };
    const rt = run();
    const dispatched = actionsOf(rt)
      .filter((a) => a.status === 'executed' && 'unitId' in a.payload)
      .map((a) => (a.payload as { unitId: string }).unitId);
    expect(new Set(dispatched).size).toBe(dispatched.length);
    expect(dispatched.length).toBeGreaterThanOrEqual(3);
    for (const incident of Object.values(rt.world.incidents)) {
      expect(incident.assignedUnitIds.length).toBeLessThanOrEqual(1);
    }
    expect(JSON.stringify(run().world.toSnapshot())).toBe(JSON.stringify(rt.world.toSnapshot()));
  });
});

describe('overrides and housekeeping', () => {
  it('overriding an executed dispatch recalls the crew and sends the operator’s choice', () => {
    const { rt, audit } = makeRuntime();
    const incident = spawn(rt, { kind: 'water_rescue', severity: 5 }, 5, 2);
    rt.step();
    const [auto] = actionsOf(rt, 'dispatch_unit');

    const result = rt.actions.override(auto!.id, operator, 'Rescue 2 is needed at the creek', {
      kind: 'dispatch_unit',
      unitId: MINI.units.rescue1,
      incidentId: incident.id,
    });
    expect(result.overridden).toMatchObject({ status: 'overridden', decidedBy: operator.id });
    expect(result.replacement).toMatchObject({
      status: 'executed',
      initiator: 'operator',
      overrideOf: auto!.id,
      payload: { unitId: MINI.units.rescue1 },
    });
    expect(rt.world.incidents[incident.id]!.assignedUnitIds).toEqual([MINI.units.rescue1]);
    expect(rt.world.units[MINI.units.rescue2]!.status).not.toBe('dispatched');
    expect(audit).toEqual(
      expect.arrayContaining([
        'action.overridden by user-operator',
        'action.created by user-operator',
      ]),
    );

    rt.advance(30);
    expect(actionsOf(rt, 'dispatch_unit')).toHaveLength(2); // the platform does not fight back
  });

  it('expires a waiting proposal once it is moot or too old', () => {
    const { rt } = makeRuntime();
    const incident = spawn(rt, { kind: 'water_rescue', severity: 2 }, 5, 2);
    rt.step();
    const [waiting] = actionsOf(rt, 'dispatch_unit');
    rt.world.setIncident({ ...rt.world.incidents[incident.id]!, status: 'resolved' });
    rt.step();
    expect(rt.world.actions[waiting!.id]!.status).toBe('expired');

    const other = makeRuntime();
    spawn(other.rt, { kind: 'fire', severity: 3 }, 1, 1);
    other.rt.step();
    const [old] = actionsOf(other.rt, 'dispatch_unit');
    other.rt.advance(610);
    expect(other.rt.world.actions[old!.id]!.status).toBe('expired');
  });

  it('a rule switched off stops the proposal altogether', () => {
    const { rt } = makeRuntime(quiet, rule('rule-fire-dispatch', { autonomy: 'off' }));
    spawn(rt, { kind: 'water_rescue', severity: 5 }, 5, 2);
    rt.advance(5);
    expect(actionsOf(rt)).toEqual([]);
  });
});

describe('protective actions during a flood', () => {
  it('publishes closures automatically and proposes a shelter for approval', () => {
    const { rt } = makeRuntime(flood);
    rt.advance(120);

    const closures = actionsOf(rt, 'publish_road_closure');
    expect(closures.length).toBeGreaterThan(0);
    expect(closures.every((a) => a.status === 'executed' && a.authority === 'public_works')).toBe(
      true,
    );
    const flooded = Object.values(rt.world.roads).filter((road) => road.status === 'flooded');
    expect(flooded.length).toBeGreaterThan(3);
    expect(flooded.every((road) => road.closurePublished)).toBe(true);

    const shelter = actionsOf(rt, 'activate_shelter');
    expect(shelter).toHaveLength(1);
    expect(shelter[0]).toMatchObject({ status: 'awaiting_approval', authority: 'ema' });
    const facilityId = (shelter[0]!.payload as { facilityId: string }).facilityId;
    expect(rt.world.facilities[facilityId]!.activated).toBe(false);

    rt.actions.approve(shelter[0]!.id, demoUser('admin'));
    rt.advance(30);
    expect(rt.world.facilities[facilityId]).toMatchObject({ activated: true });
    expect(rt.world.facilities[facilityId]!.occupancy).toBeGreaterThan(0);
    expect(rt.world.metrics.sheltersOpen).toBe(1);
    expect(() => WorldSnapshotSchema.parse(rt.world.toSnapshot())).not.toThrow();
  });
});

describe('grid isolation', () => {
  const section = (rt: OperationRuntime, id: string) => rt.world.gridSections[id]!;

  it('flags the creekside section, isolates it under the utility rule, and darkens what it feeds', () => {
    // A slow rise, so the warning phase lasts long enough to observe.
    const slow: Scenario = {
      ...quiet,
      id: 'slow-flood',
      hazards: [
        {
          id: 'hz',
          kind: 'flash_flood',
          label: 'Slow creek flood',
          sourcePaths: [MINI_CREEK_PATH],
          stageCurve: [
            [0, 0],
            [600, 3.6],
            [900, 3.6],
          ],
          tuning: { debrisChance: 0 },
        },
      ],
    };
    const { rt, audit } = makeRuntime(slow);
    let sawThreat = false;
    for (let i = 0; i < 700 && section(rt, MINI.sections.creekside).status === 'energized'; i++) {
      rt.step();
      sawThreat ||= section(rt, MINI.sections.creekside).threatened;
    }
    expect(sawThreat).toBe(true);

    const isolate = actionsOf(rt, 'isolate_grid_section').find(
      (a) => (a.payload as { sectionId: string }).sectionId === MINI.sections.creekside,
    )!;
    expect(isolate).toMatchObject({
      status: 'executed',
      authority: 'utility',
      ruleId: 'rule-utility-isolate',
      decidedBy: 'auto',
    });
    const factors = Object.fromEntries(isolate.explain.factors.map((f) => [f.label, f.value]));
    expect(factors['Customers de-energized']).toBe('2000'); // the section and the one it feeds
    expect(factors['Critical facilities affected']).toMatch(/Eastside Medical Center/);
    expect(audit).toContain('action.executed by auto');

    expect(section(rt, MINI.sections.creekside)).toMatchObject({
      status: 'isolated',
      customersOut: 900,
    });
    expect(section(rt, MINI.sections.hospitalEast)).toMatchObject({
      status: 'isolated',
      customersOut: 1100,
    });

    const hospital = rt.world.facilities[MINI.facilities.hospitalEast]!;
    expect(hospital).toMatchObject({ power: 'backup', status: 'degraded', backupFuelMin: 240 });
    rt.advance(3);
    expect(rt.world.facilities[MINI.facilities.hospitalEast]!.onDivert).toBe(true); // EMS reacts
    expect(rt.world.metrics.customersOut).toBeGreaterThanOrEqual(2000);
  });

  it('burns generator fuel and takes the facility offline when it runs out', () => {
    const { rt } = makeRuntime();
    rt.applyInject({
      kind: 'facility_power_loss',
      facilityId: MINI.facilities.ems,
      backupFuelMin: 3,
    });
    rt.advance(125);
    expect(rt.world.facilities[MINI.facilities.ems]).toMatchObject({
      power: 'backup',
      backupFuelMin: 1,
    });
    rt.advance(60);
    expect(rt.world.facilities[MINI.facilities.ems]).toMatchObject({
      power: 'none',
      status: 'offline',
    });
    expect(
      rt.world.timeline.some((event) => event.title.includes('run out of generator fuel')),
    ).toBe(true);
  });

  it('a fault darkens everything downstream of it', () => {
    const { rt } = makeRuntime();
    rt.applyInject({ kind: 'grid_fault', sectionId: MINI.sections.southeast });
    rt.step();
    expect(section(rt, MINI.sections.southeast).status).toBe('faulted');
    expect(section(rt, MINI.sections.ems)).toMatchObject({
      status: 'isolated',
      customersOut: 1000,
    });
    expect(rt.world.facilities[MINI.facilities.ems]!.power).toBe('backup');
    expect(rt.world.metrics.customersOut).toBe(1800);
    expect(rt.grid.restore(MINI.sections.southeast)).toMatch(/faulted/);
  });

  it('offers to re-energize once the water has stayed away, and a person decides', () => {
    const { rt } = makeRuntime(flood, rule('rule-utility-restore', { params: { clearForMin: 1 } }));
    rt.advance(520); // flood, recession, then a minute clear
    const restore = actionsOf(rt, 'restore_grid_section').find(
      (a) => (a.payload as { sectionId: string }).sectionId === MINI.sections.creekside,
    )!;
    expect(restore).toMatchObject({ status: 'awaiting_approval', authority: 'utility' });

    rt.actions.approve(restore.id, utility);
    rt.step();
    expect(section(rt, MINI.sections.creekside)).toMatchObject({
      status: 'energized',
      customersOut: 0,
    });
    expect(section(rt, MINI.sections.hospitalEast).status).toBe('energized');
    expect(rt.world.facilities[MINI.facilities.hospitalEast]).toMatchObject({
      power: 'grid',
      status: 'normal',
    });
  });

  it('refuses to isolate a section twice', () => {
    const { rt } = makeRuntime();
    expect(rt.grid.isolate(MINI.sections.ems)).toBeNull();
    expect(rt.grid.isolate(MINI.sections.ems)).toMatch(/already isolated/);
    expect(rt.grid.isolate('sec-ghost')).toMatch(/Unknown/);
  });
});

describe('action routes', () => {
  let ctx: AppContext;
  let app: FastifyInstance;
  let operationId: string;

  const as = (role: Parameters<typeof authHeader>[1]) => authHeader(ctx, role);
  const post = async (url: string, payload: object, role: Parameters<typeof authHeader>[1]) =>
    app.inject({ method: 'POST', url, payload, headers: await as(role) });
  const world = (): WorldSnapshot => ctx.operations.snapshot(operationId);
  const actions = (kind: Action['kind']) =>
    Object.values(world().actions).filter((a) => a.kind === kind);
  const code = (body: unknown) => ApiErrorBodySchema.parse(body).error.code;

  beforeEach(async () => {
    ctx = makeTestContext();
    app = await buildApp(ctx);
    operationId = ctx.operations.create(
      { regionId: 'region-mini', scenarioId: 'scenario-mini', mode: 'exercise' },
      operator,
    ).id;
    ctx.operations.control(operationId, { command: 'start' });
    ctx.operations.control(operationId, { command: 'speed', speed: 60 });
  });
  afterEach(async () => {
    await app.close();
    cleanupTempDirs();
  });

  it('scenario-mini end to end: the rescue is dispatched, the feeder isolated, all of it audited', async () => {
    for (let i = 0; i < 3; i++) ctx.operations.tick(1000); // 180 sim seconds
    const snapshot = world();

    const rescue = Object.values(snapshot.incidents).find((i) => i.kind === 'water_rescue')!;
    expect(rescue.assignedUnitIds.length).toBe(1);
    expect(
      actions('dispatch_unit').some((a) => a.status === 'executed' && a.decidedBy === 'auto'),
    ).toBe(true);
    expect(actions('assign_ambulance').some((a) => a.status === 'executed')).toBe(true);
    expect(actions('isolate_grid_section').some((a) => a.status === 'executed')).toBe(true);
    expect(actions('publish_road_closure').length).toBeGreaterThan(0);
    expect(Object.values(snapshot.actions).every((a) => a.sandboxed)).toBe(true);

    const audit = await app.inject({
      method: 'GET',
      url: apiPaths.operationAudit(operationId),
      headers: await as('observer'),
    });
    expect(audit.statusCode).toBe(200);
    const entries = AuditEntrySchema.array().parse(audit.json());
    expect(entries.length).toBeGreaterThanOrEqual(Object.keys(snapshot.actions).length);
    expect(entries.map((e) => e.simTime)).toEqual(
      [...entries.map((e) => e.simTime)].sort((a, b) => a - b),
    );
    expect(entries.some((e) => e.verb === 'action.executed' && e.actor === 'auto')).toBe(true);
  });

  it('only the owning agency may decide: approve, reject and their permission failures', async () => {
    for (let i = 0; i < 3; i++) ctx.operations.tick(1000);
    const shelter = actions('activate_shelter').find((a) => a.status === 'awaiting_approval')!;
    expect(shelter).toBeDefined();

    const denied = await post(apiPaths.actionApprove(shelter.id), {}, 'utility_operator');
    expect(denied.statusCode).toBe(403);
    expect((await post(apiPaths.actionReject(shelter.id), {}, 'operator')).statusCode).toBe(400);

    const approved = await post(apiPaths.actionApprove(shelter.id), {}, 'operator');
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ status: 'executed', decidedBy: 'user-operator' });
    const again = await post(apiPaths.actionApprove(shelter.id), {}, 'operator');
    expect(again.statusCode).toBe(409);
    expect(code(again.json())).toBe('illegal_transition');

    expect((await post(apiPaths.actionApprove('act-missing'), {}, 'operator')).statusCode).toBe(
      404,
    );
    expect(
      (await app.inject({ method: 'POST', url: apiPaths.actionApprove(shelter.id) })).statusCode,
    ).toBe(401);
  });

  it('the EOC operator cannot override the utility; the utility operator can', async () => {
    for (let i = 0; i < 3; i++) ctx.operations.tick(1000);
    const isolate = actions('isolate_grid_section').find(
      (a) =>
        a.status === 'executed' &&
        (a.payload as { sectionId: string }).sectionId === MINI.sections.creekside,
    )!;
    const sectionId = (isolate.payload as { sectionId: string }).sectionId;
    const body = { reason: 'Crew on site confirms equipment is dry' };

    expect((await post(apiPaths.actionOverride(isolate.id), body, 'operator')).statusCode).toBe(
      403,
    );
    expect(world().gridSections[sectionId]!.status).toBe('isolated');

    const overridden = await post(apiPaths.actionOverride(isolate.id), body, 'utility_operator');
    expect(overridden.statusCode).toBe(200);
    expect(overridden.json()).toMatchObject({
      overridden: { status: 'overridden', decidedBy: 'user-utility' },
    });
    expect(world().gridSections[sectionId]!.status).toBe('energized');
  });

  it('an operator can act on their own initiative, within their authority', async () => {
    const recall = { payload: { kind: 'recall_unit', unitId: MINI.units.engine1 } };
    const created = await post(apiPaths.operationActions(operationId), recall, 'operator');
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      status: 'executed',
      initiator: 'operator',
      authority: 'fire_rescue',
    });

    const grid = { payload: { kind: 'isolate_grid_section', sectionId: MINI.sections.ems } };
    expect((await post(apiPaths.operationActions(operationId), grid, 'operator')).statusCode).toBe(
      403,
    );
    expect(
      (await post(apiPaths.operationActions(operationId), grid, 'utility_operator')).statusCode,
    ).toBe(201);
    expect(world().gridSections[MINI.sections.ems]!.status).toBe('isolated');

    const unknown = { payload: { kind: 'recall_unit', unitId: 'u-ghost' } };
    expect(
      (await post(apiPaths.operationActions(operationId), unknown, 'operator')).statusCode,
    ).toBe(400);
    expect(
      (await post(apiPaths.operationActions(operationId), { payload: {} }, 'operator')).statusCode,
    ).toBe(400);
  });

  it('closing a bridge by inject shows up in the choices that follow', async () => {
    await post(
      apiPaths.operationInjects(operationId),
      { kind: 'damage_bridge', bridgeId: MINI.bridges.north, severity: 'closed' },
      'operator',
    );
    await post(
      apiPaths.operationInjects(operationId),
      {
        kind: 'spawn_incident',
        incident: {
          kind: 'water_rescue',
          title: 'Car in water',
          position: miniPoint(2, 4),
          severity: 5,
        },
      },
      'operator',
    );
    ctx.operations.tick(100);
    const dispatch = actions('dispatch_unit')[0]!;
    expect(dispatch.payload).toMatchObject({ unitId: MINI.units.rescue1 });
    expect(world().roads[miniEdgeH(2, 4)]).toMatchObject({
      status: 'closed',
      closurePublished: false,
    });
    // Closures go out in batches, half a sim minute after the first one appears.
    ctx.operations.tick(1000);
    expect(world().roads[miniEdgeH(2, 4)]).toMatchObject({ closurePublished: true });
  });
});

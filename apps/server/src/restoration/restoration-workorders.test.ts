import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Rule, Scenario, WorkOrder } from '@bastion/shared';
import {
  AccessImpactSchema,
  ApiErrorBodySchema,
  apiPaths,
  RestorationAnalysisSchema,
  WorkOrderSchema,
  WorldSnapshotSchema,
} from '@bastion/shared';
import {
  loadRegionMini,
  loadScenarioMini,
  MINI,
  miniEdgeH,
  miniEdgeV,
} from '@bastion/shared/fixtures';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { REPO_ROOT } from '../config';
import type { AppContext } from '../context';
import { DEFAULT_RULES } from '../db/seed';
import { buildRegionIndex } from '../region/index';
import { RegionRegistry } from '../region/pack';
import { OperationRuntime } from '../sim/runtime';
import { defaultSystems } from '../sim/systems';
import { authHeader, cleanupTempDirs, demoUser, makeTestContext } from '../testing';

const index = buildRegionIndex(loadRegionMini());
const RULES: Rule[] = DEFAULT_RULES.map((rule) => ({
  ...rule,
  updatedAt: '2026-11-15T00:00:00.000Z',
}));
const quiet: Scenario = {
  ...loadScenarioMini(),
  id: 'quiet',
  durationSimSec: 100_000,
  hazards: [],
  timeline: [],
  beats: [],
};

function makeRuntime(regionIndex = index) {
  const audit: string[] = [];
  const rt = new OperationRuntime({
    operation: {
      id: 'op-restore',
      regionId: regionIndex.region.config.id,
      scenarioId: null,
      mode: 'exercise',
      name: 'Restoration test',
      status: 'running',
      createdBy: 'user-coordinator',
      createdAt: '2026-11-15T12:00:00.000Z',
    },
    index: regionIndex,
    scenario: regionIndex === index ? quiet : null,
    systems: defaultSystems(),
    audit: (record) => audit.push(record.verb),
  });
  rt.actions.setRules(RULES);
  return { rt, audit };
}

const DEBRIS_E = miniEdgeV(4, 2); // Avenue E over the creek
const DEBRIS_F = miniEdgeV(5, 2); // Avenue F over the creek

/**
 * Cuts the south-east neighbourhood (east bank, south of the creek) off from both hospitals:
 * the South Bridge is closed and all four creek crossings are impassable. Two of the crossings
 * and the bridge are repairable; there is also debris on a street where it harms nobody.
 */
function cutOffSouthEast(rt: OperationRuntime) {
  const block = (edgeId: string, estCrewHours?: number) =>
    rt.applyInject({
      kind: 'set_road_status',
      edgeIds: [edgeId],
      status: 'blocked',
      reason: 'Debris',
      ...(estCrewHours === undefined ? {} : { estCrewHours }),
    });
  rt.applyInject({ kind: 'damage_bridge', bridgeId: MINI.bridges.south, severity: 'closed' }); // 3 h
  block(miniEdgeV(3, 2));
  block(miniEdgeV(6, 2));
  block(DEBRIS_E, 2);
  block(DEBRIS_F, 5);
  block(miniEdgeH(0, 5), 1); // a quiet corner of the west bank
}

/** Population of the cells whose nearest intersection is on the east bank south of the creek. */
function southEastPopulation(): number {
  let total = 0;
  for (const cell of index.region.cells) {
    const [, col, row] = index.nodeIdByCell.get(cell.id)!.split('-').map(Number);
    if (col! >= 3 && row! <= 2) total += cell.population;
  }
  return total;
}
const candidateFor = (rt: OperationRuntime, edgeId: string) =>
  [...rt.repairCandidates.values()].find((candidate) => candidate.edgeIds.includes(edgeId))!;

describe('restoration ranking', () => {
  it('finds nobody cut off on an undamaged network', () => {
    const { rt } = makeRuntime();
    const analysis = rt.restoration.analyze();
    expect(analysis.baseline).toEqual({
      isolatedPop: 0,
      noHospitalAccessPop: 0,
      noShelterAccessPop: 0,
    });
    expect(analysis.options).toEqual([]);
    expect(analysis.recommendedOptionId).toBeNull();
  });

  it('recommends the clearance that gives the most people a hospital back per crew-hour', () => {
    const { rt } = makeRuntime();
    cutOffSouthEast(rt);
    const analysis = RestorationAnalysisSchema.parse(rt.restoration.analyze());
    const cutOff = southEastPopulation();
    expect(cutOff).toBeGreaterThan(1000);

    expect(analysis.baseline.noHospitalAccessPop).toBe(cutOff);
    expect(analysis.baseline.isolatedPop).toBe(0); // their own shelter is still reachable
    expect(analysis.candidates).toHaveLength(4);

    const byCandidate = (edgeId: string) =>
      analysis.options.find((option) => option.candidateIds[0] === candidateFor(rt, edgeId).id)!;
    const avenueE = byCandidate(DEBRIS_E);
    const avenueF = byCandidate(DEBRIS_F);
    const bridge = byCandidate(miniEdgeH(2, 1));
    const corner = byCandidate(miniEdgeH(0, 5));

    // Each of the three reconnects the same people; they differ in effort.
    for (const option of [avenueE, avenueF, bridge]) {
      expect(option.impact.hospitalAccessPop).toBe(cutOff);
    }
    expect(corner.impact.hospitalAccessPop).toBe(0);
    expect([avenueE.rank, bridge.rank, avenueF.rank, corner.rank]).toEqual([1, 2, 3, 4]);
    expect(avenueE.score).toBeCloseTo(cutOff / 2, 0);
    expect(analysis.recommendedOptionId).toBe(avenueE.id);
    expect(avenueE.rationale).toMatch(/back within 15 minutes of a hospital/);
    expect(avenueE.rationale).toContain(cutOff.toLocaleString('en-US'));
    expect(corner.rationale).toMatch(/does not change who can reach/);
  });

  it('answers what-if questions without touching the real network or the world', () => {
    const { rt } = makeRuntime();
    cutOffSouthEast(rt);
    const version = rt.network.version;
    const roads = JSON.stringify(rt.world.roads);
    rt.restoration.analyze();
    expect(rt.network.version).toBe(version);
    expect(JSON.stringify(rt.world.roads)).toBe(roads);
    expect(rt.network.isEdgePassable(DEBRIS_E)).toBe(false);
  });

  it('gives the map a per-cell before and after for an option', () => {
    const { rt } = makeRuntime();
    cutOffSouthEast(rt);
    const analysis = rt.restoration.analyze();
    const impact = AccessImpactSchema.parse(rt.restoration.impact(analysis.recommendedOptionId!));
    expect(impact.cells.length).toBeGreaterThan(10);
    const regained = impact.cells.filter(
      (cell) => cell.beforeMin === null && cell.afterMin !== null,
    );
    const population = regained.reduce(
      (sum, cell) => sum + index.cellById.get(cell.cellId)!.population,
      0,
    );
    expect(population).toBe(southEastPopulation());
    expect(() => rt.restoration.impact('opt-nope')).toThrow(/not found/);
  });

  it('a hospital outage and a second bridge loss change which repair comes first', () => {
    const { rt } = makeRuntime();
    // The coordinator's priorities are rule parameters. Here only hospital access counts.
    rt.actions.setRules(
      RULES.map((rule) =>
        rule.id === 'rule-pw-work-order'
          ? { ...rule, params: { ...rule.params, shelterWeight: 0, isolationWeight: 0 } }
          : rule,
      ),
    );
    cutOffSouthEast(rt);
    const first = rt.restoration.analyze();
    expect(first.options[0]!.candidateIds).toEqual([candidateFor(rt, DEBRIS_E).id]);

    // Now the east hospital is down and the North Bridge has collapsed: the whole east bank
    // depends on the west hospital, and clearing Avenue E alone leads nowhere.
    rt.applyInject({ kind: 'facility_offline', facilityId: MINI.facilities.hospitalEast });
    rt.applyInject({ kind: 'damage_bridge', bridgeId: MINI.bridges.north, severity: 'collapsed' });
    const second = rt.restoration.analyze();

    const avenueE = second.options.find(
      (option) =>
        option.candidateIds.length === 1 &&
        option.candidateIds[0] === candidateFor(rt, DEBRIS_E).id,
    )!;
    expect(avenueE.impact.hospitalAccessPop).toBe(0);
    const top = second.options[0]!;
    expect(top.candidateIds).toContain(candidateFor(rt, miniEdgeH(2, 1)).id); // the South Bridge
    expect(top.id).not.toBe(first.options[0]!.id);
    expect(second.baseline.noHospitalAccessPop).toBeGreaterThan(first.baseline.noHospitalAccessPop);

    // Reopening the bridge and one creek crossing together reaches more people than either alone.
    const pair = second.options.find((option) => option.candidateIds.length === 2);
    expect(pair).toBeDefined();
    expect(pair!.impact.hospitalAccessPop).toBeGreaterThan(
      top.candidateIds.length === 1 ? top.impact.hospitalAccessPop : 0,
    );
  });

  it('runs by itself a few seconds after the network changes and updates the metrics', () => {
    const { rt } = makeRuntime();
    rt.advance(10);
    expect(rt.world.restoration).toBeNull();
    cutOffSouthEast(rt);
    rt.advance(2);
    expect(rt.world.restoration).toBeNull(); // still settling
    rt.advance(5);
    expect(rt.world.restoration?.recommendedOptionId).toBeDefined();
    expect(rt.world.metrics.noHospitalAccessPop).toBe(southEastPopulation());
    expect(() => WorldSnapshotSchema.parse(rt.world.toSnapshot())).not.toThrow();
  });

  it.runIf(existsSync(join(REPO_ROOT, 'data', 'regions', 'portland', 'region.json')))(
    'analyses 30 repairs on the real Portland network inside the time budget',
    () => {
      const registry = new RegionRegistry(join(REPO_ROOT, 'data', 'regions'), false);
      const portland = registry.index('portland')!;
      const { rt } = makeRuntime(portland);
      const edges = portland.region.edges.filter(
        (edge) => edge.class !== 'local' && !edge.bridgeId,
      );
      for (let i = 0; i < 30; i++) {
        const edge = edges[Math.floor((i * edges.length) / 30)]!;
        rt.applyInject({
          kind: 'set_road_status',
          edgeIds: [edge.id],
          status: 'blocked',
          reason: 'Debris',
          estCrewHours: 1 + (i % 4),
        });
      }
      rt.restoration.analyze(); // warm up
      const started = performance.now();
      const analysis = rt.restoration.analyze();
      const elapsed = performance.now() - started;
      expect(analysis.candidates).toHaveLength(30);
      expect(analysis.options.length).toBeGreaterThanOrEqual(30);
      expect(elapsed).toBeLessThan(1500);
    },
  );
});

describe('work orders', () => {
  const coordinator = demoUser('coordinator');
  const orders = (rt: OperationRuntime) => Object.values(rt.world.workOrders);

  function recommended() {
    const made = makeRuntime();
    cutOffSouthEast(made.rt);
    made.rt.advance(6);
    const optionId = made.rt.world.restoration!.recommendedOptionId!;
    made.rt.actions.byOperator({ kind: 'create_work_order', optionId }, coordinator);
    return { ...made, optionId, order: orders(made.rt)[0]! };
  }

  it('runs from work order to reopened road without further input, and re-ranks what is left', () => {
    const { rt, audit, order } = recommended();
    expect(order).toMatchObject({
      status: 'created',
      progress: 0,
      title: expect.stringContaining('Clear debris'),
    });

    const seen: string[] = [order.status];
    for (let i = 0; i < 900 && rt.world.workOrders[order.id]!.status !== 'reopened'; i++) {
      rt.step();
      const status = rt.world.workOrders[order.id]!.status;
      if (seen.at(-1) !== status) seen.push(status);
    }
    expect(seen).toEqual(['created', 'assigned', 'in_progress', 'inspection', 'reopened']);

    const done = rt.world.workOrders[order.id]!;
    expect(done).toMatchObject({ progress: 1, assignedUnitIds: [] });
    expect(done.history.map((entry) => entry.status)).toEqual(seen);
    expect(done.history[0]!.by).toBe(coordinator.id);

    // The road is open again and the crew is on its way home.
    expect(rt.world.roads[DEBRIS_E]).toBeUndefined();
    expect(rt.network.isEdgePassable(DEBRIS_E)).toBe(true);
    expect(rt.world.units[MINI.units.works1]!.status).toMatch(/returning|available/);
    expect(rt.repairCandidates.has(done.candidateId)).toBe(false);

    // A few seconds later the analysis no longer lists anyone without a hospital.
    rt.advance(8);
    expect(rt.world.restoration!.baseline.noHospitalAccessPop).toBe(0);
    expect(rt.world.metrics.noHospitalAccessPop).toBe(0);
    expect(rt.world.restoration!.candidates.map((c) => c.id)).not.toContain(done.candidateId);
    expect(audit).toEqual(
      expect.arrayContaining(['work_order.created', 'work_order.transitioned']),
    );
    expect(rt.world.timeline.some((event) => event.kind === 'work_order.reopened')).toBe(true);
  });

  it('sends the crew to the end of the blocked road it can reach', () => {
    const { rt, order } = recommended();
    rt.advance(3);
    const crew = rt.world.units[MINI.units.works1]!;
    expect(rt.world.workOrders[order.id]).toMatchObject({
      status: 'assigned',
      assignedUnitIds: [crew.id],
    });
    // North end of Avenue E's creek crossing: the south end is the cut-off side.
    expect(crew.assignment).toMatchObject({ targetType: 'work_order', targetId: order.id });
    expect(crew.assignment!.destination).toEqual(
      index.region.nodes.find((n) => n.id === 'n-4-3')!.position,
    );
  });

  it('lets a coordinator inspect, fail the inspection, and send the crew back to work', () => {
    const { rt, order } = recommended();
    while (rt.world.workOrders[order.id]!.status !== 'in_progress') rt.step();

    expect(rt.workOrders.transition(order.id, 'inspection', coordinator).status).toBe('inspection');
    const failed = rt.workOrders.transition(order.id, 'failed_inspection', coordinator);
    expect(failed).toMatchObject({ status: 'failed_inspection', progress: 0.7 });
    expect(rt.world.roads[DEBRIS_E]?.status).toBe('blocked'); // still closed

    expect(rt.workOrders.transition(order.id, 'in_progress', coordinator).status).toBe(
      'in_progress',
    );
    for (let i = 0; i < 300 && rt.world.workOrders[order.id]!.status !== 'reopened'; i++) rt.step();
    expect(rt.world.workOrders[order.id]!.status).toBe('reopened');
    expect(rt.world.workOrders[order.id]!.history.map((h) => h.status)).toEqual(
      expect.arrayContaining(['failed_inspection', 'reopened']),
    );
  });

  it('rejects steps the current status does not allow', () => {
    const { rt, order } = recommended();
    expect(() => rt.workOrders.transition(order.id, 'reopened', coordinator)).toThrow(
      /cannot be moved/,
    );
    expect(() => rt.workOrders.transition('wo-ghost', 'cancelled', coordinator)).toThrow(
      /not found/,
    );
    rt.workOrders.transition(order.id, 'cancelled', coordinator);
    expect(() => rt.workOrders.transition(order.id, 'in_progress', coordinator)).toThrow(
      /cannot be moved/,
    );
  });

  it('cancelling releases the crew and frees the repair for a new order', () => {
    const { rt, order, optionId } = recommended();
    rt.advance(20);
    expect(rt.world.units[MINI.units.works1]!.status).not.toBe('available');
    rt.workOrders.transition(order.id, 'cancelled', coordinator);
    expect(rt.world.units[MINI.units.works1]!.status).toMatch(/returning|available/);

    const again = rt.actions.byOperator({ kind: 'create_work_order', optionId }, coordinator);
    expect(again.status).toBe('executed');
    expect(orders(rt)).toHaveLength(2);
  });

  it('refuses a second order for a repair already under way, and an unknown option', () => {
    const { rt, optionId } = recommended();
    const duplicate = rt.actions.byOperator({ kind: 'create_work_order', optionId }, coordinator);
    expect(duplicate).toMatchObject({ status: 'failed' });
    expect(duplicate.rejectReason).toMatch(/already a work order/);
    const unknown = rt.actions.byOperator(
      { kind: 'create_work_order', optionId: 'opt-x' },
      coordinator,
    );
    expect(unknown.rejectReason).toMatch(/Unknown restoration option/);
    expect(orders(rt)).toHaveLength(1);
  });

  it('waits for a crew when none is free', () => {
    const made = makeRuntime();
    cutOffSouthEast(made.rt);
    made.rt.applyInject({ kind: 'unit_out_of_service', unitId: MINI.units.works1 });
    made.rt.advance(6);
    const optionId = made.rt.world.restoration!.recommendedOptionId!;
    made.rt.actions.byOperator({ kind: 'create_work_order', optionId }, coordinator);
    made.rt.advance(60);
    expect(orders(made.rt)[0]).toMatchObject({ status: 'created', assignedUnitIds: [] });
  });
});

describe('restoration and work order routes', () => {
  let ctx: AppContext;
  let app: FastifyInstance;
  let operationId: string;

  const call = async (
    method: 'GET' | 'POST',
    url: string,
    role: Parameters<typeof authHeader>[1],
    payload?: object,
  ) =>
    app.inject({
      method,
      url,
      headers: await authHeader(ctx, role),
      ...(payload ? { payload } : {}),
    });

  beforeEach(async () => {
    ctx = makeTestContext();
    app = await buildApp(ctx);
    operationId = ctx.operations.create(
      { regionId: 'region-mini', scenarioId: null, mode: 'exercise' },
      demoUser('coordinator'),
    ).id;
    ctx.operations.control(operationId, { command: 'start' });
    cutOffSouthEast(ctx.operations.require(operationId));
  });
  afterEach(async () => {
    await app.close();
    cleanupTempDirs();
  });

  it('analyse, inspect the impact, issue a work order and watch the road reopen', async () => {
    const analysed = await call('POST', apiPaths.restorationAnalyze(operationId), 'coordinator');
    expect(analysed.statusCode).toBe(200);
    const analysis = RestorationAnalysisSchema.parse(analysed.json());
    const optionId = analysis.recommendedOptionId!;

    const impact = await call('GET', apiPaths.restorationImpact(operationId, optionId), 'observer');
    expect(impact.statusCode).toBe(200);
    expect(AccessImpactSchema.parse(impact.json()).optionId).toBe(optionId);
    expect(
      (await call('GET', apiPaths.restorationImpact(operationId, 'opt-nope'), 'observer'))
        .statusCode,
    ).toBe(404);

    const created = await call('POST', apiPaths.workOrders(operationId), 'coordinator', {
      optionId,
    });
    expect(created.statusCode).toBe(201);
    const order: WorkOrder = WorkOrderSchema.parse(created.json());
    expect(order).toMatchObject({ status: 'created', optionId });

    ctx.operations.control(operationId, { command: 'speed', speed: 60 });
    for (let i = 0; i < 10; i++) ctx.operations.tick(1000);
    const world = ctx.operations.snapshot(operationId);
    expect(world.workOrders[order.id]!.status).toBe('reopened');
    expect(world.roads[DEBRIS_E]).toBeUndefined();
    expect(world.restoration!.baseline.noHospitalAccessPop).toBe(0);
    expect(
      Object.values(world.actions).some(
        (a) => a.kind === 'create_work_order' && a.status === 'executed',
      ),
    ).toBe(true);

    const audit = await call('GET', apiPaths.operationAudit(operationId), 'coordinator');
    const verbs = (audit.json() as { verb: string }[]).map((entry) => entry.verb);
    expect(verbs).toEqual(
      expect.arrayContaining(['work_order.created', 'work_order.transitioned']),
    );
  });

  it('accepts a bodiless command sent with a JSON content type, as browsers do', async () => {
    const response = await app.inject({
      method: 'POST',
      url: apiPaths.restorationAnalyze(operationId),
      headers: { ...(await authHeader(ctx, 'coordinator')), 'content-type': 'application/json' },
    });
    expect(response.statusCode).toBe(200);
  });

  it('is reserved for the recovery coordinator and the administrator', async () => {
    const analysis = ctx.operations.require(operationId).restoration.analyze();
    const body = { optionId: analysis.recommendedOptionId! };

    for (const role of ['operator', 'utility_operator', 'observer'] as const) {
      expect(
        (await call('POST', apiPaths.workOrders(operationId), role, body)).statusCode,
        role,
      ).toBe(403);
      expect(
        (await call('POST', apiPaths.restorationAnalyze(operationId), role)).statusCode,
        role,
      ).toBe(403);
    }
    expect((await call('POST', apiPaths.workOrders(operationId), 'admin', body)).statusCode).toBe(
      201,
    );
  });

  it('reports a duplicate order, an unknown option and an illegal step clearly', async () => {
    const analysis = ctx.operations.require(operationId).restoration.analyze();
    const body = { optionId: analysis.recommendedOptionId! };
    const first = await call('POST', apiPaths.workOrders(operationId), 'coordinator', body);
    const order = WorkOrderSchema.parse(first.json());

    const duplicate = await call('POST', apiPaths.workOrders(operationId), 'coordinator', body);
    expect(duplicate.statusCode).toBe(409);
    expect(ApiErrorBodySchema.parse(duplicate.json()).error.message).toMatch(
      /already a work order/,
    );

    const unknown = await call('POST', apiPaths.workOrders(operationId), 'coordinator', {
      optionId: 'opt-x',
    });
    expect(unknown.statusCode).toBe(409);
    expect(
      (await call('POST', apiPaths.workOrders(operationId), 'coordinator', {})).statusCode,
    ).toBe(400);

    const illegal = await call('POST', apiPaths.workOrderTransition(order.id), 'coordinator', {
      to: 'reopened',
    });
    expect(illegal.statusCode).toBe(409);
    const cancelled = await call('POST', apiPaths.workOrderTransition(order.id), 'coordinator', {
      to: 'cancelled',
    });
    expect(cancelled.json()).toMatchObject({ status: 'cancelled' });
    expect(
      (await call('POST', apiPaths.workOrderTransition(order.id), 'operator', { to: 'cancelled' }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await call('POST', apiPaths.workOrderTransition('wo-ghost'), 'coordinator', {
          to: 'cancelled',
        })
      ).statusCode,
    ).toBe(404);
  });
});

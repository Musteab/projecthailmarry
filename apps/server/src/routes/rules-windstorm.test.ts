import type { Operation, Rule, Scenario } from '@bastion/shared';
import {
  ApiErrorBodySchema,
  apiPaths,
  RuleSchema,
  ScenarioSchema,
  WorldSnapshotSchema,
} from '@bastion/shared';
import { loadRegionMini, loadScenarioMini, miniPoint } from '@bastion/shared/fixtures';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import type { AppContext } from '../context';
import { findRule } from '../db/rules';
import { DEFAULT_RULES } from '../db/seed';
import { distanceToPathM } from '../geo';
import { buildRegionIndex } from '../region/index';
import { stormCentre, windAt, WINDSTORM } from '../sim/hazards/windstorm';
import { OperationRuntime } from '../sim/runtime';
import { defaultSystems } from '../sim/systems';
import { authHeader, cleanupTempDirs, demoUser, makeTestContext } from '../testing';
import { validateRuleParams } from './rules';

describe('rules console', () => {
  let ctx: AppContext;
  let app: FastifyInstance;

  const patch = async (id: string, body: object, role: Parameters<typeof authHeader>[1]) =>
    app.inject({
      method: 'PATCH',
      url: apiPaths.rule(id),
      payload: body,
      headers: await authHeader(ctx, role),
    });

  beforeEach(async () => {
    ctx = makeTestContext();
    app = await buildApp(ctx);
  });
  afterEach(async () => {
    await app.close();
    cleanupTempDirs();
  });

  it('lets every signed-in user read the rules', async () => {
    const response = await app.inject({
      method: 'GET',
      url: apiPaths.rules,
      headers: await authHeader(ctx, 'observer'),
    });
    expect(response.statusCode).toBe(200);
    expect(RuleSchema.array().parse(response.json())).toHaveLength(DEFAULT_RULES.length);
    expect((await app.inject({ method: 'GET', url: apiPaths.rules })).statusCode).toBe(401);
  });

  it('an agency edits its own rules, and the change is audited', async () => {
    const response = await patch(
      'rule-utility-isolate',
      { autonomy: 'approve', params: { floodDepthM: 0.8 } },
      'utility_operator',
    );
    expect(response.statusCode).toBe(200);
    const updated = RuleSchema.parse(response.json());
    expect(updated).toMatchObject({
      autonomy: 'approve',
      params: { floodDepthM: 0.8, shakeMMI: 8 },
    });
    expect(findRule(ctx.db, 'rule-utility-isolate')).toEqual(updated);

    const audit = ctx.db
      .prepare("SELECT actor, detail, operation_id FROM audit_log WHERE verb = 'rule.updated'")
      .all();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor: 'user-utility', operation_id: null });
    expect(String(audit[0]!.detail)).toMatch(/autonomy auto -> approve, floodDepthM 0.5 -> 0.8/);
  });

  it('nobody edits another agency’s rules, except the administrator', async () => {
    const body = { autonomy: 'off' };
    expect((await patch('rule-utility-isolate', body, 'operator')).statusCode).toBe(403);
    expect((await patch('rule-fire-dispatch', body, 'utility_operator')).statusCode).toBe(403);
    expect((await patch('rule-fire-dispatch', body, 'operator')).statusCode).toBe(403); // read-only role
    expect((await patch('rule-fire-dispatch', body, 'observer')).statusCode).toBe(403);
    expect(findRule(ctx.db, 'rule-fire-dispatch')!.autonomy).toBe('auto');
    expect((await patch('rule-fire-dispatch', body, 'admin')).statusCode).toBe(200);
  });

  it('rejects unknown rules, empty changes and bad parameters with every problem listed', async () => {
    expect((await patch('rule-nope', { autonomy: 'off' }, 'admin')).statusCode).toBe(404);
    expect((await patch('rule-fire-dispatch', {}, 'admin')).statusCode).toBe(400);
    expect((await patch('rule-fire-dispatch', { autonomy: 'sometimes' }, 'admin')).statusCode).toBe(
      400,
    );

    const response = await patch(
      'rule-fire-dispatch',
      { params: { minSeverity: 9, minConfidence: 'high', launchCode: 1 } },
      'admin',
    );
    expect(response.statusCode).toBe(400);
    const { details } = ApiErrorBodySchema.parse(response.json()).error;
    expect(details).toEqual([
      'minSeverity: must be between 1 and 5',
      'minConfidence: must be a number',
      'launchCode: not a parameter of this rule',
    ]);
    expect(findRule(ctx.db, 'rule-fire-dispatch')!.params).toEqual({
      minSeverity: 4,
      minConfidence: 0.7,
    });
  });

  it('validates parameter patches against the rule', () => {
    const rule: Rule = { ...DEFAULT_RULES[0]!, updatedAt: 'x' };
    expect(validateRuleParams(rule, { minSeverity: 5, minConfidence: 0.9 })).toEqual([]);
    expect(validateRuleParams(rule, { floodDepthM: 0.4 })).toEqual([]); // a known threshold
    expect(validateRuleParams(rule, { minSeverity: 0 })).toHaveLength(1);
  });

  it('takes effect in a running operation on the next step', async () => {
    const { id } = ctx.operations.create(
      { regionId: 'region-mini', scenarioId: null, mode: 'exercise' },
      demoUser('operator'),
    );
    ctx.operations.control(id, { command: 'start' });
    const spawn = (col: number) =>
      ctx.operations.inject(id, {
        kind: 'spawn_incident',
        incident: {
          kind: 'water_rescue',
          title: `Rescue ${col}`,
          position: miniPoint(col, 2),
          severity: 5,
        },
      });
    const dispatches = () =>
      Object.values(ctx.operations.snapshot(id).actions).filter((a) => a.kind === 'dispatch_unit');

    spawn(5);
    ctx.operations.tick(1000);
    expect(dispatches().map((a) => a.status)).toEqual(['executed']);

    expect((await patch('rule-fire-dispatch', { autonomy: 'approve' }, 'admin')).statusCode).toBe(
      200,
    );
    spawn(1);
    ctx.operations.tick(1000);
    expect(
      dispatches()
        .map((a) => a.status)
        .sort(),
    ).toEqual(['awaiting_approval', 'executed']);
  });
});

describe('windstorms', () => {
  const index = buildRegionIndex(loadRegionMini());
  const operation: Operation = {
    id: 'op-wind',
    regionId: 'region-mini',
    scenarioId: 'wind',
    mode: 'exercise',
    name: 'Wind test',
    status: 'running',
    createdBy: 'user-operator',
    createdAt: '2026-11-15T12:00:00.000Z',
  };
  const trackPath = [miniPoint(-1, 2.5), miniPoint(7, 2.5)];

  function storm(
    kind: 'tornado' | 'hurricane',
    radiusM: number,
    peakWindKph: number,
    seed = 3,
  ): Scenario {
    return ScenarioSchema.parse({
      ...loadScenarioMini(),
      id: 'wind',
      hazard: kind,
      seed,
      durationSimSec: 400,
      hazards: [
        {
          id: 'hz',
          kind,
          label: kind === 'tornado' ? 'EF3 tornado' : 'Hurricane landfall',
          track: [
            [20, trackPath[0]],
            [100, trackPath[1]],
          ],
          radiusM,
          peakWindKph,
        },
      ],
      timeline: [],
      beats: [],
    });
  }
  const run = (scenario: Scenario) => {
    const rt = new OperationRuntime({ operation, index, scenario, systems: defaultSystems() });
    rt.actions.setRules(DEFAULT_RULES.map((rule) => ({ ...rule, updatedAt: 'x' })));
    return rt;
  };

  it('interpolates the storm centre and fades the wind toward the edge', () => {
    const track: [number, [number, number]][] = [
      [10, [0, 0]],
      [20, [10, 0]],
    ];
    expect(stormCentre(track, 5)).toBeNull();
    expect(stormCentre(track, 15)).toEqual([5, 0]);
    expect(stormCentre(track, 25)).toBeNull();
    expect(windAt(200, 400, 0)).toBe(200);
    expect(windAt(200, 400, 100)).toBe(200); // inside the core
    expect(windAt(200, 400, 250)).toBeCloseTo(100, 5);
    expect(windAt(200, 400, 400)).toBe(0);
  });

  it('a tornado cuts a narrow swath along its track and leaves it on the map', () => {
    const rt = run(storm('tornado', 220, 260));
    rt.advance(15);
    expect(rt.world.cells).toEqual({});
    expect(rt.world.hazards[0]!.position).toBeUndefined();

    rt.advance(45); // mid-track
    const centre = rt.world.hazards[0]!.position!;
    expect(centre[0]).toBeGreaterThan(trackPath[0]![0]);
    expect(centre[0]).toBeLessThan(trackPath[1]![0]);
    expect(rt.world.metrics.peopleAtRisk).toBeGreaterThan(0);

    rt.advance(100); // long gone
    expect(rt.world.hazards[0]!.position).toBeUndefined();
    const swath = Object.entries(rt.world.cells).filter(([, cell]) => cell.windKph);
    expect(swath.length).toBeGreaterThan(5);
    expect(swath.length).toBeLessThan(index.region.cells.length / 2);
    for (const [id] of swath) {
      expect(distanceToPathM(index.cellById.get(id)!.center, trackPath)).toBeLessThan(220);
    }

    // Debris lies inside the swath, within the cap, and each piece is a repair candidate.
    const blocked = Object.entries(rt.world.roads).filter(([, road]) => road.status === 'blocked');
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked.length).toBeLessThanOrEqual(WINDSTORM.tornado.maxDebris);
    for (const [edgeId, road] of blocked) {
      const edge = index.edgeById.get(edgeId)!;
      expect(
        distanceToPathM(edge.geometry[Math.floor(edge.geometry.length / 2)]!, trackPath),
      ).toBeLessThan(220);
      expect(rt.repairCandidates.has(road.repairCandidateId!)).toBe(true);
    }
    rt.advance(10);
    expect(rt.world.restoration?.candidates.length).toBe(blocked.length);
    expect(() => WorldSnapshotSchema.parse(rt.world.toSnapshot())).not.toThrow();
  });

  it('is reproducible, and different seeds damage different things', () => {
    const outcome = (seed: number) => {
      const rt = run(storm('tornado', 220, 260, seed));
      rt.advance(200);
      return JSON.stringify([rt.world.roads, rt.world.incidents, rt.world.gridSections]);
    };
    expect(outcome(3)).toBe(outcome(3));
    expect(new Set([1, 2, 3, 4].map(outcome)).size).toBeGreaterThan(1);
  });

  it('a hurricane is wide: wind everywhere, the grid suffers, few buildings fall', () => {
    const rt = run(storm('hurricane', 4000, 170));
    rt.advance(200);
    const windy = Object.values(rt.world.cells).filter((cell) => (cell.windKph ?? 0) > 0);
    expect(windy.length).toBe(index.region.cells.length);
    const dark = Object.values(rt.world.gridSections).filter(
      (section) => section.status !== 'energized',
    );
    expect(dark.length).toBeGreaterThan(0);
    const collapses = Object.values(rt.world.incidents).filter(
      (i) => i.kind === 'structure_collapse',
    );
    expect(collapses.length).toBeLessThanOrEqual(WINDSTORM.hurricane.maxCollapses);
    const blocked = Object.values(rt.world.roads).filter((road) => road.status === 'blocked');
    expect(blocked.length).toBeLessThanOrEqual(WINDSTORM.hurricane.maxDebris);
  });
});

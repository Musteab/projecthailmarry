import { apiPaths } from '@bastion/shared';
import { MINI, miniEdgeV } from '@bastion/shared/fixtures';
import { afterEach, expect, it } from 'vitest';
import { buildApp } from '../app';
import { authHeader, cleanupTempDirs, demoUser, makeTestContext } from '../testing';

afterEach(cleanupTempDirs);

it('routes commands to the right exercise and rejects stale command IDs after reset', async () => {
  const ctx = makeTestContext();
  const app = await buildApp(ctx);
  const headers = await authHeader(ctx, 'admin');
  const user = demoUser('admin');
  const post = (url: string, payload: object) =>
    app.inject({ method: 'POST', url, headers, payload });
  const seed = (id?: string) => {
    const op = id
      ? ctx.operations.require(id).operation
      : ctx.operations.create(
          { regionId: 'region-mini', scenarioId: null, mode: 'exercise' },
          user,
        );
    ctx.operations.control(op.id, { command: 'start' });
    const rt = ctx.operations.require(op.id);
    const action = rt.actions.byOperator(
      { kind: 'isolate_grid_section', sectionId: MINI.sections.southeast },
      user,
    );
    rt.applyInject({
      kind: 'set_road_status',
      edgeIds: [miniEdgeV(4, 2)],
      status: 'blocked',
      reason: 'Test debris',
      estCrewHours: 2,
    });
    const analysis = rt.restoration.analyze();
    const optionId = analysis.recommendedOptionId ?? analysis.options[0]!.id;
    rt.actions.byOperator({ kind: 'create_work_order', optionId }, user);
    const order = Object.values(rt.world.workOrders)[0]!;
    return { rt, action, order };
  };
  try {
    const first = seed();
    ctx.operations.control(first.rt.operation.id, { command: 'end' });
    const second = seed();
    expect(second.action.id).not.toBe(first.action.id);
    expect(second.order.id).not.toBe(first.order.id);
    const override = await post(apiPaths.actionOverride(second.action.id), {
      reason: 'Operator review',
    });
    expect(override.statusCode, override.body).toBe(200);
    expect(first.rt.world.actions[first.action.id]!.status).toBe('executed');
    const cancelled = await post(apiPaths.workOrderTransition(second.order.id), {
      to: 'cancelled',
    });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(first.rt.world.workOrders[first.order.id]!.status).not.toBe('cancelled');

    ctx.operations.control(second.rt.operation.id, { command: 'reset' });
    const reset = seed(second.rt.operation.id);
    expect(reset.action.id).not.toBe(second.action.id);
    expect(reset.order.id).not.toBe(second.order.id);
    expect(
      (await post(apiPaths.actionOverride(second.action.id), { reason: 'Stale command' }))
        .statusCode,
    ).toBe(404);
    expect(
      (await post(apiPaths.workOrderTransition(second.order.id), { to: 'cancelled' })).statusCode,
    ).toBe(404);
    expect(reset.rt.world.actions[reset.action.id]!.status).toBe('executed');
  } finally {
    await app.close();
  }
});

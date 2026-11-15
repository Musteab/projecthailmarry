import {
  AccessImpactSchema,
  CreateWorkOrderRequestSchema,
  RestorationAnalysisSchema,
  TransitionWorkOrderRequestSchema,
  WorkOrderSchema,
} from '@bastion/shared';
import type { FastifyInstance } from 'fastify';
import { currentUser } from '../auth/service';
import type { AppContext } from '../context';
import { ApiError } from '../errors';
import { parseInput } from '../http';

type OperationParams = { Params: { operationId: string } };

/** Restoration ranking and work orders. Changing anything needs the `restoration` permission. */
export function registerRestorationRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { operations, auth, respond } = ctx;
  const mayRestore = { preHandler: auth.requireCan('restoration') };
  const base = '/api/operations/:operationId';

  app.post<OperationParams>(`${base}/restoration/analyze`, mayRestore, async (request) =>
    respond(
      RestorationAnalysisSchema,
      operations.act(request.params.operationId, (rt) => rt.restoration.analyze()),
      'restoration analysis',
    ),
  );

  app.get<{ Params: { operationId: string; optionId: string } }>(
    `${base}/restoration/options/:optionId/impact`,
    async (request) =>
      respond(
        AccessImpactSchema,
        operations.require(request.params.operationId).restoration.impact(request.params.optionId),
        'access impact',
      ),
  );

  app.post<OperationParams>(`${base}/work-orders`, mayRestore, async (request, reply) => {
    const { optionId } = parseInput(CreateWorkOrderRequestSchema, request.body);
    const user = currentUser(request);
    const order = operations.act(request.params.operationId, (rt) => {
      // Goes through the action pipeline so it is authorised, executed and audited like any action.
      const action = rt.actions.byOperator({ kind: 'create_work_order', optionId }, user);
      if (action.status !== 'executed') {
        throw new ApiError(
          409,
          'work_order_not_created',
          action.rejectReason ?? 'Could not create it',
        );
      }
      return Object.values(rt.world.workOrders)
        .filter((candidate) => candidate.optionId === optionId)
        .at(-1)!;
    });
    return reply.status(201).send(respond(WorkOrderSchema, order, 'work order'));
  });

  app.post<{ Params: { workOrderId: string } }>(
    '/api/work-orders/:workOrderId/transition',
    mayRestore,
    async (request) => {
      const { to } = parseInput(TransitionWorkOrderRequestSchema, request.body);
      const user = currentUser(request);
      const runtime = operations.findWorkOrder(request.params.workOrderId);
      return respond(
        WorkOrderSchema,
        operations.act(runtime.operation.id, (rt) =>
          rt.workOrders.transition(request.params.workOrderId, to, user),
        ),
        'work order',
      );
    },
  );
}

import {
  ActionSchema,
  AuditEntrySchema,
  CreateActionRequestSchema,
  OverrideActionRequestSchema,
  OverrideActionResponseSchema,
  RejectActionRequestSchema,
} from '@bastion/shared';
import type { FastifyInstance } from 'fastify';
import { authorityOf } from '../actions/service';
import { currentUser } from '../auth/service';
import type { AppContext } from '../context';
import { listAudit } from '../db/audit';
import { parseInput } from '../http';

type OperationParams = { Params: { operationId: string } };
type ActionParams = { Params: { actionId: string } };

/**
 * Human control over the platform's actions. Every route checks that the caller may act for the
 * agency the action belongs to: the utility's actions are the utility's to approve or override.
 */
export function registerActionRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { operations, auth, respond } = ctx;

  // An action an operator takes on their own initiative; it executes at once.
  app.post<OperationParams>('/api/operations/:operationId/actions', async (request, reply) => {
    const { payload } = parseInput(CreateActionRequestSchema, request.body);
    const user = currentUser(request);
    const runtime = operations.require(request.params.operationId);
    auth.assertCan(user, 'approve', authorityOf(runtime, payload));
    const action = operations.act(runtime.operation.id, (rt) =>
      rt.actions.byOperator(payload, user),
    );
    return reply.status(201).send(respond(ActionSchema, action, 'action'));
  });

  app.post<ActionParams>('/api/actions/:actionId/approve', async (request) => {
    const user = currentUser(request);
    const { runtime, action } = operations.findAction(request.params.actionId);
    auth.assertCan(user, 'approve', action.authority);
    return respond(
      ActionSchema,
      operations.act(runtime.operation.id, (rt) => rt.actions.approve(action.id, user)),
      'action',
    );
  });

  app.post<ActionParams>('/api/actions/:actionId/reject', async (request) => {
    const { reason } = parseInput(RejectActionRequestSchema, request.body);
    const user = currentUser(request);
    const { runtime, action } = operations.findAction(request.params.actionId);
    auth.assertCan(user, 'approve', action.authority);
    return respond(
      ActionSchema,
      operations.act(runtime.operation.id, (rt) => rt.actions.reject(action.id, user, reason)),
      'action',
    );
  });

  app.post<ActionParams>('/api/actions/:actionId/override', async (request) => {
    const { reason, replacement } = parseInput(OverrideActionRequestSchema, request.body);
    const user = currentUser(request);
    const { runtime, action } = operations.findAction(request.params.actionId);
    auth.assertCan(user, 'approve', action.authority);
    if (replacement) auth.assertCan(user, 'approve', authorityOf(runtime, replacement));
    return respond(
      OverrideActionResponseSchema,
      operations.act(runtime.operation.id, (rt) =>
        rt.actions.override(action.id, user, reason, replacement),
      ),
      'override result',
    );
  });

  app.get<OperationParams>('/api/operations/:operationId/audit', async (request) => {
    operations.require(request.params.operationId);
    return respond(
      AuditEntrySchema.array(),
      listAudit(ctx.db, request.params.operationId),
      'audit trail',
    );
  });
}

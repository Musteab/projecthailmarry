import {
  apiPaths,
  ControlRequestSchema,
  CreateOperationRequestSchema,
  InjectSchema,
  OkResponseSchema,
  OperationSchema,
  SignalInputSchema,
  SignalSchema,
  WorldSnapshotSchema,
} from '@bastion/shared';
import type { FastifyInstance } from 'fastify';
import { currentUser } from '../auth/service';
import type { AppContext } from '../context';
import { parseInput } from '../http';

type OperationParams = { Params: { operationId: string } };

export function registerOperationRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { operations, auth, respond } = ctx;
  const mayOperate = { preHandler: auth.requireCan('operate') };
  const one = '/api/operations/:operationId'; // apiPaths.operation(id)

  app.post(apiPaths.operations, mayOperate, async (request, reply) => {
    const body = parseInput(CreateOperationRequestSchema, request.body);
    const operation = operations.create(body, currentUser(request));
    return reply.status(201).send(respond(OperationSchema, operation, 'operation'));
  });

  // Additive to the contract: lets a client find the operation that is already running.
  app.get(apiPaths.operations, async () =>
    respond(OperationSchema.array(), operations.list(), 'operation list'),
  );

  app.get<OperationParams>(one, async (request) =>
    respond(WorldSnapshotSchema, operations.snapshot(request.params.operationId), 'snapshot'),
  );

  app.post<OperationParams>(`${one}/control`, mayOperate, async (request) => {
    const body = parseInput(ControlRequestSchema, request.body);
    return respond(
      OperationSchema,
      operations.control(request.params.operationId, body),
      'operation',
    );
  });

  app.post<OperationParams>(`${one}/injects`, mayOperate, async (request) => {
    const inject = parseInput(InjectSchema, request.body);
    operations.inject(request.params.operationId, inject);
    return respond(OkResponseSchema, { ok: true as const }, 'ok');
  });

  app.post<OperationParams>(`${one}/signals`, mayOperate, async (request, reply) => {
    const input = parseInput(SignalInputSchema, request.body);
    const signal = operations.ingestSignal(request.params.operationId, input);
    return reply.status(201).send(respond(SignalSchema, signal, 'signal'));
  });
}

import type { ApiErrorBody } from '@bastion/shared';
import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

/**
 * An error with a stable machine-readable code that maps onto the contract error body
 * `{ error: { code, message, details? } }`. Throw it from anywhere inside a request.
 */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  toBody(): ApiErrorBody {
    return errorBody(this.code, this.message, this.details);
  }
}

export function errorBody(code: string, message: string, details?: unknown): ApiErrorBody {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, 'validation_failed', message, details);
export const unauthorized = (message = 'Authentication required') =>
  new ApiError(401, 'unauthorized', message);
export const forbidden = (message = 'You are not allowed to do that') =>
  new ApiError(403, 'forbidden', message);
export const notFound = (what: string) => new ApiError(404, 'not_found', `${what} not found`);
/** For commands that are valid in general but not in the current state. */
export const conflict = (message: string, details?: unknown) =>
  new ApiError(409, 'illegal_transition', message, details);

const CODE_BY_STATUS: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  429: 'rate_limited',
};

/** Turns a zod failure into the `details` of a validation error. */
export function describeIssues(error: ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

/** Makes every failure, including unknown routes, answer with the contract error body. */
export function installErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    void reply
      .status(404)
      .send(errorBody('not_found', `Route ${request.method} ${request.url} not found`));
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      if (error.statusCode >= 500) request.log.error(error);
      return reply.status(error.statusCode).send(error.toBody());
    }
    if (error instanceof ZodError) {
      return reply
        .status(400)
        .send(errorBody('validation_failed', 'Request validation failed', describeIssues(error)));
    }

    // Errors raised by Fastify itself (malformed JSON, payload too large, ...) carry a 4xx status.
    const candidate = error as { statusCode?: unknown; message?: unknown };
    const status = typeof candidate.statusCode === 'number' ? candidate.statusCode : 500;
    if (status >= 400 && status < 500) {
      const message = typeof candidate.message === 'string' ? candidate.message : 'Bad request';
      return reply.status(status).send(errorBody(CODE_BY_STATUS[status] ?? 'bad_request', message));
    }

    // Anything else is a bug: log it in full, tell the client nothing about the internals.
    request.log.error(error);
    return reply.status(500).send(errorBody('internal_error', 'Internal server error'));
  });
}

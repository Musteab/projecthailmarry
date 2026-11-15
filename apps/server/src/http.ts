import type { z } from 'zod';
import { ApiError, badRequest, describeIssues } from './errors';

/**
 * Validates request input (body, params, query) against a shared schema.
 * Throws a 400 `validation_failed` listing every problem.
 */
export function parseInput<S extends z.ZodType>(
  schema: S,
  input: unknown,
  what = 'body',
): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw badRequest(`Invalid request ${what}`, describeIssues(result.error));
  return result.data;
}

/**
 * Checks an outgoing payload against the contract. A mismatch means the server is about to
 * break the agreement with the client, so it fails loudly instead of sending the payload.
 * Returns the original value untouched (extra fields are kept).
 */
export function checkContract<S extends z.ZodType, T extends z.infer<S>>(
  schema: S,
  payload: T,
  label: string,
): T {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new ApiError(
      500,
      'contract_violation',
      `Server produced a ${label} that does not match the contract`,
      describeIssues(result.error),
    );
  }
  return payload;
}

/** Returns a responder that validates payloads when enabled and is a no-op otherwise. */
export function makeResponder(validate: boolean) {
  return function respond<S extends z.ZodType, T extends z.infer<S>>(
    schema: S,
    payload: T,
    label: string,
  ): T {
    return validate ? checkContract(schema, payload, label) : payload;
  };
}
export type Responder = ReturnType<typeof makeResponder>;

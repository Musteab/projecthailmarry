import { apiPaths, LoginRequestSchema, LoginResponseSchema, UserSchema } from '@bastion/shared';
import type { FastifyInstance } from 'fastify';
import { currentUser } from '../auth/service';
import type { AppContext } from '../context';
import { ApiError } from '../errors';
import { parseInput } from '../http';

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post(apiPaths.login, { config: { public: true } }, async (request, reply) => {
    const { email, password } = parseInput(LoginRequestSchema, request.body);
    try {
      const result = await ctx.auth.login(email, password, request.ip);
      return ctx.respond(LoginResponseSchema, result, 'login response');
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 429) {
        const { retryAfterSec } = error.details as { retryAfterSec: number };
        void reply.header('retry-after', String(retryAfterSec));
      }
      throw error;
    }
  });

  app.get(apiPaths.me, async (request) =>
    ctx.respond(UserSchema, currentUser(request), 'current user'),
  );
}

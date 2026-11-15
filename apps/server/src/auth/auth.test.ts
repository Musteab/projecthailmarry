import type { Authority, Role } from '@bastion/shared';
import {
  ApiErrorBodySchema,
  apiPaths,
  AuthoritySchema,
  can,
  LoginResponseSchema,
  RoleSchema,
  UserSchema,
} from '@bastion/shared';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import type { AppContext } from '../context';
import {
  authHeader,
  cleanupTempDirs,
  demoUser,
  loginAs,
  makeTestContext,
  TEST_PASSWORD,
} from '../testing';
import { AttemptLimiter } from './rateLimit';
import { currentUser } from './service';
import { createTokenService, TOKEN_TTL_SEC } from './tokens';

const errorCode = (body: unknown) => ApiErrorBodySchema.parse(body).error.code;
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe('authentication', () => {
  let ctx: AppContext;
  let app: FastifyInstance;
  let wallClock: number;

  const login = (email: string, password: string) =>
    app.inject({ method: 'POST', url: apiPaths.login, payload: { email, password } });
  const me = (headers: Record<string, string> = {}) =>
    app.inject({ method: 'GET', url: apiPaths.me, headers });

  beforeEach(async () => {
    wallClock = Date.parse('2026-11-15T12:00:00Z');
    ctx = makeTestContext({}, { now: () => wallClock });
    app = await buildApp(ctx);
  });
  afterEach(async () => {
    await app.close();
    cleanupTempDirs();
  });

  describe('login', () => {
    it('returns a token and the public user', async () => {
      const response = await login('operator@bastion.demo', TEST_PASSWORD);
      expect(response.statusCode).toBe(200);
      const { token, user } = LoginResponseSchema.parse(response.json());
      expect(user).toEqual(demoUser('operator'));
      expect(response.body).not.toContain('scrypt');
      expect(response.body).not.toContain('password');

      const claims = await ctx.auth.tokens.verify(token);
      expect(claims).toEqual({ sub: 'user-operator', role: 'operator', authority: 'ema' });
    });

    it('accepts the email in any case', async () => {
      expect((await login('Operator@Bastion.Demo', TEST_PASSWORD)).statusCode).toBe(200);
    });

    it('gives the same 401 for a wrong password and an unknown account', async () => {
      const wrongPassword = await login('operator@bastion.demo', 'not-the-password');
      const unknownUser = await login('nobody@bastion.demo', TEST_PASSWORD);
      expect(wrongPassword.statusCode).toBe(401);
      expect(unknownUser.statusCode).toBe(401);
      expect(wrongPassword.json()).toEqual(unknownUser.json());
      expect(errorCode(wrongPassword.json())).toBe('unauthorized');
    });

    it('validates the request body', async () => {
      const response = await app.inject({ method: 'POST', url: apiPaths.login, payload: {} });
      expect(response.statusCode).toBe(400);
      expect(errorCode(response.json())).toBe('validation_failed');
    });

    it('issues tokens that last one shift', async () => {
      const token = await ctx.auth.tokens.issue(demoUser('admin'), undefined, 1_000_000);
      const payload = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as {
        iat: number;
        exp: number;
      };
      expect(payload.exp - payload.iat).toBe(TOKEN_TTL_SEC);
      expect(TOKEN_TTL_SEC).toBe(8 * 60 * 60);
    });
  });

  describe('token checks', () => {
    it('returns the current user for a valid token', async () => {
      const response = await me(await loginAs(app, 'coordinator'));
      expect(response.statusCode).toBe(200);
      expect(UserSchema.parse(response.json())).toEqual(demoUser('coordinator'));
    });

    it.each([
      ['no header', {}],
      ['a wrong scheme', { authorization: 'Basic b3BlcmF0b3I6cGFzcw==' }],
      ['an empty bearer', { authorization: 'Bearer ' }],
      ['garbage', { authorization: 'Bearer not.a.jwt' }],
    ])('rejects %s with 401', async (_label, headers) => {
      const response = await me(headers as Record<string, string>);
      expect(response.statusCode).toBe(401);
      expect(errorCode(response.json())).toBe('unauthorized');
    });

    it('rejects a tampered token', async () => {
      const token = await ctx.auth.tokens.issue(demoUser('observer'));
      const [header, payload, signature] = token.split('.') as [string, string, string];
      const forged = Buffer.from(
        JSON.stringify({
          ...JSON.parse(Buffer.from(payload, 'base64url').toString()),
          role: 'admin',
        }),
      ).toString('base64url');

      expect((await me(bearer(`${header}.${forged}.${signature}`))).statusCode).toBe(401);
      expect(
        (await me(bearer(`${header}.${payload}.${signature.slice(0, -3)}abc`))).statusCode,
      ).toBe(401);
      expect((await me(bearer(token))).statusCode).toBe(200);
    });

    it('rejects an expired token', async () => {
      const expired = await ctx.auth.tokens.issue(demoUser('operator'), -60);
      const response = await me(bearer(expired));
      expect(response.statusCode).toBe(401);
      expect(ApiErrorBodySchema.parse(response.json()).error.message).toMatch(/expired/i);
    });

    it('rejects a token signed with another secret or with no signature', async () => {
      const other = createTokenService('a-completely-different-secret-0123456789');
      expect((await me(bearer(await other.issue(demoUser('admin'))))).statusCode).toBe(401);

      const unsigned = [
        Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
        Buffer.from(
          JSON.stringify({ sub: 'user-admin', role: 'admin', authority: 'ema', iss: 'bastion' }),
        ).toString('base64url'),
        '',
      ].join('.');
      expect((await me(bearer(unsigned))).statusCode).toBe(401);
    });

    it('rejects a correctly signed token that lacks our claims', async () => {
      const key = new TextEncoder().encode(ctx.config.jwtSecret);
      const now = Math.floor(Date.now() / 1000);
      const noRole = await new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('user-admin')
        .setIssuer('bastion')
        .setExpirationTime(now + 60)
        .sign(key);
      const wrongIssuer = await new SignJWT({ role: 'admin', authority: 'ema' })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('user-admin')
        .setIssuer('someone-else')
        .setExpirationTime(now + 60)
        .sign(key);
      expect((await me(bearer(noRole))).statusCode).toBe(401);
      expect((await me(bearer(wrongIssuer))).statusCode).toBe(401);
    });

    it('rejects a token whose user no longer exists', async () => {
      const headers = await authHeader(ctx, 'observer');
      ctx.db.prepare('DELETE FROM users WHERE id = ?').run('user-observer');
      expect((await me(headers)).statusCode).toBe(401);
    });

    it('authenticateToken serves the WebSocket handshake', async () => {
      const token = await ctx.auth.tokens.issue(demoUser('utility_operator'));
      await expect(ctx.auth.authenticateToken(token)).resolves.toEqual(
        demoUser('utility_operator'),
      );
      await expect(ctx.auth.authenticateToken(undefined)).rejects.toMatchObject({
        statusCode: 401,
      });
      await expect(ctx.auth.authenticateToken('nope')).rejects.toMatchObject({ statusCode: 401 });
    });
  });

  describe('default-deny gate', () => {
    it('protects every /api route that is not marked public', async () => {
      app.get('/api/test/secret', async (request) => ({ id: currentUser(request).id }));
      app.get('/api/test/open', { config: { public: true } }, async () => ({ ok: true }));

      expect((await app.inject({ method: 'GET', url: '/api/test/secret' })).statusCode).toBe(401);
      expect((await app.inject({ method: 'GET', url: '/api/test/open' })).statusCode).toBe(200);
      for (const url of [apiPaths.scenarios, apiPaths.regionStatic('region-mini'), apiPaths.me]) {
        expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(401);
      }

      const authed = await app.inject({
        method: 'GET',
        url: '/api/test/secret',
        headers: await authHeader(ctx, 'operator'),
      });
      expect(authed.json()).toEqual({ id: 'user-operator' });
    });

    it('leaves non-API paths alone and lets them opt in with the authenticate preHandler', async () => {
      app.get('/public/test/feed', async () => ({ ok: true }));
      app.get('/public/test/private', { preHandler: ctx.auth.authenticate }, async (request) => ({
        id: currentUser(request).id,
      }));

      expect((await app.inject({ method: 'GET', url: '/public/test/feed' })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: '/public/test/private' })).statusCode).toBe(
        401,
      );
      const authed = await app.inject({
        method: 'GET',
        url: '/public/test/private',
        headers: await authHeader(ctx, 'admin'),
      });
      expect(authed.json()).toEqual({ id: 'user-admin' });
    });

    it('answers 404, not 401, for an unknown route', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/does-not-exist' });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('authorization', () => {
    beforeEach(() => {
      app.post<{ Params: { authority: Authority } }>(
        '/api/test/approve/:authority',
        {
          preHandler: ctx.auth.requireCan('approve', (request) =>
            AuthoritySchema.parse((request.params as { authority: string }).authority),
          ),
        },
        async () => ({ ok: true }),
      );
      app.post('/api/test/operate', { preHandler: ctx.auth.requireCan('operate') }, async () => ({
        ok: true,
      }));
      app.post(
        '/api/test/restoration',
        { preHandler: ctx.auth.requireCan('restoration') },
        async () => ({ ok: true }),
      );
    });

    it('a utility operator cannot approve an EMS action, and gets 403 not 401', async () => {
      const headers = await authHeader(ctx, 'utility_operator');
      const ems = await app.inject({ method: 'POST', url: '/api/test/approve/ems', headers });
      expect(ems.statusCode).toBe(403);
      expect(errorCode(ems.json())).toBe('forbidden');

      const own = await app.inject({ method: 'POST', url: '/api/test/approve/utility', headers });
      expect(own.statusCode).toBe(200);
    });

    it('matches the shared permission matrix for every role and authority', async () => {
      for (const role of RoleSchema.options) {
        const headers = await authHeader(ctx, role);
        for (const authority of AuthoritySchema.options) {
          const response = await app.inject({
            method: 'POST',
            url: `/api/test/approve/${authority}`,
            headers,
          });
          const expected = can({ role }, 'approve', authority) ? 200 : 403;
          expect(response.statusCode, `${role} approving ${authority}`).toBe(expected);
        }
      }
    });

    it('guards operate and restoration by role', async () => {
      const expected: Record<Role, { operate: number; restoration: number }> = {
        admin: { operate: 200, restoration: 200 },
        operator: { operate: 200, restoration: 403 },
        coordinator: { operate: 200, restoration: 200 },
        utility_operator: { operate: 403, restoration: 403 },
        observer: { operate: 403, restoration: 403 },
      };
      for (const role of RoleSchema.options) {
        const headers = await authHeader(ctx, role);
        for (const verb of ['operate', 'restoration'] as const) {
          const response = await app.inject({ method: 'POST', url: `/api/test/${verb}`, headers });
          expect(response.statusCode, `${role} ${verb}`).toBe(expected[role][verb]);
        }
      }
    });

    it('requires a token before it checks the role', async () => {
      const response = await app.inject({ method: 'POST', url: '/api/test/operate' });
      expect(response.statusCode).toBe(401);
    });

    it('uses the role in the database, not the one frozen into the token', async () => {
      const headers = await authHeader(ctx, 'operator');
      expect(
        (await app.inject({ method: 'POST', url: '/api/test/operate', headers })).statusCode,
      ).toBe(200);

      ctx.db.prepare("UPDATE users SET role = 'observer' WHERE id = 'user-operator'").run();
      expect(
        (await app.inject({ method: 'POST', url: '/api/test/operate', headers })).statusCode,
      ).toBe(403);
    });
  });

  describe('login rate limit', () => {
    const fail = () => login('operator@bastion.demo', 'wrong-password');

    it('blocks further attempts after ten failures, even with the right password', async () => {
      for (let attempt = 0; attempt < 10; attempt++) expect((await fail()).statusCode).toBe(401);

      const blocked = await login('operator@bastion.demo', TEST_PASSWORD);
      expect(blocked.statusCode).toBe(429);
      expect(errorCode(blocked.json())).toBe('rate_limited');
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(300);
    });

    it('does not lock out other accounts', async () => {
      for (let attempt = 0; attempt < 10; attempt++) await fail();
      expect((await login('admin@bastion.demo', TEST_PASSWORD)).statusCode).toBe(200);
    });

    it('lets the account back in once the window has passed', async () => {
      for (let attempt = 0; attempt < 10; attempt++) await fail();
      expect((await fail()).statusCode).toBe(429);

      wallClock += 5 * 60 * 1000 + 1000;
      expect((await login('operator@bastion.demo', TEST_PASSWORD)).statusCode).toBe(200);
    });

    it('forgets earlier failures after a successful sign-in', async () => {
      for (let attempt = 0; attempt < 9; attempt++) await fail();
      expect((await login('operator@bastion.demo', TEST_PASSWORD)).statusCode).toBe(200);
      for (let attempt = 0; attempt < 9; attempt++) expect((await fail()).statusCode).toBe(401);
      expect((await login('operator@bastion.demo', TEST_PASSWORD)).statusCode).toBe(200);
    });
  });
});

describe('AttemptLimiter', () => {
  it('blocks at the limit and reports how long is left', () => {
    let now = 0;
    const limiter = new AttemptLimiter(3, 60_000, () => now);
    limiter.recordFailure('k');
    now = 10_000;
    limiter.recordFailure('k');
    expect(limiter.retryAfterSec('k')).toBe(0);
    now = 20_000;
    limiter.recordFailure('k');
    // Blocked until the first failure (t=0) leaves the 60 s window.
    expect(limiter.retryAfterSec('k')).toBe(40);
    now = 60_001;
    expect(limiter.retryAfterSec('k')).toBe(0);
  });

  it('tracks keys independently and forgets expired ones', () => {
    let now = 0;
    const limiter = new AttemptLimiter(1, 1000, () => now);
    limiter.recordFailure('a');
    limiter.recordFailure('b');
    expect(limiter.retryAfterSec('a')).toBe(1);
    limiter.reset('a');
    expect(limiter.retryAfterSec('a')).toBe(0);
    expect(limiter.size).toBe(1);
    now = 5000;
    limiter.prune();
    expect(limiter.size).toBe(0);
  });
});

import { randomBytes } from 'node:crypto';
import type { Authority, LoginResponse, PermissionVerb, User } from '@bastion/shared';
import { can } from '@bastion/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Database } from '../db/database';
import { findUserByEmail, findUserById, toPublicUser } from '../db/users';
import { ApiError, forbidden, unauthorized } from '../errors';
import { hashPassword, verifyPasswordAsync } from './password';
import { AttemptLimiter } from './rateLimit';
import type { TokenService } from './tokens';
import { createTokenService } from './tokens';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the auth gate on every protected route. */
    user: User | null;
  }
  interface FastifyContextConfig {
    /** Marks a route under /api as reachable without a token. Everything else is denied. */
    public?: boolean;
  }
}

const MAX_FAILED_LOGINS = 10;
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
/** One message for "no such user" and "wrong password", so accounts cannot be enumerated. */
const BAD_CREDENTIALS = 'Invalid email or password';

export interface AuthOptions {
  db: Database;
  jwtSecret: string;
  /** injectable clock for the login limiter (tests) */
  now?: () => number;
}

/** Resolves the authority a request is about, e.g. the authority of the action being approved. */
export type AuthorityResolver = (
  request: FastifyRequest,
) => Authority | undefined | Promise<Authority | undefined>;

export interface AuthService {
  tokens: TokenService;
  /** Verifies credentials and issues a token. Throws 401 or 429. */
  login(email: string, password: string, clientKey: string): Promise<LoginResponse>;
  /** The current user for a token, or 401. Used directly by the WebSocket (`/ws?token=`). */
  authenticateToken(token: string | undefined): Promise<User>;
  /**
   * onRequest hook for the whole app: every route under /api needs a valid token unless its
   * config says `public: true`. New routes are protected by default.
   */
  gate(request: FastifyRequest): Promise<void>;
  /** preHandler that enforces a valid token. Handed to @bastion/intel as IntelHost.authenticate. */
  authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  /** preHandler factory: 403 unless the user may perform `verb` (for the resolved authority). */
  requireCan(
    verb: PermissionVerb,
    resolveAuthority?: AuthorityResolver,
  ): (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  /** Same check for use inside a handler or service. */
  assertCan(user: User, verb: PermissionVerb, authority?: Authority): void;
}

/** The authenticated user of a request. Only call on protected routes. */
export function currentUser(request: FastifyRequest): User {
  if (!request.user) throw unauthorized();
  return request.user;
}

function bearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (!header) return undefined;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}

export function createAuth(options: AuthOptions): AuthService {
  const { db } = options;
  const tokens = createTokenService(options.jwtSecret);
  const limiter = new AttemptLimiter(MAX_FAILED_LOGINS, LOGIN_WINDOW_MS, options.now);
  // Verified against when the email is unknown, so both failure paths cost the same time.
  const decoyHash = hashPassword(randomBytes(24).toString('hex'));

  async function authenticateToken(token: string | undefined): Promise<User> {
    if (!token) throw unauthorized();
    const claims = await tokens.verify(token);
    if (!claims) throw unauthorized('Invalid or expired token');
    // The database, not the token, is the source of truth for role and authority.
    const user = findUserById(db, claims.sub);
    if (!user) throw unauthorized('Invalid or expired token');
    return toPublicUser(user);
  }

  async function authenticate(request: FastifyRequest): Promise<void> {
    if (request.user) return;
    request.user = await authenticateToken(bearerToken(request));
  }

  function assertCan(user: User, verb: PermissionVerb, authority?: Authority): void {
    if (!can(user, verb, authority)) {
      const scope = authority ? ` for ${authority}` : '';
      throw forbidden(`Your role (${user.role}) may not ${verb}${scope}`);
    }
  }

  return {
    tokens,
    authenticateToken,
    authenticate,
    assertCan,

    async login(email, password, clientKey) {
      const key = `${clientKey}|${email.trim().toLowerCase()}`;
      const retryAfterSec = limiter.retryAfterSec(key);
      if (retryAfterSec > 0) {
        throw new ApiError(
          429,
          'rate_limited',
          `Too many failed sign-in attempts. Try again in ${retryAfterSec} seconds.`,
          { retryAfterSec },
        );
      }

      const user = findUserByEmail(db, email);
      const passwordOk = await verifyPasswordAsync(password, user?.passwordHash ?? decoyHash);
      if (!user || !passwordOk) {
        limiter.recordFailure(key);
        if (limiter.size > 10_000) limiter.prune();
        throw unauthorized(BAD_CREDENTIALS);
      }

      limiter.reset(key);
      const visible = toPublicUser(user);
      return { token: await tokens.issue(visible), user: visible };
    },

    async gate(request) {
      if (request.method === 'OPTIONS') return; // CORS preflight carries no credentials
      if (!request.url.startsWith('/api/')) return; // /public/*, /ws and static files
      if (request.is404) return; // unknown routes answer 404 and expose nothing
      if (request.routeOptions.config.public) return;
      await authenticate(request);
    },

    requireCan(verb, resolveAuthority) {
      return async (request) => {
        await authenticate(request);
        const authority = resolveAuthority ? await resolveAuthority(request) : undefined;
        assertCan(currentUser(request), verb, authority);
      };
    },
  };
}

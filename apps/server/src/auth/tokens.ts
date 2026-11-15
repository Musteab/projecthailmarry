import type { Authority, Role, User } from '@bastion/shared';
import { AuthoritySchema, RoleSchema } from '@bastion/shared';
import { jwtVerify, SignJWT } from 'jose';

/** Tokens last one shift. */
export const TOKEN_TTL_SEC = 8 * 60 * 60;
const ISSUER = 'bastion';
const ALGORITHM = 'HS256';

export interface TokenClaims {
  /** user id */
  sub: string;
  role: Role;
  authority: Authority;
}

export interface TokenService {
  /** `ttlSec` and `nowSec` exist for tests; production code passes only the user. */
  issue(user: User, ttlSec?: number, nowSec?: number): Promise<string>;
  /** The claims of a valid, unexpired token signed by this server; otherwise undefined. */
  verify(token: string): Promise<TokenClaims | undefined>;
}

export function createTokenService(secret: string): TokenService {
  const key = new TextEncoder().encode(secret);

  return {
    issue(user, ttlSec = TOKEN_TTL_SEC, nowSec = Math.floor(Date.now() / 1000)) {
      return new SignJWT({ role: user.role, authority: user.authority })
        .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
        .setSubject(user.id)
        .setIssuer(ISSUER)
        .setIssuedAt(nowSec)
        .setExpirationTime(nowSec + ttlSec)
        .sign(key);
    },

    async verify(token) {
      try {
        // Pinning the algorithm rejects `alg: none` and anything not signed with our key.
        const { payload } = await jwtVerify(token, key, {
          algorithms: [ALGORITHM],
          issuer: ISSUER,
          requiredClaims: ['sub', 'exp'],
        });
        const role = RoleSchema.safeParse(payload.role);
        const authority = AuthoritySchema.safeParse(payload.authority);
        if (typeof payload.sub !== 'string' || !role.success || !authority.success) {
          return undefined;
        }
        return { sub: payload.sub, role: role.data, authority: authority.data };
      } catch {
        return undefined;
      }
    },
  };
}

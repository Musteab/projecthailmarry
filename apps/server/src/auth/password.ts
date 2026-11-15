import { randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing with scrypt from node:crypto.
 * Stored format: scrypt$<N>$<r>$<p>$<salt base64>$<hash base64>
 */
const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LENGTH, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64'), hash.toString('base64')].join('$');
}

interface ParsedHash {
  cost: { N: number; r: number; p: number };
  salt: Buffer;
  expected: Buffer;
}

function parseStored(stored: string): ParsedHash | undefined {
  const [scheme, n, r, p, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !n || !r || !p || !saltB64 || !hashB64) return undefined;

  const cost = { N: Number(n), r: Number(r), p: Number(p) };
  if (!Number.isInteger(cost.N) || !Number.isInteger(cost.r) || !Number.isInteger(cost.p)) {
    return undefined;
  }
  return { cost, salt: Buffer.from(saltB64, 'base64'), expected: Buffer.from(hashB64, 'base64') };
}

const matches = (actual: Buffer, expected: Buffer) =>
  actual.length === expected.length && timingSafeEqual(actual, expected);

/** Constant-time comparison. Returns false for a malformed stored hash rather than throwing. */
export function verifyPassword(password: string, stored: string): boolean {
  const parsed = parseStored(stored);
  if (!parsed) return false;
  try {
    const actual = scryptSync(password, parsed.salt, parsed.expected.length, parsed.cost);
    return matches(actual, parsed.expected);
  } catch {
    return false;
  }
}

/**
 * Same check off the main thread. Use this inside request handlers: the synchronous version
 * would stall the simulation tick loop for the duration of the key derivation.
 */
export function verifyPasswordAsync(password: string, stored: string): Promise<boolean> {
  const parsed = parseStored(stored);
  if (!parsed) return Promise.resolve(false);
  return new Promise((resolve) => {
    scrypt(password, parsed.salt, parsed.expected.length, parsed.cost, (error, actual) => {
      resolve(!error && matches(actual, parsed.expected));
    });
  });
}

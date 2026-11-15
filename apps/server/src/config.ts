import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** Repository root, so relative paths mean the same thing whatever the working directory is. */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Development-only defaults. A production start refuses to run with either of them. */
const DEV_JWT_SECRET = 'dev-only-secret-do-not-use-in-production-0000';
const DEV_DEMO_PASSWORD = 'bastion-demo';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // API_PORT, not PORT: dev tools and preview harnesses set PORT for the web dev server.
  API_PORT: z.coerce
    .number({ error: 'must be a port number between 1 and 65535' })
    .int()
    .min(1)
    .max(65535)
    .default(8787),
  API_HOST: z.string().default('127.0.0.1'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  DATABASE_PATH: z.string().default('./.data/bastion.sqlite'),
  DATA_DIR: z.string().default('./data'),
  JWT_SECRET: z.string().min(32, 'must be at least 32 characters').optional(),
  SEED_DEMO_PASSWORD: z.string().min(8, 'must be at least 8 characters').optional(),
  REGION_ID: z.string().default('portland'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SERVE_WEB: z.enum(['true', 'false']).optional(),
  WEB_DIST_DIR: z.string().default('./apps/web/dist'),
});

export interface Config {
  env: 'development' | 'test' | 'production';
  port: number;
  host: string;
  corsOrigins: string[];
  /** absolute path, or ':memory:' */
  databasePath: string;
  /** absolute path of the folder holding regions/ and scenarios/ */
  dataDir: string;
  jwtSecret: string;
  seedDemoPassword: string;
  /** region the server should prefer; falls back to the test region when its pack is missing */
  regionId: string;
  logLevel: string;
  /** validate outgoing payloads against the shared schemas (on outside production) */
  validateResponses: boolean;
  /** expose region-mini and scenario-mini (on outside production) */
  includeFixtures: boolean;
  /** serve the built web app from this process (on in production; SERVE_WEB overrides) */
  serveWeb: boolean;
  /** absolute path of the built web app */
  webDistDir: string;
}

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid configuration:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

const fromRoot = (path: string) => (isAbsolute(path) ? path : resolve(REPO_ROOT, path));

/** Reads and validates configuration. Throws a ConfigError listing every problem at once. */
export function loadConfig(source: Record<string, string | undefined> = process.env): Config {
  // A variable set to the empty string (`JWT_SECRET=` in .env) means "not set".
  const present = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''));
  const parsed = EnvSchema.safeParse(present);

  const problems = parsed.success
    ? []
    : parsed.error.issues.map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`);
  if (!parsed.success) throw new ConfigError(problems);

  const env = parsed.data;
  if (env.NODE_ENV === 'production') {
    if (!env.JWT_SECRET) problems.push('JWT_SECRET: required in production');
    if (!env.SEED_DEMO_PASSWORD) problems.push('SEED_DEMO_PASSWORD: required in production');
    if (env.JWT_SECRET === DEV_JWT_SECRET) problems.push('JWT_SECRET: must not be the dev default');
  }
  if (problems.length > 0) throw new ConfigError(problems);

  const production = env.NODE_ENV === 'production';
  return {
    env: env.NODE_ENV,
    port: env.API_PORT,
    host: env.API_HOST,
    corsOrigins: env.CORS_ORIGIN.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    databasePath: env.DATABASE_PATH === ':memory:' ? ':memory:' : fromRoot(env.DATABASE_PATH),
    dataDir: fromRoot(env.DATA_DIR),
    jwtSecret: env.JWT_SECRET ?? DEV_JWT_SECRET,
    seedDemoPassword: env.SEED_DEMO_PASSWORD ?? DEV_DEMO_PASSWORD,
    regionId: env.REGION_ID,
    logLevel: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
    validateResponses: !production,
    includeFixtures: !production,
    serveWeb: env.SERVE_WEB === undefined ? production : env.SERVE_WEB === 'true',
    webDistDir: fromRoot(env.WEB_DIST_DIR),
  };
}

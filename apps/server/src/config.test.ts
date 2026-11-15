import { isAbsolute } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config';

const problemsOf = (env: Record<string, string>): string[] => {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  return [];
};

describe('loadConfig', () => {
  it('works with an empty environment in development', () => {
    const config = loadConfig({});
    expect(config.env).toBe('development');
    expect(config.port).toBe(8787);
    expect(config.host).toBe('127.0.0.1');
    expect(config.corsOrigins).toEqual(['http://localhost:5173']);
    expect(config.validateResponses).toBe(true);
    expect(config.includeFixtures).toBe(true);
    expect(config.jwtSecret.length).toBeGreaterThanOrEqual(32);
  });

  it('resolves relative paths against the repository root and keeps :memory:', () => {
    const config = loadConfig({ DATABASE_PATH: './.data/x.sqlite', DATA_DIR: './data' });
    expect(isAbsolute(config.databasePath)).toBe(true);
    expect(config.databasePath.replaceAll('\\', '/')).toMatch(/\/\.data\/x\.sqlite$/);
    expect(isAbsolute(config.dataDir)).toBe(true);
    expect(loadConfig({ DATABASE_PATH: ':memory:' }).databasePath).toBe(':memory:');
  });

  it('ignores PORT, which dev tools set for the web app', () => {
    expect(loadConfig({ PORT: '5173' }).port).toBe(8787);
    expect(loadConfig({ PORT: '5173', API_PORT: '9000' }).port).toBe(9000);
  });

  it('treats an empty value as unset', () => {
    expect(loadConfig({ API_PORT: '', JWT_SECRET: '', CORS_ORIGIN: '' }).port).toBe(8787);
  });

  it('splits several CORS origins', () => {
    expect(loadConfig({ CORS_ORIGIN: 'http://a.test, http://b.test' }).corsOrigins).toEqual([
      'http://a.test',
      'http://b.test',
    ]);
  });

  it('reports every invalid value at once, naming the variable', () => {
    const problems = problemsOf({ API_PORT: 'eighty', JWT_SECRET: 'short', NODE_ENV: 'staging' });
    expect(problems).toHaveLength(3);
    expect(problems.join('\n')).toMatch(/API_PORT/);
    expect(problems.join('\n')).toMatch(/JWT_SECRET: must be at least 32 characters/);
    expect(problems.join('\n')).toMatch(/NODE_ENV/);
  });

  it('produces a readable message', () => {
    expect(() => loadConfig({ API_PORT: '0' })).toThrow(/Invalid configuration:\n {2}- API_PORT/);
  });

  it('refuses to start in production without real secrets', () => {
    const problems = problemsOf({ NODE_ENV: 'production' });
    expect(problems).toEqual([
      'JWT_SECRET: required in production',
      'SEED_DEMO_PASSWORD: required in production',
    ]);
  });

  it('turns fixtures and response validation off in production', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      JWT_SECRET: 'a-production-secret-that-is-long-enough-0123',
      SEED_DEMO_PASSWORD: 'a-demo-password',
    });
    expect(config.includeFixtures).toBe(false);
    expect(config.validateResponses).toBe(false);
  });

  it('silences logging under test', () => {
    expect(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'debug' }).logLevel).toBe('silent');
  });
});

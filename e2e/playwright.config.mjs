import { URL } from 'node:url';
import { defineConfig } from './deps.mjs';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
const root = fileURLToPath(new URL('..', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'bastion-e2e-'));
const quote = (s) => `'${s.replaceAll("'", "'\\''")}'`;
const command = (args) => args.map(quote).join(' ');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export default defineConfig({
  testDir: root + 'e2e',
  timeout: 180000,
  expect: { timeout: 45000 },
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: join(scratch, 'results'),
  use: {
    baseURL: 'http://127.0.0.1:5189',
    viewport: { width: 1600, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      ...(existsSync(chrome) ? { executablePath: chrome } : {}),
      // GPU-less CI exercises the shipped 2D fallback; local rehearsals retain full 3D.
      args: process.env.E2E_2D === '1' ? ['--disable-webgl'] : ['--enable-unsafe-swiftshader'],
    },
  },
  projects: [
    { name: 'mock', testMatch: 'mock.spec.mjs' },
    { name: 'live', testMatch: 'live.spec.mjs' },
  ],
  webServer: [
    {
      command: command([
        process.execPath,
        '--import',
        root + 'apps/server/node_modules/tsx/dist/loader.mjs',
        root + 'apps/server/src/main.ts',
      ]),
      cwd: root,
      url: 'http://127.0.0.1:8799/api/health',
      reuseExistingServer: false,
      timeout: 30000,
      env: {
        API_PORT: '8799',
        API_HOST: '127.0.0.1',
        CORS_ORIGIN: 'http://127.0.0.1:5189',
        DATABASE_PATH: join(scratch, 'server.sqlite'),
        DATA_DIR: root + 'data',
        INTEL_MODE: 'cache',
        FEEDS_ENABLED: '0',
        SEED_DEMO_PASSWORD: 'bastion-demo',
        JWT_SECRET: 'bastion-e2e-only-jwt-secret-not-for-production',
        LOG_LEVEL: 'silent',
      },
    },
    {
      command: command([
        process.execPath,
        root + 'apps/web/node_modules/vite/bin/vite.js',
        '--config',
        root + 'e2e/vite.config.mjs',
      ]),
      cwd: root,
      url: 'http://127.0.0.1:5189',
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});

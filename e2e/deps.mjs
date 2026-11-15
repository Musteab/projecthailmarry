// Reuse the workspace's pinned Playwright dependency without changing root ownership.
export { test, expect, defineConfig } from '../apps/web/node_modules/@playwright/test/index.mjs';

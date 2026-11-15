import { defineConfig } from 'vitest/config';

// One runner for the whole workspace. Each folder is a project; a package may add its own
// vitest.config.ts (for example jsdom for the web app) and it will be picked up.
export default defineConfig({
  test: {
    projects: ['apps/*', 'packages/*', 'tools/*'],
  },
});

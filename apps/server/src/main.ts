import { buildApp } from './app';

// API_PORT, not PORT: dev tools and preview harnesses set PORT for the web dev server, and the
// two must never collide. Hosting platforms that inject PORT are mapped to API_PORT at deploy time.
const port = Number(process.env.API_PORT ?? 8787);
// Local by default; a deployment sets API_HOST=0.0.0.0.
const host = process.env.API_HOST ?? '127.0.0.1';
const app = buildApp();

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

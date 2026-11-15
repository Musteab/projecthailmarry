import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from './context';

/** Answers a request the router did not match. Returns true when it handled it. */
export type NotFoundFallback = (request: FastifyRequest, reply: FastifyReply) => boolean;

/** Paths that belong to the API, the realtime socket and the public feeds, never to the web app. */
const RESERVED = ['/api', '/ws', '/public'];

/**
 * Serves the built web app from the same process as the API, so a deployment is one container
 * and one URL. Unknown paths that look like pages get index.html (the app does its own routing);
 * unknown API paths and missing files still answer with the JSON 404.
 *
 * Returns the fallback for the not-found handler, or undefined when the web app is not served
 * (development, or the build is missing).
 */
export async function registerWebApp(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<NotFoundFallback | undefined> {
  const { serveWeb, webDistDir } = ctx.config;
  if (!serveWeb) return undefined;
  if (!existsSync(join(webDistDir, 'index.html'))) {
    app.log.warn(`web app not served: no build found in ${webDistDir} (run "pnpm build")`);
    return undefined;
  }

  await app.register(fastifyStatic, {
    root: webDistDir,
    // One route per built file instead of a catch-all, so the API's own 404s and its auth gate
    // keep working exactly as they do without the web app.
    wildcard: false,
    setHeaders(response, path) {
      // Vite fingerprints everything under assets/, so those can be cached forever. The page
      // itself must always be fresh, or a redeploy would not reach people.
      const fingerprinted = path.replaceAll('\\', '/').includes('/assets/');
      void response.header(
        'cache-control',
        fingerprinted ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
    },
  });

  return (request, reply) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return false;
    const path = request.url.split('?')[0]!;
    if (RESERVED.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return false;
    // A missing file (it has an extension) is a real 404; anything else is a page of the app.
    if (path.slice(path.lastIndexOf('/')).includes('.')) return false;
    void reply.header('cache-control', 'no-cache').sendFile('index.html');
    return true;
  };
}

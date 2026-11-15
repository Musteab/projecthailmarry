import { URL } from 'node:url';
import { fileURLToPath } from 'node:url';
import base from '../apps/web/vite.config.ts';
const server = 'http://127.0.0.1:8799';
export default {
  ...base,
  root: fileURLToPath(new URL('../apps/web', import.meta.url)),
  envDir: fileURLToPath(new URL('..', import.meta.url)),
  server: {
    host: '127.0.0.1',
    port: 5189,
    strictPort: true,
    proxy: {
      '/api': { target: server, changeOrigin: true },
      '/public': { target: server, changeOrigin: true },
      '/ws': { target: server, ws: true },
    },
  },
};

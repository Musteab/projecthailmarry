import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const SERVER = 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react()],
  // .env, .env.mock and .env.example live at the repository root.
  envDir: '../..',
  server: {
    port: 5173,
    proxy: {
      '/api': { target: SERVER, changeOrigin: true },
      '/public': { target: SERVER, changeOrigin: true },
      '/ws': { target: SERVER, ws: true },
    },
  },
});

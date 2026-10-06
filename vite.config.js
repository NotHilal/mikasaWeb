import { defineConfig } from 'vite';

export default defineConfig({
  build: { target: 'esnext', chunkSizeWarningLimit: 1500 },
  server: { port: 5180 },
});

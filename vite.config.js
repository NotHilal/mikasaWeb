import { defineConfig, loadEnv } from 'vite';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env };
  return {
    build: { target: 'esnext', chunkSizeWarningLimit: 1500 },
    server: { port: 5180 },
    plugins: [{
      // the friends edition (VITE_EDITION=friends) has no gift: its pictures aren't in the build
      // either, so nobody can open them by their address
      name: 'friends-edition-no-gift',
      apply: 'build',
      async closeBundle() {
        if (env.VITE_EDITION === 'friends') await rm(resolve('dist/gift'), { recursive: true, force: true });
      },
    }],
  };
});

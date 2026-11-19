import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  // The CSP does not allow data: images, so assets must stay separate files.
  build: { assetsInlineLimit: 0 },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.js'],
    setupFiles: ['src/test-setup.js'],
  },
  resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
});

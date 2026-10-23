import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { port: 5173 },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      // the game, and the V2 look lab (vertical slice)
      input: { main: 'index.html', slice: 'slice.html' },
    },
  },
  // texture workers import three.js as an ES module
  worker: { format: 'es' },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 120_000,
  },
});

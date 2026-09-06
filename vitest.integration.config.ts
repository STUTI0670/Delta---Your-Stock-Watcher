import { defineConfig } from 'vitest/config';
import path from 'node:path';

/** Integration suite — needs a reachable MONGODB_URI. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.integration.test.ts'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
});

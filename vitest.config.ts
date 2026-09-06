import { defineConfig } from 'vitest/config';
import path from 'node:path';

/** Unit suite — pure business logic, no database or network. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/integration/**', 'node_modules/**'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
});

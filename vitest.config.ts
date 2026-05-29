import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  workspace: false,
  resolve: {
    alias: {
      '@skillevolver/core': path.resolve(__dirname, 'packages/core/src'),
      '@skillevolver/sandbox': path.resolve(__dirname, 'packages/sandbox/src'),
      '@skillevolver/skill-registry': path.resolve(__dirname, 'packages/skill-registry/src'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/phase4/**'],
  },
});

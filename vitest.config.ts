import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    setupFiles: ['src/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/utils/*.ts', 'src/middleware/*.ts'],
      exclude: ['src/__tests__/**'],
    },
    testTimeout: 10000,
  },
});

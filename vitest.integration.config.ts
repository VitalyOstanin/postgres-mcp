import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test-integration/**/*.test.ts'],
    setupFiles: ['./test-integration/setup.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
    // Integration tests share a single Postgres container; running them in
    // parallel risks schema/identifier collisions. Force serial execution.
    fileParallelism: false,
    maxWorkers: 1,
    isolate: true,
  },
});

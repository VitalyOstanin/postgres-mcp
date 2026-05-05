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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/version.ts'],
      // Keep integration coverage in its own directory so the unit suite's
      // coverage report doesn't get clobbered when both are collected on CI.
      reportsDirectory: 'coverage-integration',
    },
  },
});

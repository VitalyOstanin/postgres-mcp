import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Cap worker pool tightly — tests run alongside the user's other work,
    // and saturating CPU has frozen the machine before. Keep this low.
    maxWorkers: '10%',
    isolate: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      // Files exercised only by integration tests against a real PostgreSQL
      // container don't accumulate coverage in the unit run — excluding them
      // keeps unit-coverage thresholds meaningful instead of being dragged
      // down by code paths the unit suite intentionally avoids.
      exclude: [
        'src/**/*.d.ts',
        'src/version.ts',
        'src/postgres-client.ts',
        'src/server.ts',
        'src/tools/show-object.ts',
        'src/utils/postgres-stream.ts',
        'src/utils/streaming.ts',
        'src/utils/date.ts',
      ],
      reportsDirectory: 'coverage',
      // Floors set just below current values so a regression fails the
      // build but small fluctuations don't. Raise these after adding tests.
      thresholds: {
        statements: 75,
        branches: 65,
        functions: 80,
        lines: 75,
      },
    },
  },
});

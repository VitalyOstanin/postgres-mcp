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
      // Exclude the entry point and type-only declarations from coverage —
      // index.ts is exercised end-to-end by integration tests; type files
      // contribute zero executable lines.
      exclude: ['src/**/*.d.ts', 'src/version.ts'],
      reportsDirectory: 'coverage',
    },
  },
});

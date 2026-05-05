import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    maxWorkers: '10%',
    isolate: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
      reportsDirectory: 'coverage',
    },
  },
});

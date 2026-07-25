import { defineConfig } from 'vitest/config';

// Deterministic test configuration (no randomness, no wall-clock dependence).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}'],
    globals: false,
    // Enforce deterministic ordering of test files/cases.
    sequence: {
      shuffle: false,
      concurrent: false,
    },
    reporters: ['default'],
    fileParallelism: false,
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true,
        isolate: true,
      },
    },
  },
});

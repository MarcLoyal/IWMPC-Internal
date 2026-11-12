import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/tests/**/*.test.ts'],
    setupFiles: ['src/tests/setup.ts'],
    // Tests share one database, so run the files one after another.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.js'],
    setupFiles: ['./test/setup.js'],
    fileParallelism: false,
    poolOptions: {
      forks: {
        minForks: 1,
        maxForks: 1,
      },
    },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});

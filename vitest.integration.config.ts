import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'tests/scaffold/docker.test.ts',
      'tests/scaffold/migrations.test.ts',
    ],
    globals: true,
    testTimeout: 60000,
  },
});

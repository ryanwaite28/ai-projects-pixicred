import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: [
      'tests/scaffold/docker.test.ts',
      'tests/scaffold/migrations.test.ts',
    ],
    globals: true,
  },
});

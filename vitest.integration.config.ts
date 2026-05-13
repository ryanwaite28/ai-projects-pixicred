import { defineConfig } from 'vitest/config';
import fs from 'node:fs';

const hbsPlugin = {
  name: 'hbs-text-loader',
  transform(_: string, id: string) {
    if (id.endsWith('.hbs')) {
      const src = fs.readFileSync(id, 'utf-8');
      return { code: `export default ${JSON.stringify(src)}` };
    }
  },
};

export default defineConfig({
  plugins: [hbsPlugin],
  test: {
    include: [
      'tests/scaffold/docker.test.ts',
      'tests/scaffold/migrations.test.ts',
      'tests/db/**/*.test.ts',
      'tests/service/**/*.test.ts',
    ],
    globalSetup: ['tests/db/globalSetup.ts'],
    globals: true,
    testTimeout: 120000,
    hookTimeout: 60000,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});

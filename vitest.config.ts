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
    include: ['tests/**/*.test.ts'],
    exclude: [
      'tests/scaffold/docker.test.ts',
      'tests/scaffold/migrations.test.ts',
      'tests/db/**',
      'tests/service/**',
    ],
    globals: true,
  },
});

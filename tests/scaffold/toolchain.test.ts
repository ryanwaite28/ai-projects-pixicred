import { describe, test, expect } from 'vitest';
import { execSync } from 'child_process';
import { existsSync } from 'fs';

describe('TypeScript toolchain', () => {
  test('TypeScript strict mode rejects implicit any in src/db/client.ts', () => {
    expect(existsSync('src/db/client.ts')).toBe(true);
    expect(() => execSync('npx tsc --noEmit', { stdio: 'pipe' })).not.toThrow();
  });

  test('prisma generate produces PrismaClient without error', () => {
    expect(() => execSync('npm run db:generate', { stdio: 'pipe' })).not.toThrow();
    expect(existsSync('node_modules/.prisma/client')).toBe(true);
  });

  test('esbuild bundles src/db/client.ts without error and produces dist/lambdas/db-client/index.js', () => {
    expect(() => execSync('npm run build', { stdio: 'pipe' })).not.toThrow();
    expect(existsSync('dist/lambdas/db-client/index.js')).toBe(true);
  });

  test('ESLint exits 0 on src/db/client.ts', () => {
    expect(() => execSync('npx eslint src/db/client.ts', { stdio: 'pipe' })).not.toThrow();
  });
});

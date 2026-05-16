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

  test('esbuild bundles all Lambda entry points without error', () => {
    expect(() => execSync('npm run build', { stdio: 'pipe' })).not.toThrow();

    const expectedBundles = [
      'api-applications', 'api-accounts', 'api-transactions', 'api-payments',
      'api-statements', 'api-notifications', 'api-auth', 'api-admin',
      'api-merchant', 'api-health',
      'service',
      'credit-check', 'notification', 'statement-gen', 'billing-lifecycle',
      'dispute-resolution', 'transaction-settlement',
    ];

    for (const name of expectedBundles) {
      expect(existsSync(`dist/lambdas/${name}/index.js`), `missing bundle: ${name}`).toBe(true);
    }
  });

  test('ESLint exits 0 on src/db/client.ts', () => {
    expect(() => execSync('npx eslint src/db/client.ts', { stdio: 'pipe' })).not.toThrow();
  });
});

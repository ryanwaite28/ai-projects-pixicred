import { describe, test, expect } from 'vitest';
import { execSync } from 'child_process';

const dbEnv = {
  ...process.env,
  DATABASE_URL:
    process.env['DATABASE_URL'] ??
    'postgresql://pixicred:pixicred_local@localhost:5432/pixicred',
};

describe('Database migrations — integration', () => {
  test('db:generate runs to completion with exit code 0', () => {
    const output = execSync('npm run db:generate', { stdio: 'pipe' });
    expect(output).toBeDefined();
  });

  test('db:migrate runs to completion with exit code 0', () => {
    const output = execSync('npm run db:migrate', { stdio: 'pipe', env: dbEnv });
    expect(output).toBeDefined();
  });

  test('db:migrate is idempotent — running twice does not throw', () => {
    execSync('npm run db:migrate', { stdio: 'pipe', env: dbEnv });
    expect(() => execSync('npm run db:migrate', { stdio: 'pipe', env: dbEnv })).not.toThrow();
  });
});

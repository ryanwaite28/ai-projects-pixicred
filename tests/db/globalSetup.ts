import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'child_process';

let containerStop: (() => Promise<void>) | undefined;

export async function setup({ provide }: { provide(key: string, value: unknown): void }): Promise<void> {
  const container = await new PostgreSqlContainer('postgres:15')
    .withDatabase('pixicred_test')
    .withUsername('pixicred')
    .withPassword('pixicred_local')
    .start();

  const url = container.getConnectionUri();
  process.env['TEST_DATABASE_URL'] = url;
  process.env['ENVIRONMENT'] = 'local';
  process.env['DATABASE_URL'] = url;

  provide('testDatabaseUrl', url);

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });

  containerStop = async () => { await container.stop(); };
}

export async function teardown(): Promise<void> {
  await containerStop?.();
}

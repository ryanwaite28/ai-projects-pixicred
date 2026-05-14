import { inject } from 'vitest';

const url = inject('testDatabaseUrl') as string | undefined;
if (url) {
  process.env['TEST_DATABASE_URL'] = url;
  process.env['DATABASE_URL'] = url;
  process.env['ENVIRONMENT'] = 'local';
}

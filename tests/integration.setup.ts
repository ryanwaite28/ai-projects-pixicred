import { inject } from 'vitest';

declare module 'vitest' {
  export interface ProvidedContext {
    testDatabaseUrl: string;
  }
}

const url = inject('testDatabaseUrl');
if (url) {
  process.env['TEST_DATABASE_URL'] = url;
  process.env['DATABASE_URL'] = url;
  process.env['ENVIRONMENT'] = 'local';
}

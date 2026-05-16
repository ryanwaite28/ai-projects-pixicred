import * as esbuild from 'esbuild';

export const baseConfig: esbuild.BuildOptions = {
  platform: 'node',
  target: 'node20',
  bundle: true,
  minify: false,
  sourcemap: true,
  external: ['@prisma/client', '.prisma/client', 'bcrypt'],
  loader: { '.hbs': 'text' },
};

const lambdaEntries: Array<[string, string]> = [
  ['api-applications',      'src/handlers/api/applications.handler.ts'],
  ['api-accounts',          'src/handlers/api/accounts.handler.ts'],
  ['api-transactions',      'src/handlers/api/transactions.handler.ts'],
  ['api-payments',          'src/handlers/api/payments.handler.ts'],
  ['api-statements',        'src/handlers/api/statements.handler.ts'],
  ['api-notifications',     'src/handlers/api/notifications.handler.ts'],
  ['api-auth',              'src/handlers/api/auth.handler.ts'],
  ['api-admin',             'src/handlers/api/admin.handler.ts'],
  ['api-merchant',          'src/handlers/api/merchant.handler.ts'],
  ['api-health',            'src/handlers/api/health.handler.ts'],
  ['service',               'src/handlers/service/service.handler.ts'],
  ['credit-check',          'src/handlers/sqs/credit-check.handler.ts'],
  ['notification',          'src/handlers/sqs/notification.handler.ts'],
  ['statement-gen',         'src/handlers/sqs/statement-gen.handler.ts'],
  ['billing-lifecycle',     'src/handlers/sqs/billing-lifecycle.handler.ts'],
  ['dispute-resolution',    'src/handlers/sqs/dispute-resolution.handler.ts'],
  ['transaction-settlement','src/handlers/sqs/transaction-settlement.handler.ts'],
];

const localEntries: Array<[string, string]> = [
  ['api-server',     'local/api-server.ts'],
  ['service-server', 'local/service-server.ts'],
  ['worker',         'local/worker.ts'],
];

void (async () => {
  const builds: Promise<esbuild.BuildResult>[] = [];

  for (const [name, entryPoint] of lambdaEntries) {
    builds.push(
      esbuild.build({
        ...baseConfig,
        entryPoints: { index: entryPoint },
        outdir: `dist/lambdas/${name}`,
      }),
    );
  }

  for (const [name, entryPoint] of localEntries) {
    builds.push(
      esbuild.build({
        ...baseConfig,
        entryPoints: { [name]: entryPoint },
        outdir: 'dist/local',
      }),
    );
  }

  await Promise.all(builds);
  console.log('Build complete.');
})();

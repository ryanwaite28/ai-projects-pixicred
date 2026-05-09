import * as esbuild from 'esbuild';

export const baseConfig: esbuild.BuildOptions = {
  platform: 'node',
  target: 'node20',
  bundle: true,
  minify: false,
  sourcemap: true,
  external: ['@prisma/client', '.prisma/client'],
  loader: { '.hbs': 'text' },
};

// Phase 0: single dummy bundle to validate toolchain.
// Phase 8 replaces this with all 12 Lambda entry points.
void (async () => {
  await esbuild.build({
    ...baseConfig,
    entryPoints: { index: 'src/db/client.ts' },
    outdir: 'dist/lambdas/db-client',
  });
  console.log('Build complete.');
})();

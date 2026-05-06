import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'index.js',
  sourcemap: true,
  external: [],
  logLevel: 'info',
});

console.log('Build complete: index.js');

import * as esbuild from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

await esbuild.build({
  entryPoints: [resolve(__dirname, 'index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'index.js',
  sourcemap: true,
  external: ['@larksuite/openclaw-lark', '@larksuiteoapi/node-sdk'],
  logLevel: 'info',
});

console.log('Build complete: index.js');

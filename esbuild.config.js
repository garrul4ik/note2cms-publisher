const esbuild = require('esbuild');
const production = process.argv.includes('production');

esbuild.build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  minify: production,
  sourcemap: !production,
  target: 'es2018',
  outfile: 'main.js',
  platform: 'browser',
  format: 'cjs',
  external: ['obsidian']
}).then(() => console.log('Build complete'));
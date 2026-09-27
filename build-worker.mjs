import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const projectDir = fileURLToPath(new URL('.', import.meta.url));

const [html, css, js] = await Promise.all([
  readFile(new URL('./public/index.html', import.meta.url), 'utf8'),
  readFile(new URL('./public/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('./public/app.js', import.meta.url), 'utf8'),
]);

await mkdir(new URL('./dist/server/', import.meta.url), { recursive: true });
await build({
  absWorkingDir: projectDir,
  entryPoints: [fileURLToPath(new URL('./worker.mjs', import.meta.url))],
  outfile: fileURLToPath(new URL('./dist/server/index.js', import.meta.url)),
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
  plugins: [{
    name: 'public-assets',
    setup(plugin) {
      plugin.onResolve({ filter: /^virtual:assets$/ }, () => ({ path: 'virtual:assets', namespace: 'assets' }));
      plugin.onLoad({ filter: /.*/, namespace: 'assets' }, () => ({
        contents: `export default ${JSON.stringify({ html, css, js })};`,
        loader: 'js',
      }));
    },
  }],
});

console.log('Worker build complete.');

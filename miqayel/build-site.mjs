import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const project = fileURLToPath(new URL('../', import.meta.url));
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const bundle = await build({
  absWorkingDir: project,
  entryPoints: ['./miqayel/client-inspect.mjs'],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  minify: true,
  write: false,
  define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
});
const bundledJs = Buffer.from(bundle.outputFiles[0].contents).toString('utf8');
const safeJs = bundledJs.replace(/<\/script/gi, '<\\/script');
const safeApp = app.replace(/<\/script/gi, '<\\/script');
const page = html
  .replace('<link rel="stylesheet" href="/styles.css">', `<style>\n${css}\n</style>`)
  .replace('  <script src="/app.js" defer></script>\n', '')
  .replace('</body>', `<script>${safeJs}</script>\n<script>${safeApp}</script>\n</body>`);

if (page.includes('href="/styles.css"') || page.includes('src="/app.js"')) {
  throw new Error('The standalone page still references separate app assets.');
}
const output = new URL('./dist/curvescope.html', import.meta.url);
await mkdir(new URL('./dist/', import.meta.url), { recursive: true });
await writeFile(output, page);
console.log(`Built ${fileURLToPath(output)} (${Buffer.byteLength(page)} bytes).`);

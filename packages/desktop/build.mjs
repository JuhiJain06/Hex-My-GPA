// Bundles the Electron app into dist/:
//   dist/main.js        main process (ESM, Node platform)
//   dist/preload.cjs    preload (CJS, as sandboxed preloads require)
//   dist/renderer/*     one IIFE bundle per renderer + its html + common.css
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, 'src');
const out = join(root, 'dist');
const rendererSrc = join(src, 'renderer');
const rendererOut = join(out, 'renderer');

rmSync(out, { recursive: true, force: true });
mkdirSync(rendererOut, { recursive: true });

const common = { bundle: true, sourcemap: 'linked', target: 'es2022', logLevel: 'warning' };
// Runtime deps that must stay in node_modules (sql.js loads its wasm relative to itself).
const external = ['electron', 'sql.js', 'ws', 'get-windows'];

const htmlPages = readdirSync(rendererSrc).filter((f) => f.endsWith('.html'));
const rendererEntries = htmlPages.map((f) => join(rendererSrc, f.replace(/\.html$/, '.ts')));

await Promise.all([
  build({ ...common, entryPoints: [join(src, 'main', 'index.ts')], outfile: join(out, 'main.js'),
    platform: 'node', format: 'esm', external }),
  build({ ...common, entryPoints: [join(src, 'preload.ts')], outfile: join(out, 'preload.cjs'),
    platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ ...common, entryPoints: rendererEntries, outdir: rendererOut, platform: 'browser', format: 'iife' }),
]);

for (const f of [...htmlPages, 'common.css']) copyFileSync(join(rendererSrc, f), join(rendererOut, f));
console.log(`built main, preload and ${htmlPages.length} renderers → dist/`);

// Bundles the Electron app into dist/:
//   dist/main.js        main process (ESM, Node platform)
//   dist/watchdog.js    watchdog process (ESM, run by electron.exe as node)
//   dist/preload.cjs    preload (CJS, as sandboxed preloads require)
//   dist/renderer/*     one IIFE bundle per renderer + its html + the renderer css (common, pet), plus core's theme
//                       tokens.css (imported by common.css) and sprite.css
//   dist/renderer/art/*.png  the buddies' character art (core/buddy/art), unaltered
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, 'src');
const out = join(root, 'dist');
const rendererSrc = join(src, 'renderer');
const rendererOut = join(out, 'renderer');
const core = join(root, '..', 'core');

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
  build({ ...common, entryPoints: [join(src, 'watchdog', 'run.ts')], outfile: join(out, 'watchdog.js'),
    platform: 'node', format: 'esm' }),
  build({ ...common, entryPoints: [join(src, 'preload.ts')], outfile: join(out, 'preload.cjs'),
    platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ ...common, entryPoints: rendererEntries, outdir: rendererOut, platform: 'browser', format: 'iife' }),
]);

const cssFiles = readdirSync(rendererSrc).filter((f) => f.endsWith('.css'));
for (const f of [...htmlPages, ...cssFiles]) copyFileSync(join(rendererSrc, f), join(rendererOut, f));
copyFileSync(join(core, 'theme', 'tokens.css'), join(rendererOut, 'tokens.css'));
copyFileSync(join(core, 'buddy', 'sprite.css'), join(rendererOut, 'sprite.css'));
const artSrc = join(core, 'buddy', 'art');
mkdirSync(join(rendererOut, 'art'), { recursive: true });
for (const f of readdirSync(artSrc).filter((f) => f.endsWith('.png'))) copyFileSync(join(artSrc, f), join(rendererOut, 'art', f));
console.log(`built main, watchdog, preload and ${htmlPages.length} renderers → dist/`);

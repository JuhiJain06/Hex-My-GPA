// Bundles the MV3 extension into dist/:
//   dist/background.js                  service worker (ESM; "type": "module" in the manifest)
//   dist/{blocked,options}.{js,html}    pages (IIFE)
//   dist/youtube.js                     content script (IIFE)
//   dist/manifest.json
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, 'src');
const out = join(root, 'dist');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const common = { bundle: true, sourcemap: 'linked', target: 'es2022', platform: 'browser', logLevel: 'warning' };
const htmlPages = readdirSync(src).filter((f) => f.endsWith('.html'));

await Promise.all([
  build({ ...common, entryPoints: [join(src, 'background.ts')], outfile: join(out, 'background.js'), format: 'esm' }),
  build({ ...common, entryPoints: [...htmlPages.map((f) => join(src, f.replace(/\.html$/, '.ts'))), join(src, 'youtube.ts')], outdir: out, format: 'iife' }),
]);

copyFileSync(join(root, 'manifest.json'), join(out, 'manifest.json'));
for (const f of htmlPages) copyFileSync(join(src, f), join(out, f));
console.log(`built background, youtube and ${htmlPages.length} pages -> dist/`);

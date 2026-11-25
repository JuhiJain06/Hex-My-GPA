// Bundles the MV3 extension into dist/:
//   dist/background.js                  service worker (ESM; "type": "module" in the manifest)
//   dist/{blocked,options}.{js,html}    pages (IIFE)
//   dist/youtube.js                     content script (IIFE)
//   dist/manifest.json
//   dist/{tokens,sprite}.css            core's theme tokens and buddy animations, linked by the pages
//   dist/art/*.png                      the buddies' character art (core/buddy/art), unaltered
// A CSS import in TS is the file's text (the YouTube card puts the tokens in its shadow root).
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, 'src');
const out = join(root, 'dist');
const core = join(root, '..', 'core');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const common = { bundle: true, sourcemap: 'linked', target: 'es2022', platform: 'browser', logLevel: 'warning', loader: { '.css': 'text' } };
const htmlPages = readdirSync(src).filter((f) => f.endsWith('.html'));

await Promise.all([
  build({ ...common, entryPoints: [join(src, 'background.ts')], outfile: join(out, 'background.js'), format: 'esm' }),
  build({ ...common, entryPoints: [...htmlPages.map((f) => join(src, f.replace(/\.html$/, '.ts'))), join(src, 'youtube.ts')], outdir: out, format: 'iife' }),
]);

copyFileSync(join(root, 'manifest.json'), join(out, 'manifest.json'));
for (const f of htmlPages) copyFileSync(join(src, f), join(out, f));
copyFileSync(join(core, 'theme', 'tokens.css'), join(out, 'tokens.css'));
copyFileSync(join(core, 'buddy', 'sprite.css'), join(out, 'sprite.css'));
const artSrc = join(core, 'buddy', 'art');
mkdirSync(join(out, 'art'), { recursive: true });
for (const f of readdirSync(artSrc).filter((f) => f.endsWith('.png'))) copyFileSync(join(artSrc, f), join(out, 'art', f));
console.log(`built background, youtube and ${htmlPages.length} pages -> dist/`);

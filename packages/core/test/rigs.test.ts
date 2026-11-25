/// <reference types="node" />
import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANIMALS } from '../src/index';
import { PICTURE_SIZE, RIGS, SCENES, pictureFile, pictureKey, type Picture, type PictureKey } from '../buddy/rigs';

const here = dirname(fileURLToPath(import.meta.url));
const art = join(here, '../buddy/art');
const pictures: [string, PictureKey, string][] = ANIMALS.flatMap((a) =>
  (['stand', ...SCENES] as Picture[]).map((p) => [`${a.id} ${p}`, pictureKey(a.id, p), pictureFile(a.id, p)] as [string, PictureKey, string]));

function pngSize(file: string): [number, number] {
  const b = readFileSync(file);
  expect(b.toString('ascii', 12, 16)).toBe('IHDR');
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

describe('pictures', () => {
  test('6 standing poses + 18 scenes, keyed fox / fox-study', () => {
    expect(pictures).toHaveLength(24);
    expect(pictureKey('fox', 'stand')).toBe('fox');
    expect(pictureKey('fox', 'study')).toBe('fox-study');
    expect(pictureFile('fox', 'stand')).toBe('fox.png');
    expect(pictureFile('fox', 'sleep')).toBe('scenes/fox-sleep.png');
    expect(Object.keys(PICTURE_SIZE).sort()).toEqual(pictures.map((p) => p[1]).sort());
    expect(Object.keys(RIGS).sort()).toEqual(pictures.map((p) => p[1]).sort());
  });

  test('every scene PNG in art/scenes is one of them', () => {
    const files = readdirSync(join(art, 'scenes')).filter((f) => f.endsWith('.png')).map((f) => `scenes/${f}`).sort();
    expect(files).toEqual(pictures.map((p) => p[2]).filter((f) => f.startsWith('scenes/')).sort());
  });

  test.each(pictures)('%s: the file exists and PICTURE_SIZE matches it', (_n, key, file) => {
    expect(existsSync(join(art, file))).toBe(true);
    expect(pngSize(join(art, file))).toEqual(PICTURE_SIZE[key]);
  });
});

describe('rigs', () => {
  test.each(pictures)('%s: every point is inside the image; parts are real lines', (_n, key) => {
    const [w, h] = PICTURE_SIZE[key];
    for (const p of RIGS[key]) {
      expect(['ear', 'tail']).toContain(p.k);
      for (const [x, y] of [p.b, p.t]) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(w);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThan(h);
      }
      const len = Math.hypot(p.t[0] - p.b[0], p.t[1] - p.b[1]);
      expect(len).toBeGreaterThanOrEqual(p.k === 'ear' ? 12 : 40);
      expect(len).toBeLessThan(p.k === 'ear' ? 90 : 160);
    }
  });

  test('every pet moves its ears in every picture (at most two ears and one tail each)', () => {
    for (const [n, key] of pictures) {
      const parts = RIGS[key];
      const ears = parts.filter((p) => p.k === 'ear').length;
      expect(ears, n).toBe(2);
      expect(parts.filter((p) => p.k === 'tail').length, n).toBeLessThanOrEqual(1);
    }
  });

  test('tails where they show: fox and cat awake, the dog\'s curly tail at the desk and on its back', () => {
    const tails = pictures.filter(([, key]) => RIGS[key].some((p) => p.k === 'tail')).map((p) => p[1]).sort();
    expect(tails).toEqual(['cat', 'cat-break', 'cat-study', 'dog-break', 'dog-study', 'fox', 'fox-break', 'fox-study'].sort());
  });
});

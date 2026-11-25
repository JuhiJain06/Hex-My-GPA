/// <reference types="node" />
// @vitest-environment jsdom
import { describe, test, expect, vi, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANIMALS, MOODS, type Animal, type Mood } from '../src/index';
import { ART_SIZE, INK, OVERLAYS, petSprite, spriteSlot, spriteWidth } from '../buddy/sprite';

const here = dirname(fileURLToPath(import.meta.url));
const combos = ANIMALS.flatMap((a) => MOODS.map((m) => [a.id, m] as [Animal, Mood]));
/** The sleep dim, however the DOM spells the numbers (".9" or "0.9"). */
const DIM = /^brightness\(0?\.9\) saturate\(0?\.85\)$/;
const overlayKinds = (el: Element) => [...el.querySelectorAll('[data-doodle]')].map((d) => d.getAttribute('data-doodle')).sort();

afterEach(() => vi.restoreAllMocks());

/** Reads a PNG's width and height from its IHDR chunk. */
function pngSize(file: string): [number, number] {
  const b = readFileSync(file);
  expect(b.toString('ascii', 12, 16)).toBe('IHDR');
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

describe('the art', () => {
  test.each(ANIMALS.map((a) => a.id))('%s.png exists and ART_SIZE matches it', (animal) => {
    const file = join(here, '../buddy/art', `${animal}.png`);
    expect(existsSync(file)).toBe(true);
    expect(pngSize(file)).toEqual(ART_SIZE[animal]);
  });
  test('spriteWidth follows the aspect ratio', () => {
    expect(spriteWidth('cat', 345)).toBe(327);
    expect(spriteWidth('dog', 150)).toBe(Math.round((150 * 345) / 308));
  });
});

describe('petSprite', () => {
  test.each(combos)('%s / %s: the right image, unaltered, with the mood\'s doodles', (animal, mood) => {
    const el = petSprite(animal, mood, 150);
    expect(el.tagName).toBe('DIV');
    expect(el.classList.contains('sprite')).toBe(true);
    expect(el.classList.contains(`sprite--${mood}`)).toBe(true);
    expect(el.dataset.animal).toBe(animal);
    expect(el.dataset.mood).toBe(mood);
    const imgs = el.querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    const img = imgs[0]!;
    expect(img.getAttribute('src')).toBe(`art/${animal}.png`);
    expect(img.alt).toBe(ANIMALS.find((a) => a.id === animal)!.label);
    expect(img.draggable).toBe(false);
    expect(img.getAttribute('draggable')).toBe('false');
    expect(img.style.height).toBe('150px');
    expect(img.style.width).toBe(`${spriteWidth(animal, 150)}px`);
    expect(el.style.width).toBe(`${spriteWidth(animal, 150)}px`);
    expect(el.style.height).toBe('150px');
    // Never recolored, except the sleep dim.
    if (mood === 'sleep') expect(img.style.filter).toMatch(DIM);
    else expect(img.style.filter).toBe('');
    expect(overlayKinds(el)).toEqual([...OVERLAYS[mood]].sort());
  });

  test('the mood overlay table', () => {
    expect(OVERLAYS).toEqual({
      wave: [], study: [], alert: ['alert'], sleep: ['zz'], sad: ['sweat'], celebrate: ['hearts', 'sparkles'], break: ['mug'],
    });
  });

  test('doodles are inline SVG paths in dark ink, ignored by the mouse', () => {
    const el = petSprite('fox', 'celebrate', 150);
    const svgs = el.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThan(0);
    for (const svg of svgs) {
      expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.querySelectorAll('path').length).toBeGreaterThan(0);
      for (const p of svg.querySelectorAll('path')) expect(p.getAttribute('stroke')).toBe(INK);
    }
    expect(INK).toBe('#3a2f2a');
  });

  test('artBase resolves the image per page', () => {
    expect(petSprite('panda', 'wave', 72, '../art/').querySelector('img')!.getAttribute('src')).toBe('../art/panda.png');
  });

  test('an unknown animal shows the cat', () => {
    expect(petSprite('penguin' as Animal, 'wave', 72).querySelector('img')!.getAttribute('src')).toBe('art/cat.png');
  });

  test('never uses innerHTML-style APIs', () => {
    const setter = vi.spyOn(Element.prototype, 'innerHTML', 'set');
    const adj = vi.spyOn(Element.prototype, 'insertAdjacentHTML');
    for (const [a, m] of combos) petSprite(a, m, 72);
    expect(setter).not.toHaveBeenCalled();
    expect(adj).not.toHaveBeenCalled();
    const src = readFileSync(join(here, '../buddy/sprite.ts'), 'utf8');
    expect(src).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|DOMParser|createContextualFragment/);
  });
});

describe('spriteSlot', () => {
  test('a mood change keeps the same <img> (no reload flash); an animal change swaps it', () => {
    const host = document.createElement('div');
    const slot = spriteSlot(host, 150);
    slot.set('cat', 'study');
    const img = host.querySelector('img')!;
    slot.set('cat', 'study');
    expect(host.querySelector('img')).toBe(img);
    slot.set('cat', 'sleep');
    expect(host.querySelector('img')).toBe(img);
    expect(host.querySelector('.sprite')!.classList.contains('sprite--sleep')).toBe(true);
    expect(host.querySelector('.sprite')!.classList.contains('sprite--study')).toBe(false);
    expect(img.style.filter).toMatch(DIM);
    expect(overlayKinds(host)).toEqual(['zz']);
    slot.set('cat', 'study');
    expect(img.style.filter).toBe('');
    expect(overlayKinds(host)).toEqual([]);
    slot.set('dog', 'study');
    expect(host.querySelector('img')).not.toBe(img);
    expect(host.querySelector('img')!.getAttribute('src')).toBe('art/dog.png');
    expect(host.querySelectorAll('.sprite')).toHaveLength(1);
  });
});

describe('sprite.css', () => {
  const css = readFileSync(join(here, '../buddy/sprite.css'), 'utf8');
  test.each(['study', 'wave', 'break', 'sad', 'celebrate'])('has motion for %s', (mood) => {
    expect(css).toMatch(new RegExp(`\\.sprite--${mood}[^{]*\\{[^}]*animation`));
  });
  test('sad shakes for 3 s', () => expect(css).toMatch(/\.sprite--sad[^{]*\{[^}]*animation:[^;]*\b3s\b/));
  test('all motion stops for reduced motion (the doodles stay)', () => {
    const rm = css.slice(css.indexOf('prefers-reduced-motion'));
    expect(rm).toMatch(/\.sprite,\s*\.sprite \*[^{]*\{[^}]*animation:\s*none/);
    expect(rm).not.toMatch(/display:\s*none|visibility:\s*hidden/);
  });
});

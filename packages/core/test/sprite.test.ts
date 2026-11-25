/// <reference types="node" />
// @vitest-environment jsdom
import { describe, test, expect, vi, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANIMALS, MOODS, type Animal, type Mood } from '../src/index';
import {
  ART_SIZE, INK, MOOD_PICTURE, OVERLAYS, STEAM_AT, fitSize, petSprite, pictureFor, spriteSize, spriteSlot, spriteWidth,
} from '../buddy/sprite';
import { PICTURE_SIZE, RIGS } from '../buddy/rigs';

const here = dirname(fileURLToPath(import.meta.url));
const combos = ANIMALS.flatMap((a) => MOODS.map((m) => [a.id, m] as [Animal, Mood]));
const overlayKinds = (el: Element) => [...el.querySelectorAll('[data-doodle]')].map((d) => d.getAttribute('data-doodle')).sort();
const art = (el: Element) => el.querySelector<HTMLElement>('.sp-art')!;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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
  test('spriteWidth follows the standing pose\'s aspect ratio', () => {
    expect(spriteWidth('cat', 345)).toBe(327);
    expect(spriteWidth('dog', 150)).toBe(Math.round((150 * 345) / 308));
  });
});

describe('mood → picture', () => {
  test('the mapping (spec Addendum 4)', () => {
    expect(MOOD_PICTURE).toEqual({
      wave: 'stand', celebrate: 'stand', study: 'study', sad: 'study', break: 'break', alert: 'break', sleep: 'sleep',
    });
  });
  test.each(combos)('%s / %s: file, size, rig and pace', (animal, mood) => {
    const p = pictureFor(animal, mood);
    const scene = MOOD_PICTURE[mood];
    expect(p.file).toBe(scene === 'stand' ? `${animal}.png` : `scenes/${animal}-${scene}.png`);
    expect(p.key).toBe(scene === 'stand' ? animal : `${animal}-${scene}`);
    expect(p.natural).toEqual(PICTURE_SIZE[p.key]);
    expect(p.rig).toBe(RIGS[p.key]);
    expect(p.slow).toBe(mood === 'sleep');
  });
  test('an unknown animal is the cat', () => {
    expect(pictureFor('penguin' as Animal, 'study').file).toBe('scenes/cat-study.png');
  });
});

describe('fitSize', () => {
  test('height first, width from the aspect ratio', () => {
    expect(fitSize([400, 200], 150)).toEqual([300, 150]);
    expect(fitSize([400, 200], 150, 320)).toEqual([300, 150]);
  });
  test('too wide: as wide as allowed, and shorter', () => {
    expect(fitSize([581, 218], 150, 320)).toEqual([320, 120]);
  });
  test('spriteSize is fitSize of the mood\'s picture', () => {
    expect(spriteSize('dog', 'break', 150, 320)).toEqual([320, 120]);
    expect(spriteSize('fox', 'wave', 150, 320)).toEqual([126, 150]);
  });
});

describe('petSprite', () => {
  test.each(combos)('%s / %s: one canvas with the mood\'s picture, sized, with the mood\'s doodles', (animal, mood) => {
    const el = petSprite(animal, mood, 150, 'art/', { maxWidth: 320 });
    const [w, h] = spriteSize(animal, mood, 150, 320);
    expect(el.tagName).toBe('DIV');
    expect(el.classList.contains('sprite')).toBe(true);
    expect(el.classList.contains(`sprite--${mood}`)).toBe(true);
    expect(el.dataset.animal).toBe(animal);
    expect(el.dataset.mood).toBe(mood);
    expect(el.dataset.picture).toBe(pictureFor(animal, mood).key);
    expect(el.querySelectorAll('img')).toHaveLength(0);
    const canvases = el.querySelectorAll('canvas');
    expect(canvases).toHaveLength(1);
    const c = canvases[0]!;
    expect(c.classList.contains('sp-art')).toBe(true);
    expect(c.getAttribute('role')).toBe('img');
    expect(c.getAttribute('aria-label')).toBe(ANIMALS.find((a) => a.id === animal)!.label);
    expect(c.dataset.src).toBe(`art/${pictureFor(animal, mood).file}`);
    expect(c.style.width).toBe(`${w}px`);
    expect(c.style.height).toBe(`${h}px`);
    expect(el.style.width).toBe(`${w}px`);
    expect(el.style.height).toBe(`${h}px`);
    expect(w).toBeLessThanOrEqual(320);
    expect(h).toBeLessThanOrEqual(150);
    // Never recolored (not even asleep: the scene shows it).
    expect(c.style.filter).toBe('');
    const want = OVERLAYS[mood].filter((k) => k !== 'steam' || STEAM_AT[animal]);
    expect(overlayKinds(el)).toEqual([...want].sort());
  });

  test('the mood overlay table', () => {
    expect(OVERLAYS).toEqual({
      wave: [], study: ['twinkle'], alert: ['alert', 'steam'], sleep: ['zz'], sad: ['sweat'], celebrate: ['hearts', 'sparkles'], break: ['steam'],
    });
  });

  test('steam rises over the hot drinks only (cat, fox, panda, bunny), inside the picture', () => {
    expect(Object.keys(STEAM_AT).sort()).toEqual(['bunny', 'cat', 'fox', 'panda']);
    for (const [x, y] of Object.values(STEAM_AT)) {
      expect(x).toBeGreaterThan(0); expect(x).toBeLessThan(1);
      expect(y).toBeGreaterThan(0); expect(y).toBeLessThan(1);
    }
    expect(petSprite('cat', 'break', 150).querySelectorAll('.sp-steam')).toHaveLength(3);
    expect(petSprite('dog', 'break', 150).querySelectorAll('.sp-steam')).toHaveLength(0);
  });

  test('asleep: three z\'s that rise one after another', () => {
    const zs = [...petSprite('cat', 'sleep', 150).querySelectorAll<SVGElement>('.sp-z')];
    expect(zs).toHaveLength(3);
    expect(zs.map((z) => z.style.animationDelay)).toEqual(['0s', '1.2s', '2.4s']);
  });

  test('doodles are inline SVG paths in dark ink (or plain shapes), ignored by the mouse', () => {
    for (const mood of MOODS) {
      const el = petSprite('fox', mood, 150);
      for (const svg of el.querySelectorAll('svg')) {
        expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
        expect(svg.getAttribute('aria-hidden')).toBe('true');
        expect(svg.querySelectorAll('path').length).toBeGreaterThan(0);
        for (const p of svg.querySelectorAll('path')) expect(p.getAttribute('stroke')).toBe(INK);
      }
      for (const d of el.querySelectorAll('.sp-doodle')) expect(d.getAttribute('aria-hidden')).toBe('true');
    }
    expect(INK).toBe('#3a2f2a');
  });

  test('artBase resolves the picture per page', () => {
    expect(art(petSprite('panda', 'wave', 72, '../art/')).dataset.src).toBe('../art/panda.png');
    expect(art(petSprite('panda', 'sleep', 72, '../art/')).dataset.src).toBe('../art/scenes/panda-sleep.png');
  });

  test('an unknown animal shows the cat', () => {
    expect(art(petSprite('penguin' as Animal, 'wave', 72)).dataset.src).toBe('art/cat.png');
  });

  test('fluid: shrinks to its container, keeping the aspect ratio', () => {
    const el = petSprite('dog', 'wave', 72, 'art/', { fluid: true });
    const [w, h] = spriteSize('dog', 'wave', 72);
    expect(el.style.width).toBe('100%');
    expect(el.style.maxWidth).toBe(`${w}px`);
    expect(el.style.aspectRatio.replace(/\s/g, '')).toBe(`${w}/${h}`);
    expect(art(el).style.width).toBe('100%');
    expect(art(el).style.height).toBe('100%');
  });

  test('never uses innerHTML-style APIs', () => {
    const setter = vi.spyOn(Element.prototype, 'innerHTML', 'set');
    const adj = vi.spyOn(Element.prototype, 'insertAdjacentHTML');
    for (const [a, m] of combos) petSprite(a, m, 72);
    expect(setter).not.toHaveBeenCalled();
    expect(adj).not.toHaveBeenCalled();
    for (const f of ['sprite.ts', 'animator.ts', 'warp.ts']) {
      const src = readFileSync(join(here, '../buddy', f), 'utf8');
      expect(src, f).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|DOMParser|createContextualFragment/);
    }
  });
});

// ---- With a fake image loader and 2D context, so pictures "load" in jsdom ----

interface FakeCtx {
  drawImage: ReturnType<typeof vi.fn>;
  getImageData: ReturnType<typeof vi.fn>;
  createImageData: ReturnType<typeof vi.fn>;
  putImageData: ReturnType<typeof vi.fn>;
}
function fakeCanvas(opts: { tainted?: boolean } = {}) {
  const ctxs: FakeCtx[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    const ctx: FakeCtx = {
      drawImage: vi.fn(),
      getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => {
        if (opts.tainted) throw new DOMException('tainted', 'SecurityError');
        return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(200) };
      }),
      createImageData: vi.fn((w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) })),
      putImageData: vi.fn(),
    };
    ctxs.push(ctx);
    return ctx as unknown as CanvasRenderingContext2D;
  } as never);
  /** Pending image loads; `load()` finishes them all (each with the natural size of its file). */
  const pending: { img: FakeImage }[] = [];
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    decoding = '';
    naturalWidth = 0;
    naturalHeight = 0;
    private s = '';
    get src() { return this.s; }
    set src(v: string) { this.s = v; pending.push({ img: this }); }
  }
  vi.stubGlobal('Image', FakeImage);
  const load = () => {
    for (const { img } of pending.splice(0)) {
      const m = /art\/(?:scenes\/)?([a-z-]+)\.png$/.exec(img.src)!;
      [img.naturalWidth, img.naturalHeight] = PICTURE_SIZE[m[1] as keyof typeof PICTURE_SIZE] as [number, number];
      img.onload?.();
    }
  };
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => { frames.push(cb); return frames.length; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  return { ctxs, load, frames, pending };
}

function reducedMotion(on: boolean) {
  vi.stubGlobal('matchMedia', vi.fn((q: string) => ({
    matches: on && q.includes('reduce'), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })));
}

describe('the canvas animator', () => {
  test('draws the picture at its natural size, then warps it at ~30 fps', () => {
    reducedMotion(false);
    const f = fakeCanvas();
    const el = petSprite('fox', 'study', 150);
    document.body.appendChild(el);
    f.load();
    const c = el.querySelector('canvas')!;
    expect([c.width, c.height]).toEqual([471, 311]);
    const shown = f.ctxs.find((x) => x.putImageData.mock.calls.length > 0)!;
    // The whole picture, then its first frame: only the box around the ears and tail.
    expect(shown.putImageData).toHaveBeenCalledTimes(2);
    expect(shown.putImageData.mock.calls[0]!.length).toBe(3);
    const [, , , dx, dy, dw, dh] = shown.putImageData.mock.calls[1]! as number[];
    expect(dx).toBeGreaterThan(0);
    expect(dy).toBe(0);
    expect(dx + dw!).toBeLessThanOrEqual(471);
    expect(dh).toBeLessThan(311);
    expect(f.frames.length).toBe(1);
    // rAF at 60 Hz: every other frame is drawn.
    for (let i = 1; i <= 6; i++) f.frames[f.frames.length - 1]!(1000 + i * 16.7);
    expect(shown.putImageData.mock.calls.length).toBeGreaterThanOrEqual(2 + 3);
    expect(shown.putImageData.mock.calls.length).toBeLessThanOrEqual(2 + 4);
    el.remove();
  });

  test('reduced motion: the unwarped picture is drawn once and nothing loops', () => {
    reducedMotion(true);
    const f = fakeCanvas();
    const el = petSprite('fox', 'study', 150);
    document.body.appendChild(el);
    f.load();
    const shown = f.ctxs.find((x) => x.putImageData.mock.calls.length > 0)!;
    expect(shown.putImageData).toHaveBeenCalledTimes(1);
    const reader = f.ctxs.find((x) => x.getImageData.mock.calls.length > 0)!;
    expect(shown.putImageData.mock.calls[0]![0]).toBe(reader.getImageData.mock.results[0]!.value);
    expect(f.frames).toHaveLength(0);
    el.remove();
  });

  test('a hidden page pauses the loop; showing it again resumes', () => {
    reducedMotion(false);
    const f = fakeCanvas();
    let hidden = false;
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    const el = petSprite('cat', 'break', 150);
    document.body.appendChild(el);
    f.load();
    expect(f.frames).toHaveLength(1);
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(globalThis.cancelAnimationFrame).toHaveBeenCalled();
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(f.frames).toHaveLength(2);
    el.remove();
  });

  test('a mood or animal change keeps the canvas and swaps the picture only once it has loaded', () => {
    reducedMotion(false);
    const f = fakeCanvas();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const slot = spriteSlot(host, 150, 'art/', { maxWidth: 320 });
    slot.set('cat', 'study');
    f.load();
    const c = host.querySelector('canvas')!;
    const seen: unknown[] = [];
    host.addEventListener('sprite:picture', (e) => seen.push((e as CustomEvent).detail));
    slot.set('cat', 'sleep');
    // Not loaded yet: the old picture (and its size) is still up.
    expect(c.dataset.src).toBe('art/scenes/cat-study.png');
    expect(host.querySelector<HTMLElement>('.sprite')!.style.width).toBe(`${spriteSize('cat', 'study', 150, 320)[0]}px`);
    expect(overlayKinds(host)).toEqual(['zz']);
    f.load();
    expect(host.querySelector('canvas')).toBe(c);
    expect(c.dataset.src).toBe('art/scenes/cat-sleep.png');
    expect([c.width, c.height]).toEqual([416, 215]);
    expect(host.querySelector<HTMLElement>('.sprite')!.style.width).toBe(`${spriteSize('cat', 'sleep', 150, 320)[0]}px`);
    slot.set('dog', 'break');
    f.load();
    expect(host.querySelector('canvas')).toBe(c);
    expect(host.querySelectorAll('.sprite')).toHaveLength(1);
    expect(c.dataset.src).toBe('art/scenes/dog-break.png');
    expect(host.querySelector<HTMLElement>('.sprite')!.dataset.animal).toBe('dog');
    expect(host.querySelector<HTMLElement>('.sprite')!.style.width).toBe('320px');
    expect(seen).toEqual([
      { width: 290, height: 150, src: 'art/scenes/cat-sleep.png' },
      { width: 320, height: 120, src: 'art/scenes/dog-break.png' },
    ]);
    // A superseded load never shows: break → study before break's image arrives.
    slot.set('dog', 'wave');
    slot.set('dog', 'study');
    f.load();
    expect(c.dataset.src).toBe('art/scenes/dog-study.png');
    host.remove();
  });

  test('a tainted canvas falls back to a plain <img> of the same picture', () => {
    reducedMotion(false);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = fakeCanvas({ tainted: true });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const slot = spriteSlot(host, 150);
    slot.set('bunny', 'study');
    f.load();
    expect(host.querySelector('canvas')).toBeNull();
    const img = host.querySelector<HTMLImageElement>('img.sp-art')!;
    expect(img.getAttribute('src')).toBe('art/scenes/bunny-study.png');
    expect(img.dataset.src).toBe('art/scenes/bunny-study.png');
    expect(img.alt).toBe('Bunny');
    expect(img.draggable).toBe(false);
    expect(img.style.height).toBe('150px');
    expect(warn).toHaveBeenCalled();
    expect(f.frames).toHaveLength(0);
    // Later moods still swap the picture, on the <img>.
    slot.set('bunny', 'sleep');
    f.load();
    expect(host.querySelector<HTMLImageElement>('img.sp-art')).toBe(img);
    expect(img.getAttribute('src')).toBe('art/scenes/bunny-sleep.png');
    host.remove();
  });

  test('a canvas that fails on a later picture falls back at that picture’s size', () => {
    reducedMotion(false);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = fakeCanvas();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const slot = spriteSlot(host, 150, 'art/', { maxWidth: 320 });
    slot.set('dog', 'study');
    f.load();
    for (const c of f.ctxs) c.getImageData.mockImplementation(() => { throw new DOMException('tainted', 'SecurityError'); });
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(() => f.ctxs[0] as unknown as CanvasRenderingContext2D);
    slot.set('dog', 'break');
    f.load();
    const img = host.querySelector<HTMLImageElement>('img.sp-art')!;
    expect(img.getAttribute('src')).toBe('art/scenes/dog-break.png');
    expect(img.style.width).toBe('320px');
    expect(img.style.height).toBe('120px');
    expect(host.querySelector<HTMLElement>('.sprite')!.style.height).toBe('120px');
    host.remove();
  });

  test('removed from the page: the loop stops', () => {
    reducedMotion(false);
    const f = fakeCanvas();
    const el = petSprite('fox', 'study', 150);
    document.body.appendChild(el);
    f.load();
    f.frames.at(-1)!(100);
    const n = f.frames.length;
    el.remove();
    f.frames.at(-1)!(200);
    expect(f.frames.length).toBe(n);
  });
});

describe('sprite.css', () => {
  const css = readFileSync(join(here, '../buddy/sprite.css'), 'utf8');
  test.each(['study', 'wave', 'break', 'alert', 'sleep', 'sad', 'celebrate'])('has motion for %s', (mood) => {
    expect(css).toMatch(new RegExp(`\\.sprite--${mood}[^{]*\\{[^}]*animation`));
  });
  test('the preview\'s timings: breathe 3.6 s, sway 3.2 s, snooze 5 s', () => {
    expect(css).toMatch(/\.sprite--study[^{]*\{[^}]*sp-breathe 3\.6s/);
    expect(css).toMatch(/\.sprite--break[^{]*\{[^}]*sp-sway 3\.2s/);
    expect(css).toMatch(/\.sprite--sleep[^{]*\{[^}]*sp-snooze 5s/);
  });
  test('sad shakes for 3 s', () => expect(css).toMatch(/\.sprite--sad[^{]*\{[^}]*animation:[^;]*\b3s\b/));
  test('all motion stops for reduced motion (the doodles stay)', () => {
    const rm = css.slice(css.indexOf('prefers-reduced-motion'));
    expect(rm).toMatch(/\.sprite,\s*\.sprite \*[^{]*\{[^}]*animation:\s*none/);
    expect(rm).not.toMatch(/display:\s*none|visibility:\s*hidden/);
  });
});

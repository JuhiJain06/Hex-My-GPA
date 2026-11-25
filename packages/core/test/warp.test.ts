/// <reference types="node" />
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { partAngle, partsBox, prepareParts, warpFrame, type WarpPart } from '../buddy/warp';
import type { RigPart } from '../buddy/rigs';

const here = dirname(fileURLToPath(import.meta.url));

/** An opaque W×H image whose pixel (x, y) is RGBA (x, y, (x*7+y*13)&255, 255): its color says where it came from. */
function coordImage(w: number, h: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    d[o] = x; d[o + 1] = y; d[o + 2] = (x * 7 + y * 13) & 255; d[o + 3] = 255;
  }
  return d;
}
const px = (d: ArrayLike<number>, w: number, x: number, y: number) => {
  const o = (y * w + x) * 4;
  return [d[o], d[o + 1], d[o + 2], d[o + 3]];
};

const W = 120;
const H = 100;
const earUp: RigPart = { k: 'ear', b: [60, 70], t: [60, 30] }; // 40 px long, pointing up
const fixed = (a: number) => ({ angle: () => a });

describe('warpFrame', () => {
  test('zero angle is the identity', () => {
    const src = coordImage(W, H);
    const dst = new Uint8ClampedArray(src.length);
    warpFrame(src, dst, W, H, prepareParts([earUp], W, H, [0]), 1.23, fixed(0));
    expect([...dst]).toEqual([...src]);
  });

  test('the pixel at the base never moves', () => {
    const src = coordImage(W, H);
    const dst = new Uint8ClampedArray(src.length);
    for (const a of [-0.3, 0.2, 0.5]) {
      warpFrame(src, dst, W, H, prepareParts([earUp], W, H, [0]), 0, fixed(a));
      expect(px(dst, W, 60, 70)).toEqual(px(src, W, 60, 70));
    }
  });

  test('the pixel at the tip moves by about angle × length (rotated about the base)', () => {
    const src = coordImage(W, H);
    const dst = new Uint8ClampedArray(src.length);
    const a = 0.2;
    warpFrame(src, dst, W, H, prepareParts([earUp], W, H, [0]), 0, fixed(a));
    const [sx, sy] = px(dst, W, 60, 30) as [number, number];
    // The tip shows the pixel that sat `a` radians away around the base, 40 px out.
    expect(Math.hypot(sx - 60, sy - 30)).toBeGreaterThan(a * 40 - 1.5);
    expect(Math.hypot(sx - 60, sy - 30)).toBeLessThan(a * 40 + 1.5);
    expect(Math.hypot(sx - 60, sy - 70)).toBeCloseTo(40, -0.5);
    // Inverse mapping: a positive angle samples from the clockwise side, so the ear leans the other way.
    expect(sx).toBeLessThan(60);
  });

  test('pixels outside the part\'s capsule are untouched', () => {
    const src = coordImage(W, H);
    const dst = new Uint8ClampedArray(src.length);
    warpFrame(src, dst, W, H, prepareParts([earUp], W, H, [0]), 0, fixed(0.4));
    // r = max(18, 0.55 * 40) = 22: well to the side, below the base, and beyond 1.35 × the length.
    for (const [x, y] of [[60 + 30, 50], [60 - 30, 40], [60, 80], [60, 70 - 40 * 1.35 - 2], [5, 5], [115, 95]] as [number, number][]) {
      expect(px(dst, W, x, y), `${x},${y}`).toEqual(px(src, W, x, y));
    }
  });

  test('a sample from outside the image is transparent', () => {
    const src = coordImage(W, H);
    const dst = new Uint8ClampedArray(src.length);
    const edge: RigPart = { k: 'ear', b: [2, 40], t: [2, 10] }; // up the left edge
    warpFrame(src, dst, W, H, prepareParts([edge], W, H, [0]), 0, fixed(1.2));
    // The tip turns 1.2 rad about the base: it samples ~28 px left of the image.
    expect(px(dst, W, 2, 10)[3]).toBe(0);
  });

  test('dst starts as a copy of src (so parts only change their own boxes)', () => {
    const src = coordImage(W, H);
    const dst = new Uint8ClampedArray(src.length).fill(7);
    warpFrame(src, dst, W, H, [], 0, fixed(0.3));
    expect([...dst]).toEqual([...src]);
  });

  test('boxesOnly: frame after frame on the same buffer gives the same pixels as a full copy', () => {
    const src = coordImage(W, H);
    const parts = prepareParts([earUp, { k: 'tail', b: [20, 90], t: [5, 60] }], W, H, [0, 1.7]);
    const full = new Uint8ClampedArray(src.length);
    const boxed = new Uint8ClampedArray(src);
    for (const t of [0.1, 0.5, 1.3, 2.2, 7.9]) {
      warpFrame(src, full, W, H, parts, t);
      warpFrame(src, boxed, W, H, parts, t, { boxesOnly: true });
      expect([...boxed]).toEqual([...full]);
    }
    expect(partsBox(parts)).toEqual([
      Math.min(parts[0]!.x0, parts[1]!.x0), Math.min(parts[0]!.y0, parts[1]!.y0),
      Math.max(parts[0]!.x1, parts[1]!.x1), Math.max(parts[0]!.y1, parts[1]!.y1),
    ]);
    expect(partsBox([])).toBeNull();
  });

  test('each part works only inside its clamped bounding box', () => {
    const [p] = prepareParts([{ k: 'tail', b: [10, 90], t: [110, 95] }], W, H, [0]) as [WarpPart];
    expect(p.x0).toBe(0);
    expect(p.y1).toBe(H);
    expect(p.x1).toBeLessThanOrEqual(W);
    expect(p.r).toBeCloseTo(0.55 * Math.hypot(100, 5));
  });
});

describe('partAngle', () => {
  const ts = Array.from({ length: 4000 }, (_, i) => i * 0.013);
  const max = (f: (t: number) => number) => Math.max(...ts.map((t) => Math.abs(f(t))));

  test('tails swish slowly: ±0.13 rad awake, ±0.05 asleep', () => {
    const p = { k: 'tail' as const, ph: 0.4 };
    expect(max((t) => partAngle(p, t, false))).toBeLessThanOrEqual(0.13);
    expect(max((t) => partAngle(p, t, false))).toBeGreaterThan(0.12);
    expect(max((t) => partAngle(p, t, true))).toBeLessThanOrEqual(0.05);
  });

  test('ears sway with an occasional quick twitch awake; small and slow asleep, no twitch', () => {
    const p = { k: 'ear' as const, ph: 1.1 };
    const awake = max((t) => partAngle(p, t, false));
    expect(awake).toBeGreaterThan(0.1); // the twitch shows
    expect(awake).toBeLessThanOrEqual(0.06 + 0.16);
    expect(max((t) => partAngle(p, t, true))).toBeLessThanOrEqual(0.03);
  });
});

/**
 * The approved preview (art/warp-prototype.js) runs unchanged against a fake canvas; the port must
 * produce the same pixels for the same rig, phases and time.
 */
describe('matches the approved prototype', () => {
  function runPrototype(src: Uint8ClampedArray, w: number, h: number, parts: RigPart[], slow: boolean, ms: number) {
    const code = readFileSync(join(here, '../buddy/art/warp-prototype.js'), 'utf8');
    let put: Uint8ClampedArray | null = null;
    let frame: ((ms: number) => void) | null = null;
    const ctx = {
      drawImage() {},
      getImageData: () => ({ data: src.slice() }),
      createImageData: (W: number, H: number) => ({ data: new Uint8ClampedArray(W * H * 4) }),
      putImageData: (img: { data: Uint8ClampedArray }) => { put = img.data.slice(); },
    };
    const win: Record<string, unknown> = {};
    const doc = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
    const raf = (cb: (ms: number) => void) => { frame = cb; };
    const math = Object.create(Math, { random: { value: () => 0 } });
    new Function('window', 'document', 'requestAnimationFrame', 'Math', code)(win, doc, raf, math);
    const warpCanvas = win.warpCanvas as (img: unknown, parts: RigPart[], slow: boolean) => unknown;
    warpCanvas({ naturalWidth: w, naturalHeight: h }, parts, slow);
    frame!(ms);
    return { out: put!, rig: win.RIG as Record<string, RigPart[]> };
  }

  test.each([
    ['ears and a tail, awake', false, 1234],
    ['ears and a tail, awake, mid-twitch time', false, 1745],
    ['asleep', true, 5100],
  ])('%s', (_name, slow, ms) => {
    const w = 140;
    const h = 120;
    const src = coordImage(w, h);
    const parts: RigPart[] = [
      { k: 'ear', b: [40, 60], t: [30, 15] },
      { k: 'ear', b: [90, 55], t: [104, 12] },
      { k: 'tail', b: [100, 100], t: [135, 70] },
    ];
    const { out } = runPrototype(src, w, h, parts, slow as boolean, ms as number);
    const dst = new Uint8ClampedArray(src.length);
    // Math.random() = 0 in the prototype: phases i * 1.7.
    warpFrame(src, dst, w, h, prepareParts(parts, w, h, parts.map((_, i) => i * 1.7)), (ms as number) / 1000, { slow: slow as boolean });
    expect(dst.length).toBe(out.length);
    let diff = 0;
    for (let i = 0; i < dst.length; i++) if (dst[i] !== out[i]) diff++;
    expect(diff).toBe(0);
    // And the frame really moved something.
    let moved = 0;
    for (let i = 0; i < dst.length; i++) if (dst[i] !== src[i]) moved++;
    expect(moved).toBeGreaterThan(0);
  });

  test('the fox and bunny scene rigs are the approved ones', async () => {
    const { RIGS } = await import('../buddy/rigs');
    const { rig } = runPrototype(coordImage(4, 4), 4, 4, [], false, 0);
    for (const [key, parts] of Object.entries(rig)) {
      expect(RIGS[key as keyof typeof RIGS], key).toEqual(parts);
    }
    expect(Object.keys(rig).sort()).toEqual(['bunny-break', 'bunny-sleep', 'bunny-study', 'fox-break', 'fox-sleep', 'fox-study']);
  });
});

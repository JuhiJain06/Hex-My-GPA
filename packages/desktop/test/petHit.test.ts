import { describe, test, expect } from 'vitest';
import { ALPHA_HIT, HIT_INSET, HitSync, MaskCache, alphaFromRgba, spriteHit, type AlphaMask } from '../src/shared/pet';

/**
 * A 4×3 image:   x=0  x=1  x=2  x=3
 *          y=0     0    0  255    0
 *          y=1     0   41   40    0
 *          y=2   200  200  200  200
 */
const mask: AlphaMask = { width: 4, height: 3, alpha: Uint8Array.from([0, 0, 255, 0, 0, 41, 40, 0, 200, 200, 200, 200]) };
/** Drawn at 2× in the page, its top-left at (100, 50). */
const rect = { left: 100, top: 50, width: 8, height: 6 };
const at = (ix: number, iy: number) => spriteHit(rect, mask, 100 + ix * 2 + 1, 50 + iy * 2 + 1);

describe('spriteHit with the image alpha', () => {
  test('the threshold is alpha > 40', () => expect(ALPHA_HIT).toBe(40));
  test('opaque pixels hit, transparent ones pass through', () => {
    expect(at(2, 0)).toBe(true);
    expect(at(0, 0)).toBe(false);
    expect(at(3, 1)).toBe(false);
    for (let x = 0; x < 4; x++) expect(at(x, 2)).toBe(true);
  });
  test('41 hits, 40 does not', () => {
    expect(at(1, 1)).toBe(true);
    expect(at(2, 1)).toBe(false);
  });
  test('scales page coordinates to image pixels', () => {
    expect(spriteHit(rect, mask, 104, 50)).toBe(true); // image (2, 0)
    expect(spriteHit(rect, mask, 103.9, 50)).toBe(false); // image (1, 0)
  });
  test('outside the image box never hits', () => {
    expect(spriteHit(rect, mask, 99, 55)).toBe(false);
    expect(spriteHit(rect, mask, 108, 55)).toBe(false); // right edge is exclusive
    expect(spriteHit(rect, mask, 104, 56)).toBe(false);
    expect(spriteHit(rect, mask, 104, 49)).toBe(false);
  });
  test('a zero-size box never hits', () => {
    expect(spriteHit({ left: 0, top: 0, width: 0, height: 0 }, mask, 0, 0)).toBe(false);
  });
});

describe('spriteHit without alpha (tainted canvas): the box minus a 15% inset', () => {
  const box = { left: 0, top: 0, width: 100, height: 200 };
  test('the inset is 15%', () => expect(HIT_INSET).toBe(0.15));
  test('inside the inset box hits, the margin does not', () => {
    expect(spriteHit(box, null, 50, 100)).toBe(true);
    expect(spriteHit(box, null, 15, 30)).toBe(true);
    expect(spriteHit(box, null, 14.9, 100)).toBe(false);
    expect(spriteHit(box, null, 85.1, 100)).toBe(false);
    expect(spriteHit(box, null, 50, 29.9)).toBe(false);
    expect(spriteHit(box, null, 50, 170.1)).toBe(false);
  });
});

describe('alphaFromRgba', () => {
  test('keeps every 4th byte', () => {
    const rgba = Uint8ClampedArray.from([1, 2, 3, 0, 9, 9, 9, 41, 0, 0, 0, 255]);
    expect([...alphaFromRgba(rgba)]).toEqual([0, 41, 255]);
  });
});

describe('MaskCache (a picture swap under a resting pointer)', () => {
  test('loads each picture once; undefined while loading; onReady when it arrives', () => {
    const loads: [string, (m: AlphaMask | null) => void][] = [];
    const ready: string[] = [];
    const cache = new MaskCache((key, done) => loads.push([key, done]), (key) => ready.push(key));
    expect(cache.get('art/scenes/dog-break.png')).toBeUndefined();
    expect(cache.get('art/scenes/dog-break.png')).toBeUndefined();
    expect(loads).toHaveLength(1);
    expect(ready).toEqual([]);
    loads[0]![1](mask);
    expect(ready).toEqual(['art/scenes/dog-break.png']);
    expect(cache.get('art/scenes/dog-break.png')).toBe(mask);
    expect(loads).toHaveLength(1);
  });
  test('an unreadable picture is cached as null (the inset box) and still reports ready', () => {
    const ready: string[] = [];
    const cache = new MaskCache((_k, done) => done(null), (key) => ready.push(key));
    expect(cache.get('a.png')).toBeUndefined(); // done() ran synchronously inside get
    expect(ready).toEqual(['a.png']);
    expect(cache.get('a.png')).toBeNull();
  });
  test('re-testing after a swap reaches main both ways (update), which settled() + update would not', () => {
    const sent: boolean[] = [];
    const hits = new HitSync((h) => sent.push(h));
    hits.update(true); // resting over the standing pose: the window catches clicks
    // The wider, shorter scene now leaves the pointer over nothing: must turn click-through back on.
    hits.update(false);
    expect(sent).toEqual([true, false]);
    // resyncHit's settled() would have forgotten the "true" and sent nothing, leaving the window catching clicks.
    const sent2: boolean[] = [];
    const h2 = new HitSync((h) => sent2.push(h));
    h2.update(true);
    h2.settled();
    h2.update(false);
    expect(sent2).toEqual([true]);
  });
});

import { describe, test, expect } from 'vitest';
import {
  PET_MARGIN, clampPetPos, defaultPetPos, menuBounds, parsePetDrag, parsePetMenu, parsePetSize, restorePetPos,
} from '../src/main/petPosition';
import { PET_FOOT_GAP, PET_H, PET_W } from '../src/shared/layout';

const size = { width: PET_W, height: PET_H };
const primary = { x: 0, y: 0, width: 1920, height: 1040 }; // taskbar at the bottom (1080 - 40)
const right = { x: 1920, y: 0, width: 1280, height: 984 };

describe('defaultPetPos', () => {
  test('bottom-right of the work area, 12 px from the right edge, standing on a bottom taskbar', () => {
    expect(PET_MARGIN).toBe(12);
    expect(defaultPetPos(primary, size)).toEqual({ x: 1920 - PET_W - 12, y: 1040 - PET_H });
  });
  test('the feet of the pet sit 6 px above the work-area bottom (the window bottom is the work-area bottom)', () => {
    expect(PET_FOOT_GAP).toBe(6);
    const p = defaultPetPos(primary, size);
    expect(p.y + PET_H - PET_FOOT_GAP).toBe(1040 - 6);
  });
  test('the same rule works for a taskbar on the left or top (work area already excludes it)', () => {
    const leftBar = { x: 48, y: 0, width: 1872, height: 1080 };
    expect(defaultPetPos(leftBar, size)).toEqual({ x: 48 + 1872 - PET_W - 12, y: 1080 - PET_H });
    const topBar = { x: 0, y: 40, width: 1920, height: 1040 };
    expect(defaultPetPos(topBar, size)).toEqual({ x: 1920 - PET_W - 12, y: 40 + 1040 - PET_H });
  });
  test('rounds to whole pixels', () => {
    const p = defaultPetPos({ x: 0.5, y: 0.25, width: 1000.3, height: 700.7 }, size);
    expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true);
  });
});

describe('clampPetPos', () => {
  const displays = [primary, right];
  test('a position fully on a display is kept', () => {
    expect(clampPetPos({ x: 100, y: 200 }, displays, size)).toEqual({ x: 100, y: 200 });
    expect(clampPetPos({ x: 2000, y: 100 }, displays, size)).toEqual({ x: 2000, y: 100 });
  });
  test('dragged past an edge: pulled back fully on screen', () => {
    expect(clampPetPos({ x: -500, y: -40 }, displays, size)).toEqual({ x: 0, y: 0 });
    expect(clampPetPos({ x: 100, y: 1200 }, displays, size)).toEqual({ x: 100, y: 1040 - PET_H });
  });
  test('straddling two displays: clamped onto the display holding its center', () => {
    // Center just right of the seam (1920): onto the right display; just left of it: onto the primary.
    expect(clampPetPos({ x: 1920 - PET_W / 2 + 20, y: 100 }, displays, size)).toEqual({ x: 1920, y: 100 });
    expect(clampPetPos({ x: 1920 - PET_W / 2 - 20, y: 100 }, displays, size)).toEqual({ x: 1920 - PET_W, y: 100 });
  });
  test('in a gap below the shorter display: goes to the nearest display', () => {
    const p = clampPetPos({ x: 2500, y: 1000 }, displays, size);
    expect(p).toEqual({ x: 2500, y: 984 - PET_H });
  });
  test('a removed display: lands on the remaining one', () => {
    expect(clampPetPos({ x: 2500, y: 300 }, [primary], size)).toEqual({ x: 1920 - PET_W, y: 300 });
  });
  test('no displays: returned unchanged', () => {
    expect(clampPetPos({ x: 5, y: 6 }, [], size)).toEqual({ x: 5, y: 6 });
  });
});

describe('restorePetPos', () => {
  const ds = [{ id: 1, workArea: primary }, { id: 2, workArea: right }];
  test('nothing saved: the default spot on the primary display', () => {
    expect(restorePetPos(null, ds, 1, size)).toEqual(defaultPetPos(primary, size));
  });
  test('saved on a display that is still there: kept (clamped)', () => {
    expect(restorePetPos({ x: 2100, y: 300, displayId: 2 }, ds, 1, size)).toEqual({ x: 2100, y: 300 });
    expect(restorePetPos({ x: 2100, y: 5000, displayId: 2 }, ds, 1, size)).toEqual({ x: 2100, y: 984 - PET_H });
  });
  test('saved on a display that is gone: the default spot on the primary display', () => {
    expect(restorePetPos({ x: 2100, y: 300, displayId: 9 }, ds, 1, size)).toEqual(defaultPetPos(primary, size));
  });
  test('unknown primary id falls back to the first display', () => {
    expect(restorePetPos(null, ds, 77, size)).toEqual(defaultPetPos(primary, size));
  });
});

describe('menuBounds', () => {
  const X = 1920 - PET_W - 12; // default spot
  const pet = { x: X, y: 1040 - PET_H, width: PET_W, height: PET_H };
  test('pet on the right half: the menu opens to its left, growing upward from the pet\'s bottom', () => {
    const r = menuBounds(pet, { width: 210, height: 300 }, primary);
    expect(r.side).toBe('left');
    expect(r.anchor).toBe('bottom');
    expect(r.bounds).toEqual({ x: X - 210, y: 1040 - 300, width: PET_W + 210, height: 300 });
  });
  test('pet on the left half: the menu opens to its right', () => {
    const r = menuBounds({ ...pet, x: 20 }, { width: 210, height: 150 }, primary);
    expect(r.side).toBe('right');
    expect(r.bounds.x).toBe(20);
    expect(r.bounds.height).toBe(PET_H); // never shorter than the pet
  });
  test('pet near the top: the window grows downward instead', () => {
    const r = menuBounds({ ...pet, y: 10 }, { width: 210, height: 400 }, primary);
    expect(r.anchor).toBe('top');
    expect(r.bounds.y).toBe(10);
  });
  test('the pet itself never moves on screen', () => {
    for (const p of [pet, { ...pet, x: 20 }, { ...pet, y: 10 }]) {
      const r = menuBounds(p, { width: 210, height: 400 }, primary);
      const petX = r.side === 'left' ? r.bounds.x + r.bounds.width - PET_W : r.bounds.x;
      const petY = r.anchor === 'bottom' ? r.bounds.y + r.bounds.height - PET_H : r.bounds.y;
      expect({ x: petX, y: petY }).toEqual({ x: p.x, y: p.y });
    }
  });
  test('a menu taller than the work area is capped', () => {
    const r = menuBounds(pet, { width: 210, height: 5000 }, primary);
    expect(r.bounds.height).toBeLessThanOrEqual(primary.height);
  });
});

describe('IPC payload parsers', () => {
  test('pet:drag accepts finite deltas up to 5000', () => {
    expect(parsePetDrag({ dx: 3, dy: -4 })).toEqual({ dx: 3, dy: -4 });
    expect(parsePetDrag({ dx: 5000, dy: -5000 })).toEqual({ dx: 5000, dy: -5000 });
  });
  test.each([
    [null], [5], ['x'], [{}], [{ dx: 1 }], [{ dx: NaN, dy: 0 }], [{ dx: Infinity, dy: 0 }],
    [{ dx: 5001, dy: 0 }], [{ dx: 0, dy: -5001 }], [{ dx: '1', dy: 0 }], [[1, 2]],
  ])('pet:drag rejects %j', (p) => expect(parsePetDrag(p)).toBeNull());

  test('pet:menu: open with a size, or closed', () => {
    expect(parsePetMenu({ open: false })).toEqual({ open: false });
    expect(parsePetMenu({ open: true, width: 210, height: 300 })).toEqual({ open: true, size: { width: 210, height: 300 } });
  });
  test.each([
    [null], [{}], [{ open: 'yes' }], [{ open: true }], [{ open: true, width: 210 }],
    [{ open: true, width: -1, height: 10 }], [{ open: true, width: 210, height: NaN }], [{ open: true, width: 9999, height: 10 }],
  ])('pet:menu rejects %j', (p) => expect(parsePetMenu(p)).toBeNull());

  test('pet:layout size', () => {
    expect(parsePetSize({ width: 210.4, height: 300.6 })).toEqual({ width: 210, height: 301 });
    expect(parsePetSize({ width: 0, height: 300 })).toBeNull();
    expect(parsePetSize({ width: 210, height: 3001 })).toBeNull();
    expect(parsePetSize('x')).toBeNull();
  });
});

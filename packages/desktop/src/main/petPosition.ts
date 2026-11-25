/**
 * Where the desktop pet sits, and where its menu opens. Pure (no Electron imports), so it is unit
 * tested; petWindow.ts feeds it the real displays. All values are screen DIPs.
 */
import type { PetPos } from '@study-buddy/core';
import type { PetMenuLayout } from '../shared/ipc';
import type { Rect } from '../shared/layout';

export interface Point { x: number; y: number }
export interface Size { width: number; height: number }

/** Gap between the pet and the work-area edges at its default spot. */
export const PET_MARGIN = 12;
/** Largest drag step accepted from the renderer (one pointer move). */
export const MAX_DRAG = 5000;
/** Largest menu the renderer may ask room for. */
const MAX_MENU = { width: 600, height: 3000 } as const;

/** Bottom-right of the work area, 12 px from the edges: just above a bottom taskbar (work areas exclude it). */
export function defaultPetPos(workArea: Rect, size: Size): Point {
  return {
    x: Math.round(workArea.x + workArea.width - size.width - PET_MARGIN),
    y: Math.round(workArea.y + workArea.height - size.height - PET_MARGIN),
  };
}

function clampInto(p: Point, r: Rect, size: Size): Point {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));
  return { x: clamp(p.x, r.x, r.x + r.width - size.width), y: clamp(p.y, r.y, r.y + r.height - size.height) };
}

/** Distance from a point to a rectangle (0 inside). */
function distance(px: number, py: number, r: Rect): number {
  const dx = Math.max(r.x - px, 0, px - (r.x + r.width));
  const dy = Math.max(r.y - py, 0, py - (r.y + r.height));
  return Math.hypot(dx, dy);
}

/**
 * Keeps the whole pet on one display: the one holding its center, else the nearest one. `displays`
 * are work areas (so the pet never hides under a taskbar). No displays: returned unchanged.
 */
export function clampPetPos(p: Point, displays: Rect[], size: Size): Point {
  if (displays.length === 0) return { ...p };
  const cx = p.x + size.width / 2;
  const cy = p.y + size.height / 2;
  let best = displays[0]!;
  let bestD = Infinity;
  for (const d of displays) {
    const dist = distance(cx, cy, d);
    if (dist < bestD) { best = d; bestD = dist; }
  }
  return clampInto(p, best, size);
}

export interface DisplayInfo { id: number; workArea: Rect }

/**
 * Where the pet opens: its saved spot (kept on the display it was left on) if that display is still
 * connected, else the default spot on the primary display.
 */
export function restorePetPos(saved: PetPos | null, displays: DisplayInfo[], primaryId: number, size: Size): Point {
  const on = saved ? displays.find((d) => d.id === saved.displayId) : undefined;
  if (saved && on) return clampInto({ x: saved.x, y: saved.y }, on.workArea, size);
  const primary = displays.find((d) => d.id === primaryId) ?? displays[0];
  return primary ? defaultPetPos(primary.workArea, size) : { x: 0, y: 0 };
}

/**
 * The window bounds while the menu is open: the menu goes on the roomier side of the pet (left when
 * the pet is on the right half of its display), and the window grows up from the pet's bottom
 * (down from its top when there is no room above). The pet itself never moves on screen.
 */
export function menuBounds(pet: Rect, menu: Size, workArea: Rect): PetMenuLayout & { bounds: Rect } {
  const side: PetMenuLayout['side'] = pet.x + pet.width / 2 > workArea.x + workArea.width / 2 ? 'left' : 'right';
  const height = Math.min(Math.max(pet.height, menu.height), Math.max(pet.height, workArea.height));
  const anchor: PetMenuLayout['anchor'] = pet.y + pet.height - height >= workArea.y ? 'bottom' : 'top';
  return {
    side,
    anchor,
    bounds: {
      x: side === 'left' ? pet.x - menu.width : pet.x,
      y: anchor === 'bottom' ? pet.y + pet.height - height : pet.y,
      width: pet.width + menu.width,
      height,
    },
  };
}

// ---- IPC payloads from the pet renderer (validated before main acts on them) ----

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** `pet:drag`: `{dx, dy}`, finite and each at most 5000 px either way. */
export function parsePetDrag(p: unknown): { dx: number; dy: number } | null {
  if (!isObj(p) || !finite(p.dx) || !finite(p.dy)) return null;
  if (Math.abs(p.dx) > MAX_DRAG || Math.abs(p.dy) > MAX_DRAG) return null;
  return { dx: p.dx, dy: p.dy };
}

/** `pet:layout`: the menu's size, rounded; positive and not absurd. */
export function parsePetSize(p: unknown): Size | null {
  if (!isObj(p) || !finite(p.width) || !finite(p.height)) return null;
  if (p.width <= 0 || p.height <= 0 || p.width > MAX_MENU.width || p.height > MAX_MENU.height) return null;
  return { width: Math.round(p.width), height: Math.round(p.height) };
}

/** `pet:menu`: `{open: false}` or `{open: true, width, height}`. */
export function parsePetMenu(p: unknown): { open: false } | { open: true; size: Size } | null {
  if (!isObj(p) || typeof p.open !== 'boolean') return null;
  if (!p.open) return { open: false };
  const size = parsePetSize(p);
  return size ? { open: true, size } : null;
}

/** The desktop pet's speech bubble: what it says, and its queue of one-off notices. Pure. */
import type { UiState } from './ipc';

/** How long a one-off notice replaces the bubble's timer text. */
export const TRANSIENT_MS = 6000;
/** Longest topic shown in "Back to <topic>?". */
const TOPIC_MAX = 24;

const pad = (n: number) => String(n).padStart(2, '0');
const secondsLeft = (ms: number) => Math.max(0, Math.ceil(ms / 1000));

function shorten(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * The bubble's everyday text: "mm:ss" left in a focus block, "Paused", "Break · m:ss", or
 * "Back to <topic>?" once a break is over. Empty when there is nothing to say.
 */
export function bubbleText(ui: Pick<UiState, 'phase' | 'topic' | 'phaseEndsAt' | 'pausedSince'>, now: number): string {
  switch (ui.phase) {
    case 'focus': {
      if (ui.pausedSince !== null) return 'Paused';
      if (ui.phaseEndsAt === null) return '';
      const s = secondsLeft(ui.phaseEndsAt - now);
      return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
    }
    case 'break': {
      if (ui.phaseEndsAt === null) return 'Break';
      const s = secondsLeft(ui.phaseEndsAt - now);
      return `Break · ${Math.floor(s / 60)}:${pad(s % 60)}`;
    }
    case 'awaitingNext':
      return `Back to ${ui.topic ? shorten(ui.topic, TOPIC_MAX) : 'studying'}?`;
    default:
      return '';
  }
}

/** The planned-length notice, e.g. "You hit your planned 1.5 h". */
export function plannedText(plannedMin: number): string {
  const h = Math.round((plannedMin / 60) * 100) / 100;
  return `You hit your planned ${h} h`;
}

/**
 * Show the browser-link warning? Once per session (the pet window lives for one session) and again
 * whenever it changes. `last` is the status seen before (undefined: none yet); null means connected.
 */
export function shouldShowExtNotice(last: string | null | undefined, now: string | null): boolean {
  return now !== null && now !== last;
}

export interface Notice {
  id: string;
  text: string;
  /** Stays (and goes to the front) until dismissed: the planned-length question. */
  sticky?: boolean;
}

/** One-off bubble messages, shown one at a time for TRANSIENT_MS each (sticky ones until dismissed). */
export class NoticeQueue {
  private items: Notice[] = [];
  /** When the head started showing. */
  private headSince: number | null = null;

  push(n: Notice, now: number): void {
    const wasHead = this.items[0]?.id === n.id;
    this.items = this.items.filter((x) => x.id !== n.id);
    if (n.sticky) {
      this.items.unshift(n);
      this.headSince = now;
    } else {
      this.items.push(n);
      if (this.items.length === 1 || wasHead) {
        // Replacing the showing notice (or the first one): it gets its full time from now.
        if (wasHead) this.items.unshift(this.items.pop()!);
        this.headSince = now;
      }
    }
  }

  /** The notice to show now, or null for the everyday text. Expired notices are dropped. */
  current(now: number): Notice | null {
    for (;;) {
      const head = this.items[0];
      if (!head) { this.headSince = null; return null; }
      this.headSince ??= now;
      if (head.sticky || now - this.headSince < TRANSIENT_MS) return head;
      this.items.shift();
      // The next notice starts when the previous one ran out, so it gets its full time.
      this.headSince += TRANSIENT_MS;
    }
  }

  dismiss(id: string): void {
    const wasHead = this.items[0]?.id === id;
    this.items = this.items.filter((x) => x.id !== id);
    if (wasHead) this.headSince = null;
  }
}

/**
 * The renderer's view of main's click-through flag. It sends `pet:hit` only on changes, so whenever
 * main resets the window to click-through (settle: menu closed, re-clamp, reset) the renderer must
 * call `settled()` to forget its cached "true"; the next hover over the pet then re-sends it.
 */
export class HitSync {
  private hit = false;
  constructor(private readonly send: (hit: boolean) => void) {}

  update(h: boolean): void {
    if (h === this.hit) return;
    this.hit = h;
    this.send(h);
  }

  /** Main just set ignore=true (the window passes clicks through again). */
  settled(): void {
    this.hit = false;
  }
}

/**
 * Close the menu on window blur? Not when the document still has focus or a <select> is active:
 * a native select popup can blur the window while the user is picking a sound.
 */
export function closeOnBlur(s: { hasFocus: boolean; activeTag: string | null }): boolean {
  return !s.hasFocus && s.activeTag?.toUpperCase() !== 'SELECT';
}

// ---- Click-through hit-testing against the pet image's own alpha ----

/** A pixel counts as the pet when its alpha is above this (soft edges and stray specks pass through). */
export const ALPHA_HIT = 40;
/** Without alpha (a tainted canvas), the image box shrunk by this much on every side counts. */
export const HIT_INSET = 0.15;

/** The image's alpha channel, one byte per pixel, row by row. */
export interface AlphaMask { width: number; height: number; alpha: ArrayLike<number> }
export interface Box { left: number; top: number; width: number; height: number }

/** The alpha bytes out of canvas RGBA pixel data. */
export function alphaFromRgba(rgba: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(Math.floor(rgba.length / 4));
  for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4 + 3]!;
  return out;
}

/**
 * Is the page point (x, y) on the pet? `box` is where the image is drawn (its client rect).
 * With a mask: the image pixel under the point has alpha > ALPHA_HIT. Without one: inside the box
 * minus a HIT_INSET margin. Pure.
 */
export function spriteHit(box: Box, mask: AlphaMask | null, x: number, y: number): boolean {
  if (!(box.width > 0 && box.height > 0)) return false;
  const u = (x - box.left) / box.width;
  const v = (y - box.top) / box.height;
  if (!(u >= 0 && u < 1 && v >= 0 && v < 1)) return false;
  if (!mask) return u >= HIT_INSET && u <= 1 - HIT_INSET && v >= HIT_INSET && v <= 1 - HIT_INSET;
  const ix = Math.min(mask.width - 1, Math.floor(u * mask.width));
  const iy = Math.min(mask.height - 1, Math.floor(v * mask.height));
  return (mask.alpha[iy * mask.width + ix] ?? 0) > ALPHA_HIT;
}

/**
 * Each picture's alpha mask, loaded once per picture path. `get` answers at once from the cache, or
 * starts the load and answers `undefined` (not known yet); when a load finishes, `onReady` runs so
 * the caller can re-test the resting pointer (the first hover over a new picture can't wait for it).
 */
export class MaskCache {
  private readonly masks = new Map<string, AlphaMask | null>();
  private readonly loading = new Set<string>();

  constructor(
    /** Loads `key`'s mask and calls `done` once (null: unreadable, so the inset box is used). */
    private readonly load: (key: string, done: (mask: AlphaMask | null) => void) => void,
    private readonly onReady: (key: string) => void,
  ) {}

  /** The mask (null: use the inset box), or undefined while it is still loading. */
  get(key: string): AlphaMask | null | undefined {
    if (this.masks.has(key)) return this.masks.get(key)!;
    if (!this.loading.has(key)) {
      this.loading.add(key);
      this.load(key, (mask) => {
        this.loading.delete(key);
        this.masks.set(key, mask);
        this.onReady(key);
      });
    }
    return undefined;
  }
}

import { ANIMALS, type Animal, type Mood } from '../src/index';
import { createAnimator, type Animator } from './animator';
import { PICTURE_SIZE, RIGS, pictureFile, pictureKey, type Picture, type PictureKey, type RigPart } from './rigs';

/**
 * The study buddy as the user's own character art. Each mood shows one of the pet's pictures,
 * unaltered apart from motion: its studying / on-break / asleep scene (art/scenes/) or its standing
 * pose (art/{animal}.png). The ears and tail move (animator.ts, one canvas per sprite), the whole
 * picture breathes or sways (sprite.css), and small sketch doodles add to the mood: twinkles while
 * studying, steam on a break, floating "z" asleep, "!" when it is time to come back, a sweat drop
 * after a slip, hearts and sparkles to celebrate. Built with DOM APIs only (no HTML parsing).
 */

/** The doodles' ink: the dark brown of the art's own outlines. */
export const INK = '#3a2f2a';

/** Natural size [width, height] of each standing pose, art/{animal}.png. */
export const ART_SIZE: Readonly<Record<Animal, readonly [number, number]>> = {
  cat: PICTURE_SIZE.cat,
  fox: PICTURE_SIZE.fox,
  panda: PICTURE_SIZE.panda,
  bunny: PICTURE_SIZE.bunny,
  dog: PICTURE_SIZE.dog,
  hamster: PICTURE_SIZE.hamster,
};

/** Shown width in px of the standing pose drawn `height` px tall (it keeps the art's aspect ratio). */
export function spriteWidth(animal: Animal, height: number): number {
  const [w, h] = ART_SIZE[animal] ?? ART_SIZE.cat;
  return Math.round((height * w) / h);
}

/** Which picture each mood shows (spec Addendum 4). */
export const MOOD_PICTURE: Readonly<Record<Mood, Picture>> = {
  wave: 'stand',
  celebrate: 'stand',
  study: 'study',
  sad: 'study',
  break: 'break',
  alert: 'break',
  sleep: 'sleep',
};

export interface PictureInfo {
  picture: Picture;
  key: PictureKey;
  /** Path under art/. */
  file: string;
  natural: readonly [number, number];
  rig: readonly RigPart[];
  /** Asleep: small, slow part motion. */
  slow: boolean;
}

export function pictureFor(animal: Animal, mood: Mood): PictureInfo {
  const a: Animal = ART_SIZE[animal] ? animal : 'cat';
  const picture = MOOD_PICTURE[mood] ?? 'stand';
  const key = pictureKey(a, picture);
  return { picture, key, file: pictureFile(a, picture), natural: PICTURE_SIZE[key], rig: RIGS[key], slow: mood === 'sleep' };
}

/**
 * Shown [width, height] of a picture `maxH` px tall, its width following the aspect ratio; when that
 * is wider than `maxW`, the picture is made shorter to fit.
 */
export function fitSize(natural: readonly [number, number], maxH: number, maxW = Infinity): [number, number] {
  const [nw, nh] = natural;
  if ((maxH * nw) / nh <= maxW) return [Math.round((maxH * nw) / nh), maxH];
  return [Math.round(maxW), Math.round((maxW * nh) / nw)];
}

/** The size `petSprite(animal, mood, maxH, …, { maxWidth })` shows at. */
export function spriteSize(animal: Animal, mood: Mood, maxH: number, maxW = Infinity): [number, number] {
  return fitSize(pictureFor(animal, mood).natural, maxH, maxW);
}

export type Doodle = 'zz' | 'alert' | 'sweat' | 'hearts' | 'sparkles' | 'twinkle' | 'steam';

/** Which doodles go with each mood (wave is motion only). */
export const OVERLAYS: Readonly<Record<Mood, readonly Doodle[]>> = {
  wave: [],
  study: ['twinkle'],
  alert: ['alert', 'steam'],
  sleep: ['zz'],
  sad: ['sweat'],
  celebrate: ['hearts', 'sparkles'],
  break: ['steam'],
};

/**
 * Where the steam rises in each break scene: over the hot drink, as fractions of the picture
 * [left, top of the rim]. The dog (a water flask) and hamster (a closed acorn) have no hot drink.
 */
export const STEAM_AT: Readonly<Partial<Record<Animal, readonly [number, number]>>> = {
  cat: [0.555, 0.6],
  fox: [0.636, 0.515],
  panda: [0.75, 0.385],
  bunny: [0.153, 0.8],
};

const SVG_NS = 'http://www.w3.org/2000/svg';

interface Stroke { d: string; fill?: string; width?: number; cls?: string }
interface Piece {
  /** viewBox width and height. */
  vb: [number, number];
  strokes: Stroke[];
  /** Size as a fraction of the sprite's height (the piece's height). */
  h: number;
  /** Placement, CSS lengths relative to the sprite box. */
  at: Partial<Record<'left' | 'right' | 'top' | 'bottom', string>>;
  cls?: string;
  /** CSS animation-delay. */
  delay?: string;
}

// Hand-drawn shapes: slightly uneven curves so they read as sketched, like the art.
const Z = 'M4 4.6 C8.4 4 12.6 4.6 17.2 4.1 C12.8 9 8.6 13.8 4.3 18.2 C8.8 17.9 13.6 18.5 18 17.9';
const HEART = 'M12 20.6 C9.4 18.4 3.2 14.3 3.1 8.9 C3 5.8 5.3 3.7 8 3.8 C10.1 3.9 11.4 5.3 12.1 7.1 '
  + 'C12.8 5.2 14.3 3.8 16.4 3.8 C19.2 3.8 21.2 6 20.9 9.1 C20.5 14.1 14.8 18.3 12 20.6 Z';
const SPARKLE = 'M12 2.4 C12.7 8.2 13.6 10.9 21.6 12.1 C13.7 13.1 12.6 15.9 12.1 21.8 '
  + 'C11.4 15.9 10.4 13.2 2.4 12 C10.3 10.8 11.3 8.1 12 2.4 Z';

const zPiece = (h: number, delay: string): Piece => ({
  vb: [22, 22], h, at: { right: '22%', top: '22%' }, cls: 'sp-z', delay, strokes: [{ d: Z, width: 2.6 }],
});

const PIECES: Readonly<Record<Exclude<Doodle, 'twinkle' | 'steam'>, Piece[]>> = {
  // Three z's that rise and fade one after another (sizes as in the approved preview).
  zz: [zPiece(0.11, '0s'), zPiece(0.085, '1.2s'), zPiece(0.067, '2.4s')],
  alert: [{
    vb: [24, 34], h: 0.22, at: { left: '1%', top: '0%' }, cls: 'sp-bang',
    strokes: [
      { d: 'M12.2 4 C11.6 10.2 12.7 15.8 11.8 22.2', width: 3.4 },
      { d: 'M11.9 29.2 C12.1 29.3 12.2 29.6 12 29.8', width: 4 },
      { d: 'M3.6 9.4 C4.8 10.6 5.6 11.5 6.8 12.6', width: 1.8 },
      { d: 'M20.6 9.2 C19.4 10.5 18.5 11.3 17.4 12.5', width: 1.8 },
    ],
  }],
  sweat: [{
    vb: [20, 25], h: 0.15, at: { right: '6%', top: '12%' }, cls: 'sp-drop',
    strokes: [
      { d: 'M10.2 2 C8.4 7 3.4 11.6 3.6 16.2 C3.8 20.6 7.6 22.6 10.6 22.2 C14.2 21.8 16.6 18.8 16.2 15 C15.8 11.2 11.8 7.6 10.2 2 Z', fill: '#cfe8f7', width: 1.8 },
      { d: 'M6.8 15.4 C6.9 17.3 7.9 18.6 9.4 19.1', width: 1.3 },
    ],
  }],
  hearts: [
    { vb: [24, 24], h: 0.16, at: { left: '-6%', top: '8%' }, cls: 'sp-heart', strokes: [{ d: HEART, fill: '#f7b3c2', width: 1.8 }] },
    { vb: [24, 24], h: 0.12, at: { right: '-4%', top: '20%' }, cls: 'sp-heart sp-heart--2', strokes: [{ d: HEART, fill: '#f7b3c2', width: 2 }] },
  ],
  sparkles: [
    { vb: [24, 24], h: 0.11, at: { right: '-2%', top: '0%' }, cls: 'sp-sparkle', strokes: [{ d: SPARKLE, fill: '#fff3c4', width: 1.6 }] },
    { vb: [24, 24], h: 0.09, at: { left: '-4%', top: '42%' }, cls: 'sp-sparkle sp-sparkle--2', strokes: [{ d: SPARKLE, fill: '#fff3c4', width: 1.8 }] },
    { vb: [24, 24], h: 0.08, at: { right: '-6%', bottom: '34%' }, cls: 'sp-sparkle sp-sparkle--3', strokes: [{ d: SPARKLE, fill: '#fff3c4', width: 2 }] },
  ],
};

/** Study twinkles (gold four-point stars, as in the preview): [left, top, delay]. */
const TWINKLES: readonly [string, string, string][] = [['6%', '14%', '0s'], ['86%', '6%', '0.9s'], ['74%', '34%', '1.7s']];

function svgPiece(p: Piece, size: number): SVGSVGElement {
  const h = Math.max(6, Math.round(size * p.h));
  const w = Math.round((h * p.vb[0]) / p.vb[1]);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${p.vb[0]} ${p.vb[1]}`);
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', `sp-piece${p.cls ? ` ${p.cls}` : ''}`);
  for (const [k, v] of Object.entries(p.at)) svg.style.setProperty(k, v);
  if (p.delay) svg.style.animationDelay = p.delay;
  for (const s of p.strokes) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', s.d);
    path.setAttribute('fill', s.fill ?? 'none');
    path.setAttribute('stroke', INK);
    path.setAttribute('stroke-width', String(s.width ?? 2));
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    if (s.cls) path.setAttribute('class', s.cls);
    svg.appendChild(path);
  }
  return svg;
}

function bit(cls: string, at: Record<string, string>, w: number, h: number, delay: string): HTMLElement {
  const s = document.createElement('span');
  s.className = cls;
  for (const [k, v] of Object.entries(at)) s.style.setProperty(k, v);
  s.style.width = `${w}px`;
  s.style.height = `${h}px`;
  s.style.animationDelay = delay;
  return s;
}

function doodle(kind: Doodle, size: number, animal: Animal): HTMLElement | null {
  const wrap = document.createElement('span');
  wrap.className = `sp-doodle sp-doodle--${kind}`;
  wrap.dataset.doodle = kind;
  wrap.setAttribute('aria-hidden', 'true');
  if (kind === 'twinkle') {
    const d = Math.max(5, Math.round(size * 0.06));
    wrap.append(...TWINKLES.map(([left, top, delay]) => bit('sp-twinkle', { left, top }, d, d, delay)));
  } else if (kind === 'steam') {
    const at = STEAM_AT[animal];
    if (!at) return null;
    const w = Math.max(2, Math.round(size * 0.018));
    const h = Math.max(8, Math.round(size * 0.133));
    wrap.append(...[0, 0.9, 1.8].map((delay, i) => bit('sp-steam', {
      left: `calc(${(at[0] * 100).toFixed(1)}% + ${(i - 1) * Math.max(3, Math.round(size * 0.03))}px)`,
      bottom: `${((1 - at[1]) * 100).toFixed(1)}%`,
    }, w, h, `${delay}s`)));
  } else {
    wrap.append(...PIECES[kind].map((p) => svgPiece(p, size)));
  }
  return wrap;
}

const labelOf = (animal: Animal) => ANIMALS.find((a) => a.id === animal)?.label ?? 'Cat';

export interface SpriteOptions {
  /** Widest the picture may be shown; wider pictures are shown shorter (default: no limit). */
  maxWidth?: number;
  /** Shrink to the container's width when it is narrower (Settings tiles). */
  fluid?: boolean;
}

interface SpriteState {
  animal: Animal;
  size: number;
  artBase: string;
  opts: SpriteOptions;
  /** The picture asked for last, and whether it is asleep (its part motion is slower). */
  want: string;
  art: HTMLCanvasElement | HTMLImageElement;
  animator: Animator | null;
  /** The picture being loaded and the size it will be shown at. */
  pending: { url: string; w: number; h: number } | null;
}
const states = new WeakMap<HTMLElement, SpriteState>();

/** The shown size: on the sprite box and its picture, and the picture's file for hit-testing. */
function applySize(el: HTMLElement, st: SpriteState, w: number, h: number, url: string): void {
  if (st.opts.fluid) {
    el.style.width = '100%';
    el.style.maxWidth = `${w}px`;
    el.style.height = 'auto';
    el.style.aspectRatio = `${w} / ${h}`;
    st.art.style.width = '100%';
    st.art.style.height = '100%';
  } else {
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    st.art.style.width = `${w}px`;
    st.art.style.height = `${h}px`;
  }
  el.style.setProperty('--sp-h', `${h}px`);
  el.dataset.w = String(w);
  el.dataset.h = String(h);
  st.art.dataset.src = url;
  el.dispatchEvent(new CustomEvent('sprite:picture', { bubbles: true, detail: { width: w, height: h, src: url } }));
}

/** Plain `<img>` instead of the canvas (its pixels can't be read): no part motion, same picture. */
function fallBack(el: HTMLElement, st: SpriteState, url: string, err: unknown): void {
  console.warn('buddy: part motion unavailable, showing the plain picture', err);
  st.animator?.destroy();
  st.animator = null;
  const img = document.createElement('img');
  img.className = 'sp-art';
  img.alt = labelOf(st.animal);
  img.draggable = false;
  img.setAttribute('draggable', 'false');
  img.decoding = 'async';
  img.src = url;
  img.style.cssText = st.art.style.cssText;
  img.dataset.src = url;
  st.art.replaceWith(img);
  st.art = img;
  if (st.pending?.url === url) applySize(el, st, st.pending.w, st.pending.h, url);
}

function showPicture(el: HTMLElement, st: SpriteState, mood: Mood, first: boolean): void {
  const info = pictureFor(st.animal, mood);
  const want = `${info.key}/${info.slow}`;
  el.dataset.picture = info.key;
  if (want === st.want) return;
  st.want = want;
  const url = `${st.artBase}${info.file}`;
  const [w, h] = fitSize(info.natural, st.size, st.opts.maxWidth);
  const label = labelOf(st.animal);
  // Reserve the space at once the first time; later swaps resize when the new picture is ready.
  if (first) applySize(el, st, w, h, url);
  st.pending = { url, w, h };
  if (st.animator && st.art instanceof HTMLCanvasElement) {
    st.art.setAttribute('aria-label', label);
    st.animator.show(url, info.rig, info.slow, () => applySize(el, st, w, h, url));
    return;
  }
  const img = st.art as HTMLImageElement;
  img.alt = label;
  if (first) { img.src = url; return; }
  const next = new Image();
  next.onload = () => {
    if (st.want !== want) return;
    img.src = url;
    applySize(el, st, w, h, url);
  };
  next.src = url;
}

/** Puts `el` (made by petSprite) in `mood`, and on `animal` when given: class, picture and doodles. */
export function setSpriteMood(el: HTMLElement, mood: Mood, animal?: Animal): void {
  const st = states.get(el);
  if (!st) return;
  if (animal) {
    st.animal = ART_SIZE[animal] ? animal : 'cat';
    el.dataset.animal = st.animal;
  }
  for (const c of [...el.classList]) if (c.startsWith('sprite--')) el.classList.remove(c);
  el.classList.add(`sprite--${mood}`);
  el.dataset.mood = mood;
  showPicture(el, st, mood, false);
  for (const d of el.querySelectorAll('.sp-doodle')) d.remove();
  const h = Number(el.dataset.h) || st.size;
  el.append(...(OVERLAYS[mood] ?? []).flatMap((k) => doodle(k, h, st.animal) ?? []));
}

/**
 * The buddy at most `size` px tall (its width follows the picture, up to `opts.maxWidth`) in `mood`.
 * `artBase` is where this page finds the art (each build copies it to `art/` beside the pages).
 */
export function petSprite(animal: Animal, mood: Mood, size: number, artBase = 'art/', opts: SpriteOptions = {}): HTMLElement {
  const known: Animal = ART_SIZE[animal] ? animal : 'cat';
  const el = document.createElement('div');
  el.className = 'sprite';
  el.dataset.animal = known;
  el.dataset.size = String(size);

  const figure = document.createElement('div');
  figure.className = 'sp-figure';
  const canvas = document.createElement('canvas');
  canvas.className = 'sp-art';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', labelOf(known));
  canvas.width = 0;
  canvas.height = 0;
  figure.appendChild(canvas);
  el.appendChild(figure);

  const st: SpriteState = { animal: known, size, artBase, opts, want: '', art: canvas, animator: null, pending: null };
  st.animator = createAnimator(canvas, (url, err) => fallBack(el, st, url, err));
  states.set(el, st);

  showPicture(el, st, mood, true);
  setSpriteMood(el, mood);
  return el;
}

/**
 * A spot in the page showing one buddy. Mood and animal changes reuse the same sprite and canvas;
 * the picture is swapped once the new one has loaded (no flash).
 */
export function spriteSlot(host: Element, size: number, artBase = 'art/', opts: SpriteOptions = {}): { set(animal: Animal, mood: Mood): void } {
  let el: HTMLElement | null = null;
  let shown = '';
  return {
    set(animal, mood) {
      const key = `${animal}/${mood}`;
      if (key === shown) return;
      if (el && host.contains(el)) setSpriteMood(el, mood, animal);
      else {
        el = petSprite(animal, mood, size, artBase, opts);
        host.replaceChildren(el);
      }
      shown = key;
    },
  };
}

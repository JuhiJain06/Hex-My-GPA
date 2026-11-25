import { ANIMALS, type Animal, type Mood } from '../src/index';

/**
 * The study buddy as the user's own character art: one transparent PNG per animal (art/*.png,
 * shown unaltered) with small sketch-style doodles around it for the mood ("z z", "!", a sweat
 * drop, hearts and sparkles, a steaming mug). Motion lives in sprite.css and stops for reduced
 * motion. Built with DOM APIs only (no HTML parsing).
 */

/** The doodles' ink: the dark brown of the art's own outlines. */
export const INK = '#3a2f2a';

/** Natural size [width, height] of each PNG in art/ (checked against the files by the tests). */
export const ART_SIZE: Readonly<Record<Animal, readonly [number, number]>> = {
  cat: [327, 345],
  fox: [296, 352],
  panda: [326, 299],
  bunny: [321, 321],
  dog: [345, 308],
  hamster: [283, 274],
};

/** Shown width in px of an animal drawn `height` px tall (it keeps the art's aspect ratio). */
export function spriteWidth(animal: Animal, height: number): number {
  const [w, h] = ART_SIZE[animal] ?? ART_SIZE.cat;
  return Math.round((height * w) / h);
}

export type Doodle = 'zz' | 'alert' | 'sweat' | 'hearts' | 'sparkles' | 'mug';

/** Which doodles go with each mood (wave and study are motion only). */
export const OVERLAYS: Readonly<Record<Mood, readonly Doodle[]>> = {
  wave: [],
  study: [],
  alert: ['alert'],
  sleep: ['zz'],
  sad: ['sweat'],
  celebrate: ['hearts', 'sparkles'],
  break: ['mug'],
};

/** The art is never recolored; asleep it is only dimmed a little. */
const SLEEP_FILTER = 'brightness(.9) saturate(.85)';

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
}

// Hand-drawn shapes: slightly uneven curves so they read as sketched, like the art.
const Z_BIG = 'M3.5 19.6 C7.6 19 11.2 19.5 15.6 19.1 C11.6 23.4 7.8 27.6 3.8 31.4 C8 31.2 12.4 31.7 16.4 31.2';
const Z_SMALL = 'M20.4 5.4 C23.2 5 26 5.5 28.8 5.2 C26 8.2 23.4 11 20.6 13.6 C23.4 13.5 26.4 13.8 29.2 13.4';
const HEART = 'M12 20.6 C9.4 18.4 3.2 14.3 3.1 8.9 C3 5.8 5.3 3.7 8 3.8 C10.1 3.9 11.4 5.3 12.1 7.1 '
  + 'C12.8 5.2 14.3 3.8 16.4 3.8 C19.2 3.8 21.2 6 20.9 9.1 C20.5 14.1 14.8 18.3 12 20.6 Z';
const SPARKLE = 'M12 2.4 C12.7 8.2 13.6 10.9 21.6 12.1 C13.7 13.1 12.6 15.9 12.1 21.8 '
  + 'C11.4 15.9 10.4 13.2 2.4 12 C10.3 10.8 11.3 8.1 12 2.4 Z';

const PIECES: Readonly<Record<Doodle, Piece[]>> = {
  zz: [{
    vb: [32, 34], h: 0.24, at: { right: '-6%', top: '0%' }, cls: 'sp-zz',
    strokes: [{ d: Z_BIG, width: 2.4 }, { d: Z_SMALL, width: 2 }],
  }],
  alert: [{
    vb: [24, 34], h: 0.22, at: { left: '-6%', top: '0%' }, cls: 'sp-bang',
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
  mug: [{
    vb: [32, 36], h: 0.22, at: { right: '-8%', bottom: '0%' }, cls: 'sp-mug',
    strokes: [
      { d: 'M6.2 16.2 C6 22.2 6.6 27.8 8.1 32.1 C12.4 33.2 17.8 33.1 22.1 32 C23.6 27.9 24.1 22 23.9 16 C18.1 15.4 12.1 15.5 6.2 16.2 Z', fill: '#f5e6d3', width: 1.8 },
      { d: 'M24 19.2 C28.8 18.4 29.6 25.8 23.4 26.6', width: 1.8 },
      { d: 'M11.2 12.4 C9.2 9.6 13.1 7.2 11 3.2', width: 1.6, cls: 'sp-steam' },
      { d: 'M17.4 12.4 C15.4 9.4 19.3 7.4 17.2 3.4', width: 1.6, cls: 'sp-steam sp-steam--2' },
    ],
  }],
};

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

function doodle(kind: Doodle, size: number): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = `sp-doodle sp-doodle--${kind}`;
  wrap.dataset.doodle = kind;
  wrap.setAttribute('aria-hidden', 'true');
  wrap.append(...PIECES[kind].map((p) => svgPiece(p, size)));
  return wrap;
}

const labelOf = (animal: Animal) => ANIMALS.find((a) => a.id === animal)?.label ?? 'Cat';

/** Puts `el` (made by petSprite) in `mood`: class, sleep dim and doodles. The image is kept. */
export function setSpriteMood(el: HTMLElement, mood: Mood): void {
  const size = Number(el.dataset.size) || el.getBoundingClientRect().height || 100;
  for (const c of [...el.classList]) if (c.startsWith('sprite--')) el.classList.remove(c);
  el.classList.add(`sprite--${mood}`);
  el.dataset.mood = mood;
  const img = el.querySelector<HTMLImageElement>('img.sp-art');
  if (img) img.style.filter = mood === 'sleep' ? SLEEP_FILTER : '';
  for (const d of el.querySelectorAll('.sp-doodle')) d.remove();
  el.append(...(OVERLAYS[mood] ?? []).map((k) => doodle(k, size)));
}

/**
 * The buddy `size` px tall (its width follows the art) in `mood`. `artBase` is where this page finds
 * the PNGs (each build copies them to `art/` beside the pages).
 */
export function petSprite(animal: Animal, mood: Mood, size: number, artBase = 'art/'): HTMLElement {
  const known: Animal = ART_SIZE[animal] ? animal : 'cat';
  const width = spriteWidth(known, size);
  const el = document.createElement('div');
  el.className = 'sprite';
  el.dataset.animal = known;
  el.dataset.size = String(size);
  el.style.width = `${width}px`;
  el.style.height = `${size}px`;

  const figure = document.createElement('div');
  figure.className = 'sp-figure';
  const img = document.createElement('img');
  img.className = 'sp-art';
  img.src = `${artBase}${known}.png`;
  img.alt = labelOf(known);
  img.draggable = false;
  img.setAttribute('draggable', 'false');
  img.decoding = 'async';
  img.width = width;
  img.height = size;
  img.style.width = `${width}px`;
  img.style.height = `${size}px`;
  figure.appendChild(img);
  el.appendChild(figure);

  setSpriteMood(el, mood);
  return el;
}

/** A spot in the page showing one buddy; a mood change keeps the same image, an animal change swaps it. */
export function spriteSlot(host: Element, size: number, artBase = 'art/'): { set(animal: Animal, mood: Mood): void } {
  let el: HTMLElement | null = null;
  let shown = '';
  return {
    set(animal, mood) {
      const key = `${animal}/${mood}`;
      if (key === shown) return;
      if (el && el.dataset.animal === animal && host.contains(el)) setSpriteMood(el, mood);
      else {
        el = petSprite(animal, mood, size, artBase);
        host.replaceChildren(el);
      }
      shown = key;
    },
  };
}

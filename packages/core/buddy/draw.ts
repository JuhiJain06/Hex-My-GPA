import { ANIMALS, type Animal, type Mood } from '../src/index';

/**
 * The study buddy: an original, round, chibi-style animal drawn from simple SVG shapes with DOM
 * APIs only. All animals share one rig (tail, body, feet, ears, head, markings, eyes, cheeks,
 * nose, mouth, arms, prop) on a 100×100 viewBox; an animal is just a parameter set, and a mood
 * swaps eyes, mouth, arms and props. Animations live in buddy.css (class names below).
 */

const NS = 'http://www.w3.org/2000/svg';
const EYE = '#2e2a33';
const CHEEK = '#f59bb0';
const TEAR = '#8cc8f0';

type Ears = 'pointy' | 'round' | 'long' | 'none';
type Tail = 'curl' | 'bushy' | 'puff' | 'stub' | 'none';
type Mark = 'stripe' | 'muzzle' | 'patch' | 'pouch' | 'face' | 'belly';

interface Look {
  ears: Ears;
  tail: Tail;
  /** Main fur, its outline, the inside of the ears, the tummy. */
  fur: string; line: string; inner: string; belly: string;
  /** Outer ear color (defaults to fur). */
  ear?: string;
  /** Arms, feet and tail color (defaults to fur). */
  limb?: string;
  feet?: string;
  tailColor?: string;
  nose: string;
  beak?: boolean;
  /** Markings in drawing order; `pouch` and `face` sit on the head, `belly` on the body. */
  marks: Mark[];
  markColor?: string;
  /** White ring behind the eyes so they read on dark patches. */
  eyeRing?: boolean;
}

const LOOKS: Record<Animal, Look> = {
  cat: {
    ears: 'pointy', tail: 'curl', fur: '#f7c99b', line: '#b97a4a', inner: '#f6a9b9', belly: '#fff4e6',
    nose: '#ef8aa0', marks: ['stripe'], markColor: '#e39a5c',
  },
  fox: {
    ears: 'pointy', tail: 'bushy', fur: '#f5a26a', line: '#b0603a', inner: '#7a4a3a', belly: '#fff8f0',
    feet: '#7a4a3a', nose: '#4a3530', marks: ['muzzle'], markColor: '#fff8f0',
  },
  panda: {
    ears: 'round', tail: 'stub', fur: '#fbfaf6', line: '#6f6e7c', inner: '#5b5a68', belly: '#fbfaf6',
    ear: '#3e3d48', limb: '#3e3d48', tailColor: '#3e3d48', nose: '#3e3d48', marks: ['patch'], markColor: '#3e3d48',
    eyeRing: true,
  },
  bunny: {
    ears: 'long', tail: 'puff', fur: '#f6eee8', line: '#b9a59a', inner: '#f7b6c6', belly: '#fffaf6',
    tailColor: '#ffffff', nose: '#ef8aa0', marks: [],
  },
  penguin: {
    ears: 'none', tail: 'none', fur: '#56658a', line: '#313b52', inner: '#56658a', belly: '#fbfbff',
    feet: '#f6a54c', nose: '#f6a54c', beak: true, marks: ['face', 'belly'], markColor: '#fbfbff',
  },
  hamster: {
    ears: 'round', tail: 'none', fur: '#f2c27f', line: '#b78544', inner: '#f6a9b9', belly: '#fff3df',
    nose: '#ef8aa0', marks: ['pouch'], markColor: '#fff3df',
  },
};

const MOOD_TEXT: Record<Mood, string> = {
  wave: 'waving hello', study: 'studying', break: 'on a break', alert: 'looking at you',
  sleep: 'asleep', sad: 'a little sad', celebrate: 'celebrating',
};

type Attrs = Record<string, string | number>;

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: SVGElement[]): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  e.append(...kids);
  return e;
}
const g = (cls: string, ...kids: SVGElement[]) => el('g', { class: cls }, ...kids);
/** Mirror an x coordinate across the vertical center line. */
const mx = (x: number) => 100 - x;

function outlined(look: Look, fill: string): Attrs {
  return { fill, stroke: look.line, 'stroke-width': 2, 'stroke-linejoin': 'round' };
}

function heartPath(x: number, y: number, s: number): string {
  return `M${x} ${y + s * 0.9} C${x - s * 1.5} ${y}, ${x - s * 0.6} ${y - s}, ${x} ${y - s * 0.25} `
    + `C${x + s * 0.6} ${y - s}, ${x + s * 1.5} ${y}, ${x} ${y + s * 0.9} Z`;
}
function sparklePath(x: number, y: number, s: number): string {
  return `M${x} ${y - s} Q${x} ${y} ${x + s} ${y} Q${x} ${y} ${x} ${y + s} Q${x} ${y} ${x - s} ${y} Q${x} ${y} ${x} ${y - s} Z`;
}

// ---------- parts ----------

function tail(look: Look): SVGElement | null {
  const color = look.tailColor ?? look.fur;
  switch (look.tail) {
    case 'curl':
      return g('b-tail b-tail--curl',
        el('path', { d: 'M66 88 Q88 90 86 70 Q85 61 78 63', fill: 'none', stroke: look.line, 'stroke-width': 8, 'stroke-linecap': 'round' }),
        el('path', { d: 'M66 88 Q88 90 86 70 Q85 61 78 63', fill: 'none', stroke: color, 'stroke-width': 5, 'stroke-linecap': 'round' }));
    case 'bushy':
      return g('b-tail b-tail--bushy',
        el('ellipse', { cx: 80, cy: 74, rx: 10, ry: 17, transform: 'rotate(38 80 74)', ...outlined(look, color) }),
        el('ellipse', { class: 'b-tail-tip', cx: 87.5, cy: 63, rx: 5.5, ry: 6.5, transform: 'rotate(38 87.5 63)', fill: look.belly }));
    case 'puff':
      return g('b-tail b-tail--puff', el('circle', { cx: 72, cy: 87, r: 6.5, ...outlined(look, color) }));
    case 'stub':
      return g('b-tail b-tail--stub', el('circle', { cx: 71, cy: 88, r: 5, fill: color }));
    default:
      return null;
  }
}

function body(look: Look): SVGElement {
  const parts: SVGElement[] = [el('ellipse', { class: 'b-body-shape', cx: 50, cy: 79, rx: 22, ry: 17, ...outlined(look, look.fur) })];
  if (look.marks.includes('belly')) parts.push(el('ellipse', { class: 'b-mark b-mark--belly', cx: 50, cy: 81, rx: 16, ry: 13.5, fill: look.belly }));
  else parts.push(el('ellipse', { class: 'b-belly', cx: 50, cy: 82, rx: 12, ry: 10, fill: look.belly }));
  return g('b-body', ...parts);
}

function feet(look: Look): SVGElement {
  const fill = look.feet ?? look.limb ?? look.fur;
  return g('b-feet',
    el('ellipse', { cx: 40, cy: 94, rx: 6.5, ry: 3.6, ...outlined(look, fill) }),
    el('ellipse', { cx: 60, cy: 94, rx: 6.5, ry: 3.6, ...outlined(look, fill) }));
}

function ear(look: Look, side: 'left' | 'right', droop: boolean): SVGElement | null {
  const x = (v: number) => (side === 'left' ? v : mx(v));
  const outer = look.ear ?? look.fur;
  let shapes: SVGElement[];
  let pivot: [number, number];
  switch (look.ears) {
    case 'pointy':
      shapes = [
        el('path', { d: `M${x(26)} 36 L${x(29)} 9 L${x(48)} 24 Z`, ...outlined(look, outer), 'stroke-width': 2.5 }),
        el('path', { d: `M${x(31)} 29 L${x(32.5)} 16 L${x(42)} 24 Z`, fill: look.inner, 'stroke-linejoin': 'round' }),
      ];
      pivot = [x(36), 30];
      break;
    case 'round':
      shapes = [
        el('circle', { cx: x(29), cy: 25, r: 9, ...outlined(look, outer) }),
        el('circle', { cx: x(29), cy: 25, r: 4.8, fill: look.inner }),
      ];
      pivot = [x(32), 30];
      break;
    case 'long':
      shapes = [
        el('ellipse', { cx: x(39), cy: 15, rx: 7.5, ry: 15, transform: `rotate(${side === 'left' ? -12 : 12} ${x(39)} 15)`, ...outlined(look, outer) }),
        el('ellipse', { cx: x(39), cy: 16, rx: 3.6, ry: 10.5, transform: `rotate(${side === 'left' ? -12 : 12} ${x(39)} 16)`, fill: look.inner }),
      ];
      pivot = [x(41), 28];
      break;
    default:
      return null;
  }
  const angle = droop ? (side === 'left' ? -28 : 28) : 0;
  // The droop rotates an inner wrapper; the outer group is free for the CSS wiggle.
  const inner = el('g', angle ? { transform: `rotate(${angle} ${pivot[0]} ${pivot[1]})` } : {}, ...shapes);
  return g(`b-ear b-ear--${look.ears} b-ear--${side}`, inner);
}

function headShape(look: Look): SVGElement {
  return el('ellipse', { class: 'b-head-shape', cx: 50, cy: 47, rx: 28, ry: 24.5, ...outlined(look, look.fur) });
}

function marks(look: Look): SVGElement[] {
  const c = look.markColor ?? look.belly;
  const out: SVGElement[] = [];
  for (const m of look.marks) {
    switch (m) {
      case 'stripe':
        for (const d of ['M50 24 L50 31', 'M43 25 L45 31', 'M57 25 L55 31']) {
          out.push(el('path', { class: 'b-mark b-mark--stripe', d, stroke: c, 'stroke-width': 2.6, 'stroke-linecap': 'round', fill: 'none' }));
        }
        break;
      case 'muzzle':
        out.push(el('path', { class: 'b-mark b-mark--muzzle', d: 'M23.5 52 Q37 48 50 56 Q63 48 76.5 52 Q72 70 50 71 Q28 70 23.5 52 Z', fill: c }));
        break;
      case 'patch':
        out.push(el('ellipse', { class: 'b-mark b-mark--patch', cx: 39, cy: 49, rx: 7, ry: 8.5, transform: 'rotate(30 39 49)', fill: c }));
        out.push(el('ellipse', { class: 'b-mark b-mark--patch', cx: 61, cy: 49, rx: 7, ry: 8.5, transform: 'rotate(-30 61 49)', fill: c }));
        break;
      case 'pouch':
        out.push(el('ellipse', { class: 'b-mark b-mark--pouch', cx: 30, cy: 57, rx: 10.5, ry: 8.5, ...outlined(look, c), 'stroke-width': 1.5 }));
        out.push(el('ellipse', { class: 'b-mark b-mark--pouch', cx: 70, cy: 57, rx: 10.5, ry: 8.5, ...outlined(look, c), 'stroke-width': 1.5 }));
        break;
      case 'face':
        out.push(g('b-mark b-mark--face',
          el('circle', { cx: 40.5, cy: 49, r: 12, fill: c }),
          el('circle', { cx: 59.5, cy: 49, r: 12, fill: c }),
          el('ellipse', { cx: 50, cy: 58, rx: 18, ry: 10.5, fill: c })));
        break;
      default:
        break; // belly is drawn with the body
    }
  }
  return out;
}

const EYE_L = 40;
const EYE_R = 60;
const EYE_Y = 49;

function eyes(look: Look, mood: Mood): SVGElement {
  const both = (fn: (x: number) => SVGElement[]) => [...fn(EYE_L), ...fn(EYE_R)];
  const arc = (bend: number) => both((x) => [el('path', {
    d: `M${x - 4} ${EYE_Y} Q${x} ${EYE_Y + bend} ${x + 4} ${EYE_Y}`,
    fill: 'none', stroke: look.eyeRing ? '#ffffff' : EYE, 'stroke-width': 2.4, 'stroke-linecap': 'round',
  })]);
  if (mood === 'sleep') return g('b-eyes b-eyes--closed', ...arc(3.5));
  if (mood === 'celebrate') return g('b-eyes b-eyes--happy', ...arc(-5));
  const wide = mood === 'alert';
  const rx = wide ? 4.2 : 3.3;
  const ry = wide ? 5 : 3.9;
  const kids = both((x) => [
    ...(look.eyeRing ? [el('circle', { cx: x, cy: EYE_Y, r: ry + 1.4, fill: '#ffffff' })] : []),
    el('ellipse', { cx: x, cy: EYE_Y, rx, ry, fill: EYE }),
    el('circle', { cx: x + 1.2, cy: EYE_Y - 1.6, r: wide ? 1.7 : 1.3, fill: '#ffffff' }),
  ]);
  const open = g(`b-eyes b-eyes--open${wide ? ' b-eyes--wide' : ''}${mood === 'sad' ? ' b-eyes--sad' : ''}`, ...kids);
  if (mood !== 'sad') return open;
  const brow = look.eyeRing ? '#ffffff' : look.line;
  return g('b-eyes-wrap', open,
    el('path', { class: 'b-brow', d: `M${EYE_L - 5} 42.5 L${EYE_L + 3} 39.5`, stroke: brow, 'stroke-width': 2, 'stroke-linecap': 'round' }),
    el('path', { class: 'b-brow', d: `M${EYE_R + 5} 42.5 L${EYE_R - 3} 39.5`, stroke: brow, 'stroke-width': 2, 'stroke-linecap': 'round' }));
}

function cheeks(): SVGElement {
  return g('b-cheeks',
    el('ellipse', { cx: 32, cy: 57, rx: 4.6, ry: 2.8, fill: CHEEK, opacity: 0.75 }),
    el('ellipse', { cx: 68, cy: 57, rx: 4.6, ry: 2.8, fill: CHEEK, opacity: 0.75 }));
}

function nose(look: Look): SVGElement {
  if (look.beak) {
    return el('path', { class: 'b-nose b-nose--beak', d: 'M44.5 53 Q50 50.5 55.5 53 L50 59 Z', fill: look.nose, stroke: '#c97b2c', 'stroke-width': 1, 'stroke-linejoin': 'round' });
  }
  return el('path', { class: 'b-nose', d: 'M47.4 53.2 Q50 52 52.6 53.2 Q51.5 55.6 50 55.8 Q48.5 55.6 47.4 53.2 Z', fill: look.nose });
}

function mouth(look: Look, mood: Mood): SVGElement {
  const y = look.beak ? 61 : 57;
  const line = { fill: 'none', stroke: EYE, 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  switch (mood) {
    case 'wave':
    case 'celebrate':
      return el('path', { class: 'b-mouth b-mouth--open', d: `M44.5 ${y} Q50 ${y + 9} 55.5 ${y} Z`, fill: '#d9677b', stroke: EYE, 'stroke-width': 1.4, 'stroke-linejoin': 'round' });
    case 'alert':
      return el('ellipse', { class: 'b-mouth b-mouth--o', cx: 50, cy: y + 2.5, rx: 2.3, ry: 2.8, fill: EYE });
    case 'sad':
      return el('path', { class: 'b-mouth b-mouth--frown', d: `M45.5 ${y + 3.5} Q50 ${y} 54.5 ${y + 3.5}`, ...line });
    case 'sleep':
      return el('path', { class: 'b-mouth b-mouth--sleep', d: `M47.5 ${y + 1} Q50 ${y + 2.5} 52.5 ${y + 1}`, ...line });
    default:
      return el('path', { class: 'b-mouth b-mouth--w', d: `M45 ${y} Q47.5 ${y + 3} 50 ${y} Q52.5 ${y + 3} 55 ${y}`, ...line });
  }
}

function paw(look: Look, cx: number, cy: number, angle: number): SVGElement {
  const fill = look.limb ?? look.fur;
  return el('ellipse', { class: 'b-paw', cx, cy, rx: 5.6, ry: 7, transform: `rotate(${angle} ${cx} ${cy})`, ...outlined(look, fill) });
}

function book(): SVGElement {
  return g('b-prop b-prop-book',
    el('path', { d: 'M30 78 L50 82 L70 78 L70 95 L50 98 L30 95 Z', fill: '#8fb3e6', stroke: '#5b7fb8', 'stroke-width': 1.5, 'stroke-linejoin': 'round' }),
    el('path', { d: 'M32 78.5 L50 82 L50 95.5 L32 92.5 Z', fill: '#ffffff' }),
    el('path', { d: 'M68 78.5 L50 82 L50 95.5 L68 92.5 Z', fill: '#fdfaf3' }),
    el('path', { d: 'M35.5 84 L46.5 86.2 M35.5 88 L46.5 90.2 M53.5 86.2 L64.5 84 M53.5 90.2 L64.5 88', stroke: '#b9c7dd', 'stroke-width': 1.1, 'stroke-linecap': 'round' }),
    el('path', { d: 'M50 82 L50 95.5', stroke: '#5b7fb8', 'stroke-width': 1.2 }));
}

function cup(): SVGElement {
  return g('b-prop b-prop-cup',
    g('b-steam',
      el('path', { d: 'M46 72 Q44 69.5 46 67 Q48 64.5 46 62', fill: 'none', stroke: '#c8bfd8', 'stroke-width': 1.6, 'stroke-linecap': 'round' }),
      el('path', { d: 'M53 72 Q51 69.5 53 67 Q55 64.5 53 62', fill: 'none', stroke: '#c8bfd8', 'stroke-width': 1.6, 'stroke-linecap': 'round' })),
    el('path', { d: 'M57 79 Q64 79 64 84 Q64 89 57 89', fill: 'none', stroke: '#d98aa3', 'stroke-width': 2.6 }),
    el('rect', { x: 41, y: 75, width: 18, height: 17, rx: 4, fill: '#f8cfdc', stroke: '#d98aa3', 'stroke-width': 1.6 }),
    el('ellipse', { cx: 50, cy: 76.5, rx: 7.5, ry: 1.8, fill: '#a97452' }));
}

function zs(): SVGElement[] {
  return [[70, 33, 12], [79, 23, 15], [87, 12, 18]].map(([x, y, s], i) =>
    g(`b-z b-z--${i + 1}`, Object.assign(el('text', {
      x: x!, y: y!, 'font-size': s!, 'font-weight': 800, 'font-family': 'Segoe UI, system-ui, sans-serif', fill: '#a493f0',
      stroke: '#6f5fc0', 'stroke-width': 0.8, 'paint-order': 'stroke',
    }), { textContent: 'z' })));
}

function arms(look: Look, mood: Mood): SVGElement[] {
  const rest = (side: 'left' | 'right') =>
    g(`b-arm b-arm--${side}`, paw(look, side === 'left' ? 30 : 70, 79, side === 'left' ? 18 : -18));
  switch (mood) {
    case 'wave':
      return [rest('left'), g('b-arm b-arm--right b-arm--raised', paw(look, 80, 60, 28))];
    case 'celebrate':
      return [
        g('b-arm b-arm--left b-arm--up', paw(look, 20, 61, -30)),
        g('b-arm b-arm--right b-arm--up', paw(look, 80, 61, 30)),
      ];
    case 'study':
      return [book(), g('b-arm b-arm--left b-arm--hold', paw(look, 31, 86, 8)), g('b-arm b-arm--right b-arm--hold', paw(look, 69, 86, -8))];
    case 'break':
      return [cup(), g('b-arm b-arm--left b-arm--hold', paw(look, 40, 86, 12)), g('b-arm b-arm--right b-arm--hold', paw(look, 60, 86, -12))];
    case 'sleep':
      return [g('b-arm b-arm--left b-arm--tucked', paw(look, 40, 76, 70)), g('b-arm b-arm--right b-arm--tucked', paw(look, 60, 76, -70))];
    default:
      return [rest('left'), rest('right')];
  }
}

function extras(mood: Mood): SVGElement[] {
  switch (mood) {
    case 'sleep':
      return zs();
    case 'sad':
      return [el('path', { class: 'b-tear', d: 'M36.5 54 C34 58 34 61 36.5 61.5 C39 61 39 58 36.5 54 Z', fill: TEAR, stroke: '#5fa7d6', 'stroke-width': 0.8 })];
    case 'celebrate':
      return [
        el('path', { class: 'b-heart b-heart--1', d: heartPath(14, 30, 6), fill: '#f47fa0' }),
        el('path', { class: 'b-heart b-heart--2', d: heartPath(87, 22, 5), fill: '#f9a3bd' }),
        el('path', { class: 'b-sparkle b-sparkle--1', d: sparklePath(22, 12, 5), fill: '#ffd36e' }),
        el('path', { class: 'b-sparkle b-sparkle--2', d: sparklePath(78, 8, 4), fill: '#b9a6f2' }),
        el('path', { class: 'b-sparkle b-sparkle--3', d: sparklePath(92, 44, 3.5), fill: '#ffd36e' }),
      ];
    default:
      return [];
  }
}

const prefersReducedMotion = (): boolean => {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
  } catch { return false; }
};

export interface DrawOptions {
  /** Static pose (no animation). Defaults to the user's prefers-reduced-motion setting. */
  still?: boolean;
}

/** Draws `animal` in `mood` as a `size`×`size` px SVG. Pure DOM construction, no HTML parsing. */
export function drawBuddy(animal: Animal, mood: Mood, size: number, opts: DrawOptions = {}): SVGSVGElement {
  const look = LOOKS[animal] ?? LOOKS.cat;
  const label = ANIMALS.find((a) => a.id === animal)?.label ?? 'Cat';
  const still = opts.still ?? prefersReducedMotion();
  const svg = el('svg', {
    xmlns: NS, viewBox: '0 0 100 100', width: size, height: size,
    class: `buddy buddy--${animal} buddy--${mood}${still ? ' buddy--still' : ''}`,
    'data-animal': animal, 'data-mood': mood, role: 'img', 'aria-label': `${label}, ${MOOD_TEXT[mood]}`,
  });
  const droop = mood === 'sad';
  const head = el('g', { class: 'b-head', ...(mood === 'sleep' ? { transform: 'rotate(-8 50 72)' } : {}) },
    g('b-ears', ...[ear(look, 'left', droop), ear(look, 'right', droop)].filter((e): e is SVGElement => e !== null)),
    headShape(look),
    ...marks(look),
    eyes(look, mood),
    cheeks(),
    nose(look),
    mouth(look, mood));
  const t = tail(look);
  const figure = g('b-figure', ...(t ? [t] : []), body(look), feet(look), head, ...arms(look, mood));
  svg.append(
    el('ellipse', { class: 'b-shadow', cx: 50, cy: 97, rx: 26, ry: 2.6, fill: '#000000', opacity: 0.08 }),
    figure,
    ...extras(mood),
  );
  return svg;
}

/** The animal's arm color and outline (for paws drawn outside the buddy, e.g. folded on the study desk). */
export function limbColors(animal: Animal): { fill: string; line: string } {
  const look = LOOKS[animal] ?? LOOKS.cat;
  return { fill: look.limb ?? look.fur, line: look.line };
}

/** A spot in the page that shows one buddy and redraws only when the animal or mood changes. */
export function buddySlot(host: Element, size: number): { set(animal: Animal, mood: Mood): void } {
  let key = '';
  return {
    set(animal, mood) {
      const k = `${animal}/${mood}`;
      if (k === key) return;
      key = k;
      host.replaceChildren(drawBuddy(animal, mood, size));
    },
  };
}

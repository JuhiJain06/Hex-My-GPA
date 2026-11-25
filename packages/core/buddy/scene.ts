import { ANIMALS, type Animal, type Mood } from '../src/index';
import { drawBuddy, limbColors, type DrawOptions } from './draw';

/**
 * The desktop pet's little study corner: the buddy (drawBuddy) behind a small desk with a lamp, a
 * mug and a book. Props follow the mood: an open book with a turning page and a wiggling pencil
 * while studying, a stretch then a relaxed mug break, head down on the desk with z's when asleep.
 * Built with DOM APIs only; the loops live in buddy.css (`.scene ...`) and stop for reduced motion.
 *
 * Coordinates: a 140×118 viewBox. The buddy's own 100×100 rig is placed at (30, 4) scaled 0.8, so
 * its paws (rig y ≈ 86) land on the desk top (y 70–76).
 */

const NS = 'http://www.w3.org/2000/svg';
const VB_W = 140;
const VB_H = 118;
/** Width / height of the scene; height in px = size / SCENE_ASPECT. */
export const SCENE_ASPECT = VB_W / VB_H;

const BUDDY = { x: 30, y: 4, size: 80 } as const;
/** How far the buddy sinks when it dozes with its head on the desk. */
const HEAD_DOWN = 14;

const WOOD = '#e9c7a2';
const WOOD_DARK = '#c99d74';
const WOOD_LINE = '#a9784f';
const INK = '#5b4a5e';

type Attrs = Record<string, string | number>;
function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: SVGElement[]): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  e.append(...kids);
  return e;
}
const g = (cls: string, ...kids: SVGElement[]) => el('g', { class: cls }, ...kids);

const SCENE_TEXT: Record<Mood, string> = {
  wave: 'waving from its desk', study: 'studying at its desk', break: 'taking a break at its desk',
  alert: 'looking up from its desk', sleep: 'dozing on its desk', sad: 'a little sad at its desk',
  celebrate: 'celebrating at its desk',
};

function lamp(dim: boolean): SVGElement {
  // Drawn 6 units left of its design spot so the shade clears the buddy's ears.
  return g(`s-lamp${dim ? ' s-lamp--dim' : ''}`,
    el('ellipse', { class: 's-glow', cx: 63, cy: 72.5, rx: 30, ry: 3.6, fill: '#ffe6a3', opacity: dim ? 0.25 : 0.6, 'pointer-events': 'none' }),
    el('g', { transform: 'translate(-6 0)' },
    el('ellipse', { cx: 19, cy: 70.5, rx: 9, ry: 2.6, fill: '#b9a6f2', stroke: '#7f6cc4', 'stroke-width': 1.2 }),
    el('path', { d: 'M19 70 L21 45 L35 35', fill: 'none', stroke: '#7f6cc4', 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
    el('circle', { cx: 21, cy: 45, r: 1.8, fill: '#7f6cc4' }),
    el('circle', { class: 's-bulb', cx: 41.5, cy: 41, r: 3, fill: '#fff3c4', opacity: dim ? 0.5 : 1, 'pointer-events': 'none' }),
    el('path', { d: 'M29 33 L40 26 L49 38 Q42 44 35 43 Z', fill: '#f8b996', stroke: '#c9805c', 'stroke-width': 1.4, 'stroke-linejoin': 'round' })));
}

function desk(): SVGElement {
  return g('s-desk',
    el('ellipse', { class: 's-floor', cx: 70, cy: 113.5, rx: 62, ry: 3, fill: '#000000', opacity: 0.08 }),
    el('rect', { x: 10, y: 84, width: 6, height: 28, rx: 2, fill: WOOD_DARK, stroke: WOOD_LINE, 'stroke-width': 1.2 }),
    el('rect', { x: 124, y: 84, width: 6, height: 28, rx: 2, fill: WOOD_DARK, stroke: WOOD_LINE, 'stroke-width': 1.2 }),
    el('rect', { x: 4, y: 75.5, width: 132, height: 10, rx: 3, fill: WOOD_DARK, stroke: WOOD_LINE, 'stroke-width': 1.4 }),
    el('path', { d: 'M10 69.5 L130 69.5 L136 76 L4 76 Z', fill: WOOD, stroke: WOOD_LINE, 'stroke-width': 1.4, 'stroke-linejoin': 'round' }),
    el('path', { d: 'M58 80.5 L82 80.5', stroke: WOOD_LINE, 'stroke-width': 1.6, 'stroke-linecap': 'round' }));
}

const lines = (d: string) => el('path', { d, stroke: '#c3cde0', 'stroke-width': 0.9, 'stroke-linecap': 'round', fill: 'none' });

function openBook(turning: boolean): SVGElement {
  const right = 'M70 66 L88 63.5 L92 73 L70 74 Z';
  return g('s-book s-book--open',
    el('path', { d: 'M45.5 74.6 L70 75.8 L94.5 74.6 L92 72.6 L70 73.6 L48 72.6 Z', fill: '#8fb3e6', stroke: '#5b7fb8', 'stroke-width': 1.1, 'stroke-linejoin': 'round' }),
    el('path', { d: 'M48 73 L52 63.5 L70 66 L70 74 Z', fill: '#ffffff', stroke: '#b9c7dd', 'stroke-width': 0.8, 'stroke-linejoin': 'round' }),
    el('path', { d: right, fill: '#fdfaf3', stroke: '#b9c7dd', 'stroke-width': 0.8, 'stroke-linejoin': 'round' }),
    lines('M53.5 66.5 L67 68.3 M52.5 69 L67 70.6 M51.6 71.3 L62 72.4 M73 68.3 L86 66.6 M73 70.6 L87.4 69.2'),
    ...(turning ? [el('path', { class: 's-page-turn', d: right, fill: '#ffffff', stroke: '#b9c7dd', 'stroke-width': 0.8, 'stroke-linejoin': 'round' })] : []),
    el('path', { d: 'M70 66 L70 74', stroke: '#9fb2d4', 'stroke-width': 0.9 }));
}

function closedBook(): SVGElement {
  return g('s-book s-book--closed',
    el('rect', { x: 36, y: 66.5, width: 22, height: 4.5, rx: 1, fill: '#f6b6c8', stroke: '#c97b93', 'stroke-width': 1 }),
    el('rect', { x: 38, y: 62.5, width: 19, height: 4.5, rx: 1, fill: '#bfe7d3', stroke: '#6fae8f', 'stroke-width': 1 }),
    el('path', { d: 'M40 64.7 L55 64.7 M38.5 68.7 L56 68.7', stroke: '#ffffff', 'stroke-width': 0.9, 'stroke-linecap': 'round', opacity: 0.8 }));
}

function pencil(): SVGElement {
  // Points down-left onto the right page; wiggles about its tip (buddy.css).
  return g('s-pencil',
    el('path', { d: 'M86.5 69.5 L88.3 65.6 L96.6 55.2 L99.2 57.2 L90.6 67.2 Z', fill: '#ffd36e', stroke: '#c99a2e', 'stroke-width': 0.8, 'stroke-linejoin': 'round' }),
    el('path', { d: 'M96.6 55.2 L97.8 53.7 Q99.6 53.4 100.4 55.7 L99.2 57.2 Z', fill: '#f59bb0', stroke: '#c97b93', 'stroke-width': 0.8 }),
    el('path', { d: 'M86.5 69.5 L88.3 65.6 L90.6 67.2 Z', fill: '#f3e2c7' }),
    el('circle', { cx: 86.9, cy: 69, r: 0.7, fill: INK }));
}

function mug(steam: boolean): SVGElement {
  const wisp = (x: number) => el('path', {
    d: `M${x} 57 Q${x - 2} 54.5 ${x} 52 Q${x + 2} 49.5 ${x} 47`, fill: 'none', stroke: '#c8bfd8', 'stroke-width': 1.4, 'stroke-linecap': 'round',
  });
  return g('s-mug',
    ...(steam ? [g('s-steam', wisp(109), wisp(114.5))] : []),
    el('path', { d: 'M117.5 62 Q123 62 123 66 Q123 70 117.5 70', fill: 'none', stroke: '#d98aa3', 'stroke-width': 2.2 }),
    el('rect', { x: 105, y: 59, width: 13, height: 13, rx: 3, fill: '#f8cfdc', stroke: '#d98aa3', 'stroke-width': 1.4 }),
    el('ellipse', { cx: 111.5, cy: 60.3, rx: 5.2, ry: 1.3, fill: '#a97452' }),
    el('path', { d: 'M108.5 66 Q111.5 68.5 114.5 66', fill: 'none', stroke: '#ffffff', 'stroke-width': 1, 'stroke-linecap': 'round', opacity: 0.8 }));
}

/** A paw drawn in the buddy's 100×100 rig, for the overlays below. */
function paw(animal: Animal, cx: number, cy: number, rx: number, ry: number, angle: number): SVGElement {
  const c = limbColors(animal);
  return el('ellipse', { cx, cy, rx, ry, transform: `rotate(${angle} ${cx} ${cy})`, fill: c.fill, stroke: c.line, 'stroke-width': 2, 'stroke-linejoin': 'round' });
}

/** One arm reaching up from the shoulder, past the side of the head (rig coordinates). */
function stretchArm(animal: Animal, side: 'left' | 'right'): SVGElement[] {
  const c = limbColors(animal);
  const x = (v: number) => (side === 'left' ? v : 100 - v);
  const d = `M${x(30)} 78 Q${x(4)} 60 ${x(12)} 22`;
  return [
    el('path', { d, fill: 'none', stroke: c.line, 'stroke-width': 11, 'stroke-linecap': 'round' }),
    el('path', { d, fill: 'none', stroke: c.fill, 'stroke-width': 7, 'stroke-linecap': 'round' }),
    paw(animal, x(12), 18, 6, 6.5, 0),
  ];
}

/** A transparent layer with the buddy's rig coordinates, drawn in front of the desk. */
function rigLayer(cls: string, mood: Mood, still: boolean, dy = 0, ...kids: SVGElement[]): SVGSVGElement {
  return el('svg', {
    class: `${cls} s-rig buddy--${mood}${still ? ' buddy--still' : ''}`, x: BUDDY.x, y: BUDDY.y + dy,
    width: BUDDY.size, height: BUDDY.size, viewBox: '0 0 100 100', overflow: 'visible',
  }, ...kids);
}

/** Moods whose paws rest on the desk top: they are lifted in front of the desk so they sit on it. */
const PAWS_ON_DESK: readonly Mood[] = ['study', 'break', 'alert', 'sad'];

/** Draws `animal` at its study desk in `mood`, `size` px wide (height size / SCENE_ASPECT). */
export function drawStudyScene(animal: Animal, mood: Mood, size: number, opts: DrawOptions = {}): SVGSVGElement {
  const buddy = drawBuddy(animal, mood, BUDDY.size, opts);
  const still = buddy.classList.contains('buddy--still');
  const label = ANIMALS.find((a) => a.id === animal)?.label ?? 'Cat';
  const svg = el('svg', {
    xmlns: NS, viewBox: `0 0 ${VB_W} ${VB_H}`, width: size, height: Math.round(size / SCENE_ASPECT),
    class: `scene scene--${mood}${still ? ' scene--still' : ''}`,
    'data-animal': animal, 'data-mood': mood, role: 'img', 'aria-label': `${label}, ${SCENE_TEXT[mood]}`,
  });

  // The buddy sits behind the desk: its hand-held props, feet and ground shadow are replaced by the desk.
  for (const sel of ['.b-prop', '.b-shadow', '.b-feet']) buddy.querySelectorAll(sel).forEach((n) => n.remove());
  const sleeping = mood === 'sleep';
  buddy.setAttribute('x', String(BUDDY.x));
  buddy.setAttribute('y', String(BUDDY.y + (sleeping ? HEAD_DOWN : 0)));
  buddy.setAttribute('aria-hidden', 'true');
  buddy.removeAttribute('role');
  buddy.removeAttribute('xmlns');

  const front: SVGElement[] = [];
  if (sleeping) {
    // Head down: only the head shows above the folded arms; the sunk body and tail would poke out under the desk.
    for (const sel of ['.b-arm', '.b-body', '.b-tail']) buddy.querySelectorAll(sel).forEach((n) => n.remove());
    front.push(rigLayer('s-arms-folded', mood, still, HEAD_DOWN,
      paw(animal, 36, 72, 15, 6.5, 6), paw(animal, 64, 72, 15, 6.5, -6)));
  } else if (PAWS_ON_DESK.includes(mood)) {
    const arms = [...buddy.querySelectorAll('.b-arm')] as SVGElement[];
    front.push(rigLayer(mood === 'break' ? 's-paws s-arms-rest' : 's-paws', mood, still, 0, ...arms));
  }
  if (mood === 'break') {
    // Stretch first (paws up high), then relax with the mug (buddy.css fades one into the other).
    front.push(rigLayer('s-stretch', mood, still, 0, ...stretchArm(animal, 'left'), ...stretchArm(animal, 'right')));
  }

  const studying = mood === 'study';
  const bookOpen = studying || mood === 'alert' || mood === 'sad' || sleeping;
  svg.append(
    g(`s-buddy${sleeping ? ' s-buddy--head-down' : ''}`, buddy),
    desk(),
    lamp(sleeping),
    bookOpen ? openBook(studying) : closedBook(),
    mug(!sleeping && mood !== 'sad'),
    ...front,
    ...(studying ? [pencil()] : []),
  );
  return svg;
}

/** A spot in the page that shows one study scene and redraws only when the animal or mood changes. */
export function sceneSlot(host: Element, size: number): { set(animal: Animal, mood: Mood): void } {
  let key = '';
  return {
    set(animal, mood) {
      const k = `${animal}/${mood}`;
      if (k === key) return;
      key = k;
      host.replaceChildren(drawStudyScene(animal, mood, size));
    },
  };
}

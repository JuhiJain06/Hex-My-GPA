/// <reference types="node" />
// @vitest-environment jsdom
import { describe, test, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANIMALS, MOODS, type Animal, type Mood } from '../src/index';
import { buddySlot, drawBuddy } from '../buddy/draw';

const SVG_NS = 'http://www.w3.org/2000/svg';
const animals = ANIMALS.map((a) => a.id);
const combos = animals.flatMap((a) => MOODS.map((m) => [a, m] as [Animal, Mood]));

/** Tag + class of every element, in document order: the shape structure, ignoring colors. */
const structure = (svg: Element): string =>
  [...svg.querySelectorAll('*')].map((el) => `${el.tagName}.${el.getAttribute('class') ?? ''}`).join('|');

afterEach(() => vi.restoreAllMocks());

describe('drawBuddy', () => {
  test.each(combos)('%s × %s renders a tagged svg', (animal, mood) => {
    const svg = drawBuddy(animal, mood, 64);
    expect(svg.namespaceURI).toBe(SVG_NS);
    expect(svg.tagName).toBe('svg');
    expect(svg.getAttribute('data-animal')).toBe(animal);
    expect(svg.getAttribute('data-mood')).toBe(mood);
    expect(svg.getAttribute('width')).toBe('64');
    expect(svg.getAttribute('height')).toBe('64');
    expect(svg.getAttribute('viewBox')).toBe('0 0 100 100');
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toMatch(new RegExp(ANIMALS.find((a) => a.id === animal)!.label));
    expect(svg.querySelectorAll('*').length).toBeGreaterThan(10);
    for (const el of svg.querySelectorAll('*')) expect(el.namespaceURI).toBe(SVG_NS);
  });

  test.each([...MOODS])('every animal has a distinct structure in %s mood', (mood) => {
    const sigs = new Set(animals.map((a) => structure(drawBuddy(a, mood, 96))));
    expect(sigs.size).toBe(animals.length);
  });

  test('ears and markings follow the animal', () => {
    const has = (a: Animal, sel: string) => drawBuddy(a, 'study', 48).querySelector(sel) !== null;
    expect(has('cat', '.b-ear--pointy')).toBe(true);
    expect(has('fox', '.b-ear--pointy')).toBe(true);
    expect(has('panda', '.b-ear--round')).toBe(true);
    expect(has('hamster', '.b-ear--round')).toBe(true);
    expect(has('bunny', '.b-ear--long')).toBe(true);
    expect(has('penguin', '.b-ear')).toBe(false);
    expect(has('panda', '.b-mark--patch')).toBe(true);
    expect(has('fox', '.b-mark--muzzle')).toBe(true);
    expect(has('fox', '.b-tail-tip')).toBe(true);
    expect(has('penguin', '.b-mark--belly')).toBe(true);
    expect(has('hamster', '.b-mark--pouch')).toBe(true);
    expect(has('cat', '.b-mark--stripe')).toBe(true);
  });

  test.each([
    ['study', '.b-prop-book'],
    ['break', '.b-prop-cup'],
    ['sleep', '.b-z'],
    ['celebrate', '.b-heart'],
    ['celebrate', '.b-sparkle'],
    ['sad', '.b-tear'],
    ['wave', '.b-arm--raised'],
    ['alert', '.b-eyes--wide'],
  ] as [Mood, string][])('%s mood shows %s for every animal', (mood, sel) => {
    for (const a of animals) expect(drawBuddy(a, mood, 48).querySelector(sel), `${a}`).not.toBeNull();
  });

  test('props belong to their mood only', () => {
    expect(drawBuddy('cat', 'wave', 48).querySelector('.b-prop-book, .b-prop-cup, .b-z, .b-heart, .b-tear')).toBeNull();
    expect(drawBuddy('cat', 'study', 48).querySelector('.b-prop-cup')).toBeNull();
  });

  test('blinking open eyes except when asleep or celebrating (closed, happy eyes)', () => {
    expect(drawBuddy('fox', 'study', 48).querySelector('.b-eyes--open')).not.toBeNull();
    expect(drawBuddy('fox', 'sleep', 48).querySelector('.b-eyes--closed')).not.toBeNull();
    expect(drawBuddy('fox', 'sleep', 48).querySelector('.b-eyes--open')).toBeNull();
  });

  test('reduced motion: still class when asked or when the media query matches', () => {
    expect(drawBuddy('cat', 'wave', 48, { still: true }).classList.contains('buddy--still')).toBe(true);
    expect(drawBuddy('cat', 'wave', 48, { still: false }).classList.contains('buddy--still')).toBe(false);
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    expect(drawBuddy('cat', 'wave', 48).classList.contains('buddy--still')).toBe(true);
    expect(window.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
    expect(drawBuddy('cat', 'wave', 48).classList.contains('buddy--still')).toBe(false);
  });

  test('classes name the animal and mood for the stylesheet', () => {
    const svg = drawBuddy('panda', 'celebrate', 48);
    expect(svg.classList.contains('buddy')).toBe(true);
    expect(svg.classList.contains('buddy--panda')).toBe(true);
    expect(svg.classList.contains('buddy--celebrate')).toBe(true);
  });

  test('never uses innerHTML-style APIs', () => {
    const setter = vi.spyOn(Element.prototype, 'innerHTML', 'set');
    const adj = vi.spyOn(Element.prototype, 'insertAdjacentHTML');
    for (const [a, m] of combos) drawBuddy(a, m, 48);
    expect(setter).not.toHaveBeenCalled();
    expect(adj).not.toHaveBeenCalled();
    const drawSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../buddy/draw.ts'), 'utf8');
    expect(drawSrc).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|DOMParser|createContextualFragment/);
  });
});

describe('buddySlot', () => {
  test('redraws only when the animal or mood changes (keeps animations running)', () => {
    const host = document.createElement('div');
    const slot = buddySlot(host, 48);
    slot.set('cat', 'study');
    const first = host.firstElementChild;
    expect(first?.getAttribute('data-mood')).toBe('study');
    slot.set('cat', 'study');
    expect(host.firstElementChild).toBe(first);
    slot.set('cat', 'sad');
    expect(host.firstElementChild?.getAttribute('data-mood')).toBe('sad');
    slot.set('fox', 'sad');
    expect(host.firstElementChild?.getAttribute('data-animal')).toBe('fox');
    expect(host.children.length).toBe(1);
  });
});

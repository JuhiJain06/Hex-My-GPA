/// <reference types="node" />
// @vitest-environment jsdom
import { describe, test, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANIMALS, MOODS, type Animal, type Mood } from '../src/index';
import { drawStudyScene, SCENE_ASPECT } from '../buddy/scene';

const SVG_NS = 'http://www.w3.org/2000/svg';
const combos = ANIMALS.flatMap((a) => MOODS.map((m) => [a.id, m] as [Animal, Mood]));
const has = (svg: Element, sel: string) => svg.querySelector(sel) !== null;

afterEach(() => vi.restoreAllMocks());

describe('drawStudyScene', () => {
  test.each(combos)('%s × %s renders the desk, lamp and the buddy', (animal, mood) => {
    const svg = drawStudyScene(animal, mood, 180);
    expect(svg.namespaceURI).toBe(SVG_NS);
    expect(svg.tagName).toBe('svg');
    expect(svg.getAttribute('class')).toMatch(/\bscene\b/);
    expect(svg.getAttribute('data-animal')).toBe(animal);
    expect(svg.getAttribute('data-mood')).toBe(mood);
    expect(svg.getAttribute('width')).toBe('180');
    expect(Number(svg.getAttribute('height'))).toBe(Math.round(180 / SCENE_ASPECT));
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toMatch(new RegExp(ANIMALS.find((a) => a.id === animal)!.label));
    expect(has(svg, '.s-desk')).toBe(true);
    expect(has(svg, '.s-lamp')).toBe(true);
    const inner = svg.querySelector('svg.buddy');
    expect(inner?.getAttribute('data-animal')).toBe(animal);
    // The buddy's own hand-held props are replaced by the desk props.
    expect(has(svg, '.b-prop')).toBe(false);
    for (const el of svg.querySelectorAll('*')) expect(el.namespaceURI).toBe(SVG_NS);
  });

  test('studying: an open book with a turning page, a pencil that wiggles, and a steaming mug', () => {
    const svg = drawStudyScene('cat', 'study', 180);
    expect(has(svg, '.s-book--open')).toBe(true);
    expect(has(svg, '.s-page-turn')).toBe(true);
    expect(has(svg, '.s-pencil')).toBe(true);
    expect(has(svg, '.s-mug .s-steam')).toBe(true);
    expect(svg.querySelector('svg.buddy')?.getAttribute('data-mood')).toBe('study');
  });

  test('break: stretches, then relaxes with the mug; the book is closed', () => {
    const svg = drawStudyScene('fox', 'break', 180);
    expect(has(svg, '.s-stretch')).toBe(true);
    expect(has(svg, '.s-mug')).toBe(true);
    expect(has(svg, '.s-book--closed')).toBe(true);
    expect(has(svg, '.s-pencil')).toBe(false);
  });

  test('sleep: head down on the desk, arms folded, z\'s, lamp dimmed', () => {
    const svg = drawStudyScene('panda', 'sleep', 180);
    expect(has(svg, '.s-buddy--head-down')).toBe(true);
    expect(has(svg, '.s-arms-folded')).toBe(true);
    expect(has(svg, '.b-z')).toBe(true);
    expect(has(svg, '.s-lamp--dim')).toBe(true);
  });

  test('celebrate keeps the hearts; sad keeps the tear', () => {
    expect(has(drawStudyScene('bunny', 'celebrate', 180), '.b-heart')).toBe(true);
    expect(has(drawStudyScene('bunny', 'sad', 180), '.b-tear')).toBe(true);
  });

  test('the folded arms use the animal\'s limb color (panda arms are dark)', () => {
    const fill = (a: Animal) => drawStudyScene(a, 'sleep', 180).querySelector('.s-arms-folded ellipse')?.getAttribute('fill');
    expect(fill('panda')).not.toBe(fill('cat'));
  });

  test('every mood gives a different scene', () => {
    const sig = (m: Mood) => [...drawStudyScene('cat', m, 120).querySelectorAll('*')].map((e) => e.getAttribute('class') ?? e.tagName).join('|');
    expect(new Set(MOODS.map(sig)).size).toBe(MOODS.length);
  });

  test('reduced motion: a still scene (and a still buddy)', () => {
    const saved = window.matchMedia;
    try {
      window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
      const svg = drawStudyScene('cat', 'study', 180);
      expect(svg.getAttribute('class')).toMatch(/scene--still/);
      expect(svg.querySelector('svg.buddy')?.getAttribute('class')).toMatch(/buddy--still/);
      expect(drawStudyScene('cat', 'study', 180, { still: false }).getAttribute('class')).not.toMatch(/still/);
      window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
      expect(drawStudyScene('cat', 'study', 180).getAttribute('class')).not.toMatch(/still/);
    } finally {
      window.matchMedia = saved;
    }
  });

  test('glow and z\'s never catch the mouse', () => {
    const svg = drawStudyScene('cat', 'sleep', 180);
    expect(svg.querySelector('.s-glow')?.getAttribute('pointer-events')).toBe('none');
  });

  test('built with DOM APIs only (no HTML parsing)', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../buddy/scene.ts'), 'utf8');
    expect(src).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|DOMParser/);
  });

  test('the scene animations exist in buddy.css and stop for reduced motion', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../buddy/buddy.css'), 'utf8');
    for (const k of ['s-page-turn', 's-pencil', 's-steam', 's-stretch']) expect(css).toContain(`.${k}`);
    expect(css).toMatch(/\.scene--still/);
    expect(css).toMatch(/prefers-reduced-motion[\s\S]*\.scene/);
  });
});

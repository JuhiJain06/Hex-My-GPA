/// <reference types="node" />
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { contrastRatio, parseColor, parseTokens, type Scheme } from '../theme/tokens';
import { toShadowCss } from '../theme/tokensCss';

const css = readFileSync(new URL('../theme/tokens.css', import.meta.url), 'utf8');
const tokens = parseTokens(css);
const SCHEMES: Scheme[] = ['light', 'dark'];

/**
 * Every text/background pair the UI uses (desktop windows, extension pages, YouTube card).
 * WCAG AA body text: 4.5:1. `--overlay` is translucent, so it is checked over black and white.
 */
const PAIRS: [fg: string, bg: string][] = [
  ['--text', '--bg'], ['--text', '--card'], ['--text', '--panel'],
  ['--muted', '--bg'], ['--muted', '--card'], ['--muted', '--panel'],
  ['--on-accent', '--accent'],
  ['--on-mint', '--mint'],
  ['--on-lavender', '--lavender'],
  ['--accent-text', '--bg'], ['--accent-text', '--card'],
  ['--warn', '--bg'], ['--warn', '--card'],
  ['--danger', '--bg'], ['--danger', '--card'],
  ['--ok', '--bg'], ['--ok', '--card'],
  ['--text', '--overlay'], ['--muted', '--overlay'],
];

describe('theme tokens', () => {
  test('both schemes define every token the light scheme defines', () => {
    expect(Object.keys(tokens.light).length).toBeGreaterThan(10);
    for (const name of Object.keys(tokens.light)) expect(tokens.dark[name], name).toBeDefined();
  });

  test('dark overrides every color token', () => {
    for (const [fg, bg] of PAIRS) {
      expect(tokens.dark[fg], fg).not.toBe(tokens.light[fg]);
      expect(tokens.dark[bg], bg).not.toBe(tokens.light[bg]);
    }
  });

  test('rounded corners are 12-16 px and the font stack is local and rounded', () => {
    const r = Number.parseFloat(tokens.light['--radius'] ?? '');
    expect(r).toBeGreaterThanOrEqual(12);
    expect(r).toBeLessThanOrEqual(16);
    expect(tokens.light['--font']).toMatch(/Nunito/);
    expect(css).not.toMatch(/@import|@font-face|url\(/);
  });

  for (const scheme of SCHEMES) {
    test.each(PAIRS)(`${scheme}: %s on %s is at least 4.5:1`, (fg, bg) => {
      const t = tokens[scheme];
      expect(t[fg], fg).toBeDefined();
      expect(t[bg], bg).toBeDefined();
      const backdrops = parseColor(t[bg]!).a < 1 ? ['#000000', '#ffffff'] : [t[bg]!];
      for (const under of backdrops) {
        const ratio = contrastRatio(t[fg]!, t[bg]!, under);
        expect(ratio, `${fg} on ${bg} over ${under} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});

describe('shadow-root tokens', () => {
  test('rewrites :root to :host and keeps every token', () => {
    const shadow = toShadowCss(css);
    expect(shadow).not.toMatch(/:root/);
    expect(parseTokens(shadow.replaceAll(':host', ':root'))).toEqual(tokens);
  });
});

describe('contrast helpers', () => {
  test('black on white is 21:1, same on same is 1:1', () => {
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
  });
  test('translucent backgrounds are composited over the backdrop', () => {
    expect(contrastRatio('#000000', 'rgba(255, 255, 255, 0)', '#000000')).toBeCloseTo(1, 5);
    expect(contrastRatio('#000000', 'rgba(255, 255, 255, 1)', '#000000')).toBeCloseTo(21, 5);
  });
  test('dark block overrides light values; the rest inherit', () => {
    const t = parseTokens(':root { --a: #111; --b: 12px; } /* x */ @media (prefers-color-scheme: dark) { :root { --a: #eee; } }');
    expect(t.light).toEqual({ '--a': '#111', '--b': '12px' });
    expect(t.dark).toEqual({ '--a': '#eee', '--b': '12px' });
  });
});

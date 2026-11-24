/**
 * Reads the shared theme (tokens.css): the custom properties of its top-level `:root` block (light)
 * and of the `:root` block inside `@media (prefers-color-scheme: dark)` (dark = light + overrides).
 * Also WCAG contrast helpers for the contrast test. No DOM, no Node APIs.
 */
export type Scheme = 'light' | 'dark';
export type TokenMap = Record<string, string>;

const DARK_MEDIA = /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{\s*:root\s*\{([^}]*)\}\s*\}/;

function declarations(body: string): TokenMap {
  const out: TokenMap = {};
  for (const decl of body.split(';')) {
    const m = /^\s*(--[\w-]+)\s*:\s*([\s\S]+?)\s*$/.exec(decl);
    if (m) out[m[1]!] = m[2]!.replace(/\s+/g, ' ');
  }
  return out;
}

export function parseTokens(css: string): Record<Scheme, TokenMap> {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const darkMatch = DARK_MEDIA.exec(src);
  const rest = darkMatch ? src.replace(darkMatch[0], '') : src;
  const lightMatch = /:root\s*\{([^}]*)\}/.exec(rest);
  const light = lightMatch ? declarations(lightMatch[1]!) : {};
  const dark = { ...light, ...(darkMatch ? declarations(darkMatch[1]!) : {}) };
  return { light, dark };
}

export interface Rgba { r: number; g: number; b: number; a: number }

export function parseColor(s: string): Rgba {
  const v = s.trim().toLowerCase();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(v);
  if (m) {
    let h = m[1]!;
    if (h.length === 3) h = [...h].map((c) => c + c).join('');
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(v);
  if (m) return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] === undefined ? 1 : Number(m[4]) };
  throw new Error(`unsupported color: ${s}`);
}

function over(top: Rgba, under: Rgba): Rgba {
  const mix = (a: number, b: number) => a * top.a + b * (1 - top.a);
  return { r: mix(top.r, under.r), g: mix(top.g, under.g), b: mix(top.b, under.b), a: 1 };
}

function luminance({ r, g, b }: Rgba): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast of `fg` on `bg`; translucent colors are composited (bg over `backdrop`, fg over bg). */
export function contrastRatio(fg: string, bg: string, backdrop = '#ffffff'): number {
  const back = over(parseColor(bg), parseColor(backdrop));
  const front = over(parseColor(fg), back);
  const [hi, lo] = [luminance(front), luminance(back)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** One token's value for a scheme (e.g. a window's native background color), or `fallback`. */
export function tokenValue(css: string, name: string, scheme: Scheme, fallback: string): string {
  return parseTokens(css)[scheme][name] ?? fallback;
}

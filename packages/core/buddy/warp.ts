import type { PartKind, RigPart } from './rigs';

/**
 * Ear and tail motion: a port of the approved preview (art/warp-prototype.js), unchanged in how it
 * looks. Each part bends as an inverse-mapped rotation about its base: every pixel in the part's
 * capsule shows the source pixel rotated by -angle·weight about the base, where the weight rises
 * toward the tip (s^1.3) and falls off softly away from the base→tip line. Nothing is duplicated,
 * the base never moves, and samples from outside the image are transparent. Pure (RGBA arrays in,
 * RGBA arrays out); the canvas wrapper is animator.ts.
 */

/** A rig part with its precomputed geometry and its phase. */
export interface WarpPart extends RigPart {
  dx: number;
  dy: number;
  /** Base→tip length. */
  L: number;
  /** Capsule radius around the base→tip line. */
  r: number;
  /** The capsule's bounding box, clamped to the image (x1, y1 exclusive). */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Phase offset (radians) so parts don't move in step. */
  ph: number;
}

/**
 * The parts' geometry for a w×h image. `phases[i]` defaults to the preview's `i * 1.7 + random`,
 * so the ears are slightly out of step and each sprite differs a little.
 */
export function prepareParts(parts: readonly RigPart[], w: number, h: number, phases?: readonly number[]): WarpPart[] {
  return parts.map((p, i) => {
    const dx = p.t[0] - p.b[0];
    const dy = p.t[1] - p.b[1];
    const L = Math.hypot(dx, dy);
    const r = Math.max(18, L * 0.55);
    return {
      ...p, dx, dy, L, r,
      x0: Math.max(0, Math.floor(Math.min(p.b[0], p.t[0]) - r)),
      x1: Math.min(w, Math.ceil(Math.max(p.b[0], p.t[0]) + r)),
      y0: Math.max(0, Math.floor(Math.min(p.b[1], p.t[1]) - r)),
      y1: Math.min(h, Math.ceil(Math.max(p.b[1], p.t[1]) + r)),
      ph: phases?.[i] ?? i * 1.7 + Math.random(),
    };
  });
}

/**
 * A part's angle (radians) at time `t` seconds. Tails: a slow swish. Ears: a small sway plus an
 * occasional quick twitch. `slow` (asleep): much smaller and slower, and ears never twitch.
 */
export function partAngle(part: { k: PartKind; ph: number }, t: number, slow: boolean): number {
  if (part.k === 'tail') return (slow ? 0.05 : 0.13) * Math.sin(t * (slow ? 1.1 : 2.4) + part.ph);
  const tw = Math.max(0, Math.sin(t * 0.9 + part.ph)) ** 24;
  return (slow ? 0.03 : 0.06) * Math.sin(t * (slow ? 0.9 : 1.8) + part.ph) + (slow ? 0 : 0.16 * tw * Math.sin(t * 22));
}

export interface WarpOptions {
  /** Asleep: the small, slow motion. */
  slow?: boolean;
  /** Overrides partAngle (tests). */
  angle?: (part: WarpPart, t: number) => number;
  /**
   * `dst` already equals `src` outside the parts' boxes (the previous frame, say): restore and warp
   * only the boxes instead of copying the whole picture. Same result.
   */
  boxesOnly?: boolean;
}

/** The union of the parts' boxes, [x0, y0, x1, y1] (x1, y1 exclusive), or null for no parts. */
export function partsBox(parts: readonly WarpPart[]): [number, number, number, number] | null {
  if (parts.length === 0) return null;
  return [
    Math.min(...parts.map((p) => p.x0)), Math.min(...parts.map((p) => p.y0)),
    Math.max(...parts.map((p) => p.x1)), Math.max(...parts.map((p) => p.y1)),
  ];
}

/**
 * Writes the frame at time `t` (seconds) into `dst`: a copy of `src` with each part bent by its
 * angle. Only each part's bounding box is warped (and, with `boxesOnly`, only those boxes are
 * written at all). `src` and `dst` are w×h RGBA.
 */
export function warpFrame(
  src: ArrayLike<number>,
  dst: Uint8ClampedArray,
  w: number,
  h: number,
  parts: readonly WarpPart[],
  t: number,
  opts: WarpOptions = {},
): void {
  if (opts.boxesOnly) {
    for (const p of parts) {
      for (let y = p.y0; y < p.y1; y++) {
        const a = (y * w + p.x0) * 4;
        const b = (y * w + p.x1) * 4;
        for (let i = a; i < b; i++) dst[i] = src[i]!;
      }
    }
  } else {
    dst.set(src);
  }
  const slow = opts.slow ?? false;
  for (const p of parts) {
    const a = opts.angle ? opts.angle(p, t) : partAngle(p, t, slow);
    const [bx, by] = p.b;
    const L2 = p.L * p.L;
    for (let y = p.y0; y < p.y1; y++) {
      for (let x = p.x0; x < p.x1; x++) {
        const ux = x - bx;
        const uy = y - by;
        // Where along base→tip this pixel is (0 at the base, 1 at the tip); a little past the tip still bends.
        const s = (ux * p.dx + uy * p.dy) / L2;
        if (s <= 0 || s > 1.35) continue;
        const px = bx + p.dx * Math.min(s, 1);
        const py = by + p.dy * Math.min(s, 1);
        const dist = Math.hypot(x - px, y - py);
        if (dist > p.r) continue;
        const fall = 1 - (dist / p.r) ** 2;
        const wgt = Math.min(1, s) ** 1.3 * fall;
        const th = -a * wgt;
        const co = Math.cos(th);
        const si = Math.sin(th);
        const sx = Math.round(bx + ux * co - uy * si);
        const sy = Math.round(by + ux * si + uy * co);
        const o = (y * w + x) * 4;
        if (sx < 0 || sy < 0 || sx >= w || sy >= h) { dst[o + 3] = 0; continue; }
        const q = (sy * w + sx) * 4;
        dst[o] = src[q]!;
        dst[o + 1] = src[q + 1]!;
        dst[o + 2] = src[q + 2]!;
        dst[o + 3] = src[q + 3]!;
      }
    }
  }
}

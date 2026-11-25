import type { RigPart } from './rigs';
import { partsBox, prepareParts, warpFrame, type WarpPart } from './warp';

/**
 * Draws one picture into a `<canvas>` (sized to the image's natural size; CSS scales it) and bends
 * its ears and tail with warp.ts at about 30 fps. The loop pauses while the page is hidden or the
 * canvas has left the page; under prefers-reduced-motion the plain picture is drawn once. Showing a
 * new picture keeps the old frame up until the new image has loaded and its first frame is drawn
 * (no flicker). If the pixels can't be read (a tainted canvas, no 2D context), `onFail` is called so
 * the caller can show a plain `<img>` instead.
 */

/** Frames per second of the part motion. */
export const FPS = 30;
const FRAME_MS = 1000 / FPS;
const REDUCED = '(prefers-reduced-motion: reduce)';

export interface Animator {
  /**
   * Shows `src` with `parts` moving (`slow`: asleep). `onSwap(w, h)` runs right before the new
   * picture's first frame is drawn, in the same task, so the caller can resize around it.
   */
  show(src: string, parts: readonly RigPart[], slow: boolean, onSwap?: (w: number, h: number) => void): void;
  /** Stops the loop and drops the listeners (the canvas keeps its last frame). */
  destroy(): void;
}

interface Current {
  w: number;
  h: number;
  src: ImageData;
  out: ImageData;
  parts: WarpPart[];
  slow: boolean;
  /** The parts' union box: the only area a frame changes. */
  box: [number, number, number, number] | null;
}

export function createAnimator(canvas: HTMLCanvasElement, onFail: (src: string, err: unknown) => void): Animator {
  const doc = canvas.ownerDocument;
  const mq = typeof matchMedia === 'function' ? matchMedia(REDUCED) : null;
  let ctx: CanvasRenderingContext2D | null = null;
  let cur: Current | null = null;
  let ticket = 0;
  let raf = 0;
  let last = -Infinity;
  /** The canvas has been in the page: leaving it afterwards stops the loop for good (until the next show). */
  let attached = false;
  let dead = false;

  const reduced = () => mq?.matches === true;
  /** Taken out of the page after being in it (a sprite that was replaced or thrown away). */
  const gone = () => {
    if (canvas.isConnected) attached = true;
    return attached && !canvas.isConnected;
  };
  const moving = () => !dead && cur !== null && cur.parts.length > 0 && !reduced() && !doc.hidden && !gone();

  const still = () => { if (ctx && cur) ctx.putImageData(cur.src, 0, 0); };
  const draw = (ms: number) => {
    if (!ctx || !cur) return;
    // `out` holds the last frame, equal to the picture outside the parts' boxes: redo just those.
    warpFrame(cur.src.data, cur.out.data, cur.w, cur.h, cur.parts, ms / 1000, { slow: cur.slow, boxesOnly: true });
    const b = cur.box;
    if (b) ctx.putImageData(cur.out, 0, 0, b[0], b[1], b[2] - b[0], b[3] - b[1]);
    else ctx.putImageData(cur.out, 0, 0);
  };

  function tick(ms: number): void {
    raf = 0;
    if (!moving()) return; // hidden, reduced motion, or removed from the page: stop
    // About 30 fps on a 60 Hz (or faster) display; a little slack so 60 Hz doesn't drop to 20.
    if (canvas.isConnected && ms - last >= FRAME_MS - 4) {
      last = ms;
      draw(ms);
    }
    raf = requestAnimationFrame(tick);
  }

  /** Starts or stops the loop to match visibility and the motion setting. */
  function run(): void {
    if (moving()) {
      if (!raf) raf = requestAnimationFrame(tick);
    } else if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }
  /** Visibility or the motion setting changed (reduced motion: back to the still picture). */
  function sync(): void {
    run();
    if (reduced() && !dead) still();
  }
  doc.addEventListener('visibilitychange', sync);
  mq?.addEventListener?.('change', sync);

  return {
    show(src, parts, slow, onSwap) {
      const mine = ++ticket;
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        if (mine !== ticket || dead) return;
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        let pixels: ImageData;
        let next: CanvasRenderingContext2D;
        try {
          // Read the pixels off-screen, so a failure leaves the shown frame alone.
          const off = doc.createElement('canvas');
          off.width = w;
          off.height = h;
          const octx = off.getContext('2d', { willReadFrequently: true });
          if (!octx) throw new Error('no 2d context');
          octx.drawImage(img, 0, 0);
          pixels = octx.getImageData(0, 0, w, h); // throws when the canvas is tainted
          const c = canvas.getContext('2d');
          if (!c) throw new Error('no 2d context');
          next = c;
        } catch (err) {
          if (raf) { cancelAnimationFrame(raf); raf = 0; }
          cur = null;
          onFail(src, err);
          return;
        }
        onSwap?.(w, h);
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;
        ctx = next;
        const out = next.createImageData(w, h);
        out.data.set(pixels.data);
        const prepared = prepareParts(parts, w, h);
        cur = { w, h, src: pixels, out, parts: prepared, slow, box: partsBox(prepared) };
        attached = false;
        last = -Infinity;
        // The whole new picture first (draw() then repaints only the moving parts).
        still();
        if (moving()) draw(performance.now());
        run();
      };
      img.onerror = () => { if (mine === ticket) console.warn('buddy: picture failed to load', src); };
      img.src = src;
    },
    destroy() {
      dead = true;
      ticket++;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      doc.removeEventListener('visibilitychange', sync);
      mq?.removeEventListener?.('change', sync);
    },
  };
}

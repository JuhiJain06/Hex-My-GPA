/** Window sizes shared by the main process and the renderers. Pure; no Electron imports. */

/** The desktop pet window (bubble + scene) with its menu closed. */
export const PET_W = 200;
export const PET_H = 220;
/** The pet's menu beside it (including a small gap). */
export const PET_MENU_W = 244;

/** Space kept free below a window's height on the primary display's work area. */
export const SCREEN_MARGIN = 40;

/** Clamps a window height to the work area (minus SCREEN_MARGIN); never below 100 px. */
export function clampHeight(height: number, workAreaHeight: number): number {
  return Math.max(100, Math.min(height, workAreaHeight - SCREEN_MARGIN));
}

/** Gap between stacked prompt windows and from the work-area edges. */
export const STACK_MARGIN = 16;
export const CHECKIN_SIZE = { laptop: { w: 340, h: 150 }, book: { w: 380, h: 220 } } as const;
export const PROMPT_SIZE = { w: 340, h: 130 } as const;
export const OFFER_SIZE = { w: 360, h: 150 } as const;

export type StackSlot = 'checkin-laptop' | 'checkin-book' | 'prompt' | 'offer';
export interface Rect { x: number; y: number; width: number; height: number }

/**
 * Bottom-right stack of the small prompt windows, so no two ever share a spot (a click or Ctrl+Alt+Y
 * meant for one can't land on another): the check-in at the bottom, the gray-app prompt above the
 * tallest (book) check-in, the unlisted-app offer above the prompt.
 */
export function stackBounds(slot: StackSlot, wa: Rect): Rect {
  const size = slot === 'checkin-laptop' ? CHECKIN_SIZE.laptop : slot === 'checkin-book' ? CHECKIN_SIZE.book
    : slot === 'prompt' ? PROMPT_SIZE : OFFER_SIZE;
  const above = slot === 'prompt' ? CHECKIN_SIZE.book.h + STACK_MARGIN
    : slot === 'offer' ? CHECKIN_SIZE.book.h + STACK_MARGIN + PROMPT_SIZE.h + STACK_MARGIN : 0;
  return {
    x: wa.x + wa.width - size.w - STACK_MARGIN,
    y: wa.y + wa.height - size.h - STACK_MARGIN - above,
    width: size.w,
    height: size.h,
  };
}

/** Window sizes shared by the main process and the renderers. Pure; no Electron imports. */

/**
 * The desktop pet window with its menu closed: the pet's picture stands at the bottom (its feet
 * PET_FOOT_GAP above the window's bottom, which sits on the work area's bottom, i.e. the taskbar),
 * with room for the speech bubble above it. Wide enough for the widest scene (PET_ART_MAX_W) plus
 * a little margin.
 */
export const PET_W = 336;
export const PET_H = 230;
/** The pet's picture height in the pet window (its width follows each picture's aspect ratio). */
export const PET_ART_H = 150;
/** The widest the picture may be; a wider scene is shown shorter so it fits. */
export const PET_ART_MAX_W = 320;
/** Gap between the bottom of the pet's feet and the taskbar. */
export const PET_FOOT_GAP = 6;
/** Room above the pet's head for the bubble (the planned-length notice with its buttons is the tallest). */
export const PET_BUBBLE_ROOM = PET_H - PET_ART_H - PET_FOOT_GAP;
/** Gap between the top of the picture and the bubble's tail. */
export const PET_BUBBLE_GAP = 8;
/** The bubble's bottom (px above the window's bottom) over a picture `artH` px tall. */
export const bubbleBottom = (artH: number): number => PET_FOOT_GAP + artH + PET_BUBBLE_GAP;
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

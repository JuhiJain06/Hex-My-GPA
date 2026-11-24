/** Window sizes shared by the main process and the mini renderer. Pure; no Electron imports. */

/** The mini timer: wide enough for two rows of two labelled buttons. */
export const MINI_W = 280;
/** Collapsed mini height (sound panel closed). */
export const MINI_H = 180;
/** Tallest the mini grows with the sound panel open (before the screen clamp). */
export const MINI_MAX_H = 420;

/** Space kept free below a window's height on the primary display's work area. */
export const SCREEN_MARGIN = 40;

/** Clamps a window height to the work area (minus SCREEN_MARGIN); never below 100 px. */
export function clampHeight(height: number, workAreaHeight: number): number {
  return Math.max(100, Math.min(height, workAreaHeight - SCREEN_MARGIN));
}

/** Clicks this soon after a prompt window is shown are ignored (they were meant for what was underneath). */
export const CLICK_ARM_MS = 500;

export interface ClickArming {
  /** Call when the window becomes visible again. */
  shown(): void;
  ready(): boolean;
  /** Wraps a click handler so it only runs once armed. */
  guard<A extends unknown[]>(fn: (...a: A) => void): (...a: A) => void;
}

/**
 * Click-through protection for prompt windows that pop up under the pointer (shown inactive):
 * armed CLICK_ARM_MS after creation and after each `shown()`. Pure; the clock is injected.
 */
export function createClickArming(clock: () => number, ms = CLICK_ARM_MS): ClickArming {
  let shownAt = clock();
  const ready = () => clock() - shownAt >= ms;
  return {
    shown: () => { shownAt = clock(); },
    ready,
    guard: (fn) => (...a) => { if (ready()) fn(...a); },
  };
}

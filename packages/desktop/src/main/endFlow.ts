/** The sound fade-out is 2 s; the mini window hosts the audio, so it must outlive it. */
export const MINI_FADE_CLOSE_MS = 2200;

/**
 * Closes the mini window after the sound has faded out. If a new session started in the
 * meantime the (reused) mini window belongs to it, so it is left open.
 */
export function scheduleMiniClose(close: () => void, sessionActive: () => boolean): void {
  setTimeout(() => { if (!sessionActive()) close(); }, MINI_FADE_CLOSE_MS);
}

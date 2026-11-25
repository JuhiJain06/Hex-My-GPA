/** The sound fade-out is 2 s; the pet window hosts the audio, so it must outlive it. */
export const PET_FADE_CLOSE_MS = 2200;

/**
 * Closes the pet window after the sound has faded out. If a new session started in the
 * meantime the (reused) pet window belongs to it, so it is left open.
 */
export function schedulePetClose(close: () => void, sessionActive: () => boolean): void {
  setTimeout(() => { if (!sessionActive()) close(); }, PET_FADE_CLOSE_MS);
}

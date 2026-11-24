import type { Rhythm } from '@study-buddy/core';

/**
 * Env-driven dev switches, read once at startup. For manual checks only.
 * - BUDDY_FAST=1      short rhythm (3/1/2 min, long break every 3) and fast check-ins
 * - BUDDY_DEBUG=1     log engine events and phase changes to stdout
 * - BUDDY_AUTOSTART=t start a laptop session with topic t on launch (unless one is resumed)
 * - BUDDY_DATA_DIR=d  use d as userData (keeps manual-check data out of the real profile)
 * - BUDDY_NO_GUARD=1  the app guard logs what it would do but shows no overlay, prompt or offer
 *                     (use for every live check on a real desktop)
 */
export const fastMode = process.env.BUDDY_FAST === '1';
export const debug = process.env.BUDDY_DEBUG === '1';
export const autostartTopic = process.env.BUDDY_AUTOSTART?.trim() || null;
export const noGuard = process.env.BUDDY_NO_GUARD === '1';
export const dataDirOverride = process.env.BUDDY_DATA_DIR?.trim() || null;

export const FAST_RHYTHM: Rhythm = { focusMin: 3, shortBreakMin: 1, longBreakMin: 2, longBreakEvery: 3 };
/** Task 8 reads this when fastMode is on: a check-in every 1 min, unanswered after 20 s. */
export const FAST_CHECKIN = { everyMin: 1, timeoutSec: 20 } as const;

/** The rhythm override for SessionController, or undefined to use settings. */
export const rhythmOverride: Rhythm | undefined = fastMode ? FAST_RHYTHM : undefined;

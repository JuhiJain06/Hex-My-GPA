import type { Mode } from './settings';

export const CHECKIN = {
  laptop: { baseMin: 25, timeoutMin: 2 },
  book: { baseMin: 15, timeoutMin: 5 },
  jitterMin: 5,
} as const;

export interface CheckinConfig {
  readonly laptop: { readonly baseMin: number; readonly timeoutMin: number };
  readonly book: { readonly baseMin: number; readonly timeoutMin: number };
  readonly jitterMin: number;
}

const M = 60_000;

export function nextCheckinAt(
  mode: Mode,
  from: number,
  rand: () => number = Math.random,
  config: CheckinConfig = CHECKIN,
): number {
  return from + (config[mode].baseMin + (rand() * 2 - 1) * config.jitterMin) * M;
}

/** 'pause' means the pause runs with since = shownAt. */
export function resolveUnanswered(
  mode: Mode,
  shownAt: number,
  now: number,
  idleSec: number,
  config: CheckinConfig = CHECKIN,
): 'wait' | 'pause' | 'ignored' {
  const elapsed = now - shownAt;
  if (elapsed < config[mode].timeoutMin * M) return 'wait';
  return idleSec * 1000 >= elapsed ? 'pause' : 'ignored';
}

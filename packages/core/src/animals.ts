import type { Phase } from './engine';

export type Animal = 'cat' | 'fox' | 'panda' | 'bunny' | 'penguin' | 'hamster';
export type Mood = 'wave' | 'study' | 'break' | 'alert' | 'sleep' | 'sad' | 'celebrate';

/** The study buddies offered in Settings, in display order. Cat is the default. */
export const ANIMALS: readonly { id: Animal; label: string }[] = [
  { id: 'cat', label: 'Cat' },
  { id: 'fox', label: 'Fox' },
  { id: 'panda', label: 'Panda' },
  { id: 'bunny', label: 'Bunny' },
  { id: 'penguin', label: 'Penguin' },
  { id: 'hamster', label: 'Hamster' },
];

export const MOODS: readonly Mood[] = ['wave', 'study', 'break', 'alert', 'sleep', 'sad', 'celebrate'];

export const isAnimal = (v: unknown): v is Animal => typeof v === 'string' && ANIMALS.some((a) => a.id === v);

/** How long the buddy looks sad after a slip. */
export const SAD_MS = 3000;
/** The break's last minute counts as the 1-minute warning. */
export const BREAK_WARNING_MS = 60_000;

export interface MoodInput {
  phase: Phase;
  /** Focus is paused (away / suspended). */
  paused: boolean;
  /** When the last slip (blocked site/app, "drifted") happened; null if none. */
  recentSlipAt: number | null;
  /** Planned length reached (until the next phase change), or the summary window. */
  celebrating: boolean;
  /** End of the current phase; used for the break's 1-minute warning. */
  phaseEndsAt?: number | null;
}

/** The buddy's mood. Precedence: celebrate > sad > sleep > alert > break > study > wave. Pure. */
export function moodFor(s: MoodInput, now: number): Mood {
  if (s.celebrating) return 'celebrate';
  if (s.recentSlipAt !== null && now >= s.recentSlipAt && now - s.recentSlipAt < SAD_MS) return 'sad';
  if (s.paused) return 'sleep';
  if (s.phase === 'awaitingNext') return 'alert';
  if (s.phase === 'break') {
    const end = s.phaseEndsAt ?? null;
    return end !== null && end - now <= BREAK_WARNING_MS ? 'alert' : 'break';
  }
  if (s.phase === 'focus') return 'study';
  return 'wave';
}

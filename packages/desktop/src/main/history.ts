import { dailyTotals, localDay, streak, topTags } from '@study-buddy/core';
import type { Db } from './db';

export const HISTORY_DAYS = 30;

export interface History {
  /** Exactly 30 local days ending today, oldest first, zero-filled. */
  days: { day: string; ms: number }[];
  /** Reflection tags from the same 30 days, most common first. */
  tags: { tag: string; count: number }[];
  /** Consecutive days at or above settings.streakMinMinutes, counting `extra`. */
  streakDays: number;
}

const startOfDay = (ms: number, daysBack: number): number => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysBack).getTime();
};

/** `extra` holds intervals not yet in the db (the running session) so today's total includes them. */
export function buildHistory(db: Db, now: number, extra: [number, number][] = []): History {
  const since = startOfDay(now, HISTORY_DAYS - 1);
  const totals = dailyTotals([...db.intervalsSince(since), ...extra]);
  const days: History['days'] = [];
  for (let back = HISTORY_DAYS - 1; back >= 0; back--) {
    const day = localDay(startOfDay(now, back));
    days.push({ day, ms: totals.get(day) ?? 0 });
  }
  // The streak may reach further back than the bars.
  const longTotals = dailyTotals([...db.intervalsSince(startOfDay(now, 400)), ...extra]);
  const streakDays = streak(longTotals, localDay(now), db.getSettings().streakMinMinutes);
  return { days, tags: topTags(db.reflections(since), since), streakDays };
}

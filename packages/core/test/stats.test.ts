import { describe, expect, test } from 'vitest';
import { dailyTotals, streak, summarize, topTags, localDay, type SessionRecord, type BuddyEvent } from '../src/stats';

const M = 60_000;

function rec(focus: number, events: BuddyEvent[] = []): SessionRecord {
  return {
    id: 1,
    info: { topic: 'T', mode: 'laptop', goal: null, plannedMin: null, startedAt: 0 },
    endedAt: null,
    intervals: [[0, focus]],
    blocksCompleted: 2,
    events,
  };
}
const ev = (kind: BuddyEvent['kind'], target: string | null, detail: string | null = null): BuddyEvent => ({ at: 0, kind, target, detail });

describe('stats', () => {
  test('localDay formats local date', () => {
    expect(localDay(new Date(2026, 10, 3, 5).getTime())).toBe('2026-11-03');
  });
  test('splits an interval at local midnight', () => {
    const s = new Date(2026, 10, 23, 23, 30).getTime(), e = new Date(2026, 10, 24, 0, 45).getTime();
    const t = dailyTotals([[s, e]]);
    expect(t.get('2026-11-23')).toBe(30 * M);
    expect(t.get('2026-11-24')).toBe(45 * M);
  });
  test('streak counts back from today, or from yesterday if today is below min', () => {
    const m = new Map([['2026-11-21', 130 * M], ['2026-11-22', 125 * M], ['2026-11-23', 30 * M]]);
    expect(streak(m, '2026-11-23', 120)).toBe(2);
    m.set('2026-11-23', 120 * M);
    expect(streak(m, '2026-11-23', 120)).toBe(3);
    expect(streak(new Map(), '2026-11-23', 120)).toBe(0);
  });
  test('summarize groups slips, keeps bypasses apart, compares to average', () => {
    const s = rec(100 * M, [
      ev('slip', 'youtube.com'), ev('slip', 'youtube.com'), ev('slip', 'steam.exe'),
      ev('bypass', 'app-closed'),
      ev('checkin', null, 'yes'), ev('checkin', null, 'yes'), ev('checkin', null, 'drifted'),
      ev('checkin', null, 'pages:12'), ev('checkin', null, 'pages:8'),
      ev('overrun', null),
    ]);
    const r = summarize(s, [rec(60 * M), rec(120 * M)]);
    expect(r.focusMs).toBe(100 * M);
    expect(r.blocksCompleted).toBe(2);
    expect(r.slipsByTarget).toEqual({ 'youtube.com': 2, 'steam.exe': 1 });
    expect(r.bypasses.length).toBe(1);
    expect(r.checkins).toEqual({ yes: 2, switched: 0, drifted: 1, ignored: 0, pages: 20 });
    expect(r.overruns).toBe(1);
    expect(r.vsAverageMs).toBe(10 * M);
    expect(summarize(s, []).vsAverageMs).toBeNull();
  });
  test('topTags counts only since, sorted desc then tag asc', () => {
    const r = [
      { at: 5, tags: ['Phone', 'Tired'] },
      { at: 10, tags: ['Tired', 'Phone'] },
      { at: 11, tags: ['Tired', 'Interrupted'] },
    ];
    expect(topTags(r, 10)).toEqual([
      { tag: 'Tired', count: 2 }, { tag: 'Interrupted', count: 1 }, { tag: 'Phone', count: 1 },
    ]);
  });
});

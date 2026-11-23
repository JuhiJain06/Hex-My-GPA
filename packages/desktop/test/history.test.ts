import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, localDay, type EngineState, type SessionInfo } from '@study-buddy/core';
import { openDb, type Db } from '../src/main/db';
import { buildHistory } from '../src/main/history';

const M = 60_000;
const at = (daysBack: number, h: number, m = 0) => new Date(2026, 10, 23 - daysBack, h, m).getTime();
const NOW = at(0, 15);
let dir: string;
let db: Db;
beforeEach(async () => { dir = mkdtempSync(join(tmpdir(), 'sb-hist-')); db = await openDb(join(dir, 'sb.sqlite')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function finished(intervals: [number, number][], endedAt = intervals[intervals.length - 1][1]): number {
  const info: SessionInfo = { topic: 'T', mode: 'laptop', goal: null, plannedMin: null, startedAt: intervals[0][0] };
  const id = db.createSession(info);
  db.finishSession(id, { intervals, blocksCompleted: 1, session: info } as unknown as EngineState, endedAt);
  return id;
}

describe('buildHistory', () => {
  test('exactly 30 zero-filled days, oldest first, ending today', () => {
    const h = buildHistory(db, NOW);
    expect(h.days).toHaveLength(30);
    expect(h.days[29].day).toBe(localDay(NOW));
    expect(h.days[0].day).toBe(localDay(at(29, 12)));
    expect(h.days.every((d) => d.ms === 0)).toBe(true);
    expect(h.tags).toEqual([]);
    expect(h.streakDays).toBe(0);
  });

  test('sums finished intervals per day; ignores older than 30 days', () => {
    finished([[at(0, 9), at(0, 9, 30)], [at(0, 10), at(0, 10, 15)]]);
    finished([[at(2, 9), at(2, 10)]]);
    finished([[at(29, 9), at(29, 9, 20)]]);
    finished([[at(30, 9), at(30, 11)]]);
    const h = buildHistory(db, NOW);
    expect(h.days[29].ms).toBe(45 * M);
    expect(h.days[27].ms).toBe(60 * M);
    expect(h.days[0].ms).toBe(20 * M);
    expect(h.days.reduce((a, d) => a + d.ms, 0)).toBe(125 * M);
  });

  test('extra (live) intervals add to today without touching the db', () => {
    finished([[at(0, 9), at(0, 9, 30)]]);
    const h = buildHistory(db, NOW, [[at(0, 13), at(0, 13, 10)]]);
    expect(h.days[29].ms).toBe(40 * M);
  });

  test('tags counted only from the last 30 days, most common first', () => {
    const id = finished([[at(0, 9), at(0, 10)]]);
    db.saveReflection(id, { at: at(0, 10), goal: null, tags: ['Phone', 'Tired'], note: null });
    db.saveReflection(id, { at: at(1, 10), goal: null, tags: ['Phone'], note: null });
    db.saveReflection(id, { at: at(31, 10), goal: null, tags: ['Phone', 'Interrupted'], note: null });
    expect(buildHistory(db, NOW).tags).toEqual([{ tag: 'Phone', count: 2 }, { tag: 'Tired', count: 1 }]);
  });

  test('streak uses settings.streakMinMinutes and counts live minutes', () => {
    db.saveSettings({ ...DEFAULT_SETTINGS, streakMinMinutes: 30 });
    finished([[at(1, 9), at(1, 10)]]);
    expect(buildHistory(db, NOW).streakDays).toBe(1);
    expect(buildHistory(db, NOW, [[at(0, 13), at(0, 13, 31)]]).streakDays).toBe(2);
  });
});

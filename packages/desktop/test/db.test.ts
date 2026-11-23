import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, type EngineState, type SessionInfo } from '@study-buddy/core';
import { openDb } from '../src/main/db';

const M = 60_000;
let dir: string;
let file: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'sb-db-')); file = join(dir, 'sb.sqlite'); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const info: SessionInfo = { topic: 'Maths', mode: 'laptop', goal: 'ch3', plannedMin: 60, startedAt: 1000 };
const snap = (over: Partial<EngineState> = {}): EngineState =>
  ({ intervals: [], blocksCompleted: 0, session: info, ...over }) as unknown as EngineState;

describe('db', () => {
  test('settings default then persist across reopen', async () => {
    const db = await openDb(file);
    expect(db.getSettings()).toEqual(DEFAULT_SETTINGS);
    const changed = { ...DEFAULT_SETTINGS, streakMinMinutes: 77 };
    db.saveSettings(changed);
    expect(existsSync(file + '.tmp')).toBe(false);
    const db2 = await openDb(file);
    expect(db2.getSettings().streakMinMinutes).toBe(77);
    expect(db2.getSettings()).toEqual(changed);
  });

  test('secret is 32 hex chars and stable across reopen', async () => {
    const db = await openDb(file);
    const s = db.getSecret();
    expect(s).toMatch(/^[0-9a-f]{32}$/);
    expect(db.getSecret()).toBe(s);
    expect((await openDb(file)).getSecret()).toBe(s);
  });

  test('activeSession reports stale when heartbeat older than 10 min', async () => {
    const db = await openDb(file);
    expect(db.activeSession(0)).toBeNull();
    const id = db.createSession(info);
    db.saveSnapshot(id, snap({ blocksCompleted: 2 }), 0);
    const a = db.activeSession(9 * M)!;
    expect(a.id).toBe(id);
    expect(a.stale).toBe(false);
    expect(a.heartbeatAt).toBe(0);
    expect(a.snapshot.blocksCompleted).toBe(2);
    expect(db.activeSession(11 * M)!.stale).toBe(true);
  });

  test('finishSession clears active session and stores intervals for sessions()/intervalsSince()', async () => {
    const db = await openDb(file);
    const id = db.createSession(info);
    db.finishSession(id, snap({ intervals: [[1000, 2000], [5000, 9000]], blocksCompleted: 3 }), 10_000);
    db.finishSession(id, snap({ intervals: [[1000, 2000], [5000, 9000]], blocksCompleted: 3 }), 10_000);
    expect(db.activeSession(20_000)).toBeNull();
    const live = db.createSession(info);
    db.saveSnapshot(live, snap({ intervals: [[50_000, 60_000]] }), 1);
    expect(db.intervalsSince(0)).toEqual([[1000, 2000], [5000, 9000]]);
    expect(db.intervalsSince(3000)).toEqual([[5000, 9000]]);
    const re = await openDb(file);
    const list = re.sessions(0);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, info, endedAt: 10_000, blocksCompleted: 3, intervals: [[1000, 2000], [5000, 9000]], events: [] });
    expect(re.sessions(10_001)).toEqual([]);
  });

  test('events and reflections round-trip', async () => {
    const db = await openDb(file);
    const id = db.createSession(info);
    db.addEvent(id, { at: 5, kind: 'slip', target: 'youtube.com', detail: null });
    db.addEvent(id, { at: 7, kind: 'checkin', target: null, detail: 'ok' });
    db.saveReflection(id, { at: 9000, goal: 'partly', tags: ['tired', 'noisy'], note: 'meh' });
    db.finishSession(id, snap(), 9500);
    const re = await openDb(file);
    expect(re.sessions(0)[0].events).toEqual([
      { at: 5, kind: 'slip', target: 'youtube.com', detail: null },
      { at: 7, kind: 'checkin', target: null, detail: 'ok' },
    ]);
    expect(re.reflections(0)).toEqual([{ at: 9000, tags: ['tired', 'noisy'] }]);
    expect(re.reflections(9001)).toEqual([]);
  });
});

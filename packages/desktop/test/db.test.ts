import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { copyFileSync, existsSync, fsyncSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, type EngineState, type SessionInfo } from '@study-buddy/core';
import { renameSync } from 'node:fs';
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
  test('nested settings merge fills missing nested defaults and keeps saved values', async () => {
    const db = await openDb(file);
    const old = {
      rhythm: { focusMin: 30, shortBreakMin: 5, longBreakMin: 20 },
      sound: { ambient: 'rain', ambientVolume: 0.9, freq: null },
      sites: { hard: ['foo.com'] },
    };
    db.saveSettings(old as unknown as typeof DEFAULT_SETTINGS);
    const s = (await openDb(file)).getSettings();
    expect(s.rhythm).toEqual({ ...DEFAULT_SETTINGS.rhythm, focusMin: 30, shortBreakMin: 5, longBreakMin: 20 });
    expect(s.rhythm.longBreakEvery).toBe(DEFAULT_SETTINGS.rhythm.longBreakEvery);
    expect(s.sound).toEqual({ ...DEFAULT_SETTINGS.sound, ambient: 'rain', ambientVolume: 0.9 });
    expect(s.sound.freqVolume).toBe(DEFAULT_SETTINGS.sound.freqVolume);
    expect(s.sites.hard).toEqual(['foo.com']);
    expect(s.sites.fine).toEqual(DEFAULT_SETTINGS.sites.fine);
    expect(s.apps).toEqual(DEFAULT_SETTINGS.apps);
  });

  test('persist retries rename on transient EBUSY then succeeds', async () => {
    let calls = 0;
    const flaky = (from: string, to: string): void => {
      if (++calls <= 2) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      renameSync(from, to);
    };
    const db = await openDb(file, { rename: flaky });
    expect(calls).toBe(3);
    calls = 100;
    db.saveSettings({ ...DEFAULT_SETTINGS, streakMinMinutes: 55 });
    expect((await openDb(file)).getSettings().streakMinMinutes).toBe(55);
  });

  test('persist rethrows non-transient errors and exhausted retries', async () => {
    const enoent = () => { throw Object.assign(new Error('x'), { code: 'ENOENT' }); };
    await expect(openDb(file, { rename: enoent })).rejects.toThrow('x');
    let calls = 0;
    const always = () => { calls++; throw Object.assign(new Error('busy'), { code: 'EBUSY' }); };
    await expect(openDb(file, { rename: always })).rejects.toThrow('busy');
    expect(calls).toBe(5);
  });
});

describe('hasSavedSettings', () => {
  test('false on a fresh db, true after saveSettings, and persists across reopen', async () => {
    const db = await openDb(file);
    expect(db.hasSavedSettings()).toBe(false);
    db.getSecret(); // other keys do not count
    expect(db.hasSavedSettings()).toBe(false);
    db.saveSettings(DEFAULT_SETTINGS);
    expect(db.hasSavedSettings()).toBe(true);
    expect((await openDb(file)).hasSavedSettings()).toBe(true);
  });
});

describe('paired flag (I5)', () => {
  test('false on a fresh db; markPaired persists across reopen', async () => {
    const db = await openDb(file);
    expect(db.isPaired()).toBe(false);
    db.markPaired();
    db.markPaired(); // idempotent
    expect(db.isPaired()).toBe(true);
    expect((await openDb(file)).isPaired()).toBe(true);
  });
});

describe('durability and recovery (I7)', () => {
  const noLog = { log: () => {} };

  test('persist fsyncs the temp file before the rename and keeps the previous file as .bak', async () => {
    const order: string[] = [];
    const db = await openDb(file, {
      ...noLog,
      fsync: (fd) => { order.push('fsync'); fsyncSync(fd); },
      rename: (from, to) => { order.push('rename'); renameSync(from, to); },
    });
    expect(order).toEqual(['fsync', 'rename']);
    expect(existsSync(file + '.bak')).toBe(false); // nothing to back up on a fresh file
    db.saveSettings({ ...DEFAULT_SETTINGS, streakMinMinutes: 11 });
    db.saveSettings({ ...DEFAULT_SETTINGS, streakMinMinutes: 22 });
    expect(order).toEqual(['fsync', 'rename', 'fsync', 'rename', 'fsync', 'rename']);
    // .bak holds the state before the last write.
    copyFileSync(file + '.bak', join(dir, 'bak.sqlite'));
    expect((await openDb(join(dir, 'bak.sqlite'), noLog)).getSettings().streakMinMinutes).toBe(11);
    expect((await openDb(file, noLog)).getSettings().streakMinMinutes).toBe(22);
  });

  test('a garbage file is moved aside as .corrupt-<ts> and the .bak is used', async () => {
    const db = await openDb(file, noLog);
    db.saveSettings({ ...DEFAULT_SETTINGS, streakMinMinutes: 33 });
    db.saveSettings({ ...DEFAULT_SETTINGS, streakMinMinutes: 44 });
    writeFileSync(file, 'this is not a database, just garbage bytes '.repeat(50));
    const logs: unknown[][] = [];
    const db2 = await openDb(file, { log: (...a) => logs.push(a), now: () => 1234 });
    expect(db2.getSettings().streakMinMinutes).toBe(33); // from .bak
    expect(readFileSync(file + '.corrupt-1234', 'utf8')).toContain('garbage');
    expect(logs.length).toBeGreaterThan(0);
    // The recovered db is written back as the main file.
    expect((await openDb(file, noLog)).getSettings().streakMinMinutes).toBe(33);
  });

  test('a zero-length file with no .bak starts fresh (and is kept aside)', async () => {
    writeFileSync(file, '');
    const db = await openDb(file, { ...noLog, now: () => 99 });
    expect(db.getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(db.hasSavedSettings()).toBe(false);
    expect(existsSync(file + '.corrupt-99')).toBe(true);
    db.saveSettings({ ...DEFAULT_SETTINGS, streakMinMinutes: 5 });
    expect((await openDb(file, noLog)).getSettings().streakMinMinutes).toBe(5);
  });

  test('a corrupt main file and a corrupt .bak still start fresh', async () => {
    writeFileSync(file, 'garbage'.repeat(100));
    writeFileSync(file + '.bak', 'also garbage'.repeat(100));
    const db = await openDb(file, { ...noLog, now: () => 7 });
    expect(db.getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(existsSync(file + '.corrupt-7')).toBe(true);
  });
});

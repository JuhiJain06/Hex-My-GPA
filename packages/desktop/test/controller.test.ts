import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SHORT_SUGGESTIONS, type EngineEvent } from '@study-buddy/core';
import { openDb, type Db } from '../src/main/db';
import { SessionController, type UiState } from '../src/main/controller';
import { FAST_RHYTHM } from '../src/main/config';

const S = 1000;
const M = 60_000;
// 10:00 local time (TZ pinned by vitest.config) so a few hours of focus stays inside one day.
const T0 = new Date(2026, 10, 23, 10, 0, 0).getTime();

let dir: string;
let db: Db;
let now: number;
const clock = () => now;
const info = { topic: 'Maths', mode: 'laptop' as const, goal: 'ch3', plannedMin: null };

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sb-ctrl-'));
  db = await openDb(join(dir, 'sb.sqlite'));
  now = T0;
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

/** Advance the fake clock to `until` in `step` increments, ticking each time. */
function runTo(c: SessionController, until: number, step = 10 * S): void {
  while (now < until) {
    now = Math.min(until, now + step);
    c.tick();
  }
}

describe('SessionController', () => {
  test('start persists a snapshot; tick emits breakStarted at 45 min with a suggestion in uiState', () => {
    const c = new SessionController(db, clock);
    const events: EngineEvent[] = [];
    const uis: UiState[] = [];
    c.on('engine', (e: EngineEvent) => events.push(e));
    c.on('ui', (u: UiState) => uis.push(u));

    c.start(info);
    expect(c.sessionId).not.toBeNull();
    const active = db.activeSession(now)!;
    expect(active.id).toBe(c.sessionId);
    expect(active.snapshot.phase).toBe('focus');
    expect(active.snapshot.session?.topic).toBe('Maths');
    expect(events.map((e) => e.type)).toEqual(['focusStarted']);
    expect(uis.length).toBeGreaterThan(0);
    expect(c.uiState().suggestion).toBeNull();

    runTo(c, T0 + 45 * M - 10 * S);
    expect(events.some((e) => e.type === 'breakStarted')).toBe(false);
    runTo(c, T0 + 45 * M);
    expect(events.find((e) => e.type === 'breakStarted')).toMatchObject({ type: 'breakStarted', long: false });

    const ui = c.uiState();
    expect(ui.phase).toBe('break');
    expect(SHORT_SUGGESTIONS).toContain(ui.suggestion);
    expect(ui.blockingActive).toBe(false);
    expect(db.activeSession(now)!.snapshot.phase).toBe('break');
  });

  test('setTopic trims, caps, persists and emits ui; blank is ignored', () => {
    const c = new SessionController(db, clock);
    c.start(info);
    const uis: UiState[] = [];
    c.on('ui', (u: UiState) => uis.push(u));
    c.setTopic('   ');
    expect(c.uiState().topic).toBe('Maths');
    expect(uis).toHaveLength(0);
    c.setTopic('  Physics  ');
    expect(c.uiState().topic).toBe('Physics');
    expect(uis.at(-1)?.topic).toBe('Physics');
    expect(db.activeSession(now)!.snapshot.session?.topic).toBe('Physics');
    c.setTopic('x'.repeat(300));
    expect(c.uiState().topic).toHaveLength(200);
  });

  test('next break suggestion differs from the previous one', () => {
    const c = new SessionController(db, clock, { rand: () => 0 });
    c.start(info);
    runTo(c, T0 + 45 * M);
    const first = c.uiState().suggestion;
    c.nextBlock();
    expect(c.uiState().suggestion).toBeNull();
    runTo(c, now + 45 * M);
    const second = c.uiState().suggestion;
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
  });

  test('heartbeat: snapshot saved on phase change and at least every 15 s, not every tick', () => {
    const c = new SessionController(db, clock);
    c.start(info);
    const spy = vi.spyOn(db, 'saveSnapshot');
    runTo(c, T0 + 10 * S, S);
    expect(spy).not.toHaveBeenCalled();
    runTo(c, T0 + 15 * S, S);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(db.activeSession(now)!.heartbeatAt).toBe(T0 + 15 * S);
  });

  test('a throwing saveSnapshot is logged and the timer keeps running', () => {
    const c = new SessionController(db, clock);
    c.start(info);
    vi.spyOn(db, 'saveSnapshot').mockImplementation(() => { throw new Error('EPERM'); });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const events: EngineEvent[] = [];
    c.on('engine', (e: EngineEvent) => events.push(e));
    expect(() => runTo(c, T0 + 45 * M)).not.toThrow();
    expect(err).toHaveBeenCalled();
    expect(events.some((e) => e.type === 'breakStarted')).toBe(true);
  });

  test('restore resumes a fresh active session', () => {
    const c = new SessionController(db, clock);
    c.start(info);
    runTo(c, T0 + 5 * M);
    const id = c.sessionId;

    now += 30 * S;
    const c2 = new SessionController(db, clock);
    expect(c2.restore()).toBe('resumed');
    expect(c2.sessionId).toBe(id);
    expect(c2.uiState().phase).toBe('focus');
    expect(c2.uiState().topic).toBe('Maths');
    expect(c2.uiState().pausedSince).toBeNull();
  });

  test('restore with no active session returns none', () => {
    const c = new SessionController(db, clock);
    expect(c.restore()).toBe('none');
    expect(c.sessionId).toBeNull();
    expect(c.uiState().phase).toBe('idle');
  });

  test('restore ends a stale session at its heartbeat without logging a bypass', () => {
    const c = new SessionController(db, clock);
    c.start(info);
    runTo(c, T0 + 2 * M);
    const T = db.activeSession(now)!.heartbeatAt;
    expect(T).toBe(T0 + 2 * M);
    const id = c.sessionId;

    now = T + 11 * M;
    const c2 = new SessionController(db, clock);
    expect(c2.restore()).toBe('staleEnded');
    expect(c2.sessionId).toBeNull();
    expect(c2.uiState().phase).toBe('idle');
    expect(db.activeSession(now)).toBeNull();

    const [rec] = db.sessions(0);
    expect(rec.id).toBe(id);
    expect(rec.endedAt).toBe(T);
    expect(rec.intervals).toEqual([[T0, T]]);
    expect(rec.events.filter((e) => e.kind === 'bypass')).toEqual([]);
  });

  test('restore with byWatchdog option is accepted', () => {
    const c = new SessionController(db, clock);
    c.start(info);
    now += 5 * S;
    expect(new SessionController(db, clock).restore({ byWatchdog: true })).toBe('resumed');
  });

  test('overrun engine event is logged as an overrun event', () => {
    const c = new SessionController(db, clock);
    const events: EngineEvent[] = [];
    c.on('engine', (e: EngineEvent) => events.push(e));
    c.start(info);
    runTo(c, T0 + 45 * M + 10 * M + 3 * M);
    expect(events.map((e) => e.type)).toContain('overrun');
    const id = c.end();
    const rec = db.sessions(0).find((s) => s.id === id)!;
    expect(rec.events.filter((e) => e.kind === 'overrun')).toHaveLength(1);
    expect(rec.events[0].at).toBe(T0 + 58 * M);
  });

  test('todayMs includes the open focus interval', () => {
    const c = new SessionController(db, clock);
    c.start(info);
    runTo(c, T0 + 20 * M);
    expect(c.uiState().todayMs).toBe(20 * M);
  });

  test('todayMs adds finished sessions today and is not double counted after end', () => {
    const c = new SessionController(db, clock);
    c.start(info);
    runTo(c, T0 + 30 * M);
    const id = c.end();
    expect(typeof id).toBe('number');
    expect(c.sessionId).toBeNull();
    expect(c.uiState().phase).toBe('idle');
    expect(c.uiState().todayMs).toBe(30 * M);

    c.start(info);
    runTo(c, now + 10 * M);
    expect(c.uiState().todayMs).toBe(40 * M);
  });

  test('pause stops the open interval; resume restarts it', () => {
    const c = new SessionController(db, clock);
    c.start(info);
    runTo(c, T0 + 10 * M);
    c.pause(T0 + 8 * M);
    expect(c.uiState().pausedSince).toBe(T0 + 8 * M);
    runTo(c, T0 + 12 * M);
    expect(c.uiState().todayMs).toBe(8 * M);
    c.resume();
    runTo(c, T0 + 13 * M);
    expect(c.uiState().todayMs).toBe(9 * M);
  });

  test('streakDays counts days at or above settings.streakMinMinutes', () => {
    db.saveSettings({ ...db.getSettings(), streakMinMinutes: 20 });
    const c = new SessionController(db, clock);
    c.start(info);
    runTo(c, T0 + 19 * M);
    expect(c.uiState().streakDays).toBe(0);
    runTo(c, T0 + 21 * M);
    expect(c.uiState().streakDays).toBe(1);
  });

  test('turnOffBlocking returns true only for the right sentence during focus', () => {
    const c = new SessionController(db, clock);
    c.start(info);
    expect(c.uiState().blockingActive).toBe(true);
    expect(c.turnOffBlocking('nope')).toBe(false);
    expect(c.turnOffBlocking('I am choosing to stop studying')).toBe(true);
    expect(c.uiState().blockingActive).toBe(false);
  });

  test('extensionConnected is reflected in uiState', () => {
    const c = new SessionController(db, clock);
    expect(c.uiState().extensionConnected).toBe(false);
    c.setExtensionConnected(true);
    expect(c.uiState().extensionConnected).toBe(true);
  });

  test('rhythm override (fast mode) is used instead of settings', () => {
    // 3-min fast focus so 1-min fast check-ins can appear before the break.
    expect(FAST_RHYTHM).toEqual({ focusMin: 3, shortBreakMin: 1, longBreakMin: 2, longBreakEvery: 3 });
    const c = new SessionController(db, clock, { rhythm: FAST_RHYTHM });
    const events: EngineEvent[] = [];
    c.on('engine', (e: EngineEvent) => events.push(e));
    c.start(info);
    runTo(c, T0 + 3 * M - S, S);
    expect(events.map((e) => e.type)).not.toContain('breakStarted');
    runTo(c, T0 + 3 * M, S);
    expect(events.map((e) => e.type)).toContain('breakStarted');
  });

  test('logEvent stamps the clock time; ignored without a session', () => {
    const c = new SessionController(db, clock);
    expect(() => c.logEvent({ kind: 'slip', target: 'x.com', detail: null })).not.toThrow();
    c.start(info);
    now += 5 * S;
    c.logEvent({ kind: 'slip', target: 'x.com', detail: null });
    const id = c.end();
    const rec = db.sessions(0).find((s) => s.id === id)!;
    expect(rec.events).toEqual([{ at: T0 + 5 * S, kind: 'slip', target: 'x.com', detail: null }]);
  });

  test('study videos: added per session, de-duplicated, reset on end and start', () => {
    const c = new SessionController(db, clock);
    c.addStudyVideo('ignored');
    expect(c.studyVideos()).toEqual([]);
    c.start(info);
    c.addStudyVideo('abc');
    c.addStudyVideo('abc');
    c.addStudyVideo('def');
    expect(c.studyVideos()).toEqual(['abc', 'def']);
    c.end();
    expect(c.studyVideos()).toEqual([]);
    c.start(info);
    c.addStudyVideo('x');
    c.start(info);
    expect(c.studyVideos()).toEqual([]);
  });
});

describe('SessionController: study buddy', () => {
  test('uiState carries the chosen animal (cat by default, cat for a broken stored value)', () => {
    const c = new SessionController(db, clock);
    expect(c.uiState().animal).toBe('cat');
    db.saveSettings({ ...db.getSettings(), animal: 'fox' });
    expect(c.uiState().animal).toBe('fox');
    db.saveSettings({ ...db.getSettings(), animal: 'dragon' as never });
    expect(c.uiState().animal).toBe('cat');
  });
  test('uiState carries the speech-bubble setting (on by default)', () => {
    const c = new SessionController(db, clock);
    expect(c.uiState().showBubble).toBe(true);
    db.saveSettings({ ...db.getSettings(), pet: { showBubble: false, pos: null } });
    expect(c.uiState().showBubble).toBe(false);
  });
  test('refreshUi re-emits the ui state (settings saved)', () => {
    const c = new SessionController(db, clock);
    const uis: UiState[] = [];
    c.on('ui', (u: UiState) => uis.push(u));
    db.saveSettings({ ...db.getSettings(), animal: 'bunny' });
    c.refreshUi();
    expect(uis.at(-1)?.animal).toBe('bunny');
  });
  test('logging a slip emits "slip" with its timestamp; other events do not', () => {
    const c = new SessionController(db, clock);
    const slips: number[] = [];
    c.on('slip', (at: number) => slips.push(at));
    c.logEvent({ kind: 'slip', target: 'x', detail: null }); // no session: nothing logged
    c.start(info);
    now += 5 * S;
    c.logEvent({ kind: 'slip', target: 'reddit.com', detail: 'hard-block-visit' });
    c.logEvent({ kind: 'bypass', target: 'x', detail: null });
    expect(slips).toEqual([T0 + 5 * S]);
  });
});

describe('SessionController: slips only while blocking (I3)', () => {
  const events = (c: SessionController) => {
    const id = c.end();
    return db.sessions(0).find((s) => s.id === id)!.events.map((e) => [e.at, e.kind, e.target]);
  };
  const RH = { focusMin: 25, shortBreakMin: 5, longBreakMin: 15, longBreakEvery: 3 };

  test('site/app slips are dropped during breaks, awaitingNext, after the turn-off sentence, and while paused', () => {
    const c = new SessionController(db, clock, { rhythm: RH });
    const emitted: number[] = [];
    c.on('slip', (at: number) => emitted.push(at));
    c.start(info);
    now += S;
    c.logEvent({ kind: 'slip', target: 'reddit.com', detail: 'hard-block-visit' }); // focus: kept
    c.pause(now);
    now += S;
    c.logEvent({ kind: 'slip', target: 'reddit.com', detail: 'hard-block-visit' }); // paused: dropped
    c.resume();
    runTo(c, T0 + 26 * M);
    expect(c.engine.state.phase).toBe('break');
    c.logEvent({ kind: 'slip', target: 'reddit.com', detail: 'hard-block-visit' }); // break: dropped
    runTo(c, T0 + 32 * M);
    expect(c.engine.state.phase).toBe('awaitingNext');
    c.logEvent({ kind: 'slip', target: 'steam.exe', detail: null }); // awaitingNext: dropped
    c.nextBlock();
    expect(c.turnOffBlocking('I am choosing to stop studying')).toBe(true);
    c.logEvent({ kind: 'slip', target: 'youtube.com', detail: 'youtube-timeout' }); // bypassed: dropped
    c.logEvent({ kind: 'overrun', target: null, detail: null }); // other kinds are not gated
    expect(emitted).toEqual([T0 + S]);
    const ev = events(c).filter(([, k]) => k === 'slip');
    expect(ev).toEqual([[T0 + S, 'slip', 'reddit.com']]);
  });

  test('a check-in "drifted" slip still counts in unpaused focus after the turn-off sentence (check-ins continue)', () => {
    const c = new SessionController(db, clock, { rhythm: RH });
    c.start(info);
    c.turnOffBlocking('I am choosing to stop studying');
    now += S;
    c.logEvent({ kind: 'slip', target: 'check-in', detail: null });
    c.pause(now);
    c.logEvent({ kind: 'slip', target: 'check-in', detail: null }); // paused: dropped
    expect(events(c).filter(([, k]) => k === 'slip')).toEqual([[T0 + S, 'slip', 'check-in']]);
  });
});

describe('SessionController: browser link (I5)', () => {
  test('bridgeListening defaults to true and is reflected in uiState when it fails', () => {
    const c = new SessionController(db, clock);
    const uis: UiState[] = [];
    c.on('ui', (u: UiState) => uis.push(u));
    expect(c.uiState().bridgeListening).toBe(true);
    c.setBridgeListening(false);
    expect(c.uiState().bridgeListening).toBe(false);
    expect(uis.at(-1)?.bridgeListening).toBe(false);
  });
});

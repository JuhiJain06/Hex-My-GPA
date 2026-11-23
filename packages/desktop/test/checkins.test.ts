import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Mode } from '@study-buddy/core';
import { openDb, type Db } from '../src/main/db';
import { SessionController } from '../src/main/controller';
import { CheckinRunner, parseCheckinAnswer } from '../src/main/checkins';

const S = 1000;
const M = 60_000;
const T0 = new Date(2026, 10, 23, 10, 0, 0).getTime();

let dir: string;
let db: Db;
let now: number;
let idle: number;
let shown: { mode: Mode; topic: string }[];
let hides: number;
let ctrl: SessionController;
let runner: CheckinRunner;

const ui = { show: (c: { mode: Mode; topic: string }) => { shown.push(c); }, hide: () => { hides++; } };

function setup(mode: Mode = 'laptop', rhythm = { focusMin: 90, shortBreakMin: 10, longBreakMin: 25, longBreakEvery: 3 }) {
  ctrl = new SessionController(db, () => now, { rhythm });
  runner = new CheckinRunner(ctrl, ui, () => idle, () => now, () => 0);
  ctrl.start({ topic: 'Maths', mode, goal: null, plannedMin: null });
}
function runTo(until: number, step = 10 * S): void {
  while (now < until) {
    now = Math.min(until, now + step);
    ctrl.tick();
    runner.tick();
  }
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sb-chk-'));
  db = await openDb(join(dir, 'sb.sqlite'));
  now = T0;
  idle = 0;
  shown = [];
  hides = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe('CheckinRunner', () => {
  test('schedules only during unpaused focus; reschedules from the answer time', () => {
    setup();
    runTo(T0 + 19 * M);
    expect(shown).toHaveLength(0);
    runTo(T0 + 20 * M);
    expect(shown).toEqual([{ mode: 'laptop', topic: 'Maths' }]);
    runTo(T0 + 21 * M);
    runner.answer('yes');
    expect(hides).toBe(1);
    runTo(T0 + 40 * M);
    expect(shown).toHaveLength(1);
    runTo(T0 + 41 * M);
    expect(shown).toHaveLength(2);
  });

  test('no check-in while paused; a visible one is hidden when the break starts, none during break', () => {
    setup('laptop', { focusMin: 40, shortBreakMin: 10, longBreakMin: 25, longBreakEvery: 3 });
    runTo(T0 + 5 * M);
    idle = 999;
    ctrl.pause(now);
    runTo(T0 + 30 * M);
    expect(shown).toHaveLength(0);
    idle = 0;
    runTo(T0 + 31 * M); // resumes via idle < 2
    expect(ctrl.engine.state.pausedSince).toBeNull();
    runTo(T0 + 70 * M); // shown at 51m, focus ends at 66m
    expect(ctrl.engine.state.phase).not.toBe('focus');
    expect(shown).toHaveLength(1);
    expect(hides).toBeGreaterThan(0);
    runTo(now + 60 * M);
    expect(shown).toHaveLength(1);
  });

  test('unanswered + no input → pause since shownAt; any input then resumes', () => {
    setup();
    const pause = vi.spyOn(ctrl, 'pause');
    const resume = vi.spyOn(ctrl, 'resume');
    const log = vi.spyOn(ctrl, 'logEvent');
    runTo(T0 + 20 * M, 5 * S);
    expect(shown).toHaveLength(1);
    // the user walked away when it was shown: idle grows with the clock
    while (now < T0 + 22 * M) {
      now += 5 * S;
      idle = (now - (T0 + 20 * M)) / 1000 + 1;
      ctrl.tick();
      runner.tick();
    }
    expect(pause).toHaveBeenCalledWith(T0 + 20 * M);
    expect(log.mock.calls.some(([e]) => e.kind === 'checkin')).toBe(false);
    expect(ctrl.engine.state.pausedSince).toBe(T0 + 20 * M);
    expect(resume).not.toHaveBeenCalled();
    now += 10 * S;
    idle = 0;
    ctrl.tick();
    runner.tick();
    expect(resume).toHaveBeenCalledTimes(1);
    expect(ctrl.engine.state.pausedSince).toBeNull();
  });

  test('answering while paused resumes', () => {
    setup();
    runTo(T0 + 20 * M);
    idle = 600;
    runTo(T0 + 22 * M);
    expect(ctrl.engine.state.pausedSince).not.toBeNull();
    runner.answer('yes');
    expect(ctrl.engine.state.pausedSince).toBeNull();
  });

  test('unanswered but user active → logs checkin detail "ignored", hides, no pause', () => {
    setup();
    const pause = vi.spyOn(ctrl, 'pause');
    const log = vi.spyOn(ctrl, 'logEvent');
    runTo(T0 + 20 * M);
    idle = 3;
    runTo(T0 + 22 * M);
    expect(pause).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith({ kind: 'checkin', target: null, detail: 'ignored' });
    expect(hides).toBe(1);
    expect(ctrl.engine.state.pausedSince).toBeNull();
  });

  test('drifted logs checkin detail "drifted" and a slip with target "check-in"', () => {
    setup();
    const log = vi.spyOn(ctrl, 'logEvent');
    runTo(T0 + 20 * M);
    runner.answer('drifted');
    expect(log.mock.calls.map(([e]) => e)).toEqual([
      { kind: 'checkin', target: null, detail: 'drifted' },
      { kind: 'slip', target: 'check-in', detail: null },
    ]);
  });

  test('switched updates the topic and logs "switched"', () => {
    setup();
    const log = vi.spyOn(ctrl, 'logEvent');
    runTo(T0 + 20 * M);
    runner.answer('switched', 'Physics');
    expect(ctrl.uiState().topic).toBe('Physics');
    expect(log).toHaveBeenCalledWith({ kind: 'checkin', target: null, detail: 'switched' });
  });

  test('book mode logs pages as "pages:<n>" and uses the book cadence', () => {
    setup('book');
    const log = vi.spyOn(ctrl, 'logEvent');
    runTo(T0 + 9 * M);
    expect(shown).toHaveLength(0);
    runTo(T0 + 10 * M); // rand 0 → base 15 - jitter 5
    expect(shown).toEqual([{ mode: 'book', topic: 'Maths' }]);
    runner.answer({ pages: 7 });
    expect(log).toHaveBeenCalledWith({ kind: 'checkin', target: null, detail: 'pages:7' });
  });

  test('answer with nothing showing is ignored; config override drives fast mode', () => {
    setup();
    const log = vi.spyOn(ctrl, 'logEvent');
    runner.answer('yes');
    expect(log).not.toHaveBeenCalled();
    const fast = { laptop: { baseMin: 1, timeoutMin: 20 / 60 }, book: { baseMin: 1, timeoutMin: 20 / 60 }, jitterMin: 0 };
    const r2 = new CheckinRunner(ctrl, ui, () => idle, () => now, () => 0, fast);
    now += 30 * S;
    ctrl.tick();
    r2.tick(); // first tick schedules from now
    now += 60 * S;
    ctrl.tick();
    r2.tick();
    expect(shown).toHaveLength(1);
  });
});

describe('parseCheckinAnswer', () => {
  test('accepts only the allowed shapes', () => {
    expect(parseCheckinAnswer({ answer: 'yes' })).toEqual({ a: 'yes' });
    expect(parseCheckinAnswer({ answer: 'drifted' })).toEqual({ a: 'drifted' });
    expect(parseCheckinAnswer({ answer: 'switched', topic: '  Bio ' })).toEqual({ a: 'switched', topic: 'Bio' });
    expect(parseCheckinAnswer({ answer: 'pages', pages: 0 })).toEqual({ a: { pages: 0 } });
    expect(parseCheckinAnswer({ answer: 'pages', pages: 2000 })).toEqual({ a: { pages: 2000 } });
    for (const bad of [null, 'yes', 5, {}, { answer: 'nope' }, { answer: 'switched' }, { answer: 'switched', topic: '  ' },
      { answer: 'pages' }, { answer: 'pages', pages: -1 }, { answer: 'pages', pages: 2001 },
      { answer: 'pages', pages: 1.5 }, { answer: 'pages', pages: '3' }, { answer: 'pages', pages: NaN }]) {
      expect(parseCheckinAnswer(bad)).toBeNull();
    }
  });
});

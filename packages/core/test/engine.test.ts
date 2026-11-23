import { describe, expect, test } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/settings';
import { SessionEngine, type EngineEvent } from '../src/engine';

const M = 60_000;
const R = DEFAULT_SETTINGS.rhythm;

function run(e: SessionEngine, from: number, to: number): EngineEvent[] {
  const out: EngineEvent[] = [];
  for (let t = from + 1000; t <= to; t += 1000) out.push(...e.tick(t));
  return out;
}
function start(plannedMin: number | null = null): SessionEngine {
  const e = new SessionEngine(R);
  e.start({ topic: 'P', mode: 'laptop', goal: null, plannedMin }, 0);
  return e;
}

describe('SessionEngine', () => {
  test('focus 45 → short break 10 → awaitingNext', () => {
    const e = start();
    expect(run(e, 0, 45 * M)).toContainEqual({ type: 'breakStarted', long: false, endsAt: 55 * M });
    const ev = run(e, 45 * M, 55 * M);
    expect(ev).toContainEqual({ type: 'breakOneMinuteLeft' });
    expect(ev).toContainEqual({ type: 'breakEnded' });
    expect(e.state.phase).toBe('awaitingNext');
    expect(e.focusMs(55 * M)).toBe(45 * M);
  });

  test('every third break is 25 min', () => {
    const e = start();
    let t = 0;
    const breaks: EngineEvent[] = [];
    for (let i = 0; i < 3; i++) {
      const ev = run(e, t, t + 45 * M);
      t += 45 * M;
      breaks.push(ev.find((x) => x.type === 'breakStarted')!);
      if (i < 2) expect(e.startNextBlock(t)).toContainEqual({ type: 'focusStarted', endsAt: t + 45 * M });
    }
    expect(breaks[0]).toMatchObject({ long: false });
    expect(breaks[1]).toMatchObject({ long: false });
    expect(breaks[2]).toEqual({ type: 'breakStarted', long: true, endsAt: t + 25 * M });
  });

  test('startNextBlock from break or awaitingNext works; elsewhere no-op', () => {
    const e = new SessionEngine(R);
    expect(e.startNextBlock(0)).toEqual([]);
    e.start({ topic: 'P', mode: 'book', goal: null, plannedMin: null }, 0);
    expect(e.startNextBlock(1000)).toEqual([]);
    run(e, 0, 45 * M);
    expect(e.state.phase).toBe('break');
    expect(e.startNextBlock(46 * M)).toEqual([{ type: 'focusStarted', endsAt: 91 * M }]);
    expect(e.state.phase).toBe('focus');
    run(e, 46 * M, 91 * M + 10 * M);
    expect(e.state.phase).toBe('awaitingNext');
    expect(e.startNextBlock(102 * M)).toHaveLength(1);
    expect(e.state.phase).toBe('focus');
  });

  test('overrun fires once, 3 min after break ends', () => {
    const e = start();
    run(e, 0, 55 * M);
    expect(e.state.phase).toBe('awaitingNext');
    expect(run(e, 55 * M, 55 * M + 3 * M - 1000)).toEqual([]);
    const ev = run(e, 55 * M + 3 * M - 1000, 55 * M + 10 * M);
    expect(ev.filter((x) => x.type === 'overrun')).toHaveLength(1);
  });

  test('blocking: on in focus and while paused, off in break and after bypass', () => {
    const e = start();
    expect(e.blockingActive).toBe(true);
    run(e, 0, 5 * M);
    e.pause(5 * M, 5 * M);
    expect(e.blockingActive).toBe(true);
    e.resume(5 * M);
    expect(e.turnOffBlocking('nope', 5 * M)).toEqual([]);
    expect(e.blockingActive).toBe(true);
    expect(e.turnOffBlocking('  i am CHOOSING to  stop studying ', 5 * M)).toEqual([{ type: 'bypassOn' }]);
    expect(e.blockingActive).toBe(false);
    expect(e.state.bypassActive).toBe(true);
    run(e, 5 * M, 46 * M);
    expect(e.state.phase).toBe('break');
    expect(e.state.bypassActive).toBe(false);
    expect(e.blockingActive).toBe(false);
    e.startNextBlock(46 * M);
    expect(e.blockingActive).toBe(true);
  });

  test('retroactive pause uncounts time and freezes countdown', () => {
    const e = start();
    run(e, 0, 10 * M);
    expect(e.pause(8 * M, 10 * M)).toEqual([{ type: 'paused', since: 8 * M }]);
    e.resume(15 * M);
    expect(e.focusMs(15 * M)).toBe(8 * M);
    expect(e.state.phaseEndsAt).toBe(45 * M + 7 * M);
  });

  test('pause clamps since to the open interval start and misuse is a no-op', () => {
    const e = start();
    run(e, 0, 2 * M);
    expect(e.resume(2 * M)).toEqual([]);
    expect(e.pause(-5 * M, 2 * M)).toEqual([{ type: 'paused', since: 0 }]);
    expect(e.pause(1 * M, 2 * M)).toEqual([]);
    expect(e.focusMs(2 * M)).toBe(0);
  });

  test('treats a tick gap over 60 s as a pause', () => {
    const e = start();
    e.tick(1000);
    expect(e.tick(1000 + 30 * M)).toContainEqual({ type: 'paused', since: 1000 });
    expect(e.state.phase).toBe('focus');
    expect(e.focusMs(1000 + 30 * M)).toBe(1000);
    expect(e.state.lastTickAt).toBe(1000 + 30 * M);
  });

  test('extend adds 10 min; endBlockEarly starts break now', () => {
    const e = start();
    run(e, 0, 20 * M);
    expect(e.extendBlock(20 * M)).toEqual([]);
    expect(e.state.phaseEndsAt).toBe(55 * M);
    expect(e.endBlockEarly(20 * M)).toContainEqual({ type: 'breakStarted', long: false, endsAt: 30 * M });
    expect(e.state.phase).toBe('break');
    expect(e.state.blocksCompleted).toBe(1);
    expect(e.focusMs(20 * M)).toBe(20 * M);
    expect(e.extendBlock(21 * M)).toEqual([]);
    expect(e.state.phaseEndsAt).toBe(30 * M);
    expect(e.endBlockEarly(21 * M)).toEqual([]);
  });

  test('plannedLengthReached fires once when counted focus hits plannedMin', () => {
    const e = start(45);
    const ev = run(e, 0, 45 * M);
    expect(ev.filter((x) => x.type === 'plannedLengthReached')).toHaveLength(1);
    const later = run(e, 45 * M, 100 * M);
    expect(later.filter((x) => x.type === 'plannedLengthReached')).toHaveLength(0);
  });

  test('end closes the session', () => {
    const e = start();
    run(e, 0, 10 * M);
    expect(e.end(10 * M)).toEqual([{ type: 'sessionEnded' }]);
    expect(e.state.phase).toBe('ended');
    expect(e.focusMs(20 * M)).toBe(10 * M);
    expect(e.end(11 * M)).toEqual([]);
    expect(e.tick(12 * M)).toEqual([]);
  });

  test('snapshot round-trips', () => {
    const e = start();
    run(e, 0, 12 * M);
    const t = 12 * M;
    const e2 = new SessionEngine(R, JSON.parse(JSON.stringify(e.state)));
    expect(e2.focusMs(t)).toBe(e.focusMs(t));
    expect(e2.state).toEqual(e.state);
  });
});

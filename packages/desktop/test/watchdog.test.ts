import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { openDb, type Db } from '../src/main/db';
import { SessionController } from '../src/main/controller';
import {
  RESTORED_FLAG,
  MAX_RELAUNCHES,
  RELAUNCH_WINDOW_MS,
  bindOsSessionEnd,
  isAlive,
  parseRestartHistory,
  relaunchDecision,
  restartHistoryArgs,
  parseWatchdogArgs,
  relaunchArgs,
  relaunchEnv,
  startWatchdog,
  stopWatchdog,
  watchdogArgs,
  watchdogStep,
  writeFlag,
  type WatchdogSpawner,
} from '../src/main/watchdog';

const S = 1000;
const M = 60_000;
const T0 = new Date(2026, 10, 23, 10, 0, 0).getTime();
const info = { topic: 'Maths', mode: 'laptop' as const, goal: null, plannedMin: null };

let dir: string;
let db: Db;
let now: number;
const clock = () => now;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sb-wd-'));
  db = await openDb(join(dir, 'sb.sqlite'));
  now = T0;
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

const bypasses = () => db.sessions(0).flatMap((s) => s.events).filter((e) => e.kind === 'bypass');
/** Events of the still-active session (sessions() lists finished ones only after end). */
function activeBypasses(c: SessionController) {
  const id = c.end();
  return db.sessions(0).find((s) => s.id === id)!.events.filter((e) => e.kind === 'bypass');
}

test('watchdogStep', () => {
  expect(watchdogStep({ appAlive: true, flagExists: true })).toBe('continue');
  expect(watchdogStep({ appAlive: false, flagExists: true })).toBe('relaunch');
  expect(watchdogStep({ appAlive: true, flagExists: false })).toBe('exit');
  expect(watchdogStep({ appAlive: false, flagExists: false })).toBe('exit');
});

describe('restore and bypass logging', () => {
  test('restore with --restored-by-watchdog logs one app-closed bypass', () => {
    const c = new SessionController(db, clock);
    c.start(info);
    now += 20 * S;
    c.tick();
    now += 5 * S;
    const c2 = new SessionController(db, clock);
    expect(c2.restore({ byWatchdog: true })).toBe('resumed');
    const got = activeBypasses(c2);
    expect(got).toEqual([{ at: T0 + 25 * S, kind: 'bypass', target: 'app-closed', detail: null }]);
  });

  test('restore with a leftover flag (killed by hand, relaunched by hand) logs one app-closed bypass', () => {
    const c = new SessionController(db, clock);
    c.start(info);
    now += 5 * S;
    const c2 = new SessionController(db, clock);
    expect(c2.restore({ flagLeftover: true })).toBe('resumed');
    expect(activeBypasses(c2)).toEqual([{ at: T0 + 5 * S, kind: 'bypass', target: 'app-closed', detail: null }]);
  });

  test('watchdog relaunch and a leftover flag together still log exactly one app-closed', () => {
    const c = new SessionController(db, clock);
    c.start(info);
    now += 5 * S;
    const c2 = new SessionController(db, clock);
    expect(c2.restore({ byWatchdog: true, flagLeftover: true })).toBe('resumed');
    expect(activeBypasses(c2).filter((e) => e.target === 'app-closed')).toHaveLength(1);
  });

  test('stale restore with a leftover flag logs nothing', () => {
    const c = new SessionController(db, clock);
    c.start(info);
    now += 11 * M;
    const c2 = new SessionController(db, clock);
    expect(c2.restore({ byWatchdog: true, flagLeftover: true })).toBe('staleEnded');
    expect(bypasses()).toEqual([]);
  });

  test('restore without byWatchdog logs no bypass', () => {
    const c = new SessionController(db, clock);
    c.start(info);
    now += 5 * S;
    const c2 = new SessionController(db, clock);
    expect(c2.restore()).toBe('resumed');
    expect(activeBypasses(c2)).toEqual([]);
  });

  test('restore by watchdog of a stale session logs nothing (the PC was off)', () => {
    const c = new SessionController(db, clock);
    c.start(info);
    now += 2 * M;
    c.tick();
    now += 11 * M;
    const c2 = new SessionController(db, clock);
    expect(c2.restore({ byWatchdog: true })).toBe('staleEnded');
    expect(bypasses()).toEqual([]);
  });

  test('turnOffBlocking logs exactly one blocking-turned-off bypass, only on success', () => {
    const c = new SessionController(db, clock);
    c.start(info);
    now += 10 * S;
    expect(c.turnOffBlocking('I am choosing to stop')).toBe(false);
    expect(c.turnOffBlocking('  i AM choosing   to stop studying ')).toBe(true);
    expect(c.turnOffBlocking('I am choosing to stop studying')).toBe(false); // already off
    expect(activeBypasses(c)).toEqual([{ at: T0 + 10 * S, kind: 'bypass', target: 'blocking-turned-off', detail: null }]);
  });
});

describe('spawn args', () => {
  test('relaunchArgs reproduces the launch and appends --restored-by-watchdog once', () => {
    expect(relaunchArgs(['C:/e/electron.exe', 'dist/main.js'])).toEqual(['dist/main.js', RESTORED_FLAG]);
    expect(relaunchArgs(['C:/e/electron.exe', 'dist/main.js', RESTORED_FLAG, '--x'])).toEqual(['dist/main.js', '--x', RESTORED_FLAG]);
    expect(relaunchArgs(['C:/app/Study Buddy.exe'])).toEqual([RESTORED_FLAG]);
    // Old restart history is dropped (the watchdog appends the current one on relaunch).
    expect(relaunchArgs(['e', 'dist/main.js', RESTORED_FLAG, '--watchdog-restarts=2', '--watchdog-first=5'])).toEqual(['dist/main.js', RESTORED_FLAG]);
  });

  test('watchdogArgs round-trips through parseWatchdogArgs, including spaces', () => {
    const opts = { appPid: 4242, exePath: 'C:/Program Files/e/electron.exe', args: ['dist/main.js', '--tag=a b'], flagFile: 'C:/data dir/session-active.flag', cwd: 'E:/Projects/Study buddy', restarts: 2, firstAt: T0 };
    const argv = watchdogArgs('E:/x/dist/watchdog.js', opts);
    expect(argv[0]).toBe('E:/x/dist/watchdog.js');
    expect(parseWatchdogArgs(argv.slice(1))).toEqual(opts);
    // No history given → none.
    const bare = parseWatchdogArgs(watchdogArgs('w.js', { appPid: 1, exePath: 'e', args: [], flagFile: 'f', cwd: 'c' }).slice(1));
    expect(bare).toMatchObject({ restarts: 0, firstAt: null });
  });

  test('parseWatchdogArgs rejects missing or bad values', () => {
    expect(parseWatchdogArgs([])).toBeNull();
    expect(parseWatchdogArgs(['--app-pid', 'abc', '--exe', 'e', '--flag', 'f', '--cwd', 'c', '--'])).toBeNull();
    expect(parseWatchdogArgs(['--app-pid', '1', '--exe', 'e', '--cwd', 'c', '--'])).toBeNull();
  });

  test('relaunchEnv drops ELECTRON_RUN_AS_NODE and keeps BUDDY_* and the rest', () => {
    const env = relaunchEnv({ ELECTRON_RUN_AS_NODE: '1', BUDDY_FAST: '1', BUDDY_DATA_DIR: 'C:/t', PATH: 'p' });
    expect(env).toEqual({ BUDDY_FAST: '1', BUDDY_DATA_DIR: 'C:/t', PATH: 'p' });
  });
});

describe('relaunch cap', () => {
  test(`allows ${MAX_RELAUNCHES} relaunches within the window, then gives up`, () => {
    expect(MAX_RELAUNCHES).toBe(3);
    expect(RELAUNCH_WINDOW_MS).toBe(2 * M);
    let h = { restarts: 0, firstAt: null as number | null };
    const seen: number[] = [];
    for (let i = 0; i < 3; i++) {
      const d = relaunchDecision(h, T0 + i * 4 * S);
      expect(d.ok).toBe(true);
      if (d.ok) { h = d.next; seen.push(h.restarts); }
    }
    expect(seen).toEqual([1, 2, 3]);
    expect(h.firstAt).toBe(T0);
    expect(relaunchDecision(h, T0 + 12 * S)).toEqual({ ok: false });
    expect(relaunchDecision(h, T0 + 2 * M - 1)).toEqual({ ok: false });
  });

  test('history older than the window starts a fresh count', () => {
    const d = relaunchDecision({ restarts: 3, firstAt: T0 }, T0 + 2 * M + 1);
    expect(d).toEqual({ ok: true, next: { restarts: 1, firstAt: T0 + 2 * M + 1 } });
  });

  test('restart history round-trips through the app argv; bad values mean none', () => {
    const argv = ['e', 'dist/main.js', RESTORED_FLAG, ...restartHistoryArgs({ restarts: 2, firstAt: T0 })];
    expect(parseRestartHistory(argv)).toEqual({ restarts: 2, firstAt: T0 });
    expect(parseRestartHistory(['e', 'dist/main.js'])).toEqual({ restarts: 0, firstAt: null });
    expect(parseRestartHistory(['e', '--watchdog-restarts=x', '--watchdog-first=-1'])).toEqual({ restarts: 0, firstAt: null });
  });
});

describe('OS shutdown / logoff', () => {
  test('query-session-end, session-end and powerMonitor shutdown each delete the flag (once each is fine)', () => {
    for (const [src, ev] of [['win', 'query-session-end'], ['win', 'session-end'], ['pm', 'shutdown']] as const) {
      const win = new EventEmitter();
      const pm = new EventEmitter();
      const flag = join(dir, `flag-${ev}`);
      writeFlag(flag);
      const onEnd = vi.fn(() => stopWatchdog(flag));
      bindOsSessionEnd({ window: win, powerMonitor: pm }, onEnd);
      (src === 'win' ? win : pm).emit(ev);
      expect(onEnd).toHaveBeenCalledTimes(1);
      expect(existsSync(flag)).toBe(false);
    }
  });

  test('other window events do not touch the flag', () => {
    const win = new EventEmitter();
    const onEnd = vi.fn();
    bindOsSessionEnd({ window: win, powerMonitor: new EventEmitter() }, onEnd);
    win.emit('close');
    win.emit('blur');
    expect(onEnd).not.toHaveBeenCalled();
  });
});

describe('flag and watchdog process', () => {
  test('writeFlag creates the flag and stopWatchdog deletes it (idempotent)', () => {
    const flag = join(dir, 'session-active.flag');
    writeFlag(flag);
    expect(existsSync(flag)).toBe(true);
    stopWatchdog(flag);
    expect(existsSync(flag)).toBe(false);
    expect(() => stopWatchdog(flag)).not.toThrow();
  });

  test('startWatchdog spawns once with the watchdog env and skips while that watchdog is alive', () => {
    const calls: { cmd: string; args: string[]; env: NodeJS.ProcessEnv; detached: boolean; stdio: string; windowsHide: boolean }[] = [];
    let alive = true;
    const spawner: WatchdogSpawner = {
      spawn: (cmd, args, o) => { calls.push({ cmd, args, env: o.env, detached: o.detached, stdio: o.stdio, windowsHide: o.windowsHide }); return 777; },
      isAlive: (pid) => pid === 777 && alive,
    };
    const opts = { appPid: 1, exePath: 'e.exe', args: ['m.js', RESTORED_FLAG], flagFile: 'f', cwd: 'c', restarts: 0, firstAt: null };
    const base = { execPath: 'node.exe', script: 'w.js', env: { BUDDY_FAST: '1' } };
    startWatchdog(opts, { ...base, spawner });
    startWatchdog(opts, { ...base, spawner });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ cmd: 'node.exe', detached: true, stdio: 'ignore', windowsHide: true });
    expect(calls[0]!.args).toEqual(watchdogArgs('w.js', opts));
    expect(calls[0]!.env).toEqual({ BUDDY_FAST: '1', ELECTRON_RUN_AS_NODE: '1' });
    alive = false;
    startWatchdog(opts, { ...base, spawner });
    expect(calls).toHaveLength(2);
  });

  test('isAlive: our own pid is alive, an unused pid is not', () => {
    expect(isAlive(process.pid)).toBe(true);
    expect(isAlive(0x7ffffff0)).toBe(false);
  });
});

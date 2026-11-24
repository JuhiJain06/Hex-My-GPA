import { spawn } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Relaunches the app if it dies mid-session. Main writes `<userData>/session-active.flag` while a
 * session runs and spawns `dist/watchdog.js` (src/watchdog/run.ts) as a detached node process.
 * Every 3 s it checks the app pid and the flag: app gone + flag present → relaunch the app with
 * `--restored-by-watchdog`; flag gone → exit. No electron imports here (run.ts bundles this file).
 */

/** Appended to the relaunched app's argv; `restore({ byWatchdog: true })` then logs an app-closed bypass. */
export const RESTORED_FLAG = '--restored-by-watchdog';
export const FLAG_FILE_NAME = 'session-active.flag';
export const POLL_MS = 3000;
/** Relaunch cap: at most this many relaunches within {@link RELAUNCH_WINDOW_MS}, then the watchdog gives up. */
export const MAX_RELAUNCHES = 3;
export const RELAUNCH_WINDOW_MS = 2 * 60_000;
const RESTARTS_ARG = '--watchdog-restarts=';
const FIRST_ARG = '--watchdog-first=';

/** Relaunches so far in the current window, and when the window's first relaunch happened. */
export interface RestartHistory {
  restarts: number;
  firstAt: number | null;
}
const NO_HISTORY: RestartHistory = { restarts: 0, firstAt: null };

export interface WatchdogOptions {
  appPid: number;
  exePath: string;
  /** Relaunch args (see {@link relaunchArgs}). */
  args: string[];
  flagFile: string;
  /** Working directory to relaunch in (dev args like `dist/main.js` are relative). Default: our cwd. */
  cwd?: string;
  /** Restart history this app was launched with ({@link parseRestartHistory}); default none. */
  restarts?: number;
  firstAt?: number | null;
}

export type WatchdogAction = 'continue' | 'relaunch' | 'exit';

export function watchdogStep(s: { appAlive: boolean; flagExists: boolean }): WatchdogAction {
  if (!s.flagExists) return 'exit';
  return s.appAlive ? 'continue' : 'relaunch';
}

/**
 * May the watchdog relaunch now? A history older than the window starts a fresh count; within the
 * window, the {@link MAX_RELAUNCHES}+1-th relaunch is refused (the app keeps dying on startup).
 */
export function relaunchDecision(h: RestartHistory, now: number): { ok: true; next: RestartHistory } | { ok: false } {
  if (h.firstAt === null || now - h.firstAt >= RELAUNCH_WINDOW_MS) return { ok: true, next: { restarts: 1, firstAt: now } };
  if (h.restarts >= MAX_RELAUNCHES) return { ok: false };
  return { ok: true, next: { restarts: h.restarts + 1, firstAt: h.firstAt } };
}

/** App argv carrying the restart history to the relaunched app (which hands it to its own watchdog). */
export function restartHistoryArgs(h: RestartHistory): string[] {
  return [`${RESTARTS_ARG}${h.restarts}`, `${FIRST_ARG}${h.firstAt ?? 0}`];
}

/** Reads {@link restartHistoryArgs} from the app's argv; missing or invalid → no history. */
export function parseRestartHistory(argv: readonly string[]): RestartHistory {
  const val = (prefix: string) => Number(argv.find((a) => a.startsWith(prefix))?.slice(prefix.length));
  const restarts = val(RESTARTS_ARG);
  const firstAt = val(FIRST_ARG);
  if (!Number.isInteger(restarts) || restarts <= 0 || !Number.isFinite(firstAt) || firstAt <= 0) return { ...NO_HISTORY };
  return { restarts, firstAt };
}

type Emitter = { on(event: string, fn: () => void): unknown };

/**
 * OS shutdown / logoff: Windows closes windowed apps seconds before windowless ones like the
 * watchdog, which would then "relaunch" us and log a false app-closed bypass. So on the window's
 * `query-session-end` / `session-end` (Windows) and powerMonitor `shutdown` (macOS/Linux), call
 * `onEnd` (main deletes the flag, so the watchdog just exits).
 */
export function bindOsSessionEnd(t: { window: Emitter; powerMonitor: Emitter }, onEnd: () => void): void {
  t.window.on('query-session-end', onEnd);
  t.window.on('session-end', onEnd);
  t.powerMonitor.on('shutdown', onEnd);
}

/** True if a process with this pid exists (EPERM still means it exists). */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Args that reproduce how this app was started (`process.argv`), plus {@link RESTORED_FLAG} once. */
export function relaunchArgs(argv: readonly string[]): string[] {
  const own = (a: string) => a === RESTORED_FLAG || a.startsWith(RESTARTS_ARG) || a.startsWith(FIRST_ARG);
  return [...argv.slice(1).filter((a) => !own(a)), RESTORED_FLAG];
}

/** The relaunched app's env: ours minus ELECTRON_RUN_AS_NODE (BUDDY_* and the rest pass through). */
export function relaunchEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  delete out.ELECTRON_RUN_AS_NODE;
  return out;
}

/** argv for the watchdog: `<script> --app-pid N --exe E --flag F --cwd C --restarts R --first T -- ...relaunchArgs`. */
export function watchdogArgs(script: string, o: WatchdogOptions): string[] {
  return [script, '--app-pid', String(o.appPid), '--exe', o.exePath, '--flag', o.flagFile, '--cwd', o.cwd ?? process.cwd(),
    '--restarts', String(o.restarts ?? 0), '--first', String(o.firstAt ?? 0), '--', ...o.args];
}

/** Inverse of {@link watchdogArgs} (without the script). Null if anything is missing or invalid. */
export function parseWatchdogArgs(argv: readonly string[]): Required<WatchdogOptions> | null {
  const sep = argv.indexOf('--');
  if (sep < 0) return null;
  const named = new Map<string, string>();
  for (let i = 0; i + 1 < sep; i += 2) named.set(argv[i]!, argv[i + 1]!);
  const pid = Number(named.get('--app-pid'));
  const exePath = named.get('--exe');
  const flagFile = named.get('--flag');
  const cwd = named.get('--cwd');
  if (!Number.isInteger(pid) || pid <= 0 || !exePath || !flagFile || !cwd) return null;
  const restarts = Number(named.get('--restarts') ?? 0);
  const first = Number(named.get('--first') ?? 0);
  const hist = Number.isInteger(restarts) && restarts > 0 && Number.isFinite(first) && first > 0
    ? { restarts, firstAt: first } : { ...NO_HISTORY };
  return { appPid: pid, exePath, args: argv.slice(sep + 1), flagFile, cwd, ...hist };
}

export function writeFlag(flagFile: string): void {
  writeFileSync(flagFile, String(process.pid));
}

/** Deletes the flag; a running watchdog sees it gone and exits within {@link POLL_MS}. */
export function stopWatchdog(flagFile: string): void {
  rmSync(flagFile, { force: true });
}

export interface WatchdogSpawner {
  /** Spawns detached and unref'd; returns the pid (or undefined if spawning failed). */
  spawn(cmd: string, args: string[], o: { env: NodeJS.ProcessEnv; detached: true; stdio: 'ignore'; windowsHide: true }): number | undefined;
  isAlive(pid: number): boolean;
}

const realSpawner: WatchdogSpawner = {
  spawn(cmd, args, o) {
    const child = spawn(cmd, args, o);
    child.on('error', (err) => console.error('[watchdog] spawn failed', err));
    child.unref();
    return child.pid;
  },
  isAlive,
};

export interface StartDeps {
  /** The binary that runs the script as node (electron's own execPath with ELECTRON_RUN_AS_NODE). */
  execPath?: string;
  /** Path to dist/watchdog.js. Default: next to the bundle this code runs from (dist/main.js). */
  script?: string;
  env?: NodeJS.ProcessEnv;
  spawner?: WatchdogSpawner;
}

let watchdogPid: number | undefined;

/** Spawns the watchdog unless the one we already spawned is still alive (one per session). */
export function startWatchdog(opts: WatchdogOptions, deps: StartDeps = {}): void {
  const sp = deps.spawner ?? realSpawner;
  if (watchdogPid !== undefined && sp.isAlive(watchdogPid)) return;
  const script = deps.script ?? join(dirname(fileURLToPath(import.meta.url)), 'watchdog.js');
  watchdogPid = sp.spawn(deps.execPath ?? process.execPath, watchdogArgs(script, opts), {
    env: { ...(deps.env ?? process.env), ELECTRON_RUN_AS_NODE: '1' },
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
}

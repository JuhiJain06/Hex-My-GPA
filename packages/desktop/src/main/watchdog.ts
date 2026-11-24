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

export interface WatchdogOptions {
  appPid: number;
  exePath: string;
  /** Relaunch args (see {@link relaunchArgs}). */
  args: string[];
  flagFile: string;
  /** Working directory to relaunch in (dev args like `dist/main.js` are relative). Default: our cwd. */
  cwd?: string;
}

export type WatchdogAction = 'continue' | 'relaunch' | 'exit';

export function watchdogStep(s: { appAlive: boolean; flagExists: boolean }): WatchdogAction {
  if (!s.flagExists) return 'exit';
  return s.appAlive ? 'continue' : 'relaunch';
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
  return [...argv.slice(1).filter((a) => a !== RESTORED_FLAG), RESTORED_FLAG];
}

/** The relaunched app's env: ours minus ELECTRON_RUN_AS_NODE (BUDDY_* and the rest pass through). */
export function relaunchEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  delete out.ELECTRON_RUN_AS_NODE;
  return out;
}

/** argv for the watchdog process: `<script> --app-pid N --exe E --flag F --cwd C -- ...relaunchArgs`. */
export function watchdogArgs(script: string, o: WatchdogOptions): string[] {
  return [script, '--app-pid', String(o.appPid), '--exe', o.exePath, '--flag', o.flagFile, '--cwd', o.cwd ?? process.cwd(), '--', ...o.args];
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
  return { appPid: pid, exePath, args: argv.slice(sep + 1), flagFile, cwd };
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

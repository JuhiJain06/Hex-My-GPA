// The watchdog process (bundled to dist/watchdog.js, run by electron.exe with ELECTRON_RUN_AS_NODE=1).
// argv: see watchdogArgs(). Polls every 3 s; relaunches the app if it died mid-session, exits once
// the session flag is gone. Never prints (stdio is ignored) and never throws out.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { POLL_MS, isAlive, parseWatchdogArgs, relaunchEnv, watchdogStep } from '../main/watchdog';

const opts = parseWatchdogArgs(process.argv.slice(2));
if (!opts) process.exit(2);
const { appPid, exePath, args, flagFile, cwd } = opts;

const timer = setInterval(() => {
  let action;
  try {
    action = watchdogStep({ appAlive: isAlive(appPid), flagExists: existsSync(flagFile) });
  } catch {
    action = 'continue' as const;
  }
  if (action === 'continue') return;
  clearInterval(timer);
  if (action === 'relaunch') {
    try {
      const child = spawn(exePath, args, { cwd, env: relaunchEnv(process.env), detached: true, stdio: 'ignore' });
      child.on('error', () => process.exit(1));
      child.unref();
      // Give spawn a moment to report an error before leaving.
      setTimeout(() => process.exit(0), 500);
    } catch {
      process.exit(1);
    }
    return;
  }
  process.exit(0);
}, POLL_MS);

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, isBrowserCovered, type BrowserKind, type BuddyEvent, type Lists, type WindowReport } from '@study-buddy/core';
import { openDb, type Db } from '../src/main/db';
import { SessionController } from '../src/main/controller';
import { AppGuard, BROWSER_LABEL, parseOfferAnswer, parsePromptAnswer, type GuardUi } from '../src/main/appGuard';
import { SharedHotkey } from '../src/main/sharedHotkey';

const S = 1000;
const M = 60_000;
const T0 = new Date(2026, 10, 23, 10, 0, 0).getTime();
const OWN = 4242;
const RHYTHM = { focusMin: 25, shortBreakMin: 5, longBreakMin: 15, longBreakEvery: 3 };

type Call =
  | { t: 'overlay'; label: string; until: number | null }
  | { t: 'hideOverlay' }
  | { t: 'prompt'; exe: string }
  | { t: 'hidePrompt' }
  | { t: 'offer'; exe: string }
  | { t: 'hideOffer' };

let dir: string;
let db: Db;
let now: number;
let calls: Call[];
let apps: Lists;
let covered: boolean;
let ctrl: SessionController;
let guard: AppGuard;
let lost: Partial<Record<BrowserKind, number>>;

const ui: GuardUi = {
  showOverlay: (r) => { calls.push({ t: 'overlay', ...r }); },
  hideOverlay: () => { calls.push({ t: 'hideOverlay' }); },
  showPrompt: (exe) => { calls.push({ t: 'prompt', exe }); },
  hidePrompt: () => { calls.push({ t: 'hidePrompt' }); },
  showOffer: (exe) => { calls.push({ t: 'offer', exe }); },
  hideOffer: () => { calls.push({ t: 'hideOffer' }); },
};

const fg = (exe: string, pid = 100, title = exe) => ({ exe, title, pid });
const of = <K extends Call['t']>(t: K) => calls.filter((c): c is Extract<Call, { t: K }> => c.t === t);
/** The last overlay-related call, i.e. whether the overlay is currently up. */
const overlayUp = (): boolean => {
  const last = calls.filter((c) => c.t === 'overlay' || c.t === 'hideOverlay').pop();
  return last?.t === 'overlay';
};
const promptUp = (): boolean => {
  const last = calls.filter((c) => c.t === 'prompt' || c.t === 'hidePrompt').pop();
  return last?.t === 'prompt';
};

function start(): void {
  ctrl = new SessionController(db, () => now, { rhythm: RHYTHM });
  guard = new AppGuard(
    ctrl, ui, () => apps, () => covered, OWN, () => now,
    (fn) => { apps = fn(apps); },
    (kind) => lost[kind] ?? null,
  );
  ctrl.start({ topic: 'Maths', mode: 'laptop', goal: null, plannedMin: null });
}
function runTo(until: number, step = S): void {
  while (now < until) {
    now = Math.min(until, now + step);
    ctrl.tick();
    guard.tick();
  }
}
/** Ends the session and returns its slip events. */
function slips(): BuddyEvent[] {
  return endedEvents().filter((e) => e.kind === 'slip');
}
/** Ends the session and returns all its events. */
function endedEvents(): BuddyEvent[] {
  const id = ctrl.end();
  return db.sessions(0).find((s) => s.id === id)!.events;
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sb-guard-'));
  db = await openDb(join(dir, 'sb.sqlite'));
  now = T0;
  calls = [];
  covered = true;
  lost = {};
  apps = { fine: ['code.exe', ...DEFAULT_SETTINGS.apps.fine], gray: ['spotify.exe'], hard: ['steam.exe'] };
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('AppGuard', () => {
  test("ignores Study Buddy's own process", () => {
    start();
    guard.onForeground(fg('electron.exe', OWN));
    runTo(T0 + 5 * S);
    expect(calls).toEqual([]);

    // Hard app → overlay; switching to our own window hides it but keeps the hard app as "last real fg".
    guard.onForeground(fg('steam.exe'));
    expect(overlayUp()).toBe(true);
    guard.onForeground(fg('electron.exe', OWN));
    expect(overlayUp()).toBe(false);
    runTo(T0 + 20 * S);
    expect(overlayUp()).toBe(false);
    expect(of('prompt')).toEqual([]);

    // Back to the same hard app: overlay again, but it is the same entry, so still only one slip.
    guard.onForeground(fg('steam.exe'));
    expect(overlayUp()).toBe(true);

    // Renderer processes can be recognised with a predicate.
    const g2 = new AppGuard(ctrl, ui, () => apps, () => covered, (pid) => pid === OWN || pid === 777, () => now, () => {});
    calls = [];
    g2.onForeground(fg('spotify.exe', 777));
    expect(calls).toEqual([]);

    expect(slips()).toEqual([{ at: T0 + 5 * S, kind: 'slip', target: 'steam.exe', detail: null }]);
  });

  test('hard app → overlay with break time while blockingActive; none in break or after bypass', () => {
    start();
    const endsAt = T0 + 25 * M;
    guard.onForeground(fg('steam.exe'));
    expect(of('overlay')).toEqual([{ t: 'overlay', label: 'steam.exe', until: endsAt }]);
    runTo(T0 + 30 * S);
    expect(of('overlay')).toHaveLength(1); // not re-shown every tick

    // A fine app hides it; re-entering is a new entry → a second slip.
    guard.onForeground(fg('code.exe'));
    expect(overlayUp()).toBe(false);
    guard.onForeground(fg('steam.exe'));
    expect(overlayUp()).toBe(true);

    // Break starts → overlay hidden, and it does not come back during the break.
    runTo(endsAt);
    expect(ctrl.engine.state.phase).toBe('break');
    expect(overlayUp()).toBe(false);
    guard.onForeground(fg('code.exe'));
    guard.onForeground(fg('steam.exe'));
    runTo(endsAt + 10 * S);
    expect(overlayUp()).toBe(false);

    // Next block → blocked again (and a slip for this block).
    runTo(T0 + 30 * M);
    ctrl.nextBlock();
    expect(overlayUp()).toBe(true);
    expect(of('overlay').at(-1)).toEqual({ t: 'overlay', label: 'steam.exe', until: now + 25 * M });

    // Bypass → hidden and stays hidden.
    expect(ctrl.turnOffBlocking('I am choosing to stop studying')).toBe(true);
    expect(overlayUp()).toBe(false);
    guard.onForeground(fg('code.exe'));
    guard.onForeground(fg('steam.exe'));
    runTo(now + 10 * S);
    expect(overlayUp()).toBe(false);

    expect(slips().map((e) => [e.at, e.target])).toEqual([
      [T0, 'steam.exe'], [T0 + 30 * S, 'steam.exe'], [T0 + 30 * M, 'steam.exe'],
    ]);
  });

  test('gray app → prompt once per block; no/30 s timeout → slip + re-ask after 5 min; yes → silent for the block', () => {
    start();
    guard.onForeground(fg('spotify.exe'));
    expect(of('prompt')).toEqual([{ t: 'prompt', exe: 'spotify.exe' }]);
    expect(of('overlay')).toEqual([]);

    // Unanswered for 30 s → hidden + slip.
    runTo(T0 + 29 * S);
    expect(promptUp()).toBe(true);
    runTo(T0 + 30 * S);
    expect(promptUp()).toBe(false);

    // Not re-asked before 5 min, even when re-entering.
    guard.onForeground(fg('code.exe'));
    guard.onForeground(fg('spotify.exe'));
    runTo(T0 + 30 * S + 5 * M - S);
    expect(of('prompt')).toHaveLength(1);
    runTo(T0 + 30 * S + 5 * M);
    expect(of('prompt')).toHaveLength(2);

    // "No" → slip, hidden, re-asked 5 min later if still in front.
    const noAt = now + 3 * S;
    runTo(noAt);
    guard.answerPrompt('spotify.exe', false);
    expect(promptUp()).toBe(false);
    runTo(noAt + 5 * M);
    expect(of('prompt')).toHaveLength(3);

    // "Yes" → silent for the rest of the block.
    guard.answerPrompt('spotify.exe', true);
    expect(promptUp()).toBe(false);
    guard.onForeground(fg('code.exe'));
    guard.onForeground(fg('spotify.exe'));
    runTo(T0 + 25 * M - S);
    expect(of('prompt')).toHaveLength(3);
    // Answers for something not being asked are ignored.
    guard.answerPrompt('spotify.exe', false);

    // Break hides nothing new; the next block asks again.
    runTo(T0 + 31 * M);
    expect(of('prompt')).toHaveLength(3);
    ctrl.nextBlock();
    expect(of('prompt')).toHaveLength(4);
    // Break while a prompt is up → hidden without a slip.
    ctrl.turnOffBlocking('I am choosing to stop studying');
    expect(promptUp()).toBe(false);

    expect(slips().map((e) => [e.at, e.target])).toEqual([
      [T0 + 30 * S, 'spotify.exe'], [noAt, 'spotify.exe'],
    ]);
  });

  test('unlisted app foreground for 2 min cumulative in a focus block → offer once; "block" adds to apps.hard', () => {
    start();
    guard.onForeground(fg('game.exe'));
    runTo(T0 + 90 * S);
    guard.onForeground(fg('code.exe'));
    runTo(T0 + 5 * M); // time in a fine app does not count
    guard.onForeground(fg('game.exe'));
    runTo(T0 + 5 * M + 29 * S);
    expect(of('offer')).toEqual([]);
    runTo(T0 + 5 * M + 30 * S);
    expect(of('offer')).toEqual([{ t: 'offer', exe: 'game.exe' }]);
    runTo(T0 + 10 * M);
    expect(of('offer')).toHaveLength(1);
    expect(of('overlay')).toEqual([]);

    guard.answerOffer('game.exe', 'block');
    expect(apps.hard).toContain('game.exe');
    expect(overlayUp()).toBe(true); // it is blocked now
    // Answering again (not offered) changes nothing.
    guard.answerOffer('game.exe', 'block');
    expect(apps.hard.filter((e) => e === 'game.exe')).toHaveLength(1);

    // 'fine' adds to the fine list; 'later' changes nothing; each offered once per session.
    guard.onForeground(fg('tool.exe'));
    runTo(now + 2 * M);
    guard.answerOffer('tool.exe', 'fine');
    expect(apps.fine).toContain('tool.exe');
    guard.onForeground(fg('chat.exe'));
    runTo(now + 2 * M);
    const before = JSON.stringify(apps);
    guard.answerOffer('chat.exe', 'later');
    expect(JSON.stringify(apps)).toBe(before);
    // Next block: chat.exe is not offered again this session.
    runTo(T0 + 31 * M);
    ctrl.nextBlock();
    runTo(now + 3 * M);
    expect(of('offer').map((c) => c.exe)).toEqual(['game.exe', 'tool.exe', 'chat.exe']);
  });

  test('unlisted time counts only while blocking is active and resets per block', () => {
    start();
    guard.onForeground(fg('chat.exe'));
    runTo(T0 + 90 * S); // 90 s of chat.exe in block 1 do not carry over
    guard.onForeground(fg('game.exe'));
    runTo(T0 + 24 * M);
    guard.onForeground(fg('code.exe'));
    // Break: game time is not counted.
    runTo(T0 + 25 * M);
    guard.onForeground(fg('chat.exe'));
    runTo(T0 + 30 * M);
    expect(of('offer').map((c) => c.exe)).toEqual(['game.exe']);
    ctrl.nextBlock();
    runTo(now + 119 * S);
    expect(of('offer').map((c) => c.exe)).toEqual(['game.exe']);
    runTo(now + S);
    expect(of('offer').map((c) => c.exe)).toEqual(['game.exe', 'chat.exe']);
  });

  test('browser uncovered for over 3 s → overlay labelled "Browser without Study Buddy"; covered → no overlay', () => {
    start();
    covered = false;
    // Browsers skip list classification, even when listed as fine.
    guard.onForeground(fg('chrome.exe'));
    runTo(T0 + 3 * S);
    expect(overlayUp()).toBe(false);
    runTo(T0 + 4 * S);
    expect(of('overlay')).toEqual([{ t: 'overlay', label: 'Browser without Study Buddy', until: T0 + 25 * M }]);
    covered = true;
    runTo(T0 + 5 * S);
    expect(overlayUp()).toBe(false);
    runTo(T0 + 3 * M);
    expect(of('overlay')).toHaveLength(1);
    expect(of('offer')).toEqual([]);
    expect(of('prompt')).toEqual([]);
    expect(slips()).toEqual([]);
  });

  test('fine and unlisted apps never overlay', () => {
    start();
    guard.onForeground(fg('code.exe'));
    runTo(T0 + 5 * M);
    guard.onForeground(fg('game.exe'));
    runTo(T0 + 10 * M);
    guard.onForeground(null);
    runTo(T0 + 11 * M);
    expect(of('overlay')).toEqual([]);
    expect(of('prompt')).toEqual([]);
    expect(slips()).toEqual([]);
  });
});

describe('AppGuard browser windows with real coverage (C1)', () => {
  const report = (...titles: string[]): WindowReport[] => titles.map((title) => ({ title, incognito: false, focused: true }));
  let reports: { browser: BrowserKind; windows: WindowReport[] }[];
  function startReal(): void {
    ctrl = new SessionController(db, () => now, { rhythm: RHYTHM });
    guard = new AppGuard(ctrl, ui, () => apps, (f) => isBrowserCovered(f, reports), OWN, () => now);
    ctrl.start({ topic: 'Maths', mode: 'laptop', goal: null, plannedMin: null });
  }

  test('file dialogs, DevTools and sign-in popups of a connected browser are never overlaid', () => {
    reports = [{ browser: 'chrome', windows: report('NotebookLM', 'Sign in - Google Accounts') },
      { browser: 'edge', windows: report('Claude') }];
    startReal();
    const titles = ['Open', 'Save As', 'DevTools - notebooklm.google.com/', 'Sign in - Google Accounts - Google Chrome',
      'Choose a profile', 'NotebookLM - Google Chrome'];
    for (const title of titles) {
      guard.onForeground(fg('chrome.exe', 100, title));
      runTo(now + 10 * S);
    }
    for (const title of ['Open', 'Save As', 'DevTools - claude.ai/new', 'Claude - Personal - Microsoft\u200b Edge']) {
      guard.onForeground(fg('msedge.exe', 101, title));
      runTo(now + 10 * S);
    }
    expect(of('overlay')).toEqual([]);
    expect(slips()).toEqual([]);
  });

  test('an unreported tab window (e.g. incognito the extension cannot see) is still overlaid after 3 s', () => {
    reports = [{ browser: 'chrome', windows: report('NotebookLM') }];
    startReal();
    guard.onForeground(fg('chrome.exe', 100, 'Reddit - Google Chrome (Incognito)'));
    runTo(T0 + 4 * S);
    expect(of('overlay').map((c) => c.label)).toEqual([BROWSER_LABEL]);
    // A dialog of a browser kind with no extension connected is overlaid too (spec: unconnected browser).
    guard.onForeground(fg('msedge.exe', 101, 'Open'));
    runTo(T0 + 9 * S);
    expect(of('overlay').map((c) => c.label)).toEqual([BROWSER_LABEL, BROWSER_LABEL]);
  });
});

describe('AppGuard gating (I3, I6)', () => {
  test('gray prompt closes without a slip when the foreground leaves that app (our own windows do not count)', () => {
    start();
    guard.onForeground(fg('spotify.exe'));
    expect(promptUp()).toBe(true);
    guard.onForeground(fg('electron.exe', OWN)); // clicking the prompt / pet keeps it
    runTo(T0 + 5 * S);
    expect(promptUp()).toBe(true);
    guard.onForeground(fg('code.exe'));
    expect(promptUp()).toBe(false);
    runTo(T0 + 2 * M); // the old prompt's 30 s timeout must not fire later
    expect(slips()).toEqual([]);
  });

  test('no gray asks or re-asks while paused; an open prompt closes without a slip on pause', () => {
    start();
    guard.onForeground(fg('spotify.exe'));
    expect(promptUp()).toBe(true);
    runTo(T0 + 10 * S);
    ctrl.pause(now);
    guard.tick();
    expect(promptUp()).toBe(false);
    runTo(T0 + 10 * M);
    expect(of('prompt')).toHaveLength(1);
    ctrl.resume();
    guard.tick();
    expect(of('prompt')).toHaveLength(2);
    expect(slips()).toEqual([]);
  });

  test('unlisted time does not accrue while paused', () => {
    start();
    guard.onForeground(fg('game.exe'));
    runTo(T0 + 60 * S);
    ctrl.pause(now);
    runTo(T0 + 10 * M);
    ctrl.resume();
    runTo(now + 59 * S);
    expect(of('offer')).toEqual([]);
    runTo(now + S);
    expect(of('offer')).toEqual([{ t: 'offer', exe: 'game.exe' }]);
  });

  test('Windows shell/host processes are never prompted, offered or overlaid, even if listed', () => {
    apps = { ...apps, gray: [...apps.gray, 'searchhost.exe'], hard: [...apps.hard, 'lockapp.exe'] };
    start();
    for (const exe of ['lockapp.exe', 'searchhost.exe', 'startmenuexperiencehost.exe', 'shellexperiencehost.exe',
      'applicationframehost.exe', 'systemsettings.exe', 'textinputhost.exe', 'searchapp.exe']) {
      expect(guard.classify(exe)).toBe('system');
      guard.onForeground(fg(exe));
      runTo(now + 3 * M);
    }
    expect(calls.filter((c) => c.t !== 'hideOverlay')).toEqual([]);
    expect(slips()).toEqual([]);
  });

  test('claude.exe is fine by default', () => {
    apps = DEFAULT_SETTINGS.apps;
    start();
    expect(guard.classify('claude.exe')).toBe('fine');
    guard.onForeground(fg('claude.exe'));
    runTo(T0 + 5 * M);
    expect(of('offer')).toEqual([]);
  });

  test('the offer window is hidden when the session ends', () => {
    start();
    guard.onForeground(fg('game.exe'));
    runTo(T0 + 2 * M);
    expect(of('offer')).toHaveLength(1);
    ctrl.end();
    expect(of('hideOffer')).toHaveLength(1);
  });
});

describe('AppGuard extension-disconnected bypass (I4)', () => {
  const bypasses = () => endedEvents().filter((e) => e.kind === 'bypass' && e.target === 'extension-disconnected');

  test('logged once, only after an uncovered window of the lost browser kind has been in front for 10 s', () => {
    start();
    covered = true;
    guard.onForeground(fg('chrome.exe'));
    runTo(T0 + 10 * S);
    // Extension drops (browser closed, or switched off). Nothing in front of that kind → nothing logged.
    lost.chrome = now;
    covered = false;
    guard.onForeground(fg('code.exe'));
    runTo(T0 + 5 * M);
    // Browser reopened: uncovered while the extension reconnects → no bypass within 10 s.
    guard.onForeground(fg('chrome.exe'));
    runTo(now + 9 * S);
    delete lost.chrome;
    covered = true;
    runTo(now + 30 * S);
    // Lost again, and the browser stays uncovered in front → one bypass after 10 s.
    lost.chrome = now;
    covered = false;
    runTo(now + 10 * S); // first uncovered tick is 1 s after the drop
    const at = now + S;
    runTo(at + 2 * M);
    guard.onForeground(fg('code.exe'));
    guard.onForeground(fg('chrome.exe'));
    runTo(now + 1 * M);
    expect(bypasses()).toEqual([{ at, kind: 'bypass', target: 'extension-disconnected', detail: null }]);
  });

  test('none for another browser kind, while not blocking, or for a link lost before the session started', () => {
    lost.edge = T0 - M;
    start();
    covered = false;
    guard.onForeground(fg('msedge.exe')); // lost before this session
    runTo(T0 + M);
    lost.chrome = now;
    guard.onForeground(fg('firefox.exe')); // no extension kind
    runTo(now + M);
    ctrl.turnOffBlocking('I am choosing to stop studying');
    guard.onForeground(fg('chrome.exe'));
    runTo(now + M);
    expect(bypasses()).toEqual([]);
  });
});

describe('AppGuard overlay dismiss', () => {
  test('dismissed overlay re-arms within 5 s while the hard app stays in front; not after switching away', () => {
    start();
    guard.onForeground(fg('steam.exe'));
    expect(overlayUp()).toBe(true);
    guard.dismissOverlay();
    expect(overlayUp()).toBe(false);
    runTo(T0 + 4 * S);
    expect(overlayUp()).toBe(false);
    runTo(T0 + 5 * S);
    expect(overlayUp()).toBe(true); // same app still in front → back
    expect(of('overlay')).toHaveLength(2);

    // Dismiss, then switch to a fine app: stays down, and the grace ends with the foreground change.
    guard.dismissOverlay();
    guard.onForeground(fg('code.exe'));
    runTo(T0 + 20 * S);
    expect(overlayUp()).toBe(false);
    expect(of('overlay')).toHaveLength(2);
    // Coming back is a new entry → overlay immediately (no leftover grace).
    guard.onForeground(fg('steam.exe'));
    expect(overlayUp()).toBe(true);
  });

  test('dismiss also re-arms for an uncovered browser; no-op when nothing is shown', () => {
    start();
    guard.dismissOverlay();
    expect(calls).toEqual([]);
    covered = false;
    guard.onForeground(fg('chrome.exe'));
    runTo(T0 + 4 * S);
    expect(overlayUp()).toBe(true);
    guard.dismissOverlay();
    runTo(T0 + 8 * S);
    expect(overlayUp()).toBe(false);
    runTo(T0 + 9 * S);
    expect(of('overlay').map((c) => c.label)).toEqual([BROWSER_LABEL, BROWSER_LABEL]);
  });
});

describe('guard IPC parsers', () => {
  test('accept only well-formed lowercase exe answers', () => {
    expect(parsePromptAnswer({ exe: 'spotify.exe', study: true })).toEqual({ exe: 'spotify.exe', study: true });
    expect(parsePromptAnswer({ exe: 'spotify.exe', study: 'yes' })).toBeNull();
    expect(parsePromptAnswer({ exe: 'C:\\x\\spotify.exe', study: false })).toBeNull();
    expect(parsePromptAnswer({ exe: 'Spotify.exe', study: false })).toBeNull();
    expect(parsePromptAnswer(null)).toBeNull();
    expect(parseOfferAnswer({ exe: 'game.exe', choice: 'block' })).toEqual({ exe: 'game.exe', choice: 'block' });
    expect(parseOfferAnswer({ exe: 'game.exe', choice: 'nuke' })).toBeNull();
    expect(parseOfferAnswer({ exe: 'game', choice: 'fine' })).toBeNull();
  });
});

describe('SharedHotkey (Ctrl+Alt+Y owner)', () => {
  test('binds once, answers the most recently shown owner, falls back on release, unbinds when empty', () => {
    const log: string[] = [];
    let fire: (() => void) | null = null;
    let t = 0;
    const key = new SharedHotkey(
      (fn) => { log.push('bind'); fire = fn; return true; },
      () => { log.push('unbind'); fire = null; },
      () => (t += 1000), // every claim/fire is a second apart: never debounced or unarmed here
    );
    key.claim('checkin', () => log.push('checkin:Y'));
    key.claim('prompt', () => log.push('prompt:Y'));
    expect(log).toEqual(['bind']); // one registration for both
    fire!();
    expect(log.at(-1)).toBe('prompt:Y'); // newest visible prompt wins
    key.release('prompt');
    fire!();
    expect(log.at(-1)).toBe('checkin:Y'); // back to the check-in
    // Re-claiming moves an owner to the top; releasing an unknown owner is harmless.
    key.claim('prompt', () => log.push('prompt:Y2'));
    key.claim('checkin', () => log.push('checkin:Y2'));
    key.release('nobody');
    fire!();
    expect(log.at(-1)).toBe('checkin:Y2');
    key.release('checkin');
    key.release('prompt');
    expect(log.filter((l) => l === 'bind' || l === 'unbind')).toEqual(['bind', 'unbind']);
    expect(fire).toBeNull();
    // Claimable again afterwards.
    key.claim('prompt', () => log.push('prompt:Y3'));
    fire!();
    expect(log.at(-1)).toBe('prompt:Y3');
  });

  test('a failed registration is retried on the next claim', () => {
    let ok = false;
    let binds = 0;
    const key = new SharedHotkey(() => { binds++; return ok; }, () => {});
    key.claim('a', () => {});
    ok = true;
    key.claim('b', () => {});
    expect(binds).toBe(2);
    key.claim('c', () => {});
    expect(binds).toBe(2);
  });

  test('ignores a fire within 750 ms of the previous one (second press / key auto-repeat after the prompt closes)', () => {
    let t = 10_000;
    const log: string[] = [];
    let fire: (() => void) | null = null;
    const key = new SharedHotkey((fn) => { fire = fn; return true; }, () => { fire = null; }, () => t);
    key.claim('checkin', () => log.push('checkin'));
    t += 2000;
    key.claim('prompt', () => { log.push('prompt'); key.release('prompt'); });
    t += 1000;
    fire!(); // answers the prompt, which releases → the check-in is the owner now
    t += 40;
    fire!(); // auto-repeat: ignored
    t += 400;
    fire!(); // still within 750 ms of the last (ignored) fire: ignored
    expect(log).toEqual(['prompt']);
    t += 800;
    fire!(); // a deliberate later press answers the check-in
    expect(log).toEqual(['prompt', 'checkin']);
  });

  test('ignores a fire aimed at an owner shown less than 500 ms ago', () => {
    let t = 10_000;
    const log: string[] = [];
    let fire: (() => void) | null = null;
    const key = new SharedHotkey((fn) => { fire = fn; return true; }, () => {}, () => t);
    key.claim('checkin', () => log.push('checkin'));
    t += 300;
    fire!();
    expect(log).toEqual([]);
    t += 1000;
    fire!();
    expect(log).toEqual(['checkin']);
  });
});

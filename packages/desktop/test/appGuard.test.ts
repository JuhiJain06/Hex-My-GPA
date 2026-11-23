import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, type BuddyEvent, type Lists } from '@study-buddy/core';
import { openDb, type Db } from '../src/main/db';
import { SessionController } from '../src/main/controller';
import { AppGuard, parseOfferAnswer, parsePromptAnswer, type GuardUi } from '../src/main/appGuard';

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
  | { t: 'offer'; exe: string };

let dir: string;
let db: Db;
let now: number;
let calls: Call[];
let apps: Lists;
let covered: boolean;
let ctrl: SessionController;
let guard: AppGuard;

const ui: GuardUi = {
  showOverlay: (r) => { calls.push({ t: 'overlay', ...r }); },
  hideOverlay: () => { calls.push({ t: 'hideOverlay' }); },
  showPrompt: (exe) => { calls.push({ t: 'prompt', exe }); },
  hidePrompt: () => { calls.push({ t: 'hidePrompt' }); },
  showOffer: (exe) => { calls.push({ t: 'offer', exe }); },
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
  const id = ctrl.end();
  return db.sessions(0).find((s) => s.id === id)!.events.filter((e) => e.kind === 'slip');
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sb-guard-'));
  db = await openDb(join(dir, 'sb.sqlite'));
  now = T0;
  calls = [];
  covered = true;
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

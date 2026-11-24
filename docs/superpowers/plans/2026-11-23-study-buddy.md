# Study Buddy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Windows desktop companion plus a Chrome/Edge extension that keep the user focused through long study sessions. Together they pace focus blocks and breaks, run check-ins, block distractions, play focus sounds, and track stats.

**Architecture:** An npm-workspaces monorepo with three packages:
- **`core`** holds all decision logic as pure, clock-injected TypeScript, and is fully unit-tested.
- **`desktop`** is an Electron app. It owns state, the SQLite file, the windows, foreground-app watching and a localhost WebSocket bridge.
- **`extension`** is a thin MV3 client. It enforces web rules and reports web events over that bridge.

**Tech Stack:** TypeScript 5, Node ≥ 20 (dev machine has 26), current stable Electron, esbuild (bundling main, preload, renderers and extension), vitest (+ jsdom for DOM logic), `ws` (bridge server), `sql.js` (SQLite file without native builds), `get-windows` (foreground window), Web Audio API (sounds).

**Spec:** `docs/superpowers/specs/2026-11-23-study-buddy-design.md`

## Global Constraints

- Windows only. Chrome MV3 extension that also loads in Edge.
- Nothing leaves the machine. The bridge binds `127.0.0.1` only, and every extension connection must present the shared secret.
- Default rhythm is 45 min focus / 10 min break, with every 3rd break 25 min. Extending a block adds 10 min.
- Check-ins: laptop mode every 25 min, book mode every 15 min, both ±5 min random. They go unanswered after 2 min (laptop) or 5 min (book).
- The YouTube "Is this for study?" prompt auto-answers "no" after 30 s and re-asks after 5 min.
- A break plays a 1-minute warning. If the user hasn't started the next block 3 min after a break ends, it's an overrun.
- The streak minimum defaults to 120 focus minutes per day.
- The bypass sentence is exactly `I am choosing to stop studying` (compared case-insensitively, after trimming and collapsing spaces). It unlocks sites and apps until the next break, and check-ins continue.
- Any site not on a list is **fine**. Claude, NotebookLM and Gemini are never interrupted.
- Check-in and app-prompt windows never take keyboard focus (`focusable: false`, `showInactive()`).
- Calm, unobtrusive UI. Every prompt can be answered with one click or one hotkey.

## Review Focus

1. **The laptop sleeps or the lid closes mid-block.** On wake, the slept time must not count as focus and the block must not "finish" instantly. → Engine test `treats a tick gap over 60 s as a pause` (Task 2), plus `powerMonitor` suspend → pause (Task 7).
2. **A session crosses midnight.** Today's total must split at local midnight, and the streak must count both days correctly. → Stats test `splits an interval at local midnight` (Task 4).
3. **The PC reboots or crashes mid-session, and the app opens hours later.** It must not resume a stale session or log a bypass. → Storage test `activeSession reports stale when heartbeat older than 10 min` (Task 6), and the restore path in Task 7.
4. **The MV3 service worker gets suspended, or the WebSocket blips.** This must not log a false "extension switched off" bypass or flash overlays. → A 20 s keepalive ping (Task 11), a 10 s disconnect grace before a bypass is logged, and a 3 s coverage grace before an overlay (Task 10 tests).
5. **Study Buddy's own windows (overlay, prompts) become the foreground window.** This must not be classified as an app or create an overlay loop. → App-guard test `ignores Study Buddy's own process` (Task 9).

---

## File Structure

```
package.json                      workspaces: packages/*
tsconfig.base.json
packages/core/
  src/settings.ts                 Settings type, DEFAULT_SETTINGS, BROWSER_EXES
  src/lists.ts                    classifySite, classifyApp
  src/engine.ts                   SessionEngine (focus/break/pause/bypass state machine)
  src/checkins.ts                 nextCheckinAt, resolveUnanswered
  src/suggestions.ts              break suggestions + pickSuggestion
  src/stats.ts                    dailyTotals, streak, summarize, topTags
  src/protocol.ts                 bridge message types + parseExtMessage
  src/coverage.ts                 isBrowserCovered
  src/index.ts                    re-exports
  test/*.test.ts
packages/desktop/
  build.mjs                       esbuild: main, preload, watchdog, renderers → dist/
  src/shared/ipc.ts               IPC channel names + payload types
  src/main/index.ts               bootstrap + wiring only
  src/main/db.ts                  sql.js storage
  src/main/controller.ts          SessionController: engine + db + timers + events
  src/main/windows.ts             create/show every BrowserWindow
  src/main/hotkeys.ts             globalShortcut registration
  src/main/foreground.ts          polls get-windows every 1 s
  src/main/appGuard.ts            app classification → overlay / prompt / 2-min offer
  src/main/bridge.ts              ws server, per-connection reports, disconnect handling
  src/main/watchdog.ts            spawn/stop the watchdog process
  src/watchdog/run.ts             the watchdog itself (runs with ELECTRON_RUN_AS_NODE)
  src/preload.ts                  exposes window.buddy {send, invoke, on}
  src/renderer/<name>.html/.ts    start, mini, checkin, prompt, overlay, break,
                                  reflection, summary, history, settings, bypass
  src/renderer/audio.ts           SoundEngine (Web Audio)
  assets/sounds/                  rain.ogg, cafe.ogg, CREDITS.md
  test/*.test.ts
packages/extension/
  build.mjs                       esbuild → dist/ (copies manifest + html)
  manifest.json
  src/background.ts               ws client, keepalive, DNR rules, window reports, offline fallback
  src/rules.ts                    buildBlockRules (pure)
  src/youtube.ts                  content script wiring
  src/youtubeLogic.ts             pure: videoId, isShorts, prompt state machine
  src/blocked.html/.ts            "Blocked until break at HH:MM"
  src/options.html/.ts            pairing code + Incognito walkthrough
  src/sidepanel.html/.ts          state display + start-session form
  test/*.test.ts
```

---

### Task 1: Workspace scaffold, settings and list classification

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.gitignore` (`node_modules`, `dist`), `packages/core/package.json`, `packages/core/vitest.config.ts` (`test.env.TZ = 'Asia/Kolkata'`), `packages/core/src/settings.ts`, `packages/core/src/lists.ts`, `packages/core/src/index.ts`
- Test: `packages/core/test/lists.test.ts`

**Interfaces:**
- Produces:
  - `type Mode = 'laptop' | 'book'`
  - `interface Rhythm { focusMin: number; shortBreakMin: number; longBreakMin: number; longBreakEvery: number }`
  - `type FreqChoice = { kind: 'binaural' | 'isochronic'; beatHz: number; carrierHz: number } | { kind: 'pure'; hz: number }`
  - `interface SoundChoice { ambient: 'none' | 'rain' | 'brown' | 'cafe'; ambientVolume: number; freq: FreqChoice | null; freqVolume: number }`
  - `interface Lists { fine: string[]; gray: string[]; hard: string[] }`
  - `interface Settings { rhythm: Rhythm; streakMinMinutes: number; sites: Lists; apps: Lists; sound: SoundChoice }`
  - `DEFAULT_SETTINGS: Settings`, `BROWSER_EXES: string[]`
  - `classifySite(url: string, sites: Lists): 'fine' | 'gray' | 'hard'`
  - `classifyApp(exe: string, apps: Lists): 'fine' | 'gray' | 'hard' | 'unlisted'`

- [ ] **Step 1: `git init`, create the workspace files, and run `npm install -D typescript vitest jsdom esbuild` at the root.**

- [ ] **Step 2: Write the failing tests**

```ts
import { classifySite, classifyApp } from '../src/lists';
import { DEFAULT_SETTINGS as D } from '../src/settings';
test('defaults', () => {
  expect(D.rhythm).toEqual({ focusMin: 45, shortBreakMin: 10, longBreakMin: 25, longBreakEvery: 3 });
  expect(D.streakMinMinutes).toBe(120);
  expect(D.sites.fine).toEqual(['claude.ai', 'notebooklm.google.com', 'gemini.google.com']);
  expect(D.sites.gray).toEqual(['youtube.com']);
  expect(D.sites.hard).toEqual(expect.arrayContaining(['instagram.com', 'facebook.com', 'x.com', 'reddit.com', 'netflix.com']));
  expect(D.apps.hard).toEqual([]);
});
test('subdomains match, unlisted is fine', () => {
  expect(classifySite('https://www.instagram.com/reels/', D.sites)).toBe('hard');
  expect(classifySite('https://m.youtube.com/watch?v=x', D.sites)).toBe('gray');
  expect(classifySite('https://khanacademy.org', D.sites)).toBe('fine');
  expect(classifySite('https://notinstagram.com', D.sites)).toBe('fine');
});
test('longest matching entry wins', () => {
  const s = { fine: ['gemini.google.com'], gray: [], hard: ['google.com'] };
  expect(classifySite('https://gemini.google.com/app', s)).toBe('fine');
  expect(classifySite('https://news.google.com', s)).toBe('hard');
});
test('apps are case-insensitive; unknown is unlisted', () => {
  expect(classifyApp('ONENOTE.EXE', D.apps)).toBe('fine');
  expect(classifyApp('steam.exe', { fine: [], gray: [], hard: ['Steam.exe'] })).toBe('hard');
  expect(classifyApp('game.exe', D.apps)).toBe('unlisted');
});
test('malformed url is fine', () => expect(classifySite('not a url', D.sites)).toBe('fine'));
```

- [ ] **Step 3: Run `npx vitest run -r packages/core`.** Expected: FAIL (modules missing).

- [ ] **Step 4: Implement `settings.ts` and `lists.ts`.**
  - **Default hard sites:** `instagram.com, facebook.com, x.com, twitter.com, reddit.com, netflix.com, poki.com, crazygames.com, miniclip.com, roblox.com`.
  - **Default fine apps:** `acrord32.exe, acrobat.exe, sumatrapdf.exe, onenote.exe, winword.exe, notepad.exe, code.exe, obsidian.exe, notion.exe, explorer.exe` plus `BROWSER_EXES = ['chrome.exe','msedge.exe','firefox.exe','brave.exe','opera.exe','vivaldi.exe']`.
  - **Default sound:** `{ ambient: 'none', ambientVolume: 0.5, freq: null, freqVolume: 0.3 }`.
  - **Site matching:** host equals the entry, or ends with `'.' + entry`. The longest matching entry wins, and on a tie the order is fine > gray > hard.

- [ ] **Step 5: Run the tests.** Expected: PASS.

- [ ] **Step 6: Commit** `feat(core): settings defaults and list classification`

---

### Task 2: Session engine

**Files:**
- Create: `packages/core/src/engine.ts`
- Test: `packages/core/test/engine.test.ts`

**Interfaces:**
- Consumes: `Rhythm`, `Mode`
- Produces:
  - `interface SessionInfo { topic: string; mode: Mode; goal: string | null; plannedMin: number | null; startedAt: number }`
  - `type Phase = 'idle' | 'focus' | 'break' | 'awaitingNext' | 'ended'`
  - `interface EngineState { phase: Phase; session: SessionInfo | null; blocksCompleted: number; breakCount: number; phaseEndsAt: number | null; pausedSince: number | null; bypassActive: boolean; breakEndedAt: number | null; overrunFired: boolean; oneMinuteFired: boolean; plannedFired: boolean; intervals: [number, number][]; openFocusSince: number | null; lastTickAt: number }` (JSON-serialisable; it's the persisted snapshot)
  - `type EngineEvent = { type: 'focusStarted'; endsAt: number } | { type: 'breakStarted'; long: boolean; endsAt: number } | { type: 'breakOneMinuteLeft' } | { type: 'breakEnded' } | { type: 'overrun' } | { type: 'paused'; since: number } | { type: 'resumed' } | { type: 'plannedLengthReached' } | { type: 'bypassOn' } | { type: 'sessionEnded' }`
  - `class SessionEngine { constructor(rhythm: Rhythm, snapshot?: EngineState); readonly state: EngineState; get blockingActive(): boolean; start(info: Omit<SessionInfo,'startedAt'>, now: number): EngineEvent[]; tick(now: number): EngineEvent[]; startNextBlock(now: number): EngineEvent[]; endBlockEarly(now: number): EngineEvent[]; extendBlock(now: number): EngineEvent[]; pause(since: number, now: number): EngineEvent[]; resume(now: number): EngineEvent[]; turnOffBlocking(sentence: string, now: number): EngineEvent[]; end(now: number): EngineEvent[]; focusMs(now: number): number }`

- [ ] **Step 1: Write the failing tests.** Use `const M = 60_000`, `const R = DEFAULT_SETTINGS.rhythm`, start at `t0 = 0`, and tick in 1 s steps with a helper `run(e, from, to)` that collects events.

```ts
test('focus 45 → short break 10 → awaitingNext', () => {
  const e = new SessionEngine(R); e.start({ topic: 'P', mode: 'laptop', goal: null, plannedMin: null }, 0);
  expect(run(e, 0, 45*M)).toContainEqual({ type: 'breakStarted', long: false, endsAt: 55*M });
  const ev = run(e, 45*M, 55*M);
  expect(ev).toContainEqual({ type: 'breakOneMinuteLeft' });
  expect(ev).toContainEqual({ type: 'breakEnded' });
  expect(e.state.phase).toBe('awaitingNext');
  expect(e.focusMs(55*M)).toBe(45*M);
});
test('every third break is 25 min', () => { /* 3 cycles via startNextBlock; 3rd breakStarted has long: true and endsAt = start+25*M */ });
test('overrun fires once, 3 min after break ends', () => { /* after breakEnded, run 3*M → exactly one overrun */ });
test('blocking: on in focus and while paused, off in break and after bypass', () => {
  /* blockingActive true at start; pause → still true; turnOffBlocking('  i am CHOOSING to  stop studying ') → [{type:'bypassOn'}], blockingActive false;
     wrong sentence → [] ; after next breakStarted, bypassActive false */
});
test('retroactive pause uncounts time and freezes countdown', () => {
  const e = start(); e.tick(10*M); e.pause(8*M, 10*M); e.resume(15*M);
  expect(e.focusMs(15*M)).toBe(8*M);
  expect(e.state.phaseEndsAt).toBe(45*M + 7*M); // paused 8→15
});
test('treats a tick gap over 60 s as a pause', () => {
  const e = start(); e.tick(1000); expect(e.tick(1000 + 30*M)).toContainEqual({ type: 'paused', since: 1000 });
  expect(e.state.phase).toBe('focus'); expect(e.focusMs(1000 + 30*M)).toBe(1000);
});
test('extend adds 10 min; endBlockEarly starts break now', () => { /* phaseEndsAt 45M→55M; endBlockEarly(20M) → breakStarted endsAt 30M */ });
test('plannedLengthReached fires once when counted focus hits plannedMin', () => { /* plannedMin 45 → fires at the 45M block end, not again */ });
test('snapshot round-trips', () => { const e2 = new SessionEngine(R, JSON.parse(JSON.stringify(e.state))); expect(e2.focusMs(t)).toBe(e.focusMs(t)); });
```

- [ ] **Step 2: Run them.** Expected: FAIL.

- [ ] **Step 3: Implement `SessionEngine` with these rules:**
  - `tick` first checks `now - lastTickAt > 60_000`. If the phase is focus and it isn't paused, it calls `pause(lastTickAt)`.
  - Focus ends at `phaseEndsAt` only when not paused. Breaks are long when `breakCount % longBreakEvery === 0` after incrementing.
  - `pause` clamps `since` to at least `openFocusSince`, closes the open interval there, and sets `pausedSince`.
  - `resume` adds `now - pausedSince` to `phaseEndsAt`.
  - `bypassActive` resets on `breakStarted`.

- [ ] **Step 4: Run the tests.** Expected: PASS.

- [ ] **Step 5: Commit** `feat(core): session engine`

---

### Task 3: Check-in scheduling and break suggestions

**Files:**
- Create: `packages/core/src/checkins.ts`, `packages/core/src/suggestions.ts`
- Test: `packages/core/test/checkins.test.ts`

**Interfaces:**
- Produces:
  - `CHECKIN = { laptop: { baseMin: 25, timeoutMin: 2 }, book: { baseMin: 15, timeoutMin: 5 }, jitterMin: 5 }`
  - `nextCheckinAt(mode: Mode, from: number, rand?: () => number): number`
  - `resolveUnanswered(mode: Mode, shownAt: number, now: number, idleSec: number): 'wait' | 'pause' | 'ignored'`
  - `SHORT_SUGGESTIONS: string[]`, `LONG_SUGGESTIONS: string[]`, `pickSuggestion(long: boolean, last: string | null, rand?: () => number): string`

- [ ] **Step 1: Write the failing tests**

```ts
test('interval bounds', () => {
  expect(nextCheckinAt('laptop', 0, () => 0)).toBe(20*M);
  expect(nextCheckinAt('laptop', 0, () => 1)).toBe(30*M);
  expect(nextCheckinAt('book', 0, () => 0.5)).toBe(15*M);
});
test('unanswered: wait, then pause if no input since shown, else ignored', () => {
  expect(resolveUnanswered('laptop', 0, 1*M, 60)).toBe('wait');
  expect(resolveUnanswered('laptop', 0, 2*M, 120)).toBe('pause');
  expect(resolveUnanswered('laptop', 0, 2*M, 5)).toBe('ignored');
  expect(resolveUnanswered('book', 0, 4*M, 240)).toBe('wait');
  expect(resolveUnanswered('book', 0, 5*M, 300)).toBe('pause');
});
test('suggestion never repeats back to back', () => {
  for (const s of SHORT_SUGGESTIONS) expect(pickSuggestion(false, s)).not.toBe(s);
  expect(LONG_SUGGESTIONS).toContain('Walk around');
  expect(SHORT_SUGGESTIONS).toEqual(expect.arrayContaining(['Stand up and stretch', 'Drink water', 'Look out a window for 20 s']));
});
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** `nextCheckinAt = from + (base + (rand()*2-1)*jitter) * M`. Status `'pause'` means the pause runs `since = shownAt`. The suggestion lists hold 6–8 items each, and the long list includes `'Walk around'` and `'Eat something'`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): check-in scheduling and break suggestions`

---

### Task 4: Stats

**Files:**
- Create: `packages/core/src/stats.ts`
- Test: `packages/core/test/stats.test.ts`

**Interfaces:**
- Produces:
  - `localDay(ms: number): string` (`YYYY-MM-DD` in local time)
  - `dailyTotals(intervals: [number, number][]): Map<string, number>` (ms per local day)
  - `streak(totals: Map<string, number>, today: string, minMinutes: number): number`
  - `type EventKind = 'slip' | 'bypass' | 'checkin' | 'overrun'`
  - `interface BuddyEvent { at: number; kind: EventKind; target: string | null; detail: string | null }` (checkin `detail` is `'yes' | 'switched' | 'drifted' | 'ignored' | 'pages:<n>'`)
  - `interface SessionRecord { id: number; info: SessionInfo; endedAt: number | null; intervals: [number, number][]; blocksCompleted: number; events: BuddyEvent[] }`
  - `interface Summary { focusMs: number; blocksCompleted: number; slipsByTarget: Record<string, number>; checkins: { yes: number; switched: number; drifted: number; ignored: number; pages: number }; bypasses: BuddyEvent[]; overruns: number; vsAverageMs: number | null }`
  - `summarize(s: SessionRecord, previous: SessionRecord[]): Summary`
  - `REFLECTION_TAGS = ['Phone','Tired','Wandering mind','Distracting site','Hard material','Interrupted']`
  - `topTags(reflections: { at: number; tags: string[] }[], sinceMs: number): { tag: string; count: number }[]` (count desc)

- [ ] **Step 1: Write the failing tests** (TZ is fixed to Asia/Kolkata by the vitest config)

```ts
test('splits an interval at local midnight', () => {
  const s = new Date(2026, 10, 23, 23, 30).getTime(), e = new Date(2026, 10, 24, 0, 45).getTime();
  const t = dailyTotals([[s, e]]);
  expect(t.get('2026-11-23')).toBe(30*M); expect(t.get('2026-11-24')).toBe(45*M);
});
test('streak counts back from today, or from yesterday if today is below min', () => {
  const m = new Map([['2026-11-21', 130*M], ['2026-11-22', 125*M], ['2026-11-23', 30*M]]);
  expect(streak(m, '2026-11-23', 120)).toBe(2);
  m.set('2026-11-23', 120*M); expect(streak(m, '2026-11-23', 120)).toBe(3);
  expect(streak(new Map(), '2026-11-23', 120)).toBe(0);
});
test('summarize groups slips, keeps bypasses apart, compares to average', () => {
  /* events: 2 slips target 'youtube.com', 1 slip 'steam.exe', 1 bypass 'app-closed', checkins yes,yes,drifted,'pages:12','pages:8', 1 overrun;
     previous sessions with 60M and 120M focus; this one 100M →
     slipsByTarget {'youtube.com':2,'steam.exe':1}, bypasses.length 1, checkins {yes:2,switched:0,drifted:1,ignored:0,pages:20}, overruns 1, vsAverageMs 10*M */
  /* with previous = [] → vsAverageMs null */
});
test('topTags', () => { /* counts only reflections at >= sinceMs, sorted desc */ });
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** `dailyTotals` walks each interval and cuts at `new Date(y, m, d + 1)` boundaries.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): stats`

---

### Task 5: Bridge protocol and browser coverage

**Files:**
- Create: `packages/core/src/protocol.ts`, `packages/core/src/coverage.ts`
- Test: `packages/core/test/protocol.test.ts`

**Interfaces:**
- Produces:
  - `BRIDGE_PORT = 47615`
  - `type BrowserKind = 'chrome' | 'edge'`
  - `interface WindowReport { title: string; incognito: boolean; focused: boolean }`
  - `type DesktopToExt = { t: 'helloAck'; ok: boolean } | { t: 'state'; phase: Phase; blocking: boolean; topic: string | null; phaseEndsAt: number | null; sites: Lists; studyVideos: string[] }`
  - `type ExtToDesktop = { t: 'hello'; secret: string; browser: BrowserKind; incognitoAllowed: boolean } | { t: 'windows'; windows: WindowReport[] } | { t: 'slip'; reason: 'youtube-not-study' | 'youtube-timeout' | 'hard-block-visit'; target: string } | { t: 'videoStudy'; videoId: string } | { t: 'startSession'; topic: string; mode: Mode; goal: string | null; plannedMin: number | null } | { t: 'ping' }`
  - `parseExtMessage(raw: string): ExtToDesktop | null`
  - `isBrowserCovered(fg: { exe: string; title: string }, reports: { browser: BrowserKind; windows: WindowReport[] }[]): boolean`

- [ ] **Step 1: Write the failing tests**

```ts
test('parse rejects junk and wrong shapes', () => {
  expect(parseExtMessage('{')).toBeNull();
  expect(parseExtMessage(JSON.stringify({ t: 'slip', reason: 'nope', target: 'x' }))).toBeNull();
  expect(parseExtMessage(JSON.stringify({ t: 'startSession', topic: '', mode: 'book', goal: null, plannedMin: null }))).toBeNull(); // empty topic
  expect(parseExtMessage(JSON.stringify({ t: 'ping' }))).toEqual({ t: 'ping' });
});
const chrome = { browser: 'chrome' as const, windows: [{ title: 'Ch 4 notes', incognito: false, focused: true }] };
test('covered when a connected report has a window whose tab title prefixes the OS title', () => {
  expect(isBrowserCovered({ exe: 'chrome.exe', title: 'Ch 4 notes - Google Chrome' }, [chrome])).toBe(true);
  expect(isBrowserCovered({ exe: 'CHROME.EXE', title: 'Other tab - Google Chrome' }, [chrome])).toBe(false);
  expect(isBrowserCovered({ exe: 'msedge.exe', title: 'Ch 4 notes - Microsoft Edge' }, [chrome])).toBe(false);
  expect(isBrowserCovered({ exe: 'firefox.exe', title: 'anything' }, [chrome])).toBe(false);
  expect(isBrowserCovered({ exe: 'chrome.exe', title: 'x' }, [{ browser: 'chrome', windows: [{ title: '', incognito: false, focused: true }] }])).toBe(false);
});
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Use hand-written type guards with no schema library. Coverage maps `chrome.exe → chrome` and `msedge.exe → edge`. Every other exe is uncovered.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): bridge protocol and browser coverage`

---

### Task 6: Desktop storage

**Files:**
- Create: `packages/desktop/package.json` (deps: `electron`, `sql.js`, `ws`, `get-windows`, `@study-buddy/core`), `packages/desktop/src/main/db.ts`
- Test: `packages/desktop/test/db.test.ts`

**Interfaces:**
- Consumes: `Settings`, `DEFAULT_SETTINGS`, `SessionInfo`, `EngineState`, `BuddyEvent`, `SessionRecord`
- Produces:
  - `openDb(filePath: string): Promise<Db>`. It creates tables if they don't exist and loads the file if it's there. Every write persists by writing `<file>.tmp` then renaming it.
  - `interface Db { getSettings(): Settings; saveSettings(s: Settings): void; getSecret(): string; createSession(info: SessionInfo): number; saveSnapshot(id: number, snap: EngineState, now: number): void; activeSession(now: number): { id: number; snapshot: EngineState; heartbeatAt: number; stale: boolean } | null; finishSession(id: number, snap: EngineState, endedAt: number): void; addEvent(id: number, e: BuddyEvent): void; saveReflection(id: number, r: { at: number; goal: 'yes' | 'partly' | 'no' | null; tags: string[]; note: string | null }): void; sessions(sinceMs: number): SessionRecord[]; reflections(sinceMs: number): { at: number; tags: string[] }[]; intervalsSince(sinceMs: number): [number, number][] }`

- [ ] **Step 1: Write the failing tests** (use a temp dir)

```ts
test('settings default then persist across reopen', async () => { /* getSettings() equals DEFAULT_SETTINGS; save change; reopen same file → change kept */ });
test('secret is 32 hex chars and stable across reopen', async () => {});
test('activeSession reports stale when heartbeat older than 10 min', async () => {
  /* createSession; saveSnapshot(id, snap, 0); activeSession(9*M).stale false; activeSession(11*M).stale true */
});
test('finishSession clears active session and stores intervals for sessions()/intervalsSince()', async () => {});
test('events and reflections round-trip', async () => {});
```

- [ ] **Step 2: Run `npx vitest run -r packages/desktop`.** Expected: FAIL.
- [ ] **Step 3: Implement.** Tables: `settings(k,v)`, `sessions(id, info_json, snapshot_json, heartbeat_at, ended_at, blocks_completed)`, `intervals(session_id, start, end)`, `events(session_id, at, kind, target, detail)`, `reflections(session_id, at, goal, tags_json, note)`. A session is active when `ended_at IS NULL`. Merge saved settings over `DEFAULT_SETTINGS` so new keys get defaults.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(desktop): sql.js storage`

---

### Task 7: Desktop shell. Start screen, mini window, controller, breaks, sleep handling

**Files:**
- Create: `packages/desktop/build.mjs`, `src/shared/ipc.ts`, `src/preload.ts`, `src/main/index.ts`, `src/main/controller.ts`, `src/main/windows.ts`, `src/main/hotkeys.ts`, `src/renderer/{start,mini,break}.{html,ts}`
- Test: `packages/desktop/test/controller.test.ts`

**Interfaces:**
- Consumes: `SessionEngine`, `Db`, `nextCheckinAt`, `pickSuggestion`, `dailyTotals`, `streak`, `localDay`
- Produces:
  - `IPC` channel constants in `src/shared/ipc.ts`: `'session:start' | 'session:end' | 'block:next' | 'block:endEarly' | 'block:extend' | 'blocking:off' | 'checkin:answer' | 'prompt:answer' | 'reflection:save' | 'settings:get' | 'settings:save' | 'history:get' | 'summary:get' | 'sound:mute' | 'state'` (main→renderer broadcast)
  - `interface UiState { phase: Phase; topic: string | null; phaseEndsAt: number | null; pausedSince: number | null; todayMs: number; streakDays: number; blockingActive: boolean; extensionConnected: boolean; suggestion: string | null }`
  - `class SessionController extends EventEmitter { constructor(db: Db, clock: () => number); restore(): 'none' | 'resumed' | 'staleEnded'; start(info): void; tick(): void; nextBlock(): void; endBlockEarly(): void; extend(): void; turnOffBlocking(sentence: string): boolean; pause(since: number): void; resume(): void; end(): number /* sessionId */; logEvent(e: Omit<BuddyEvent,'at'>): void; uiState(): UiState; get engine(): SessionEngine; get sessionId(): number | null }`
  - It emits `'engine'` with each `EngineEvent` and `'ui'` with `UiState` after every change.

- [ ] **Step 1: Write the failing controller tests** with a fake clock and a temp db:

```ts
test('start persists a snapshot; tick emits breakStarted at 45 min with a suggestion in uiState', () => {});
test('restore resumes a fresh active session', () => { /* new controller on same db → 'resumed', phase focus */ });
test('restore ends a stale session at its heartbeat without logging a bypass', () => {
  /* heartbeat at T, restore at T+11M → 'staleEnded'; sessions() shows endedAt = T; no 'bypass' events */
});
test('overrun engine event is logged as an overrun event', () => {});
test('todayMs includes the open focus interval', () => {});
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement `SessionController`.** `tick()` runs every 1 s from `index.ts`, and it saves a snapshot when the phase changes and at least every 15 s, which also serves as the heartbeat. On `breakStarted` it picks a suggestion that isn't the same as the last one.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Build the windows and wiring.**
  - **Single-instance lock**, plus a tray icon (Open, History, Settings, End session). The app opens the start window on launch unless `restore()` returns `'resumed'`.
  - **Start window:** topic (required), Laptop/Book toggle, optional planned hours, and a goal field with placeholder `What does "done" look like?`. The goal field is highlighted when empty but not required. On start, the mini window shows `Phone in another room?` for 10 s.
  - **Mini window:** `alwaysOnTop: true`, frameless, draggable, about 260×120. It shows topic, time left (`mm:ss`, or "Paused"), today's total, streak, and the buttons +10 min, End block, Turn off blocking (opens Task 17's window), End session. It also shows `Browser buddy not connected — websites aren't being watched` when `!extensionConnected`.
  - **Break window:** it shows on `breakStarted` with the suggestion and a countdown, plays a chime, and focuses at `breakOneMinuteLeft`. When the break ends it shows `Back to <topic>?` with a Start button wired to `block:next`.
  - **Sleep:** `powerMonitor.on('suspend')` calls `controller.pause(now)`.
  - **Planned length:** on `plannedLengthReached`, the mini window shows `You hit your planned N h` with End session / Keep going.
  - **Fast mode:** env `BUDDY_FAST=1` sets the rhythm to 1/1/2 min and check-ins to every 1 min with a 20 s timeout. It's for manual checks only.
- [ ] **Step 6: Manual check.** `npm run dev -w desktop` with a temporary rhythm of 1/1/2 min set via env `BUDDY_FAST=1`:
  - Starting a session shows the mini window and the phone reminder.
  - After 1 min the break window appears with a suggestion.
  - The chime plays at the 1-minute warning, then `Back to <topic>?`.
  - Quitting and relaunching mid-block resumes it.
- [ ] **Step 7: Commit** `feat(desktop): shell, controller, mini and break windows`

---

### Task 8: Check-ins and away-pause

**Files:**
- Create: `src/main/checkins.ts` (`CheckinRunner`), `src/renderer/checkin.{html,ts}`
- Modify: `src/main/index.ts`, `src/main/hotkeys.ts`
- Test: `packages/desktop/test/checkins.test.ts`

**Interfaces:**
- Consumes: `SessionController`, `nextCheckinAt`, `resolveUnanswered`
- Produces: `class CheckinRunner { constructor(ctrl: SessionController, ui: { show(c: { mode: Mode; topic: string }): void; hide(): void }, idleSec: () => number, clock: () => number, rand?: () => number); tick(): void; answer(a: 'yes' | 'switched' | 'drifted' | { pages: number }, newTopic?: string): void }`

- [ ] **Step 1: Write the failing tests** with fake clock, idle, and ui:

```ts
test('schedules only during unpaused focus; reschedules from the answer time', () => {});
test('unanswered + no input → pause since shownAt; any input then resumes', () => {
  /* laptop, rand 0 → shown at 20M; idle grows; at 22M → ctrl.pause(20M), checkin event detail 'ignored' not logged;
     later idleSec 0 → ctrl.resume() */
});
test('unanswered but user active → logs checkin detail "ignored", hides, no pause', () => {});
test('drifted logs checkin detail "drifted" and a slip with target "check-in"', () => {});
test('book mode logs pages as "pages:<n>"', () => {});
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement `CheckinRunner`.** Index wiring: `idleSec = () => powerMonitor.getSystemIdleTime()`, and the runner ticks every 1 s. While paused, it resumes when `idleSec() < 2`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Build the check-in window.**
  - **Laptop mode:** a small window in the bottom-right, `focusable: false`, shown with `showInactive()`. Buttons: Yes / Switched topic / Drifted.
  - **Book mode:** larger, with a soft chime, a pages number input and Yes / Drifted. Clicking the input is allowed to focus.
  - **Hotkeys while visible:** `Ctrl+Alt+Y` yes, `Ctrl+Alt+S` switched, `Ctrl+Alt+D` drifted.
  - **"Switched topic"** opens a focused one-line input for the new topic, which updates `session.topic`.
- [ ] **Step 6: Manual check** with `BUDDY_FAST=1` (check-ins every 1 min, timeout 20 s):
  - Typing in Notepad while a check-in shows never loses keystrokes.
  - With hands off, the mini window shows "Paused" and the timer freezes.
  - Touching the mouse resumes it.
- [ ] **Step 7: Commit** `feat(desktop): check-ins and away-pause`

---

### Task 9: Foreground app guard

**Files:**
- Create: `src/main/foreground.ts`, `src/main/appGuard.ts`, `src/renderer/{overlay,prompt}.{html,ts}`
- Test: `packages/desktop/test/appGuard.test.ts`

**Interfaces:**
- Consumes: `classifyApp`, `BROWSER_EXES`, `SessionController`, and (from Task 10) `coverage: (fg) => boolean`
- Produces:
  - `startForegroundPolling(onChange: (fg: { exe: string; title: string; pid: number } | null) => void): () => void` (uses `get-windows` `activeWindow()`, polls every 1 s)
  - `class AppGuard { constructor(ctrl: SessionController, ui: GuardUi, getApps: () => Lists, coverage: (fg: { exe: string; title: string }) => boolean, ownPid: number, clock: () => number); onForeground(fg: { exe: string; title: string; pid: number } | null): void; tick(): void; answerPrompt(exe: string, study: boolean): void; answerOffer(exe: string, choice: 'block' | 'fine' | 'later'): void }`
  - `interface GuardUi { showOverlay(reason: { label: string; until: number | null }): void; hideOverlay(): void; showPrompt(exe: string): void; hidePrompt(): void; showOffer(exe: string): void }`

- [ ] **Step 1: Write the failing tests:**

```ts
test("ignores Study Buddy's own process", () => { /* fg.pid === ownPid → no overlay, no prompt, last real fg kept */ });
test('hard app → overlay with break time while blockingActive; none in break or after bypass', () => {});
test('gray app → prompt once per block; no/30 s timeout → slip + re-ask after 5 min; yes → silent for the block', () => {});
test('unlisted app foreground for 2 min cumulative in a focus block → offer once; "block" adds to apps.hard', () => {});
test('browser uncovered for over 3 s → overlay labelled "Browser without Study Buddy"; covered → no overlay', () => {});
test('fine and unlisted apps never overlay', () => {});
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement `AppGuard`.** Slips use `target = exe`. Browsers (`BROWSER_EXES`) skip list classification and use `coverage` only.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Build the windows.**
  - **Overlay:** a full-screen, transparent-dark, `alwaysOnTop('screen-saver')` window that doesn't steal focus. It reads `Blocked until break at HH:MM` and has a "Back to <topic>" button that just hides it, so the user switches apps.
  - **Prompt:** like the check-in window, it reads `Is this for study?` with Yes/No and hotkeys `Ctrl+Alt+Y`/`Ctrl+Alt+N`.
  - **Offer:** `You've been in <app> for 2 min. Block it during focus?` with Block / It's for study / Not now.
- [ ] **Step 6: Manual check.**
  - Add `notepad.exe` to the hard list via the db, start a session, and focus Notepad: the overlay appears.
  - During the break it doesn't appear.
  - Notepad's text is intact afterwards.
- [ ] **Step 7: Commit** `feat(desktop): foreground app guard`

---

### Task 10: Desktop bridge server

**Files:**
- Create: `src/main/bridge.ts`
- Modify: `src/main/index.ts` (wire coverage into AppGuard, broadcast state, show pairing code in Settings later)
- Test: `packages/desktop/test/bridge.test.ts` (real `ws` client against a server on an ephemeral port)

**Interfaces:**
- Consumes: `parseExtMessage`, `isBrowserCovered`, `DesktopToExt`, `SessionController`
- Produces: `class Bridge extends EventEmitter { constructor(opts: { port: number; secret: string; clock: () => number; isBrowserRunning: (b: BrowserKind) => Promise<boolean> }); listen(): Promise<void>; close(): void; broadcast(s: Extract<DesktopToExt, { t: 'state' }>): void; get connected(): boolean; get incognitoWarning(): boolean; reports(): { browser: BrowserKind; windows: WindowReport[] }[] }`. It emits `'slip'`, `'videoStudy'`, `'startSession'`, and `'bypass'` (`{ target: 'extension-disconnected' }`).

- [ ] **Step 1: Write the failing tests:**

```ts
test('binds 127.0.0.1 only', () => {});
test('wrong secret → helloAck ok:false and socket closed; right secret → ok:true and immediate state', () => {});
test('messages before hello are ignored', () => {});
test('disconnect during focus + browser still running after 10 s → one bypass event; reconnect within 10 s → none', () => {});
test('disconnect when browser process gone → no bypass', () => {});
test('incognitoWarning true when any connected hello had incognitoAllowed false', () => {});
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** `isBrowserRunning` uses `tasklist /FI "IMAGENAME eq chrome.exe" /NH` (or `msedge.exe`) through `execFile`. A connection that has said `hello` is "connected". Its latest `windows` report replaces the previous one. The disconnect bypass check only runs when `ctrl.engine.blockingActive`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Wire it up.**
  - On every controller `'ui'` change, broadcast the `state` (with `studyVideos` kept in the controller for the session).
  - Bridge slips → `ctrl.logEvent({kind:'slip'})`. Bridge bypass → `logEvent({kind:'bypass'})`.
  - `startSession` → `ctrl.start` if the phase is idle.
  - AppGuard coverage: `fg => bridge.connected && isBrowserCovered(fg, bridge.reports())`.
- [ ] **Step 6: Commit** `feat(desktop): localhost bridge`

---

### Task 11: Extension. Connection, blocking, blocked page, offline fallback, pairing

**Files:**
- Create: `packages/extension/{package.json,build.mjs,manifest.json}`, `src/background.ts`, `src/rules.ts`, `src/blocked.{html,ts}`, `src/options.{html,ts}`
- Test: `packages/extension/test/rules.test.ts`

**Interfaces:**
- Consumes: `DesktopToExt`, `ExtToDesktop`, `BRIDGE_PORT`, `Lists`
- Produces:
  - `buildBlockRules(sites: Lists, untilMs: number | null, extId: string): chrome.declarativeNetRequest.Rule[]`
  - `shouldBlockOffline(last: { phase: Phase; blocking: boolean; phaseEndsAt: number | null } | null, now: number): boolean`
  - `chrome.storage.local` keys: `secret`, `lastState`

- [ ] **Step 1: Write the failing tests:**

```ts
test('one redirect rule per hard site + one for youtube shorts, main_frame only', () => {
  const r = buildBlockRules({ fine: [], gray: ['youtube.com'], hard: ['instagram.com', 'x.com'] }, 1700000000000, 'abc');
  expect(r).toHaveLength(3);
  expect(r[0].condition).toMatchObject({ requestDomains: ['instagram.com'], resourceTypes: ['main_frame'] });
  expect(r[0].action.redirect!.extensionPath).toBe('/blocked.html?site=instagram.com&until=1700000000000');
  expect(r[2].condition.regexFilter).toBe('^https?://([a-z0-9-]+\\.)*youtube\\.com/shorts/');
});
test('no shorts rule when youtube is not gray', () => {});
test('offline: blocks only inside a known blocking focus block, until its end', () => {
  expect(shouldBlockOffline({ phase: 'focus', blocking: true, phaseEndsAt: 1000 }, 999)).toBe(true);
  expect(shouldBlockOffline({ phase: 'focus', blocking: true, phaseEndsAt: 1000 }, 1000)).toBe(false);
  expect(shouldBlockOffline({ phase: 'break', blocking: false, phaseEndsAt: 5000 }, 10)).toBe(false);
  expect(shouldBlockOffline(null, 10)).toBe(false);
});
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement `rules.ts`.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Build `background.ts` and the pages.**
  - **Manifest permissions:** `declarativeNetRequest`, `storage`, `tabs`, `alarms`, `sidePanel`, and host `ws://127.0.0.1/*`. Set `"incognito": "spanning"`.
  - **Connection:** connect to `ws://127.0.0.1:47615` with `hello` (browser from `navigator.userAgentData.brands` containing "Microsoft Edge" → `edge`, else `chrome`; `incognitoAllowed` from `chrome.extension.isAllowedIncognitoAccess()`).
  - **Keepalive:** `ping` every 20 s.
  - **Reconnect:** on the `chrome.alarms` 1-minute alarm, plus an immediate retry with backoff of 1, 2, 4… up to 30 s.
  - **On `state`:** save `lastState`, then replace the dynamic rules with `buildBlockRules` when `blocking`, or clear them otherwise.
  - **When disconnected:** apply `shouldBlockOffline(lastState)`, and set an alarm at `phaseEndsAt` that clears the rules.
  - **Window reports:** send `windows` on `tabs.onActivated`, `tabs.onUpdated` (title), `windows.onFocusChanged` and connect. Each report lists the active tab title per window.
  - **Blocked page:** `Blocked until break at HH:MM` (from `until`), the topic from `lastState`, and a "Back" button. On load it sends a `hard-block-visit` slip via `chrome.runtime.sendMessage` → background → bridge.
  - **Options page:** a pairing-code field (saved to `secret`) that shows connected or not. If Incognito isn't allowed, it shows step-by-step text: open `chrome://extensions` (or `edge://extensions`) → Details → "Allow in Incognito", with a Re-check button.
- [ ] **Step 6: Manual check.**
  - Load `packages/extension/dist` unpacked in Chrome and pair using the code from the desktop Settings. (Until Task 15, temporarily log the secret to the console.)
  - Start a session: instagram.com shows the blocked page, and khanacademy.org and claude.ai load.
  - In a break, instagram.com loads.
  - Quit the desktop app mid-block: blocking continues until the block's end, then stops.
- [ ] **Step 7: Commit** `feat(extension): connection, blocking, pairing`

---

### Task 12: Extension. YouTube rules

**Files:**
- Create: `src/youtubeLogic.ts`, `src/youtube.ts`
- Modify: `manifest.json` (content script on `*://*.youtube.com/*`, `run_at: document_start`), `src/background.ts` (relay `videoStudy` and slips; send `studyVideos` to tabs)
- Test: `packages/extension/test/youtubeLogic.test.ts` (jsdom)

**Interfaces:**
- Produces:
  - `videoIdOf(url: string): string | null` (`watch?v=` only)
  - `isShorts(url: string): boolean`
  - `HIDE_CSS: string` (hides `ytd-browse[page-subtype="home"] #contents`, `#related`, `#secondary ytd-watch-next-secondary-results-renderer`, `.ytp-endscreen-content`, `.ytp-ce-element`, `ytd-reel-shelf-renderer`, `ytd-rich-shelf-renderer[is-shorts]`)
  - `class StudyPrompt { constructor(clock: () => number); onVideo(id: string | null, studyVideos: string[]): 'show' | 'none'; answer(study: boolean): { slip: 'youtube-not-study' } | { study: string } ; tick(): 'timeout' | 'reask' | null }` (30 s timeout → slip `youtube-timeout`; 5 min after a no/timeout on the same video → `'reask'`)

- [ ] **Step 1: Write the failing tests:**

```ts
test('ids and shorts', () => {
  expect(videoIdOf('https://www.youtube.com/watch?v=abc123&t=4')).toBe('abc123');
  expect(videoIdOf('https://www.youtube.com/results?search_query=x')).toBeNull();
  expect(isShorts('https://www.youtube.com/shorts/xyz')).toBe(true);
});
test('prompt: once per video; yes silences; no → slip and reask after 5 min; timeout at 30 s', () => {});
test('already-studied video (from desktop list) never prompts', () => {});
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Wire `youtube.ts`.**
  - Inject `HIDE_CSS` only while `blocking` (the state comes from the background via messages).
  - Listen to `yt-navigate-finish` and `popstate` to handle in-app navigation. If `isShorts(location.href)` during blocking, navigate to `/` and send a `hard-block-visit` slip with target `youtube.com/shorts`. This catches the SPA navigation that DNR can't see.
  - **Prompt:** a small in-page card (shadow DOM) reading `Is this for study?` with Yes/No. The video keeps playing.
- [ ] **Step 6: Manual check.**
  - During focus, the YouTube home feed is empty and search works.
  - Opening a video prompts. Yes, then reloading, doesn't prompt again.
  - Clicking a Short from search lands on the home page.
  - No answer for 30 s logs a slip, which shows in the desktop summary later.
- [ ] **Step 7: Commit** `feat(extension): youtube rules`

---

### Task 13: Extension side panel

**Files:**
- Create: `src/sidepanel.{html,ts}`
- Modify: `manifest.json` (`side_panel.default_path`), `src/background.ts` (forward `state` to the panel; accept `startSession` from it)

- [ ] **Step 1: Build the panel.**
  - **Desktop connected:** it shows the same info as the mini window (topic, time left, today, streak), using fields added to the `state` message: extend `DesktopToExt` state with `todayMs: number; streakDays: number`, and update the Task 5 parser test.
  - **Desktop disconnected:** it shows `Desktop buddy not running`.
  - **Idle:** it shows the start form (topic, mode, goal, planned hours) that sends `startSession`.
- [ ] **Step 2: Run the core tests after the protocol change.** Expected: PASS.
- [ ] **Step 3: Manual check.** Starting from the side panel starts the desktop session and the mini window appears.
- [ ] **Step 4: Commit** `feat(extension): side panel`

---

### Task 14: Reflection, summary and history

**Files:**
- Create: `src/renderer/{reflection,summary,history}.{html,ts}`
- Modify: `src/main/index.ts` (`session:end` → reflection → summary; IPC handlers `summary:get`, `history:get`, `reflection:save`)
- Test: `packages/desktop/test/history.test.ts`

**Interfaces:**
- Consumes: `summarize`, `dailyTotals`, `topTags`, `REFLECTION_TAGS`, `Db`
- Produces: `buildHistory(db: Db, now: number): { days: { day: string; ms: number }[] /* 30 entries, oldest first, zero-filled */; tags: { tag: string; count: number }[] }`

- [ ] **Step 1: Write the failing test.** `buildHistory` returns exactly 30 days ending today, zero-filled, with tags only from the last 30 days.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement `buildHistory`.**
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Build the windows.**
  - **Reflection:** `Did you reach your goal?` with Yes/Partly/No (hidden if no goal was set). `What got in the way?` uses toggle chips for `REFLECTION_TAGS` plus an optional note. Save, or a single "Skip" link.
  - **Summary:** total focus, blocks, slips by target, check-in counts (pages if book mode), overruns, a separate "Bypasses" list, and `+/- N min vs your average` (hidden when null).
  - **History:** 30 simple bars with a minutes label, the streak, and "What gets in the way most" (top tags).
- [ ] **Step 6: Manual check.** End a fast session that has a slip and a bypass. The reflection then summary appear, and the bypass is listed separately.
- [ ] **Step 7: Commit** `feat(desktop): reflection, summary, history`

---

### Task 15: Settings window

**Files:**
- Create: `src/renderer/settings.{html,ts}`
- Modify: `src/main/index.ts` (`settings:get`/`settings:save` → db, broadcast new lists to the bridge)

- [ ] **Step 1: Build it.**
  - Editable site lists (fine/gray/hard) and app lists (one entry per line, lowercased and trimmed on save).
  - The rhythm, applied from the next session (four number fields).
  - The streak minimum in minutes.
  - The extension pairing code with a Copy button.
  - Default sound (Task 16 controls).
  - Validate: rhythm minutes are integers 1–180, `longBreakEvery` is 1–10, and empty list lines are dropped.
  - **First launch** (no `settings` rows yet): open Settings at the pairing section, with the Incognito walkthrough text (the same steps as the extension options page).
- [ ] **Step 2: Manual check.** Adding `wikipedia.org` to hard during focus blocks it within a second, without a session restart. Deleting userData and relaunching opens Settings at the pairing code.
- [ ] **Step 3: Commit** `feat(desktop): settings`

---

### Task 16: Focus sounds

**Files:**
- Create: `src/renderer/audio.ts`, `assets/sounds/{rain.ogg,cafe.ogg,CREDITS.md}`
- Modify: `src/renderer/mini.{html,ts}` (a sound popover), `src/main/hotkeys.ts` (`Ctrl+Alt+M` → `sound:mute`), `src/main/index.ts` (persist the choice to `settings.sound`)
- Test: `packages/desktop/test/audio.test.ts` (pure helpers)

**Interfaces:**
- Produces:
  - `FREQ_PRESETS: { label: string; choice: FreqChoice }[]`: `Gamma focus (40 Hz)` binaural 40/200, `Calm focus (10 Hz)` binaural 10/200, `Alert (16 Hz)` binaural 16/200, the same three as isochronic, `432 Hz tone`, `528 Hz tone`
  - `oscillatorPlan(f: FreqChoice): { left: number | null; right: number | null; mono: number | null; pulseHz: number | null }`
  - `class SoundEngine { constructor(ctx: AudioContext); play(c: SoundChoice): void; fadeOut(ms?: number): void; fadeIn(ms?: number): void; setMuted(m: boolean): void }`

- [ ] **Step 1: Write the failing tests:**

```ts
test('binaural splits carrier ± beat across ears', () =>
  expect(oscillatorPlan({ kind: 'binaural', beatHz: 40, carrierHz: 200 })).toEqual({ left: 200, right: 240, mono: null, pulseHz: null }));
test('isochronic pulses a mono carrier', () =>
  expect(oscillatorPlan({ kind: 'isochronic', beatHz: 10, carrierHz: 200 })).toEqual({ left: null, right: null, mono: 200, pulseHz: 10 }));
test('pure tone', () => expect(oscillatorPlan({ kind: 'pure', hz: 432 })).toEqual({ left: null, right: null, mono: 432, pulseHz: null }));
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Brown noise:** generated (an integrated white-noise buffer, looped).
  - **Rain and café:** looped `<audio>` files routed into the graph.
  - **Binaural:** a `ChannelMergerNode`.
  - **Isochronic:** carrier gain driven by an `OscillatorNode` square wave through a `GainNode` with offset.
  - **Volumes:** separate ambient and frequency gains.
  - **Fades:** 2 s fade-out on `breakStarted`/`sessionEnded`, fade-in on `focusStarted`.
  - **Audio host:** the audio runs in the mini window renderer, which lives for the whole session.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Add the audio files.** Put two CC0-licensed loops (rain, café, each under 2 MB, ogg) in `assets/sounds/`, with source URL and license in `CREDITS.md`. If none can be confirmed CC0, ship without them, hide those two options, and note it in CREDITS.md.
- [ ] **Step 6: Build the popover UI.** Ambient select + volume, frequency preset select + volume, and the note `Binaural beats need headphones. Research on them is mixed — use what helps you.` The last choice auto-plays at the next session start.
- [ ] **Step 7: Manual check.**
  - With headphones, 40 Hz binaural is audible as a beat.
  - Sound fades at the break and returns on the next block.
  - `Ctrl+Alt+M` mutes it from any app.
- [ ] **Step 8: Commit** `feat(desktop): focus sounds`

---

### Task 17: Bypass sentence and watchdog

**Files:**
- Create: `src/renderer/bypass.{html,ts}`, `src/main/watchdog.ts`, `src/watchdog/run.ts`
- Modify: `src/main/index.ts`, `src/main/controller.ts` (`restore()` logs `bypass` `app-closed` when launched with `--restored-by-watchdog`)
- Test: `packages/desktop/test/watchdog.test.ts`

**Interfaces:**
- Produces:
  - `startWatchdog(opts: { appPid: number; exePath: string; args: string[]; flagFile: string }): void` (spawns `process.execPath src/watchdog/run.js` with `ELECTRON_RUN_AS_NODE=1`, `detached: true`, `stdio: 'ignore'`, then `unref()`)
  - `stopWatchdog(flagFile: string): void` (deletes the flag; the watchdog exits when the flag is gone)
  - `watchdogStep(s: { appAlive: boolean; flagExists: boolean }): 'continue' | 'relaunch' | 'exit'` (pure, used by `run.ts` every 3 s)

- [ ] **Step 1: Write the failing tests:**

```ts
test('watchdogStep', () => {
  expect(watchdogStep({ appAlive: true, flagExists: true })).toBe('continue');
  expect(watchdogStep({ appAlive: false, flagExists: true })).toBe('relaunch');
  expect(watchdogStep({ appAlive: true, flagExists: false })).toBe('exit');
  expect(watchdogStep({ appAlive: false, flagExists: false })).toBe('exit');
});
test('restore with --restored-by-watchdog logs one app-closed bypass', () => {});
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The flag file lives at `<userData>/session-active.flag`. It's written at session start and deleted in `end()` and on a stale restore.
  - On `relaunch`, `run.ts` spawns `exePath ...args --restored-by-watchdog` detached and exits. The new app starts a new watchdog.
  - **Bypass window:** opened from "Turn off blocking". It shows the sentence to type, a text field (paste disabled), and Confirm. Confirm calls `ctrl.turnOffBlocking`. On true, it logs `bypass` target `blocking-turned-off` and closes. On false, it shakes.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Manual check.**
  - Kill `electron.exe` in Task Manager mid-session: it reappears within about 5 s on the same block, and the summary later lists "App closed".
  - Ending the session normally, then quitting: it doesn't come back.
  - Typing the sentence wrong fails. Typing it right lets instagram.com load until the next break.
- [ ] **Step 6: Commit** `feat(desktop): bypass sentence and watchdog`

---

### Task 18: End-to-end verification

- [ ] **Step 1: Run `npm test` at the root.** Expected: every package PASS.
- [ ] **Step 2: Do a full fast-mode session** (`BUDDY_FAST=1`) with Chrome paired, and walk the spec's behaviour list in order. Expected:
  - Start → phone reminder.
  - Hard site blocked, Claude/NotebookLM untouched.
  - YouTube feed hidden and the prompt works.
  - Check-in without focus steal.
  - Hands off → pause.
  - Break with suggestion → 1-min warning → overrun logged.
  - Firefox (or a second Chrome profile) foreground → overlay.
  - Incognito without permission → overlay.
  - Disabling the extension → overlay + bypass.
  - Killing the app → it relaunches.
  - Ending → reflection → summary with bypasses listed separately → history shows today.
- [ ] **Step 3: Commit** any fixes: `chore: end-to-end fixes`

---

## Addendum tasks (2026-11-25, from spec addendum)

### Task 19: Animal companion

**Files:**
- Create: `packages/core/src/animals.ts` (`ANIMALS`, `Animal`, `Mood`, `moodFor`), `packages/desktop/src/renderer/buddy/{draw.ts,buddy.css}` (SVG builder + animations)
- Modify: core `settings.ts` (`animal: Animal`, default `'cat'`), desktop `settingsValidate.ts`, settings window (picker with previews), mini/break/start/summary renderers, overlay; protocol state gains `animal`
- Test: `packages/core/test/animals.test.ts`, `packages/desktop/test/buddyDraw.test.ts` (jsdom)

**Interfaces:**
- `type Animal = 'cat'|'fox'|'panda'|'bunny'|'penguin'|'hamster'`; `ANIMALS: { id: Animal; label: string }[]`
- `type Mood = 'wave'|'study'|'break'|'alert'|'sleep'|'sad'|'celebrate'`
- `moodFor(s: { phase: Phase; paused: boolean; recentSlipAt: number | null; celebrating: boolean }, now: number): Mood` — sad for 3 s after a slip; celebrate wins; sleep when paused; alert in awaitingNext; etc.
- `drawBuddy(animal: Animal, mood: Mood, size: number): SVGSVGElement` — built with DOM APIs only, no innerHTML; every animal × mood produces a valid SVG with a `data-mood` attribute.

- [ ] Tests first for `moodFor` (each table row in the spec addendum) and `drawBuddy` (6×7 combinations render, distinct per animal, `prefers-reduced-motion` class switch).
- [ ] Implement; wire into windows; settings picker saves `animal`; mini window gets `recentSlipAt` via a new `buddy:slip` broadcast when a slip event is logged.
- [ ] Manual check via CDP: each mood visible in screenshots; picker changes the animal live.
- [ ] Commit `feat: animal companion`

### Task 20: Pastel theme

**Files:** Modify `packages/desktop/src/renderer/common.css` (+ every window's CSS that hard-codes colors), extension `blocked`, `sidepanel`, `options` pages and the YouTube card styles; add a shared token block.

- [ ] Define tokens (light + dark), replace hard-coded colors; check text contrast ≥ 4.5:1 with a small test that parses the token file and computes contrast for text/background pairs.
- [ ] Extension pages show the chosen animal (blocked page: `sad` mood; side panel: mood from state).
- [ ] Manual check via CDP screenshots of every window in light and dark.
- [ ] Commit `feat: pastel theme`

import { app, powerMonitor } from 'electron';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { BRIDGE_PORT, DEFAULT_SETTINGS, isBrowserCovered, type BrowserKind, type EngineEvent, type Lists } from '@study-buddy/core';
import { Bridge } from './bridge';
import { openDb } from './db';
import { SessionController, type UiState } from './controller';
import { autostartTopic, dataDirOverride, debug, fastMode, rhythmOverride } from './config';
import { CheckinRunner, FAST_CHECKIN_CONFIG } from './checkins';
import { createCheckinUi } from './checkinUi';
import { AppGuard, type GuardUi } from './appGuard';
import { createGuardUi } from './appGuardUi';
import { startForegroundPolling, type ForegroundWindow } from './foreground';
import { broadcast, closeWindow, showWindow } from './windows';
import { breakWindowAction } from './breakFlow';
import { registerIpc } from './ipc';
import { createTray } from './tray';
import { unbindAllHotkeys } from './hotkeys';
import { IPC } from '../shared/ipc';

const PHONE_REMINDER = { phone: '1' };
const IMAGE_NAME: Record<BrowserKind, string> = { chrome: 'chrome.exe', edge: 'msedge.exe' };
/** True if a process with the browser's image name is running. Any error counts as not running. */
const isBrowserRunning = (kind: BrowserKind): Promise<boolean> =>
  new Promise((resolve) => {
    execFile('tasklist', ['/FI', `IMAGENAME eq ${IMAGE_NAME[kind]}`, '/NH'], { windowsHide: true }, (err, stdout) => {
      resolve(!err && stdout.toLowerCase().includes(IMAGE_NAME[kind]));
    });
  });
const log = (...a: unknown[]) => { if (debug) console.log(`[buddy ${new Date().toISOString().slice(11, 19)}]`, ...a); };

// `electron dist/main.js` has no app package.json, so name the app and its data folder explicitly.
app.setName('Study Buddy');
app.setPath('userData', dataDirOverride ?? join(app.getPath('appData'), 'Study Buddy'));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void main().catch((err) => {
    console.error('[buddy] startup failed', err);
    app.exit(1);
  });
}

async function main(): Promise<void> {
  await app.whenReady();
  app.setAppUserModelId('study.buddy');
  const db = await openDb(join(app.getPath('userData'), 'study-buddy.sqlite'));
  const ctrl = new SessionController(db, Date.now, { rhythm: rhythmOverride });
  if (fastMode) console.log('[buddy] fast mode: 3/1/2 min rhythm');

  /** Mini window query: phone reminder on a fresh start, planned length for the prompt. */
  const miniQuery = (fresh: boolean): Record<string, string> => {
    const planned = ctrl.engine.state.session?.plannedMin;
    return { ...(fresh ? PHONE_REMINDER : {}), ...(planned ? { planned: String(planned) } : {}) };
  };

  const showSessionWindows = (fresh: boolean) => {
    closeWindow('start');
    showWindow('mini', { query: miniQuery(fresh) });
    const phase = ctrl.engine.state.phase;
    if (phase === 'break' || phase === 'awaitingNext') showWindow('break');
  };

  const endSession = () => {
    const id = ctrl.end();
    log('session ended', id);
    closeWindow('mini');
    closeWindow('break');
    tray.refresh();
    // Task 14 replaces this with the reflection → summary flow.
    showWindow('start');
  };

  const checkinUi = createCheckinUi((a) => checkins.answer(a));
  const checkins = new CheckinRunner(
    ctrl,
    {
      show: (c) => { log('check-in shown', c.mode); checkinUi.show(c); },
      hide: () => { log('check-in hidden'); checkinUi.hide(); },
    },
    () => powerMonitor.getSystemIdleTime(),
    Date.now,
    Math.random,
    fastMode ? FAST_CHECKIN_CONFIG : undefined,
  );

  // App guard: foreground app → overlay / gray prompt / unlisted offer while blocking is active.
  let lastFg: ForegroundWindow | null = null;
  const guardUi = createGuardUi({
    foreground: () => lastFg,
    topic: () => ctrl.engine.state.session?.topic ?? null,
    answerPrompt: (exe, study) => guard.answerPrompt(exe, study),
  });
  const loggedGuardUi: GuardUi = {
    showOverlay: (r) => { log('overlay shown', JSON.stringify(r)); guardUi.showOverlay(r); },
    hideOverlay: () => { log('overlay hidden'); guardUi.hideOverlay(); },
    showPrompt: (exe) => { log('prompt shown', exe); guardUi.showPrompt(exe); },
    hidePrompt: () => { log('prompt hidden'); guardUi.hidePrompt(); },
    showOffer: (exe) => { log('offer shown', exe); guardUi.showOffer(exe); },
  };
  const getApps = (): Lists => {
    try { return db.getSettings().apps; } catch (err) {
      console.error('[buddy] getSettings failed', err);
      return DEFAULT_SETTINGS.apps;
    }
  };
  /** Our main process or any of our child processes (renderers, GPU, ...). */
  const isOwnPid = (pid: number): boolean =>
    pid === process.pid || app.getAppMetrics().some((m) => m.pid === pid);
  let bridge: Bridge | null = null;
  const guard = new AppGuard(
    ctrl,
    loggedGuardUi,
    getApps,
    (fg) => bridge !== null && bridge.connected && isBrowserCovered(fg, bridge.reports()),
    isOwnPid,
    Date.now,
    (fn) => {
      const s = db.getSettings();
      db.saveSettings({ ...s, apps: fn(s.apps) });
      log('apps updated', JSON.stringify(db.getSettings().apps.hard));
    },
  );
  startForegroundPolling((fg) => {
    const own = fg !== null && isOwnPid(fg.pid);
    if (fg && !own) lastFg = fg;
    log('foreground', fg ? `${fg.exe} pid=${fg.pid}${own ? ' (ours)' : ` → ${guard.classify(fg.exe)}`}` : 'none');
    try { guard.onForeground(fg); } catch (err) { console.error('[buddy] guard failed', err); }
  });

  const tray = createTray({
    open: () => (ctrl.sessionId !== null ? showSessionWindows(false) : showWindow('start')),
    history: () => showWindow('history', { focus: true }),
    settings: () => showWindow('settings', { focus: true }),
    endSession: () => { if (ctrl.sessionId !== null) endSession(); },
    quit: () => app.quit(),
    sessionActive: () => ctrl.sessionId !== null,
  });

  let lastPhase: string | null = null;
  ctrl.on('ui', (ui: UiState) => {
    broadcast(IPC.state, ui);
    if (ui.phase !== lastPhase) {
      log('phase', lastPhase, '→', ui.phase, ui.suggestion ? `(${ui.suggestion})` : '');
      lastPhase = ui.phase;
    }
  });
  ctrl.on('engine', (e: EngineEvent) => {
    log('engine', JSON.stringify(e));
    broadcast(IPC.engine, e);
    onEngineEvent(e);
  });

  function onEngineEvent(e: EngineEvent): void {
    const action = breakWindowAction(e);
    if (action === 'show') showWindow('break');
    else if (action === 'showFocused') showWindow('break', { focus: true });
    else if (action === 'close') closeWindow('break');
    if (e.type === 'plannedLengthReached') showWindow('mini');
  }

  registerIpc({
    ctrl,
    db,
    onStarted: () => {
      log('session started', ctrl.sessionId, ctrl.engine.state.session?.topic);
      showSessionWindows(true);
      tray.refresh();
    },
    endSession,
    onCheckinAnswer: (a, topic) => { log('check-in answer', JSON.stringify(a)); checkins.answer(a, topic); },
    focusCheckin: (id) => checkinUi.focus(id),
    onPromptAnswer: (exe, study) => { log('prompt answer', exe, study); guard.answerPrompt(exe, study); },
    onOfferAnswer: (exe, choice) => {
      log('offer answer', exe, choice);
      guardUi.hideOffer();
      guard.answerOffer(exe, choice);
    },
    dismissOverlay: () => { log('overlay dismissed'); guard.dismissOverlay(); },
  });

  app.on('second-instance', () => (ctrl.sessionId !== null ? showSessionWindows(false) : showWindow('start')));
  // Tray app: closing every window must not quit.
  app.on('window-all-closed', () => {});
  app.on('will-quit', () => unbindAllHotkeys());

  powerMonitor.on('suspend', () => {
    log('suspend → pause');
    ctrl.pause(Date.now());
  });

  const broadcastState = (ui: UiState = ctrl.uiState()) => {
    if (!bridge) return;
    let sites = DEFAULT_SETTINGS.sites;
    try { sites = db.getSettings().sites; } catch (err) { console.error('[buddy] getSettings failed', err); }
    bridge.broadcast({
      t: 'state',
      phase: ui.phase,
      blocking: ctrl.engine.blockingActive,
      topic: ui.topic,
      phaseEndsAt: ui.phaseEndsAt,
      sites,
      studyVideos: ctrl.studyVideos(),
      todayMs: ui.todayMs,
      streakDays: ui.streakDays,
    });
  };
  ctrl.on('ui', broadcastState);

  const b = new Bridge({
    port: BRIDGE_PORT,
    secret: db.getSecret(),
    clock: Date.now,
    isBrowserRunning,
    isBlocking: () => ctrl.sessionId !== null && ctrl.engine.blockingActive,
  });
  b.on('connection', () => ctrl.setExtensionConnected(b.connected));
  b.on('slip', (e: { reason: string; target: string }) => {
    log('slip', e.reason, e.target);
    ctrl.logEvent({ kind: 'slip', target: e.target, detail: e.reason });
  });
  b.on('bypass', (e: { target: string }) => {
    log('bypass', e.target);
    ctrl.logEvent({ kind: 'bypass', target: e.target, detail: null });
  });
  b.on('videoStudy', (id: string) => { ctrl.addStudyVideo(id); broadcastState(); });
  b.on('startSession', (m: { topic: string; mode: 'laptop' | 'book'; goal: string | null; plannedMin: number | null }) => {
    if (ctrl.sessionId !== null) return;
    const topic = m.topic.trim();
    if (!topic) return;
    ctrl.start({ topic, mode: m.mode, goal: m.goal, plannedMin: m.plannedMin });
    log('session started via extension', topic);
    showSessionWindows(true);
    tray.refresh();
  });
  try {
    await b.listen();
    bridge = b;
    broadcastState();
    log('bridge listening on 127.0.0.1:' + b.port);
  } catch (err) {
    console.error(`[buddy] bridge could not listen on 127.0.0.1:${BRIDGE_PORT} (port in use?); continuing without the browser extension`, err);
  }
  app.on('will-quit', () => b.close());

  const restored = ctrl.restore();
  log('restore →', restored);
  if (restored === 'resumed') {
    showSessionWindows(false);
  } else if (autostartTopic) {
    ctrl.start({ topic: autostartTopic, mode: 'laptop', goal: null, plannedMin: null });
    log('autostart', autostartTopic);
    showSessionWindows(true);
  } else {
    showWindow('start');
  }
  tray.refresh();

  setInterval(() => {
    try { ctrl.tick(); } catch (err) { console.error('[buddy] tick failed', err); }
    try { checkins.tick(); } catch (err) { console.error('[buddy] check-in tick failed', err); }
    try { guard.tick(); } catch (err) { console.error('[buddy] guard tick failed', err); }
  }, 1000);
  console.log('[buddy] ready');
}

import { app, powerMonitor } from 'electron';
import { join } from 'node:path';
import type { EngineEvent } from '@study-buddy/core';
import { openDb } from './db';
import { SessionController, type UiState } from './controller';
import { autostartTopic, dataDirOverride, debug, fastMode, rhythmOverride } from './config';
import { broadcast, closeWindow, showWindow } from './windows';
import { breakWindowAction } from './breakFlow';
import { registerIpc } from './ipc';
import { createTray } from './tray';
import { unbindAllHotkeys } from './hotkeys';
import { IPC } from '../shared/ipc';

const PHONE_REMINDER = { phone: '1' };
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
  if (fastMode) console.log('[buddy] fast mode: 1/1/2 min rhythm');

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
  });

  app.on('second-instance', () => (ctrl.sessionId !== null ? showSessionWindows(false) : showWindow('start')));
  // Tray app: closing every window must not quit.
  app.on('window-all-closed', () => {});
  app.on('will-quit', () => unbindAllHotkeys());

  powerMonitor.on('suspend', () => {
    log('suspend → pause');
    ctrl.pause(Date.now());
  });

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
  }, 1000);
  console.log('[buddy] ready');
}

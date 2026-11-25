import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import type { Db } from './db';
import type { SessionController } from './controller';
import { closeBySender, showWindow } from './windows';
import { parseCheckinAnswer } from './checkins';
import { parseOfferAnswer, parsePromptAnswer } from './appGuard';
import { summarize } from '@study-buddy/core';
import { buildHistory } from './history';
import { parseReflection } from './reflection';
import { parseSettings, parseSound } from './settingsValidate';
import { parseStart } from './startRequest';

export { parseStart };
import { IPC, type HistoryView, type OfferAnswerMsg, type SettingsSaveResult, type SummaryView, type WindowName } from '../shared/ipc';

const DAY_MS = 86_400_000;

export interface IpcDeps {
  ctrl: SessionController;
  db: Db;
  /** Called after a session started from the start window. */
  onStarted(): void;
  /** Runs the whole end-of-session flow (controller.end + windows). */
  endSession(): void;
  /** Check-in answer (already validated). */
  onCheckinAnswer(a: 'yes' | 'switched' | 'drifted' | { pages: number }, topic?: string): void;
  /** Make the check-in window focusable and focus it (for typing). */
  focusCheckin(senderId: number): void;
  /** Gray-app prompt answer (already validated). */
  onPromptAnswer(exe: string, study: boolean): void;
  /** Unlisted-app offer answer (already validated). */
  onOfferAnswer(exe: string, choice: OfferAnswerMsg['choice']): void;
  /** Called after validated settings were saved (rebroadcast lists to the bridge). */
  onSettingsSaved(): void;
  /** The bypass sentence was accepted (already logged by the controller): close its window, rebroadcast. */
  onBlockingOff(): void;
  /** The overlay's button: hide the overlay. */
  dismissOverlay(): void;
  /** Focus-sound mute flag (not persisted); toggle also broadcasts it. */
  isMuted(): boolean;
  toggleMute(): void;
  /** Settings → "Reset pet position". */
  resetPetPosition(): void;
}

/** Windows a renderer may open by name. */
const OPENABLE: readonly WindowName[] = ['start', 'bypass', 'history', 'settings'];

const fromUs = (e: IpcMainEvent | IpcMainInvokeEvent): boolean => (e.senderFrame?.url ?? '').startsWith('file:');

function on(channel: string, fn: (payload: unknown, e: IpcMainEvent) => void): void {
  ipcMain.on(channel, (e, payload: unknown) => {
    if (!fromUs(e)) return;
    try { fn(payload, e); } catch (err) { console.error(`[ipc] ${channel} failed`, err); }
  });
}

function handle(channel: string, fn: (payload: unknown) => unknown): void {
  ipcMain.handle(channel, (e, payload: unknown) => {
    if (!fromUs(e)) throw new Error('Rejected sender');
    return fn(payload);
  });
}

export function registerIpc(deps: IpcDeps): void {
  const { ctrl, db, onStarted, endSession, onCheckinAnswer, focusCheckin } = deps;
  handle(IPC.state, () => ctrl.uiState());
  handle(IPC.settingsGet, () => db.getSettings());
  handle(IPC.settingsSecret, () => db.getSecret());
  handle(IPC.settingsSave, (p): SettingsSaveResult => {
    const r = parseSettings(p, db.getSettings());
    if ('error' in r) return { ok: false, error: r.error };
    db.saveSettings(r);
    deps.onSettingsSaved();
    return { ok: true, settings: r };
  });
  handle(IPC.soundMute, () => deps.isMuted());
  handle(IPC.soundSave, (p): SettingsSaveResult => {
    const sound = parseSound(p);
    if ('error' in sound) return { ok: false, error: sound.error };
    const next = { ...db.getSettings(), sound };
    db.saveSettings(next);
    return { ok: true, settings: next };
  });
  handle(IPC.sessionStart, (p) => {
    const req = parseStart(p);
    if (!req) return { ok: false, error: 'Please enter a topic.' };
    ctrl.start(req);
    onStarted();
    return { ok: true };
  });
  handle(IPC.blockingOff, (p) => {
    if (typeof p !== 'string' || p.length > 200 || ctrl.sessionId === null || !ctrl.engine.blockingActive) return false;
    const ok = ctrl.turnOffBlocking(p);
    if (ok) deps.onBlockingOff();
    return ok;
  });

  const finishedSession = (id: unknown) =>
    typeof id === 'number' && Number.isInteger(id) ? db.sessions(0).find((s) => s.id === id) : undefined;

  handle(IPC.summaryGet, (p): SummaryView | null => {
    const record = finishedSession(p);
    if (!record) return null;
    const since = Date.now() - 30 * DAY_MS;
    const previous = db.sessions(since).filter((s) => s.id !== record.id);
    return { topic: record.info.topic, mode: record.info.mode, goal: record.info.goal, summary: summarize(record, previous) };
  });
  handle(IPC.historyGet, (): HistoryView => buildHistory(db, Date.now(), ctrl.liveIntervals()));
  handle(IPC.reflectionSave, (p) => {
    const r = parseReflection(p);
    if (!r) return { ok: false };
    const record = finishedSession(r.sessionId);
    if (!record || db.hasReflection(r.sessionId)) return { ok: false };
    if (r.goal !== null && !record.info.goal) return { ok: false };
    db.saveReflection(r.sessionId, { at: Date.now(), goal: r.goal, tags: r.tags, note: r.note });
    return { ok: true };
  });

  on(IPC.sessionEnd, () => { if (ctrl.sessionId !== null) endSession(); });
  on(IPC.sessionResume, () => ctrl.resume());
  on(IPC.blockNext, () => ctrl.nextBlock());
  on(IPC.blockEndEarly, () => ctrl.endBlockEarly());
  on(IPC.blockExtend, () => ctrl.extend());
  on(IPC.checkinAnswer, (p) => {
    const r = parseCheckinAnswer(p);
    if (r) onCheckinAnswer(r.a, r.topic);
  });
  on(IPC.checkinFocus, (_p, e) => focusCheckin(e.sender.id));
  on(IPC.promptAnswer, (p) => {
    const r = parsePromptAnswer(p);
    if (r) deps.onPromptAnswer(r.exe, r.study);
  });
  on(IPC.offerAnswer, (p) => {
    const r = parseOfferAnswer(p);
    if (r) deps.onOfferAnswer(r.exe, r.choice);
  });
  on(IPC.soundMute, () => deps.toggleMute());
  on(IPC.petResetPos, () => deps.resetPetPosition());
  on(IPC.overlayDismiss, () => deps.dismissOverlay());
  on(IPC.windowOpen, (p) => {
    if (typeof p === 'string' && (OPENABLE as readonly string[]).includes(p)) showWindow(p as WindowName, { focus: true });
  });
  on(IPC.windowClose, (_p, e) => closeBySender(e.sender.id));
}

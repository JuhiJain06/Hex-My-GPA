import type { Animal, EngineEvent, Mode, Phase, Summary } from '@study-buddy/core';

/**
 * Every IPC channel the renderers may use. The preload refuses anything not listed here.
 * Direction: R→M `send`/`invoke` unless marked "M→R" (broadcast from main, received with `on`).
 */
export const IPC = {
  sessionStart: 'session:start',
  sessionEnd: 'session:end',
  sessionResume: 'session:resume',
  blockNext: 'block:next',
  blockEndEarly: 'block:endEarly',
  blockExtend: 'block:extend',
  blockingOff: 'blocking:off',
  checkinAnswer: 'checkin:answer',
  /** R→M: the check-in window asks to become focusable so a text input can take keys. */
  checkinFocus: 'checkin:focus',
  /** M→R: Ctrl+Alt+S pressed; the check-in window should open its new-topic input. */
  checkinSwitch: 'checkin:switch',
  /** R→M: answer to the gray-app "Is this for study?" prompt ({@link PromptAnswerMsg}). */
  promptAnswer: 'prompt:answer',
  /** R→M: answer to the unlisted-app offer ({@link OfferAnswerMsg}). */
  offerAnswer: 'offer:answer',
  /** R→M: the overlay's "Back to <topic>" button; main just hides the overlay. */
  overlayDismiss: 'overlay:dismiss',
  reflectionSave: 'reflection:save',
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  /** R→M invoke: the extension pairing code; only answered to our own file:// windows. */
  settingsSecret: 'settings:secret',
  historyGet: 'history:get',
  summaryGet: 'summary:get',
  /** M→R broadcast of the muted flag (boolean); `invoke` returns the current flag. Ctrl+Alt+M toggles it in main. */
  soundMute: 'sound:mute',
  /** R→M: persist the chosen SoundChoice to settings.sound (validated in main). Replies SettingsSaveResult. */
  soundSave: 'sound:save',
  /** R→M: the mini window asks for a taller/shorter height (px) while the sound popover is open. */
  miniResize: 'mini:resize',
  windowOpen: 'window:open',
  windowClose: 'window:close',
  /** M→R broadcast of UiState; also `invoke('state')` returns the current UiState. */
  state: 'state',
  /** M→R broadcast of each EngineEvent (chime, planned-length prompt, ...). */
  engine: 'engine',
  /** M→R broadcast: a slip was just logged (blocked site/app, check-in "drifted"); payload is its timestamp (ms). */
  buddySlip: 'buddy:slip',
} as const;

export type Channel = (typeof IPC)[keyof typeof IPC];
export const CHANNELS: readonly Channel[] = Object.values(IPC);
export const isChannel = (c: unknown): c is Channel => typeof c === 'string' && (CHANNELS as readonly string[]).includes(c);

export interface UiState {
  phase: Phase;
  topic: string | null;
  phaseEndsAt: number | null;
  pausedSince: number | null;
  todayMs: number;
  streakDays: number;
  blockingActive: boolean;
  extensionConnected: boolean;
  suggestion: string | null;
  /** The study buddy chosen in Settings. */
  animal: Animal;
}

/** Payload of `session:start`. */
export interface StartRequest {
  topic: string;
  mode: Mode;
  goal: string | null;
  plannedMin: number | null;
}

/** Payload of `checkin:answer`. */
export type CheckinAnswerMsg =
  | { answer: 'yes' }
  | { answer: 'drifted' }
  | { answer: 'switched'; topic: string }
  | { answer: 'pages'; pages: number };

/** Payload of `prompt:answer`. */
export interface PromptAnswerMsg { exe: string; study: boolean }

/** Payload of `offer:answer`. */
export interface OfferAnswerMsg { exe: string; choice: 'block' | 'fine' | 'later' }

/** Reply of `summary:get`; null when the session id is not a finished session. */
export interface SummaryView {
  topic: string;
  mode: Mode;
  goal: string | null;
  summary: Summary;
}

/** Reply of `history:get`. */
export interface HistoryView {
  days: { day: string; ms: number }[];
  tags: { tag: string; count: number }[];
  streakDays: number;
}

/** Every window main can show (renderers may open only the `OPENABLE` subset). Later tasks add names here. */
export type WindowName =
  | 'start' | 'mini' | 'break' | 'checkin' | 'overlay' | 'prompt' | 'offer' | 'bypass' | 'history' | 'settings'
  | 'reflection' | 'summary';

export type EngineEventMsg = EngineEvent;

/** Shape of `window.buddy` exposed by the preload. */
export interface BuddyApi {
  send(channel: Channel, payload?: unknown): void;
  invoke<T = unknown>(channel: Channel, payload?: unknown): Promise<T>;
  on(channel: Channel, listener: (payload: unknown) => void): () => void;
}

/** Reply of `settings:save`. */
export type SettingsSaveResult = { ok: true; settings: import('@study-buddy/core').Settings } | { ok: false; error: string };

import type { EngineEvent, Mode, Phase } from '@study-buddy/core';

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
  promptAnswer: 'prompt:answer',
  reflectionSave: 'reflection:save',
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  historyGet: 'history:get',
  summaryGet: 'summary:get',
  soundMute: 'sound:mute',
  windowOpen: 'window:open',
  windowClose: 'window:close',
  /** M→R broadcast of UiState; also `invoke('state')` returns the current UiState. */
  state: 'state',
  /** M→R broadcast of each EngineEvent (chime, planned-length prompt, ...). */
  engine: 'engine',
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
}

/** Payload of `session:start`. */
export interface StartRequest {
  topic: string;
  mode: Mode;
  goal: string | null;
  plannedMin: number | null;
}

/** Windows a renderer may ask main to open (`window:open`). Later tasks add names here. */
export type WindowName = 'start' | 'mini' | 'break' | 'bypass' | 'history' | 'settings';

export type EngineEventMsg = EngineEvent;

/** Shape of `window.buddy` exposed by the preload. */
export interface BuddyApi {
  send(channel: Channel, payload?: unknown): void;
  invoke<T = unknown>(channel: Channel, payload?: unknown): Promise<T>;
  on(channel: Channel, listener: (payload: unknown) => void): () => void;
}

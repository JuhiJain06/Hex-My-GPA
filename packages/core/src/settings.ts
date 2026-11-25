import type { Animal } from './animals';

export type Mode = 'laptop' | 'book';

export interface Rhythm {
  focusMin: number;
  shortBreakMin: number;
  longBreakMin: number;
  longBreakEvery: number;
}

export type FreqChoice =
  | { kind: 'binaural' | 'isochronic'; beatHz: number; carrierHz: number }
  | { kind: 'pure'; hz: number };

export interface SoundChoice {
  ambient: 'none' | 'rain' | 'brown' | 'cafe';
  ambientVolume: number;
  freq: FreqChoice | null;
  freqVolume: number;
}

export interface Lists {
  fine: string[];
  gray: string[];
  hard: string[];
}

export interface Settings {
  rhythm: Rhythm;
  streakMinMinutes: number;
  sites: Lists;
  apps: Lists;
  sound: SoundChoice;
  /** The study buddy shown in the windows (and the extension). */
  animal: Animal;
}

export const BROWSER_EXES: string[] = [
  'chrome.exe', 'msedge.exe', 'firefox.exe', 'brave.exe', 'opera.exe', 'vivaldi.exe',
];

/** Apps that are never interrupted, whatever the lists say (spec anti-goal: Claude is a study tool). */
export const ALWAYS_FINE_APPS: readonly string[] = ['claude.exe'];

/**
 * Windows shell and host processes (lock screen, Start, search, settings, IME, UWP frame host).
 * They come to the front on their own, so they are never classified, offered or blocked.
 */
export const SYSTEM_EXES: readonly string[] = [
  'lockapp.exe', 'searchhost.exe', 'searchapp.exe', 'startmenuexperiencehost.exe', 'shellexperiencehost.exe',
  'applicationframehost.exe', 'systemsettings.exe', 'textinputhost.exe',
];

export const DEFAULT_SETTINGS: Settings = {
  rhythm: { focusMin: 45, shortBreakMin: 10, longBreakMin: 25, longBreakEvery: 3 },
  streakMinMinutes: 120,
  sites: {
    fine: ['claude.ai', 'notebooklm.google.com', 'gemini.google.com'],
    gray: ['youtube.com'],
    hard: [
      'instagram.com', 'facebook.com', 'x.com', 'twitter.com', 'reddit.com',
      'netflix.com', 'poki.com', 'crazygames.com', 'miniclip.com', 'roblox.com',
    ],
  },
  apps: {
    fine: [
      'acrord32.exe', 'acrobat.exe', 'sumatrapdf.exe', 'onenote.exe', 'winword.exe',
      'notepad.exe', 'code.exe', 'obsidian.exe', 'notion.exe', 'explorer.exe',
      ...ALWAYS_FINE_APPS,
      ...BROWSER_EXES,
    ],
    gray: [],
    hard: [],
  },
  sound: { ambient: 'none', ambientVolume: 0.5, freq: null, freqVolume: 0.3 },
  animal: 'cat',
};

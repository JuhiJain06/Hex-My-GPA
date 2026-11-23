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
}

export const BROWSER_EXES: string[] = [
  'chrome.exe', 'msedge.exe', 'firefox.exe', 'brave.exe', 'opera.exe', 'vivaldi.exe',
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
      ...BROWSER_EXES,
    ],
    gray: [],
    hard: [],
  },
  sound: { ambient: 'none', ambientVolume: 0.5, freq: null, freqVolume: 0.3 },
};

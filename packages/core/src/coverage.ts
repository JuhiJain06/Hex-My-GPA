import type { BrowserKind, WindowReport } from './protocol';

const EXE_TO_BROWSER: Record<string, BrowserKind> = { 'chrome.exe': 'chrome', 'msedge.exe': 'edge' };

/** The extension kind of a browser exe, or null (other browsers have no Study Buddy extension). */
export function browserKindOf(exe: string): BrowserKind | null {
  return EXE_TO_BROWSER[exe.toLowerCase()] ?? null;
}

/** Zero-width characters (Edge writes "Microsoft​ Edge" in its window titles). */
const ZERO_WIDTH = /[​-‍⁠﻿]/g;
const SUFFIX: Record<BrowserKind, RegExp> = {
  chrome: /^Google Chrome( \(.*\))?$/,
  edge: /^Microsoft Edge( \(.*\))?$/,
};

/**
 * True if `title` is a tab window of that browser ("<tab> - Google Chrome", "<tab> - Personal -
 * Microsoft Edge", incognito/InPrivate included). File dialogs, DevTools, PWA windows, the profile
 * picker and other popups don't carry the browser's name as a " - " segment.
 */
export function isTabWindowTitle(kind: BrowserKind, title: string): boolean {
  return title.replace(ZERO_WIDTH, '').split(' - ').some((seg) => SUFFIX[kind].test(seg.trim()));
}

/**
 * Whether the foreground browser window is watched by a connected extension of its kind.
 * No extension of that kind connected → not covered. Connected → every window is covered unless it
 * is positively a tab window whose active tab no connected extension reported (an incognito window
 * the extension may not see, or a profile without the extension).
 */
export function isBrowserCovered(
  fg: { exe: string; title: string },
  reports: { browser: BrowserKind; windows: WindowReport[] }[],
): boolean {
  const kind = browserKindOf(fg.exe);
  if (!kind) return false;
  const mine = reports.filter((r) => r.browser === kind);
  if (mine.length === 0) return false;
  if (!isTabWindowTitle(kind, fg.title)) return true;
  return mine.some((r) => r.windows.some((w) => w.title !== '' && fg.title.startsWith(w.title)));
}

export interface BrowserLink {
  /** The desktop bridge is listening for the extension. */
  listening: boolean;
  /** An extension has said hello with the right code at least once (ever). */
  paired: boolean;
  reports: { browser: BrowserKind; windows: WindowReport[] }[];
}

/**
 * Coverage as the app guard sees it. Until an extension was paired at least once, or while the bridge
 * can't listen, no browser can ever be covered, so none is overlaid; otherwise `isBrowserCovered`.
 */
export function browserCoverage(fg: { exe: string; title: string }, link: BrowserLink): boolean {
  if (!link.listening || !link.paired) return true;
  return isBrowserCovered(fg, link.reports);
}

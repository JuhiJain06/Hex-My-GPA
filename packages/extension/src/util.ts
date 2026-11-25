import type { BrowserKind, WindowReport } from '@study-buddy/core';

const pad = (n: number): string => String(n).padStart(2, '0');

/** Text for the blocked page, from its `until` query param (epoch ms). */
export function blockedMessage(until: string | null): string {
  const ms = until === null || until === '' ? NaN : Number(until);
  if (!Number.isFinite(ms)) return 'Blocked during this focus block';
  const d = new Date(ms);
  return `Blocked until break at ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function browserKind(brands: { brand: string }[] | undefined): BrowserKind {
  return brands?.some((b) => b.brand === 'Microsoft Edge') ? 'edge' : 'chrome';
}

const MAX_TITLE = 300;
const MAX_WINDOWS = 50; // keeps a report far below the bridge's 64 KiB maxPayload

/**
 * Window types the background reports. Not only 'normal': the desktop treats an unreported tab-titled
 * window as uncovered, and OAuth/sign-in popups carry the browser's title suffix too.
 */
export const REPORTED_WINDOW_TYPES: readonly `${chrome.windows.WindowType}`[] = ['normal', 'popup', 'app', 'devtools'];

/** One report per window: its active tab's title. */
export function windowReports(windows: chrome.windows.Window[]): WindowReport[] {
  return windows.slice(0, MAX_WINDOWS).map((w) => ({
    title: (w.tabs?.find((t) => t.active)?.title ?? '').slice(0, MAX_TITLE),
    incognito: w.incognito,
    focused: w.focused,
  }));
}

/** The pairing code is the desktop's secret: lowercase hex. Callers trim/lowercase first. */
export function isPairingCode(s: string): boolean {
  return /^[0-9a-f]+$/i.test(s);
}

/** "Continue to <site>": the original URL from the blocked page's fragment, only if it is http(s). */
export function continueUrl(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * Whether a page's slip goes to the desktop: only while connected, only while the last state says
 * blocking (a reload or session restore of the blocked page in a break is not a slip), and only
 * from a tab's top frame.
 */
export function shouldForwardSlip(
  last: { blocking: boolean } | null,
  connected: boolean,
  sender: { tab?: unknown; frameId?: number },
): boolean {
  return connected && !!last?.blocking && sender.tab !== undefined && sender.frameId === 0;
}

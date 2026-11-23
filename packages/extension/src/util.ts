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

/** One report per normal window: its active tab's title. */
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

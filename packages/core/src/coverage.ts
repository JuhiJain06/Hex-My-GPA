import type { BrowserKind, WindowReport } from './protocol';

const EXE_TO_BROWSER: Record<string, BrowserKind> = { 'chrome.exe': 'chrome', 'msedge.exe': 'edge' };

export function isBrowserCovered(
  fg: { exe: string; title: string },
  reports: { browser: BrowserKind; windows: WindowReport[] }[],
): boolean {
  const kind = EXE_TO_BROWSER[fg.exe.toLowerCase()];
  if (!kind) return false;
  return reports.some(
    (r) => r.browser === kind && r.windows.some((w) => w.title !== '' && fg.title.startsWith(w.title)),
  );
}

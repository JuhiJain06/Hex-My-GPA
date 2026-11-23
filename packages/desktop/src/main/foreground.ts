import { basename } from 'node:path';
import { activeWindow } from 'get-windows';

export interface ForegroundWindow {
  exe: string;
  title: string;
  pid: number;
  /** Window rect in screen (physical) pixels, used to pick the overlay's display. */
  bounds?: { x: number; y: number; width: number; height: number };
}

const POLL_MS = 1000;

/**
 * Polls the foreground window every second via `get-windows` (its prebuilt N-API binary loads under
 * Electron without a rebuild) and calls `onChange` when the exe, title or pid changes. `exe` is the
 * lowercased basename of the owner's path (e.g. `chrome.exe`); null when nothing is in front.
 * Returns a stop function.
 */
export function startForegroundPolling(onChange: (fg: ForegroundWindow | null) => void): () => void {
  let last: string | undefined;
  let busy = false;
  let warned = false;
  const poll = async () => {
    if (busy) return;
    busy = true;
    try {
      const w = await activeWindow();
      const fg: ForegroundWindow | null = w?.owner.path
        ? {
          exe: basename(w.owner.path.replace(/\\/g, '/')).toLowerCase(),
          title: w.title,
          pid: w.owner.processId,
          bounds: w.bounds,
        }
        : null;
      const key = fg ? `${fg.pid}|${fg.exe}|${fg.title}` : '';
      if (key !== last) {
        last = key;
        onChange(fg);
      }
    } catch (err) {
      if (!warned) console.error('[foreground] activeWindow failed', err);
      warned = true;
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void poll(), POLL_MS);
  void poll();
  return () => clearInterval(timer);
}

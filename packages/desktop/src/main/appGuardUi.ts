import { screen, type Display } from 'electron';
import type { GuardUi } from './appGuard';
import type { ForegroundWindow } from './foreground';
import { closeWindow, showWindow } from './windows';
import { bindHotkey, unbindHotkey } from './hotkeys';

const MARGIN = 16;
const PROMPT = { w: 340, h: 130 };
const OFFER = { w: 360, h: 150 };
const KEYS = ['prompt-y', 'prompt-n'] as const;

export interface GuardUiDeps {
  /** The last real foreground window (for the overlay's display). */
  foreground(): ForegroundWindow | null;
  /** Current session topic, for the overlay's "Back to <topic>" button. */
  topic(): string | null;
  answerPrompt(exe: string, study: boolean): void;
}

/** The display holding the foreground window; the primary display if its bounds are unknown. */
function targetDisplay(fg: ForegroundWindow | null): Display {
  if (fg?.bounds && fg.bounds.width > 0 && fg.bounds.height > 0) {
    try {
      // get-windows reports physical pixels; Electron's displays are in DIPs.
      return screen.getDisplayMatching(screen.screenToDipRect(null, fg.bounds));
    } catch { /* fall through */ }
  }
  return screen.getPrimaryDisplay();
}

function bottomRight(w: number, h: number, above = 0) {
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x + wa.width - w - MARGIN, y: wa.y + wa.height - h - MARGIN - above, width: w, height: h };
}

/**
 * Electron side of the app guard. The overlay covers the display of the foreground window, sits at
 * the 'screen-saver' level and never takes focus; its button only hides it. The gray-app prompt is
 * check-in style with Ctrl+Alt+Y/N bound only while it is visible; the offer (stacked above the
 * prompt slot) has buttons only.
 */
export function createGuardUi(deps: GuardUiDeps): GuardUi & { hideOffer(): void } {
  return {
    showOverlay({ label, until }) {
      const query: Record<string, string> = { label, topic: deps.topic() ?? 'studying' };
      if (until !== null) query.until = String(until);
      const win = showWindow('overlay', { query });
      if (!win) return;
      win.setBounds(targetDisplay(deps.foreground()).bounds);
      win.setAlwaysOnTop(true, 'screen-saver');
    },
    hideOverlay() {
      closeWindow('overlay');
    },
    showPrompt(exe) {
      const win = showWindow('prompt', { query: { kind: 'gray', exe } });
      win?.setBounds(bottomRight(PROMPT.w, PROMPT.h));
      bindHotkey('prompt-y', 'Control+Alt+Y', () => deps.answerPrompt(exe, true));
      bindHotkey('prompt-n', 'Control+Alt+N', () => deps.answerPrompt(exe, false));
    },
    hidePrompt() {
      KEYS.forEach(unbindHotkey);
      closeWindow('prompt');
    },
    showOffer(exe) {
      const win = showWindow('offer', { query: { kind: 'offer', exe } });
      win?.setBounds(bottomRight(OFFER.w, OFFER.h, PROMPT.h + MARGIN));
    },
    hideOffer() {
      closeWindow('offer');
    },
  };
}

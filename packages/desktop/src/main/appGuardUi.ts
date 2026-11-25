import { screen, type Display } from 'electron';
import type { GuardUi } from './appGuard';
import type { ForegroundWindow } from './foreground';
import { ABOVE_OVERLAY, closeWindow, getWindow, raiseAboveOverlay, showWindow } from './windows';
import { bindHotkey, ctrlAltY, unbindHotkey } from './hotkeys';
import { stackBounds } from '../shared/layout';

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

/**
 * Electron side of the app guard. The overlay covers the display of the foreground window, sits at
 * the 'screen-saver' level and never takes focus; its button only hides it. The gray-app prompt is
 * check-in style with Ctrl+Alt+Y/N bound only while it is visible (Y is shared with the
 * check-in: the newest visible one answers). The check-in, prompt and offer each have their own
 * bottom-right slot (stackBounds), so they never overlap; the offer has buttons only.
 */
export function createGuardUi(deps: GuardUiDeps): GuardUi {
  return {
    showOverlay({ label, until }) {
      const query: Record<string, string> = { label, topic: deps.topic() ?? 'studying' };
      if (until !== null) query.until = String(until);
      const win = showWindow('overlay', { query });
      if (!win) return;
      win.setBounds(targetDisplay(deps.foreground()).bounds);
      win.setAlwaysOnTop(true, 'screen-saver');
      // Keep pending prompts clickable: raise them now and again once a new overlay is actually shown.
      const raise = () => ABOVE_OVERLAY.forEach((n) => raiseAboveOverlay(getWindow(n)));
      raise();
      win.once('show', raise);
    },
    hideOverlay() {
      closeWindow('overlay');
    },
    showPrompt(exe) {
      const win = showWindow('prompt', { query: { kind: 'gray', exe } });
      win?.setBounds(stackBounds('prompt', screen.getPrimaryDisplay().workArea));
      raiseAboveOverlay(win);
      win?.once('show', () => raiseAboveOverlay(win));
      ctrlAltY.claim('prompt', () => deps.answerPrompt(exe, true));
      bindHotkey('prompt-n', 'Control+Alt+N', () => deps.answerPrompt(exe, false));
    },
    hidePrompt() {
      ctrlAltY.release('prompt');
      unbindHotkey('prompt-n');
      closeWindow('prompt');
    },
    showOffer(exe) {
      const win = showWindow('offer', { query: { kind: 'offer', exe } });
      win?.setBounds(stackBounds('offer', screen.getPrimaryDisplay().workArea));
      raiseAboveOverlay(win);
      win?.once('show', () => raiseAboveOverlay(win));
    },
    hideOffer() {
      closeWindow('offer');
    },
  };
}

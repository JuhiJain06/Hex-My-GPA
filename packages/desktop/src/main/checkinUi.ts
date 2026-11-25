import { screen, type BrowserWindow } from 'electron';
import type { CheckinAnswer, CheckinUi } from './checkins';
import { closeWindow, getWindow, raiseAboveOverlay, showWindow } from './windows';
import { bindHotkey, ctrlAltY, unbindHotkey } from './hotkeys';
import { IPC } from '../shared/ipc';
import { stackBounds } from '../shared/layout';

const KEYS = ['checkin-s', 'checkin-d'] as const;

/**
 * Shows the check-in bottom-right without stealing focus. The global hotkeys exist only while it is
 * visible. A focusable:false window cannot take typing on Windows, so the renderer asks (on mousedown
 * in an input) for `focusCheckin`; the window is closed on hide, which resets it to non-focusable.
 * If the user closes the window itself (Alt+F4 on a focused check-in), its hotkeys are released and
 * `dismissed` is called: no answer is logged and no hotkey stays bound to an invisible check-in.
 */
export function createCheckinUi(
  answer: (a: CheckinAnswer) => void,
  dismissed: () => void,
): CheckinUi & { focus(senderId: number): void } {
  /** The window currently showing the check-in; cleared before we close it ourselves. */
  let current: BrowserWindow | null = null;
  const unbind = () => {
    KEYS.forEach(unbindHotkey);
    ctrlAltY.release('checkin');
  };
  return {
    show({ mode, topic }) {
      const wa = screen.getPrimaryDisplay().workArea;
      const win = showWindow('checkin', { query: { mode, topic } });
      win?.setBounds(stackBounds(mode === 'book' ? 'checkin-book' : 'checkin-laptop', wa));
      if (win && win !== current) {
        win.once('closed', () => {
          if (current !== win) return; // closed by hide()
          current = null;
          unbind();
          dismissed();
        });
      }
      current = win;
      raiseAboveOverlay(win);
      win?.once('show', () => raiseAboveOverlay(win));
      ctrlAltY.claim('checkin', () => answer('yes'));
      bindHotkey('checkin-d', 'Control+Alt+D', () => answer('drifted'));
      if (mode === 'laptop') {
        bindHotkey('checkin-s', 'Control+Alt+S', () => {
          const win = getWindow('checkin');
          if (!win) return;
          win.setFocusable(true);
          win.focus();
          win.webContents.send(IPC.checkinSwitch);
        });
      }
    },
    hide() {
      current = null;
      unbind();
      const win = getWindow('checkin');
      win?.setFocusable(false);
      closeWindow('checkin');
    },
    focus(senderId) {
      const win = getWindow('checkin');
      if (!win || win.webContents.id !== senderId) return;
      win.setFocusable(true);
      win.focus();
    },
  };
}


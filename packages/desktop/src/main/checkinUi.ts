import { screen } from 'electron';
import type { Mode } from '@study-buddy/core';
import type { CheckinAnswer, CheckinUi } from './checkins';
import { closeWindow, getWindow, raiseAboveOverlay, showWindow } from './windows';
import { bindHotkey, ctrlAltY, unbindHotkey } from './hotkeys';
import { IPC } from '../shared/ipc';

const SIZES: Record<Mode, { w: number; h: number }> = {
  laptop: { w: 340, h: 150 },
  book: { w: 380, h: 220 },
};
const MARGIN = 16;
const KEYS = ['checkin-s', 'checkin-d'] as const;

/**
 * Shows the check-in bottom-right without stealing focus. The global hotkeys exist only while it is
 * visible. A focusable:false window cannot take typing on Windows, so the renderer asks (on mousedown
 * in an input) for `focusCheckin`; the window is closed on hide, which resets it to non-focusable.
 */
export function createCheckinUi(answer: (a: CheckinAnswer) => void): CheckinUi & { focus(senderId: number): void } {
  const unbind = () => {
    KEYS.forEach(unbindHotkey);
    ctrlAltY.release('checkin');
  };
  return {
    show({ mode, topic }) {
      const { w, h } = SIZES[mode];
      const wa = screen.getPrimaryDisplay().workArea;
      const win = showWindow('checkin', { query: { mode, topic } });
      win?.setBounds({ x: wa.x + wa.width - w - MARGIN, y: wa.y + wa.height - h - MARGIN, width: w, height: h });
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


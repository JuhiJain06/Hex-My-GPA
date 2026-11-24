import { BrowserWindow, nativeTheme, screen, type BrowserWindowConstructorOptions } from 'electron';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTokens } from '@study-buddy/core/theme/tokens';
import type { Channel, WindowName } from '../shared/ipc';
import { clampHeight, MINI_H, MINI_W } from '../shared/layout';
import { debug } from './config';

const here = dirname(fileURLToPath(import.meta.url));

export interface WindowSpec {
  /** Basename of dist/renderer/<html>.html. */
  html: string;
  options: () => BrowserWindowConstructorOptions;
  /** Show without stealing focus. */
  inactive?: boolean;
}

const MARGIN = 16;

/** The theme's page background per scheme (from the tokens.css next to the renderers), so no white flash. */
const pageBg = (() => {
  try {
    const t = parseTokens(readFileSync(join(here, 'renderer', 'tokens.css'), 'utf8'));
    return { light: t.light['--bg'] ?? '#fdf7ef', dark: t.dark['--bg'] ?? '#221f2a' };
  } catch {
    return { light: '#fdf7ef', dark: '#221f2a' };
  }
})();

const specs = new Map<string, WindowSpec>();
const open = new Map<string, BrowserWindow>();

/** Register a window type. Later tasks call this for checkin, overlay, reflection, ... */
export function defineWindow(name: WindowName, spec: WindowSpec): void {
  specs.set(name, spec);
}

defineWindow('start', {
  html: 'start',
  options: () => ({ width: 420, height: 630, resizable: false, title: 'Study Buddy' }),
});

defineWindow('mini', {
  html: 'mini',
  inactive: true,
  options: () => {
    const wa = screen.getPrimaryDisplay().workArea;
    return {
      width: MINI_W, height: MINI_H,
      x: wa.x + wa.width - MINI_W - MARGIN, y: wa.y + MARGIN,
      frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true,
      minimizable: false, maximizable: false, fullscreenable: false,
    };
  },
});

defineWindow('break', {
  html: 'break',
  inactive: true,
  options: () => ({
    width: 420, height: 440, resizable: false, alwaysOnTop: true,
    minimizable: false, maximizable: false, title: 'Break',
  }),
});

defineWindow('checkin', {
  html: 'checkin',
  inactive: true,
  // Sized and positioned per mode by checkinUi; never takes focus unless the user clicks an input.
  options: () => ({
    width: 340, height: 150, frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true,
    minimizable: false, maximizable: false, fullscreenable: false, focusable: false,
  }),
});

// Full-screen block overlay; appGuardUi sets its bounds to the target display and raises it to
// the 'screen-saver' level. Never takes focus, so the blocked app keeps the keyboard (and its text).
defineWindow('overlay', {
  html: 'overlay',
  inactive: true,
  options: () => ({
    frame: false, transparent: true, backgroundColor: '#00000000', resizable: false, movable: false,
    alwaysOnTop: true, skipTaskbar: true, focusable: false, hasShadow: false,
    minimizable: false, maximizable: false, fullscreenable: false,
  }),
});

// Gray-app prompt and unlisted-app offer: check-in style, bottom-right, positioned by appGuardUi.
const promptOptions = (): BrowserWindowConstructorOptions => ({
  width: 340, height: 130, frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true,
  minimizable: false, maximizable: false, fullscreenable: false, focusable: false,
});
defineWindow('prompt', { html: 'prompt', inactive: true, options: promptOptions });
defineWindow('offer', { html: 'prompt', inactive: true, options: promptOptions });

// The bypass sentence: small, focused, above other windows so it can't get lost behind the mini.
defineWindow('bypass', {
  html: 'bypass',
  options: () => ({
    width: 400, height: 280, resizable: false, alwaysOnTop: true,
    minimizable: false, maximizable: false, fullscreenable: false, title: 'Turn off blocking',
  }),
});

defineWindow('reflection', {
  html: 'reflection',
  options: () => ({ width: 420, height: 560, resizable: false, title: 'How did it go?' }),
});
defineWindow('summary', {
  html: 'summary',
  options: () => ({ width: 440, height: 680, resizable: false, title: 'Session summary' }),
});
defineWindow('history', {
  html: 'history',
  options: () => ({ width: 560, height: 560, resizable: false, title: 'History' }),
});

defineWindow('settings', {
  html: 'settings',
  options: () => ({ width: 640, height: 700, minWidth: 520, minHeight: 400, title: 'Settings' }),
});

const base = ():BrowserWindowConstructorOptions => ({
  show: false,
  autoHideMenuBar: true,
  backgroundColor: nativeTheme.shouldUseDarkColors ? pageBg.dark : pageBg.light,
  webPreferences: {
    preload: join(here, 'preload.cjs'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    autoplayPolicy: 'no-user-gesture-required',
  },
});

export interface ShowOptions {
  /** Passed as the page's query string; if the window is already open it is reloaded with it. */
  query?: Record<string, string>;
  /** Force focus even for specs that normally show inactive. */
  focus?: boolean;
}

export function showWindow(name: WindowName, opts: ShowOptions = {}): BrowserWindow | null {
  const spec = specs.get(name);
  if (!spec) {
    console.warn(`[windows] "${name}" is not available yet`);
    return null;
  }
  const file = join(here, 'renderer', `${spec.html}.html`);
  let win = open.get(name);
  if (win && !win.isDestroyed()) {
    if (opts.query) void win.loadFile(file, { query: opts.query });
    reveal(win, spec, opts);
    return win;
  }
  const o = clampToScreen(spec.options());
  win = new BrowserWindow({ ...base(), ...o, webPreferences: { ...base().webPreferences, ...o.webPreferences } });
  open.set(name, win);
  const created = win;
  created.on('closed', () => { if (open.get(name) === created) open.delete(name); });
  created.webContents.on('console-message', (e) => {
    if (debug || e.level === 'error' || e.level === 'warning') console.log(`[renderer:${name}] ${e.level}: ${e.message}`);
  });
  if (debug) created.webContents.on('did-finish-load', () => console.log(`[windows] ${name} loaded ${created.webContents.getURL().split('/').pop()}`));
  created.webContents.on('render-process-gone', (_e, d) => console.error(`[renderer:${name}] gone`, d.reason));
  created.once('ready-to-show', () => reveal(created, spec, opts));
  void created.loadFile(file, { query: opts.query });
  return created;
}

/** Every window fits the primary work area (minus 40 px); tall pages scroll inside instead. */
function clampToScreen(o: BrowserWindowConstructorOptions): BrowserWindowConstructorOptions {
  const workH = screen.getPrimaryDisplay().workArea.height;
  const out = { ...o };
  if (out.height !== undefined) out.height = clampHeight(out.height, workH);
  if (out.minHeight !== undefined) out.minHeight = clampHeight(out.minHeight, workH);
  return out;
}

function reveal(win: BrowserWindow, spec: WindowSpec, opts: ShowOptions): void {
  if (win.isDestroyed()) return;
  if (spec.inactive && !opts.focus) win.showInactive();
  else {
    win.show();
    win.focus();
  }
}

export function getWindow(name: WindowName): BrowserWindow | null {
  const w = open.get(name);
  return w && !w.isDestroyed() ? w : null;
}

export function focusWindow(name: WindowName): void {
  const w = getWindow(name);
  if (!w) return;
  w.show();
  w.focus();
}

/**
 * Puts a small prompt window above the block overlay: same 'screen-saver' level, then raised.
 * The overlay is full-screen at that level, so without this it would cover pending prompts.
 */
export function raiseAboveOverlay(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return;
  win.setAlwaysOnTop(true, 'screen-saver');
  win.moveTop();
}

/** The windows that must stay clickable while the overlay is up. */
export const ABOVE_OVERLAY: readonly WindowName[] = ['checkin', 'prompt', 'offer'];

export function closeWindow(name: WindowName): void {
  getWindow(name)?.close();
}

/** Close the window that owns `webContentsId`, if it is one of ours. */
export function closeBySender(webContentsId: number): void {
  for (const w of open.values()) if (!w.isDestroyed() && w.webContents.id === webContentsId) w.close();
}

export function broadcast(channel: Channel, payload: unknown): void {
  for (const w of open.values()) if (!w.isDestroyed()) w.webContents.send(channel, payload);
}

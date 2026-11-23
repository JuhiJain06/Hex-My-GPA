import { BrowserWindow, screen, type BrowserWindowConstructorOptions } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Channel, WindowName } from '../shared/ipc';
import { debug } from './config';

const here = dirname(fileURLToPath(import.meta.url));

export interface WindowSpec {
  /** Basename of dist/renderer/<html>.html. */
  html: string;
  options: () => BrowserWindowConstructorOptions;
  /** Show without stealing focus. */
  inactive?: boolean;
}

const MINI_W = 260;
const MINI_H = 150;
const MARGIN = 16;

const specs = new Map<string, WindowSpec>();
const open = new Map<string, BrowserWindow>();

/** Register a window type. Later tasks call this for checkin, overlay, reflection, ... */
export function defineWindow(name: WindowName, spec: WindowSpec): void {
  specs.set(name, spec);
}

defineWindow('start', {
  html: 'start',
  options: () => ({ width: 420, height: 440, resizable: false, title: 'Study Buddy' }),
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
    width: 420, height: 300, resizable: false, alwaysOnTop: true,
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

const base = (): BrowserWindowConstructorOptions => ({
  show: false,
  autoHideMenuBar: true,
  backgroundColor: '#1d1f24',
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
  const o = spec.options();
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

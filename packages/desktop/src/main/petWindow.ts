import { ipcMain, screen, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import type { PetPos, Settings } from '@study-buddy/core';
import { IPC, type PetMenuLayout } from '../shared/ipc';
import { PET_H, PET_W, type Rect } from '../shared/layout';
import { clampPetPos, menuBounds, parsePetDrag, parsePetMenu, parsePetSize, restorePetPos, type Point } from './petPosition';
import { defineWindow, getWindow, showWindow, type ShowOptions } from './windows';

/**
 * The desktop pet: a small transparent, frameless, always-on-top (normal level, below the overlay
 * and prompts) window that never takes focus except while its menu is open. Clicks pass through
 * everywhere except over the pet, its bubble and its menu: the renderer hit-tests on mousemove and
 * sends `pet:hit`. Dragging sends `pet:drag` deltas; main moves and clamps, and saves on drag end.
 */

export interface PetDeps {
  getSettings(): Settings;
  saveSettings(s: Settings): void;
  log(...a: unknown[]): void;
}

const SIZE = { width: PET_W, height: PET_H } as const;

export interface PetWindow {
  /** Show the pet (creating it at its saved spot), reloading it with `query` when given. */
  show(opts?: ShowOptions): BrowserWindow | null;
  /** Clear the saved spot and move an open pet to the default spot. */
  resetPosition(): void;
}

export function createPetWindow(deps: PetDeps): PetWindow {
  /** Top-left of the pet itself (the window is larger while the menu is open). */
  let pos: Point | null = null;
  let menuOpen = false;
  const ready = new WeakSet<BrowserWindow>();

  const displays = () => screen.getAllDisplays();
  const workAreas = (): Rect[] => displays().map((d) => d.workArea);

  const savedPos = (): PetPos | null => {
    try { return deps.getSettings().pet?.pos ?? null; } catch { return null; }
  };
  const currentPos = (): Point => {
    pos ??= restorePetPos(savedPos(), displays().map((d) => ({ id: d.id, workArea: d.workArea })), screen.getPrimaryDisplay().id, SIZE);
    return pos;
  };
  const petRect = (): Rect => ({ ...currentPos(), ...SIZE });

  defineWindow('pet', {
    html: 'pet',
    inactive: true,
    options: () => ({
      ...petRect(),
      transparent: true, backgroundColor: '#00000000', frame: false, resizable: false, movable: false,
      skipTaskbar: true, hasShadow: false, alwaysOnTop: true, focusable: false,
      minimizable: false, maximizable: false, fullscreenable: false, title: 'Study buddy',
    }),
  });

  const win = (): BrowserWindow | null => getWindow('pet');
  const fromPet = (e: IpcMainEvent | IpcMainInvokeEvent): BrowserWindow | null => {
    const w = win();
    return w && e.sender.id === w.webContents.id && (e.senderFrame?.url ?? '').startsWith('file:') ? w : null;
  };

  /** Back to just the pet: closed-menu bounds, not focusable, clicks pass through. */
  const settle = (w: BrowserWindow) => {
    if (w.isDestroyed()) return;
    menuOpen = false;
    w.setBounds(petRect());
    w.setFocusable(false);
    w.setIgnoreMouseEvents(true, { forward: true });
  };

  const persist = () => {
    if (!pos) return;
    try {
      const display = screen.getDisplayMatching(petRect());
      const s = deps.getSettings();
      deps.saveSettings({ ...s, pet: { ...s.pet, pos: { x: pos.x, y: pos.y, displayId: display.id } } });
      deps.log('pet position saved', pos.x, pos.y, display.id);
    } catch (err) { console.error('[pet] saving the position failed', err); }
  };

  const layoutFor = (size: { width: number; height: number }) =>
    menuBounds(petRect(), size, screen.getDisplayMatching(petRect()).workArea);

  ipcMain.on(IPC.petHit, (e, p: unknown) => {
    const w = fromPet(e);
    if (!w || typeof p !== 'boolean') return;
    w.setIgnoreMouseEvents(!p, { forward: true });
  });
  ipcMain.on(IPC.petDrag, (e, p: unknown) => {
    const w = fromPet(e);
    const d = parsePetDrag(p);
    if (!w || !d || menuOpen) return;
    const cur = currentPos();
    pos = clampPetPos({ x: Math.round(cur.x + d.dx), y: Math.round(cur.y + d.dy) }, workAreas(), SIZE);
    w.setBounds(petRect());
  });
  ipcMain.on(IPC.petDragEnd, (e) => { if (fromPet(e)) persist(); });
  ipcMain.handle(IPC.petLayout, (e, p: unknown): PetMenuLayout | null => {
    const size = parsePetSize(p);
    if (!fromPet(e) || !size) return null;
    const { side, anchor } = layoutFor(size);
    return { side, anchor };
  });
  ipcMain.handle(IPC.petMenu, (e, p: unknown): PetMenuLayout | null => {
    const w = fromPet(e);
    const m = parsePetMenu(p);
    if (!w || !m) return null;
    if (!m.open) {
      settle(w);
      return null;
    }
    const l = layoutFor(m.size);
    menuOpen = true;
    w.setBounds(l.bounds);
    w.setFocusable(true);
    w.focus();
    return { side: l.side, anchor: l.anchor };
  });

  // A display unplugged or rescaled: keep the pet on screen.
  const reclamp = () => {
    if (!pos) return;
    pos = clampPetPos(pos, workAreas(), SIZE);
    const w = win();
    // With the menu open the window is resized when it closes (it closes on blur anyway).
    if (w && !menuOpen) settle(w);
  };
  screen.on('display-removed', reclamp);
  screen.on('display-metrics-changed', reclamp);

  return {
    show(opts = {}) {
      const w = showWindow('pet', opts);
      if (w && !ready.has(w)) {
        ready.add(w);
        settle(w);
        // A reload (new query) resets the renderer, so its menu is closed: match it.
        w.webContents.on('did-finish-load', () => settle(w));
        w.on('closed', () => { menuOpen = false; });
      }
      return w;
    },
    resetPosition() {
      pos = null;
      try {
        const s = deps.getSettings();
        deps.saveSettings({ ...s, pet: { ...s.pet, pos: null } });
      } catch (err) { console.error('[pet] resetting the position failed', err); }
      const w = win();
      if (w && !menuOpen) settle(w);
      deps.log('pet position reset');
    },
  };
}

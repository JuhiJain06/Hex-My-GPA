import { globalShortcut } from 'electron';
import { SharedHotkey } from './sharedHotkey';

/**
 * Named global shortcuts. Later tasks bind keys only while a prompt is visible
 * (e.g. Ctrl+Alt+Y for check-ins) and release them when it hides.
 */
const bound = new Map<string, string>();

export function bindHotkey(id: string, accelerator: string, fn: () => void): boolean {
  unbindHotkey(id);
  let ok = false;
  try { ok = globalShortcut.register(accelerator, fn); } catch (err) { console.error('[hotkeys] register failed', accelerator, err); }
  if (ok) bound.set(id, accelerator);
  else console.warn(`[hotkeys] ${accelerator} is taken by another app`);
  return ok;
}

export function unbindHotkey(id: string): void {
  const acc = bound.get(id);
  if (acc === undefined) return;
  globalShortcut.unregister(acc);
  bound.delete(id);
}

export function unbindAllHotkeys(): void {
  globalShortcut.unregisterAll();
  bound.clear();
}

/** Ctrl+Alt+Y ("yes"), shared by the check-in and the gray-app prompt: the newest visible one answers. */
export const ctrlAltY = new SharedHotkey(
  (fire) => bindHotkey('shared-y', 'Control+Alt+Y', fire),
  () => unbindHotkey('shared-y'),
);

/** Ctrl+Alt+M: mute / unmute focus sounds. Global and bound for the whole app run. */
export const bindMuteHotkey = (toggle: () => void): boolean => bindHotkey('sound-mute', 'Control+Alt+M', toggle);

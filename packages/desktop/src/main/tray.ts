import { Menu, Tray, nativeImage, type NativeImage } from 'electron';

export interface TrayActions {
  open(): void;
  history(): void;
  settings(): void;
  endSession(): void;
  quit(): void;
  sessionActive(): boolean;
}

/** A 16×16 filled circle (BGRA bitmap), drawn at runtime so no asset file is needed. */
function icon(): NativeImage {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      const alpha = Math.max(0, Math.min(1, 7.5 - d)); // soft 1px edge
      const i = (y * size + x) * 4;
      buf[i] = 0x8a;     // B
      buf[i + 1] = 0xc0; // G
      buf[i + 2] = 0x4c; // R
      buf[i + 3] = Math.round(alpha * 255);
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

/** Creates the tray. Call the returned `refresh` when the session starts or ends. */
export function createTray(a: TrayActions): { tray: Tray; refresh(): void } {
  const tray = new Tray(icon());
  tray.setToolTip('Study Buddy');
  const menu = () => Menu.buildFromTemplate([
    { label: 'Open', click: a.open },
    { label: 'History', click: a.history },
    { label: 'Settings', click: a.settings },
    { type: 'separator' },
    { label: 'End session', enabled: a.sessionActive(), click: a.endSession },
    { label: 'Quit Study Buddy', click: a.quit },
  ]);
  const refresh = () => tray.setContextMenu(menu());
  refresh();
  tray.on('click', a.open);
  return { tray, refresh };
}

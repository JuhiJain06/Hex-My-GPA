import type { BuddyApi, EngineEventMsg, UiState } from '../shared/ipc';
export { IPC } from '../shared/ipc';
export type { UiState, EngineEventMsg };

export const buddy = (window as unknown as { buddy: BuddyApi }).buddy;

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

/** Subscribe to UiState: fetches the current state once, then follows broadcasts. */
export function onState(fn: (s: UiState) => void): void {
  buddy.on('state', (s) => fn(s as UiState));
  void buddy.invoke<UiState>('state').then(fn);
}

export function onEngine(fn: (e: EngineEventMsg) => void): void {
  buddy.on('engine', (e) => fn(e as EngineEventMsg));
}

export function mmss(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function hm(ms: number): string {
  const min = Math.floor(ms / 60_000);
  const h = Math.floor(min / 60);
  return h > 0 ? `${h}h ${String(min % 60).padStart(2, '0')}m` : `${min}m`;
}

/** A soft two-note chime made with Web Audio (no asset files). */
export function chime(): void {
  try {
    const ctx = new AudioContext();
    const t0 = ctx.currentTime;
    [660, 880].forEach((hz, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = hz;
      const t = t0 + i * 0.18;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 1);
    });
    setTimeout(() => void ctx.close(), 1500);
  } catch (err) {
    console.warn('chime failed', err);
  }
}

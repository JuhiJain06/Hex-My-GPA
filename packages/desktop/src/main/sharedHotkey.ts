/** A fire this soon after the previous one is ignored (second press, key auto-repeat). */
export const REPEAT_MS = 750;
/** A fire aimed at an owner shown this recently is ignored (the user meant the window before it). */
export const ARM_MS = 500;

/**
 * One global accelerator shared by several prompts (Ctrl+Alt+Y is "yes" for both the check-in and the
 * gray-app prompt). It is registered once while anyone holds it and fires for the most recently
 * shown owner; when that owner releases it, the previous one gets it back. So that one press can't
 * answer two prompts, a fire within REPEAT_MS of the previous fire (answered or not) and a fire at an
 * owner claimed less than ARM_MS ago are ignored. Pure: register/unregister and the clock are injected.
 */
export class SharedHotkey {
  private owners: { id: string; fn: () => void; at: number }[] = [];
  private bound = false;
  private lastFire: number | null = null;

  constructor(
    private readonly bind: (fire: () => void) => boolean,
    private readonly unbind: () => void,
    private readonly clock: () => number = Date.now,
  ) {}

  claim(id: string, fn: () => void): void {
    this.owners = this.owners.filter((o) => o.id !== id);
    this.owners.push({ id, fn, at: this.clock() });
    if (!this.bound) this.bound = this.bind(() => this.fire());
  }

  release(id: string): void {
    const before = this.owners.length;
    this.owners = this.owners.filter((o) => o.id !== id);
    if (this.owners.length === before || this.owners.length > 0 || !this.bound) return;
    this.bound = false;
    this.unbind();
  }

  private fire(): void {
    const now = this.clock();
    const last = this.lastFire;
    this.lastFire = now;
    if (last !== null && now - last < REPEAT_MS) return;
    const owner = this.owners.at(-1);
    if (!owner || now - owner.at < ARM_MS) return;
    owner.fn();
  }
}

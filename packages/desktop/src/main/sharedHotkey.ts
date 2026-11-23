/**
 * One global accelerator shared by several prompts (Ctrl+Alt+Y is "yes" for both the check-in and the
 * gray-app prompt). It is registered once while anyone holds it and fires for the most recently
 * shown owner; when that owner releases it, the previous one gets it back. Pure: the actual
 * register/unregister calls are injected.
 */
export class SharedHotkey {
  private owners: { id: string; fn: () => void }[] = [];
  private bound = false;

  constructor(private readonly bind: (fire: () => void) => boolean, private readonly unbind: () => void) {}

  claim(id: string, fn: () => void): void {
    this.owners = this.owners.filter((o) => o.id !== id);
    this.owners.push({ id, fn });
    if (!this.bound) this.bound = this.bind(() => this.owners.at(-1)?.fn());
  }

  release(id: string): void {
    const before = this.owners.length;
    this.owners = this.owners.filter((o) => o.id !== id);
    if (this.owners.length === before || this.owners.length > 0 || !this.bound) return;
    this.bound = false;
    this.unbind();
  }
}

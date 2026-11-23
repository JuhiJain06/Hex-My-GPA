export interface ConnectorDeps<H> {
  /** True while a socket is CONNECTING or OPEN. */
  isActive(): boolean;
  /** Async work before opening (load secret, incognito access, ...). null = nothing to open. */
  prepare(): Promise<H | null>;
  /** Opens the socket synchronously (must make isActive() true or schedule its own retry). */
  open(hello: H): void;
}

/**
 * Single-flight connect: overlapping connect() calls (startup + alarm wake, retry timer +
 * alarm, reconnect on a code change) share one in-flight attempt, so at most one socket is
 * opened. invalidate() makes an in-flight attempt re-prepare instead of opening with
 * stale data (e.g. the pairing code changed while it was awaiting).
 */
export function createConnector<H>(deps: ConnectorDeps<H>): { connect(): Promise<void>; invalidate(): void } {
  let inflight: Promise<void> | null = null;
  let gen = 0;

  async function run(): Promise<void> {
    for (;;) {
      if (deps.isActive()) return;
      const g = gen;
      const hello = await deps.prepare();
      if (g !== gen) continue; // invalidated while preparing: start over
      if (hello === null || deps.isActive()) return;
      deps.open(hello);
      return;
    }
  }

  return {
    connect() {
      inflight ??= run().finally(() => { inflight = null; });
      return inflight;
    },
    invalidate() { gen++; },
  };
}

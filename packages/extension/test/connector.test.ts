import { expect, test } from 'vitest';
import { createConnector } from '../src/connector';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

/** Fake socket world: prepare() resolves only when the test says so. */
function harness() {
  const opened: string[] = [];
  const pending: { resolve: (v: string | null) => void }[] = [];
  let active = false;
  const c = createConnector<string>({
    isActive: () => active,
    prepare: () => { const d = deferred<string | null>(); pending.push(d); return d.promise; },
    open: (h) => { opened.push(h); active = true; },
  });
  return { c, opened, pending, setActive: (v: boolean) => { active = v; } };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test('two concurrent connect() calls open exactly one socket', async () => {
  const h = harness();
  const a = h.c.connect();
  const b = h.c.connect(); // e.g. top-level startup connect + onAlarm connect on a worker wake
  await tick();
  expect(h.pending).toHaveLength(1); // second call joined the in-flight one
  h.pending[0].resolve('secret');
  await Promise.all([a, b]);
  expect(h.opened).toEqual(['secret']);
});

test('no socket opened while one is already active', async () => {
  const h = harness();
  h.setActive(true);
  await h.c.connect();
  expect(h.pending).toHaveLength(0);
  expect(h.opened).toEqual([]);
});

test('after the in-flight attempt finishes, a later connect() can open again', async () => {
  const h = harness();
  const a = h.c.connect();
  await tick();
  h.pending[0].resolve('one');
  await a;
  h.setActive(false); // socket closed
  const b = h.c.connect();
  await tick();
  h.pending[1].resolve('two');
  await b;
  expect(h.opened).toEqual(['one', 'two']);
});

test('nothing to open (not paired) opens nothing', async () => {
  const h = harness();
  const a = h.c.connect();
  await tick();
  h.pending[0].resolve(null);
  await a;
  expect(h.opened).toEqual([]);
});

test('invalidate() during an in-flight attempt re-prepares instead of opening with stale data', async () => {
  const h = harness();
  const a = h.c.connect();
  await tick();
  h.c.invalidate(); // e.g. pairing code changed mid-connect
  const b = h.c.connect();
  h.pending[0].resolve('old-secret');
  await tick();
  expect(h.pending).toHaveLength(2);
  h.pending[1].resolve('new-secret');
  await Promise.all([a, b]);
  expect(h.opened).toEqual(['new-secret']);
});

test('a failing prepare() releases the guard', async () => {
  let calls = 0;
  const c = createConnector<string>({
    isActive: () => false,
    prepare: async () => { calls++; throw new Error('boom'); },
    open: () => {},
  });
  await expect(c.connect()).rejects.toThrow('boom');
  await expect(c.connect()).rejects.toThrow('boom');
  expect(calls).toBe(2);
});

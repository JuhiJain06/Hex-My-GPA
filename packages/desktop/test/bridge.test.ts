import { describe, test, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { Bridge } from '../src/main/bridge';

const SECRET = 's3cret-value';
const STATE = { t: 'state' as const, phase: 'focus' as const, blocking: true, topic: 'Maths', phaseEndsAt: 123, sites: { hard: [], gray: [] } as never, studyVideos: [], todayMs: 0, streakDays: 0, animal: 'cat' as const };

let bridge: Bridge;
let clients: WebSocket[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function make(extra: Partial<ConstructorParameters<typeof Bridge>[0]> = {}) {
  bridge = new Bridge({
    port: 0, secret: SECRET, clock: Date.now,
    helloTimeoutMs: 200,
    ...extra,
  });
  return bridge.listen();
}

/** Connects and records every message and the close event. */
async function connect(origin?: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}`, origin ? { origin } : undefined);
  clients.push(ws);
  const msgs: any[] = [];
  const state = { closed: false };
  ws.on('message', (d) => msgs.push(JSON.parse(String(d))));
  ws.on('close', () => { state.closed = true; });
  await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
  return { ws, msgs, state };
}
const hello = (ws: WebSocket, over: object = {}) =>
  ws.send(JSON.stringify({ t: 'hello', secret: SECRET, browser: 'chrome', incognitoAllowed: true, ...over }));

afterEach(() => { for (const c of clients) c.terminate(); clients = []; bridge.close(); });

describe('Bridge', () => {
  test('binds 127.0.0.1 only', async () => {
    await make();
    const addr = (bridge as any).wss.address();
    expect(addr.address).toBe('127.0.0.1');
    expect(bridge.port).toBeGreaterThan(0);
  });

  test('rejects upgrades from a web page origin, accepts extension origins and none', async () => {
    await make();
    await expect(connect('https://evil.example')).rejects.toBeTruthy();
    const a = await connect('chrome-extension://abc');
    const b = await connect('extension://abc');
    const c = await connect();
    expect([a, b, c].every((x) => x.ws.readyState === WebSocket.OPEN)).toBe(true);
  });

  test('wrong secret → helloAck ok:false and socket closed; right secret → ok:true and immediate state', async () => {
    await make();
    bridge.broadcast(STATE);
    const bad = await connect();
    hello(bad.ws, { secret: 'nope' });
    await sleep(60);
    expect(bad.msgs).toEqual([{ t: 'helloAck', ok: false }]);
    expect(bad.state.closed).toBe(true);
    expect(bridge.connected).toBe(false);

    const short = await connect();
    hello(short.ws, { secret: 'x' }); // length mismatch
    await sleep(60);
    expect(short.msgs).toEqual([{ t: 'helloAck', ok: false }]);

    const good = await connect();
    hello(good.ws);
    await sleep(60);
    expect(good.msgs).toEqual([{ t: 'helloAck', ok: true }, STATE]);
    expect(bridge.connected).toBe(true);
  });

  test('messages before hello are ignored; unparseable messages are ignored', async () => {
    await make();
    const slips: unknown[] = [];
    bridge.on('slip', (s) => slips.push(s));
    const c = await connect();
    c.ws.send(JSON.stringify({ t: 'slip', reason: 'hard-block-visit', target: 'x.com' }));
    c.ws.send('garbage');
    await sleep(60);
    expect(slips).toEqual([]);
    expect(c.state.closed).toBe(false);
    hello(c.ws);
    await sleep(30);
    c.ws.send('garbage');
    c.ws.send(JSON.stringify({ t: 'slip', reason: 'hard-block-visit', target: 'x.com' }));
    await sleep(60);
    expect(slips).toEqual([{ reason: 'hard-block-visit', target: 'x.com' }]);
  });

  test('closes a connection that has not said hello in time', async () => {
    await make();
    const c = await connect();
    await sleep(350);
    expect(c.state.closed).toBe(true);
  });

  test('emits videoStudy and startSession after hello; reports() keeps the latest windows per connection', async () => {
    await make();
    const got: any[] = [];
    bridge.on('videoStudy', (id) => got.push(['v', id]));
    bridge.on('startSession', (m) => got.push(['s', m.topic]));
    const c = await connect();
    hello(c.ws);
    c.ws.send(JSON.stringify({ t: 'windows', windows: [{ title: 'a', incognito: false, focused: true }] }));
    c.ws.send(JSON.stringify({ t: 'windows', windows: [{ title: 'b', incognito: false, focused: true }] }));
    c.ws.send(JSON.stringify({ t: 'videoStudy', videoId: 'abc' }));
    c.ws.send(JSON.stringify({ t: 'startSession', topic: ' Maths ', mode: 'laptop', goal: null, plannedMin: null }));
    await sleep(80);
    expect(got).toEqual([['v', 'abc'], ['s', ' Maths ']]);
    expect(bridge.reports()).toEqual([{ browser: 'chrome', windows: [{ title: 'b', incognito: false, focused: true }] }]);
  });

  test('lostSince: set when the last helloed connection of a browser kind closes, cleared by its next hello', async () => {
    let t = 1000;
    await make({ clock: () => t });
    const bypasses: unknown[] = [];
    bridge.on('bypass', (b) => bypasses.push(b));
    expect(bridge.lostSince('chrome')).toBeNull();
    const a = await connect();
    hello(a.ws);
    const e = await connect();
    hello(e.ws, { browser: 'edge' });
    await sleep(40);
    t = 2000;
    a.ws.close();
    await sleep(40);
    expect(bridge.lostSince('chrome')).toBe(2000);
    expect(bridge.lostSince('edge')).toBeNull();
    // Reconnecting clears it; a second chrome connection keeps the kind alive when one of them drops.
    const b = await connect();
    hello(b.ws);
    const c = await connect();
    hello(c.ws);
    await sleep(40);
    expect(bridge.lostSince('chrome')).toBeNull();
    b.ws.close();
    await sleep(40);
    expect(bridge.lostSince('chrome')).toBeNull();
    // The bridge itself never decides a bypass (the app guard does, lazily) and never asks the OS.
    await sleep(300);
    expect(bypasses).toEqual([]);
  });

  test('a connection that never said hello leaves no lost record', async () => {
    await make();
    const a = await connect();
    a.ws.close();
    await sleep(40);
    expect(bridge.lostSince('chrome')).toBeNull();
  });

  test('incognitoWarning true when any connected hello had incognitoAllowed false', async () => {
    await make();
    const a = await connect();
    hello(a.ws);
    await sleep(40);
    expect(bridge.incognitoWarning).toBe(false);
    const b = await connect();
    hello(b.ws, { browser: 'edge', incognitoAllowed: false });
    await sleep(40);
    expect(bridge.incognitoWarning).toBe(true);
    b.ws.close();
    await sleep(40);
    expect(bridge.incognitoWarning).toBe(false);
  });

  test('emits connection changes', async () => {
    await make();
    let n = 0;
    bridge.on('connection', () => n++);
    const a = await connect();
    hello(a.ws);
    await sleep(40);
    a.ws.close();
    await sleep(40);
    expect(n).toBe(2);
  });
});

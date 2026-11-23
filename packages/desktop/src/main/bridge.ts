import { EventEmitter } from 'node:events';
import { timingSafeEqual } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import {
  parseExtMessage,
  type BrowserKind,
  type DesktopToExt,
  type ExtToDesktop,
  type WindowReport,
} from '@study-buddy/core';

export type StateMessage = Extract<DesktopToExt, { t: 'state' }>;

export interface BridgeOptions {
  port: number;
  secret: string;
  clock: () => number;
  isBrowserRunning: (b: BrowserKind) => Promise<boolean>;
  /** True while blocking is active (the disconnect-bypass check only runs then). */
  isBlocking: () => boolean;
  /** Wait after a disconnect before calling it a bypass. Default 10 s. */
  bypassDelayMs?: number;
  /** Time a new connection has to say hello. Default 5 s. */
  helloTimeoutMs?: number;
}

interface Conn {
  ws: WebSocket;
  hello: { browser: BrowserKind; incognitoAllowed: boolean } | null;
  windows: WindowReport[];
  timer: NodeJS.Timeout | null;
}

const originOk = (origin: string | undefined): boolean =>
  !origin || origin.startsWith('chrome-extension://') || origin.startsWith('extension://');

/**
 * Localhost WebSocket server the browser extension connects to.
 * Emits 'slip' {reason,target}, 'videoStudy' (id), 'startSession' (msg), 'bypass' {target},
 * and 'connection' whenever `connected` may have changed.
 */
export class Bridge extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private conns = new Set<Conn>();
  private lastState: StateMessage | null = null;
  private bypassTimers = new Set<NodeJS.Timeout>();
  private readonly secret: Buffer;

  constructor(private readonly opts: BridgeOptions) {
    super();
    this.secret = Buffer.from(opts.secret);
  }

  get port(): number {
    return this.wss ? (this.wss.address() as AddressInfo).port : this.opts.port;
  }

  listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({
        host: '127.0.0.1',
        port: this.opts.port,
        verifyClient: (info: { origin: string }) => originOk(info.origin),
      });
      const onError = (err: Error) => reject(err);
      wss.once('error', onError);
      wss.once('listening', () => {
        wss.off('error', onError);
        wss.on('error', (err) => console.error('[bridge] server error', err));
        this.wss = wss;
        resolve();
      });
      wss.on('connection', (ws) => this.onConnection(ws));
    });
  }

  close(): void {
    for (const t of this.bypassTimers) clearTimeout(t);
    this.bypassTimers.clear();
    for (const c of this.conns) {
      if (c.timer) clearTimeout(c.timer);
      c.ws.terminate();
    }
    this.conns.clear();
    this.wss?.close();
    this.wss = null;
  }

  broadcast(s: StateMessage): void {
    this.lastState = s;
    for (const c of this.conns) if (c.hello) this.send(c.ws, s);
  }

  get connected(): boolean {
    return this.helloed().length > 0;
  }

  get incognitoWarning(): boolean {
    return this.helloed().some((c) => !c.hello!.incognitoAllowed);
  }

  reports(): { browser: BrowserKind; windows: WindowReport[] }[] {
    return this.helloed().map((c) => ({ browser: c.hello!.browser, windows: c.windows }));
  }

  private helloed(): Conn[] {
    return [...this.conns].filter((c) => c.hello && c.ws.readyState === WebSocket.OPEN);
  }

  private send(ws: WebSocket, m: DesktopToExt): void {
    try { ws.send(JSON.stringify(m)); } catch { /* socket gone */ }
  }

  private secretOk(given: string): boolean {
    const g = Buffer.from(given);
    return g.length === this.secret.length && timingSafeEqual(g, this.secret);
  }

  private onConnection(ws: WebSocket): void {
    const conn: Conn = { ws, hello: null, windows: [], timer: null };
    this.conns.add(conn);
    conn.timer = setTimeout(() => { if (!conn.hello) ws.close(); }, this.opts.helloTimeoutMs ?? 5000);
    ws.on('message', (data) => {
      const msg = parseExtMessage(String(data));
      if (msg) this.onMessage(conn, msg);
    });
    ws.on('error', () => { /* handled by close */ });
    ws.on('close', () => this.onClose(conn));
  }

  private onMessage(conn: Conn, msg: ExtToDesktop): void {
    if (!conn.hello) {
      if (msg.t !== 'hello') return;
      if (!this.secretOk(msg.secret)) {
        this.send(conn.ws, { t: 'helloAck', ok: false });
        conn.ws.close();
        return;
      }
      conn.hello = { browser: msg.browser, incognitoAllowed: msg.incognitoAllowed };
      if (conn.timer) { clearTimeout(conn.timer); conn.timer = null; }
      this.send(conn.ws, { t: 'helloAck', ok: true });
      if (this.lastState) this.send(conn.ws, this.lastState);
      this.emit('connection');
      return;
    }
    switch (msg.t) {
      case 'windows': conn.windows = msg.windows; break;
      case 'slip': this.emit('slip', { reason: msg.reason, target: msg.target }); break;
      case 'videoStudy': this.emit('videoStudy', msg.videoId); break;
      case 'startSession': this.emit('startSession', msg); break;
      default: break;
    }
  }

  private onClose(conn: Conn): void {
    this.conns.delete(conn);
    if (conn.timer) clearTimeout(conn.timer);
    if (!conn.hello) return;
    this.emit('connection');
    if (!this.opts.isBlocking()) return;
    const kind = conn.hello.browser;
    const reconnected = () => this.helloed().some((c) => c.hello!.browser === kind);
    const t = setTimeout(() => {
      this.bypassTimers.delete(t);
      if (reconnected()) return;
      this.opts.isBrowserRunning(kind).then((running) => {
        if (running && !reconnected()) this.emit('bypass', { target: 'extension-disconnected' });
      }, () => { /* treat as not running */ });
    }, this.opts.bypassDelayMs ?? 10_000);
    this.bypassTimers.add(t);
  }
}

// MV3 service worker. It can be killed and restarted at any time, so everything that matters
// lives in chrome.storage.local (`secret`, `lastState`) or in the persisted dynamic DNR rules;
// in-memory state here is only the live socket and caches that are safe to lose.
import { BRIDGE_PORT, type DesktopToExt, type ExtToDesktop } from '@study-buddy/core';
import { parseDesktopMessage } from './messages';
import { backoffMs, buildBlockRules, sameRules, shouldBlockOffline } from './rules';
import { browserKind, windowReports } from './util';

type StateMsg = Extract<DesktopToExt, { t: 'state' }>;
type Rule = chrome.declarativeNetRequest.Rule;

const RECONNECT_ALARM = 'reconnect';
const OFFLINE_END_ALARM = 'offline-end';
const PING_MS = 20_000;
const WINDOWS_DEBOUNCE_MS = 300;

let ws: WebSocket | null = null;
let helloed = false; // helloAck ok:true received on the current socket
let badCode = false; // last helloAck was ok:false
let helloIncognito: boolean | null = null;
let attempt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let windowsTimer: ReturnType<typeof setTimeout> | null = null;

// ---------- storage ----------

async function loadSecret(): Promise<string | null> {
  const { secret } = await chrome.storage.local.get('secret');
  return typeof secret === 'string' && secret !== '' ? secret : null;
}

async function loadLastState(): Promise<StateMsg | null> {
  const { lastState } = await chrome.storage.local.get('lastState');
  // Re-validate: storage is ours, but a shape from an older build must not crash rule building.
  const parsed = lastState ? parseDesktopMessage(JSON.stringify(lastState)) : null;
  return parsed && parsed.t === 'state' ? parsed : null;
}

// ---------- rules ----------

let applied: Rule[] | null = null; // last set we applied; null = unknown (fresh worker)
let rulesQueue: Promise<void> = Promise.resolve();

/** Atomically replaces all dynamic rules; skipped when unchanged. Calls are serialised. */
function setRules(rules: Rule[]): Promise<void> {
  rulesQueue = rulesQueue.then(async () => {
    if (applied && sameRules(applied, rules)) return;
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existing.map((r) => r.id),
      addRules: rules,
    });
    applied = rules;
  }).catch((err) => {
    applied = null;
    console.error('[study-buddy] updateDynamicRules failed', err);
  });
  return rulesQueue;
}

const rulesFor = (s: StateMsg): Rule[] =>
  s.blocking ? buildBlockRules(s.sites, s.phaseEndsAt, chrome.runtime.id) : [];

/** While disconnected: keep blocking only inside the last known blocking focus block. */
async function applyOffline(): Promise<void> {
  if (helloed) return;
  const last = await loadLastState();
  if (helloed) return;
  if (last && shouldBlockOffline(last, Date.now())) {
    await setRules(rulesFor(last));
    await chrome.alarms.create(OFFLINE_END_ALARM, { when: last.phaseEndsAt! });
  } else {
    await chrome.alarms.clear(OFFLINE_END_ALARM);
    await setRules([]);
  }
}

async function onState(s: StateMsg): Promise<void> {
  await chrome.storage.local.set({ lastState: s });
  await setRules(rulesFor(s));
}

// ---------- socket ----------

function send(m: ExtToDesktop): boolean {
  if (!ws || ws.readyState !== WebSocket.OPEN || !helloed) return false;
  try { ws.send(JSON.stringify(m)); return true; } catch { return false; }
}

async function connect(): Promise<void> {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  await applyOffline();
  const secret = await loadSecret();
  if (!secret) return; // not paired yet; saving a code triggers connect()
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return; // raced
  const incognitoAllowed = await chrome.extension.isAllowedIncognitoAccess();
  const brands = (navigator as Navigator & { userAgentData?: { brands: { brand: string }[] } }).userAgentData?.brands;

  let sock: WebSocket;
  try { sock = new WebSocket(`ws://127.0.0.1:${BRIDGE_PORT}`); } catch { scheduleRetry(); return; }
  ws = sock;
  helloed = false;
  sock.onopen = () => {
    helloIncognito = incognitoAllowed;
    sock.send(JSON.stringify({ t: 'hello', secret, browser: browserKind(brands), incognitoAllowed } satisfies ExtToDesktop));
  };
  sock.onmessage = (e) => {
    if (ws !== sock) return;
    const msg = parseDesktopMessage(String(e.data));
    if (!msg) return;
    if (msg.t === 'helloAck') {
      badCode = !msg.ok;
      if (!msg.ok) return; // desktop closes the socket; onclose retries with backoff
      helloed = true;
      attempt = 0;
      void chrome.alarms.clear(OFFLINE_END_ALARM);
      startPing();
      scheduleWindows();
    } else if (helloed) {
      void onState(msg);
    }
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null;
    helloed = false;
    stopPing();
    void applyOffline();
    scheduleRetry();
  };
  sock.onerror = () => { /* onclose follows */ };
}

function scheduleRetry(): void {
  if (retryTimer) return;
  const delay = backoffMs(attempt++);
  retryTimer = setTimeout(() => { retryTimer = null; void connect(); }, delay);
}

function reconnectNow(): void {
  attempt = 0;
  const old = ws;
  ws = null;
  helloed = false;
  stopPing();
  if (old) { old.onclose = null; old.close(); }
  void connect();
}

function startPing(): void {
  stopPing();
  pingTimer = setInterval(() => send({ t: 'ping' }), PING_MS);
}

function stopPing(): void {
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
}

// ---------- window reports ----------

function scheduleWindows(): void {
  if (windowsTimer) clearTimeout(windowsTimer);
  windowsTimer = setTimeout(() => { windowsTimer = null; void sendWindows(); }, WINDOWS_DEBOUNCE_MS);
}

async function sendWindows(): Promise<void> {
  if (!helloed) return;
  const wins = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
  send({ t: 'windows', windows: windowReports(wins) });
}

// ---------- listeners (registered synchronously so a restarted worker receives its wake event) ----------

chrome.tabs.onActivated.addListener(scheduleWindows);
chrome.tabs.onUpdated.addListener((_id, change) => { if (change.title !== undefined) scheduleWindows(); });
chrome.tabs.onRemoved.addListener(scheduleWindows);
chrome.windows.onFocusChanged.addListener(scheduleWindows);
chrome.windows.onCreated.addListener(scheduleWindows);
chrome.windows.onRemoved.addListener(scheduleWindows);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM) void connect();
  else if (alarm.name === OFFLINE_END_ALARM) void applyOffline();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'secret' in changes) { badCode = false; reconnectNow(); }
});

type PageMessage = { t: 'slip'; target: unknown } | { t: 'status' } | { t: 'recheck' };

chrome.runtime.onMessage.addListener((msg: PageMessage, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (msg?.t === 'slip') {
    // Only the blocked page reports slips, and only of this kind. Dropped if disconnected.
    if (typeof msg.target === 'string' && sender.url?.startsWith(chrome.runtime.getURL('/blocked.html'))) {
      send({ t: 'slip', reason: 'hard-block-visit', target: msg.target.slice(0, 500) });
    }
    return false;
  }
  if (msg?.t === 'status') {
    void loadSecret().then((secret) => reply({ connected: helloed, paired: secret !== null, badCode }));
    return true;
  }
  if (msg?.t === 'recheck') {
    void chrome.extension.isAllowedIncognitoAccess().then((allowed) => {
      if (helloed && allowed !== helloIncognito) reconnectNow(); // re-hello so the desktop learns
      reply({ incognitoAllowed: allowed });
    });
    return true;
  }
  return false;
});

chrome.runtime.onStartup.addListener(() => { /* waking the worker runs the startup code below */ });
chrome.runtime.onInstalled.addListener(() => { /* ditto */ });

// ---------- startup ----------

void chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 1 });
void connect();

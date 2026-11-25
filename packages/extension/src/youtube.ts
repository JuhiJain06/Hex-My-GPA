// Content script on *://*.youtube.com/* (document_start, top frame only).
// State {blocking, topic, studyVideos} arrives from the background over a `yt` port; the port is
// re-opened whenever it drops (service-worker restart), and the background re-sends on connect.
import {
  StudyPrompt, canAsk, isShorts, mountPromptCard, setHideCss, videoIdOf, type PromptCard, type YtState,
} from './youtubeLogic';

const TICK_MS = 1000;
const RECONNECT_MS = 1000;

let state: YtState = { blocking: false, topic: null, studyVideos: [] };
// Asks start/time out only while the card can be seen: tab visible and no fullscreen video
// (no slips for a prompt nobody could see).
const prompt = new StudyPrompt(() => Date.now(), () => canAsk(document));
let card: PromptCard | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
let leaving = false; // redirecting away from Shorts: report once
let dead = false; // extension reloaded/uninstalled: this script's context is gone

function post(msg: object): void {
  if (dead) return;
  try { void chrome.runtime.sendMessage(msg).catch(() => {}); } catch { dead = true; }
}

function getCard(): PromptCard {
  card ??= mountPromptCard(document, onAnswer);
  return card;
}

function onAnswer(study: boolean): void {
  let res;
  try { res = prompt.answer(study); } catch { card?.hide(); return; } // stale click
  card?.hide();
  if ('study' in res) post({ type: 'yt-study', videoId: res.study });
  else {
    post({ type: 'yt-slip', reason: res.slip, target: 'youtube.com' });
    getCard().remind(state.topic);
  }
}

function onTick(): void {
  const r = prompt.tick();
  if (r === 'timeout') {
    card?.hide();
    post({ type: 'yt-slip', reason: 'youtube-timeout', target: 'youtube.com' });
    getCard().remind(state.topic);
  } else if (r === 'reask') {
    getCard().show();
  }
}

function stopTicker(): void {
  if (ticker) { clearInterval(ticker); ticker = null; }
}

/** Re-evaluates the page against the current state; called on state pushes and navigations. */
function evaluate(): void {
  if (!state.blocking) {
    setHideCss(document, false);
    prompt.reset();
    card?.hide();
    card?.hideReminder();
    stopTicker();
    return;
  }
  setHideCss(document, true);
  if (isShorts(location.href)) {
    if (leaving) return;
    leaving = true;
    // SPA navigation into Shorts that DNR never sees: back to the (emptied) home page.
    post({ type: 'yt-slip', reason: 'hard-block-visit', target: 'youtube.com/shorts' });
    prompt.reset();
    card?.hide();
    location.replace('/');
    return;
  }
  ticker ??= setInterval(onTick, TICK_MS);
  if (prompt.onVideo(videoIdOf(location.href), state.studyVideos) === 'show') getCard().show();
  else card?.hide();
}

function isYtState(v: unknown): v is YtState {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.blocking === 'boolean' && (o.topic === null || typeof o.topic === 'string')
    && Array.isArray(o.studyVideos) && o.studyVideos.every((x) => typeof x === 'string');
}

function connectPort(): void {
  if (dead) return;
  let port: chrome.runtime.Port;
  try { port = chrome.runtime.connect({ name: 'yt' }); } catch { dead = true; return; }
  port.onMessage.addListener((msg: unknown) => {
    if (!isYtState(msg)) return;
    state = { blocking: msg.blocking, topic: msg.topic, studyVideos: [...msg.studyVideos] };
    evaluate();
  });
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError; // silence "Receiving end does not exist"
    if (!chrome.runtime?.id) { dead = true; return; } // context invalidated: stop for good
    setTimeout(connectPort, RECONNECT_MS);
  });
}

// YouTube is an SPA: yt-navigate-finish fires after in-app navigations; popstate for back/forward.
document.addEventListener('yt-navigate-finish', evaluate);
window.addEventListener('popstate', evaluate);
function onSeeable(): void {
  if (!state.blocking) return;
  if (prompt.onVisibility() === 'show') getCard().show();
  else card?.hide();
}
document.addEventListener('visibilitychange', onSeeable);
document.addEventListener('fullscreenchange', onSeeable);
connectPort();

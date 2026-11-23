// Pure-ish YouTube rules shared by the content script (youtube.ts) and the background worker.
import type { DesktopToExt, ExtToDesktop } from '@study-buddy/core';
import { shouldBlockOffline } from './rules';

type StateMsg = Extract<DesktopToExt, { t: 'state' }>;

export const VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/;
export const PROMPT_TIMEOUT_MS = 30_000;
export const REASK_MS = 5 * 60_000;

function parseUrl(url: string): URL | null {
  try { return new URL(url); } catch { return null; }
}

export function isYoutubeHost(host: string): boolean {
  return host === 'youtube.com' || host.endsWith('.youtube.com');
}

/** Video id from a `/watch?v=` URL only (no embeds, shorts or youtu.be). */
export function videoIdOf(url: string): string | null {
  const u = parseUrl(url);
  if (!u || u.pathname !== '/watch') return null;
  const v = u.searchParams.get('v');
  return v !== null && VIDEO_ID.test(v) ? v : null;
}

export function isShorts(url: string): boolean {
  const u = parseUrl(url);
  return !!u && (u.pathname === '/shorts' || u.pathname.startsWith('/shorts/'));
}

export const HIDE_CSS = [
  'ytd-browse[page-subtype="home"] #contents',
  '#related',
  '#secondary ytd-watch-next-secondary-results-renderer',
  '.ytp-endscreen-content',
  '.ytp-ce-element',
  'ytd-reel-shelf-renderer',
  'ytd-rich-shelf-renderer[is-shorts]',
].join(',\n') + ' { display: none !important; }';

/** Adds (once) or removes the HIDE_CSS style element. Works before <head> exists. */
export function setHideCss(doc: Document, on: boolean): void {
  const existing = doc.querySelector('style[data-study-buddy]');
  if (!on) { existing?.remove(); return; }
  if (existing) return;
  const style = doc.createElement('style');
  style.setAttribute('data-study-buddy', '');
  style.textContent = HIDE_CSS;
  (doc.head ?? doc.documentElement).appendChild(style);
}

type PromptPhase = 'idle' | 'asking' | 'waiting' | 'done';

/**
 * Per-tab "Is this for study?" state for the current video.
 * asking: card visible, times out after 30 s; waiting: after a no/timeout, re-asks 5 min later;
 * done: answered yes (or known study video). Navigating to another video starts over.
 */
export class StudyPrompt {
  private video: string | null = null;
  private phase: PromptPhase = 'idle';
  private since = 0; // asking: when shown; waiting: when the re-ask is due
  private readonly studied = new Set<string>();

  constructor(private readonly clock: () => number) {}

  onVideo(id: string | null, studyVideos: string[]): 'show' | 'none' {
    if (id === null || this.studied.has(id) || studyVideos.includes(id)) {
      this.video = id;
      this.phase = id === null ? 'idle' : 'done';
      return 'none';
    }
    if (id === this.video && this.phase !== 'idle') return this.phase === 'asking' ? 'show' : 'none';
    this.video = id;
    this.ask();
    return 'show';
  }

  answer(study: boolean): { slip: 'youtube-not-study' } | { study: string } {
    if (this.phase !== 'asking' || this.video === null) throw new Error('no open prompt');
    if (study) {
      this.studied.add(this.video);
      this.phase = 'done';
      return { study: this.video };
    }
    this.arm();
    return { slip: 'youtube-not-study' };
  }

  tick(): 'timeout' | 'reask' | null {
    const now = this.clock();
    if (this.phase === 'asking' && now - this.since >= PROMPT_TIMEOUT_MS) { this.arm(); return 'timeout'; }
    if (this.phase === 'waiting' && now >= this.since) { this.ask(); return 'reask'; }
    return null;
  }

  /** Blocking ended: forget the current video and stop timing (the studied set is kept). */
  reset(): void {
    this.video = null;
    this.phase = 'idle';
  }

  private ask(): void { this.phase = 'asking'; this.since = this.clock(); }
  private arm(): void { this.phase = 'waiting'; this.since = this.clock() + REASK_MS; }
}

export interface PromptCard {
  host: HTMLElement;
  yes: HTMLButtonElement;
  no: HTMLButtonElement;
  show(): void;
  hide(): void;
  visible(): boolean;
  text(): string;
  remove(): void;
}

const CARD_CSS = `
:host { all: initial; }
.card { position: fixed; left: 16px; bottom: 16px; z-index: 2147483647; display: flex; align-items: center;
  gap: 10px; padding: 10px 14px; border-radius: 10px; background: #1f2937; color: #f9fafb;
  font: 14px/1.3 system-ui, sans-serif; box-shadow: 0 4px 16px rgba(0,0,0,.35); }
.card[hidden] { display: none; }
button { font: inherit; cursor: pointer; border: 0; border-radius: 6px; padding: 4px 12px; }
.yes { background: #22c55e; color: #052e16; }
.no { background: #4b5563; color: #f9fafb; }`;

/** A small fixed bottom-left card in a closed shadow root. Static text only; never touches the video. */
export function mountPromptCard(doc: Document, onAnswer: (study: boolean) => void): PromptCard {
  const host = doc.createElement('study-buddy-prompt');
  const root = host.attachShadow({ mode: 'closed' });
  const style = doc.createElement('style');
  style.textContent = CARD_CSS;
  const card = doc.createElement('div');
  card.className = 'card';
  card.hidden = true;
  card.setAttribute('role', 'dialog');
  const label = doc.createElement('span');
  label.textContent = 'Is this for study?';
  const yes = doc.createElement('button');
  yes.className = 'yes';
  yes.textContent = 'Yes';
  const no = doc.createElement('button');
  no.className = 'no';
  no.textContent = 'No';
  yes.addEventListener('click', (e) => { e.stopPropagation(); onAnswer(true); });
  no.addEventListener('click', (e) => { e.stopPropagation(); onAnswer(false); });
  card.append(label, yes, no);
  root.append(style, card);
  doc.documentElement.appendChild(host);
  return {
    host, yes, no,
    show: () => {
      if (!host.isConnected) doc.documentElement.appendChild(host); // YouTube may rebuild the DOM
      card.hidden = false;
    },
    hide: () => { card.hidden = true; },
    visible: () => !card.hidden,
    text: () => card.textContent ?? '',
    remove: () => host.remove(),
  };
}

export interface YtState { blocking: boolean; topic: string | null; studyVideos: string[] }

/** What the background pushes to YouTube tabs: live state when connected, else offline rules. */
export function ytStateFor(last: StateMsg | null, connected: boolean, now: number): YtState {
  if (!last) return { blocking: false, topic: null, studyVideos: [] };
  const blocking = connected ? last.blocking : shouldBlockOffline(last, now);
  return { blocking, topic: last.topic, studyVideos: [...last.studyVideos] };
}

export interface YtSender { tab?: { id?: number }; frameId?: number; url?: string }

const SLIP_TARGETS: Record<string, string> = {
  'youtube-not-study': 'youtube.com',
  'youtube-timeout': 'youtube.com',
  'hard-block-visit': 'youtube.com/shorts',
};

/** Validates a message from the YouTube content script into a desktop-bound message, or null. */
export function parseYtMessage(msg: unknown, sender: YtSender): ExtToDesktop | null {
  if (!sender.tab || sender.frameId !== 0 || typeof sender.url !== 'string') return null;
  const u = parseUrl(sender.url);
  if (!u || !isYoutubeHost(u.hostname)) return null;
  if (typeof msg !== 'object' || msg === null) return null;
  const o = msg as Record<string, unknown>;
  if (o.type === 'yt-study') {
    return typeof o.videoId === 'string' && VIDEO_ID.test(o.videoId) ? { t: 'videoStudy', videoId: o.videoId } : null;
  }
  if (o.type === 'yt-slip') {
    const reason = o.reason;
    if (typeof reason !== 'string' || !Object.hasOwn(SLIP_TARGETS, reason) || o.target !== SLIP_TARGETS[reason]) return null;
    return { t: 'slip', reason: reason as 'youtube-not-study' | 'youtube-timeout' | 'hard-block-visit', target: o.target };
  }
  return null;
}

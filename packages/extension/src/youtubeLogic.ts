// Pure-ish YouTube rules shared by the content script (youtube.ts) and the background worker.
import { SHADOW_TOKENS_CSS } from '@study-buddy/core/theme/tokensCss';
import type { DesktopToExt, ExtToDesktop } from '@study-buddy/core';
import { shouldBlockOffline } from './rules';

type StateMsg = Extract<DesktopToExt, { t: 'state' }>;

export const VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/;
export const PROMPT_TIMEOUT_MS = 30_000;
export const REASK_MS = 5 * 60_000;
export const REMINDER_MS = 8_000;
const MAX_TOPIC = 80;

/** "Back to <topic>?" shown after a no / timeout; generic when there is no topic. */
export function reminderText(topic: string | null): string {
  const t = (topic ?? '').trim().slice(0, MAX_TOPIC);
  return t === '' ? 'Back to studying?' : `Back to ${t}?`;
}

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

/**
 * Whether the "Is this for study?" card can be seen: the tab is visible and no element is
 * fullscreen (the card is mounted on the page, so a fullscreen video hides it).
 */
export function canAsk(doc: { visibilityState: string; fullscreenElement: Element | null }): boolean {
  return doc.visibilityState === 'visible' && doc.fullscreenElement === null;
}

type PromptPhase = 'idle' | 'deferred' | 'asking' | 'waiting' | 'done';

/**
 * Per-tab "Is this for study?" state for the current video.
 * asking: card visible, times out after 30 s; waiting: after a no/timeout, re-asks 5 min later;
 * done: answered yes (or known study video). Navigating to another video starts over.
 * Asks only happen while `visible()`: a hidden tab defers the ask (deferred), and the 30 s window
 * starts fresh when the tab is shown again, so nobody is timed out on a tab they can't see.
 */
export class StudyPrompt {
  private video: string | null = null;
  private phase: PromptPhase = 'idle';
  private since = 0; // asking: when shown; waiting: when the re-ask is due
  private readonly studied = new Set<string>();

  constructor(private readonly clock: () => number, private readonly visible: () => boolean = () => true) {}

  onVideo(id: string | null, studyVideos: string[]): 'show' | 'none' {
    if (id === null || this.studied.has(id) || studyVideos.includes(id)) {
      this.video = id;
      this.phase = id === null ? 'idle' : 'done';
      return 'none';
    }
    if (id === this.video && this.phase !== 'idle') return this.onVisibility();
    this.video = id;
    this.phase = 'deferred';
    return this.onVisibility();
  }

  /** Call on visibilitychange: hidden defers an open ask; visible starts a deferred/due one. */
  onVisibility(): 'show' | 'none' {
    if (!this.visible()) {
      if (this.phase === 'asking') this.phase = 'deferred';
      return 'none';
    }
    if (this.phase === 'deferred' || (this.phase === 'waiting' && this.clock() >= this.since)) this.ask();
    return this.phase === 'asking' ? 'show' : 'none';
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
    if (!this.visible()) {
      if (this.phase === 'asking') this.phase = 'deferred';
      return null;
    }
    const now = this.clock();
    if (this.phase === 'deferred') { this.ask(); return 'reask'; }
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
  dismiss: HTMLButtonElement;
  /** Shows the non-blocking "Back to <topic>?" note; auto-dismisses after REMINDER_MS. */
  remind(topic: string | null): void;
  hideReminder(): void;
  reminderVisible(): boolean;
  reminderText(): string;
}

// The shared theme tokens (with :root → :host) come first; the page's own styles can't reach in.
const CARD_CSS = `${SHADOW_TOKENS_CSS}
:host { all: initial; }
.card { position: fixed; left: 16px; bottom: 16px; z-index: 2147483647; display: flex; align-items: center;
  gap: 10px; padding: 10px 14px; border-radius: var(--radius); background: var(--card); color: var(--text);
  border: 1px solid var(--line); font: 600 14px/1.3 var(--font); box-shadow: var(--shadow); }
.card[hidden] { display: none; }
button { font: inherit; font-weight: 700; cursor: pointer; border: 0; border-radius: var(--radius-sm); padding: 4px 14px; }
button:focus-visible { outline: 2px solid var(--accent-text); outline-offset: 2px; }
.yes { background: var(--accent); color: var(--on-accent); }
.no { background: var(--panel); color: var(--text); border: 1px solid var(--line); }
.remind { background: var(--lavender); color: var(--on-lavender); border-color: var(--lavender); }
.x { background: transparent; color: inherit; padding: 0 4px; font-size: 16px; line-height: 1; }`;

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

  const reminder = doc.createElement('div');
  reminder.className = 'card remind';
  reminder.hidden = true;
  reminder.setAttribute('role', 'status');
  const remindLabel = doc.createElement('span');
  const dismiss = doc.createElement('button');
  dismiss.className = 'x';
  dismiss.textContent = '×';
  dismiss.setAttribute('aria-label', 'Dismiss');
  reminder.append(remindLabel, dismiss);

  const win = doc.defaultView ?? globalThis;
  let remindTimer: ReturnType<typeof setTimeout> | null = null;
  const hideReminder = (): void => {
    if (remindTimer !== null) { win.clearTimeout(remindTimer); remindTimer = null; }
    reminder.hidden = true;
  };
  dismiss.addEventListener('click', (e) => { e.stopPropagation(); hideReminder(); });

  root.append(style, card, reminder);
  doc.documentElement.appendChild(host);
  const attach = (): void => { if (!host.isConnected) doc.documentElement.appendChild(host); }; // YouTube may rebuild the DOM
  return {
    host, yes, no, dismiss,
    show: () => {
      attach();
      hideReminder();
      card.hidden = false;
    },
    remind: (topic) => {
      attach();
      hideReminder();
      remindLabel.textContent = reminderText(topic);
      reminder.hidden = false;
      remindTimer = win.setTimeout(hideReminder, REMINDER_MS);
    },
    hideReminder,
    reminderVisible: () => !reminder.hidden,
    reminderText: () => remindLabel.textContent ?? '',
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

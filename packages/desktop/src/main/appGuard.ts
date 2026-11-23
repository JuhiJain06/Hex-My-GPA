import { BROWSER_EXES, classifyApp, type EngineEvent, type Lists } from '@study-buddy/core';
import type { SessionController } from './controller';
import type { OfferAnswerMsg, PromptAnswerMsg } from '../shared/ipc';

export interface Foreground { exe: string; title: string; pid: number }

export interface GuardUi {
  showOverlay(reason: { label: string; until: number | null }): void;
  hideOverlay(): void;
  showPrompt(exe: string): void;
  hidePrompt(): void;
  showOffer(exe: string): void;
}

export type OfferChoice = 'block' | 'fine' | 'later';

export const BROWSER_LABEL = 'Browser without Study Buddy';
/** An uncovered browser is tolerated this long (the extension may still be connecting). */
const BROWSER_GRACE_MS = 3_000;
const PROMPT_TIMEOUT_MS = 30_000;
const REASK_MS = 5 * 60_000;
const OFFER_AFTER_MS = 2 * 60_000;

/**
 * Watches the foreground app while blocking is active (unbypassed focus):
 * - hard-listed apps get the full-screen overlay and one slip per foreground entry;
 * - gray-listed apps get an "Is this for study?" prompt (no / 30 s timeout → slip, re-ask after 5 min;
 *   yes → silent for the rest of the block);
 * - unlisted apps used for 2 min (cumulative, per block) get a one-per-session "block it?" offer;
 * - browsers skip the lists and are overlaid when `coverage` says no extension covers them for > 3 s.
 * Study Buddy's own windows are ignored: they hide the overlay but keep the last real foreground.
 * Pure logic: windows go through `ui`, list changes through `updateApps`. Driven by `tick()` every second.
 */
export class AppGuard {
  private readonly isOwn: (pid: number) => boolean;
  /** Last foreground that was not ours. */
  private cur: Foreground | null = null;
  private ownFront = false;
  /** Whether a slip was already logged for the current entry in this block. */
  private entrySlipped = false;
  private overlayKey: string | null = null;
  private browserUncoveredSince: number | null = null;
  private prompt: { exe: string; at: number } | null = null;
  /** Per block: gray exes answered "yes", and when each other gray exe may be asked again. */
  private silenced = new Set<string>();
  private askAfter = new Map<string, number>();
  /** Per block: ms each unlisted exe has been in front while blocking. */
  private unlistedMs = new Map<string, number>();
  private lastAccountAt: number;
  /** Per session: exes offered, and offers still awaiting an answer. */
  private offered = new Set<string>();
  private pendingOffers = new Set<string>();

  constructor(
    private readonly ctrl: SessionController,
    private readonly ui: GuardUi,
    private readonly getApps: () => Lists,
    private readonly coverage: (fg: { exe: string; title: string }) => boolean,
    ownPid: number | ((pid: number) => boolean),
    private readonly clock: () => number,
    private readonly updateApps: (fn: (apps: Lists) => Lists) => void = () => {},
  ) {
    this.isOwn = typeof ownPid === 'number' ? (pid) => pid === ownPid : ownPid;
    this.lastAccountAt = clock();
    ctrl.on('engine', (e: EngineEvent) => {
      if (e.type === 'focusStarted' || e.type === 'breakStarted') this.resetBlock();
      if (e.type === 'sessionEnded') {
        this.resetBlock();
        this.offered.clear();
        this.pendingOffers.clear();
      }
      this.evaluate();
    });
  }

  onForeground(fg: Foreground | null): void {
    this.account();
    if (fg && this.isOwn(fg.pid)) {
      this.ownFront = true;
    } else {
      this.ownFront = false;
      if (!fg || !this.cur || fg.exe !== this.cur.exe) {
        this.entrySlipped = false;
        this.browserUncoveredSince = null;
      }
      this.cur = fg;
    }
    this.evaluate();
  }

  tick(): void {
    this.account();
    this.evaluate();
  }

  answerPrompt(exe: string, study: boolean): void {
    if (!this.prompt || this.prompt.exe !== exe) return;
    this.closePrompt();
    if (study) this.silenced.add(exe);
    else this.refused(exe);
    this.evaluate();
  }

  answerOffer(exe: string, choice: OfferChoice): void {
    if (!this.pendingOffers.delete(exe)) return;
    if (choice === 'block') this.updateApps((a) => moveTo(a, 'hard', exe));
    else if (choice === 'fine') this.updateApps((a) => moveTo(a, 'fine', exe));
    this.evaluate();
  }

  private get blocking(): boolean {
    return this.ctrl.sessionId !== null && this.ctrl.engine.blockingActive;
  }

  /** How the guard treats `exe`: browsers skip the lists (coverage decides). */
  classify(exe: string): 'browser' | 'fine' | 'gray' | 'hard' | 'unlisted' {
    if (BROWSER_EXES.includes(exe)) return 'browser';
    return classifyApp(exe, this.getApps());
  }

  /** Credits time since the last call to the current unlisted app (blocking only). */
  private account(): void {
    const now = this.clock();
    const elapsed = now - this.lastAccountAt;
    this.lastAccountAt = now;
    const fg = this.front();
    if (!fg || elapsed <= 0 || !this.blocking || this.classify(fg.exe) !== 'unlisted') return;
    this.unlistedMs.set(fg.exe, (this.unlistedMs.get(fg.exe) ?? 0) + elapsed);
  }

  /** The real foreground, or null when nothing / our own window is in front. */
  private front(): Foreground | null {
    return this.ownFront ? null : this.cur;
  }

  private evaluate(): void {
    const now = this.clock();
    const blocking = this.blocking;

    if (this.prompt && !blocking) this.closePrompt();
    if (this.prompt && now - this.prompt.at >= PROMPT_TIMEOUT_MS) {
      const { exe } = this.prompt;
      this.closePrompt();
      this.refused(exe);
    }

    const fg = this.front();
    let overlay: string | null = null;
    if (fg && blocking) {
      const kind = this.classify(fg.exe);
      if (kind === 'hard') {
        overlay = fg.exe;
        if (!this.entrySlipped) {
          this.entrySlipped = true;
          this.slip(fg.exe);
        }
      } else if (kind === 'browser') {
        if (this.coverage(fg)) this.browserUncoveredSince = null;
        else {
          this.browserUncoveredSince ??= now;
          if (now - this.browserUncoveredSince > BROWSER_GRACE_MS) overlay = BROWSER_LABEL;
        }
      } else if (kind === 'gray') {
        if (!this.prompt && !this.silenced.has(fg.exe) && now >= (this.askAfter.get(fg.exe) ?? -Infinity)) {
          this.prompt = { exe: fg.exe, at: now };
          this.ui.showPrompt(fg.exe);
        }
      } else if (kind === 'unlisted') {
        if (!this.offered.has(fg.exe) && (this.unlistedMs.get(fg.exe) ?? 0) >= OFFER_AFTER_MS) {
          this.offered.add(fg.exe);
          this.pendingOffers.add(fg.exe);
          this.ui.showOffer(fg.exe);
        }
      }
    }
    this.setOverlay(overlay);
  }

  private setOverlay(label: string | null): void {
    const until = this.ctrl.engine.state.phaseEndsAt;
    const key = label === null ? null : `${label}|${until}`;
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    if (label === null) this.ui.hideOverlay();
    else this.ui.showOverlay({ label, until });
  }

  private closePrompt(): void {
    this.prompt = null;
    this.ui.hidePrompt();
  }

  /** A gray app the user did not claim as study: slip now, ask again in 5 min. */
  private refused(exe: string): void {
    this.slip(exe);
    this.askAfter.set(exe, this.clock() + REASK_MS);
  }

  private slip(exe: string): void {
    this.ctrl.logEvent({ kind: 'slip', target: exe, detail: null });
  }

  private resetBlock(): void {
    this.entrySlipped = false;
    this.browserUncoveredSince = null;
    this.silenced.clear();
    this.askAfter.clear();
    this.unlistedMs.clear();
    this.lastAccountAt = this.clock();
  }
}

/** Puts `exe` on exactly one list. */
function moveTo(apps: Lists, level: keyof Lists, exe: string): Lists {
  const without = (l: string[]) => l.filter((e) => e.toLowerCase() !== exe);
  const next: Lists = { fine: without(apps.fine), gray: without(apps.gray), hard: without(apps.hard) };
  next[level] = [...next[level], exe];
  return next;
}

/** An exe basename as the foreground poller reports it (lowercase, `.exe`). */
const EXE_RE = /^[^\\/:*?"<>|]{1,255}\.exe$/;
const parseExe = (v: unknown): string | null =>
  typeof v === 'string' && EXE_RE.test(v) && v === v.toLowerCase() ? v : null;

export function parsePromptAnswer(p: unknown): PromptAnswerMsg | null {
  if (typeof p !== 'object' || p === null) return null;
  const r = p as Record<string, unknown>;
  const exe = parseExe(r.exe);
  return exe && typeof r.study === 'boolean' ? { exe, study: r.study } : null;
}

export function parseOfferAnswer(p: unknown): OfferAnswerMsg | null {
  if (typeof p !== 'object' || p === null) return null;
  const r = p as Record<string, unknown>;
  const exe = parseExe(r.exe);
  return exe && (r.choice === 'block' || r.choice === 'fine' || r.choice === 'later') ? { exe, choice: r.choice } : null;
}

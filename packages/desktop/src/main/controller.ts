import { EventEmitter } from 'node:events';
import {
  SessionEngine,
  dailyTotals,
  toAnimal,
  localDay,
  pickSuggestion,
  streak,
  type Animal,
  type BuddyEvent,
  type EngineEvent,
  type Phase,
  type Rhythm,
  type SessionInfo,
} from '@study-buddy/core';
import type { Db } from './db';
import type { UiState } from '../shared/ipc';

export type { UiState } from '../shared/ipc';

const HEARTBEAT_MS = 15_000;
const STREAK_LOOKBACK_DAYS = 60;

export interface ControllerOptions {
  /** Overrides settings.rhythm (fast mode). */
  rhythm?: Rhythm;
  rand?: () => number;
}

function startOfDay(ms: number, daysBack = 0): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysBack).getTime();
}

/**
 * Owns the SessionEngine for the running session: persists snapshots (the heartbeat),
 * turns engine events into db events, and derives the UiState the windows render.
 * Emits 'engine' (EngineEvent), 'ui' (UiState) and 'slip' (timestamp of each logged slip).
 */
export class SessionController extends EventEmitter {
  private eng: SessionEngine;
  private id: number | null = null;
  private lastSaveAt = 0;
  private suggestion: string | null = null;
  private lastSuggestion: string | null = null;
  private extConnected = false;
  private bridgeOk = true;
  private videos: string[] = [];
  /** Finished-session intervals from the db for the streak window; refreshed per day and after end(). */
  private history: { day: string; intervals: [number, number][] } | null = null;

  constructor(private readonly db: Db, private readonly clock: () => number, private readonly opts: ControllerOptions = {}) {
    super();
    this.eng = new SessionEngine(this.rhythm());
  }

  get engine(): SessionEngine { return this.eng; }
  get sessionId(): number | null { return this.id; }

  /**
   * Picks up the session left in the db by a previous run. The app died mid-session if the watchdog
   * relaunched us (`byWatchdog`) or the session flag was still there at startup (`flagLeftover`:
   * both processes killed, or relaunched by hand first); a resumed session then logs exactly one
   * `app-closed` bypass. A stale session (the PC was off) is closed at its heartbeat and never counts.
   */
  restore(opts: { byWatchdog?: boolean; flagLeftover?: boolean } = {}): 'none' | 'resumed' | 'staleEnded' {
    const now = this.clock();
    const active = this.db.activeSession(now);
    if (!active) return 'none';
    const engine = new SessionEngine(this.rhythm(), active.snapshot);
    if (active.stale || !active.snapshot.phase) {
      // Crash/reboot long ago: close the session at its last heartbeat. Never a bypass.
      engine.end(active.heartbeatAt);
      this.safe('finishSession', () => this.db.finishSession(active.id, engine.state, active.heartbeatAt));
      this.history = null;
      this.emitUi();
      return 'staleEnded';
    }
    this.eng = engine;
    this.id = active.id;
    const s = engine.state;
    if (s.phase === 'break' || s.phase === 'awaitingNext') {
      this.setSuggestion(s.breakCount % this.rhythm().longBreakEvery === 0);
    }
    this.lastSaveAt = now;
    if (opts.byWatchdog || opts.flagLeftover) this.logEvent({ kind: 'bypass', target: 'app-closed', detail: null });
    this.tick();
    return 'resumed';
  }

  start(info: Omit<SessionInfo, 'startedAt'>): void {
    const now = this.clock();
    if (this.id !== null) this.end();
    this.eng = new SessionEngine(this.rhythm());
    this.suggestion = null;
    this.videos = [];
    const events = this.eng.start(info, now);
    this.id = this.db.createSession(this.eng.state.session!);
    this.after(events, true);
  }

  tick(): void {
    if (this.id === null) return;
    const before = this.eng.state.phase;
    const events = this.eng.tick(this.clock());
    this.after(events, before !== this.eng.state.phase);
  }

  nextBlock(): void { this.act((now) => this.eng.startNextBlock(now)); }
  endBlockEarly(): void { this.act((now) => this.eng.endBlockEarly(now)); }
  extend(): void { this.act((now) => this.eng.extendBlock(now)); }
  pause(since: number): void { this.act((now) => this.eng.pause(since, now)); }
  resume(): void { this.act((now) => this.eng.resume(now)); }

  /** The bypass sentence: on success blocking is off until the next block, logged as a `blocking-turned-off` bypass. */
  turnOffBlocking(sentence: string): boolean {
    let ok = false;
    this.act((now) => {
      const ev = this.eng.turnOffBlocking(sentence, now);
      ok = ev.length > 0;
      if (ok) this.logEvent({ kind: 'bypass', target: 'blocking-turned-off', detail: null });
      return ev;
    });
    return ok;
  }

  /** Ends the session, writes it to the db and returns its id. The controller goes back to idle. */
  end(): number {
    const id = this.id;
    if (id === null) throw new Error('No active session');
    const now = this.clock();
    const events = this.eng.end(now);
    this.safe('finishSession', () => this.db.finishSession(id, this.eng.state, now));
    for (const e of events) this.emit('engine', e);
    this.id = null;
    this.suggestion = null;
    this.videos = [];
    this.eng = new SessionEngine(this.rhythm());
    this.history = null;
    this.emitUi();
    return id;
  }

  /**
   * Logs an event for the running session. Slips count only while they can be real: a blocked
   * site/app/video slip needs active, unpaused blocking (not breaks, awaitingNext, the turn-off
   * sentence or a pause); a check-in "drifted" slip needs unpaused focus (check-ins continue after
   * the sentence). Anything else is dropped.
   */
  logEvent(e: Omit<BuddyEvent, 'at'>): void {
    const id = this.id;
    if (id === null) return;
    if (e.kind === 'slip' && !this.slipAllowed(e.target)) return;
    const at = this.clock();
    this.safe('addEvent', () => this.db.addEvent(id, { ...e, at }));
    if (e.kind === 'slip') this.emit('slip', at);
  }

  private slipAllowed(target: string | null): boolean {
    const s = this.eng.state;
    if (s.pausedSince !== null) return false;
    return target === 'check-in' ? s.phase === 'focus' : this.eng.blockingActive;
  }

  /** Re-emits the UiState (after settings changed, e.g. a new study buddy). */
  refreshUi(): void { this.emitUi(); }

  /** Changes the session topic (check-in "switched topic"). Ignores blank input. */
  setTopic(topic: string): void {
    const t = topic.trim().slice(0, 200);
    const session = this.eng.state.session;
    if (this.id === null || !session || !t) return;
    session.topic = t;
    this.save(this.clock());
    this.emitUi();
  }

  /** YouTube video ids the user marked as study material this session. */
  studyVideos(): string[] { return [...this.videos]; }

  addStudyVideo(id: string): void {
    if (this.id === null || !id || this.videos.includes(id)) return;
    this.videos.push(id);
  }

  setExtensionConnected(connected: boolean): void {
    if (connected === this.extConnected) return;
    this.extConnected = connected;
    this.emitUi();
  }

  /** False when the extension bridge could not listen (port in use): shown by the pet. */
  setBridgeListening(ok: boolean): void {
    if (ok === this.bridgeOk) return;
    this.bridgeOk = ok;
    this.emitUi();
  }

  uiState(): UiState {
    const now = this.clock();
    const s = this.eng.state;
    const totals = this.totals(now);
    const today = localDay(now);
    let streakMin = 120;
    let animal: Animal = 'cat';
    let showBubble = true;
    try {
      const settings = this.db.getSettings();
      streakMin = settings.streakMinMinutes;
      animal = toAnimal(settings.animal);
      showBubble = settings.pet?.showBubble !== false;
    } catch { /* keep defaults */ }
    const phase: Phase = s.phase;
    return {
      phase,
      topic: s.session?.topic ?? null,
      phaseEndsAt: s.phaseEndsAt,
      pausedSince: s.pausedSince,
      todayMs: totals.get(today) ?? 0,
      streakDays: streak(totals, today, streakMin),
      blockingActive: this.id !== null && this.eng.blockingActive,
      extensionConnected: this.extConnected,
      bridgeListening: this.bridgeOk,
      suggestion: phase === 'break' || phase === 'awaitingNext' ? this.suggestion : null,
      animal,
      showBubble,
    };
  }

  private rhythm(): Rhythm {
    if (this.opts.rhythm) return this.opts.rhythm;
    try { return this.db.getSettings().rhythm; } catch (err) {
      console.error('[controller] getSettings failed', err);
      return { focusMin: 45, shortBreakMin: 10, longBreakMin: 25, longBreakEvery: 3 };
    }
  }

  /** Intervals of the running session, including the open focus stretch; empty when idle. */
  liveIntervals(now: number = this.clock()): [number, number][] {
    if (this.id === null) return [];
    const s = this.eng.state;
    const out: [number, number][] = [...s.intervals];
    if (s.phase === 'focus' && s.pausedSince === null && s.openFocusSince !== null && now > s.openFocusSince) {
      out.push([s.openFocusSince, now]);
    }
    return out;
  }

  private totals(now: number): Map<string, number> {
    const day = localDay(now);
    if (!this.history || this.history.day !== day) {
      let intervals: [number, number][] = [];
      try { intervals = this.db.intervalsSince(startOfDay(now, STREAK_LOOKBACK_DAYS)); } catch (err) {
        console.error('[controller] intervalsSince failed', err);
      }
      this.history = { day, intervals };
    }
    const all = [...this.history.intervals, ...this.liveIntervals(now)];
    return dailyTotals(all);
  }

  private act(fn: (now: number) => EngineEvent[]): void {
    if (this.id === null) return;
    this.after(fn(this.clock()), true);
  }

  private after(events: EngineEvent[], save: boolean): void {
    for (const e of events) {
      if (e.type === 'breakStarted') this.setSuggestion(e.long);
      else if (e.type === 'focusStarted') this.suggestion = null;
      else if (e.type === 'overrun') this.logEvent({ kind: 'overrun', target: null, detail: null });
    }
    const now = this.clock();
    if (save || events.length > 0 || now - this.lastSaveAt >= HEARTBEAT_MS) this.save(now);
    for (const e of events) this.emit('engine', e);
    this.emitUi();
  }

  private setSuggestion(long: boolean): void {
    this.suggestion = pickSuggestion(long, this.lastSuggestion, this.opts.rand);
    this.lastSuggestion = this.suggestion;
  }

  private save(now: number): void {
    const id = this.id;
    if (id === null) return;
    // Stamp the attempt even on failure so a broken disk doesn't retry every second.
    this.lastSaveAt = now;
    this.safe('saveSnapshot', () => this.db.saveSnapshot(id, this.eng.state, now));
  }

  private safe(what: string, fn: () => void): void {
    try { fn(); } catch (err) { console.error(`[controller] ${what} failed`, err); }
  }

  private emitUi(): void {
    this.emit('ui', this.uiState());
  }
}

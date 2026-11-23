import type { Mode, Rhythm } from './settings';

export interface SessionInfo {
  topic: string;
  mode: Mode;
  goal: string | null;
  plannedMin: number | null;
  startedAt: number;
}

export type Phase = 'idle' | 'focus' | 'break' | 'awaitingNext' | 'ended';

export interface EngineState {
  phase: Phase;
  session: SessionInfo | null;
  blocksCompleted: number;
  breakCount: number;
  phaseEndsAt: number | null;
  pausedSince: number | null;
  bypassActive: boolean;
  breakEndedAt: number | null;
  overrunFired: boolean;
  oneMinuteFired: boolean;
  plannedFired: boolean;
  intervals: [number, number][];
  openFocusSince: number | null;
  lastTickAt: number;
}

export type EngineEvent =
  | { type: 'focusStarted'; endsAt: number }
  | { type: 'breakStarted'; long: boolean; endsAt: number }
  | { type: 'breakOneMinuteLeft' }
  | { type: 'breakEnded' }
  | { type: 'overrun' }
  | { type: 'paused'; since: number }
  | { type: 'resumed' }
  | { type: 'plannedLengthReached' }
  | { type: 'bypassOn' }
  | { type: 'sessionEnded' };

const MIN = 60_000;
const GAP_MS = 60_000;
const OVERRUN_MS = 3 * MIN;
const EXTEND_MS = 10 * MIN;
export const BYPASS_SENTENCE = 'I am choosing to stop studying';

function normalise(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

function initialState(): EngineState {
  return {
    phase: 'idle',
    session: null,
    blocksCompleted: 0,
    breakCount: 0,
    phaseEndsAt: null,
    pausedSince: null,
    bypassActive: false,
    breakEndedAt: null,
    overrunFired: false,
    oneMinuteFired: false,
    plannedFired: false,
    intervals: [],
    openFocusSince: null,
    lastTickAt: 0,
  };
}

export class SessionEngine {
  readonly state: EngineState;

  constructor(private readonly rhythm: Rhythm, snapshot?: EngineState) {
    this.state = snapshot ? (JSON.parse(JSON.stringify(snapshot)) as EngineState) : initialState();
  }

  get blockingActive(): boolean {
    return this.state.phase === 'focus' && !this.state.bypassActive;
  }

  start(info: Omit<SessionInfo, 'startedAt'>, now: number): EngineEvent[] {
    Object.assign(this.state, initialState());
    this.state.session = { ...info, startedAt: now };
    this.state.lastTickAt = now;
    return [this.beginFocus(now)];
  }

  tick(now: number): EngineEvent[] {
    const s = this.state;
    const ev: EngineEvent[] = [];
    if (s.phase === 'idle' || s.phase === 'ended') {
      s.lastTickAt = now;
      return ev;
    }
    if (now - s.lastTickAt > GAP_MS && s.phase === 'focus' && s.pausedSince === null) {
      ev.push(...this.pause(s.lastTickAt, now));
    }
    s.lastTickAt = now;

    if (s.phase === 'focus' && s.pausedSince === null) {
      this.checkPlanned(now, ev);
      if (s.phaseEndsAt !== null && now >= s.phaseEndsAt) {
        this.closeInterval(Math.min(now, s.phaseEndsAt));
        this.finishBlock(now, ev);
      }
    } else if (s.phase === 'break' && s.phaseEndsAt !== null) {
      if (!s.oneMinuteFired && now >= s.phaseEndsAt - MIN) {
        s.oneMinuteFired = true;
        ev.push({ type: 'breakOneMinuteLeft' });
      }
      if (now >= s.phaseEndsAt) {
        s.phase = 'awaitingNext';
        s.phaseEndsAt = null;
        s.breakEndedAt = now;
        ev.push({ type: 'breakEnded' });
      }
    } else if (s.phase === 'awaitingNext') {
      if (!s.overrunFired && s.breakEndedAt !== null && now - s.breakEndedAt >= OVERRUN_MS) {
        s.overrunFired = true;
        ev.push({ type: 'overrun' });
      }
    }
    return ev;
  }

  startNextBlock(now: number): EngineEvent[] {
    if (this.state.phase !== 'break' && this.state.phase !== 'awaitingNext') return [];
    return [this.beginFocus(now)];
  }

  endBlockEarly(now: number): EngineEvent[] {
    const s = this.state;
    if (s.phase !== 'focus') return [];
    const ev: EngineEvent[] = [];
    if (s.pausedSince === null) this.closeInterval(now);
    this.finishBlock(now, ev);
    return ev;
  }

  extendBlock(_now: number): EngineEvent[] {
    const s = this.state;
    if (s.phase !== 'focus' || s.phaseEndsAt === null) return [];
    s.phaseEndsAt += EXTEND_MS;
    return [];
  }

  pause(since: number, now: number): EngineEvent[] {
    const s = this.state;
    if (s.phase !== 'focus' || s.pausedSince !== null || s.openFocusSince === null) return [];
    const at = Math.min(Math.max(since, s.openFocusSince), Math.max(now, s.openFocusSince));
    this.closeInterval(at);
    s.pausedSince = at;
    return [{ type: 'paused', since: at }];
  }

  resume(now: number): EngineEvent[] {
    const s = this.state;
    if (s.phase !== 'focus' || s.pausedSince === null) return [];
    if (s.phaseEndsAt !== null) s.phaseEndsAt += Math.max(0, now - s.pausedSince);
    s.pausedSince = null;
    s.openFocusSince = now;
    s.lastTickAt = now;
    return [{ type: 'resumed' }];
  }

  turnOffBlocking(sentence: string, _now: number): EngineEvent[] {
    const s = this.state;
    if (s.phase !== 'focus' || s.bypassActive) return [];
    if (normalise(sentence) !== normalise(BYPASS_SENTENCE)) return [];
    s.bypassActive = true;
    return [{ type: 'bypassOn' }];
  }

  end(now: number): EngineEvent[] {
    const s = this.state;
    if (s.phase === 'idle' || s.phase === 'ended') return [];
    if (s.phase === 'focus' && s.pausedSince === null) this.closeInterval(now);
    s.phase = 'ended';
    s.phaseEndsAt = null;
    s.pausedSince = null;
    s.openFocusSince = null;
    s.bypassActive = false;
    return [{ type: 'sessionEnded' }];
  }

  focusMs(now: number): number {
    const s = this.state;
    let total = 0;
    for (const [a, b] of s.intervals) total += b - a;
    if (s.phase === 'focus' && s.pausedSince === null && s.openFocusSince !== null) {
      total += Math.max(0, now - s.openFocusSince);
    }
    return total;
  }

  private beginFocus(now: number): EngineEvent {
    const s = this.state;
    const endsAt = now + this.rhythm.focusMin * MIN;
    s.phase = 'focus';
    s.phaseEndsAt = endsAt;
    s.pausedSince = null;
    s.openFocusSince = now;
    s.breakEndedAt = null;
    s.overrunFired = false;
    s.oneMinuteFired = false;
    s.lastTickAt = now;
    return { type: 'focusStarted', endsAt };
  }

  private closeInterval(at: number): void {
    const s = this.state;
    if (s.openFocusSince !== null) {
      if (at > s.openFocusSince) s.intervals.push([s.openFocusSince, at]);
      s.openFocusSince = null;
    }
  }

  private checkPlanned(now: number, ev: EngineEvent[]): void {
    const s = this.state;
    const planned = s.session?.plannedMin;
    if (s.plannedFired || planned == null) return;
    if (this.focusMs(now) >= planned * MIN) {
      s.plannedFired = true;
      ev.push({ type: 'plannedLengthReached' });
    }
  }

  private finishBlock(now: number, ev: EngineEvent[]): void {
    const s = this.state;
    s.pausedSince = null;
    s.blocksCompleted += 1;
    this.checkPlanned(now, ev);
    s.breakCount += 1;
    const long = s.breakCount % this.rhythm.longBreakEvery === 0;
    const endsAt = now + (long ? this.rhythm.longBreakMin : this.rhythm.shortBreakMin) * MIN;
    s.phase = 'break';
    s.phaseEndsAt = endsAt;
    s.bypassActive = false;
    s.oneMinuteFired = false;
    ev.push({ type: 'breakStarted', long, endsAt });
  }
}

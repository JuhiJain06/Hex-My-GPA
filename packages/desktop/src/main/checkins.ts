import { CHECKIN, nextCheckinAt, resolveUnanswered, type CheckinConfig, type EngineEvent, type Mode } from '@study-buddy/core';
import type { SessionController } from './controller';
import type { CheckinAnswerMsg } from '../shared/ipc';
import { FAST_CHECKIN } from './config';

export interface CheckinUi {
  show(c: { mode: Mode; topic: string }): void;
  hide(): void;
}

export type CheckinAnswer = 'yes' | 'switched' | 'drifted' | { pages: number };

/** Accepts exactly the allowed check-in answer shapes; anything else is null. */
export function parseCheckinAnswer(p: unknown): { a: CheckinAnswer; topic?: string } | null {
  if (typeof p !== 'object' || p === null) return null;
  const r = p as Partial<CheckinAnswerMsg> & Record<string, unknown>;
  if (r.answer === 'yes' || r.answer === 'drifted') return { a: r.answer };
  if (r.answer === 'switched') {
    const topic = typeof r.topic === 'string' ? r.topic.trim().slice(0, 200) : '';
    return topic ? { a: 'switched', topic } : null;
  }
  if (r.answer === 'pages') {
    return typeof r.pages === 'number' && Number.isInteger(r.pages) && r.pages >= 0 && r.pages <= 2000
      ? { a: { pages: r.pages } } : null;
  }
  return null;
}

/** Check-in cadence for BUDDY_FAST: every minute, no jitter, unanswered after 20 s. */
export const FAST_CHECKIN_CONFIG: CheckinConfig = {
  laptop: { baseMin: FAST_CHECKIN.everyMin, timeoutMin: FAST_CHECKIN.timeoutSec / 60 },
  book: { baseMin: FAST_CHECKIN.everyMin, timeoutMin: FAST_CHECKIN.timeoutSec / 60 },
  jitterMin: 0,
};

/** Idle seconds below which a paused session counts as "user is back". */
const BACK_IDLE_SEC = 2;

/**
 * Schedules check-ins during unpaused focus, resolves unanswered ones (pause / ignored) and
 * resumes a paused session once the user touches the machine again. Driven by `tick()` every second.
 */
export class CheckinRunner {
  private nextAt: number | null = null;
  private visible: { at: number; mode: Mode } | null = null;

  constructor(
    private readonly ctrl: SessionController,
    private readonly ui: CheckinUi,
    private readonly idleSec: () => number,
    private readonly clock: () => number,
    private readonly rand: () => number = Math.random,
    private readonly config: CheckinConfig = CHECKIN,
  ) {
    ctrl.on('engine', (e: EngineEvent) => {
      if (e.type === 'focusStarted') this.schedule();
      else if (e.type === 'breakStarted' || e.type === 'sessionEnded') this.clear();
    });
  }

  tick(): void {
    const s = this.ctrl.engine.state;
    if (this.ctrl.sessionId === null || s.phase !== 'focus' || !s.session) {
      this.clear();
      return;
    }
    const now = this.clock();

    if (s.pausedSince !== null) {
      if (this.idleSec() < BACK_IDLE_SEC) {
        this.ctrl.resume();
        this.hide();
        this.schedule();
      }
      return;
    }

    if (this.visible) {
      const { at, mode } = this.visible;
      const outcome = resolveUnanswered(mode, at, now, this.idleSec(), this.config);
      if (outcome === 'pause') {
        // The check-in stays up so the user sees it on return; answering or any input resumes.
        this.ctrl.pause(at);
      } else if (outcome === 'ignored') {
        this.log('ignored');
        this.hide();
        this.schedule();
      }
      return;
    }

    if (this.nextAt === null) this.schedule();
    else if (now >= this.nextAt) {
      const mode = s.session.mode;
      this.visible = { at: now, mode };
      this.nextAt = null;
      this.ui.show({ mode, topic: s.session.topic });
    }
  }

  answer(a: CheckinAnswer, newTopic?: string): void {
    if (!this.visible) return;
    // Book mode has no topic switch; laptop mode has no page count.
    const book = this.visible.mode === 'book';
    if ((a === 'switched' && book) || (typeof a === 'object' && !book)) return;
    if (a === 'yes') this.log('yes');
    else if (a === 'switched') {
      if (newTopic) this.ctrl.setTopic(newTopic);
      this.log('switched');
    } else if (a === 'drifted') {
      this.log('drifted');
      this.ctrl.logEvent({ kind: 'slip', target: 'check-in', detail: null });
    } else this.log(`pages:${a.pages}`);
    this.hide();
    if (this.ctrl.engine.state.pausedSince !== null) this.ctrl.resume();
    this.schedule();
  }

  private schedule(): void {
    const s = this.ctrl.engine.state;
    this.nextAt = s.session ? nextCheckinAt(s.session.mode, this.clock(), this.rand, this.config) : null;
  }

  private clear(): void {
    this.nextAt = null;
    this.hide();
  }

  private hide(): void {
    if (!this.visible) return;
    this.visible = null;
    this.ui.hide();
  }

  private log(detail: string): void {
    this.ctrl.logEvent({ kind: 'checkin', target: null, detail });
  }
}

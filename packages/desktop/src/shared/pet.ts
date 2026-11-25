/** The desktop pet's speech bubble: what it says, and its queue of one-off notices. Pure. */
import type { UiState } from './ipc';

/** How long a one-off notice replaces the bubble's timer text. */
export const TRANSIENT_MS = 6000;
/** Longest topic shown in "Back to <topic>?". */
const TOPIC_MAX = 24;

const pad = (n: number) => String(n).padStart(2, '0');
const secondsLeft = (ms: number) => Math.max(0, Math.ceil(ms / 1000));

function shorten(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * The bubble's everyday text: "mm:ss" left in a focus block, "Paused", "Break · m:ss", or
 * "Back to <topic>?" once a break is over. Empty when there is nothing to say.
 */
export function bubbleText(ui: Pick<UiState, 'phase' | 'topic' | 'phaseEndsAt' | 'pausedSince'>, now: number): string {
  switch (ui.phase) {
    case 'focus': {
      if (ui.pausedSince !== null) return 'Paused';
      if (ui.phaseEndsAt === null) return '';
      const s = secondsLeft(ui.phaseEndsAt - now);
      return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
    }
    case 'break': {
      if (ui.phaseEndsAt === null) return 'Break';
      const s = secondsLeft(ui.phaseEndsAt - now);
      return `Break · ${Math.floor(s / 60)}:${pad(s % 60)}`;
    }
    case 'awaitingNext':
      return `Back to ${ui.topic ? shorten(ui.topic, TOPIC_MAX) : 'studying'}?`;
    default:
      return '';
  }
}

/** The planned-length notice, e.g. "You hit your planned 1.5 h". */
export function plannedText(plannedMin: number): string {
  const h = Math.round((plannedMin / 60) * 100) / 100;
  return `You hit your planned ${h} h`;
}

/**
 * Show the browser-link warning? Once per session (the pet window lives for one session) and again
 * whenever it changes. `last` is the status seen before (undefined: none yet); null means connected.
 */
export function shouldShowExtNotice(last: string | null | undefined, now: string | null): boolean {
  return now !== null && now !== last;
}

export interface Notice {
  id: string;
  text: string;
  /** Stays (and goes to the front) until dismissed: the planned-length question. */
  sticky?: boolean;
}

/** One-off bubble messages, shown one at a time for TRANSIENT_MS each (sticky ones until dismissed). */
export class NoticeQueue {
  private items: Notice[] = [];
  /** When the head started showing. */
  private headSince: number | null = null;

  push(n: Notice, now: number): void {
    const wasHead = this.items[0]?.id === n.id;
    this.items = this.items.filter((x) => x.id !== n.id);
    if (n.sticky) {
      this.items.unshift(n);
      this.headSince = now;
    } else {
      this.items.push(n);
      if (this.items.length === 1 || wasHead) {
        // Replacing the showing notice (or the first one): it gets its full time from now.
        if (wasHead) this.items.unshift(this.items.pop()!);
        this.headSince = now;
      }
    }
  }

  /** The notice to show now, or null for the everyday text. Expired notices are dropped. */
  current(now: number): Notice | null {
    for (;;) {
      const head = this.items[0];
      if (!head) { this.headSince = null; return null; }
      this.headSince ??= now;
      if (head.sticky || now - this.headSince < TRANSIENT_MS) return head;
      this.items.shift();
      // The next notice starts when the previous one ran out, so it gets its full time.
      this.headSince += TRANSIENT_MS;
    }
  }

  dismiss(id: string): void {
    const wasHead = this.items[0]?.id === id;
    this.items = this.items.filter((x) => x.id !== id);
    if (wasHead) this.headSince = null;
  }
}

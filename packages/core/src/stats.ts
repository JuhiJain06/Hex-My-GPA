import type { SessionInfo } from './engine';

export function localDay(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function dailyTotals(intervals: [number, number][]): Map<string, number> {
  const out = new Map<string, number>();
  for (const [start, end] of intervals) {
    let cur = start;
    while (cur < end) {
      const d = new Date(cur);
      const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
      const cut = Math.min(end, next);
      const key = localDay(cur);
      out.set(key, (out.get(key) ?? 0) + (cut - cur));
      cur = cut;
    }
  }
  return out;
}

function prevDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return localDay(new Date(y, m - 1, d - 1).getTime());
}

export function streak(totals: Map<string, number>, today: string, minMinutes: number): number {
  const min = minMinutes * 60_000;
  let day = (totals.get(today) ?? 0) >= min ? today : prevDay(today);
  let n = 0;
  while ((totals.get(day) ?? 0) >= min) {
    n++;
    day = prevDay(day);
  }
  return n;
}

export type EventKind = 'slip' | 'bypass' | 'checkin' | 'overrun';
export interface BuddyEvent { at: number; kind: EventKind; target: string | null; detail: string | null }
export interface SessionRecord {
  id: number;
  info: SessionInfo;
  endedAt: number | null;
  intervals: [number, number][];
  blocksCompleted: number;
  events: BuddyEvent[];
}
export interface Summary {
  focusMs: number;
  blocksCompleted: number;
  slipsByTarget: Record<string, number>;
  checkins: { yes: number; switched: number; drifted: number; ignored: number; pages: number };
  bypasses: BuddyEvent[];
  overruns: number;
  vsAverageMs: number | null;
}

const focusOf = (s: SessionRecord) => s.intervals.reduce((a, [x, y]) => a + (y - x), 0);

export function summarize(s: SessionRecord, previous: SessionRecord[]): Summary {
  const slipsByTarget: Record<string, number> = {};
  const checkins = { yes: 0, switched: 0, drifted: 0, ignored: 0, pages: 0 };
  const bypasses: BuddyEvent[] = [];
  let overruns = 0;
  for (const e of s.events) {
    if (e.kind === 'slip') {
      const k = e.target ?? 'unknown';
      slipsByTarget[k] = (slipsByTarget[k] ?? 0) + 1;
    } else if (e.kind === 'bypass') bypasses.push(e);
    else if (e.kind === 'overrun') overruns++;
    else if (e.kind === 'checkin' && e.detail) {
      if (e.detail.startsWith('pages:')) {
        const n = Number(e.detail.slice(6));
        if (Number.isFinite(n)) checkins.pages += n;
      } else if (e.detail === 'yes' || e.detail === 'switched' || e.detail === 'drifted' || e.detail === 'ignored') {
        checkins[e.detail]++;
      }
    }
  }
  const focusMs = focusOf(s);
  const vsAverageMs = previous.length === 0
    ? null
    : focusMs - previous.reduce((a, p) => a + focusOf(p), 0) / previous.length;
  return { focusMs, blocksCompleted: s.blocksCompleted, slipsByTarget, checkins, bypasses, overruns, vsAverageMs };
}

export const REFLECTION_TAGS = ['Phone', 'Tired', 'Wandering mind', 'Distracting site', 'Hard material', 'Interrupted'] as const;

export function topTags(reflections: { at: number; tags: string[] }[], sinceMs: number): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of reflections) {
    if (r.at < sinceMs) continue;
    for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts].map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
}

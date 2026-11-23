import type { DesktopToExt, Lists, Phase } from '@study-buddy/core';

const PHASES: Phase[] = ['idle', 'focus', 'break', 'awaitingNext', 'ended'];
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

function parseLists(v: unknown): Lists | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (!isStrArray(o.fine) || !isStrArray(o.gray) || !isStrArray(o.hard)) return null;
  return { fine: [...o.fine], gray: [...o.gray], hard: [...o.hard] };
}

/** Validates a message from the desktop bridge; anything unexpected yields null. */
export function parseDesktopMessage(raw: string): DesktopToExt | null {
  let m: unknown;
  try { m = JSON.parse(raw); } catch { return null; }
  if (typeof m !== 'object' || m === null || Array.isArray(m)) return null;
  const o = m as Record<string, unknown>;
  switch (o.t) {
    case 'helloAck':
      return typeof o.ok === 'boolean' ? { t: 'helloAck', ok: o.ok } : null;
    case 'state': {
      if (!PHASES.includes(o.phase as Phase)) return null;
      if (typeof o.blocking !== 'boolean') return null;
      if (!(o.topic === null || typeof o.topic === 'string')) return null;
      const end = o.phaseEndsAt;
      if (!(end === null || (typeof end === 'number' && Number.isFinite(end)))) return null;
      const sites = parseLists(o.sites);
      if (!sites || !isStrArray(o.studyVideos)) return null;
      const { todayMs, streakDays } = o;
      if (typeof todayMs !== 'number' || !Number.isFinite(todayMs) || todayMs < 0) return null;
      if (typeof streakDays !== 'number' || !Number.isFinite(streakDays) || streakDays < 0) return null;
      return {
        t: 'state', phase: o.phase as Phase, blocking: o.blocking, topic: o.topic,
        phaseEndsAt: end, sites, studyVideos: [...o.studyVideos], todayMs, streakDays,
      };
    }
    default:
      return null;
  }
}

import type { Phase } from './engine';
import type { Lists, Mode } from './settings';
import type { Animal } from './animals';

export const BRIDGE_PORT = 47615;
export type BrowserKind = 'chrome' | 'edge';
export interface WindowReport { title: string; incognito: boolean; focused: boolean }

export type DesktopToExt =
  | { t: 'helloAck'; ok: boolean }
  | { t: 'state'; phase: Phase; blocking: boolean; topic: string | null; phaseEndsAt: number | null; sites: Lists; studyVideos: string[]; todayMs: number; streakDays: number; animal: Animal };

export type ExtToDesktop =
  | { t: 'hello'; secret: string; browser: BrowserKind; incognitoAllowed: boolean }
  | { t: 'windows'; windows: WindowReport[] }
  | { t: 'slip'; reason: 'youtube-not-study' | 'youtube-timeout' | 'hard-block-visit'; target: string }
  | { t: 'videoStudy'; videoId: string }
  | { t: 'startSession'; topic: string; mode: Mode; goal: string | null; plannedMin: number | null }
  | { t: 'ping' };

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNonEmpty = (v: unknown): v is string => isStr(v) && v.length > 0;
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const SLIP_REASONS = ['youtube-not-study', 'youtube-timeout', 'hard-block-visit'];

export function parseExtMessage(raw: string): ExtToDesktop | null {
  let m: unknown;
  try { m = JSON.parse(raw); } catch { return null; }
  if (typeof m !== 'object' || m === null || Array.isArray(m)) return null;
  const o = m as Record<string, unknown>;
  switch (o.t) {
    case 'hello':
      if (isNonEmpty(o.secret) && (o.browser === 'chrome' || o.browser === 'edge') && isBool(o.incognitoAllowed))
        return { t: 'hello', secret: o.secret, browser: o.browser, incognitoAllowed: o.incognitoAllowed };
      return null;
    case 'windows': {
      if (!Array.isArray(o.windows)) return null;
      const windows: WindowReport[] = [];
      for (const w of o.windows) {
        if (typeof w !== 'object' || w === null) return null;
        const r = w as Record<string, unknown>;
        if (!isStr(r.title) || !isBool(r.incognito) || !isBool(r.focused)) return null;
        windows.push({ title: r.title, incognito: r.incognito, focused: r.focused });
      }
      return { t: 'windows', windows };
    }
    case 'slip':
      if (isStr(o.reason) && SLIP_REASONS.includes(o.reason) && isStr(o.target))
        return { t: 'slip', reason: o.reason as 'youtube-not-study' | 'youtube-timeout' | 'hard-block-visit', target: o.target };
      return null;
    case 'videoStudy':
      return isNonEmpty(o.videoId) ? { t: 'videoStudy', videoId: o.videoId } : null;
    case 'startSession': {
      if (!isStr(o.topic) || o.topic.trim() === '') return null;
      if (o.mode !== 'laptop' && o.mode !== 'book') return null;
      if (!(o.goal === null || isStr(o.goal))) return null;
      const p = o.plannedMin;
      if (!(p === null || (typeof p === 'number' && Number.isFinite(p) && p > 0))) return null;
      return { t: 'startSession', topic: o.topic, mode: o.mode, goal: o.goal, plannedMin: p };
    }
    case 'ping':
      return { t: 'ping' };
    default:
      return null;
  }
}

import { REFLECTION_TAGS } from '@study-buddy/core';

export const NOTE_MAX = 500;

export interface ReflectionSave {
  sessionId: number;
  goal: 'yes' | 'partly' | 'no' | null;
  tags: string[];
  note: string | null;
}

/** Shape check for `reflection:save`. Whether the session exists/is finished is checked by the caller. */
export function parseReflection(p: unknown): ReflectionSave | null {
  if (typeof p !== 'object' || p === null) return null;
  const r = p as Record<string, unknown>;
  if (typeof r.sessionId !== 'number' || !Number.isInteger(r.sessionId)) return null;
  if (!(r.goal === null || r.goal === 'yes' || r.goal === 'partly' || r.goal === 'no')) return null;
  if (!Array.isArray(r.tags)) return null;
  const allowed: readonly unknown[] = REFLECTION_TAGS;
  const tags: string[] = [];
  for (const t of r.tags) {
    if (typeof t !== 'string' || !allowed.includes(t) || tags.includes(t)) return null;
    tags.push(t);
  }
  if (!(r.note === null || (typeof r.note === 'string' && r.note.length <= NOTE_MAX))) return null;
  return { sessionId: r.sessionId, goal: r.goal, tags, note: r.note };
}

import type { StartRequest } from '../shared/ipc';

/**
 * Validates a session start from the start window or the extension side panel (via the bridge):
 * topic trimmed and capped at 200, goal at 500, plannedMin rounded and capped at 24 h. Pure.
 */
export function parseStart(p: unknown): StartRequest | null {
  if (typeof p !== 'object' || p === null) return null;
  const r = p as Record<string, unknown>;
  const topic = typeof r.topic === 'string' ? r.topic.trim().slice(0, 200) : '';
  if (!topic) return null;
  const mode = r.mode === 'book' ? 'book' : r.mode === 'laptop' ? 'laptop' : null;
  if (!mode) return null;
  const goal = typeof r.goal === 'string' && r.goal.trim() ? r.goal.trim().slice(0, 500) : null;
  const pm = typeof r.plannedMin === 'number' && Number.isFinite(r.plannedMin) && r.plannedMin > 0
    ? Math.min(Math.round(r.plannedMin), 24 * 60) : null;
  return { topic, mode, goal, plannedMin: pm };
}

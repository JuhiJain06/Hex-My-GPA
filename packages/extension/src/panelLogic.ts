import type { ExtToDesktop } from '@study-buddy/core';

export const MAX_TOPIC = 200;

/** Validates the side panel's start request; returns the socket message or null. */
export function parsePanelStart(msg: unknown): Extract<ExtToDesktop, { t: 'startSession' }> | null {
  if (typeof msg !== 'object' || msg === null) return null;
  const o = msg as Record<string, unknown>;
  if (o.type !== 'panel-start') return null;
  if (typeof o.topic !== 'string') return null;
  const topic = o.topic.trim();
  if (topic === '' || topic.length > MAX_TOPIC) return null;
  if (o.mode !== 'laptop' && o.mode !== 'book') return null;
  if (!(o.goal === undefined || o.goal === null || typeof o.goal === 'string')) return null;
  const goal = typeof o.goal === 'string' && o.goal.trim() !== '' ? o.goal.trim() : null;
  const p = o.plannedMin ?? null;
  if (!(p === null || (typeof p === 'number' && Number.isFinite(p) && p > 0))) return null;
  return { t: 'startSession', topic, mode: o.mode, goal, plannedMin: p };
}

export function formatTimeLeft(phaseEndsAt: number | null, now: number): string {
  if (phaseEndsAt === null) return '--:--';
  const s = Math.max(0, Math.ceil((phaseEndsAt - now) / 1000));
  const mm = Math.floor(s / 60);
  return `${String(mm).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function formatHm(ms: number): string {
  const m = Math.floor(Math.max(0, ms) / 60_000);
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

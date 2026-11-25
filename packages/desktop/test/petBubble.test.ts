import { describe, test, expect } from 'vitest';
import { NoticeQueue, TRANSIENT_MS, bubbleText, plannedText, shouldShowExtNotice } from '../src/shared/pet';

const NOW = 1_000_000;
const ui = (over: Record<string, unknown> = {}) => ({
  phase: 'focus' as string, topic: 'Biology' as string | null, phaseEndsAt: NOW + 25 * 60_000 as number | null,
  pausedSince: null as number | null, ...over,
}) as Parameters<typeof bubbleText>[0];

describe('bubbleText', () => {
  test('focus: time left as mm:ss', () => {
    expect(bubbleText(ui(), NOW)).toBe('25:00');
    expect(bubbleText(ui({ phaseEndsAt: NOW + 61_500 }), NOW)).toBe('01:02');
    expect(bubbleText(ui({ phaseEndsAt: NOW + 90 * 60_000 }), NOW)).toBe('90:00');
  });
  test('focus past its end shows 00:00, never negative', () => {
    expect(bubbleText(ui({ phaseEndsAt: NOW - 5000 }), NOW)).toBe('00:00');
  });
  test('paused', () => expect(bubbleText(ui({ pausedSince: NOW - 1 }), NOW)).toBe('Paused'));
  test('break: "Break · m:ss"', () => {
    expect(bubbleText(ui({ phase: 'break', phaseEndsAt: NOW + 4 * 60_000 + 12_000 }), NOW)).toBe('Break · 4:12');
    expect(bubbleText(ui({ phase: 'break', phaseEndsAt: NOW + 25 * 60_000 }), NOW)).toBe('Break · 25:00');
    expect(bubbleText(ui({ phase: 'break', phaseEndsAt: null }), NOW)).toBe('Break');
  });
  test('awaitingNext: "Back to <topic>?"', () => {
    expect(bubbleText(ui({ phase: 'awaitingNext', phaseEndsAt: null }), NOW)).toBe('Back to Biology?');
    expect(bubbleText(ui({ phase: 'awaitingNext', topic: null }), NOW)).toBe('Back to studying?');
  });
  test('a long topic is shortened with an ellipsis', () => {
    const t = bubbleText(ui({ phase: 'awaitingNext', topic: 'Organic chemistry: reaction mechanisms and stereo' }), NOW);
    expect(t.length).toBeLessThanOrEqual(34);
    expect(t).toMatch(/^Back to Organic chemistry.*…\?$/);
  });
  test('idle: nothing', () => expect(bubbleText(ui({ phase: 'idle', phaseEndsAt: null }), NOW)).toBe(''));
  test('focus with no end time yet: nothing', () => expect(bubbleText(ui({ phaseEndsAt: null }), NOW)).toBe(''));
});

describe('plannedText', () => {
  test('hours with up to two decimals', () => {
    expect(plannedText(120)).toBe('You hit your planned 2 h');
    expect(plannedText(90)).toBe('You hit your planned 1.5 h');
    expect(plannedText(50)).toBe('You hit your planned 0.83 h');
  });
});

describe('shouldShowExtNotice (once per session, and whenever it changes)', () => {
  const NOT = 'Browser buddy not connected';
  test('first not-connected status is shown', () => expect(shouldShowExtNotice(undefined, NOT)).toBe(true));
  test('connected (null) is never shown', () => {
    expect(shouldShowExtNotice(undefined, null)).toBe(false);
    expect(shouldShowExtNotice(NOT, null)).toBe(false);
  });
  test('the same status again is not repeated', () => expect(shouldShowExtNotice(NOT, NOT)).toBe(false));
  test('a change is shown: reconnect then lose it again, or a different reason', () => {
    expect(shouldShowExtNotice(null, NOT)).toBe(true);
    expect(shouldShowExtNotice(NOT, 'Browser link unavailable')).toBe(true);
  });
});

describe('NoticeQueue', () => {
  test('a notice shows for TRANSIENT_MS (about 6 s), then the bubble falls back', () => {
    expect(TRANSIENT_MS).toBeGreaterThanOrEqual(5000);
    expect(TRANSIENT_MS).toBeLessThanOrEqual(7000);
    const q = new NoticeQueue();
    q.push({ id: 'phone', text: 'Phone in another room?' }, NOW);
    expect(q.current(NOW)?.text).toBe('Phone in another room?');
    expect(q.current(NOW + TRANSIENT_MS - 1)?.id).toBe('phone');
    expect(q.current(NOW + TRANSIENT_MS)).toBeNull();
  });
  test('notices queue: the next one gets its full time after the first', () => {
    const q = new NoticeQueue();
    q.push({ id: 'phone', text: 'a' }, NOW);
    q.push({ id: 'ext', text: 'b' }, NOW + 1000);
    expect(q.current(NOW + 1000)?.id).toBe('phone');
    expect(q.current(NOW + TRANSIENT_MS)?.id).toBe('ext');
    expect(q.current(NOW + 2 * TRANSIENT_MS - 1)?.id).toBe('ext');
    expect(q.current(NOW + 2 * TRANSIENT_MS)).toBeNull();
  });
  test('a sticky notice (planned length) stays until dismissed and goes first', () => {
    const q = new NoticeQueue();
    q.push({ id: 'ext', text: 'b' }, NOW);
    q.push({ id: 'planned', text: 'You hit your planned 2 h', sticky: true }, NOW + 10);
    expect(q.current(NOW + 10)?.id).toBe('planned');
    expect(q.current(NOW + 10 * 60_000)?.id).toBe('planned');
    q.dismiss('planned');
    expect(q.current(NOW + 10 * 60_000 + 1)?.id).toBe('ext');
  });
  test('pushing the same id again replaces it instead of queueing twice', () => {
    const q = new NoticeQueue();
    q.push({ id: 'ext', text: 'one' }, NOW);
    q.push({ id: 'ext', text: 'two' }, NOW + 5);
    expect(q.current(NOW + 5)?.text).toBe('two');
    expect(q.current(NOW + 5 + TRANSIENT_MS)).toBeNull();
  });
});

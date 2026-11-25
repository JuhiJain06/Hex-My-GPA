import { describe, test, expect } from 'vitest';
import { breakWindowAction } from '../src/main/breakFlow';
import { breakChime } from '../src/renderer/breakChime';
import type { UiState } from '../src/shared/ipc';

const ui = (over: Partial<UiState>): UiState => ({
  phase: 'break', topic: 'Maths', phaseEndsAt: null, pausedSince: null, todayMs: 0, streakDays: 0,
  blockingActive: false, extensionConnected: false, bridgeListening: true, suggestion: 'Drink water', animal: 'cat', ...over,
});

describe('breakWindowAction (main)', () => {
  test('breakStarted shows the break window without focus', () => {
    expect(breakWindowAction({ type: 'breakStarted', long: false, endsAt: 1 })).toBe('show');
  });
  test('breakOneMinuteLeft and breakEnded (re)create and focus it, even if the user closed it', () => {
    expect(breakWindowAction({ type: 'breakOneMinuteLeft' })).toBe('showFocused');
    expect(breakWindowAction({ type: 'breakEnded' })).toBe('showFocused');
  });
  test('focusStarted closes it; unrelated events do nothing', () => {
    expect(breakWindowAction({ type: 'focusStarted', endsAt: 1 })).toBe('close');
    expect(breakWindowAction({ type: 'overrun' })).toBeNull();
  });
});

describe('breakChime (renderer)', () => {
  const now = 1_000_000;
  test('a fresh window chimes on its first sight of a break: break start', () => {
    expect(breakChime({ kind: 'state', state: ui({ phaseEndsAt: now + 10 * 60_000 }) }, false)).toBe(true);
  });
  test('a window recreated at the 1-minute warning chimes on load (it missed the event)', () => {
    expect(breakChime({ kind: 'state', state: ui({ phaseEndsAt: now + 59_000 }) }, false)).toBe(true);
  });
  test('later states never re-chime', () => {
    expect(breakChime({ kind: 'state', state: ui({ phaseEndsAt: now + 59_000 }) }, true)).toBe(false);
  });
  test('an open window chimes for the warning and break-end events', () => {
    expect(breakChime({ kind: 'event', event: { type: 'breakOneMinuteLeft' } }, true)).toBe(true);
    expect(breakChime({ kind: 'event', event: { type: 'breakEnded' } }, true)).toBe(true);
    expect(breakChime({ kind: 'event', event: { type: 'overrun' } }, true)).toBe(false);
  });
  test('no chime on load outside a break', () => {
    expect(breakChime({ kind: 'state', state: ui({ phase: 'awaitingNext' }) }, false)).toBe(false);
  });
});

import { expect, test } from 'vitest';
import { animalOf, formatHm, formatTimeLeft, panelMood, parsePanelStart } from '../src/panelLogic';

test('parsePanelStart validates and maps to startSession', () => {
  expect(parsePanelStart({ type: 'panel-start', topic: ' Calculus ', mode: 'book', goal: ' ch 3 ', plannedMin: 90 }))
    .toEqual({ t: 'startSession', topic: 'Calculus', mode: 'book', goal: 'ch 3', plannedMin: 90 });
  expect(parsePanelStart({ type: 'panel-start', topic: 'x', mode: 'laptop', goal: '  ', plannedMin: null }))
    .toEqual({ t: 'startSession', topic: 'x', mode: 'laptop', goal: null, plannedMin: null });
  expect(parsePanelStart({ type: 'panel-start', topic: 'x', mode: 'laptop' }))
    .toEqual({ t: 'startSession', topic: 'x', mode: 'laptop', goal: null, plannedMin: null });
});

test('parsePanelStart rejects bad input', () => {
  const ok = { type: 'panel-start', topic: 'x', mode: 'laptop', goal: null, plannedMin: 30 };
  expect(parsePanelStart(null)).toBeNull();
  expect(parsePanelStart('x')).toBeNull();
  for (const b of [
    { ...ok, type: 'other' }, { ...ok, topic: '   ' }, { ...ok, topic: 5 }, { ...ok, topic: 'a'.repeat(201) },
    { ...ok, mode: 'phone' }, { ...ok, goal: 4 }, { ...ok, plannedMin: 0 }, { ...ok, plannedMin: -5 },
    { ...ok, plannedMin: Infinity }, { ...ok, plannedMin: '30' },
  ]) expect(parsePanelStart(b)).toBeNull();
});

test('formatTimeLeft', () => {
  expect(formatTimeLeft(null, 0)).toBe('--:--');
  expect(formatTimeLeft(65_000, 0)).toBe('01:05');
  expect(formatTimeLeft(1000, 5000)).toBe('00:00');
  expect(formatTimeLeft(3_600_000 + 1, 0)).toBe('60:01');
});

test('formatHm', () => {
  expect(formatHm(0)).toBe('0h 0m');
  expect(formatHm(5_400_000)).toBe('1h 30m');
  expect(formatHm(-5)).toBe('0h 0m');
});

test('animalOf reads the animal from a stored state, defaulting to the cat', () => {
  expect(animalOf({ animal: 'fox' })).toBe('fox');
  expect(animalOf({ animal: 'dragon' })).toBe('cat');
  expect(animalOf({})).toBe('cat');
  expect(animalOf(undefined)).toBe('cat');
  expect(animalOf(null)).toBe('cat');
  expect(animalOf('fox')).toBe('cat');
});

test('panelMood follows the phase (pause unknown → not paused; no slips or celebrations)', () => {
  const now = 1_000_000;
  expect(panelMood({ phase: 'idle', phaseEndsAt: null }, now)).toBe('wave');
  expect(panelMood({ phase: 'focus', phaseEndsAt: now + 60_000 }, now)).toBe('study');
  expect(panelMood({ phase: 'break', phaseEndsAt: now + 5 * 60_000 }, now)).toBe('break');
  expect(panelMood({ phase: 'break', phaseEndsAt: now + 30_000 }, now)).toBe('alert');
  expect(panelMood({ phase: 'awaitingNext', phaseEndsAt: null }, now)).toBe('alert');
  expect(panelMood({ phase: 'ended', phaseEndsAt: null }, now)).toBe('wave');
});

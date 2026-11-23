import { test, expect } from 'vitest';
import { nextCheckinAt, resolveUnanswered } from '../src/checkins';
import { SHORT_SUGGESTIONS, LONG_SUGGESTIONS, pickSuggestion } from '../src/suggestions';

const M = 60_000;

test('interval bounds', () => {
  expect(nextCheckinAt('laptop', 0, () => 0)).toBe(20 * M);
  expect(nextCheckinAt('laptop', 0, () => 1)).toBe(30 * M);
  expect(nextCheckinAt('book', 0, () => 0.5)).toBe(15 * M);
});
test('unanswered: wait, then pause if no input since shown, else ignored', () => {
  expect(resolveUnanswered('laptop', 0, 1 * M, 60)).toBe('wait');
  expect(resolveUnanswered('laptop', 0, 2 * M, 120)).toBe('pause');
  expect(resolveUnanswered('laptop', 0, 2 * M, 5)).toBe('ignored');
  expect(resolveUnanswered('book', 0, 4 * M, 240)).toBe('wait');
  expect(resolveUnanswered('book', 0, 5 * M, 300)).toBe('pause');
});
test('suggestion never repeats back to back', () => {
  for (const s of SHORT_SUGGESTIONS) expect(pickSuggestion(false, s)).not.toBe(s);
  for (const s of LONG_SUGGESTIONS) expect(pickSuggestion(true, s)).not.toBe(s);
  expect(LONG_SUGGESTIONS).toContain('Walk around');
  expect(LONG_SUGGESTIONS).toContain('Eat something');
  expect(SHORT_SUGGESTIONS).toEqual(expect.arrayContaining(['Stand up and stretch', 'Drink water', 'Look out a window for 20 s']));
  expect(SHORT_SUGGESTIONS).toContain(pickSuggestion(false, null));
  expect(LONG_SUGGESTIONS).toContain(pickSuggestion(true, null));
});

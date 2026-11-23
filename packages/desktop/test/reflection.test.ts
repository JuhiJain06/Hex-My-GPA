import { describe, test, expect } from 'vitest';
import { parseReflection } from '../src/main/reflection';
import { bypassLabel } from '../src/shared/labels';

describe('parseReflection', () => {
  const ok = { sessionId: 3, goal: 'yes', tags: ['Phone', 'Tired'], note: 'hi' };
  test('accepts a valid payload', () => expect(parseReflection(ok)).toEqual(ok));
  test('accepts null goal and note and empty tags', () =>
    expect(parseReflection({ sessionId: 1, goal: null, tags: [], note: null })).toEqual({ sessionId: 1, goal: null, tags: [], note: null }));
  test.each([
    ['not an object', 5],
    ['null', null],
    ['bad session id', { ...ok, sessionId: '3' }],
    ['fractional id', { ...ok, sessionId: 1.5 }],
    ['bad goal', { ...ok, goal: 'maybe' }],
    ['missing goal', { sessionId: 3, tags: [], note: null }],
    ['unknown tag', { ...ok, tags: ['Phone', 'Bored'] }],
    ['duplicate tag', { ...ok, tags: ['Phone', 'Phone'] }],
    ['tags not array', { ...ok, tags: 'Phone' }],
    ['note too long', { ...ok, note: 'x'.repeat(501) }],
    ['note number', { ...ok, note: 5 }],
  ])('rejects %s', (_n, p) => expect(parseReflection(p)).toBeNull());
  test('accepts a 500 char note', () => expect(parseReflection({ ...ok, note: 'x'.repeat(500) })?.note).toHaveLength(500));
});

describe('bypassLabel', () => {
  test('known targets', () => {
    expect(bypassLabel('blocking-turned-off')).toBe('Turned off blocking');
    expect(bypassLabel('extension-disconnected')).toBe('Browser extension switched off');
    expect(bypassLabel('app-closed')).toBe('App closed');
  });
  test('unknown shows raw, null shows a fallback', () => {
    expect(bypassLabel('weird')).toBe('weird');
    expect(bypassLabel(null)).toBe('Unknown');
  });
});

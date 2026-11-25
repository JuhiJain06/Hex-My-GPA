import { describe, test, expect } from 'vitest';
import { ANIMALS, isAnimal, moodFor, SAD_MS, toAnimal, type MoodInput } from '../src/index';

const NOW = 1_000_000;
const base: MoodInput = { phase: 'idle', paused: false, recentSlipAt: null, celebrating: false, phaseEndsAt: null };
const mood = (over: Partial<MoodInput>, now = NOW) => moodFor({ ...base, ...over }, now);

describe('ANIMALS', () => {
  test('lists the six animals in order, cat first (the default)', () => {
    expect(ANIMALS.map((a) => a.id)).toEqual(['cat', 'fox', 'panda', 'bunny', 'dog', 'hamster']);
    expect(ANIMALS.map((a) => a.label)).toEqual(['Cat', 'Fox', 'Panda', 'Bunny', 'Dog', 'Hamster']);
  });
  test('isAnimal accepts only known ids', () => {
    expect(isAnimal('fox')).toBe(true);
    expect(isAnimal('dog')).toBe(true);
    for (const v of ['penguin', 'Cat', '', null, undefined, 3]) expect(isAnimal(v)).toBe(false);
  });
});

describe('toAnimal (saved values)', () => {
  test('known animals are kept', () => {
    for (const a of ANIMALS) expect(toAnimal(a.id)).toBe(a.id);
  });
  test('a saved penguin becomes the dog', () => expect(toAnimal('penguin')).toBe('dog'));
  test('anything unknown falls back to the cat', () => {
    for (const v of ['dragon', 'Fox', '', null, undefined, 3, {}]) expect(toAnimal(v)).toBe('cat');
  });
});

describe('moodFor: one row of the spec table each', () => {
  test('idle / start screen → wave', () => expect(mood({ phase: 'idle' })).toBe('wave'));
  test('ended → wave', () => expect(mood({ phase: 'ended' })).toBe('wave'));
  test('focus → study', () => expect(mood({ phase: 'focus', phaseEndsAt: NOW + 600_000 })).toBe('study'));
  test('break → break', () => expect(mood({ phase: 'break', phaseEndsAt: NOW + 120_000 })).toBe('break'));
  test('1-minute warning (break, last minute) → alert', () => {
    expect(mood({ phase: 'break', phaseEndsAt: NOW + 60_000 })).toBe('alert');
    expect(mood({ phase: 'break', phaseEndsAt: NOW + 1_000 })).toBe('alert');
    expect(mood({ phase: 'break', phaseEndsAt: NOW + 60_001 })).toBe('break');
  });
  test('"Back to topic?" (awaitingNext) → alert', () => expect(mood({ phase: 'awaitingNext' })).toBe('alert'));
  test('paused → sleep', () => expect(mood({ phase: 'focus', paused: true })).toBe('sleep'));
  test('slip → sad for 3 s, then back to content', () => {
    const f = { phase: 'focus' as const, recentSlipAt: NOW };
    expect(mood(f, NOW)).toBe('sad');
    expect(mood(f, NOW + SAD_MS - 1)).toBe('sad');
    expect(mood(f, NOW + SAD_MS)).toBe('study');
    expect(SAD_MS).toBe(3000);
  });
  test('a slip timestamp in the future does not make it sad', () => {
    expect(mood({ phase: 'focus', recentSlipAt: NOW + 10 })).toBe('study');
  });
  test('planned length reached / summary → celebrate', () => expect(mood({ phase: 'focus', celebrating: true })).toBe('celebrate'));
});

describe('moodFor: precedence celebrate > sad > sleep > alert > break > study > wave', () => {
  test('celebrate beats sad and sleep', () => {
    expect(mood({ phase: 'focus', celebrating: true, recentSlipAt: NOW, paused: true })).toBe('celebrate');
  });
  test('sad beats sleep', () => expect(mood({ phase: 'focus', paused: true, recentSlipAt: NOW })).toBe('sad'));
  test('sad beats alert and break', () => {
    expect(mood({ phase: 'awaitingNext', recentSlipAt: NOW })).toBe('sad');
    expect(mood({ phase: 'break', phaseEndsAt: NOW + 120_000, recentSlipAt: NOW })).toBe('sad');
  });
  test('sleep beats alert', () => expect(mood({ phase: 'awaitingNext', paused: true })).toBe('sleep'));
  test('alert beats break', () => expect(mood({ phase: 'break', phaseEndsAt: NOW + 30_000 })).toBe('alert'));
  test('a celebrating idle buddy still celebrates (summary)', () => expect(mood({ phase: 'idle', celebrating: true })).toBe('celebrate'));
});

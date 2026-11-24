import { describe, test, expect } from 'vitest';
import { FREQ_PRESETS, oscillatorPlan, normalizeChoice, shouldBeAudible, fadeAction } from '../src/renderer/audio';

describe('oscillatorPlan', () => {
  test('binaural splits carrier ± beat across ears', () =>
    expect(oscillatorPlan({ kind: 'binaural', beatHz: 40, carrierHz: 200 })).toEqual({ left: 200, right: 240, mono: null, pulseHz: null }));
  test('isochronic pulses a mono carrier', () =>
    expect(oscillatorPlan({ kind: 'isochronic', beatHz: 10, carrierHz: 200 })).toEqual({ left: null, right: null, mono: 200, pulseHz: 10 }));
  test('pure tone', () => expect(oscillatorPlan({ kind: 'pure', hz: 432 })).toEqual({ left: null, right: null, mono: 432, pulseHz: null }));
  test('no frequency', () => expect(oscillatorPlan(null)).toEqual({ left: null, right: null, mono: null, pulseHz: null }));
});

describe('FREQ_PRESETS', () => {
  test('has the eight presets', () => {
    expect(FREQ_PRESETS.map((p) => p.label)).toEqual([
      'Gamma focus (40 Hz)', 'Calm focus (10 Hz)', 'Alert (16 Hz)',
      'Gamma focus (40 Hz, isochronic)', 'Calm focus (10 Hz, isochronic)', 'Alert (16 Hz, isochronic)',
      '432 Hz tone', '528 Hz tone',
    ]);
    expect(FREQ_PRESETS[0]!.choice).toEqual({ kind: 'binaural', beatHz: 40, carrierHz: 200 });
    expect(FREQ_PRESETS[3]!.choice).toEqual({ kind: 'isochronic', beatHz: 40, carrierHz: 200 });
    expect(FREQ_PRESETS[7]!.choice).toEqual({ kind: 'pure', hz: 528 });
  });
});

describe('normalizeChoice', () => {
  const c = { ambient: 'cafe' as const, ambientVolume: 0.5, freq: null, freqVolume: 0.3 };
  test('cafe is treated as none', () => expect(normalizeChoice(c).ambient).toBe('none'));
  test('others unchanged', () => expect(normalizeChoice({ ...c, ambient: 'rain' }).ambient).toBe('rain'));
});

describe('shouldBeAudible / fadeAction', () => {
  test('only while focus and not paused', () => {
    expect(shouldBeAudible({ phase: 'focus', pausedSince: null })).toBe(true);
    expect(shouldBeAudible({ phase: 'focus', pausedSince: 5 })).toBe(false);
    expect(shouldBeAudible({ phase: 'break', pausedSince: null })).toBe(false);
    expect(shouldBeAudible({ phase: 'awaitingNext', pausedSince: null })).toBe(false);
  });
  test('engine events map to fades', () => {
    expect(fadeAction('focusStarted')).toBe('in');
    expect(fadeAction('breakStarted')).toBe('out');
    expect(fadeAction('sessionEnded')).toBe('out');
    expect(fadeAction('breakEnded')).toBeNull();
  });
});

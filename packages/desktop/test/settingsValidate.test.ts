import { describe, test, expect } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '@study-buddy/core';
import { parseSettings, ALWAYS_FINE_SITES } from '../src/main/settingsValidate';

const input = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  rhythm: { ...DEFAULT_SETTINGS.rhythm },
  streakMinMinutes: 120,
  sites: { fine: [], gray: [], hard: [] },
  apps: { fine: [], gray: [], hard: [] },
  ...over,
});
const ok = (i: unknown, cur: Settings = DEFAULT_SETTINGS): Settings => {
  const r = parseSettings(i, cur);
  if ('error' in r) throw new Error(`unexpected error: ${r.error}`);
  return r;
};
const err = (i: unknown): string => {
  const r = parseSettings(i, DEFAULT_SETTINGS);
  if (!('error' in r)) throw new Error('expected an error');
  return r.error;
};
const sites = (hard: string[], gray: string[] = [], fine: string[] = []) => input({ sites: { fine, gray, hard } });
const apps = (hard: string[], gray: string[] = [], fine: string[] = []) => input({ apps: { fine, gray, hard } });

describe('parseSettings: shape', () => {
  test.each([[null], [5], ['x'], [[]]])('rejects non-object %j', (v) => expect(err(v)).toBeTruthy());
  test('rejects a list that is not an array of strings', () => {
    expect(err(input({ sites: { fine: 'a.com', gray: [], hard: [] } }))).toMatch(/fine/);
    expect(err(sites([5 as unknown as string]))).toBeTruthy();
  });
  test('accepts a full valid payload', () => {
    const s = ok(input());
    expect(s.rhythm).toEqual(DEFAULT_SETTINGS.rhythm);
    expect(s.streakMinMinutes).toBe(120);
  });
});

describe('parseSettings: lists', () => {
  test('trims, lowercases, drops empty lines and dedupes', () => {
    expect(ok(sites(['  Wikipedia.ORG ', '', '   ', 'wikipedia.org', 'a.com'])).sites.hard).toEqual(['wikipedia.org', 'a.com']);
  });
  test('site entries lose scheme, www. and path', () => {
    expect(ok(sites(['https://www.Example.com/a/b?q=1', 'http://foo.org/', 'www.bar.net'])).sites.hard)
      .toEqual(['example.com', 'foo.org', 'bar.net']);
  });
  test.each(['nodots', 'bad domain.com', 'a_b.com', 'exa$mple.com', 'localhost'])('rejects site %j', (v) =>
    expect(err(sites([v]))).toContain(v.toLowerCase()));
  test('rejects an entry longer than 253 chars', () => {
    expect(err(sites(['a'.repeat(250) + '.com']))).toMatch(/253/);
  });
  test('accepts exactly 253 chars', () => {
    const d = 'a'.repeat(249) + '.com';
    expect(d.length).toBe(253);
    expect(ok(sites([d])).sites.hard).toEqual([d]);
  });
  test('max 500 entries per list', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => `s${i}.com`);
    expect(ok(sites(many(500))).sites.hard).toHaveLength(500);
    expect(err(sites(many(501)))).toMatch(/500/);
  });
  test('app entries lowercase and must be .exe names', () => {
    expect(ok(apps([' Steam.EXE ', 'my app.exe', 'a-b_c.1.exe'])).apps.hard).toEqual(['steam.exe', 'my app.exe', 'a-b_c.1.exe']);
    expect(err(apps(['steam']))).toContain('steam');
    expect(err(apps(['C:\\x\\steam.exe']))).toBeTruthy();
    expect(err(apps(['.exe']))).toBeTruthy();
  });
  test('app list limits apply too', () => {
    expect(err(apps(['a'.repeat(260) + '.exe']))).toMatch(/253/);
  });
});

describe('parseSettings: never-interrupt rule', () => {
  test('always-fine sites are present in fine even when the list is empty', () => {
    expect(ok(input()).sites.fine).toEqual(expect.arrayContaining([...ALWAYS_FINE_SITES]));
    expect(ALWAYS_FINE_SITES).toEqual(['claude.ai', 'notebooklm.google.com', 'gemini.google.com']);
  });
  test('removed from gray and hard on every save', () => {
    const s = ok(sites(['claude.ai', 'x.com', 'https://www.gemini.google.com/app'], ['notebooklm.google.com', 'youtube.com']));
    expect(s.sites.hard).toEqual(['x.com']);
    expect(s.sites.gray).toEqual(['youtube.com']);
    expect(s.sites.fine).toEqual(expect.arrayContaining([...ALWAYS_FINE_SITES]));
  });
  test('no duplicates in fine when already listed', () => {
    const s = ok(sites([], [], ['claude.ai', 'foo.com']));
    expect(s.sites.fine.filter((d) => d === 'claude.ai')).toHaveLength(1);
    expect(s.sites.fine).toContain('foo.com');
  });
});

describe('parseSettings: rhythm and streak', () => {
  const r = (over: Record<string, unknown>) => input({ rhythm: { ...DEFAULT_SETTINGS.rhythm, ...over } });
  test('boundaries', () => {
    expect(ok(r({ focusMin: 1, shortBreakMin: 180, longBreakMin: 1, longBreakEvery: 10 })).rhythm)
      .toEqual({ focusMin: 1, shortBreakMin: 180, longBreakMin: 1, longBreakEvery: 10 });
  });
  test.each([
    ['focusMin', 0], ['focusMin', 181], ['focusMin', 1.5], ['focusMin', '45'], ['focusMin', NaN],
    ['shortBreakMin', 0], ['longBreakMin', 200], ['longBreakEvery', 0], ['longBreakEvery', 11], ['longBreakEvery', 2.5],
  ])('rejects %s=%j', (k, v) => expect(err(r({ [k]: v }))).toBeTruthy());
  test('missing rhythm is an error', () => expect(err({ ...input(), rhythm: undefined })).toMatch(/rhythm/i));
  test('streakMinMinutes 1..1440 integer', () => {
    expect(ok(input({ streakMinMinutes: 1 })).streakMinMinutes).toBe(1);
    expect(ok(input({ streakMinMinutes: 1440 })).streakMinMinutes).toBe(1440);
    for (const v of [0, 1441, 3.5, '60', null]) expect(err(input({ streakMinMinutes: v }))).toMatch(/streak/i);
  });
});

describe('parseSettings: sound', () => {
  test('missing sound keeps the current value', () => {
    const cur: Settings = { ...DEFAULT_SETTINGS, sound: { ambient: 'rain', ambientVolume: 0.2, freq: null, freqVolume: 0.1 } };
    expect(ok(input(), cur).sound).toEqual(cur.sound);
  });
  test('valid sound is accepted', () => {
    const sound = { ambient: 'cafe', ambientVolume: 1, freq: { kind: 'binaural', beatHz: 10, carrierHz: 200 }, freqVolume: 0 };
    expect(ok(input({ sound })).sound).toEqual(sound);
    const pure = { ambient: 'none', ambientVolume: 0, freq: { kind: 'pure', hz: 432 }, freqVolume: 0.5 };
    expect(ok(input({ sound: pure })).sound).toEqual(pure);
  });
  test.each([
    [{ ambient: 'storm', ambientVolume: 0.5, freq: null, freqVolume: 0.5 }],
    [{ ambient: 'none', ambientVolume: 2, freq: null, freqVolume: 0.5 }],
    [{ ambient: 'none', ambientVolume: 0.5, freq: null, freqVolume: -1 }],
    [{ ambient: 'none', ambientVolume: 0.5, freq: { kind: 'laser', hz: 5 }, freqVolume: 0.5 }],
    [{ ambient: 'none', ambientVolume: 0.5, freq: { kind: 'pure' }, freqVolume: 0.5 }],
    [{ ambient: 'none', ambientVolume: 0.5, freq: { kind: 'isochronic', beatHz: 5 }, freqVolume: 0.5 }],
    ['loud'],
  ])('rejects invalid sound %j', (sound) => expect(err(input({ sound }))).toMatch(/sound/i));
});

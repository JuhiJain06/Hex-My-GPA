import { test, expect } from 'vitest';
import { classifySite, classifyApp } from '../src/lists';
import { DEFAULT_SETTINGS as D } from '../src/settings';
test('defaults', () => {
  expect(D.rhythm).toEqual({ focusMin: 45, shortBreakMin: 10, longBreakMin: 25, longBreakEvery: 3 });
  expect(D.streakMinMinutes).toBe(120);
  expect(D.sites.fine).toEqual(['claude.ai', 'notebooklm.google.com', 'gemini.google.com']);
  expect(D.sites.gray).toEqual(['youtube.com']);
  expect(D.sites.hard).toEqual(expect.arrayContaining(['instagram.com', 'facebook.com', 'x.com', 'reddit.com', 'netflix.com']));
  expect(D.apps.hard).toEqual([]);
});
test('subdomains match, unlisted is fine', () => {
  expect(classifySite('https://www.instagram.com/reels/', D.sites)).toBe('hard');
  expect(classifySite('https://m.youtube.com/watch?v=x', D.sites)).toBe('gray');
  expect(classifySite('https://khanacademy.org', D.sites)).toBe('fine');
  expect(classifySite('https://notinstagram.com', D.sites)).toBe('fine');
});
test('longest matching entry wins', () => {
  const s = { fine: ['gemini.google.com'], gray: [], hard: ['google.com'] };
  expect(classifySite('https://gemini.google.com/app', s)).toBe('fine');
  expect(classifySite('https://news.google.com', s)).toBe('hard');
});
test('apps are case-insensitive; unknown is unlisted', () => {
  expect(classifyApp('ONENOTE.EXE', D.apps)).toBe('fine');
  expect(classifyApp('steam.exe', { fine: [], gray: [], hard: ['Steam.exe'] })).toBe('hard');
  expect(classifyApp('game.exe', D.apps)).toBe('unlisted');
});
test('malformed url is fine', () => expect(classifySite('not a url', D.sites)).toBe('fine'));

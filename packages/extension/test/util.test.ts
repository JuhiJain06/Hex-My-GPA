import { expect, test } from 'vitest';
import { blockedMessage, browserKind, windowReports, isPairingCode, REPORTED_WINDOW_TYPES } from '../src/util';

test('blocked message shows the break time in local HH:MM (TZ Asia/Kolkata)', () => {
  // 2023-11-14T22:13:20Z = 03:43:20 IST next day
  expect(blockedMessage('1700000000000')).toBe('Blocked until break at 03:43');
  expect(blockedMessage(null)).toBe('Blocked during this focus block');
  expect(blockedMessage('garbage')).toBe('Blocked during this focus block');
});

test('browser kind from userAgentData brands', () => {
  expect(browserKind([{ brand: 'Microsoft Edge' }, { brand: 'Chromium' }])).toBe('edge');
  expect(browserKind([{ brand: 'Google Chrome' }])).toBe('chrome');
  expect(browserKind(undefined)).toBe('chrome');
});

test('window reports: active tab title per window, capped in length', () => {
  const wins = [
    { focused: true, incognito: false, tabs: [{ active: false, title: 'A' }, { active: true, title: 'Khan Academy' }] },
    { focused: false, incognito: true, tabs: [{ active: true, title: 'x'.repeat(1000) }] },
    { focused: false, incognito: false, tabs: [] },
    { focused: false, incognito: false },
  ] as chrome.windows.Window[];
  const r = windowReports(wins);
  expect(r[0]).toEqual({ title: 'Khan Academy', incognito: false, focused: true });
  expect(r[1].title).toHaveLength(300);
  expect(r[1].incognito).toBe(true);
  expect(r[2].title).toBe('');
  expect(r[3].title).toBe('');
});

test('pairing code is trimmed lowercase hex', () => {
  expect(isPairingCode('ab12CD')).toBe(true);
  expect(isPairingCode('')).toBe(false);
  expect(isPairingCode('xyz')).toBe(false);
  expect(isPairingCode('ab 12')).toBe(false);
});

test('window reports cover every window type the extension can see (popups, app windows, DevTools), not only normal ones', () => {
  expect([...REPORTED_WINDOW_TYPES].sort()).toEqual(['app', 'devtools', 'normal', 'popup']);
});

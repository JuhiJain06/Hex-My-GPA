import { test, expect } from 'vitest';
import { parseExtMessage, isBrowserCovered } from '../src/index';

test('parse rejects junk and wrong shapes', () => {
  expect(parseExtMessage('{')).toBeNull();
  expect(parseExtMessage('5')).toBeNull();
  expect(parseExtMessage(JSON.stringify({ t: 'zzz' }))).toBeNull();
  expect(parseExtMessage(JSON.stringify({ t: 'slip', reason: 'nope', target: 'x' }))).toBeNull();
  expect(parseExtMessage(JSON.stringify({ t: 'startSession', topic: '', mode: 'book', goal: null, plannedMin: null }))).toBeNull();
  expect(parseExtMessage(JSON.stringify({ t: 'startSession', topic: 'a', mode: 'book', goal: null, plannedMin: 0 }))).toBeNull();
  expect(parseExtMessage(JSON.stringify({ t: 'hello', secret: '', browser: 'chrome', incognitoAllowed: true }))).toBeNull();
  expect(parseExtMessage(JSON.stringify({ t: 'windows', windows: [{ title: 1, incognito: false, focused: true }] }))).toBeNull();
  expect(parseExtMessage(JSON.stringify({ t: 'videoStudy', videoId: '' }))).toBeNull();
  expect(parseExtMessage(JSON.stringify({ t: 'ping' }))).toEqual({ t: 'ping' });
});
test('parse accepts valid and drops extras', () => {
  expect(parseExtMessage(JSON.stringify({ t: 'hello', secret: 's', browser: 'edge', incognitoAllowed: false, x: 1 })))
    .toEqual({ t: 'hello', secret: 's', browser: 'edge', incognitoAllowed: false });
  expect(parseExtMessage(JSON.stringify({ t: 'startSession', topic: ' a ', mode: 'laptop', goal: 'g', plannedMin: 30, y: 2 })))
    .toEqual({ t: 'startSession', topic: ' a ', mode: 'laptop', goal: 'g', plannedMin: 30 });
  expect(parseExtMessage(JSON.stringify({ t: 'slip', reason: 'hard-block-visit', target: 'x' })))
    .toEqual({ t: 'slip', reason: 'hard-block-visit', target: 'x' });
});
const chrome = { browser: 'chrome' as const, windows: [{ title: 'Ch 4 notes', incognito: false, focused: true }] };
test('covered when a connected report has a window whose tab title prefixes the OS title', () => {
  expect(isBrowserCovered({ exe: 'chrome.exe', title: 'Ch 4 notes - Google Chrome' }, [chrome])).toBe(true);
  expect(isBrowserCovered({ exe: 'CHROME.EXE', title: 'Other tab - Google Chrome' }, [chrome])).toBe(false);
  expect(isBrowserCovered({ exe: 'msedge.exe', title: 'Ch 4 notes - Microsoft Edge' }, [chrome])).toBe(false);
  expect(isBrowserCovered({ exe: 'firefox.exe', title: 'anything' }, [chrome])).toBe(false);
  expect(isBrowserCovered({ exe: 'chrome.exe', title: 'x' }, [{ browser: 'chrome', windows: [{ title: '', incognito: false, focused: true }] }])).toBe(false);
});

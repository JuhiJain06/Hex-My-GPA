import { describe, test, expect } from 'vitest';
import { browserCoverage, browserKindOf, isBrowserCovered, isTabWindowTitle, type WindowReport } from '../src/index';

const win = (title: string): WindowReport => ({ title, incognito: false, focused: true });
const chrome = { browser: 'chrome' as const, windows: [win('Ch 4 notes')] };
const edge = { browser: 'edge' as const, windows: [win('Ch 4 notes')] };
// Edge puts a zero-width space between "Microsoft" and "Edge" in its window titles.
const EDGE = 'Microsoft​ Edge';

describe('browserKindOf', () => {
  test('maps chrome/edge exes (any case); other browsers have no extension kind', () => {
    expect(browserKindOf('chrome.exe')).toBe('chrome');
    expect(browserKindOf('MSEDGE.EXE')).toBe('edge');
    expect(browserKindOf('firefox.exe')).toBeNull();
    expect(browserKindOf('code.exe')).toBeNull();
  });
});

describe('isTabWindowTitle', () => {
  test('recognises tab-window titles by the browser suffix', () => {
    expect(isTabWindowTitle('chrome', 'Ch 4 notes - Google Chrome')).toBe(true);
    expect(isTabWindowTitle('chrome', 'Ch 4 notes - Google Chrome (Incognito)')).toBe(true);
    expect(isTabWindowTitle('chrome', 'Google Chrome')).toBe(true);
    expect(isTabWindowTitle('edge', `Ch 4 notes and 3 more pages - Personal - ${EDGE}`)).toBe(true);
    expect(isTabWindowTitle('edge', `New InPrivate tab - [InPrivate] - ${EDGE}`)).toBe(true);
    expect(isTabWindowTitle('edge', 'Ch 4 notes - Microsoft Edge')).toBe(true); // without the zero-width space
  });

  test('dialogs, DevTools, PWAs and popups without the suffix are not tab windows', () => {
    for (const t of ['Open', 'Save As', 'DevTools - www.example.com/notes', 'YouTube', 'Sign in - Google Accounts',
      'Choose a profile', 'Picture in picture', 'Google Chromebook review']) {
      expect(isTabWindowTitle('chrome', t)).toBe(false);
      expect(isTabWindowTitle('edge', t)).toBe(false);
    }
    expect(isTabWindowTitle('edge', 'Notes - Google Chrome')).toBe(false);
  });
});

describe('isBrowserCovered', () => {
  test('a reported tab window is covered; an unreported one of the same browser is not', () => {
    expect(isBrowserCovered({ exe: 'chrome.exe', title: 'Ch 4 notes - Google Chrome' }, [chrome])).toBe(true);
    expect(isBrowserCovered({ exe: 'chrome.exe', title: 'Other tab - Google Chrome' }, [chrome])).toBe(false);
    expect(isBrowserCovered({ exe: 'msedge.exe', title: `Ch 4 notes and 2 more pages - Personal - ${EDGE}` }, [edge])).toBe(true);
    expect(isBrowserCovered({ exe: 'msedge.exe', title: `Hidden - [InPrivate] - ${EDGE}` }, [edge])).toBe(false);
  });

  test('with that browser\'s extension connected, its non-tab windows (dialogs, DevTools, OAuth popups, PWAs) are covered', () => {
    for (const title of ['Open', 'Save As', 'DevTools - claude.ai/new', 'Sign in - Google Accounts', 'NotebookLM', '']) {
      expect(isBrowserCovered({ exe: 'chrome.exe', title }, [chrome])).toBe(true);
      expect(isBrowserCovered({ exe: 'msedge.exe', title }, [edge])).toBe(true);
    }
  });

  test('no extension of that browser kind connected → never covered, dialogs included', () => {
    expect(isBrowserCovered({ exe: 'msedge.exe', title: 'Open' }, [chrome])).toBe(false);
    expect(isBrowserCovered({ exe: 'chrome.exe', title: 'Save As' }, [])).toBe(false);
    expect(isBrowserCovered({ exe: 'firefox.exe', title: 'Open' }, [chrome, edge])).toBe(false);
  });
});

describe('browserCoverage (I5: only once paired and the bridge is listening)', () => {
  const fg = { exe: 'chrome.exe', title: 'Reddit - Google Chrome' };
  test('never paired, or bridge not listening → no browser is overlaid (nothing could ever cover it)', () => {
    expect(browserCoverage(fg, { listening: true, paired: false, reports: [] })).toBe(true);
    expect(browserCoverage({ exe: 'firefox.exe', title: 'x' }, { listening: true, paired: false, reports: [] })).toBe(true);
    expect(browserCoverage(fg, { listening: false, paired: true, reports: [] })).toBe(true);
  });
  test('paired and listening → the normal coverage rules', () => {
    expect(browserCoverage(fg, { listening: true, paired: true, reports: [] })).toBe(false);
    expect(browserCoverage(fg, { listening: true, paired: true, reports: [{ browser: 'chrome', windows: [win('Reddit')] }] })).toBe(true);
  });
});

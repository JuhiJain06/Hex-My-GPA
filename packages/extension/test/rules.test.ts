import { expect, test } from 'vitest';
import { buildBlockRules, shouldBlockOffline, sameRules, backoffMs } from '../src/rules';

test('one redirect rule per hard site + one for youtube shorts, main_frame only', () => {
  const r = buildBlockRules({ fine: [], gray: ['youtube.com'], hard: ['instagram.com', 'x.com'] }, 1700000000000, 'abc');
  expect(r).toHaveLength(3);
  expect(r[0].condition).toMatchObject({ requestDomains: ['instagram.com'], resourceTypes: ['main_frame'] });
  expect(r[0].action.redirect!.extensionPath).toBe('/blocked.html?site=instagram.com&until=1700000000000');
  expect(r[2].condition.regexFilter).toBe('^https?://([a-z0-9-]+\\.)*youtube\\.com/shorts/');
});

test('no shorts rule when youtube is not gray', () => {
  const r = buildBlockRules({ fine: ['youtube.com'], gray: [], hard: ['instagram.com'] }, 1, 'abc');
  expect(r).toHaveLength(1);
  expect(r.some((x) => x.condition.regexFilter)).toBe(false);
  expect(buildBlockRules({ fine: [], gray: [], hard: [] }, 1, 'abc')).toEqual([]);
});

test('ids are deterministic and start at 1; every rule is a main_frame redirect', () => {
  const r = buildBlockRules({ fine: [], gray: ['youtube.com'], hard: ['a.com', 'b.com'] }, 5, 'abc');
  expect(r.map((x) => x.id)).toEqual([1, 2, 3]);
  for (const x of r) {
    expect(x.action.type).toBe('redirect');
    expect(x.condition.resourceTypes).toEqual(['main_frame']);
  }
  expect(r[2].action.redirect!.extensionPath).toBe('/blocked.html?site=youtube.com%2Fshorts&until=5');
  expect(buildBlockRules({ fine: [], gray: ['youtube.com'], hard: ['a.com', 'b.com'] }, 5, 'abc')).toEqual(r);
});

test('normalises entries: lowercases, trims, dedupes, drops invalid domains', () => {
  const r = buildBlockRules({ fine: [], gray: [], hard: [' Instagram.COM ', 'instagram.com', '', 'bad domain', '*.x.com'] }, 1, 'abc');
  expect(r).toHaveLength(1);
  expect(r[0].condition.requestDomains).toEqual(['instagram.com']);
});

test('null until leaves the until param out', () => {
  const r = buildBlockRules({ fine: [], gray: [], hard: ['x.com'] }, null, 'abc');
  expect(r[0].action.redirect!.extensionPath).toBe('/blocked.html?site=x.com');
});

test('more specific fine/gray subdomains of a hard site are excluded from its rule', () => {
  const r = buildBlockRules({ fine: ['docs.google.com'], gray: ['news.google.com', 'other.com'], hard: ['google.com'] }, 1, 'abc');
  expect(r[0].condition.excludedRequestDomains).toEqual(['docs.google.com', 'news.google.com']);
  const plain = buildBlockRules({ fine: [], gray: [], hard: ['x.com'] }, 1, 'abc');
  expect(plain[0].condition.excludedRequestDomains).toBeUndefined();
});

test('youtube shorts rule is skipped when youtube is itself hard-blocked', () => {
  const r = buildBlockRules({ fine: [], gray: ['youtube.com'], hard: ['youtube.com'] }, 1, 'abc');
  expect(r).toHaveLength(1);
  expect(r[0].condition.requestDomains).toEqual(['youtube.com']);
});

test('offline: blocks only inside a known blocking focus block, until its end', () => {
  expect(shouldBlockOffline({ phase: 'focus', blocking: true, phaseEndsAt: 1000 }, 999)).toBe(true);
  expect(shouldBlockOffline({ phase: 'focus', blocking: true, phaseEndsAt: 1000 }, 1000)).toBe(false);
  expect(shouldBlockOffline({ phase: 'break', blocking: false, phaseEndsAt: 5000 }, 10)).toBe(false);
  expect(shouldBlockOffline(null, 10)).toBe(false);
  expect(shouldBlockOffline({ phase: 'focus', blocking: false, phaseEndsAt: 1000 }, 10)).toBe(false);
  expect(shouldBlockOffline({ phase: 'focus', blocking: true, phaseEndsAt: null }, 10)).toBe(false);
});

test('sameRules compares rule sets by value', () => {
  const a = buildBlockRules({ fine: [], gray: [], hard: ['x.com'] }, 1, 'abc');
  expect(sameRules(a, buildBlockRules({ fine: [], gray: [], hard: ['x.com'] }, 1, 'abc'))).toBe(true);
  expect(sameRules(a, buildBlockRules({ fine: [], gray: [], hard: ['x.com'] }, 2, 'abc'))).toBe(false);
  expect(sameRules([], [])).toBe(true);
});

test('reconnect backoff doubles from 1 s and caps at 30 s', () => {
  expect([0, 1, 2, 3, 4, 5, 6, 20].map(backoffMs)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
});

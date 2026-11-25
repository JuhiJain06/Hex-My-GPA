import type { Lists, Phase } from '@study-buddy/core';

type Rule = chrome.declarativeNetRequest.Rule;

const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
/** Whole-URL regexes: `\\0` in the substitution must be the complete original URL. */
const SHORTS_REGEX = '^https?://([a-z0-9-]+\\.)*youtube\\.com/shorts/[^#]*';
const ANY_URL_REGEX = '^https?://[^#]*';

function clean(list: string[]): string[] {
  const out: string[] = [];
  for (const raw of list) {
    const d = raw.trim().toLowerCase();
    if (DOMAIN.test(d) && !out.includes(d)) out.push(d);
  }
  return out;
}

/**
 * The blocked page URL; the original URL rides in the fragment (`#\\0`) so the page can offer
 * "Continue to <site>" once blocking is off.
 */
function blockedUrl(base: string, site: string, untilMs: number | null): string {
  const q = `site=${encodeURIComponent(site)}` + (untilMs === null ? '' : `&until=${untilMs}`);
  return `${base}?${q}#\\0`;
}

function redirectRule(id: number, condition: chrome.declarativeNetRequest.RuleCondition, url: string): Rule {
  return {
    id,
    priority: 1,
    action: { type: 'redirect', redirect: { regexSubstitution: url } },
    condition: { ...condition, resourceTypes: ['main_frame'] },
  };
}

/**
 * Dynamic DNR rules for a blocking focus block: one main-frame redirect to blocked.html per
 * hard site (subdomains included), plus one for YouTube Shorts when youtube.com is gray.
 * Fine/gray entries that are subdomains of a hard site are excluded from its rule, matching
 * classifySite's most-specific-entry-wins behaviour. Ids are deterministic, starting at 1.
 * `blockedBase` is the full URL of blocked.html (chrome.runtime.getURL): a regexSubstitution redirect
 * needs an absolute URL, and it carries the original URL along in the fragment.
 */
export function buildBlockRules(sites: Lists, untilMs: number | null, blockedBase: string): Rule[] {
  const hard = clean(sites.hard);
  const softer = clean([...sites.fine, ...sites.gray]);
  const rules: Rule[] = [];
  for (const site of hard) {
    const excluded = softer.filter((d) => d.endsWith('.' + site));
    const condition: chrome.declarativeNetRequest.RuleCondition = { regexFilter: ANY_URL_REGEX, requestDomains: [site] };
    if (excluded.length > 0) condition.excludedRequestDomains = excluded;
    rules.push(redirectRule(rules.length + 1, condition, blockedUrl(blockedBase, site, untilMs)));
  }
  const youtubeHard = hard.some((d) => d === 'youtube.com');
  if (clean(sites.gray).includes('youtube.com') && !youtubeHard) {
    rules.push(redirectRule(rules.length + 1, { regexFilter: SHORTS_REGEX }, blockedUrl(blockedBase, 'youtube.com/shorts', untilMs)));
  }
  return rules;
}

export interface OfflineState { phase: Phase; blocking: boolean; phaseEndsAt: number | null }

/** With the desktop unreachable, keep blocking only inside the last known blocking focus block. */
export function shouldBlockOffline(last: OfflineState | null, now: number): boolean {
  return !!last && last.phase === 'focus' && last.blocking && last.phaseEndsAt !== null && now < last.phaseEndsAt;
}

export function sameRules(a: Rule[], b: Rule[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Reconnect delay after `attempt` consecutive failures: 1, 2, 4, 8, 16, then 30 s. */
export function backoffMs(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
}

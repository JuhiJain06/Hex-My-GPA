// @vitest-environment jsdom
import { expect, test } from 'vitest';
import {
  HIDE_CSS, StudyPrompt, isShorts, mountPromptCard, parseYtMessage, setHideCss, videoIdOf, ytStateFor,
} from '../src/youtubeLogic';

const SEC = 1000;
const MIN = 60 * SEC;

function fakeClock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('ids and shorts', () => {
  expect(videoIdOf('https://www.youtube.com/watch?v=abc123&t=4')).toBe('abc123');
  expect(videoIdOf('https://www.youtube.com/results?search_query=x')).toBeNull();
  expect(isShorts('https://www.youtube.com/shorts/xyz')).toBe(true);
  // extra edges
  expect(videoIdOf('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  expect(videoIdOf('https://www.youtube.com/watch')).toBeNull();
  expect(videoIdOf('https://www.youtube.com/watch?v=<script>')).toBeNull();
  expect(videoIdOf('https://www.youtube.com/embed/abc123')).toBeNull();
  expect(videoIdOf('not a url')).toBeNull();
  expect(isShorts('https://www.youtube.com/watch?v=abc123')).toBe(false);
  expect(isShorts('https://www.youtube.com/')).toBe(false);
  expect(isShorts('https://www.youtube.com/shortsfan')).toBe(false);
  expect(isShorts('garbage')).toBe(false);
});

test('prompt: once per video; yes silences; no → slip and reask after 5 min; timeout at 30 s', () => {
  const c = fakeClock();
  const p = new StudyPrompt(c.now);

  // once per video: shows, and a repeat onVideo for the same open prompt does not restart it
  expect(p.onVideo('vidAAAAAA', [])).toBe('show');
  c.advance(20 * SEC);
  expect(p.onVideo('vidAAAAAA', [])).toBe('show');
  expect(p.tick()).toBeNull();

  // yes silences: returns the study id, never asks again for this video in this tab
  expect(p.answer(true)).toEqual({ study: 'vidAAAAAA' });
  expect(p.onVideo('vidAAAAAA', [])).toBe('none');
  c.advance(10 * MIN);
  expect(p.tick()).toBeNull();
  expect(p.onVideo('vidBBBBBB', [])).toBe('show');
  expect(p.onVideo('vidAAAAAA', [])).toBe('none');

  // no → slip, then re-ask 5 min later if still on the video
  expect(p.onVideo('vidCCCCCC', [])).toBe('show');
  expect(p.answer(false)).toEqual({ slip: 'youtube-not-study' });
  expect(p.onVideo('vidCCCCCC', [])).toBe('none');
  c.advance(5 * MIN - 1);
  expect(p.tick()).toBeNull();
  c.advance(1);
  expect(p.tick()).toBe('reask');
  expect(p.tick()).toBeNull();

  // timeout at 30 s after the (re)ask, then another re-ask 5 min later
  c.advance(30 * SEC - 1);
  expect(p.tick()).toBeNull();
  c.advance(1);
  expect(p.tick()).toBe('timeout');
  expect(p.tick()).toBeNull();
  c.advance(5 * MIN);
  expect(p.tick()).toBe('reask');

  // navigating to another video resets: no pending re-ask for the old one
  expect(p.answer(false)).toEqual({ slip: 'youtube-not-study' });
  expect(p.onVideo('vidDDDDDD', [])).toBe('show');
  c.advance(30 * SEC);
  expect(p.tick()).toBe('timeout');
  expect(p.onVideo(null, [])).toBe('none');
  c.advance(10 * MIN);
  expect(p.tick()).toBeNull();

  // reset() (blocking off) stops everything; answering with nothing open throws
  expect(p.onVideo('vidEEEEEE', [])).toBe('show');
  p.reset();
  c.advance(10 * MIN);
  expect(p.tick()).toBeNull();
  expect(() => p.answer(true)).toThrow();
});

test('already-studied video (from desktop list) never prompts', () => {
  const c = fakeClock();
  const p = new StudyPrompt(c.now);
  expect(p.onVideo('known1234', ['known1234'])).toBe('none');
  c.advance(10 * MIN);
  expect(p.tick()).toBeNull();
  // a prompt already open closes when the desktop list later includes it (yes in another tab)
  expect(p.onVideo('other1234', [])).toBe('show');
  expect(p.onVideo('other1234', ['other1234'])).toBe('none');
  c.advance(10 * MIN);
  expect(p.tick()).toBeNull();
});

test('HIDE_CSS covers the feed, related, end screens and shorts shelves', () => {
  for (const sel of [
    'ytd-browse[page-subtype="home"] #contents', '#related',
    '#secondary ytd-watch-next-secondary-results-renderer', '.ytp-endscreen-content', '.ytp-ce-element',
    'ytd-reel-shelf-renderer', 'ytd-rich-shelf-renderer[is-shorts]',
  ]) expect(HIDE_CSS).toContain(sel);
});

test('setHideCss injects once and removes', () => {
  setHideCss(document, true);
  setHideCss(document, true);
  const styles = document.querySelectorAll('style[data-study-buddy]');
  expect(styles.length).toBe(1);
  expect(styles[0].textContent).toBe(HIDE_CSS);
  setHideCss(document, false);
  expect(document.querySelectorAll('style[data-study-buddy]').length).toBe(0);
});

test('prompt card: closed shadow root, text, yes/no callbacks, show/hide', () => {
  const answers: boolean[] = [];
  const card = mountPromptCard(document, (s) => answers.push(s));
  expect(card.host.isConnected).toBe(true);
  expect(card.host.shadowRoot).toBeNull(); // closed
  expect(card.visible()).toBe(false);
  card.show();
  expect(card.visible()).toBe(true);
  expect(card.text()).toContain('Is this for study?');
  card.yes.click();
  card.no.click();
  expect(answers).toEqual([true, false]);
  card.hide();
  expect(card.visible()).toBe(false);
  card.remove();
  expect(card.host.isConnected).toBe(false);
});

test('content state: live when connected, offline only inside the last focus block', () => {
  const last = {
    t: 'state' as const, phase: 'focus' as const, blocking: true, topic: 'Calc', phaseEndsAt: 5000,
    sites: { fine: [], gray: [], hard: [] }, studyVideos: ['abc123'],
  };
  expect(ytStateFor(last, true, 9999)).toEqual({ blocking: true, topic: 'Calc', studyVideos: ['abc123'] });
  expect(ytStateFor(last, false, 4999).blocking).toBe(true);
  expect(ytStateFor(last, false, 5000).blocking).toBe(false);
  expect(ytStateFor({ ...last, blocking: false }, true, 0).blocking).toBe(false);
  expect(ytStateFor(null, false, 0)).toEqual({ blocking: false, topic: null, studyVideos: [] });
});

test('content-script messages are validated by sender, reason and shape', () => {
  const ok = { tab: { id: 3 }, frameId: 0, url: 'https://www.youtube.com/watch?v=abc123' };
  expect(parseYtMessage({ type: 'yt-study', videoId: 'abc123' }, ok)).toEqual({ t: 'videoStudy', videoId: 'abc123' });
  expect(parseYtMessage({ type: 'yt-slip', reason: 'youtube-timeout', target: 'youtube.com' }, ok))
    .toEqual({ t: 'slip', reason: 'youtube-timeout', target: 'youtube.com' });
  expect(parseYtMessage({ type: 'yt-slip', reason: 'youtube-not-study', target: 'youtube.com' }, ok))
    .toEqual({ t: 'slip', reason: 'youtube-not-study', target: 'youtube.com' });
  expect(parseYtMessage({ type: 'yt-slip', reason: 'hard-block-visit', target: 'youtube.com/shorts' }, ok))
    .toEqual({ t: 'slip', reason: 'hard-block-visit', target: 'youtube.com/shorts' });
  expect(parseYtMessage({ type: 'yt-study', videoId: 'abc123' }, { ...ok, url: 'https://youtube.com/' })).not.toBeNull();

  // bad sender
  expect(parseYtMessage({ type: 'yt-study', videoId: 'abc123' }, { ...ok, tab: undefined })).toBeNull();
  expect(parseYtMessage({ type: 'yt-study', videoId: 'abc123' }, { ...ok, frameId: 1 })).toBeNull();
  expect(parseYtMessage({ type: 'yt-study', videoId: 'abc123' }, { ...ok, url: 'https://evil.com/?youtube.com' })).toBeNull();
  expect(parseYtMessage({ type: 'yt-study', videoId: 'abc123' }, { ...ok, url: 'https://notyoutube.com/' })).toBeNull();
  expect(parseYtMessage({ type: 'yt-study', videoId: 'abc123' }, { ...ok, url: undefined })).toBeNull();
  // bad shapes
  expect(parseYtMessage({ type: 'yt-study', videoId: 'abc' }, ok)).toBeNull();
  expect(parseYtMessage({ type: 'yt-study', videoId: 'abc123!!' }, ok)).toBeNull();
  expect(parseYtMessage({ type: 'yt-study', videoId: 'a'.repeat(21) }, ok)).toBeNull();
  expect(parseYtMessage({ type: 'yt-slip', reason: 'other', target: 'youtube.com' }, ok)).toBeNull();
  expect(parseYtMessage({ type: 'yt-slip', reason: 'youtube-timeout', target: 'evil.com' }, ok)).toBeNull();
  expect(parseYtMessage({ type: 'yt-slip', reason: 'hard-block-visit', target: 'youtube.com' }, ok)).toBeNull();
  expect(parseYtMessage({ type: 'yt-slip', reason: 'youtube-timeout', target: 'youtube.com/shorts' }, ok)).toBeNull();
  expect(parseYtMessage(null, ok)).toBeNull();
  expect(parseYtMessage({ type: 'nope' }, ok)).toBeNull();
});

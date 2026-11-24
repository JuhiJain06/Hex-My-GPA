import { expect, test } from 'vitest';
import { parseDesktopMessage } from '../src/messages';

const state = {
  t: 'state', phase: 'focus', blocking: true, topic: 'Calculus', phaseEndsAt: 1700000000000,
  sites: { fine: ['khanacademy.org'], gray: ['youtube.com'], hard: ['instagram.com'] }, studyVideos: ['abc123'], todayMs: 5400000, streakDays: 3, animal: 'fox',
};

test('parses helloAck', () => {
  expect(parseDesktopMessage('{"t":"helloAck","ok":true}')).toEqual({ t: 'helloAck', ok: true });
  expect(parseDesktopMessage('{"t":"helloAck","ok":false}')).toEqual({ t: 'helloAck', ok: false });
  expect(parseDesktopMessage('{"t":"helloAck","ok":"yes"}')).toBeNull();
});

test('parses a full state and copies only known fields', () => {
  expect(parseDesktopMessage(JSON.stringify({ ...state, extra: 1 }))).toEqual(state);
  expect(parseDesktopMessage(JSON.stringify({ ...state, topic: null, phaseEndsAt: null, phase: 'idle', blocking: false })))
    .toMatchObject({ topic: null, phaseEndsAt: null, phase: 'idle' });
});

test('rejects malformed state', () => {
  const bad = [
    { ...state, phase: 'nap' },
    { ...state, blocking: 1 },
    { ...state, topic: 3 },
    { ...state, phaseEndsAt: 'soon' },
    { ...state, phaseEndsAt: [1] },
    { ...state, sites: null },
    { ...state, sites: { fine: [], gray: [] } },
    { ...state, sites: { fine: [], gray: [1], hard: [] } },
    { ...state, studyVideos: 'abc' },
    { ...state, studyVideos: [null] },
    { ...state, todayMs: -1 },
    { ...state, todayMs: '5' },
    { ...state, streakDays: -2 },
    { ...state, streakDays: null },
    { ...state, todayMs: undefined },
    { ...state, animal: 'dragon' },
    { ...state, animal: 'Fox' },
    { ...state, animal: null },
    { ...state, animal: 3 },
  ];
  for (const b of bad) expect(parseDesktopMessage(JSON.stringify(b))).toBeNull();
  expect(parseDesktopMessage(JSON.stringify(state).replace('1700000000000', '1e999'))).toBeNull(); // Infinity
});

test('state animal: every animal parses; missing means cat (older desktop / stored lastState)', () => {
  for (const animal of ['cat', 'fox', 'panda', 'bunny', 'penguin', 'hamster']) {
    expect(parseDesktopMessage(JSON.stringify({ ...state, animal }))).toMatchObject({ animal });
  }
  const { animal: _omit, ...old } = state;
  expect(parseDesktopMessage(JSON.stringify(old))).toEqual({ ...state, animal: 'cat' });
});

test('rejects garbage', () => {
  for (const raw of ['', 'not json', 'null', '[]', '42', '{"t":"ping"}', '{}']) expect(parseDesktopMessage(raw)).toBeNull();
});

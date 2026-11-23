export const SHORT_SUGGESTIONS: string[] = [
  'Stand up and stretch',
  'Drink water',
  'Look out a window for 20 s',
  'Roll your shoulders',
  'Take five slow breaths',
  'Rest your eyes',
];

export const LONG_SUGGESTIONS: string[] = [
  'Walk around',
  'Eat something',
  'Step outside for fresh air',
  'Make a warm drink',
  'Do a few stretches',
  'Tidy your desk',
];

export function pickSuggestion(long: boolean, last: string | null, rand: () => number = Math.random): string {
  const list = long ? LONG_SUGGESTIONS : SHORT_SUGGESTIONS;
  const pool = list.length > 1 ? list.filter((s) => s !== last) : list;
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
}

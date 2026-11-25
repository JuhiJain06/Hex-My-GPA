import { describe, test, expect } from 'vitest';
import { parseStart } from '../src/main/startRequest';

describe('parseStart (start window and extension side panel)', () => {
  test('caps topic (200) and goal (500), trims, rounds and caps plannedMin', () => {
    // What the extension sends after parseExtMessage: topic only checked non-blank, any positive plannedMin.
    const r = parseStart({ topic: `  ${'t'.repeat(300)} `, mode: 'book', goal: 'g'.repeat(900), plannedMin: 99_999.4 });
    expect(r).toEqual({ topic: 't'.repeat(200), mode: 'book', goal: 'g'.repeat(500), plannedMin: 1440 });
    expect(parseStart({ topic: 'Maths', mode: 'laptop', goal: '  ', plannedMin: 30.6 }))
      .toEqual({ topic: 'Maths', mode: 'laptop', goal: null, plannedMin: 31 });
  });

  test('rejects a blank topic or unknown mode', () => {
    expect(parseStart({ topic: '   ', mode: 'laptop', goal: null, plannedMin: null })).toBeNull();
    expect(parseStart({ topic: 'x', mode: 'phone', goal: null, plannedMin: null })).toBeNull();
    expect(parseStart(null)).toBeNull();
  });
});

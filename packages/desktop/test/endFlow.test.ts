import { describe, test, expect, vi, afterEach } from 'vitest';
import { schedulePetClose, PET_FADE_CLOSE_MS } from '../src/main/endFlow';

afterEach(() => vi.useRealTimers());

describe('schedulePetClose', () => {
  test('closes only after the fade has played', () => {
    vi.useFakeTimers();
    const close = vi.fn();
    schedulePetClose(close, () => false);
    vi.advanceTimersByTime(PET_FADE_CLOSE_MS - 1);
    expect(close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
  test('the fade outlasts the 2 s sound fade-out', () => expect(PET_FADE_CLOSE_MS).toBeGreaterThanOrEqual(2000));
  test('does not close the pet window if a new session started meanwhile', () => {
    vi.useFakeTimers();
    const close = vi.fn();
    schedulePetClose(close, () => true);
    vi.advanceTimersByTime(PET_FADE_CLOSE_MS + 10);
    expect(close).not.toHaveBeenCalled();
  });
});

import { describe, test, expect } from 'vitest';
import { CHANNELS, IPC, isChannel } from '../src/shared/ipc';

describe('preload allow-list after the pet replaced the mini window', () => {
  test('no mini channel is left', () => {
    expect(CHANNELS.some((c) => c.startsWith('mini:'))).toBe(false);
    expect(isChannel('mini:resize')).toBe(false);
  });
  test('the pet channels are exactly these', () => {
    expect(CHANNELS.filter((c) => c.startsWith('pet:')).sort()).toEqual(
      ['pet:drag', 'pet:dragEnd', 'pet:hit', 'pet:layout', 'pet:menu', 'pet:resetPos'].sort());
    expect(IPC.petDrag).toBe('pet:drag');
  });
  test('channel names are unique', () => expect(new Set(CHANNELS).size).toBe(CHANNELS.length));
});

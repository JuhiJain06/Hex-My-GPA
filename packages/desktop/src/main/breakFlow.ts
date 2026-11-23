import type { EngineEvent } from '@study-buddy/core';

export type BreakWindowAction = 'show' | 'showFocused' | 'close' | null;

/**
 * What the break window should do for an engine event. 'showFocused' recreates the
 * window if the user closed it, so the 1-minute warning and "Back to <topic>?" are never lost.
 */
export function breakWindowAction(e: EngineEvent): BreakWindowAction {
  switch (e.type) {
    case 'breakStarted': return 'show';
    case 'breakOneMinuteLeft':
    case 'breakEnded': return 'showFocused';
    case 'focusStarted': return 'close';
    default: return null;
  }
}

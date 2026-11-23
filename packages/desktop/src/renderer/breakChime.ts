import type { EngineEventMsg, UiState } from '../shared/ipc';

export type BreakInput = { kind: 'state'; state: UiState } | { kind: 'event'; event: EngineEventMsg };

/**
 * Whether the break window should chime. A window opened (or recreated) during a break
 * missed the event that opened it, so it chimes once on its first break state; that covers
 * both break start and a window recreated at the 1-minute warning. An open window chimes
 * for the warning and break-end events.
 */
export function breakChime(input: BreakInput, chimedOnLoad: boolean): boolean {
  if (input.kind === 'state') return !chimedOnLoad && input.state.phase === 'break';
  return input.event.type === 'breakOneMinuteLeft' || input.event.type === 'breakEnded';
}

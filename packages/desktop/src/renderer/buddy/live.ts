import { moodFor, type Animal, type Mood } from '@study-buddy/core';
import { buddy, IPC, onEngine, onState, type UiState } from '../api';
import { buddySlot } from '@study-buddy/core/buddy/draw';

/**
 * Shows the study buddy in `host`, following the app: UiState (animal, phase, pause), `buddy:slip`
 * (sad for 3 s) and the planned-length event (celebrate until the next phase change).
 */
export function liveBuddy(host: Element, size: number): void {
  const slot = buddySlot(host, size);
  let state: UiState | null = null;
  let recentSlipAt: number | null = null;
  let celebrating = false;
  let celebratePhase: string | null = null;

  const render = () => {
    if (!state) return;
    if (celebrating && state.phase !== celebratePhase) celebrating = false;
    const mood: Mood = moodFor({
      phase: state.phase,
      paused: state.pausedSince !== null,
      recentSlipAt,
      celebrating,
      phaseEndsAt: state.phaseEndsAt,
    }, Date.now());
    slot.set(state.animal as Animal, mood);
  };

  onState((s) => { state = s; render(); });
  buddy.on(IPC.buddySlip, (at) => {
    if (typeof at === 'number' && Number.isFinite(at)) { recentSlipAt = at; render(); }
  });
  onEngine((e) => {
    if (e.type === 'plannedLengthReached') {
      celebrating = true;
      celebratePhase = state?.phase ?? null;
      render();
    }
  });
  setInterval(render, 250);
}

/** A buddy with a set mood (null: not yet known) whose animal follows the settings (start, summary, overlay). */
export function staticBuddy(host: Element, size: number, mood: () => Mood | null): { refresh(): void } {
  const slot = buddySlot(host, size);
  let animal: Animal | null = null;
  const refresh = () => {
    const m = mood();
    if (animal && m) slot.set(animal, m);
  };
  // Draw only once the chosen animal is known, so a fox user never sees a cat flash by.
  onState((s) => { animal = s.animal; refresh(); });
  return { refresh };
}

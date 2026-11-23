import { $, buddy, chime, IPC, mmss, onEngine, onState, type UiState } from './api';

let state: UiState | null = null;
let chimedForBreak = false;

function render(): void {
  const s = state;
  if (!s) return;
  const awaiting = s.phase === 'awaitingNext';
  $('during').classList.toggle('hidden', awaiting);
  $('back').classList.toggle('hidden', !awaiting);
  $('suggestion').textContent = s.suggestion ?? '';
  $('countdown').textContent = s.phaseEndsAt !== null ? mmss(s.phaseEndsAt - Date.now()) : '00:00';
  $('backMsg').textContent = `Back to ${s.topic ?? 'studying'}?`;
  document.title = awaiting ? 'Break over' : 'Break';
}

onState((s) => {
  state = s;
  // The window opens on breakStarted (before it can hear that event), so it chimes on first sight of the break.
  if (s.phase === 'break' && !chimedForBreak) {
    chimedForBreak = true;
    chime();
  }
  render();
});
onEngine((e) => {
  if (e.type === 'breakOneMinuteLeft' || e.type === 'breakEnded') chime();
});
setInterval(render, 250);

$('start').addEventListener('click', () => buddy.send(IPC.blockNext));
$('endSession').addEventListener('click', () => buddy.send(IPC.sessionEnd));

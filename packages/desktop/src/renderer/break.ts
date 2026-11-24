import { $, buddy, chime, IPC, mmss, onEngine, onState, type UiState } from './api';
import { breakChime } from './breakChime';
import { liveBuddy } from './buddy/live';

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
  if (breakChime({ kind: 'state', state: s }, chimedForBreak)) {
    chimedForBreak = true;
    chime();
  }
  render();
});
onEngine((e) => {
  if (breakChime({ kind: 'event', event: e }, chimedForBreak)) chime();
});
setInterval(render, 250);
liveBuddy($('buddy'), 160);

$('start').addEventListener('click', () => buddy.send(IPC.blockNext));
$('endSession').addEventListener('click', () => buddy.send(IPC.sessionEnd));

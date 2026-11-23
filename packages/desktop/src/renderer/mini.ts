import { $, buddy, hm, IPC, mmss, onEngine, onState, type UiState } from './api';

const params = new URLSearchParams(location.search);
const PHONE_MS = 10_000;
let state: UiState | null = null;

const time = $('time');
const label = $('label');
const btn = (id: string) => $<HTMLButtonElement>(id);

function render(): void {
  const s = state;
  if (!s) return;
  $('topic').textContent = s.topic ?? '';
  $('today').textContent = hm(s.todayMs);
  $('streak').textContent = String(s.streakDays);
  $('ext').classList.toggle('hidden', s.extensionConnected);

  const paused = s.phase === 'focus' && s.pausedSince !== null;
  time.classList.toggle('paused', paused);
  time.title = paused ? 'Click to resume' : '';
  if (paused) time.textContent = 'Paused';
  else if (s.phaseEndsAt !== null) time.textContent = mmss(s.phaseEndsAt - Date.now());
  else time.textContent = s.phase === 'awaitingNext' ? 'Break over' : '--:--';

  label.textContent = s.phase === 'focus' ? (s.blockingActive ? 'Focus' : 'Focus · unblocked')
    : s.phase === 'break' ? 'Break' : s.phase === 'awaitingNext' ? 'Ready?' : '';
  btn('extend').disabled = s.phase !== 'focus';
  btn('endBlock').disabled = s.phase !== 'focus';
  btn('blockingOff').disabled = !s.blockingActive;
}

onState((s) => { state = s; render(); });
setInterval(render, 250);

time.addEventListener('click', () => { if (state?.pausedSince != null) buddy.send(IPC.sessionResume); });
btn('extend').addEventListener('click', () => buddy.send(IPC.blockExtend));
btn('endBlock').addEventListener('click', () => buddy.send(IPC.blockEndEarly));
btn('blockingOff').addEventListener('click', () => buddy.send(IPC.windowOpen, 'bypass'));
btn('end').addEventListener('click', () => buddy.send(IPC.sessionEnd));

if (params.get('phone') === '1') {
  $('phone').classList.remove('hidden');
  setTimeout(() => $('phone').classList.add('hidden'), PHONE_MS);
}

const plannedMin = Number(params.get('planned'));
onEngine((e) => {
  if (e.type !== 'plannedLengthReached' || !(plannedMin > 0)) return;
  const h = Math.round((plannedMin / 60) * 100) / 100;
  $('plannedMsg').textContent = `You hit your planned ${h} h`;
  $('planned').classList.remove('hidden');
});
btn('plannedKeep').addEventListener('click', () => $('planned').classList.add('hidden'));
btn('plannedEnd').addEventListener('click', () => buddy.send(IPC.sessionEnd));

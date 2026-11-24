import type { DesktopToExt } from '@study-buddy/core';
import { buddySlot } from '@study-buddy/core/buddy/draw';
import { formatHm, formatTimeLeft, panelMood } from './panelLogic';

type StateMsg = Extract<DesktopToExt, { t: 'state' }>;
interface PanelUpdate { connected: boolean; state: StateMsg | null }

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let cur: PanelUpdate = { connected: false, state: null };
const buddyEl = $('buddy');
const buddy = buddySlot(buddyEl, 64);

function render(): void {
  const { connected, state } = cur;
  const active = connected && state !== null && state.phase !== 'idle';
  $('offline').hidden = connected;
  $('live').hidden = !active;
  $('start').hidden = !(connected && !active);
  if (active && state) {
    $('topic').textContent = state.topic ?? '';
    $('today').textContent = formatHm(state.todayMs);
    $('streak').textContent = `${state.streakDays} day${state.streakDays === 1 ? '' : 's'}`;
  }
  tick();
}

function tick(): void {
  const s = cur.state;
  const counting = s !== null && (s.phase === 'focus' || s.phase === 'break');
  $('timeLeft').textContent = counting ? formatTimeLeft(s.phaseEndsAt, Date.now()) : '--:--';
  // The chosen animal in the mood of the moment (redrawn only when the animal or mood changes).
  buddyEl.hidden = !cur.connected || s === null;
  if (cur.connected && s !== null) buddy.set(s.animal, panelMood(s, Date.now()));
}
setInterval(tick, 1000);

// The background worker can be killed; the port then drops and we reconnect, and it pushes on connect.
function connectPort(): void {
  const p = chrome.runtime.connect({ name: 'panel' });
  p.onMessage.addListener((m: PanelUpdate) => { cur = m; render(); });
  p.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    setTimeout(connectPort, 500);
  });
}
connectPort();
render();

$('start').addEventListener('submit', (e) => {
  e.preventDefault();
  const msg = $('startMsg');
  const hoursRaw = $<HTMLInputElement>('hours').value.trim();
  const hours = hoursRaw === '' ? null : Number(hoursRaw);
  if (hours !== null && !(Number.isFinite(hours) && hours > 0)) { msg.textContent = 'Planned hours must be a positive number.'; return; }
  const topic = $<HTMLInputElement>('topicIn').value.trim();
  if (topic === '') { msg.textContent = 'Enter a topic.'; return; }
  msg.textContent = '';
  void chrome.runtime.sendMessage({
    type: 'panel-start', topic, mode: $<HTMLSelectElement>('mode').value,
    goal: $<HTMLInputElement>('goal').value, plannedMin: hours === null ? null : Math.max(1, Math.round(hours * 60)),
  }).then((r: { ok?: boolean } | undefined) => {
    if (!r?.ok) msg.textContent = 'Could not start (desktop not connected or invalid input).';
  }).catch(() => { msg.textContent = 'Could not reach the extension background.'; });
});

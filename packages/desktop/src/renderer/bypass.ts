import { BYPASS_SENTENCE } from '@study-buddy/core';
import { $, buddy, IPC, onState } from './api';

const CLOSE_AFTER_MS = 1500;
const input = $<HTMLInputElement>('sentenceInput');
$('sentence').textContent = BYPASS_SENTENCE;

// The sentence must be typed: no paste, no drag-and-drop, no context menu.
for (const ev of ['paste', 'drop', 'dragover'] as const) input.addEventListener(ev, (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => e.preventDefault());

let closing = false;
function alreadyOff(): void {
  if (closing) return;
  closing = true;
  $('form').classList.add('hidden');
  $('off').classList.remove('hidden');
  setTimeout(() => buddy.send(IPC.windowClose), CLOSE_AFTER_MS);
}

function shake(): void {
  input.value = '';
  input.classList.remove('shake');
  void input.offsetWidth; // restart the animation
  input.classList.add('shake');
  input.focus();
}
input.addEventListener('animationend', () => input.classList.remove('shake'));

let busy = false;
async function confirm(): Promise<void> {
  if (busy || closing) return;
  busy = true;
  try {
    const ok = await buddy.invoke<boolean>(IPC.blockingOff, input.value);
    if (ok) closing = true; // main closes the window
    else shake();
  } finally {
    busy = false;
  }
}

$('confirm').addEventListener('click', () => void confirm());
input.addEventListener('keydown', (e) => { if (e.key === 'Enter') void confirm(); });
$('cancel').addEventListener('click', () => buddy.send(IPC.windowClose));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') buddy.send(IPC.windowClose); });

// Ignored while our own Confirm is in flight: success turns blocking off and main closes us.
onState((s) => { if (!s.blockingActive && !busy) alreadyOff(); });
input.focus();

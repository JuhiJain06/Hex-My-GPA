import { $, buddy, IPC } from './api';
import type { Mode } from '@study-buddy/core';

let mode: Mode = 'laptop';
const topic = $<HTMLInputElement>('topic');
const goal = $<HTMLInputElement>('goal');
const hours = $<HTMLInputElement>('hours');
const error = $('error');

function setMode(m: Mode): void {
  mode = m;
  $('laptop').setAttribute('aria-pressed', String(m === 'laptop'));
  $('book').setAttribute('aria-pressed', String(m === 'book'));
}
$('laptop').addEventListener('click', () => setMode('laptop'));
$('book').addEventListener('click', () => setMode('book'));

const markGoal = () => goal.classList.toggle('empty', goal.value.trim() === '');
goal.addEventListener('input', markGoal);
markGoal();
topic.focus();

$<HTMLFormElement>('form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  error.textContent = '';
  if (!topic.value.trim()) {
    error.textContent = 'Please enter a topic.';
    topic.focus();
    return;
  }
  const h = Number(hours.value);
  try {
    const res = await buddy.invoke<{ ok: boolean; error?: string }>(IPC.sessionStart, {
      topic: topic.value,
      mode,
      goal: goal.value.trim() || null,
      plannedMin: hours.value && h > 0 ? Math.round(h * 60) : null,
    });
    if (!res.ok) error.textContent = res.error ?? 'Could not start.';
  } catch (err) {
    console.error('session:start failed', err);
    error.textContent = 'Could not start the session. Please try again.';
  }
});

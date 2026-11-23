import { REFLECTION_TAGS } from '@study-buddy/core';
import { $, buddy, IPC } from './api';

const params = new URLSearchParams(location.search);
const sessionId = Number(params.get('session'));
const hasGoal = params.get('goal') === '1';

let goal: 'yes' | 'partly' | 'no' | null = null;
const tags = new Set<string>();
const error = $('error');

if (!hasGoal) $('goalSection').classList.add('hidden');

const goalButtons = Array.from($('goalChoice').querySelectorAll('button'));
for (const b of goalButtons) {
  b.addEventListener('click', () => {
    const v = b.dataset.v as 'yes' | 'partly' | 'no';
    goal = goal === v ? null : v;
    for (const o of goalButtons) o.setAttribute('aria-pressed', String(o.dataset.v === goal));
  });
}

for (const tag of REFLECTION_TAGS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = tag;
  b.setAttribute('aria-pressed', 'false');
  b.addEventListener('click', () => {
    if (!tags.delete(tag)) tags.add(tag);
    b.setAttribute('aria-pressed', String(tags.has(tag)));
  });
  $('chips').appendChild(b);
}

const close = () => buddy.send(IPC.windowClose);
$('skip').addEventListener('click', close);
$('save').addEventListener('click', async () => {
  error.textContent = '';
  const note = $<HTMLTextAreaElement>('note').value.trim().slice(0, 500);
  try {
    const res = await buddy.invoke<{ ok: boolean }>(IPC.reflectionSave, {
      sessionId,
      goal: hasGoal ? goal : null,
      tags: REFLECTION_TAGS.filter((t) => tags.has(t)),
      note: note || null,
    });
    if (res.ok) close(); else error.textContent = 'Could not save. You can skip instead.';
  } catch (err) {
    console.error('reflection:save failed', err);
    error.textContent = 'Could not save. You can skip instead.';
  }
});

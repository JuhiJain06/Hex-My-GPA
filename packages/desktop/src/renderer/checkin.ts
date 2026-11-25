import { $, buddy, chime, IPC } from './api';
import type { CheckinAnswerMsg } from '../shared/ipc';
import { createClickArming } from '../shared/arming';

const params = new URLSearchParams(location.search);
const book = params.get('mode') === 'book';
const send = (m: CheckinAnswerMsg) => buddy.send(IPC.checkinAnswer, m);
// Shown inactive, possibly right under the pointer: a click in its first 500 ms was meant for
// whatever was there before, so the answer buttons ignore it.
const arming = createClickArming(() => performance.now());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') arming.shown(); });

$('topic').textContent = params.get('topic') ?? 'your topic';
document.body.classList.toggle('book', book);
$('pagesRow').classList.toggle('hidden', !book);
$('switched').classList.toggle('hidden', book);

// The window is non-focusable so it never steals keystrokes. Clicking a text input is the one
// moment we ask main to make it focusable (and focus it) so the user can type.
for (const id of ['pages', 'newTopicInput']) {
  $(id).addEventListener('mousedown', () => buddy.send(IPC.checkinFocus));
}

function openTopicInput(): void {
  $('main').classList.add('hidden');
  $('newTopic').classList.remove('hidden');
  buddy.send(IPC.checkinFocus);
  setTimeout(() => $<HTMLInputElement>('newTopicInput').focus(), 50);
}

$('yes').addEventListener('click', arming.guard(() => {
  const raw = $<HTMLInputElement>('pages').value.trim();
  const pages = Number(raw);
  if (book && raw !== '' && Number.isInteger(pages) && pages >= 0 && pages <= 2000) send({ answer: 'pages', pages });
  else send({ answer: 'yes' });
}));
$('drifted').addEventListener('click', arming.guard(() => send({ answer: 'drifted' })));
$('switched').addEventListener('click', arming.guard(openTopicInput));
buddy.on(IPC.checkinSwitch, openTopicInput);
$('newTopic').addEventListener('submit', (e) => {
  e.preventDefault();
  const topic = $<HTMLInputElement>('newTopicInput').value.trim();
  if (topic) send({ answer: 'switched', topic });
});
$('pages').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('yes').click(); });

if (book) chime();

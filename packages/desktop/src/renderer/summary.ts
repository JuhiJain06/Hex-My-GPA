import { $, buddy, hm, IPC } from './api';
import { bypassLabel } from '../shared/labels';
import type { SummaryView } from '../shared/ipc';

function rows(listId: string, items: [string, string][], emptyText: string): void {
  const ul = $(listId);
  ul.replaceChildren();
  if (items.length === 0) items = [[emptyText, '']];
  for (const [label, value] of items) {
    const li = document.createElement('li');
    const a = document.createElement('span');
    a.textContent = label;
    const b = document.createElement('span');
    b.textContent = value;
    li.append(a, b);
    ul.appendChild(li);
  }
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function render(v: SummaryView): void {
  const s = v.summary;
  $('topic').textContent = v.topic;
  $('goal').textContent = v.goal ? `Goal: ${v.goal}` : '';
  $('total').textContent = hm(s.focusMs);
  const vs = $('vs');
  if (s.vsAverageMs === null) vs.textContent = '';
  else {
    const min = Math.round(s.vsAverageMs / 60_000);
    vs.textContent = `${min >= 0 ? '+' : '-'}${Math.abs(min)} min vs your average`;
  }
  $('blocks').textContent = String(s.blocksCompleted);
  rows('slips', Object.entries(s.slipsByTarget).sort((a, b) => b[1] - a[1]).map(([t, n]) => [t, String(n)]), 'None');
  const c = s.checkins;
  const checkins: [string, string][] = [
    ['Yes, on topic', String(c.yes)],
    ['Switched topic', String(c.switched)],
    ['Drifted', String(c.drifted)],
    ['Ignored', String(c.ignored)],
  ];
  if (v.mode === 'book') checkins.push(['Pages', String(c.pages)]);
  rows('checkins', checkins, '');
  $('overruns').textContent = String(s.overruns);
  if (s.bypasses.length > 0) {
    $('bypasses').classList.remove('hidden');
    rows('bypassList', s.bypasses.map((b) => [bypassLabel(b.target), clock(b.at)]), '');
  }
}

$('done').addEventListener('click', () => buddy.send(IPC.windowClose));
const sessionId = Number(new URLSearchParams(location.search).get('session'));
void buddy.invoke<SummaryView | null>(IPC.summaryGet, sessionId)
  .then((v) => { if (v) render(v); else $('topic').textContent = 'Summary not available'; })
  .catch((err) => { console.error('summary:get failed', err); $('topic').textContent = 'Summary not available'; });

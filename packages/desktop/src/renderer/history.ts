import { $, buddy, IPC } from './api';
import type { HistoryView } from '../shared/ipc';

function render(h: HistoryView): void {
  $('streak').textContent = h.streakDays > 0 ? `${h.streakDays}-day streak` : 'No streak yet';
  const max = Math.max(1, ...h.days.map((d) => d.ms));
  const bars = $('bars');
  bars.replaceChildren();
  h.days.forEach((d, i) => {
    const col = document.createElement('div');
    col.className = 'col';
    col.title = d.day;
    const val = document.createElement('div');
    val.className = 'val';
    const min = Math.round(d.ms / 60_000);
    val.textContent = min > 0 ? String(min) : '';
    const bar = document.createElement('div');
    bar.className = i === h.days.length - 1 ? 'bar today' : 'bar';
    bar.style.height = `${Math.round((d.ms / max) * 160)}px`;
    col.append(val, bar);
    bars.appendChild(col);
  });
  $('from').textContent = h.days[0]?.day ?? '';
  const ul = $('tags');
  ul.replaceChildren();
  const items = h.tags.length > 0 ? h.tags : [{ tag: 'Nothing recorded yet', count: -1 }];
  for (const t of items) {
    const li = document.createElement('li');
    const a = document.createElement('span');
    a.textContent = t.tag;
    const b = document.createElement('span');
    b.textContent = t.count >= 0 ? String(t.count) : '';
    li.append(a, b);
    ul.appendChild(li);
  }
}

void buddy.invoke<HistoryView>(IPC.historyGet).then(render).catch((err) => console.error('history:get failed', err));

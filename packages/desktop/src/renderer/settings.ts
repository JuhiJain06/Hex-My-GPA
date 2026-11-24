import { $, buddy, IPC } from './api';
import { ANIMALS, type Animal, type Lists, type Settings } from '@study-buddy/core';
import { drawBuddy } from './buddy/draw';
import type { SettingsSaveResult } from '../shared/ipc';

const LIST_KEYS = ['fine', 'gray', 'hard'] as const;
const NUM_FIELDS = ['focusMin', 'shortBreakMin', 'longBreakMin', 'longBreakEvery'] as const;
const area = (group: 'sites' | 'apps', k: string) => $<HTMLTextAreaElement>(`${group}-${k}`);
const num = (id: string) => $<HTMLInputElement>(id);

let animal: Animal = 'cat';
const tiles = new Map<Animal, HTMLButtonElement>();

function selectAnimal(a: Animal): void {
  animal = a;
  for (const [id, tile] of tiles) {
    tile.setAttribute('aria-checked', String(id === a));
    tile.tabIndex = id === a ? 0 : -1;
  }
}

for (const a of ANIMALS) {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'tile';
  tile.setAttribute('role', 'radio');
  tile.dataset.animal = a.id;
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = a.label;
  tile.append(drawBuddy(a.id, 'wave', 64), name);
  tile.addEventListener('click', () => selectAnimal(a.id));
  tiles.set(a.id, tile);
  $('animals').appendChild(tile);
}
// Arrow keys move the choice, as in any radio group.
$('animals').addEventListener('keydown', (ev) => {
  const step = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 0;
  if (!step) return;
  ev.preventDefault();
  const i = ANIMALS.findIndex((x) => x.id === animal);
  const next = ANIMALS[(i + step + ANIMALS.length) % ANIMALS.length]!.id;
  selectAnimal(next);
  tiles.get(next)?.focus();
});
selectAnimal(animal);

function fill(s: Settings): void {
  if (ANIMALS.some((a) => a.id === s.animal)) selectAnimal(s.animal);
  for (const k of LIST_KEYS) {
    area('sites', k).value = s.sites[k].join('\n');
    area('apps', k).value = s.apps[k].join('\n');
  }
  for (const f of NUM_FIELDS) num(f).value = String(s.rhythm[f]);
  num('streakMin').value = String(s.streakMinMinutes);
}

const lines = (text: string): string[] => text.split(/\r?\n/);
const readLists = (group: 'sites' | 'apps'): Lists =>
  ({ fine: lines(area(group, 'fine').value), gray: lines(area(group, 'gray').value), hard: lines(area(group, 'hard').value) });
/** Empty or non-numeric fields become NaN, which the main-process validator rejects. */
const readNum = (id: string): number => (num(id).value.trim() === '' ? NaN : Number(num(id).value));

function collect(): unknown {
  return {
    rhythm: {
      focusMin: readNum('focusMin'), shortBreakMin: readNum('shortBreakMin'),
      longBreakMin: readNum('longBreakMin'), longBreakEvery: readNum('longBreakEvery'),
    },
    streakMinMinutes: readNum('streakMin'),
    sites: readLists('sites'),
    apps: readLists('apps'),
    animal,
  };
}

const showError = (msg: string): void => { $('error').textContent = msg; };

async function save(): Promise<void> {
  showError('');
  $<HTMLButtonElement>('save').disabled = true;
  try {
    const r = await buddy.invoke<SettingsSaveResult>(IPC.settingsSave, collect());
    if (r.ok) buddy.send(IPC.windowClose);
    else showError(r.error);
  } catch (err) {
    console.error('settings:save failed', err);
    showError('Could not save settings.');
  } finally {
    $<HTMLButtonElement>('save').disabled = false;
  }
}

async function copyCode(): Promise<void> {
  const code = $<HTMLInputElement>('code');
  let done = false;
  try { await navigator.clipboard.writeText(code.value); done = true; } catch { /* fall back below */ }
  if (!done) {
    code.focus();
    code.select();
    try { done = document.execCommand('copy'); } catch { done = false; }
  }
  $('copyMsg').textContent = done ? 'Copied.' : 'Could not copy. Select the code and press Ctrl+C.';
}

$('save').addEventListener('click', () => void save());
$('cancel').addEventListener('click', () => buddy.send(IPC.windowClose));
$('copy').addEventListener('click', () => void copyCode());

void buddy.invoke<Settings>(IPC.settingsGet)
  .then(fill)
  .catch((err) => { console.error('settings:get failed', err); showError('Could not load settings.'); });

void buddy.invoke<string>(IPC.settingsSecret)
  .then((c) => { $<HTMLInputElement>('code').value = c; })
  .catch((err) => console.error('settings:secret failed', err));

if (new URLSearchParams(location.search).has('pair')) {
  const sec = $('pairing');
  sec.classList.add('focus');
  window.addEventListener('load', () => sec.scrollIntoView({ block: 'start' }));
}

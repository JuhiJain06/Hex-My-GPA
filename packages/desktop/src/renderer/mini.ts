import { DEFAULT_SETTINGS, type SoundChoice } from '@study-buddy/core';
import { $, buddy, hm, IPC, mmss, onEngine, onState, type UiState } from './api';
import { liveBuddy } from './buddy/live';
import { FREQ_PRESETS, SoundEngine, fadeAction, normalizeChoice, shouldBeAudible } from './audio';
import { MINI_H } from '../shared/layout';

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

onState((s) => { state = s; render(); syncAudible(); });
liveBuddy($('buddy'), 48);
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

// ---- Focus sounds (this window lives for the whole session, so it hosts the audio) ----
let engine: SoundEngine | null = null;
let choice: SoundChoice = normalizeChoice(DEFAULT_SETTINGS.sound);
let audible = false;

function syncAudible(): void {
  if (!engine || !state) return;
  const want = shouldBeAudible(state);
  if (want === audible) return;
  audible = want;
  if (want) engine.fadeIn(); else engine.fadeOut();
}

const ambientSel = $<HTMLSelectElement>('ambient');
const freqSel = $<HTMLSelectElement>('freq');
const ambientVol = $<HTMLInputElement>('ambientVol');
const freqVol = $<HTMLInputElement>('freqVol');
FREQ_PRESETS.forEach((p, i) => freqSel.add(new Option(p.label, String(i))));

function showChoice(): void {
  ambientSel.value = choice.ambient;
  ambientVol.value = String(choice.ambientVolume);
  freqVol.value = String(choice.freqVolume);
  const i = FREQ_PRESETS.findIndex((p) => JSON.stringify(p.choice) === JSON.stringify(choice.freq));
  freqSel.value = i >= 0 ? String(i) : '';
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function changed(): void {
  const preset = freqSel.value === '' ? undefined : FREQ_PRESETS[Number(freqSel.value)];
  choice = {
    ambient: ambientSel.value as SoundChoice['ambient'],
    ambientVolume: Number(ambientVol.value),
    freq: freqSel.value === '' ? null : (preset?.choice ?? choice.freq),
    freqVolume: Number(freqVol.value),
  };
  engine?.play(choice);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void buddy.invoke(IPC.soundSave, choice), 250);
}
for (const el of [ambientSel, freqSel, ambientVol, freqVol]) el.addEventListener('input', changed);

function setMuted(m: boolean): void {
  engine?.setMuted(m);
  $('muteBtn').textContent = m ? 'Unmute' : 'Mute';
}
btn('muteBtn').addEventListener('click', () => buddy.send(IPC.soundMute));
buddy.on(IPC.soundMute, (m) => setMuted(m === true));

// The window grows while the popover is open and shrinks back when it closes.
btn('soundBtn').addEventListener('click', () => {
  const open = $('soundPanel').classList.toggle('hidden') === false;
  btn('soundBtn').setAttribute('aria-expanded', String(open));
  requestAnimationFrame(() => buddy.send(IPC.miniResize, open ? document.body.scrollHeight + 4 : MINI_H));
});

async function startSound(): Promise<void> {
  try {
    const settings = await buddy.invoke<{ sound: SoundChoice }>(IPC.settingsGet);
    choice = normalizeChoice(settings.sound);
    showChoice();
    engine = new SoundEngine(new AudioContext());
    (window as unknown as { __sound?: SoundEngine }).__sound = engine; // diagnostics
    engine.play(choice);
    setMuted(await buddy.invoke<boolean>(IPC.soundMute));
    syncAudible();
  } catch (err) {
    console.warn('focus sounds unavailable', err);
  }
}
void startSound();

const plannedMin = Number(params.get('planned'));
onEngine((e) => {
  const fade = fadeAction(e.type);
  if (fade && engine) {
    audible = fade === 'in';
    if (audible) engine.fadeIn(); else engine.fadeOut();
  }
  if (e.type !== 'plannedLengthReached' || !(plannedMin > 0)) return;
  const h = Math.round((plannedMin / 60) * 100) / 100;
  $('plannedMsg').textContent = `You hit your planned ${h} h`;
  $('planned').classList.remove('hidden');
});
btn('plannedKeep').addEventListener('click', () => $('planned').classList.add('hidden'));
btn('plannedEnd').addEventListener('click', () => buddy.send(IPC.sessionEnd));

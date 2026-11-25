import { DEFAULT_SETTINGS, type SoundChoice } from '@study-buddy/core';
import { sceneSlot } from '@study-buddy/core/buddy/scene';
import { $, buddy, hm, IPC, onEngine, onState, type UiState } from './api';
import { liveBuddy } from './buddy/live';
import { FREQ_PRESETS, SoundEngine, fadeAction, normalizeChoice, shouldBeAudible } from './audio';
import { extensionStatusText } from '../shared/labels';
import { PET_MENU_W } from '../shared/layout';
import { NoticeQueue, bubbleText, plannedText, shouldShowExtNotice } from '../shared/pet';
import type { PetMenuLayout } from '../shared/ipc';

/**
 * The desktop pet: the buddy at its desk, a speech bubble (time left, one-off notices) and a menu
 * with the session controls. It replaces the old mini timer, so it also hosts the focus sounds.
 * The window is click-through except over the pet, bubble and menu (see `hitTest`).
 */

const params = new URLSearchParams(location.search);
const SCENE_PX = 188;
/** Pointer travel before a press on the pet counts as a drag instead of a click. */
const DRAG_SLOP = 4;
let state: UiState | null = null;

const btn = (id: string) => $<HTMLButtonElement>(id);
const petEl = $('pet');
const bubble = $('bubble');
const menu = $('menu');

// ---- Speech bubble ----
const notices = new NoticeQueue();
let lastExt: string | null | undefined;

function renderBubble(): void {
  const now = Date.now();
  const notice = notices.current(now);
  const paused = !notice && state?.phase === 'focus' && state.pausedSince !== null;
  const text = notice ? notice.text : state && state.showBubble !== false ? bubbleText(state, now) : '';
  $('bubbleText').textContent = text;
  bubble.classList.toggle('hidden', text === '');
  bubble.classList.toggle('notice', notice !== null);
  bubble.classList.toggle('timer', notice === null);
  bubble.classList.toggle('paused', paused);
  bubble.classList.toggle('clickable', paused);
  bubble.title = paused ? 'Click to resume' : '';
  $('bubbleBtns').classList.toggle('hidden', notice?.id !== 'planned');
}

bubble.addEventListener('click', (e) => {
  if ((e.target as Element).closest('button')) return;
  if (bubble.classList.contains('paused')) buddy.send(IPC.sessionResume);
});

if (params.get('phone') === '1') notices.push({ id: 'phone', text: 'Phone in another room?' }, Date.now());

const plannedMin = Number(params.get('planned'));
btn('plannedKeep').addEventListener('click', () => { notices.dismiss('planned'); renderBubble(); });
btn('plannedEnd').addEventListener('click', () => buddy.send(IPC.sessionEnd));

// ---- Menu contents ----
function renderMenu(): void {
  const s = state;
  if (!s) return;
  $('topic').textContent = s.topic ?? '';
  $('today').textContent = hm(s.todayMs);
  $('streak').textContent = String(s.streakDays);
  const ext = extensionStatusText(s);
  $('ext').classList.toggle('hidden', ext === null);
  if (ext !== null) $('ext').textContent = ext;
  $('label').textContent = s.phase === 'focus' ? (s.pausedSince !== null ? 'Paused' : s.blockingActive ? 'Focus' : 'Focus · unblocked')
    : s.phase === 'break' ? 'Break' : s.phase === 'awaitingNext' ? 'Ready?' : '';
  btn('extend').disabled = s.phase !== 'focus';
  btn('endBlock').disabled = s.phase !== 'focus';
  btn('blockingOff').disabled = !s.blockingActive;
}

function render(): void {
  renderBubble();
  renderMenu();
}

onState((s) => {
  state = s;
  const ext = extensionStatusText(s);
  if (shouldShowExtNotice(lastExt, ext) && ext !== null) notices.push({ id: 'ext', text: ext }, Date.now());
  lastExt = ext;
  render();
  syncAudible();
});
liveBuddy(petEl, SCENE_PX, sceneSlot);
setInterval(render, 250);

btn('extend').addEventListener('click', () => buddy.send(IPC.blockExtend));
btn('endBlock').addEventListener('click', () => buddy.send(IPC.blockEndEarly));
btn('blockingOff').addEventListener('click', () => { void closeMenu(); buddy.send(IPC.windowOpen, 'bypass'); });
btn('end').addEventListener('click', () => buddy.send(IPC.sessionEnd));

// ---- Click-through: only the pet's drawing, the bubble and the menu catch the mouse ----
let hit = false;
let dragging = false;

function hitTest(x: number, y: number): boolean {
  const el = document.elementFromPoint(x, y);
  if (!el) return false;
  if (el.closest('#menu:not(.hidden)') || el.closest('#bubble:not(.hidden)')) return true;
  const pet = el.closest('#pet');
  // The scene's own box is transparent: only its painted shapes count.
  return pet !== null && el !== pet && el !== pet.firstElementChild;
}

function setHit(h: boolean): void {
  if (h === hit) return;
  hit = h;
  buddy.send(IPC.petHit, h);
}
document.addEventListener('mousemove', (e) => { if (!dragging) setHit(hitTest(e.clientX, e.clientY)); });
document.documentElement.addEventListener('mouseleave', () => { if (!dragging) setHit(false); });

// ---- Drag (pointer deltas to main, which moves and clamps the window) or click (menu) ----
let press: { id: number; x: number; y: number; lastX: number; lastY: number } | null = null;

petEl.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !hitTest(e.clientX, e.clientY)) return;
  press = { id: e.pointerId, x: e.screenX, y: e.screenY, lastX: e.screenX, lastY: e.screenY };
  petEl.setPointerCapture(e.pointerId);
});
petEl.addEventListener('pointermove', (e) => {
  if (!press || e.pointerId !== press.id) return;
  if (!dragging) {
    if (menuOpen || Math.hypot(e.screenX - press.x, e.screenY - press.y) < DRAG_SLOP) return;
    dragging = true;
    petEl.classList.add('dragging');
  }
  const dx = e.screenX - press.lastX;
  const dy = e.screenY - press.lastY;
  press.lastX = e.screenX;
  press.lastY = e.screenY;
  if (dx !== 0 || dy !== 0) buddy.send(IPC.petDrag, { dx, dy });
});
function endPress(e: PointerEvent, cancelled: boolean): void {
  if (!press || e.pointerId !== press.id) return;
  press = null;
  if (dragging) {
    dragging = false;
    petEl.classList.remove('dragging');
    buddy.send(IPC.petDragEnd);
  } else if (!cancelled) {
    void (menuOpen ? closeMenu() : openMenu());
  }
}
petEl.addEventListener('pointerup', (e) => endPress(e, false));
petEl.addEventListener('pointercancel', (e) => endPress(e, true));

// ---- Menu: the window grows beside the pet and becomes focusable only while it is open ----
let menuOpen = false;

function applyLayout(l: PetMenuLayout | null): void {
  if (!l) return;
  document.body.classList.toggle('side-left', l.side === 'left');
  document.body.classList.toggle('side-right', l.side === 'right');
  document.body.classList.toggle('anchor-top', l.anchor === 'top');
  document.body.classList.toggle('anchor-bottom', l.anchor === 'bottom');
}

/** Sizes the window for the menu as it is now (closed sound panel or open). */
async function placeMenu(): Promise<void> {
  const size = { width: PET_MENU_W, height: Math.ceil(menu.getBoundingClientRect().height) };
  applyLayout(await buddy.invoke<PetMenuLayout | null>(IPC.petLayout, size));
  applyLayout(await buddy.invoke<PetMenuLayout | null>(IPC.petMenu, { open: true, ...size }));
}

async function openMenu(): Promise<void> {
  if (menuOpen) return;
  menuOpen = true;
  renderMenu();
  menu.classList.add('measuring');
  menu.classList.remove('hidden');
  try { await placeMenu(); } catch (err) { console.warn('pet menu failed', err); }
  if (!menuOpen) return; // closed while opening
  menu.classList.remove('measuring');
  btn('extend').disabled ? btn('end').focus() : btn('extend').focus();
}

async function closeMenu(): Promise<void> {
  if (!menuOpen) return;
  menuOpen = false;
  menu.classList.add('hidden');
  $('soundPanel').classList.add('hidden');
  btn('soundBtn').setAttribute('aria-expanded', 'false');
  try { await buddy.invoke(IPC.petMenu, { open: false }); } catch (err) { console.warn('pet menu close failed', err); }
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') void closeMenu(); });
window.addEventListener('blur', () => void closeMenu());

btn('soundBtn').addEventListener('click', () => {
  const open = $('soundPanel').classList.toggle('hidden') === false;
  btn('soundBtn').setAttribute('aria-expanded', String(open));
  void placeMenu();
});

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

onEngine((e) => {
  const fade = fadeAction(e.type);
  if (fade && engine) {
    audible = fade === 'in';
    if (audible) engine.fadeIn(); else engine.fadeOut();
  }
  if (e.type !== 'plannedLengthReached' || !(plannedMin > 0)) return;
  notices.push({ id: 'planned', text: plannedText(plannedMin), sticky: true }, Date.now());
  renderBubble();
});

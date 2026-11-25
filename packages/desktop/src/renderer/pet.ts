import { DEFAULT_SETTINGS, type SoundChoice } from '@study-buddy/core';
import { $, buddy, hm, IPC, onEngine, onState, type UiState } from './api';
import { liveBuddy } from './buddy/live';
import { FREQ_PRESETS, SoundEngine, fadeAction, normalizeChoice, shouldBeAudible } from './audio';
import { extensionStatusText } from '../shared/labels';
import { bubbleBottom, PET_ART_H, PET_ART_MAX_W, PET_FOOT_GAP, PET_MENU_W, PET_W } from '../shared/layout';
import {
  HitSync, NoticeQueue, alphaFromRgba, bubbleText, closeOnBlur, plannedText, shouldShowExtNotice, spriteHit, type AlphaMask,
} from '../shared/pet';
import type { PetMenuLayout } from '../shared/ipc';

/**
 * The desktop pet: the buddy standing on the taskbar, a speech bubble (time left, one-off notices) and a menu
 * with the session controls. It replaces the old mini timer, so it also hosts the focus sounds.
 * The window is click-through except over the pet's painted pixels, bubble and menu (see `hitTest`).
 */

const params = new URLSearchParams(location.search);
/** Pointer travel before a press on the pet counts as a drag instead of a click. */
const DRAG_SLOP = 4;
let state: UiState | null = null;

const btn = (id: string) => $<HTMLButtonElement>(id);
const petEl = $('pet');
const bubble = $('bubble');
const menu = $('menu');
// The picture stands PET_FOOT_GAP above the window's bottom (the taskbar); the bubble sits above its
// top-center, and the menu opens right beside it. Pictures differ in size, so both follow each swap.
petEl.style.bottom = `${PET_FOOT_GAP}px`;
function fitToPicture(width: number, height: number): void {
  bubble.style.bottom = `${bubbleBottom(height)}px`;
  document.body.style.setProperty('--pet-pad', `${Math.max(0, Math.floor((PET_W - width) / 2))}px`);
}
fitToPicture(PET_ART_H, PET_ART_H);
petEl.addEventListener('sprite:picture', (e) => {
  const d = (e as CustomEvent<{ width: number; height: number }>).detail;
  fitToPicture(d.width, d.height);
});

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
  const paused = s.phase === 'focus' && s.pausedSince !== null;
  if ($('resume').classList.contains('hidden') === paused) {
    $('resume').classList.toggle('hidden', !paused);
    if (menuOpen) void placeMenu(); // the menu changed height
  }
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
liveBuddy(petEl, PET_ART_H, { maxWidth: PET_ART_MAX_W });
setInterval(render, 250);

btn('extend').addEventListener('click', () => buddy.send(IPC.blockExtend));
btn('endBlock').addEventListener('click', () => buddy.send(IPC.blockEndEarly));
btn('blockingOff').addEventListener('click', () => { void closeMenu(); buddy.send(IPC.windowOpen, 'bypass'); });
btn('end').addEventListener('click', () => buddy.send(IPC.sessionEnd));
btn('resume').addEventListener('click', () => buddy.send(IPC.sessionResume));

// ---- Click-through: only the pet's painted pixels, the bubble and the menu catch the mouse ----
/**
 * Alpha of each picture, read once per picture from the plain image (null: unreadable, so the inset
 * box is used). The ears and tail move on the canvas, but hit-testing uses the still picture.
 */
const masks = new Map<string, AlphaMask | null>();
/** The plain images the masks are read from, by the picture's path. */
const maskImages = new Map<string, HTMLImageElement>();

function readMask(key: string, img: HTMLImageElement): void {
  if (masks.has(key) || !img.complete || img.naturalWidth === 0) return;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data; // throws if tainted
    masks.set(key, { width: canvas.width, height: canvas.height, alpha: alphaFromRgba(data) });
  } catch (err) {
    console.warn('pet: image alpha unavailable, using its box', err);
    masks.set(key, null);
  }
}

function onPet(x: number, y: number): boolean {
  // The shown picture: its canvas (or the plain <img> fallback) carries the picture's path.
  const art = petEl.querySelector<HTMLElement>('.sp-art');
  const key = art?.dataset.src;
  if (!art || !key) return false;
  if (!masks.has(key)) {
    let img = maskImages.get(key);
    if (!img) {
      img = new Image();
      const im = img;
      im.addEventListener('load', () => readMask(key, im), { once: true });
      im.src = key;
      maskImages.set(key, im);
    }
    if (!img.complete) return false;
    readMask(key, img);
  }
  return spriteHit(art.getBoundingClientRect(), masks.get(key) ?? null, x, y);
}
const hits = new HitSync((h) => buddy.send(IPC.petHit, h));
let dragging = false;
/** Last pointer spot in the window (null: the pointer is outside). */
let pointer: { x: number; y: number } | null = null;

function hitTest(x: number, y: number): boolean {
  const el = document.elementFromPoint(x, y);
  if (el && (el.closest('#menu:not(.hidden)') || el.closest('#bubble:not(.hidden)'))) return true;
  // The pet: its image's own alpha, not its box (the doodles never catch the mouse).
  return onPet(x, y);
}

/** Main reset the window to click-through: forget the cached hit and re-check where the pointer is. */
function resyncHit(): void {
  hits.settled();
  if (pointer && !dragging) hits.update(hitTest(pointer.x, pointer.y));
}
document.addEventListener('mousemove', (e) => {
  pointer = { x: e.clientX, y: e.clientY };
  if (!dragging) hits.update(hitTest(e.clientX, e.clientY));
});
document.documentElement.addEventListener('mouseleave', () => { pointer = null; if (!dragging) hits.update(false); });
buddy.on(IPC.petResync, () => resyncHit());

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
  const first = !$('resume').classList.contains('hidden') ? btn('resume') : btn('extend').disabled ? btn('end') : btn('extend');
  first.focus();
}

async function closeMenu(): Promise<void> {
  if (!menuOpen) return;
  menuOpen = false;
  menu.classList.add('hidden');
  $('soundPanel').classList.add('hidden');
  btn('soundBtn').setAttribute('aria-expanded', 'false');
  try { await buddy.invoke(IPC.petMenu, { open: false }); } catch (err) { console.warn('pet menu close failed', err); }
  resyncHit(); // main's settle() made the window click-through again
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') void closeMenu(); });
// A native <select> popup can blur the window: wait a tick, then close only on a real blur.
window.addEventListener('blur', () => {
  setTimeout(() => {
    if (closeOnBlur({ hasFocus: document.hasFocus(), activeTag: document.activeElement?.tagName ?? null })) void closeMenu();
  }, 0);
});

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

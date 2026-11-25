import {
  ALWAYS_FINE_APPS, isAnimal, type FreqChoice, type Lists, type PetSettings, type Rhythm, type Settings, type SoundChoice,
} from '@study-buddy/core';

/** Spec anti-goal: these are never interrupted, whatever the user types. */
export const ALWAYS_FINE_SITES: readonly string[] = ['claude.ai', 'notebooklm.google.com', 'gemini.google.com'];

const MAX_ENTRIES = 500;
const MAX_LEN = 253;
const SITE_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;
const APP_RE = /^[a-z0-9 _.-]+\.exe$/;
const AMBIENT = ['none', 'rain', 'brown', 'cafe'];
const LISTS = ['fine', 'gray', 'hard'] as const;

type Fail = { error: string };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isUnit = (v: unknown): v is number => typeof v === 'number' && v >= 0 && v <= 1;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function normalizeSite(raw: string): string {
  return raw.replace(/^https?:\/\//, '').replace(/[/?#].*$/, '').replace(/^www\./, '');
}

function parseList(raw: unknown, label: string, kind: 'site' | 'app'): string[] | Fail {
  if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'string')) return { error: `${label} must be a list of text lines.` };
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of raw as string[]) {
    let v = line.trim().toLowerCase();
    if (!v) continue;
    if (kind === 'site') v = normalizeSite(v);
    if (v.length > MAX_LEN) return { error: `${label}: "${v.slice(0, 30)}…" is longer than ${MAX_LEN} characters.` };
    if (kind === 'site' ? !SITE_RE.test(v) : !APP_RE.test(v)) {
      return { error: kind === 'site'
        ? `${label}: "${v}" doesn't look like a website (for example example.com).`
        : `${label}: "${v}" doesn't look like an app (for example notepad.exe).` };
    }
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  if (out.length > MAX_ENTRIES) return { error: `${label} can have at most ${MAX_ENTRIES} entries.` };
  return out;
}

function parseLists(raw: unknown, name: string, kind: 'site' | 'app'): Lists | Fail {
  if (!isObj(raw)) return { error: `${name} are missing.` };
  const out = {} as Lists;
  for (const k of LISTS) {
    const r = parseList(raw[k], `${name} (${k})`, kind);
    if ('error' in r) return r;
    out[k] = r;
  }
  return out;
}

function parseRhythm(raw: unknown): Rhythm | Fail {
  if (!isObj(raw)) return { error: 'Rhythm is missing.' };
  const spec: [keyof Rhythm, string, number][] = [
    ['focusMin', 'Focus minutes', 180], ['shortBreakMin', 'Short break minutes', 180],
    ['longBreakMin', 'Long break minutes', 180], ['longBreakEvery', 'Long break every', 10],
  ];
  const out = {} as Rhythm;
  for (const [k, label, max] of spec) {
    const v = raw[k];
    if (!isInt(v, 1, max)) return { error: `Rhythm: ${label} must be a whole number from 1 to ${max}.` };
    out[k] = v;
  }
  return out;
}

function parseFreq(raw: unknown): FreqChoice | null | Fail {
  if (raw === null) return null;
  const bad = { error: 'Sound: frequency is invalid.' };
  if (!isObj(raw)) return bad;
  if (raw.kind === 'pure') return isNum(raw.hz) && raw.hz > 0 ? { kind: 'pure', hz: raw.hz } : bad;
  if (raw.kind === 'binaural' || raw.kind === 'isochronic') {
    return isNum(raw.beatHz) && raw.beatHz > 0 && isNum(raw.carrierHz) && raw.carrierHz > 0
      ? { kind: raw.kind, beatHz: raw.beatHz, carrierHz: raw.carrierHz } : bad;
  }
  return bad;
}

export function parseSound(raw: unknown): SoundChoice | Fail {
  if (!isObj(raw) || typeof raw.ambient !== 'string' || !AMBIENT.includes(raw.ambient)
    || !isUnit(raw.ambientVolume) || !isUnit(raw.freqVolume)) return { error: 'Sound settings are invalid.' };
  const freq = parseFreq(raw.freq);
  if (freq !== null && 'error' in freq) return freq;
  return { ambient: raw.ambient as SoundChoice['ambient'], ambientVolume: raw.ambientVolume, freq, freqVolume: raw.freqVolume };
}

/** The pet block: each missing field keeps its current value; a position needs finite numbers. */
export function parsePet(raw: unknown, current: PetSettings): PetSettings | Fail {
  const bad = { error: 'Study buddy: the pet settings are invalid.' };
  if (!isObj(raw)) return bad;
  let showBubble = current.showBubble;
  if (raw.showBubble !== undefined) {
    if (typeof raw.showBubble !== 'boolean') return bad;
    showBubble = raw.showBubble;
  }
  let pos = current.pos;
  if (raw.pos !== undefined) {
    if (raw.pos === null) pos = null;
    else if (isObj(raw.pos) && isNum(raw.pos.x) && isNum(raw.pos.y) && isNum(raw.pos.displayId)) {
      pos = { x: raw.pos.x, y: raw.pos.y, displayId: raw.pos.displayId };
    } else return bad;
  }
  return { showBubble, pos };
}

/** Validates and normalizes a settings payload from the Settings window. Pure. */
export function parseSettings(input: unknown, current: Settings): Settings | Fail {
  if (!isObj(input)) return { error: 'Settings are invalid.' };
  const rhythm = parseRhythm(input.rhythm);
  if ('error' in rhythm) return rhythm;
  if (!isInt(input.streakMinMinutes, 1, 1440)) return { error: 'Streak minimum must be a whole number of minutes from 1 to 1440.' };
  const sites = parseLists(input.sites, 'Sites', 'site');
  if ('error' in sites) return sites;
  const apps = parseLists(input.apps, 'Apps', 'app');
  if ('error' in apps) return apps;
  let sound = current.sound;
  if (input.sound !== undefined) {
    const s = parseSound(input.sound);
    if ('error' in s) return s;
    sound = s;
  }
  let animal = current.animal;
  if (input.animal !== undefined) {
    if (!isAnimal(input.animal)) return { error: 'Study buddy: please pick one of the animals.' };
    animal = input.animal;
  }
  let pet = current.pet;
  if (input.pet !== undefined) {
    const p = parsePet(input.pet, current.pet);
    if ('error' in p) return p;
    pet = p;
  }
  const always = new Set(ALWAYS_FINE_SITES);
  const protectedSite = (d: string) => ALWAYS_FINE_SITES.some((p) => d === p || d.endsWith('.' + p));
  sites.fine = [...ALWAYS_FINE_SITES, ...sites.fine.filter((d) => !always.has(d))];
  sites.gray = sites.gray.filter((d) => !protectedSite(d));
  sites.hard = sites.hard.filter((d) => !protectedSite(d));
  const alwaysApp = new Set(ALWAYS_FINE_APPS);
  apps.fine = [...ALWAYS_FINE_APPS, ...apps.fine.filter((e) => !alwaysApp.has(e))];
  apps.gray = apps.gray.filter((e) => !alwaysApp.has(e));
  apps.hard = apps.hard.filter((e) => !alwaysApp.has(e));
  return { rhythm, streakMinMinutes: input.streakMinMinutes, sites, apps, sound, animal, pet };
}

import type { FreqChoice, SoundChoice } from '@study-buddy/core';

// Pure helpers first: nothing here touches AudioContext until a SoundEngine is constructed,
// so this module can be imported in Node tests.

export interface FreqPreset { label: string; choice: FreqChoice }

const binaural = (label: string, beatHz: number): FreqPreset =>
  ({ label, choice: { kind: 'binaural', beatHz, carrierHz: 200 } });
const isochronic = (label: string, beatHz: number): FreqPreset =>
  ({ label, choice: { kind: 'isochronic', beatHz, carrierHz: 200 } });

export const FREQ_PRESETS: FreqPreset[] = [
  binaural('Gamma focus (40 Hz)', 40), binaural('Calm focus (10 Hz)', 10), binaural('Alert (16 Hz)', 16),
  isochronic('Gamma focus (40 Hz, isochronic)', 40), isochronic('Calm focus (10 Hz, isochronic)', 10),
  isochronic('Alert (16 Hz, isochronic)', 16),
  { label: '432 Hz tone', choice: { kind: 'pure', hz: 432 } },
  { label: '528 Hz tone', choice: { kind: 'pure', hz: 528 } },
];

export interface OscillatorPlan { left: number | null; right: number | null; mono: number | null; pulseHz: number | null }

export function oscillatorPlan(f: FreqChoice | null): OscillatorPlan {
  if (!f) return { left: null, right: null, mono: null, pulseHz: null };
  if (f.kind === 'pure') return { left: null, right: null, mono: f.hz, pulseHz: null };
  if (f.kind === 'binaural') return { left: f.carrierHz, right: f.carrierHz + f.beatHz, mono: null, pulseHz: null };
  return { left: null, right: null, mono: f.carrierHz, pulseHz: f.beatHz };
}

/** The café recording is not shipped, so a saved 'cafe' plays as 'none'. */
export function normalizeChoice(c: SoundChoice): SoundChoice {
  return c.ambient === 'cafe' ? { ...c, ambient: 'none' } : c;
}

/** Sound plays only during an unpaused focus block. */
export function shouldBeAudible(s: { phase: string; pausedSince: number | null }): boolean {
  return s.phase === 'focus' && s.pausedSince === null;
}

export function fadeAction(eventType: string): 'in' | 'out' | null {
  if (eventType === 'focusStarted') return 'in';
  if (eventType === 'breakStarted' || eventType === 'sessionEnded') return 'out';
  return null;
}

export const DEFAULT_FADE_MS = 2000;

// ---- Web Audio engine --------------------------------------------------------------------

function edgeFade(d: Float32Array, sr: number): void {
  const len = Math.min(Math.floor(sr * 0.05), d.length >> 1);
  for (let i = 0; i < len; i++) {
    const g = i / len;
    d[i]! *= g;
    d[d.length - 1 - i]! *= g;
  }
}

/** Brown noise: leaky integration of white noise. */
function brownBuffer(ctx: AudioContext, seconds = 10): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let last = 0;
    for (let i = 0; i < n; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    edgeFade(d, ctx.sampleRate);
  }
  return buf;
}

/** Pink-ish noise (Paul Kellet's filter) plus sparse short droplet ticks. */
function rainBuffer(ctx: AudioContext, seconds = 20): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.12;
    }
    const drops = Math.floor(seconds * 14);
    for (let k = 0; k < drops; k++) {
      const at = Math.floor(Math.random() * (n - sr * 0.05));
      const len = Math.floor(sr * (0.004 + Math.random() * 0.012));
      const amp = 0.08 + Math.random() * 0.2;
      for (let i = 0; i < len; i++) d[at + i]! += (Math.random() * 2 - 1) * amp * Math.exp((-5 * i) / len);
    }
    edgeFade(d, sr);
  }
  return buf;
}

export interface EngineDebug {
  state: string; muted: boolean; target: number;
  fade: number; mute: number; ambientGain: number; freqGain: number;
  ambient: string; oscillators: { role: string; hz: number }[];
}

type FreqNode = OscillatorNode | ChannelMergerNode | GainNode;

/** Only the mini window creates a SoundEngine: it is the sole audio host and lives for the whole session. */
export class SoundEngine {
  private readonly fadeGain: GainNode;
  private readonly muteGain: GainNode;
  private readonly ambientGain: GainNode;
  private readonly freqGain: GainNode;
  private ambientKind = 'none';
  private ambientNode: AudioBufferSourceNode | null = null;
  private freqKey = 'null';
  private freqNodes: FreqNode[] = [];
  private oscInfo: { role: string; hz: number }[] = [];
  private readonly buffers = new Map<string, AudioBuffer>();
  private target = 0;
  private muted = false;

  constructor(private readonly ctx: AudioContext) {
    this.ambientGain = ctx.createGain();
    this.freqGain = ctx.createGain();
    this.fadeGain = ctx.createGain();
    this.muteGain = ctx.createGain();
    this.fadeGain.gain.value = 0;
    this.ambientGain.connect(this.fadeGain);
    this.freqGain.connect(this.fadeGain);
    this.fadeGain.connect(this.muteGain).connect(ctx.destination);
  }

  play(c: SoundChoice): void {
    const choice = normalizeChoice(c);
    void this.ctx.resume();
    const clamp = (v: number) => Math.min(1, Math.max(0, v || 0)); // a NaN from the DOM must not throw
    this.ambientGain.gain.setTargetAtTime(clamp(choice.ambientVolume), this.ctx.currentTime, 0.05);
    this.freqGain.gain.setTargetAtTime(clamp(choice.freqVolume) * 0.5, this.ctx.currentTime, 0.05);
    if (choice.ambient !== this.ambientKind) this.setAmbient(choice.ambient);
    const key = JSON.stringify(choice.freq);
    if (key !== this.freqKey) { this.freqKey = key; this.setFreq(choice.freq); }
  }

  fadeOut(ms = DEFAULT_FADE_MS): void { this.fadeTo(0, ms); }
  fadeIn(ms = DEFAULT_FADE_MS): void { this.fadeTo(1, ms); }

  setMuted(m: boolean): void {
    this.muted = m;
    const g = this.muteGain.gain;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(m ? 0 : 1, now + 0.05);
  }

  /** Snapshot for diagnostics (read over CDP in the manual check). */
  debug(): EngineDebug {
    return {
      state: this.ctx.state, muted: this.muted, target: this.target,
      fade: this.fadeGain.gain.value, mute: this.muteGain.gain.value,
      ambientGain: this.ambientGain.gain.value, freqGain: this.freqGain.gain.value,
      ambient: this.ambientKind, oscillators: this.oscInfo.map((o) => ({ ...o })),
    };
  }

  private fadeTo(v: 0 | 1, ms: number): void {
    if (this.target === v) return;
    this.target = v;
    const g = this.fadeGain.gain;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(v, now + Math.max(0.01, ms / 1000));
  }

  private setAmbient(kind: string): void {
    try { this.ambientNode?.stop(); } catch { /* already stopped */ }
    this.ambientNode?.disconnect();
    this.ambientNode = null;
    this.ambientKind = kind;
    if (kind !== 'brown' && kind !== 'rain') return;
    let buf = this.buffers.get(kind);
    if (!buf) {
      buf = kind === 'brown' ? brownBuffer(this.ctx) : rainBuffer(this.ctx);
      this.buffers.set(kind, buf);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.ambientGain);
    src.start();
    this.ambientNode = src;
  }

  private setFreq(f: FreqChoice | null): void {
    for (const n of this.freqNodes) {
      if (n instanceof OscillatorNode) { try { n.stop(); } catch { /* already stopped */ } }
      n.disconnect();
    }
    this.freqNodes = [];
    this.oscInfo = [];
    const plan = oscillatorPlan(f);
    const osc = (role: string, hz: number, type: OscillatorType = 'sine'): OscillatorNode => {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.value = hz;
      this.freqNodes.push(o);
      this.oscInfo.push({ role, hz });
      return o;
    };
    if (plan.left !== null && plan.right !== null) {
      const merger = this.ctx.createChannelMerger(2);
      const l = osc('left', plan.left);
      const r = osc('right', plan.right);
      l.connect(merger, 0, 0);
      r.connect(merger, 0, 1);
      merger.connect(this.freqGain);
      this.freqNodes.push(merger);
      l.start();
      r.start();
    } else if (plan.mono !== null) {
      const carrier = osc('carrier', plan.mono);
      if (plan.pulseHz !== null) {
        const pulse = this.ctx.createGain();
        pulse.gain.value = 0.5;
        const lfo = osc('pulse', plan.pulseHz, 'square');
        const depth = this.ctx.createGain();
        depth.gain.value = 0.5; // gain swings 0..1 around the 0.5 offset
        lfo.connect(depth).connect(pulse.gain);
        carrier.connect(pulse).connect(this.freqGain);
        this.freqNodes.push(pulse, depth);
        lfo.start();
      } else carrier.connect(this.freqGain);
      carrier.start();
    }
  }
}

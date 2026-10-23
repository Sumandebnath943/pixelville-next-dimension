/* ============================================================
   Procedural audio, ported from V1's js/sounds.js: no files —
   everything is synthesised with WebAudio. Ambience follows the
   world (wind, rain, crickets, birdsong); the sim's `sound`
   events trigger the jingles. V2 adds a car engine hum.
   ============================================================ */
import { Settings } from '../sim/settings';
import { Weather } from '../sim/weather';
import { on } from '../sim/core';

type Gain = GainNode | null;

class Sound {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  started = false;
  enabled = (() => { try { return localStorage.getItem('pixelville-nd-snd') !== '0'; } catch { return true; } })();
  private wind: Gain = null;
  private rain: Gain = null;
  private crickets: Gain = null;
  private engine: OscillatorNode | null = null;
  private engineG: Gain = null;
  private noiseBuf: AudioBuffer | null = null;
  private birdTimer = 3;

  start(): void {
    if (this.started) return;
    this.started = true;
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.enabled ? this.vol() : 0;
    this.master.connect(c.destination);
    const len = c.sampleRate * 2;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    const noiseLayer = (type: BiquadFilterType, freq: number, q?: number) => {
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const f = c.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      if (q) f.Q.value = q;
      const g = c.createGain();
      g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(this.master!);
      src.start();
      return g;
    };
    this.wind = noiseLayer('lowpass', 320);
    this.rain = noiseLayer('bandpass', 1600, 0.6);
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 4400;
    const am = c.createOscillator();
    am.type = 'square';
    am.frequency.value = 5.2;
    const amG = c.createGain();
    amG.gain.value = 0.5;
    const cg = c.createGain();
    cg.gain.value = 0;
    am.connect(amG.gain);
    osc.connect(amG); amG.connect(cg); cg.connect(this.master);
    osc.start(); am.start();
    this.crickets = cg;
    // the Founder's engine
    this.engine = c.createOscillator();
    this.engine.type = 'sawtooth';
    this.engine.frequency.value = 40;
    const ef = c.createBiquadFilter();
    ef.type = 'lowpass';
    ef.frequency.value = 400;
    this.engineG = c.createGain();
    this.engineG.gain.value = 0;
    this.engine.connect(ef); ef.connect(this.engineG); this.engineG.connect(this.master);
    this.engine.start();
  }

  vol(): number { return Settings.get('volume') ?? 0.5; }
  toggle(): boolean {
    this.enabled = !this.enabled;
    try { localStorage.setItem('pixelville-nd-snd', this.enabled ? '1' : '0'); } catch { /* private mode */ }
    if (this.master && this.ctx) this.master.gain.linearRampToValueAtTime(this.enabled ? this.vol() : 0, this.ctx.currentTime + 0.2);
    return this.enabled;
  }
  setVolume(v: number): void {
    Settings.set('volume', v);
    if (this.master && this.ctx && this.enabled) this.master.gain.linearRampToValueAtTime(v, this.ctx.currentTime + 0.1);
  }

  /** ambience follows the world; call every frame */
  tick(dt: number, o: { dark: number; rainI: number; snowI: number; day: boolean; engine: number; indoorsQuiet?: boolean }): void {
    if (!this.started || !this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const set = (g: Gain, v: number) => { if (g) g.gain.setTargetAtTime(v, t, 0.6); };
    set(this.wind, 0.028 + o.snowI * 0.02 + o.rainI * 0.015);
    set(this.rain, o.rainI * 0.13);
    set(this.crickets, o.dark > 0.4 && Weather.season <= 2 && o.rainI < 0.2 ? 0.012 : 0);
    if (this.engine && this.engineG) {
      this.engine.frequency.setTargetAtTime(38 + o.engine * 120, t, 0.1);
      this.engineG.gain.setTargetAtTime(o.engine >= 0 ? 0.035 + o.engine * 0.05 : 0, t, 0.15);
    }
    if (o.day && o.rainI < 0.4 && Weather.season !== 3) {
      this.birdTimer -= dt;
      if (this.birdTimer <= 0) { this.birdTimer = 2.5 + Math.random() * 7; this.chirp(); }
    }
  }
  engineOff(): void {
    if (this.engineG && this.ctx) this.engineG.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
  }

  private env(g: GainNode, t0: number, a: number, peak: number, dec: number): void {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + dec);
  }
  tone(freq0: number, freq1: number | null, dur: number, peak: number, type: OscillatorType = 'sine', delay = 0): void {
    if (!this.started || !this.enabled || !this.ctx) return;
    const c = this.ctx, t0 = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq0, t0);
    if (freq1) o.frequency.exponentialRampToValueAtTime(freq1, t0 + dur);
    const g = c.createGain();
    this.env(g, t0, 0.012, peak, dur);
    o.connect(g); g.connect(this.master!);
    o.start(t0); o.stop(t0 + dur + 0.15);
  }
  noise(dur: number, peak: number, freq: number, type: BiquadFilterType = 'lowpass', delay = 0): void {
    if (!this.started || !this.enabled || !this.ctx || !this.noiseBuf) return;
    const c = this.ctx, t0 = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = c.createGain();
    this.env(g, t0, 0.01, peak, dur);
    s.connect(f); f.connect(g); g.connect(this.master!);
    s.start(t0); s.stop(t0 + dur + 0.1);
  }

  chirp(): void {
    const n = 2 + ((Math.random() * 3) | 0);
    for (let i = 0; i < n; i++) this.tone(2300 + Math.random() * 700, 1800 + Math.random() * 300, 0.07, 0.035, 'sine', i * 0.11);
  }
  place(): void { this.tone(150, 90, 0.1, 0.16, 'sine'); this.noise(0.06, 0.08, 900); }
  crunch(): void { this.noise(0.16, 0.14, 450); this.tone(90, 55, 0.14, 0.1, 'triangle'); }
  bell(): void {
    for (let s = 0; s < 2; s++) for (const [f, p] of [[523, 0.09], [784, 0.05], [1046, 0.03]]) this.tone(f, null, 1.6, p, 'sine', s * 1.1);
  }
  thunder(): void {
    this.noise(1.6, 0.3, 130, 'lowpass', 0.25 + Math.random() * 0.6);
    this.noise(0.9, 0.16, 70, 'lowpass', 1.1 + Math.random() * 0.4);
  }
  siren(): void {
    for (let i = 0; i < 3; i++) {
      this.tone(700, null, 0.13, 0.045, 'triangle', i * 0.26);
      this.tone(950, null, 0.13, 0.045, 'triangle', i * 0.26 + 0.13);
    }
  }
  launch(): void { this.noise(0.35, 0.03, 2200, 'highpass'); }
  baby(): void {
    this.tone(880, 1040, 0.28, 0.05, 'sine');
    this.tone(1040, 880, 0.3, 0.04, 'sine', 0.3);
    this.tone(1180, null, 0.35, 0.035, 'sine', 0.62);
  }
  ding(): void {
    this.tone(1320, null, 0.12, 0.06, 'square');
    this.tone(1760, null, 0.2, 0.05, 'sine', 0.06);
    this.noise(0.05, 0.03, 3200, 'highpass', 0.02);
  }
  fanfare(): void {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, null, 0.28, 0.06, 'triangle', i * 0.14));
    this.tone(1046, null, 0.65, 0.05, 'sine', 0.62);
  }
  pop(): void {
    this.noise(0.1, 0.12, 1200, 'highpass');
    for (let i = 0; i < 4; i++) this.noise(0.04, 0.05, 2600, 'highpass', 0.12 + i * 0.07 + Math.random() * 0.05);
  }
}

export const Snd = new Sound();

// the sim asks for sounds by name
on('sound', ({ name }) => {
  const fn = (Snd as unknown as Record<string, unknown>)[name];
  if (typeof fn === 'function') (fn as () => void).call(Snd);
});
// unlock audio on the first interaction anywhere
window.addEventListener('pointerdown', () => Snd.start(), { once: true });
window.addEventListener('keydown', () => Snd.start(), { once: true });

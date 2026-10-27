/* ============================================================
   Sound (V2: designed, not just played). Everything is still
   synthesised with WebAudio, no files. The mix is a small desk:
   - the STREET bus carries everything that happens outdoors
     (ambience, traffic, the sim's events); indoors it is
     muffled through the walls and quietened,
   - the ROOM bus carries the inside of the building you are in
     (its hum, its people, its own noises and music) through a
     reverb shaped to the room,
   - the UI bus (the Planner's clicks, the phone) is never
     muffled.
   The ambience is a set of layers whose levels follow what is
   around the listener (audio/scape.ts measures it): wind by
   height and openness and the weather, leaves rustling in the
   trees, rain on the ground or on the roof, the sea or a river,
   the hum of the traffic, the murmur of people, crickets and
   cicadas, and birds by species, time of day, season and place.
   Nearby vehicles each have an engine voice of their own
   (positional), the emergency services a siren, and the
   Founder's car an engine with gears, tyres and wind. The
   sim's one-shots (sirens, crashes, bells, fireworks…) come
   from where they happen, quieter with distance.
   ============================================================ */
import { Subs } from '../ui/access';
import { Settings } from '../sim/settings';
import { on } from '../sim/core';

type Gain = GainNode;
/** a looping layer: noise or a tone, through a filter, at a level */
interface Layer { g: Gain; f: BiquadFilterNode; f2?: BiquadFilterNode; src: AudioScheduledSourceNode }
/** a positional engine voice for a vehicle near the listener */
interface Voice { g: Gain; tg: Gain; osc: OscillatorNode; sub: OscillatorNode; f: BiquadFilterNode; tf: BiquadFilterNode; pan: StereoPannerNode; who: unknown }

/** what the listener is in the middle of, measured by audio/scape.ts (0 … 1 unless said) */
export interface Scene {
  indoors: boolean;
  /** the room: its template (interiors/plan.ts) and type, size (m), how many people are in it */
  room?: { template: string; type: string; w: number; d: number; h: number; people: number; music: boolean };
  /** height of the listener above the ground (m), how open the place is (no buildings close by) */
  height: number; open: number;
  trees: number; water: number; sea: number;
  traffic: number; crowd: number;
  dark: number; clock: number; season: number;
  rain: number; snow: number; wind: number;
  /** building sites at work, fires, works (each: x, z metres, how loud 0 … 1) */
  sites: { x: number; z: number; k: number }[];
  fires: { x: number; z: number; k: number }[];
  works: { x: number; z: number; k: number }[];
  /** the vehicles nearest the listener: where, how fast (m/s), what */
  cars: { who: unknown; x: number; z: number; v: number; kind: 'car' | 'moto' | 'bus' | 'truck' | 'train' | 'plane' | 'heli' | 'boat' }[];
  /** the nearest emergency vehicle on blue lights */
  siren?: { x: number; z: number; kind: 'police' | 'fire' | 'ambulance' };
  /** the Founder: at the wheel (speed m/s, throttle 0 … 1, braking, the kind of vehicle), or on foot */
  drive?: { v: number; gas: number; brake: number; skid: number; kind: 'car' | 'moto' | 'bus' | 'truck' | 'bike' };
  /** a footstep just landed (surface), and whether running */
  step?: { surface: 'hard' | 'grass' | 'snow' | 'gravel' | 'wood' | 'tile' | 'carpet' | 'sand'; run: boolean };
  /** a crowd gathered nearby (a rally, a festival): where and how big */
  gathering?: { x: number; z: number; k: number; cheer: boolean };
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

class Sound {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  started = false;
  enabled = (() => { try { return localStorage.getItem('pixelville-nd-snd') !== '0'; } catch { return true; } })();
  /** the desk: outdoors (muffled indoors), the room (with its reverb), the interface */
  private street: Gain | null = null;
  private streetLp: BiquadFilterNode | null = null;
  private room: Gain | null = null;
  private ui: Gain | null = null;
  private verb: ConvolverNode | null = null;
  private verbIn: Gain | null = null;
  private verbSize = 0;
  private white: AudioBuffer | null = null;
  private pink: AudioBuffer | null = null;
  private brown: AudioBuffer | null = null;
  private L: Record<string, Layer> = {};
  private voices: Voice[] = [];
  private sirenV: { osc: OscillatorNode; g: Gain; pan: StereoPannerNode; f: BiquadFilterNode; t: number } | null = null;
  /** the Founder's own vehicle */
  private eng: { o1: OscillatorNode; o2: OscillatorNode; g: Gain; f: BiquadFilterNode; tyre: Layer; wind: Layer; skid: Layer; gear: number; rpm: number } | null = null;
  /** when the next scheduled sounds of each kind are due (audio clock) */
  private next: Record<string, number> = {};

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
    // a gentle limiter on the whole mix (a crash next to a siren in a storm shouldn't clip)
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.01; comp.release.value = 0.25;
    this.master.connect(comp); comp.connect(c.destination);
    // the buses
    this.street = c.createGain();
    this.streetLp = c.createBiquadFilter();
    this.streetLp.type = 'lowpass'; this.streetLp.frequency.value = 18000; this.streetLp.Q.value = 0.5;
    this.street.connect(this.streetLp); this.streetLp.connect(this.master);
    this.room = c.createGain();
    this.room.gain.value = 0;
    this.room.connect(this.master);
    this.ui = c.createGain();
    this.ui.connect(this.master);
    this.verb = c.createConvolver();
    this.verbIn = c.createGain();
    this.verbIn.gain.value = 0.25;
    this.verbIn.connect(this.verb);
    const wet = c.createGain();
    wet.gain.value = 0.55;
    this.verb.connect(wet); wet.connect(this.master);
    this.setVerb(0.7);
    // noise: white, pink (Paul Kellet's filter), brown (integrated), four seconds each, looped
    const len = c.sampleRate * 4;
    const mk = (fill: (d: Float32Array) => void): AudioBuffer => { const b = c.createBuffer(1, len, c.sampleRate); fill(b.getChannelData(0)); return b; };
    this.white = mk((d) => { for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; });
    this.pink = mk((d) => {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      }
    });
    this.brown = mk((d) => { let l = 0; for (let i = 0; i < d.length; i++) { l = (l + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = l * 3.5; } });
    // the ambience layers (all silent until the scene says otherwise)
    const S = this.street;
    this.L.wind = this.loop(this.brown, 'lowpass', 380, 0.6, S);
    this.L.gust = this.loop(this.pink, 'bandpass', 700, 0.5, S);
    this.L.leaves = this.loop(this.pink, 'bandpass', 3800, 0.9, S, 'highpass', 1500);
    this.L.rain = this.loop(this.white, 'bandpass', 2600, 0.45, S, 'lowpass', 7000);
    this.L.rainNear = this.loop(this.pink, 'highpass', 4500, 0.7, S);
    this.L.waves = this.loop(this.brown, 'lowpass', 520, 0.7, S, 'highpass', 60);
    this.L.stream = this.loop(this.pink, 'bandpass', 1400, 0.6, S);
    this.L.traffic = this.loop(this.brown, 'lowpass', 230, 0.8, S, 'highpass', 35);
    this.L.crowd = this.loop(this.pink, 'bandpass', 600, 2.2, S, 'peaking', 1700);
    this.L.crowd.f2!.gain.value = 8;
    this.L.cicada = this.loop(this.white, 'bandpass', 6400, 6, S);
    this.L.fire = this.loop(this.brown, 'lowpass', 900, 0.7, S);
    // indoors: the room's hum (ventilation, fridges, a ticking house), rain on its roof and windows
    this.L.roomTone = this.loop(this.brown, 'lowpass', 140, 0.7, this.room);
    this.L.roomHum = this.toneLoop(100, 'sine', this.room);
    this.L.roofRain = this.loop(this.pink, 'lowpass', 1100, 0.8, this.room);
    this.L.murmur = this.loop(this.pink, 'bandpass', 520, 2.4, this.room, 'peaking', 1600);
    this.L.murmur.f2!.gain.value = 9;
    this.L.machine = this.toneLoop(50, 'sawtooth', this.room, 'lowpass', 260);
    // crickets: a 4.6 kHz tone gated into chirps (scheduled in tick)
    this.L.crickets = this.toneLoop(4600, 'sine', S);
    for (let i = 0; i < 6; i++) this.voices.push(this.voice());
    // the Founder's own engine, tyres, wind and skid
    const o1 = c.createOscillator(), o2 = c.createOscillator();
    o1.type = 'sawtooth'; o2.type = 'square';
    const ef = c.createBiquadFilter();
    ef.type = 'lowpass'; ef.frequency.value = 600; ef.Q.value = 2.5;
    const eg = c.createGain();
    eg.gain.value = 0;
    const o2g = c.createGain();
    o2g.gain.value = 0.45;
    o1.connect(ef); o2.connect(o2g); o2g.connect(ef); ef.connect(eg); eg.connect(this.master);
    o1.start(); o2.start();
    this.eng = {
      o1, o2, g: eg, f: ef, gear: 1, rpm: 800,
      tyre: this.loop(this.pink, 'bandpass', 700, 0.8, this.master),
      wind: this.loop(this.pink, 'highpass', 500, 0.5, this.master, 'lowpass', 3500),
      skid: this.loop(this.white, 'bandpass', 2300, 6, this.master),
    };
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

  /* ---------- building blocks ---------- */
  private loop(buf: AudioBuffer | null, type: BiquadFilterType, freq: number, q: number, out: AudioNode, type2?: BiquadFilterType, freq2?: number): Layer {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = Math.random() * 3;
    const f = c.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.value = 0;
    let f2: BiquadFilterNode | undefined;
    if (type2) {
      f2 = c.createBiquadFilter();
      f2.type = type2; f2.frequency.value = freq2 ?? 1000;
      src.connect(f); f.connect(f2); f2.connect(g);
    } else { src.connect(f); f.connect(g); }
    g.connect(out);
    src.start(0, Math.random() * 3);
    return { g, f, f2, src };
  }
  private toneLoop(freq: number, type: OscillatorType, out: AudioNode, ft: BiquadFilterType = 'allpass', ff = 1000): Layer {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = type; o.frequency.value = freq;
    const f = c.createBiquadFilter();
    f.type = ft; f.frequency.value = ff;
    const g = c.createGain();
    g.gain.value = 0;
    o.connect(f); f.connect(g); g.connect(out);
    o.start();
    return { g, f, src: o };
  }
  private voice(): Voice {
    const c = this.ctx!;
    const osc = c.createOscillator(), sub = c.createOscillator();
    osc.type = 'sawtooth'; sub.type = 'triangle';
    const f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 400; f.Q.value = 1.5;
    const g = c.createGain(), tg = c.createGain();
    g.gain.value = 0; tg.gain.value = 0;
    const pan = c.createStereoPanner();
    osc.connect(f); sub.connect(f); f.connect(g); g.connect(pan);
    const tyre = c.createBufferSource();
    tyre.buffer = this.pink; tyre.loop = true;
    const tf = c.createBiquadFilter();
    tf.type = 'bandpass'; tf.frequency.value = 800; tf.Q.value = 0.7;
    tyre.connect(tf); tf.connect(tg); tg.connect(pan);
    pan.connect(this.street!);
    osc.start(); sub.start(); tyre.start(0, Math.random() * 3);
    return { g, tg, osc, sub, f, tf, pan, who: null };
  }
  /** a room's reverb: decaying noise, `t` seconds long (rebuilt only when the size changes much) */
  private setVerb(t: number): void {
    if (!this.ctx || !this.verb || Math.abs(t - this.verbSize) < 0.15) return;
    this.verbSize = t;
    const c = this.ctx, n = Math.floor(c.sampleRate * t), b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.6) * (i < c.sampleRate * 0.004 ? 0.3 : 1);
    }
    this.verb.buffer = b;
  }
  private set(g: AudioParam, v: number, t = 0.5): void {
    if (this.ctx) g.setTargetAtTime(v, this.ctx.currentTime, t);
  }

  /* ---------- positional one-shots ---------- */
  /** the listener (metres) and the camera's heading (a unit vector along the ground): set every frame */
  private lx = 0;
  private lz = 0;
  private fx = 0;
  private fz = 1;
  listen(x: number, z: number, fx: number, fz: number): void {
    const l = Math.hypot(fx, fz) || 1;
    this.lx = x; this.lz = z; this.fx = fx / l; this.fz = fz / l;
  }
  /** -1 … 1: how far to the listener's right (x, z) is, eased to the middle when it's close */
  private panOf(x: number, z: number): number {
    const dx = x - this.lx, dz = z - this.lz, d = Math.hypot(dx, dz);
    if (d < 0.5) return 0;
    return Math.max(-1, Math.min(1, ((dx * -this.fz + dz * this.fx) / d) * Math.min(1, d / 10) * 0.85));
  }
  /** where the next tones and noises go (a positional sound's own gain and panner), else the street */
  private out: AudioNode | null = null;
  /** play `fn`'s sounds as if from (x, z) metres, heard up to `range` m: quieter with distance (silent beyond),
   *  panned to the side they come from, muffled through the walls when the listener is indoors. Returns whether
   *  anything was played */
  at(x: number, z: number, range: number, fn: () => void): boolean {
    if (!this.started || !this.enabled || !this.ctx || !this.street) return false;
    const d = Math.hypot(x - this.lx, z - this.lz);
    const k = d >= range ? 0 : Math.pow(1 - d / range, 1.6);
    if (k < 0.03) return false;
    const c = this.ctx, g = c.createGain();
    g.gain.value = k;
    const pan = c.createStereoPanner();
    pan.pan.value = this.panOf(x, z);
    g.connect(pan);
    pan.connect(this.street);
    // (and a little of it into the space around: distant sounds are mostly reflections)
    if (d > 30 && this.verbIn) { const s = c.createGain(); s.gain.value = Math.min(0.6, d / 300); g.connect(s); s.connect(this.verbIn); }
    this.out = g;
    try { fn(); } finally { this.out = null; }
    return true;
  }
  /** the interface's own sounds (never muffled) */
  uiSound(fn: () => void): void {
    if (!this.ui) { fn(); return; }
    this.out = this.ui;
    try { fn(); } finally { this.out = null; }
  }
  engineOff(): void {
    if (this.eng && this.ctx) {
      this.set(this.eng.g.gain, 0, 0.2);
      for (const l of [this.eng.tyre, this.eng.wind, this.eng.skid]) this.set(l.g.gain, 0, 0.2);
    }
  }

  private env(g: GainNode, t0: number, a: number, peak: number, dec: number): void {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + dec);
  }
  tone(freq0: number, freq1: number | null, dur: number, peak: number, type: OscillatorType = 'sine', delay = 0, to?: AudioNode): void {
    if (!this.started || !this.enabled || !this.ctx) return;
    const c = this.ctx, t0 = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq0, t0);
    if (freq1) o.frequency.exponentialRampToValueAtTime(freq1, t0 + dur);
    const g = c.createGain();
    this.env(g, t0, Math.min(0.012, dur * 0.2), peak, dur);
    o.connect(g); g.connect(to ?? this.out ?? this.street ?? this.master!);
    o.start(t0); o.stop(t0 + dur + 0.15);
  }
  noise(dur: number, peak: number, freq: number, type: BiquadFilterType = 'lowpass', delay = 0, to?: AudioNode, q = 0.7, buf: 'white' | 'pink' | 'brown' = 'white', attack = 0.01): void {
    if (!this.started || !this.enabled || !this.ctx || !this.white) return;
    const c = this.ctx, t0 = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = buf === 'pink' ? this.pink : buf === 'brown' ? this.brown : this.white;
    const f = c.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    this.env(g, t0, attack, peak, dur);
    s.connect(f); f.connect(g); g.connect(to ?? this.out ?? this.street ?? this.master!);
    s.start(t0, Math.random() * 3); s.stop(t0 + attack + dur + 0.1);
  }
  /** a struck, ringing thing: inharmonic partials (`ratios` of `f`), each dying away at its own rate */
  private ring(f: number, ratios: number[], peak: number, dur: number, delay = 0, to?: AudioNode): void {
    ratios.forEach((r, i) => this.tone(f * r, null, dur / (1 + i * 0.35), peak / (1 + i * 0.6), 'sine', delay, to));
  }

  /* ---------- the sim's events ---------- */
  chirp(): void { this.bird('sparrow', 0, 0.6); }
  place(): void { this.tone(150, 90, 0.1, 0.16, 'sine', 0, this.ui ?? undefined); this.noise(0.06, 0.08, 900, 'lowpass', 0, this.ui ?? undefined); }
  /** a collision: the thump, crumpling metal, glass going, something rolling away */
  crunch(): void {
    Subs.sound('crunch', 'Crash!');
    this.noise(0.25, 0.32, 260, 'lowpass', 0, undefined, 0.7, 'brown', 0.004);
    this.noise(0.4, 0.16, 1400, 'bandpass', 0.01, undefined, 1.2, 'white', 0.003);
    this.ring(310, [1, 1.53, 2.31, 3.17], 0.05, 0.5, 0.02);
    for (let i = 0; i < 7; i++) this.tone(rnd(3200, 6800), null, rnd(0.04, 0.12), 0.025, 'sine', 0.06 + i * rnd(0.02, 0.06));
    this.noise(0.6, 0.04, 3500, 'highpass', 0.12, undefined, 0.7, 'white', 0.02);
  }
  /** church bells: a peal of real bell partials (hum, prime, tierce, quint, nominal), ringing down */
  bell(): void {
    Subs.sound('bell', 'Church bells ring', 20000);
    const notes = [392, 349, 330, 294, 262];
    for (let r = 0; r < 2; r++) notes.forEach((f, i) => this.ring(f, [0.5, 1, 1.19, 1.5, 2, 2.5, 3.01], 0.07, 3.2, r * 2.2 + i * 0.42));
  }
  thunder(): void {
    Subs.sound('thunder', 'Thunder rumbles', 8000);
    const d = 0.25 + Math.random() * 1.2;
    this.noise(0.18, 0.2, 2200, 'lowpass', d, undefined, 0.7, 'white', 0.005); // the crack (only when it's close)
    this.noise(2.6, 0.32, 160, 'lowpass', d + 0.05, undefined, 0.7, 'brown', 0.2);
    this.noise(1.8, 0.2, 80, 'lowpass', d + 0.8 + Math.random() * 0.6, undefined, 0.7, 'brown', 0.3);
  }
  /** a siren going past: a few seconds of wail (from where it is) */
  siren(): void {
    Subs.sound('siren', 'Sirens', 10000);
    if (!this.ctx) return;
    const c = this.ctx, t0 = c.currentTime, o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
    o.type = 'sawtooth'; f.type = 'lowpass'; f.frequency.value = 1800;
    for (let k = 0; k < 4; k++) { o.frequency.setValueAtTime(620, t0 + k * 0.9); o.frequency.linearRampToValueAtTime(1350, t0 + k * 0.9 + 0.45); o.frequency.linearRampToValueAtTime(620, t0 + k * 0.9 + 0.9); }
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(0.05, t0 + 0.2); g.gain.setValueAtTime(0.05, t0 + 3.2); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.7);
    o.connect(f); f.connect(g); g.connect(this.out ?? this.street!);
    o.start(t0); o.stop(t0 + 3.8);
  }
  /** a firework's rocket going up */
  launch(): void { this.noise(0.9, 0.03, 2400, 'bandpass', 0, undefined, 2, 'white', 0.2); this.tone(900, 2200, 0.8, 0.012, 'sine'); }
  /** a car horn, `k` 0..1 for how near it is: two reedy notes */
  horn(k = 1): void {
    if (k > 0.35) Subs.sound('horn', 'A horn sounds');
    if (!this.ctx) return;
    const c = this.ctx, t0 = c.currentTime, f = c.createBiquadFilter(), g = c.createGain();
    f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 1.2;
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(0.09 * k, t0 + 0.02); g.gain.setValueAtTime(0.09 * k, t0 + 0.32); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.42);
    for (const fr of [415, 523]) { const o = c.createOscillator(); o.type = 'square'; o.frequency.value = fr; o.connect(f); o.start(t0); o.stop(t0 + 0.45); }
    f.connect(g); g.connect(this.out ?? this.street!);
  }
  /** a baby crying: a vowel that rises and falls */
  baby(): void {
    for (let i = 0; i < 3; i++) {
      this.tone(420, 560, 0.45, 0.03, 'sawtooth', i * 0.6);
      this.noise(0.4, 0.02, 1100, 'bandpass', i * 0.6, undefined, 4);
    }
  }
  ding(): void {
    this.tone(1320, null, 0.12, 0.06, 'square', 0, this.ui ?? undefined);
    this.tone(1760, null, 0.2, 0.05, 'sine', 0.06, this.ui ?? undefined);
  }
  /** a brass fanfare: a rising arpeggio and a held chord */
  fanfare(): void {
    Subs.sound('fanfare', 'A fanfare plays', 10000);
    if (!this.ctx) return;
    const c = this.ctx;
    const play = (f: number, at: number, dur: number): void => {
      const o = c.createOscillator(), fl = c.createBiquadFilter(), g = c.createGain(), t0 = c.currentTime + at;
      o.type = 'sawtooth'; o.frequency.value = f;
      fl.type = 'lowpass'; fl.frequency.setValueAtTime(400, t0); fl.frequency.linearRampToValueAtTime(2400, t0 + 0.06); fl.frequency.linearRampToValueAtTime(1400, t0 + dur);
      this.env(g, t0, 0.03, 0.035, dur);
      o.connect(fl); fl.connect(g); g.connect(this.out ?? this.street!);
      o.start(t0); o.stop(t0 + dur + 0.1);
    };
    [523, 659, 784, 1046].forEach((f, i) => play(f, i * 0.14, 0.3));
    for (const f of [523, 659, 784]) play(f, 0.62, 0.9);
  }
  /** a firework bursting: a bang, then crackle */
  pop(): void {
    Subs.sound('pop', 'Fireworks', 8000);
    this.noise(0.5, 0.18, 300, 'lowpass', 0, undefined, 0.7, 'brown', 0.003);
    this.noise(0.12, 0.1, 1800, 'highpass', 0.01);
    for (let i = 0; i < 12; i++) this.noise(0.03, 0.035, rnd(2500, 6000), 'bandpass', 0.25 + i * rnd(0.03, 0.08), undefined, 3);
  }

  /* ---------- birds: a few species' calls ---------- */
  private bird(kind: string, pan: number, k: number): void {
    if (!this.ctx || !this.street) return;
    const c = this.ctx, g = c.createGain(), p = c.createStereoPanner();
    g.gain.value = k; p.pan.value = pan;
    g.connect(p); p.connect(this.street);
    this.out = g;
    try {
      if (kind === 'blackbird') {
        // a fluting phrase: a few notes gliding, then a twittering tail
        let t = 0;
        for (let i = 0; i < 4 + ((Math.random() * 3) | 0); i++) { const f = rnd(1500, 2600); this.tone(f, f * rnd(0.85, 1.25), rnd(0.12, 0.22), 0.03, 'sine', t); t += rnd(0.14, 0.24); }
        for (let i = 0; i < 6; i++) this.tone(rnd(4000, 6000), rnd(3500, 6500), 0.03, 0.012, 'sine', t + i * 0.04);
      } else if (kind === 'robin') {
        let t = 0;
        for (let i = 0; i < 7; i++) { const f = rnd(2800, 5200); this.tone(f, f * rnd(0.7, 1.4), rnd(0.05, 0.12), 0.018, 'sine', t); t += rnd(0.07, 0.15); }
      } else if (kind === 'pigeon') {
        // the wood pigeon: coo-COO-coo coo-coo
        [[0, 0.32], [0.38, 0.5], [0.95, 0.3], [1.35, 0.28], [1.7, 0.28]].forEach(([at, dur]) => this.tone(390, 330, dur, 0.035, 'sine', at));
      } else if (kind === 'crow') {
        for (let i = 0; i < 2 + ((Math.random() * 2) | 0); i++) { this.noise(0.22, 0.03, 1100, 'bandpass', i * 0.45, undefined, 3); this.tone(620, 520, 0.22, 0.018, 'sawtooth', i * 0.45); }
      } else if (kind === 'gull') {
        for (let i = 0; i < 3; i++) this.tone(1500, 900, 0.3, 0.025, 'triangle', i * 0.32);
      } else if (kind === 'owl') {
        this.tone(410, 380, 0.5, 0.04, 'sine', 0); this.tone(410, 360, 0.25, 0.03, 'sine', 0.8); this.tone(420, 370, 0.7, 0.035, 'sine', 1.2);
      } else if (kind === 'woodpecker') {
        for (let i = 0; i < 14; i++) this.noise(0.012, 0.05, 1200, 'bandpass', i * 0.055, undefined, 4);
      } else {
        // sparrows: chirps
        const n = 2 + ((Math.random() * 4) | 0);
        for (let i = 0; i < n; i++) this.tone(rnd(2600, 3600), rnd(2000, 2600), 0.06, 0.03, 'sine', i * rnd(0.09, 0.16));
      }
    } finally { this.out = null; }
  }
  /** a dog barking, somewhere in the houses */
  private dog(pan: number, k: number): void {
    if (!this.ctx || !this.street) return;
    const g = this.ctx.createGain(), p = this.ctx.createStereoPanner();
    g.gain.value = k; p.pan.value = pan; g.connect(p); p.connect(this.street);
    this.out = g;
    try { for (let i = 0; i < 2 + ((Math.random() * 3) | 0); i++) { this.tone(rnd(380, 520), 300, 0.12, 0.05, 'sawtooth', i * rnd(0.25, 0.45)); this.noise(0.1, 0.04, 900, 'bandpass', i * rnd(0.25, 0.45), undefined, 2); } }
    finally { this.out = null; }
  }

  /* ---------- the scene, every frame ---------- */
  /** ambience follows the world (audio/scape.ts measures it); call every frame */
  tick(dt: number, s: Scene): void {
    if (!this.started || !this.enabled || !this.ctx || !this.street || !this.room) return;
    const c = this.ctx, now = c.currentTime;
    const L = this.L, set = (l: Layer, v: number, t = 0.6): void => this.set(l.g.gain, v, t);
    const inn = s.indoors, room = s.room;
    // through the walls: the street muffled and quieter; the room up
    this.set(this.streetLp!.frequency, inn ? 520 : 18000, 0.25);
    this.set(this.street.gain, inn ? 0.45 : 1, 0.25);
    this.set(this.room.gain, inn ? 1 : 0, 0.25);
    this.setVerb(inn && room ? Math.min(2.4, 0.3 + (room.w * room.d * room.h) / 600) : 0.8);
    this.set(this.verbIn!.gain, inn ? 0.32 : 0.12, 0.3);

    // weather and the air
    const gust = 0.5 + 0.5 * Math.sin(now * 0.37) * Math.sin(now * 0.13 + 1.3);
    const windK = clamp01(s.wind) * (0.4 + 0.6 * s.open) * (1 + Math.min(1.5, s.height / 40));
    set(L.wind, (0.012 + windK * 0.05 + s.snow * 0.015) * (0.6 + 0.8 * gust), 0.8);
    this.set(L.wind.f.frequency, 260 + windK * 500 + gust * 180, 0.8);
    set(L.gust, windK * windK * 0.03 * gust, 0.5);
    set(L.leaves, s.trees * (0.004 + clamp01(s.wind) * 0.03) * (0.5 + gust) * (s.season === 3 ? 0.25 : 1), 0.4);
    set(L.rain, s.rain * 0.12 * (inn ? 0.5 : 1), 0.8);
    set(L.rainNear, s.rain * 0.035 * (inn ? 0 : 1), 0.8);
    set(L.roofRain, inn ? s.rain * 0.14 : 0, 0.8);
    // water: the sea's or a lake's waves rolling in and out, a river's steady chatter
    const swell = 0.55 + 0.45 * Math.sin(now * 0.55) * Math.sin(now * 0.23 + 0.7);
    set(L.waves, s.sea * 0.07 * swell, 0.9);
    set(L.stream, clamp01(s.water - s.sea) * 0.03, 0.8);
    // the town: the traffic's hum (rush hour and all), people talking
    set(L.traffic, clamp01(s.traffic) * 0.07, 0.8);
    const babble = 0.6 + 0.4 * Math.sin(now * 5.3) * Math.sin(now * 3.1 + 0.4);
    set(L.crowd, clamp01(s.crowd) * 0.05 * babble + (s.gathering ? clamp01(s.gathering.k) * (s.gathering.cheer ? 0.09 : 0.04) : 0), 0.15);
    this.set(L.crowd.f.frequency, 480 + babble * 260, 0.1);
    // the season's insects: crickets on warm nights, cicadas in the summer heat by day
    const warmNight = s.dark > 0.45 && s.season <= 2 && s.rain < 0.2 && s.snow < 0.1;
    const cicada = s.season === 1 && s.dark < 0.2 && s.clock > 660 && s.clock < 1080 && s.rain < 0.1 ? s.trees * 0.02 : 0;
    set(L.cicada, cicada * (0.6 + 0.4 * Math.sin(now * 0.9)), 1.2);
    if (warmNight && (this.next.cricket ?? 0) < now + 0.2) {
      // a chirp: three pulses of the 4.6 kHz tone
      const t0 = Math.max(now, this.next.cricket ?? now), k = 0.008 + s.trees * 0.006 + (1 - s.traffic) * 0.004;
      for (let i = 0; i < 3; i++) { L.crickets.g.gain.setValueAtTime(k, t0 + i * 0.05); L.crickets.g.gain.setValueAtTime(0, t0 + i * 0.05 + 0.025); }
      this.next.cricket = t0 + rnd(0.45, 1.1);
    }
    // fires crackle where they burn
    let fireK = 0;
    for (const f of s.fires) fireK = Math.max(fireK, f.k * Math.pow(clamp01(1 - Math.hypot(f.x - this.lx, f.z - this.lz) / 140), 1.5));
    set(L.fire, fireK * 0.09, 0.4);
    if (fireK > 0.05 && (this.next.crackle ?? 0) < now) {
      for (let i = 0; i < 4; i++) this.noise(0.02, 0.05 * fireK, rnd(1500, 4500), 'bandpass', rnd(0, 0.3), undefined, 3);
      this.next.crackle = now + rnd(0.08, 0.3);
    }

    // birds: a dawn chorus, quieter by day, an evening song, owls at night; by habitat, season and weather
    this.birds(s, now);
    // building sites and works, the sound of work
    this.work(s, now);
    // the vehicles near the listener and the siren of whoever's on blue lights
    this.traffic(s);
    // the Founder at the wheel, or on foot
    this.founder(dt, s);
    // inside: the room's own life
    this.roomLife(s, now);
  }

  private birds(s: Scene, now: number): void {
    if ((this.next.bird ?? 0) > now) return;
    const h = s.clock / 60;
    const dawn = Math.max(0, 1 - Math.abs(h - 5.8) / 1.6), dusk = Math.max(0, 1 - Math.abs(h - 19.5) / 1.4);
    const day = h > 6 && h < 19 ? 0.35 : 0;
    const season = s.season === 3 ? 0.2 : s.season === 0 ? 1.25 : s.season === 2 ? 0.6 : 1;
    const habitat = 0.25 + s.trees * 0.9 + s.open * 0.3 - clamp01(s.traffic) * 0.3;
    let rate = (dawn * 2.5 + dusk * 1.2 + day) * season * habitat * (1 - clamp01(s.rain * 1.5)) * (s.indoors ? 0.3 : 1);
    const night = s.dark > 0.6;
    if (night) rate = s.trees > 0.25 ? 0.05 : 0;
    this.next.bird = now + (rate > 0.01 ? rnd(0.4, 2.6) / rate : 4);
    if (rate <= 0.01) return;
    const pan = rnd(-0.9, 0.9), k = rnd(0.35, 1) * (s.indoors ? 0.4 : 1);
    if (night) { if (Math.random() < 0.6) this.bird('owl', pan, k * 0.8); return; }
    const r = Math.random();
    const kind = s.sea > 0.2 && r < 0.35 ? 'gull'
      : s.trees > 0.5 && r < 0.12 ? 'woodpecker'
        : r < (s.season === 3 ? 0.55 : 0.3) ? 'robin'
          : r < 0.5 ? 'blackbird'
            : r < 0.62 && s.trees > 0.2 ? 'pigeon'
              : r < 0.7 ? 'crow'
                : 'sparrow';
    this.bird(kind, pan, k);
    // and now and then a dog in the houses (more in the evening)
    if (s.open < 0.8 && Math.random() < (h > 17 || h < 8 ? 0.12 : 0.04)) this.dog(rnd(-0.9, 0.9), rnd(0.2, 0.6));
  }

  private work(s: Scene, now: number): void {
    // hammering, sawing and the cement mixer on building sites in working hours
    for (const w of s.sites) {
      const d = Math.hypot(w.x - this.lx, w.z - this.lz), k = w.k * Math.pow(clamp01(1 - d / 110), 1.5);
      if (k < 0.04) continue;
      const key = `site${Math.round(w.x)}|${Math.round(w.z)}`;
      if ((this.next[key] ?? 0) > now) continue;
      this.next[key] = now + rnd(0.5, 2.2);
      this.at(w.x, w.z, 110, () => {
        if (Math.random() < 0.6) for (let i = 0; i < 3 + ((Math.random() * 4) | 0); i++) { this.noise(0.05, 0.09, 1600, 'bandpass', i * 0.32, undefined, 2); this.tone(rnd(300, 600), null, 0.06, 0.03, 'triangle', i * 0.32); }
        else { this.noise(1.4, 0.04, 2200, 'bandpass', 0, undefined, 4, 'white', 0.05); this.tone(180, 220, 1.4, 0.012, 'sawtooth'); }
      });
    }
    // the works: machinery humming, a clank now and then
    for (const w of s.works) {
      const d = Math.hypot(w.x - this.lx, w.z - this.lz), k = w.k * Math.pow(clamp01(1 - d / 140), 1.5);
      if (k < 0.04) continue;
      const key = `works${Math.round(w.x)}|${Math.round(w.z)}`;
      if ((this.next[key] ?? 0) > now) continue;
      this.next[key] = now + rnd(1.5, 4);
      this.at(w.x, w.z, 140, () => {
        this.noise(2.5, 0.05, 120, 'lowpass', 0, undefined, 0.8, 'brown', 0.3);
        if (Math.random() < 0.5) this.ring(rnd(180, 320), [1, 2.7, 4.1], 0.04, 0.6, rnd(0.2, 1.5));
      });
    }
  }

  /** engine voices: the nearest few vehicles, each its own pitch and level, panned to where it is */
  private traffic(s: Scene): void {
    const c = this.ctx!, now = c.currentTime;
    const want = s.cars.slice(0, this.voices.length);
    const used = new Set<Voice>();
    for (const car of want) {
      const v = this.voices.find((q) => q.who === car.who && !used.has(q)) ?? this.voices.find((q) => !used.has(q) && !want.some((w) => w.who === q.who));
      if (!v) continue;
      used.add(v);
      v.who = car.who;
      const d = Math.hypot(car.x - this.lx, car.z - this.lz);
      const big = car.kind === 'bus' || car.kind === 'truck', air = car.kind === 'plane' || car.kind === 'heli';
      const range = air ? 900 : car.kind === 'train' ? 420 : big ? 220 : 160;
      const k = Math.pow(clamp01(1 - d / range), 1.7);
      const sp = Math.max(0, car.v);
      // pitch: a gear's worth of revs from the speed (low and slow for diesels and trains, a buzz for motorbikes)
      const gear = car.kind === 'moto' ? 1 + Math.min(4, Math.floor(sp / 6)) : 1 + Math.min(4, Math.floor(sp / 7));
      const span = car.kind === 'moto' ? 6 : 7, frac = (sp - (gear - 1) * span) / span;
      const base = car.kind === 'moto' ? 70 : big ? 34 : car.kind === 'train' ? 28 : car.kind === 'boat' ? 45 : air ? (car.kind === 'heli' ? 18 : 90) : 42;
      const f = base * (1 + clamp01(frac) * 0.9) + (sp < 0.5 ? 0 : 6);
      v.osc.frequency.setTargetAtTime(f, now, 0.15);
      v.sub.frequency.setTargetAtTime(f * 0.5, now, 0.15);
      v.f.frequency.setTargetAtTime((big || car.kind === 'train' ? 260 : 420) + sp * 25, now, 0.2);
      const level = (car.kind === 'train' ? 0.08 : air ? 0.09 : big ? 0.05 : car.kind === 'moto' ? 0.04 : 0.028) * (0.45 + clamp01(sp / 12) * 0.55);
      v.g.gain.setTargetAtTime(level * k, now, 0.2);
      // tyres on the road (rails clattering for a train, the rotor's chop for a helicopter)
      v.tf.frequency.setTargetAtTime(car.kind === 'train' ? 1800 : air ? 500 : 650 + sp * 30, now, 0.3);
      v.tg.gain.setTargetAtTime((car.kind === 'train' ? 0.05 : air ? 0.03 : 0.012 * clamp01(sp / 10)) * k, now, 0.25);
      v.pan.pan.setTargetAtTime(this.panOf(car.x, car.z), now, 0.1);
    }
    for (const v of this.voices) if (!used.has(v)) { v.g.gain.setTargetAtTime(0, now, 0.3); v.tg.gain.setTargetAtTime(0, now, 0.3); v.who = null; }
    // the siren of whoever is on blue lights nearest (wail for the police, hi-lo for the fire engine, yelp for an ambulance)
    if (s.siren) {
      if (!this.sirenV) {
        const o = c.createOscillator(), g = c.createGain(), pan = c.createStereoPanner(), f = c.createBiquadFilter();
        o.type = 'sawtooth'; f.type = 'lowpass'; f.frequency.value = 2000; g.gain.value = 0;
        o.connect(f); f.connect(g); g.connect(pan); pan.connect(this.street!);
        o.start();
        this.sirenV = { osc: o, g, pan, f, t: 0 };
      }
      const S = this.sirenV, d = Math.hypot(s.siren.x - this.lx, s.siren.z - this.lz);
      S.t += 1 / 60;
      const ph = S.t, kind = s.siren.kind;
      const fr = kind === 'fire' ? (Math.floor(ph * 1.2) % 2 ? 960 : 720) : kind === 'ambulance' ? 650 + 650 * Math.abs(Math.sin(ph * 6)) : 620 + 700 * (0.5 - 0.5 * Math.cos(ph * 1.4));
      S.osc.frequency.setTargetAtTime(fr, now, 0.02);
      S.g.gain.setTargetAtTime(0.06 * Math.pow(clamp01(1 - d / 420), 1.6), now, 0.15);
      S.pan.pan.setTargetAtTime(this.panOf(s.siren.x, s.siren.z), now, 0.1);
    } else if (this.sirenV) this.sirenV.g.gain.setTargetAtTime(0, now, 0.3);
  }

  /** the Founder's engine (revs through the gears with the speed, the throttle opening it up), tyres, wind, skids,
   *  and footsteps on whatever they walk on */
  private founder(dt: number, s: Scene): void {
    const e = this.eng!, now = this.ctx!.currentTime;
    const d = s.drive;
    if (!d) {
      this.set(e.g.gain, 0, 0.25);
      for (const l of [e.tyre, e.wind, e.skid]) this.set(l.g.gain, 0, 0.25);
    } else {
      const sp = Math.abs(d.v);
      if (d.kind === 'bike') {
        this.set(e.g.gain, 0, 0.2);
        // a freewheel ticking when coasting
        if (sp > 1 && d.gas < 0.1 && (this.next.freewheel ?? 0) < now) { this.tone(5200, null, 0.008, 0.012, 'square', 0, this.master!); this.next.freewheel = now + 0.9 / (sp + 1); }
      } else {
        const tops = d.kind === 'moto' ? [0, 7, 13, 20, 28, 38] : d.kind === 'bus' || d.kind === 'truck' ? [0, 4, 8, 13, 19, 26] : [0, 5, 10, 16, 23, 32];
        let gear = 1;
        while (gear < tops.length - 1 && sp > tops[gear]) gear++;
        const lo = tops[gear - 1], hi = tops[gear], frac = clamp01((sp - lo) / Math.max(1, hi - lo));
        const idle = d.kind === 'moto' ? 1300 : d.kind === 'bus' || d.kind === 'truck' ? 650 : 850;
        const red = d.kind === 'moto' ? 9000 : d.kind === 'bus' || d.kind === 'truck' ? 2300 : 5600;
        const target = sp < 0.6 ? idle + d.gas * (red - idle) * 0.35 : idle + (red - idle) * (0.18 + frac * 0.7) + d.gas * 300;
        e.rpm += (target - e.rpm) * Math.min(1, dt * (gear !== e.gear ? 3 : 7));
        if (gear !== e.gear) e.gear = gear;
        const cyl = d.kind === 'moto' ? 1 : d.kind === 'bus' || d.kind === 'truck' ? 3 : 2;
        const f = (e.rpm / 60) * cyl;
        e.o1.frequency.setTargetAtTime(f, now, 0.03);
        e.o2.frequency.setTargetAtTime(f * 0.5, now, 0.03);
        this.set(e.f.frequency, 220 + d.gas * 1500 + e.rpm * 0.08, 0.05);
        this.set(e.g.gain, (d.kind === 'moto' ? 0.05 : d.kind === 'bus' || d.kind === 'truck' ? 0.06 : 0.04) * (0.55 + d.gas * 0.45), 0.08);
      }
      this.set(e.tyre.g.gain, clamp01(sp / 25) ** 1.4 * 0.05, 0.2);
      this.set(e.tyre.f.frequency, 400 + sp * 22, 0.3);
      this.set(e.wind.g.gain, clamp01((sp - 12) / 25) ** 2 * 0.06, 0.3);
      this.set(e.skid.g.gain, clamp01(d.skid) * 0.06, 0.05);
    }
    if (s.step) this.footstep(s.step.surface, s.step.run);
  }

  /** one footstep: the heel, the sole, and what the ground does under it */
  footstep(surface: string, run = false): void {
    if (!this.ctx || !this.master) return;
    const k = run ? 1.4 : 1, to = this.master;
    switch (surface) {
      case 'grass': this.noise(0.09, 0.03 * k, 2800, 'bandpass', 0, to, 0.8, 'pink', 0.02); this.noise(0.05, 0.02 * k, 400, 'lowpass', 0, to, 0.7, 'brown'); break;
      case 'snow': this.noise(0.16, 0.05 * k, 1100, 'bandpass', 0, to, 1.5, 'white', 0.03); for (let i = 0; i < 3; i++) this.noise(0.02, 0.02 * k, 3000, 'bandpass', 0.03 + i * 0.03, to, 4); break;
      case 'gravel': case 'sand': this.noise(0.12, (surface === 'sand' ? 0.025 : 0.045) * k, surface === 'sand' ? 1600 : 3200, 'bandpass', 0, to, 1, 'white', 0.01); break;
      case 'wood': this.noise(0.05, 0.05 * k, 600, 'bandpass', 0, to, 1.5, 'brown', 0.002); this.tone(180, 140, 0.06, 0.03 * k, 'triangle', 0, to); break;
      case 'carpet': this.noise(0.06, 0.02 * k, 500, 'lowpass', 0, to, 0.7, 'brown'); break;
      case 'tile': this.noise(0.03, 0.05 * k, 2400, 'bandpass', 0, to, 2, 'white', 0.001); this.noise(0.04, 0.03 * k, 300, 'lowpass', 0, to, 0.7, 'brown'); break;
      default: this.noise(0.035, 0.045 * k, 1800, 'bandpass', 0, to, 1.4, 'white', 0.001); this.noise(0.05, 0.035 * k, 220, 'lowpass', 0, to, 0.7, 'brown');
    }
  }

  /** inside a building: its hum, its people, its own sounds, and (in shops, cafés and venues) its music */
  private roomLife(s: Scene, now: number): void {
    const L = this.L, r = s.room;
    if (!s.indoors || !r) {
      for (const k of ['roomTone', 'roomHum', 'murmur', 'machine']) this.set(L[k].g.gain, 0, 0.3);
      return;
    }
    const t = r.template, type = r.type, R = this.room!;
    const busy = clamp01(r.people / 10);
    this.set(L.roomTone.g.gain, 0.03, 1);
    this.set(L.roomHum.g.gain, t === 'shop' || type === 'butcher' || type === 'fishmarket' || t === 'hospital' ? 0.006 : 0.002, 1);
    this.set(L.murmur.g.gain, busy * (t === 'food' || t === 'venue' || t === 'terminal' || t === 'classroom' ? 0.06 : 0.035) * (0.6 + 0.4 * Math.sin(now * 4.7) * Math.sin(now * 2.9)), 0.15);
    const industrial = t === 'workshop' && !['laundry', 'autoshop'].includes(type);
    this.set(L.machine.g.gain, industrial ? 0.02 : type === 'laundry' ? 0.012 : 0, 1);
    // the room's own sounds, now and then
    if ((this.next.room ?? 0) < now) {
      this.next.room = now + rnd(0.6, 2.5);
      const pick = Math.random();
      if (t === 'food') {
        if (pick < 0.5) this.ring(rnd(2200, 3400), [1, 2.4, 3.9], 0.02, 0.3, 0, R); // a cup on a saucer, cutlery
        else if (pick < 0.62 && (type === 'cafe' || type === 'bakery')) this.noise(2.2, 0.03, 3500, 'highpass', 0, R, 0.7, 'white', 0.3); // the espresso machine
        else if (pick < 0.72) this.tone(1800, null, 0.08, 0.015, 'square', 0, R); // the till
      } else if (t === 'shop' || type === 'pharmacy') {
        if (type === 'barber') { if (pick < 0.5) { this.tone(115, null, 1.2, 0.012, 'sawtooth', 0, R); this.noise(1.2, 0.01, 4000, 'highpass', 0, R); } else for (let i = 0; i < 4; i++) this.noise(0.015, 0.02, 5000, 'bandpass', i * 0.12, R, 3); }
        else if (pick < 0.45) this.tone(2000, null, 0.07, 0.014, 'square', 0, R); // a scanner's beep
        else if (pick < 0.55) this.ring(1400, [1, 1.5], 0.012, 0.25, 0, R);
      } else if (t === 'office' || t === 'police') {
        if (pick < 0.55) for (let i = 0; i < 6; i++) this.noise(0.012, 0.015, 3500, 'bandpass', i * rnd(0.08, 0.14), R, 2); // typing
        else if (pick < 0.65) for (let i = 0; i < 2; i++) { this.tone(450, null, 0.4, 0.012, 'sine', i * 0.6, R); this.tone(480, null, 0.4, 0.012, 'sine', i * 0.6, R); } // a phone
        else if (pick < 0.75 && t === 'police') this.noise(0.8, 0.02, 1800, 'bandpass', 0, R, 2); // radio static
      } else if (t === 'workshop' || t === 'fire') {
        if (pick < 0.5) this.ring(rnd(160, 300), [1, 2.76, 5.4], 0.05, 0.7, 0, R); // a clank
        else if (pick < 0.7) this.noise(0.5, 0.05, 900, 'bandpass', 0, R, 1, 'white', 0.05); // an air tool, a press
      } else if (t === 'hospital') {
        if (pick < 0.6) this.tone(1000, null, 0.12, 0.012, 'sine', 0, R); // a monitor
      } else if (t === 'terminal') {
        if (pick < 0.12) { this.tone(659, null, 0.6, 0.03, 'sine', 0, R); this.tone(523, null, 0.9, 0.03, 'sine', 0.55, R); } // the announcement chime
      } else if (t === 'classroom') {
        if (pick < 0.3 && type !== 'library') this.noise(0.15, 0.02, 2500, 'bandpass', 0, R, 3); // chalk
        else if (pick < 0.4) this.noise(0.25, 0.012, 3000, 'highpass', 0, R); // a page turned
      } else if (t === 'venue') {
        if (type === 'arcade') [0, 1, 2, 3].forEach((i) => this.tone([523, 659, 784, 1046][(i + ((Math.random() * 4) | 0)) % 4], null, 0.08, 0.015, 'square', i * 0.09, R));
        else if (type === 'casino' && pick < 0.5) [0, 1, 2, 3, 4].forEach((i) => this.tone(880 + i * 110, null, 0.1, 0.015, 'triangle', i * 0.08, R));
        else if (type === 'pool' && pick < 0.6) this.noise(0.6, 0.04, 1200, 'bandpass', 0, R, 0.8, 'pink', 0.02);
        else if (type === 'gym' && pick < 0.4) this.ring(220, [1, 2.9], 0.04, 0.4, 0, R);
      } else if (t === 'civic') {
        if ((type === 'church' || type === 'temple') && pick < 0.15) for (const f of [131, 196, 262]) this.tone(f, null, 4, 0.012, 'triangle', 0, R); // the organ, a held chord
      } else if (t === 'home') {
        if (pick < 0.5) { this.next.room = now + 1; this.noise(0.01, 0.012, 3000, 'bandpass', 0, R, 4); } // the clock
      }
    }
    // music: the shop's radio, the café's playlist, the gym's beat
    if (r.music && (this.next.music ?? 0) < now) this.music(type === 'gym' || type === 'arcade' ? 'beat' : 'easy', now);
  }

  /** a bar of background music from a ceiling speaker (chords and a few melody notes; or a beat) */
  private music(style: 'easy' | 'beat', now: number): void {
    const R = this.room!;
    const prog = [[262, 330, 392], [196, 247, 294], [220, 262, 330], [175, 220, 262]];
    const bar = Math.floor(now / 2.4) % 4, ch = prog[bar];
    this.next.music = now + 2.4;
    if (style === 'beat') {
      for (let i = 0; i < 4; i++) { this.tone(110, 45, 0.18, 0.04, 'sine', i * 0.5, R); this.noise(0.03, 0.012, 7000, 'highpass', i * 0.5 + 0.25, R); }
      for (const f of ch) this.tone(f, null, 0.4, 0.006, 'square', 0, R);
      return;
    }
    for (const f of ch) this.tone(f, null, 2.3, 0.008, 'triangle', 0, R);
    const scale = [523, 587, 659, 784, 880];
    for (let i = 0; i < 3; i++) if (Math.random() < 0.7) this.tone(scale[(Math.random() * scale.length) | 0], null, 0.5, 0.008, 'sine', i * 0.8, R);
  }
}

export const Snd = new Sound();

/** how far each of the sim's sounds carries (metres); 0: heard everywhere (a fanfare, thunder, the Planner's clicks) */
const CARRY: Record<string, number> = { siren: 420, crunch: 220, bell: 900, launch: 1100, pop: 1300, baby: 45, ding: 90, horn: 120, fanfare: 400 };
// the sim asks for sounds by name, and says where they happen
on('sound', ({ name, at }) => {
  const fn = (Snd as unknown as Record<string, unknown>)[name];
  if (typeof fn !== 'function') return;
  const play = (): void => (fn as () => void).call(Snd);
  if (at && CARRY[name]) Snd.at(at.x * 0.5, at.y * 0.5, CARRY[name], play);
  else play();
});
// unlock audio on the first interaction anywhere
window.addEventListener('pointerdown', () => Snd.start(), { once: true });
window.addEventListener('keydown', () => Snd.start(), { once: true });

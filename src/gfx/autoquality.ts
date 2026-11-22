/* ============================================================
   V2: Auto quality that measures. The graphics card's name only
   guesses (any card that isn't Intel's got High, whatever screen
   it drives); so with Quality on Auto, the first half-minute of
   play on a computer and screen is timed, and the preset for the
   next time the game opens follows from it:
   - frames slower than 25 ms (under 40 a second) on High: Medium
     next time; on Medium, only slower than 45 ms (about 22 a
     second) steps down to Low;
   - Medium with the graphics card done in under 5 ms a frame
     (where the browser can time it), and nothing slow: High next
     time, which is then timed in its turn and kept only if it
     holds up.
   Kept per graphics card and screen (a new monitor is timed
   afresh); choosing Auto again in Settings starts it over. A
   preset the player chose is never touched.
   ============================================================ */
import type { Quality } from './pipeline';

/** what the timing decided for one card and screen */
export interface AutoRecord {
  /** the graphics card and the screen's size in device pixels */
  sig: string;
  /** the preset to open with */
  pick: Quality;
  /** presets timed and kept (fast enough) */
  ok: Quality[];
  /** presets timed and found too slow */
  slow: Quality[];
  /** the last timing: median frame, slowest 5%, graphics card (ms; -1 untimed) */
  last?: { q: Quality; frame: number; p95: number; gpu: number; at: number };
}

const KEY = 'pixelville-nd-auto-quality';
/** frames slower than this (ms, the median over the timed spell) mean the preset is too much: High and Ultra under
 *  40 a second; Medium only under about 22 (Low is a big step down in looks, kept for a game that can't play) */
export const SLOW_MS = 25;
export const SLOW_MS_MEDIUM = 45;
/** on Medium, the graphics card's own time under this (ms) means High will fit */
export const ROOM_GPU_MS = 5;
/** seconds of play before timing starts (textures, shaders and the first trees settle), and how long it times */
export const WARM_S = 8, SPELL_S = 20;

const LIGHTER: Record<Quality, Quality> = { ultra: 'high', high: 'medium', medium: 'low', low: 'low' };

export function median(a: number[]): number {
  if (!a.length) return -1;
  const s = [...a].sort((x, y) => x - y);
  return s[s.length >> 1];
}
export function pct(a: number[], k: number): number {
  if (!a.length) return -1;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * k))];
}

/** the verdict on one timed spell: frame intervals (ms) and, where the browser can time it, the graphics card's (ms) */
export function decide(q: Quality, frames: number[], gpu: number[], rec: Pick<AutoRecord, 'slow'>): { next: Quality; verdict: 'slow' | 'room' | 'ok' } {
  const m = median(frames);
  if (q !== 'low' && m > (q === 'medium' ? SLOW_MS_MEDIUM : SLOW_MS)) return { next: LIGHTER[q], verdict: 'slow' };
  const g = median(gpu);
  if (q === 'medium' && g >= 0 && g < ROOM_GPU_MS && !rec.slow.includes('high')) return { next: 'high', verdict: 'room' };
  return { next: q, verdict: 'ok' };
}

export function signature(gpu: string): string {
  const d = globalThis.devicePixelRatio || 1;
  // (the monitor's size; an embedded browser that reports none, the window's)
  const s = globalThis.screen, w = s?.width || globalThis.innerWidth || 0, h = s?.height || globalThis.innerHeight || 0;
  return `${gpu}|${Math.round(w * d)}x${Math.round(h * d)}`;
}
export function loadRecord(sig: string): AutoRecord | null {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) || 'null') as AutoRecord | null;
    return r && r.sig === sig ? r : null;
  } catch { return null; }
}
export function saveRecord(r: AutoRecord): void {
  try { localStorage.setItem(KEY, JSON.stringify(r)); } catch { /* private mode: timed again next time */ }
}
export function clearRecord(): void {
  try { localStorage.removeItem(KEY); } catch { /* private mode */ }
}
/** the graphics card gave up (a context loss) on an auto-picked preset: it was too much */
export function markLost(sig: string, q: Quality): void {
  const r = loadRecord(sig) ?? { sig, pick: q, ok: [], slow: [] };
  if (!r.slow.includes(q)) r.slow.push(q);
  r.ok = r.ok.filter((x) => x !== q);
  r.pick = LIGHTER[q];
  saveRecord(r);
}

/** times a spell of play on an auto-picked preset and records the verdict */
export class QualityProbe {
  private playT = 0;
  private last = 0;
  private frames: number[] = [];
  private gpu: number[] = [];
  done = false;

  constructor(private sig: string, private q: Quality, private tell: (verdict: 'slow' | 'room' | 'ok', next: Quality) => void) {
    const r = loadRecord(sig);
    // (already timed on this preset and kept: nothing to do)
    if (r && r.ok.includes(q) && r.pick === q) this.done = true;
  }

  /** a frame at `now` (ms); `playing`: an ordinary frame of play (not a menu, a loading or travel screen, a hidden
   *  tab, or a capped frame rate); `gpuMs`: the graphics card's time for its last measured frame (NaN: untimed) */
  frame(now: number, playing: boolean, gpuMs: number): void {
    if (this.done) return;
    const gap = this.last ? now - this.last : 0;
    this.last = now;
    if (!playing || gap <= 0 || gap > 250) return; // (a pause, a dialog's wait, a hidden tab: not the game's pace)
    this.playT += gap / 1000;
    if (this.playT < WARM_S) return;
    this.frames.push(gap);
    if (gpuMs >= 0) this.gpu.push(gpuMs);
    if (this.playT < WARM_S + SPELL_S) return;
    this.done = true;
    const r = loadRecord(this.sig) ?? { sig: this.sig, pick: this.q, ok: [], slow: [] };
    const { next, verdict } = decide(this.q, this.frames, this.gpu, r);
    r.last = { q: this.q, frame: +median(this.frames).toFixed(1), p95: +pct(this.frames, 0.95).toFixed(1), gpu: this.gpu.length ? +median(this.gpu).toFixed(1) : -1, at: Date.now() };
    if (verdict === 'slow') { if (!r.slow.includes(this.q)) r.slow.push(this.q); r.ok = r.ok.filter((x) => x !== this.q); }
    else if (!r.ok.includes(this.q)) r.ok.push(this.q);
    r.pick = next;
    saveRecord(r);
    if (verdict !== 'ok') this.tell(verdict, next);
  }
}

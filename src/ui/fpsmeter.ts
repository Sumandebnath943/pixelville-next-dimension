/* ============================================================
   V2: the frame-rate counter (Settings → Graphics), in a top
   corner under the bar while playing: frames a second over the
   last half second, and the slowest frame in it (a stutter shows
   there long before it moves the average). Green from 50 fps,
   amber from 30, red below.
   ============================================================ */
import { Settings } from '../sim/settings';

const WINDOW_MS = 500;

export class FpsMeter {
  private frames = 0;
  private worst = 0;
  private from = 0;
  private last = 0;
  private fps: HTMLElement;
  private slow: HTMLElement;

  constructor(private el: HTMLElement) {
    this.fps = el.querySelector('b')!;
    this.slow = el.querySelector('small')!;
  }

  /** a frame was drawn at `now` (the frame loop's own clock) */
  tick(now: number): void {
    if ((Settings.get('fpsMeter') || 'off') === 'off') { this.last = 0; return; }
    if (this.last) {
      const gap = now - this.last;
      // (a hidden tab or a long pause on purpose (a dialog's wait) says nothing about the game: start again)
      if (gap > 1000) { this.from = now; this.frames = 0; this.worst = 0; }
      else { this.frames++; this.worst = Math.max(this.worst, gap); }
    } else this.from = now;
    this.last = now;
    if (now - this.from < WINDOW_MS || !this.frames) return;
    const fps = (this.frames * 1000) / (now - this.from);
    this.fps.textContent = String(Math.round(fps));
    this.slow.textContent = `slowest ${Math.round(this.worst)} ms`;
    this.el.dataset.level = fps >= 50 ? 'good' : fps >= 30 ? 'fair' : 'poor';
    this.from = now;
    this.frames = 0;
    this.worst = 0;
  }
}

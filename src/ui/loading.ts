const PHASES = {
  records:   { start: 0,  end: 7,   halfTime: 800,  segment: 0 },
  land:      { start: 7,  end: 16,  halfTime: 1500, segment: 1 },
  buildings: { start: 16, end: 46,  halfTime: 3500, segment: 2 },
  textures:  { start: 46, end: 60,  halfTime: 3000, segment: 3 },
  models:    { start: 60, end: 69,  halfTime: 4000, segment: 3 },
  lighting:  { start: 69, end: 97,  halfTime: 7000, segment: 4 },
  frame:     { start: 97, end: 100, halfTime: 1500, segment: 4 },
} as const;
type Phase = keyof typeof PHASES;
const SEGMENT_ENDS = [PHASES.records.end, PHASES.land.end, PHASES.buildings.end, PHASES.models.end, PHASES.frame.end];

/** Actual milestones unlock ranges. Time and completed work guide the display within them. */
export class LoadingProgress {
  private phase: Phase = 'records';
  private value = 0;
  private fraction = 0;
  private started: number;
  private lastPaint: number;
  private finish: { elapsed: number; from: number; duration: number } | null = null;

  constructor(now: number) {
    this.started = this.lastPaint = now;
  }

  enter(phase: Phase, now: number): void {
    this.phase = phase;
    this.started = now;
    this.fraction = 0;
  }

  report(done: number, total: number): void {
    if (total > 0) this.fraction = Math.max(this.fraction, Math.min(1, done / total));
  }

  complete(now: number, duration: number): void {
    if (this.finish) return;
    this.finish = { elapsed: 0, from: this.value, duration };
    this.lastPaint = now;
  }

  paint(now: number): number {
    // A missed paint (terrain build, shader submission, or a hidden tab) must not cause a jump.
    const dt = Math.max(0, Math.min(32, now - this.lastPaint));
    this.lastPaint = Math.max(this.lastPaint, now);
    if (this.finish) {
      const { from, duration } = this.finish;
      this.finish.elapsed += dt;
      const t = duration > 0 ? Math.min(1, this.finish.elapsed / duration) : 1;
      this.value = t === 1 ? 100 : from + (100 - from) * t * t * (3 - 2 * t);
      return this.value;
    }

    const { start, end, halfTime } = PHASES[this.phase];
    const estimate = 1 - 2 ** (-Math.max(0, now - this.started) / halfTime);
    // Keep room for the real phase completion, even if its counter or estimate is exhausted.
    const target = start + (end - start - 1) * Math.max(estimate, this.fraction);
    this.value = Math.max(this.value, Math.min(target, this.value + dt * 0.045));
    return this.value;
  }
}

const TIPS = [
  'Villagers remember what you do, and tell each other about it.',
  'Keep right and stop at red lights: the road cameras write tickets.',
  'Rise into the Planner to build; the village grows on its own around what you place.',
  'The last bus and the last train leave at 23:30. Flights run round the clock.',
  'Hire a mountain bike at the foot of the peak and ride the trail to the summit.',
  'Every December the great tree comes to the square on a flatbed, with a police escort.',
  'The phone’s Jobs app has shifts to work: firefighter, cabbie, pilot, reporter…',
  'Mind the traffic on foot: a car that hits you hurts, and a bus hurts more.',
];

export class LoadingScreen {
  private readonly progress = new LoadingProgress(performance.now());
  private readonly text: HTMLElement;
  private readonly percent: HTMLElement;
  private readonly track: HTMLElement;
  private readonly segments: HTMLElement[];
  private readonly tipText: HTMLElement;
  private tip = -1;
  private tipTimer = 0;
  private tipSwap = 0;
  private raf = 0;
  private stopped = false;
  private onComplete: (() => void) | null = null;
  ready = false;

  constructor(private readonly root: HTMLElement) {
    this.text = root.querySelector<HTMLElement>('#loading-text')!;
    this.percent = root.querySelector<HTMLElement>('#loading-pct')!;
    this.track = root.querySelector<HTMLElement>('#loading-track')!;
    this.segments = Array.from(this.track.children) as HTMLElement[];
    this.tipText = root.querySelector<HTMLElement>('#loading-tip')!;
    this.track.style.gridTemplateColumns = SEGMENT_ENDS.map((end, i) => `${end - (SEGMENT_ENDS[i - 1] ?? 0)}fr`).join(' ');

    const art = root.querySelector<HTMLImageElement>('.ld-art')!;
    const showArt = () => root.classList.add(art.naturalWidth ? 'has-art' : 'no-art');
    if (art.complete) showArt();
    else {
      art.addEventListener('load', showArt, { once: true });
      art.addEventListener('error', showArt, { once: true });
    }
  }

  enter(phase: Phase, message: string): void {
    if (this.stopped) return;
    performance.mark(`boot:${message}`);
    this.progress.enter(phase, performance.now());
    this.text.textContent = message;
    this.segments.forEach((segment, i) => segment.classList.toggle('on', i === PHASES[phase].segment));
    this.startTips();
    this.schedulePaint();
  }

  buildings(done: number, total: number): void {
    if (this.stopped) return;
    this.progress.report(done, total);
    this.text.textContent = `Raising the buildings… ${done} of ${total}`;
  }

  pause(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.stopTips();
  }

  stop(): void {
    this.stopped = true;
    this.pause();
    this.segments.forEach((segment) => segment.classList.remove('on'));
  }

  fail(): void {
    this.stop();
    this.text.textContent = 'Loading stopped';
    this.root.classList.add('failed');
    this.root.querySelector<HTMLButtonElement>('#ld-reload')?.focus();
  }

  /** Called only after a successful draw to the landing canvas. */
  complete(onComplete: () => void): void {
    if (this.stopped || this.onComplete || this.ready) return;
    const reduced = document.body.classList.contains('calm') || matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.onComplete = onComplete;
    this.progress.complete(performance.now(), reduced ? 0 : 300);
    this.stopTips();
    this.schedulePaint();
  }

  private schedulePaint(): void {
    if (!this.raf) this.raf = requestAnimationFrame(this.paint);
  }

  private paint = (now: number): void => {
    this.raf = 0;
    const value = this.progress.paint(now);
    const percent = String(Math.floor(value));
    if (this.percent.textContent !== percent) {
      this.percent.textContent = percent;
      this.track.setAttribute('aria-valuenow', percent);
    }
    this.segments.forEach((segment, i) => {
      const start = SEGMENT_ENDS[i - 1] ?? 0, end = SEGMENT_ENDS[i];
      const fill = Math.max(0, Math.min(1, (value - start) / (end - start)));
      const scale = fill.toFixed(3);
      if (segment.style.getPropertyValue('--f') !== scale) segment.style.setProperty('--f', scale);
      segment.classList.toggle('done', fill === 1);
    });
    if (value < 100) {
      this.schedulePaint();
      return;
    }
    performance.mark('boot:Ready');
    this.text.textContent = 'Ready';
    this.segments.forEach((segment) => segment.classList.remove('on'));
    this.ready = true;
    this.root.classList.add('finished');
    const done = this.onComplete;
    this.onComplete = null;
    done?.();
    // Transition events can be skipped in reduced motion or when a tab goes hidden.
    const fallback = window.setTimeout(() => this.root.remove(), 850);
    this.root.addEventListener('transitionend', (event) => {
      if (event.target === this.root && event.propertyName === 'opacity') {
        clearTimeout(fallback);
        this.root.remove();
      }
    });
  };

  private startTips(): void {
    if (this.tipTimer) return;
    if (this.tip < 0) this.tip = Math.floor(Math.random() * TIPS.length);
    this.tipText.textContent = TIPS[this.tip];
    this.tipTimer = window.setInterval(() => {
      this.tipText.classList.add('out');
      this.tipSwap = window.setTimeout(() => {
        this.tip = (this.tip + 1) % TIPS.length;
        this.tipText.textContent = TIPS[this.tip];
        this.tipText.classList.remove('out');
      }, 400);
    }, 5200);
  }

  private stopTips(): void {
    clearInterval(this.tipTimer);
    clearTimeout(this.tipSwap);
    this.tipTimer = 0;
    this.tipText.classList.remove('out');
  }
}

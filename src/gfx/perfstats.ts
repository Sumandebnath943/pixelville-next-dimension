/* ============================================================
   V2: what the frames cost, for the auto quality's timing and
   the performance report: the last ten seconds or so of frames
   (the gap between them, the game's own work, the graphics card's
   time where the browser can measure it, the draw calls), kept in
   a ring so nothing is made per frame.
   ============================================================ */

const N = 600;

export const PerfStats = {
  gap: new Float32Array(N),
  cpu: new Float32Array(N),
  gpu: new Float32Array(N).fill(-1),
  draws: new Float32Array(N),
  tris: new Float32Array(N),
  playing: new Uint8Array(N),
  i: 0,
  n: 0,
  last: 0,

  /** a frame: when it started (ms), the game's own work in it (ms), the graphics card's latest timing (ms, -1: none) */
  record(now: number, cpuMs: number, playing: boolean, gpuMs: number, draws: number, tris: number): void {
    const gap = this.last ? now - this.last : 0;
    this.last = now;
    if (gap <= 0 || gap > 1000) return; // (a hidden tab or a stall on purpose: not a frame of play)
    const i = this.i;
    this.gap[i] = gap; this.cpu[i] = cpuMs; this.gpu[i] = gpuMs; this.draws[i] = draws; this.tris[i] = tris;
    this.playing[i] = playing ? 1 : 0;
    this.i = (i + 1) % N;
    this.n = Math.min(N, this.n + 1);
  },

  /** the frames of play kept (oldest first), as plain arrays */
  take(): { gap: number[]; cpu: number[]; gpu: number[]; draws: number[]; tris: number[] } {
    const o = { gap: [] as number[], cpu: [] as number[], gpu: [] as number[], draws: [] as number[], tris: [] as number[] };
    for (let k = 0; k < this.n; k++) {
      const j = (this.i - this.n + k + N) % N;
      if (!this.playing[j]) continue;
      o.gap.push(this.gap[j]); o.cpu.push(this.cpu[j]); o.draws.push(this.draws[j]); o.tris.push(this.tris[j]);
      if (this.gpu[j] >= 0) o.gpu.push(this.gpu[j]);
    }
    return o;
  },
};

/** the graphics card's own time for a frame (EXT_disjoint_timer_query_webgl2), where the browser offers it. Results
 *  arrive a frame or two later; `ms` is the latest (-1 until one has) */
export class GpuTimer {
  private ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  ms = -1;

  constructor(private gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  }
  get available(): boolean { return !!this.ext; }

  begin(): void {
    if (!this.ext || this.active || this.pending.length > 4) return;
    const q = this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }
  end(): void {
    if (!this.ext || !this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
    this.poll();
  }
  private poll(): void {
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext!.GPU_DISJOINT_EXT);
    while (this.pending.length) {
      const q = this.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      this.pending.shift();
      if (!disjoint) this.ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
      gl.deleteQuery(q);
    }
  }
}

/* ============================================================
   V2: the performance report (Settings → Graphics → Copy report):
   plain text a player can paste into a message, with what a
   slow game needs looked at: the graphics card, the screen and
   the size the game draws at, the preset and where it came from,
   and what the last stretch of play cost (frame times, the
   game's own work, the graphics card's time, draw calls).
   ============================================================ */
import { median, pct, type AutoRecord } from '../gfx/autoquality';
import { PerfStats } from '../gfx/perfstats';

export interface ReportInput {
  gpu: string;
  software: boolean;
  gpuTimer: boolean;
  quality: string;
  source: 'chosen' | 'auto-timed' | 'auto-guessed' | 'after-reset';
  auto: AutoRecord | null;
  resSetting: unknown;
  resScale: number;
  fpsCap: number;
  meter: string;
  canvas: [number, number];
  where: string;
  buildings: number;
  people: number;
  textures: number;
  geometries: number;
}

const SOURCE = {
  'chosen': 'chosen in Settings',
  'auto-timed': 'Auto, from timing play on this computer and screen',
  'auto-guessed': 'Auto, guessed from the graphics card (not timed yet)',
  'after-reset': 'one lighter for this load, after the graphics card reset',
};
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const ms = (v: number): string => (v < 0 ? '–' : `${v.toFixed(1)} ms`);

export function buildReport(d: ReportInput): string {
  const f = PerfStats.take();
  const dpr = globalThis.devicePixelRatio || 1;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  const L: string[] = [];
  L.push('PixelVille — Next Dimension · performance report');
  L.push(`When: ${new Date().toLocaleString()} · build ${__BUILD__}`);
  L.push(`Where: ${d.where}`);
  L.push('');
  L.push('GRAPHICS CARD');
  L.push(`  ${d.gpu || 'unknown (no WebGL2)'}`);
  L.push(`  Drawing without the card (software): ${d.software ? 'YES: turn on hardware acceleration in the browser' : 'no'}`);
  L.push(`  Card's own time measurable here: ${d.gpuTimer ? 'yes' : 'no'}`);
  L.push('');
  L.push('SCREEN');
  L.push(`  Window ${innerWidth} × ${innerHeight}, scale ${dpr}; monitor ${Math.round(screen.width * dpr)} × ${Math.round(screen.height * dpr)}`);
  L.push(`  The game draws at ${d.canvas[0]} × ${d.canvas[1]} (${Math.round(d.resScale * 100)}% resolution)`);
  L.push('');
  L.push('SETTINGS');
  L.push(`  Quality: ${cap(d.quality)} (${SOURCE[d.source]})`);
  if (d.auto?.last) {
    const a = d.auto.last;
    L.push(`  Auto timing: ${cap(a.q)} ran at a median ${ms(a.frame)} a frame (slowest 5%: ${ms(a.p95)}; card ${ms(a.gpu)}) → opens with ${cap(d.auto.pick)}`);
  }
  if (d.auto && (d.auto.ok.length || d.auto.slow.length)) L.push(`  Kept: ${d.auto.ok.map(cap).join(', ') || '–'} · too slow: ${d.auto.slow.map(cap).join(', ') || '–'}`);
  L.push(`  Resolution: ${d.resSetting === 'auto' || d.resSetting === undefined ? 'Auto' : `${Math.round(Number(d.resSetting) * 100)}%`} · frame-rate cap: ${d.fpsCap ? `${d.fpsCap} fps` : 'none'} · counter: ${d.meter}`);
  L.push('');
  L.push(`THE LAST STRETCH OF PLAY (${f.gap.length} frames)`);
  if (f.gap.length < 30) L.push('  Not enough play yet: play for half a minute, then copy the report again.');
  else {
    const med = median(f.gap);
    L.push(`  Frames a second: ${Math.round(1000 / med)} (median frame ${ms(med)}; slowest 5%: ${ms(pct(f.gap, 0.95))}; slowest: ${ms(Math.max(...f.gap))}; over 50 ms: ${f.gap.filter((g) => g > 50).length})`);
    L.push(`  The game's own work: median ${ms(median(f.cpu))} a frame (slowest 5%: ${ms(pct(f.cpu, 0.95))})`);
    L.push(`  The graphics card: ${f.gpu.length ? `median ${ms(median(f.gpu))} a frame (slowest 5%: ${ms(pct(f.gpu, 0.95))})` : 'not measurable in this browser'}`);
    L.push(`  Draw calls: ${Math.round(median(f.draws)).toLocaleString()} a frame · triangles: ${(median(f.tris) / 1e6).toFixed(2)} million`);
  }
  L.push('');
  L.push('MEMORY AND VILLAGE');
  L.push(`  ${mem ? `Script memory ${Math.round(mem.usedJSHeapSize / 1e6)} MB · ` : ''}textures ${d.textures} · meshes ${d.geometries}`);
  L.push(`  ${d.buildings} building${d.buildings === 1 ? '' : 's'} · ${d.people} villager${d.people === 1 ? '' : 's'}`);
  L.push('');
  L.push('BROWSER');
  L.push(`  ${navigator.userAgent}`);
  L.push(`  ${navigator.hardwareConcurrency || '?'} processor threads${nav.deviceMemory ? ` · ${nav.deviceMemory} GB memory or more` : ''}`);
  return L.join('\n');
}

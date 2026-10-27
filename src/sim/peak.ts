/* ============================================================
   The Peak (V2, Milestone 8): a real mountain to climb. A
   massif 44 tiles across and about 125 m high, with ridges, a
   pointed summit, forest on its lower slopes and a switchback
   trail from a trailhead at its foot (the side facing the
   village) to a cairn on top, kept to an easy gradient so it
   can be walked or ridden on a mountain bike. Villagers hike
   and cycle it; the Founder can too. Pure shape and trail maths,
   shared by the sim, the terrain and the Founder. Metres.
   V2: the massif is rugged (ridges and gullies running down
   from the summit, crags and ledges up high, broken ground
   everywhere), and the trail is a smooth winding path cut into
   the slope as a level bench: a cut bank above it, the spoil
   below, its curves rounded at the hairpins.
   ============================================================ */
const TM = 8;
/** the footprint's radius, in tiles */
export const PEAK_R = 22;
export interface Peak { x: number; y: number; h?: number; seed?: number }

const centre = (pk: Peak): [number, number] => [(pk.x + 0.5) * TM, (pk.y + 0.5) * TM];

/** the mountain's broad shape (m), 0 beyond its foot: what the trail is laid out on */
function baseHeight(pk: Peak, x: number, z: number): number {
  const [cx, cz] = centre(pk), R = PEAK_R * TM, H = pk.h || 125, s = ((pk.seed ?? 7) % 97) * 0.13;
  const dx = x - cx, dz = z - cz, r = Math.hypot(dx, dz);
  if (r >= R) return 0;
  const a = Math.atan2(dz, dx), u = r / R;
  // ridges run down from the summit: the mountain reaches further out along them
  const ridge = 0.1 * Math.sin(a * 3 + s) + 0.06 * Math.sin(a * 5 + s * 2.3) + 0.035 * Math.sin(a * 11 + s * 0.7);
  const v = u / (1 + ridge * (0.25 + 0.75 * u));
  if (v >= 1) return 0;
  // (a rounded summit you can stand on: within 8% of the top the slope eases off to level)
  if (v < 0.08) return H * (0.932 - 10.05 * v * v);
  return H * Math.pow(1 - v, 1.7);
}

/** V2: the broad shape eased down to the level over the last tenth of the way to the foot (along a ridge it ended in
 *  a step of several metres where the footprint's circle cut it off) */
function footBase(pk: Peak, x: number, z: number): number {
  const b = baseHeight(pk, x, z);
  if (b <= 0) return 0;
  const [cx, cz] = centre(pk), R = PEAK_R * TM;
  return b * smooth(Math.min(1, (R - Math.hypot(x - cx, z - cz)) / (0.1 * R)));
}

/* ---------- V2: the rugged detail ---------- */
function hash(ix: number, iy: number, s: number): number {
  let h = (Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function noise(x: number, y: number, s: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function fbm(x: number, y: number, oct: number, s: number): number {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { sum += amp * noise(x * f, y * f, s + i * 17); norm += amp; amp *= 0.5; f *= 2.03; }
  return sum / norm;
}
/** ridges and gullies, crags and ledges and broken ground, on top of the broad shape (m) */
function detail(pk: Peak, x: number, z: number, base: number): number {
  const [cx, cz] = centre(pk), R = PEAK_R * TM, H = pk.h || 125, sd = (pk.seed ?? 7) % 9973;
  const dx = x - cx, dz = z - cz, r = Math.hypot(dx, dz), u = r / R;
  if (u >= 1 || base <= 0) return 0;
  const a = Math.atan2(dz, dx), f = base / H;
  // spurs and gullies running down from the summit, bent as they go (sharp crests, rounded hollows)
  const warp = (fbm(x / 70, z / 70, 2, sd + 3) - 0.5) * 3;
  const crest = 1 - Math.abs(Math.sin(a * 3.5 + warp + sd));
  const spurs = (crest * crest - 0.38) * H * 0.11 * Math.min(1, u / 0.22) * (1 - Math.pow(u, 5));
  // crags: the upper slopes break into ledges and short cliffs
  // (going up each band: first a ledge that climbs gently, then a short cliff back up to the slope)
  const t = f * 9 + (fbm(x / 45, z / 45, 2, sd + 7) - 0.5) * 1.6, fr = t - Math.floor(t);
  const step = -(fr - smooth(Math.max(0, (fr - 0.6) / 0.4))) * (H / 9) * 0.5 * Math.max(0, Math.min(1, (f - 0.22) * 3));
  // broken ground: boulders, hummocks and hollows (more of it higher up, where it's bare rock)
  const rough = (fbm(x / 16, z / 16, 3, sd + 11) - 0.5) * (1.6 + f * 6);
  // nothing at the very foot, where it meets the level
  const foot = Math.min(1, base / 6);
  return (spurs + step + rough) * foot;
}

/* ---------- V2: the trail, laid out once, and the bench it runs on ---------- */
interface Trail { pts: number[][]; hts: number[]; cells: Map<number, number[]> }
const TRAILS = new Map<string, Trail>();
/** how far either side of the trail's middle its bench is level, and where it has eased back into the slope (m) */
const BENCH_IN = 2.6, BENCH_OUT = 6.5, CELL = 4;
const cellKey = (i: number, j: number): number => (i + 4096) * 8192 + (j + 4096);

function trail(pk: Peak): Trail {
  const key = `${pk.x},${pk.y},${pk.h},${pk.seed}`;
  const hit = TRAILS.get(key);
  if (hit) return hit;
  const [cx, cz] = centre(pk), R = PEAK_R * TM, a0 = bearing(pk);
  // laid out on the broad shape: every step takes the way that climbs nearest one in six (round the ridges, too), so
  // on the steep upper slopes it zigzags in switchbacks, sweeping either side of the line it set out on
  let pts: number[][] = [];
  let r = R * 0.985, a = a0, side = 1;
  pts.push([cx + Math.cos(a) * (R + 6), cz + Math.sin(a) * (R + 6)]);
  const at = (rr: number, aa: number): number => baseHeight(pk, cx + Math.cos(aa) * rr, cz + Math.sin(aa) * rr);
  for (let i = 0; i < 900 && r > 5; i++) {
    pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    const step = 4.5, h0 = at(r, a);
    let best: [number, number] | null = null, bestErr = Infinity;
    for (let k = 0; k <= 12; k++) {
      const inward = k / 12, nr = r - step * inward, na = a + ((step * Math.sqrt(1 - inward * inward)) / Math.max(6, r)) * side;
      const g = (at(nr, na) - h0) / step;
      const err = g < 0.02 ? 1 + (0.02 - g) : Math.abs(g - 0.16) + (g > 0.24 ? 1 : 0);
      if (err < bestErr - 1e-6) { bestErr = err; best = [nr, na]; }
    }
    [r, a] = best!;
    if ((a - a0) * side > 0.55) side = -side;
  }
  pts.push([cx, cz]);
  // V2: rounded into curves (the hairpins too), then a point every 2 m
  for (let it = 0; it < 3; it++) {
    const out = [pts[0]];
    for (let k = 0; k < pts.length - 1; k++) {
      const p = pts[k], q = pts[k + 1];
      if (k > 0) out.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25]);
      if (k < pts.length - 2) out.push([p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75]);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  const even: number[][] = [pts[0]];
  let carry = 0;
  for (let k = 0; k < pts.length - 1; k++) {
    const p = pts[k], q = pts[k + 1], L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    let d = 2 - carry;
    while (d <= L) { even.push([p[0] + ((q[0] - p[0]) * d) / L, p[1] + ((q[1] - p[1]) * d) / L]); d += 2; }
    carry = L - (d - 2);
  }
  even.push(pts[pts.length - 1]);
  // the bench's level along the way: the broad slope's, evened out (twice, over about 40 m) so the path never humps
  // or dips, and the climb round a hairpin, whose rounded corner cuts across the slope, is spread along the legs
  // either side instead of all taken on the bend
  const raw = even.map(([x, z]) => footBase(pk, x, z));
  let hts = raw;
  for (let pass = 0; pass < 3; pass++) {
    const src = hts;
    hts = src.map((_, i) => {
      let s = 0, w = 0;
      for (let k = -10; k <= 10; k++) { const j = Math.max(0, Math.min(src.length - 1, i + k)); const wk = 11 - Math.abs(k); s += src[j] * wk; w += wk; }
      return s / w;
    });
  }
  // (from the level at the trailhead: the first few metres run up a low embankment onto the mountain, as steep as the
  // rest and no steeper, where its foot rises sharply)
  hts = hts.map((h, i) => h * smooth(Math.min(1, i / 6)));
  // (and nowhere steeper than about one in three and a half: where a rounded hairpin still climbs harder than that, the
  // way up to it is raised a little to take some of the climb, as a built-up path would)
  for (let i = hts.length - 2; i >= 0; i--) {
    const run = Math.hypot(even[i + 1][0] - even[i][0], even[i + 1][1] - even[i][1]);
    hts[i] = Math.max(hts[i], hts[i + 1] - 0.28 * run);
  }
  // which stretches of it are near each patch of ground (for the bench)
  const cells = new Map<number, number[]>();
  for (let i = 0; i < even.length - 1; i++) {
    const [ax, az] = even[i], [bx, bz] = even[i + 1];
    const i0 = Math.floor((Math.min(ax, bx) - BENCH_OUT) / CELL), i1 = Math.floor((Math.max(ax, bx) + BENCH_OUT) / CELL);
    const j0 = Math.floor((Math.min(az, bz) - BENCH_OUT) / CELL), j1 = Math.floor((Math.max(az, bz) + BENCH_OUT) / CELL);
    for (let ii = i0; ii <= i1; ii++)
      for (let jj = j0; jj <= j1; jj++) {
        const k = cellKey(ii, jj);
        let l = cells.get(k);
        if (!l) cells.set(k, (l = []));
        l.push(i);
      }
  }
  const t: Trail = { pts: even, hts, cells };
  TRAILS.set(key, t);
  return t;
}

/** the mountain's height (m) at a point, 0 beyond its foot (V2: rugged, with the trail's bench cut into it) */
export function peakHeight(pk: Peak, x: number, z: number): number {
  const base = footBase(pk, x, z);
  const raw = base > 0 ? Math.max(0, base + detail(pk, x, z, base)) : 0;
  const tr = trail(pk), list = tr.cells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (!list) return raw;
  // the bench: level across the trail (and a hand's breadth under its surface), easing back into the slope either
  // side; on the bench itself only its own leg counts, and where two legs of a switchback run close the ground between
  // them is shared between their levels
  let sw = 0, sh = 0, top = 0, dn = Infinity, hn = 0;
  for (const i of list) {
    const [ax, az] = tr.pts[i], [bx, bz] = tr.pts[i + 1];
    const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
    const d = Math.hypot(x - ax - ex * t, z - az - ez * t);
    if (d >= BENCH_OUT) continue;
    const h = tr.hts[i] + (tr.hts[i + 1] - tr.hts[i]) * t - 0.04;
    if (d < dn) { dn = d; hn = h; }
    const k = d <= BENCH_IN ? 1 : 1 - smooth((d - BENCH_IN) / (BENCH_OUT - BENCH_IN));
    const wk = (k * k * k * k) / (0.02 + Math.max(0, d - BENCH_IN));
    sw += wk; sh += wk * h;
    if (k > top) top = k;
  }
  if (dn <= BENCH_IN) return hn;
  return sw > 0 ? raw + (sh / sw - raw) * top : raw;
}
const smooth = (t: number): number => t * t * (3 - 2 * t);

/** which way the trail sets out from (towards the middle of the map, where the village is) */
function bearing(pk: Peak): number {
  const [cx, cz] = centre(pk);
  return Math.atan2(128 * TM - cz, 128 * TM - cx);
}

/**
 * The trail, as points (metres, about 2 m apart) from the trailhead at the foot to the summit: it climbs at about one
 * in six, in switchbacks on the steep upper slopes, its bends rounded.
 */
export function peakTrail(pk: Peak): number[][] {
  return trail(pk).pts;
}
/** V2: the level of the trail's bench at each of its points (m) */
export function peakTrailHeights(pk: Peak): number[] {
  return trail(pk).hts;
}

/** the trailhead (the sign and the bike hire), facing up the trail */
export function trailhead(pk: Peak): { x: number; z: number; yaw: number } {
  const t = peakTrail(pk), [x, z] = t[0], [x2, z2] = t[Math.min(t.length - 1, 3)];
  return { x, z, yaw: Math.atan2(x2 - x, z2 - z) };
}

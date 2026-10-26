/* ============================================================
   The Peak (V2, Milestone 8): a real mountain to climb. A
   massif 44 tiles across and about 125 m high, with ridges, a
   pointed summit, forest on its lower slopes and a switchback
   trail from a trailhead at its foot (the side facing the
   village) to a cairn on top, kept to an easy gradient so it
   can be walked or ridden on a mountain bike. Villagers hike
   and cycle it; the Founder can too. Pure shape and trail maths,
   shared by the sim, the terrain and the Founder. Metres.
   ============================================================ */
const TM = 8;
/** the footprint's radius, in tiles */
export const PEAK_R = 22;
export interface Peak { x: number; y: number; h?: number; seed?: number }

const centre = (pk: Peak): [number, number] => [(pk.x + 0.5) * TM, (pk.y + 0.5) * TM];

/** the mountain's height (m) at a point, 0 beyond its foot */
export function peakHeight(pk: Peak, x: number, z: number): number {
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

/** which way the trail sets out from (towards the middle of the map, where the village is) */
function bearing(pk: Peak): number {
  const [cx, cz] = centre(pk);
  return Math.atan2(128 * TM - cz, 128 * TM - cx);
}

const TRAILS = new Map<string, number[][]>();
/**
 * The trail, as points (metres) from the trailhead at the foot to the summit: every step takes the way that
 * climbs nearest one in six (round the ridges, too), so on the steep upper slopes it zigzags in switchbacks,
 * sweeping either side of the line it set out on.
 */
export function peakTrail(pk: Peak): number[][] {
  const key = `${pk.x},${pk.y},${pk.h},${pk.seed}`;
  const hit = TRAILS.get(key);
  if (hit) return hit;
  const [cx, cz] = centre(pk), R = PEAK_R * TM, a0 = bearing(pk);
  const pts: number[][] = [];
  let r = R * 0.985, a = a0, side = 1;
  pts.push([cx + Math.cos(a) * (R + 6), cz + Math.sin(a) * (R + 6)]);
  const at = (rr: number, aa: number): number => peakHeight(pk, cx + Math.cos(aa) * rr, cz + Math.sin(aa) * rr);
  for (let i = 0; i < 900 && r > 5; i++) {
    pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    // the next step: of the ways that climb, the one nearest a one-in-six gradient (round the ridges, too)
    const step = 4.5, h0 = at(r, a);
    let best: [number, number] | null = null, bestErr = Infinity;
    for (let k = 0; k <= 12; k++) {
      const inward = k / 12, nr = r - step * inward, na = a + ((step * Math.sqrt(1 - inward * inward)) / Math.max(6, r)) * side;
      const g = (at(nr, na) - h0) / step;
      const err = g < 0.02 ? 1 + (0.02 - g) : Math.abs(g - 0.16) + (g > 0.24 ? 1 : 0);
      if (err < bestErr - 1e-6) { bestErr = err; best = [nr, na]; }
    }
    [r, a] = best!;
    // a switchback where the leg has swung far enough off the line
    if ((a - a0) * side > 0.55) side = -side;
  }
  pts.push([cx, cz]);
  TRAILS.set(key, pts);
  return pts;
}

/** the trailhead (the sign and the bike hire), facing up the trail */
export function trailhead(pk: Peak): { x: number; z: number; yaw: number } {
  const t = peakTrail(pk), [x, z] = t[0], [x2, z2] = t[2];
  return { x, z, yaw: Math.atan2(x2 - x, z2 - z) };
}

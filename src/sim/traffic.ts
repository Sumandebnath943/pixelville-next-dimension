/* ============================================================
   Traffic (V2): road users that keep their distance, give way
   and stop for people. Every vehicle in the sim drives a tile
   path; before it moves, it looks along the stretch it is about
   to drive and finds the first thing in its lane: the vehicle in
   front, someone on the carriageway, a red light or lowered
   level-crossing gates, or a junction that crossing traffic
   already holds. Its speed then follows from the distance it
   needs to stop there, so queues form, close up and pull away
   smoothly at any game speed.
   The Founder is a road user too (the client reports where they
   are): drivers queue behind the Founder's car, stop for the
   Founder on foot, and honk when held up. Something stopped in
   the lane for a while (a parked car, a bus at its stop, a wreck)
   is overtaken through the oncoming lane when that is clear.
   Units: tiles and sim seconds. Positions are V1 pixels (T = 16
   per tile, tile centres at +8), lanes 2.7 px right of centre.
   V2 (Milestone 8): drivers also slow for the bends ahead, which
   they take on arcs in their lane (lanePose).
   V2: nothing drives through anything. A junction is a box: a
   driver goes in only once the way across is theirs (every tile
   of the box at once, so a car never stops halfway across an
   avenue) and there is room on the far side, so the box never
   jams; drivers kept waiting go first. Other road users are as
   long and as wide as they are, at whatever angle they stand.
   Passing something parked happens only on a clear straight
   with a gap to pull back into; ambulances, fire engines and
   squad cars on a call drive in the traffic too, on blue lights.
   ============================================================ */
import { World } from './world';

const T = 16;
const LANE = 2.7 / T;      // lane centre, right of the road's centreline (V2 (Milestone 8): 1.35 m, was 1.75 m: cars hung over the kerb)
const CAR_LEN = 0.56;      // ~4.5 m
const GAP = 0.3;           // ~2.4 m bumper to bumper in a queue
const ACC = 0.35;          // pulling away (~2.8 m/s²)
const DEC = 0.45;          // planned braking (~3.6 m/s²)
const DEC_MAX = 1.1;       // as hard as it gets
const LOOK = 5.2;          // how far ahead a driver looks (> stopping distance at town speed; V2: and past a junction to the far side)
const HALF_W = 0.115;      // V2: half a car's width (~0.9 m)
const ON_ROAD = 0.29;      // closer than this to the centreline, a pedestrian is on the carriageway
const PRIO_AFTER = 2.5;    // V2: seconds held at a junction before crossing traffic lets that driver go first
const PASS_AFTER = 1.5;    // seconds stuck behind something stopped before pulling out to pass
const RELAX_AFTER = 20;    // V2: seconds stuck behind something parked before passing it on a shorter view of the road ahead
const HONK_AFTER = 2;      // seconds held up by the Founder before the horn
const SWERVE = 0.35;       // how fast a car moves across the road (tiles/s, at walking pace)
/** V2: half the width of a vehicle `len` tiles long (tiles) */
const halfW = (len: number): number => (len >= 0.85 ? 0.15 : len < 0.4 ? 0.06 : HALF_W);

export { CAR_LEN, LANE };
/** V2 (Milestone 8): the lane centre in V1 pixels, right of the road's centreline (1.35 m: the carriageway
 *  between the kerbs is 5.2 m, so a 1.8 m car keeps clear of both the kerb and the oncoming lane) */
export const LANE_PX = LANE * T;
/** V2 (Milestone 8): the road's cross-section: a pavement this wide (metres) along every kerb that faces open
 *  ground, with a quarter-round kerb of the same radius at the inner corners of junctions and bends (so a car on
 *  its tight right-turn arc clears the kerb); people walk down the middle of it */
export const PAVEMENT_M = 1.4;
export const FOOT_PX = (4 - 0.55) * 2; // px from the centreline to where people walk: 0.55 m in from the pavement's outer edge, clear of the lamp posts at its kerb side

/* ---------- V2 (Milestone 8): where a vehicle is along its path ----------
   Paths are tile centres. On a straight a vehicle runs `lat` to the right of the centre
   line. Where the path turns, it follows a quarter circle in its lane from the edge of
   the corner tile it enters by to the edge it leaves by: a tight arc for a right turn
   (radius ½ tile − lat), a wide one for a left (½ tile + lat), as a driver would; at a
   dead end it swings round in a half circle. So nothing cuts a corner onto the
   pavement or across the oncoming lane, and the heading turns smoothly. */
export interface Pose { x: number; y: number; hx: number; hy: number; dx: number; dy: number }
const _pose: Pose = { x: 0, y: 0, hx: 1, hy: 0, dx: 1, dy: 0 };
/** step k of the path as travelled (dir −1 walks it backwards) */
const at = (path: number[][], k: number, dir: number): number[] | undefined => path[dir > 0 ? k : path.length - 1 - k];
/** the direction of travel into step k (or, failing that, out of it) */
function stepDir(path: number[][], k: number, dir: number, into: boolean): [number, number] {
  const n = path.length;
  for (let j = 0; j < n; j++) {
    const a = at(path, into ? k - 1 - j : k + j, dir), b = at(path, into ? k - j : k + 1 + j, dir);
    if (!a || !b) break;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    if (dx || dy) return [Math.sign(dx), Math.sign(dy)];
  }
  if (into) return stepDir(path, k, dir, false);
  return [1, 0];
}
/**
 * Position (V1 px) and heading `prog` steps along `path`, `lat` px right of the centreline,
 * driving towards the end (`dir` +1) or the start (−1). `dx, dy` is the axis of the stretch
 * it is on (the old meaning of dirx/diry); `hx, hy` the true heading through bends.
 */
export function lanePose(path: number[][], prog: number, lat: number, dir = 1, out: Pose = _pose): Pose {
  const n = path.length;
  const s = Math.max(0, Math.min(n - 1, dir > 0 ? prog : n - 1 - prog));
  const k = Math.round(s), u = s - k; // the tile we're in, and where in it (−½ … ½)
  const cur = at(path, k, dir)!;
  const [ax, ay] = stepDir(path, k, dir, true), [bx, by] = stepDir(path, k, dir, false);
  const L = lat / T;
  const cx = cur[0] + 0.5, cy = cur[1] + 0.5;
  const t = u + 0.5;
  if ((ax === bx && ay === by) || k === 0 || k === n - 1) {
    const [dx, dy] = u < 0 || k === n - 1 ? [ax, ay] : [bx, by];
    out.x = (cx + dx * u - dy * L) * T; out.y = (cy + dy * u + dx * L) * T;
    out.hx = dx; out.hy = dy; out.dx = dx; out.dy = dy;
    return out;
  }
  const n1x = -ay, n1y = ax, n2x = -by, n2y = bx; // right-hand normals (y runs south)
  if (ax === -bx && ay === -by) {
    // a dead end: up to the middle in our lane, then round in a half circle into the other
    if (t < 0.5) {
      out.x = (cx - ax * (0.5 - t) + n1x * L) * T; out.y = (cy - ay * (0.5 - t) + n1y * L) * T;
      out.hx = ax; out.hy = ay;
    } else {
      const a0 = Math.atan2(n1y, n1x), a = a0 + Math.PI * (t - 0.5) * 2 * -1; // sweeping left, through the far side
      out.x = (cx + Math.cos(a) * L) * T; out.y = (cy + Math.sin(a) * L) * T;
      out.hx = Math.sin(a); out.hy = -Math.cos(a);
    }
    out.dx = u < 0 ? ax : bx; out.dy = u < 0 ? ay : by;
    return out;
  }
  // a bend: the arc about the corner between the edge we came in by and the one we leave by
  const qx = cx - ax * 0.5 + bx * 0.5, qy = cy - ay * 0.5 + by * 0.5;
  const ex = cx - ax * 0.5 + n1x * L, ey = cy - ay * 0.5 + n1y * L;
  const xx = cx + bx * 0.5 + n2x * L, xy = cy + by * 0.5 + n2y * L;
  const r = Math.hypot(ex - qx, ey - qy);
  const a0 = Math.atan2(ey - qy, ex - qx);
  let da = Math.atan2(xy - qy, xx - qx) - a0;
  while (da > Math.PI) da -= Math.PI * 2;
  while (da < -Math.PI) da += Math.PI * 2;
  const a = a0 + da * t, sg = Math.sign(da) || 1;
  out.x = (qx + Math.cos(a) * r) * T; out.y = (qy + Math.sin(a) * r) * T;
  out.hx = -Math.sin(a) * sg; out.hy = Math.cos(a) * sg;
  out.dx = u < 0 ? ax : bx; out.dy = u < 0 ? ay : by;
  return out;
}
/** how a path turns at step k as travelled: 0 straight on, 1 right, −1 left, 2 back the way it came */
export function turnAt(path: number[][], k: number, dir: number): number {
  if (k <= 0 || k >= path.length - 1) return 0;
  const [ax, ay] = stepDir(path, k, dir, true), [bx, by] = stepDir(path, k, dir, false);
  if (ax === bx && ay === by) return 0;
  if (ax === -bx && ay === -by) return 2;
  return ax * by - ay * bx > 0 ? 1 : -1; // (y runs south: a positive cross product turns right)
}
/* ---------- V2 (Milestone 8): railway bends ----------
   A rail bend (two arms at right angles) is a curve, not a corner. Where straight track runs
   on from both arms, the curve sweeps through half of each neighbouring tile too (a radius
   of a whole tile for the middle track); otherwise it turns within its own tile. The three
   tracks of the mainline stay side by side through the curve (inner, middle, outer), so a
   train on one track is still on it after the bend. The terrain draws the same curves. */
const ARMS: [number, number, number][] = [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8]];
const armBit = (dx: number, dy: number): number => (dy < 0 ? 1 : dx > 0 ? 2 : dy > 0 ? 4 : 8);
/** the rail tile (x, y) as a bend: its two arms, and whether the curve may sweep through the neighbours */
export function railBend(x: number, y: number): { a: [number, number]; b: [number, number]; wide: boolean } | null {
  const m = World.railMask(x, y);
  const arms = ARMS.filter(([, , bit]) => m & bit);
  if (arms.length !== 2) return null;
  const [a, b] = arms;
  if (a[0] === -b[0] && a[1] === -b[1]) return null;
  // the neighbour along an arm carries straight on (or ends): it isn't a bend or a junction itself
  const runsOn = (dx: number, dy: number): boolean => {
    const mm = World.railMask(x + dx, y + dy), back = armBit(-dx, -dy), on = armBit(dx, dy);
    return (mm & back) !== 0 && (mm & ~(back | on)) === 0;
  };
  return { a: [a[0], a[1]], b: [b[0], b[1]], wide: runsOn(a[0], a[1]) && runsOn(b[0], b[1]) };
}
/** where a train is `prog` steps along a rail `path`, `lat` px right of the line (as the path runs: a train
 *  going back along it stays on the same track), round the bends on their curves */
export function railPose(path: number[][], prog: number, lat: number, out: Pose = _pose): Pose {
  const n = path.length, s = Math.max(0, Math.min(n - 1, prog)), k0 = Math.round(s);
  for (const kc of [k0, k0 - 1, k0 + 1]) {
    if (kc <= 0 || kc >= n - 1) continue;
    const turn = turnAt(path, kc, 1);
    if (turn !== 1 && turn !== -1) continue;
    const bend = railBend(path[kc][0], path[kc][1]);
    const R = bend?.wide ? 1 : 0.5;
    if (Math.abs(s - kc) > R) continue;
    const [ax, ay] = stepDir(path, kc, 1, true), [bx, by] = stepDir(path, kc, 1, false);
    const L = lat / T, cx = path[kc][0] + 0.5, cy = path[kc][1] + 0.5;
    const qx = cx - ax * R + bx * R, qy = cy - ay * R + by * R;
    const ex = cx - ax * R - ay * L, ey = cy - ay * R + ax * L;
    const xx = cx + bx * R - by * L, xy = cy + by * R + bx * L;
    const r = Math.hypot(ex - qx, ey - qy), a0 = Math.atan2(ey - qy, ex - qx);
    let da = Math.atan2(xy - qy, xx - qx) - a0;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    const t = (s - (kc - R)) / (2 * R), a = a0 + da * t, sg = Math.sign(da) || 1;
    out.x = (qx + Math.cos(a) * r) * T; out.y = (qy + Math.sin(a) * r) * T;
    out.hx = -Math.sin(a) * sg; out.hy = Math.cos(a) * sg;
    out.dx = t < 0.5 ? ax : bx; out.dy = t < 0.5 ? ay : by;
    return out;
  }
  return lanePose(path, s, lat, 1, out);
}

/** the speed (path steps a second) a turn is taken at: a right turn's tight arc is short, so the same
 *  step rate is already slow; a left's wide arc is long, so it's taken at fewer steps a second */
const TURN_V = { right: 0.95, left: 0.62, back: 0.35 };

/** one road user as seen by others this tick (x, y in tiles; dx, dy the axis of its stretch; V2: hx, hy its true
 *  heading, w its half width, v its speed in tiles/s (−1 unknown), pass: it is out in the other lane, overtaking) */
export interface Ob { o: unknown; x: number; y: number; dx: number; dy: number; hx: number; hy: number; car: boolean; len: number; w: number; v: number; still: boolean; wide: number; pass: boolean }
/** V2: an overtake under way: what we pulled out for (and their lengths), and how long it may take */
interface Over { o: unknown; os: unknown[]; lens: number[]; t: number }
/** V2: the junction box a vehicle holds: path steps k0…k1 (as travelled), each tile's key, the quarters it sweeps
 *  there and the headings it enters and leaves it by */
interface Run { path: number[][]; k0: number; k1: number; keys: number[]; m: number[]; d: number[]; x: number[] }
/** per-vehicle state kept on its trip object: speed, time stuck, the overtake under way, its lane, V2: the junction
 *  box it holds, and how long it has waited at one (since which tick) */
export interface Drive { v?: number; wait?: number; honk?: number; lat?: number; over?: Over | null; box?: Run | null; jw?: number; js?: number }
/** the Founder as the sim sees them: V1 pixels, a heading, at the wheel or on foot */
export interface Guest { x: number; y: number; dx: number; dy: number; car: boolean; still: boolean; len?: number }

/** stand for the Founder, and the Founder's car, in the index */
export const FOUNDER = { founder: true };
export const FOUNDER_CAR = { founder: true, car: true };
const isFounder = (o: unknown): boolean => o === FOUNDER || o === FOUNDER_CAR;
/** a stable order between road users, for two that start in exactly the same spot */
const ranks = new WeakMap<object, number>();
let nextRank = 1;
const rank = (o: unknown): number => {
  if (typeof o !== 'object' || !o) return 0;
  let r = ranks.get(o);
  if (!r) ranks.set(o, (r = nextRank++));
  return r;
};

const grid = new Map<number, Ob[]>();
/** the tiles holding anyone this tick (only these are cleared next tick) */
const filled: number[] = [];
const pool: Ob[] = [];
let used = 0;
/** V2: who holds a junction tile (and how they cross it: l, a long vehicle leaving by heading x), and who waits at its
 *  line (w: seconds waiting, since: the tick the wait began); entries nobody has refreshed lately lapse */
interface Claim { o: unknown; m: number; d: number; u: boolean; w: number; since: number; tick: number; l: boolean; x: number }
const claims = new Map<number, Claim[]>();
const asks = new Map<number, Claim[]>();
/** V2: the spots someone pulled out onto, and on which tick (two cars leaving at once don't take the same spot) */
const joins = new Map<number, number>();
/** V2 (Milestone 8): who has run into whom lately (so a hit counts once) */
const struck = new Map<string, number>();
let tick = 0;
let gateClosed: (tx: number, ty: number) => boolean = () => false;

function put(o: any, x: number, y: number, dx: number, dy: number, car: boolean, len: number, still = false, wide = 0, v = -1, pass = false): void {
  if (x === undefined || y === undefined || Number.isNaN(x)) return;
  const key = World.idx(Math.floor(x / T), Math.floor(y / T));
  const ob = pool[used] || (pool[used] = { o: null, x: 0, y: 0, dx: 0, dy: 0, hx: 1, hy: 0, car: false, len: 0, w: 0, v: -1, still: false, wide: 0, pass: false });
  used++;
  ob.o = o; ob.x = x / T; ob.y = y / T; ob.dx = dx || 0; ob.dy = dy || 0; ob.car = car; ob.len = len; ob.still = still; ob.wide = wide;
  // V2: the true heading through a bend, where the mover keeps one (the stretch's axis otherwise)
  let hx = typeof o?.hx === 'number' ? o.hx : ob.dx, hy = typeof o?.hy === 'number' ? o.hy : ob.dy;
  const hl = Math.hypot(hx, hy);
  if (hl > 1e-6) { hx /= hl; hy /= hl; } else { hx = 1; hy = 0; }
  ob.hx = hx; ob.hy = hy;
  ob.w = car ? halfW(len) : 0.04; ob.v = v; ob.pass = pass;
  let list = grid.get(key);
  if (!list) grid.set(key, (list = []));
  if (!list.length) filled.push(key);
  list.push(ob);
}

const DX4 = [0, 1, 0, -1], DY4 = [-1, 0, 1, 0]; // N E S W (y runs south)
const dirOf = (dx: number, dy: number): number => (dy < 0 ? 0 : dx > 0 ? 1 : dy > 0 ? 2 : 3);
const bits = (m: number): number => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
/** the arms of (x, y), as N E S W bits: on V1's two-tile avenues the twin row alongside isn't a side street (a
 *  neighbour only counts as an arm unless it and this tile both carry on in the same direction) */
function arms(x: number, y: number): number {
  const ew = (yy: number): boolean => World.isRoad(x - 1, yy) && World.isRoad(x + 1, yy);
  const ns = (xx: number): boolean => World.isRoad(xx, y - 1) && World.isRoad(xx, y + 1);
  let m = 0;
  if (World.isRoad(x, y - 1) && !(ew(y) && ew(y - 1))) m |= 1;
  if (World.isRoad(x + 1, y) && !(ns(x) && ns(x + 1))) m |= 2;
  if (World.isRoad(x, y + 1) && !(ew(y) && ew(y + 1))) m |= 4;
  if (World.isRoad(x - 1, y) && !(ns(x) && ns(x - 1))) m |= 8;
  return m;
}

/** Where roads meet from three or four sides. */
export function isJunction(x: number, y: number): boolean {
  if (World.signalOn(World.idx(x, y))) return false; // V2: dark lights make it an ordinary junction
  return bits(arms(x, y)) >= 3;
}

/* ---------- V2: junction boxes ----------
   The box is every tile of a junction: where three or four streets meet, a signalled crossing, a corner of two
   avenues crossing, and on a two-tile avenue the twin row across from any of those. A driver reserves all the tiles
   of the box ahead at once, each for the quarters of the tile its swept path covers, so movements that cross take
   turns while those that don't (straight on from either side, two right turns) share it. A plain bend is a box of
   its own tile only: a car turning one way and a truck turning the other would meet on their arcs, so they take
   turns there too, but a queue may stand on it (a diagonal road is a staircase of bends). */
/** the heart of a junction (1): three or more arms, a signalled crossing, or arms both ways with a twin row
 *  alongside (a corner of two avenues crossing); or a plain bend (2) */
function core(x: number, y: number): number {
  if (World.signals.has(World.idx(x, y))) return 1;
  const m = arms(x, y);
  if (bits(m) >= 3) return 1;
  if (!(m & 10) || !(m & 5)) return 0;
  for (let k = 0; k < 4; k++) if (!(m & (1 << k)) && World.isRoad(x + DX4[k], y + DY4[k])) return 1;
  return 2;
}
let boxStamp = -1, boxSigs = -1;
let boxMemo = new Int8Array(0), armsMemo = new Int8Array(0);
function fresh(): void {
  if (boxStamp !== World.roadStamp || boxSigs !== World.signals.size || boxMemo.length !== World.roadMap.length) {
    boxStamp = World.roadStamp; boxSigs = World.signals.size;
    boxMemo = new Int8Array(World.roadMap.length).fill(-1);
    armsMemo = new Int8Array(World.roadMap.length).fill(-1);
  }
}
/** V2: does the step from tile a to its neighbour b hop sideways from one row of an avenue to its twin? */
function twinStep(a: number[], b: number[]): boolean {
  fresh();
  const i = World.idx(a[0], a[1]);
  if (armsMemo[i] < 0) armsMemo[i] = arms(a[0], a[1]);
  return !(armsMemo[i] & (1 << dirOf(b[0] - a[0], b[1] - a[1])));
}
/** V2: what kind of box (x, y) is part of: 0 none, 1 a junction, 2 a plain bend */
function boxKind(x: number, y: number): number {
  if (!World.isRoad(x, y)) return 0;
  fresh();
  const i = World.idx(x, y);
  if (boxMemo[i] < 0) {
    let v = core(x, y);
    const m = arms(x, y);
    for (let k = 0; k < 4 && v !== 1; k++) if (!(m & (1 << k)) && World.isRoad(x + DX4[k], y + DY4[k]) && core(x + DX4[k], y + DY4[k]) === 1) v = 1;
    boxMemo[i] = v;
  }
  return boxMemo[i];
}
/** V2: is (x, y) a tile of a junction box (or a bend)? */
export function isBox(x: number, y: number): boolean {
  return boxKind(x, y) !== 0;
}
/** which quarters of a tile (bits NW 1, NE 2, SW 4, SE 8) a vehicle sweeps crossing it, entering heading `i` and
 *  leaving heading `o` (N E S W), in its lane and round its arc: [car, anything longer][i][o] */
const MASKS: number[][][] = [CAR_LEN, 1.0].map((len) => {
  const tab: number[][] = [];
  const pose: Pose = { x: 0, y: 0, hx: 1, hy: 0, dx: 1, dy: 0 };
  for (let i = 0; i < 4; i++) {
    tab.push([]);
    for (let o = 0; o < 4; o++) {
      const back = (o + 2) % 4 === i;
      const path = [[50 - DX4[i], 50 - DY4[i]], [50, 50], back ? [50 - DX4[i], 50 - DY4[i]] : [50 + DX4[o], 50 + DY4[o]]];
      let m = 0;
      for (let s = 0.5 - len / 2; s <= 1.5 + len / 2 + 1e-6; s += 0.04) {
        lanePose(path, s, LANE_PX, 1, pose);
        const hl = Math.hypot(pose.hx, pose.hy) || 1, fx = pose.hx / hl, fy = pose.hy / hl, w = halfW(len) + 0.02;
        for (const a of [-1, -0.5, 0, 0.5, 1])
          for (const b of [-1, 0, 1]) {
            const x = pose.x / T - 50.5 + (fx * a * len) / 2 - fy * b * w, y = pose.y / T - 50.5 + (fy * a * len) / 2 + fx * b * w;
            if (Math.abs(x) <= 0.5 && Math.abs(y) <= 0.5) m |= 1 << ((x >= 0 ? 1 : 0) + (y >= 0 ? 2 : 0));
          }
      }
      tab[i].push(m);
    }
  }
  return tab;
});
function mark(map: Map<number, Claim[]>, key: number, o: unknown, m: number, d: number, u: boolean, w: number, since: number, l = false, x = -1): void {
  let list = map.get(key);
  if (!list) map.set(key, (list = []));
  for (const c of list) if (c.o === o) { c.m = m; c.d = d; c.u = u; c.w = w; c.since = since; c.tick = tick; c.l = l; c.x = x; return; }
  list.push({ o, m, d, u, w, since, tick, l, x });
}
/** does a driver waiting at the line (`r`) go before `me` (waiting since `since`)? Blue lights first, then, once
 *  they've waited a while, whoever began waiting first (a strict order, so two drivers never both give way) */
const outranks = (r: Claim, me: unknown, u: boolean, since: number): boolean =>
  r.u !== u ? r.u : r.w > PRIO_AFTER && (r.since < since || (r.since === since && rank(r.o) < rank(me)));
const RUN = { keys: [] as number[], m: [] as number[], d: [] as number[], x: [] as number[] };

/** V2: the route for something that stops at the end to work there (a delivery, a repair, a fire, a call): if its
 *  last step only hops across to the far row of an avenue (the door's side), it stops on the near row instead, in
 *  line with the traffic, rather than standing sideways across the other carriageway. (Shared paths: a copy.) */
export function kerbside(path: number[][]): number[][] {
  const n = path.length;
  if (n < 3) return path;
  const a = path[n - 2], b = path[n - 1];
  if (arms(a[0], a[1]) & (1 << dirOf(b[0] - a[0], b[1] - a[1]))) return path;
  return path.slice(0, n - 1);
}

/** the stretches of path ahead of `prog`, each with its distance from us */
interface Seg { a: number[]; b: number[]; base: number; dx: number; dy: number; end: boolean }
function segmentsAhead(path: number[][], prog: number, dir: number, reach: number, out: Seg[], max = 8): Seg[] {
  out.length = 0;
  const m0 = dir > 0 ? Math.floor(prog) : Math.ceil(prog);
  for (let m = m0, n = 0; n < max; m += dir, n++) {
    const a = path[m], b = path[m + dir];
    if (!a || !b) break;
    const base = (m - prog) * dir;
    if (base > reach) break;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    if (!dx && !dy) continue;
    out.push({ a, b, base, dx, dy, end: !path[m + 2 * dir] });
  }
  return out;
}
const SEGS: Seg[] = [];
const PSEGS: Seg[] = [];
const SEEN = new Set<Ob>();
const PSEEN = new Set<Ob>();
const JOIN: Pose = { x: 0, y: 0, hx: 1, hy: 0, dx: 1, dy: 0 };

export const Traffic = {
  /** the Founder (and their parked car), as the client last reported them */
  guests: [] as Guest[],
  /** a driver held up by the Founder sounds the horn (the client plays it) */
  onHonk: null as ((who: any) => void) | null,

  /**
   * Index every road user where they stood after the last tick. `life` is the
   * Life module (buses, cabs, tourists, campaign cars, emergency services).
   */
  begin(people: any[], life: any): void {
    tick++;
    for (const k of filled) grid.get(k)!.length = 0;
    filled.length = 0;
    used = 0;
    gateClosed = (tx, ty) => life.trainNearTile(tx, ty, 5);
    // "still" marks what is parked on the road for a while (a bus at its stop, a squad car at a
    // scene, a wreck): traffic queues behind it, then passes it
    // (V2: with how fast each is going, and whether it is out in the other lane overtaking)
    for (const p of people) {
      if (p.state !== 'walk' || !p.trip) continue;
      const t = p.trip;
      if (t.joined === false) continue; // (still in the drive, waiting to pull out)
      if (t.car || t.taxi || t.moto) put(p, p.x, p.y, p.dirx, p.diry, true, t.moto ? 0.3 : CAR_LEN, (t.parkT || 0) > 0, 0, t.v ?? -1, !!t.over);
      else put(p, p.x, p.y, p.dirx, p.diry, false, 0);
    }
    // (V2: the emergency services keep their driving state apart, on `drv`)
    const dv = (u: any): Drive => u.drv ?? u;
    const car = (u: any, len: number, still: boolean): void => put(u, u.x, u.y, u.dirx, u.diry, true, len, still, 0, dv(u).v ?? -1, !!dv(u).over);
    for (const b of life.buses || []) if (!b.hidden) car(b, 1.3, b.pause > 0);
    for (const c of life.taxis || []) car(c, CAR_LEN, c.pause > 0);
    for (const t of life.tourists || []) if (t.phase !== 'visit') car(t, CAR_LEN, false);
    for (const c of life.campaignCars || []) car(c, CAR_LEN, false);
    for (const u of life.police || []) car(u, CAR_LEN, u.phase === 'scene');
    for (const u of life.fireTrucks || []) car(u, 1.1, u.phase === 'douse');
    // V2: ambulances at a scene, delivery trucks unloading and repair vans at work stand in the road
    for (const u of life.ambulances || []) car(u, 0.75, u.phase === 'treat');
    for (const u of life.trucks || []) car(u, 0.9, u.phase === 'drop');
    for (const u of life.crews || []) car(u, 0.7, u.phase === 'fix');
    if (life.crash) put(life.crash, life.crash.x, life.crash.y, 1, 0, true, 1.2, true);
    // V2 (Milestone 8): the Christmas tree on its flatbed, crawling through town: traffic waits behind it
    if (life.convoy) put(life.convoy, life.convoy.x, life.convoy.y, life.convoy.dirx, life.convoy.diry, true, 2.4, false);
    // the Founder's car sits anywhere across the road (V2: at its true heading, so only a small margin on top)
    for (const g of this.guests) put(g.car ? FOUNDER_CAR : FOUNDER, g.x, g.y, g.dx, g.dy, g.car, g.car ? g.len ?? CAR_LEN : 0, g.still, g.car ? 0.03 : 0);
    // claims and waits nobody has refreshed lately lapse
    for (const map of [claims, asks])
      for (const [k, list] of map) {
        let j = 0;
        for (const c of list) if (c.tick >= tick - 2) list[j++] = c;
        list.length = j;
        if (!j) map.delete(k);
      }
  },

  /**
   * How far along its path (in path steps, ≥ 0) a vehicle moves this tick.
   * It drives `path` from `prog` towards the end (`dir` +1) or the start (-1)
   * at up to `v0` tiles/s; `st` carries its speed and lane between ticks.
   */
  advance(me: unknown, st: Drive, path: number[][], prog: number, dir: number, v0: number, dt: number, len = CAR_LEN, urgent = false): number {
    if (dt <= 0 || !path || path.length < 2) return 0;
    const lat = st.lat ?? LANE;
    const ov = st.over || null;
    const half = len / 2, myW = halfW(len);
    const v = st.v || 0;
    // V2: the next junction box ahead: all the tiles of it we'll cross (a bend on its own), so that we look far
    // enough to see the room past it
    const n = path.length, s0 = dir > 0 ? prog : n - 1 - prog;
    const tail = Math.round(s0 - half - 0.02);
    let held = st.box && st.box.path === path && tail <= st.box.k1 ? st.box : null;
    let kb = -1, k1 = -1, hard = false;
    const findBox = (): void => {
      kb = -1;
      for (let k = Math.max(0, tail); k < n && k - s0 < LOOK; k++) {
        if (held && k <= held.k1) continue;
        const t = at(path, k, dir)!;
        if (isBox(t[0], t[1])) { kb = k; break; }
      }
      k1 = kb;
      if (kb < 0) return;
      const t0 = at(path, kb, dir)!;
      hard = boxKind(t0[0], t0[1]) === 1;
      if (hard) while (k1 + 1 < n && k1 + 1 - kb < 6) { const t = at(path, k1 + 1, dir)!; if (boxKind(t[0], t[1]) !== 1) break; k1++; }
    };
    findBox();
    const reach = kb >= 0 && hard ? Math.min(9, Math.max(LOOK, k1 + 1.5 - s0 + len + GAP)) : LOOK;
    let free = reach;
    let byTraffic = false, byStill = false, byFounder = false;
    let blocker: Ob | null = null;
    /** (V2: how fast the one in front is going our way, so a junction can see it will have moved on) */
    let ahead = 0;
    const segs = segmentsAhead(path, prog, dir, reach, SEGS, 12);
    const seen = SEEN;
    seen.clear();
    const hold = (f: number, traffic: boolean): void => {
      if (f < free) { free = f; byTraffic = traffic; byStill = false; byFounder = false; blocker = null; ahead = 0; }
    };
    const n0 = path.length;
    /** (V2: the first sideways hop between the rows of an avenue ahead: how far to it, and the room it needs) */
    let hop: { entry: number; room: number; b: number[]; d: number } | null = null;
    for (const { a, b, base, dx, dy, end } of segs) {
      const ax = a[0] + 0.5, ay = a[1] + 0.5;
      const nx = -dy, ny = dx; // right-hand normal (y runs south)
      const sideways = twinStep(a, b) && !isBox(b[0], b[1]);
      // everyone standing on or near this stretch (V2: on the last, as far as our nose will reach where we stop; on a
      // hop between the rows of an avenue, all across the far row)
      for (const [tx, ty] of [a, b]) {
        const list = grid.get(World.idx(tx, ty));
        if (!list) continue;
        for (const ob of list) {
          if (ob.o === me || seen.has(ob)) continue;
          const rx = ob.x - ax, ry = ob.y - ay;
          const along = rx * dx + ry * dy;
          if (along < -0.05 || along > (end || sideways ? 1.35 + half : 1.05)) continue;
          let s = base + along;
          const c = rx * nx + ry * ny; // across the road, + is our side
          const ha = ob.hx * dx + ob.hy * dy; // (its heading along ours)
          if (s <= 0.05) {
            // beside or behind us; but two cars started in the very same spot (friends leaving
            // together) would drive on as one: the later one in the index lets the other go first
            // (V2: decided the same way from both sides, however slightly one is ahead)
            const twin = ob.car && s > -0.05 && Math.abs(c - lat) < 0.1 && ha > 0.5;
            if (twin) { if (rank(me) < rank(ob.o)) continue; s = 0.05; }
            else if (s <= 0.02) continue;
          }
          if (ob.car) {
            // V2: how far its body reaches along our way and across it, at the angle it stands (a car crossing in
            // front fills our lane with its length; it used to count as a point)
            const ca = Math.abs(ha), cn = Math.abs(ob.hx * nx + ob.hy * ny);
            const ea = (ca * ob.len) / 2 + cn * ob.w, ec = (cn * ob.len) / 2 + ca * ob.w;
            if (Math.abs(c - lat) > myW + ec + 0.03 + ob.wide) continue;
            if (ov && ov.os.includes(ob.o)) continue; // what we're overtaking
            seen.add(ob);
            // (someone overtaking towards us in our lane: stop well short, so they have room to pull back in)
            const f = s - half - ea - GAP - (ob.pass && ha < -0.5 ? 0.8 : 0);
            if (f < free) { free = f; byTraffic = true; byStill = ob.still; byFounder = isFounder(ob.o); blocker = ob; ahead = ob.v > 0 ? ob.v * ha : 0; }
          } else {
            if (Math.abs(c) > ON_ROAD) continue;
            seen.add(ob);
            const f = s - half - 0.35;
            if (f < free) { free = f; byTraffic = false; byStill = false; byFounder = isFounder(ob.o); blocker = null; ahead = 0; }
          }
        }
      }
      // what the next tile asks of us: lights, gates
      const entry = base + 1 - 0.5 - half; // distance until our nose enters b's tile
      const key = World.idx(b[0], b[1]);
      const canStop = v * v / (2 * DEC_MAX) <= entry + 0.05;
      if (entry > -0.05 && entry < LOOK) {
        // a red light where the signalled crossing begins (V2: dark in a blackout; blue lights go through)
        if (!urgent && World.signals.size && World.signalOn(key) && !World.signals.has(World.idx(a[0], a[1])) && (dy !== 0) !== World.nsGreen() && canStop) hold(entry - 0.05, false);
        if (World.crossings.size && World.crossings.has(key) && canStop && gateClosed(b[0], b[1])) hold(entry - 0.1, false);
        // V2: a spot on the road someone is hopping into from the twin row of an avenue is kept clear for them
        if (!isBox(b[0], b[1]) && canStop)
          for (const c of claims.get(key) || []) if (c.o !== me && c.tick >= tick - 1 && c.d !== dirOf(dx, dy)) { hold(entry - 0.05, true); break; }
      }
      if (!hop && sideways && entry < 1.5) hop = { entry, room: base + 0.55 + half, b, d: dirOf(dx, dy) };
    }
    // V2: hopping across from one row of an avenue to its twin (to a door on the far side, or setting off from one):
    // wait for a gap in the traffic along that row, as when pulling out of a drive, and for room to be all the way in
    // it (half across, a car blocks both rows); then claim the spot we're hopping into, as a junction tile is claimed,
    // it, so nobody pulls into it meanwhile (once under way it's committed)
    if (hop) {
      const key = World.idx(hop.b[0], hop.b[1]), mine = (claims.get(key) || []).some((c) => c.o === me && c.tick >= tick - 1);
      const go = hop.entry <= 0 || (free >= hop.room && !Traffic.coming(me, hop.b[0], hop.b[1], !mine) && !Traffic.intoFromBox(me, hop.b[0], hop.b[1]));
      // (and keep it while we wait: we may be standing across our own row already, having pulled out of a drive)
      if (go || mine) mark(claims, key, me, 15, hop.d, urgent, 0, 0);
      if (!go) hold(hop.entry - 0.1, true);
      // a villager's car that has just pulled out of its drive, across its own row, and finds no way in: it backs
      // into the drive again and waits there (standing across the row it would block it)
      if (!go && (st as any).joined === true && (dir > 0 ? prog : n0 - 1 - prog) < 0.3 && hop.entry > 0) {
        (st as any).joined = false; (st as any).waitJoin = 0; st.v = 0;
        return 0;
      }
    }

    // V2: junction boxes. The one we hold stays ours on the tiles we haven't left yet (let go untouched if the light
    // turns red before we're in); the next one ahead is reserved whole, or we wait at its line.
    if (held) {
      const ent = held.k0 - 0.5 - s0 - half;
      const red = !urgent && ent > 0.02 && World.signalOn(held.keys[0]) && (held.d[0] % 2 === 0) !== World.nsGreen();
      // (and if someone has got in between us and it, it's theirs to ask for, not ours to hold)
      if ((red && v * v / (2 * DEC_MAX) <= ent + 0.05) || (ent > 0.02 && blocker && free < ent - 0.3)) { held = null; findBox(); }
    }
    st.box = held;
    const long = len >= 0.85;
    if (held) for (let i = 0; i < held.keys.length; i++) if (held.k0 + i >= tail) mark(claims, held.keys[i], me, held.m[i], held.d[i], urgent, 0, 0, long, held.x[i]);
    const entB = kb - 0.5 - s0 - half; // (our nose to the box's edge; below zero we're already in it)
    if (kb >= 0 && entB < (v * v) / (2 * DEC) + 1.2) {
      // the tiles of the box we'll cross, and how we cross each
      const R = RUN, tab = MASKS[len >= 0.85 ? 1 : 0];
      R.keys.length = R.m.length = R.d.length = R.x.length = 0;
      for (let k = kb; k <= k1; k++) {
        const t = at(path, k, dir)!;
        const [ix, iy] = stepDir(path, k, dir, true), [ox, oy] = stepDir(path, k, dir, false);
        const di = dirOf(ix, iy);
        const dO = k === n - 1 ? di : dirOf(ox, oy);
        R.keys.push(World.idx(t[0], t[1])); R.m.push(tab[di][dO]); R.d.push(di); R.x.push(dO);
      }
      // where we wait: a little short of the box, further back while a long vehicle turns out of it towards us (its
      // nose swings wide across our side of the road)
      let back = 0.22;
      for (const c of claims.get(R.keys[0]) || []) if (c.o !== me && c.tick >= tick - 1 && c.l && c.x === (R.d[0] + 2) % 4) back = 0.5;
      const front = free >= entB - back - 0.08; // (nobody between us and the line)
      const red = !urgent && World.signalOn(R.keys[0]) && (R.d[0] % 2 === 0) !== World.nsGreen();
      const since = st.jw ? st.js ?? tick : tick;
      let ok = !red, crossed = false;
      for (let i = 0; i < R.keys.length && ok; i++) {
        for (const c of claims.get(R.keys[i]) || []) if (c.o !== me && c.tick >= tick - 1 && (c.m & R.m[i]) && c.d !== R.d[i]) { ok = false; crossed = true; break; }
        if (ok) for (const r of asks.get(R.keys[i]) || []) if (r.o !== me && r.tick >= tick - 1 && (r.m & R.m[i]) && r.d !== R.d[i] && outranks(r, me, urgent, since)) { ok = false; crossed = true; break; }
      }
      // room on the far side for all of us (where the car in front would stop if it braked now: it is moving on; a
      // queue may stand on a bend)
      if (ok && hard && k1 < n - 1 && free + (ahead > 0 ? (ahead * ahead) / (2 * DEC_MAX) : 0) < k1 + 0.5 - s0 + half + 0.05) ok = false;
      // (nor while someone hops across into the spot just past it: we'd have to wait for them inside)
      if (ok && k1 < n - 1) {
        const E = at(path, k1 + 1, dir)!, de = R.x[R.x.length - 1];
        for (const c of claims.get(World.idx(E[0], E[1])) || []) if (c.o !== me && c.tick >= tick - 1 && c.d !== de && !isBox(E[0], E[1])) { ok = false; break; }
      }
      // a long vehicle turning right swings its nose across the far side of the road it turns into: not while a car
      // waits close up at the line there
      if (ok && long && k1 < n - 1 && turnAt(path, k1, dir) === 1) {
        const E = at(path, k1 + 1, dir)!, o = R.x[R.x.length - 1], fx = DX4[o], fy = DY4[o];
        for (const ob of grid.get(World.idx(E[0], E[1])) || []) {
          if (ob.o === me || !ob.car || ob.hx * fx + ob.hy * fy > -0.7) continue;
          const rx = ob.x - E[0] - 0.5, ry = ob.y - E[1] - 0.5;
          if (rx * -fy + ry * fx < 0 && rx * fx + ry * fy + 0.5 - ob.len / 2 < 0.55) { ok = false; break; }
        }
      }
      if ((ok && front) || entB <= -0.02) {
        st.box = { path, k0: kb, k1, keys: R.keys.slice(), m: R.m.slice(), d: R.d.slice(), x: R.x.slice() };
        for (let i = 0; i < R.keys.length; i++) mark(claims, R.keys[i], me, R.m[i], R.d[i], urgent, 0, 0, long, R.x[i]);
        st.jw = 0;
      } else if (!ok) {
        hold(entB - back, true);
        if (front) {
          st.js = since;
          st.jw = (st.jw || 0) + dt;
          // held by crossing traffic: say so, so that after a while it lets us go first
          if (crossed || urgent) for (let i = 0; i < R.keys.length; i++) mark(asks, R.keys[i], me, R.m[i], R.d[i], urgent, st.jw, since);
        }
      }
    }

    // overtaking: back into our lane once everything we pulled out for is behind us and the lane beside us is clear
    if (ov) {
      ov.t -= dt;
      let past = true;
      for (let i = 0; i < ov.os.length && past; i++) {
        const rel = Traffic.relAlong(ov.os[i], path, prog, dir);
        if (rel !== null && rel > -(half + ov.lens[i] / 2 + 0.12)) past = false;
      }
      if ((past || ov.t <= 0) && Traffic.laneFree(me, path, prog, dir, half, myW)) st.over = null;
    }
    // pulling out to overtake: room on our side ahead is still closed, but the other lane is clear
    const changing = Math.abs((st.over ? -LANE : LANE) - lat) > 0.05;
    let room = Math.max(0, free);
    if (changing) room = Math.min(room, 0.6); // ease along while crossing the road

    // V2 (Milestone 8): slow for the next bend (and through it): brake down to the turn's own speed by the
    // time the arc begins, as a driver would, instead of swinging round the corner at full speed
    let bend = v0;
    for (let k = Math.max(1, Math.round(s0)); k < Math.min(n - 1, Math.round(s0) + 5); k++) {
      const turn = turnAt(path, k, dir);
      if (!turn) continue;
      const vt = turn === 2 ? TURN_V.back : turn > 0 ? TURN_V.right : TURN_V.left;
      bend = Math.sqrt(vt * vt + 2 * DEC * Math.max(0, k - 0.5 - s0));
      break;
    }
    // speed: as fast as still lets us stop in the room we have
    const target = Math.min(v0, bend, Math.sqrt(2 * DEC * room));
    let nv = target < v ? Math.max(target, v - DEC_MAX * dt) : Math.min(target, v + ACC * dt);
    let step = nv * dt;
    // V2 (Milestone 8): someone stepping out inside the stopping distance can't be stopped for in time: the driver
    // brakes as hard as the car will, and may still hit them (it used to stop dead, which no car can do)
    const lateFor = !byTraffic && free < v ** 2 / (2 * DEC_MAX) - 0.05 && v > 0.5;
    if (lateFor) { nv = Math.max(0, v - DEC_MAX * dt); step = nv * dt; }
    else if (step > room) { step = room; nv = room / dt; }
    st.v = nv;
    // across the road, towards our lane (or the oncoming one while passing)
    const want = st.over ? -LANE : LANE;
    const sway = Math.max(SWERVE, nv * 0.7) * dt;
    st.lat = Math.abs(want - lat) <= sway ? want : lat + Math.sign(want - lat) * sway;

    // stuck behind something stopped: pull out past it, if the way is clear (V2: never through it; on blue lights,
    // past a queue too, and sooner)
    if (nv < 0.05 && byTraffic) st.wait = (st.wait || 0) + dt;
    else if (nv > 0.3 || !byTraffic) st.wait = 0;
    const wait = st.wait || 0;
    const stopped = blocker as Ob | null;
    if (stopped && (byStill || urgent) && !st.over && free < 1.2 && wait > (urgent ? 0.3 : PASS_AFTER)) {
      const plan = Traffic.passPlan(me, path, prog, dir, stopped, len, urgent, wait > RELAX_AFTER);
      if (plan) { st.over = plan; st.wait = 0; }
    }
    // held up by the Founder: the horn, then again every few seconds
    if (byFounder && nv < 0.3) {
      st.honk = (st.honk || 0) + dt;
      if (st.honk > HONK_AFTER) { st.honk = -5; Traffic.onHonk?.(me); }
    } else if ((st.honk || 0) > 0) st.honk = 0;
    else if (st.honk) st.honk = Math.min(0, st.honk + dt);
    return step;
  },

  /**
   * V2: can `me` overtake `first` (stopped in our lane ahead), and what does it pull out for? Whatever stands
   * right behind it with no room to pull back in between goes too (on blue lights a queue counts; otherwise only
   * parked things: a queue isn't overtaken). The stretch we pass on must run straight with no junction, lights,
   * crossing or anyone in the road, it must leave room past them before the path ends, and the other lane must be
   * clear for as far as anything coming could get while we're out in it (`relaxed`: after a long wait, a shorter look).
   */
  passPlan(me: unknown, path: number[][], prog: number, dir: number, first: Ob, len: number, urgent: boolean, relaxed: boolean): Over | null {
    const half = len / 2, myW = halfW(len);
    const segs = segmentsAhead(path, prog, dir, 16, PSEGS, 18);
    if (!segs.length) return null;
    const mine: { ob: Ob; s: number; ea: number }[] = [], other: { ob: Ob; s: number; ea: number; ha: number }[] = [];
    let walker = Infinity;
    const seen = PSEEN;
    seen.clear();
    for (const { a, b, base, dx, dy } of segs) {
      const ax = a[0] + 0.5, ay = a[1] + 0.5, nx = -dy, ny = dx;
      for (const [tx, ty] of [a, b])
        for (const ob of grid.get(World.idx(tx, ty)) || []) {
          if (ob.o === me || seen.has(ob)) continue;
          const rx = ob.x - ax, ry = ob.y - ay, along = rx * dx + ry * dy;
          if (along < -0.05 || along > 1.05) continue;
          const s = base + along, c = rx * nx + ry * ny;
          if (s <= 0) continue;
          seen.add(ob);
          if (!ob.car) { if (Math.abs(c) < ON_ROAD) walker = Math.min(walker, s); continue; }
          const ha = ob.hx * dx + ob.hy * dy, ca = Math.abs(ha), cn = Math.abs(ob.hx * nx + ob.hy * ny);
          const ea = (ca * ob.len) / 2 + cn * ob.w, ec = (cn * ob.len) / 2 + ca * ob.w;
          // (something across the road is in both lanes)
          if (Math.abs(c - LANE) < myW + ec + 0.03 + ob.wide) mine.push({ ob, s, ea });
          if (Math.abs(c + LANE) < myW + ec + 0.08 + ob.wide) other.push({ ob, s, ea, ha });
        }
    }
    mine.sort((p, q) => p.s - q.s);
    const i0 = mine.findIndex((e) => e.ob === first);
    if (i0 < 0) return null;
    const os: unknown[] = [], lens: number[] = [];
    let end = 0;
    for (let i = i0; i < mine.length; i++) {
      const e = mine[i];
      if (i > i0 && e.s - e.ea >= end + len + 2 * GAP) break; // a gap to pull back into
      if (!e.ob.still && !urgent) return null;
      os.push(e.ob.o); lens.push(e.ob.len);
      end = Math.max(end, e.s + e.ea);
    }
    const dist = end + GAP + half + 0.1; // how far our centre goes in the other lane
    const left = dir > 0 ? path.length - 1 - prog : prog;
    if (left < dist + 0.5 || walker < dist + 0.5) return null;
    const d0 = segs[0];
    if (isBox(d0.a[0], d0.a[1])) return null;
    for (const { b, base, dx, dy } of segs) {
      if (base > dist) break;
      if (dx !== d0.dx || dy !== d0.dy) return null; // the road turns
      const key = World.idx(b[0], b[1]);
      if (isBox(b[0], b[1]) || World.signals.has(key) || World.crossings.has(key)) return null;
    }
    const time = 1.5 + dist / 0.8;
    const reach = relaxed ? dist + 2.5 : dist + 2 + 1.7 * time;
    if (segs[segs.length - 1].base + 1 < Math.min(reach, left)) return null; // (can't see that far: the path ends first)
    for (const e of other) {
      if (e.s - e.ea > reach) continue;
      if (os.includes(e.ob.o)) { if (Math.abs(e.ha) < 0.7) return null; continue; } // (what we pass, standing across the road)
      if (e.s - e.ea < dist + GAP || e.ha < 0.3 || !e.ob.still) return null; // in the way, or coming (or going) along it
    }
    return { o: first.o, os, lens, t: time * 2 + 4 };
  },

  /** V2: is anything moving bearing down on tile (x, y), within a couple of tiles (or, `close`, standing just short
   *  of it, facing it: about to move into it)? */
  coming(me: unknown, x: number, y: number, close = false): boolean {
    const cx = x + 0.5, cy = y + 0.5;
    for (let j = -2; j <= 2; j++)
      for (let i = -2; i <= 2; i++)
        for (const ob of grid.get(World.idx(x + i, y + j)) || []) {
          if (ob.o === me || !ob.car || ob.still) continue;
          const slow = ob.v >= 0 && ob.v < 0.15;
          if (slow && !close) continue;
          const rx = cx - ob.x, ry = cy - ob.y, ahead = rx * ob.hx + ry * ob.hy;
          if (ahead > -0.4 && ahead < (slow ? 1.6 : 2.6) && Math.abs(rx * -ob.hy + ry * ob.hx) < 0.5) return true;
        }
    return false;
  },

  /** V2: will someone holding a junction box beside tile (x, y) come out of it into the tile? */
  intoFromBox(me: unknown, x: number, y: number): boolean {
    for (let k = 0; k < 4; k++)
      for (const c of claims.get(World.idx(x - DX4[k], y - DY4[k])) || []) if (c.o !== me && c.tick >= tick - 1 && c.x === k) return true;
    return false;
  },

  /** V2: is our own lane clear beside us, to pull back into after overtaking? */
  laneFree(me: unknown, path: number[][], prog: number, dir: number, half: number, myW: number): boolean {
    const i = dir > 0 ? Math.floor(prog) : Math.ceil(prog);
    const a = path[i], b = path[i + dir] || path[i - dir];
    if (!a || !b) return true;
    const sgn = path[i + dir] ? 1 : -1;
    const dx = (b[0] - a[0]) * sgn, dy = (b[1] - a[1]) * sgn, f = Math.abs(prog - i);
    const px = a[0] + 0.5 + dx * f, py = a[1] + 0.5 + dy * f;
    for (let j = -1; j <= 1; j++)
      for (let k = -1; k <= 1; k++)
        for (const ob of grid.get(World.idx(a[0] + k, a[1] + j)) || []) {
          if (ob.o === me || !ob.car) continue;
          const rx = ob.x - px, ry = ob.y - py, along = rx * dx + ry * dy, c = rx * -dy + ry * dx;
          const ca = Math.abs(ob.hx * dx + ob.hy * dy), cn = Math.abs(ob.hx * -dy + ob.hy * dx);
          if (Math.abs(c - LANE) < myW + (cn * ob.len) / 2 + ca * ob.w + 0.03 && Math.abs(along) < half + (ca * ob.len) / 2 + cn * ob.w + GAP * 0.5) return false;
        }
    return true;
  },

  /**
   * V2 (Milestone 8): is there room for `me` to pull out onto the first tile of `path`? Nothing on the
   * spot itself, and (unless `relax`: it has waited a long while) nothing moving that's bearing down on it from
   * within a couple of tiles. (V2: the spot is the car's own outline in its lane, against each vehicle's own; `force`:
   * after a very long wait, something parked there doesn't stop it, but a car in the traffic always does.)
   */
  roomToJoin(me: unknown, path: number[][], relax = false, force = false): boolean {
    const t0 = path[0];
    if (!t0) return true;
    const k0 = World.idx(t0[0], t0[1]);
    if ((joins.get(k0) ?? -9) >= tick - 1) return false;
    // (V2: setting off across to the far row of an avenue: there must be room on that row too)
    const t1 = path[1];
    const hop = !!t1 && twinStep(t0, t1) && !isBox(t1[0], t1[1]);
    if (hop) {
      if (Traffic.coming(me, t1[0], t1[1], true) || Traffic.intoFromBox(me, t1[0], t1[1])) return false;
      // nothing on the spot across, nor right up against it along that row
      const t2 = path[2] || t1;
      for (const t of [t1, t2])
        for (const ob of grid.get(World.idx(t[0], t[1])) || [])
          if (ob.o !== me && ob.car && Math.hypot(ob.x - t1[0] - 0.5, ob.y - t1[1] - 0.5) < 0.5 + ob.len / 2 + CAR_LEN / 2) return false;
    }
    const p = lanePose(path, 0, LANE_PX, 1, JOIN);
    const px = p.x / T, py = p.y / T, fx = p.hx, fy = p.hy;
    for (let j = -2; j <= 2; j++)
      for (let i = -2; i <= 2; i++) {
        for (const ob of grid.get(World.idx(t0[0] + i, t0[1] + j)) || []) {
          if (ob.o === me || !ob.car) continue;
          const rx = ob.x - px, ry = ob.y - py, along = rx * fx + ry * fy, c = rx * -fy + ry * fx;
          const ca = Math.abs(ob.hx * fx + ob.hy * fy), cn = Math.abs(ob.hx * -fy + ob.hy * fx);
          if (Math.abs(c) < HALF_W + (cn * ob.len) / 2 + ca * ob.w + 0.05 && Math.abs(along) < CAR_LEN / 2 + (ca * ob.len) / 2 + cn * ob.w + 0.15 && !(force && ob.still)) return false;
          if (relax || ob.still) continue;
          const v = ob.v >= 0 ? ob.v : 1;
          if (v > 0.1 && Math.hypot(rx, ry) < 2.6 && -rx * ob.hx - ry * ob.hy > 0) return false;
        }
      }
    // (V2: pulling out inside a junction box: only once the way across it is clear, and then it's ours)
    let run = 0;
    if (isBox(t0[0], t0[1])) {
      const hard = boxKind(t0[0], t0[1]) === 1, tab = MASKS[0];
      for (let k = 0; k < path.length && k < 6; k++) {
        const t = path[k];
        if (k > 0 && (!hard || boxKind(t[0], t[1]) !== 1)) break;
        const [ix, iy] = stepDir(path, k, 1, true), [ox, oy] = stepDir(path, k, 1, false);
        const di = dirOf(ix, iy), dO = k === path.length - 1 ? di : dirOf(ox, oy), key = World.idx(t[0], t[1]);
        for (const c of claims.get(key) || []) if (c.o !== me && c.tick >= tick - 1 && (c.m & tab[di][dO]) && c.d !== di) return false;
        run = k + 1;
      }
      for (let k = 0; k < run; k++) {
        const t = path[k], [ix, iy] = stepDir(path, k, 1, true), [ox, oy] = stepDir(path, k, 1, false);
        const di = dirOf(ix, iy), dO = k === path.length - 1 ? di : dirOf(ox, oy);
        mark(claims, World.idx(t[0], t[1]), me, tab[di][dO], di, false, 0, 0, false, dO);
      }
    }
    // (and the spot across is kept for it from now on)
    if (hop) mark(claims, World.idx(t1[0], t1[1]), me, 15, dirOf(t1[0] - t0[0], t1[1] - t0[1]), false, 0, 0);
    joins.set(k0, tick);
    if (joins.size > 200) for (const [k, t] of joins) if (t < tick - 2) joins.delete(k);
    return true;
  },

  /** where `o` (a road user in the index) is along our heading, relative to us (tiles), or null */
  relAlong(o: unknown, path: number[][], prog: number, dir: number): number | null {
    const i = dir > 0 ? Math.floor(prog) : Math.ceil(prog);
    const a = path[i], b = path[i + dir] || path[i - dir];
    if (!a || !b) return null;
    const sgn = path[i + dir] ? 1 : -1;
    const dx = (b[0] - a[0]) * sgn, dy = (b[1] - a[1]) * sgn;
    const f = Math.abs(prog - i);
    const px = a[0] + 0.5 + dx * f, py = a[1] + 0.5 + dy * f;
    for (let j = -2; j <= 3; j++) {
      const q = path[i + dir * j];
      if (!q) continue;
      for (const ob of grid.get(World.idx(q[0], q[1])) || []) if (ob.o === o) return (ob.x - px) * dx + (ob.y - py) * dy;
    }
    return null;
  },

  /**
   * V2 (Milestone 8): who a moving vehicle has run into this tick. Every vehicle in the index is checked
   * against the people on foot around it (where both stand now); a knock at walking pace does nothing, a
   * faster one hurts in proportion to the speed and the size of what hit them. Each pair counts once a
   * few seconds. `dt` is the tick's sim seconds (speeds come from how far each vehicle moved).
   */
  hits(dt: number, onHit: (veh: any, who: unknown, speed: number, mass: number) => void): void {
    if (dt <= 0) return;
    const now = tick;
    for (const key of filled) {
      for (const ob of grid.get(key)!) {
        if (!ob.car || isFounder(ob.o)) continue;
        const o: any = ob.o;
        const vx = (o.x ?? ob.x * T) / T, vy = (o.y ?? ob.y * T) / T;
        const v = Math.hypot(vx - ob.x, vy - ob.y) / dt; // tiles a second
        if (v < 0.22) continue;
        const hx = o.hx ?? ob.dx, hy = o.hy ?? ob.dy, hl = Math.hypot(hx, hy) || 1;
        const fx = hx / hl, fy = hy / hl;
        const tx = Math.floor(vx), ty = Math.floor(vy);
        for (let j = -1; j <= 1; j++)
          for (let i = -1; i <= 1; i++)
            for (const pd of grid.get(World.idx(tx + i, ty + j)) || []) {
              if (pd.car) continue;
              const q: any = pd.o;
              const px = isFounder(q) ? pd.x : (q.x ?? pd.x * T) / T, py = isFounder(q) ? pd.y : (q.y ?? pd.y * T) / T;
              const rx = px - vx, ry = py - vy;
              if (Math.abs(rx * fx + ry * fy) > ob.len / 2 + 0.05 || Math.abs(rx * -fy + ry * fx) > 0.15) continue;
              const k = `${rank(o)}:${rank(q)}`;
              if ((struck.get(k) ?? -1e9) > now - 120) continue;
              struck.set(k, now);
              onHit(o, q, v * 8, ob.len >= 0.95 ? 1.6 : ob.len >= 0.7 ? 1.25 : ob.len < 0.4 ? 0.6 : 1);
            }
      }
    }
    if (struck.size > 400) for (const [k, t] of struck) if (t < now - 200) struck.delete(k);
  },

  /**
   * V2: has a vehicle on a job got there: at the end of its run (`left` path steps to go), or held up within a tile
   * and a half of it for a few seconds (something standing on the very spot), when it stops where it is and gets on
   * with it? (`st.held` keeps the count.)
   */
  there(st: { held?: number }, left: number, step: number, dt: number): boolean {
    st.held = step < 1e-4 && left < 1.5 ? (st.held || 0) + dt : 0;
    return left <= 1e-3 || st.held > 3;
  },

  /** road users within r pixels of (x, y), as indexed this tick (their `o` holds live positions) */
  near(x: number, y: number, r: number, out: Ob[] = []): Ob[] {
    out.length = 0;
    const t0x = Math.floor((x - r) / T), t1x = Math.floor((x + r) / T), t0y = Math.floor((y - r) / T), t1y = Math.floor((y + r) / T);
    for (let ty = t0y; ty <= t1y; ty++)
      for (let tx = t0x; tx <= t1x; tx++) for (const ob of grid.get(World.idx(tx, ty)) || []) if (!isFounder(ob.o)) out.push(ob);
    return out;
  },

  /** the lateral offset a vehicle's position uses (V1 pixels, right of the centreline) */
  lanePx(st: Drive | null | undefined): number {
    return (st?.lat ?? LANE) * T;
  },

  /** forget everything (a new map or a loaded save) */
  reset(): void {
    grid.clear();
    filled.length = 0;
    claims.clear();
    asks.clear();
    joins.clear();
    boxStamp = -1;
    used = 0;
    this.guests = [];
  },
};

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
   ============================================================ */
import { World } from './world';

const T = 16;
const LANE = 2.7 / T;      // lane centre, right of the road's centreline (V2 (Milestone 8): 1.35 m, was 1.75 m: cars hung over the kerb)
const CAR_LEN = 0.56;      // ~4.5 m
const GAP = 0.3;           // ~2.4 m bumper to bumper in a queue
const ACC = 0.35;          // pulling away (~2.8 m/s²)
const DEC = 0.45;          // planned braking (~3.6 m/s²)
const DEC_MAX = 1.1;       // as hard as it gets
const LOOK = 3.6;          // how far ahead a driver looks (> stopping distance at town speed)
const IN_LANE = 0.2;       // how far off our lane line another vehicle still blocks it
const ON_ROAD = 0.29;      // closer than this to the centreline, a pedestrian is on the carriageway
const BOLD_AFTER = 6;      // seconds stuck behind crossing traffic before a driver edges out anyway
const PASS_AFTER = 1.5;    // seconds stuck behind something stopped before pulling out to pass
const SQUEEZE_AFTER = 20;  // seconds stuck with no chance to pass before squeezing by regardless
const HONK_AFTER = 2;      // seconds held up by the Founder before the horn
const SWERVE = 0.35;       // how fast a car moves across the road (tiles/s, at walking pace)

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

/** one road user as seen by others this tick (x, y in tiles; dx, dy its heading) */
export interface Ob { o: unknown; x: number; y: number; dx: number; dy: number; car: boolean; len: number; still: boolean; wide: number }
/** per-vehicle state kept on its trip object: speed, time stuck, the ways out of a jam, its lane */
export interface Drive { v?: number; wait?: number; bold?: number; pass?: number; honk?: number; lat?: number; over?: { o: unknown; t: number } | null }
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
/** junction tile → who holds it, on which axis, last refreshed on which tick */
const claims = new Map<number, { o: unknown; ns: boolean; tick: number }>();
/** V2 (Milestone 8): who has run into whom lately (so a hit counts once) */
const struck = new Map<string, number>();
let tick = 0;
let gateClosed: (tx: number, ty: number) => boolean = () => false;

function put(o: unknown, x: number, y: number, dx: number, dy: number, car: boolean, len: number, still = false, wide = 0): void {
  if (x === undefined || y === undefined || Number.isNaN(x)) return;
  const key = World.idx(Math.floor(x / T), Math.floor(y / T));
  const ob = pool[used] || (pool[used] = { o: null, x: 0, y: 0, dx: 0, dy: 0, car: false, len: 0, still: false, wide: 0 });
  used++;
  ob.o = o; ob.x = x / T; ob.y = y / T; ob.dx = dx || 0; ob.dy = dy || 0; ob.car = car; ob.len = len; ob.still = still; ob.wide = wide;
  let list = grid.get(key);
  if (!list) grid.set(key, (list = []));
  if (!list.length) filled.push(key);
  list.push(ob);
}

/**
 * Where roads meet from three or four sides. On V1's two-tile avenues the twin
 * row alongside isn't a side street: a neighbour only counts as an arm unless
 * it and this tile both carry on in the same direction.
 */
export function isJunction(x: number, y: number): boolean {
  if (World.signalOn(World.idx(x, y))) return false; // V2: dark lights make it an ordinary junction
  const ew = (yy: number): boolean => World.isRoad(x - 1, yy) && World.isRoad(x + 1, yy);
  const ns = (xx: number): boolean => World.isRoad(xx, y - 1) && World.isRoad(xx, y + 1);
  let n = 0;
  if (World.isRoad(x + 1, y) && !(ns(x) && ns(x + 1))) n++;
  if (World.isRoad(x - 1, y) && !(ns(x) && ns(x - 1))) n++;
  if (World.isRoad(x, y + 1) && !(ew(y) && ew(y + 1))) n++;
  if (World.isRoad(x, y - 1) && !(ew(y) && ew(y - 1))) n++;
  return n >= 3;
}

/** the stretches of path ahead of `prog`, each with its distance from us */
interface Seg { a: number[]; b: number[]; base: number; dx: number; dy: number }
function segmentsAhead(path: number[][], prog: number, dir: number, reach: number, out: Seg[]): Seg[] {
  out.length = 0;
  const m0 = dir > 0 ? Math.floor(prog) : Math.ceil(prog);
  for (let m = m0, n = 0; n < 8; m += dir, n++) {
    const a = path[m], b = path[m + dir];
    if (!a || !b) break;
    const base = (m - prog) * dir;
    if (base > reach) break;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    if (!dx && !dy) continue;
    out.push({ a, b, base, dx, dy });
  }
  return out;
}
const SEGS: Seg[] = [];

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
    for (const p of people) {
      if (p.state !== 'walk' || !p.trip) continue;
      const t = p.trip;
      if (t.joined === false) continue; // (still in the drive, waiting to pull out)
      if (t.car || t.taxi || t.moto) put(p, p.x, p.y, p.dirx, p.diry, true, t.moto ? 0.3 : CAR_LEN, (t.parkT || 0) > 0);
      else put(p, p.x, p.y, p.dirx, p.diry, false, 0);
    }
    for (const b of life.buses || []) if (!b.hidden) put(b, b.x, b.y, b.dirx, b.diry, true, 1.3, b.pause > 0);
    for (const c of life.taxis || []) put(c, c.x, c.y, c.dirx, c.diry, true, CAR_LEN, c.pause > 0);
    for (const t of life.tourists || []) if (t.phase !== 'visit') put(t, t.x, t.y, t.dirx, t.diry, true, CAR_LEN);
    for (const c of life.campaignCars || []) put(c, c.x, c.y, c.dirx, c.diry, true, CAR_LEN);
    for (const u of life.police || []) put(u, u.x, u.y, u.dirx, u.diry, true, CAR_LEN, u.phase === 'scene');
    for (const u of life.fireTrucks || []) put(u, u.x, u.y, u.dirx, u.diry, true, 1.1, u.phase === 'douse');
    // V2: ambulances at a scene, delivery trucks unloading and repair vans at work stand in the road
    for (const u of life.ambulances || []) put(u, u.x, u.y, u.dirx, u.diry, true, 0.75, u.phase === 'treat');
    for (const u of life.trucks || []) put(u, u.x, u.y, u.dirx, u.diry, true, 0.9, u.phase === 'drop');
    for (const u of life.crews || []) put(u, u.x, u.y, u.dirx, u.diry, true, 0.7, u.phase === 'fix');
    if (life.crash) put(life.crash, life.crash.x, life.crash.y, 1, 0, true, 1.2, true);
    // V2 (Milestone 8): the Christmas tree on its flatbed, crawling through town: traffic waits behind it
    if (life.convoy) put(life.convoy, life.convoy.x, life.convoy.y, life.convoy.dirx, life.convoy.diry, true, 2.4, false);
    // the Founder's car sits anywhere across the road, so it blocks a wider strip than a lane
    for (const g of this.guests) put(g.car ? FOUNDER_CAR : FOUNDER, g.x, g.y, g.dx, g.dy, g.car, g.car ? g.len ?? CAR_LEN : 0, g.still, g.car ? 0.14 : 0);
    // claims nobody has refreshed lately lapse
    for (const [k, c] of claims) if (c.tick < tick - 2) claims.delete(k);
  },

  /**
   * How far along its path (in path steps, ≥ 0) a vehicle moves this tick.
   * It drives `path` from `prog` towards the end (`dir` +1) or the start (-1)
   * at up to `v0` tiles/s; `st` carries its speed and lane between ticks.
   */
  advance(me: unknown, st: Drive, path: number[][], prog: number, dir: number, v0: number, dt: number, len = CAR_LEN): number {
    if (dt <= 0 || !path || path.length < 2) return 0;
    const bold = (st.bold || 0) > 0, squeezing = (st.pass || 0) > 0;
    const lat = st.lat ?? LANE;
    const passing = st.over ? st.over.o : null;
    let free = LOOK;
    let byTraffic = false, byStill = false, byFounder = false;
    let blocker: Ob | null = null;
    const half = len / 2;
    const segs = segmentsAhead(path, prog, dir, LOOK, SEGS);
    const seen = new Set<Ob>();
    let junctionDone = false;
    for (const { a, b, base, dx, dy } of segs) {
      const ax = a[0] + 0.5, ay = a[1] + 0.5;
      const nx = -dy, ny = dx; // right-hand normal (y runs south)
      // everyone standing on or near this stretch
      for (const [tx, ty] of [a, b]) {
        const list = grid.get(World.idx(tx, ty));
        if (!list) continue;
        for (const ob of list) {
          if (ob.o === me || seen.has(ob)) continue;
          const rx = ob.x - ax, ry = ob.y - ay;
          const along = rx * dx + ry * dy;
          if (along < -0.05 || along > 1.05) continue;
          let s = base + along;
          const c = rx * nx + ry * ny; // across the road, + is our side
          if (s <= 0.02) {
            // beside or behind us; but two cars started in the very same spot (friends leaving
            // together) would drive on as one: the later one in the index lets the other go first
            const twin = ob.car && s > -0.05 && Math.abs(c - lat) < 0.1 && ob.dx * dx + ob.dy * dy > 0.5 && rank(me) > rank(ob.o);
            if (!twin) continue;
            s = 0.03;
          }
          if (ob.car) {
            if (Math.abs(c - lat) > IN_LANE + ob.wide) continue;
            if (ob.o === passing) continue; // the one we're overtaking
            const parallel = Math.abs(ob.dx * dx + ob.dy * dy) > 0.5;
            if (bold && !parallel) continue; // edging out across a stuck junction
            if (squeezing && ob.still) continue; // squeezing by something parked
            seen.add(ob);
            const f = s - half - ob.len / 2 - GAP;
            if (f < free) { free = f; byTraffic = true; byStill = ob.still; byFounder = isFounder(ob.o); blocker = ob; }
          } else {
            if (Math.abs(c) > ON_ROAD) continue;
            seen.add(ob);
            const f = s - half - 0.35;
            if (f < free) { free = f; byTraffic = false; byStill = false; byFounder = isFounder(ob.o); blocker = null; }
          }
        }
      }
      // what the next tile asks of us: lights, gates, a junction to share
      const entry = base + 1 - 0.5 - half; // distance until our nose enters b's tile
      const key = World.idx(b[0], b[1]);
      const ns = dy !== 0;
      const v = st.v || 0;
      const canStop = v * v / (2 * DEC_MAX) <= entry + 0.05;
      if (entry > -0.05 && entry < LOOK) {
        if (World.signals.size && World.signalOn(key) && ns !== World.nsGreen() && canStop) { // V2: dark in a blackout
          if (entry - 0.05 < free) { free = entry - 0.05; byTraffic = false; byStill = false; byFounder = false; blocker = null; }
        }
        if (World.crossings.size && World.crossings.has(key) && canStop && gateClosed(b[0], b[1])) {
          if (entry - 0.1 < free) { free = entry - 0.1; byTraffic = false; byStill = false; byFounder = false; blocker = null; }
        }
      }
      // the first unsignalled junction ahead (or the one we're crossing): first come, first through
      if (!junctionDone && entry < 1.2 && entry > -1 - len && isJunction(b[0], b[1])) {
        junctionDone = true;
        const cl = claims.get(key);
        const held = cl && cl.o !== me && cl.tick >= tick - 1 && cl.ns !== ns;
        if (held && !bold && entry > 0.02) {
          if (entry - 0.05 < free) { free = entry - 0.05; byTraffic = true; byStill = false; byFounder = false; blocker = null; }
        } else if (entry < 1.0 && free > entry) {
          claims.set(key, { o: me, ns, tick });
        }
      }
    }
    // the junction tile we're in stays ours (on the axis we came in on) until we've left it
    const here = path[Math.round(prog)];
    if (here && isJunction(here[0], here[1])) {
      const nxt = path[Math.round(prog) + dir] || here, prv = path[Math.round(prog) - dir] || here;
      claims.set(World.idx(here[0], here[1]), { o: me, ns: prv !== here ? prv[1] !== here[1] : nxt[1] !== here[1], tick });
    }

    // overtaking: done once what we passed is behind us (or it took too long)
    if (st.over) {
      st.over.t -= dt;
      const rel = Traffic.relAlong(st.over.o, path, prog, dir);
      if (st.over.t <= 0 || rel === null || rel < -(half + CAR_LEN)) st.over = null;
    }
    // pulling out to overtake: room on our side ahead is still closed, but the other lane is clear
    const changing = Math.abs((st.over ? -LANE : LANE) - lat) > 0.05;
    let room = Math.max(0, free);
    if (changing) room = Math.min(room, 0.6); // ease along while crossing the road

    // V2 (Milestone 8): slow for the next bend (and through it): brake down to the turn's own speed by the
    // time the arc begins, as a driver would, instead of swinging round the corner at full speed
    const n = path.length, s0 = dir > 0 ? prog : n - 1 - prog;
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
    let v = st.v || 0;
    v = target < v ? Math.max(target, v - DEC_MAX * dt) : Math.min(target, v + ACC * dt);
    let step = v * dt;
    // V2 (Milestone 8): someone stepping out inside the stopping distance can't be stopped for in time: the driver
    // brakes as hard as the car will, and may still hit them (it used to stop dead, which no car can do)
    const lateFor = !byTraffic && free < (st.v || 0) ** 2 / (2 * DEC_MAX) - 0.05 && (st.v || 0) > 0.5;
    if (lateFor) { v = Math.max(0, (st.v || 0) - DEC_MAX * dt); step = v * dt; }
    else if (step > room) { step = room; v = room / dt; }
    st.v = v;
    // across the road, towards our lane (or the oncoming one while passing)
    const want = st.over ? -LANE : LANE;
    const sway = Math.max(SWERVE, v * 0.7) * dt;
    st.lat = Math.abs(want - lat) <= sway ? want : lat + Math.sign(want - lat) * sway;

    // stuck: pull out past something stopped, edge out across a stuck junction, or squeeze by
    if (v < 0.05 && byTraffic) st.wait = (st.wait || 0) + dt;
    else if (v > 0.3 || !byTraffic) st.wait = 0;
    const wait = st.wait || 0;
    if (byStill && blocker && !st.over && wait > PASS_AFTER && free < 1.2 && Traffic.oppositeClear(me, segs, blocker, free + half + blocker.len + GAP + 1.2)) {
      st.over = { o: blocker.o, t: 9 };
      st.wait = 0;
    } else if (wait > (byStill ? SQUEEZE_AFTER : BOLD_AFTER)) {
      if (byStill) st.pass = 4;
      else st.bold = 2.5;
      st.wait = 0;
    }
    if (st.bold) st.bold = Math.max(0, st.bold - dt);
    if (st.pass) st.pass = Math.max(0, st.pass - dt);
    // held up by the Founder: the horn, then again every few seconds
    if (byFounder && v < 0.3) {
      st.honk = (st.honk || 0) + dt;
      if (st.honk > HONK_AFTER) { st.honk = -5; Traffic.onHonk?.(me); }
    } else if ((st.honk || 0) > 0) st.honk = 0;
    else if (st.honk) st.honk = Math.min(0, st.honk + dt);
    return step;
  },

  /**
   * Is the oncoming lane clear for an overtake of `dist` tiles? The road must run
   * straight with no junction, lights or crossing on the way, and nothing may be
   * coming towards us in that lane (or anyone be crossing the road).
   */
  oppositeClear(me: unknown, segs: Seg[], blocker: Ob, dist: number): boolean {
    const d0 = segs[0];
    if (!d0) return false;
    const reach = dist + 2.5; // and room to see what's coming
    for (const { a, b, base, dx, dy } of segs) {
      if (base > reach) break;
      if (dx !== d0.dx || dy !== d0.dy) return false; // the road turns
      if (base < dist) {
        const key = World.idx(b[0], b[1]);
        if (isJunction(b[0], b[1]) || World.signals.has(key) || World.crossings.has(key)) return false;
      }
      const ax = a[0] + 0.5, ay = a[1] + 0.5;
      for (const [tx, ty] of [a, b]) {
        for (const ob of grid.get(World.idx(tx, ty)) || []) {
          if (ob.o === me || ob === blocker) continue;
          const rx = ob.x - ax, ry = ob.y - ay;
          const along = rx * dx + ry * dy;
          if (along < -0.3 || along > 1.3 || base + along > reach) continue;
          const c = rx * -dy + ry * dx;
          if (ob.car ? Math.abs(c + LANE) < IN_LANE + ob.wide + 0.08 : Math.abs(c) < ON_ROAD) return false;
        }
      }
    }
    return segs.length > 0 && segs[segs.length - 1].base + 1 >= Math.min(dist, LOOK);
  },

  /**
   * V2 (Milestone 8): is there room for `me` to pull out onto the first tile of `path`? Nothing on the
   * tile itself, and nothing moving that's bearing down on it from within a couple of tiles.
   */
  roomToJoin(me: unknown, path: number[][]): boolean {
    const t0 = path[0];
    if (!t0) return true;
    const cx = t0[0] + 0.5, cy = t0[1] + 0.5;
    for (let j = -2; j <= 2; j++)
      for (let i = -2; i <= 2; i++) {
        for (const ob of grid.get(World.idx(t0[0] + i, t0[1] + j)) || []) {
          if (ob.o === me || !ob.car) continue;
          const rx = cx - ob.x, ry = cy - ob.y, d = Math.hypot(rx, ry);
          if (d < 0.95) return false;
          const v = (ob.o as any)?.trip?.v ?? (ob.o as any)?.v ?? (ob.still ? 0 : 1);
          if (!ob.still && v > 0.1 && d < 2.6 && rx * ob.dx + ry * ob.dy > 0) return false;
        }
      }
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
   * V2 (Milestone 8): vehicles on blue lights don't queue, but they don't run people down either: how much of
   * its speed (0 … 1) a vehicle at `prog` on `path` can keep with someone on the carriageway ahead
   */
  pedBrake(me: unknown, path: number[][], prog: number, dir = 1): number {
    let near = Infinity;
    for (const { a, b, base, dx, dy } of segmentsAhead(path, prog, dir, 2.6, SEGS)) {
      const ax = a[0] + 0.5, ay = a[1] + 0.5;
      for (const [tx, ty] of [a, b])
        for (const ob of grid.get(World.idx(tx, ty)) || []) {
          if (ob.car || ob.o === me) continue;
          const rx = ob.x - ax, ry = ob.y - ay, along = rx * dx + ry * dy;
          if (along < -0.05 || along > 1.05 || Math.abs(rx * -dy + ry * dx) > ON_ROAD) continue;
          near = Math.min(near, base + along);
        }
    }
    return near < 0.8 ? 0 : near < 2.6 ? (near - 0.8) / 1.8 : 1;
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
    used = 0;
    this.guests = [];
  },
};

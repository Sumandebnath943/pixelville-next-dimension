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
   per tile, tile centres at +8), lanes 3.5 px right of centre.
   ============================================================ */
import { World } from './world';

const T = 16;
const LANE = 3.5 / T;      // lane centre, right of the road's centreline
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
const pool: Ob[] = [];
let used = 0;
/** junction tile → who holds it, on which axis, last refreshed on which tick */
const claims = new Map<number, { o: unknown; ns: boolean; tick: number }>();
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
  list.push(ob);
}

/**
 * Where roads meet from three or four sides. On V1's two-tile avenues the twin
 * row alongside isn't a side street: a neighbour only counts as an arm unless
 * it and this tile both carry on in the same direction.
 */
export function isJunction(x: number, y: number): boolean {
  if (World.signals.has(World.idx(x, y))) return false;
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
    for (const list of grid.values()) list.length = 0;
    used = 0;
    gateClosed = (tx, ty) => life.trainNearTile(tx, ty, 5);
    // "still" marks what is parked on the road for a while (a bus at its stop, a squad car at a
    // scene, a wreck): traffic queues behind it, then passes it
    for (const p of people) {
      if (p.state !== 'walk' || !p.trip) continue;
      const t = p.trip;
      if (t.car || t.taxi || t.moto) put(p, p.x, p.y, p.dirx, p.diry, true, t.moto ? 0.3 : CAR_LEN);
      else put(p, p.x, p.y, p.dirx, p.diry, false, 0);
    }
    for (const b of life.buses || []) put(b, b.x, b.y, b.dirx, b.diry, true, 1.3, b.pause > 0);
    for (const c of life.taxis || []) put(c, c.x, c.y, c.dirx, c.diry, true, CAR_LEN, c.pause > 0);
    for (const t of life.tourists || []) if (t.phase !== 'visit') put(t, t.x, t.y, t.dirx, t.diry, true, CAR_LEN);
    for (const c of life.campaignCars || []) put(c, c.x, c.y, c.dirx, c.diry, true, CAR_LEN);
    for (const u of life.police || []) put(u, u.x, u.y, u.dirx, u.diry, true, CAR_LEN, u.phase === 'scene');
    for (const u of life.fireTrucks || []) put(u, u.x, u.y, u.dirx, u.diry, true, 1.1, u.phase === 'douse');
    if (life.crash) put(life.crash, life.crash.x, life.crash.y, 1, 0, true, 1.2, true);
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
        if (World.signals.size && World.signals.has(key) && ns !== World.nsGreen() && canStop) {
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

    // speed: as fast as still lets us stop in the room we have
    const target = Math.min(v0, Math.sqrt(2 * DEC * room));
    let v = st.v || 0;
    v = target < v ? Math.max(target, v - DEC_MAX * dt) : Math.min(target, v + ACC * dt);
    let step = v * dt;
    if (step > room) { step = room; v = room / dt; }
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
    claims.clear();
    used = 0;
    this.guests = [];
  },
};

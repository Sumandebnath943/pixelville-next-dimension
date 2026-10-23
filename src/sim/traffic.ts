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
const BOLD_AFTER = 6;      // seconds stuck before a driver edges out anyway
const SQUEEZE_AFTER = 10;  // seconds behind something parked before squeezing past

export { CAR_LEN };

/** one road user as seen by others this tick */
interface Ob { o: unknown; x: number; y: number; dx: number; dy: number; car: boolean; len: number; still: boolean }
/** per-vehicle state kept on its trip object: speed, time stuck, and the two ways out of a jam */
export interface Drive { v?: number; wait?: number; bold?: number; pass?: number }

const grid = new Map<number, Ob[]>();
const pool: Ob[] = [];
let used = 0;
/** junction tile → who holds it, on which axis, last refreshed on which tick */
const claims = new Map<number, { o: unknown; ns: boolean; tick: number }>();
let tick = 0;
let gateClosed: (tx: number, ty: number) => boolean = () => false;

function put(o: unknown, x: number, y: number, dx: number, dy: number, car: boolean, len: number, still = false): void {
  if (x === undefined || y === undefined || Number.isNaN(x)) return;
  const key = World.idx(Math.floor(x / T), Math.floor(y / T));
  const ob = pool[used] || (pool[used] = { o: null, x: 0, y: 0, dx: 0, dy: 0, car: false, len: 0, still: false });
  used++;
  ob.o = o; ob.x = x / T; ob.y = y / T; ob.dx = dx || 0; ob.dy = dy || 0; ob.car = car; ob.len = len; ob.still = still;
  let list = grid.get(key);
  if (!list) grid.set(key, (list = []));
  list.push(ob);
}

function isJunction(x: number, y: number): boolean {
  if (World.signals.has(World.idx(x, y))) return false;
  let n = 0;
  if (World.isRoad(x + 1, y)) n++;
  if (World.isRoad(x - 1, y)) n++;
  if (World.isRoad(x, y + 1)) n++;
  if (World.isRoad(x, y - 1)) n++;
  return n >= 3;
}

export const Traffic = {
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
    // scene, a wreck): traffic queues behind it, then squeezes past
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
    // claims nobody has refreshed lately lapse
    for (const [k, c] of claims) if (c.tick < tick - 2) claims.delete(k);
  },

  /**
   * How far along its path (in path steps, ≥ 0) a vehicle moves this tick.
   * It drives `path` from `prog` towards the end (`dir` +1) or the start (-1)
   * at up to `v0` tiles/s; `st` carries its speed between ticks.
   */
  advance(me: unknown, st: Drive, path: number[][], prog: number, dir: number, v0: number, dt: number, len = CAR_LEN): number {
    if (dt <= 0 || !path || path.length < 2) return 0;
    const bold = (st.bold || 0) > 0, passing = (st.pass || 0) > 0;
    let free = LOOK;
    let byTraffic = false, byStill = false;
    const half = len / 2;
    // the segments ahead: from path point m to m + dir, starting with the one we're on
    const m0 = dir > 0 ? Math.floor(prog) : Math.ceil(prog);
    const seen = new Set<Ob>();
    let junctionDone = false;
    for (let m = m0, n = 0; n < 6; m += dir, n++) {
      const a = path[m], b = path[m + dir];
      if (!a || !b) break;
      const base = (m - prog) * dir; // path distance from us to this segment's start
      if (base > LOOK) break;
      const dx = b[0] - a[0], dy = b[1] - a[1];
      if (!dx && !dy) continue;
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
          const s = base + along;
          if (s <= 0.02) continue; // beside or behind us
          const c = rx * nx + ry * ny; // across the road, + is our side
          if (ob.car) {
            if (Math.abs(c - LANE) > IN_LANE) continue;
            const parallel = Math.abs(ob.dx * dx + ob.dy * dy) > 0.5;
            if (bold && !parallel) continue; // edging out across a stuck junction
            if (passing && ob.still) continue; // squeezing past something parked
            seen.add(ob);
            const f = s - half - ob.len / 2 - GAP;
            if (f < free) { free = f; byTraffic = true; byStill = ob.still; }
          } else {
            if (Math.abs(c) > ON_ROAD) continue;
            seen.add(ob);
            const f = s - half - 0.35;
            if (f < free) { free = f; byTraffic = false; byStill = false; }
          }
        }
      }
      // what the next tile asks of us: lights, gates, a junction to share
      const k = m + dir;
      const entry = (k - prog) * dir - 0.5 - half; // distance until our nose enters tile k
      const key = World.idx(b[0], b[1]);
      const ns = dy !== 0;
      const v = st.v || 0;
      const canStop = v * v / (2 * DEC_MAX) <= entry + 0.05;
      if (entry > -0.05 && entry < LOOK) {
        if (World.signals.size && World.signals.has(key) && ns !== World.nsGreen() && canStop) {
          if (entry - 0.05 < free) { free = entry - 0.05; byTraffic = false; byStill = false; }
        }
        if (World.crossings.size && World.crossings.has(key) && canStop && gateClosed(b[0], b[1])) {
          if (entry - 0.1 < free) { free = entry - 0.1; byTraffic = false; byStill = false; }
        }
      }
      // the first unsignalled junction ahead (or the one we're crossing): first come, first through
      if (!junctionDone && entry < 1.2 && entry > -1 - len && isJunction(b[0], b[1])) {
        junctionDone = true;
        const cl = claims.get(key);
        const held = cl && cl.o !== me && cl.tick >= tick - 1 && cl.ns !== ns;
        if (held && !bold && entry > 0.02) {
          if (entry - 0.05 < free) { free = entry - 0.05; byTraffic = true; byStill = false; }
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

    // speed: as fast as still lets us stop in the room we have
    const room = Math.max(0, free);
    const target = Math.min(v0, Math.sqrt(2 * DEC * room));
    let v = st.v || 0;
    v = target < v ? Math.max(target, v - DEC_MAX * dt) : Math.min(target, v + ACC * dt);
    let step = v * dt;
    if (step > room) { step = room; v = room / dt; }
    st.v = v;
    // stuck behind traffic for a while: edge out across the junction, or squeeze past what's parked
    if (v < 0.05 && byTraffic) st.wait = (st.wait || 0) + dt;
    else if (v > 0.3 || !byTraffic) st.wait = 0;
    if ((st.wait || 0) > (byStill ? SQUEEZE_AFTER : BOLD_AFTER)) {
      if (byStill) st.pass = 4;
      else st.bold = 2.5;
      st.wait = 0;
    }
    if (st.bold) st.bold = Math.max(0, st.bold - dt);
    if (st.pass) st.pass = Math.max(0, st.pass - dt);
    return step;
  },

  /** forget everything (a new map or a loaded save) */
  reset(): void {
    grid.clear();
    claims.clear();
    used = 0;
  },
};

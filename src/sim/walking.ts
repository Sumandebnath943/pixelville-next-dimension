/* ============================================================
   Walking (V2, Milestone 8): people on foot keep to a pavement.
   A walker picks the side of the street their door is on and
   stays on it: along a street they walk the pavement, and across
   the mouth of a side street the crossing line. They go round a corner on the
   corner's kerb when they turn towards their own side; to turn
   the other way they first cross the street they're on, at the
   junction mouth, as people do (and wait at the kerb for a gap in
   the traffic first). If their door is across the road at the end,
   they cross there. Each walker has their own pace and their own
   line on the pavement, and steps aside for someone in front or
   coming the other way, so a family leaving together walks as a
   group, not as one body.
   Positions are V1 pixels (16 a tile, tile centres at +8).
   ============================================================ */
import { World } from './world';
import { Traffic, FOOT_PX, turnAt, lanePose, zebraAt, ZEBRA_AT } from './traffic';

const T = 16;
/** how far (px) a walker steps aside to pass someone */
const DODGE = 0.9;
/** the longest a walker waits at the kerb for a gap before crossing anyway (sim seconds) */
const KERB_WAIT = 10;

export interface WalkState {
  /** +1: the right-hand pavement (as they walk), −1 the left */
  side: number;
  /** where along the path the next crossing is (path steps), and the side it leads to */
  crossAt: number; crossTo: number;
  /** the lateral offset (px, right of the centreline) while crossing, else null */
  lat: number | null;
  /** waiting at the kerb for a gap (seconds) */
  wait: number;
  /** this walker's pace and line on the pavement */
  pace: number; line: number;
  /** stepping aside (px, eased) */
  dodge: number; dodgeWant: number;
  /** where the last crossing was (path steps), so it isn't made twice */
  done: number;
  /** V2: seconds left stepping round something standing on the pavement (the line may leave the pavement) */
  wide?: number;
  /** V2: waiting at the kerb, how far out from the road's middle (px) their place in the queue is */
  slotLat?: number;
  /** V2: which kerb's queue they're in, and the traffic tick they were last there */
  qKey?: string; qTick?: number;
  /** V2: how far back from the crossing line (path steps) they cross: the second of two crossing abreast */
  xOff?: number;
}
/** V2: the people waiting at each kerb to cross (keyed by where), in the order they came: each has a place of their own */
const KERB = new Map<string, any[]>();

/** V2: how far from the road's centreline (px) a walker's middle keeps: clear of the kerb (2.6 m, plus a body),
 *  and no further out than the back of the pavement */
const PAVE_IN = 5.8, PAVE_OUT = 8.4;

const isRoad = (x: number, y: number): boolean => World.isRoad(x, y);
/** the travel direction into step k (or out of it at the start) */
function dirAt(path: number[][], k: number, out: boolean): [number, number] {
  const a = out ? path[k] : path[k - 1] || path[k], b = out ? path[k + 1] || path[k] : path[k];
  let dx = b[0] - a[0], dy = b[1] - a[1];
  if (!dx && !dy) {
    const a2 = path[k - 1], b2 = path[k + 1];
    if (out && a2) { dx = path[k][0] - a2[0]; dy = path[k][1] - a2[1]; }
    else if (!out && b2) { dx = b2[0] - path[k][0]; dy = b2[1] - path[k][1]; }
  }
  return [Math.sign(dx) || (dy ? 0 : 1), Math.sign(dy)];
}
/** which side of the travel direction a building is on (+1 right, −1 left) */
function sideOf(b: any, x: number, y: number, dx: number, dy: number): number {
  if (!b) return 1;
  const bx = b.x + b.w / 2 - (x + 0.5), by = b.y + b.h / 2 - (y + 0.5);
  const c = bx * -dy + by * dx;
  return c >= 0 ? 1 : -1;
}
/** is the tile alongside (x, y), on side `s` of direction (dx, dy), the twin row of an avenue (so there's no
 *  pavement on that side of this row: it's across the other carriageway)? */
export function twinSide(x: number, y: number, dx: number, dy: number, s: number): boolean {
  const nx = -dy * s, ny = dx * s, tx = x + nx, ty = y + ny;
  return isRoad(tx, ty) && (isRoad(tx + dx, ty + dy) || isRoad(tx - dx, ty - dy)) && (isRoad(x + dx, y + dy) || isRoad(x - dx, y - dy));
}

export const Walk = {
  /** a new walk along `path` from building `from` to building `to` */
  plan(p: any, t: any, from: any, to: any): void {
    const path: number[][] = t.path;
    const [dx, dy] = dirAt(path, 0, true);
    const seed = (p.seed >>> 0) || 1;
    const w: WalkState = {
      side: sideOf(from, path[0][0], path[0][1], dx, dy), crossAt: -1, crossTo: 0, lat: null, wait: 0,
      pace: 0.86 + ((seed * 2654435761) >>> 0) / 4294967296 * 0.28,
      line: (((seed >> 4) % 11) - 5) * 0.15,
      dodge: 0, dodgeWant: 0, done: -1,
    };
    t.walk = w;
    t.endSide = sideOf(to, path[path.length - 1][0], path[path.length - 1][1], ...dirAt(path, path.length - 1, false));
    Walk.nextCrossing(t);
  },

  /** where the next change of pavement is, from here on: before a turn away from our side (we cross the street
   *  we're on at the junction mouth, then go round the corner on the kerb), before an avenue row whose only pavement
   *  is on the other hand, and at the end if the door is across the road */
  nextCrossing(t: any): void {
    const w: WalkState = t.walk, path: number[][] = t.path, n = path.length;
    let s = w.side;
    // (V2: past the junction of the crossing just made, which is now up to a tile ahead of it, on the zebra)
    for (let k = Math.max(1, Math.ceil(t.prog + 0.51), Math.floor(w.done + 1) + 1); k < n - 1; k++) {
      const turn = turnAt(path, k, 1);
      if (turn === 2) { s = -s; continue; } // turning back on the same pavement: it's now on the other hand
      const [dx, dy] = dirAt(path, k, false);
      if ((turn && turn !== s) || (!turn && twinSide(path[k][0], path[k][1], dx, dy, s))) {
        // (V2: on the zebra across the junction's mouth, back from its edge, where the drivers stop short of it)
        const p0 = path[k - 1];
        w.crossAt = k - 0.5 - (p0 && zebraAt(p0[0], p0[1], dx, dy) ? ZEBRA_AT : 0); w.crossTo = -s;
        return;
      }
    }
    if (t.endSide !== s && w.done < n - 1.5) { w.crossAt = n - 1 - 0.01; w.crossTo = -s; return; }
    w.crossAt = -1;
  },

  /** one tick: how far along the path (steps) the walker gets; crossings and stepping aside happen here */
  step(p: any, t: any, dt: number, speed: number): number {
    const w: WalkState | undefined = t.walk;
    if (!w) return speed * dt;
    // stepping aside, eased
    w.dodge += (w.dodgeWant - w.dodge) * Math.min(1, dt * 3);
    if (w.wide) w.wide = Math.max(0, w.wide - dt);
    let v = speed * w.pace;
    // someone just ahead on this pavement, or coming the other way on our line: step aside, or keep their pace
    // (V2: the Founder on foot too, and anyone standing on the pavement: walked round, never through)
    const hx = p.hx ?? p.dirx ?? 1, hy = p.hy ?? p.diry ?? 0;
    const crossing = w.lat !== null;
    // (which way is away from the road: the side we walk on)
    const out = w.side;
    w.dodgeWant = 0;
    let blockedBy = 0;
    for (const ob of Traffic.near(p.x, p.y, 26, NEAR, true)) {
      if (ob.o === p) continue;
      const rx = ob.x * T - p.x, ry = ob.y * T - p.y;
      const along = rx * hx + ry * hy, across = rx * -hy + ry * hx;
      if (ob.car) {
        // V2: a vehicle's body across our line (the Founder's car left on the pavement, a car backing out of its
        // drive): wait while it moves, go round it on the side away from the road while it stands
        if (crossing || along < -2 || along > 7) continue;
        const ca = Math.abs(ob.hx * hx + ob.hy * hy), cn = Math.abs(ob.hx * -hy + ob.hy * hx);
        const ea = ((ca * ob.len) / 2 + cn * ob.w) * T, ec = ((cn * ob.len) / 2 + ca * ob.w) * T;
        if (along - ea > 3.2 || along + ea < -0.6) continue;
        const shiftR = across + ec + 0.9, shiftL = across - ec - 0.9;
        if (shiftR <= 0 || shiftL >= 0) continue; // (clear of our line already)
        const vv = ob.v >= 0 ? ob.v : 1;
        if (!ob.still && vv > 0.05) { blockedBy = 1; continue; }
        // (out round it if the verge has room; else past it on the road side, as people step round a car on the kerb)
        const lat = Walk.offset(t, w.side) * out;
        const shift = lat + Math.abs(out > 0 ? shiftR : shiftL) <= PAVE_OUT + 2 ? (out > 0 ? shiftR : shiftL) : out > 0 ? shiftL : shiftR;
        if (Math.abs(shift) < 9) { w.dodgeWant = w.dodge + shift; w.wide = 1.5; }
        else blockedBy = 1;
        continue;
      }
      const o = ob.o as any;
      // (V2: two setting off from the same door at once: one lets the other go a step ahead and falls in beside)
      if (along > -0.6 && along < 0.5 && Math.abs(across) < 1 && !ob.still && ((p.seed >>> 0) || 1) > ((o?.seed >>> 0) || 0)) {
        v = Math.min(v, speed * w.pace * 0.55);
        w.dodgeWant = across >= 0 ? -DODGE * 2 : DODGE * 2;
        continue;
      }
      if (along < 0.5 || along > 14 || Math.abs(across) > 6) continue;
      const same = ob.hx * hx + ob.hy * hy;
      // (stepping aside, away from them, unless the pavement's edge leaves no room that way: then the other way)
      const mine = Walk.offset(t, w.side), theirs0 = mine + across;
      const sideStep = (d: number): number => {
        const keep = w.dodge;
        w.dodge = keep + d;
        const sep = Math.abs(Walk.offset(t, w.side) - theirs0);
        w.dodge = keep;
        return sep;
      };
      const step2 = (away: number): number => (sideStep(-away) > sideStep(away) + 0.3 ? -away : away);
      if (Math.abs(across) < 4) {
        if (ob.still) {
          // someone standing on the pavement (the Founder, a casualty, a queue): round them, away from the road
          if (along < 6) w.dodgeWant = step2(across * out > 0.6 ? (across > 0 ? -DODGE * 2 : DODGE * 2) : out * DODGE * 2.2);
        } else if (same > 0.5) {
          // the same way: overtake on the side away from the road if there's room, else fall in behind
          const theirs = o?.trip?.walk?.pace ?? 1;
          if (theirs < w.pace - 0.04) w.dodgeWant = step2(across > 0 ? -DODGE * 2 : DODGE * 2);
          // (V2: and close behind someone who has stopped, stop too: they used to walk on into them)
          else if (along < 9) v = Math.min(v, along < 1.8 ? 0 : speed * theirs * (along < 6 ? 0.8 : 1));
        } else if (same < -0.5) w.dodgeWant = step2(across > 0 ? -DODGE * 2 : DODGE * 2); // meeting: both keep right of each other
      }
    }
    if (blockedBy) v = 0;
    // V2: a level crossing ahead: wait at the barrier while its lights flash, never out on the tracks when a train comes
    if (World.crossings.size) {
      const k0 = Math.floor(t.prog + 0.5), cur = t.path[k0], nx = t.path[k0 + 1];
      if (cur && nx && !World.crossings.has(World.idx(cur[0], cur[1])) && Traffic.gateDown(nx[0], nx[1])) {
        const edge = k0 + 0.3; // (a couple of metres short of the tracks)
        if (t.prog + v * dt > edge) v = Math.max(0, (edge - t.prog) / dt);
      }
    }
    // a crossing ahead: walk up to the kerb, wait for a gap, cross straight over
    if (w.crossAt >= 0 && t.prog + v * dt >= w.crossAt) {
      // (V2: people waiting to cross take places of their own at the kerb, two abreast and a step apart, in the order
      // they came: they used to stand a hair apart, most of them inside one another)
      // (and, crossing, those who set off side by side keep a step apart along the road: they walk over abreast, not
      // through one another)
      let back = w.lat === null ? 0 : w.xOff || 0, row = 0;
      if (w.lat === null) {
        const c = t.path[Math.max(0, Math.min(t.path.length - 1, Math.round(w.crossAt)))];
        const key = `${c[0]},${c[1]},${w.crossAt % 1 > 0.6 ? 1 : 0},${w.side},${w.crossTo},${t.path[Math.max(0, Math.floor(w.crossAt))]?.join(',')}`;
        // (those still waiting here: each renews its place every tick, so anyone gone on, or gone in, drops out)
        const now = Traffic.now();
        w.qKey = key; w.qTick = now;
        const q = (KERB.get(key) || []).filter((o: any) => o === p || (o.trip?.walk?.qKey === key && now - o.trip.walk.qTick <= 1 && o.trip.walk.lat === null));
        if (!q.includes(p)) q.push(p);
        KERB.set(key, q);
        const i = q.indexOf(p);
        row = i >> 1;
        back = row * 0.18 + (i % 2) * 0.09;
        w.xOff = (i % 2) * 0.09;
        w.slotLat = i % 2 ? PAVE_IN + 1.9 : PAVE_IN + 0.4;
        if (KERB.size > 300) for (const [k2, l] of KERB) if (!l.length) KERB.delete(k2);
      }
      const step = Math.max(0, w.crossAt - back - t.prog);
      const from = Walk.offset(t, w.side), to = Walk.offset(t, w.crossTo);
      const sp = speed * w.pace * T * 1.15; // (a brisker step over the road, px/s)
      if (w.lat === null) {
        // at the kerb: nothing standing across the way over, and nothing coming that would reach us before we're
        // across (V2: after a long wait, anything that can still stop for us in time; never into a moving car)
        // (V2: and from the front of the queue: those behind wait their turn)
        if (row > 0 || !Walk.clearToCross(p, t, from, to, sp, w.wait >= KERB_WAIT)) { w.wait += dt; return step; }
        w.lat = from;
        w.slotLat = undefined;
      }
      const dir = Math.sign(to - w.lat);
      // (V2: and never step into something that has stopped across the way meanwhile: back to the kerb they set out
      // from, rather than standing out in the road, where the drivers wait for anyone on foot (and the car across the
      // way could be one of them, waiting for them: they used to stand there, then walk on through it))
      if (Walk.bodyAt(t, w.lat + dir * 1.4, p)) {
        w.wait += dt;
        const back = from - w.lat;
        if (Math.abs(back) < 0.05) w.lat = null; // (on the kerb again: they wait there, off the road)
        else if (!Walk.bodyAt(t, w.lat - Math.sign(dir) * 1.4, p)) w.lat += Math.sign(back) * Math.min(sp * dt, Math.abs(back));
        return step;
      }
      w.lat += dir * Math.min(sp * dt, Math.abs(to - w.lat));
      if (Math.abs(to - w.lat) < 1e-3) {
        w.side = w.crossTo; w.lat = null; w.wait = 0;
        // (and on from the spot where they crossed; that crossing is behind them)
        w.done = w.crossAt;
        Walk.nextCrossing(t);
        return 0;
      }
      return step;
    }
    return v * dt;
  },

  /** V2: may the walker at the kerb cross from lateral `from` to `to` (px) here? Nothing's body across the way, and
   *  nothing moving that reaches the line before they're over (`relaxed`: that couldn't stop for them in time) */
  clearToCross(p: any, t: any, from: number, to: number, speed: number, relaxed: boolean): boolean {
    const n = Math.max(2, Math.ceil(Math.abs(to - from) / 1.2));
    for (let i = 0; i <= n; i++) if (Walk.bodyAt(t, from + ((to - from) * i) / n, p)) return false;
    const cross = Math.abs(to - from) / Math.max(1, speed) + 1.5; // seconds on the road, and a margin
    for (const ob of Traffic.near(p.x, p.y, 64, NEAR, true)) {
      if (!ob.car) continue;
      const o = ob.o as any;
      const v = ob.v >= 0 ? ob.v : o?.trip ? o.trip.v ?? 0 : o?.v ?? (o?.pause > 0 ? 0 : 1);
      if (v < 0.12) continue; // standing still (its body was checked above)
      // how far it has to go to reach our line, along its heading (tiles)
      const rx = p.x / T - ob.x, ry = p.y / T - ob.y;
      const ahead = rx * ob.hx + ry * ob.hy, side = Math.abs(rx * -ob.hy + ry * ob.hx);
      if (ahead < -ob.len / 2 - 0.3 || side > 0.75) continue; // gone past, or on another street
      const gap = Math.max(0, ahead - ob.len / 2 - 0.2);
      if (relaxed ? gap < (v * v) / (2 * 0.45) + 0.6 : gap / v < cross) return false;
    }
    return true;
  },

  /** V2: is lateral offset `lat` (px) on the walker's path at their spot inside a vehicle's body? */
  bodyAt(t: any, lat: number, me: unknown): boolean {
    const path: number[][] = t.path, n = path.length;
    const prog = Math.max(0, Math.min(n - 1, t.prog));
    const k = Math.round(prog), u = prog - k;
    const [dx, dy] = dirAt(path, k, u >= 0);
    const x = (path[k][0] + 0.5 + dx * u) - (dy * lat) / T, y = (path[k][1] + 0.5 + dy * u) + (dx * lat) / T;
    for (const ob of Traffic.near(x * T, y * T, 24, NEAR2, true)) {
      if (!ob.car || ob.o === me) continue;
      const rx = x - ob.x, ry = y - ob.y;
      if (Math.abs(rx * ob.hx + ry * ob.hy) < ob.len / 2 + 0.05 && Math.abs(rx * -ob.hy + ry * ob.hx) < ob.w + 0.05) return true;
    }
    return false;
  },

  /** the signed lateral offset (px, right of the centreline) of side `s`: the pavement, or the crossing line
   *  across a side street's mouth (the same distance out), with this walker's own line and any step aside
   *  (V2: never in towards the carriageway, where the cars' wing mirrors pass: out onto the verge instead) */
  offset(t: any, s: number): number {
    const w: WalkState = t.walk;
    if (w.slotLat !== undefined && s === w.side) return s * w.slotLat; // (their place in the queue at the kerb)
    const lat = s * (FOOT_PX + w.line) + (w.dodge || 0);
    // (round a car standing on the pavement, a step either side of it is allowed)
    return (w.wide || 0) > 0 ? s * Math.max(0.6, Math.min(PAVE_OUT + 2, lat * s)) : s * Math.max(PAVE_IN, Math.min(PAVE_OUT, lat * s));
  },

  /** where the walker is (sets x, y, dirx/diry: the stretch's axis, hx/hy: their heading) */
  pose(p: any, t: any): void {
    const path: number[][] = t.path, n = path.length, w: WalkState = t.walk;
    const prog = Math.max(0, Math.min(n - 1, t.prog));
    const k = Math.round(prog), u = prog - k;
    const cur = path[k];
    const [ax, ay] = dirAt(path, k, false), [bx, by] = dirAt(path, k, true);
    const cx = cur[0] + 0.5, cy = cur[1] + 0.5;
    const crossing = w.lat !== null;
    const turn = crossing || k === 0 || k === n - 1 ? 0 : turnAt(path, k, 1);
    if (!turn || turn === 2) {
      // a straight stretch, on our pavement's line (or partway over the road)
      const [dx, dy] = u < 0 || k === n - 1 ? [ax, ay] : [bx, by];
      const lat = crossing ? w.lat! : Walk.offset(t, w.side);
      p.x = (cx + dx * u) * T - dy * lat; p.y = (cy + dy * u) * T + dx * lat;
      // (crossing, they face across the road)
      const g = crossing ? Math.sign(Walk.offset(t, w.crossTo) - w.lat!) : 0;
      if (g) { p.hx = -dy * g; p.hy = dx * g; } else { p.hx = dx; p.hy = dy; }
      p.dirx = dx; p.diry = dy;
      return;
    }
    // a corner on our side: round it on the corner's kerb (the arc about the inner corner of the tile)
    const L = (Walk.offset(t, w.side) * w.side) / T;
    const n1x = -ay * w.side, n1y = ax * w.side, n2x = -by * w.side, n2y = bx * w.side;
    const qx = cx - ax * 0.5 + bx * 0.5, qy = cy - ay * 0.5 + by * 0.5;
    const ex = cx - ax * 0.5 + n1x * L, ey = cy - ay * 0.5 + n1y * L;
    const xx = cx + bx * 0.5 + n2x * L, xy = cy + by * 0.5 + n2y * L;
    const r = Math.hypot(ex - qx, ey - qy), a0 = Math.atan2(ey - qy, ex - qx);
    let da = Math.atan2(xy - qy, xx - qx) - a0;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    const a = a0 + da * (u + 0.5), sg = Math.sign(da) || 1;
    p.x = (qx + Math.cos(a) * r) * T; p.y = (qy + Math.sin(a) * r) * T;
    p.hx = -Math.sin(a) * sg; p.hy = Math.cos(a) * sg;
    p.dirx = u < 0 ? ax : bx; p.diry = u < 0 ? ay : by;
  },
};
const NEAR: ReturnType<typeof Traffic.near> = [];
const NEAR2: ReturnType<typeof Traffic.near> = [];

/* ---------- V2: the crowds an incident draws (onlookers, neighbours with buckets, reporters) ----------
   They used to glide in a straight line from their door to the scene in a few seconds, through houses, parked
   cars and the traffic, and stood in a ring that took in the middle of the road. Now each walks (or runs) out to
   the street, along its pavement (round the corners on the kerb), and off it to a spot on the pavement or the
   verge near the scene; on the way they're road users like anyone on foot (sim/traffic.ts). Their progress stays
   `f` (0 at the door … 1 at the spot), so the incident code is unchanged. Positions are V1 pixels. */
interface Route { pts: number[][]; cum: number[]; total: number }
const G_WATER = 1;
const free = (tx: number, ty: number): boolean =>
  World.inB(tx, ty) && !World.isRoad(tx, ty) && !World.isRail(tx, ty) && !World.buildingAt(tx, ty) && World.ground[World.idx(tx, ty)] !== G_WATER;
export const Stroll = {
  /** a spot (px) moved off the carriageway: onto the pavement of the street it's on, or the nearest open ground */
  offRoad(x: number, y: number): { x: number; y: number } {
    const tx = Math.floor(x / T), ty = Math.floor(y / T);
    if (!World.isRoad(tx, ty) && !World.isRail(tx, ty) && !World.buildingAt(tx, ty)) return { x, y };
    if (World.isRoad(tx, ty)) {
      const ew = isRoad(tx - 1, ty) || isRoad(tx + 1, ty), ns = isRoad(tx, ty - 1) || isRoad(tx, ty + 1);
      const lx = x - (tx * T + 8), ly = y - (ty * T + 8);
      // a plain stretch: its pavement, on the side the spot was nearer to (if that side isn't more road)
      if (ew && !ns) { const s = ly >= 0 ? 1 : -1; if (!isRoad(tx, ty + s)) return { x, y: ty * T + 8 + s * (FOOT_PX + 0.3) }; if (!isRoad(tx, ty - s)) return { x, y: ty * T + 8 - s * (FOOT_PX + 0.3) }; }
      if (ns && !ew) { const s = lx >= 0 ? 1 : -1; if (!isRoad(tx + s, ty)) return { x: tx * T + 8 + s * (FOOT_PX + 0.3), y }; if (!isRoad(tx - s, ty)) return { x: tx * T + 8 - s * (FOOT_PX + 0.3), y }; }
    }
    // anywhere else (a junction, a building): the nearest open ground
    for (let r = 6; r <= 40; r += 4)
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        if (free(Math.floor(px / T), Math.floor(py / T))) return { x: px, y: py };
      }
    return { x, y };
  },

  /** the walk from (sx, sy) to (tx, ty): to the street, along the pavement, to the spot */
  route(o: any): Route {
    if (o.route && o.route.sx === o.sx && o.route.tx === o.tx) return o.route.r;
    const pts: number[][] = [[o.sx, o.sy]];
    const a = World.nearestRoad(Math.floor(o.sx / T), Math.floor(o.sy / T), 4), b = World.nearestRoad(Math.floor(o.tx / T), Math.floor(o.ty / T), 6);
    const path: number[][] | null = a && b ? World.roadPath(a.x, a.y, b.x, b.y) : null;
    if (path && path.length) {
      // the pavement on the side of the street the start is on
      const p0 = path[0], p1 = path[1] || p0;
      const dx = Math.sign(p1[0] - p0[0]) || (p1[1] === p0[1] ? 1 : 0), dy = Math.sign(p1[1] - p0[1]);
      const side = (o.sx - (p0[0] * T + 8)) * -dy + (o.sy - (p0[1] * T + 8)) * dx >= 0 ? 1 : -1;
      const pose = { x: 0, y: 0, hx: 1, hy: 0, dx: 1, dy: 0 };
      const n = path.length;
      for (let s = 0; s <= n - 1 + 1e-6; s += 0.25) {
        lanePose(path, Math.min(n - 1, s), side * FOOT_PX, 1, pose);
        pts.push([pose.x, pose.y]);
      }
    }
    pts.push([o.tx, o.ty]);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const r = { pts, cum, total: Math.max(1, cum[cum.length - 1]) };
    o.route = { sx: o.sx, tx: o.tx, r };
    return r;
  },

  /** would the next step (`dir` +1 on towards the spot, −1 back) put them in a vehicle's way? (they wait for it) */
  blocked(o: any, dir: number): boolean {
    const r = Stroll.route(o), keep = o.f;
    o.f = Math.max(0, Math.min(1, keep + (dir * 1.4) / r.total));
    const save = { x: o.x, y: o.y, hx: o.hx, hy: o.hy, dirx: o.dirx, diry: o.diry };
    Stroll.place(o);
    const x = o.x / T, y = o.y / T;
    Object.assign(o, save);
    o.f = keep;
    for (const ob of Traffic.near(x * T, y * T, 24, NEAR2, true)) {
      if (!ob.car) continue;
      const rx = x - ob.x, ry = y - ob.y;
      if (Math.abs(rx * ob.hx + ry * ob.hy) < ob.len / 2 + 0.06 && Math.abs(rx * -ob.hy + ry * ob.hx) < ob.w + 0.06) return true;
    }
    return false;
  },

  /** how fast `f` runs at `px` pixels a second (2.8 a walk, 6 a run) */
  rate(o: any, px: number): number {
    return px / Stroll.route(o).total;
  },

  /** set o.x, o.y and the heading for its progress `f` */
  place(o: any): void {
    const r = Stroll.route(o), d = Math.max(0, Math.min(1, o.f)) * r.total;
    let i = 1;
    while (i < r.cum.length - 1 && r.cum[i] < d) i++;
    const a = r.pts[i - 1], b = r.pts[i], seg = r.cum[i] - r.cum[i - 1] || 1, k = Math.max(0, Math.min(1, (d - r.cum[i - 1]) / seg));
    o.x = a[0] + (b[0] - a[0]) * k; o.y = a[1] + (b[1] - a[1]) * k;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    o.hx = (b[0] - a[0]) / l; o.hy = (b[1] - a[1]) / l;
    o.dirx = o.hx; o.diry = o.hy;
  },
};

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
import { Traffic, FOOT_PX, turnAt } from './traffic';

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
}

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
    for (let k = Math.max(1, Math.ceil(t.prog + 0.51), Math.floor(w.done + 0.5) + 1); k < n - 1; k++) {
      const turn = turnAt(path, k, 1);
      if (turn === 2) { s = -s; continue; } // turning back on the same pavement: it's now on the other hand
      const [dx, dy] = dirAt(path, k, false);
      if ((turn && turn !== s) || (!turn && twinSide(path[k][0], path[k][1], dx, dy, s))) { w.crossAt = k - 0.5; w.crossTo = -s; return; }
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
    let v = speed * w.pace;
    // someone just ahead on this pavement, or coming the other way on our line: step aside, or keep their pace
    const hx = p.hx ?? p.dirx ?? 1, hy = p.hy ?? p.diry ?? 0;
    w.dodgeWant = 0;
    for (const ob of Traffic.near(p.x, p.y, 22, NEAR)) {
      if (ob.car || ob.o === p) continue;
      const o = ob.o as any;
      const rx = o.x - p.x, ry = o.y - p.y;
      const along = rx * hx + ry * hy, across = rx * -hy + ry * hx;
      if (along < 0.5 || along > 14 || Math.abs(across) > 6) continue;
      const same = (o.hx ?? o.dirx ?? 0) * hx + (o.hy ?? o.diry ?? 0) * hy;
      if (Math.abs(across) < 4) {
        if (same > 0.5) {
          // the same way: overtake on the side away from the road if there's room, else fall in behind
          const theirs = o.trip?.walk?.pace ?? 1;
          if (theirs < w.pace - 0.04) w.dodgeWant = across > 0 ? -DODGE * 2 : DODGE * 2;
          else if (along < 9) v = Math.min(v, speed * theirs * (along < 6 ? 0.8 : 1));
        } else if (same < -0.5) w.dodgeWant = across > 0 ? -DODGE * 2 : DODGE * 2; // meeting: both keep right of each other
      }
    }
    // a crossing ahead: walk up to the kerb, wait for a gap, cross straight over
    if (w.crossAt >= 0 && t.prog + v * dt >= w.crossAt) {
      // (people waiting to cross stand a step apart at the kerb, not on one spot)
      const step = Math.max(0, w.crossAt - t.prog - ((((p.seed >>> 0) || 1) % 5) * 0.045));
      const from = Walk.offset(t, w.side), to = Walk.offset(t, w.crossTo);
      if (w.lat === null) {
        // at the kerb: anything coming along this street?
        if (w.wait < KERB_WAIT && Walk.trafficNear(p)) { w.wait += dt; return step; }
        w.lat = from;
      }
      const sp = speed * w.pace * T * 1.15 * dt; // (a brisker step over the road)
      w.lat += Math.sign(to - w.lat) * Math.min(sp, Math.abs(to - w.lat));
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

  /** is a vehicle coming along the street at (p.x, p.y), close enough to matter? */
  trafficNear(p: any): boolean {
    for (const ob of Traffic.near(p.x, p.y, 48, NEAR)) {
      if (!ob.car) continue;
      const o = ob.o as any;
      const v = o.trip ? o.trip.v ?? 0 : o.v ?? (o.pause > 0 ? 0 : 1);
      if (v < 0.15) continue; // standing still: it'll wait for us
      const rx = p.x - o.x, ry = p.y - o.y;
      if (rx * ob.dx + ry * ob.dy > -4) return true; // heading our way (or level with us)
    }
    return false;
  },

  /** the signed lateral offset (px, right of the centreline) of side `s`: the pavement, or the crossing line
   *  across a side street's mouth (the same distance out), with this walker's own line and any step aside */
  offset(t: any, s: number): number {
    const w: WalkState = t.walk;
    return s * (FOOT_PX + w.line) + (w.dodge || 0);
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

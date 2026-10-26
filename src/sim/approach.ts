/* ============================================================
   V2: the roads beyond the map's edge. What comes from off the
   map (visitors' cars, delivery trucks, the county's repair
   van) used to appear out of thin air on the last tile of the
   road at the edge, a dozen trucks at once when the shops ran
   low, in full view of the Planner; and what left vanished
   there. Now each drives in along the road's continuation
   beyond the edge from well past anything that is drawn, one
   behind another, and joins the village's traffic only when
   there's room; what leaves drives away into the distance
   before it's taken off. Positions are V1 pixels (16 a tile):
   beyond the edge they run below 0 or past the map's size.
   ============================================================ */
import { World, GW, GH } from './world';
import { Traffic, LANE_PX } from './traffic';

const T = 16;
/** where an arrival sets off from, and where a departure is taken off: px out from the edge tile's centre (1.1 km,
 *  past the farthest the Planner draws anything) */
export const OFF_FAR = 2200;
/** an arrival waits here for room to pull in (px out from the edge tile's centre; the map's edge is at 8) */
const HOLD = 14;
const CRUISE = 2.6 * T; // px/s on the open road (about 75 km/h)
const TOWN = 1.4 * T; // px/s coming into the village
const BLIND = 16 * T; // px/s where nobody can see it
const ACC = 0.35 * T, DEC = 0.45 * T; // px/s² (as the village's traffic)
const GAP = 0.35 * T; // px bumper to bumper in a queue
/** px between arrivals set off on the same road */
const SPACING = 120;

/** a road that runs off the map: its last tile on the edge, and the way into the map */
export interface Gate { x: number; y: number; dx: number; dy: number }
interface Mover { v: any; g: Gate; len: number; out: boolean; speed: number; joining: boolean; path: number[][]; age: number }

let stamp = -1;
let gates: Gate[] = [];
const movers: Mover[] = [];

/** where a vehicle `off` px out along gate g stands, in its lane, heading in (or out) */
function place(v: any, g: Gate, off: number, out: boolean): void {
  // (the lane is right of the way it's going; y runs south, so right of (fx, fy) is (-fy, fx))
  const fx = out ? -g.dx : g.dx, fy = out ? -g.dy : g.dy;
  v.x = g.x * T + 8 - g.dx * off - fy * LANE_PX;
  v.y = g.y * T + 8 - g.dy * off + fx * LANE_PX;
  v.dirx = v.hx = fx;
  v.diry = v.hy = fy;
}

export const Approach = {
  /** can the player see this point (px)? The client sets it: in front of the camera and within drawing range */
  seen: (_x: number, _y: number): boolean => true,

  /** the roads that run off the map (none to the south: the sea lies that way) */
  gates(force = false): Gate[] {
    if (!force && stamp === World.roadStamp) return gates;
    stamp = World.roadStamp;
    gates = [];
    const R = (x: number, y: number): boolean => World.isRoad(x, y);
    for (let x = 1; x < GW - 1; x++) if (R(x, 0) && R(x, 1)) gates.push({ x, y: 0, dx: 0, dy: 1 });
    for (let y = 1; y < GH - 1; y++) {
      if (R(0, y) && R(1, y)) gates.push({ x: 0, y, dx: 1, dy: 0 });
      if (R(GW - 1, y) && R(GW - 2, y)) gates.push({ x: GW - 1, y, dx: -1, dy: 0 });
    }
    return gates;
  },
  gateAt(x: number, y: number): Gate | null {
    for (const g of this.gates()) if (g.x === x && g.y === y) return g;
    return null;
  },

  /** a vehicle setting off along `path` from a road's edge tile comes in from beyond the edge (false, and it sets off
   *  where it is, when the path doesn't start on one). `len` in tiles */
  arrive(v: any, path: number[][], len = 0.56): boolean {
    const g = path.length > 1 ? this.gateAt(path[0][0], path[0][1]) : null;
    if (!g) return false;
    // (behind the last one to set off on this road)
    let off = OFF_FAR;
    for (const m of movers) if (!m.out && m.g.x === g.x && m.g.y === g.y) off = Math.max(off, m.v.off + SPACING);
    v.off = off;
    movers.push({ v, g, len, out: false, speed: CRUISE, joining: false, path, age: 0 });
    place(v, g, off, false);
    return true;
  },

  /** a vehicle at the end of `path` on a road's edge tile drives on off the map (false when it isn't on one) */
  depart(v: any, path: number[][], len = 0.56): boolean {
    const end = path[path.length - 1];
    const g = end ? this.gateAt(end[0], end[1]) : null;
    if (!g) return false;
    v.off = 0;
    movers.push({ v, g, len, out: true, speed: Math.max(TOWN * 0.4, (v.v || 0) * T), joining: false, path, age: 0 });
    place(v, g, 0, true);
    return true;
  },

  /** is it out beyond the edge (handled here, not by its own system)? */
  away(v: any): boolean {
    return v.off !== undefined;
  },

  tick(dt: number): void {
    if (dt <= 0 || !movers.length) return;
    // arrivals nearest the edge first on each road, so each keeps its distance from the one in front
    movers.sort((a, b) => (a.out === b.out ? (a.g.x - b.g.x) || (a.g.y - b.g.y) || (a.out ? b.v.off - a.v.off : a.v.off - b.v.off) : a.out ? 1 : -1));
    let front: Mover | null = null;
    for (let i = 0; i < movers.length; i++) {
      const m = movers[i], v = m.v;
      m.age += dt;
      if (v.done) { m.age = Infinity; continue; }
      const sameRoad = front && front.g.x === m.g.x && front.g.y === m.g.y && front.out === m.out;
      const blind = !Approach.seen(v.x, v.y);
      if (!m.out) {
        // coming up to the line, the first on the road looks for room on the edge tile and, if there is, drives
        // straight in (the spot is kept for it from then on); otherwise it stops at the line and waits
        if (!m.joining && !sameRoad && v.off <= HOLD + (m.speed * m.speed) / (2 * DEC) + 8 && Traffic.roomToJoin(v, m.path, m.age > 240)) m.joining = true;
        // as fast as still lets it stop at the line, or behind the one in front
        const stop = sameRoad ? front!.v.off + ((front!.len + m.len) / 2) * T + GAP : m.joining ? -1e6 : HOLD;
        const room = Math.max(0, v.off - stop);
        const want = blind ? BLIND : v.off < 10 * T ? TOWN : CRUISE;
        const vmax = Math.min(want, Math.sqrt(2 * DEC * room));
        m.speed = m.speed < vmax ? Math.min(vmax, m.speed + ACC * dt * (blind ? 8 : 1)) : vmax;
        v.off = Math.max(m.joining ? 0 : stop, v.off - m.speed * dt);
        if (m.joining && v.off <= 0.01) {
          v.off = undefined;
          v.v = Math.max(0.3, m.speed / T); // (it carries on at the speed it came in at)
          m.age = Infinity;
          place(v, m.g, 0, false);
          continue;
        }
        place(v, m.g, v.off, false);
      } else {
        // away down the road, gathering speed, and gone well out of sight
        const want = blind && v.off > 30 * T ? BLIND : CRUISE;
        m.speed = Math.min(want, m.speed + ACC * dt * (blind ? 8 : 1));
        v.off += m.speed * dt;
        if (v.off >= OFF_FAR || (blind && v.off > 40 * T)) { v.done = true; m.age = Infinity; }
        place(v, m.g, v.off, true);
      }
      front = m;
    }
    // (and one that waited at the line all day: a lost cause)
    for (let i = movers.length - 1; i >= 0; i--) if (movers[i].age === Infinity || movers[i].age > 1800) {
      const m = movers[i];
      if (m.age !== Infinity) m.v.done = true;
      movers.splice(i, 1);
    }
  },

  /** forget everything (a new map or a loaded save) */
  reset(): void {
    movers.length = 0;
    stamp = -1;
  },
};

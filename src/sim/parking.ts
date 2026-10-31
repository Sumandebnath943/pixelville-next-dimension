/* ============================================================
   Parking (V2, Milestone 8): where a car stands off the road.
   A home's cars stand in its driveway along the right-hand side
   of the plot, nose to the street, one slot each (the slot is the
   car's place in the family's list, so a car always goes back to
   the same spot). Visitors' cars stand in a row of bays across
   the front of a venue's plot. Cars pull out of these spots onto
   the road and turn back into them, so nothing appears in the
   street out of nowhere. Shared by the sim (trips start and end
   here), the renderer (which draws the cars) and the Founder (who
   can take one). Positions in metres.
   ============================================================ */
import { CAT } from './catalog';
import { lanePose } from './traffic';
import { World } from './world';

const TM = 8;
export interface Spot { x: number; z: number; yaw: number }
/** sim seconds a car takes to reverse into its spot at the end of a drive (V2: the least; a longer way in takes longer,
 *  parkPlan) */
export const PARK_TIME = 4;
/** V2: manoeuvring speeds (m/s): creeping out of a drive, rolling on past it, and backing in */
const CREEP = 1.6, ROLL = 2.6, BACK = 1.3;
/** (and never longer than this for one move, sim seconds, however far a spot is) */
const MOVE_MAX = 14;

/** where the plot's frame puts a point (lx, lz) relative to its centre, for a building facing f */
function toWorld(b: any, lx: number, lz: number): [number, number] {
  const f = b.facing || 0;
  const bx = (b.x + b.w / 2) * TM, bz = (b.y + b.h / 2) * TM;
  const [rx, rz] = f === 0 ? [lx, lz] : f === 1 ? [lz, -lx] : f === 2 ? [-lx, -lz] : [-lz, lx];
  return [bx + rx, bz + rz];
}

/** V2: the parking each plot really has room for, worked out by the renderer from what it built (walls, trees,
 *  crops and the way out to the street all clear). The plan's standard places put more than half the driveways and
 *  bays inside the buildings, and the cars drawn there stood in the walls or, where they couldn't be drawn, vanished.
 *  Null headless: the standard places. */
export const Lots = {
  of: null as ((b: any) => { park: Spot[]; drive: Spot[] } | null) | null,
  /** V2: would a car (4.5 × 1.8 m) standing at (x, z) facing yaw be in any wall, fence, hedge or post the renderer
   *  built? (A pulling-out or backing-in car's way is checked against it.) Null headless. */
  blocked: null as ((x: number, z: number, yaw: number) => boolean) | null,
};

/** the driveway slot (0–2) of a home's car, or null if it has none (a fourth car parks in the street) */
export function drivewaySpot(b: any, slot: number): Spot | null {
  const d = CAT[b.type];
  if (!d?.res || slot < 0 || slot > 2) return null;
  const L = Lots.of?.(b);
  if (L) return L.drive[slot] ?? null;
  const W = (d.w || 1) * TM, D = (d.h || 1) * TM;
  const [x, z] = toWorld(b, W / 2 - 1.5 - slot * 2.4, D / 2 - 3.2);
  return { x, z, yaw: ((b.facing || 0) * Math.PI) / 2 };
}

/** parking bay k (0–3) across the front of a workplace's or venue's plot (staff and visitors) */
export function baySpot(b: any, k: number): Spot | null {
  const d = CAT[b.type];
  if (!d || d.res || !d.building || k < 0) return null;
  const L = Lots.of?.(b);
  if (L) return L.park[k] ?? null;
  if (k > 3) return null;
  const W = (d.w || 1) * TM, D = (d.h || 1) * TM;
  if (W < 6) return null;
  // spread across the width the plot has, 2.7 m apart (a car is 1.8 m wide)
  const n = Math.min(4, Math.max(1, Math.floor((W - 2) / 2.7)));
  if (k >= n) return null;
  const [x, z] = toWorld(b, -((n - 1) * 2.7) / 2 + k * 2.7, D / 2 - 2.6);
  // (backed in, nose to the street, like the driveways: they reverse in and drive out)
  return { x, z, yaw: ((b.facing || 0) * Math.PI) / 2 };
}

/** V2: how many cars a workplace's, venue's or car park's plot has bays for */
export function bayCount(b: any): number {
  const d = CAT[b.type];
  if (!d || d.res || !d.building) return 0;
  const L = Lots.of?.(b);
  if (L) return L.park.length;
  const W = (d.w || 1) * TM;
  return W < 6 ? 0 : Math.min(4, Math.max(1, Math.floor((W - 2) / 2.7)));
}

/* ---------- V2: who stands in which bay ----------
   A venue's (or a car park's) bays are each someone's: booked when the driver sets off for it, stood in on arrival,
   given up once the car has pulled out of it again. (They were a count, and a car took the bay numbered by it: with
   cars leaving in any order, the next one parked inside a car still standing there, and a car leaving was drawn
   pulling out of a bay it never stood in.) Not saved: a load starts everyone at home. */
interface Bay { p: any; here: boolean }
function baysOf(b: any): (Bay | null)[] {
  return (b.bays ??= []);
}
/** is a booking still somebody's? (anyone gone home another way, or out of the village, lets theirs go) */
function live(b: any, e: Bay): boolean {
  const p = e.p, t = p.trip;
  if (t && (t.toB === b || t.fromB === b)) return true;
  // (standing there: its driver inside, or walking on from the car park, or over to the polls and back)
  return e.here && !!(p.carHeld || t?.keepCar) && (p.at === b || p.carLotId === b.id);
}
const carOf = (p: any): any => p.carHeld || p.trip?.keepCar;
function recount(b: any): void {
  b.parked = baysOf(b).reduce((n: number, e) => n + (e ? 1 : 0), 0);
}
/** book the first free bay at `b` for `p` (−1: none free) */
export function claimBay(b: any, p: any): number {
  const a = baysOf(b), n = bayCount(b);
  for (let k = 0; k < a.length; k++) if (a[k] && (k >= n || !live(b, a[k]!))) a[k] = null;
  let got = a.findIndex((e) => e?.p === p);
  if (got < 0) for (let k = 0; k < n; k++) if (!a[k]) { a[k] = { p, here: false }; got = k; break; }
  recount(b);
  return got;
}
/** the bay `p` holds at `b` (−1: none) */
export function bayHeld(b: any, p: any): number {
  return b?.bays ? b.bays.findIndex((e: Bay | null) => e?.p === p) : -1;
}
/** `p`'s car has pulled into its bay at `b` */
export function parkInBay(b: any, p: any): void {
  const k = bayHeld(b, p);
  if (k >= 0) b.bays[k].here = true;
}
/** `p`'s car has left its bay at `b` (or the booking is off) */
export function leaveBay(b: any, p: any): void {
  const k = bayHeld(b, p);
  if (k >= 0) { b.bays[k] = null; recount(b); }
}
/** the bays at `b` with a car standing in them: [bay, the car's paint seed] */
export function standingBays(b: any, out: [number, number][] = []): [number, number][] {
  out.length = 0;
  const a: (Bay | null)[] = b.bays || [];
  for (let k = 0; k < a.length; k++) { const e = a[k]; if (e?.here && carOf(e.p)) out.push([k, carOf(e.p).seed || 0]); }
  return out;
}
/** how many of `b`'s bays are free */
export function baysFree(b: any): number {
  const a: (Bay | null)[] = b.bays || [];
  let used = 0;
  for (const e of a) if (e && live(b, e)) used++;
  return Math.max(0, bayCount(b) - used);
}

/** V2: the nearest public car park to `b` with a bay free (within ten tiles' walk of its door), or null */
export function carParkNear(b: any, buildings: any[]): any {
  let best: any = null, bd = 11;
  for (const c of buildings) {
    if (c.type !== 'carpark' || !c.connected || c.ruined || c.construction > 0 || baysFree(c) <= 0) continue;
    const d = Math.abs(c.door.x - b.door.x) + Math.abs(c.door.y - b.door.y);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

/** where a car leaving `b` stands before it pulls out (its own slot at home, else the venue bay it took) */
export function spotFor(b: any, car: any, bay = 0): Spot | null {
  if (!b) return null;
  if (CAT[b.type]?.res) return drivewaySpot(b, (b.cars || []).indexOf(car));
  return baySpot(b, bay);
}

/** V2: the street tile a parking spot's drive comes out on: straight on from its nose (it stands nose to the street)
 *  to the first road tile, the near row of an avenue. (Trips start and end there, not at the door: the door's tile
 *  could be ten metres along the road, and the car went past it and reversed all that way back.) */
export function spotTile(s: Spot): { x: number; y: number } | null {
  const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
  for (let d = 1; d <= 16; d += 0.5) {
    const x = Math.floor((s.x + fx * d) / TM), y = Math.floor((s.z + fz * d) / TM);
    if (World.isRoad(x, y)) return { x, y };
  }
  return null;
}
const HX4 = [0, 1, 0, -1], HY4 = [-1, 0, 1, 0];
/** V2: the heading (0–3, north east south west) to arrive at spot `s`'s street tile by: along the street with the spot
 *  on the right (`side` 1), in the lane on its side (so it never backs in across the oncoming lane), or on the left
 *  (`side` −1: across that lane, the way round when the right side is far round); −1 if the tile has no such way.
 *  (Never head on at the spot, from a side street: it rolled on into the plot to back in.) */
export function kerbHeading(s: Spot, tile: { x: number; y: number }, side = 1): number {
  const ox = s.x / TM - (tile.x + 0.5), oy = s.z / TM - (tile.y + 0.5);
  const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
  let best = -1, bs = 0.05;
  for (let hd = 0; hd < 4; hd++) {
    const hx = HX4[hd], hy = HY4[hd];
    if (!World.isRoad(tile.x - hx, tile.y - hy) || Math.abs(hx * fx + hy * fz) > 0.5) continue; // (in along the street)
    const right = (-hy * ox + hx * oy) * side;
    if (right > bs) { bs = right; best = hd; }
  }
  return best;
}

/** where a parking spot's axis (out through its nose) meets a lane through (lx, lz) heading (hx, hz): the corner a
 *  car turns at, coming out of the spot or backing into it (metres) */
export function axisMeetsLane(s: Spot, lx: number, lz: number, hx: number, hz: number): { x: number; z: number } {
  const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
  const den = fx * -hz + fz * hx;
  let t = Math.abs(den) < 0.2 ? 4 : ((lx - s.x) * -hz + (lz - s.z) * hx) / den;
  t = Math.max(1.5, Math.min(12, t));
  return { x: s.x + fx * t, z: s.z + fz * t };
}

const smooth = (u: number): number => { const k = Math.max(0, Math.min(1, u)); return k * k * (3 - 2 * k); };

/* ---------- V2: the manoeuvres, planned once and shared by the sim, the traffic and the renderer ----------
   Out: creep forward down the drive (it stands nose to the street) and swing round into the lane on a cubic curve,
   ending in the lane a few metres on, where the sim takes over (the sim holds the car there meanwhile, so traffic
   coming up the lane stops for it). In: roll on along the lane until just past the drive, stop, and back in on a
   cubic curve, nose to the street. Each at manoeuvring speed (metres a second, not tiles), so a longer way in takes
   longer. (They were quadratic curves over a fixed time or a tile of the sim's own progress: a car pulled out of a
   ten-metre drive in the time the sim drove eight metres from standstill, and shot into the road; and a spot ten
   metres back down the road was reversed into along the carriageway.) */
interface Curve { ax: number; az: number; bx: number; bz: number; cx: number; cz: number; dx: number; dz: number; len: number }
/** a way into or out of a spot: straight along the spot's axis between the spot and M (out of the plot, where nothing
 *  stands: the drive in front of every spot is clear), and the turn between M and the lane. `lineFirst`: out (the
 *  straight, then the turn); else in (the turn, then the straight). (The turn used to start in the spot, and cars swung
 *  through the car park's sign and lamps.) */
interface Move { sx: number; sz: number; fx: number; fz: number; line: number; c: Curve; lineFirst: boolean; len: number }
export interface OutPlan { c: Move; dur: number; prog: number }
export interface InPlan { qx: number; qz: number; hx: number; hz: number; roll: number; rollT: number; c: Move; revT: number; dur: number }
function curve(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): Curve {
  const k: Curve = { ax, az, bx, bz, cx, cz, dx, dz, len: 0 };
  let px = ax, pz = az;
  for (let i = 1; i <= 16; i++) { const q = bez(k, i / 16); k.len += Math.hypot(q[0] - px, q[1] - pz); px = q[0]; pz = q[1]; }
  return k;
}
/** the spot's own straight: how far out along its axis before the turn may begin (metres): to `turn` metres short of the
 *  lane line at C, at least out past the front of the plot */
function straightTo(s: Spot, c: { x: number; z: number }, turn: number): number {
  return Math.max(0, Math.hypot(c.x - s.x, c.z - s.z) - turn);
}
const MV: [number, number, number, number] = [0, 0, 0, 0];
/** the point `d` metres along a move, and which way it runs there */
function moveAt(m: Move, d: number): [number, number, number, number] {
  const cl = m.c.len;
  const onLine = m.lineFirst ? d < m.line : d > cl;
  if (onLine) {
    const k = m.lineFirst ? d : m.line - (d - cl); // (metres out from the spot along its axis)
    MV[0] = m.sx + m.fx * k; MV[1] = m.sz + m.fz * k; MV[2] = m.lineFirst ? m.fx : -m.fx; MV[3] = m.lineFirst ? m.fz : -m.fz;
    return MV;
  }
  const u = Math.max(0, Math.min(1, (m.lineFirst ? d - m.line : d) / (cl || 1)));
  const q = bez(m.c, u);
  MV[0] = q[0]; MV[1] = q[1]; MV[2] = q[2]; MV[3] = q[3];
  return MV;
}
const BZ: [number, number, number, number] = [0, 0, 0, 0];
/** the point on a curve at u, and which way it runs there */
function bez(k: Curve, u: number): [number, number, number, number] {
  const a = 1 - u;
  BZ[0] = a * a * a * k.ax + 3 * a * a * u * k.bx + 3 * a * u * u * k.cx + u * u * u * k.dx;
  BZ[1] = a * a * a * k.az + 3 * a * a * u * k.bz + 3 * a * u * u * k.cz + u * u * u * k.dz;
  BZ[2] = 3 * a * a * (k.bx - k.ax) + 6 * a * u * (k.cx - k.bx) + 3 * u * u * (k.dx - k.cx);
  BZ[3] = 3 * a * a * (k.bz - k.az) + 6 * a * u * (k.cz - k.bz) + 3 * u * u * (k.dz - k.cz);
  return BZ;
}
const LANE_PT = { x: 0, y: 0, hx: 1, hy: 0, dx: 1, dy: 0 };
/** V2: metres from a car's middle back to its rear axle. A move steers the rear axle (a car's rear wheels follow on
 *  behind, its nose swings wide), and the car stands ahead of it: steering its middle swung its tail out sideways into
 *  the fence down the side of the drive */
const AXLE = 1.3;
/** how far short of the lane line the turn begins (metres): the gentlest first, then later, then earlier */
const TURNS = [3.5, 2.8, 2.2, 1.6, 4.5, 1.0, 5.5];
const PS = { x: 0, z: 0, yaw: 0 };
/** where the car stands `d` metres along a move: its middle, and its nose (out of the spot, the way it's moving;
 *  backing in, against it) */
function poseOn(m: Move, d: number, forward: boolean): { x: number; z: number; yaw: number } {
  const q = moveAt(m, d), l = Math.hypot(q[2], q[3]) || 1;
  const nx = (forward ? q[2] : -q[2]) / l, nz = (forward ? q[3] : -q[3]) / l;
  PS.x = q[0] + nx * AXLE; PS.z = q[1] + nz * AXLE; PS.yaw = Math.atan2(nx, nz);
  return PS;
}
/** is the car clear of every wall, fence, hedge and post all along a move? (Lots.blocked, from the renderer, which
 *  knows what was built; headless, nothing is in the way) */
function clearMove(m: Move, forward: boolean): boolean {
  const hit = Lots.blocked;
  if (!hit) return true;
  for (let d = 0; d <= m.len; d += 0.4) { const q = poseOn(m, d, forward); if (hit(q.x, q.z, q.yaw)) return false; }
  return true;
}
/** the way out of spot `s` onto `path` (lane `lat` px): where it joins the lane, along the path, and the move there */
export function outPlan(s: Spot, path: number[][], lat: number): OutPlan {
  const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
  const l0 = lanePose(path, 0, lat, 1, LANE_PT);
  const c = axisMeetsLane(s, l0.x * 0.5, l0.y * 0.5, l0.hx, l0.hy);
  // (it's in the lane, straight, about a car's length past the corner: or at the start, if the corner is ahead of it)
  const along = ((c.x - l0.x * 0.5) * l0.hx + (c.z - l0.y * 0.5) * l0.hy) + 4.5;
  const prog = Math.max(0, Math.min(Math.min(1.4, path.length - 1), along / TM));
  const e = lanePose(path, prog, lat, 1, LANE_PT);
  const hl = Math.hypot(e.hx, e.hy) || 1, hx = e.hx / hl, hz = e.hy / hl;
  // (all for the rear axle: in the spot, and in the lane where it ends)
  const rx = s.x - fx * AXLE, rz = s.z - fz * AXLE, ex = e.x * 0.5 - hx * AXLE, ez = e.y * 0.5 - hz * AXLE;
  let first: Move | null = null;
  for (const turn of TURNS) {
    // straight down the drive and out of the plot, then round into the lane (a quarter turn about the corner)
    const line = straightTo({ x: rx, z: rz, yaw: s.yaw }, c, turn), mx = rx + fx * line, mz = rz + fz * line;
    const a = Math.max(0.6, Math.hypot(c.x - mx, c.z - mz) * 0.55), b = Math.max(0.6, Math.hypot(ex - c.x, ez - c.z) * 0.55);
    const k = curve(mx, mz, mx + fx * a, mz + fz * a, ex - hx * b, ez - hz * b, ex, ez);
    const m: Move = { sx: rx, sz: rz, fx, fz, line, c: k, lineFirst: true, len: line + k.len };
    first ??= m;
    if (clearMove(m, true)) { first = m; break; }
  }
  return { c: first!, dur: Math.min(MOVE_MAX, 0.6 + first!.len / CREEP), prog };
}
/** the way into spot `s` for a car standing in its lane at (qx, qz) heading (hx, hz), metres */
export function inPlan(s: Spot, qx: number, qz: number, hx: number, hz: number): InPlan {
  const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
  const c = axisMeetsLane(s, qx, qz, hx, hz);
  // (it stops a car's length past the drive, to swing its tail round into it; never backs along the road to get there;
  // come head on at the spot, from a side street, it doesn't roll on at all, into the plot)
  const roll = Math.abs(hx * fx + hz * fz) > 0.5 ? 0 : Math.max(0, (c.x - qx) * hx + (c.z - qz) * hz + 4.5);
  const px = qx + hx * roll - hx * AXLE, pz = qz + hz * roll - hz * AXLE, rx = s.x - fx * AXLE, rz = s.z - fz * AXLE;
  let first: Move | null = null;
  for (const turn of TURNS) {
    // back round the corner until square to the spot, out past the plot, then straight back into it
    const line = straightTo({ x: rx, z: rz, yaw: s.yaw }, c, turn), mx = rx + fx * line, mz = rz + fz * line;
    const a = Math.max(0.6, Math.hypot(px - c.x, pz - c.z) * 0.55), b = Math.max(0.6, Math.hypot(c.x - mx, c.z - mz) * 0.55);
    const k = curve(px, pz, px - hx * a, pz - hz * a, mx + fx * b, mz + fz * b, mx, mz);
    const m: Move = { sx: rx, sz: rz, fx, fz, line, c: k, lineFirst: false, len: line + k.len };
    first ??= m;
    if (clearMove(m, false)) { first = m; break; }
  }
  const rollT = roll > 0.05 ? Math.min(4, roll / ROLL + 0.4) : 0, revT = Math.min(MOVE_MAX, 0.7 + first!.len / BACK);
  return { qx, qz, hx, hz, roll, rollT, c: first!, revT, dur: Math.max(PARK_TIME, rollT + revT) };
}
/** the trip's way into its spot, worked out where it stands at the end of its drive (kept on the trip) */
export function parkPlan(p: any, t: any): InPlan | null {
  if (!t.to) return null;
  if (!t.inPlan) {
    const hl = Math.hypot(p.hx ?? p.dirx ?? 0, p.hy ?? p.diry ?? 1) || 1;
    t.inPlan = inPlan(t.to, p.x * 0.5, p.y * 0.5, (p.hx ?? p.dirx ?? 0) / hl, (p.hy ?? p.diry ?? 1) / hl);
  }
  return t.inPlan;
}
/** how long the trip's car takes to park, sim seconds */
export function parkDuration(p: any, t: any): number {
  return parkPlan(p, t)?.dur ?? PARK_TIME;
}

/**
 * V2 (Milestone 8): where a villager's car is drawn (metres, yaw): in its lane (the sim's x, y), or pulling out of the
 * drive or bay it stood in, or rolling on past its spot and backing in (outPlan, inPlan). `ok` says whether a spot is
 * usable (clear of the building's own walls); off: still off the carriageway. (Shared by the renderer and, V2, the
 * traffic: people on the pavement wait for a car crossing it, and drivers for a car pulling out.)
 */
export function carDrawPose(p: any, t: any, ok: (b: any, s: Spot) => boolean, o = { x: 0, z: 0, yaw: 0, off: false }): { x: number; z: number; yaw: number; off: boolean } {
  o.x = p.x * 0.5; o.z = p.y * 0.5; o.yaw = Math.atan2(p.hx ?? p.dirx ?? 0, p.hy ?? p.diry ?? 1); o.off = false;
  const n = t.path.length;
  const from = t.from && ok(t.fromB || p.at, t.from) ? t.from : null, to = t.to && ok(t.toB || p.dest, t.to) ? t.to : null;
  if (from && t.joined === false) { o.x = from.x; o.z = from.z; o.yaw = from.yaw; o.off = true; return o; }
  if (from && t.out && t.outT !== undefined) {
    // pulling out: down the drive and round into the lane
    const m = t.out.c, d = smooth(Math.min(1, t.outT / t.out.dur)) * m.len, q = poseOn(m, d, true);
    o.x = q.x; o.z = q.z; o.yaw = q.yaw; o.off = d < m.line;
    return o;
  }
  if (to && (t.parkT || 0) > 0 && t.prog >= n - 1) {
    const P = parkPlan(p, t)!, s = t.parkT;
    if (s < P.rollT) {
      // on along the lane, slowing to a stop just past the drive
      const k = P.roll * smooth(s / P.rollT);
      o.x = P.qx + P.hx * k; o.z = P.qz + P.hz * k; o.yaw = Math.atan2(P.hx, P.hz);
      return o;
    }
    // (a moment in reverse gear, then back in, the nose against the way it's moving)
    const m = P.c, d = smooth(Math.max(0, Math.min(1, (s - P.rollT - 0.7) / (P.revT - 0.7)))) * m.len, q = poseOn(m, d, false);
    o.x = q.x; o.z = q.z; o.yaw = q.yaw; o.off = d > m.c.len;
    return o;
  }
  return o;
}

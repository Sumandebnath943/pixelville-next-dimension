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
import { lanePose, LANE_PX } from './traffic';

const TM = 8;
export interface Spot { x: number; z: number; yaw: number }
/** sim seconds a car takes to reverse into its spot at the end of a drive */
export const PARK_TIME = 4;

/** where the plot's frame puts a point (lx, lz) relative to its centre, for a building facing f */
function toWorld(b: any, lx: number, lz: number): [number, number] {
  const f = b.facing || 0;
  const bx = (b.x + b.w / 2) * TM, bz = (b.y + b.h / 2) * TM;
  const [rx, rz] = f === 0 ? [lx, lz] : f === 1 ? [lz, -lx] : f === 2 ? [-lx, -lz] : [-lz, lx];
  return [bx + rx, bz + rz];
}

/** the driveway slot (0–2) of a home's car, or null if it has none (a fourth car parks in the street) */
export function drivewaySpot(b: any, slot: number): Spot | null {
  const d = CAT[b.type];
  if (!d?.res || slot < 0 || slot > 2) return null;
  const W = (d.w || 1) * TM, D = (d.h || 1) * TM;
  const [x, z] = toWorld(b, W / 2 - 1.5 - slot * 2.4, D / 2 - 3.2);
  return { x, z, yaw: ((b.facing || 0) * Math.PI) / 2 };
}

/** parking bay k (0–3) across the front of a workplace's or venue's plot (staff and visitors) */
export function baySpot(b: any, k: number): Spot | null {
  const d = CAT[b.type];
  if (!d || d.res || !d.building || k < 0 || k > 3) return null;
  const W = (d.w || 1) * TM, D = (d.h || 1) * TM;
  if (W < 6) return null;
  // spread across the width the plot has, 2.7 m apart (a car is 1.8 m wide)
  const n = Math.min(4, Math.max(1, Math.floor((W - 2) / 2.7)));
  if (k >= n) return null;
  const [x, z] = toWorld(b, -((n - 1) * 2.7) / 2 + k * 2.7, D / 2 - 2.6);
  // (backed in, nose to the street, like the driveways: they reverse in and drive out)
  return { x, z, yaw: ((b.facing || 0) * Math.PI) / 2 };
}

/** where a car leaving `b` stands before it pulls out (its own slot at home, else the venue bay it took) */
export function spotFor(b: any, car: any, bay = 0): Spot | null {
  if (!b) return null;
  if (CAT[b.type]?.res) return drivewaySpot(b, (b.cars || []).indexOf(car));
  return baySpot(b, bay);
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
/**
 * V2 (Milestone 8): where a villager's car is drawn (metres, yaw): in its lane (the sim's x, y), or pulling out of the
 * drive or bay it stood in (a curve from the spot, out along the drive and round into the lane), or at the end of
 * the drive going past its spot and reversing in. `ok` says whether a spot is usable (clear of the building's own
 * walls); off: still off the carriageway. (Shared by the renderer and, V2, the traffic: people on the pavement wait
 * for a car crossing it.)
 */
export function carDrawPose(p: any, t: any, ok: (b: any, s: Spot) => boolean, o = { x: 0, z: 0, yaw: 0, off: false }): { x: number; z: number; yaw: number; off: boolean } {
  o.x = p.x * 0.5; o.z = p.y * 0.5; o.yaw = Math.atan2(p.hx ?? p.dirx ?? 0, p.hy ?? p.diry ?? 1); o.off = false;
  const n = t.path.length;
  const from = t.from && ok(p.at, t.from) ? t.from : null, to = t.to && ok(p.dest, t.to) ? t.to : null;
  if (from && t.joined === false) { o.x = from.x; o.z = from.z; o.yaw = from.yaw; o.off = true; return o; }
  if (from && t.prog < 1) {
    // out of the spot: a curve from the spot, along its axis to the lane, then round into the lane
    const l0 = lanePose(t.path, 0, (t.lat ?? LANE_PX / 16) * 16);
    const c = axisMeetsLane(from, l0.x * 0.5, l0.y * 0.5, l0.hx, l0.hy);
    const s = t.prog, a = 1 - s;
    const px = a * a * from.x + 2 * a * s * c.x + s * s * o.x, pz = a * a * from.z + 2 * a * s * c.z + s * s * o.z;
    const dx = 2 * a * (c.x - from.x) + 2 * s * (o.x - c.x), dz = 2 * a * (c.z - from.z) + 2 * s * (o.z - c.z);
    o.x = px; o.z = pz; o.yaw = Math.atan2(dx, dz); o.off = s < 0.5;
    return o;
  }
  if (to && (t.parkT || 0) > 0 && t.prog >= n - 1) {
    // into the spot: on along the lane past it, then back in
    const u = Math.min(1, t.parkT / PARK_TIME);
    const hx = Math.sin(o.yaw), hz = Math.cos(o.yaw);
    const c = axisMeetsLane(to, o.x, o.z, hx, hz);
    const past = Math.max(0, (c.x - o.x) * hx + (c.z - o.z) * hz + 3);
    const p0x = o.x + hx * past, p0z = o.z + hz * past;
    if (u < 0.35) {
      const k = smooth(u / 0.35);
      o.x += hx * past * k; o.z += hz * past * k;
      return o;
    }
    const s = smooth((u - 0.35) / 0.65), a = 1 - s;
    const px = a * a * p0x + 2 * a * s * c.x + s * s * to.x, pz = a * a * p0z + 2 * a * s * c.z + s * s * to.z;
    const dx = 2 * a * (c.x - p0x) + 2 * s * (to.x - c.x), dz = 2 * a * (c.z - p0z) + 2 * s * (to.z - c.z);
    o.x = px; o.z = pz; o.off = s > 0.5;
    // reversing: the nose points against the way it's moving
    if (Math.hypot(dx, dz) > 1e-4) o.yaw = Math.atan2(-dx, -dz);
    return o;
  }
  return o;
}

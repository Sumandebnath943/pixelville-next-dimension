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

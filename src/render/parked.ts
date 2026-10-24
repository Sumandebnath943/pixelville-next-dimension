/* ============================================================
   Where the village's cars stand when they're at home: along the
   right-hand side of the plot, nose to the street, up to three a
   driveway. Shared by the renderer (which draws them) and the
   Founder (who can take one), so both agree on every spot.
   ============================================================ */
import * as THREE from 'three';
import { CAT } from '../sim/catalog';
import type { CarStyle } from '../gfx/car';

const TM = 8;
export const CAR_COLORS = ['#c0392b', '#2e86c1', '#f4f6f7', '#1c2833', '#27ae60', '#f39c12', '#8e44ad', '#7f8c8d'].map((h) => new THREE.Color(h));
const CAR_STYLES: CarStyle[] = ['hatch', 'sedan', 'estate', 'suv', 'hatch', 'sedan'];

/** the body style a near car of this paint is drawn with (the renderer picks it the same way) */
export function styleForPaint(c: THREE.Color): CarStyle {
  return CAR_STYLES[(Math.round(c.r * 7) + Math.round(c.g * 5) + Math.round(c.b * 3)) % CAR_STYLES.length];
}

export interface DrivewayCar { b: any; car: any; x: number; z: number; yaw: number; color: THREE.Color }

/** a home's cars standing in its driveway (the free ones, up to three) */
export function drivewayCars(b: any, out: DrivewayCar[] = []): DrivewayCar[] {
  const d = CAT[b.type];
  if (!d?.res || !b.cars || b.ruined || b.construction > 0) return out;
  const f = b.facing || 0;
  const bx = (b.x + b.w / 2) * TM, bz = (b.y + b.h / 2) * TM;
  const W = (d.w || 1) * TM, D = (d.h || 1) * TM;
  const yaw = (f * Math.PI) / 2;
  let k = 0;
  for (const car of b.cars) {
    if (!car.free) continue;
    const lx = W / 2 - 1.5 - k * 2.4, lz = D / 2 - 3.2;
    const [rx, rz] = f === 0 ? [lx, lz] : f === 1 ? [lz, -lx] : f === 2 ? [-lx, -lz] : [-lz, lx];
    out.push({ b, car, x: bx + rx, z: bz + rz, yaw, color: CAR_COLORS[(car.seed || 0) % CAR_COLORS.length] });
    if (++k >= 3) break;
  }
  return out;
}

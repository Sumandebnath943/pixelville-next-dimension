/* ============================================================
   Where the village's cars stand when they're at home: along the
   right-hand side of the plot, nose to the street, up to three a
   driveway. Shared by the renderer (which draws them) and the
   Founder (who can take one), so both agree on every spot.
   ============================================================ */
import * as THREE from 'three';
import { CAT } from '../sim/catalog';
import type { CarStyle } from '../gfx/car';
import { drivewaySpot } from '../sim/parking';

export const CAR_COLORS = ['#c0392b', '#2e86c1', '#f4f6f7', '#1c2833', '#27ae60', '#f39c12', '#8e44ad', '#7f8c8d'].map((h) => new THREE.Color(h));
const CAR_STYLES: CarStyle[] = ['hatch', 'sedan', 'estate', 'suv', 'hatch', 'sedan'];

/** the body style a near car of this paint is drawn with (the renderer picks it the same way) */
export function styleForPaint(c: THREE.Color): CarStyle {
  return CAR_STYLES[(Math.round(c.r * 7) + Math.round(c.g * 5) + Math.round(c.b * 3)) % CAR_STYLES.length];
}

export interface DrivewayCar { b: any; car: any; x: number; z: number; yaw: number; color: THREE.Color }

/** a home's cars standing in its driveway (the free ones; V2 (Milestone 8): each in its own slot, so a car
 *  pulling out leaves a gap rather than the others shuffling up, and comes back to the same spot) */
export function drivewayCars(b: any, out: DrivewayCar[] = []): DrivewayCar[] {
  const d = CAT[b.type];
  if (!d?.res || !b.cars || b.ruined || b.construction > 0) return out;
  b.cars.forEach((car: any, i: number) => {
    if (!car.free) return;
    const s = drivewaySpot(b, i);
    if (s) out.push({ b, car, x: s.x, z: s.z, yaw: s.yaw, color: CAR_COLORS[(car.seed || 0) % CAR_COLORS.length] });
  });
  return out;
}

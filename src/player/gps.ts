/* ============================================================
   GPS (design §4.5): a destination, the road route to it from
   wherever the Founder is, and the distance left. The route is
   re-planned when the Founder strays from it, and the tiles
   already passed are dropped as they go.
   ============================================================ */
import { World } from '../sim/world';

const TM = 8;

export interface Dest { x: number; z: number; label: string }

export class Gps {
  dest: Dest | null = null;
  /** road tiles from near the Founder to near the destination */
  route: number[][] = [];
  /** metres left to go */
  left = 0;
  onArrive: ((d: Dest) => void) | null = null;
  onChange: (() => void) | null = null;
  private t = 0;

  /** head for a point (metres) */
  set(x: number, z: number, label: string): void {
    this.dest = { x, z, label };
    this.route = [];
    this.t = 0;
    this.onChange?.();
  }
  clear(): void {
    this.dest = null;
    this.route = [];
    this.left = 0;
    this.onChange?.();
  }

  update(dt: number, px: number, pz: number): void {
    const d = this.dest;
    if (!d) return;
    if (Math.hypot(px - d.x, pz - d.z) < 12) {
      this.clear();
      this.onArrive?.(d);
      return;
    }
    this.t -= dt;
    const off = this.trim(px, pz);
    if (this.t <= 0 || off > 16) {
      this.t = 3;
      this.plan(px, pz);
      this.trim(px, pz);
    }
    this.left = this.measure(px, pz);
  }

  private plan(px: number, pz: number): void {
    const d = this.dest!;
    const s = World.nearestRoad(Math.floor(px / TM), Math.floor(pz / TM), 6);
    const e = World.nearestRoad(Math.floor(d.x / TM), Math.floor(d.z / TM), 6);
    this.route = (s && e && World.roadPath(s.x, s.y, e.x, e.y)) || [];
  }

  /** drop the tiles already behind the Founder; returns how far the Founder is from the route */
  private trim(px: number, pz: number): number {
    if (!this.route.length) return Infinity;
    let best = 0, bd = Infinity;
    for (let i = 0; i < Math.min(this.route.length, 16); i++) {
      const [x, y] = this.route[i];
      const dd = Math.hypot(x * TM + 4 - px, y * TM + 4 - pz);
      if (dd < bd) { bd = dd; best = i; }
    }
    if (best > 0) this.route = this.route.slice(best);
    return bd;
  }

  private measure(px: number, pz: number): number {
    const d = this.dest!;
    const r = this.route;
    if (!r.length) return Math.hypot(px - d.x, pz - d.z);
    let m = Math.hypot(r[0][0] * TM + 4 - px, r[0][1] * TM + 4 - pz);
    for (let i = 1; i < r.length; i++) m += TM * (Math.abs(r[i][0] - r[i - 1][0]) + Math.abs(r[i][1] - r[i - 1][1]));
    const l = r[r.length - 1];
    return m + Math.hypot(l[0] * TM + 4 - d.x, l[1] * TM + 4 - d.z);
  }
}

/** "340 m" / "1.2 km" */
export function distLabel(m: number): string {
  return m < 950 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1)} km`;
}

/* ============================================================
   The Founder's vehicles (design §10, vehicle ownership): what
   is owned, what each is worth, how much fuel and how many
   dents it has, and where it is — out on the street (only one
   at a time: the one the Founder drives), in the garage at the
   Lodge, or in the impound lot at a police station. Plus the
   showroom models, and the parking rules the wardens enforce.
   ============================================================ */
import { World } from '../sim/world';
import { isJunction } from '../sim/traffic';
import type { CarStyle } from '../gfx/car';

const TM = 8;

export type Kind = 'car' | 'moto';
export interface Model { id: string; name: string; kind: Kind; style: CarStyle | 'moto'; price: number; blurb: string }
/** what the showrooms sell (prices in V1's range: families pay $250–420 for a car) */
export const MODELS: Model[] = [
  { id: 'hatch', name: 'Pixel Hatch', kind: 'car', style: 'hatch', price: 280, blurb: 'Small, nimble, easy to park' },
  { id: 'sedan', name: 'Ville Saloon', kind: 'car', style: 'sedan', price: 360, blurb: 'The family favourite' },
  { id: 'estate', name: 'Meadow Estate', kind: 'car', style: 'estate', price: 410, blurb: 'Room for the whole market run' },
  { id: 'suv', name: 'Ridge 4×4', kind: 'car', style: 'suv', price: 520, blurb: 'High, solid, unbothered by weather' },
  { id: 'moto', name: 'Sprite 125', kind: 'moto', style: 'moto', price: 160, blurb: 'Light and frugal; slips through traffic' },
  { id: 'moto2', name: 'Ridge 650', kind: 'moto', style: 'moto', price: 260, blurb: 'Quick off the lights, a long tank' },
];
export const PAINTS = ['#3e1a5e', '#b0201c', '#1f3a6a', '#e8e6e0', '#151618', '#2f5a3a', '#c8a050', '#7a7f86', '#d06a1a', '#5a8ab8'];
export const PAINT_NAMES = ['Founder violet', 'Post-box red', 'Harbour blue', 'Chalk white', 'Coal black', 'Hedge green', 'Harvest gold', 'Slate grey', 'Ember orange', 'Sky blue'];

/** how each kind drives and drinks */
export const SPEC: Record<Kind, { max: number; accel: number; range: number; tank: number; reach: number; radius: number; repair: number }> = {
  // top speed m/s, acceleration m/s², km on a full tank, $ for a full tank, contact circles: centre offset and radius, $ per point of damage
  car: { max: 30, accel: 9, range: 26, tank: 30, reach: 1.35, radius: 1.0, repair: 1.4 },
  moto: { max: 32, accel: 12, range: 20, tank: 14, reach: 0.65, radius: 0.55, repair: 0.8 },
};

export interface Vehicle {
  id: number;
  model: string; // a MODELS id (or 'founder' for the Founder's own saloon)
  name: string;
  kind: Kind;
  style: CarStyle | 'moto';
  color: string;
  price: number;
  /** 0 (empty) … 1 (full) */
  fuel: number;
  /** 0 (as new) … 100 (wrecked) */
  damage: number;
  where: 'out' | 'lodge' | 'impound';
  /** impounded at this police station, for this fee */
  impound?: { station: number; fee: number };
}

export class Fleet {
  list: Vehicle[] = [];
  /** the one out on the street (0 = none) */
  current = 0;
  /** parking fines the Founder couldn't pay on the spot */
  owed = 0;
  private nextId = 1;

  get cur(): Vehicle | null { return this.list.find((v) => v.id === this.current && v.where === 'out') || null; }

  add(m: Pick<Vehicle, 'model' | 'name' | 'kind' | 'style' | 'color' | 'price'>): Vehicle {
    const v: Vehicle = { ...m, id: this.nextId++, fuel: 1, damage: 0, where: 'lodge' };
    this.list.push(v);
    return v;
  }
  remove(v: Vehicle): void {
    this.list = this.list.filter((q) => q !== v);
    if (this.current === v.id) this.current = 0;
  }
  /** what a showroom will pay for it */
  value(v: Vehicle): number {
    return Math.round(v.price * 0.55 * (1 - (v.damage / 100) * 0.6));
  }

  serialize(): { list: Vehicle[]; current: number; owed: number } {
    return { list: this.list.map((v) => ({ ...v })), current: this.current, owed: Math.round(this.owed) };
  }
  restore(s: { list?: Vehicle[]; current?: number; owed?: number } | null | undefined): void {
    this.list = (s?.list || []).map((v) => ({ ...v }));
    this.current = s?.current || 0;
    this.owed = s?.owed || 0;
    this.nextId = this.list.reduce((m, v) => Math.max(m, v.id), 0) + 1;
  }
}

/**
 * Why a vehicle standing at (x, z) is parked illegally, or null when it's fine:
 * on the railway, in or next to a junction, lights or level crossing, in a bus or
 * taxi bay, or out in the carriageway instead of at the kerb.
 */
export function parkingOffence(x: number, z: number): string | null {
  const tx = Math.floor(x / TM), tz = Math.floor(z / TM);
  if (!World.inB(tx, tz)) return null;
  if (World.isRail(tx, tz)) return 'on the railway';
  if (!World.isRoad(tx, tz)) return null; // off the road: verges, yards, the Lodge drive
  const key = World.idx(tx, tz);
  if (World.signals.has(key) || World.crossings.has(key) || isJunction(tx, tz)) return 'in the middle of a junction';
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = tx + dx, nz = tz + dz;
    if (World.signals.has(World.idx(nx, nz)) || World.crossings.has(World.idx(nx, nz)) || (World.isRoad(nx, nz) && isJunction(nx, nz))) return 'too close to a junction';
  }
  // the stretch of road in front of a bus stop or taxi rank's door
  for (const b of World.buildings) if ((b.type === 'busstop' || b.type === 'taxistand') && Math.abs(b.door.x - tx) + Math.abs(b.door.y - tz) <= 1) return b.type === 'busstop' ? 'in the bus stop' : 'in the taxi rank';
  // at the kerb: within a car's width of a road edge that has no road beyond it
  const ew = World.isRoad(tx - 1, tz) || World.isRoad(tx + 1, tz);
  const ns = World.isRoad(tx, tz - 1) || World.isRoad(tx, tz + 1);
  const edges: number[] = [];
  if (ew && !ns) {
    if (!World.isRoad(tx, tz - 1)) edges.push(Math.abs(z - tz * TM));
    if (!World.isRoad(tx, tz + 1)) edges.push(Math.abs(z - (tz + 1) * TM));
  } else if (ns && !ew) {
    if (!World.isRoad(tx - 1, tz)) edges.push(Math.abs(x - tx * TM));
    if (!World.isRoad(tx + 1, tz)) edges.push(Math.abs(x - (tx + 1) * TM));
  } else if (ew && ns) {
    // a two-tile avenue: the outer edges are the kerbs
    for (const [dx, dz, d] of [[0, -1, Math.abs(z - tz * TM)], [0, 1, Math.abs(z - (tz + 1) * TM)], [-1, 0, Math.abs(x - tx * TM)], [1, 0, Math.abs(x - (tx + 1) * TM)]] as [number, number, number][])
      if (!World.isRoad(tx + dx, tz + dz)) edges.push(d);
  }
  if (!edges.length || Math.min(...edges) > 2.8) return 'out in the road';
  return null;
}

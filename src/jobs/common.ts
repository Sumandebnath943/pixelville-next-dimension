/* ============================================================
   Work shifts (Milestone 6, design §11): what every job shares.
   A job is a loop of real tasks the simulation already makes
   (a fire, a casualty, a fare, a load for a shop, a power cut),
   worked from the street in the Founder's body or at the wheel
   of the workplace's vehicle. The shift manager
   (src/player/shifts.ts) starts and ends it, keeps the clock,
   the pay and the stars, and hands each job this context.
   ============================================================ */
import type * as THREE from 'three';
import { Sim } from '../sim/agents';
import { World } from '../sim/world';
import type { Founder } from '../player/founder';
import type { Gps } from '../player/gps';
import type { Vehicle } from '../player/fleet';
import type { TravelView } from '../player/travel';

export const TM = 8, PX = 0.5;
/** in-game minutes, comparable across days */
export const nowAbs = (): number => Sim.day * 1440 + Sim.clock;
export const active = (b: any): boolean => !!b && b.connected && !b.construction && !b.ruined && World.buildings.includes(b);
/** a building's door, and its middle (metres) */
export const doorM = (b: any): { x: number; z: number } => ({ x: b.door.x * TM + 4, z: b.door.y * TM + 4 });
export const midM = (b: any): { x: number; z: number } => ({ x: (b.x + b.w / 2) * TM, z: (b.y + b.h / 2) * TM });
/** how far (metres) the point is from a building's plot (0 on it) */
export function toPlot(b: any, x: number, z: number): number {
  const dx = Math.max(b.x * TM - x, 0, x - (b.x + b.w) * TM), dz = Math.max(b.y * TM - z, 0, z - (b.y + b.h) * TM);
  return Math.hypot(dx, dz);
}
/** the middle of the road tile nearest a building's door (metres), or its door */
export function kerbM(b: any): { x: number; z: number } {
  const r = World.nearestRoad(b.door.x, b.door.y, 4);
  return r ? { x: r.x * TM + 4, z: r.y * TM + 4 } : doorM(b);
}
/** where a road tile runs: the heading (yaw) along it */
export function roadYaw(tx: number, ty: number): number {
  return World.isRoad(tx - 1, ty) || World.isRoad(tx + 1, ty) ? Math.PI / 2 : 0;
}
export const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
export const money = (n: number): string => `$${Math.round(n)}`;
export const clockOf = (abs: number): string => {
  const t = ((Math.round(abs) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

/** what the jobs draw with (the actors layer, or nothing in tests) */
export interface Draw {
  vehicle(type: string, x: number, y: number, z: number, yaw: number, paint: THREE.Color, opts?: { siren?: boolean; beacon?: boolean; pitch?: number; roll?: number; rotor?: number }): void;
  prop(k: string, x: number, y: number, z: number, yaw?: number, scale?: number, color?: THREE.Color | null): void;
  person(p: { x: number; y: number; z: number; yaw: number; kind: string; seed: number; mode: 'walk' | 'run' | 'stand' | 'lie' | 'sit'; phase: number; shirt?: THREE.Color }): void;
  spray(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void;
}

/** the controls a job reads for the vehicles it flies or drives itself (the train, the plane) */
export interface Controls { gas: number; brake: number; steer: number; pitch: number }

/** what the shift manager gives a job */
export interface ShiftCtx {
  f: Founder;
  gps: Gps;
  /** the workplace the shift was started at (a fire station, a farm, a building site…) */
  b: any;
  /** a personal toast (`news`: the village hears of it too) */
  toast(m: string, at?: { x: number; y: number }, news?: boolean): void;
  /** money for the shift: added up and paid at clock-off */
  earn(amount: number, why: string): void;
  /** the shift went well (stars up), or a task went wrong (stars down) */
  good(k?: number): void;
  bad(why: string): void;
  /** the shift's own vehicle, if it has one, and whether the Founder is at its wheel */
  vehicle(): Vehicle | null;
  atWheel(): boolean;
  /** throttle, brake, steering and pitch (keyboard, pad or touch) */
  controls(): Controls;
  /** the room the Founder is in, if any (the shop shift works indoors) */
  indoors(): any | null;
  /** the journey screens (the pilot flies between cities behind them) */
  travelView(): TravelView | null;
}

/** the prompt line a job offers: what E does here and now */
export interface Act { text: string; act: () => void }

export interface Job {
  /** the shift panel's line: what to do now, more detail, and progress (0…1) */
  objective(): { text: string; sub?: string; k?: number };
  update(dt: number): void;
  /** what E does right now (null: nothing for the job here) */
  interaction(): Act | null;
  /** a call from the sim (a fire, a casualty, a break-in, a power cut): take it? */
  claim?(kind: string, scene: any): boolean;
  /** the Founder is in the cab of something the job drives itself (main.ts leaves them be) */
  carrying?(): boolean;
  /** the prompt while carrying (and E's action, if any) */
  line?(): Act | null;
  /** the job's own screen over the world (the pilot between cities) */
  overlay?(): boolean;
  frame?(now: number): void;
  /** mid-task (a patient aboard, a fare in the back): the shift runs on a little past its end */
  busy?(): boolean;
  /** clock-off isn't possible right now (in the air) */
  locked?(): string | null;
  /** where to show the job's marker (metres): the fire, the fare, the customer */
  marker?(): { x: number; y: number; z: number; icon: string } | null;
  draw?(d: Draw): void;
  /** the shift is over: hand everything back to the village */
  end(): void;
}

/** a piece of work done on the spot (treating, mending, filming): progresses while it can */
export class Work {
  t = 0;
  constructor(public need: number) {}
  /** `dt` seconds of work if `ok`; true when it's done */
  step(dt: number, ok: boolean): boolean {
    if (ok) this.t = Math.min(this.need, this.t + dt);
    return this.t >= this.need;
  }
  get k(): number { return this.need ? this.t / this.need : 1; }
}

/** where the Founder is: on foot, or the vehicle they're driving (metres) */
export function here(f: Founder): { x: number; z: number } {
  return f.driving ? { x: f.car.x, z: f.car.z } : { x: f.pos.x, z: f.pos.z };
}
export function distTo(f: Founder, x: number, z: number): number {
  const h = here(f);
  return Math.hypot(h.x - x, h.z - z);
}
/** on foot within `r` metres of (x, z) */
export function onFootNear(f: Founder, x: number, z: number, r: number): boolean {
  return !f.driving && Math.hypot(f.pos.x - x, f.pos.z - z) < r;
}
/** stopped (or on foot) within `r` metres of (x, z) */
export function stoppedNear(f: Founder, x: number, z: number, r: number): boolean {
  if (!f.driving) return Math.hypot(f.pos.x - x, f.pos.z - z) < r;
  return Math.abs(f.car.speed) < 1.2 && Math.hypot(f.car.x - x, f.car.z - z) < r;
}
/** is the Founder looking toward (x, z), within `cone` radians (the camera's heading) */
export function facing(f: Founder, x: number, z: number, cone: number): boolean {
  const want = Math.atan2(x - f.pos.x, z - f.pos.z);
  return Math.abs(wrap(want - f.camYaw)) < cone;
}
/** the nearest of `list` to (x, z) by door, or null */
export function nearestDoor<T>(list: T[], x: number, z: number, door: (o: T) => { x: number; z: number } = (o: any) => doorM(o)): T | null {
  let best: T | null = null, bd = Infinity;
  for (const o of list) {
    const p = door(o), d = Math.hypot(p.x - x, p.z - z);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

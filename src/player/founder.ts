/* ============================================================
   The Founder: the player's body in the world (design §4).
   Walk, run and jump in third or first person; get into the
   Founder's own car and drive it with arcade handling. Collides
   with buildings, trees, open water and the map edge.
   ============================================================ */
import * as THREE from 'three';
import { World, GW, GH } from '../sim/world';
import { Settings } from '../sim/settings';
import { Input } from '../input/input';
import { heightAt, isWaterAt, treeSpot, postsNear } from '../render/terrain';
import { drivewayCars, DrivewayCar } from '../render/parked';
import { baySpot } from '../sim/parking';
import { CAT } from '../sim/catalog';
import type { BuildingLayer } from '../render/buildings';
import { emit, on } from '../sim/core';
import type { FounderSave } from '../sim/game';
import { Person } from '../gfx/person';
import { Car as CarModel, Moto, Bike, Ride, CarStyle, addBeam } from '../gfx/car';
import { Fleet, Vehicle, specOf } from './fleet';
import type { BagItem } from './shopping';
import { surface } from '../gfx/surface';
import { ENV } from '../gfx/env';
import { Traffic, PAVEMENT_M } from '../sim/traffic';
import { Life } from '../sim/life';
import { Sim } from '../sim/agents';
import { Wallet, Entry } from './wallet';

const TM = 8;
/** a tile's four corners: which neighbours make it an inner corner, and where it is in the tile */
const CORNERS = [[-1, -1, 0, 0], [1, -1, TM, 0], [-1, 1, 0, TM], [1, 1, TM, TM]] as const;
const R_BODY = 0.38;
const GRAV = 22;
/** how far the street camera keeps from walls (the near plane's corners reach ~0.44 m) */
const CAM_RADIUS = 0.45;

/** how far (m) a camera at (x, y, z) must rise to clear the leaves of the trees around it: each crown is an
 *  ellipsoid sized like the street trees (11–18 m tall, the crown from about a third of the way up) */
export function crownLift(x: number, y: number, z: number): number {
  const tx = Math.floor(x / TM), tz = Math.floor(z / TM);
  let lift = 0;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const gx = tx + i, gz = tz + j;
      if (!World.inB(gx, gz) || !World.tree[World.idx(gx, gz)]) continue;
      const t = treeSpot(gx, gz), H = 14 * t.s, rx = 0.32 * H + CAM_RADIUS;
      const d2 = ((x - t.x) ** 2 + (z - t.z) ** 2) / (rx * rx);
      if (d2 >= 1) continue;
      const base = Math.max(0, heightAt(t.x, t.z)), cy = base + 0.62 * H, ry = 0.42 * H + CAM_RADIUS;
      const top = cy + ry * Math.sqrt(1 - d2);
      if (y > cy - ry * Math.sqrt(1 - d2) && y < top) lift = Math.max(lift, top - y + 0.5);
    }
  return lift;
}

/** push circle p (radius r) out of a capsule: a vehicle at (x, z) facing yaw, `reach` from its middle to the
 *  centres of its end circles, `rad` wide each side; true if it touched */
function capsule(p: { x: number; z: number }, r: number, x: number, z: number, yaw: number, reach: number, rad: number): boolean {
  const fx = Math.sin(yaw), fz = Math.cos(yaw), rr = rad + r;
  const t = Math.max(-reach, Math.min(reach, (p.x - x) * fx + (p.z - z) * fz));
  const cx = x + fx * t, cz = z + fz * t, dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
  if (d >= rr) return false;
  if (d < 1e-4) { p.x = cx - fz * rr; p.z = cz + fx * rr; return true; }
  p.x = cx + (dx / d) * rr;
  p.z = cz + (dz / d) * rr;
  return true;
}

/** where a ray from o (inverse direction i) first enters the box, if before `max` (else Infinity) */
function slab(ox: number, oy: number, oz: number, ix: number, iy: number, iz: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, max: number): number {
  let t0 = 0, t1 = max;
  let a = (x0 - ox) * ix, c = (x1 - ox) * ix;
  t0 = Math.max(t0, Math.min(a, c)); t1 = Math.min(t1, Math.max(a, c));
  a = (y0 - oy) * iy; c = (y1 - oy) * iy;
  t0 = Math.max(t0, Math.min(a, c)); t1 = Math.min(t1, Math.max(a, c));
  a = (z0 - oz) * iz; c = (z1 - oz) * iz;
  t0 = Math.max(t0, Math.min(a, c)); t1 = Math.min(t1, Math.max(a, c));
  return t0 <= t1 ? t0 : Infinity;
}

export interface Car { x: number; z: number; yaw: number; speed: number; y: number; pitch: number }
/** a road rule the Founder broke, or harm they caused (the wanted level and reputation read these) */
export interface Offence { kind: 'red light' | 'speeding' | 'wrong side' | 'bump' | 'crash' | 'hit' | 'ram' | 'theft'; day: number; clock: number; x: number; z: number; at: number }
const SPEED_LIMIT = 60 / 3.6; // town streets, with a little grace over 50 km/h

export class Founder {
  pos = new THREE.Vector3();
  vy = 0;
  yaw = 0; // body facing
  camYaw = 0;
  camPitch = -0.18;
  camDist = 5.5;
  firstPerson = !!Settings.get('firstPerson');
  onGround = true;
  driving = false;
  car: Car = { x: 0, z: 0, yaw: 0, speed: 0, y: 0, pitch: 0 };
  /** the Founder's money: a balance and a ledger */
  purse = new Wallet();
  get wallet(): number { return this.purse.balance; }
  mesh = new THREE.Group();
  carMesh = new THREE.Group();
  private phase = 0;
  private camPos = new THREE.Vector3();
  private camInit = false;
  private camSets: Float32Array[] = [];
  speedKmh = 0;
  /** what the Founder did on the road, newest last */
  offences: Offence[] = [];
  /** everything the Founder owns on wheels; `car` above is the physics of the one in hand */
  fleet = new Fleet();
  /** a car taken from a family's drive: in hand while it's driven; it goes back to them when left */
  hijacked: Vehicle | null = null;
  /** where the owned vehicle that's out stands while the Founder drives a stolen one */
  leftAt: { x: number; z: number; yaw: number } | null = null;
  /** told when the stolen car is left behind (it stands at x, z until it's returned) */
  onAbandon: ((v: Vehicle, x: number, z: number, yaw: number) => void) | null = null;
  /** told of a crash so violent the Founder is hurt (impact speed, m/s) */
  onWreck: ((impact: number) => void) | null = null;
  /** V2 (Milestone 6): a workplace's vehicle for a shift (the fire engine, the bus…); the owned one waits where it was left */
  work: Vehicle | null = null;
  /** blue lights (or an amber beacon) on the work vehicle; while answering a call the road rules give way */
  siren = false;
  beacon = false;
  exempt = false;
  /** the vehicle in hand: a work vehicle, a stolen one, or the owned one that's out */
  get vehicle(): Vehicle | null { return this.work ?? this.hijacked ?? this.fleet.cur; }
  /** the dents in the vehicle in hand, 0 (as new) … 100 (wrecked) */
  get damage(): number { return this.vehicle?.damage ?? 0; }
  set damage(d: number) { const v = this.vehicle; if (v) v.damage = Math.max(0, Math.min(100, d)); }
  /** where the owned vehicle that's out stands (null when none is out) */
  ownedAt(): { x: number; z: number } | null {
    if (!this.fleet.cur) return null;
    return this.hijacked || this.work ? this.leftAt : { x: this.car.x, z: this.car.z };
  }
  private parkedMesh = new THREE.Group();
  private parkedRide: Ride | null = null;
  private stillT = 0;
  /** V2: where the car last stood clear of everything (to back it out of open water) */
  private lastFree = new THREE.Vector2();
  private speedT = 0;
  private wrongT = 0;
  private lastTile = -1;
  private ruleCd: Record<string, number> = {};
  private bumpCd = 0;

  constructor(scene: THREE.Scene, private buildings: BuildingLayer) {
    this.buildBody();
    scene.add(this.mesh, this.carMesh, this.parkedMesh);
    on('founderHit', (h) => this.runOver(h.speed, h.mass, h.what, h.dx, h.dy));
  }

  /* ---------- V2 (Milestone 8): the Founder on foot is as breakable as anyone ---------- */
  /** 0 … 100; it mends by itself a few seconds after the last knock */
  health = 100;
  /** seconds left on the ground after being knocked down */
  downT = 0;
  private hurtT = 0;
  /** told when a vehicle hits the Founder (damage dealt, what it was); `onWreck` follows if it was too much */
  onHurt: ((damage: number, what: string) => void) | null = null;
  /** a vehicle ran into the Founder on foot: hurt by how fast and how big it was, knocked aside and down */
  runOver(speed: number, mass: number, what: string, dx: number, dy: number): void {
    if (this.driving || this.passenger) return;
    const dmg = Math.round(Math.min(100, speed * mass * 4.2));
    if (dmg < 4) return;
    this.health = Math.max(0, this.health - dmg);
    this.hurtT = 0;
    this.downT = Math.min(3.5, 0.8 + dmg / 30);
    // thrown along the way it was going, and a little to the side
    const l = Math.hypot(dx, dy) || 1, k = Math.min(4, 0.6 + speed * 0.18);
    const p = { x: this.pos.x + (dx / l) * k + (dy / l) * 0.6, z: this.pos.z + (dy / l) * k - (dx / l) * 0.6 };
    this.collide(p, R_BODY);
    this.pos.x = p.x; this.pos.z = p.z;
    emit('sound', { name: 'crunch' });
    this.onHurt?.(dmg, what);
    if (this.health <= 0) { this.health = 100; this.downT = 0; this.onWreck?.(99); }
  }
  private mend(dt: number): void {
    this.downT = Math.max(0, this.downT - dt);
    this.hurtT += dt;
    if (this.hurtT > 6 && this.health < 100) this.health = Math.min(100, this.health + dt * 4);
  }

  /* the Founder: a deep-violet coat, a gold scarf, a wide-brimmed hat */
  private person!: Person;
  private ride: Ride | null = null;
  private lastCar = { speed: 0, yaw: 0 };
  private buildBody(): void {
    const c = (h: string): THREE.Color => new THREE.Color(h);
    this.person = new Person({
      height: 1.83, build: 1.04, female: false, skin: c('#e0ac85'), hair: c('#3a2618'),
      top: c('#4a2a6a'), legs: c('#2a2238'), shoes: c('#16121a'), longHair: false, longSleeves: true, skirt: false, coat: c('#4a2a6a'),
    });
    this.person.carriesUmbrella = false;
    this.mesh.add(this.person.root);
    const felt = surface(new THREE.MeshStandardMaterial({ color: 0x1e1a24, roughness: 0.75 }), { snow: 0.8, wet: 0.5 }, 'felt');
    const gold = new THREE.MeshStandardMaterial({ color: 0xc9a24a, roughness: 0.35, metalness: 0.6 });
    const hat = new THREE.Group();
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.022, 28), felt);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.125, 0.16, 24), felt);
    crown.position.y = 0.085;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.127, 0.127, 0.035, 24), gold);
    band.position.y = 0.03;
    hat.add(brim, crown, band);
    hat.position.set(0, 0.185, 0.005);
    hat.rotation.x = -0.05;
    hat.traverse((o) => (o.castShadow = true));
    this.person.bones.head.add(hat);
    const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.066, 0.016, 8, 24), surface(new THREE.MeshStandardMaterial({ color: 0xb8902e, roughness: 0.9 }), { snow: 0.6, wet: 0.6 }, 'scarf'));
    scarf.rotation.x = Math.PI / 2;
    scarf.scale.set(1.15, 1, 0.95);
    scarf.position.set(0, 0.0, 0.008);
    this.person.bones.neck.add(scarf);
    // a faint golden glow at the Founder's feet — villagers say buildings rise where it walks
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.62, 32), new THREE.MeshBasicMaterial({ color: 0xffd060, transparent: true, opacity: 0.3, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    this.mesh.add(ring);
  }

  /** draw the vehicle that's out (or none) */
  private setRide(v: Vehicle | null): void {
    if (this.ride) this.carMesh.remove(this.ride.root);
    this.ride = null;
    this.carMesh.visible = !!v;
    if (!v) return;
    const col = new THREE.Color(v.color);
    if (v.work) {
      // a cab or a patrol car is a full model; the fire engine, the bus, the ambulance and the rest are
      // the village's own instanced models (src/player/shifts.ts draws them), with the headlamps here
      const t = v.work.type;
      // (V2 (Milestone 8): a hired mountain bike is ridden, and drawn, here)
      if (t === 'bike') { this.ride = new Bike(col); this.carMesh.add(this.ride.root); return; }
      if (t !== 'police' && t !== 'taxi') return;
      this.ride = new CarModel(t === 'police' ? 'estate' : 'sedan', col, t !== 'taxi', t);
    } else this.ride = v.kind === 'moto' ? new Moto(col) : new CarModel(v.style as CarStyle, col, true);
    this.carMesh.add(this.ride.root);
  }

  /** draw (or stop drawing) the owned vehicle left standing while a stolen one is in hand */
  private showParked(v: Vehicle | null): void {
    if (this.parkedRide) this.parkedMesh.remove(this.parkedRide.root);
    this.parkedRide = null;
    if (!v || !this.leftAt) return;
    this.parkedRide = v.kind === 'moto' ? new Moto(new THREE.Color(v.color)) : new CarModel(v.style as CarStyle, new THREE.Color(v.color), true);
    this.parkedMesh.add(this.parkedRide.root);
    this.parkedRide.drive(0.016, this.leftAt.x, this.leftAt.z, this.leftAt.yaw, 0, 0, 0, this.groundAt(this.leftAt.x, this.leftAt.z));
  }

  /** take a stolen car in hand and get in; an owned vehicle that's out stays standing where it is */
  hijack(v: Vehicle, x: number, z: number, yaw: number): void {
    if (this.driving) this.exitCar();
    if (this.work) this.dropWork();
    if (this.hijacked) this.dropHijacked();
    if (this.fleet.cur && !this.leftAt) {
      this.leftAt = { x: this.car.x, z: this.car.z, yaw: this.car.yaw };
      this.showParked(this.fleet.cur);
    }
    this.hijacked = v;
    Object.assign(this.car, { x, z, yaw, speed: 0, y: this.groundAt(x, z), pitch: 0 });
    this.setRide(v);
    this.driving = true;
    this.camYaw = yaw;
  }
  /** leave the stolen car where it stands; the owned vehicle (if one is out) is in hand again */
  dropHijacked(): void {
    const v = this.hijacked;
    if (!v) return;
    if (this.driving) this.exitCar();
    const at = { x: this.car.x, z: this.car.z, yaw: this.car.yaw };
    this.hijacked = null;
    if (this.fleet.cur && this.leftAt) {
      Object.assign(this.car, { ...this.leftAt, speed: 0, y: this.groundAt(this.leftAt.x, this.leftAt.z), pitch: 0 });
      this.setRide(this.fleet.cur);
    } else this.setRide(null);
    this.leftAt = null;
    this.showParked(null);
    this.onAbandon?.(v, at.x, at.z, at.yaw);
  }
  /** on foot beside the owned vehicle left standing (while on a shift it waits for the end of it) */
  nearLeft(): boolean {
    return !this.driving && !this.work && !!this.leftAt && Math.hypot(this.pos.x - this.leftAt.x, this.pos.z - this.leftAt.z) < 3.4;
  }

  /* ---------- V2 (Milestone 6): a work vehicle for a shift ---------- */
  /** take a workplace's vehicle at (x, z) facing `yaw`; the owned one (if out) stays standing where it is */
  takeWork(v: Vehicle, x: number, z: number, yaw: number): void {
    if (this.driving) this.exitCar();
    if (this.hijacked) this.dropHijacked();
    if (this.work) this.dropWork();
    if (this.fleet.cur && !this.leftAt) {
      this.leftAt = { x: this.car.x, z: this.car.z, yaw: this.car.yaw };
      this.showParked(this.fleet.cur);
    }
    this.work = v;
    Object.assign(this.car, { x, z, yaw, speed: 0, y: this.groundAt(x, z), pitch: 0 });
    this.setRide(v);
  }
  /** the work vehicle goes back to its depot; the owned vehicle (if one is out) is in hand again */
  dropWork(): void {
    if (!this.work) return;
    if (this.driving) this.exitCar();
    this.work = null;
    this.siren = this.beacon = this.exempt = false;
    if (this.fleet.cur && this.leftAt) {
      Object.assign(this.car, { ...this.leftAt, speed: 0, y: this.groundAt(this.leftAt.x, this.leftAt.z), pitch: 0 });
      this.setRide(this.fleet.cur);
    } else this.setRide(null);
    this.leftAt = null;
    this.showParked(null);
  }

  /** start beside the Lodge (or wherever a save put us) */
  spawn(lodge: any, save?: FounderSave | null): void {
    if (!save) { // a new village: a fresh start
      this.purse.restore(undefined, []);
      this.offences = [];
    }
    // nothing stolen survives a load: the car goes home, the record back into its family's drive
    // (nor does a shift: the work vehicle is back at its depot)
    this.hijacked = null;
    this.work = null;
    this.siren = this.beacon = this.exempt = false;
    this.leftAt = null;
    this.showParked(null);
    for (const r of (save?.returnCars || []) as { home: number; car: any }[]) {
      const home = World.buildings.find((b: any) => b.id === r.home);
      if (home && home.cars && !home.cars.includes(r.car)) home.cars.push({ ...r.car, free: true });
    }
    this.fleet.restore(save?.fleet as any);
    this.bag = (save?.bag || []).slice(-16);
    if (!this.fleet.list.length) {
      // the Founder's own saloon (also for saves from before vehicles could be owned)
      const v = this.fleet.add({ model: 'founder', name: "Founder's saloon", kind: 'car', style: 'sedan', color: '#3e1a5e', price: 340 });
      v.where = 'out';
      v.damage = save?.damage ?? 0;
      this.fleet.current = v.id;
    }
    if (save) {
      this.pos.set(save.x, save.y, save.z);
      this.yaw = this.camYaw = save.yaw;
      this.purse.restore(save.wallet, save.ledger as Entry[] | undefined);
      if (save.car) Object.assign(this.car, { x: save.car.x, z: save.car.z, yaw: save.car.yaw, speed: 0 });
      else this.parkCarAtLodge(lodge);
    } else if (lodge) {
      const dx = lodge.door.x * TM + 4, dz = lodge.door.y * TM + 4;
      const cx = (lodge.x + lodge.w / 2) * TM, cz = (lodge.y + lodge.h / 2) * TM;
      this.pos.set(dx + (dx - cx) * 0.05, 0, dz + (dz - cz) * 0.05);
      this.yaw = this.camYaw = Math.atan2(dx - cx, dz - cz);
      this.parkCarAtLodge(lodge);
    } else {
      this.pos.set((GW / 2) * TM, 0, (GH / 2) * TM);
    }
    this.driving = false;
    this.pos.y = this.groundAt(this.pos.x, this.pos.z);
    this.car.y = this.groundAt(this.car.x, this.car.z);
    this.camInit = false;
    this.setRide(this.fleet.cur);
  }
  /** the spot in the Lodge's drive where a vehicle is brought out */
  lodgeSpot(lodge: any): { x: number; z: number; yaw: number } {
    const dx = lodge.door.x * TM + 4, dz = lodge.door.y * TM + 4;
    const cx = (lodge.x + lodge.w / 2) * TM, cz = (lodge.y + lodge.h / 2) * TM;
    const out = Math.atan2(dx - cx, dz - cz);
    // to the side of the door, nose toward the street
    return { x: dx + Math.cos(out) * 5.5, z: dz - Math.sin(out) * 5.5, yaw: out };
  }
  private parkCarAtLodge(lodge: any): void {
    if (!lodge) return;
    const s = this.lodgeSpot(lodge);
    Object.assign(this.car, { x: s.x, z: s.z, yaw: s.yaw, speed: 0 });
  }

  /** bring `v` out at (x, z) facing `yaw`; whatever was out goes back to the Lodge garage */
  useVehicle(v: Vehicle, x: number, z: number, yaw: number): void {
    if (this.work) this.dropWork();
    if (this.hijacked) this.dropHijacked();
    if (this.driving) this.exitCar();
    const prev = this.fleet.cur;
    if (prev && prev !== v) prev.where = 'lodge';
    v.where = 'out';
    delete v.impound;
    this.fleet.current = v.id;
    Object.assign(this.car, { x, z, yaw, speed: 0, y: this.groundAt(x, z), pitch: 0 });
    this.setRide(v);
  }
  /** put the vehicle that's out away (into the garage, or the impound lot); none is out afterwards */
  stow(where: 'lodge' | 'impound'): Vehicle | null {
    const v = this.fleet.cur;
    if (!v) return null;
    if (this.hijacked || this.work) { // the owned one is the vehicle left standing: it goes, the other stays in hand
      v.where = where;
      this.fleet.current = 0;
      this.leftAt = null;
      this.showParked(null);
      return v;
    }
    if (this.driving) this.exitCar();
    v.where = where;
    this.fleet.current = 0;
    this.setRide(null);
    return v;
  }

  /** what the Founder is carrying: things bought over counters, tickets for the journey */
  bag: BagItem[] = [];

  /** stolen cars still away from home (the one in hand, any left standing), for a save to send back */
  pendingReturns: () => { home: number; car: any }[] = () => [];

  save(): FounderSave {
    // a save keeps no stolen car: the owned vehicle's own spot is saved, and the stolen one goes home on load
    const at = this.hijacked || this.work ? this.leftAt : { x: this.car.x, z: this.car.z, yaw: this.car.yaw };
    const returnCars = [...this.pendingReturns()];
    if (this.hijacked?.stolen) returnCars.push({ home: this.hijacked.stolen.home, car: this.hijacked.stolen.car });
    return {
      x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yaw, car: at ? { x: at.x, z: at.z, yaw: at.yaw } : null,
      wallet: Math.round(this.wallet), ledger: this.purse.ledger.slice(-80), damage: Math.round(this.fleet.cur?.damage ?? 0),
      fleet: this.fleet.serialize(), returnCars, bag: this.bag.slice(),
    };
  }

  /* ---------- ground & collisions ---------- */
  groundAt(x: number, z: number): number {
    const h = heightAt(x, z);
    if (h > 0.3) return h;
    const tx = Math.floor(x / TM), tz = Math.floor(z / TM);
    if (!World.isRoad(tx, tz)) return Math.max(0, h);
    const base = World.ground[World.idx(tx, tz)] === 1 ? 0.25 : 0.03;
    if (World.ground[World.idx(tx, tz)] === 1) return base;
    // the raised pavement strip along kerbs that face open ground (V2 (Milestone 8): and the quarter-round
    // pavement at a junction's inner corners)
    const lx = x - tx * TM, lz = z - tz * TM;
    const SW = PAVEMENT_M;
    const R = (i: number, j: number): boolean => World.isRoad(tx + i, tz + j);
    if ((lz < SW && !R(0, -1)) || (lz > TM - SW && !R(0, 1)) || (lx < SW && !R(-1, 0)) || (lx > TM - SW && !R(1, 0))) return base + 0.17;
    for (const [i, j, cx, cz] of CORNERS) if (R(i, 0) && R(0, j) && !R(i, j) && Math.hypot(lx - cx, lz - cz) < SW) return base + 0.17;
    return base;
  }

  /** push a circle out of every solid it overlaps; returns true if it hit something */
  collide(p: { x: number; z: number }, r: number): boolean {
    let hit = false;
    // map edge
    const maxX = GW * TM - 1, maxZ = GH * TM - 1;
    if (p.x < 1) { p.x = 1; hit = true; }
    if (p.z < 1) { p.z = 1; hit = true; }
    if (p.x > maxX) { p.x = maxX; hit = true; }
    if (p.z > maxZ) { p.z = maxZ; hit = true; }
    const boxes = this.buildings.solidsNear(p.x, p.z, r + 2);
    const tx = Math.floor(p.x / TM), tz = Math.floor(p.z / TM);
    // open water is a wall for now (swimming arrives later). V2 (Milestone 8): its edge is the smoothed shoreline
    // on the bank, not the old tile line: feel round the body for it and step back from it
    for (let it = 0; it < 4; it++) {
      let ax = 0, az = 0, n = 0;
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4, cx = Math.cos(a), cz = Math.sin(a);
        if (isWaterAt(p.x + cx * r, p.z + cz * r)) { ax -= cx; az -= cz; n++; }
      }
      if (!n) break;
      hit = true;
      const l = Math.hypot(ax, az);
      if (l < 1e-3) break; // (water all round: leave it be)
      p.x += (ax / l) * r * 0.3; p.z += (az / l) * r * 0.3;
    }
    for (const [x0, z0, x1, z1] of boxes) {
      const cx = Math.max(x0, Math.min(p.x, x1)), cz = Math.max(z0, Math.min(p.z, z1));
      let dx = p.x - cx, dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      hit = true;
      if (d2 < 1e-6) { // centre inside the box: leave by the nearest side
        const opts = [[x0 - r - p.x, 0], [x1 + r - p.x, 0], [0, z0 - r - p.z], [0, z1 + r - p.z]];
        opts.sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]));
        p.x += opts[0][0]; p.z += opts[0][1];
        continue;
      }
      const d = Math.sqrt(d2);
      dx /= d; dz /= d;
      p.x = cx + dx * r;
      p.z = cz + dz * r;
    }
    // V2 (Milestone 8): lamp posts and signal poles
    for (const s of postsNear(p.x, p.z, this.posts)) {
      const rr = r + s.r, dx = p.x - s.x, dz = p.z - s.z, d = Math.hypot(dx, dz);
      if (d < rr && d > 1e-4) { p.x = s.x + (dx / d) * rr; p.z = s.z + (dz / d) * rr; hit = true; }
    }
    // V2 (Milestone 8): the villagers' cars standing in their drives and in the bays
    for (let j = -1; j <= 1; j++)
      for (let i = -1; i <= 1; i++) {
        const b = World.buildingAt(tx + i * 2, tz + j * 2);
        if (!b || this.seenB.has(b)) continue;
        this.seenB.add(b);
        for (const c of drivewayCars(b, this.driveCars)) if (capsule(p, r, c.x, c.z, c.yaw, 1.35, 0.92)) hit = true;
        this.driveCars.length = 0;
        if (b.parked > 0 && !CAT[b.type]?.res) for (let k = 0; k < Math.min(4, b.parked); k++) {
          const s = baySpot(b, k);
          if (s && capsule(p, r, s.x, s.z, s.yaw, 1.35, 0.92)) hit = true;
        }
      }
    this.seenB.clear();
    // tree trunks
    for (let j = -1; j <= 1; j++)
      for (let i = -1; i <= 1; i++) {
        const x = tx + i, z = tz + j;
        if (!World.inB(x, z) || !World.tree[World.idx(x, z)]) continue;
        const t = treeSpot(x, z);
        const rr = r + 0.35 * t.s;
        const dx = p.x - t.x, dz = p.z - t.z;
        const d = Math.hypot(dx, dz);
        if (d < rr && d > 1e-4) { p.x = t.x + (dx / d) * rr; p.z = t.z + (dz / d) * rr; hit = true; }
      }
    return hit;
  }

  private posts: { x: number; z: number; r: number }[] = [];
  private seenB = new Set<any>();
  private driveCars: DrivewayCar[] = [];
  private nearV: ReturnType<typeof Traffic.near> = [];
  /** V2 (Milestone 8): on foot, the village's traffic is solid too: a car, a bus or a cab standing or passing is
   *  walked round, not through (a moving one that runs into the Founder is a knock: sim/traffic.ts hits) */
  private collideTraffic(p: { x: number; z: number }, r: number): void {
    for (const ob of Traffic.near(p.x * 2, p.z * 2, 30, this.nearV)) {
      if (!ob.car) continue;
      const o = ob.o as any;
      const x = (o.x ?? ob.x * 16) * 0.5, z = (o.y ?? ob.y * 16) * 0.5;
      const yaw = Math.atan2(o.hx ?? ob.dx, o.hy ?? ob.dy), L = ob.len * 8;
      capsule(p, r, x, z, yaw, Math.max(0.2, L / 2 - 0.9), L > 6 ? 1.25 : L < 3 ? 0.45 : 0.92);
    }
  }

  /** V2 (Milestone 7): on foot, the vehicles the Founder has out are solid: the one in hand (a fire engine,
   *  a bus, your own car) and the owned one left standing; each a capsule along its length */
  private collideVehicles(p: { x: number; z: number }, r: number): void {
    const solid = (v: Vehicle | null, x: number, z: number, yaw: number): void => {
      if (!v) return;
      const sp = specOf(v), fx = Math.sin(yaw), fz = Math.cos(yaw), rr = sp.radius + r;
      // the nearest point on the axis between the rear and front contact circles
      const t = Math.max(-sp.reach, Math.min(sp.reach, (p.x - x) * fx + (p.z - z) * fz));
      const cx = x + fx * t, cz = z + fz * t, dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
      if (d >= rr) return;
      if (d < 1e-4) { p.x = cx - fz * rr; p.z = cz + fx * rr; return; }
      p.x = cx + (dx / d) * rr;
      p.z = cz + (dz / d) * rr;
    };
    if (!this.driving) solid(this.vehicle, this.car.x, this.car.z, this.car.yaw);
    if (this.leftAt) solid(this.fleet.cur, this.leftAt.x, this.leftAt.z, this.leftAt.yaw);
  }

  nearCar(): boolean {
    return !this.driving && !!this.vehicle && Math.hypot(this.pos.x - this.car.x, this.pos.z - this.car.z) < 3.4;
  }

  enterCar(): void {
    if (!this.vehicle) return;
    this.driving = true;
    this.camYaw = this.car.yaw;
  }
  /** on foot at a doorstep, facing away from the building (out of the cells, out of hospital) */
  stepOutOf(b: any): void {
    if (this.driving) this.exitCar();
    const dx = b.door.x * TM + 4, dz = b.door.y * TM + 4;
    const cx = (b.x + b.w / 2) * TM, cz = (b.y + b.h / 2) * TM;
    this.pos.set(dx + (dx - cx) * 0.05, 0, dz + (dz - cz) * 0.05);
    this.pos.y = this.groundAt(this.pos.x, this.pos.z);
    this.yaw = this.camYaw = Math.atan2(dx - cx, dz - cz);
    this.camInit = false;
  }
  exitCar(): void {
    this.driving = false;
    // step out on the driver's side
    const side = this.car.yaw + Math.PI / 2;
    const p = { x: this.car.x + Math.sin(side) * 2, z: this.car.z + Math.cos(side) * 2 };
    this.collide(p, R_BODY);
    this.pos.set(p.x, this.groundAt(p.x, p.z), p.z);
    this.yaw = this.car.yaw;
    this.car.speed = 0;
  }

  /* ---------- per-frame ---------- */
  update(dt: number): void {
    dt = Math.min(dt, 0.05);
    const sens = Settings.get('mouseSens') || 1;
    const look = Input.look(sens, !!Settings.get('invertY'));
    this.camYaw -= look.dx;
    this.camPitch = Math.max(-1.25, Math.min(0.6, this.camPitch - look.dy));
    if (Input.wheel) this.camDist = Math.max(2.5, Math.min(14, this.camDist + Input.wheel * 0.8));
    if (Input.take('camera')) {
      this.firstPerson = !this.firstPerson;
      Settings.set('firstPerson', this.firstPerson);
    }
    if (this.driving) this.drive(dt);
    else this.walk(dt);
    this.pose(dt);
    this.reportToTraffic(dt);
  }

  /* ---------- V2 (Milestone 5): a passenger on the village's transport ---------- */
  /** set while riding: the camera orbits the vehicle at `dist` metres; the body stays out of sight */
  passenger: { dist: number } | null = null;
  /** a frame aboard: the Founder is at (x, y, z) inside the vehicle; mouse and wheel still look around */
  passengerAt(x: number, y: number, z: number, dist: number): void {
    const look = Input.look(Settings.get('mouseSens') || 1, !!Settings.get('invertY'));
    this.camYaw -= look.dx;
    this.camPitch = Math.max(-1.25, Math.min(0.4, this.camPitch - look.dy));
    if (!this.passenger) { this.passenger = { dist }; this.camInit = false; }
    if (Input.wheel) this.passenger.dist = Math.max(dist * 0.5, Math.min(dist * 2.5, this.passenger.dist + Input.wheel * 1.2));
    this.pos.set(x, y, z);
    this.mesh.visible = false;
    // nobody stands at the stop any more; the car the Founder came in is still parked in the road
    const v = this.fleet.cur, c = this.car;
    Traffic.guests = v && !this.hijacked ? [{ x: c.x * 2, y: c.z * 2, dx: Math.sin(c.yaw), dy: Math.cos(c.yaw), car: true, still: true, len: v.kind === 'moto' ? 0.3 : undefined }] : [];
  }
  endRide(): void {
    this.passenger = null;
    this.camInit = false;
  }
  /** on foot at (x, z) facing `yaw` (stepping out of a cab at the kerb) */
  placeAt(x: number, z: number, yaw: number): void {
    if (this.driving) this.exitCar();
    const p = { x, z };
    this.collide(p, R_BODY);
    this.pos.set(p.x, this.groundAt(p.x, p.z), p.z);
    this.yaw = this.camYaw = yaw;
    this.camInit = false;
  }

  /** tell the village's traffic where the Founder and their car are */
  private reportToTraffic(dt: number): void {
    const c = this.car;
    this.stillT = Math.abs(c.speed) < 0.5 ? this.stillT + dt : 0;
    const v = this.vehicle;
    // the car counts as parked once it has stood still a while: drivers then pass it
    const car = v ? { x: c.x * 2, y: c.z * 2, dx: Math.sin(c.yaw), dy: Math.cos(c.yaw), car: true, still: !this.driving || this.stillT > 5, len: specOf(v).len ?? (v.kind === 'moto' ? 0.3 : undefined) } : null;
    const me = { x: this.pos.x * 2, y: this.pos.z * 2, dx: Math.sin(this.yaw), dy: Math.cos(this.yaw), car: false, still: true };
    Traffic.guests = this.driving && car ? [car] : car ? [car, me] : [me];
    // the owned vehicle left standing while a stolen one is driven is in the road too
    const l = this.leftAt;
    if (l && this.fleet.cur) Traffic.guests.push({ x: l.x * 2, y: l.z * 2, dx: Math.sin(l.yaw), dy: Math.cos(l.yaw), car: true, still: true, len: this.fleet.cur.kind === 'moto' ? 0.3 : undefined });
  }

  /* ---------- the Founder among the village's traffic ---------- */
  private near: ReturnType<typeof Traffic.near> = [];
  /** push the car off other vehicles; a hard hit is a crash, a person in the way is knocked down */
  private bumpTraffic(c: Car, fx: number, fz: number, dt: number): void {
    this.bumpCd = Math.max(0, this.bumpCd - dt);
    const sp = specOf(this.vehicle);
    const mine = [sp.reach, -sp.reach], R = sp.radius;
    for (const ob of Traffic.near(c.x * 2, c.z * 2, 28, this.near)) {
      const o = ob.o as any;
      const ox = (o.x ?? ob.x * 16) * 0.5, oz = (o.y ?? ob.y * 16) * 0.5;
      if (!ob.car) {
        // someone on foot in the car's path
        if (!o.trip || o.state !== 'walk' || o.knocked) continue;
        for (const k of mine) {
          const mx = c.x + fx * k, mz = c.z + fz * k;
          if (Math.hypot(mx - ox, mz - oz) > R + 0.3) continue;
          if (Math.abs(c.speed) > 1.5) {
            Life.founderHitPerson(o, Math.abs(c.speed));
            this.offence('hit');
            c.speed *= 0.35;
          } else c.speed = 0; // nudged up to them: stop
          break;
        }
        continue;
      }
      // a vehicle: its body as a row of circles along its heading
      let hx = o.dirx ?? ob.dx, hz = o.diry ?? ob.dy;
      const hl = Math.hypot(hx, hz) || 1;
      hx /= hl; hz /= hl;
      const L = ob.len * 8, r = L > 6 ? 1.25 : L < 3 ? 0.6 : 0.95;
      const span = Math.max(0, L / 2 - r), n = span > 0 ? Math.max(2, Math.ceil((2 * span) / (1.4 * r)) + 1) : 1;
      const theirV = ((o.trip ? o.trip.v : o.v) || 0) * 8;
      for (let i = 0; i < n; i++) {
        const k = n === 1 ? 0 : -span + (2 * span * i) / (n - 1);
        const cx = ox + hx * k, cz = oz + hz * k;
        for (const m of mine) {
          const mx = c.x + fx * m, mz = c.z + fz * m;
          const dx = mx - cx, dz = mz - cz;
          const d = Math.hypot(dx, dz);
          const overlap = R + r - d;
          if (overlap <= 0 || d < 1e-4) continue;
          const nx = dx / d, nz = dz / d;
          c.x += nx * overlap;
          c.z += nz * overlap;
          // how hard: closing speed along the contact normal
          const impact = -((fx * c.speed - hx * theirV) * nx + (fz * c.speed - hz * theirV) * nz);
          if (impact > 1) {
            c.speed = impact > 3 ? -c.speed * 0.25 : c.speed * 0.3;
            if (this.bumpCd <= 0) {
              this.bumpCd = 1.5;
              if (impact > 14) this.onWreck?.(impact);
              if (Life.police.includes(o) && impact > 2) {
                // ramming a squad car: the officers take it personally
                emit('sound', { name: 'crunch' });
                this.damage = this.damage + impact * 1.5;
                this.offence('ram');
              } else if (impact > 5 && Life.founderCrash(o)) {
                c.speed = 0;
                this.damage = Math.min(100, this.damage + impact * 2.5);
                this.offence('crash');
              } else if (impact > 2.5) {
                emit('sound', { name: 'crunch' });
                this.damage = Math.min(100, this.damage + impact);
                this.offence('bump');
              }
            }
          }
        }
      }
    }
  }

  /** red lights, speeding, the wrong side of the road (noted, for the police and gossip to come) */
  private roadRules(c: Car, fx: number, fz: number, dt: number): void {
    for (const k in this.ruleCd) this.ruleCd[k] = Math.max(0, this.ruleCd[k] - dt);
    const sp = Math.abs(c.speed);
    const tx = Math.floor(c.x / TM), tz = Math.floor(c.z / TM);
    const key = World.inB(tx, tz) ? World.idx(tx, tz) : -1;
    // through a red light: entering a signalled junction against the phase
    if (key !== this.lastTile) {
      if (key >= 0 && World.signalOn(key) && sp > 2) { // (no red light to run when the lights are out)
        const movingNS = Math.abs(fz) > Math.abs(fx);
        if (movingNS !== World.nsGreen()) this.offence('red light');
      }
      this.lastTile = key;
    }
    this.speedT = sp > SPEED_LIMIT && key >= 0 && World.isRoad(tx, tz) ? this.speedT + dt : 0;
    if (this.speedT > 2 && !this.ruleCd.speeding) { this.offence('speeding'); this.ruleCd.speeding = 25; }
    // the wrong side: on a straight stretch, left of the centreline while moving along it
    let wrong = false;
    if (sp > 4 && key >= 0 && World.isRoad(tx, tz)) {
      const ew = World.isRoad(tx - 1, tz) && World.isRoad(tx + 1, tz) && !World.isRoad(tx, tz - 1) && !World.isRoad(tx, tz + 1);
      const ns = World.isRoad(tx, tz - 1) && World.isRoad(tx, tz + 1) && !World.isRoad(tx - 1, tz) && !World.isRoad(tx + 1, tz);
      const sx = Math.sign(c.speed) * fx, sz = Math.sign(c.speed) * fz;
      if ((ew && Math.abs(sx) > 0.8) || (ns && Math.abs(sz) > 0.8)) {
        const ox = c.x - (tx * TM + 4), oz = c.z - (tz * TM + 4);
        wrong = ox * -sz + oz * sx < -0.7; // right-hand normal (z runs south): negative is the left
      }
      // V2 (Milestone 8): on a twin-row avenue, the left-hand row is the oncoming carriageway
      if (!wrong && (Math.abs(sx) > 0.8 || Math.abs(sz) > 0.8)) wrong = World.isLeftRow(tx, tz, Math.round(sx), Math.round(sz));
    }
    this.wrongT = wrong ? this.wrongT + dt : 0;
    if (this.wrongT > 1.5 && !this.ruleCd.wrong) { this.offence('wrong side'); this.ruleCd.wrong = 25; }
  }

  offence(kind: Offence['kind']): void {
    // on blue lights to a call, the road rules give way (a crash is still a crash)
    if (this.exempt && (kind === 'red light' || kind === 'speeding' || kind === 'wrong side')) return;
    const at = { kind, day: Sim.day, clock: Math.round(Sim.clock), x: Math.round(this.car.x), z: Math.round(this.car.z), at: Date.now() };
    this.offences.push(at);
    if (this.offences.length > 60) this.offences.shift();
    emit('founderOffence', at);
  }

  private walk(dt: number): void {
    this.mend(dt);
    // knocked down: on the ground for a moment
    const mv = this.downT > 0 ? { x: 0, y: 0 } : Input.move();
    const run = Input.running();
    const speed = run ? 7.2 : 3.2;
    const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
    const rx = -Math.cos(this.camYaw), rz = Math.sin(this.camYaw);
    const vx = (fx * mv.y + rx * mv.x) * speed, vz = (fz * mv.y + rz * mv.x) * speed;
    const moving = Math.hypot(vx, vz) > 0.1;
    const p = { x: this.pos.x + vx * dt, z: this.pos.z + vz * dt };
    this.collide(p, R_BODY);
    this.collideVehicles(p, R_BODY);
    this.collideTraffic(p, R_BODY);
    const g = this.groundAt(p.x, p.z);
    // steps up to ~0.5 m are climbed; mountains are walked
    if (g - this.pos.y < 0.55 || heightAt(p.x, p.z) > 0.3) {
      this.pos.x = p.x;
      this.pos.z = p.z;
    }
    if (moving) {
      const target = Math.atan2(vx, vz);
      let d = target - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * Math.min(1, dt * 12);
      this.phase += Math.hypot(vx, vz) * dt * 2.4;
    }
    const ground = this.groundAt(this.pos.x, this.pos.z);
    if (this.onGround && Input.take('jump')) { this.vy = 7; this.onGround = false; }
    this.vy -= GRAV * dt;
    this.pos.y += this.vy * dt;
    if (this.pos.y <= ground) { this.pos.y = ground; this.vy = 0; this.onGround = true; }
    else if (this.pos.y - ground > 0.05) this.onGround = false;
    this.speedKmh = Math.hypot(vx, vz) * 3.6;
    this.mesh.userData.moving = moving;
    this.mesh.userData.run = run;
  }

  private drive(dt: number): void {
    const c = this.car;
    const v = this.vehicle;
    if (!v) { this.driving = false; return; }
    const sp = specOf(v);
    const { gas, brake } = Input.pedals();
    const steer = Input.steer();
    const hb = Input.handbrake();
    // a battered vehicle loses its top end, shredded tyres more; an empty tank crawls; a wreck won't go
    let MAX = sp.max * (v.damage > 50 ? 1 - (v.damage - 50) / 100 : 1) * (v.flat ? 0.4 : 1), REV = -8, power = sp.accel;
    if (v.fuel <= 0) { MAX = Math.min(MAX, 2.2); REV = -2.2; }
    // V2 (Milestone 8): pedal power: a bicycle slows to a crawl up a steep climb and runs away down one
    if (v.work?.type === 'bike') { MAX *= THREE.MathUtils.clamp(1 + c.pitch * 3.2, 0.28, 1.6); REV = -1.5; }
    if (v.damage >= 100) { MAX = 0; REV = 0; power = 0; }
    if (gas > 0 && c.speed < MAX) c.speed = Math.min(MAX, c.speed + (c.speed < 0 ? 18 : power) * gas * dt);
    if (brake > 0) c.speed -= (c.speed > 0 ? 22 : 6) * brake * dt;
    if (!gas && !brake) c.speed *= 1 - Math.min(1, dt * 0.6);
    if (hb) c.speed *= 1 - Math.min(1, dt * 3);
    if (c.speed > MAX) c.speed = Math.max(MAX, c.speed - 6 * dt); // the limit just dropped (a knock, an empty tank)
    c.speed = Math.max(REV, c.speed);
    const turn = steer * (sp.turn ?? (v.kind === 'moto' ? 2.3 : 1.9)) * (c.speed / (Math.abs(c.speed) + 5)) * (hb ? 1.6 : 1);
    c.yaw -= turn * dt;
    // fuel goes with distance driven
    v.fuel = Math.max(0, v.fuel - (Math.abs(c.speed) * dt) / (sp.range * 1000));
    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
    const nx = c.x + fx * c.speed * dt, nz = c.z + fz * c.speed * dt;
    // front and rear contact circles, pushed clear of whatever they overlap and the car with them (V2: all the way
    // clear: it used to move half way, so the car stayed touching and bounced on the spot frame after frame, its
    // speed flipped and quartered each time, and it couldn't be reversed away)
    let x = nx, z = nz, hit = false, stuck = false;
    for (let it = 0; it < 4; it++) {
      const front = { x: x + fx * sp.reach, z: z + fz * sp.reach }, rear = { x: x - fx * sp.reach, z: z - fz * sp.reach };
      const f0x = front.x, f0z = front.z, r0x = rear.x, r0z = rear.z;
      const hitF = this.collide(front, sp.radius), hitR = this.collide(rear, sp.radius);
      if (!hitF && !hitR) break;
      hit = true;
      const pfx = front.x - f0x, pfz = front.z - f0z, prx = rear.x - r0x, prz = rear.z - r0z;
      const [dx, dz] = pfx * pfx + pfz * pfz >= prx * prx + prz * prz ? [pfx, pfz] : [prx, prz];
      // (an end deep in open water has no way out it can feel for: back to where the car last stood clear)
      stuck = dx * dx + dz * dz < 1e-8;
      if (stuck) {
        const far = Math.hypot(this.lastFree.x - c.x, this.lastFree.y - c.z) > 25; // (it was placed somewhere new since)
        x = far ? c.x : this.lastFree.x; z = far ? c.z : this.lastFree.y;
        break;
      }
      x += dx; z += dz;
    }
    if (hit) {
      // how squarely it met what it hit: the push back against the way it was going (1 head on, 0 along it or away)
      const px = x - nx, pz = z - nz, pl = Math.hypot(px, pz), dir = Math.sign(c.speed);
      const into = pl > 1e-5 ? -(px * fx * dir + pz * fz * dir) / pl : 0;
      if (into > 0.05) {
        const impact = Math.abs(c.speed) * into;
        if (impact > 6) {
          emit('sound', { name: 'crunch' });
          this.damage = Math.min(100, this.damage + impact * 0.8);
          if (impact > 16) this.onWreck?.(impact); // into a wall at speed
        }
        // head on it bounces back a little; a glancing blow only slows it (V2: and backing away is never fought)
        c.speed = into > 0.7 ? -c.speed * 0.25 : c.speed * (1 - into);
      }
    }
    c.x = x;
    c.z = z;
    if (!hit || !stuck) {
      const front = { x: x + fx * sp.reach, z: z + fz * sp.reach }, rear = { x: x - fx * sp.reach, z: z - fz * sp.reach };
      if (!hit || (!this.collide(front, sp.radius) && !this.collide(rear, sp.radius))) this.lastFree.set(x, z);
    }
    // V2: the village's cars, buses and people are in the way too
    this.bumpTraffic(c, fx, fz, dt);
    this.roadRules(c, fx, fz, dt);
    const yf = this.groundAt(c.x + fx * 1.6, c.z + fz * 1.6), yr = this.groundAt(c.x - fx * 1.6, c.z - fz * 1.6);
    c.y = (yf + yr) / 2;
    c.pitch = Math.atan2(yr - yf, 3.2);
    this.pos.set(c.x, c.y, c.z);
    this.yaw = c.yaw;
    this.speedKmh = Math.abs(c.speed) * 3.6;
    // the chase camera drifts back behind the car when you let go of the mouse
    if (Math.abs(c.speed) > 2) {
      let d = c.yaw + (c.speed < 0 ? Math.PI : 0) - this.camYaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.camYaw += d * (1 - Math.exp(-dt * 1.8));
    }
  }

  /** on a motorbike or a bicycle (the rider shows) */
  twoWheels(): boolean { return this.ride instanceof Moto || this.ride instanceof Bike; }

  /** photo mode: the Founder is in the picture, even when the camera was behind their eyes */
  showBody(): void {
    this.mesh.visible = !this.driving || this.twoWheels();
  }

  /** animate the body, place the car, and set the camera */
  private pose(dt: number): void {
    const riding = this.driving && this.twoWheels();
    this.mesh.visible = (!this.driving || riding) && !this.firstPerson;
    const moving = !!this.mesh.userData.moving;
    const speed = moving ? Math.max(0.6, this.speedKmh / 3.6) : 0;
    const c = this.car;
    if (riding && this.ride instanceof Bike) {
      // (V2 (Milestone 8): on the saddle of the mountain bike, pedalling)
      const m = this.ride;
      this.mesh.position.set(c.x - Math.sin(c.yaw) * 0.17, c.y + 0.44, c.z - Math.cos(c.yaw) * 0.17);
      this.mesh.rotation.set(0, c.yaw, m.lean, 'YXZ');
      if (this.mesh.visible) this.person.animate(dt, 'pedal', m.crank, ENV.rain.value);
    } else if (riding) {
      // astride the motorcycle, leaning with it
      const m = this.ride as Moto;
      this.mesh.position.set(c.x - Math.sin(c.yaw) * 0.22, c.y + 0.42, c.z - Math.cos(c.yaw) * 0.22);
      this.mesh.rotation.set(0, c.yaw, m.lean, 'YXZ');
      if (this.mesh.visible) this.person.animate(dt, 'sit', 0, ENV.rain.value);
    } else {
      this.mesh.position.copy(this.pos);
      // (V2 (Milestone 8): flat on the road after a knock)
      const down = this.downT > 0;
      this.mesh.rotation.set(down ? -Math.PI / 2 : 0, this.yaw, 0, 'YXZ');
      if (down) this.mesh.position.y += 0.14;
      if (this.mesh.visible) this.person.animate(dt, down ? 'lie' : moving ? 'walk' : 'idle', speed, ENV.rain.value);
    }
    this.carMesh.position.set(c.x, c.y, c.z);
    this.carMesh.rotation.set(c.pitch, c.yaw, 0, 'YXZ');
    if (!this.ride) {
      // (a work vehicle drawn by the actors layer: just its headlamps' beam here, from its nose)
      const sp = specOf(this.vehicle);
      if (this.driving && this.vehicle && ENV.night.value > 0.2) addBeam(this.carMesh, 0, 1, sp.reach + sp.radius * 0.8, 1.2);
      return;
    }
    if (this.ride instanceof CarModel) this.ride.setSiren(this.siren, performance.now() / 1000);
    // the vehicle's own suspension, wheels and lights
    const accel = (c.speed - this.lastCar.speed) / Math.max(dt, 1e-3);
    let dy = c.yaw - this.lastCar.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.lastCar.speed = c.speed;
    this.lastCar.yaw = c.yaw;
    this.ride.drive(dt, 0, 0, 0, c.speed, accel, dy / Math.max(dt, 1e-3), 0);
    this.ride.lights(this.driving && ENV.night.value > 0.2, ENV.night.value, !this.driving);
  }

  /** place the street camera: third-person orbit with collision, or eyes */
  applyCamera(cam: THREE.PerspectiveCamera, dt: number, _night: number): void {
    const aboard = this.passenger;
    if (this.firstPerson && !this.driving && !aboard) {
      // V2 (Milestone 7): a gentle head bob while walking (Settings → Accessibility turns it off)
      const k = this.bobK += ((Settings.get('headBob') !== false && this.onGround ? Math.min(1, this.speedKmh / 12) : 0) - this.bobK) * Math.min(1, dt * 6);
      const sway = Math.cos(this.phase) * 0.02 * k;
      cam.position.set(this.pos.x - Math.cos(this.camYaw) * sway, this.pos.y + 1.65 + Math.sin(this.phase * 2) * 0.03 * k, this.pos.z + Math.sin(this.camYaw) * sway);
      const look = new THREE.Vector3(Math.sin(this.camYaw) * Math.cos(this.camPitch), Math.sin(this.camPitch), Math.cos(this.camYaw) * Math.cos(this.camPitch));
      cam.lookAt(cam.position.clone().add(look));
      this.yaw = this.camYaw;
      return;
    }
    // (a fire engine or a bus is long: the chase camera sits further back, the cab further forward and higher)
    const big = this.driving && this.vehicle?.work ? Math.max(0, specOf(this.vehicle).reach - 1.35) : 0;
    const target = new THREE.Vector3(this.pos.x, this.pos.y + (this.driving ? 1.6 + big * 0.3 : 1.55), this.pos.z);
    const dist = aboard ? aboard.dist : this.driving ? (this.firstPerson ? 0.01 : this.twoWheels() ? (this.ride instanceof Bike ? 4.8 : 6) : 8.5 + big * 2) : this.camDist;
    if (this.driving && this.firstPerson && !aboard) {
      const c = this.car, fwd = 0.3 + big * 1.25;
      cam.position.set(c.x + Math.sin(c.yaw) * fwd - Math.cos(c.yaw) * 0.35, c.y + 1.3 + big * 0.35, c.z + Math.cos(c.yaw) * fwd + Math.sin(c.yaw) * 0.35);
      const look = new THREE.Vector3(Math.sin(this.camYaw) * Math.cos(this.camPitch), Math.sin(this.camPitch), Math.cos(this.camYaw) * Math.cos(this.camPitch));
      cam.lookAt(cam.position.clone().add(look));
      return;
    }
    const pitch = this.driving || aboard ? Math.min(this.camPitch, -0.08) : this.camPitch;
    const dir = new THREE.Vector3(-Math.sin(this.camYaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(this.camYaw) * Math.cos(pitch));
    // V2 (Milestone 8): the camera is held rigidly at its angle and distance from the Founder (or the car). It used
    // to chase that spot with a per-frame lerp, so the lag behind a moving Founder depended on the frame time and the
    // whole view surged back and forth whenever frames came unevenly. Only height steps (kerbs, a jump's landing) and
    // the distance (pulled in by a wall at once, easing back out) are smoothed, at rates that don't depend on the frame rate.
    const ease = (rate: number): number => 1 - Math.exp(-rate * Math.min(dt, 0.1));
    if (!this.camInit) { this.camY = target.y; this.camD = dist; this.camInit = true; }
    this.camY += (target.y - this.camY) * ease(this.driving || aboard ? 14 : 10);
    if (Math.abs(target.y - this.camY) > 3) this.camY = target.y; // (a teleport: out of a building, off a ride)
    target.y = this.camY;
    const reach = this.camReach(target, dir, dist);
    this.camD = reach < this.camD ? reach : this.camD + (Math.min(dist, reach) - this.camD) * ease(4);
    this.camPos.copy(target).addScaledVector(dir, this.camD);
    // too close to see past the Founder: look over their shoulder instead
    if (!this.driving && !aboard && this.camD < 0.9) this.mesh.visible = false;
    cam.position.copy(this.camPos);
    // V2 (Milestone 7): following a vehicle, the camera rises over a tree's crown rather than sitting in its
    // leaves (the train's view along a wooded line). V2 (Milestone 8): it glides up and down rather than jumping
    // (passing a row of street trees made the view hop)
    const lift = this.driving || aboard ? crownLift(this.camPos.x, this.camPos.y, this.camPos.z) : 0;
    this.camLift += (lift - this.camLift) * ease(lift > this.camLift ? 5 : 1.5);
    cam.position.y += this.camLift;
    cam.lookAt(target);
  }
  private camLift = 0;
  private camY = 0;
  private camD = 5.5;
  private bobK = 0;

  /** how far the camera can travel from o along unit d (up to len) before touching ground or a building */
  private camReach(o: THREE.Vector3, d: THREE.Vector3, len: number): number {
    const R = CAM_RADIUS;
    let best = len;
    // terrain and pavements, sampled
    for (let s = 0.4; s < best; s += 0.4) {
      const px = o.x + d.x * s, pz = o.z + d.z * s;
      if (o.y + d.y * s < Math.max(heightAt(px, pz), this.groundAt(px, pz)) + 0.3) { best = Math.max(0.3, s - 0.4); break; }
    }
    // building volumes: exact ray / box (slab) tests, boxes grown by the camera's radius
    const ex = o.x + d.x * len, ez = o.z + d.z * len;
    const sets = this.buildings.camBoxes(Math.min(o.x, ex) - 2, Math.min(o.z, ez) - 2, Math.max(o.x, ex) + 2, Math.max(o.z, ez) + 2, this.camSets);
    const ox = o.x, oy = o.y, oz = o.z, ix = 1 / d.x, iy = 1 / d.y, iz = 1 / d.z;
    for (const b of sets)
      for (let i = 0; i < b.length; i += 6) {
        const bx0 = b[i], by0 = b[i + 1], bz0 = b[i + 2], bx1 = b[i + 3], by1 = b[i + 4], bz1 = b[i + 5];
        if (ox > bx0 - R && ox < bx1 + R && oy > by0 - R && oy < by1 + R && oz > bz0 - R && oz < bz1 + R) {
          // the Founder is already within a camera-width of it: inside it (a doorway, an awning's
          // edge) it doesn't count; beside it, only a ray heading into it does
          if (ox > bx0 && ox < bx1 && oy > by0 && oy < by1 && oz > bz0 && oz < bz1) continue;
          const t = slab(ox, oy, oz, ix, iy, iz, bx0, by0, bz0, bx1, by1, bz1, best);
          if (t < best) best = Math.max(0.25, t - R);
          continue;
        }
        const t = slab(ox, oy, oz, ix, iy, iz, bx0 - R, by0 - R, bz0 - R, bx1 + R, by1 + R, bz1 + R, best);
        if (t < best) best = Math.max(0.25, t);
      }
    return best;
  }

  /** tile under the Founder */
  tile(): { x: number; y: number } {
    return { x: Math.floor(this.pos.x / TM), y: Math.floor(this.pos.z / TM) };
  }
}

/* ============================================================
   Actors: everything that moves or happens in the street, read
   straight from the simulation each frame — "everything you see
   is real" (design pillar 2). Villagers on foot or at the wheel,
   buses and cabs, trains, emergency crews, crowds at incidents,
   rallies and riots, beach days, boats, planes, helicopters,
   fireworks, fires, festivals, tornadoes and mood bubbles.
   Sim positions are V1 px (16/tile) → metres ×0.5.
   ============================================================ */
import * as THREE from 'three';
import { Sim } from '../sim/agents';
import { Life } from '../sim/life';
import { Gov } from '../sim/gov';
import { Festivals } from '../sim/festivals';
import { Calamity } from '../sim/calamity';
import { Weather } from '../sim/weather';
import { World } from '../sim/world';
import { CAT } from '../sim/catalog';
import { InstancedPool, MAT, MeshBuilder, hex, hash2 } from './kit';
import { Power } from '../sim/power';
import { GOODS } from '../sim/supply';
import { Gateways } from '../sim/gateways';
import { HAIR, PANTS, PERSON, PROPS, SHIRT, SKIN, VEHICLES } from './models';
import { heightAt } from './terrain';
import type { BuildingLayer } from './buildings';
import { Person, Look, randomLook, Pose } from '../gfx/person';
import { Car as CarModel } from '../gfx/car';
import { FarFleet, pickModel, seedOf, type VehicleModel } from '../gfx/vehicle';
import { FlyingBirds } from '../gfx/birds';
import { Crowd, castLoaded, outfitFor, rigFor } from '../gfx/people';
import { Animal, Herd, beast, dogBreed, zooLoaded, type BeastPose } from '../gfx/animals';
import { Fauna } from './fauna';
import { drivewayCars, DrivewayCar, CAR_COLORS as PARKED_COLORS, styleForPaint } from './parked';
import { baySpot, bayCount, carDrawPose } from '../sim/parking';
import { trailhead } from '../sim/peak';
import { Traffic, lanePose, railPose, workZone, FOOT_PX, LANE_PX } from '../sim/traffic';
import { ENV } from '../gfx/env';
import { FireFX } from '../gfx/fire';
import { XmasPlaza, TreeScene } from '../gfx/festive';
import { interiorDay, SHADOW_DETAIL } from '../gfx/architecture';
import { STAGE_DECK } from '../sim/hustings';

/* V2 detail tiers: the nearest villagers are skinned, gait-animated people and the
   nearest cars are full models; everything farther stays light instanced figures */
/* V2: Ultra (the player's own choice, for a gaming PC) draws the downloaded models in full detail much further out and
   more of them at once; every other preset keeps the counts it had, so lighter machines and phones lose nothing */
const ultra = (): boolean => SHADOW_DETAIL.tiny;
const nearPeople = (): number => (ultra() ? 56 : 32), nearPeopleR = (): number => (ultra() ? 90 : 48);
const nearCars = (): number => (ultra() ? 36 : 22), nearCarsR = (): number => (ultra() ? 140 : 80);
/** squared distances inside which the nearest level of detail is drawn: people, cars, animals (nearest, mid) */
const lod0People = (): number => (ultra() ? 2500 : 400), lod0Cars = (): number => (ultra() ? 8100 : 900);
const lodBeasts = (): [number, number] => (ultra() ? [900, 3600] : [144, 900]);
/** V2: the birds that fly: colour, size, how fast they beat */
const BIRD_KIND: Record<string, { colour: THREE.Color; scale: number; rate: number }> = {
  gull: { colour: new THREE.Color(0.96, 0.96, 0.95), scale: 1.05, rate: 1.4 },
  crow: { colour: new THREE.Color(0.1, 0.1, 0.11), scale: 0.85, rate: 1.7 },
  pigeon: { colour: new THREE.Color(0.55, 0.58, 0.64), scale: 0.62, rate: 2.2 },
};
/* V2 (Milestone 9): the nearest animals are skinned and walk; farther, the big ones stand as instanced herds */
const NEAR_BEASTS = 24, NEAR_BEASTS_R = 60, HERD_R = 250;
interface BeastWant { id: string; key: string; x: number; y: number; z: number; yaw: number; pose: BeastPose | 'auto'; speed: number }
interface CarWant { type: string; x: number; y: number; z: number; yaw: number; paint: THREE.Color; siren: boolean; pitch: number; roll: number; parked: boolean }
interface CarSlot { car: CarModel; kind: string; x: number; z: number; yaw: number; v: number; a: number; used: boolean; seen: number }

/* V2 (Milestone 9): which downloaded model draws each vehicle type, and how many of each model can be on screen */
const TYPE_KIND: Record<string, string> = { car: 'car', taxi: 'taxi', police: 'police', fire: 'fire', ambulance: 'ambulance', truck: 'truck', van: 'utility', tractor: 'tractor', bus: 'bus', moto: 'moto', bicycle: 'bicycle', loco: 'loco', coach: 'coach', wagon: 'wagon', boat: 'boat', ferry: 'ferry', heli: 'heli', plane: 'plane' };
const FLEET_CAPS: Record<string, number> = { car: 140, taxi: 40, police: 30, fire: 12, ambulance: 8, truck: 24, utility: 9, van: 9, tow: 6, tractor: 6, bus: 24, moto: 80, bicycle: 40, loco: 16, coach: 60, wagon: 50, boat: 30, ferry: 3, heli: 6, plane: 6 };

const PX = 0.5;
const TM = 8;
const PEOPLE_CAP = 900;
const CAR_COLORS = PARKED_COLORS;
/* a hose's jet and the spray where it lands */
const JET = hex('#dfeaf2'), SPLASH = hex('#f2f6f8');
/* polling booths: plain, not in any candidate's colours */
const BOOTH = hex('#d6d4cc');
/* the far (instanced) vehicles' lamps: lit, or dark on a parked car */
const LIGHTS_ON = new THREE.Color(1, 1, 1), LIGHTS_OFF = new THREE.Color(0.16, 0.16, 0.17);
interface VehOpts { siren?: boolean; beacon?: boolean; pitch?: number; roll?: number; rotor?: number; scale?: number; parked?: boolean; seed?: number }

export type Mode = 'walk' | 'run' | 'stand' | 'lie' | 'sit' | 'work' | 'carry' | 'speak' | 'cheer';
interface PersonDraw {
  x: number; y: number; z: number; yaw: number; kind: string; seed: number; mode: Mode; phase: number;
  shirt?: THREE.Color; pants?: THREE.Color; hair?: THREE.Color; scale?: number;
  /** V2 (Milestone 9): the uniform they wear (police, fire, medical, construction, chef, pilot, delivery, gardener, business) */
  job?: string;
}

/* per-entity smoothing state keyed by the sim object itself */
const track = new WeakMap<object, { x: number; z: number; yaw: number; phase: number }>();
function smooth(o: object, x: number, z: number, yawHint: number | null): { yaw: number; phase: number; moving: boolean } {
  let s = track.get(o);
  if (!s) {
    s = { x, z, yaw: yawHint ?? 0, phase: Math.random() * 6 };
    track.set(o, s);
  }
  const dx = x - s.x, dz = z - s.z;
  const d = Math.hypot(dx, dz);
  let target = yawHint;
  if (d > 0.02 && d < 8) target = Math.atan2(dx, dz);
  if (target !== null && target !== undefined) {
    let diff = target - s.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    s.yaw += diff * 0.25;
  }
  if (d < 8) s.phase += d * 2.6;
  s.x = x;
  s.z = z;
  return { yaw: s.yaw, phase: s.phase, moving: d > 0.004 };
}

/** V2 (Milestone 8): a vehicle's true heading (through the bends) as a yaw, with no lag behind the turn */
function headYaw(o: any): number {
  return Math.atan2(o.hx ?? o.dirx ?? 0, o.hy ?? o.diry ?? 1);
}

function dirYaw(dx: number, dy: number): number | null {
  if (!dx && !dy) return null;
  return Math.atan2(dx, dy);
}

/* ---------- a soft round point of light (sparks, fireflies) ---------- */
const FLIES = 160;
let GLINT: THREE.Texture | null = null;
function glintTexture(): THREE.Texture {
  if (GLINT) return GLINT;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 32;
  const g = cv.getContext('2d')!;
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.18, 'rgba(255,255,255,0.85)');
  gr.addColorStop(0.45, 'rgba(255,255,255,0.22)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 32, 32);
  GLINT = new THREE.CanvasTexture(cv);
  return GLINT;
}

/* ---------- emoji bubbles ---------- */
const bubbleTex = new Map<string, THREE.Texture>();
function emojiTexture(e: string): THREE.Texture {
  let t = bubbleTex.get(e);
  if (t) return t;
  // V2 thought bubble: a soft frosted pill with a hairline border and a little tail
  const W = 128, H = 96;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  const pill = (x: number, y: number, w: number, h: number, r: number): void => {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  };
  g.shadowColor = 'rgba(0,0,0,0.28)';
  g.shadowBlur = 8;
  g.shadowOffsetY = 2;
  g.fillStyle = 'rgba(250,250,247,0.94)';
  pill(14, 8, W - 28, 62, 30);
  g.fill();
  g.beginPath();
  g.moveTo(W / 2 - 9, 66); g.quadraticCurveTo(W / 2 - 2, 78, W / 2 - 6, 88); g.quadraticCurveTo(W / 2 + 6, 76, W / 2 + 9, 66);
  g.fill();
  g.shadowColor = 'transparent';
  g.strokeStyle = 'rgba(30,34,44,0.12)';
  g.lineWidth = 1.5;
  pill(14, 8, W - 28, 62, 30);
  g.stroke();
  g.font = '40px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(e, W / 2, 41);
  t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  bubbleTex.set(e, t);
  return t;
}

export class Actors {
  group = new THREE.Group();
  private legs: InstancedPool;
  private arms: InstancedPool;
  private torso: InstancedPool;
  private head: InstancedPool;
  private hair: InstancedPool;
  private hairLong: InstancedPool;
  private veh: Record<string, { paint: InstancedPool; fixed: InstancedPool; lights: InstancedPool; siren?: InstancedPool; rotor?: InstancedPool }> = {};
  private props: Record<string, InstancedPool> = {};
  private sparks: THREE.Points;
  private sparkPos: Float32Array;
  private sparkCol: Float32Array;
  private flies: THREE.Points;
  private flyPos: Float32Array;
  private flyCol: Float32Array;
  private bubbles: THREE.Sprite[] = [];
  private fireLights: THREE.PointLight[] = [];
  lightsMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0x888888 });
  sirenMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  glowTint = new THREE.MeshBasicMaterial({ color: 0xffffff });
  people: PersonDraw[] = [];
  /** for picking in the Planner: the sim person behind each drawn walker */
  pickables: { x: number; y: number; z: number; ref: any }[] = [];
  private camX = 0;
  private camZ = 0;
  private range = 260;
  private t = 0;

  private fireFX: FireFX;
  private plaza: XmasPlaza;

  constructor(scene: THREE.Scene, private buildings: BuildingLayer) {
    scene.add(this.group);
    const g = this.group;
    this.fireFX = new FireFX(scene);
    this.plaza = new XmasPlaza(scene);
    this.legs = new InstancedPool(PERSON.leg, MAT.tint, PEOPLE_CAP * 2, g);
    this.arms = new InstancedPool(PERSON.arm, MAT.tint, PEOPLE_CAP * 2, g);
    this.torso = new InstancedPool(PERSON.torso, MAT.tint, PEOPLE_CAP, g);
    this.head = new InstancedPool(PERSON.head, MAT.tint, PEOPLE_CAP, g);
    this.hair = new InstancedPool(PERSON.hair, MAT.tint, PEOPLE_CAP, g);
    this.hairLong = new InstancedPool(PERSON.hairLong, MAT.tint, PEOPLE_CAP, g);
    const caps: Record<string, number> = { bicycle: 24, car: 500, taxi: 40, police: 30, fire: 12, bus: 24, moto: 80, loco: 16, coach: 60, wagon: 50, boat: 30, ferry: 3, raft: 12, heli: 4, plane: 5, balloon: 4, ufo: 1, sleigh: 1, ambulance: 8, truck: 24, van: 9, tractor: 3 };
    for (const [k, m] of Object.entries(VEHICLES)) {
      const cap = caps[k] || 8;
      this.veh[k] = {
        paint: new InstancedPool(m.paint, MAT.tint, cap, g),
        fixed: new InstancedPool(m.fixed, MAT.solid, cap, g),
        lights: new InstancedPool(m.lights, this.lightsMat, cap, g, false),
        siren: m.siren ? new InstancedPool(m.siren, this.sirenMat, cap, g, false) : undefined,
        rotor: m.rotor ? new InstancedPool(m.rotor, MAT.solid, cap, g) : undefined,
      };
    }
    for (const [k, p] of Object.entries(PROPS)) {
      const cap = k === 'puddle' ? 8 : k === 'bulb' ? 6000 : k === 'diya' ? 1200 : k === 'smoke' || k === 'flame' ? 8 : k === 'pole' || k === 'carry' ? 8 : k === 'jet' ? 64 : 160;
      this.props[k] = new InstancedPool(p.geo, p.glow ? this.glowTint : p.tinted ? MAT.tint : MAT.solid, cap, g, !p.glow && k !== 'puddle');
    }
    // fireworks & celebration sparks (V2 (Milestone 8): soft round glints, not square points)
    const N = 1600;
    this.sparkPos = new Float32Array(N * 3);
    this.sparkCol = new Float32Array(N * 3);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(this.sparkCol, 3));
    const glint = glintTexture();
    this.sparks = new THREE.Points(sg, new THREE.PointsMaterial({ size: 0.9, map: glint, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.sparks.frustumCulled = false;
    g.add(this.sparks);
    // fireflies: a few centimetres of cold light each (the same material, smaller, so the same shader)
    this.flyPos = new Float32Array(FLIES * 3);
    this.flyCol = new Float32Array(FLIES * 3);
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(this.flyPos, 3));
    fg.setAttribute('color', new THREE.BufferAttribute(this.flyCol, 3));
    this.flies = new THREE.Points(fg, new THREE.PointsMaterial({ size: 0.16, map: glint, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.flies.frustumCulled = false;
    g.add(this.flies);
    for (let i = 0; i < 40; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: true, transparent: true }));
      s.scale.set(1.1, 1.1, 1);
      s.visible = false;
      g.add(s);
      this.bubbles.push(s);
    }
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xff8a3a, 0, 40, 1.6);
      g.add(l);
      this.fireLights.push(l);
    }
    // V2: traffic-signal lenses, full-bright and coloured per instance (red, amber, green, or out)
    this.lenses = new InstancedPool(new MeshBuilder().box(-0.09, -0.09, -0.015, 0.09, 0.09, 0.015, hex('#ffffff')).build(), this.sirenMat, 720, g, false);
    this.fleet = new FarFleet(g, (m) => FLEET_CAPS[m.kind] ?? 40);
    this.flyers = new FlyingBirds(g);
    this.crowd = new Crowd(g);
    this.herd = new Herd(g);
  }
  private lenses: InstancedPool;
  /** V2 (Milestone 9): distant traffic drawn from the downloaded models, and far crowds from the modelled villagers */
  private fleet: FarFleet;
  /** V2: birds on the wing */
  private flyers: FlyingBirds;
  private crowd: Crowd;
  /** V2 (Milestone 9): the animals: those wanted this frame, the near ones' skinned bodies (kept by key), far herds,
   *  and the farm, zoo, park and street animals that aren't the sim's */
  private beastWant: BeastWant[] = [];
  private nearBeasts = new Map<string, { a: Animal; seen: number; x: number; z: number; v: number }>();
  private herd: Herd;
  private fauna = new Fauna();
  private faunaWired = false;

  private near(x: number, z: number, extra = 0): boolean {
    return Math.abs(x - this.camX) < this.range + extra && Math.abs(z - this.camZ) < this.range + extra;
  }
  /** V2: is (x, z) metres within the range things are drawn in round the view? */
  inRange(x: number, z: number, extra = 0): boolean {
    return this.near(x, z, extra);
  }

  /* ---------- drawing primitives ---------- */
  person(p: PersonDraw): void {
    if (this.people.length >= PEOPLE_CAP) return;
    this.people.push(p);
  }
  /** V2 (Milestone 9): an animal this frame, by model and a key of its own (so the same one keeps its body and its
   *  step from frame to frame); 'auto' walks it while it moves. False when the model isn't loaded (the caller draws
   *  its old figure) */
  animal(id: string, key: string, x: number, y: number, z: number, yaw: number, pose: BeastPose | 'auto', speed = 0): boolean {
    if (!beast(id)) return false;
    if (this.beastWant.length < 400) this.beastWant.push({ id, key, x, y, z, yaw, pose, speed });
    return true;
  }
  /** a vehicle this frame; `parked` ones stand with their lights off */
  vehicle(type: string, x: number, y: number, z: number, yaw: number, paint: THREE.Color, opts: VehOpts = {}): void {
    // nearby cars, cabs and patrol cars are drawn as full models
    if ((type === 'car' || type === 'taxi' || type === 'police') && !opts.scale && this.carWant.length < nearCars() * 2) {
      const d2 = (x - this.camX) ** 2 + (z - this.camZ) ** 2;
      if (d2 < nearCarsR() ** 2) {
        this.carWant.push({ type, x, y, z, yaw, paint: paint.clone(), siren: !!opts.siren, pitch: opts.pitch || 0, roll: opts.roll || 0, parked: !!opts.parked });
        return;
      }
    }
    this.instancedVehicle(type, x, y, z, yaw, paint, opts);
  }
  /** V2 (Milestone 9): the downloaded model for a vehicle type (a car's by its paint's style; the same paint, the same model) */
  private modelFor(type: string, paint: THREE.Color, seed?: number): VehicleModel | undefined {
    const kind = TYPE_KIND[type];
    if (!kind) return undefined;
    return pickModel(kind, type === 'car' ? styleForPaint(paint) : null, seed ?? seedOf(paint));
  }
  private instancedVehicle(type: string, x: number, y: number, z: number, yaw: number, paint: THREE.Color, opts: VehOpts = {}): void {
    const m = this.modelFor(type, paint, opts.seed);
    if (m) {
      const lit = opts.parked ? 0 : this.night > 0.2 || Weather.isRaining() ? 1 : 0;
      const flash = opts.siren || opts.beacon ? Math.floor(this.t * 6) % 2 : 0;
      this.fleet.add(m, x, y, z, yaw, paint, lit, flash, opts.pitch || 0, opts.roll || 0, opts.scale || 1, opts.rotor || 0);
      return;
    }
    const v = this.veh[type];
    if (!v) return;
    const s = opts.scale || 1;
    v.paint.add(x, y, z, yaw, s, paint, opts.pitch || 0, opts.roll || 0);
    v.fixed.add(x, y, z, yaw, s, null, opts.pitch || 0, opts.roll || 0);
    v.lights.add(x, y, z, yaw, s, opts.parked ? LIGHTS_OFF : LIGHTS_ON, opts.pitch || 0, opts.roll || 0);
    if (v.siren) {
      const on = opts.siren || opts.beacon ? Math.floor(this.t * 6) % 2 : -1;
      // blue lights for the emergency services, amber beacons for a works van
      const col = on < 0 ? (opts.beacon !== undefined ? hex('#7a5a20') : hex('#888888')) : opts.beacon ? (on ? hex('#ffb020') : hex('#7a5a20')) : on ? hex('#ff2a2a') : hex('#2a6aff');
      v.siren.add(x, y, z, yaw, s, col, opts.pitch || 0, opts.roll || 0);
    }
    if (v.rotor) v.rotor.add(x, y, z, yaw + (opts.rotor || 0), s);
  }
  prop(k: string, x: number, y: number, z: number, yaw = 0, scale = 1, color?: THREE.Color | null, sy?: number): void {
    this.props[k]?.add(x, y, z, yaw, scale, color || null, 0, 0, sy);
  }
  /** V2 (Milestone 6): a jet of water from a hose (metres), arcing to where it lands */
  spray(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    const h = Math.hypot(x1 - x0, z1 - z0), arc = Math.min(4, h * 0.18), yaw = Math.atan2(x1 - x0, z1 - z0);
    // V2 (Milestone 7): solid slugs of water along the arc (the additive glints alone vanished in daylight),
    // thickening as the jet breaks up, and a burst of spray where it lands
    const jet = this.props.jet, hd = Math.max(1, h);
    for (let i = 0; i < 40; i++) {
      const f = (this.t * 1.6 + i / 40) % 1;
      // nose along the arc: positive pitch tips +z down
      const slope = (y1 - y0) / hd + (Math.cos(f * Math.PI) * Math.PI * arc) / hd;
      const s = 0.8 + f * 1.3, wob = Math.sin(i * 12.9898 + this.t * 9) * 0.006 * f * h;
      jet.add(x0 + (x1 - x0) * f + Math.cos(yaw) * wob, y0 + (y1 - y0) * f + Math.sin(f * Math.PI) * arc, z0 + (z1 - z0) * f - Math.sin(yaw) * wob, yaw, s, JET, -Math.atan(slope));
    }
    for (let i = 0; i < 10; i++) {
      const a = i * 2.4 + this.t * 3, r = 0.4 + ((this.t * 2 + i * 0.37) % 1) * 1.6;
      this.prop('jet', x1 + Math.cos(a) * r, y1 + ((i * 0.53 + this.t) % 1) * 1.4, z1 + Math.sin(a) * r, a, 2.2, SPLASH);
    }
    for (let i = 0; i < 8; i++) {
      const f = (this.t * 2 + i / 8) % 1;
      this.spark(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f + Math.sin(f * Math.PI) * arc, z0 + (z1 - z0) * f, 0.6, 0.8, 1);
    }
  }

  /** V2 (Milestone 8): the Founder has the first of the hire bikes out */
  hireOut = false;
  /** the client adds its own figures each frame (the Founder's errands: a runaway dog) */
  extra: ((a: Actors) => void) | null = null;
  private drive: DrivewayCar[] = [];

  /* ---------- per-frame update ---------- */
  update(dt: number, camX: number, camZ: number, range: number, now: number, night: number): void {
    this.t += dt;
    this.dt = dt;
    this.night = night;
    this.carWant.length = 0;
    this.camX = camX;
    this.camZ = camZ;
    this.range = range;
    this.people.length = 0;
    this.pickables.length = 0;
    for (const p of [this.legs, this.arms, this.torso, this.head, this.hair, this.hairLong]) p.begin();
    for (const v of Object.values(this.veh)) {
      v.paint.begin(); v.fixed.begin(); v.lights.begin(); v.siren?.begin(); v.rotor?.begin();
    }
    for (const p of Object.values(this.props)) p.begin();
    this.lenses.begin();
    this.fleet.begin();
    this.flyers.begin();
    this.crowd.begin();
    this.herd.begin();
    this.beastWant.length = 0;
    this.lightsMat.color.setScalar(0.5 + night * 0.9);
    // festive bulbs, diyas and torches: bright enough to bloom after dark
    this.glowTint.color.setScalar(0.3 + night * 0.5);

    this.collectVillagers(now);
    this.collectParked();
    this.collectServices();
    this.collectSystems(now);
    this.collectSignals();
    this.collectTransit();
    this.collectCrowds();
    this.collectNature();
    this.collectFestive(night);
    this.collectFires(night);
    this.collectSky();
    this.collectFauna();
    this.extra?.(this);
    this.drawPeople();
    this.drawCars();
    this.drawAnimals();
    this.drawBubbles(now);
    this.drawSparks();

    for (const p of [this.legs, this.arms, this.torso, this.head, this.hair, this.hairLong]) p.end();
    for (const v of Object.values(this.veh)) {
      v.paint.end(); v.fixed.end(); v.lights.end(); v.siren?.end(); v.rotor?.end();
    }
    for (const p of Object.values(this.props)) p.end();
    this.lenses.end();
    this.fleet.end();
    this.flyers.end();
    this.crowd.end();
    this.herd.end();
  }

  private groundY(x: number, z: number, onStreet: boolean): number {
    const h = heightAt(x, z);
    if (h > 0.3) return h;
    const tx = Math.floor(x / TM), tz = Math.floor(z / TM);
    if (World.isRoad(tx, tz)) return (World.ground[World.idx(tx, tz)] === 1 ? 0.25 : 0.03) + (onStreet ? 0 : 0.17);
    return Math.max(0, h);
  }

  /* villagers out and about — on foot, by car, cab or motorbike */
  private collectVillagers(now: number): void {
    const raining = Weather.isRaining() || Weather.isSnowing();
    for (const p of Sim.people) {
      if (p.state === 'hurt') { // V2: hurt, on the ground, waiting for the ambulance
        const x = p.x * PX, z = p.y * PX;
        if (!this.near(x, z, 40)) continue;
        const y = this.groundY(x, z, false);
        this.person({ x, y, z, yaw: (p.seed % 628) / 100, kind: p.kind, seed: p.seed, mode: 'lie', phase: 0 });
        this.pickables.push({ x, y, z, ref: p });
        if (p.bubble && p.bubbleUntil > now) this.wantBubble(x, y + 1.0, z, p.bubble);
        continue;
      }
      if (p.state !== 'walk' || !p.trip) continue;
      const x = p.x * PX, z = p.y * PX;
      if (!this.near(x, z, 40)) continue;
      const t = p.trip;
      const hint = dirYaw(p.dirx || 0, p.diry || 0);
      if ((t.car || t.taxi) && t.joined === false && !(t.from && this.spotFree(p.at, t.from))) {
        // V2: waiting at the kerb for the cab to come (or for a gap, with no drive to wait in): the villager stands on
        // the pavement by their door. (Each one was drawn as a car of its own standing in the lane, a family's worth
        // stacked on one spot, with the traffic driving through them)
        const nx = -(p.diry || 0), nz = p.dirx || 0;
        const sx = (p.waitX ?? p.x + nx * (FOOT_PX - LANE_PX)) * PX, sz = (p.waitY ?? p.y + nz * (FOOT_PX - LANE_PX)) * PX;
        const y = this.groundY(sx, sz, false);
        this.person({ x: sx, y, z: sz, yaw: Math.atan2(-nx, -nz), kind: p.kind, seed: p.seed, mode: 'stand', phase: 0 });
        this.pickables.push({ x: sx, y, z: sz, ref: p });
        continue;
      }
      if (t.car || t.taxi) {
        // V2 (Milestone 8): its true heading through the bends (no lag behind the turn), and out of its drive or
        // bay onto the road at the start, and reversing into its spot at the end
        const cp = this.carPose(p, t);
        const col = t.taxi ? hex('#f2c230') : CAR_COLORS[(t.car.seed || 0) % CAR_COLORS.length];
        const gy = this.groundY(cp.x, cp.z, !cp.off);
        this.vehicle(t.taxi ? 'taxi' : 'car', cp.x, gy, cp.z, cp.yaw, col);
        if (p.bubble && p.bubbleUntil > now) this.wantBubble(cp.x, gy + 2.3, cp.z, p.bubble); // a driver's mood (the horn)
        continue;
      }
      if (t.moto) {
        const sm = { yaw: headYaw(p) };
        const y = this.groundY(x, z, true);
        this.vehicle('moto', x, y, z, sm.yaw, CAR_COLORS[p.seed % CAR_COLORS.length]);
        this.person({ x, y: y + 0.35, z, yaw: sm.yaw, kind: p.kind, seed: p.seed, mode: 'sit', phase: 0 });
        continue;
      }
      const sm = smooth(p, x, z, hint);
      // V2: at a rally or the polls (sim/hustings.ts): up on the stage speaking, clapping in the crowd, in the queue
      const cv = t.civic && t.civic.phase !== 'go' ? t.civic : null;
      const y = this.groundY(x, z, false) + (cv && cv.lift ? STAGE_DECK * cv.lift : 0);
      const frozen = p.freezeT > 0;
      const down = frozen && p.knocked; // knocked down by the Founder's car
      let mode: Mode = down ? 'lie' : frozen || !sm.moving ? 'stand' : 'walk';
      if (cv && mode === 'stand') mode = cv.speak ? 'speak' : cv.cheer ? 'cheer' : 'stand';
      this.person({ x, y, z, yaw: sm.yaw, kind: p.kind, seed: p.seed, mode, phase: sm.phase });
      this.pickables.push({ x, y, z, ref: p });
      // (a few supporters brought a placard in the candidate's colours, and wave it when the crowd cheers)
      if (cv && cv.kind === 'rally' && cv.role === 'crowd' && cv.phase === 'at' && p.seed % 4 === 0 && Life.rally)
        this.prop('placard', x, y + (cv.cheer ? 0.22 : 0), z, sm.yaw, 1, hex(Life.rally.color));
      if (raining && p.kind !== 'kid') this.prop('handUmbrella', x, y, z, sm.yaw, p.kind === 'kid' ? 0.7 : 1, SHIRT[(p.seed >> 3) % SHIRT.length]);
      if (t.dog !== undefined) {
        // (V2 (Milestone 9): the walker's own dog, one of the modelled breeds, at their side and at their pace)
        const ox = Math.cos(sm.yaw) * 0.7, oz = -Math.sin(sm.yaw) * 0.7;
        if (!this.animal(dogBreed(p.seed), `dog:${p.seed}`, x + ox, y, z + oz, sm.yaw, mode === 'walk' ? 'walk' : 'idle', 1.35))
          this.prop('dog', x + ox, y, z + oz, sm.yaw + Math.sin(sm.phase) * 0.1, 1, hex(t.dog ? '#8a6a42' : '#e8e0d0'));
      }
      if (p.bubble && p.bubbleUntil > now) this.wantBubble(x, y + 2.4 * (p.kind === 'kid' ? 0.65 : 1), z, p.bubble);
    }
  }

  /* V2 (Milestone 8): where a villager's car is drawn: in its lane (sim), or pulling out of the drive or bay it
     stood in (a curve from the spot, out along the drive and round into the lane), or at the end of the drive
     going past its spot and reversing in (so it ends up standing nose to the street, as the parked cars do) */
  private cpOut = { x: 0, z: 0, yaw: 0, off: false };
  private spotFreeFn = (b: any, s: { x: number; z: number; yaw: number }): boolean => this.spotFree(b, s);
  private carPose(p: any, t: any): { x: number; z: number; yaw: number; off: boolean } {
    return carDrawPose(p, t, this.spotFreeFn, this.cpOut);
  }
  /** is a parking spot clear of the building's own walls (some plots are built right up to the street)? */
  private spotOk = new Map<string, boolean>();
  private spotFree(b: any, s: { x: number; z: number; yaw: number }): boolean {
    if (!b) return false;
    const key = `${b.id}|${b.variant}|${b.facing || 0}|${s.x.toFixed(1)},${s.z.toFixed(1)}`;
    let ok = this.spotOk.get(key);
    if (ok === undefined) {
      const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
      ok = true;
      for (const [x0, z0, x1, z1] of this.buildings.solidsNear(s.x, s.z, 4)) {
        // the car's footprint, as five points along its length (it's 4.5 m by 1.8)
        for (let k = -2; k <= 2 && ok; k++) for (const w of [-0.8, 0.8]) {
          const px = s.x + fx * k * 1.05 + fz * w, pz = s.z + fz * k * 1.05 - fx * w;
          if (px > x0 && px < x1 && pz > z0 && pz < z1) { ok = false; break; }
        }
        if (!ok) break;
      }
      if (this.spotOk.size > 4000) this.spotOk.clear();
      this.spotOk.set(key, ok);
    }
    return ok;
  }

  /* cars at home in the driveway, and at venues while their drivers are inside */
  private collectParked(): void {
    for (const b of World.buildings) {
      const bx = (b.x + b.w / 2) * TM, bz = (b.y + b.h / 2) * TM;
      if (!this.near(bx, bz, 30) || b.ruined) continue;
      const f = b.facing || 0;
      const d = CAT[b.type];
      // driveway: along the right-hand side of the plot, nose to the street
      const toWorld = (lx: number, lz: number) => {
        const [rx, rz] = f === 0 ? [lx, lz] : f === 1 ? [lz, -lx] : f === 2 ? [-lx, -lz] : [-lz, lx];
        return [bx + rx, bz + rz];
      };
      const yaw = (f * Math.PI) / 2;
      const W = (d.w || 1) * TM, D = (d.h || 1) * TM;
      if (b.construction > 0) {
        // a building site: no cars yet (its crew and materials are drawn below)
      } else if (d.res && b.cars) {
        for (const c of drivewayCars(b, this.drive)) this.vehicle('car', c.x, 0.13, c.z, c.yaw, c.color, { parked: true });
        this.drive.length = 0;
        if (b.bikes) {
          const [x, z] = toWorld(-W / 2 + 1.5, D / 2 - 2);
          this.vehicle('moto', x, 0.1, z, yaw, CAR_COLORS[(b.id * 3) % CAR_COLORS.length], { parked: true });
        }
      } else if (b.parked > 0 && !d.res) {
        // V2 (Milestone 8): in marked bays across the front of the plot, nose in (sim/parking.ts)
        for (let k = 0; k < Math.min(bayCount(b), b.parked); k++) {
          const s = baySpot(b, k);
          if (s && this.spotFree(b, s)) this.vehicle('car', s.x, 0.13, s.z, s.yaw, CAR_COLORS[(b.id + k * 3) % CAR_COLORS.length], { parked: true });
        }
      }
      // construction crews on site (V2: idle by an empty yard while they wait for materials)
      if (b.construction > 0 && b.stalled) {
        for (let k = 0; k < 2; k++) {
          const [x, z] = toWorld(-W / 2 + 1.2 + k * 1.1, D / 2 + 0.6);
          this.person({ x, y: 0.1, z, yaw: yaw + (k ? 0.6 : -0.4), kind: 'man', seed: b.id * 7 + k, mode: 'stand', phase: 0, job: 'construction', shirt: hex('#f26a1a'), hair: hex('#f2c230') });
          if (k === 0 && Math.floor(this.t / 4 + b.id) % 3 === 0) this.wantBubble(x, 2.5, z, '⏳');
        }
      } else if (b.construction > 0 || b.upgrading > 0) this.siteCrew(b, f, W, D, toWorld);
      // V2: the materials on site, a pallet for every few loads (none left: the site stalls)
      if (b.construction > 0 && b.mats > 0.3) {
        const n = Math.min(4, Math.ceil(b.mats / 5));
        for (let k = 0; k < n; k++) {
          const [x, z] = toWorld(W / 2 - 1.2 - k * 1.5, D / 2 - 1.1);
          this.prop(k % 2 ? 'timber' : 'bricks', x, 0.05, z, yaw + (k % 2 ? Math.PI / 2 : 0));
        }
      }
    }
  }

  /* V2 (Milestone 8): a crew at work on a building site, sized to the job: bricklayers and carpenters up on the
     scaffold at the height the walls have reached, hammering away; a labourer carrying loads from the pallets to
     the foot of the scaffold and walking back for more; a foreman with the plans by the gate. In working hours
     only (after dark the site stands quiet). They used to be two men walking round and round the plot. */
  private siteCrew(b: any, f: number, W: number, D: number, toWorld: (lx: number, lz: number) => number[]): void {
    const c = Sim.clock;
    if (c < 400 || c > 1110) return;
    const H = this.buildings.heightOf(b.id);
    const p = b.construction > 0 ? Math.max(0.04, 1 - b.construction / Math.max(1, b.conTotal || 40 + b.w * b.h * 22)) : 1;
    const top = H * p;
    // the plank they stand on: the scaffold's lift just below the top of the walls (on the ground at first)
    const lift = top < 2.4 ? 0 : Math.min(Math.floor((top - 0.6) / 2) * 2, Math.max(0, H - 2));
    const x0 = -W / 2 + 0.4, x1 = W / 2 - 0.4, z0 = -D / 2 + 0.4, z1 = D / 2 - 0.4;
    const yawOf = (dx: number, dz: number): number => {
      const [rx, rz] = f === 0 ? [dx, dz] : f === 1 ? [dz, -dx] : f === 2 ? [-dx, -dz] : [-dz, dx];
      return Math.atan2(rx, rz);
    };
    const hi = hex('#f26a1a'), hat = hex('#f2c230');
    const crew = Math.max(2, Math.min(6, 1 + Math.round((W * D) / 90)));
    // the scaffold's four sides (local), each worker on a stretch of one, facing the wall
    const sides: [number, number, number, number, number, number][] = [
      [x0, z1 + 0.05, x1, z1 + 0.05, 0, -1], [x1 + 0.05, z0, x1 + 0.05, z1, -1, 0], [x0, z0 - 0.05, x1, z0 - 0.05, 0, 1], [x0 - 0.05, z0, x0 - 0.05, z1, 1, 0],
    ];
    // (V2: while they work at ground level, the right-hand side is the labourer's way in from the pallets, and two
    // on the same side keep to their own halves of it: they used to walk through each other)
    const use = lift > 0 ? [0, 1, 2, 3] : [0, 2, 3];
    const onSide = [0, 0, 0, 0];
    for (let k = 1; k < crew; k++) {
      const si = use[(k + b.id) % use.length], j = onSide[si]++;
      const [ax, az, bx2, bz2, fx, fz] = sides[si];
      // a spot along the plank, moved on every half a minute or so (a few steps along to the next stretch)
      const seg = Math.floor(this.t / 28 + k * 0.37 + b.id), shift = this.t / 28 + k * 0.37 + b.id - seg;
      const u0 = ((hash2(b.id * 31 + k, seg) % 1000) / 1000) * 0.38 + 0.1 + (j % 2) * 0.42, u1 = ((hash2(b.id * 31 + k, seg + 1) % 1000) / 1000) * 0.38 + 0.1 + (j % 2) * 0.42;
      const walking = shift > 0.9;
      const u = walking ? u0 + (u1 - u0) * (shift - 0.9) * 10 : u0;
      const lx = ax + (bx2 - ax) * u, lz = az + (bz2 - az) * u;
      const [x, z] = toWorld(lx, lz);
      const along = Math.sign(u1 - u0) || 1;
      const yaw = walking ? yawOf((bx2 - ax) * along, (bz2 - az) * along) : yawOf(fx, fz);
      this.person({ x, y: lift + 0.05, z, yaw, kind: 'man', seed: b.id * 7 + k, mode: walking ? 'walk' : 'work', phase: this.t * 4 + k, job: 'construction', shirt: hi, hair: hat });
    }
    // the labourer: a load from the pallets at the front corner to the foot of the scaffold, and back for more
    const cyc = (this.t / 14 + b.id * 0.13) % 1;
    const from = toWorld(W / 2 - 1.2, D / 2 - 1.1), to = toWorld(x1 + 0.6, z1 - 2.2);
    const out = cyc < 0.42, back = cyc > 0.5 && cyc < 0.92;
    const k = out ? cyc / 0.42 : back ? 1 - (cyc - 0.5) / 0.42 : cyc <= 0.5 ? 1 : 0;
    const lx = from[0] + (to[0] - from[0]) * k, lz = from[1] + (to[1] - from[1]) * k;
    const yaw = out ? Math.atan2(to[0] - from[0], to[1] - from[1]) : Math.atan2(from[0] - to[0], from[1] - to[1]);
    this.person({ x: lx, y: 0.1, z: lz, yaw, kind: 'man', seed: b.id * 7 + 9, mode: out ? 'carry' : back ? 'walk' : 'work', phase: this.t * 4, job: 'construction', shirt: hi, hair: hat });
    if (out) this.prop('crate', lx + Math.sin(yaw) * 0.45, 0.95, lz + Math.cos(yaw) * 0.45, yaw, 0.55);
    // the foreman, by the front with the plans
    const [fx2, fz2] = toWorld(-W / 2 + 1.3, D / 2 + 0.9);
    this.person({ x: fx2, y: 0.1, z: fz2, yaw: yawOf(0.3, -1), kind: 'man', seed: b.id * 7 + 13, mode: 'stand', phase: 0, job: 'construction', shirt: hex('#f4f4f0'), hair: hex('#f4f4f4') });
  }

  /* police, fire brigade, burglars, crashes, disputes, road works, reporters */
  private collectServices(): void {
    for (const u of Life.police) {
      const x = u.x * PX, z = u.y * PX;
      if (!this.near(x, z, 40)) continue;
      const sm = { yaw: headYaw(u) };
      this.vehicle('police', x, this.groundY(x, z, true), z, sm.yaw, hex('#f4f6f7'), { siren: u.phase === 'go' || u.phase === 'scene' });
    }
    for (const u of Life.fireTrucks) {
      const x = u.x * PX, z = u.y * PX;
      if (!this.near(x, z, 40)) continue;
      const sm = { yaw: headYaw(u) };
      this.vehicle('fire', x, this.groundY(x, z, true), z, sm.yaw, hex('#c0302a'), { siren: u.phase !== 'return' });
      if (u.phase === 'douse' && u.target) {
        // the crew on the hose
        const tb = u.target;
        const tx = (tb.x + tb.w / 2) * TM, tz = (tb.y + tb.h / 2) * TM;
        const yaw = Math.atan2(tx - x, tz - z);
        for (let k = 0; k < 2; k++) {
          const px = x + Math.sin(yaw) * (3 + k) + Math.cos(yaw) * (k ? 1 : -1), pz = z + Math.cos(yaw) * (3 + k) - Math.sin(yaw) * (k ? 1 : -1);
          this.person({ x: px, y: 0.2, z: pz, yaw, kind: 'man', seed: u.target.id + k, mode: 'stand', phase: 0, job: 'fire', shirt: hex('#2a2a2a'), hair: hex('#f2c230') });
        }
        for (let i = 0; i < 18; i++) {
          const f = ((this.t * 2 + i / 18) % 1);
          const sx = x + (tx - x) * f, sz = z + (tz - z) * f;
          this.spark(sx, 2 + Math.sin(f * Math.PI) * 4, sz, 0.6, 0.8, 1);
        }
      }
    }
    const c = Life.crime;
    if (c && c.burglar) {
      const B = c.burglar;
      const x = B.x * PX, z = B.y * PX;
      if (this.near(x, z)) {
        const sm = smooth(B, x, z, null);
        this.person({ x, y: this.groundY(x, z, false), z, yaw: sm.yaw, kind: 'man', seed: B.seed, mode: B.phase === 'rob' ? 'stand' : 'run', phase: sm.phase, shirt: hex('#1a1a1a'), pants: hex('#1a1a1a'), hair: hex('#1a1a1a') });
      }
    }
    if (Life.crash) {
      const k = Life.crash;
      const x = k.x * PX, z = k.y * PX;
      if (k.founder) { // the Founder's own car is the other one
        this.vehicle(k.taxi ? 'taxi' : 'car', x, 0.03, z, k.a1, k.taxi ? hex('#f2c230') : CAR_COLORS[k.s1 % 8], { roll: 0.08 });
      } else {
        this.vehicle('car', x - 1.5, 0.03, z, k.a1, CAR_COLORS[k.s1 % 8], { roll: 0.08 });
        this.vehicle('car', x + 1.5, 0.03, z + 0.6, k.a2, CAR_COLORS[k.s2 % 8], { pitch: -0.06 });
      }
      this.prop('cone', x - 4, 0.03, z - 2.5);
      this.prop('cone', x + 4, 0.03, z + 2.5);
    }
    for (const rw of Life.roadworks) {
      // V2: one lane closed, where the traffic knows it is (sim/traffic.ts workZone): the barrier across it facing
      // the traffic that comes along it, cones down its edge by the centre line, the crew inside (they used to
      // stand across both lanes while the cars drove through them)
      const zn = rw.zone ?? workZone(rw);
      const x = zn.x * PX, z = zn.y * PX, hx = zn.hx, hz = zn.hy, L = zn.len * TM;
      if (!this.near(x, z)) continue;
      const yaw = Math.atan2(hx, hz), side = { x: -hz, z: hx }; // (the closed lane's left: towards the centre line)
      this.prop('barrier', x - hx * (L / 2), 0.03, z - hz * (L / 2), yaw, 0.82);
      for (const k of [-0.25, 0.1, 0.45]) this.prop('cone', x + hx * L * k + side.x * 0.75, 0.03, z + hz * L * k + side.z * 0.75);
      const w = Math.sin(this.t * 0.4 + rw.x) * 0.9;
      this.person({ x: x + hx * w - side.x * 0.2, y: 0.03, z: z + hz * w - side.z * 0.2, yaw: yaw + Math.PI / 2 + Math.sin(this.t * 0.7) * 0.6, kind: 'man', seed: rw.x * 13 + rw.y, mode: 'work', phase: this.t * 4, job: 'construction', shirt: hex('#f26a1a'), hair: hex('#f2c230') });
    }
    for (const r of Life.reporters) this.lerpPerson(r, 'stand', { camera: true, shirt: hex('#3a5ad0') });
  }

  /* V2 (Milestone 4): ambulances and their crews, delivery trucks, the power company's vans */
  private collectSystems(now: number): void {
    for (const a of Life.ambulances) {
      const x = a.x * PX, z = a.y * PX;
      if (!this.near(x, z, 40)) continue;
      const sm = { yaw: headYaw(a) };
      this.vehicle('ambulance', x, this.groundY(x, z, true), z, sm.yaw, hex('#f6f6f2'), { siren: a.phase !== 'return' || a.patient?.state === 'amb' });
      if (a.phase === 'treat' && a.patient) {
        // two paramedics over the casualty, the bag open beside them
        const p = a.patient, px = p.x * PX, pz = p.y * PX, py = this.groundY(px, pz, false);
        for (let k = 0; k < 2; k++) {
          const ang = k * Math.PI + (p.seed % 7) * 0.3;
          const mx = px + Math.cos(ang) * 1.0, mz = pz + Math.sin(ang) * 1.0;
          this.person({ x: mx, y: py, z: mz, yaw: Math.atan2(px - mx, pz - mz), kind: k ? 'woman' : 'man', seed: a.from.id * 13 + k, mode: 'stand', phase: 0, job: 'medical', shirt: hex('#2e8a4e'), pants: hex('#24603a') });
        }
        this.prop('medbag', px + 0.6, py, pz + 0.7, 0.4);
        void now;
      }
    }
    for (const t of Life.trucks) {
      const x = t.x * PX, z = t.y * PX;
      if (!this.near(x, z, 40)) continue;
      const sm = { yaw: headYaw(t) };
      this.vehicle('truck', x, this.groundY(x, z, true), z, sm.yaw, hex(GOODS[t.g as keyof typeof GOODS].color));
      if (t.phase === 'drop') {
        // the driver wheels the load in
        const bx = x - Math.sin(sm.yaw) * 4.2, bz = z - Math.cos(sm.yaw) * 4.2;
        this.person({ x: bx + Math.cos(sm.yaw) * 1.4, y: this.groundY(bx, bz, false), z: bz - Math.sin(sm.yaw) * 1.4, yaw: sm.yaw + Math.PI / 2, kind: 'man', seed: t.seed, mode: 'stand', phase: 0, job: 'delivery', shirt: hex('#3a4a5a') });
        this.prop('crate', bx + Math.cos(sm.yaw) * 2, 0.05, bz - Math.sin(sm.yaw) * 2, sm.yaw);
      }
    }
    for (const c of Life.crews) {
      if (c.phase === 'wait') continue; // still setting out from the county yard
      const x = c.x * PX, z = c.y * PX;
      if (!this.near(x, z, 40)) continue;
      const sm = { yaw: headYaw(c) };
      this.vehicle('van', x, this.groundY(x, z, true), z, sm.yaw, hex('#f2f0e8'), { beacon: c.phase === 'fix' || c.phase === 'go' });
      if (c.phase === 'fix') {
        // two linesmen in hi-vis at the kerb, one up a ladder at the pole
        for (let k = 0; k < 2; k++) {
          const ox = Math.cos(sm.yaw) * (2.2 + k * 0.8), oz = -Math.sin(sm.yaw) * (2.2 + k * 0.8);
          const px = x + ox - Math.sin(sm.yaw) * (k ? 1.5 : -1), pz = z + oz - Math.cos(sm.yaw) * (k ? 1.5 : -1);
          this.person({ x: px, y: this.groundY(px, pz, false) + (k ? 1.4 : 0), z: pz, yaw: sm.yaw - Math.PI / 2, kind: 'man', seed: c.seed + k, mode: 'stand', phase: 0, job: 'construction', shirt: hex('#f2c230'), hair: hex('#f2f2f2') });
        }
      }
    }
  }

  /* V2: traffic signals at the junctions the sim lights; dark when the district's power is out.
     Each post carries two three-lamp heads back to back, facing the traffic it governs. */
  private collectSignals(): void {
    const heads = World.signalHeads as [number, number, number][] | undefined;
    if (!heads || !heads.length) return;
    const ms = performance.now();
    const nsGreen = World.nsGreen();
    const amber = (ms % 8000) / 8000 > 0.8;
    const OFF = hex('#151413'), RED = hex('#ff2a18'), AMB = hex('#ffa412'), GRN = hex('#22ff78');
    for (const [hx, hy, aspect] of heads) {
      const x = aspect === 0 ? hx * TM + TM - 0.9 : hx * TM + 0.9;
      const z = aspect === 0 ? hy * TM + TM - 0.9 : hy * TM + 0.9;
      if (!this.near(x, z, -60)) continue;
      const yaw = aspect === 0 ? 0 : Math.PI / 2;
      const y = this.groundY(x, z, false);
      this.prop('sigPole', x, y, z, yaw);
      const dark = Power.tileDark(Math.floor(x / TM), Math.floor(z / TM));
      const go = aspect === 0 ? nsGreen : !nsGreen;
      const cols = dark ? [OFF, OFF, OFF] : go ? [OFF, amber ? AMB : OFF, amber ? OFF : GRN] : [RED, OFF, OFF];
      const sy = Math.sin(yaw), cy = Math.cos(yaw);
      for (const side of [1, -1]) {
        const zl = 0.31 * side;
        [3.17, 2.85, 2.53].forEach((ly, i) => this.lenses.add(x + sy * zl, y + ly, z + cy * zl, yaw, 1, cols[i]));
      }
    }
  }

  /* someone hurrying from a doorway (sx,sy) to a scene (tx,ty) by fraction f */
  private lerpPerson(o: any, endMode: Mode, extra: { camera?: boolean; bucket?: boolean; shirt?: THREE.Color; placard?: THREE.Color; face?: { x: number; z: number } } = {}): void {
    const f = Math.max(0, Math.min(1, o.f));
    // (V2: along the route the sim walks them, by the streets: sim/walking.ts Stroll)
    const x = (o.route ? o.x : o.sx + (o.tx - o.sx) * f) * PX, z = (o.route ? o.y : o.sy + (o.ty - o.sy) * f) * PX;
    if (!this.near(x, z)) return;
    const moving = f > 0 && f < 1;
    const sm = smooth(o, x, z, null);
    let yaw = sm.yaw;
    if (!moving && extra.face) yaw = Math.atan2(extra.face.x - x, extra.face.z - z);
    const y = this.groundY(x, z, false);
    this.person({ x, y, z, yaw, kind: o.kind || (o.seed % 2 ? 'woman' : 'man'), seed: o.seed, mode: moving ? 'run' : endMode, phase: sm.phase, shirt: extra.shirt });
    if (extra.camera) this.prop('camera', x, y, z, yaw);
    if (extra.bucket) this.prop('bucket', x, y, z, yaw);
  }

  /* buses, cabs, trains, tourists, campaign cars, boats and the ferry */
  private collectTransit(): void {
    for (const bus of Life.buses) {
      if (bus.hidden) continue; // (back at the depot for the night)
      const x = bus.x * PX, z = bus.y * PX;
      if (!this.near(x, z, 40)) continue;
      const sm = { yaw: headYaw(bus) };
      this.vehicle('bus', x, this.groundY(x, z, true), z, sm.yaw, hex('#2a6ab8'));
    }
    for (const cab of Life.taxis) {
      const x = cab.x * PX, z = cab.y * PX;
      if (!this.near(x, z, 40)) continue;
      const sm = { yaw: headYaw(cab) };
      this.vehicle('taxi', x, this.groundY(x, z, true), z, sm.yaw, hex('#f2c230'));
    }
    for (const t of Life.tourists) {
      if (t.phase === 'visit') continue;
      const x = t.x * PX, z = t.y * PX;
      if (!this.near(x, z, 40)) continue;
      const sm = { yaw: headYaw(t) };
      this.vehicle('car', x, this.groundY(x, z, true), z, sm.yaw, CAR_COLORS[(t.seed + 3) % 8]);
    }
    for (const cc of Life.campaignCars) {
      const x = cc.x * PX, z = cc.y * PX;
      if (!this.near(x, z, 40)) continue;
      const sm = { yaw: headYaw(cc) };
      const col = Gov.campaign ? hex(Gov.campaign.candidates[cc.ci]?.color || '#4f8ede') : hex('#4f8ede');
      this.vehicle('car', x, this.groundY(x, z, true), z, sm.yaw, col);
    }
    // trains: the consist trails behind the engine along the track (V2: and the Intercity Express on the national line)
    for (const tr of Life.intercity ? Life.trains.concat([Life.intercity]) : Life.trains) {
      if (tr.hidden || !tr.route) continue;
      const lane = (tr.lane || 0) * PX;
      const n = (tr.cars || 3) + 1;
      // V2 (Milestone 9): each car spaced by its model's real length (a locomotive, the railcars or wagons behind)
      let off = 0, prevLen = 0;
      for (let k = 0; k < n; k++) {
        const kt = k === 0 ? 'loco' : tr.type === 'freight' ? 'wagon' : 'coach';
        const len = (this.modelFor(kt, hex('#ffffff'))?.dims.L ?? 9.0) + 0.5;
        if (k > 0) off += (prevLen + len) / 2 / TM;
        prevLen = len;
        const prog = tr.prog - tr.dir * off;
        if (prog < -0.4 || prog > tr.route.length - 0.6) continue;
        // V2 (Milestone 8): every car round the curve on the train's own track (it used to swap tracks at a bend)
        const pt = railPose(tr.route, Math.max(0, Math.min(tr.route.length - 1, prog)), lane / PX);
        const x = pt.x * PX, z = pt.y * PX;
        if (!this.near(x, z, 60)) continue;
        const yaw = Math.atan2(pt.hx * tr.dir, pt.hy * tr.dir);
        const onBridge = World.ground[World.idx(Math.floor(x / TM), Math.floor(z / TM))] === 1;
        const y = onBridge ? 0.5 : 0.38;
        const type = k === 0 ? 'loco' : tr.type === 'freight' ? 'wagon' : 'coach';
        const paint = tr.type === 'freight' ? hex(k === 0 ? '#3a4a3a' : '#8a5a3a') : tr.type === 'express' ? hex('#c8ccd4') : tr.type === 'nightliner' ? hex('#2a3a6a') : tr.type === 'intercity' ? hex(k === 0 ? '#e8e4da' : '#2a5a9a') : hex('#c0392b');
        this.vehicle(type, x, y, z, yaw, paint);
      }
    }
    Life.boats.forEach((b: any, i: number) => this.boat(b, 'boat', hex('#f4f0e4'), i));
    if (Life.ferry) this.boat(Life.ferry, 'ferry', hex('#2a5a8a'));
    for (const r of Calamity.rafts) {
      const x = r.x * PX, z = r.y * PX;
      if (this.near(x, z)) {
        const sm = smooth(r, x, z, null);
        this.vehicle('raft', x, 0.55, z, sm.yaw, hex('#a07a4a'));
        this.person({ x, y: 0.85, z, yaw: sm.yaw, kind: r.ph % 2 > 1 ? 'woman' : 'man', seed: Math.floor(r.ph * 100), mode: 'stand', phase: 0 });
      }
    }
  }
  private boat(b: any, type: string, col: THREE.Color, seed = 0): void {
    const x = b.x * PX, z = b.y * PX;
    if (!this.near(x, z, 60)) return;
    const sm = smooth(b, x, z, b.dirx !== undefined ? dirYaw(b.dirx, b.diry) : b.flip ? (b.flip > 0 ? Math.PI / 2 : -Math.PI / 2) : null);
    this.vehicle(type, x, -0.35 + Math.sin((b.ph || 0) * 2) * 0.08, z, sm.yaw, col, { seed });
  }

  /* crowds: gawkers, bucket brigades, rubble-clearers, rallies, riots, queues, beach days, hikers */
  private collectCrowds(): void {
    for (const gk of Life.gawkers) this.lerpPerson(gk, 'stand', { face: { x: gk.tx * PX, z: gk.ty * PX } });
    // V2 (Milestone 5): visitors from out of town, walking between the gateway and the sights
    for (const v of Gateways.visitors) {
      if (v.phase === 'stay') continue;
      const x = v.x * PX, z = v.y * PX;
      if (!this.near(x, z)) continue;
      const sm = smooth(v, x, z, dirYaw(v.dirx || 0, v.diry || 0));
      this.person({ x, y: this.groundY(x, z, false), z, yaw: sm.yaw, kind: v.kind, seed: v.seed, mode: 'walk', phase: sm.phase });
    }
    for (const k of Life.buckets) for (const h of k.helpers) this.lerpPerson(h, 'stand', { bucket: true, face: { x: (k.b.x + k.b.w / 2) * TM, z: (k.b.y + k.b.h / 2) * TM } });
    if (Life.disaster) for (const h of Life.disaster.helpers) this.lerpPerson(h, 'stand', { face: { x: (Life.disaster.b.x + Life.disaster.b.w / 2) * TM, z: (Life.disaster.b.y + Life.disaster.b.h / 2) * TM } });
    // V2: the rally's stage on its green, the candidate's colours behind it (sim/hustings.ts). The crowd and the
    // candidate are villagers, drawn with everyone else; a candidate from outside the village is drawn here
    const rally = Life.rally;
    if (rally) {
      const sx = rally.x * PX, sz = rally.y * PX, yaw = Math.atan2(rally.fx, rally.fy);
      if (this.near(sx, sz, 40)) {
        const gy = this.groundY(sx, sz, false);
        this.prop('stage', sx, gy, sz, yaw);
        const bx = sx - Math.sin(yaw) * 1.18, bz = sz - Math.cos(yaw) * 1.18;
        this.prop('bannerPoles', bx, gy, bz, yaw);
        this.prop('banner', bx, gy, bz, yaw, 1, hex(rally.color));
        const si = rally.standIn;
        if (si && si.shown) {
          const x = si.x * PX, z = si.y * PX;
          const walking = si.phase === 'in' || si.phase === 'out' || si.phase === 'climb' || si.phase === 'down';
          this.person({
            x, y: this.groundY(x, z, false) + STAGE_DECK * si.lift, z, yaw: Math.atan2(si.dirx || 0, si.diry || 1), kind: si.kind, seed: si.seed,
            mode: walking ? 'walk' : rally.phase === 'speech' ? 'speak' : 'stand', phase: this.t * 3, shirt: hex(rally.color),
          });
        }
      }
    }
    const riot = Life.riot;
    if (riot) {
      for (const c of riot.crowd) {
        const x = c.x * PX, z = c.y * PX + 2;
        const yaw = Math.PI + Math.sin(this.t * 3 + c.seed) * 0.3;
        this.person({ x, y: 0.2, z, yaw, kind: c.kind, seed: c.seed, mode: 'stand', phase: 0 });
        this.prop('placard', x, 0.2 + Math.abs(Math.sin(this.t * 4 + c.seed)) * 0.3, z, yaw, 1, hex('#f4f0e4'));
      }
    }
    // V2: the polling station on its green, 08:00–20:00: booths under a canopy, the ballot box, the sign by the
    // street; the voters and their queue are villagers (sim/hustings.ts)
    const vb = Life.votingBooths;
    if (vb) {
      const cx = vb.x * PX, cz = vb.y * PX, yaw = Math.atan2(vb.fx, vb.fy);
      if (this.near(cx, cz, 40)) {
        this.prop('canopy', cx, this.groundY(cx, cz, false), cz, yaw);
        for (const b of vb.booths) {
          const x = b.x * PX, z = b.y * PX;
          this.prop('booth', x, this.groundY(x, z, false), z, yaw, 1, BOOTH);
        }
        const bx = vb.box.x * PX, bz = vb.box.y * PX, sx = vb.sign.x * PX, sz = vb.sign.y * PX;
        this.prop('ballotBox', bx, this.groundY(bx, bz, false), bz, yaw);
        this.prop('pollSign', sx, this.groundY(sx, sz, false), sz, yaw);
      }
    }
    // queues at bus shelters and taxi ranks
    for (const [id, q] of Life.stopQueues as Map<number, any>) {
      if (!q.waiting.length) continue;
      const b = World.buildings.find((o: any) => o.id === id);
      if (!b) continue;
      const x0 = b.door.x * TM + 4, z0 = b.door.y * TM + 4;
      if (!this.near(x0, z0)) continue;
      q.waiting.forEach((w: any, i: number) => {
        const s = Life.queueSpot(b, i);
        this.person({ x: s.x * PX, y: 0.15, z: s.y * PX, yaw: s.yaw, kind: w.kind, seed: w.seed, mode: 'stand', phase: 0 });
      });
    }
    for (const a of Life.alighters) {
      const x = a.x * PX, z = a.y * PX;
      if (!this.near(x, z)) continue;
      this.person({ x, y: this.groundY(x, z, false), z, yaw: Math.atan2(a.vx, a.vy), kind: a.kind, seed: a.seed, mode: 'walk', phase: a.ph });
    }
    for (const bf of Life.beachfolk) {
      const x = bf.x * PX, z = bf.y * PX;
      if (!this.near(x, z)) continue;
      const seedYaw = (bf.seed % 628) / 100;
      if (bf.mode === 'towel') {
        this.prop('towel', x, 0.02, z, seedYaw, 1, hex(bf.towelC));
        this.person({ x, y: 0.12, z, yaw: seedYaw, kind: bf.kind, seed: bf.seed, mode: 'lie', phase: 0 });
      } else this.person({ x, y: bf.mode === 'wade' ? -0.5 : 0.02, z, yaw: seedYaw + Math.sin(bf.ph * 0.3), kind: bf.kind, seed: bf.seed, mode: 'stand', phase: 0 });
      if (bf.umbrella) this.prop('umbrella', x + 0.8, 0, z + 0.4, 0, 1, hex(bf.towelC));
    }
    for (const h of Life.hikers) {
      const x = h.x * PX, z = h.y * PX;
      if (!this.near(x, z, 80)) continue;
      const sm = smooth(h, x, z, null);
      const y = heightAt(x, z);
      if (h.bike) {
        // (V2 (Milestone 8): a mountain biker, astride; off and standing by it at the top)
        const kit = SHIRT[(h.seed >> 2) % SHIRT.length];
        if (h.pause > 0) {
          this.vehicle('bicycle', x + Math.cos(sm.yaw) * 0.6, y, z - Math.sin(sm.yaw) * 0.6, sm.yaw, CAR_COLORS[h.seed % CAR_COLORS.length], { parked: true });
          this.person({ x, y, z, yaw: sm.yaw, kind: h.seed % 2 ? 'woman' : 'man', seed: h.seed, mode: 'stand', phase: 0, shirt: kit });
        } else {
          this.vehicle('bicycle', x, y, z, sm.yaw, CAR_COLORS[h.seed % CAR_COLORS.length], { parked: true });
          this.person({ x, y: y + 0.3, z, yaw: sm.yaw, kind: h.seed % 2 ? 'woman' : 'man', seed: h.seed, mode: 'sit', phase: 0, shirt: kit });
        }
        continue;
      }
      this.person({ x, y, z, yaw: sm.yaw, kind: h.seed % 2 ? 'woman' : 'man', seed: h.seed, mode: h.pause > 0 ? 'stand' : 'walk', phase: sm.phase, shirt: hex('#c0703a') });
      if (Sim.clock > 1140 || Sim.clock < 360) this.prop('torch', x, y, z, sm.yaw, 1, hex('#ffb040'));
    }
  }

  /* ducks, birds, butterflies, puddles, the tornado */
  private collectNature(): void {
    Life.ducks.forEach((d: any, i: number) => {
      const x = d.x * PX, z = d.y * PX;
      if (!this.near(x, z)) return;
      const sm = smooth(d, x, z, null);
      // (V2 (Milestone 9): the mallard rides the water, its body a third under)
      if (!this.animal('duck', `duck:${i}`, x, -0.58, z, sm.yaw, 'swim')) this.prop('duck', x, -0.38, z, sm.yaw);
    });
    // V2 (Milestone 9): butterflies, at last drawn: each flits about its flowers in loose loops
    Life.butterflies.forEach((b: any, i: number) => {
      const ax = b.ax * PX, az = b.ay * PX;
      if (!this.near(ax, az, -this.range + 40)) return;
      const k = 0.7 + b.v * 0.15;
      const x = ax + Math.sin(b.ph * k) * 1.4, z = az + Math.cos(b.ph * k * 0.77) * 1.4;
      const yaw = Math.atan2(Math.cos(b.ph * k) * k, -Math.sin(b.ph * k * 0.77) * k * 0.77);
      this.animal('butterfly', `fly:${i}`, x, this.groundY(x, z, false) + 0.55 + Math.sin(b.ph * 1.3) * 0.3, z, yaw, 'fly');
    });
    // V2: birds on the wing (gfx/birds.ts): each flock at its own height, the birds of it loosely spread, beating and
    // gliding in turn (they were flat triangles rocking from side to side, every one 32 m up)
    Life.birds.forEach((b: any, i: number) => {
      const x = b.x * PX, z = b.y * PX;
      if (!this.near(x, z, 160)) return;
      const k = BIRD_KIND[b.kind as string] ?? BIRD_KIND.gull, h = hash2(i * 7 + 3, Math.round(b.vx * 10));
      const y = (b.alt ?? 30) + (h % 9) - 4 + Math.sin(this.t * 0.4 + i) * 1.2;
      const beat = THREE.MathUtils.smoothstep(Math.sin(this.t * 0.3 + i * 1.7), -0.35, 0.25);
      this.flyers.add(x, y, z + Math.sin(this.t * 0.5 + i) * 1.5, b.vx > 0 ? Math.PI / 2 : -Math.PI / 2, 0, b.ph * k.rate, beat, k.colour, k.scale);
    });
    // and a few circling over the farms and parks by day, soaring on the warm air with a beat now and then
    if (Sim.clock > 360 && Sim.clock < 1140 && !Weather.isRaining()) {
      for (const bd of World.buildings) {
        if (bd.type !== 'farm' && bd.type !== 'park' && bd.type !== 'grandpark') continue;
        const cx = (bd.x + bd.w / 2) * TM, cz = (bd.y + bd.h / 2) * TM;
        if (!this.near(cx, cz, 60)) continue;
        const k = bd.type === 'farm' ? BIRD_KIND.crow : BIRD_KIND.gull;
        for (let j = 0; j < 3; j++) {
          const h = hash2(bd.id, j * 13 + 1), r = 16 + (h % 14), w = (0.22 + ((h >>> 5) % 10) / 60) * (j % 2 ? 1 : -1);
          const a = this.t * w + ((h >>> 9) % 628) / 100, y = 22 + ((h >>> 3) % 12) + Math.sin(this.t * 0.2 + j) * 2;
          const beat = THREE.MathUtils.smoothstep(Math.sin(this.t * 0.45 + j * 2.1), 0.55, 0.9);
          this.flyers.add(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r, Math.atan2(-Math.sin(a) * w, Math.cos(a) * w), w > 0 ? 0.32 : -0.32, this.t * 14 + j, beat, k.colour, k.scale);
        }
      }
    }
    // V2 (Milestone 8): the hire bikes in their rack at the foot of each peak's trail
    for (const pk of World.peaks) {
      const th = trailhead(pk);
      if (!this.near(th.x, th.z, 30)) continue;
      const fx = Math.sin(th.yaw), fz = Math.cos(th.yaw), rx = Math.cos(th.yaw), rz = -Math.sin(th.yaw);
      for (let k = 0; k < 3; k++) {
        const s = 2.1 + k * 1.1, bx = th.x + rx * s - fx * 1.2, bz = th.z + rz * s - fz * 1.2;
        if (this.hireOut && k === 0) continue;
        this.vehicle('bicycle', bx, 0.02, bz, th.yaw, hex(['#2a6ad0', '#d0402a', '#2aa060'][k]), { parked: true });
      }
    }
    // V2: puddles are part of the wet-surface shader (they mirror the street), not discs
    const tn = Calamity.tornado;
    if (tn) {
      const x = tn.x * PX, z = tn.y * PX;
      for (let i = 0; i < 4; i++) this.prop('funnel', x + Math.sin(this.t * 3 + i) * 0.6, i * 2, z, this.t * 4 + i, 1 + i * 0.12, hex(i % 2 ? '#6a6e74' : '#82868c'));
      for (let i = 0; i < 18; i++) {
        const a = this.t * 5 + i;
        const r = 4 + (i % 5) * 2.4;
        this.prop('crate', x + Math.cos(a) * r, 2 + ((i * 7) % 24), z + Math.sin(a) * r, a, 0.5);
      }
    }
  }

  /* Christmas, Diwali, campaign banners and camps */
  private collectFestive(night: number): void {
    const F = Festivals;
    this.plaza.update(this.dt, F.tree ? this.treeScene(F.tree) : null, night, this.t);
    for (const mk of F.markets) {
      const x0 = mk.x * TM, z0 = mk.y * TM;
      if (!this.near(x0, z0)) continue;
      for (let i = 0; i < 6; i++) {
        const x = x0 + 5 + (i % 3) * 11, z = z0 + 7 + Math.floor(i / 3) * 14;
        this.prop('stall', x, 0, z, Math.floor(i / 3) ? Math.PI : 0);
        for (let k = 0; k < 6; k++) this.prop('bulb', x - 1.5 + k * 0.6, 2.95, z + (Math.floor(i / 3) ? -1.05 : 1.05), 0, 0.7, hex(['#ffd040', '#ff6060', '#60c0ff'][k % 3]));
      }
    }
    for (const c of F.carolers) {
      const x = c.x * PX, z = c.y * PX;
      if (!this.near(x, z)) continue;
      for (let k = 0; k < 4; k++) this.person({ x: x + (k - 1.5) * 0.8, y: 0.15, z: z + 1.5, yaw: Math.PI, kind: k % 2 ? 'woman' : 'man', seed: c.seed + k, mode: 'stand', phase: 0, shirt: hex(k % 2 ? '#c0392b' : '#2a6a3a') });
    }
    const santa = F.santa;
    if (santa) {
      const x = santa.x * PX, z = santa.y * PX;
      const sm = smooth(santa, x, z, headYaw(santa));
      this.person({ x, y: this.groundY(x, z, false), z, yaw: sm.yaw, kind: 'man', seed: 4242, mode: 'walk', phase: sm.phase, shirt: hex('#d02020'), pants: hex('#d02020'), hair: hex('#f4f4f4'), scale: 1.08 });
    }
    if (F.sleigh) {
      const x = F.sleigh.x * PX, z = F.sleigh.y * PX;
      this.vehicle('sleigh', x, 70 + Math.sin(F.sleigh.ph) * 2, z, Math.PI / 2, hex('#c0392b'));
    }
    // Diwali: a diya on every doorstep after dark; Christmas: lights along rooflines
    const diwali = F.diyasTonight() && night > 0.3;
    const xmas = F.decorated() && night > 0.2;
    if (diwali || xmas) {
      for (const b of World.buildings) {
        if (b.ruined || b.construction) continue;
        const bx = (b.x + b.w / 2) * TM, bz = (b.y + b.h / 2) * TM;
        if (!this.near(bx, bz)) continue;
        if (diwali && CAT[b.type].res) {
          const dx = b.door.x * TM + 4, dz = b.door.y * TM + 4;
          for (let k = -2; k <= 2; k++) this.prop('diya', (dx + bx) / 2 + k * 0.6, 0.15, (dz + bz) / 2 + k * 0.1, 0, 1, hex('#ffb040').multiplyScalar(0.8 + 0.2 * Math.sin(this.t * 6 + k)));
        }
        if (xmas && Math.hypot(bx - this.camX, bz - this.camZ) < 140) {
          // a string of lights along the eaves, all the way round
          const h = this.buildings.heightOf(b.id) * 0.68;
          const W = b.w * TM * 0.4, D = b.h * TM * 0.4;
          const per = 2 * (W + D) * 2;
          const n = Math.min(90, Math.round(per / 0.45));
          const warm = b.id % 3 !== 0;
          for (let k = 0; k < n; k++) {
            let u = (k / n) * per;
            let px: number, pz: number;
            if (u < 2 * W) { px = bx - W + u; pz = bz + D; }
            else if ((u -= 2 * W) < 2 * D) { px = bx + W; pz = bz + D - u; }
            else if ((u -= 2 * D) < 2 * W) { px = bx + W - u; pz = bz - D; }
            else { u -= 2 * W; px = bx - W; pz = bz - D + u; }
            const sag = Math.abs(Math.sin((k / n) * Math.PI * 16)) * 0.12;
            const col = warm ? hex('#ffd9a0') : hex(['#ff4040', '#ffd040', '#40c0ff', '#80ff90', '#ff6ad0'][(k + b.id) % 5]);
            this.prop('bulb', px, h - sag, pz, 0, 1.5, col.multiplyScalar(0.8 + 0.2 * Math.sin(this.t * 2.5 + k)));
          }
        }
      }
    }
    const camp = Gov.campaign;
    if (camp) {
      for (const bn of camp.banners) {
        const x = bn.x * TM + 4, z = bn.y * TM + 4;
        if (!this.near(x, z)) continue;
        const yaw = World.isRoad(bn.x, bn.y - 1) || World.isRoad(bn.x, bn.y + 1) ? 0 : Math.PI / 2;
        this.prop('bannerPoles', x, 0, z, yaw);
        this.prop('banner', x, 0, z, yaw, 1, hex(camp.candidates[bn.ci]?.color || '#888'));
      }
      for (const cp of camp.camps) {
        const x = cp.x * TM + 4, z = cp.y * TM + 4;
        if (!this.near(x, z)) continue;
        this.prop('tent', x, 0, z, 0, 1, hex(camp.candidates[cp.ci]?.color || '#888'));
        // a volunteer handing out leaflets in the daytime (V2: they go home at night; the tent stays up)
        if (Sim.clock >= 540 && Sim.clock < 1170 && !camp.votingDay)
          this.person({ x: x + 2.2, y: 0, z: z + 1, yaw: Math.sin(this.t * 0.4 + cp.ci) * 1.5, kind: cp.ci % 2 ? 'woman' : 'man', seed: cp.ci * 11 + cp.x, mode: 'stand', phase: 0, shirt: hex(camp.candidates[cp.ci]?.color || '#888') });
      }
    }
  }

  /* V2 (Milestone 8): the great tree's year, Rockefeller-style (sim/festivals.ts tickTree): the head gardener's
     helicopter over the woods, the crane and the saws at the tree, the flatbed lying in wait and then crawling
     through town between two squad cars on blue lights, the crane standing it up in the square, the crew on the
     scaffolding stringing the lights from the bottom up, the star hoisted, the stage and the crowd on lighting
     night, and then the lights on their hours */
  private treeScene(tree: any): TreeScene {
    const H = 24, T2 = this.t;
    const px = tree.x * TM + 8, pz = tree.y * TM + 8;
    const sc: TreeScene = { plaza: null, tree: null, lights: 0, lit: false, star: -1, scaffold: false, crane: null, flatbed: null, stage: false };
    const src = tree.src ? { x: tree.src.x * TM + 4, z: tree.src.y * TM + 4 } : null;
    // the road beside the tree's garden (where the crane and the flatbed stand), and which way it runs
    if (src && !tree._road) {
      const r = World.nearestRoad(tree.src.x, tree.src.y, 30);
      if (r) tree._road = { x: r.x * TM + 4, z: r.y * TM + 4, yaw: World.isRoad(r.x - 1, r.y) || World.isRoad(r.x + 1, r.y) ? Math.PI / 2 : 0 };
    }
    const road = tree._road as { x: number; z: number; yaw: number } | undefined;
    const lying = (fx: number, fz: number, yaw: number): TreeScene['tree'] => ({ x: fx + Math.sin(yaw) * 6, y: 2.3, z: fz + Math.cos(yaw) * 6, yaw: yaw + Math.PI, tilt: Math.PI / 2 });
    const ph = tree.phase;
    if (ph === 'scouting' && src && Sim.clock > 480 && Sim.clock < 1020) {
      // the head gardener's helicopter, circling the woods
      const a = T2 * 0.12 + tree.year;
      this.vehicle('heli', src.x + Math.cos(a) * 70, 72, src.z + Math.sin(a) * 70, a + Math.PI, hex('#2a4a8a'), { rotor: T2 * 30 });
    }
    if (ph === 'cutting' && src && road) {
      sc.crane = { x: road.x + Math.cos(road.yaw) * 5, z: road.z - Math.sin(road.yaw) * 5, hx: src.x, hy: 14, hz: src.z };
      for (let k = 0; k < 3; k++) {
        const a = k * 2.1 + 0.4;
        this.person({ x: src.x + Math.cos(a) * 1.2, y: 0.05, z: src.z + Math.sin(a) * 1.2, yaw: Math.atan2(-Math.cos(a), -Math.sin(a)), kind: 'man', seed: 777 + k, mode: 'work', phase: T2 * 3 + k, job: 'construction', shirt: hex('#f26a1a'), hair: hex('#f2c230') });
      }
    }
    if (ph === 'loaded' && road) {
      sc.flatbed = { x: road.x, z: road.z, yaw: road.yaw };
      sc.tree = lying(road.x, road.z, road.yaw);
    }
    if (ph === 'hauling' && tree.cv) {
      const cv = tree.cv, yaw = Math.atan2(cv.hx ?? cv.dirx ?? 0, cv.hy ?? cv.diry ?? 1), mx = cv.x * PX, mz = cv.y * PX;
      sc.flatbed = { x: mx, z: mz, yaw };
      sc.tree = lying(mx, mz, yaw);
      // the escort: a squad car ahead and one behind, blue lights going
      const path = tree.haulPath;
      if (path && path.length > 1) for (const k of [3.4, -2.6]) {
        const p = lanePose(path, Math.max(0, Math.min(path.length - 1, tree.prog + k)), Traffic.lanePx(null));
        this.vehicle('police', p.x * PX, 0.03, p.y * PX, Math.atan2(p.hx, p.hy), hex('#f4f6f7'), { siren: true });
      }
    }
    if (['arrived', 'raising', 'decorating', 'ceremony', 'lit'].includes(ph)) {
      sc.plaza = { x: px, z: pz };
      const yaw = 0.35;
      if (ph === 'arrived') {
        sc.flatbed = { x: px + 18, z: pz, yaw: 0 };
        sc.tree = lying(px + 18, pz, 0);
      } else if (ph === 'raising') {
        const tilt = (Math.PI / 2) * (1 - THREE.MathUtils.smoothstep(tree.prog, 0, 1));
        sc.tree = { x: px, y: 0.6, z: pz, yaw, tilt };
        // the hook on the tree, two thirds of the way up its trunk
        const up = new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(tilt, yaw, 0, 'YXZ')).multiplyScalar(H * 0.66);
        sc.crane = { x: px - 20, z: pz + 6, hx: px + up.x, hy: 0.6 + up.y, hz: pz + up.z };
      } else sc.tree = { x: px, y: 0.6, z: pz, yaw, tilt: 0 };
      if (ph === 'decorating') {
        sc.scaffold = true;
        sc.lights = tree.prog;
        if (tree.star) {
          sc.star = tree.starT || 0;
          if ((tree.starT || 0) < 1) sc.crane = { x: px - 20, z: pz + 6, hx: px, hy: 1 + (tree.starT || 0) * H + 1.4, hz: pz };
        }
        // the crew up on the scaffolding, at the level the lights have reached
        if (Sim.clock > 420 && Sim.clock < 1080) {
          const lv = Math.min(6, Math.floor(tree.prog * 7)), y = 1 + lv * 3, r = Math.max(0.3, (1 - y / H) * H * 0.3 * 0.92) + 1.1;
          for (let k = 0; k < 5; k++) {
            const a = k * 1.256 + T2 * 0.02;
            this.person({ x: px + Math.cos(a) * r, y: y + 0.06, z: pz + Math.sin(a) * r, yaw: Math.atan2(-Math.cos(a), -Math.sin(a)), kind: 'man', seed: 900 + k, mode: 'work', phase: T2 * 3 + k, job: 'construction', shirt: hex('#f26a1a'), hair: hex('#f2c230') });
          }
        }
      }
      if (ph === 'ceremony' || ph === 'lit') { sc.lights = 1; sc.star = 1; }
      if (ph === 'ceremony') sc.stage = !!tree.stage || Sim.clock >= 1170;
      if (ph === 'lit') sc.lit = Festivals.treeLightsOn();
      // a crowd round the rink: hundreds on lighting night, a gathering on any lit evening
      const crowd = ph === 'ceremony' && Sim.clock >= 1170 ? 56 : ph === 'lit' && sc.lit && Sim.clock > 1050 && Sim.clock < 1380 ? 18 : 0;
      for (let k = 0; k < crowd; k++) {
        const a = k * 2.399 + 0.3, r = 12.2 + (k % 4) * 0.8;
        const x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r;
        if (sc.stage && z > pz + 12 && Math.abs(x - px) < 6) continue; // (clear of the stage)
        this.person({ x, y: 0.1, z, yaw: Math.atan2(px - x, pz - z), kind: k % 3 === 0 ? 'woman' : k % 7 === 0 ? 'kid' : 'man', seed: 5000 + k * 13, mode: 'stand', phase: 0 });
      }
      if (sc.stage) for (let k = 0; k < 3; k++) this.person({ x: px - 2.5 + k * 2.5, y: 1.1, z: pz + 16.5, yaw: Math.PI, kind: k === 1 ? 'woman' : 'man', seed: 6100 + k, mode: k === 1 ? 'stand' : 'work', phase: T2 * 2 + k, shirt: hex(['#c0392b', '#f4f0e4', '#2a5a3a'][k]) });
    }
    return sc;
  }

  /* burning buildings: GPU flames, embers and smoke, and a flickering glow */
  private collectFires(night: number): void {
    const fires: { x: number; z: number; d: number }[] = [];
    this.fireFX.begin();
    const near = World.buildings
      .filter((b: any) => b.fire || (CAT[b.type].smoke && !b.ruined && !b.construction && b.workers.length))
      .map((b: any) => ({ b, d: Math.hypot((b.x + b.w / 2) * TM - this.camX, (b.y + b.h / 2) * TM - this.camZ) }))
      .filter((o: { d: number }) => o.d < this.range + 80)
      .sort((p: { b: any }, q: { b: any }) => (q.b.fire ? 1 : 0) - (p.b.fire ? 1 : 0));
    for (const { b, d } of near) {
      const bx = (b.x + b.w / 2) * TM, bz = (b.y + b.h / 2) * TM;
      const h = this.buildings.heightOf(b.id);
      if (b.fire) {
        fires.push({ x: bx, z: bz, d });
        this.fireFX.fire(bx, h * 0.45, bz, b.w * TM * 0.55, b.h * TM * 0.55, h, Math.min(1.6, 0.8 + b.w * b.h * 0.08));
      } else {
        const hv = hash2(b.id, 3);
        this.fireFX.plume(bx + ((hv % 100) / 100 - 0.5) * b.w * 3, h, bz + (((hv >>> 8) % 100) / 100 - 0.5) * b.h * 3, 1 + b.w * 0.15);
      }
    }
    this.fireFX.end(interiorDay.value / 0.07);
    fires.sort((a, b) => a.d - b.d);
    this.fireLights.forEach((l, i) => {
      const f = fires[i];
      if (!f) { l.intensity = 0; return; }
      l.position.set(f.x, 5, f.z);
      l.intensity = (40 + Math.sin(this.t * 12 + i) * 12) * (0.35 + night);
    });
  }

  /* planes, helicopters, balloons and the thing on dark nights */
  private collectSky(): void {
    // V2 (Milestone 6): airliners parked at the stands (fewer while the village's are flying; the last stand is the Founder's)
    for (const a of World.buildings) {
      if (a.type !== 'airport' || a.construction || a.ruined) continue;
      const f = Life.airfield(a);
      const parked = Math.max(1, 3 - Life.planes.length);
      for (let k = 0; k < parked; k++) if (this.near(f.stands[k].x, f.stands[k].z, 60)) this.vehicle('plane', f.stands[k].x, 0, f.stands[k].z, 0, hex(k === 1 ? '#e8eef4' : '#f4f6f7'));
    }
    for (const pl of Life.planes) {
      const x = pl.x * PX, z = pl.y * PX;
      this.vehicle('plane', x, pl.alt * PX, z, Math.PI / 2, hex('#f4f6f7'), { pitch: pl.mode === 'takeoff' && pl.alt > 0 ? -0.18 : pl.mode === 'land' && pl.alt > 0 ? 0.06 : 0 });
    }
    for (const h of Life.helis) {
      const x = h.x * PX, z = h.y * PX;
      const sm = smooth(h, x, z, null);
      this.vehicle('heli', x, h.alt * PX + this.groundY(x, z, true), z, sm.yaw, hex('#c0392b'), { rotor: h.rot });
    }
    for (const b of Life.balloons) {
      const x = b.x * PX, z = b.y * PX;
      this.vehicle('balloon', x, 55 + Math.sin(b.ph * 0.5) * 3, z, 0, hex(['#e05a5a', '#f2c230', '#4f8ede'][Math.floor(b.y) % 3]));
    }
    if (Life.ufo) {
      const u = Life.ufo;
      this.vehicle('ufo', u.x * PX, 60 + Math.sin(u.ph) * 2, u.y * PX, u.ph, hex('#9aa4b4'));
    }
  }

  /* ---------- people: skinned near, instanced far ---------- */
  private dt = 1 / 60;
  private night = 0;
  private nearPeople = new Map<string, { person: Person; seen: number }>();
  private carWant: CarWant[] = [];
  private carSlots: CarSlot[] = [];

  /** a villager's look, stable for their seed, honouring uniforms */
  private lookFor(p: PersonDraw): Look {
    let s = (p.seed >>> 0) || 1;
    const rnd = (): number => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    const look = randomLook(rnd, Weather.season === 3);
    look.female = p.kind === 'woman';
    if (p.kind === 'kid') look.height = 1.12 + rnd() * 0.3;
    else if (look.height < 1.5) look.height = look.female ? 1.62 : 1.74;
    else if (!look.female && look.height < 1.66) look.height += 0.1;
    if (!look.female) { look.skirt = false; look.longHair = rnd() < 0.05; }
    if (p.shirt) { look.top = p.shirt.clone(); look.coat = undefined; }
    if (p.pants) look.legs = p.pants.clone();
    if (p.hair) look.hair = p.hair.clone();
    return look;
  }

  private drawPeople(): void {
    const rain = ENV.rain.value;
    const sorted = this.people.map((p) => ({ p, d: (p.x - this.camX) ** 2 + (p.z - this.camZ) ** 2 })).sort((a, b) => a.d - b.d);
    const far: PersonDraw[] = [];
    let near = 0, created = 0;
    for (const { p, d } of sorted) {
      if (near >= nearPeople() || d > nearPeopleR() ** 2) { far.push(p); continue; }
      const rig = rigFor(p.seed, p.kind, p.job);
      // (a key of its own once the characters have loaded, so a code-built body gives way to the modelled one)
      const key = `${p.kind}|${p.seed}|${p.job || ''}${rig ? '|' + rig.id : ''}`;
      let e = this.nearPeople.get(key);
      if (!e) {
        if (created >= 3) { far.push(p); continue; } // spread new bodies over frames
        const look = this.lookFor(p);
        if (rig) { look.height = rig.height; look.female = rig.female; }
        e = { person: new Person(look, rig, rig ? outfitFor(p.seed, rig, p.shirt, p.pants) : undefined), seen: this.t };
        this.group.add(e.person.root);
        this.nearPeople.set(key, e);
        created++;
      }
      near++;
      e.seen = this.t;
      const r = e.person.root;
      r.visible = true;
      r.scale.setScalar(p.scale || 1);
      e.person.setLod(d < lod0People() ? 0 : 1);
      const pose: Pose = p.mode === 'walk' || p.mode === 'run' ? 'walk' : p.mode === 'sit' ? 'sit' : p.mode === 'lie' ? 'lie' : p.mode === 'work' ? 'work' : p.mode === 'carry' ? 'carry' : p.mode === 'speak' ? 'speak' : p.mode === 'cheer' ? 'cheer' : 'idle';
      r.position.set(p.x, p.y + (p.mode === 'lie' ? 0.14 : 0), p.z);
      r.rotation.set(p.mode === 'lie' ? -Math.PI / 2 : 0, p.yaw, 0, 'YXZ');
      if (p.mode === 'sit') r.position.y -= 0.02;
      e.person.animate(this.dt, pose, p.mode === 'run' ? 3.1 : p.mode === 'carry' ? 1.1 : 1.35, rain);
    }
    for (const [k, e] of this.nearPeople) {
      if (e.seen === this.t) continue;
      e.person.root.visible = false;
      if (this.t - e.seen > 20) {
        this.group.remove(e.person.root);
        // (a modelled character's geometry is shared with everyone wearing it: only a code-built body is its own)
        if (!e.person.rig) e.person.mesh.geometry.dispose();
        e.person.mesh.skeleton.dispose();
        this.nearPeople.delete(k);
      }
    }
    this.drawFarPeople(far);
  }

  /** full car models for the nearest traffic, matched frame to frame so they don't swap */
  private drawCars(): void {
    const dt = Math.max(1e-3, this.dt);
    for (const s of this.carSlots) s.used = false;
    const wants = this.carWant.map((w) => ({ w, d: (w.x - this.camX) ** 2 + (w.z - this.camZ) ** 2 })).sort((a, b) => a.d - b.d);
    let shown = 0;
    for (const { w } of wants) {
      if (shown >= nearCars()) { this.instancedVehicle(w.type, w.x, w.y, w.z, w.yaw, w.paint, { siren: w.siren, pitch: w.pitch, roll: w.roll, parked: w.parked }); continue; }
      const style = w.type === 'taxi' ? 'sedan' : w.type === 'police' ? 'estate' : styleForPaint(w.paint);
      const model = this.modelFor(w.type, w.paint);
      const kind = `${w.type}:${model ? model.id : style}`;
      // the same car as last frame: the nearest slot of this kind within a few metres
      let best: CarSlot | null = null, bd = 36;
      for (const s of this.carSlots) {
        if (s.used || s.kind !== kind) continue;
        const d = (s.x - w.x) ** 2 + (s.z - w.z) ** 2;
        if (d < bd) { bd = d; best = s; }
      }
      if (!best) best = this.carSlots.find((s) => !s.used && s.kind === kind && this.t - s.seen > 0.4) || null;
      if (!best) {
        if (this.carSlots.length >= nearCars() + 8) { this.instancedVehicle(w.type, w.x, w.y, w.z, w.yaw, w.paint, { siren: w.siren, parked: w.parked }); continue; }
        const car = new CarModel(style, w.paint, w.type !== 'taxi', w.type === 'taxi' ? 'taxi' : w.type === 'police' ? 'police' : undefined, model?.id);
        this.group.add(car.root);
        best = { car, kind, x: w.x, z: w.z, yaw: w.yaw, v: 0, a: 0, used: false, seen: this.t };
        this.carSlots.push(best);
      }
      if (this.t - best.seen > 0.4) { best.x = w.x; best.z = w.z; best.yaw = w.yaw; best.v = 0; best.a = 0; best.car.setPaint(w.paint); }
      best.used = true;
      shown++;
      // (V2: signed, along the car's own heading: below 0 when it backs into its spot. It was the distance moved, never
      // below 0, and a car reversing spun its wheels forwards and turned them against the turn)
      const dist = Math.hypot(w.x - best.x, w.z - best.z);
      const v = dist < 10 ? ((w.x - best.x) * Math.sin(w.yaw) + (w.z - best.z) * Math.cos(w.yaw)) / dt : 0;
      const vs = best.v + (v - best.v) * Math.min(1, dt * 6);
      best.a += ((vs - best.v) / dt - best.a) * Math.min(1, dt * 4);
      let dy = w.yaw - best.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      best.v = vs;
      best.x = w.x; best.z = w.z; best.yaw = w.yaw; best.seen = this.t;
      best.car.root.visible = true;
      best.car.drive(dt, w.x, w.z, w.yaw, vs, best.a, dy / dt, w.y);
      best.car.setLod((w.x - this.camX) ** 2 + (w.z - this.camZ) ** 2 < lod0Cars() ? 0 : 1);
      // (a parked car stands dark: no headlamps, no tail lamps, no brake lights)
      best.car.lights(!w.parked && (this.night > 0.2 || Weather.isRaining() || Weather.isSnowing()), this.night, w.parked);
      best.car.setSiren(w.siren, this.t);
    }
    for (const s of this.carSlots) if (!s.used) s.car.root.visible = false;
  }

  /* V2 (Milestone 9): the farm, zoo, park and street animals round the camera (render/fauna.ts) */
  private collectFauna(): void {
    if (!zooLoaded().length) return;
    if (!this.faunaWired) { this.fauna.blocked = this.faunaBlocked; this.faunaWired = true; }
    // (V2: on top of the lot's paving or turf, 10 cm up, where the animals' places are: at the bare ground's height the
    // pigeons on a plaza or outside a shop stood sunk to the breast in it)
    this.fauna.player = this.player;
    this.fauna.collect(this.dt, this.camX, this.camZ, this.range, (d) => {
      const y = this.lotGround(d.x, d.z);
      this.animal(d.id, d.key, d.x, y, d.z, d.yaw, d.pose, d.speed);
      // (the farmer behind the plough horse, a keeper putting out the food)
      const h = d.handler;
      if (h && this.near(h.x, h.z, 60)) {
        this.person({ x: h.x, y: this.lotGround(h.x, h.z), z: h.z, yaw: h.yaw, kind: 'man', seed: hash2(Math.round(d.x), Math.round(d.z)) % 997, mode: h.walk ? 'walk' : 'work', phase: 0, job: 'gardener', shirt: hex(h.job === 'farmer' ? '#5a6a3a' : '#3a6a4a') });
      }
    });
  }
  /** V2: the Founder (null in the Planner), for the animals that shy away */
  player: { x: number; z: number; fast: boolean } | null = null;
  /** V2: ground height on a lot's paving or turf (10 cm up) or off it */
  private lotGround(x: number, z: number): number {
    const tx = Math.floor(x / TM), tz = Math.floor(z / TM);
    return this.groundY(x, z, false) + (World.inB(tx, tz) && World.bmap[World.idx(tx, tz)] ? 0.1 : 0);
  }
  /** V2: something in the way of an animal of radius r at (x, z): a fence, a bench, a rock, a pool, a tree */
  private faunaBlocked = (x: number, z: number, r: number): boolean => {
    for (const [x0, z0, x1, z1] of this.buildings.solidsNear(x, z, r + 1)) if (x > x0 - r && x < x1 + r && z > z0 - r && z < z1 + r) return true;
    for (const t of this.buildings.treesNear(x, z, r + 1)) if ((t.x - x) ** 2 + (t.z - z) ** 2 < (0.45 + r) ** 2) return true;
    return false;
  };

  /** the nearest animals skinned and moving (each keeps its body by its key), the big ones farther off as herds */
  private drawAnimals(): void {
    const dt = Math.max(1e-3, this.dt);
    const list = this.beastWant.map((w) => ({ w, d: (w.x - this.camX) ** 2 + (w.z - this.camZ) ** 2 })).sort((a, b) => a.d - b.d);
    let near = 0, created = 0;
    for (const { w, d } of list) {
      const b = beast(w.id);
      if (!b) continue;
      const big = b.entry.height > 0.9;
      if (near >= NEAR_BEASTS || d > NEAR_BEASTS_R * NEAR_BEASTS_R) {
        if (big && d < HERD_R * HERD_R) this.herd.add(b, w.x, w.y, w.z, w.yaw);
        continue;
      }
      let e = this.nearBeasts.get(w.key);
      if (e && e.a.beast !== b) { this.dropBeast(w.key); e = undefined; }
      if (!e) {
        // (new bodies spread over frames)
        if (created >= 2) { if (big) this.herd.add(b, w.x, w.y, w.z, w.yaw); continue; }
        e = { a: new Animal(b), seen: this.t, x: w.x, z: w.z, v: 0 };
        this.group.add(e.a.root);
        this.nearBeasts.set(w.key, e);
        created++;
      }
      near++;
      // its pace from how far it came since last frame (unless the caller says)
      const moved = Math.hypot(w.x - e.x, w.z - e.z);
      e.v += ((moved < 5 ? moved / dt : 0) - e.v) * Math.min(1, dt * 5);
      e.x = w.x; e.z = w.z; e.seen = this.t;
      const r = e.a.root;
      r.visible = true;
      r.position.set(w.x, w.y, w.z);
      r.rotation.y = w.yaw;
      const [l0, l1] = lodBeasts();
      e.a.setLod(d < l0 ? 0 : d < l1 ? 1 : 2);
      e.a.animate(this.dt, w.pose === 'auto' ? (e.v > 0.15 ? 'walk' : 'idle') : w.pose, w.speed > 0 ? w.speed : e.v);
    }
    for (const [k, e] of this.nearBeasts) {
      if (e.seen === this.t) continue;
      e.a.root.visible = false;
      if (this.t - e.seen > 20) this.dropBeast(k);
    }
  }
  private dropBeast(k: string): void {
    const e = this.nearBeasts.get(k);
    if (!e) return;
    // (the model's geometry is shared: only this one's skeleton goes)
    this.group.remove(e.a.root);
    e.a.mesh.skeleton.dispose();
    this.nearBeasts.delete(k);
  }

  private drawFarPeople(list: PersonDraw[]): void {
    const tmpC = new THREE.Color();
    const modelled = castLoaded().length > 0;
    for (const p of list) {
      const rig = modelled ? rigFor(p.seed, p.kind, p.job) : undefined;
      if (rig) {
        const o = outfitFor(p.seed, rig, p.shirt, p.pants);
        if (p.mode === 'lie') this.crowd.add(rig, p.x, p.y + 0.15, p.z, p.yaw, p.scale || 1, o, -Math.PI / 2);
        else this.crowd.add(rig, p.x, p.y - (p.mode === 'sit' ? 0.4 : 0), p.z, p.yaw, p.scale || 1, o);
        continue;
      }
      const kid = p.kind === 'kid';
      const s = (p.scale || 1) * (kid ? 0.64 : p.kind === 'woman' ? 0.95 : 1);
      const seed = p.seed >>> 0;
      const skin = SKIN[seed % SKIN.length];
      const shirt = p.shirt || SHIRT[(seed >> 3) % SHIRT.length];
      const pants = p.pants || PANTS[(seed >> 6) % PANTS.length];
      const hair = p.hair || HAIR[(seed >> 9) % HAIR.length];
      const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
      const off = (lx: number, lz: number): [number, number] => [p.x + lx * cy + lz * sy, p.z - lx * sy + lz * cy];
      let swing = 0;
      if (p.mode === 'walk' || p.mode === 'carry') swing = Math.sin(p.phase) * 0.55;
      else if (p.mode === 'run') swing = Math.sin(p.phase * 1.4) * 0.95;
      if (p.mode === 'lie') {
        // lying on a towel: the whole figure tipped flat
        const pitch = -Math.PI / 2;
        this.torso.add(p.x, p.y + 0.15, p.z, p.yaw, s, shirt, pitch);
        const [hx, hz] = off(0, 0.66 * s);
        this.head.add(hx, p.y + 0.15, hz, p.yaw, s, skin, pitch);
        continue;
      }
      const hipY = p.y + (p.mode === 'sit' ? 0.45 : 0.82) * s;
      for (const side of [-1, 1]) {
        const [lx, lz] = off(side * 0.11 * s, 0);
        this.legs.add(lx, hipY, lz, p.yaw, s, pants, p.mode === 'sit' ? -1.3 : swing * side);
        const [ax, az] = off(side * 0.3 * s, 0);
        // (arms forward under a load; the hammer arm beating on a site; V2: a speaker's gesturing hand, a crowd's
        // hands up when it cheers)
        const arm = p.mode === 'sit' ? -0.9 : p.mode === 'carry' ? -1.2 : p.mode === 'work' ? (side > 0 ? -0.6 - Math.abs(Math.sin(this.t * 4.2 + p.seed)) * 1.5 : -0.8)
          : p.mode === 'speak' ? (side > 0 ? -1.2 - Math.sin(this.t * 2.3 + p.seed) * 0.35 : -0.5)
          : p.mode === 'cheer' ? -2.2 - Math.abs(Math.sin(this.t * 9 + p.seed + side)) * 0.3 : -swing * side * 0.8;
        this.arms.add(ax, hipY + 0.62 * s, az, p.yaw, s, tmpC.copy(shirt), arm);
      }
      this.torso.add(p.x, hipY, p.z, p.yaw, s, shirt);
      this.head.add(p.x, hipY + 0.68 * s, p.z, p.yaw, s, skin);
      (p.kind === 'woman' ? this.hairLong : this.hair).add(p.x, hipY + 0.68 * s, p.z, p.yaw, s, hair);
    }
  }

  private bubbleWant: { x: number; y: number; z: number; e: string; d: number }[] = [];
  private wantBubble(x: number, y: number, z: number, e: string): void {
    const d = Math.hypot(x - this.camX, z - this.camZ);
    if (d < 60) this.bubbleWant.push({ x, y, z, e, d });
  }
  /** V2 (Milestone 9): one of each modelled thing (a villager in their own clothes and one in changed ones, a far
   *  figure, a car with its wheels and glass, a distant car), under the ground by `at` while the stage compiles, so
   *  none of their shaders is first compiled in play */
  private warm: THREE.Group | null = null;
  prewarmModels(on: boolean, at: THREE.Vector3): void {
    const rig = castLoaded()[0], model = pickModel('car', null, 0);
    if (on && !this.warm) {
      this.warm = new THREE.Group();
      if (rig) {
        for (const o of [null, { top: new THREE.Color('#884422') }]) {
          const p = new Person({ ...randomLook(Math.random), height: rig.height, female: rig.female }, rig, o);
          p.animate(1 / 60, 'idle', 0, 0);
          this.warm.add(p.root);
        }
      }
      if (model) this.warm.add(new CarModel('hatch', new THREE.Color('#556677'), true, undefined, model.id).root);
      // (an animal of each material: the coat, and the butterfly's two-sided wings)
      for (const b of [beast('cow'), beast('butterfly')]) {
        if (!b) continue;
        const a = new Animal(b);
        a.animate(1 / 60, 'idle', 0);
        this.warm.add(a.root);
      }
      this.group.add(this.warm);
    }
    if (!this.warm) return;
    this.warm.visible = on;
    this.warm.position.set(at.x, at.y - 30, at.z);
    this.crowd.begin(); this.fleet.begin(); this.herd.begin();
    if (on && rig) this.crowd.add(rig, at.x, at.y - 30, at.z, 0, 1, { top: new THREE.Color('#884422') });
    if (on && model) this.fleet.add(model, at.x + 4, at.y - 30, at.z, 0, new THREE.Color('#556677'), 1);
    const cow = beast('cow');
    if (on && cow) this.herd.add(cow, at.x - 4, at.y - 30, at.z, 0);
    this.crowd.end(); this.fleet.end(); this.herd.end();
  }

  /** V2 (Milestone 7): the thought bubbles' shader is compiled with everything else before the first frame
   *  (one bubble, textured, out of sight, while the stage warms up), not the first time someone has a thought */
  prewarm(on: boolean): void {
    // V2 (Milestone 8): in the Christmas season the great tree's square (and its crane, flatbed, stage) is built and
    // compiled before the first frame too, out of sight
    if (Festivals.tree || Festivals.yearDay() >= 14) {
      this.plaza.update(0, on ? { plaza: { x: 0, z: -900 }, tree: { x: 0, y: -60, z: -900, yaw: 0, tilt: 0 }, lights: 1, lit: true, star: 1, scaffold: true, crane: { x: 20, z: -900, hx: 0, hy: -40, hz: -900 }, flatbed: { x: 0, z: -880, yaw: 0 }, stage: true } : null, 1, 0);
    }
    const s = this.bubbles[0];
    if (!s) return;
    s.visible = on;
    if (on) { s.position.set(0, -500, 0); s.material.map = emojiTexture('💭'); s.material.needsUpdate = true; }
  }
  private drawBubbles(_now: number): void {
    this.bubbleWant.sort((a, b) => a.d - b.d);
    // one thought per head: drop any bubble that would sit on top of a nearer one
    const kept: typeof this.bubbleWant = [];
    for (const w of this.bubbleWant) if (!kept.some((k) => Math.abs(k.x - w.x) < 0.9 && Math.abs(k.z - w.z) < 0.9)) kept.push(w);
    this.bubbles.forEach((s, i) => {
      const w = kept[i];
      if (!w) { s.visible = false; return; }
      s.visible = true;
      // float a little above the head, gently bobbing; fade out with distance
      s.position.set(w.x, w.y + 0.55 + Math.sin(this.t * 1.6 + i) * 0.04, w.z);
      const k = THREE.MathUtils.clamp(1 - (w.d - 30) / 30, 0, 1);
      s.material.opacity = 0.95 * k;
      s.scale.set(0.95, 0.7, 1);
      const tex = emojiTexture(w.e);
      if (s.material.map !== tex) { s.material.map = tex; s.material.needsUpdate = true; }
    });
    this.bubbleWant.length = 0;
  }

  /* ---------- fireworks & sparks ---------- */
  private sparkN = 0;
  private spark(x: number, y: number, z: number, r: number, g: number, b: number): void {
    if (this.sparkN >= this.sparkPos.length / 3) return;
    const i = this.sparkN++ * 3;
    this.sparkPos[i] = x; this.sparkPos[i + 1] = y; this.sparkPos[i + 2] = z;
    this.sparkCol[i] = r; this.sparkCol[i + 1] = g; this.sparkCol[i + 2] = b;
  }
  private drawSparks(): void {
    const c = new THREE.Color();
    for (const r of Life.rockets) {
      if (r.gy === undefined) continue;
      c.set(r.hue);
      this.spark(r.x * PX, 8 + (r.gy - r.y) * PX, r.gy * PX, c.r, c.g, c.b);
    }
    for (const s of Life.sparks) {
      if (s.gy === undefined) continue;
      c.set(s.hue).multiplyScalar(Math.min(1, s.life + 0.2));
      this.spark(s.x * PX, 8 + (s.gy - s.y) * PX, s.gy * PX, c.r, c.g, c.b);
    }
    const geo = this.sparks.geometry;
    geo.setDrawRange(0, this.sparkN);
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    this.sparkN = 0;
    this.drawFireflies();
  }

  /* V2 (Milestone 8): fireflies on warm, dry nights at the edge of the woods: a little swarm at each spot,
     drifting a metre or two over the grass, each flashing for a moment every few seconds (they were
     0.9 m squares hovering at head height) */
  private drawFireflies(): void {
    let n = 0;
    const warm = Weather.season <= 1 && (Sim.clock > 1230 || Sim.clock < 270) && !Weather.isRaining();
    if (warm && this.night > 0.5) {
      for (let s = 0; s < Life.fireflySpots.length && n < FLIES; s++) {
        const f = Life.fireflySpots[s];
        const fx = f.x * PX, fz = f.y * PX;
        if ((fx - this.camX) ** 2 + (fz - this.camZ) ** 2 > 70 * 70) continue;
        for (let k = 0; k < 6 && n < FLIES; k++) {
          const ph = f.ph * 7.1 + k * 2.39;
          const t = this.t * (0.16 + (k % 3) * 0.05) + ph;
          // a lazy figure-of-eight drift, rising and settling
          const x = fx + Math.sin(t) * 3.2 + Math.sin(t * 2.3 + k) * 0.6;
          const z = fz + Math.sin(t * 0.8 + 1.3) * Math.cos(t * 0.5) * 3.2;
          const y = 0.35 + (Math.sin(t * 0.7 + k * 0.9) + 1) * 0.6;
          // the flash: about half a second in every three to five
          const per = 3 + (k % 4) * 0.6;
          const u = ((this.t + ph * 3) % per) / per;
          const b = u < 0.12 ? Math.sin((u / 0.12) * Math.PI) : 0;
          if (b <= 0.02) continue;
          const i = n++ * 3;
          this.flyPos[i] = x; this.flyPos[i + 1] = heightAt(x, z) + y; this.flyPos[i + 2] = z;
          this.flyCol[i] = 0.55 * b; this.flyCol[i + 1] = 0.9 * b; this.flyCol[i + 2] = 0.18 * b;
        }
      }
    }
    const geo = this.flies.geometry;
    geo.setDrawRange(0, n);
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** point along a tile path (V1 path = [[tx,ty],…]) at fractional progress */
export function pathAt(path: number[][], prog: number): { x: number; y: number; dx: number; dy: number } {
  const n = path.length;
  const i = Math.max(0, Math.min(n - 1, Math.floor(prog)));
  const f = Math.max(0, Math.min(1, prog - i));
  const a = path[i], b = path[Math.min(i + 1, n - 1)];
  let dx = b[0] - a[0], dy = b[1] - a[1];
  if (!dx && !dy && i > 0) {
    dx = a[0] - path[i - 1][0];
    dy = a[1] - path[i - 1][1];
  }
  return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, dx, dy };
}

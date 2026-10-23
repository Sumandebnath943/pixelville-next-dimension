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
import { InstancedPool, MAT, hex, hash2 } from './kit';
import { HAIR, PANTS, PERSON, PROPS, SHIRT, SKIN, VEHICLES } from './models';
import { heightAt } from './terrain';
import type { BuildingLayer } from './buildings';

const PX = 0.5;
const TM = 8;
const PEOPLE_CAP = 900;
const CAR_COLORS = ['#c0392b', '#2e86c1', '#f4f6f7', '#1c2833', '#27ae60', '#f39c12', '#8e44ad', '#7f8c8d'].map((h) => hex(h));

export type Mode = 'walk' | 'run' | 'stand' | 'lie' | 'sit';
interface PersonDraw {
  x: number; y: number; z: number; yaw: number; kind: string; seed: number; mode: Mode; phase: number;
  shirt?: THREE.Color; pants?: THREE.Color; hair?: THREE.Color; scale?: number;
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

function dirYaw(dx: number, dy: number): number | null {
  if (!dx && !dy) return null;
  return Math.atan2(dx, dy);
}

/* ---------- emoji bubbles ---------- */
const bubbleTex = new Map<string, THREE.Texture>();
function emojiTexture(e: string): THREE.Texture {
  let t = bubbleTex.get(e);
  if (t) return t;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.beginPath();
  g.arc(32, 30, 26, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(26, 52); g.lineTo(32, 63); g.lineTo(38, 52);
  g.fill();
  g.font = '34px system-ui, "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(e, 32, 32);
  t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
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

  constructor(scene: THREE.Scene, private buildings: BuildingLayer) {
    scene.add(this.group);
    const g = this.group;
    this.legs = new InstancedPool(PERSON.leg, MAT.tint, PEOPLE_CAP * 2, g);
    this.arms = new InstancedPool(PERSON.arm, MAT.tint, PEOPLE_CAP * 2, g);
    this.torso = new InstancedPool(PERSON.torso, MAT.tint, PEOPLE_CAP, g);
    this.head = new InstancedPool(PERSON.head, MAT.tint, PEOPLE_CAP, g);
    this.hair = new InstancedPool(PERSON.hair, MAT.tint, PEOPLE_CAP, g);
    this.hairLong = new InstancedPool(PERSON.hairLong, MAT.tint, PEOPLE_CAP, g);
    const caps: Record<string, number> = { car: 500, taxi: 40, police: 30, fire: 12, bus: 24, moto: 80, loco: 16, coach: 60, wagon: 50, boat: 30, ferry: 3, raft: 12, heli: 4, plane: 4, balloon: 4, ufo: 1, sleigh: 1 };
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
      const cap = k === 'puddle' ? 260 : k === 'bulb' ? 1500 : k === 'diya' ? 1200 : k === 'smoke' || k === 'flame' ? 200 : 160;
      this.props[k] = new InstancedPool(p.geo, p.glow ? this.glowTint : p.tinted ? MAT.tint : MAT.solid, cap, g, !p.glow && k !== 'puddle');
    }
    // fireworks & celebration sparks
    const N = 1600;
    this.sparkPos = new Float32Array(N * 3);
    this.sparkCol = new Float32Array(N * 3);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(this.sparkCol, 3));
    this.sparks = new THREE.Points(sg, new THREE.PointsMaterial({ size: 0.9, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.sparks.frustumCulled = false;
    g.add(this.sparks);
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
  }

  private near(x: number, z: number, extra = 0): boolean {
    return Math.abs(x - this.camX) < this.range + extra && Math.abs(z - this.camZ) < this.range + extra;
  }

  /* ---------- drawing primitives ---------- */
  person(p: PersonDraw): void {
    if (this.people.length >= PEOPLE_CAP) return;
    this.people.push(p);
  }
  vehicle(type: string, x: number, y: number, z: number, yaw: number, paint: THREE.Color, opts: { siren?: boolean; pitch?: number; roll?: number; rotor?: number; scale?: number } = {}): void {
    const v = this.veh[type];
    if (!v) return;
    const s = opts.scale || 1;
    v.paint.add(x, y, z, yaw, s, paint, opts.pitch || 0, opts.roll || 0);
    v.fixed.add(x, y, z, yaw, s, null, opts.pitch || 0, opts.roll || 0);
    v.lights.add(x, y, z, yaw, s, null, opts.pitch || 0, opts.roll || 0);
    if (v.siren) {
      const on = opts.siren ? Math.floor(this.t * 6) % 2 : -1;
      v.siren.add(x, y, z, yaw, s, on < 0 ? hex('#888888') : on ? hex('#ff2a2a') : hex('#2a6aff'), opts.pitch || 0, opts.roll || 0);
    }
    if (v.rotor) v.rotor.add(x, y, z, yaw + (opts.rotor || 0), s);
  }
  prop(k: string, x: number, y: number, z: number, yaw = 0, scale = 1, color?: THREE.Color | null, sy?: number): void {
    this.props[k]?.add(x, y, z, yaw, scale, color || null, 0, 0, sy);
  }

  /* ---------- per-frame update ---------- */
  update(dt: number, camX: number, camZ: number, range: number, now: number, night: number): void {
    this.t += dt;
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
    this.lightsMat.color.setScalar(0.5 + night * 0.9);
    this.glowTint.color.setScalar(1);

    this.collectVillagers(now);
    this.collectParked();
    this.collectServices();
    this.collectTransit();
    this.collectCrowds();
    this.collectNature();
    this.collectFestive(night);
    this.collectFires(night);
    this.collectSky();
    this.drawPeople();
    this.drawBubbles(now);
    this.drawSparks();

    for (const p of [this.legs, this.arms, this.torso, this.head, this.hair, this.hairLong]) p.end();
    for (const v of Object.values(this.veh)) {
      v.paint.end(); v.fixed.end(); v.lights.end(); v.siren?.end(); v.rotor?.end();
    }
    for (const p of Object.values(this.props)) p.end();
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
      if (p.state !== 'walk' || !p.trip) continue;
      const x = p.x * PX, z = p.y * PX;
      if (!this.near(x, z, 40)) continue;
      const t = p.trip;
      const hint = dirYaw(p.dirx || 0, p.diry || 0);
      if (t.car || t.taxi) {
        const sm = smooth(p, x, z, hint);
        const col = t.taxi ? hex('#f2c230') : CAR_COLORS[(t.car.seed || 0) % CAR_COLORS.length];
        this.vehicle(t.taxi ? 'taxi' : 'car', x, this.groundY(x, z, true), z, sm.yaw, col);
        continue;
      }
      if (t.moto) {
        const sm = smooth(p, x, z, hint);
        const y = this.groundY(x, z, true);
        this.vehicle('moto', x, y, z, sm.yaw, CAR_COLORS[p.seed % CAR_COLORS.length]);
        this.person({ x, y: y + 0.35, z, yaw: sm.yaw, kind: p.kind, seed: p.seed, mode: 'sit', phase: 0 });
        continue;
      }
      const sm = smooth(p, x, z, hint);
      const y = this.groundY(x, z, false);
      const frozen = p.freezeT > 0;
      this.person({ x, y, z, yaw: sm.yaw, kind: p.kind, seed: p.seed, mode: frozen || !sm.moving ? 'stand' : 'walk', phase: sm.phase });
      this.pickables.push({ x, y, z, ref: p });
      if (raining && p.kind !== 'kid') this.prop('handUmbrella', x, y, z, sm.yaw, p.kind === 'kid' ? 0.7 : 1, SHIRT[(p.seed >> 3) % SHIRT.length]);
      if (t.dog !== undefined) {
        const ox = Math.cos(sm.yaw) * 0.7, oz = -Math.sin(sm.yaw) * 0.7;
        this.prop('dog', x + ox, y, z + oz, sm.yaw + Math.sin(sm.phase) * 0.1, 1, hex(t.dog ? '#8a6a42' : '#e8e0d0'));
      }
      if (p.bubble && p.bubbleUntil > now) this.wantBubble(x, y + 2.4 * (p.kind === 'kid' ? 0.65 : 1), z, p.bubble);
    }
  }

  /* cars at home in the driveway, and at venues while their drivers are inside */
  private collectParked(): void {
    for (const b of World.buildings) {
      const bx = (b.x + b.w / 2) * TM, bz = (b.y + b.h / 2) * TM;
      if (!this.near(bx, bz, 30) || b.ruined || b.construction > 0) continue;
      const f = b.facing || 0;
      const d = CAT[b.type];
      // driveway: along the right-hand side of the plot, nose to the street
      const toWorld = (lx: number, lz: number) => {
        const [rx, rz] = f === 0 ? [lx, lz] : f === 1 ? [lz, -lx] : f === 2 ? [-lx, -lz] : [-lz, lx];
        return [bx + rx, bz + rz];
      };
      const yaw = (f * Math.PI) / 2;
      const W = (d.w || 1) * TM, D = (d.h || 1) * TM;
      if (d.res && b.cars) {
        let k = 0;
        for (const c of b.cars) {
          if (!c.free) continue;
          const [x, z] = toWorld(W / 2 - 1.5 - k * 2.4, D / 2 - 3.2);
          this.vehicle('car', x, 0.13, z, yaw, CAR_COLORS[(c.seed || 0) % CAR_COLORS.length]);
          if (++k >= 3) break;
        }
        if (b.bikes) {
          const [x, z] = toWorld(-W / 2 + 1.5, D / 2 - 2);
          this.vehicle('moto', x, 0.1, z, yaw, CAR_COLORS[(b.id * 3) % CAR_COLORS.length]);
        }
      } else if (b.parked > 0 && d.visit) {
        for (let k = 0; k < Math.min(4, b.parked); k++) {
          const [x, z] = toWorld(-W / 2 + 2 + k * 2.5, D / 2 - 1.5);
          this.vehicle('car', x, 0.13, z, yaw + Math.PI / 2, CAR_COLORS[(b.id + k * 3) % CAR_COLORS.length]);
        }
      }
      // construction crews on site
      if (b.construction > 0 || b.upgrading > 0) {
        for (let k = 0; k < 2; k++) {
          const a = this.t * 0.25 + k * Math.PI + b.id;
          const x = bx + Math.cos(a) * (b.w * TM * 0.5 + 0.8), z = bz + Math.sin(a) * (b.h * TM * 0.5 + 0.8);
          this.person({ x, y: 0.1, z, yaw: a + Math.PI, kind: 'man', seed: b.id * 7 + k, mode: 'walk', phase: this.t * 4 + k, shirt: hex('#f26a1a'), hair: hex('#f2c230') });
        }
      }
    }
  }

  /* police, fire brigade, burglars, crashes, disputes, road works, reporters */
  private collectServices(): void {
    for (const u of Life.police) {
      const x = u.x * PX, z = u.y * PX;
      if (!this.near(x, z, 40)) continue;
      const sm = smooth(u, x, z, dirYaw(u.dirx, u.diry));
      this.vehicle('police', x, this.groundY(x, z, true), z, sm.yaw, hex('#f4f6f7'), { siren: u.phase === 'go' || u.phase === 'scene' });
    }
    for (const u of Life.fireTrucks) {
      const x = u.x * PX, z = u.y * PX;
      if (!this.near(x, z, 40)) continue;
      const sm = smooth(u, x, z, dirYaw(u.dirx, u.diry));
      this.vehicle('fire', x, this.groundY(x, z, true), z, sm.yaw, hex('#c0302a'), { siren: u.phase !== 'return' });
      if (u.phase === 'douse' && u.target) {
        // the crew on the hose
        const tb = u.target;
        const tx = (tb.x + tb.w / 2) * TM, tz = (tb.y + tb.h / 2) * TM;
        const yaw = Math.atan2(tx - x, tz - z);
        for (let k = 0; k < 2; k++) {
          const px = x + Math.sin(yaw) * (3 + k) + Math.cos(yaw) * (k ? 1 : -1), pz = z + Math.cos(yaw) * (3 + k) - Math.sin(yaw) * (k ? 1 : -1);
          this.person({ x: px, y: 0.2, z: pz, yaw, kind: 'man', seed: u.target.id + k, mode: 'stand', phase: 0, shirt: hex('#2a2a2a'), hair: hex('#f2c230') });
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
      this.vehicle('car', x - 1.5, 0.03, z, k.a1, CAR_COLORS[k.s1 % 8], { roll: 0.08 });
      this.vehicle('car', x + 1.5, 0.03, z + 0.6, k.a2, CAR_COLORS[k.s2 % 8], { pitch: -0.06 });
      this.prop('cone', x - 4, 0.03, z - 2.5);
      this.prop('cone', x + 4, 0.03, z + 2.5);
    }
    for (const rw of Life.roadworks) {
      const x = rw.x * TM + 4, z = rw.y * TM + 4;
      if (!this.near(x, z)) continue;
      this.prop('barrier', x, 0.03, z - 2.5);
      this.prop('cone', x - 2.5, 0.03, z + 2);
      this.prop('cone', x + 2.5, 0.03, z + 2);
      this.person({ x: x + Math.sin(this.t) * 1.2, y: 0.03, z: z + 0.5, yaw: this.t, kind: 'man', seed: rw.x * 13 + rw.y, mode: 'stand', phase: 0, shirt: hex('#f26a1a'), hair: hex('#f2c230') });
    }
    for (const r of Life.reporters) this.lerpPerson(r, 'stand', { camera: true, shirt: hex('#3a5ad0') });
  }

  /* someone hurrying from a doorway (sx,sy) to a scene (tx,ty) by fraction f */
  private lerpPerson(o: any, endMode: Mode, extra: { camera?: boolean; bucket?: boolean; shirt?: THREE.Color; placard?: THREE.Color; face?: { x: number; z: number } } = {}): void {
    const f = Math.max(0, Math.min(1, o.f));
    const x = (o.sx + (o.tx - o.sx) * f) * PX, z = (o.sy + (o.ty - o.sy) * f) * PX;
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
      const x = bus.x * PX, z = bus.y * PX;
      if (!this.near(x, z, 40)) continue;
      const sm = smooth(bus, x, z, dirYaw(bus.dirx, bus.diry));
      this.vehicle('bus', x, this.groundY(x, z, true), z, sm.yaw, hex('#2a6ab8'));
    }
    for (const cab of Life.taxis) {
      const x = cab.x * PX, z = cab.y * PX;
      if (!this.near(x, z, 40)) continue;
      const sm = smooth(cab, x, z, dirYaw(cab.dirx, cab.diry));
      this.vehicle('taxi', x, this.groundY(x, z, true), z, sm.yaw, hex('#f2c230'));
    }
    for (const t of Life.tourists) {
      if (t.phase === 'visit') continue;
      const x = t.x * PX, z = t.y * PX;
      if (!this.near(x, z, 40)) continue;
      const sm = smooth(t, x, z, dirYaw(t.dirx, t.diry));
      this.vehicle('car', x, this.groundY(x, z, true), z, sm.yaw, CAR_COLORS[(t.seed + 3) % 8]);
    }
    for (const cc of Life.campaignCars) {
      const x = cc.x * PX, z = cc.y * PX;
      if (!this.near(x, z, 40)) continue;
      const sm = smooth(cc, x, z, dirYaw(cc.dirx, cc.diry));
      const col = Gov.campaign ? hex(Gov.campaign.candidates[cc.ci]?.color || '#4f8ede') : hex('#4f8ede');
      this.vehicle('car', x, this.groundY(x, z, true), z, sm.yaw, col);
    }
    // trains: the consist trails behind the engine along the track
    for (const tr of Life.trains) {
      if (tr.hidden || !tr.route) continue;
      const lane = (tr.lane || 0) * PX;
      const n = (tr.cars || 3) + 1;
      for (let k = 0; k < n; k++) {
        const prog = tr.prog - tr.dir * k * 1.2;
        if (prog < -0.4 || prog > tr.route.length - 0.6) continue;
        const pt = pathAt(tr.route, Math.max(0, Math.min(tr.route.length - 1, prog)));
        const horiz = pt.dx !== 0;
        const x = pt.x * TM + 4 + (horiz ? 0 : lane), z = pt.y * TM + 4 + (horiz ? lane : 0);
        if (!this.near(x, z, 60)) continue;
        const yaw = Math.atan2(pt.dx * tr.dir, pt.dy * tr.dir);
        const onBridge = World.ground[World.idx(Math.floor(pt.x + 0.5), Math.floor(pt.y + 0.5))] === 1;
        const y = onBridge ? 0.5 : 0.38;
        const type = k === 0 ? 'loco' : tr.type === 'freight' ? 'wagon' : 'coach';
        const paint = tr.type === 'freight' ? hex(k === 0 ? '#3a4a3a' : '#8a5a3a') : tr.type === 'express' ? hex('#c8ccd4') : tr.type === 'nightliner' ? hex('#2a3a6a') : hex('#c0392b');
        this.vehicle(type, x, y, z, yaw, paint);
      }
    }
    for (const b of Life.boats) this.boat(b, 'boat', hex('#f4f0e4'));
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
  private boat(b: any, type: string, col: THREE.Color): void {
    const x = b.x * PX, z = b.y * PX;
    if (!this.near(x, z, 60)) return;
    const sm = smooth(b, x, z, b.dirx !== undefined ? dirYaw(b.dirx, b.diry) : b.flip ? (b.flip > 0 ? Math.PI / 2 : -Math.PI / 2) : null);
    this.vehicle(type, x, -0.35 + Math.sin((b.ph || 0) * 2) * 0.08, z, sm.yaw, col);
  }

  /* crowds: gawkers, bucket brigades, rubble-clearers, rallies, riots, queues, beach days, hikers */
  private collectCrowds(): void {
    for (const gk of Life.gawkers) this.lerpPerson(gk, 'stand', { face: { x: gk.tx * PX, z: gk.ty * PX } });
    for (const k of Life.buckets) for (const h of k.helpers) this.lerpPerson(h, 'stand', { bucket: true, face: { x: (k.b.x + k.b.w / 2) * TM, z: (k.b.y + k.b.h / 2) * TM } });
    if (Life.disaster) for (const h of Life.disaster.helpers) this.lerpPerson(h, 'stand', { face: { x: (Life.disaster.b.x + Life.disaster.b.w / 2) * TM, z: (Life.disaster.b.y + Life.disaster.b.h / 2) * TM } });
    const rally = Life.rally;
    if (rally) {
      const sx = rally.x * PX, sz = rally.y * PX;
      this.prop('soapbox', sx, 0.1, sz);
      this.person({ x: sx, y: 0.7, z: sz, yaw: 0, kind: rally.speakerKind, seed: rally.speakerSeed, mode: 'stand', phase: this.t * 3, shirt: hex(rally.color) });
      for (const c of rally.crowd) {
        const x = c.x * PX, z = c.y * PX + 2;
        this.person({ x, y: 0.2, z, yaw: Math.atan2(sx - x, sz - z), kind: c.kind, seed: c.seed, mode: 'stand', phase: 0 });
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
    const vb = Life.votingBooths;
    if (vb) {
      const x0 = vb.x * PX, z0 = vb.y * PX;
      vb.colors.forEach((c: string, i: number) => this.prop('booth', x0 - 3 + i * 1.6, 0.1, z0 - 1.2, 0, 1, hex(c)));
      vb.queue.forEach((q: any, i: number) => this.person({ x: x0 + 3 + (i % 5) * 0.9, y: 0.1, z: z0 + Math.floor(i / 5) * 1.2, yaw: Math.PI, kind: q.kind, seed: q.seed, mode: 'stand', phase: 0 }));
    }
    // queues at bus shelters and taxi ranks
    for (const [id, q] of Life.stopQueues as Map<number, any>) {
      if (!q.waiting.length) continue;
      const b = World.buildings.find((o: any) => o.id === id);
      if (!b) continue;
      const x0 = b.door.x * TM + 4, z0 = b.door.y * TM + 4;
      if (!this.near(x0, z0)) continue;
      const bx = (b.x + b.w / 2) * TM, bz = (b.y + b.h / 2) * TM;
      const ux = Math.sign(bx - x0) * 0.9, uz = Math.sign(bz - z0) * 0.9;
      q.waiting.forEach((w: any, i: number) => {
        const x = (x0 + bx) / 2 + (uz ? i * 0.8 : 0) - (uz ? 2 : 0), z = (z0 + bz) / 2 + (ux ? i * 0.8 : 0) - (ux ? 2 : 0);
        this.person({ x, y: 0.15, z, yaw: Math.atan2(x0 - bx, z0 - bz), kind: w.kind, seed: w.seed, mode: 'stand', phase: 0 });
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
      this.person({ x, y, z, yaw: sm.yaw, kind: h.seed % 2 ? 'woman' : 'man', seed: h.seed, mode: h.pause > 0 ? 'stand' : 'walk', phase: sm.phase, shirt: hex('#c0703a') });
      if (Sim.clock > 1140 || Sim.clock < 360) this.prop('torch', x, y, z, sm.yaw, 1, hex('#ffb040'));
    }
  }

  /* ducks, birds, butterflies, puddles, the tornado */
  private collectNature(): void {
    for (const d of Life.ducks) {
      const x = d.x * PX, z = d.y * PX;
      if (!this.near(x, z)) continue;
      const sm = smooth(d, x, z, null);
      this.prop('duck', x, -0.38, z, sm.yaw);
    }
    for (const b of Life.birds) {
      const x = b.x * PX, z = b.y * PX;
      if (!this.near(x, z, 120)) continue;
      const flap = Math.sin(b.ph) * 0.6;
      this.props.bird.add(x, 32 + Math.sin(b.ph * 0.3) * 2, z, b.vx > 0 ? Math.PI / 2 : -Math.PI / 2, 1.4, null, 0, flap);
    }
    for (const p of Weather.puddles) {
      const x = p.x * PX, z = p.y * PX;
      if (!this.near(x, z)) continue;
      this.prop('puddle', x, 0, z, 0, 0.5 + p.r * 1.4, hex('#5a6878'));
    }
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
    const tree = F.tree;
    if (tree) {
      const x = tree.x * TM + 8, z = tree.y * TM + 8;
      if (tree.phase === 'hauling' && tree.haulPath && tree.haulPath.length > 1) {
        const pt = pathAt(tree.haulPath, Math.min(tree.haulPath.length - 1, tree.prog));
        const hx = pt.x * TM + 4, hz = pt.y * TM + 4;
        const yaw = Math.atan2(pt.dx, pt.dy);
        this.prop('log', hx, 1.2, hz, yaw);
        this.vehicle('car', hx + Math.sin(yaw) * 7, 0.03, hz + Math.cos(yaw) * 7, yaw, hex('#5a6a3a'), { scale: 1.2 });
      } else if (tree.phase === 'raising' || tree.phase === 'lit') {
        const s = tree.phase === 'raising' ? 0.3 + tree.prog * 0.7 : 1;
        this.prop('xtree', x, 0, z, 0, 1, null, s);
        if (tree.phase === 'lit') {
          this.prop('xstar', x, 0, z, this.t * 0.5, 1, hex('#ffe060'));
          for (let i = 0; i < 70; i++) {
            const h = 1.5 + (i / 70) * 10.5, r = 4.2 * (1 - h / 13) + 0.2;
            const a = i * 2.4;
            const twinkle = (Math.sin(this.t * 3 + i) + 1) / 2;
            this.prop('bulb', x + Math.cos(a) * r, h, z + Math.sin(a) * r, 0, 1, hex(['#ff4040', '#ffd040', '#40c0ff', '#80ff90'][i % 4]).multiplyScalar(0.5 + twinkle * 0.5 + night * 0.3));
          }
        }
      }
    }
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
      const sm = smooth(santa, x, z, dirYaw(santa.dirx, santa.diry));
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
        if (xmas) {
          const h = this.buildings.heightOf(b.id) * 0.62;
          const W = b.w * TM * 0.42, D = b.h * TM * 0.42;
          for (let k = 0; k < 10; k++) {
            const a = (k / 10) * Math.PI * 2;
            this.prop('bulb', bx + Math.cos(a) * W, h, bz + Math.sin(a) * D, 0, 0.8, hex(['#ff4040', '#ffd040', '#40c0ff', '#80ff90'][(k + b.id) % 4]));
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
        this.person({ x: x + 2.2, y: 0, z: z + 1, yaw: Math.sin(this.t + cp.ci) * 1.5, kind: cp.ci % 2 ? 'woman' : 'man', seed: cp.ci * 11 + cp.x, mode: 'stand', phase: 0, shirt: hex(camp.candidates[cp.ci]?.color || '#888') });
      }
    }
  }

  /* burning buildings: flames, smoke and a flickering glow */
  private collectFires(night: number): void {
    const fires: { x: number; z: number; d: number }[] = [];
    for (const b of World.buildings) {
      const bx = (b.x + b.w / 2) * TM, bz = (b.y + b.h / 2) * TM;
      const smoky = CAT[b.type].smoke && !b.ruined && !b.construction && b.workers.length;
      if (!b.fire && !smoky) continue;
      if (!this.near(bx, bz, 80)) continue;
      const h = this.buildings.heightOf(b.id);
      if (b.fire) {
        fires.push({ x: bx, z: bz, d: Math.hypot(bx - this.camX, bz - this.camZ) });
        for (let i = 0; i < 9; i++) {
          const hv = hash2(b.id, i);
          const ox = ((hv % 100) / 100 - 0.5) * b.w * TM * 0.6, oz = (((hv >> 8) % 100) / 100 - 0.5) * b.h * TM * 0.6;
          const fl = 0.8 + Math.sin(this.t * 9 + i) * 0.25;
          this.prop('flame', bx + ox, h * 0.55, bz + oz, this.t * 2 + i, fl, hex(i % 3 ? '#ff7a1a' : '#ffd040'), fl * 1.4);
        }
      }
      const n = b.fire ? 8 : 4;
      for (let i = 0; i < n; i++) {
        const ph = (this.t * 0.18 + i / n) % 1;
        const s = (b.fire ? 2 : 1.1) * (0.6 + ph * 1.6);
        const c = b.fire ? 0.18 + ph * 0.25 : 0.62 + ph * 0.25;
        this.prop('smoke', bx + ph * 6 + Math.sin(i) * 1.5, h + ph * (b.fire ? 22 : 14), bz + Math.cos(i * 1.7) * 1.5, ph * 3, s, new THREE.Color(c, c, c));
      }
    }
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

  /* ---------- people → instances ---------- */
  private drawPeople(): void {
    const tmpC = new THREE.Color();
    for (const p of this.people) {
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
      if (p.mode === 'walk') swing = Math.sin(p.phase) * 0.55;
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
        this.arms.add(ax, hipY + 0.62 * s, az, p.yaw, s, tmpC.copy(shirt), p.mode === 'sit' ? -0.9 : -swing * side * 0.8);
      }
      this.torso.add(p.x, hipY, p.z, p.yaw, s, shirt);
      this.head.add(p.x, hipY + 0.68 * s, p.z, p.yaw, s, skin);
      (p.kind === 'woman' ? this.hairLong : this.hair).add(p.x, hipY + 0.68 * s, p.z, p.yaw, s, hair);
    }
  }

  private bubbleWant: { x: number; y: number; z: number; e: string; d: number }[] = [];
  private wantBubble(x: number, y: number, z: number, e: string): void {
    const d = Math.hypot(x - this.camX, z - this.camZ);
    if (d < 70) this.bubbleWant.push({ x, y, z, e, d });
  }
  private drawBubbles(_now: number): void {
    this.bubbleWant.sort((a, b) => a.d - b.d);
    this.bubbles.forEach((s, i) => {
      const w = this.bubbleWant[i];
      if (!w) { s.visible = false; return; }
      s.visible = true;
      s.position.set(w.x, w.y + 0.4, w.z);
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
    // fireflies on warm nights among the trees
    if (Weather.season <= 1 && (Sim.clock > 1200 || Sim.clock < 300) && !Weather.isRaining())
      for (const f of Life.fireflySpots) {
        const x = f.x * PX + Math.sin(this.t + f.ph) * 2, z = f.y * PX + Math.cos(this.t * 0.7 + f.ph) * 2;
        if (!this.near(x, z)) continue;
        const k = (Math.sin(this.t * 3 + f.ph * 5) + 1) / 2;
        this.spark(x, 1.5 + Math.sin(this.t + f.ph) * 0.6, z, 0.8 * k, 1.0 * k, 0.3 * k);
      }
    const geo = this.sparks.geometry;
    geo.setDrawRange(0, this.sparkN);
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    this.sparkN = 0;
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

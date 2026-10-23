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
import { heightAt, isWaterAt, treeSpot } from '../render/terrain';
import type { BuildingLayer } from '../render/buildings';
import { emit } from '../sim/core';
import type { FounderSave } from '../sim/game';
import { Person } from '../gfx/person';
import { Car as CarModel } from '../gfx/car';
import { surface } from '../gfx/surface';
import { ENV } from '../gfx/env';

const TM = 8;
const R_BODY = 0.38;
const GRAV = 22;

export interface Car { x: number; z: number; yaw: number; speed: number; y: number; pitch: number }

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
  wallet = 120;
  mesh = new THREE.Group();
  carMesh = new THREE.Group();
  private phase = 0;
  private camPos = new THREE.Vector3();
  private camInit = false;
  speedKmh = 0;

  constructor(scene: THREE.Scene, private buildings: BuildingLayer) {
    this.buildBody();
    this.buildCar();
    scene.add(this.mesh, this.carMesh);
  }

  /* the Founder: a deep-violet coat, a gold scarf, a wide-brimmed hat */
  private person!: Person;
  private carModel!: CarModel;
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

  private buildCar(): void {
    this.carModel = new CarModel('sedan', new THREE.Color('#3e1a5e'), true);
    this.carMesh.add(this.carModel.root);
    const head = new THREE.SpotLight(0xfff2d0, 0, 60, 0.5, 0.5, 1.2);
    head.position.set(0, 0.8, 2.2);
    head.target.position.set(0, 0, 14);
    this.carMesh.add(head, head.target);
    this.carMesh.userData.head = head;
  }

  /** start beside the Lodge (or wherever a save put us) */
  spawn(lodge: any, save?: FounderSave | null): void {
    if (save) {
      this.pos.set(save.x, save.y, save.z);
      this.yaw = this.camYaw = save.yaw;
      this.wallet = save.wallet ?? 120;
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
    this.camInit = false;
  }
  private parkCarAtLodge(lodge: any): void {
    if (!lodge) return;
    const dx = lodge.door.x * TM + 4, dz = lodge.door.y * TM + 4;
    const cx = (lodge.x + lodge.w / 2) * TM, cz = (lodge.y + lodge.h / 2) * TM;
    const out = Math.atan2(dx - cx, dz - cz);
    // to the side of the door, nose toward the street
    this.car.x = dx + Math.cos(out) * 5.5;
    this.car.z = dz - Math.sin(out) * 5.5;
    this.car.yaw = out;
    this.car.speed = 0;
  }

  save(): FounderSave {
    return { x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yaw, car: { x: this.car.x, z: this.car.z, yaw: this.car.yaw }, wallet: Math.round(this.wallet) };
  }

  /* ---------- ground & collisions ---------- */
  groundAt(x: number, z: number): number {
    const h = heightAt(x, z);
    if (h > 0.3) return h;
    const tx = Math.floor(x / TM), tz = Math.floor(z / TM);
    if (!World.isRoad(tx, tz)) return Math.max(0, h);
    const base = World.ground[World.idx(tx, tz)] === 1 ? 0.25 : 0.03;
    if (World.ground[World.idx(tx, tz)] === 1) return base;
    // the raised pavement strip along kerbs that face open ground
    const lx = x - tx * TM, lz = z - tz * TM;
    const SW = 1.8;
    if ((lz < SW && !World.isRoad(tx, tz - 1)) || (lz > TM - SW && !World.isRoad(tx, tz + 1)) ||
        (lx < SW && !World.isRoad(tx - 1, tz)) || (lx > TM - SW && !World.isRoad(tx + 1, tz))) return base + 0.17;
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
    // open water is a wall for now (swimming arrives later)
    const tx = Math.floor(p.x / TM), tz = Math.floor(p.z / TM);
    for (let j = -1; j <= 1; j++)
      for (let i = -1; i <= 1; i++) {
        const x = tx + i, z = tz + j;
        if (!World.inB(x, z)) continue;
        if (isWaterAt(x * TM + 4, z * TM + 4)) boxes.push([x * TM, z * TM, x * TM + TM, z * TM + TM]);
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

  nearCar(): boolean {
    return !this.driving && Math.hypot(this.pos.x - this.car.x, this.pos.z - this.car.z) < 3.4;
  }

  enterCar(): void {
    this.driving = true;
    this.camYaw = this.car.yaw;
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
  }

  private walk(dt: number): void {
    const mv = Input.move();
    const run = Input.running();
    const speed = run ? 7.2 : 3.2;
    const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
    const rx = -Math.cos(this.camYaw), rz = Math.sin(this.camYaw);
    const vx = (fx * mv.y + rx * mv.x) * speed, vz = (fz * mv.y + rz * mv.x) * speed;
    const moving = Math.hypot(vx, vz) > 0.1;
    const p = { x: this.pos.x + vx * dt, z: this.pos.z + vz * dt };
    this.collide(p, R_BODY);
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
    const { gas, brake } = Input.pedals();
    const steer = Input.steer();
    const hb = Input.handbrake();
    const MAX = 30, REV = -8;
    if (gas > 0) c.speed += (c.speed < 0 ? 18 : 9) * gas * dt;
    if (brake > 0) c.speed -= (c.speed > 0 ? 22 : 6) * brake * dt;
    if (!gas && !brake) c.speed *= 1 - Math.min(1, dt * 0.6);
    if (hb) c.speed *= 1 - Math.min(1, dt * 3);
    c.speed = Math.max(REV, Math.min(MAX, c.speed));
    const turn = steer * 1.9 * (c.speed / (Math.abs(c.speed) + 5)) * (hb ? 1.6 : 1);
    c.yaw -= turn * dt;
    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
    const nx = c.x + fx * c.speed * dt, nz = c.z + fz * c.speed * dt;
    // front and rear contact circles
    const front = { x: nx + fx * 1.35, z: nz + fz * 1.35 };
    const rear = { x: nx - fx * 1.35, z: nz - fz * 1.35 };
    const hitF = this.collide(front, 1.0);
    const hitR = this.collide(rear, 1.0);
    if (hitF || hitR) {
      c.x = (front.x + rear.x) / 2;
      c.z = (front.z + rear.z) / 2;
      if (Math.abs(c.speed) > 6) emit('sound', { name: 'crunch' });
      c.speed *= -0.25;
    } else {
      c.x = nx;
      c.z = nz;
    }
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
      this.camYaw += d * Math.min(1, dt * 1.6);
    }
  }

  /** animate the body, place the car, and set the camera */
  private pose(dt: number): void {
    this.mesh.visible = !this.driving && !this.firstPerson;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
    const moving = !!this.mesh.userData.moving;
    const speed = moving ? Math.max(0.6, this.speedKmh / 3.6) : 0;
    if (this.mesh.visible) this.person.animate(dt, moving ? 'walk' : 'idle', speed, ENV.rain.value);
    const c = this.car;
    this.carMesh.position.set(c.x, c.y, c.z);
    this.carMesh.rotation.set(c.pitch, c.yaw, 0, 'YXZ');
    // the car's own suspension, wheels and lights
    const accel = (c.speed - this.lastCar.speed) / Math.max(dt, 1e-3);
    let dy = c.yaw - this.lastCar.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.lastCar.speed = c.speed;
    this.lastCar.yaw = c.yaw;
    this.carModel.drive(dt, 0, 0, 0, c.speed, accel, dy / Math.max(dt, 1e-3), 0);
    this.carModel.lights(this.driving && ENV.night.value > 0.2, ENV.night.value);
  }

  /** place the street camera: third-person orbit with collision, or eyes */
  applyCamera(cam: THREE.PerspectiveCamera, dt: number, night: number): void {
    const head = this.carMesh.userData.head as THREE.SpotLight;
    head.intensity = this.driving || night > 0.3 ? 30 * night : 0;
    if (this.firstPerson && !this.driving) {
      cam.position.set(this.pos.x, this.pos.y + 1.65, this.pos.z);
      const look = new THREE.Vector3(Math.sin(this.camYaw) * Math.cos(this.camPitch), Math.sin(this.camPitch), Math.cos(this.camYaw) * Math.cos(this.camPitch));
      cam.lookAt(cam.position.clone().add(look));
      this.yaw = this.camYaw;
      return;
    }
    const target = new THREE.Vector3(this.pos.x, this.pos.y + (this.driving ? 1.6 : 1.55), this.pos.z);
    const dist = this.driving ? (this.firstPerson ? 0.01 : 8.5) : this.camDist;
    if (this.driving && this.firstPerson) {
      const c = this.car;
      cam.position.set(c.x + Math.sin(c.yaw) * 0.3 - Math.cos(c.yaw) * 0.35, c.y + 1.3, c.z + Math.cos(c.yaw) * 0.3 + Math.sin(c.yaw) * 0.35);
      const look = new THREE.Vector3(Math.sin(this.camYaw) * Math.cos(this.camPitch), Math.sin(this.camPitch), Math.cos(this.camYaw) * Math.cos(this.camPitch));
      cam.lookAt(cam.position.clone().add(look));
      return;
    }
    const pitch = this.driving ? Math.min(this.camPitch, -0.08) : this.camPitch;
    const dir = new THREE.Vector3(-Math.sin(this.camYaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(this.camYaw) * Math.cos(pitch));
    // pull the camera in front of walls and slopes
    let d = dist;
    for (let s = 0.5; s <= dist; s += 0.4) {
      const px = target.x + dir.x * s, py = target.y + dir.y * s, pz = target.z + dir.z * s;
      if (py < heightAt(px, pz) + 0.4 || this.insideSolid(px, pz, py)) { d = Math.max(0.6, s - 0.4); break; }
    }
    const want = target.clone().addScaledVector(dir, d);
    if (!this.camInit) { this.camPos.copy(want); this.camInit = true; }
    this.camPos.lerp(want, Math.min(1, dt * (this.driving ? 10 : 18)));
    cam.position.copy(this.camPos);
    cam.lookAt(target);
  }
  private insideSolid(x: number, z: number, y: number): boolean {
    for (const [x0, z0, x1, z1] of this.buildings.solidsNear(x, z, 1)) {
      if (x > x0 && x < x1 && z > z0 && z < z1) {
        const b = World.buildingAt(Math.floor(x / TM), Math.floor(z / TM));
        if (!b || y < this.buildings.heightOf(b.id)) return true;
      }
    }
    return false;
  }

  /** tile under the Founder */
  tile(): { x: number; y: number } {
    return { x: Math.floor(this.pos.x / TM), y: Math.floor(this.pos.z / TM) };
  }
}

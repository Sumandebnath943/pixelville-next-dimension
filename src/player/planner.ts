/* ============================================================
   The Planner: V1's god view, now an aerial camera you rise
   into from anywhere (design §4.1). Gliding WASD pan, wheel
   zoom, Q/E or right-drag to rotate; place with a ghost preview
   (R rotates the door side), drag roads/rails/rivers/bulldoze,
   click buildings or villagers to inspect them.
   ============================================================ */
import * as THREE from 'three';
import { CAT } from '../sim/catalog';
import { PEAK_R } from '../sim/peak';
import { World, GW, GH, footprint, doorOf, normFacing } from '../sim/world';
import { Game } from '../sim/game';
import { Input } from '../input/input';
import { MeshBuilder, InstancedPool, hex } from '../render/kit';
import type { BuildingLayer } from '../render/buildings';
import type { Actors } from '../render/actors';

const TM = 8;

export class Planner {
  active = false;
  target = new THREE.Vector3((GW / 2) * TM, 0, (GH / 2) * TM);
  yaw = 0.5;
  pitch = 0.92;
  dist = 170;
  private vx = 0;
  private vz = 0;
  tool: string | null = null;
  facing = 0;
  hover: { x: number; y: number } | null = null;
  private dragStart: { x: number; y: number } | null = null;
  private ghost: THREE.Mesh;
  private ghostMat: THREE.MeshBasicMaterial;
  private door: THREE.Mesh;
  private preview: InstancedPool;
  private ray = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private down: { x: number; y: number; button: number; moved: number } | null = null;
  private touches = new Map<number, { x: number; y: number }>();
  private pinch0 = 0;
  private twist0: number | null = null;
  /** camera blend 0..1 when rising in or descending out */
  blend = 0;
  leaving = false;
  onBuilding: (b: any) => void = () => {};
  onPerson: (p: any) => void = () => {};
  onToolChange: (k: string | null) => void = () => {};
  onEmptyClick: () => void = () => {};

  constructor(scene: THREE.Scene, private canvas: HTMLCanvasElement, private cam: THREE.PerspectiveCamera, private buildings: BuildingLayer, private actors: Actors) {
    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0x40ff80, transparent: true, opacity: 0.35, depthWrite: false });
    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.ghostMat);
    this.ghost.visible = false;
    this.door = new THREE.Mesh(new THREE.ConeGeometry(1.4, 3, 4), new THREE.MeshBasicMaterial({ color: 0xffd040 }));
    this.door.visible = false;
    scene.add(this.ghost, this.door);
    const tile = new MeshBuilder().box(-4, 0, -4, 4, 0.5, 4, hex('#ffffff')).build();
    this.preview = new InstancedPool(tile, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false }), 1500, scene, false);
    this.attach();
  }

  enter(focus: THREE.Vector3): void {
    this.active = true;
    this.leaving = false;
    this.target.set(focus.x, 0, focus.z);
    this.blend = 0;
    Game.streetMode = false;
  }
  exit(): void {
    this.leaving = true;
    this.setTool(null);
  }
  setTool(k: string | null): void {
    this.tool = k;
    this.dragStart = null;
    this.onToolChange(k);
  }

  /* ---------- pointer input ---------- */
  private attach(): void {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => { if (this.active) e.preventDefault(); });
    c.addEventListener('pointerdown', (e) => {
      if (!this.active || this.leaving) return;
      if (e.pointerType === 'touch') {
        this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.touches.size === 2) {
          const [a, b] = [...this.touches.values()];
          this.pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
          this.twist0 = null;
          this.down = null;
          return;
        }
      }
      this.down = { x: e.clientX, y: e.clientY, button: e.button, moved: 0 };
      this.setMouse(e);
      if (e.button === 0 && this.tool && CAT[this.tool].drag) this.dragStart = this.groundTile();
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.active) return;
      this.setMouse(e);
      if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
        const prev = this.touches.get(e.pointerId)!;
        if (this.touches.size === 2) {
          this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const [a, b] = [...this.touches.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (this.pinch0) this.dist = Math.max(40, Math.min(700, this.dist * (this.pinch0 / d)));
          this.pinch0 = d;
          // V2 (Milestone 7): and a twist of the two fingers turns the view
          const ang = Math.atan2(b.y - a.y, b.x - a.x);
          if (this.twist0 !== null) {
            let da = ang - this.twist0;
            if (da > Math.PI) da -= Math.PI * 2;
            if (da < -Math.PI) da += Math.PI * 2;
            this.yaw += da;
          }
          this.twist0 = ang;
          return;
        }
        this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        void prev;
      }
      if (!this.down) return;
      const dx = e.movementX || 0, dy = e.movementY || 0;
      this.down.moved += Math.abs(dx) + Math.abs(dy);
      if (this.down.button === 2 || this.down.button === 1) {
        this.yaw -= dx * 0.006;
        this.pitch = Math.max(0.35, Math.min(1.45, this.pitch + dy * 0.004));
      } else if (this.down.button === 0 && !this.dragStart && !(this.tool && !CAT[this.tool].drag)) {
        // drag the map: it follows the cursor (camera right = (cos, -sin), forward = (-sin, -cos))
        const k = this.dist / 700;
        const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
        this.target.x += (-cy * dx - sy * dy) * k;
        this.target.z += (sy * dx - cy * dy) * k;
        this.clampTarget();
      }
    });
    window.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch') this.touches.delete(e.pointerId);
      if (!this.active || !this.down) return;
      const d = this.down;
      this.down = null;
      if ((e.target as HTMLElement) !== this.canvas && d.moved < 6) return;
      const tile = this.groundTile();
      if (d.button === 2) {
        if (d.moved < 6) this.setTool(null);
        return;
      }
      if (d.button !== 0) return;
      if (this.dragStart && this.tool && tile) {
        Game.dragTool(this.tool, this.dragStart.x, this.dragStart.y, tile.x, tile.y);
        this.dragStart = null;
        return;
      }
      if (d.moved > 6) return;
      if (this.tool && tile) {
        const o = this.originFor(this.tool, tile);
        Game.placeAt(this.tool, o.x, o.y, normFacing(this.tool, this.facing));
        return;
      }
      this.pick();
    });
  }
  private setMouse(e: PointerEvent): void {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }
  private groundTile(): { x: number; y: number } | null {
    this.ray.setFromCamera(this.mouse, this.cam);
    const pl = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const p = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(pl, p)) return null;
    const x = Math.floor(p.x / TM), y = Math.floor(p.z / TM);
    return World.inB(x, y) ? { x, y } : null;
  }
  private originFor(key: string, tile: { x: number; y: number }): { x: number; y: number } {
    const d = CAT[key];
    if (!d.building) return tile;
    const fp = footprint(key, this.facing);
    return { x: tile.x - (fp.w >> 1), y: tile.y - (fp.h >> 1) };
  }

  /* ---------- V2 (Milestone 7): a gamepad has no cursor: the ring at the screen's centre is it ---------- */
  padAim(): void { this.mouse.set(0, 0); }
  /** A on the pad: place the tool under the ring (a road or a bulldozer drag: first press starts, second finishes), or pick */
  padPress(): void {
    this.padAim();
    const tile = this.groundTile();
    const d = this.tool ? CAT[this.tool] : null;
    if (d?.drag) {
      if (!this.dragStart) { this.dragStart = tile; return; }
      if (tile) Game.dragTool(this.tool!, this.dragStart.x, this.dragStart.y, tile.x, tile.y);
      this.dragStart = null;
      return;
    }
    if (this.tool && tile) {
      const o = this.originFor(this.tool, tile);
      Game.placeAt(this.tool, o.x, o.y, normFacing(this.tool, this.facing));
      return;
    }
    this.pick();
  }

  /** click with no tool: a villager (closest on screen) or a building */
  private pick(): void {
    const r = this.canvas.getBoundingClientRect();
    const mx = ((this.mouse.x + 1) / 2) * r.width, my = ((1 - this.mouse.y) / 2) * r.height;
    let best: any = null, bd = 22;
    const v = new THREE.Vector3();
    for (const p of this.actors.pickables) {
      v.set(p.x, p.y + 1, p.z).project(this.cam);
      if (v.z > 1) continue;
      const sx = ((v.x + 1) / 2) * r.width, sy = ((1 - v.y) / 2) * r.height;
      const d = Math.hypot(sx - mx, sy - my);
      if (d < bd) { bd = d; best = p.ref; }
    }
    if (best) { this.onPerson(best); return; }
    this.ray.setFromCamera(this.mouse, this.cam);
    // buildings are merged per chunk now: pick by their boxes
    const hit = this.buildings.pick(this.ray.ray);
    if (hit) { this.onBuilding(hit); return; }
    const t = this.groundTile();
    if (t) {
      const b = World.buildingAt(t.x, t.y);
      if (b) { this.onBuilding(b); return; }
    }
    this.onEmptyClick();
  }

  private clampTarget(): void {
    this.target.x = Math.max(0, Math.min(GW * TM, this.target.x));
    this.target.z = Math.max(0, Math.min(GH * TM, this.target.z));
  }

  /** fly the camera to a world point (from a toast or the minimap) */
  focus(x: number, z: number): void {
    this.target.set(x, 0, z);
    this.clampTarget();
  }

  /* ---------- per frame ---------- */
  update(dt: number): void {
    if (!this.active) return;
    // gliding pan with velocity easing, like V1's Age-of-Empires camera
    // (Input.move() is the bound keys, the pad's left stick and the touch stick together)
    const mv = Input.move();
    const ax = mv.x, az = -mv.y;
    // world velocity = right·ax + forward·(−az), right = (cos, −sin), forward = (−sin, −cos)
    const sp = this.dist * 1.1;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const tx = (ax * cy + az * sy) * sp, tz = (-ax * sy + az * cy) * sp;
    this.vx += (tx - this.vx) * Math.min(1, dt * 6);
    this.vz += (tz - this.vz) * Math.min(1, dt * 6);
    this.target.x += this.vx * dt;
    this.target.z += this.vz * dt;
    this.clampTarget();
    if (Input.held('descend')) this.yaw += dt * 1.4;
    if (Input.held('climb')) this.yaw -= dt * 1.4;
    if (Input.pad && !Input.padMenu) {
      this.yaw -= (Input.pad.axes[2] || 0) * dt * 1.6 * (Math.abs(Input.pad.axes[2] || 0) > 0.15 ? 1 : 0);
      const zy = Input.pad.axes[3] || 0;
      if (Math.abs(zy) > 0.15) this.dist = Math.max(40, Math.min(700, this.dist * (1 + zy * dt * 1.5)));
    }
    if (Input.wheel) this.dist = Math.max(40, Math.min(700, this.dist * Math.pow(1.13, Input.wheel)));
    if (Input.take('rotate')) {
      this.facing = (this.facing + 1) & 3;
    }
    this.blend = this.leaving ? Math.max(0, this.blend - dt * 1.1) : Math.min(1, this.blend + dt * 1.1);
    if (this.leaving && this.blend <= 0) {
      this.active = false;
      this.leaving = false;
      Game.streetMode = true;
      Game.setSpeed(Math.min(Game.speedIdx, 1));
    }
    this.updateGhost();
  }

  /** the aerial camera pose */
  pose(out: THREE.PerspectiveCamera): void {
    const cp = Math.cos(this.pitch);
    out.position.set(this.target.x + Math.sin(this.yaw) * cp * this.dist, Math.sin(this.pitch) * this.dist, this.target.z + Math.cos(this.yaw) * cp * this.dist);
    out.lookAt(this.target);
  }

  private updateGhost(): void {
    this.preview.begin();
    this.ghost.visible = false;
    this.door.visible = false;
    const tile = this.active && !this.leaving ? this.groundTile() : null;
    this.hover = tile;
    if (!tile || !this.tool) { this.preview.end(); return; }
    const d = CAT[this.tool];
    if (this.dragStart && d.drag) {
      const s = this.dragStart;
      const col = d.tool === 'bulldoze' ? hex('#ff5050') : d.tool === 'rail' ? hex('#c8a060') : d.tool === 'river' ? hex('#50a0ff') : hex('#e0e0e0');
      if (d.tool === 'bulldoze') {
        const x0 = Math.min(s.x, tile.x), x1 = Math.max(s.x, tile.x), y0 = Math.min(s.y, tile.y), y1 = Math.max(s.y, tile.y);
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.preview.add(x * TM + 4, 0.2, y * TM + 4, 0, 1, col);
      } else {
        const sx = Math.sign(tile.x - s.x) || 1, sy = Math.sign(tile.y - s.y) || 1;
        for (let x = s.x; x !== tile.x + sx; x += sx) this.preview.add(x * TM + 4, 0.2, s.y * TM + 4, 0, 1, col);
        for (let y = s.y; y !== tile.y + sy; y += sy) this.preview.add(tile.x * TM + 4, 0.2, y * TM + 4, 0, 1, col);
      }
      this.preview.end();
      return;
    }
    if (d.building) {
      const f = normFacing(this.tool, this.facing);
      const fp = footprint(this.tool, f);
      const o = this.originFor(this.tool, tile);
      const ok = World.canPlace(this.tool, o.x, o.y, f);
      this.ghostMat.color.set(ok ? 0x40ff80 : 0xff4040);
      const h = Math.max(4, (d.ex || 10) * 0.6);
      this.ghost.scale.set(fp.w * TM - 0.4, h, fp.h * TM - 0.4);
      this.ghost.position.set((o.x + fp.w / 2) * TM, h / 2, (o.y + fp.h / 2) * TM);
      this.ghost.visible = true;
      const door = doorOf(o.x, o.y, fp.w, fp.h, f);
      this.door.position.set(door.x * TM + 4, 2.4, door.y * TM + 4);
      this.door.rotation.set(Math.PI, 0, 0);
      this.door.visible = true;
    } else {
      const r = d.tool === 'peak' ? PEAK_R : d.tool === 'mountain' ? 5 : d.tool === 'lake' ? 4 : d.tool === 'forest' ? 3 : 0;
      for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++)
        if (x * x + y * y <= r * r + 0.5) this.preview.add((tile.x + x) * TM + 4, 0.2, (tile.y + y) * TM + 4, 0, 1, hex(d.tool === 'bulldoze' ? '#ff5050' : '#80d0ff'));
    }
    this.preview.end();
  }
}

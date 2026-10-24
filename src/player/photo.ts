/* ============================================================
   Photo mode (design §4.6): the world holds still, the camera
   comes free of the Founder (within a short walk of them), and
   the shot is dressed like a photographer would: focal length,
   depth of field with click-to-focus, exposure, a filter, and a
   preview of other light and weather. Everything put back as it
   was on the way out; the photo itself is a PNG.
   ============================================================ */
import * as THREE from 'three';
import { Sim } from '../sim/agents';
import { Weather } from '../sim/weather';
import { ENV } from '../gfx/env';
import type { Stage } from '../render/stage';

/** how far the camera may wander from where photo mode began (metres) */
export const RADIUS = 60;
export type WeatherPreview = 'clear' | 'clouds' | 'rain' | 'heavy' | 'snow';

/** each look multiplies or replaces the scene's own grade (which follows the weather) */
export interface Look { name: string; sat: number; contrast: number; tint: [number, number, number]; lift: number; vignette: number; grain: number }
export const LOOKS: Record<string, Look> = {
  natural: { name: 'Natural', sat: 1, contrast: 1, tint: [1, 1, 1], lift: 0, vignette: 0.22, grain: 0.018 },
  vivid: { name: 'Vivid', sat: 1.3, contrast: 1.08, tint: [1, 1, 1], lift: 0, vignette: 0.2, grain: 0.012 },
  warm: { name: 'Golden', sat: 1.08, contrast: 1.02, tint: [1.08, 1, 0.86], lift: 0.01, vignette: 0.26, grain: 0.018 },
  cool: { name: 'Cool', sat: 0.94, contrast: 1.03, tint: [0.9, 0.98, 1.1], lift: 0, vignette: 0.22, grain: 0.018 },
  faded: { name: 'Faded', sat: 0.78, contrast: 0.86, tint: [1.02, 1, 0.96], lift: 0.06, vignette: 0.18, grain: 0.035 },
  mono: { name: 'Mono', sat: 0, contrast: 1.1, tint: [1, 1, 1], lift: 0, vignette: 0.24, grain: 0.022 },
  noir: { name: 'Noir', sat: 0, contrast: 1.38, tint: [1, 1, 1], lift: 0, vignette: 0.55, grain: 0.04 },
  sepia: { name: 'Sepia', sat: 0, contrast: 0.96, tint: [1.12, 0.98, 0.76], lift: 0.03, vignette: 0.3, grain: 0.03 },
};

/** the full-frame focal length that gives this vertical field of view (24 mm sensor height) */
export function focalLength(fovDeg: number): number {
  return 12 / Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2);
}
/** keep a point within `r` of `anchor` on the ground plane */
export function tether(p: THREE.Vector3, anchor: THREE.Vector3, r: number): void {
  const dx = p.x - anchor.x, dz = p.z - anchor.z, d = Math.hypot(dx, dz);
  if (d > r) { p.x = anchor.x + (dx / d) * r; p.z = anchor.z + (dz / d) * r; }
}
/** the wet and snowy streets a weather preview shows (null: as they really are) */
export function surfacesFor(w: WeatherPreview | null): { wet: number; snow: number } | null {
  if (!w) return null;
  return { wet: w === 'rain' ? 0.75 : w === 'heavy' ? 1 : 0, snow: w === 'snow' ? 0.85 : 0 };
}

export class PhotoMode {
  active = false;
  /** camera pose */
  pos = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  fov = 60;
  /** depth of field */
  dof = false;
  focus = 10;
  blur = 0.4;
  look = 'natural';
  /** exposure compensation, in stops */
  ev = 0;
  /** preview: the hour (null = as it is) and the weather (null = as it is) */
  hour: number | null = null;
  weather: WeatherPreview | null = null;
  private anchor = new THREE.Vector3();
  private undo: (() => void)[] = [];
  private real = { clock: 0, kind: '', intensity: 0, wet: 0, snow: 0 };

  constructor(private stage: Stage) {}

  /** from the camera as it is now; `subject` is where the Founder stands (the camera stays near) */
  enter(camera: THREE.PerspectiveCamera, subject: THREE.Vector3, ground: (x: number, z: number) => number): void {
    if (this.active) return;
    this.active = true;
    this.ground = ground;
    this.pos.copy(camera.position);
    const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    this.yaw = e.y;
    this.pitch = e.x;
    this.fov = camera.fov;
    this.anchor.copy(subject);
    this.focus = Math.max(1, camera.position.distanceTo(subject));
    // hold the moment, remembering what to put back
    const g = this.stage.pipe.grade.uniforms, fov = camera.fov;
    this.undo.push(this.stage.hold(), () => {
      g.vignette.value = LOOKS.natural.vignette;
      g.grain.value = LOOKS.natural.grain;
      g.lift.value = 0;
      camera.fov = fov;
      camera.updateProjectionMatrix();
    });
    this.real = { clock: Sim.clock, kind: Weather.kind, intensity: Weather.intensity, wet: ENV.wet.value, snow: ENV.snow.value };
    this.undo.push(() => {
      Sim.clock = this.real.clock;
      Weather.kind = this.real.kind;
      Weather.intensity = this.real.intensity;
    });
    this.hour = null;
    this.weather = null;
  }

  exit(): void {
    if (!this.active) return;
    this.active = false;
    const pass = this.stage.pipe.dofPass();
    if (pass) pass.enabled = false;
    while (this.undo.length) this.undo.pop()!();
  }

  private ground: (x: number, z: number) => number = () => 0;

  /** fly: `move` x strafes, y goes forward along the view; `rise` up or down; `look` turns */
  fly(dt: number, move: { x: number; y: number }, rise: number, look: { dx: number; dy: number }, fast: boolean, zoom: number): void {
    this.yaw -= look.dx;
    this.pitch = THREE.MathUtils.clamp(this.pitch - look.dy, -1.45, 1.45);
    const sp = (fast ? 14 : 5) * dt;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.pos.addScaledVector(fwd, move.y * sp).addScaledVector(right, move.x * sp);
    this.pos.y += rise * sp;
    tether(this.pos, this.anchor, RADIUS);
    const floor = this.ground(this.pos.x, this.pos.z) + 0.3;
    this.pos.y = THREE.MathUtils.clamp(this.pos.y, floor, this.anchor.y + 80);
    if (zoom) this.fov = THREE.MathUtils.clamp(this.fov * (1 + zoom * 0.08), 12, 100);
  }

  /** place the camera for this frame (before the stage's update, so the sky and shadows follow it) */
  pose(camera: THREE.PerspectiveCamera): void {
    camera.position.copy(this.pos);
    camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    if (camera.fov !== this.fov) { camera.fov = this.fov; camera.updateProjectionMatrix(); }
  }
  /** dress the picture (after the stage's update, which sets the weather's own grade) */
  dress(camera: THREE.PerspectiveCamera): void {
    // the look on top of the weather's own grade
    const L = LOOKS[this.look] || LOOKS.natural, g = this.stage.pipe.grade.uniforms;
    g.saturation.value *= L.sat;
    g.contrast.value *= L.contrast;
    (g.tint.value as THREE.Vector3).multiply(new THREE.Vector3(...L.tint));
    g.lift.value = L.lift;
    g.vignette.value = L.vignette;
    g.grain.value = L.grain;
    this.stage.exposureBias = Math.pow(2, this.ev);
    // depth of field: made the first time it's switched on
    if (this.dof || this.stage.pipe.dofPass()) {
      const pass = this.stage.pipe.dof(this.stage.scene, camera);
      const u = pass.materialBokeh.uniforms;
      pass.enabled = this.dof;
      u.focus.value = this.focus;
      u.aperture.value = 0.0002 + this.blur * this.blur * 0.006;
      u.maxblur.value = 0.004 + this.blur * 0.014;
    }
  }

  /** where shadows and nearby detail centre: a little way ahead of the camera */
  focusPoint(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.pos.x - Math.sin(this.yaw) * 15, this.pos.y, this.pos.z - Math.cos(this.yaw) * 15);
  }

  /** focus on whatever is under this point of the picture (CSS pixels) */
  focusAt(camera: THREE.PerspectiveCamera, x: number, y: number): number | null {
    const d = this.stage.pipe.distanceAt(this.stage.scene, camera, x, y);
    if (d === null) return null;
    this.focus = THREE.MathUtils.clamp(d, 0.5, 2000);
    this.dof = true;
    return this.focus;
  }

  /** the hour it really is in the village */
  get realHour(): number {
    return this.real.clock / 60;
  }
  /** show another hour (null: back to the real time) */
  setHour(h: number | null): void {
    this.hour = h;
    Sim.clock = h === null ? this.real.clock : ((h % 24) + 24) % 24 * 60;
  }
  /** show other weather (null: back to the real weather) */
  setWeather(w: WeatherPreview | null): void {
    this.weather = w;
    Weather.kind = w ?? this.real.kind;
    Weather.intensity = w ? (w === 'heavy' ? 0.9 : w === 'clear' || w === 'clouds' ? 0 : 0.6) : this.real.intensity;
    const s = surfacesFor(w) ?? { wet: this.real.wet, snow: this.real.snow };
    this.stage.snapWeather(s.wet, s.snow);
  }

  /** a file name for the shot: the village, the day and the time it shows */
  fileName(village: string): string {
    const c = Math.round(Sim.clock), hh = String(Math.floor(c / 60) % 24).padStart(2, '0'), mm = String(c % 60).padStart(2, '0');
    return `${village.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'PixelVille'}-day${Sim.day}-${hh}${mm}.png`;
  }
}

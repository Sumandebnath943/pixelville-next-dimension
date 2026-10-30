/* ============================================================
   Vehicles (Milestone 9): the downloaded models (credited in
   public/models/CREDITS.md), built small by scripts/vehicles/
   build.mjs. Each file holds a near and a mid model split into
   paint (plain body colour, tinted per car), glass, the wheel
   (one, placed at every corner and spun) and everything else
   (one texture atlas, its lamps glowing by channel), plus a far
   model in one mesh for drawing distant traffic instanced.
   A car is four draw calls near (paint, the rest, glass, its
   wheels), one model's whole far traffic one draw call.
   ============================================================ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { surface } from './surface';
import { addBeam, glare, isBraking, steerAngle, VIEW } from './car';

type V3 = [number, number, number];
interface Lod { paint: THREE.BufferGeometry | null; kit: THREE.BufferGeometry | null; glass: THREE.BufferGeometry | null; wheel: THREE.BufferGeometry | null }
export interface VehicleModel {
  id: string; kind: string; style: string | null; tint: boolean;
  dims: { L: number; W: number; H: number; WB?: number };
  wheelR: number; wheelsAt: V3[]; headAt: V3[]; beamAt: V3 | null;
  lods: Lod[]; far: THREE.BufferGeometry; atlas: THREE.Texture;
  /** a helicopter's main rotor (centred on its hub) and where the hub is */
  rotor: THREE.BufferGeometry | null; rotorAt: V3 | null;
}

const BASE = `${import.meta.env.BASE_URL}models/vehicles/`;
const MODELS = new Map<string, VehicleModel>();
let loading: Promise<void> | null = null;

/** load the whole fleet (at boot, so cars can be made at once); resolves even if some files fail */
export function loadFleet(): Promise<void> {
  loading ??= (async () => {
    const index = await fetch(BASE + 'index.json').then((r) => r.json()).catch(() => ({ fleet: [] }));
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    await Promise.all((index.fleet as any[]).map(async (e) => {
      try {
        const gltf = await loader.loadAsync(BASE + e.file);
        gltf.scene.updateMatrixWorld(true);
        const parts: Record<string, THREE.BufferGeometry> = {};
        let atlas: THREE.Texture | null = null;
        gltf.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          parts[o.name] = bake(m);
          atlas ??= (m.material as THREE.MeshStandardMaterial).map;
        });
        if (!atlas || !parts.far) return;
        const lod = (k: number): Lod => ({ paint: parts['paint' + k] ?? null, kit: parts['kit' + k] ?? null, glass: parts['glass' + k] ?? null, wheel: parts['wheel' + k] ?? null });
        MODELS.set(e.id, { id: e.id, kind: e.kind, style: e.style, tint: e.tint, dims: e.dims, wheelR: e.wheelR, wheelsAt: e.wheelsAt, headAt: e.headAt, beamAt: e.beamAt, lods: [lod(0), lod(1)], far: parts.far, atlas, rotor: parts.rotor ?? null, rotorAt: e.rotorAt ?? null });
      } catch (err) {
        console.warn('[fleet] could not load', e.id, err);
      }
    }));
  })();
  return loading;
}
/** a mesh's geometry with its node's transform (the quantisation's scale) baked in, its custom attributes renamed */
function bake(m: THREE.Mesh): THREE.BufferGeometry {
  const g = m.geometry.clone();
  const src = g.attributes.position, n = src.count, pos = new Float32Array(n * 3), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) v.fromBufferAttribute(src, i).applyMatrix4(m.matrixWorld).toArray(pos, i * 3);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  for (const [a, b] of [['_pbr', 'pbr'], ['_glow', 'glow'], ['_paint', 'paint']]) if (g.attributes[a]) { g.setAttribute(b, g.attributes[a]); g.deleteAttribute(a); }
  g.computeBoundingSphere();
  return g;
}

export function vehicleModel(id: string): VehicleModel | undefined {
  return MODELS.get(id);
}
export function allModels(): VehicleModel[] {
  return [...MODELS.values()];
}
/** the models of one kind (and car style), for picking one by a stable number */
export function modelsOf(kind: string, style?: string | null): VehicleModel[] {
  return [...MODELS.values()].filter((m) => m.kind === kind && (!style || m.style === style));
}
/** a stable pick: the same paint always gets the same model of its kind */
export function pickModel(kind: string, style: string | null, seed: number): VehicleModel | undefined {
  let list = modelsOf(kind, style);
  if (!list.length && style) list = modelsOf(kind);
  return list.length ? list[Math.abs(Math.floor(seed)) % list.length] : undefined;
}
export function seedOf(c: THREE.Color): number {
  return Math.floor(c.r * 977) * 31 + Math.floor(c.g * 613) * 17 + Math.floor(c.b * 389);
}

/* ---------- materials ---------- */
const KIT_V = /* glsl */ `attribute vec2 pbr;\nattribute float glow;\nvarying vec2 vPbr;\nvarying float vGlow;`;
const FAR_V = /* glsl */ `attribute float paint;\nattribute vec2 aLit;\nvarying vec2 vLit;`;
const KIT_F = /* glsl */ `varying vec2 vPbr;\nvarying float vGlow;\nuniform vec4 uLamp;\nuniform vec4 uLamp2;`;
/** the shared finish: atlas × vertex colour, per-vertex roughness and metalness, lamps that glow by channel
 *  (1 headlamps, 4 tail and brake lights, 5 and 6 the two halves of a light bar, 7 a roof sign or beacon). `far`:
 *  instanced, the instance colour tinting only the paint, and each instance's lamps lit or not */
function kitMaterial(map: THREE.Texture, lampU: { value: THREE.Vector4 }, lamp2U: { value: THREE.Vector4 }, far = false): THREE.MeshStandardMaterial {
  // (V2: double-sided, as every one of the downloaded models was made: drawn one-sided, a panel modelled as a single
  // sheet or wound inwards vanished seen from outside, and buses, vans, trucks and ambulances looked hollow, their
  // sides and wheels see-through)
  const m = surface(new THREE.MeshStandardMaterial({ vertexColors: true, map, roughness: 1, metalness: 1, alphaTest: 0.5, side: THREE.DoubleSide }), {
    snow: 0.5, wet: 0.35,
    vDecl: KIT_V + (far ? '\n' + FAR_V : '') + (far ? '' : ''),
    vDisplace: 'vPbr = pbr; vGlow = glow;' + (far ? `
      #ifdef USE_INSTANCING_COLOR
        vColor.rgb = color.rgb * mix(vec3(1.0), instanceColor.rgb, paint);
      #endif
      vLit = aLit;` : ''),
    fDecl: KIT_F + (far ? '\nvarying vec2 vLit;' : ''),
    uniforms: { uLamp: lampU, uLamp2: lamp2U },
    fEmissive: `{
      float ch = floor(vGlow + 0.5);
      vec4 L1 = uLamp, L2 = uLamp2;
      ${far ? 'L1 = vec4(vLit.x * 0.9, 0.0, 0.0, vLit.x * 2.2 + vLit.y * 6.0); L2 = vec4(vLit.y * 6.0, vLit.y * 6.0, vLit.x * 3.0, 0.0);' : ''}
      vec3 e = ch < 0.5 ? vec3(0.0)
        : ch < 1.5 ? vec3(1.0, 0.96, 0.86) * L1.x
        : ch < 4.5 && ch > 3.5 ? vec3(1.0, 0.1, 0.04) * L1.w
        : ch < 5.5 && ch > 4.5 ? diffuseColor.rgb * L2.x * 3.0
        : ch < 6.5 && ch > 5.5 ? diffuseColor.rgb * L2.y * 3.0
        : ch < 7.5 && ch > 6.5 ? diffuseColor.rgb * L2.z * 2.0
        : vec3(0.0);
      // (V2: at the night's exposure every lens, tail lamp and brake light burnt out into a blinding blot: headlamps
      // and beacons may glow a little past the bloom's threshold, tail lamps stay just under it, brake lights over)
      totalEmissiveRadiance += ch < 1.5 ? pvGlowCap(e, 1.5, 4.6) : ch < 4.5 ? pvGlowCap(e, 1.0, 6.0) : pvGlowCap(e, 2.0, 8.0);
    }`,
  }, far ? 'fleetFar' : 'fleet');
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    base.call(m, sh, r);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vPbr.x;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vPbr.y;');
  };
  return m;
}
let GLASS: THREE.MeshStandardMaterial | null = null;
/** tinted glass: see-through looking straight in, a mirror at a glancing angle */
function glassMaterial(): THREE.MeshStandardMaterial {
  GLASS ??= surface(new THREE.MeshStandardMaterial({ color: 0x0a0e12, roughness: 0.04, metalness: 0.25, transparent: true, opacity: 0.6, side: THREE.DoubleSide }), {
    snow: 0.4, wet: 0.1,
    fColor: 'diffuseColor.a = mix(0.32, 0.95, pow(1.0 - abs(dot(normalize(vWNrm), normalize(cameraPosition - vWPos))), 3.0));',
  }, 'fleetGlass');
  return GLASS;
}
/** a car's clear-coated body paint (the same program as the old cars' paint) */
export function paintMaterial(color: THREE.Color, metallic = true): THREE.MeshPhysicalMaterial {
  return surface(new THREE.MeshPhysicalMaterial({ color, metalness: metallic ? 0.6 : 0.05, roughness: metallic ? 0.32 : 0.4, clearcoat: 1, clearcoatRoughness: 0.035, side: THREE.DoubleSide }), { snow: 0.9, wet: 0.15 }, 'carPaint') as THREE.MeshPhysicalMaterial;
}

const _e = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3();
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);

/** a modelled car with the handles of gfx/car.ts's Car: drive it, light it, flash its light bar, repaint it */
export class ModelCar {
  root = new THREE.Group();
  body = new THREE.Group();
  paint: THREE.MeshPhysicalMaterial;
  dims: { L: number; WB: number; W: number; H: number; wheelR: number; clearance: number };
  headOn = false;
  braking = false;
  model: VehicleModel;
  private meshes: (THREE.Mesh | null)[];
  private wheelMesh: THREE.InstancedMesh | null = null;
  private lampU = { value: new THREE.Vector4() };
  private lamp2U = { value: new THREE.Vector4() };
  private glares: THREE.Sprite[] = [];
  private spin = 0;
  private steer = 0;
  private pitch = 0;
  private roll = 0;
  private bounce = 0;
  private bv = 0;
  private lod = 0;
  private rotor: THREE.Mesh | null = null;

  constructor(model: VehicleModel, color: THREE.Color, metallic = true) {
    this.model = model;
    const d = model.dims;
    this.dims = { L: d.L, WB: d.WB ?? d.L * 0.6, W: d.W, H: d.H, wheelR: model.wheelR, clearance: 0.15 };
    this.paint = paintMaterial(color, metallic);
    const l0 = model.lods[0], kit = kitMaterial(model.atlas, this.lampU, this.lamp2U);
    const mk = (g: THREE.BufferGeometry | null, mat: THREE.Material, shadow: boolean): THREE.Mesh | null => {
      if (!g) return null;
      const m = new THREE.Mesh(g, mat);
      m.castShadow = shadow;
      m.receiveShadow = true;
      this.body.add(m);
      return m;
    };
    this.meshes = [mk(l0.paint, this.paint, true), mk(l0.kit, kit, true), mk(l0.glass, glassMaterial(), false)];
    if (this.meshes[2]) this.meshes[2].renderOrder = 2;
    for (const [x, y, z] of model.headAt) {
      const sp = new THREE.Sprite(glare());
      sp.position.set(x, y, z);
      sp.visible = false;
      sp.renderOrder = 4;
      this.body.add(sp);
      this.glares.push(sp);
    }
    this.root.add(this.body);
    if (model.rotor && model.rotorAt) {
      this.rotor = new THREE.Mesh(model.rotor, kit);
      this.rotor.position.set(...model.rotorAt);
      this.rotor.castShadow = true;
      this.body.add(this.rotor);
    }
    if (l0.wheel && model.wheelsAt.length) {
      this.wheelMesh = new THREE.InstancedMesh(l0.wheel, kitMaterial(model.atlas, this.lampU, this.lamp2U), model.wheelsAt.length);
      this.wheelMesh.castShadow = this.wheelMesh.receiveShadow = true;
      this.wheelMesh.frustumCulled = false;
      this.root.add(this.wheelMesh);
      this.placeWheels();
    }
  }

  /** a helicopter's rotor turned to angle `a` (radians) */
  setRotor(a: number): void {
    if (this.rotor) this.rotor.rotation.y = a;
  }

  /** 0 near, 1 mid */
  setLod(k: number): void {
    k = Math.min(1, Math.max(0, k));
    if (k === this.lod) return;
    this.lod = k;
    const l = this.model.lods[k];
    const parts = [l.paint, l.kit, l.glass];
    this.meshes.forEach((m, i) => { if (m && parts[i]) m.geometry = parts[i]!; });
    if (this.wheelMesh && l.wheel) this.wheelMesh.geometry = l.wheel;
  }

  private placeWheels(): void {
    const w = this.wheelMesh!, at = this.model.wheelsAt, frontZ = at[0][2];
    at.forEach(([x, y, z], i) => {
      _p.set(x, y, z);
      // the left wheels face +x, the right ones are turned round (their spin then runs the other way)
      _qa.setFromAxisAngle(Y, (z > frontZ - 0.3 ? this.steer : 0) + (x < 0 ? Math.PI : 0));
      _qb.setFromAxisAngle(X, x < 0 ? -this.spin : this.spin);
      w.setMatrixAt(i, _m.compose(_p, _q.copy(_qa).multiply(_qb), _s));
    });
    w.instanceMatrix.needsUpdate = true;
  }

  /** pose for this frame; `accel` m/s² along travel, `turn` = yaw rate (rad/s) */
  drive(dt: number, x: number, z: number, yaw: number, speed: number, accel: number, turn: number, y = 0): void {
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
    this.spin += (speed * dt) / this.dims.wheelR;
    this.steer = steerAngle(turn, this.dims.WB, speed, 0.6);
    if (this.wheelMesh) this.placeWheels();
    const tp = THREE.MathUtils.clamp(-accel * 0.0065, -0.035, 0.035);
    const tr = THREE.MathUtils.clamp(-turn * speed * 0.0045, -0.04, 0.04);
    this.pitch += (tp - this.pitch) * Math.min(1, dt * 5);
    this.roll += (tr - this.roll) * Math.min(1, dt * 5);
    this.bv += (-this.bounce * 160 - this.bv * 12 + (Math.random() - 0.5) * speed * 6) * dt;
    this.bounce += this.bv * dt;
    this.body.rotation.set(this.pitch, 0, this.roll);
    this.body.position.y = this.bounce * 0.02;
    this.braking = isBraking(speed, accel);
  }
  /** the light bar flashing its halves in turn (a taxi's roof sign or a works van's beacon lit with it) */
  setSiren(on: boolean, t = 0): void {
    const ph = Math.floor(t * 6) % 2;
    this.lamp2U.value.x = on && ph ? 6 : 0;
    this.lamp2U.value.y = on && !ph ? 6 : 0;
  }
  setPaint(c: THREE.Color): void {
    if (this.model.tint) this.paint.color.copy(c);
  }

  /** as Car.lights: `night` 0..1 decides whether the headlights visibly light the road; a `parked` car is dark */
  lights(on: boolean, night: number, parked = false): void {
    this.headOn = on;
    const H = this.model.headAt;
    const eye = on ? this.body.worldToLocal(_e.copy(VIEW)) : _e.set(0, 0, 0);
    const face = H.map(([x, , z]) => (on ? Math.max(0, (eye.z - z) / (Math.hypot(eye.x - x, eye.z - z) || 1)) : 0));
    const ahead = face.length ? face.reduce((s, f) => s + f ** 4, 0) / face.length : 0;
    this.lampU.value.set(on ? 1.2 * (0.4 + 0.6 * ahead) : 0, 0, 0, parked ? 0 : (on ? 2.2 : 0) + (this.braking ? 8 : 0));
    // a taxi's sign is lit while it works
    this.lamp2U.value.z = parked ? 0 : 1.2;
    if (on && night > 0.12 && this.model.beamAt) addBeam(this.body, ...this.model.beamAt);
    const show = on && night > 0.15;
    this.glares.forEach((g, i) => {
      g.visible = show && face[i] > 0.02;
      if (!g.visible) return;
      const [x, y, z] = H[i];
      const dx = eye.x - x, dy = eye.y - y, dz = eye.z - z, d = Math.hypot(dx, dy, dz) || 1, pull = Math.min(0.6, d * 0.5) / d;
      g.position.set(x + dx * pull, y + dy * pull, z + dz * pull);
      g.scale.setScalar((0.08 + 0.6 * face[i] ** 6) * (1 - pull));
    });
  }
}

/* ---------- far traffic: each model's distant vehicles in one instanced draw ---------- */
const ZERO4 = { value: new THREE.Vector4() };
export class FarFleet {
  private pools = new Map<string, { mesh: THREE.InstancedMesh; lit: THREE.InstancedBufferAttribute; n: number; rotor: THREE.InstancedMesh | null }>();
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private eu = new THREE.Euler();
  private sc = new THREE.Vector3();
  private ps = new THREE.Vector3();
  private r4 = new THREE.Matrix4();
  private rq = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);
  constructor(private group: THREE.Object3D, private caps: (m: VehicleModel) => number) {}
  private pool(m: VehicleModel): { mesh: THREE.InstancedMesh; lit: THREE.InstancedBufferAttribute; n: number; rotor: THREE.InstancedMesh | null } {
    let p = this.pools.get(m.id);
    if (!p) {
      const cap = this.caps(m);
      const g = m.far.clone();
      const lit = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
      lit.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('aLit', lit);
      const mesh = new THREE.InstancedMesh(g, kitMaterial(m.atlas, ZERO4, ZERO4, true), cap);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
      let rotor: THREE.InstancedMesh | null = null;
      if (m.rotor && m.rotorAt) {
        const rg = m.rotor.clone();
        rg.setAttribute('aLit', new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2));
        rg.setAttribute('paint', new THREE.BufferAttribute(new Float32Array(rg.attributes.position.count), 1));
        rotor = new THREE.InstancedMesh(rg, mesh.material as THREE.Material, cap);
        rotor.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
        rotor.count = 0;
        rotor.frustumCulled = false;
        rotor.castShadow = true;
        this.group.add(rotor);
      }
      p = { mesh, lit, n: 0, rotor };
      this.pools.set(m.id, p);
    }
    return p;
  }
  begin(): void {
    for (const p of this.pools.values()) p.n = 0;
  }
  /** one distant vehicle; `lamps` 1 lit, 0 dark; `flash` its light bar (0 off) */
  add(m: VehicleModel, x: number, y: number, z: number, yaw: number, paint: THREE.Color | null, lamps: number, flash = 0, pitch = 0, roll = 0, scale = 1, rotor = 0): void {
    const p = this.pool(m);
    if (p.n >= p.mesh.instanceMatrix.count) return;
    this.q.setFromEuler(this.eu.set(pitch, yaw, roll, 'YXZ'));
    p.mesh.setMatrixAt(p.n, this.m4.compose(this.ps.set(x, y, z), this.q, this.sc.setScalar(scale)));
    if (paint && m.tint) p.mesh.instanceColor!.setXYZ(p.n, paint.r, paint.g, paint.b);
    else p.mesh.instanceColor!.setXYZ(p.n, 1, 1, 1);
    p.lit.setXY(p.n, lamps, flash);
    if (p.rotor && m.rotorAt) {
      // the rotor on its hub: the body's pose, then the hub's offset, then the spin
      this.r4.compose(this.ps.set(...m.rotorAt).multiplyScalar(scale), this.rq.setFromAxisAngle(this.up, rotor), this.sc);
      p.rotor.setMatrixAt(p.n, this.m4.clone().multiply(this.r4));
    }
    p.n++;
  }
  end(): void {
    for (const p of this.pools.values()) {
      p.mesh.count = p.n;
      p.mesh.visible = p.n > 0;
      if (p.n) { p.mesh.instanceMatrix.needsUpdate = true; p.mesh.instanceColor!.needsUpdate = true; p.lit.needsUpdate = true; }
      if (p.rotor) { p.rotor.count = p.n; p.rotor.visible = p.n > 0; if (p.n) p.rotor.instanceMatrix.needsUpdate = true; }
    }
  }
}

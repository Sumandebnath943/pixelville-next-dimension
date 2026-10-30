/* ============================================================
   People models: villagers built from Microsoft Rocketbox
   avatars (MIT; see public/models/people/LICENSE-Rocketbox.md)
   by scripts/people/build.mjs. Each file holds one character in
   three levels of detail, skinned to the same 20 joints as the
   code-built body in person.ts, so the same gait and poses
   drive them. One texture set per character: colour (+ alpha
   for hair), normal (+ roughness in its alpha) and an outfit
   mask (top, legs, shoes), so a whole person is one draw call
   and anyone's clothes can be recoloured: the villagers vary,
   uniforms keep their colours, the Founder dresses as they like.
   Far off, a crowd is each character's lightest model, instanced
   at rest, tinted the same way.
   ============================================================ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { surface } from './surface';
import { BONES, type BoneName, type Rig } from './person';

type RGB = [number, number, number];
export interface CastEntry { id: string; file: string; female: boolean; child: boolean; job: string | null; height: number; hipsY: number; tris: number[]; bytes: number; means?: { top?: RGB; legs?: RGB; shoes?: RGB } }
/** recoloured clothes (any left out keep the character's own) */
export interface Outfit { top?: THREE.Color | null; legs?: THREE.Color | null; shoes?: THREE.Color | null }

const BASE = `${import.meta.env.BASE_URL}models/people/`;
let index: Promise<CastEntry[]> | null = null;
const rigs = new Map<string, Promise<Rig>>();
const loaded = new Map<string, Rig>();
let loader: GLTFLoader | null = null;

/** the cast list (what's been built) */
export function castIndex(): Promise<CastEntry[]> {
  index ??= fetch(BASE + 'index.json').then((r) => r.json()).then((j) => j.cast as CastEntry[]).catch(() => []);
  return index;
}

/* ---------- materials ---------- */
const OUTFIT_F = /* glsl */ `
  #ifdef PV_CROWD
  varying vec3 vTop; varying vec3 vLegs;
  #else
  uniform vec3 uTop; uniform vec3 uLegs; uniform vec3 uShoes;
  #endif
  uniform sampler2D uOutfit;`;
const OUTFIT_C = /* glsl */ `{
  vec3 om = texture2D(uOutfit, vMapUv).rgb;
  #ifdef PV_CROWD
  diffuseColor.rgb *= mix(vec3(1.0), vTop, om.r) * mix(vec3(1.0), vLegs, om.g);
  #else
  diffuseColor.rgb *= mix(vec3(1.0), uTop, om.r) * mix(vec3(1.0), uLegs, om.g) * mix(vec3(1.0), uShoes, om.b);
  #endif
}`;
interface Tex { map: THREE.Texture; normalMap: THREE.Texture; outfit: THREE.Texture | null }
/** the skin, cloth and hair material: the surface patch (rain darkens, snow settles on the shoulders), roughness read
 *  from the normal map's alpha, the outfit mask's regions multiplied by how far each tint is from the clothes' own
 *  colour (`crowd`: per instance, from instanced attributes) */
function bodyMaterial(t: Tex, u: Record<string, THREE.IUniform>, crowd = false): THREE.MeshStandardMaterial {
  const m = surface(new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughness: 1, metalness: 0, alphaTest: 0.5 }), {
    snow: 0.35, wet: 0.55,
    vDecl: crowd ? 'attribute vec3 aTop; attribute vec3 aLegs; varying vec3 vTop; varying vec3 vLegs;' : '',
    vDisplace: crowd ? 'vTop = aTop; vLegs = aLegs;' : '',
    fDecl: (crowd ? '#define PV_CROWD\n' : '') + OUTFIT_F,
    fColor: OUTFIT_C,
    uniforms: { uOutfit: { value: t.outfit ?? WHITE }, ...u },
  }, crowd ? 'rbxCrowd' : 'rbx');
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    base.call(m, sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= texture2D(normalMap, vNormalMapUv).a;');
  };
  return m;
}
/** (no outfit mask: nothing recolours) */
const WHITE = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
WHITE.needsUpdate = true;

const RIG_TEX = new WeakMap<Rig, Tex>();
const MEANS = new WeakMap<Rig, { top: THREE.Color; legs: THREE.Color; shoes: THREE.Color }>();
/** how a tint multiplies a region: the tint over the clothes' own mean colour (kept within reason) */
function ratio(tint: THREE.Color | null | undefined, mean: THREE.Color, out = new THREE.Vector3()): THREE.Vector3 {
  if (!tint) return out.set(1, 1, 1);
  const f = (c: number, m: number): number => Math.min(6, Math.max(0.05, c / Math.max(0.02, m)));
  return out.set(f(tint.r, mean.r), f(tint.g, mean.g), f(tint.b, mean.b));
}
/** a material for one person in their outfit (shares its program with every other) */
export function outfitMaterial(rig: Rig, outfit: Outfit | null): { material: THREE.MeshStandardMaterial; set: (o: Outfit | null) => void } {
  const t = RIG_TEX.get(rig)!, mean = MEANS.get(rig)!;
  const u = { uTop: { value: new THREE.Vector3(1, 1, 1) }, uLegs: { value: new THREE.Vector3(1, 1, 1) }, uShoes: { value: new THREE.Vector3(1, 1, 1) } };
  const set = (o: Outfit | null): void => {
    ratio(o?.top, mean.top, u.uTop.value);
    ratio(o?.legs, mean.legs, u.uLegs.value);
    ratio(o?.shoes, mean.shoes, u.uShoes.value);
  };
  set(outfit);
  return { material: bodyMaterial(t, u), set };
}

/** one character, ready for `new Person(look, rig)` */
export function loadRig(id: string): Promise<Rig> {
  let p = rigs.get(id);
  if (p) return p;
  p = (async () => {
    const entry = (await castIndex()).find((c) => c.id === id);
    if (!entry) throw new Error(`no such villager model: ${id}`);
    if (!loader) {
      loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
    }
    const gltf = await loader.loadAsync(BASE + entry.file);
    gltf.scene.updateMatrixWorld(true);
    const joints = {} as Record<BoneName, THREE.Vector3>;
    const lods: THREE.BufferGeometry[] = [];
    let mat: THREE.MeshStandardMaterial | null = null;
    gltf.scene.traverse((o) => {
      if ((BONES as string[]).includes(o.name) && (o as THREE.Bone).isBone) joints[o.name as BoneName] = o.getWorldPosition(new THREE.Vector3());
      const m = o as THREE.SkinnedMesh;
      const k = /^lod(\d)$/.exec(o.name)?.[1] ?? /^lod(\d)$/.exec(o.parent?.name ?? '')?.[1];
      if (!m.isSkinnedMesh || k === undefined) return;
      // positions come quantised, scaled back through the skin (bind matrix and the joints' inverse binds): bake that
      // in, as plain floats, so the body stands where its joints are
      const g = m.geometry.clone();
      const sk = m.skeleton;
      const T = new THREE.Matrix4().multiplyMatrices(sk.bones[0].matrixWorld, sk.boneInverses[0]).multiply(m.bindMatrix);
      const nT = new THREE.Matrix3().getNormalMatrix(T);
      const src = g.attributes.position, srcN = g.attributes.normal;
      const pos = new Float32Array(src.count * 3), nor = new Float32Array(src.count * 3);
      const v = new THREE.Vector3();
      for (let i = 0; i < src.count; i++) {
        v.fromBufferAttribute(src, i).applyMatrix4(T).toArray(pos, i * 3);
        v.fromBufferAttribute(srcN, i).applyMatrix3(nT).normalize().toArray(nor, i * 3);
      }
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.computeBoundingSphere();
      lods[+k] = g;
      mat ??= m.material as THREE.MeshStandardMaterial;
    });
    const m0 = mat as THREE.MeshStandardMaterial | null;
    if (!m0?.map || !m0.normalMap || lods.length < 3) throw new Error(`villager model ${id} is incomplete`);
    // (the outfit mask travels in the occlusion slot)
    const tex: Tex = { map: m0.map, normalMap: m0.normalMap, outfit: m0.aoMap ?? null };
    const c = (a?: RGB): THREE.Color => (a ? new THREE.Color(a[0], a[1], a[2]) : new THREE.Color(0.5, 0.5, 0.5));
    const rig: Rig = { id, lods, joints, material: null as unknown as THREE.Material, height: entry.height, female: entry.female, child: entry.child, job: entry.job };
    RIG_TEX.set(rig, tex);
    MEANS.set(rig, { top: c(entry.means?.top), legs: c(entry.means?.legs), shoes: c(entry.means?.shoes) });
    const one = { uTop: { value: new THREE.Vector3(1, 1, 1) }, uLegs: { value: new THREE.Vector3(1, 1, 1) }, uShoes: { value: new THREE.Vector3(1, 1, 1) } };
    rig.material = bodyMaterial(tex, one);
    loaded.set(id, rig);
    return rig;
  })();
  rigs.set(id, p);
  return p;
}

/** every built character (any that fail are left out) */
export async function loadCast(): Promise<Rig[]> {
  const cast = await castIndex();
  const out = await Promise.all(cast.map((c) => loadRig(c.id).catch((e) => { console.warn('[people]', c.id, e); return null; })));
  return out.filter((r): r is Rig => !!r);
}
export function castLoaded(): Rig[] {
  return [...loaded.values()];
}

/* ---------- who wears which character ---------- */
/** the Founder's own character, which no villager wears */
let founderRig: string | null = null;
export function setFounderRig(id: string | null): void {
  founderRig = id;
  wearable = null;
}
/** (everyone else's characters, kept between frames: rigFor runs for every villager drawn) */
let wearable: Rig[] | null = null;
let wearableOf = 0;
/** the everyday grown-ups, women or men, the Founder can be */
export function figures(female: boolean): Rig[] {
  return castLoaded().filter((r) => !r.child && !r.job && r.female === female).sort((a, b) => a.id.localeCompare(b.id));
}
/** a villager's character: their job's uniform if they wear one, else an everyday one of their sex and age, the same
 *  one every time for the same seed */
export function rigFor(seed: number, kind: string, job?: string | null): Rig | undefined {
  if (!wearable || wearableOf !== loaded.size) { wearable = castLoaded().filter((r) => r.id !== founderRig); wearableOf = loaded.size; }
  const all = wearable;
  if (!all.length) return undefined;
  let list = job ? all.filter((r) => r.job === job) : [];
  if (!list.length) {
    list = kind === 'kid' ? all.filter((r) => r.child) : all.filter((r) => !r.child && !r.job && r.female === (kind === 'woman'));
    if (kind === 'kid' && list.length) {
      // (girls and boys alike: half and half by seed)
      const g = list.filter((r) => r.female === (seed % 2 === 0));
      if (g.length) list = g;
    }
  }
  if (!list.length) list = all.filter((r) => !r.child && !r.job);
  return list.length ? list[(Math.abs(seed) >>> 3) % list.length] : undefined;
}
const TOPS = ['#2c3e5a', '#7a2a2a', '#e8e4da', '#3c5a3a', '#5a4a6a', '#c8a24a', '#1e1e22', '#8aa0b8', '#b85a3a', '#4a6a8a', '#d8c8b0', '#6a2a4a', '#2a6a6a', '#a8a8a0'].map((h) => new THREE.Color(h));
const LEGS = ['#1e2a40', '#2a2a2e', '#4a3e34', '#6a6a70', '#20304a', '#7a6a50', '#3a3a30'].map((h) => new THREE.Color(h));
/** an everyday villager's own colours (uniforms keep theirs): some keep the clothes they came in, most change one or two */
export function outfitFor(seed: number, rig: Rig, shirt?: THREE.Color | null, pants?: THREE.Color | null): Outfit | null {
  if (shirt || pants) return { top: shirt ?? null, legs: pants ?? null };
  if (rig.job) return null;
  const h = (Math.imul(seed >>> 0, 2654435761) >>> 0) / 4294967296;
  if (h < 0.3) return null;
  return { top: h < 0.85 ? TOPS[Math.floor(h * 977) % TOPS.length] : null, legs: h > 0.6 ? LEGS[Math.floor(h * 613) % LEGS.length] : null };
}

/* ---------- far crowds: each character's lightest model, instanced at rest ---------- */
export class Crowd {
  private pools = new Map<Rig, { mesh: THREE.InstancedMesh; top: THREE.InstancedBufferAttribute; legs: THREE.InstancedBufferAttribute; n: number }>();
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private r = new THREE.Vector3();
  constructor(private group: THREE.Object3D, private cap = 140) {}
  private pool(rig: Rig): { mesh: THREE.InstancedMesh; top: THREE.InstancedBufferAttribute; legs: THREE.InstancedBufferAttribute; n: number } {
    let p = this.pools.get(rig);
    if (!p) {
      const g = rig.lods[2].clone();
      const top = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3).fill(1), 3), legs = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3).fill(1), 3);
      top.setUsage(THREE.DynamicDrawUsage); legs.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('aTop', top);
      g.setAttribute('aLegs', legs);
      const mesh = new THREE.InstancedMesh(g, bodyMaterial(RIG_TEX.get(rig)!, {}, true), this.cap);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      p = { mesh, top, legs, n: 0 };
      this.pools.set(rig, p);
    }
    return p;
  }
  begin(): void {
    for (const p of this.pools.values()) p.n = 0;
  }
  /** a far figure: standing (or, `pitch` −π/2, lying), its outfit's tints */
  add(rig: Rig, x: number, y: number, z: number, yaw: number, scale: number, outfit: Outfit | null, pitch = 0): void {
    const p = this.pool(rig);
    if (p.n >= this.cap) return;
    this.q.setFromEuler(this.e.set(pitch, yaw, 0, 'YXZ'));
    p.mesh.setMatrixAt(p.n, this.m4.compose(this.p.set(x, y, z), this.q, this.s.setScalar(scale)));
    const mean = MEANS.get(rig)!;
    ratio(outfit?.top, mean.top, this.r); p.top.setXYZ(p.n, this.r.x, this.r.y, this.r.z);
    ratio(outfit?.legs, mean.legs, this.r); p.legs.setXYZ(p.n, this.r.x, this.r.y, this.r.z);
    p.n++;
  }
  end(): void {
    for (const p of this.pools.values()) {
      p.mesh.count = p.n;
      p.mesh.visible = p.n > 0;
      if (p.n) { p.mesh.instanceMatrix.needsUpdate = true; p.top.needsUpdate = true; p.legs.needsUpdate = true; }
    }
  }
}

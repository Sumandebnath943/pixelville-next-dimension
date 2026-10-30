/* ============================================================
   Animals (Milestone 9): the village's dogs, cats, birds, farm
   and zoo animals, from downloaded models (each credited in
   public/models/CREDITS.md) that scripts/animals/build.mjs has
   refitted onto two skeletons of the game's own: four legs
   (pelvis, spine, chest, neck, head, a three-joint tail, each
   leg upper/lower/paw) and wings (body, neck, head, each wing in
   two, tail, legs). So one set of gaits drives every species,
   tuned by its build: the walk is a four-beat walk, the trot is
   on diagonal pairs, a hare bounds, grazers drop their heads,
   tails wag (dogs), swish (cattle and horses) or sway (cats);
   pigeons bob their heads as they step and peck, ducks ride the
   water, penguins waddle, butterflies flap. Three levels of
   detail each, one draw call; far off, a herd is each animal's
   lightest model, instanced at rest.
   ============================================================ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { surface } from './surface';

export interface ZooEntry { id: string; body: 'quad' | 'bird'; species: string; height: number; length: number; wings: boolean; tris: number[]; file: string; bytes: number }
/** one built animal: its levels of detail (posed at rest, the joints at their world places) and material */
export interface Beast { id: string; entry: ZooEntry; lods: THREE.BufferGeometry[]; joints: Record<string, THREE.Vector3>; material: THREE.MeshStandardMaterial }

const QUAD = ['root', 'pelvis', 'spine', 'chest', 'neck', 'head', 'tail0', 'tail1', 'tail2', 'fuL', 'flL', 'fpL', 'fuR', 'flR', 'fpR', 'huL', 'hlL', 'hpL', 'huR', 'hlR', 'hpR'];
const QUAD_PARENT: Record<string, string | null> = {
  root: null, pelvis: 'root', spine: 'pelvis', chest: 'spine', neck: 'chest', head: 'neck', tail0: 'pelvis', tail1: 'tail0', tail2: 'tail1',
  fuL: 'chest', flL: 'fuL', fpL: 'flL', fuR: 'chest', flR: 'fuR', fpR: 'flR', huL: 'pelvis', hlL: 'huL', hpL: 'hlL', huR: 'pelvis', hlR: 'huR', hpR: 'hlR',
};
const BIRD = ['root', 'body', 'neck', 'head', 'wingL', 'tipL', 'wingR', 'tipR', 'tail', 'legL', 'legR'];
const BIRD_PARENT: Record<string, string | null> = { root: null, body: 'root', neck: 'body', head: 'neck', wingL: 'body', tipL: 'wingL', wingR: 'body', tipR: 'wingR', tail: 'body', legL: 'body', legR: 'body' };

const BASE = `${import.meta.env.BASE_URL}models/animals/`;
let index: Promise<ZooEntry[]> | null = null;
const beasts = new Map<string, Promise<Beast>>();
const loaded = new Map<string, Beast>();
let loader: GLTFLoader | null = null;

export function zooIndex(): Promise<ZooEntry[]> {
  index ??= fetch(BASE + 'index.json').then((r) => r.json()).then((j) => j.zoo as ZooEntry[]).catch(() => []);
  return index;
}

/** the coat: its texture times its vertex colour (untextured parts carry their colour there); rain darkens it and snow
 *  settles on the back */
function coatMaterial(map: THREE.Texture | null, doubleSided: boolean): THREE.MeshStandardMaterial {
  return surface(new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.85, metalness: 0, alphaTest: 0.5, side: doubleSided ? THREE.DoubleSide : THREE.FrontSide }), { snow: 0.5, wet: 0.6 }, 'beast');
}

export function loadBeast(id: string): Promise<Beast> {
  let p = beasts.get(id);
  if (p) return p;
  p = (async () => {
    const entry = (await zooIndex()).find((z) => z.id === id);
    if (!entry) throw new Error(`no such animal model: ${id}`);
    if (!loader) {
      loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
    }
    const gltf = await loader.loadAsync(BASE + entry.file);
    gltf.scene.updateMatrixWorld(true);
    const names = entry.body === 'bird' ? BIRD : QUAD;
    const joints: Record<string, THREE.Vector3> = {};
    const lods: THREE.BufferGeometry[] = [];
    let src: THREE.MeshStandardMaterial | null = null;
    gltf.scene.traverse((o) => {
      if (names.includes(o.name) && (o as THREE.Bone).isBone) joints[o.name] = o.getWorldPosition(new THREE.Vector3());
      const m = o as THREE.SkinnedMesh;
      const k = /^lod(\d)$/.exec(o.name)?.[1] ?? /^lod(\d)$/.exec(o.parent?.name ?? '')?.[1];
      if (!m.isSkinnedMesh || k === undefined) return;
      // (as with the villagers: quantised positions come back through the skin; baked here into plain floats)
      const g = m.geometry.clone();
      const sk = m.skeleton;
      const T = new THREE.Matrix4().multiplyMatrices(sk.bones[0].matrixWorld, sk.boneInverses[0]).multiply(m.bindMatrix);
      const nT = new THREE.Matrix3().getNormalMatrix(T);
      const ps = g.attributes.position, ns = g.attributes.normal;
      const pos = new Float32Array(ps.count * 3), nor = new Float32Array(ps.count * 3);
      const v = new THREE.Vector3();
      for (let i = 0; i < ps.count; i++) {
        v.fromBufferAttribute(ps, i).applyMatrix4(T).toArray(pos, i * 3);
        v.fromBufferAttribute(ns, i).applyMatrix3(nT).normalize().toArray(nor, i * 3);
      }
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.computeBoundingSphere();
      lods[+k] = g;
      src ??= m.material as THREE.MeshStandardMaterial;
    });
    if (lods.length < 3 || names.some((n) => !joints[n])) throw new Error(`animal model ${id} is incomplete`);
    const s0 = src as THREE.MeshStandardMaterial | null;
    const beast: Beast = { id, entry, lods, joints, material: coatMaterial(s0?.map ?? null, s0?.side === THREE.DoubleSide) };
    loaded.set(id, beast);
    return beast;
  })();
  beasts.set(id, p);
  return p;
}
/** every built animal (any that fail are left out) */
export async function loadZoo(): Promise<Beast[]> {
  const zoo = await zooIndex();
  const out = await Promise.all(zoo.map((z) => loadBeast(z.id).catch((e) => { console.warn('[animals]', z.id, e); return null; })));
  return out.filter((b): b is Beast => !!b);
}
export function beast(id: string): Beast | undefined {
  return loaded.get(id);
}
export function zooLoaded(): Beast[] {
  return [...loaded.values()];
}
/** the village's dogs: one of the breeds, the same one every time for the same seed (a walker, a household) */
export const DOGS = ['labrador', 'retriever', 'chihuahua', 'bulldog'];
export function dogBreed(seed: number): string {
  return DOGS[(Math.imul(seed >>> 0, 2654435761) >>> 28) % DOGS.length];
}

/* ---------- how each kind moves ---------- */
interface Gait {
  /** stride per cycle (in shoulder heights), walking and trotting, and the speed (m/s) a walk breaks into a trot */
  walk: number; trot: number; trotAt: number;
  /** leg swing (radians) walking and trotting */
  amp: number; ampT: number;
  tail: 'wag' | 'swish' | 'sway' | 'still';
  /** the head's nod each step (horses and cattle nod deeply), and how low a grazer reaches */
  nod: number; graze: number;
  hop?: boolean;
}
const GAITS: Record<string, Gait> = {
  dog: { walk: 1.7, trot: 2.5, trotAt: 1.2, amp: 0.42, ampT: 0.55, tail: 'wag', nod: 0.04, graze: 0.6 },
  cat: { walk: 1.5, trot: 2.4, trotAt: 1.1, amp: 0.36, ampT: 0.5, tail: 'sway', nod: 0.02, graze: 0.5 },
  cow: { walk: 1.25, trot: 2, trotAt: 1.8, amp: 0.3, ampT: 0.42, tail: 'swish', nod: 0.08, graze: 1.0 },
  sheep: { walk: 1.4, trot: 2.2, trotAt: 1.4, amp: 0.34, ampT: 0.48, tail: 'still', nod: 0.05, graze: 0.95 },
  horse: { walk: 1.5, trot: 2.4, trotAt: 2.0, amp: 0.32, ampT: 0.46, tail: 'swish', nod: 0.1, graze: 1.05 },
  deer: { walk: 1.6, trot: 2.6, trotAt: 1.6, amp: 0.36, ampT: 0.52, tail: 'still', nod: 0.05, graze: 0.95 },
  elephant: { walk: 1.1, trot: 1.6, trotAt: 3, amp: 0.22, ampT: 0.3, tail: 'swish', nod: 0.04, graze: 0.3 },
  hare: { walk: 1.4, trot: 3.2, trotAt: 0.9, amp: 0.4, ampT: 0.6, tail: 'still', nod: 0.03, graze: 0.5, hop: true },
};

export type BeastPose = 'walk' | 'trot' | 'idle' | 'sit' | 'graze' | 'lie' | 'peck' | 'fly' | 'swim';

/** one animal: its own skeleton (bones keep the world's axes, as a villager's do) on a shared model */
export class Animal {
  root = new THREE.Group();
  mesh: THREE.SkinnedMesh;
  bones: Record<string, THREE.Bone> = {};
  readonly beast: Beast;
  private rest: Record<string, THREE.Vector3> = {};
  private phase = Math.random();
  private t = Math.random() * 10;
  private lod = 0;
  private look = 0;
  private lookT = 0;
  private lookTo = 0;
  /** the shoulder height (the gait's measure) */
  private leg: number;
  constructor(b: Beast) {
    this.beast = b;
    const bird = b.entry.body === 'bird', names = bird ? BIRD : QUAD, parent = bird ? BIRD_PARENT : QUAD_PARENT;
    for (const n of names) {
      const bone = new THREE.Bone();
      bone.name = n;
      const p = parent[n];
      bone.position.copy(p ? b.joints[n].clone().sub(b.joints[p]) : b.joints[n]);
      this.rest[n] = bone.position.clone();
      this.bones[n] = bone;
      if (p) this.bones[p].add(bone);
    }
    this.mesh = new THREE.SkinnedMesh(b.lods[0], b.material);
    this.mesh.add(this.bones.root);
    this.mesh.bind(new THREE.Skeleton(names.map((n) => this.bones[n])));
    this.mesh.castShadow = b.entry.height > 0.15;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
    this.leg = bird ? b.entry.height : Math.max(0.1, (b.joints.fuL.y + b.joints.huL.y) / 2);
  }
  /** 0 nearest … 2 farthest */
  setLod(k: number): void {
    if (k === this.lod) return;
    this.lod = k;
    this.mesh.geometry = this.beast.lods[Math.min(k, this.beast.lods.length - 1)];
  }
  /** `speed`: metres a second along its heading */
  animate(dt: number, pose: BeastPose, speed = 0): void {
    this.t += dt;
    for (const [n, b] of Object.entries(this.bones)) { b.rotation.set(0, 0, 0); b.position.copy(this.rest[n]); }
    if (this.beast.entry.body === 'bird') this.bird(dt, pose, speed);
    else this.quad(dt, pose, speed);
  }

  private quad(dt: number, pose: BeastPose, speed: number): void {
    const B = this.bones, h = this.leg, sp = this.beast.entry.species;
    const G = GAITS[sp] ?? GAITS.dog;
    if (pose === 'walk' && speed > G.trotAt) pose = 'trot';
    const trot = pose === 'trot', moving = pose === 'walk' || trot;
    if (moving) this.phase += (speed / (h * (trot ? G.trot : G.walk))) * dt;
    const p = this.phase * Math.PI * 2;
    if (moving) {
      // footfall order: walk LH, LF, RH, RF a quarter apart; trot on diagonal pairs; a hare's bound: hind together, then front
      const off: Record<string, number> = G.hop && trot ? { huL: 0, huR: 0.04, fuL: 0.5, fuR: 0.54 } : trot ? { huL: 0, fuR: 0, huR: 0.5, fuL: 0.5 } : { huL: 0, fuL: 0.25, huR: 0.5, fuR: 0.75 };
      const amp = trot ? G.ampT : G.amp;
      for (const [u, l, pw] of [['fuL', 'flL', 'fpL'], ['fuR', 'flR', 'fpR'], ['huL', 'hlL', 'hpL'], ['huR', 'hlR', 'hpR']]) {
        const q = p + off[u] * Math.PI * 2, swing = Math.max(0, Math.sin(q));
        const front = u[0] === 'f';
        B[u].rotation.x = -Math.cos(q) * amp;
        // the lower leg folds as the foot comes forward: back at the wrist in front, forward at the hock behind
        B[l].rotation.x = front ? swing * 0.9 : -swing * 0.7;
        B[pw].rotation.x = front ? -swing * 0.6 : swing * 0.5;
      }
      B.pelvis.position.y += Math.cos(p * 2) * 0.012 * h * (G.hop && trot ? 6 : 1);
      if (G.hop && trot) B.pelvis.rotation.x = Math.sin(p) * 0.12;
      B.pelvis.rotation.z = Math.sin(p) * 0.035;
      B.chest.rotation.z = -Math.sin(p) * 0.045;
      // (a horse or a cow nods with each stride of the forelegs)
      B.neck.rotation.x = (trot ? 0.1 : 0.04) + Math.cos(p * 2) * G.nod;
      B.head.rotation.x = -Math.cos(p * 2) * G.nod * 0.5;
    } else if (pose === 'graze') {
      // head down in the grass, a slow step now and then, the jaw working
      B.neck.rotation.x = G.graze * 0.75;
      B.head.rotation.x = G.graze * 0.35 + Math.sin(this.t * 6) * 0.03;
      B.fuL.rotation.x = 0.06; B.fuR.rotation.x = -0.04;
      B.chest.rotation.x = 0.05;
    } else if (pose === 'sit') {
      const lift = this.rest.pelvis.y;
      B.pelvis.position.y = lift * 0.55;
      B.pelvis.rotation.x = -0.75;
      B.spine.rotation.x = 0.2; B.chest.rotation.x = 0.3; B.neck.rotation.x = -0.25;
      for (const s of ['L', 'R']) {
        B[`fu${s}`].rotation.x = 0.55; B[`fl${s}`].rotation.x = -0.1;
        B[`hu${s}`].rotation.x = -1.2; B[`hl${s}`].rotation.x = 2.2; B[`hp${s}`].rotation.x = -1.0;
      }
    } else if (pose === 'lie') {
      // folded down on its legs, chin up
      const lift = this.rest.pelvis.y;
      B.pelvis.position.y = lift * 0.38;
      for (const s of ['L', 'R']) {
        B[`fu${s}`].rotation.x = -1.3; B[`fl${s}`].rotation.x = 2.4; B[`fp${s}`].rotation.x = -0.6;
        B[`hu${s}`].rotation.x = 1.2; B[`hl${s}`].rotation.x = -2.3; B[`hp${s}`].rotation.x = 0.9;
      }
      B.neck.rotation.x = -0.15;
    } else {
      // standing: breathing, the odd weight shift
      B.chest.rotation.x = Math.sin(this.t * 3.2) * 0.012;
      B.pelvis.rotation.z = Math.sin(this.t * 0.4) * 0.02;
    }
    // the tail: a dog's wag, the swish of a cow's or a horse's against flies, a cat's slow sway
    const tw = G.tail === 'wag' ? Math.sin(this.t * (moving ? 7 : 9)) * (moving ? 0.35 : 0.5)
      : G.tail === 'swish' ? Math.sin(this.t * 1.7) * Math.max(0, Math.sin(this.t * 0.31)) * 0.5
      : G.tail === 'sway' ? Math.sin(this.t * 1.1) * 0.25 : 0;
    B.tail0.rotation.y = tw * 0.5; B.tail1.rotation.y = tw * 0.7; B.tail2.rotation.y = tw;
    // a look about now and then (not while grazing)
    this.lookT -= dt;
    if (this.lookT <= 0) { this.lookTo = Math.random() < 0.6 ? 0 : (Math.random() - 0.5) * 1.3; this.lookT = 1.5 + Math.random() * 3.5; }
    this.look += ((pose === 'graze' ? 0 : this.lookTo) - this.look) * Math.min(1, dt * 3);
    B.neck.rotation.y = this.look * 0.5;
    B.head.rotation.y = this.look * 0.5;
  }

  private bird(dt: number, pose: BeastPose, speed: number): void {
    const B = this.bones, sp = this.beast.entry.species, L = this.beast.entry.length;
    if (sp === 'butterfly') {
      // a butterfly's wings clap up and fall open, fast, with a glide now and then
      const glide = Math.sin(this.t * 0.9) > 0.85;
      const f = this.t * (pose === 'idle' ? 3 : 24);
      const a = glide ? 0.15 : pose === 'idle' ? 0.6 + Math.sin(f) * 0.25 : Math.sin(f) * 0.9 + 0.2;
      B.wingL.rotation.z = a; B.wingR.rotation.z = -a;
      B.body.rotation.x = -0.15;
      return;
    }
    if (pose === 'fly' && this.beast.entry.wings) {
      // wingbeat: a full downstroke, the tips trailing on the way up; legs tucked, body level
      const f = this.t * 9, beat = Math.sin(f);
      for (const [s, sx] of [['L', 1], ['R', -1]] as [string, number][]) {
        B[`wing${s}`].rotation.z = sx * (beat * 0.85 + 0.15);
        B[`tip${s}`].rotation.z = sx * Math.sin(f - 0.9) * 0.5;
      }
      B.legL.rotation.x = B.legR.rotation.x = -1.2;
      return;
    }
    if (sp === 'penguin') {
      // the waddle: the body rocks side to side over each short step, flippers held out
      this.phase += (speed / 0.12) * dt;
      const w = pose === 'walk' ? Math.sin(this.phase * Math.PI * 2) : 0;
      B.body.rotation.z = w * 0.14;
      B.legL.rotation.x = w * 0.25; B.legR.rotation.x = -w * 0.25;
      B.wingL.rotation.z = 0.25 + Math.abs(w) * 0.1; B.wingR.rotation.z = -0.25 - Math.abs(w) * 0.1;
      B.head.rotation.y = pose === 'walk' ? 0 : Math.sin(this.t * 0.7) * 0.5;
      return;
    }
    if (pose === 'swim') {
      // riding the water: a gentle rock, the head turning, a dabble now and then
      B.body.rotation.x = Math.sin(this.t * 1.3) * 0.04;
      B.body.rotation.z = Math.sin(this.t * 0.9) * 0.05;
      const dab = Math.max(0, Math.sin(this.t * 0.37)) ** 12;
      B.neck.rotation.x = dab * 1.3;
      B.head.rotation.y = Math.sin(this.t * 0.6) * 0.5 * (1 - dab);
      return;
    }
    if (pose === 'walk') {
      // each step the head thrusts forward and then holds still while the body catches up
      this.phase += (speed / (L * 0.18)) * dt;
      const s = this.phase % 1;
      B.head.position.z += ((s < 0.5 ? s / 0.5 : 1 - (s - 0.5) / 0.5) - 0.5) * 0.08 * L;
      B.legL.rotation.x = Math.sin(this.phase * Math.PI * 2) * 0.5;
      B.legR.rotation.x = -Math.sin(this.phase * Math.PI * 2) * 0.5;
      B.body.rotation.z = Math.sin(this.phase * Math.PI * 2) * 0.06;
    } else if (pose === 'peck') {
      const k = Math.max(0, Math.sin(this.t * 5)) ** 3;
      B.body.rotation.x = 0.5 * k;
      B.neck.rotation.x = 0.9 * k;
      B.tail.rotation.x = -0.4 * k;
    } else {
      B.head.rotation.y = Math.sin(this.t * 0.9) * 0.6;
      B.neck.rotation.x = Math.sin(this.t * 0.5) * 0.05;
    }
  }
}

/* ---------- far herds: each animal's lightest model, instanced at rest ---------- */
export class Herd {
  private pools = new Map<Beast, { mesh: THREE.InstancedMesh; n: number }>();
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private mats = new Map<Beast, THREE.MeshStandardMaterial>();
  constructor(private parent: THREE.Object3D, private cap = 40) {}
  begin(): void {
    for (const p of this.pools.values()) p.n = 0;
  }
  add(b: Beast, x: number, y: number, z: number, yaw: number): void {
    let pool = this.pools.get(b);
    if (!pool) {
      let m = this.mats.get(b);
      if (!m) this.mats.set(b, (m = coatMaterial(b.material.map, b.material.side === THREE.DoubleSide)));
      const mesh = new THREE.InstancedMesh(b.lods[2], m, this.cap);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      this.parent.add(mesh);
      pool = { mesh, n: 0 };
      this.pools.set(b, pool);
    }
    if (pool.n >= this.cap) return;
    this.m4.compose(this.p.set(x, y, z), this.q.setFromEuler(this.e.set(0, yaw, 0)), this.s.set(1, 1, 1));
    pool.mesh.setMatrixAt(pool.n++, this.m4);
  }
  end(): void {
    for (const p of this.pools.values()) {
      p.mesh.count = p.n;
      p.mesh.visible = p.n > 0;
      if (p.n) p.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}

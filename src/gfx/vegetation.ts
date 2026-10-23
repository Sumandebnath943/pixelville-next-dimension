/* ============================================================
   Vegetation: procedural trees (recursive branching with bark
   tubes and alpha-cut leaf cards lit with crown-shaped normals),
   bushes and hedges, and instanced grass clumps streamed by
   distance. Everything sways with the shared wind: whole trees
   bend in gusts, branches swing, leaves flutter, grass ripples
   as gust fronts roll across it. Leaves can turn and fall for
   winter, grass shrinks under settling snow.
   ============================================================ */
import * as THREE from 'three';
import { surface } from './surface';
import { leafCard, needleCard, bark, TexSet, hash } from './textures';
import { LAYER_NO_REFLECT } from './pipeline';

/* ---------- wind GLSL (object space; instance rotation undone) ---------- */
const WIND_DECL = /* glsl */ `
attribute vec4 aWind; // x: height/H (trunk bend), y: branch flex, z: leaf flutter, w: phase
attribute float aRand;
varying float vRand;
varying float vLeafH;
uniform float uLeafFall;
`;
const WIND_DISPLACE = /* glsl */ `
{
  vRand = aRand;
  vLeafH = aWind.x;
  mat3 im = mat3(1.0);
  vec3 origin = vec3(0.0);
  #ifdef USE_INSTANCING
    im = mat3(instanceMatrix);
    origin = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  #endif
  origin = (modelMatrix * vec4(origin, 1.0)).xyz;
  vec3 s2 = max(vec3(dot(im[0], im[0]), dot(im[1], im[1]), dot(im[2], im[2])), vec3(1e-4));
  float g = pvGust(origin.xz);
  float ph = aWind.w + origin.x * 0.13 + origin.z * 0.17;
  vec3 wd = vec3(uWindDir.x, 0.0, uWindDir.y);
  float w = uWind;
  // trunk: lean with the mean wind plus slow sway
  float bend = aWind.x * aWind.x;
  vec3 off = wd * bend * (w * (0.35 + 0.65 * g) * 0.9 + sin(uTime * (0.6 + w * 0.5) + ph) * (0.08 + w * 0.25));
  // branches: swing across and along the wind
  float fb = sin(uTime * (1.6 + w * 2.2) + ph * 3.1) * aWind.y * (0.04 + w * 0.22) * (0.5 + g);
  off += vec3(sin(ph * 7.0), 0.35 * cos(ph * 5.0), cos(ph * 7.0)) * fb;
  // leaves: quick flutter
  off += vec3(sin(uTime * 9.0 + ph * 23.0), cos(uTime * 11.0 + ph * 17.0), sin(uTime * 7.0 + ph * 29.0)) * aWind.z * (0.012 + w * 0.05) * (0.5 + g);
  off.y -= dot(off.xz, off.xz) * 0.12;
  transformed += transpose(im) * off / s2;
}
`;

/* ---------- geometry accumulator ---------- */
class Geo {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  wind: number[] = [];
  rand: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  get n(): number {
    return this.pos.length / 3;
  }
  v(p: THREE.Vector3, n: THREE.Vector3, u: number, v: number, w: number[], r: number, c?: THREE.Color): number {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.wind.push(w[0], w[1], w[2], w[3]);
    this.rand.push(r);
    if (c) this.col.push(c.r, c.g, c.b);
    return this.n - 1;
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aWind', new THREE.Float32BufferAttribute(this.wind, 4));
    g.setAttribute('aRand', new THREE.Float32BufferAttribute(this.rand, 1));
    if (this.col.length) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

function rng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/* ---------- tree species ---------- */
export type Species = 'oak' | 'birch' | 'spruce' | 'lime';
interface SpeciesDef {
  height: [number, number];
  trunkR: number;
  levels: number;
  segs: number[];
  radial: number[];
  children: number[];
  angle: number[];
  lenRatio: number[];
  childStart: number[];
  upPull: number[];
  gnarl: number[];
  taper: number;
  leafLevel: number;
  leavesPer: number;
  leafSize: number;
  conifer?: boolean;
  birch?: boolean;
  deciduous: boolean;
}
const SPECIES: Record<Species, SpeciesDef> = {
  oak: {
    height: [11, 15], trunkR: 0.34, levels: 3, segs: [10, 7, 5, 3], radial: [11, 7, 5, 3],
    children: [0, 8, 6, 5], angle: [0, 52, 46, 40], lenRatio: [0.55, 0.62, 0.5, 0.45],
    childStart: [0, 0.32, 0.18, 0.25], upPull: [0.05, 0.22, 0.12, 0.05], gnarl: [0.1, 0.22, 0.28, 0.3],
    taper: 0.82, leafLevel: 2, leavesPer: 5, leafSize: 1.25, deciduous: true,
  },
  lime: {
    height: [12, 16], trunkR: 0.3, levels: 3, segs: [10, 7, 5, 3], radial: [11, 7, 5, 3],
    children: [0, 10, 5, 5], angle: [0, 40, 42, 40], lenRatio: [0.62, 0.48, 0.5, 0.45],
    childStart: [0, 0.3, 0.2, 0.25], upPull: [0.04, 0.3, 0.12, 0.05], gnarl: [0.06, 0.15, 0.22, 0.3],
    taper: 0.85, leafLevel: 2, leavesPer: 5, leafSize: 1.1, deciduous: true,
  },
  birch: {
    height: [10, 13], trunkR: 0.17, levels: 3, segs: [10, 6, 4, 3], radial: [9, 5, 4, 3],
    children: [0, 13, 5, 4], angle: [0, 38, 45, 50], lenRatio: [0.7, 0.4, 0.55, 0.5],
    childStart: [0, 0.35, 0.2, 0.3], upPull: [0.03, 0.18, -0.15, -0.3], gnarl: [0.06, 0.15, 0.2, 0.3],
    taper: 0.88, leafLevel: 2, leavesPer: 4, leafSize: 0.85, birch: true, deciduous: true,
  },
  spruce: {
    height: [13, 18], trunkR: 0.28, levels: 2, segs: [12, 5, 3], radial: [10, 5, 3],
    children: [0, 34, 6], angle: [0, 88, 55], lenRatio: [1, 0.3, 0.35],
    childStart: [0, 0.12, 0.2], upPull: [0, -0.18, 0.05], gnarl: [0.02, 0.1, 0.2],
    taper: 0.97, leafLevel: 1, leavesPer: 7, leafSize: 1.1, conifer: true, deciduous: false,
  },
};

interface TreeGeo { wood: THREE.BufferGeometry; leaves: THREE.BufferGeometry; height: number }

const _t = new THREE.Vector3(), _n1 = new THREE.Vector3(), _n2 = new THREE.Vector3(), _p = new THREE.Vector3(), _nn = new THREE.Vector3();
function perp(d: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  return Math.abs(d.y) < 0.9 ? out.crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize() : out.crossVectors(d, new THREE.Vector3(1, 0, 0)).normalize();
}

/** build one tree: bark tubes + double-sided leaf cards */
export function buildTree(species: Species, seed: number): TreeGeo {
  const sp = SPECIES[species];
  const R = rng(seed);
  const H = sp.height[0] + R() * (sp.height[1] - sp.height[0]);
  const wood = new Geo(), leaves = new Geo();
  const crown = new THREE.Vector3(0, H * (sp.conifer ? 0.45 : 0.68), 0);

  const grow = (start: THREE.Vector3, dir: THREE.Vector3, len: number, r0: number, level: number, flex0: number, phase: number): void => {
    const segs = sp.segs[level];
    const pts: THREE.Vector3[] = [start.clone()];
    const dirs: THREE.Vector3[] = [];
    const d = dir.clone().normalize();
    const cur = start.clone();
    for (let i = 0; i < segs; i++) {
      dirs.push(d.clone());
      cur.addScaledVector(d, len / segs);
      pts.push(cur.clone());
      d.y += sp.upPull[level] / segs * 3;
      d.x += (R() - 0.5) * sp.gnarl[level];
      d.z += (R() - 0.5) * sp.gnarl[level];
      d.normalize();
    }
    dirs.push(d.clone());
    const radius = (t: number): number => {
      const flare = level === 0 ? 1 + Math.max(0, 0.12 - t) * 5 : 1;
      return Math.max(0.006, r0 * (1 - t * sp.taper) * flare);
    };
    const flexAt = (t: number): number => flex0 + t * (level === 0 ? 0.08 : 0.35 + level * 0.2);

    // tube with parallel-transport frames
    const radial = sp.radial[level];
    const base = wood.n;
    let nrm = perp(dirs[0], new THREE.Vector3());
    let arc = 0;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      if (i > 0) {
        arc += pts[i].distanceTo(pts[i - 1]);
        const prev = dirs[i - 1], now = dirs[i];
        const axis = _t.crossVectors(prev, now);
        const s = axis.length();
        if (s > 1e-5) nrm.applyAxisAngle(axis.normalize(), Math.asin(Math.min(1, s)));
      }
      const bin = new THREE.Vector3().crossVectors(dirs[i], nrm).normalize();
      nrm = new THREE.Vector3().crossVectors(bin, dirs[i]).normalize();
      const r = radius(t);
      const uRep = Math.max(1, Math.round((2 * Math.PI * r) / 0.45));
      for (let k = 0; k <= radial; k++) {
        const a = (k / radial) * Math.PI * 2;
        _nn.copy(nrm).multiplyScalar(Math.cos(a)).addScaledVector(bin, Math.sin(a));
        _p.copy(pts[i]).addScaledVector(_nn, r);
        wood.v(_p, _nn, (k / radial) * uRep, arc, [Math.min(1, _p.y / H), flexAt(t), 0, phase], R());
      }
    }
    for (let i = 0; i < segs; i++)
      for (let k = 0; k < radial; k++) {
        const a = base + i * (radial + 1) + k, b = a + radial + 1;
        wood.idx.push(a, b, a + 1, a + 1, b, b + 1);
      }

    // leaves along the outer part of leafy branches
    if (level >= sp.leafLevel) {
      const n = level === sp.levels ? sp.leavesPer : Math.ceil(sp.leavesPer * 0.6);
      for (let k = 0; k < n; k++) {
        const t = 0.25 + R() * 0.75;
        const fi = Math.min(segs - 1, Math.floor(t * segs));
        const p = pts[fi].clone().lerp(pts[fi + 1], t * segs - fi);
        const bd = dirs[fi];
        const out = sp.conifer ? new THREE.Vector3(p.x, 0, p.z).normalize() : p.clone().sub(crown).normalize();
        const s = sp.leafSize * (0.7 + R() * 0.6) * (sp.conifer ? 0.6 + 0.6 * (1 - p.y / H) : 1);
        const up = bd.clone().multiplyScalar(0.55).addScaledVector(out, 0.45).add(new THREE.Vector3(0, sp.conifer ? -0.1 : 0.15, 0)).normalize();
        const side = new THREE.Vector3().crossVectors(up, new THREE.Vector3(R() - 0.5, R() - 0.5, R() - 0.5).normalize()).normalize();
        const lightN = out.clone().multiplyScalar(0.75).add(new THREE.Vector3(0, 0.35, 0)).normalize();
        const w = [Math.min(1, p.y / H), flexAt(t) + 0.15, 1, phase + k * 0.7];
        const r = R();
        const c0 = p.clone().addScaledVector(side, -s / 2), c1 = p.clone().addScaledVector(side, s / 2);
        const c2 = c1.clone().addScaledVector(up, s), c3 = c0.clone().addScaledVector(up, s);
        const tint = new THREE.Color().setHSL(0.24 + (R() - 0.5) * 0.04, 0.5, 0.42 + (R() - 0.5) * 0.12);
        // one-sided card, drawn double-sided with its crown normal kept (half the triangles)
        const i0 = leaves.v(c0, lightN, 0, 0, w, r, tint), i1 = leaves.v(c1, lightN, 1, 0, w, r, tint);
        const i2 = leaves.v(c2, lightN, 1, 1, w, r, tint), i3 = leaves.v(c3, lightN, 0, 1, w, r, tint);
        leaves.idx.push(i0, i1, i2, i0, i2, i3);
      }
    }

    if (level >= sp.levels) return;
    const nc = sp.children[level + 1];
    for (let k = 0; k < nc; k++) {
      let t = sp.childStart[level + 1] + ((k + 0.3 + R() * 0.4) / nc) * (1 - sp.childStart[level + 1]);
      if (sp.conifer && level === 0) t = sp.childStart[1] + (k / nc) * (0.97 - sp.childStart[1]);
      const fi = Math.min(segs - 1, Math.floor(t * segs));
      const p = pts[fi].clone().lerp(pts[fi + 1], t * segs - fi);
      const pd = dirs[fi];
      const n1 = perp(pd, _n1), n2 = _n2.crossVectors(pd, n1).normalize();
      const az = k * 2.39996 + R() * 0.6;
      const ang = ((sp.angle[level + 1] + (R() - 0.5) * 16) * Math.PI) / 180;
      const cd = pd.clone().multiplyScalar(Math.cos(ang)).addScaledVector(n1, Math.sin(ang) * Math.cos(az)).addScaledVector(n2, Math.sin(ang) * Math.sin(az)).normalize();
      let cl = len * sp.lenRatio[level + 1] * (0.75 + R() * 0.5);
      if (sp.conifer && level === 0) cl = (1 - t) * H * 0.3 + 0.4;
      else if (level === 0) cl *= 1 - (t - 0.5) * 0.6;
      grow(p, cd, cl, radius(t) * (sp.conifer ? 0.3 : 0.62), level + 1, flexAt(t), phase + k * 1.7);
    }
  };

  const trunkLen = sp.conifer ? H : H * sp.lenRatio[0] * 1.15;
  grow(new THREE.Vector3(0, -0.2, 0), new THREE.Vector3((R() - 0.5) * 0.08, 1, (R() - 0.5) * 0.08), trunkLen + 0.2, sp.trunkR * (0.85 + R() * 0.3), 0, 0, R() * 6.28);
  return { wood: wood.build(), leaves: leaves.build(), height: H };
}

/** a rounded bush (or a hedge when `len` > 0): leaf cards over an ellipsoid shell around a dark core */
export function buildBush(rx: number, ry: number, rz: number, seed: number, len = 0): { leaves: THREE.BufferGeometry; core: THREE.BufferGeometry } {
  const R = rng(seed);
  const g = new Geo();
  const area = 4 * Math.PI * Math.pow((rx * ry + ry * rz + rx * rz) / 3, 0.5) * (1 + len);
  const n = Math.ceil(area * 22);
  for (let k = 0; k < n; k++) {
    // a point on the shell (hedges stretch along x)
    const u = R() * 2 - 1, a = R() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const dir = new THREE.Vector3(s * Math.cos(a), Math.abs(u) * (u < -0.6 ? 0.2 : 1) * Math.sign(u), s * Math.sin(a));
    const p = new THREE.Vector3(dir.x * rx, dir.y * ry + ry, dir.z * rz);
    if (len > 0) {
      p.x = (R() - 0.5) * len;
      const face = R();
      if (face < 0.4) { p.z = rz * Math.sign(R() - 0.5); p.y = R() * ry * 2; dir.set(0, 0, Math.sign(p.z)); }
      else if (face < 0.7) { p.y = ry * 2; p.z = (R() - 0.5) * rz * 2; dir.set(0, 1, 0); }
      else { p.z = (R() - 0.5) * rz * 2; p.y = R() * ry * 2; dir.set(0, 0, Math.sign(p.z || 1)); p.z = Math.sign(p.z || 1) * rz; }
      if (Math.abs(p.x) > len / 2 - 0.2 && R() < 0.5) { p.x = Math.sign(p.x) * len / 2; dir.set(Math.sign(p.x), 0, 0); }
    }
    p.addScaledVector(dir, (R() - 0.3) * 0.15);
    const sz = 0.45 + R() * 0.35;
    const up = dir.clone().multiplyScalar(0.6).add(new THREE.Vector3(R() - 0.5, 0.6, R() - 0.5)).normalize();
    const side = new THREE.Vector3().crossVectors(up, dir.lengthSq() > 0 ? dir : new THREE.Vector3(0, 1, 0)).normalize();
    if (side.lengthSq() < 0.5) side.set(1, 0, 0);
    const ln = dir.clone().normalize().multiplyScalar(0.8).add(new THREE.Vector3(0, 0.3, 0)).normalize();
    const w = [Math.min(1, p.y / (ry * 2 + 0.01)) * 0.25, 0.12, 0.6, R() * 6.28];
    const r = R();
    const base = p.clone().addScaledVector(up, -sz * 0.4);
    const c0 = base.clone().addScaledVector(side, -sz / 2), c1 = base.clone().addScaledVector(side, sz / 2);
    const c2 = c1.clone().addScaledVector(up, sz), c3 = c0.clone().addScaledVector(up, sz);
    const tint = new THREE.Color().setHSL(0.26 + (R() - 0.5) * 0.05, 0.45, 0.36 + (R() - 0.5) * 0.1);
    const i0 = g.v(c0, ln, 0, 0, w, r, tint), i1 = g.v(c1, ln, 1, 0, w, r, tint), i2 = g.v(c2, ln, 1, 1, w, r, tint), i3 = g.v(c3, ln, 0, 1, w, r, tint);
    g.idx.push(i0, i1, i2, i0, i2, i3);
  }
  const core = len > 0 ? new THREE.BoxGeometry(len - 0.1, ry * 2 - 0.15, rz * 2 - 0.2) : new THREE.SphereGeometry(1, 10, 8);
  if (len > 0) core.translate(0, ry - 0.05, 0);
  else core.scale(rx * 0.85, ry * 0.85, rz * 0.85).translate(0, ry * 0.95, 0);
  return { leaves: g.build(), core };
}

/* ---------- materials ---------- */
export const leafFall = { value: 0 };

function foliageMaterial(tex: THREE.Texture, key: string, translucency = 0.35): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.45, vertexColors: true, roughness: 0.75, metalness: 0, side: THREE.DoubleSide });
  m.alphaToCoverage = true;
  return surface(m, {
    snow: 0.85, wet: 0.35, keepNormals: true,
    vDecl: WIND_DECL,
    vDisplace: WIND_DISPLACE,
    fDecl: 'varying float vRand;\nvarying float vLeafH;\nuniform float uLeafFall;',
    fColor: `
      // autumn: leaves yellow and brown, then drop
      float fall = uLeafFall;
      vec3 autumn = mix(vec3(0.55, 0.32, 0.06), vec3(0.32, 0.16, 0.05), vRand);
      diffuseColor.rgb = mix(diffuseColor.rgb, autumn * (0.6 + 0.6 * vRand), smoothstep(0.0, 0.5, fall) * (0.6 + 0.4 * vRand));
      if (vRand < fall * 1.15 - 0.15) discard;
      diffuseColor.rgb = mix(vec3(dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11))), diffuseColor.rgb, 0.78) * 1.6;`,
    fEmissive: `
      {
        vec3 vdir = normalize(vWPos - cameraPosition);
        float back = pow(max(0.0, dot(vdir, uSunDir)), 3.0);
        totalEmissiveRadiance += diffuseColor.rgb * uSunColor * back * ${translucency.toFixed(2)} * 0.12;
      }`,
    uniforms: { uLeafFall: leafFall },
  }, key);
}

function barkMaterial(set: TexSet, key: string): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map: set.map, normalMap: set.normalMap, roughnessMap: set.roughnessMap, roughness: 1, metalness: 0 });
  m.normalScale.set(1.4, 1.4);
  return surface(m, { snow: 0.7, wet: 0.9, vDecl: WIND_DECL, vDisplace: WIND_DISPLACE, fDecl: 'varying float vRand;\nvarying float vLeafH;' }, key);
}

/* ---------- the forest: instanced trees, bushes, hedges ---------- */
export interface TreeSpot { x: number; z: number; y?: number; species: Species; scale?: number; rot?: number }

export class Vegetation {
  group = new THREE.Group();
  private barkA: THREE.MeshStandardMaterial;
  private barkB: THREE.MeshStandardMaterial;
  private broadleaf: THREE.MeshStandardMaterial;
  private smallLeaf: THREE.MeshStandardMaterial;
  private needles: THREE.MeshStandardMaterial;
  private bushMat: THREE.MeshStandardMaterial;
  private coreMat: THREE.MeshStandardMaterial;
  deciduousLeaves: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    this.barkA = barkMaterial(bark(11), 'bark');
    this.barkB = barkMaterial(bark(12, true), 'birch');
    this.broadleaf = foliageMaterial(leafCard(3), 'leaf');
    this.smallLeaf = foliageMaterial(leafCard(7, true), 'leafs');
    this.needles = foliageMaterial(needleCard(5), 'needle', 0.15);
    this.bushMat = foliageMaterial(leafCard(9, true), 'bush', 0.2);
    this.coreMat = surface(new THREE.MeshStandardMaterial({ color: 0x14200c, roughness: 1 }), { snow: 0.8 }, 'core');
  }

  /** plant trees; each species gets two variants, instanced */
  plant(spots: TreeSpot[]): void {
    const bySp = new Map<string, TreeSpot[]>();
    spots.forEach((s, i) => {
      const k = `${s.species}:${i % 2}`;
      if (!bySp.has(k)) bySp.set(k, []);
      bySp.get(k)!.push(s);
    });
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    for (const [k, list] of bySp) {
      const [species, v] = k.split(':') as [Species, string];
      const t = buildTree(species, 101 + +v * 977 + species.length * 31);
      const sp = SPECIES[species];
      const wood = new THREE.InstancedMesh(t.wood, sp.birch ? this.barkB : this.barkA, list.length);
      const leafMat = sp.conifer ? this.needles : sp.birch ? this.smallLeaf : this.broadleaf;
      const leaves = new THREE.InstancedMesh(t.leaves, leafMat, list.length);
      list.forEach((s, i) => {
        const r = hash(Math.round(s.x * 10), Math.round(s.z * 10), 3);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.rot ?? r * Math.PI * 2);
        sc.setScalar((s.scale ?? 1) * (0.85 + r * 0.3));
        pos.set(s.x, s.y ?? 0, s.z);
        m4.compose(pos, q, sc);
        wood.setMatrixAt(i, m4);
        leaves.setMatrixAt(i, m4);
      });
      for (const m of [wood, leaves]) {
        m.castShadow = true;
        m.receiveShadow = true;
        m.computeBoundingSphere();
        this.group.add(m);
      }
      if (sp.deciduous) this.deciduousLeaves.push(leaves);
    }
  }

  bush(x: number, z: number, rx: number, ry: number, rz: number, seed: number, rot = 0, y = 0): void {
    const b = buildBush(rx, ry, rz, seed);
    this.addBush(b, x, z, rot, y);
  }
  hedge(x: number, z: number, len: number, h: number, depth: number, rot: number, seed: number, y = 0): void {
    const b = buildBush(0, h / 2, depth / 2, seed, len);
    this.addBush(b, x, z, rot, y);
  }
  private addBush(b: { leaves: THREE.BufferGeometry; core: THREE.BufferGeometry }, x: number, z: number, rot: number, y: number): void {
    const l = new THREE.Mesh(b.leaves, this.bushMat), c = new THREE.Mesh(b.core, this.coreMat);
    for (const m of [l, c]) {
      m.position.set(x, y, z);
      m.rotation.y = rot;
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    }
  }

  materialsFor(s: Species): { bark: THREE.Material; leaves: THREE.Material } {
    const sp = SPECIES[s];
    return { bark: sp.birch ? this.barkB : this.barkA, leaves: sp.conifer ? this.needles : sp.birch ? this.smallLeaf : this.broadleaf };
  }

  /** 0 summer … 1 bare (deciduous leaves turn and fall) */
  setLeafFall(k: number): void {
    leafFall.value = k;
    for (const m of this.deciduousLeaves) m.visible = k < 0.99;
  }
}

/* ---------- a forest at map scale: detailed trees near, light crowns far ---------- */
export interface TreeInstance { x: number; z: number; y: number; species: Species; scale: number; sx?: number; rot: number; tint?: THREE.Color }

/** a cheap leafy crown for distant trees: a deformed sphere wearing the leaf texture */
function farTreeGeo(species: Species, seed: number): { crown: THREE.BufferGeometry; trunk: THREE.BufferGeometry } {
  const sp = SPECIES[species];
  const H = (sp.height[0] + sp.height[1]) / 2;
  const R = rng(seed);
  // 80 triangles: the leaf texture's cut-outs give the ragged silhouette
  const crown = new THREE.IcosahedronGeometry(1, 1);
  const p = crown.attributes.position;
  const uv = new Float32Array(p.count * 2), wind = new Float32Array(p.count * 4), rnd = new Float32Array(p.count), col = new Float32Array(p.count * 3);
  const nrm = new Float32Array(p.count * 3);
  const c = new THREE.Color().setHSL(0.24, 0.5, 0.42);
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i);
    const lumpy = 0.82 + hash(Math.round(v.x * 40), Math.round(v.y * 40 + v.z * 13), seed) * 0.32;
    let x = v.x * lumpy, y = v.y * lumpy, z = v.z * lumpy;
    if (sp.conifer) {
      // a cone: wide at the bottom, a point at the top
      const t = (y + 1) / 2;
      x *= (1 - t) * 1.1 + 0.05; z *= (1 - t) * 1.1 + 0.05;
      y = 0.12 * H + t * H * 0.9;
      x *= H * 0.32; z *= H * 0.32;
    } else {
      const rx = H * (species === 'birch' ? 0.28 : 0.42), ry = H * 0.34;
      x *= rx; z *= rx; y = H * 0.62 + y * ry;
    }
    p.setXYZ(i, x, y, z);
    const n = v.clone().normalize();
    nrm.set([n.x * 0.8, n.y * 0.8 + 0.3, n.z * 0.8], i * 3);
    uv.set([Math.atan2(v.z, v.x) * 1.6, v.y * 2.4], i * 2);
    wind.set([Math.min(1, y / H), 0.3, 0.6, R() * 6.28], i * 4);
    rnd[i] = R();
    col.set([c.r, c.g, c.b], i * 3);
  }
  crown.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  crown.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  crown.setAttribute('aWind', new THREE.BufferAttribute(wind, 4));
  crown.setAttribute('aRand', new THREE.BufferAttribute(rnd, 1));
  crown.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const trunk = new THREE.CylinderGeometry(sp.trunkR * 0.55, sp.trunkR, H * (sp.conifer ? 0.3 : 0.55), 6);
  trunk.translate(0, (H * (sp.conifer ? 0.3 : 0.55)) / 2, 0);
  const tp = trunk.attributes.position;
  trunk.setAttribute('aWind', new THREE.BufferAttribute(new Float32Array(tp.count * 4), 4));
  trunk.setAttribute('aRand', new THREE.BufferAttribute(new Float32Array(tp.count), 1));
  return { crown, trunk };
}

interface LodSet { wood: THREE.InstancedMesh; leaves: THREE.InstancedMesh; deciduous: boolean }

export class TreeLayer {
  group = new THREE.Group();
  private veg: Vegetation;
  private near = new Map<string, LodSet>();
  private far = new Map<Species, LodSet>();
  private trees: TreeInstance[] = [];
  private lastX = 1e9;
  private lastZ = 1e9;
  private dirty = true;

  constructor(scene: THREE.Scene, private nearRange = 150, cap = 32000) {
    scene.add(this.group);
    this.veg = new Vegetation(scene);
    scene.remove(this.veg.group);
    const species: Species[] = ['oak', 'lime', 'birch', 'spruce'];
    for (const s of species) {
      const sp = SPECIES[s];
      const mats = this.veg.materialsFor(s);
      for (const v of [0, 1]) {
        const t = buildTree(s, 101 + v * 977 + s.length * 31);
        const set: LodSet = {
          wood: new THREE.InstancedMesh(t.wood, mats.bark, 600),
          leaves: new THREE.InstancedMesh(t.leaves, mats.leaves, 600),
          deciduous: sp.deciduous,
        };
        this.prep(set);
        this.near.set(`${s}:${v}`, set);
      }
      const f = farTreeGeo(s, 7 + s.length);
      const fset: LodSet = {
        wood: new THREE.InstancedMesh(f.trunk, mats.bark, cap),
        leaves: new THREE.InstancedMesh(f.crown, mats.leaves, cap),
        deciduous: sp.deciduous,
      };
      this.prep(fset);
      fset.wood.castShadow = false;
      fset.leaves.castShadow = false;
      // distant crowns stay out of the mirror passes
      fset.wood.layers.set(LAYER_NO_REFLECT);
      fset.leaves.layers.set(LAYER_NO_REFLECT);
      this.far.set(s, fset);
    }
  }
  private prep(s: LodSet): void {
    for (const m of [s.wood, s.leaves]) {
      m.count = 0;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
    }
    s.leaves.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(s.leaves.instanceMatrix.count * 3).fill(1), 3);
  }

  /** replace the whole forest (when the map's trees change) */
  setTrees(list: TreeInstance[]): void {
    this.trees = list;
    this.dirty = true;
  }

  /** re-sort near/far when the camera has moved far enough */
  frame(cam: THREE.Vector3): void {
    const fall = leafFall.value;
    for (const s of [...this.near.values(), ...this.far.values()]) if (s.deciduous) s.leaves.visible = fall < 0.99;
    if (!this.dirty && Math.hypot(cam.x - this.lastX, cam.z - this.lastZ) < 14) return;
    this.dirty = false;
    this.lastX = cam.x;
    this.lastZ = cam.z;
    const r2 = this.nearRange * this.nearRange;
    for (const s of [...this.near.values(), ...this.far.values()]) { s.wood.count = 0; s.leaves.count = 0; }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const white = new THREE.Color(1, 1, 1);
    const far2 = 1500 * 1500;
    for (let i = 0; i < this.trees.length; i++) {
      const t = this.trees[i];
      const d2 = (t.x - cam.x) ** 2 + (t.z - cam.z) ** 2;
      if (d2 > far2) continue; // lost in the haze
      const set = d2 < r2 ? this.near.get(`${t.species}:${i & 1}`)! : this.far.get(t.species)!;
      if (set.wood.count >= set.wood.instanceMatrix.count) continue;
      q.setFromAxisAngle(up, t.rot);
      sc.set(t.scale * (t.sx ?? 1), t.scale, t.scale * (t.sx ?? 1));
      pos.set(t.x, t.y, t.z);
      m4.compose(pos, q, sc);
      const k = set.wood.count;
      set.wood.setMatrixAt(k, m4);
      set.leaves.setMatrixAt(k, m4);
      set.leaves.setColorAt(k, t.tint || white);
      set.wood.count = set.leaves.count = k + 1;
    }
    for (const s of [...this.near.values(), ...this.far.values()]) {
      s.wood.instanceMatrix.needsUpdate = true;
      s.leaves.instanceMatrix.needsUpdate = true;
      if (s.leaves.instanceColor) s.leaves.instanceColor.needsUpdate = true;
      s.wood.visible = s.wood.count > 0;
      s.leaves.visible = s.leaves.count > 0 && (!s.deciduous || leafFall.value < 0.99);
    }
  }
}

/**
 * Grass streamed in tiles around the camera: `density(x, z)` returns
 * [density 0..1, height factor, ground y]. Tiles are built a few per
 * frame and dropped once they fall out of range.
 */
export class GrassStream {
  private tiles = new Map<string, { mesh: THREE.InstancedMesh; cx: number; cz: number; total: number }>();
  private geo = clumpGeometry(7, 4);
  material: THREE.MeshStandardMaterial;
  private scene: THREE.Scene;
  constructor(scene: THREE.Scene, private density: (x: number, z: number) => [number, number, number], private perM2 = 5, private range = 50, private tile = 16) {
    this.scene = scene;
    this.material = grassMaterial();
  }
  /** forget every tile (the map changed) */
  reset(): void {
    for (const t of this.tiles.values()) { this.scene.remove(t.mesh); t.mesh.dispose(); }
    this.tiles.clear();
  }
  update(cam: THREE.Vector3): void {
    if (this.perM2 <= 0) return;
    const T = this.tile, R = this.range + T;
    const hk = Math.max(1, (cam.y - 1.7) * 0.6);
    // build missing tiles nearest-first, at most two per frame
    let built = 0;
    const want: [number, number, number][] = [];
    for (let tz = Math.floor((cam.z - R) / T); tz <= Math.floor((cam.z + R) / T); tz++)
      for (let tx = Math.floor((cam.x - R) / T); tx <= Math.floor((cam.x + R) / T); tx++) {
        const cx = tx * T + T / 2, cz = tz * T + T / 2;
        const d = Math.hypot(cx - cam.x, cz - cam.z);
        if (d > R) continue;
        if (!this.tiles.has(tx + ',' + tz)) want.push([d, tx, tz]);
      }
    want.sort((a, b) => a[0] - b[0]);
    for (const [, tx, tz] of want) {
      if (built >= 2) break;
      this.build(tx, tz);
      built++;
    }
    for (const [k, t] of this.tiles) {
      const d = Math.hypot(t.cx - cam.x, t.cz - cam.z) + (cam.y - 2) * 0.8;
      if (d > R * 1.4) { this.scene.remove(t.mesh); t.mesh.dispose(); this.tiles.delete(k); continue; }
      const kk = THREE.MathUtils.clamp(1 - (d - 12) / (this.range + hk), 0, 1);
      t.mesh.count = Math.floor(t.total * Math.pow(kk, 1.6));
      t.mesh.visible = t.mesh.count > 0;
    }
  }
  private build(tx: number, tz: number): void {
    const T = this.tile;
    const n = Math.floor(T * T * this.perM2);
    const mats: THREE.Matrix4[] = [], cols: THREE.Color[] = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < n; i++) {
      const x = tx * T + hash(i, tx * 7 + tz, 1) * T, z = tz * T + hash(i, tx + tz * 13, 2) * T;
      const [d, hk, gy] = this.density(x, z);
      if (d <= 0 || hash(i, tx * 3 + tz * 5, 3) > d) continue;
      q.setFromAxisAngle(up, hash(i, tx, 4) * Math.PI * 2);
      const sc = hk * (0.7 + hash(i, tz, 5) * 0.6);
      const sw = Math.min(1, Math.sqrt(sc) * 1.1);
      s.set(sw, sc, sw);
      p.set(x, gy, z);
      mats.push(m4.compose(p, q, s).clone());
      const v = hash(i, tx + tz, 6);
      const c = new THREE.Color(0.85 + v * 0.3, 0.85 + v * 0.25, 0.75 + v * 0.2);
      if (hash(Math.floor(x / 3), Math.floor(z / 3), 9) > 0.8) c.multiply(new THREE.Color(1.25, 1.05, 0.7));
      cols.push(c);
    }
    const mesh = new THREE.InstancedMesh(this.geo, this.material, Math.max(1, mats.length));
    mats.forEach((m, i) => { mesh.setMatrixAt(i, m); mesh.setColorAt(i, cols[i]); });
    mesh.count = mats.length;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.computeBoundingSphere();
    mesh.layers.set(LAYER_NO_REFLECT);
    this.scene.add(mesh);
    this.tiles.set(tx + ',' + tz, { mesh, cx: tx * T + T / 2, cz: tz * T + T / 2, total: mats.length });
  }
}

/* ---------- grass ---------- */
const GRASS_DECL = /* glsl */ `
attribute float aBlade;
varying float vBlade;
`;
const GRASS_DISPLACE = /* glsl */ `
{
  vBlade = aBlade;
  mat3 im = mat3(1.0);
  vec3 origin = vec3(0.0);
  #ifdef USE_INSTANCING
    im = mat3(instanceMatrix);
    origin = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  #endif
  origin = (modelMatrix * vec4(origin, 1.0)).xyz;
  vec3 s2 = max(vec3(dot(im[0], im[0]), dot(im[1], im[1]), dot(im[2], im[2])), vec3(1e-4));
  // settled snow buries the blades
  transformed.y *= 1.0 - uSnow * 0.88;
  vec2 wp = origin.xz + transformed.xz;
  float g = pvGust(wp);
  float ph = wp.x * 1.7 + wp.y * 1.3;
  float h = aBlade * aBlade;
  float sway = uWind * (0.25 + 0.95 * g) * 0.55 + sin(uTime * (1.8 + uWind * 3.0) + ph) * (0.04 + uWind * 0.14);
  vec3 off = vec3(uWindDir.x, 0.0, uWindDir.y) * sway * h * 0.5;
  off += vec3(sin(ph * 3.0), 0.0, cos(ph * 2.0)) * 0.03 * h;
  off.y -= dot(off.xz, off.xz) * 0.9;
  transformed += transpose(im) * off / s2;
}
`;

function clumpGeometry(blades: number, seed: number): THREE.BufferGeometry {
  const R = rng(seed);
  const pos: number[] = [], nrm: number[] = [], col: number[] = [], bl: number[] = [], idx: number[] = [];
  const SEG = 4;
  const root = new THREE.Color(0.012, 0.03, 0.006), tip = new THREE.Color(0.2, 0.3, 0.05), dry = new THREE.Color(0.36, 0.3, 0.1);
  for (let b = 0; b < blades; b++) {
    const a = R() * Math.PI * 2, r = Math.sqrt(R()) * 0.13;
    const ox = Math.cos(a) * r, oz = Math.sin(a) * r;
    const yaw = R() * Math.PI;
    const h = 0.55 + R() * 0.5, w = 0.016 + R() * 0.014;
    const lean = (R() - 0.5) * 0.5, leanDir = R() * Math.PI * 2;
    const cx = Math.cos(yaw), cz = Math.sin(yaw);
    const tipC = tip.clone().lerp(dry, R() * R() * 0.8);
    const base = pos.length / 3;
    for (let s = 0; s <= SEG; s++) {
      const t = s / SEG;
      const ww = w * (1 - t * 0.85);
      const bend = lean * t * t * h;
      const px = ox + Math.cos(leanDir) * bend, pz = oz + Math.sin(leanDir) * bend, py = t * h;
      for (const side of [-1, 1]) {
        pos.push(px + cx * ww * side, py, pz + cz * ww * side);
        const n = new THREE.Vector3(-cz, 0.9, cx).normalize();
        nrm.push(n.x, n.y, n.z);
        const c = root.clone().lerp(tipC, Math.pow(t, 0.7));
        col.push(c.r, c.g, c.b);
        bl.push(t);
      }
    }
    for (let s = 0; s < SEG; s++) {
      const i = base + s * 2;
      idx.push(i, i + 1, i + 3, i, i + 3, i + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aBlade', new THREE.Float32BufferAttribute(bl, 1));
  g.setIndex(idx);
  return g;
}

interface GrassTile { mesh: THREE.InstancedMesh; cx: number; cz: number; total: number }

let GRASS_MAT: THREE.MeshStandardMaterial | null = null;
function grassMaterial(): THREE.MeshStandardMaterial {
  if (GRASS_MAT) return GRASS_MAT;
  GRASS_MAT = surface(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, side: THREE.DoubleSide }), {
    snow: 1, wet: 0.4, keepNormals: true,
    vDecl: GRASS_DECL, vDisplace: GRASS_DISPLACE,
    fDecl: 'varying float vBlade;',
    fEmissive: `
      {
        vec3 vdir = normalize(vWPos - cameraPosition);
        float back = pow(max(0.0, dot(vdir, uSunDir)), 4.0);
        totalEmissiveRadiance += diffuseColor.rgb * uSunColor * back * vBlade * 0.05;
      }`,
  }, 'grass');
  return GRASS_MAT;
}

/**
 * Grass clumps scattered where `density(x, z)` > 0 (returns 0..1 and a
 * height factor), streamed in tiles that thin out with distance.
 */
export class Grass {
  tiles: GrassTile[] = [];
  material: THREE.MeshStandardMaterial;
  constructor(scene: THREE.Scene, x0: number, z0: number, x1: number, z1: number, density: (x: number, z: number) => [number, number, number], perM2 = 7, tile = 16) {
    const geo = clumpGeometry(7, 4);
    this.material = grassMaterial();
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const tint = new THREE.Color();
    for (let tz = z0; tz < z1; tz += tile)
      for (let tx = x0; tx < x1; tx += tile) {
        const n = Math.floor(tile * tile * perM2);
        const mats: THREE.Matrix4[] = [], cols: THREE.Color[] = [];
        for (let i = 0; i < n; i++) {
          const x = tx + hash(i, tx * 7 + tz, 1) * tile, z = tz + hash(i, tx + tz * 13, 2) * tile;
          const [d, hk, gy] = density(x, z);
          if (d <= 0 || hash(i, tx * 3 + tz * 5, 3) > d) continue;
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(i, tx, 4) * Math.PI * 2);
          const sc = hk * (0.7 + hash(i, tz, 5) * 0.6);
          const sw = Math.min(1, Math.sqrt(sc) * 1.1);
          s.set(sw, sc, sw);
          p.set(x, gy, z);
          mats.push(m4.compose(p, q, s).clone());
          const v = hash(i, tx + tz, 6);
          tint.setRGB(0.85 + v * 0.3, 0.85 + v * 0.25, 0.75 + v * 0.2);
          if (hash(Math.floor(x / 3), Math.floor(z / 3), 9) > 0.8) tint.multiply(new THREE.Color(1.25, 1.05, 0.7));
          cols.push(tint.clone());
        }
        if (!mats.length) continue;
        const mesh = new THREE.InstancedMesh(geo, this.material, mats.length);
        mats.forEach((m, i) => { mesh.setMatrixAt(i, m); mesh.setColorAt(i, cols[i]); });
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        mesh.computeBoundingSphere();
        mesh.layers.set(LAYER_NO_REFLECT);
        scene.add(mesh);
        this.tiles.push({ mesh, cx: tx + tile / 2, cz: tz + tile / 2, total: mats.length });
      }
  }
  update(cam: THREE.Vector3, range = 62): void {
    const hk = Math.max(1, (cam.y - 1.7) * 0.6);
    for (const t of this.tiles) {
      const d = Math.hypot(t.cx - cam.x, t.cz - cam.z) + (cam.y - 2) * 0.8;
      const k = THREE.MathUtils.clamp(1 - (d - 14) / (range + hk), 0, 1);
      const c = Math.floor(t.total * Math.pow(k, 1.6));
      t.mesh.count = c;
      t.mesh.visible = c > 0;
    }
  }
}

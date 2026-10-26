/* ============================================================
   People: a smooth, skinned human body (lofted torso with real
   proportions, tapered limbs, shaped head with nose, ears, eyes
   and brows, hair, clothes and shoes as vertex-coloured
   regions), weights blended across every joint so elbows,
   knees and the spine bend softly. Animation is procedural,
   driven by gait data: hip/knee/ankle curves through stance and
   swing, pelvis bob, sway and rotation, counter-rotating
   shoulders, arm swing with elbow flex, idle breathing and
   weight shifts, looking both ways at a kerb, and an umbrella
   pose for the rain.
   ============================================================ */
import * as THREE from 'three';
import { surface } from './surface';

export interface Look {
  height: number;
  build: number;
  female: boolean;
  skin: THREE.Color;
  hair: THREE.Color;
  top: THREE.Color;
  legs: THREE.Color;
  shoes: THREE.Color;
  longHair: boolean;
  longSleeves: boolean;
  skirt: boolean;
  coat?: THREE.Color;
}

type BoneName = 'root' | 'hips' | 'spine' | 'chest' | 'neck' | 'head' | 'shL' | 'uaL' | 'faL' | 'handL' | 'shR' | 'uaR' | 'faR' | 'handR' | 'thL' | 'shinL' | 'footL' | 'thR' | 'shinR' | 'footR';

/* ---------- joints in bind pose (for a 1.75 m adult; scaled per person) ---------- */
function joints(l: Look): Record<BoneName, THREE.Vector3> {
  const s = l.height / 1.75;
  const sh = l.female ? 0.175 : 0.195;
  const hp = l.female ? 0.1 : 0.092;
  const J: Record<BoneName, [number, number, number]> = {
    root: [0, 0, 0], hips: [0, 0.95, 0], spine: [0, 1.08, 0], chest: [0, 1.28, 0], neck: [0, 1.49, 0], head: [0, 1.585, 0.005],
    shL: [0.06, 1.44, 0], uaL: [sh, 1.425, -0.01], faL: [sh + 0.03, 1.145, -0.025], handL: [sh + 0.045, 0.895, 0],
    shR: [-0.06, 1.44, 0], uaR: [-sh, 1.425, -0.01], faR: [-sh - 0.03, 1.145, -0.025], handR: [-sh - 0.045, 0.895, 0],
    thL: [hp, 0.925, 0], shinL: [hp + 0.005, 0.505, 0.01], footL: [hp + 0.01, 0.085, -0.01],
    thR: [-hp, 0.925, 0], shinR: [-hp - 0.005, 0.505, 0.01], footR: [-hp - 0.01, 0.085, -0.01],
  };
  const out = {} as Record<BoneName, THREE.Vector3>;
  for (const k of Object.keys(J) as BoneName[]) out[k] = new THREE.Vector3(...J[k]).multiplyScalar(s);
  return out;
}
const PARENT: Record<BoneName, BoneName | null> = {
  root: null, hips: 'root', spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  shL: 'chest', uaL: 'shL', faL: 'uaL', handL: 'faL', shR: 'chest', uaR: 'shR', faR: 'uaR', handR: 'faR',
  thL: 'hips', shinL: 'thL', footL: 'shinL', thR: 'hips', shinR: 'thR', footR: 'shinR',
};
const ORDER: BoneName[] = ['root', 'hips', 'spine', 'chest', 'neck', 'head', 'shL', 'uaL', 'faL', 'handL', 'shR', 'uaR', 'faR', 'handR', 'thL', 'shinL', 'footL', 'thR', 'shinR', 'footR'];
const BI = Object.fromEntries(ORDER.map((b, i) => [b, i])) as Record<BoneName, number>;

/* ---------- mesh builder with skin weights ---------- */
enum M { Skin, Cloth, Shoe, Hair, Eye }
class Body {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  si: number[] = [];
  sw: number[] = [];
  groups: number[][] = [[], [], [], [], []];
  private vtx(p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color, w: [BoneName, number][]): number {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.col.push(c.r, c.g, c.b);
    const ws = w.slice(0, 4);
    while (ws.length < 4) ws.push(['root', 0]);
    const tot = ws.reduce((a, b) => a + b[1], 0) || 1;
    for (const [b, v] of ws) { this.si.push(BI[b]); this.sw.push(v / tot); }
    return this.pos.length / 3 - 1;
  }
  /**
   * Loft through rings along an axis: each ring has a centre, radii (rx across, rz front-back),
   * a superellipse exponent and the bone weights for its vertices.
   */
  loft(rings: { c: THREE.Vector3; rx: number; rz: number; w: [BoneName, number][] }[], mat: M, color: THREE.Color, seg = 16, pw = 2.3, capEnds = true): void {
    const base = this.pos.length / 3;
    const n = rings.length;
    for (let i = 0; i < n; i++) {
      const r = rings[i];
      const prev = rings[Math.max(0, i - 1)].c, next = rings[Math.min(n - 1, i + 1)].c;
      const axis = new THREE.Vector3().subVectors(next, prev).normalize();
      const side = Math.abs(axis.x) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
      const fw = new THREE.Vector3().crossVectors(side, axis).normalize();
      const sd = new THREE.Vector3().crossVectors(axis, fw).normalize();
      for (let k = 0; k <= seg; k++) {
        const a = (k / seg) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const ex = Math.sign(ca) * Math.pow(Math.abs(ca), 2 / pw), ez = Math.sign(sa) * Math.pow(Math.abs(sa), 2 / pw);
        const p = r.c.clone().addScaledVector(sd, ex * r.rx).addScaledVector(fw, ez * r.rz);
        const nn = sd.clone().multiplyScalar(ex / r.rx).addScaledVector(fw, ez / r.rz).normalize();
        this.vtx(p, nn, color, r.w);
      }
    }
    const g = this.groups[mat];
    for (let i = 0; i < n - 1; i++)
      for (let k = 0; k < seg; k++) {
        const a = base + i * (seg + 1) + k, b = a + seg + 1;
        g.push(a, a + 1, b, a + 1, b + 1, b);
      }
    if (capEnds) for (const [ri, flip] of [[0, true], [n - 1, false]] as [number, boolean][]) {
      const r = rings[ri];
      const dir = ri === 0 ? new THREE.Vector3().subVectors(rings[0].c, rings[1].c).normalize() : new THREE.Vector3().subVectors(rings[n - 1].c, rings[n - 2].c).normalize();
      const ci = this.vtx(r.c.clone().addScaledVector(dir, Math.min(r.rx, r.rz) * 0.35), dir, color, r.w);
      const rb = base + ri * (seg + 1);
      for (let k = 0; k < seg; k++) {
        if (flip) g.push(ci, rb + k + 1, rb + k);
        else g.push(ci, rb + k, rb + k + 1);
      }
    }
  }
  /** an ellipsoid bound to one or two bones; `cut` drops vertices below a plane through the centre (y offset) */
  blob(c: THREE.Vector3, r: THREE.Vector3, mat: M, color: THREE.Color, w: [BoneName, number][], shape?: (p: THREE.Vector3, n: THREE.Vector3) => void, ws = 18, hs = 12): void {
    const base = this.pos.length / 3;
    for (let j = 0; j <= hs; j++) {
      const v = j / hs, th = v * Math.PI;
      for (let i = 0; i <= ws; i++) {
        const ph = (i / ws) * Math.PI * 2;
        const d = new THREE.Vector3(Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph));
        const p = new THREE.Vector3(d.x * r.x, d.y * r.y, d.z * r.z);
        const n = new THREE.Vector3(d.x / r.x, d.y / r.y, d.z / r.z).normalize();
        shape?.(p, n);
        this.vtx(p.add(c), n, color, w);
      }
    }
    const g = this.groups[mat];
    for (let j = 0; j < hs; j++)
      for (let i = 0; i < ws; i++) {
        const a = base + j * (ws + 1) + i, b = a + ws + 1;
        g.push(a, b, a + 1, a + 1, b, b + 1);
      }
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    const idx: number[] = [];
    this.groups.forEach((list, m) => {
      g.addGroup(idx.length, list.length, m);
      idx.push(...list);
    });
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }
}

/** weights for a point at fraction t along a limb from bone a to bone b (blend into the parent near the root) */
function limbW(t: number, parent: BoneName, a: BoneName, b: BoneName | null): [BoneName, number][] {
  const w: [BoneName, number][] = [];
  const near = THREE.MathUtils.clamp(1 - t / 0.22, 0, 1) * 0.5;
  const far = b ? THREE.MathUtils.clamp((t - 0.8) / 0.2, 0, 1) * 0.5 : 0;
  w.push([a, 1 - near - far]);
  if (near > 0) w.push([parent, near]);
  if (far > 0 && b) w.push([b, far]);
  return w;
}
function spineW(y: number, J: Record<BoneName, THREE.Vector3>): [BoneName, number][] {
  const chain: BoneName[] = ['hips', 'spine', 'chest', 'neck'];
  if (y <= J.hips.y) return [['hips', 1]];
  for (let i = 0; i < chain.length - 1; i++) {
    const a = J[chain[i]].y, b = J[chain[i + 1]].y;
    if (y <= b) {
      const t = (y - a) / (b - a);
      return [[chain[i], 1 - t], [chain[i + 1], t]];
    }
  }
  return [['neck', 1]];
}

function buildBody(l: Look): THREE.BufferGeometry {
  const J = joints(l);
  const s = l.height / 1.75;
  const b = l.build;
  const B = new Body();
  const top = l.coat || l.top;
  const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z).multiplyScalar(s);

  // pelvis + torso as one loft: [y, rx, rz, z offset]
  const fem = l.female;
  const rows: [number, number, number, number][] = [
    [0.845, 0.11, 0.08, 0.0], [0.88, fem ? 0.165 : 0.152, 0.106, 0.0], [0.93, fem ? 0.182 : 0.168, 0.115, -0.005], [1.0, fem ? 0.158 : 0.158, 0.105, 0.0],
    [1.08, fem ? 0.128 : 0.148, 0.098, 0.005], [1.18, fem ? 0.14 : 0.155, fem ? 0.112 : 0.105, 0.01], [1.28, fem ? 0.155 : 0.17, fem ? 0.128 : 0.118, 0.015],
    [1.36, fem ? 0.162 : 0.182, 0.118, 0.008], [1.43, fem ? 0.16 : 0.182, 0.095, -0.01], [1.48, 0.11, 0.075, -0.012], [1.51, 0.058, 0.054, -0.005],
  ];
  const beltY = 1.0;
  const lower: typeof rows = [], upper: typeof rows = [];
  for (const r of rows) { if (r[0] <= beltY + 0.001) lower.push(r); if (r[0] >= beltY - 0.001) upper.push(r); }
  const ring = (r: [number, number, number, number], extra = 0) => ({ c: v(0, r[0], r[3]), rx: r[1] * s * b + extra, rz: r[2] * s * (0.9 + b * 0.1) + extra, w: spineW(r[0] * s, J) });
  B.loft(lower.map((r) => ring(r)), M.Cloth, l.skirt ? l.legs : l.legs, 20, 2.4, true);
  B.loft(upper.map((r) => ring(r, 0.004)), M.Cloth, top, 20, 2.4, false);
  // a coat hangs below the waist
  if (l.coat) {
    B.loft([[0.98, 0.17, 0.12, 0], [0.86, 0.19, 0.13, 0], [0.72, 0.21, 0.14, 0]].map((r) => ({ c: v(0, r[0], r[3]), rx: r[1] * s * b, rz: r[2] * s, w: [['hips', 1]] as [BoneName, number][] })), M.Cloth, l.coat, 20, 2.4, false);
  }
  if (l.skirt) {
    B.loft([[0.98, 0.16, 0.11, 0], [0.75, 0.2, 0.15, 0], [0.58, 0.22, 0.17, 0]].map((r) => ({ c: v(0, r[0], r[3]), rx: r[1] * s * b, rz: r[2] * s, w: [['hips', 1]] as [BoneName, number][] })), M.Cloth, l.legs, 20, 2.2, false);
  }

  // neck and head
  B.loft([{ c: v(0, 1.47, -0.01), rx: 0.056 * s, rz: 0.058 * s, w: [['neck', 1]] }, { c: v(0, 1.6, 0.0), rx: 0.05 * s, rz: 0.052 * s, w: [['neck', 0.4], ['head', 0.6]] }], M.Skin, l.skin, 12, 2, false);
  const hc = v(0, 1.665, 0.01);
  const hr = new THREE.Vector3(0.081, 0.112, 0.098).multiplyScalar(s);
  B.blob(hc, hr, M.Skin, l.skin, [['head', 1]], (p, n) => {
    // jaw narrows, chin forward, back of the skull fuller, eye sockets
    const yy = p.y / hr.y;
    if (yy < 0) { p.x *= 1 + yy * 0.32; p.z *= 1 + yy * 0.12; if (p.z > 0) p.z += -yy * 0.012 * s; }
    if (p.z < 0) p.z *= 1.08;
    if (yy > 0.05 && yy < 0.35 && p.z > 0.06 * s && Math.abs(p.x) > 0.012 * s && Math.abs(p.x) < 0.05 * s) p.z -= 0.006 * s;
    void n;
  }, 22, 16);
  // nose, lips, ears, eyes, brows
  B.blob(v(0, 1.66, 0.103), new THREE.Vector3(0.014, 0.026, 0.02).multiplyScalar(s), M.Skin, l.skin, [['head', 1]], (p) => { if (p.z < 0) p.z *= 0.3; if (p.y < 0) p.z *= 1.2; }, 8, 6);
  B.blob(v(0, 1.618, 0.094), new THREE.Vector3(0.022, 0.007, 0.01).multiplyScalar(s), M.Skin, l.skin.clone().multiply(new THREE.Color(0.85, 0.6, 0.6)), [['head', 1]], undefined, 10, 5);
  for (const sx of [-1, 1]) {
    B.blob(v(sx * 0.082, 1.665, -0.005), new THREE.Vector3(0.012, 0.03, 0.02).multiplyScalar(s), M.Skin, l.skin, [['head', 1]], undefined, 8, 6);
    B.blob(v(sx * 0.031, 1.69, 0.086), new THREE.Vector3(0.013, 0.008, 0.008).multiplyScalar(s), M.Eye, new THREE.Color(0.9, 0.88, 0.85), [['head', 1]], undefined, 8, 5);
    B.blob(v(sx * 0.031, 1.69, 0.092), new THREE.Vector3(0.006, 0.006, 0.004).multiplyScalar(s), M.Eye, new THREE.Color(0.06, 0.04, 0.03), [['head', 1]], undefined, 8, 5);
    B.blob(v(sx * 0.032, 1.708, 0.092), new THREE.Vector3(0.019, 0.004, 0.006).multiplyScalar(s), M.Hair, l.hair, [['head', 1]], undefined, 8, 4);
  }
  // hair: a cap over the skull (longer at the back for long hair)
  const hairR = hr.clone().addScalar(0.011 * s);
  B.blob(hc.clone().add(v(0, 0.006, -0.004)), hairR, M.Hair, l.hair, [['head', 1]], (p) => {
    const front = p.z / hairR.z, up = p.y / hairR.y;
    // hairline: high over the forehead, down past the ears at the sides, to the nape (or shoulders) at the back
    const side = Math.abs(p.x) / hairR.x;
    let limit: number;
    if (front > 0.25) limit = 0.48 - side * 0.25;
    else if (front > -0.3) limit = side > 0.8 ? -0.05 : 0.2;
    else limit = l.longHair ? -1.2 : -0.45;
    // below the hairline the shell tucks deep inside the skull, out of sight
    if (up < limit) p.multiplyScalar(0.72);
    if (l.longHair && up < -0.2 && front < 0.1) { p.y -= (-0.2 - up) * 0.15 * s; p.x *= 1.05; }
  }, 26, 18);
  if (l.longHair) B.blob(v(0, 1.52, -0.075), new THREE.Vector3(0.085, 0.13, 0.04).multiplyScalar(s), M.Hair, l.hair, [['head', 0.6], ['neck', 0.4]], undefined, 14, 10);

  // arms
  for (const side of ['L', 'R'] as const) {
    const ua = J[`ua${side}`], fa = J[`fa${side}`], hd = J[`hand${side}`];
    const sh = side === 'L' ? J.shL : J.shR;
    const sleeve = l.longSleeves || !!l.coat;
    const armRings = (a: THREE.Vector3, bb: THREE.Vector3, r0: number, r1: number, bone: BoneName, parent: BoneName, child: BoneName, n = 6) =>
      Array.from({ length: n }, (_, i) => {
        const t = i / (n - 1);
        const bulge = Math.sin(t * Math.PI) * 0.006;
        return { c: a.clone().lerp(bb, t), rx: (r0 + (r1 - r0) * t + bulge) * s * b, rz: (r0 + (r1 - r0) * t + bulge) * s * 1.05, w: limbW(t, parent, bone, child) };
      });
    const upStart = ua.clone().lerp(sh, 0.35).add(new THREE.Vector3(0, 0.015 * s, 0));
    B.loft(armRings(upStart, fa, 0.05, 0.039, `ua${side}`, 'chest', `fa${side}`), M.Cloth, top, 12, 2, true);
    B.loft(armRings(fa, hd, 0.038, 0.028, `fa${side}`, `ua${side}`, `hand${side}`), sleeve ? M.Cloth : M.Skin, sleeve ? top : l.skin, 12, 2, true);
    const hand = hd.clone().add(new THREE.Vector3(side === 'L' ? 0.008 : -0.008, -0.065, 0.01).multiplyScalar(s));
    B.blob(hand, new THREE.Vector3(0.022, 0.07, 0.044).multiplyScalar(s), M.Skin, l.skin, [[`hand${side}`, 1]], undefined, 10, 8);
  }
  // legs
  for (const side of ['L', 'R'] as const) {
    const th = J[`th${side}`], sn = J[`shin${side}`], ft = J[`foot${side}`];
    const legRings = (a: THREE.Vector3, bb: THREE.Vector3, r0: number, r1: number, bone: BoneName, parent: BoneName, child: BoneName, calf = 0) =>
      Array.from({ length: 7 }, (_, i) => {
        const t = i / 6;
        const bulge = calf * Math.exp(-Math.pow((t - 0.3) / 0.2, 2));
        return { c: a.clone().lerp(bb, t).add(new THREE.Vector3(0, 0, -bulge * 0.4 * s)), rx: (r0 + (r1 - r0) * t + bulge) * s * b, rz: (r0 + (r1 - r0) * t + bulge * 1.2) * s, w: limbW(t, parent, bone, child) };
      });
    const legC = l.skirt ? l.skin : l.legs;
    B.loft(legRings(th.clone().add(new THREE.Vector3(0, 0.05 * s, 0)), sn, 0.085, 0.052, `th${side}`, 'hips', `shin${side}`), l.skirt ? M.Skin : M.Cloth, legC, 14, 2, false);
    B.loft(legRings(sn, ft.clone().add(new THREE.Vector3(0, 0.02 * s, 0)), 0.05, 0.034, `shin${side}`, `th${side}`, `foot${side}`, 0.012), l.skirt ? M.Skin : M.Cloth, legC, 14, 2, false);
    // shoe: heel to toe, flat sole
    B.blob(ft.clone().add(new THREE.Vector3(0, -0.04 * s, 0.055 * s)), new THREE.Vector3(0.048, 0.05, 0.125).multiplyScalar(s), M.Shoe, l.shoes, [[`foot${side}`, 1]], (p) => {
      if (p.y < -0.035 * s) p.y = -0.035 * s;
      if (p.z > 0) p.y *= 0.75;
    }, 12, 8);
  }
  return B.build();
}

/* ---------- gait ---------- */
// sagittal joint angles (degrees) over one stride for one leg, p = 0 heel strike
const HIP = [25, 21, 14, 6, -1, -7, -11, -4, 12, 22];
const KNEE = [5, 16, 18, 11, 6, 8, 36, 60, 44, 14];
const ANKLE = [0, -6, 2, 6, 9, 4, -16, -8, 1, 2];
function cyc(tab: number[], p: number): number {
  const n = tab.length;
  const x = (((p % 1) + 1) % 1) * n;
  const i = Math.floor(x), t = x - i;
  const a = tab[(i - 1 + n) % n], b0 = tab[i], c = tab[(i + 1) % n], d = tab[(i + 2) % n];
  // Catmull-Rom through the samples
  return 0.5 * (2 * b0 + (-a + c) * t + (2 * a - 5 * b0 + 4 * c - d) * t * t + (-a + 3 * b0 - 3 * c + d) * t * t * t);
}
const D2R = Math.PI / 180;

let MATS: THREE.Material[] | null = null;
function materials(): THREE.Material[] {
  if (MATS) return MATS;
  const skin = surface(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }), { snow: 0.15, wet: 0.2 }, 'skin');
  const cloth = surface(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }), { snow: 0.4, wet: 0.7 }, 'cloth');
  const shoe = surface(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42 }), { snow: 0.6, wet: 0.3 }, 'shoe');
  const hair = surface(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78 }), { snow: 0.5, wet: 0.5 }, 'hair');
  const eye = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.15 });
  MATS = [skin, cloth, shoe, hair, eye];
  return MATS;
}

let UMBRELLA: THREE.Group | null = null;
function umbrella(color: THREE.Color): THREE.Group {
  if (!UMBRELLA) {
    UMBRELLA = new THREE.Group();
    const canopy = new THREE.ConeGeometry(0.52, 0.22, 8, 1, true);
    canopy.translate(0, 0.86, 0);
    const shaft = new THREE.CylinderGeometry(0.008, 0.008, 0.95, 5);
    shaft.translate(0, 0.42, 0);
    UMBRELLA.add(new THREE.Mesh(canopy), new THREE.Mesh(shaft, new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8, roughness: 0.3 })));
  }
  const g = UMBRELLA.clone(true);
  const m = surface(new THREE.MeshStandardMaterial({ color, roughness: 0.35, side: THREE.DoubleSide }), { snow: 0.8, wet: 0.1 }, 'umb');
  (g.children[0] as THREE.Mesh).material = m;
  g.children.forEach((c) => (c.castShadow = true));
  return g;
}

export type Pose = 'walk' | 'idle' | 'wait' | 'sit' | 'lie' | 'work' | 'carry' | 'pedal';

export class Person {
  root = new THREE.Group();
  mesh: THREE.SkinnedMesh;
  bones = {} as Record<BoneName, THREE.Bone>;
  look: Look;
  private phase = Math.random();
  private t = Math.random() * 100;
  private lookYaw = 0;
  private lookT = 0;
  private lookTarget = 0;
  private umb: THREE.Group;
  umbrellaUp = 0;
  stride: number;
  /** wants an umbrella when it rains */
  carriesUmbrella: boolean;

  constructor(look: Look) {
    this.look = look;
    const J = joints(look);
    for (const n of ORDER) {
      const b = new THREE.Bone();
      b.name = n;
      const p = PARENT[n];
      b.position.copy(p ? J[n].clone().sub(J[p]) : J[n]);
      this.bones[n] = b;
      if (p) this.bones[p].add(b);
    }
    const geo = buildBody(look);
    this.mesh = new THREE.SkinnedMesh(geo, materials());
    this.mesh.add(this.bones.root);
    this.mesh.bind(new THREE.Skeleton(ORDER.map((n) => this.bones[n])));
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
    this.stride = 1.32 * (look.height / 1.75);
    this.carriesUmbrella = Math.random() < 0.65;
    this.umb = umbrella(new THREE.Color().setHSL(Math.random(), 0.5, Math.random() < 0.4 ? 0.12 : 0.4));
    this.umb.visible = false;
    this.bones.handR.add(this.umb);
    this.umb.position.set(0, -0.06, 0.02);
  }

  /** advance the animation. `speed` m/s; `lookAt` (radians, body-relative) when waiting at a kerb */
  animate(dt: number, pose: Pose, speed: number, rain: number): void {
    this.t += dt;
    const B = this.bones;
    for (const n of ORDER) B[n].rotation.set(0, 0, 0);
    const h = this.look.height / 1.75;
    const walking = pose === 'walk' || pose === 'carry';
    const walkK = walking ? THREE.MathUtils.clamp(speed / 1.2, 0, 1.3) : 0;
    if (walking) this.phase += (speed / this.stride) * dt;
    const p = this.phase;
    const amp = Math.min(1.15, 0.55 + walkK * 0.5);

    if (walkK > 0.02) {
      for (const [side, off] of [['L', 0], ['R', 0.5]] as const) {
        const q = p + off;
        const sgn = side === 'L' ? 1 : -1;
        B[`th${side}`].rotation.x = -cyc(HIP, q) * D2R * amp;
        B[`shin${side}`].rotation.x = cyc(KNEE, q) * D2R * amp;
        B[`foot${side}`].rotation.x = -cyc(ANKLE, q) * D2R * amp;
        B[`th${side}`].rotation.z = sgn * 0.03;
        // arms swing opposite the leg on the same side, elbows flex more going forward
        const swing = cyc(HIP, q + 0.5) * 0.75 * amp;
        B[`ua${side}`].rotation.x = -swing * D2R;
        B[`ua${side}`].rotation.z = sgn * 0.09;
        B[`fa${side}`].rotation.x = -(12 + Math.max(0, swing) * 0.8) * D2R;
      }
      const tw = Math.PI * 2 * p;
      B.hips.position.y = 0.95 * h + Math.cos(tw * 2) * 0.022 * amp - 0.012;
      B.hips.position.x = Math.sin(tw) * 0.022 * amp;
      B.hips.rotation.y = Math.sin(tw) * 0.08 * amp;
      B.hips.rotation.z = Math.sin(tw) * 0.035 * amp;
      B.chest.rotation.y = -Math.sin(tw) * 0.11 * amp;
      B.spine.rotation.x = 0.05 + walkK * 0.03;
      B.head.rotation.y = Math.sin(tw) * 0.04;
      B.head.rotation.x = -0.05;
    } else {
      // idle: breathing, a slow weight shift, hands relaxed
      const br = Math.sin(this.t * 1.6);
      B.hips.position.y = 0.95 * h;
      B.hips.position.x = Math.sin(this.t * 0.35) * 0.025;
      B.hips.rotation.z = Math.sin(this.t * 0.35) * 0.04;
      B.spine.rotation.z = -Math.sin(this.t * 0.35) * 0.03;
      B.chest.rotation.x = br * 0.015;
      for (const [side, sgn] of [['L', 1], ['R', -1]] as const) {
        B[`ua${side}`].rotation.z = sgn * (0.08 + br * 0.006);
        B[`fa${side}`].rotation.x = -0.18;
        B[`th${side}`].rotation.x = side === 'L' ? Math.sin(this.t * 0.35) * 0.04 : -Math.sin(this.t * 0.35) * 0.04;
        B[`shin${side}`].rotation.x = 0.05;
      }
    }
    if (pose === 'carry') {
      // V2 (Milestone 8): a load held in front, both arms up under it, leaning back a touch
      for (const side of ['L', 'R'] as const) {
        B[`ua${side}`].rotation.x = -0.75;
        B[`ua${side}`].rotation.z = side === 'L' ? 0.16 : -0.16;
        B[`fa${side}`].rotation.x = -0.85;
      }
      B.spine.rotation.x = -0.04;
    } else if (pose === 'work') {
      // V2 (Milestone 8): at work on a site: feet planted, bent to the job, the right arm swinging the hammer
      // down in a steady beat, the left steadying the work
      const beat = (this.t * 1.35 + this.phase) % 1;
      const swing = beat < 0.55 ? THREE.MathUtils.smoothstep(beat / 0.55, 0, 1) : 1 - THREE.MathUtils.smoothstep((beat - 0.55) / 0.12, 0, 1);
      B.hips.position.y = 0.92 * h;
      B.spine.rotation.x = 0.28;
      B.chest.rotation.x = 0.08;
      B.head.rotation.x = 0.25;
      B.thL.rotation.x = -0.22; B.shinL.rotation.x = 0.3;
      B.thR.rotation.x = 0.1; B.shinR.rotation.x = 0.2;
      B.uaR.rotation.x = -0.5 - swing * 1.6; B.uaR.rotation.z = -0.12;
      B.faR.rotation.x = -0.4 - swing * 0.7;
      B.uaL.rotation.x = -0.7; B.uaL.rotation.z = 0.2;
      B.faL.rotation.x = -0.6;
    }
    if (pose === 'pedal') {
      // V2 (Milestone 8): on a bike: perched on the saddle, leaning to the bars, legs going round with the cranks
      // (`speed` here is the crank angle, radians)
      B.hips.position.y = 0.52 * h;
      B.spine.rotation.x = 0.5;
      B.head.rotation.x = -0.35;
      for (const [side, ph] of [['L', 0], ['R', Math.PI]] as const) {
        const c = Math.sin(speed + ph);
        B[`th${side}`].rotation.x = -1.05 - c * 0.4;
        B[`shin${side}`].rotation.x = 0.95 + c * 0.45;
        B[`foot${side}`].rotation.x = -0.15;
        B[`ua${side}`].rotation.x = -0.95;
        B[`ua${side}`].rotation.z = side === 'L' ? 0.12 : -0.12;
        B[`fa${side}`].rotation.x = -0.25;
      }
    }
    if (pose === 'sit') {
      // on a bench: thighs level, shins down, hands in the lap
      B.hips.position.y = 0.5 * h;
      for (const [side, sgn] of [['L', 1], ['R', -1]] as const) {
        B[`th${side}`].rotation.x = -1.5;
        B[`shin${side}`].rotation.x = 1.45;
        B[`foot${side}`].rotation.x = 0.05;
        B[`ua${side}`].rotation.x = -0.35;
        B[`ua${side}`].rotation.z = sgn * 0.05;
        B[`fa${side}`].rotation.x = -0.9;
      }
      B.spine.rotation.x = -0.05;
    } else if (pose === 'lie') {
      // stretched out (the caller tips the whole body flat)
      B.hips.position.y = 0.95 * h;
      for (const [side, sgn] of [['L', 1], ['R', -1]] as const) {
        B[`ua${side}`].rotation.z = sgn * 0.5;
        B[`fa${side}`].rotation.x = -0.2;
        B[`th${side}`].rotation.z = sgn * 0.08;
      }
    }
    // looking around: both ways at the kerb, the odd glance otherwise
    this.lookT -= dt;
    if (this.lookT <= 0) {
      if (pose === 'wait') { this.lookTarget = this.lookTarget > 0 ? -0.9 : 0.9; this.lookT = 1.2 + Math.random() * 1.2; }
      else { this.lookTarget = Math.random() < 0.7 ? 0 : (Math.random() - 0.5) * 1.1; this.lookT = 2 + Math.random() * 4; }
    }
    this.lookYaw += (this.lookTarget - this.lookYaw) * Math.min(1, dt * 4);
    B.neck.rotation.y += this.lookYaw * 0.45;
    B.head.rotation.y += this.lookYaw * 0.55;

    // umbrella in the rain
    const want = rain > 0.25 && this.carriesUmbrella ? 1 : 0;
    this.umbrellaUp += (want - this.umbrellaUp) * Math.min(1, dt * 2.5);
    this.umb.visible = this.umbrellaUp > 0.05;
    if (this.umb.visible) {
      const k = this.umbrellaUp;
      B.uaR.rotation.x = THREE.MathUtils.lerp(B.uaR.rotation.x, -0.55, k);
      B.uaR.rotation.z = THREE.MathUtils.lerp(B.uaR.rotation.z, -0.25, k);
      B.faR.rotation.x = THREE.MathUtils.lerp(B.faR.rotation.x, -1.45, k);
      // keep the canopy upright over the head
      this.umb.rotation.set(-(B.uaR.rotation.x + B.faR.rotation.x) - 0.05, 0, -B.uaR.rotation.z - 0.25);
      this.umb.scale.setScalar(Math.max(0.01, k));
    }
  }
}

/* ---------- a random villager ---------- */
const SKINS = ['#f3d2b8', '#e8b994', '#d29f7a', '#b07a55', '#8a5a3c', '#5c3b28'];
const HAIRS = ['#1b1512', '#3a2618', '#5e3c22', '#8a6038', '#b89a6a', '#d8d0c4', '#7a2e16'];
const TOPS = ['#2c3e5a', '#7a2a2a', '#e8e4da', '#3c5a3a', '#5a4a6a', '#c8a24a', '#1e1e22', '#8aa0b8', '#b85a3a', '#4a6a8a', '#d8c8b0'];
const LEGS = ['#1e2a40', '#2a2a2e', '#4a3e34', '#6a6a70', '#20304a', '#7a6a50'];
const SHOES = ['#141414', '#3a2a1e', '#e8e8e8', '#5a4030', '#22263a'];
const COATS = ['#2a2e36', '#5a3a2a', '#7a2a2a', '#3a4a3a', '#1e2a40', '#8a7a62'];

export function randomLook(rand: () => number, winter = false): Look {
  const pick = <T,>(a: T[]): T => a[Math.floor(rand() * a.length)];
  const c = (h: string): THREE.Color => new THREE.Color(h);
  const female = rand() < 0.5;
  const kid = rand() < 0.12;
  const height = kid ? 1.15 + rand() * 0.3 : female ? 1.58 + rand() * 0.16 : 1.68 + rand() * 0.2;
  const hairC = rand() < 0.15 ? c('#cfc8be') : c(pick(HAIRS));
  return {
    height, female,
    build: 0.92 + rand() * 0.2,
    skin: c(pick(SKINS)),
    hair: hairC,
    top: c(pick(TOPS)),
    legs: c(pick(LEGS)),
    shoes: c(pick(SHOES)),
    longHair: female ? rand() < 0.7 : rand() < 0.05,
    longSleeves: winter || rand() < 0.55,
    skirt: female && !winter && rand() < 0.3,
    coat: winter || rand() < 0.15 ? c(pick(COATS)) : undefined,
  };
}

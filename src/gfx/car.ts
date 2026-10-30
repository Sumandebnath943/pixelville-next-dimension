/* ============================================================
   Cars: bodies extruded from real side profiles (wheel arches
   cut in, bevelled edges, tumblehome, plan-view taper), a glass
   greenhouse with painted roof and pillars, clear-coat metallic
   paint, multi-part wheels that spin and steer, head/tail/brake
   lights and indicators, and a sprung body that dives under
   braking, squats when pulling away and rolls in corners.
   ============================================================ */
import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { surface } from './surface';
import { ENV, MAX_BEAMS } from './env';
import { ModelCar, pickModel, seedOf, vehicleModel } from './vehicle';

/** (the old lamp materials a modelled car leaves unused) */
const DARK = new THREE.MeshStandardMaterial({ color: 0x000000 });

export type CarStyle = 'hatch' | 'sedan' | 'suv' | 'estate';
interface Dim { L: number; WB: number; W: number; H: number; belt: number; hood: number; deck: number; hoodLen: number; screen: number; rear: 'notch' | 'hatch' | 'estate'; wheelR: number; clearance: number }
const DIMS: Record<CarStyle, Dim> = {
  hatch: { L: 4.05, WB: 2.55, W: 1.76, H: 1.47, belt: 0.95, hood: 0.84, deck: 0.95, hoodLen: 0.95, screen: 0.78, rear: 'hatch', wheelR: 0.31, clearance: 0.17 },
  sedan: { L: 4.65, WB: 2.78, W: 1.82, H: 1.44, belt: 0.93, hood: 0.8, deck: 0.98, hoodLen: 1.2, screen: 0.8, rear: 'notch', wheelR: 0.32, clearance: 0.16 },
  estate: { L: 4.75, WB: 2.8, W: 1.82, H: 1.5, belt: 0.95, hood: 0.82, deck: 0.95, hoodLen: 1.15, screen: 0.78, rear: 'estate', wheelR: 0.32, clearance: 0.17 },
  suv: { L: 4.55, WB: 2.7, W: 1.88, H: 1.7, belt: 1.08, hood: 0.98, deck: 1.08, hoodLen: 1.05, screen: 0.72, rear: 'estate', wheelR: 0.36, clearance: 0.22 },
};

/** the lower body's side outline with wheel arches */
function bodyShape(d: Dim): THREE.Shape {
  const L2 = d.L / 2, w2 = d.WB / 2, r = d.wheelR, ra = r + 0.06;
  const y0 = d.clearance + 0.08;
  const s = new THREE.Shape();
  s.moveTo(L2 - 0.12, y0);
  s.quadraticCurveTo(L2 + 0.02, y0 + 0.02, L2, 0.45);
  s.quadraticCurveTo(L2 + 0.01, d.hood - 0.08, L2 - 0.08, d.hood);
  s.quadraticCurveTo(L2 - d.hoodLen * 0.5, d.hood + 0.08, L2 - d.hoodLen, d.belt);
  if (d.rear === 'notch') {
    s.lineTo(-L2 + 0.85, d.belt + 0.02);
    s.quadraticCurveTo(-L2 + 0.25, d.deck + 0.02, -L2 + 0.05, d.deck - 0.06);
  } else s.lineTo(-L2 + 0.12, d.deck);
  s.quadraticCurveTo(-L2 - 0.03, d.deck - 0.2, -L2, 0.5);
  s.quadraticCurveTo(-L2 - 0.01, y0 + 0.02, -L2 + 0.12, y0);
  // bottom edge, rear to front, rising over each wheel
  const k = Math.asin((r - y0) / ra);
  for (const cz of [-w2, w2]) {
    s.lineTo(cz - ra * Math.cos(k), y0);
    s.absarc(cz, r, ra, Math.PI + k, -k, true);
  }
  s.lineTo(L2 - 0.12, y0);
  return s;
}
function cabinShape(d: Dim): { s: THREE.Shape; zA: number; zC: number; zB: number } {
  const L2 = d.L / 2;
  const zA = L2 - d.hoodLen;
  const zTopF = zA - d.screen;
  let zC: number, zTopR: number;
  if (d.rear === 'notch') { zC = -L2 + 0.85; zTopR = zC + 0.62; }
  else if (d.rear === 'hatch') { zC = -L2 + 0.12; zTopR = zC + 0.38; }
  else { zC = -L2 + 0.12; zTopR = zC + 0.15; }
  const s = new THREE.Shape();
  s.moveTo(zA + 0.02, d.belt - 0.04);
  s.quadraticCurveTo(zA - d.screen * 0.5, (d.belt + d.H) / 2 + 0.05, zTopF, d.H - 0.02);
  s.quadraticCurveTo((zTopF + zTopR) / 2, d.H + 0.035, zTopR, d.H - 0.03);
  s.quadraticCurveTo(zC + 0.04, (d.belt + d.H) / 2 + 0.06, zC, d.belt - 0.04);
  s.lineTo(zA + 0.02, d.belt - 0.04);
  return { s, zA, zC, zB: (zA - d.screen + zTopR) / 2 + 0.1 };
}

/** extrude a side profile across the car's width, centred on x = 0 */
function extrudeAcross(shape: THREE.Shape, width: number, bevel: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 3, curveSegments: 18 });
  g.rotateY(-Math.PI / 2);
  g.translate((width - bevel * 2) / 2, 0, 0);
  return g.index ? g.toNonIndexed() : g;
}

interface Models { paint: THREE.BufferGeometry; glass: THREE.BufferGeometry; trim: THREE.BufferGeometry; chrome: THREE.BufferGeometry; head: THREE.BufferGeometry; bulb: THREE.BufferGeometry; drl: THREE.BufferGeometry; tail: THREE.BufferGeometry; plate: THREE.BufferGeometry; dims: Dim; headAt: [number, number, number][]; beamAt: [number, number, number] }
const CACHE = new Map<CarStyle, Models>();

function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = list.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const a of Object.keys(n.attributes)) if (a !== 'position' && a !== 'normal') n.deleteAttribute(a);
    return n;
  });
  const pos: number[] = [], nor: number[] = [];
  for (const g of out) {
    pos.push(...(g.attributes.position.array as Float32Array));
    nor.push(...(g.attributes.normal.array as Float32Array));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.computeBoundingSphere();
  return g;
}
const boxAt = (sx: number, sy: number, sz: number, x: number, y: number, z: number, rx = 0): THREE.BufferGeometry => {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  if (rx) g.rotateX(rx);
  return g.translate(x, y, z);
};
/** a lamp lens: a rounded rectangle w × h, `depth` deep, its face towards +z, turned `ry` about y and tipped `rx`, at (x, y, z) */
export function lamp(w: number, h: number, depth: number, r: number, x: number, y: number, z: number, ry: number, rx: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  r = Math.min(r, h / 2, w / 2);
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r);
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r);
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  const bev = Math.min(0.012, depth * 0.4);
  const g = new THREE.ExtrudeGeometry(s, { depth: depth - bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev * 0.7, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -depth);
  g.rotateX(rx);
  g.rotateY(ry);
  return g.translate(x, y, z);
}

/* V2: headlamps laid on the nose itself. They used to be blocks set a few centimetres inside the bodywork (the
   bevelled panels stand proud of the side profile), so only scraps of lens and half-buried bulbs showed through
   the paint. Now the front of the body is found by looking straight back at it (-z), and each part of the lamp
   follows the paint (its curve, the bevel round the corner, the bonnet's droop) a few millimetres proud. */
export type Nose = (x: number, y: number) => { z: number; n: THREE.Vector3 };
/** where the body's front is at (x, y) seen from ahead, and which way it faces there (between heights y0 and y1) */
export function noseOf(body: THREE.BufferGeometry, zMin: number, y0: number, y1: number): Nose {
  const p = body.attributes.position.array, nr = body.attributes.normal.array;
  const tris: number[] = [];
  for (let i = 0; i < p.length; i += 9) {
    if (Math.max(p[i + 2], p[i + 5], p[i + 8]) < zMin || Math.max(p[i + 1], p[i + 4], p[i + 7]) < y0 || Math.min(p[i + 1], p[i + 4], p[i + 7]) > y1) continue;
    // (facing forward: the front, not the panel behind it)
    if (nr[i + 2] + nr[i + 5] + nr[i + 8] > 0) tris.push(i);
  }
  const seen = new Map<string, { z: number; n: THREE.Vector3 }>();
  return (x, y) => {
    const key = `${Math.round(x * 1e5)},${Math.round(y * 1e5)}`;
    const hit = seen.get(key);
    if (hit) return hit;
    let best = -Infinity, bi = -1, bu = 0, bv = 0;
    for (const i of tris) {
      const ax = p[i], ay = p[i + 1], bx = p[i + 3], by = p[i + 4], cx = p[i + 6], cy = p[i + 7];
      const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(den) < 1e-12) continue;
      const u = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / den;
      const v = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / den;
      if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
      const z = u * p[i + 2] + v * p[i + 5] + (1 - u - v) * p[i + 8];
      if (z > best) { best = z; bi = i; bu = u; bv = v; }
    }
    const out = { z: bi < 0 ? zMin : best, n: new THREE.Vector3(0, 0, 1) };
    if (bi >= 0) {
      const w = 1 - bu - bv;
      for (let k = 0; k < 3; k++) out.n.setComponent(k, bu * nr[bi + k] + bv * nr[bi + 3 + k] + w * nr[bi + 6 + k]);
      out.n.normalize();
    }
    seen.set(key, out);
    return out;
  };
}
/** flat shapes drawn in front view (x, y), laid on the nose `lift` metres proud of the paint */
export class NoseLayer {
  private pos: number[] = [];
  private nor: number[] = [];
  constructor(private nose: Nose, private lift: number) {}
  private put(q: THREE.Vector2): void {
    const s = this.nose(q.x, q.y), l = this.lift;
    this.pos.push(q.x + s.n.x * l, q.y + s.n.y * l, s.z + s.n.z * l);
    this.nor.push(s.n.x, s.n.y, s.n.z);
  }
  /** a triangle facing out of the nose, whichever way round its corners come */
  private tri(a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2): void {
    const cw = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) < 0;
    this.put(a);
    this.put(cw ? c : b);
    this.put(cw ? b : c);
  }
  /** a closed outline, filled from its middle in rings that close up towards the edge (where a lens wraps the corner) */
  fill(ring: THREE.Vector2[]): this {
    const c = new THREE.Vector2();
    for (const q of ring) c.add(q);
    c.divideScalar(ring.length);
    const rings = [0.4, 0.66, 0.84, 0.94, 1].map((f) => ring.map((q) => c.clone().lerp(q, f)));
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      this.tri(c, rings[0][i], rings[0][j]);
      for (let k = 1; k < rings.length; k++) {
        this.tri(rings[k - 1][i], rings[k][i], rings[k][j]);
        this.tri(rings[k - 1][i], rings[k][j], rings[k - 1][j]);
      }
    }
    return this;
  }
  /** the strip between two matching outlines, along the steps where `keep` holds at both ends */
  band(inner: THREE.Vector2[], outer: THREE.Vector2[], keep: boolean[]): this {
    for (let i = 0; i < inner.length; i++) {
      const j = (i + 1) % inner.length;
      if (!keep[i] || !keep[j]) continue;
      this.tri(inner[i], outer[i], outer[j]);
      this.tri(inner[i], outer[j], inner[j]);
    }
    return this;
  }
  geo(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    return g;
  }
}
/** a headlamp's outline: u runs from the grille end (-a) to the wing end (+a), v up. A rounded slot, slimmer at
 *  the grille end and swept up towards the wing, as an even ring of points (anticlockwise) */
export function lampSlot(a: number, b: number, n = 72): THREE.Vector2[] {
  const dense: THREE.Vector2[] = [];
  for (let i = 0; i < 480; i++) {
    const t = (i / 480) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
    dense.push(sweep(a, Math.sign(c) * a * Math.abs(c) ** 0.45, Math.sign(s) * b * Math.abs(s) ** 0.45));
  }
  // even steps round it
  const cum = [0];
  for (let i = 1; i <= dense.length; i++) cum.push(cum[i - 1] + dense[i % dense.length].distanceTo(dense[i - 1]));
  const out: THREE.Vector2[] = [];
  for (let k = 0, j = 0; k < n; k++) {
    const s = (k / n) * cum[dense.length];
    while (cum[j + 1] < s) j++;
    out.push(dense[j].clone().lerp(dense[(j + 1) % dense.length], (s - cum[j]) / (cum[j + 1] - cum[j] || 1)));
  }
  return out;
}
/** the slot's shape at (u, v): slimmer towards the grille end, swept up towards the wing */
export function sweep(a: number, u: number, v: number): THREE.Vector2 {
  return new THREE.Vector2(u, v * (0.78 + 0.11 * (u / a + 1)) + 0.022 * (u / a));
}
/** an anticlockwise outline moved `d` metres outwards (inwards when negative), square to its smoothed edge */
export function grow(ring: THREE.Vector2[], d: number): THREE.Vector2[] {
  const n = ring.length;
  return ring.map((q, i) => {
    const t = ring[(i + 3) % n].clone().sub(ring[(i - 3 + n) % n]).normalize();
    return new THREE.Vector2(q.x + t.y * d, q.y - t.x * d);
  });
}
/** a circle of radius r round (u, v), anticlockwise */
export function circle(u: number, v: number, r: number, n = 24): THREE.Vector2[] {
  return Array.from({ length: n }, (_, i) => new THREE.Vector2(u + Math.cos((i / n) * Math.PI * 2) * r, v + Math.sin((i / n) * Math.PI * 2) * r));
}

function models(style: CarStyle): Models {
  const hit = CACHE.get(style);
  if (hit) return hit;
  const d = DIMS[style];
  const L2 = d.L / 2, hw = d.W / 2;

  // lower body: tumblehome and rounded plan
  let body = extrudeAcross(bodyShape(d), d.W, 0.07);
  const p = body.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), z = p.getZ(i);
    let k = 1;
    k *= 1 - 0.05 * THREE.MathUtils.smoothstep(y, 0.55, d.belt + 0.05);
    k *= 1 - 0.04 * (1 - THREE.MathUtils.smoothstep(y, d.clearance, 0.45));
    const ez = THREE.MathUtils.smoothstep(Math.abs(z), L2 - 0.95, L2);
    k *= 1 - 0.045 * ez * ez;
    p.setX(i, p.getX(i) * k);
    // hood and boot curve down towards their edges
    if (y > d.hood - 0.15) p.setY(i, y - 0.03 * Math.pow(Math.abs(p.getX(i)) / hw, 2));
  }
  // smooth panels, crisp folds
  body = toCreasedNormals(body, 0.75);

  // greenhouse: split into glass and painted roof / pillars
  const cab = cabinShape(d);
  let gh = extrudeAcross(cab.s, d.W - 0.2, 0.06);
  const gp = gh.attributes.position;
  for (let i = 0; i < gp.count; i++) {
    const y = gp.getY(i), z = gp.getZ(i);
    const t = THREE.MathUtils.clamp((y - d.belt) / (d.H - d.belt), 0, 1);
    let k = 1 - 0.17 * t;
    k *= 1 - 0.05 * THREE.MathUtils.smoothstep(Math.abs(z), L2 - 1.8, L2);
    gp.setX(i, gp.getX(i) * k);
  }
  gh = toCreasedNormals(gh, 0.75);
  const gPos: number[] = [], gNor: number[] = [], rPos: number[] = [], rNor: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  const gn = gh.attributes.normal;
  for (let i = 0; i < gp.count; i += 3) {
    a.fromBufferAttribute(gp, i); b.fromBufferAttribute(gp, i + 1); c.fromBufferAttribute(gp, i + 2);
    n.subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    const cz = (a.z + b.z + c.z) / 3, cy = (a.y + b.y + c.y) / 3, cx = (a.x + b.x + c.x) / 3;
    const side = Math.abs(n.x) > 0.55;
    const roof = n.y > 0.8 && cy > d.H - 0.12;
    const bPillar = side && Math.abs(cz - cab.zB) < 0.07;
    const cPillar = side && d.rear === 'notch' && cz < cab.zC + 0.32;
    const aPillar = Math.abs(cx) > (d.W - 0.2) / 2 * 0.72 && !side && cz > cab.zB;
    const dPillar = side && d.rear !== 'notch' && cz < cab.zC + 0.2;
    const paint = roof || bPillar || cPillar || aPillar || dPillar || cy < d.belt + 0.035;
    const P = paint ? rPos : gPos, N = paint ? rNor : gNor;
    for (let k = 0; k < 3; k++) {
      P.push(gp.getX(i + k), gp.getY(i + k), gp.getZ(i + k));
      N.push(gn.getX(i + k), gn.getY(i + k), gn.getZ(i + k));
    }
  }
  const roofG = new THREE.BufferGeometry();
  roofG.setAttribute('position', new THREE.Float32BufferAttribute(rPos, 3));
  roofG.setAttribute('normal', new THREE.Float32BufferAttribute(rNor, 3));
  const glass = new THREE.BufferGeometry();
  glass.setAttribute('position', new THREE.Float32BufferAttribute(gPos, 3));
  glass.setAttribute('normal', new THREE.Float32BufferAttribute(gNor, 3));

  // mirrors, handles: paint; bumpers, sills, grille: black trim; strips: chrome
  const paintParts = [body, roofG];
  for (const sx of [-1, 1]) {
    paintParts.push(boxAt(0.2, 0.11, 0.12, sx * (hw + 0.06), d.belt + 0.08, cab.zA - 0.08));
    for (const z of [cab.zB + 0.55, cab.zB - 0.45]) paintParts.push(boxAt(0.03, 0.03, 0.16, sx * (hw - 0.035), d.belt - 0.08, z));
  }
  const trim = [
    boxAt(d.W * 0.9, 0.17, 0.16, 0, d.clearance + 0.17, L2 - 0.02),
    boxAt(d.W * 0.9, 0.17, 0.16, 0, d.clearance + 0.17, -L2 + 0.02),
    boxAt(d.W * 0.42, 0.13, 0.06, 0, 0.58, L2 + 0.0),
  ];
  for (const sx of [-1, 1]) {
    trim.push(boxAt(0.05, 0.1, d.WB - 0.85, sx * (hw - 0.07), d.clearance + 0.1, 0));
    trim.push(boxAt(0.05, 0.04, 0.2, sx * (hw + 0.07), d.belt + 0.03, cab.zA - 0.12));
  }
  const chrome: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) chrome.push(boxAt(0.012, 0.018, cab.zA - cab.zC - 0.1, sx * (hw - 0.085), d.belt - 0.035, (cab.zA + cab.zC) / 2));
  // V2 (Milestone 8): lamp units, not glowing boxes: a slim lens swept up towards the wing in a dark seam, two small
  // projector bulbs in it and a running-light strip along its lower edge and round its outer end (the hot spots are
  // small, so they glare like real lamps instead of blooming into a white slab), all laid on the paint (see noseOf);
  // tail lamps are rounded clusters with a brighter inner bar
  const head: THREE.BufferGeometry[] = [], bulb: THREE.BufferGeometry[] = [], drl: THREE.BufferGeometry[] = [], tail: THREE.BufferGeometry[] = [];
  const headAt: [number, number, number][] = [];
  const hy = d.hood - 0.15, hc = hw - 0.3, LA = 0.2, LB = 0.065;
  const nose = noseOf(body, L2 - 0.5, hy - 0.2, hy + 0.2);
  const slot = lampSlot(LA, LB);
  const strip = slot.map((q) => q.y < -LB * 0.25 || q.x > LA * 0.62);
  for (const sx of [-1, 1]) {
    const at = (r: THREE.Vector2[]): THREE.Vector2[] => r.map((q) => new THREE.Vector2(sx * (hc + q.x), hy + q.y));
    trim.push(new NoseLayer(nose, 0.004).fill(at(grow(slot, 0.012))).geo());
    head.push(new NoseLayer(nose, 0.008).fill(at(slot)).geo());
    drl.push(new NoseLayer(nose, 0.011).band(at(grow(slot, -0.017)), at(grow(slot, -0.007)), strip).geo());
    const lit = new NoseLayer(nose, 0.011);
    for (const k of [-1, 1]) {
      const c = sweep(LA, k * 0.085, 0.012);
      lit.fill(at(circle(c.x, c.y, 0.031)));
    }
    bulb.push(lit.geo());
    const mid = hy + sweep(LA, 0, 0).y;
    headAt.push([sx * hc, mid, nose(sx * hc, mid).z + 0.02]);
    const tx = sx * (hw - 0.25), ty = d.deck - 0.21, tz = -L2 + 0.02;
    tail.push(lamp(0.36, 0.15, 0.04, 0.045, tx, ty, tz, Math.PI - sx * 0.22, 0.2));
  }
  const plate = merge([boxAt(0.52, 0.12, 0.02, 0, 0.42, L2 + 0.04), boxAt(0.52, 0.12, 0.02, 0, d.deck - 0.4, -L2 - 0.02)]);
  const beamAt: [number, number, number] = [0, hy, (headAt[0][2] + headAt[1][2]) / 2 + 0.03];
  const m: Models = { paint: merge(paintParts), glass, trim: merge(trim), chrome: merge(chrome), head: merge(head), bulb: merge(bulb), drl: merge(drl), tail: merge(tail), plate, dims: d, headAt, beamAt };
  m.glass.computeBoundingSphere();
  CACHE.set(style, m);
  return m;
}

/* ---------- wheels ---------- */
let WHEEL: { tyre: THREE.BufferGeometry; rim: THREE.BufferGeometry } | null = null;
function wheelGeo(): NonNullable<typeof WHEEL> {
  if (WHEEL) return WHEEL;
  // tyre cross-section lathed around the axle (unit radius, scaled per car)
  const prof: THREE.Vector2[] = [];
  const w = 0.62, rIn = 0.66;
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const a = -Math.PI / 2 + t * Math.PI;
    prof.push(new THREE.Vector2(rIn + (1 - rIn) * (0.82 + 0.18 * Math.cos(a)) , Math.sin(a) * w / 2));
  }
  prof.unshift(new THREE.Vector2(rIn, -w / 2));
  prof.push(new THREE.Vector2(rIn, w / 2));
  const tyre = new THREE.LatheGeometry(prof, 28);
  tyre.rotateZ(Math.PI / 2);
  // rim: dish, hub and five spokes
  const parts: THREE.BufferGeometry[] = [];
  parts.push(new THREE.CylinderGeometry(rIn, rIn, w * 0.8, 24, 1, true).rotateZ(Math.PI / 2));
  parts.push(new THREE.CylinderGeometry(0.16, 0.18, 0.12, 12).rotateZ(Math.PI / 2).translate(w * 0.28, 0, 0));
  for (let k = 0; k < 5; k++) {
    const sp = new THREE.BoxGeometry(0.08, rIn - 0.12, 0.13);
    sp.translate(0, (rIn - 0.12) / 2 + 0.12, 0);
    sp.rotateX((k / 5) * Math.PI * 2);
    sp.translate(w * 0.3, 0, 0);
    parts.push(sp);
  }
  const rim = merge(parts);
  WHEEL = { tyre: tyre.toNonIndexed(), rim };
  return WHEEL;
}

/* ---------- materials ---------- */
let SHARED: { glass: THREE.Material; trim: THREE.Material; chrome: THREE.Material; tyre: THREE.Material; rim: THREE.Material; plate: THREE.Material } | null = null;
function shared(): NonNullable<typeof SHARED> {
  if (SHARED) return SHARED;
  SHARED = {
    glass: surface(new THREE.MeshPhysicalMaterial({ color: 0x06090c, roughness: 0.03, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.02 }), { snow: 0.4, wet: 0.1 }, 'carGlass'),
    trim: surface(new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.6 }), { snow: 0.6, wet: 0.4 }, 'carTrim'),
    chrome: new THREE.MeshStandardMaterial({ color: 0xd0d4d8, roughness: 0.12, metalness: 1 }),
    tyre: surface(new THREE.MeshStandardMaterial({ color: 0x101012, roughness: 0.88 }), { snow: 0.3, wet: 0.6 }, 'tyre'),
    rim: surface(new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.25, metalness: 0.9 }), { snow: 0.3, wet: 0.2 }, 'rim'),
    plate: new THREE.MeshStandardMaterial({ color: 0xf2f0e6, roughness: 0.4 }),
  };
  return SHARED;
}

/* ---------- V2: headlamp beams ----------
   A lit car's headlamps light what is in front of it through the surface shader (gfx/surface.ts): the road in its
   own colour (lane paint brighter than tarmac, a wet road shining), the kerb, a wall, a person, the car ahead, on
   any slope. They used to lay a bright square of light flat on the road, which ignored all of that and showed its
   edges. The lamps nearest the eye go to the shaders each frame. */
const BEAMS = new Map<THREE.Object3D, [number, number, number, number]>();
/** the lamp pair at (x, y, z) in `o`'s frame, shining along its +z, lights the street this frame (`k` how strongly) */
export function addBeam(o: THREE.Object3D, x: number, y: number, z: number, k = 1): void {
  BEAMS.set(o, [x, y, z, k]);
}
/** a dipped beam's strength (candela-like, against the street lamps' 11) */
const BEAM_CD = 28000;
const _bv = new THREE.Vector3();
/** send the lamps nearest `eye` to the shaders, at most `cap` (`k` how strong beams look now: 0 by day), and start
 *  the next frame's list */
export function flushBeams(eye: THREE.Vector3, k: number, cap = MAX_BEAMS): void {
  const near: { o: THREE.Object3D; p: THREE.Vector3; k: number; d: number }[] = [];
  if (k > 0.001)
    for (const [o, [x, y, z, s]] of BEAMS) {
      if (!shown(o)) continue;
      o.updateWorldMatrix(true, false);
      const p = new THREE.Vector3(x, y, z).applyMatrix4(o.matrixWorld);
      near.push({ o, p, k: s, d: p.distanceToSquared(eye) });
    }
  BEAMS.clear();
  near.sort((a, b) => a.d - b.d);
  const n = Math.min(near.length, cap, MAX_BEAMS);
  // V2: only the nearest few beams reach the shaders. When one more car came nearer, the farthest's pool of light
  // went out at once, and the road went dark in a patch as if something had cast a shadow over it: the farthest
  // fade out as the next car closes in, so a beam comes and goes gently
  const edge = near.length > n ? Math.sqrt(near[n].d) : Infinity;
  for (let i = 0; i < n; i++) {
    const { o, p, k: s } = near[i], e = o.matrixWorld.elements;
    const fade = edge === Infinity ? 1 : 1 - THREE.MathUtils.smoothstep(Math.sqrt(near[i].d), edge * 0.7, edge);
    ENV.beamP.value[i].set(p.x, p.y, p.z, BEAM_CD * k * s * fade);
    _bv.set(e[8], e[9], e[10]).normalize();
    ENV.beamF.value[i].set(_bv.x, _bv.y, _bv.z, 0);
    _bv.set(-e[0], -e[1], -e[2]).normalize(); // (a car's right hand is its -x)
    ENV.beamR.value[i].set(_bv.x, _bv.y, _bv.z, 0);
  }
  ENV.beamN.value = n;
}
/** drawn this frame: it and everything it hangs from are visible, up to the scene */
function shown(o: THREE.Object3D): boolean {
  for (let q: THREE.Object3D | null = o; q; q = q.parent) {
    if (!q.visible) return false;
    if ((q as THREE.Scene).isScene) return true;
  }
  return false;
}

/* ---------- V2 (Milestone 8): the glare of a lit headlamp, brightest seen from in front ---------- */
let GLARE: THREE.SpriteMaterial | null = null;
export function glare(): THREE.SpriteMaterial {
  if (GLARE) return GLARE;
  // a tight hot core in a halo that fades all the way out: at night's exposure the old one burnt out into a flat white
  // disc a metre across. (Half floats, so the long faint tail doesn't band into rings.)
  const N = 128, px = new Uint16Array(N * N * 4);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const r = Math.hypot(x - (N - 1) / 2, y - (N - 1) / 2) / (N / 2);
      const a = r >= 1 ? 0 : (Math.exp(-r * 16) + 0.18 * Math.exp(-r * 4.5)) * (1 - r * r) ** 2;
      const i = (y * N + x) * 4;
      px[i] = THREE.DataUtils.toHalfFloat(a);
      px[i + 1] = THREE.DataUtils.toHalfFloat(a * 0.96);
      px[i + 2] = THREE.DataUtils.toHalfFloat(a * 0.89);
      px[i + 3] = THREE.DataUtils.toHalfFloat(1);
    }
  const tex = new THREE.DataTexture(px, N, N, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  // the same features as the thought bubbles' sprites, so it compiles no new shader
  GLARE = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0x000000 });
  return GLARE;
}
/** V2: how strongly the code-built vehicles' lamps glow: as set by day, eased off at the night's exposure (about fifty
 *  times the day's), where they burnt out into blinding blots */
function lampScale(): number {
  return Math.min(1, 1.5 / Math.max(ENV.exposure.value, 1e-3));
}
/** V2: the front wheels' angle for a yaw rate `turn` (rad/s) at a signed `speed` (m/s, below 0 reversing). Reversing,
 *  the same lock swings the car the other way, so the angle takes the speed's sign: it used to divide by the speed
 *  floored at a positive number, and every vehicle backing round a corner turned its wheels against the turn */
export function steerAngle(turn: number, wheelbase: number, speed: number, max: number, slow = 0.5): number {
  const v = speed >= 0 ? Math.max(speed, slow) : Math.min(speed, -slow);
  return THREE.MathUtils.clamp((turn * wheelbase) / v, -max, max);
}
/** V2: brake lights: standing, or slowing whichever way it's going (reversing and gathering speed is not braking) */
export function isBraking(speed: number, accel: number): boolean {
  return Math.abs(speed) < 0.05 || accel * Math.sign(speed) < -0.6;
}
/** where the camera is this frame (set by the stage), for how much of a lamp's glare it sees */
export const VIEW = new THREE.Vector3();
/** how bright the glare is drawn (scene radiance; the stage sets it from the light) */
export function setGlare(k: number): void {
  glare().color.setRGB(1, 0.95, 0.86).multiplyScalar(k);
}

export class Car {
  root = new THREE.Group();
  body = new THREE.Group();
  wheels: THREE.Group[] = [];
  paint: THREE.MeshPhysicalMaterial;
  head: THREE.MeshStandardMaterial;
  bulb: THREE.MeshStandardMaterial;
  drl: THREE.MeshStandardMaterial;
  tail: THREE.MeshStandardMaterial;
  dims: Dim;
  private glares: THREE.Sprite[] = [];
  private headAt: [number, number, number][];
  private beamAt: [number, number, number];
  private spin = 0;
  private pitch = 0;
  private roll = 0;
  private bounce = 0;
  private bv = 0;
  headOn = false;
  braking = false;
  private siren: { red: THREE.MeshStandardMaterial; blue: THREE.MeshStandardMaterial } | null = null;
  /** V2 (Milestone 9): the downloaded model this car is drawn with, when the fleet has loaded */
  model: ModelCar | null = null;

  /** `modelId`: a particular model from the fleet (else one of the style's, the same one for the same paint) */
  constructor(style: CarStyle, color: THREE.Color, metallic = true, extra?: 'taxi' | 'police', modelId?: string) {
    const fm = modelId ? vehicleModel(modelId) : pickModel(extra ?? 'car', extra ? null : style, seedOf(color));
    if (fm) {
      // (the old materials stay unused; everything below is the model's)
      this.model = new ModelCar(fm, color, metallic);
      this.root = this.model.root;
      this.body = this.model.body;
      this.paint = this.model.paint;
      this.dims = { ...DIMS[style], ...this.model.dims };
      this.head = this.bulb = this.drl = this.tail = DARK;
      this.headAt = [];
      this.beamAt = [0, 0, 0];
      return;
    }
    const m = models(style), s = shared();
    this.dims = m.dims;
    this.headAt = m.headAt;
    this.beamAt = m.beamAt;
    this.paint = surface(new THREE.MeshPhysicalMaterial({ color, metalness: metallic ? 0.6 : 0.05, roughness: metallic ? 0.32 : 0.4, clearcoat: 1, clearcoatRoughness: 0.035 }), { snow: 0.9, wet: 0.15 }, 'carPaint') as THREE.MeshPhysicalMaterial;
    // (the lamp's layers lie millimetres apart on the paint: pulled forward in depth too, so they never flicker into it)
    this.head = new THREE.MeshStandardMaterial({ color: 0x9aa2aa, roughness: 0.08, metalness: 0.35, emissive: 0xfff4dc, emissiveIntensity: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    this.bulb = new THREE.MeshStandardMaterial({ color: 0xd8dce0, roughness: 0.15, metalness: 0.5, emissive: 0xfff6e4, emissiveIntensity: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    this.drl = new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.2, metalness: 0.3, emissive: 0xf4f8ff, emissiveIntensity: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    this.tail = new THREE.MeshStandardMaterial({ color: 0x5a0808, roughness: 0.15, emissive: 0xff1a0a, emissiveIntensity: 0 });
    const add = (g: THREE.BufferGeometry, mat: THREE.Material, shadow = true): THREE.Mesh => {
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      this.body.add(mesh);
      return mesh;
    };
    add(m.paint, this.paint);
    add(m.glass, s.glass);
    add(m.trim, s.trim);
    add(m.chrome, s.chrome, false);
    add(m.head, this.head, false);
    add(m.bulb, this.bulb, false);
    add(m.drl, this.drl, false);
    add(m.tail, this.tail, false);
    add(m.plate, s.plate, false);
    for (const [x, y, z] of m.headAt) {
      const sp = new THREE.Sprite(glare());
      sp.position.set(x, y, z);
      sp.visible = false;
      sp.renderOrder = 4;
      this.body.add(sp);
      this.glares.push(sp);
    }
    this.root.add(this.body);
    const w = wheelGeo();
    const d = m.dims;
    for (const z of [d.WB / 2, -d.WB / 2])
      for (const sx of [-1, 1]) {
        const steer = new THREE.Group();
        const spin = new THREE.Group();
        const tyre = new THREE.Mesh(w.tyre, s.tyre), rim = new THREE.Mesh(w.rim, s.rim);
        tyre.castShadow = true;
        spin.add(tyre, rim);
        spin.scale.setScalar(d.wheelR);
        spin.scale.x = d.wheelR * sx;
        steer.add(spin);
        steer.position.set(sx * (d.W / 2 - 0.16), d.wheelR, z);
        this.root.add(steer);
        this.wheels.push(steer);
      }
    // a lit TAXI sign, or a police light bar
    if (extra === 'taxi') {
      const sign = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.17, 0.26), new THREE.MeshStandardMaterial({ color: 0xf2c230, emissive: 0xf2c230, emissiveIntensity: 0.6, roughness: 0.4 }));
      sign.position.set(0, d.H + 0.1, -0.1);
      this.body.add(sign);
    } else if (extra === 'police') {
      this.siren = {
        red: new THREE.MeshStandardMaterial({ color: 0x400808, emissive: 0xff1a1a, emissiveIntensity: 0, roughness: 0.3 }),
        blue: new THREE.MeshStandardMaterial({ color: 0x081040, emissive: 0x2a5aff, emissiveIntensity: 0, roughness: 0.3 }),
      };
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.06, 0.3), s.trim);
      base.position.set(0, d.H + 0.03, -0.15);
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.26), this.siren.red);
      r.position.set(-0.3, d.H + 0.12, -0.15);
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.26), this.siren.blue);
      b.position.set(0.3, d.H + 0.12, -0.15);
      this.body.add(base, r, b);
    }
  }

  /** V2 (Milestone 9): the model's nearer (0) or lighter (1) level of detail */
  setLod(k: number): void {
    this.model?.setLod(k);
  }

  /** pose for this frame; `accel` m/s² along travel, `turn` = yaw rate (rad/s) */
  drive(dt: number, x: number, z: number, yaw: number, speed: number, accel: number, turn: number, y = 0): void {
    if (this.model) { this.model.drive(dt, x, z, yaw, speed, accel, turn, y); this.braking = this.model.braking; return; }
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
    this.spin += (speed * dt) / this.dims.wheelR;
    const steer = steerAngle(turn, this.dims.WB, speed, 0.6);
    this.wheels.forEach((w, i) => {
      w.rotation.y = i < 2 ? steer : 0;
      w.children[0].rotation.x = this.spin;
    });
    // sprung body: pitch with acceleration, roll with lateral g, a little road noise
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

  /** flash the light bar (police only) */
  setSiren(on: boolean, t: number): void {
    if (this.model) { this.model.setSiren(on, t); return; }
    if (!this.siren) return;
    const ph = Math.floor(t * 6) % 2;
    const g = Math.min(1, 3 * lampScale());
    this.siren.red.emissiveIntensity = on && ph ? 18 * g : 0;
    this.siren.blue.emissiveIntensity = on && !ph ? 18 * g : 0;
  }
  setPaint(c: THREE.Color): void {
    if (this.model) { this.model.setPaint(c); return; }
    this.paint.color.copy(c);
  }

  /** `night` 0..1 decides whether the headlights visibly light the road; a `parked` car is dark all over
   *  (V2 (Milestone 8): it used to keep its lamps lit and its brake lights on in the drive) */
  lights(on: boolean, night: number, parked = false): void {
    this.headOn = on;
    if (this.model) { this.model.braking = this.braking; this.model.lights(on, night, parked); return; }
    // how squarely the eye faces each lamp, from in front of it (in the body's own frame, which follows the Founder's
    // car inside its group too): a lamp throws its light forward, so it dazzles head-on, shows its shape from the
    // side, and from behind, or from the driver's seat, has no glare at all
    const eye = on ? this.body.worldToLocal(_bv.copy(VIEW)) : _bv;
    const face = this.headAt.map(([x, , z]) => (on ? Math.max(0, (eye.z - z) / (Math.hypot(eye.x - x, eye.z - z) || 1)) : 0));
    const ahead = (face[0] ** 4 + face[1] ** 4) / 2;
    // the lens itself glows softly; the light comes from the small bulbs behind it (the whole lens shows now that it
    // sits on the paint, so its glow is kept low enough for the bulbs and the strip to read through it)
    const g = lampScale();
    this.head.emissiveIntensity = on ? 0.7 * (0.4 + 0.6 * ahead) * g : 0;
    this.bulb.emissiveIntensity = on ? 34 * (0.12 + 0.88 * ahead) * g : 0;
    // daytime running lights whenever the engine is on
    this.drl.emissiveIntensity = (parked ? 0 : on ? 9 : 5) * g;
    this.tail.emissiveIntensity = (parked ? 0 : (on ? 2.2 : 0) + (this.braking ? 8 : 0)) * g;
    // the beam on the road ahead (it dips with the body under braking)
    if (on && night > 0.12) addBeam(this.body, ...this.beamAt);
    // the glare: seen head-on a broad bloom, side-on a small point
    const show = on && night > 0.15;
    this.glares.forEach((g, i) => {
      g.visible = show && face[i] > 0.02;
      if (!g.visible) return;
      // drawn part of the way to the eye (and shrunk to match), so the car's own nose never cuts a bite out of it
      const [x, y, z] = this.headAt[i];
      const dx = eye.x - x, dy = eye.y - y, dz = eye.z - z, d = Math.hypot(dx, dy, dz) || 1, pull = Math.min(0.6, d * 0.5) / d;
      g.position.set(x + dx * pull, y + dy * pull, z + dz * pull);
      g.scale.setScalar((0.08 + 0.6 * face[i] ** 6) * (1 - pull));
    });
  }
}

/* ---------- a motorcycle ----------
   Built from the car's own materials and wheels (so it compiles no new
   shaders): a raked chrome fork, a teardrop tank, a long seat, an engine
   block with an exhaust, round head and tail lamps. It leans into turns;
   `lean` lets a rider lean with it. */
export class Moto {
  root = new THREE.Group();
  body = new THREE.Group();
  paint: THREE.MeshPhysicalMaterial;
  head: THREE.MeshStandardMaterial;
  tail: THREE.MeshStandardMaterial;
  dims = { L: 2.1, WB: 1.42, W: 0.78, H: 1.15, wheelR: 0.31 };
  lean = 0;
  braking = false;
  private front = new THREE.Group();
  private spinF = new THREE.Group();
  private spinR = new THREE.Group();
  private spin = 0;

  constructor(color: THREE.Color) {
    const s = shared(), w = wheelGeo(), d = this.dims;
    this.paint = surface(new THREE.MeshPhysicalMaterial({ color, metalness: 0.6, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.035 }), { snow: 0.9, wet: 0.15 }, 'carPaint') as THREE.MeshPhysicalMaterial;
    this.head = new THREE.MeshStandardMaterial({ color: 0x7c848c, roughness: 0.25, metalness: 0.2, emissive: 0xfff4dc, emissiveIntensity: 0 });
    this.tail = new THREE.MeshStandardMaterial({ color: 0x5a0808, roughness: 0.2, emissive: 0xff1a0a, emissiveIntensity: 0 });
    const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
    const put = (g: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D = this.body): void => {
      const m = new THREE.Mesh(g, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
    };
    const rod = (a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material, parent?: THREE.Object3D): void => {
      const g = new THREE.CylinderGeometry(r, r, a.distanceTo(b), 10);
      g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize()), V(1, 1, 1)));
      put(g, mat, parent);
    };
    const r = d.wheelR, zf = d.WB / 2, zr = -d.WB / 2;
    // wheels: the car's tyre and rim, narrower
    for (const [spin, z] of [[this.spinF, zf], [this.spinR, zr]] as [THREE.Group, number][]) {
      const tyre = new THREE.Mesh(w.tyre, s.tyre), rim = new THREE.Mesh(w.rim, s.rim);
      tyre.castShadow = true;
      spin.add(tyre, rim);
      spin.scale.set(r * 0.5, r, r);
      if (z > 0) { this.front.add(spin); this.front.position.set(0, r, z); }
      else { spin.position.set(0, r, z); this.body.add(spin); }
    }
    // the steering: fork legs, handlebar and headlamp turn together about the raked head
    rod(V(-0.085, 0, 0), V(-0.085, 0.62, -0.2), 0.024, s.chrome, this.front);
    rod(V(0.085, 0, 0), V(0.085, 0.62, -0.2), 0.024, s.chrome, this.front);
    rod(V(-0.36, 0.72, -0.26), V(0.36, 0.72, -0.26), 0.016, s.trim, this.front);
    const lamp = new THREE.SphereGeometry(0.085, 16, 12);
    lamp.scale(1, 1, 0.7);
    lamp.translate(0, 0.55, -0.1);
    put(lamp, this.head, this.front);
    const fender = new THREE.CylinderGeometry(r * 1.08, r * 1.08, 0.12, 16, 1, true, Math.PI * 0.7, Math.PI * 0.75);
    fender.rotateZ(Math.PI / 2);
    put(fender, this.paint, this.front);
    this.body.add(this.front);
    // frame, tank, seat, engine, exhaust, tail
    rod(V(0, 0.92, 0.5), V(0, 0.42, 0.05), 0.03, this.paint);
    rod(V(0, 0.9, 0.48), V(0, 0.8, -0.38), 0.026, this.paint);
    for (const sx of [-0.1, 0.1]) rod(V(sx, r, zr), V(sx, 0.44, -0.08), 0.03, s.trim);
    const tank = new THREE.SphereGeometry(1, 20, 14);
    tank.scale(0.2, 0.14, 0.32);
    tank.translate(0, 0.9, 0.2);
    put(tank, this.paint);
    const seat = new THREE.BoxGeometry(0.26, 0.08, 0.62);
    seat.translate(0, 0.86, -0.24);
    put(seat, s.trim);
    const engine = new THREE.BoxGeometry(0.3, 0.3, 0.38);
    engine.translate(0, 0.46, 0.08);
    put(engine, s.trim);
    const heads = new THREE.CylinderGeometry(0.07, 0.08, 0.36, 12);
    heads.rotateZ(Math.PI / 2);
    heads.translate(0, 0.64, 0.16);
    put(heads, s.chrome);
    rod(V(0.14, 0.36, 0.2), V(0.19, 0.44, -0.78), 0.038, s.chrome);
    const rear = new THREE.BoxGeometry(0.2, 0.05, 0.38);
    rear.translate(0, 0.86, -0.66);
    put(rear, this.paint);
    const tl = new THREE.BoxGeometry(0.14, 0.06, 0.04);
    tl.translate(0, 0.84, -0.86);
    put(tl, this.tail);
    const plate = new THREE.BoxGeometry(0.18, 0.12, 0.01);
    plate.translate(0, 0.74, -0.88);
    put(plate, s.plate);
    this.root.add(this.body);
  }

  drive(dt: number, x: number, z: number, yaw: number, speed: number, accel: number, turn: number, y = 0): void {
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
    this.spin += (speed * dt) / this.dims.wheelR;
    this.spinF.rotation.x = this.spinR.rotation.x = this.spin;
    this.front.rotation.y = steerAngle(turn, this.dims.WB, speed, 0.5, 0.6);
    // lean into the turn the way a rider would (none when standing)
    const want = speed > 1 ? THREE.MathUtils.clamp(-turn * speed * 0.055, -0.55, 0.55) : 0.12;
    this.lean += (want - this.lean) * Math.min(1, dt * 4);
    this.body.rotation.z = this.lean;
    this.braking = isBraking(speed, accel);
  }
  setPaint(c: THREE.Color): void {
    this.paint.color.copy(c);
  }
  lights(on: boolean, night: number, parked = false): void {
    const g = lampScale();
    this.head.emissiveIntensity = on ? 9 * g : 0;
    this.tail.emissiveIntensity = (parked ? 0 : (on ? 2.2 : 0) + (this.braking ? 8 : 0)) * g;
    // one lamp, turning with the bars
    if (on && night > 0.12) addBeam(this.front, 0, 0.55, 0, 0.55);
  }
}

/* ---------- V2 (Milestone 8): a mountain bike ----------
   The car's own materials again (no new shaders): a painted diamond frame of tubes, a
   chrome fork and bars that steer, knobbly wheels, a saddle, and a little lamp. */
export class Bike {
  root = new THREE.Group();
  body = new THREE.Group();
  paint: THREE.MeshPhysicalMaterial;
  head: THREE.MeshStandardMaterial;
  dims = { L: 1.75, WB: 1.08, W: 0.6, H: 1.1, wheelR: 0.34 };
  lean = 0;
  braking = false;
  /** how far round the cranks are (radians), for the rider's legs */
  crank = 0;
  private front = new THREE.Group();
  private spinF = new THREE.Group();
  private spinR = new THREE.Group();
  private spin = 0;

  constructor(color: THREE.Color) {
    const s = shared(), w = wheelGeo(), d = this.dims;
    this.paint = surface(new THREE.MeshPhysicalMaterial({ color, metalness: 0.6, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.035 }), { snow: 0.9, wet: 0.15 }, 'carPaint') as THREE.MeshPhysicalMaterial;
    this.head = new THREE.MeshStandardMaterial({ color: 0x7c848c, roughness: 0.25, metalness: 0.2, emissive: 0xfff4dc, emissiveIntensity: 0 });
    const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
    const rod = (a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material, parent: THREE.Object3D = this.body): void => {
      const g = new THREE.CylinderGeometry(r, r, a.distanceTo(b), 8);
      g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize()), V(1, 1, 1)));
      const m = new THREE.Mesh(g, mat);
      m.castShadow = true;
      parent.add(m);
    };
    const r = d.wheelR, zf = d.WB / 2, zr = -d.WB / 2;
    for (const [spin, z] of [[this.spinF, zf], [this.spinR, zr]] as [THREE.Group, number][]) {
      const tyre = new THREE.Mesh(w.tyre, s.tyre), rim = new THREE.Mesh(w.rim, s.rim);
      tyre.castShadow = true;
      spin.add(tyre, rim);
      spin.scale.set(r * 0.28, r, r);
      if (z > 0) { this.front.add(spin); this.front.position.set(0, r, z); }
      else { spin.position.set(0, r, z); this.body.add(spin); }
    }
    const bb = V(0, 0.33, 0.02), seat = V(0, 0.9, -0.14), headT = V(0, 0.93, 0.4);
    rod(V(0, r, zr), bb, 0.018, this.paint);           // chain stays
    rod(bb, seat, 0.022, this.paint);                    // seat tube
    rod(seat, headT, 0.024, this.paint);                 // top tube
    rod(bb, headT, 0.028, this.paint);                   // down tube
    rod(seat, V(0, r, zr), 0.016, this.paint);           // seat stays
    rod(V(0, 0, 0), V(0, 0.62, -0.08), 0.02, s.chrome, this.front);         // the fork, up to the head
    rod(V(-0.32, 0.72, -0.12), V(0.32, 0.72, -0.12), 0.014, s.trim, this.front); // bars
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), this.head);
    lamp.position.set(0, 0.6, -0.02);
    this.front.add(lamp);
    const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.05, 0.27), s.trim);
    saddle.position.set(0, 0.95, -0.16);
    this.body.add(saddle, this.front);
    // the cranks
    const crank = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.03, 16).rotateZ(Math.PI / 2), s.chrome);
    crank.position.copy(bb);
    this.body.add(crank);
    this.root.add(this.body);
  }

  drive(dt: number, x: number, z: number, yaw: number, speed: number, accel: number, turn: number, y = 0): void {
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
    this.spin += (speed * dt) / this.dims.wheelR;
    this.spinF.rotation.x = this.spinR.rotation.x = this.spin;
    this.crank += (speed * dt) / 0.9;
    this.front.rotation.y = steerAngle(turn, this.dims.WB, speed, 0.6, 0.6);
    const want = speed > 1 ? THREE.MathUtils.clamp(-turn * speed * 0.06, -0.45, 0.45) : 0.08;
    this.lean += (want - this.lean) * Math.min(1, dt * 4);
    this.body.rotation.z = this.lean;
    this.braking = isBraking(speed, accel);
  }
  setPaint(c: THREE.Color): void {
    this.paint.color.copy(c);
  }
  lights(on: boolean, _night: number, parked = false): void {
    this.head.emissiveIntensity = on && !parked ? 6 * lampScale() : 0;
  }
}

/** anything the Founder can ride */
export type Ride = Car | Moto | Bike;

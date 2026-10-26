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

interface Models { paint: THREE.BufferGeometry; glass: THREE.BufferGeometry; trim: THREE.BufferGeometry; chrome: THREE.BufferGeometry; head: THREE.BufferGeometry; bulb: THREE.BufferGeometry; drl: THREE.BufferGeometry; tail: THREE.BufferGeometry; plate: THREE.BufferGeometry; dims: Dim; headAt: [number, number, number][] }
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
function lamp(w: number, h: number, depth: number, r: number, x: number, y: number, z: number, ry: number, rx: number): THREE.BufferGeometry {
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
/** a bulb: a small disc on its lamp's face, (ox, oy) from the lamp's centre, turned and tipped like the lamp */
function disc(r: number, ox: number, oy: number, x: number, y: number, z: number, ry: number, rx: number): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(r, 14);
  g.translate(ox, oy, 0.004);
  g.rotateX(rx);
  g.rotateY(ry);
  return g.translate(x, y, z);
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
  // V2 (Milestone 8): lamp units, not glowing boxes: a rounded lens swept round the corner of the body, and behind
  // it two small projector bulbs and a slim running-light strip (the hot spots are small, so they glare like real
  // lamps instead of blooming into a white slab); tail lamps are rounded clusters with a brighter inner bar
  const head: THREE.BufferGeometry[] = [], bulb: THREE.BufferGeometry[] = [], drl: THREE.BufferGeometry[] = [], tail: THREE.BufferGeometry[] = [];
  const headAt: [number, number, number][] = [];
  for (const sx of [-1, 1]) {
    const hx = sx * (hw - 0.3), hy = d.hood - 0.15, hz = L2 - 0.03;
    head.push(lamp(0.4, 0.13, 0.045, 0.05, hx, hy, hz, sx * 0.28, -0.3));
    for (const k of [-1, 1]) bulb.push(disc(0.031, k * 0.085, 0.012, hx, hy, hz, sx * 0.28, -0.3));
    drl.push(lamp(0.3, 0.018, 0.012, 0.009, hx, hy - 0.046, hz + 0.006, sx * 0.28, -0.3));
    headAt.push([hx, hy, hz + 0.06]);
    const tx = sx * (hw - 0.25), ty = d.deck - 0.21, tz = -L2 + 0.02;
    tail.push(lamp(0.36, 0.15, 0.04, 0.045, tx, ty, tz, Math.PI - sx * 0.22, 0.2));
  }
  const plate = merge([boxAt(0.52, 0.12, 0.02, 0, 0.42, L2 + 0.04), boxAt(0.52, 0.12, 0.02, 0, d.deck - 0.4, -L2 - 0.02)]);
  const m: Models = { paint: merge(paintParts), glass, trim: merge(trim), chrome: merge(chrome), head: merge(head), bulb: merge(bulb), drl: merge(drl), tail: merge(tail), plate, dims: d, headAt };
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

/* ---------- headlight pool on the road (cheap stand-in for a spotlight) ---------- */
let POOL: { geo: THREE.BufferGeometry; mat: THREE.MeshBasicMaterial } | null = null;
function pool(): NonNullable<typeof POOL> {
  if (POOL) return POOL;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 128, 4, 32, 96, 92);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 128);
  const tex = new THREE.CanvasTexture(c);
  const geo = new THREE.PlaneGeometry(4.2, 11);
  geo.rotateX(-Math.PI / 2);
  geo.rotateY(Math.PI);
  POOL = { geo, mat: new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: 0x000000 }) };
  return POOL;
}
/** brightness of every car's headlight pool (scene radiance units) */
export function setHeadlightPool(k: number): void {
  pool().mat.color.setRGB(1, 0.93, 0.8).multiplyScalar(k);
}

/* ---------- V2 (Milestone 8): the glare of a lit headlamp, brightest seen from in front ---------- */
let GLARE: THREE.SpriteMaterial | null = null;
function glare(): THREE.SpriteMaterial {
  if (GLARE) return GLARE;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,250,235,1)');
  gr.addColorStop(0.12, 'rgba(255,244,220,0.65)');
  gr.addColorStop(0.4, 'rgba(255,236,205,0.14)');
  gr.addColorStop(1, 'rgba(255,230,200,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  // the same features as the thought bubbles' sprites, so it compiles no new shader
  GLARE = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0x000000 });
  return GLARE;
}
/** where the camera is this frame (set by the stage), for how much of a lamp's glare it sees */
export const VIEW = new THREE.Vector3();
/** how bright the glare is drawn (scene radiance; the stage sets it from the light) */
export function setGlare(k: number): void {
  glare().color.setRGB(1, 0.95, 0.86).multiplyScalar(k);
}

export class Car {
  root = new THREE.Group();
  private pool: THREE.Mesh;
  body = new THREE.Group();
  wheels: THREE.Group[] = [];
  paint: THREE.MeshPhysicalMaterial;
  head: THREE.MeshStandardMaterial;
  bulb: THREE.MeshStandardMaterial;
  drl: THREE.MeshStandardMaterial;
  tail: THREE.MeshStandardMaterial;
  dims: Dim;
  private glares: THREE.Sprite[] = [];
  private spin = 0;
  private pitch = 0;
  private roll = 0;
  private bounce = 0;
  private bv = 0;
  headOn = false;
  braking = false;
  private siren: { red: THREE.MeshStandardMaterial; blue: THREE.MeshStandardMaterial } | null = null;

  constructor(style: CarStyle, color: THREE.Color, metallic = true, extra?: 'taxi' | 'police') {
    const m = models(style), s = shared();
    this.dims = m.dims;
    this.paint = surface(new THREE.MeshPhysicalMaterial({ color, metalness: metallic ? 0.6 : 0.05, roughness: metallic ? 0.32 : 0.4, clearcoat: 1, clearcoatRoughness: 0.035 }), { snow: 0.9, wet: 0.15 }, 'carPaint') as THREE.MeshPhysicalMaterial;
    this.head = new THREE.MeshStandardMaterial({ color: 0x9aa2aa, roughness: 0.08, metalness: 0.35, emissive: 0xfff4dc, emissiveIntensity: 0 });
    this.bulb = new THREE.MeshStandardMaterial({ color: 0xd8dce0, roughness: 0.15, metalness: 0.5, emissive: 0xfff6e4, emissiveIntensity: 0 });
    this.drl = new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.2, metalness: 0.3, emissive: 0xf4f8ff, emissiveIntensity: 0 });
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
    const pl = pool();
    this.pool = new THREE.Mesh(pl.geo, pl.mat);
    this.pool.position.set(0, 0.06, d.L / 2 + 5.2);
    this.pool.renderOrder = 3;
    this.pool.visible = false;
    this.root.add(this.pool);
  }

  /** pose for this frame; `accel` m/s² along travel, `turn` = yaw rate (rad/s) */
  drive(dt: number, x: number, z: number, yaw: number, speed: number, accel: number, turn: number, y = 0): void {
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
    this.spin += (speed * dt) / this.dims.wheelR;
    const steer = THREE.MathUtils.clamp((turn * this.dims.WB) / Math.max(speed, 0.5), -0.6, 0.6);
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
    this.braking = accel < -0.6 || speed < 0.05;
  }

  /** flash the light bar (police only) */
  setSiren(on: boolean, t: number): void {
    if (!this.siren) return;
    const ph = Math.floor(t * 6) % 2;
    this.siren.red.emissiveIntensity = on && ph ? 18 : 0;
    this.siren.blue.emissiveIntensity = on && !ph ? 18 : 0;
  }
  setPaint(c: THREE.Color): void {
    this.paint.color.copy(c);
  }

  /** `night` 0..1 decides whether the headlights visibly light the road; a `parked` car is dark all over
   *  (V2 (Milestone 8): it used to keep its lamps lit and its brake lights on in the drive) */
  lights(on: boolean, night: number, parked = false): void {
    this.headOn = on;
    // the lens itself glows softly; the light comes from the small bulbs behind it
    this.head.emissiveIntensity = on ? 1.6 : 0;
    this.bulb.emissiveIntensity = on ? 34 : 0;
    // daytime running lights whenever the engine is on
    this.drl.emissiveIntensity = parked ? 0 : on ? 9 : 5;
    this.tail.emissiveIntensity = parked ? 0 : (on ? 2.2 : 0) + (this.braking ? 8 : 0);
    this.pool.visible = on && night > 0.12;
    // the glare: seen head-on it is a broad bloom, side-on a small point, from behind nothing
    const show = on && night > 0.15;
    let face = 0;
    if (show) {
      // (from the world matrix: the Founder's own car is posed inside a group of its own)
      const e = this.root.matrixWorld.elements;
      const dx = VIEW.x - e[12], dz = VIEW.z - e[14], d = Math.hypot(dx, dz) || 1, fl = Math.hypot(e[8], e[10]) || 1;
      face = Math.max(0, (e[8] * dx + e[10] * dz) / (d * fl));
    }
    for (const g of this.glares) {
      g.visible = show && face > 0.02;
      if (g.visible) g.scale.setScalar(0.25 + 1.15 * face * face);
    }
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
  private pool: THREE.Mesh;

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
    const pl = pool();
    this.pool = new THREE.Mesh(pl.geo, pl.mat);
    this.pool.scale.set(0.7, 1, 0.8);
    this.pool.position.set(0, 0.06, 5);
    this.pool.renderOrder = 3;
    this.pool.visible = false;
    this.root.add(this.pool);
  }

  drive(dt: number, x: number, z: number, yaw: number, speed: number, accel: number, turn: number, y = 0): void {
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
    this.spin += (speed * dt) / this.dims.wheelR;
    this.spinF.rotation.x = this.spinR.rotation.x = this.spin;
    this.front.rotation.y = THREE.MathUtils.clamp((turn * this.dims.WB) / Math.max(speed, 0.6), -0.5, 0.5);
    // lean into the turn the way a rider would (none when standing)
    const want = speed > 1 ? THREE.MathUtils.clamp(-turn * speed * 0.055, -0.55, 0.55) : 0.12;
    this.lean += (want - this.lean) * Math.min(1, dt * 4);
    this.body.rotation.z = this.lean;
    this.braking = accel < -0.6 || speed < 0.05;
  }
  setPaint(c: THREE.Color): void {
    this.paint.color.copy(c);
  }
  lights(on: boolean, night: number, parked = false): void {
    this.head.emissiveIntensity = on ? 9 : 0;
    this.tail.emissiveIntensity = parked ? 0 : (on ? 2.2 : 0) + (this.braking ? 8 : 0);
    this.pool.visible = on && night > 0.12;
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
    this.front.rotation.y = THREE.MathUtils.clamp((turn * this.dims.WB) / Math.max(speed, 0.6), -0.6, 0.6);
    const want = speed > 1 ? THREE.MathUtils.clamp(-turn * speed * 0.06, -0.45, 0.45) : 0.08;
    this.lean += (want - this.lean) * Math.min(1, dt * 4);
    this.body.rotation.z = this.lean;
    this.braking = accel < -0.6 || speed < 0.05;
  }
  setPaint(c: THREE.Color): void {
    this.paint.color.copy(c);
  }
  lights(on: boolean, _night: number, parked = false): void {
    this.head.emissiveIntensity = on && !parked ? 6 : 0;
  }
}

/** anything the Founder can ride */
export type Ride = Car | Moto | Bike;

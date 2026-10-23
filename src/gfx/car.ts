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

interface Models { paint: THREE.BufferGeometry; glass: THREE.BufferGeometry; trim: THREE.BufferGeometry; chrome: THREE.BufferGeometry; head: THREE.BufferGeometry; tail: THREE.BufferGeometry; plate: THREE.BufferGeometry; dims: Dim }
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
  const head: THREE.BufferGeometry[] = [], tail: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    head.push(boxAt(0.38, 0.12, 0.1, sx * (hw - 0.32), d.hood - 0.14, L2 - 0.035, -0.35));
    tail.push(boxAt(0.34, 0.14, 0.1, sx * (hw - 0.26), d.deck - 0.2, -L2 + 0.03, 0.25));
  }
  const plate = merge([boxAt(0.52, 0.12, 0.02, 0, 0.42, L2 + 0.04), boxAt(0.52, 0.12, 0.02, 0, d.deck - 0.4, -L2 - 0.02)]);
  const m: Models = { paint: merge(paintParts), glass, trim: merge(trim), chrome: merge(chrome), head: merge(head), tail: merge(tail), plate, dims: d };
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

export class Car {
  root = new THREE.Group();
  private pool: THREE.Mesh;
  body = new THREE.Group();
  wheels: THREE.Group[] = [];
  paint: THREE.MeshPhysicalMaterial;
  head: THREE.MeshStandardMaterial;
  tail: THREE.MeshStandardMaterial;
  dims: Dim;
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
    this.head = new THREE.MeshStandardMaterial({ color: 0x7c848c, roughness: 0.25, metalness: 0.2, emissive: 0xfff4dc, emissiveIntensity: 0 });
    this.tail = new THREE.MeshStandardMaterial({ color: 0x5a0808, roughness: 0.2, emissive: 0xff1a0a, emissiveIntensity: 0 });
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
    add(m.tail, this.tail, false);
    add(m.plate, s.plate, false);
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

  /** `night` 0..1 decides whether the headlights visibly light the road */
  lights(on: boolean, night: number): void {
    this.headOn = on;
    this.head.emissiveIntensity = on ? 14 : 0;
    this.tail.emissiveIntensity = (on ? 2.5 : 0) + (this.braking ? 9 : 0);
    this.pool.visible = on && night > 0.12;
  }
}

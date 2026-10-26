/* ============================================================
   Street furniture, built into a Kit so it merges by material:
   heritage lamp posts with glowing lanterns, traffic signals
   and pedestrian signals (lamps driven per frame), benches,
   litter bins, bollards, a pillar box, quay railings, garden
   fences and walls, and a clinker rowing boat.
   ============================================================ */
import * as THREE from 'three';
import { Kit, Palette } from './architecture';
import { surface } from './surface';

const IRON = new THREE.Color(0.035, 0.038, 0.04);
const v3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const tr = (x: number, y: number, z: number): THREE.Matrix4 => new THREE.Matrix4().makeTranslation(x, y, z);

/** emissive materials whose intensity the scene drives */
export const GLOW = {
  // (V2: a lantern in a blacked-out district stays dark)
  lantern: surface(new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffc47a, emissiveIntensity: 0, roughness: 0.3, transparent: true, opacity: 0.92 }),
    { wet: 0, fEmissive: 'totalEmissiveRadiance *= pvPower(vWPos);' }, 'lantern'),
};

export function lampPost(kit: Kit, x: number, z: number): THREE.Vector3 {
  kit.base = new THREE.Matrix4();
  kit.cyl('metal', 0.17, 0.12, 8, tr(x, 0.06, z), IRON);
  kit.cyl('metal', 0.13, 0.55, 8, tr(x, 0.4, z), IRON, false, Math.PI * 2, 0.1);
  kit.cyl('metal', 0.075, 3.4, 10, tr(x, 2.35, z), IRON, false, Math.PI * 2, 0.05);
  for (const y of [0.7, 2.2, 3.95]) kit.cyl('metal', 0.085, 0.07, 10, tr(x, y, z), IRON);
  // lantern: tapered glazed box with a hipped cap and finial
  kit.cyl('metal', 0.09, 0.12, 8, tr(x, 4.12, z), IRON, false, Math.PI * 2, 0.16);
  const glass = new THREE.CylinderGeometry(0.2, 0.13, 0.5, 4, 1, true);
  glass.rotateY(Math.PI / 4);
  glass.translate(x, 4.43, z);
  kit.add('lantern', glass);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    kit.rod('metal', v3(x + Math.cos(a) * 0.13 * 1.41 * 0.707, 4.18, z + Math.sin(a) * 0.13), v3(x + Math.cos(a) * 0.2, 4.68, z + Math.sin(a) * 0.2), 0.012, IRON, 4);
  }
  const cap = new THREE.ConeGeometry(0.29, 0.22, 4);
  cap.rotateY(Math.PI / 4);
  cap.translate(x, 4.79, z);
  kit.add('metal', cap, IRON);
  kit.cyl('metal', 0.025, 0.18, 6, tr(x, 4.97, z), IRON, false, Math.PI * 2, 0.005);
  return v3(x, 4.45, z);
}

export function bench(kit: Kit, x: number, z: number, rot: number, y = 0): void {
  kit.base = new THREE.Matrix4().makeRotationY(rot).setPosition(x, y, z);
  for (const sx of [-0.8, 0.8]) {
    kit.box('metal', sx - 0.03, 0, -0.25, sx + 0.03, 0.44, 0.22, IRON);
    kit.box('metal', sx - 0.03, 0.44, -0.27, sx + 0.03, 0.9, -0.21, IRON);
  }
  const wood = new THREE.Color(0.72, 0.55, 0.38);
  for (let i = 0; i < 4; i++) kit.box('timber', -0.95, 0.42, -0.2 + i * 0.105, 0.95, 0.46, -0.2 + i * 0.105 + 0.085, wood);
  for (let i = 0; i < 3; i++) kit.box('timber', -0.95, 0.55 + i * 0.12, -0.27, 0.95, 0.64 + i * 0.12, -0.235, wood);
}

export function bin(kit: Kit, x: number, z: number): void {
  kit.base = new THREE.Matrix4();
  const g = new THREE.Color(0.05, 0.12, 0.08);
  kit.cyl('metal', 0.24, 0.9, 14, tr(x, 0.45, z), g, false, Math.PI * 2, 0.26);
  kit.cyl('metal', 0.28, 0.08, 14, tr(x, 0.94, z), g);
  kit.cyl('metal', 0.2, 0.08, 14, tr(x, 1.01, z), g, false, Math.PI * 2, 0.08);
}

export function bollard(kit: Kit, x: number, z: number): void {
  kit.base = new THREE.Matrix4();
  kit.cyl('metal', 0.09, 0.9, 10, tr(x, 0.45, z), IRON, false, Math.PI * 2, 0.075);
  kit.cyl('metal', 0.08, 0.06, 10, tr(x, 0.96, z), IRON, false, Math.PI * 2, 0.03);
  kit.cyl('paint', 0.081, 0.06, 10, tr(x, 0.78, z), new THREE.Color(0.9, 0.88, 0.8));
}

export function pillarBox(kit: Kit, x: number, z: number, rot: number): void {
  kit.base = new THREE.Matrix4().makeRotationY(rot).setPosition(x, 0, z);
  const red = new THREE.Color(0.62, 0.03, 0.02);
  kit.cyl('paint', 0.26, 0.1, 18, tr(0, 0.05, 0), IRON);
  kit.cyl('paint', 0.23, 1.25, 18, tr(0, 0.72, 0), red);
  kit.cyl('paint', 0.27, 0.08, 18, tr(0, 1.38, 0), red);
  const cap = new THREE.SphereGeometry(0.25, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  cap.scale(1, 0.55, 1).translate(0, 1.42, 0);
  kit.add('paint', cap, red);
  kit.box('paint', -0.14, 1.12, 0.2, 0.14, 1.16, 0.24, IRON);
  kit.box('paint', -0.1, 0.72, 0.21, 0.1, 0.9, 0.235, new THREE.Color(0.85, 0.82, 0.7));
}

/** iron railing along a line: posts, rails and spear heads */
export function railing(kit: Kit, x0: number, z0: number, x1: number, z1: number, h = 1.1): void {
  kit.base = new THREE.Matrix4();
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.round(len / 0.14));
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
    const post = i % 14 === 0;
    kit.cyl('metal', post ? 0.035 : 0.011, h, 5, tr(x, h / 2, z), IRON);
    const tip = new THREE.ConeGeometry(post ? 0.05 : 0.022, post ? 0.12 : 0.07, 4);
    tip.translate(x, h + 0.04, z);
    kit.add('metal', tip, IRON);
  }
  for (const y of [0.12, h - 0.1]) kit.rod('metal', v3(x0, y, z0), v3(x1, y, z1), 0.016, IRON, 5);
}

/** close-boarded timber fence between two points */
export function fence(kit: Kit, x0: number, z0: number, x1: number, z1: number, h = 1.7): void {
  kit.base = new THREE.Matrix4();
  const len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(z1 - z0, x1 - x0);
  kit.base = new THREE.Matrix4().makeRotationY(-ang).setPosition(x0, 0, z0);
  const c = new THREE.Color(0.62, 0.5, 0.38);
  for (let x = 0; x < len; x += 1.8) {
    kit.box('timber', x - 0.05, 0, -0.05, x + 0.05, h + 0.1, 0.05, c);
    const xe = Math.min(len, x + 1.8);
    kit.box('timber', x, 0.1, -0.02, xe, h, 0.02, c);
    kit.box('timber', x, 0.25, 0.02, xe, 0.35, 0.06, c);
    kit.box('timber', x, h - 0.35, 0.02, xe, h - 0.25, 0.06, c);
  }
}

/** low front-garden wall with coping and gate piers, leaving a gap */
export function gardenWall(kit: Kit, wall: string, color: THREE.Color, x0: number, x1: number, z: number, gap: [number, number] | null, rot = 0, ox = 0, oz = 0): void {
  kit.base = new THREE.Matrix4().makeRotationY(rot).setPosition(ox, 0, oz);
  const spans: [number, number][] = gap ? [[x0, gap[0]], [gap[1], x1]] : [[x0, x1]];
  for (const [a, b] of spans) {
    if (b - a < 0.1) continue;
    kit.box(wall, a, 0, z - 0.11, b, 0.62, z + 0.11, color);
    kit.box('stone', a - 0.02, 0.62, z - 0.15, b + 0.02, 0.7, z + 0.15);
  }
  if (gap) for (const a of gap) {
    kit.box(wall, a - 0.18, 0, z - 0.18, a + 0.18, 0.95, z + 0.18, color);
    kit.box('stone', a - 0.22, 0.95, z - 0.22, a + 0.22, 1.03, z + 0.22);
  }
}

/* ---------- signals ---------- */
export class SignalHead {
  red: THREE.MeshStandardMaterial;
  amber: THREE.MeshStandardMaterial;
  green: THREE.MeshStandardMaterial;
  constructor(public group: THREE.Group) {
    this.red = new THREE.MeshStandardMaterial({ color: 0x220404, emissive: 0xff1a0a, emissiveIntensity: 0, roughness: 0.2 });
    this.amber = new THREE.MeshStandardMaterial({ color: 0x221404, emissive: 0xff9a10, emissiveIntensity: 0, roughness: 0.2 });
    this.green = new THREE.MeshStandardMaterial({ color: 0x04180a, emissive: 0x20ff7a, emissiveIntensity: 0, roughness: 0.2 });
  }
  set(state: 'red' | 'amber' | 'green' | 'redamber', k: number): void {
    this.red.emissiveIntensity = state === 'red' || state === 'redamber' ? k : 0;
    this.amber.emissiveIntensity = state === 'amber' || state === 'redamber' ? k : 0;
    this.green.emissiveIntensity = state === 'green' ? k : 0;
  }
}

/** a signal pole at (x, z) whose head faces `face` (yaw); returns the lamp materials */
export function trafficSignal(kit: Kit, scene: THREE.Object3D, x: number, z: number, face: number, pedestrian = false): SignalHead {
  kit.base = new THREE.Matrix4();
  kit.cyl('metal', 0.06, 3.2, 10, tr(x, 1.6, z), new THREE.Color(0.08, 0.08, 0.08));
  kit.cyl('metal', 0.1, 0.25, 10, tr(x, 0.12, z), new THREE.Color(0.08, 0.08, 0.08));
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = face;
  scene.add(g);
  const head = new SignalHead(g);
  // housings merge into the street kit; only the lenses are separate meshes
  kit.base = new THREE.Matrix4().makeRotationY(face).setPosition(x, 0, z);
  const black = new THREE.Color(0.03, 0.03, 0.035);
  if (!pedestrian) {
    kit.box('metal', -0.17, 2.35, 0.04, 0.17, 3.35, 0.28, black);
    kit.box('metal', -0.27, 2.25, 0.015, 0.27, 3.45, 0.045, black);
    ([[head.red, 3.17], [head.amber, 2.85], [head.green, 2.53]] as [THREE.Material, number][]).forEach(([m, y]) => {
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.1, 16), m);
      lens.position.set(0, y, 0.285);
      g.add(lens);
      const hood = new THREE.CylinderGeometry(0.12, 0.12, 0.14, 12, 1, true, -Math.PI / 2, Math.PI);
      hood.rotateX(Math.PI / 2);
      hood.translate(0, y + 0.01, 0.35);
      kit.add('metal', hood, black);
    });
  } else {
    kit.box('metal', -0.15, 2.14, 0.04, 0.15, 2.76, 0.24, black);
    ([[head.red, 2.6], [head.green, 2.3]] as [THREE.Material, number][]).forEach(([m, y]) => {
      const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), m);
      lens.position.set(0, y, 0.245);
      g.add(lens);
    });
  }
  kit.base = new THREE.Matrix4();
  return head;
}

/* ---------- boat ---------- */
export function rowingBoat(color: THREE.Color): THREE.Group {
  const g = new THREE.Group();
  // hull lofted from cross-sections; planks show as darker strakes
  const L = 3.6, B = 0.72, Dp = 0.42;
  const n = 18, m = 10;
  const pos: number[] = [], idx: number[] = [], col: number[] = [];
  const paint = color, inside = new THREE.Color(0.45, 0.32, 0.2);
  for (let i = 0; i <= n; i++) {
    const t = i / n, z = (t - 0.5) * L;
    const w = B * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.02)), 0.6) * (t > 0.5 ? 1 - (t - 0.5) * 0.4 : 1) + 0.02;
    const sheer = Dp + Math.pow(Math.abs(t - 0.5) * 2, 2) * 0.15;
    for (let j = 0; j <= m; j++) {
      const s = j / m, a = -Math.PI / 2 + s * Math.PI;
      const x = (Math.sin(a) * w) / 2, y = (1 - Math.cos(a)) * sheer;
      pos.push(x, y, z);
      const strake = Math.floor(s * 6) % 2 ? 0.85 : 1;
      col.push(paint.r * strake, paint.g * strake, paint.b * strake);
    }
  }
  for (let i = 0; i < n; i++)
    for (let j = 0; j < m; j++) {
      const a = i * (m + 1) + j, b = a + m + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const hull = new THREE.BufferGeometry();
  hull.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  hull.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  hull.setIndex(idx);
  hull.computeVertexNormals();
  const hm = surface(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, side: THREE.DoubleSide }), { snow: 1, wet: 0.3 }, 'hull');
  const hullMesh = new THREE.Mesh(hull, hm);
  hullMesh.castShadow = true;
  g.add(hullMesh);
  const wood = surface(new THREE.MeshStandardMaterial({ color: inside, roughness: 0.8 }), { snow: 1, wet: 0.8 }, 'thwart');
  for (const z of [-0.8, 0.2, 1.0]) {
    const th = new THREE.Mesh(new THREE.BoxGeometry(B * 0.85, 0.04, 0.22), wood);
    th.position.set(0, 0.28, z);
    th.castShadow = true;
    g.add(th);
  }
  for (const sx of [-1, 1]) {
    const oar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.3, 6), wood);
    oar.rotation.z = Math.PI / 2;
    oar.rotation.y = sx * 0.12;
    oar.position.set(sx * 0.15, 0.33, -0.2);
    g.add(oar);
  }
  return g;
}

/** register the lantern material with the palette so lamp glass merges */
export function registerGlow(pal: Palette): void {
  pal.defs.lantern = { mat: GLOW.lantern, metres: 1 };
}

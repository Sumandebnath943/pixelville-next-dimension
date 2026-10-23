/* ============================================================
   The vertical slice: one street block of a village.
   A T-junction of Founders Lane (east–west) and Mill Street
   (north), terraced houses with front gardens, a corner bakery
   and a pub, a riverside park with a promenade, quay wall,
   railings, steps and a jetty, the river itself, a natural far
   bank, and countryside rolling away to hills.
   Coordinates: metres, x east, z south, y up. Traffic keeps right.
   ============================================================ */
import * as THREE from 'three';
import { Kit, Palette, buildHouse, buildShop, HouseSpec, Wall } from '../gfx/architecture';
import { Vegetation, Grass, TreeSpot } from '../gfx/vegetation';
import { River, Floater } from '../gfx/water';
import * as P from '../gfx/props';
import { hash, fbm, plateTex } from '../gfx/textures';
import { surface } from '../gfx/surface';
import { ENV } from '../gfx/env';

export const G = 0.13;
export const KERB = 0.15;
export const ROAD = 3.6;
export const WALK = 7.2;
export const RC = 5;
export const QUAY = 36, BANK = 66, BANK_TOP = 72, WATER_Y = -1.5, BED_Y = -2.6;
export const ROAD_END = 330;

export interface Street {
  pal: Palette;
  lamps: THREE.Vector3[];
  signals: { A: P.SignalHead[]; B: P.SignalHead[]; walkA: P.SignalHead[]; walkB: P.SignalHead[] };
  beacons: THREE.MeshStandardMaterial;
  river: River;
  floaters: Floater[];
  veg: Vegetation;
  grass: Grass;
  doors: THREE.Vector3[];
}

/** walking surface height, for the street-level camera */
export function groundAt(x: number, z: number): number {
  if (Math.abs(z) < ROAD && Math.abs(x) < ROAD_END) return 0.03;
  if (Math.abs(x) < ROAD && z < 0 && z > -ROAD_END) return 0.03;
  if (Math.abs(z) < WALK || (Math.abs(x) < WALK && z < 0)) return KERB;
  if (z > QUAY && z < BANK) return WATER_Y;
  if (z >= BANK && z < BANK_TOP) return THREE.MathUtils.lerp(-2.2, G, (z - BANK) / (BANK_TOP - BANK));
  return G + hills(x, z);
}
function hills(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const k = THREE.MathUtils.smoothstep(r, 650, 1700);
  if (k <= 0) return 0;
  const n = fbm((x + 5000) / 10000, (z + 5000) / 10000, 6, 5, 4);
  const ridge = fbm((x + 5000) / 10000, (z + 5000) / 10000, 14, 3, 9);
  return k * (Math.pow(n, 1.6) * 260 + ridge * 40);
}
function terrainY(x: number, z: number): number {
  if (Math.abs(z) <= WALK && Math.abs(x) <= ROAD_END) return 0;
  if (Math.abs(x) <= WALK && z <= -WALK && z >= -ROAD_END) return 0;
  if (Math.abs(x) <= 9.5 && z <= 4 && z >= -9.5) return 0;
  if (z > QUAY && z < BANK && Math.abs(x) < 3200) return BED_Y;
  if (z >= BANK && z < BANK_TOP && Math.abs(x) < 3200) return THREE.MathUtils.lerp(-2.2, G, (z - BANK) / (BANK_TOP - BANK));
  return G + hills(x, z);
}

/* ---------- helpers ---------- */
/** shape coordinates are (x, -z) so that rotateX(-90°) puts the face up */
function shapeOf(pts: [number, number][]): THREE.Shape {
  const s = new THREE.Shape();
  pts.forEach(([x, z], i) => (i ? s.lineTo(x, -z) : s.moveTo(x, -z)));
  return s;
}
function arcPts(cx: number, cz: number, r: number, a0: number, a1: number, n = 12): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
  }
  return out;
}
function flat(kit: Kit, key: string, pts: [number, number][], y: number, color?: THREE.Color, extrude = 0): void {
  const s = shapeOf(pts);
  const g = extrude > 0 ? new THREE.ExtrudeGeometry(s, { depth: extrude, bevelEnabled: false }) : new THREE.ShapeGeometry(s);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  kit.base = new THREE.Matrix4();
  kit.add(key, g, color);
}

/* ---------- terrain ---------- */
function lines(specials: number[], fine: number, mid: number, lo: number, hi: number): number[] {
  const out = new Set<number>(specials);
  for (let v = -120; v <= 120; v += fine) out.add(v);
  for (let v = -600; v <= 600; v += mid) out.add(v);
  let v = 600, step = mid;
  while (v < hi) { v += step; step *= 1.12; out.add(Math.min(v, hi)); out.add(Math.max(-v, lo)); }
  return [...out].filter((a) => a >= lo && a <= hi).sort((a, b) => a - b);
}
function terrain(pal: Palette, scene: THREE.Scene): void {
  const E = 3600;
  const eps = 0.02;
  const xs = lines([-ROAD_END, -ROAD_END - eps, ROAD_END, ROAD_END + eps, -WALK, -WALK - eps, WALK, WALK + eps, -9.5, 9.5], 2, 8, -E, E);
  const zs = lines([-WALK, -WALK - eps, WALK, WALK + eps, QUAY, QUAY + eps, BANK, BANK_TOP, -ROAD_END, -ROAD_END - eps, -9.5, 4], 2, 8, -E, E);
  const nx = xs.length, nz = zs.length;
  const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2);
  const c = new THREE.Color();
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const x = xs[i], z = zs[j], k = j * nx + i;
      const y = terrainY(x, z);
      pos.set([x, y, z], k * 3);
      uv.set([x / 8, z / 8], k * 2);
      // countryside patchwork: meadow, pasture, wheat, ploughed earth
      const r = Math.hypot(x, z);
      const fk = THREE.MathUtils.smoothstep(r, 260, 520);
      const fid = hash(Math.floor((x + 40) / 140), Math.floor((z + 30) / 95), 3);
      const field = fid < 0.5 ? c.setRGB(1, 1, 1) : fid < 0.72 ? c.setRGB(1.05, 1.12, 0.85) : fid < 0.88 ? c.setRGB(1.6, 1.25, 0.55) : c.setRGB(0.9, 0.62, 0.42);
      const tint = new THREE.Color(1, 1, 1).lerp(field, fk);
      if (z > BANK - 0.5 && z < BANK + 2.5) tint.multiplyScalar(0.65);
      col.set([tint.r, tint.g, tint.b], k * 3);
    }
  const idx: number[] = [];
  for (let j = 0; j < nz - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, cc = a + nx, d = cc + 1;
      idx.push(a, cc, b, b, cc, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, pal.mat('grass'));
  m.receiveShadow = true;
  scene.add(m);
}

/* ---------- traffic-wear mask: tyre tracks, footpaths, kerb snow piles ---------- */
function wearMask(): THREE.Texture {
  const S = 2048, half = 200;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  const px = (m: number): number => ((m + half) / (half * 2)) * S;
  const w = (m: number): number => (m / (half * 2)) * S;
  g.lineCap = 'round';
  // R: wheel tracks (two per lane), heavier near the junction where cars brake and turn
  g.strokeStyle = 'rgba(255,0,0,0.9)';
  g.lineWidth = w(0.45);
  for (const lane of [1.7, -1.7]) for (const o of [-0.78, 0.78]) {
    g.beginPath(); g.moveTo(px(-half), px(lane + o)); g.lineTo(px(half), px(lane + o)); g.stroke();
  }
  for (const lane of [1.7, -1.7]) for (const o of [-0.78, 0.78]) {
    g.beginPath(); g.moveTo(px(lane + o), px(-half)); g.lineTo(px(lane + o), px(-3)); g.stroke();
  }
  g.lineWidth = w(1.6);
  g.strokeStyle = 'rgba(255,0,0,0.55)';
  for (const [cx, cz, r, a0, a1] of [[-6.8, -6.8, 8.5, Math.PI / 2, 0], [6.7, -6.7, 5, Math.PI / 2, Math.PI], [-6.7, -6.7, 5, 0, Math.PI / 2], [6.8, -6.8, 8.5, Math.PI, Math.PI / 2]] as number[][]) {
    g.beginPath(); g.arc(px(cx), px(cz), w(r), Math.min(a0, a1), Math.max(a0, a1)); g.stroke();
  }
  g.fillStyle = 'rgba(255,0,0,0.5)';
  g.fillRect(px(-6), px(-6), w(12), w(10));
  // footpaths trodden along the pavements and across the crossings
  g.strokeStyle = 'rgba(255,0,0,0.75)';
  g.lineWidth = w(1.3);
  for (const z of [-5.4, 5.4]) { g.beginPath(); g.moveTo(px(-half), px(z)); g.lineTo(px(half), px(z)); g.stroke(); }
  for (const x of [-5.4, 5.4]) { g.beginPath(); g.moveTo(px(x), px(-half)); g.lineTo(px(x), px(-7)); g.stroke(); }
  g.lineWidth = w(1.0);
  for (const x of [-11, 11, 40]) { g.beginPath(); g.moveTo(px(x), px(-6)); g.lineTo(px(x), px(6)); g.stroke(); }
  g.beginPath(); g.moveTo(px(-6), px(-11)); g.lineTo(px(6), px(-11)); g.stroke();
  for (let x = -150; x <= 150; x += 7.4) { g.beginPath(); g.moveTo(px(x), px(-6.5)); g.lineTo(px(x), px(-9.5)); g.stroke(); }
  g.strokeStyle = 'rgba(255,0,0,0.55)';
  g.lineWidth = w(1.6);
  g.beginPath(); g.moveTo(px(-half), px(33)); g.lineTo(px(half), px(33)); g.stroke();
  // G: snow ploughed to the gutters and heaped on the pavement edge
  g.globalCompositeOperation = 'lighter';
  g.strokeStyle = 'rgba(0,255,0,0.95)';
  g.lineWidth = w(0.7);
  for (const z of [-3.25, 3.25]) { g.beginPath(); g.moveTo(px(-half), px(z)); g.lineTo(px(half), px(z)); g.stroke(); }
  for (const x of [-3.25, 3.25]) { g.beginPath(); g.moveTo(px(x), px(-half)); g.lineTo(px(x), px(-8)); g.stroke(); }
  g.filter = 'blur(3px)';
  g.drawImage(c, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.flipY = false;
  t.colorSpace = THREE.NoColorSpace;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 8;
  ENV.wearTex.value = t;
  ENV.wearRect.value.set(-half, -half, 1 / (half * 2), 1 / (half * 2));
  return t;
}

/* ---------- roads, pavements, kerbs, markings ---------- */
function streets(kit: Kit, scene: THREE.Scene): void {
  // asphalt with a camber: crown 4 cm at the centre line
  kit.base = new THREE.Matrix4();
  const camber = (g: THREE.BufferGeometry, across: 'z' | 'x'): THREE.BufferGeometry => {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const d = across === 'z' ? p.getZ(i) : p.getX(i);
      p.setY(i, 0.006 + 0.04 * (1 - Math.pow(d / ROAD, 2)));
    }
    g.computeVertexNormals();
    return g;
  };
  const main = new THREE.PlaneGeometry(ROAD_END * 2, ROAD * 2, 220, 8).rotateX(-Math.PI / 2);
  kit.add('asphalt', camber(main, 'z'));
  const cross = new THREE.PlaneGeometry(ROAD * 2, ROAD_END - ROAD, 8, 120).rotateX(-Math.PI / 2).translate(0, 0, -(ROAD_END + ROAD) / 2);
  kit.add('asphalt', camber(cross, 'x'));
  for (const sx of [-1, 1]) {
    const arc = arcPts(sx * (ROAD + RC), -(ROAD + RC), RC, sx > 0 ? Math.PI : 0, Math.PI / 2 * (sx > 0 ? 1 : 1), 14);
    if (sx < 0) arc.reverse();
    flat(kit, 'asphalt', [[sx * ROAD, -ROAD], ...arc.map(([x, z]) => [x, z] as [number, number])], 0.006);
  }

  // pavements: raised slabs; the junction corners follow the kerb radius
  for (const sx of [-1, 1]) {
    const arc = arcPts(sx * (ROAD + RC), -(ROAD + RC), RC, sx > 0 ? Math.PI : 0, Math.PI / 2, 14);
    const pts: [number, number][] = [[sx * ROAD, -ROAD_END], ...arc, [sx * ROAD_END, -ROAD], [sx * ROAD_END, -WALK], [sx * WALK, -WALK], [sx * WALK, -ROAD_END]];
    flat(kit, 'paving', sx > 0 ? pts : pts.reverse(), 0, undefined, KERB - 0.005);
  }
  flat(kit, 'paving', [[-ROAD_END, ROAD], [ROAD_END, ROAD], [ROAD_END, WALK], [-ROAD_END, WALK]], 0, undefined, KERB - 0.005);

  // granite kerbs: straight runs and the radiused corners
  kit.base = new THREE.Matrix4();
  const kc = new THREE.Color(0.9, 0.9, 0.88);
  kit.box('granite', -ROAD_END, 0, ROAD - 0.02, ROAD_END, KERB + 0.008, ROAD + 0.28, kc);
  for (const sx of [-1, 1]) {
    const x0 = sx > 0 ? ROAD + RC : -ROAD_END, x1 = sx > 0 ? ROAD_END : -(ROAD + RC);
    kit.box('granite', x0, 0, -ROAD - 0.28, x1, KERB + 0.008, -ROAD + 0.02, kc);
    const a = sx * ROAD;
    kit.box('granite', Math.min(a, a + sx * 0.3), 0, -ROAD_END, Math.max(a, a + sx * 0.3), KERB + 0.008, -(ROAD + RC), kc);
    const arc = arcPts(sx * (ROAD + RC), -(ROAD + RC), RC - 0.15, sx > 0 ? Math.PI : 0, Math.PI / 2, 14);
    for (let i = 0; i < arc.length - 1; i++) {
      const [ax, az] = arc[i], [bx, bz] = arc[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const g = new THREE.BoxGeometry(len + 0.02, KERB + 0.008, 0.3);
      g.rotateY(-Math.atan2(bz - az, bx - ax));
      g.translate((ax + bx) / 2, (KERB + 0.008) / 2, (az + bz) / 2);
      kit.add('granite', g, kc);
    }
  }
  // gully grates in the gutters, manhole covers in the carriageway
  const iron = new THREE.Color(0.12, 0.12, 0.12);
  for (let x = -300; x <= 300; x += 24) {
    if (Math.abs(x) < 12) continue;
    for (const z of [ROAD - 0.3, -ROAD + 0.3]) kit.box('metal', x - 0.25, 0.0, z - 0.2, x + 0.25, 0.012, z + 0.2, iron);
  }
  for (const [x, z] of [[-60, 0.6], [25, -1.2], [90, 0.4], [0, -40], [-140, -0.8]]) {
    const g = new THREE.CylinderGeometry(0.33, 0.33, 0.02, 20);
    g.translate(x, 0.04, z);
    kit.add('metal', g, new THREE.Color(0.15, 0.14, 0.13));
  }

  // road markings
  const paint = (x0: number, z0: number, x1: number, z1: number): void => {
    const g = new THREE.PlaneGeometry(Math.abs(x1 - x0), Math.abs(z1 - z0)).rotateX(-Math.PI / 2);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const d = Math.abs(cz) < ROAD ? cz : cx;
    g.translate(cx, 0.006 + 0.04 * (1 - Math.pow(Math.min(1, Math.abs(d) / ROAD), 2)) + 0.004, cz);
    kit.add('roadPaint', g);
  };
  for (let x = -ROAD_END; x < ROAD_END; x += 9) {
    if (x > -17 && x < 17) continue;
    if (x > 30 && x < 50) continue;
    paint(x, -0.06, x + 3, 0.06);
  }
  for (let z = -18; z > -ROAD_END; z -= 9) paint(-0.06, z - 3, 0.06, z);
  // stop lines
  paint(-14.8, 0.1, -14.5, ROAD - 0.2);
  paint(14.5, -ROAD + 0.2, 14.8, -0.1);
  paint(-ROAD + 0.2, -14.8, -0.1, -14.5);
  // signalised crossings: two rows of studs each
  for (const xc of [-11, 11]) for (const e of [-1.5, 1.5]) for (let z = -ROAD + 0.2; z < ROAD - 0.2; z += 0.55) paint(xc + e - 0.1, z, xc + e + 0.1, z + 0.2);
  for (const e of [-1.5, 1.5]) for (let x = -ROAD + 0.2; x < ROAD - 0.2; x += 0.55) paint(x, -11 + e - 0.1, x + 0.2, -11 + e + 0.1);
  // zebra at x = 40, with its zig-zags
  for (let z = -ROAD + 0.1; z < ROAD; z += 1.2) paint(38.5, z, 41.5, Math.min(z + 0.6, ROAD - 0.1));
  for (const sx of [-1, 1]) for (let i = 0; i < 8; i++) {
    const x0 = 40 + sx * (3 + i * 1.6);
    for (const z of [ROAD - 0.45, -ROAD + 0.45]) paint(Math.min(x0, x0 + sx * 0.8), z - 0.06 + (i % 2) * 0.12, Math.max(x0, x0 + sx * 0.8), z + 0.06 + (i % 2) * 0.12);
  }
  void scene;
}

/* ---------- river, quay, park ---------- */
function riverside(kit: Kit, scene: THREE.Scene): { river: River; floaters: Floater[] } {
  kit.base = new THREE.Matrix4();
  // quay wall, coping and bed
  const L = 3200;
  kit.quad('ashlar', new THREE.Vector3(-L, BED_Y, QUAY), new THREE.Vector3(L, BED_Y, QUAY), new THREE.Vector3(L, G + 0.02, QUAY), new THREE.Vector3(-L, G + 0.02, QUAY), new THREE.Vector3(0, 0, 1));
  kit.box('granite', -L, G, QUAY - 0.45, L, G + 0.14, QUAY + 0.08, new THREE.Color(0.85, 0.85, 0.83));
  const bed = new THREE.PlaneGeometry(L * 2, BANK - QUAY + 2).rotateX(-Math.PI / 2).translate(0, BED_Y, (QUAY + BANK) / 2);
  kit.add('soil', bed, new THREE.Color(0.55, 0.5, 0.45));
  // promenade: a gravel walk along the quay, two paths up to the pavement
  flat(kit, 'gravel', [[-ROAD_END, 30.2], [ROAD_END, 30.2], [ROAD_END, QUAY - 0.45], [-ROAD_END, QUAY - 0.45]], G + 0.012);
  for (const x of [-22, 58]) flat(kit, 'gravel', [[x - 1.5, WALK], [x + 1.5, WALK], [x + 1.5, 30.2], [x - 1.5, 30.2]], G + 0.01);
  // steps down to a timber jetty
  const sx0 = 4;
  for (let i = 0; i < 9; i++) {
    const y = G - (i + 1) * 0.19;
    kit.box('ashlar', sx0 + i * 0.32, y, QUAY, sx0 + i * 0.32 + 0.34, y + 0.19, QUAY + 1.3);
  }
  kit.box('ashlar', sx0 - 0.3, BED_Y, QUAY, sx0 + 9 * 0.32, G - 9 * 0.19, QUAY + 1.3);
  const jy = WATER_Y + 0.45;
  const wood = new THREE.Color(0.8, 0.68, 0.55);
  kit.box('timber', sx0 + 2.6, jy - 0.08, QUAY, sx0 + 6.4, jy, QUAY + 3.6, wood);
  for (const [x, z] of [[sx0 + 2.7, QUAY + 3.5], [sx0 + 6.3, QUAY + 3.5], [sx0 + 6.3, QUAY + 1.5]]) kit.box('timber', x - 0.1, BED_Y, z - 0.1, x + 0.1, jy + 0.6, z + 0.1, new THREE.Color(0.55, 0.45, 0.35));
  P.railing(kit, -150, QUAY - 0.25, sx0 - 0.4, QUAY - 0.25);
  P.railing(kit, sx0 + 9 * 0.32 + 0.2, QUAY - 0.25, 150, QUAY - 0.25);

  const river = new River(scene, -1400, 1400, QUAY, BANK + 2.5, WATER_Y);
  // a rowing boat tied to the jetty, and a few ducks
  const boat = P.rowingBoat(new THREE.Color(0.18, 0.32, 0.42));
  boat.position.set(sx0 + 4.4, WATER_Y, QUAY + 4.6);
  boat.rotation.y = Math.PI / 2 + 0.08;
  scene.add(boat);
  const floaters = [new Floater(boat, river, 3.4, 0.7, 0.12)];
  const duckMat = surface(new THREE.MeshStandardMaterial({ color: 0x5a4a32, roughness: 0.7 }), {}, 'duck');
  const headMat = surface(new THREE.MeshStandardMaterial({ color: 0x1d4a2a, roughness: 0.4 }), {}, 'duckH');
  for (let i = 0; i < 5; i++) {
    const d = new THREE.Group();
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8).scale(1, 0.65, 1.6), duckMat);
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), i % 2 ? duckMat : headMat);
    h.position.set(0, 0.16, 0.2);
    d.add(b, h);
    d.position.set(-30 + i * 2.3 + Math.random(), WATER_Y, 46 + Math.random() * 6);
    d.rotation.y = Math.random() * 6;
    d.userData.duck = { phase: Math.random() * 6, speed: 0.1 + Math.random() * 0.15 };
    scene.add(d);
    floaters.push(new Floater(d, river, 0.4, 0.25, 0.06));
  }
  return { river, floaters };
}

/* ---------- buildings ---------- */
const DOORS = ['#1f3a5f', '#7a1f1f', '#1f4a2f', '#111111', '#e8e0cc', '#2f5a5a', '#6a3a5a', '#c8a03a'];
const RENDERS = ['#efe7d6', '#e6d6c0', '#dfe6e2', '#efd9cc', '#d9e1ea', '#f2ecd8'];

function terrace(kit: Kit, rng: () => number, x0: number, x1: number, frontZ: number, rot: number, doors: THREE.Vector3[], veg: Vegetation, ox = 0, oz = 0): void {
  // walk along the street placing groups of 3–6 houses with an alley between
  let x = x0;
  let group = 0;
  const dir = Math.sign(x1 - x0);
  while ((x1 - x) * dir > 7) {
    const walls: Wall[] = ['brickRed', 'render', 'brickBrown', 'brickYellow', 'brickRed', 'render'];
    const wall = walls[(group + Math.floor(rng() * 2)) % walls.length];
    const storeys = rng() < 0.35 ? 3 : 2;
    const roof = rng() < 0.55 ? 'slate' : 'clay';
    const depth = 9 + Math.floor(rng() * 2);
    // widths for this group, then lay them out in local-x order so the ends are known
    const widths: number[] = [];
    let total = 0;
    const n = 3 + Math.floor(rng() * 4);
    while (widths.length < n && (x1 - x) * dir - total > 7) {
      const w = 6.2 + rng() * 1.8;
      widths.push(w);
      total += w;
    }
    let lx = dir > 0 ? x : x - total;
    for (let i = 0; i < widths.length; i++) {
      const w = widths[i];
      const tint = wall === 'render' ? new THREE.Color(RENDERS[Math.floor(rng() * RENDERS.length)]) : undefined;
      const spec: HouseSpec = {
        x: 0, z: 0, rot, width: w, depth, storeys, wall, wallTint: tint, roof,
        door: new THREE.Color(DOORS[Math.floor(rng() * DOORS.length)]), seed: Math.floor(rng() * 1e6),
        endLeft: i === 0,
        endRight: i === widths.length - 1,
      };
      // the street-facing local frame maps (lx, frontZ) through the rotation
      const p = new THREE.Vector3(lx, 0, frontZ).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot).add(new THREE.Vector3(ox, 0, oz));
      spec.x = p.x; spec.z = p.z;
      const r = buildHouse(kit, spec);
      doors.push(r.door);
      // front garden: low wall or hedge on the pavement line, a path to the door, a lawn or gravel
      const gardenD = 3.4;
      const dl = new THREE.Vector3().copy(r.door).sub(new THREE.Vector3(ox, 0, oz)).applyAxisAngle(new THREE.Vector3(0, 1, 0), -rot);
      const wallKey = wall === 'render' ? 'brickRed' : wall;
      if (rng() < 0.65) P.gardenWall(kit, wallKey, new THREE.Color(1, 1, 1), lx + 0.05, lx + w - 0.05, frontZ + gardenD - 0.12, [dl.x - 0.6, dl.x + 0.6], rot, ox, oz);
      else {
        const hp = new THREE.Vector3(lx + w / 2, 0, frontZ + gardenD - 0.3).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot).add(new THREE.Vector3(ox, 0, oz));
        const half = (w - 1.6) / 2 - 0.2;
        for (const side of [-1, 1]) {
          const cx = dl.x + side * (0.8 + half / 2);
          if (cx - half / 2 < lx || cx + half / 2 > lx + w) continue;
          const q = new THREE.Vector3(cx, 0, frontZ + gardenD - 0.35).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot).add(new THREE.Vector3(ox, 0, oz));
          veg.hedge(q.x, q.z, Math.max(0.6, Math.min(half, w / 2 - 1)), 0.95, 0.65, rot, spec.seed + side, G);
        }
        void hp;
      }
      kit.base = new THREE.Matrix4().makeRotationY(rot).setPosition(ox, 0, oz);
      kit.box('paving', dl.x - 0.55, G, frontZ + 0.6, dl.x + 0.55, G + 0.025, frontZ + gardenD, new THREE.Color(0.85, 0.78, 0.72));
      if (rng() < 0.5) {
        const bx = new THREE.Vector3(lx + (dl.x - lx < w / 2 ? w * 0.72 : w * 0.28), 0, frontZ + gardenD * 0.5).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot).add(new THREE.Vector3(ox, 0, oz));
        veg.bush(bx.x, bx.z, 0.55 + rng() * 0.3, 0.45 + rng() * 0.3, 0.5, spec.seed + 7, 0, G);
      }
      lx += w;
    }
    x += dir * (total + 1.4);
    group++;
  }
}

/* ---------- the whole block ---------- */
export async function buildStreet(scene: THREE.Scene, progress: (s: string) => Promise<void>, grassPerM2 = 6.5, off: Set<string> = new Set()): Promise<Street> {
  await progress('Mixing mortar and firing bricks…');
  const pal = new Palette();
  P.registerGlow(pal);
  const kit = new Kit(pal);
  wearMask();
  await progress('Laying the ground…');
  terrain(pal, scene);
  streets(kit, scene);
  await progress('Building the river and the quay…');
  const { river, floaters } = riverside(kit, scene);

  await progress('Raising the terraces…');
  const veg = new Vegetation(scene);
  const doors: THREE.Vector3[] = [];
  let seed = 7;
  const rng = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const frontZ = -(WALK + 3.5);
  // Founders Lane, north side: pub on the west corner, bakery on the east
  const pub = buildShop(kit, {
    x: -19.4, z: -WALK, rot: 0, width: 12.2, depth: 12, storeys: 3, kind: 'pub', name: 'The Founder’s Arms',
    fascia: new THREE.Color(0.12, 0.17, 0.12), signBg: '#1a271c', signFg: '#e8d9a0', upperWall: 'brickBrown', seed: 41, sideFront: 'right',
  });
  const shop = buildShop(kit, {
    x: WALK, z: -WALK, rot: 0, width: 12.4, depth: 12, storeys: 3, kind: 'shop', name: 'Village Bakery',
    fascia: new THREE.Color(0.05, 0.16, 0.22), signBg: '#0e2a38', signFg: '#f2e3b0', awning: ['#f1eadb', '#1d4f63'], upperWall: 'render', upperTint: new THREE.Color('#efe6d2'), seed: 77, sideFront: 'left',
  });
  doors.push(pub.door, shop.door);
  terrace(kit, rng, -19.6, -170, frontZ, 0, doors, veg);
  terrace(kit, rng, 19.8, 170, frontZ, 0, doors, veg);
  // Mill Street: terraces facing each other
  // (rotating the street frame by +90° puts local x along world -z, so the west row runs over +38..+110)
  terrace(kit, rng, 38, 110, -(WALK + 3.5), Math.PI / 2, doors, veg);
  terrace(kit, rng, -38, -110, -(WALK + 3.5), -Math.PI / 2, doors, veg);
  await progress('Fencing the back gardens…');
  for (let x = -168; x < 168; x += 7.4) {
    if (Math.abs(x) < 20) continue;
    P.fence(kit, x, -21.4, x, -34);
  }
  P.fence(kit, -168, -34, -20, -34);
  P.fence(kit, 20, -34, 168, -34);

  await progress('Planting trees and hedges…');
  const trees: TreeSpot[] = [];
  for (let x = -130; x <= 150; x += 21) trees.push({ x: x + (hash(x, 1, 2) - 0.5) * 4, z: 26 + hash(x, 2, 2) * 2, species: hash(x, 3, 2) > 0.3 ? 'lime' : 'oak' });
  for (const [x, z] of [[-70, 15], [-35, 19], [24, 14], [88, 18], [120, 13], [-110, 17]]) trees.push({ x, z, species: 'oak', scale: 1.1 });
  for (const [x, z] of [[-52, 12], [-48, 16], [-45, 11.5], [70, 12], [74, 15]]) trees.push({ x, z, species: 'birch' });
  for (const [x, z] of [[132, 22], [-140, 24], [-30, -28], [40, -27], [-90, -27], [110, -29], [-36, 12]]) trees.push({ x, z, species: 'spruce' });
  for (let x = -200; x <= 220; x += 13) trees.push({ x: x + hash(x, 5, 1) * 6, z: BANK_TOP + 3 + hash(x, 6, 1) * 12, species: hash(x, 7, 1) > 0.6 ? 'birch' : hash(x, 8, 1) > 0.3 ? 'lime' : 'oak', y: G });
  for (let x = -60; x <= 60; x += 14) trees.push({ x: x + hash(x, 9, 1) * 6, z: -42 - hash(x, 10, 1) * 20, species: hash(x, 11, 1) > 0.5 ? 'oak' : 'spruce', y: G });
  for (const t of trees) if (t.y === undefined) t.y = G;
  if (!off.has('trees')) veg.plant(trees);
  for (let x = -150; x < 150; x += 10) {
    if ((x > -26 && x < -18) || (x > 54 && x < 62)) continue;
    veg.hedge(x + 5, WALK + 0.55, 9.6, 0.9, 0.7, 0, 900 + x, G);
  }
  for (const [x, z] of [[-60, 23], [-8, 21], [40, 22], [100, 23]]) {
    flat(kit, 'soil', arcPts(x, z, 2.2, 0, Math.PI * 2, 18), G + 0.03);
    for (let k = 0; k < 6; k++) veg.bush(x + Math.cos(k) * 1.2, z + Math.sin(k) * 1.2, 0.35, 0.3, 0.35, x * 13 + k, 0, G + 0.03);
  }

  await progress('Setting out lamps, benches and signals…');
  const lamps: THREE.Vector3[] = [];
  for (let x = -150; x <= 150; x += 28) {
    lamps.push(P.lampPost(kit, x + 4, -ROAD - 0.55));
    lamps.push(P.lampPost(kit, x - 10, ROAD + 0.55));
  }
  for (let z = -24; z > -110; z -= 28) lamps.push(P.lampPost(kit, (z / 28) % 2 ? ROAD + 0.55 : -ROAD - 0.55, z));
  for (let x = -120; x <= 140; x += 26) lamps.push(P.lampPost(kit, x + 13, 31));
  for (let x = -110; x <= 130; x += 26) P.bench(kit, x, 34.6, 0);
  for (let x = -97; x <= 140; x += 52) P.bin(kit, x, 34.9);
  for (const x of [-30, 34, 70]) P.bin(kit, x, -ROAD - 0.6);
  P.pillarBox(kit, 21.2, -ROAD - 0.75, 0);
  for (const sx of [-1, 1]) for (const [x, z] of [[6.6, -4.3], [5.2, -5.2], [4.3, -6.6]]) P.bollard(kit, sx * x, z);
  // street name plates on the corner buildings
  const plate = pal.custom('plate:lane', () => plateTex('Founders Lane'), { roughness: 0.4 });
  const plate2 = pal.custom('plate:mill', () => plateTex('Mill Street'), { roughness: 0.4 });
  kit.base = new THREE.Matrix4();
  kit.quad(plate, new THREE.Vector3(9.0, 2.9, -WALK + 0.03), new THREE.Vector3(10.6, 2.9, -WALK + 0.03), new THREE.Vector3(10.6, 3.3, -WALK + 0.03), new THREE.Vector3(9.0, 3.3, -WALK + 0.03), new THREE.Vector3(0, 0, 1), undefined, [0, 0, 1, 0, 1, 1, 0, 1]);
  kit.quad(plate2, new THREE.Vector3(WALK - 0.03, 2.9, -9.0), new THREE.Vector3(WALK - 0.03, 2.9, -10.6), new THREE.Vector3(WALK - 0.03, 3.3, -10.6), new THREE.Vector3(WALK - 0.03, 3.3, -9.0), new THREE.Vector3(-1, 0, 0), undefined, [0, 0, 1, 0, 1, 1, 0, 1]);

  // signals: A = Founders Lane, B = Mill Street; pedestrians walk across the lane in B, across Mill Street in A
  const sig = { A: [] as P.SignalHead[], B: [] as P.SignalHead[], walkA: [] as P.SignalHead[], walkB: [] as P.SignalHead[] };
  sig.A.push(P.trafficSignal(kit, scene, -14.2, ROAD + 0.55, -Math.PI / 2));
  sig.A.push(P.trafficSignal(kit, scene, 14.2, -ROAD - 0.55, Math.PI / 2));
  sig.B.push(P.trafficSignal(kit, scene, -ROAD - 0.55, -14.2, Math.PI));
  sig.B.push(P.trafficSignal(kit, scene, ROAD + 0.55, -15.4, Math.PI));
  for (const x of [-11, 11]) {
    sig.walkB.push(P.trafficSignal(kit, scene, x + 1.9, -ROAD - 0.5, 0, true));
    sig.walkB.push(P.trafficSignal(kit, scene, x - 1.9, ROAD + 0.5, Math.PI, true));
  }
  sig.walkA.push(P.trafficSignal(kit, scene, -ROAD - 0.5, -9.0, Math.PI / 2, true));
  sig.walkA.push(P.trafficSignal(kit, scene, ROAD + 0.5, -13.0, -Math.PI / 2, true));
  // Belisha beacons at the zebra
  const beacons = new THREE.MeshStandardMaterial({ color: 0xffb030, emissive: 0xff9a10, emissiveIntensity: 2, roughness: 0.3 });
  for (const z of [-ROAD - 0.5, ROAD + 0.5]) for (const x of [37.7, 42.3]) {
    kit.base = new THREE.Matrix4();
    for (let k = 0; k < 8; k++) kit.cyl('paint', 0.06, 0.3, 10, new THREE.Matrix4().makeTranslation(x, 0.15 + k * 0.3, z), k % 2 ? new THREE.Color(0.9, 0.9, 0.88) : new THREE.Color(0.03, 0.03, 0.03));
    const globe = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 12), beacons);
    globe.position.set(x, 2.62, z);
    scene.add(globe);
  }

  await progress('Merging geometry…');
  kit.build(scene);

  await progress('Sowing the grass…');
  const inHouseRow = (x: number, z: number): boolean => z < -WALK - 0.1 && z > -21 && Math.abs(x) < 172;
  const grass = new Grass(scene, -200, -56, 200, 88, (x, z) => {
    const y = groundAt(x, z);
    if (Math.abs(z) < WALK + 0.1 && Math.abs(x) < ROAD_END) return [0, 0, 0];
    if (Math.abs(x) < WALK + 0.1 && z < 0) return [0, 0, 0];
    if (z > 30 && z < BANK) return [0, 0, 0];
    if ((Math.abs(x + 22) < 1.7 || Math.abs(x - 58) < 1.7) && z > WALK && z < 31) return [0, 0, 0];
    // front gardens: a strip of lawn either side of the path
    if (inHouseRow(x, z)) {
      if (z > -WALK - 3.4 && z < -WALK - 0.4 && Math.abs(x) > 20) return [0.75, 0.22, G];
      return [0, 0, 0];
    }
    if (z <= -21 && z > -34 && Math.abs(x) > 20 && Math.abs(x) < 168) return [0.85, 0.22, G];
    if (z >= BANK && z < BANK_TOP + 6) return [1, 0.75 + (z < BANK + 2.5 ? 0.6 : 0), y];
    if (z > WALK && z <= 30) return [1, 0.2, G];
    // open fields: sparse tufts only near the street, the ground texture carries the rest
    return [Math.abs(x) < 190 && z > -55 ? 0.35 : 0, 0.55, y];
  }, off.has('grass') ? 0 : grassPerM2);
  return { pal, lamps, signals: sig, beacons, river, floaters, veg, grass, doors };
}

/** distant forest on the hills: cheap instanced crowns, fogged by distance */
export function farForest(scene: THREE.Scene): void {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i);
    v.multiplyScalar(0.85 + hash(Math.round(v.x * 100), Math.round(v.y * 100 + v.z * 7), 1) * 0.3);
    p.setXYZ(i, v.x, v.y + 1, v.z);
  }
  geo.computeVertexNormals();
  const mat = surface(new THREE.MeshStandardMaterial({ color: 0x2a3a1e, roughness: 0.95 }), { snow: 0.8, antiTile: 0.3 }, 'farTree');
  const N = 5000;
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pos = new THREE.Vector3();
  let n = 0;
  for (let k = 0; k < N * 6 && n < N; k++) {
    const a = hash(k, 1, 4) * Math.PI * 2, r = 420 + Math.pow(hash(k, 2, 4), 0.7) * 2600;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (z > QUAY - 10 && z < BANK_TOP + 10) continue;
    const wood = fbm((x + 5000) / 10000, (z + 5000) / 10000, 9, 4, 12);
    if (wood < 0.52 && hash(k, 3, 4) > 0.06) continue;
    const y = G + hills(x, z);
    const h = 9 + hash(k, 5, 4) * 9;
    s.set(h * 0.42, h * 0.6, h * 0.42);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(k, 6, 4) * 6.28);
    pos.set(x, y - 1, z);
    m4.compose(pos, q, s);
    mesh.setMatrixAt(n, m4);
    mesh.setColorAt(n, new THREE.Color().setHSL(0.24 + hash(k, 7, 4) * 0.08, 0.35, 0.5 + hash(k, 8, 4) * 0.3));
    n++;
  }
  mesh.count = n;
  mesh.computeBoundingSphere();
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  scene.add(mesh);
}

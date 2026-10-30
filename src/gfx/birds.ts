/* ============================================================
   Flying birds (V2): a bird on the wing, drawn instanced. The
   downloaded pigeon and duck have no wing bones, and the birds
   crossing the sky were four flat triangles rocking from side to
   side, all at one height. This one has a body, head, beak and a
   fanned tail, and wings in two parts (arm and hand) that beat
   in the vertex shader: the hand lags the arm through each
   stroke, the body bobs against the wings, and every so often a
   bird stops beating and glides on slightly raised wings. One
   shape, coloured per bird: gulls, crows, pigeons.
   ============================================================ */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { surface } from './surface';

/** one wing's planform (x out from the shoulder, z forward), arm then hand to the swept tip */
const WING: [number, number][] = [[0, 0.07], [0.27, 0.06], [0.52, -0.06], [0.5, -0.1], [0.27, -0.09], [0, -0.11]];

function birdGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const tag = (g: THREE.BufferGeometry, wing: (p: THREE.Vector3) => number, colour: (p: THREE.Vector3) => THREE.Color): THREE.BufferGeometry => {
    const n = g.attributes.position.count, w = new Float32Array(n), c = new Float32Array(n * 3), p = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      p.fromBufferAttribute(g.attributes.position as THREE.BufferAttribute, i);
      w[i] = wing(p);
      colour(p).toArray(c, i * 3);
    }
    g.setAttribute('aWing', new THREE.BufferAttribute(w, 1));
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return g;
  };
  const white = new THREE.Color(1, 1, 1), pale = new THREE.Color(0.86, 0.87, 0.88), tip = new THREE.Color(0.12, 0.12, 0.13), beak = new THREE.Color(0.9, 0.62, 0.16);
  const body = new THREE.SphereGeometry(1, 10, 6).scale(0.062, 0.058, 0.2);
  parts.push(tag(body, () => 0, () => white));
  parts.push(tag(new THREE.SphereGeometry(0.05, 8, 6).translate(0, 0.03, 0.19), () => 0, () => white));
  parts.push(tag(new THREE.ConeGeometry(0.014, 0.06, 5).rotateX(Math.PI / 2).translate(0, 0.025, 0.25), () => 0, () => beak));
  // the tail, a little fan
  const tail = new THREE.BufferGeometry();
  tail.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.01, -0.14, -0.07, 0.0, -0.32, 0.07, 0.0, -0.32], 3));
  tail.computeVertexNormals();
  parts.push(tag(tail, () => 0, () => pale));
  // the wings: a flat planform each side (both faces drawn), its spanwise distance from the shoulder in aWing
  for (const side of [1, -1]) {
    const pos: number[] = [];
    const v = (i: number): number[] => [side * (0.05 + WING[i][0]), 0.01, WING[i][1]];
    for (const [a, b, c] of [[0, 1, 5], [1, 4, 5], [1, 2, 4], [2, 3, 4]]) pos.push(...v(a), ...(side > 0 ? [...v(b), ...v(c)] : [...v(c), ...v(b)]));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    parts.push(tag(g, (p) => side * Math.max(0, Math.abs(p.x) - 0.05), (p) => (Math.abs(p.x) > 0.43 ? tip : pale)));
  }
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => { g.deleteAttribute('uv'); return g; }))!;
}

const FLAP_V = /* glsl */ `attribute float aWing;\nattribute vec2 aFlap;`;
// (the arm turns at the shoulder, the hand at the wrist a beat behind; gliding, the wings hold a shallow V)
const FLAP_D = /* glsl */ `{
  float A = aFlap.y, ph = aFlap.x;
  float s = abs(aWing);
  if (s > 0.0) {
    float side = sign(aWing);
    float a1 = (sin(ph) * 0.8 + 0.12) * A + 0.1 * (1.0 - A);
    float a2 = sin(ph - 0.8) * 0.55 * A + 0.06 * (1.0 - A);
    float r1 = min(s, 0.27), r2 = max(s - 0.27, 0.0);
    transformed.x = side * (0.05 + r1 * cos(a1) + r2 * cos(a1 + a2));
    transformed.y += r1 * sin(a1) + r2 * sin(a1 + a2);
  }
  transformed.y -= sin(ph) * 0.018 * A;
}`;

export class FlyingBirds {
  mesh: THREE.InstancedMesh;
  private flap: THREE.InstancedBufferAttribute;
  private n = 0;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  constructor(scene: THREE.Object3D, private cap = 160) {
    const geo = birdGeometry();
    this.flap = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
    this.flap.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aFlap', this.flap);
    const mat = surface(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide }), { snow: 0, wet: 0.2, vDecl: FLAP_V, vDisplace: FLAP_D }, 'birdWing');
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    scene.add(this.mesh);
  }
  begin(): void { this.n = 0; }
  /** a bird at (x, y, z) heading `yaw`, banked `roll`, its wingbeat at phase `ph`, beating `beat` (0 gliding … 1) */
  add(x: number, y: number, z: number, yaw: number, roll: number, ph: number, beat: number, colour: THREE.Color, scale = 1): void {
    if (this.n >= this.cap) return;
    this.q.setFromEuler(this.e.set(-0.05 * beat, yaw, roll, 'YXZ'));
    this.mesh.setMatrixAt(this.n, this.m4.compose(this.p.set(x, y, z), this.q, this.s.setScalar(scale)));
    this.mesh.setColorAt(this.n, colour);
    this.flap.setXY(this.n, ph, beat);
    this.n++;
  }
  end(): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
    this.flap.needsUpdate = true;
  }
}

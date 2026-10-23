/* ============================================================
   Render kit: the low-poly toolbox every 3D layer shares.
   - MeshBuilder: accumulate flat-shaded, vertex-coloured boxes,
     quads and prisms into one BufferGeometry (one draw call).
   - InstancedPool: refill an InstancedMesh from scratch each frame.
   - Materials, including the global winter snow cover.
   - Coordinates: sim px / tiles → metres, and terrain height.
   ============================================================ */
import * as THREE from 'three';
import { PX_M, TILE_M } from '../sim/core';

/* ---------- coordinates ---------- */
export const tileM = (t: number): number => t * TILE_M;
export const pxM = (px: number): number => px * PX_M;

/* ---------- colour helpers ---------- */
const _c = new THREE.Color();
export function hex(h: string | number): THREE.Color {
  return new THREE.Color(h as THREE.ColorRepresentation);
}
export function shade(h: string | number | THREE.Color, f: number): THREE.Color {
  _c.set(h as THREE.ColorRepresentation);
  if (f >= 0) _c.lerp(new THREE.Color(1, 1, 1), f);
  else _c.multiplyScalar(1 + f);
  return _c.clone();
}
export function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return (h ^ (h >>> 16)) >>> 0;
}
export function rand01(seed: number): number {
  return (hash2(seed, seed * 7 + 3) % 10007) / 10007;
}

/* ---------- MeshBuilder ---------- */
const V = new THREE.Vector3();
export class MeshBuilder {
  pos: number[] = [];
  col: number[] = [];
  /** optional transform applied to every primitive added */
  mat: THREE.Matrix4 | null = null;

  private v(x: number, y: number, z: number): void {
    if (this.mat) {
      V.set(x, y, z).applyMatrix4(this.mat);
      this.pos.push(V.x, V.y, V.z);
    } else this.pos.push(x, y, z);
  }
  private c(color: THREE.Color, n: number): void {
    for (let i = 0; i < n; i++) this.col.push(color.r, color.g, color.b);
  }

  tri(a: number[], b: number[], c: number[], color: THREE.Color): this {
    this.v(a[0], a[1], a[2]);
    this.v(b[0], b[1], b[2]);
    this.v(c[0], c[1], c[2]);
    this.c(color, 3);
    return this;
  }
  /** quad a-b-c-d counter-clockwise when seen from the front */
  quad(a: number[], b: number[], c: number[], d: number[], color: THREE.Color): this {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
    return this;
  }
  /** axis-aligned box from min corner (x0,y0,z0) to max corner */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: THREE.Color, top?: THREE.Color, opts: { noBottom?: boolean; noTop?: boolean } = {}): this {
    const t = top || color;
    const side = color;
    // +y top
    if (!opts.noTop) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], t);
    if (!opts.noBottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], side);
    // +z front
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], side);
    // -z back
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], side);
    // +x
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], side);
    // -x
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], side);
    return this;
  }
  /** box by centre and size */
  boxC(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: THREE.Color, top?: THREE.Color): this {
    return this.box(cx - sx / 2, cy - sy / 2, cz - sz / 2, cx + sx / 2, cy + sy / 2, cz + sz / 2, color, top);
  }
  /** gable roof along x: ridge at height y1 running from x0 to x1, eaves at y0 */
  gableX(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: THREE.Color, gable: THREE.Color): this {
    const zm = (z0 + z1) / 2;
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, zm], [x0, y1, zm], color);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, zm], [x1, y1, zm], color);
    this.tri([x0, y0, z0], [x0, y0, z1], [x0, y1, zm], gable);
    this.tri([x1, y0, z1], [x1, y0, z0], [x1, y1, zm], gable);
    return this;
  }
  /** gable roof along z (ridge runs front to back) */
  gableZ(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: THREE.Color, gable: THREE.Color): this {
    const xm = (x0 + x1) / 2;
    this.quad([x1, y0, z1], [x1, y0, z0], [xm, y1, z0], [xm, y1, z1], color);
    this.quad([x0, y0, z0], [x0, y0, z1], [xm, y1, z1], [xm, y1, z0], color);
    this.tri([x0, y0, z1], [x1, y0, z1], [xm, y1, z1], gable);
    this.tri([x1, y0, z0], [x0, y0, z0], [xm, y1, z0], gable);
    return this;
  }
  /** four-sided pyramid / hip roof */
  pyramid(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: THREE.Color, inset = 0): this {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const ax = inset ? Math.min(inset, (x1 - x0) / 2) : 0;
    const p0 = [cx - ax, y1, cz], p1 = [cx + ax, y1, cz];
    this.quad([x0, y0, z1], [x1, y0, z1], p1, p0, color);
    this.quad([x1, y0, z0], [x0, y0, z0], p0, p1, color);
    this.tri([x1, y0, z1], [x1, y0, z0], p1, color);
    this.tri([x0, y0, z0], [x0, y0, z1], p0, color);
    return this;
  }
  /** vertical n-gon prism (cylinder-ish) */
  cyl(cx: number, y0: number, cz: number, r: number, h: number, n: number, color: THREE.Color, top?: THREE.Color, rTop?: number): this {
    const rt = rTop === undefined ? r : rTop;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const x0 = cx + Math.cos(a0) * r, z0 = cz + Math.sin(a0) * r;
      const x1 = cx + Math.cos(a1) * r, z1 = cz + Math.sin(a1) * r;
      const tx0 = cx + Math.cos(a0) * rt, tz0 = cz + Math.sin(a0) * rt;
      const tx1 = cx + Math.cos(a1) * rt, tz1 = cz + Math.sin(a1) * rt;
      this.quad([x1, y0, z1], [x0, y0, z0], [tx0, y0 + h, tz0], [tx1, y0 + h, tz1], color);
      if (rt > 0) this.tri([cx, y0 + h, cz], [tx1, y0 + h, tz1], [tx0, y0 + h, tz0], top || color);
    }
    return this;
  }
  /** cone (cyl with zero top radius) */
  cone(cx: number, y0: number, cz: number, r: number, h: number, n: number, color: THREE.Color): this {
    return this.cyl(cx, y0, cz, r, h, n, color, color, 0);
  }
  /** low-poly blob: an octahedron-ish crown */
  blob(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, color: THREE.Color, top?: THREE.Color): this {
    const n = 6;
    const t = top || color;
    const ring: number[][] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      ring.push([cx + Math.cos(a) * rx, cy, cz + Math.sin(a) * rz]);
    }
    const up = [cx, cy + ry, cz], dn = [cx, cy - ry * 0.7, cz];
    for (let i = 0; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      this.tri(up, b, a, t);
      this.tri(dn, a, b, color);
    }
    return this;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
  get empty(): boolean {
    return this.pos.length === 0;
  }
}

/* ---------- materials ---------- */
export const snowUniform = { value: 0 };
export const nightUniform = { value: 0 };

/** Patch a standard material so upward-facing surfaces whiten in winter. */
function snowy(m: THREE.MeshStandardMaterial, strength = 1): THREE.MeshStandardMaterial {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSnow = snowUniform;
    shader.uniforms.uSnowK = { value: strength };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vUpN;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvUpN = normalize(mat3(modelMatrix) * objectNormal).y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vUpN;\nuniform float uSnow;\nuniform float uSnowK;')
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\n diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.95, 0.99), uSnow * uSnowK * smoothstep(0.3, 0.72, vUpN));',
      );
  };
  m.customProgramCacheKey = () => 'snowy' + strength;
  return m;
}

export const MAT = {
  solid: snowy(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.88, metalness: 0 })),
  ground: snowy(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0 })),
  road: snowy(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, metalness: 0 }), 0.25),
  water: new THREE.MeshStandardMaterial({ color: 0x3f86c8, transparent: true, opacity: 0.82, roughness: 0.12, metalness: 0.1 }),
  ice: new THREE.MeshStandardMaterial({ color: 0xdfeaf4, roughness: 0.3, metalness: 0 }),
  /** vertex-coloured, unlit: signs, lamps, flames, lights */
  glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
  /** windows: dark glass by day, warm light by night (emissive driven per frame) */
  windowA: new THREE.MeshStandardMaterial({ color: 0x4a6a8a, roughness: 0.2, metalness: 0.3, emissive: 0xffc870, emissiveIntensity: 0 }),
  windowB: new THREE.MeshStandardMaterial({ color: 0x4a6a8a, roughness: 0.2, metalness: 0.3, emissive: 0xffd890, emissiveIntensity: 0 }),
  windowC: new THREE.MeshStandardMaterial({ color: 0x4a6a8a, roughness: 0.2, metalness: 0.3, emissive: 0xfff0c0, emissiveIntensity: 0 }),
  /** instanced things tinted per instance (cars, people) */
  tint: snowy(new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.75, metalness: 0.05 }), 0.6),
  tintGlow: new THREE.MeshBasicMaterial({ color: 0xffffff }),
};

/* ---------- InstancedPool ---------- */
const M4 = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const E = new THREE.Euler();
const P = new THREE.Vector3();
const S = new THREE.Vector3();
export class InstancedPool {
  mesh: THREE.InstancedMesh;
  n = 0;
  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, public cap: number, scene: THREE.Object3D, castShadow = true) {
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // create the colour buffer up front so the shader is compiled with it
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.castShadow = castShadow;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  begin(): void {
    this.n = 0;
  }
  /** add with yaw + optional pitch/roll; returns false when full */
  add(x: number, y: number, z: number, yaw = 0, scale = 1, color?: THREE.Color | null, pitch = 0, roll = 0, sy?: number): boolean {
    if (this.n >= this.cap) return false;
    E.set(pitch, yaw, roll, 'YXZ');
    Q.setFromEuler(E);
    P.set(x, y, z);
    S.set(scale, sy === undefined ? scale : sy, scale);
    M4.compose(P, Q, S);
    this.mesh.setMatrixAt(this.n, M4);
    if (color) this.mesh.setColorAt(this.n, color);
    this.n++;
    return true;
  }
  addMatrix(m: THREE.Matrix4, color?: THREE.Color | null): boolean {
    if (this.n >= this.cap) return false;
    this.mesh.setMatrixAt(this.n, m);
    if (color) this.mesh.setColorAt(this.n, color);
    this.n++;
    return true;
  }
  end(): void {
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

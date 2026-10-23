/* ============================================================
   Procedural PBR textures, generated at load: albedo, normal
   and roughness maps for brick, render, roof tiles, slate,
   asphalt, paving, granite, grass, gravel, soil, bark, stone,
   wood and road paint, plus alpha-cut leaf and needle cards.
   Everything tiles seamlessly; `metres` is the real-world size
   one repeat covers, so geometry UVs are simply metres / size.
   ============================================================ */
import * as THREE from 'three';

export interface TexSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
  metres: number;
}

const ALL: THREE.Texture[] = [];
let RES = 1;
/** scale every generated texture (0.5 on integrated GPUs: 4× faster to build, a quarter of the memory) */
export function setTextureScale(s: number): void {
  RES = s;
}
export function setAnisotropy(n: number): void {
  for (const t of ALL) {
    t.anisotropy = n;
    t.needsUpdate = true;
  }
}

/* ---------- noise (integer hash, tileable value noise, worley) ---------- */
export function hash(x: number, y: number, s = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const wrap = (i: number, p: number): number => ((i % p) + p) % p;
function vnoise(x: number, y: number, p: number, s: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const x0 = wrap(ix, p), x1 = wrap(ix + 1, p), y0 = wrap(iy, p), y1 = wrap(iy + 1, p);
  const a = hash(x0, y0, s), b = hash(x1, y0, s), c = hash(x0, y1, s), d = hash(x1, y1, s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
/** tileable fbm over u,v ∈ [0,1): `period` lattice cells per repeat at the base octave */
export function fbm(u: number, v: number, period: number, oct = 4, s = 0): number {
  let sum = 0, amp = 0.5, p = period, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * vnoise(u * p, v * p, p, s + i * 31);
    norm += amp;
    amp *= 0.5;
    p *= 2;
  }
  return sum / norm;
}
/** tileable worley: distance to nearest feature point (cells) and that cell's id */
function worley(u: number, v: number, p: number, s: number): { d: number; d2: number; id: number } {
  const x = u * p, y = v * p;
  const ix = Math.floor(x), iy = Math.floor(y);
  let d = 9, d2 = 9, id = 0;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const cx = wrap(ix + i, p), cy = wrap(iy + j, p);
      const px = ix + i + hash(cx, cy, s), py = iy + j + hash(cx, cy, s + 7);
      const dd = Math.hypot(px - x, py - y);
      if (dd < d) { d2 = d; d = dd; id = hash(cx, cy, s + 13); }
      else if (dd < d2) d2 = dd;
    }
  return { d, d2, id };
}
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/* ---------- texture set builder ---------- */
interface Px { r: number; g: number; b: number; h: number; rough: number }

function dataTex(data: Uint8Array, size: number, srgb: boolean): THREE.DataTexture {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  ALL.push(t);
  return t;
}

/**
 * Fill a size×size tile. `fn` gets texel coords u,v ∈ [0,1) and metres
 * (xm, ym) and writes sRGB albedo (0..1), height in metres and roughness.
 * `bump` scales the normal map's strength.
 */
function build(size: number, metres: number, fn: (u: number, v: number, xm: number, ym: number, o: Px) => void, bump = 1): TexSet {
  size = Math.max(128, Math.round(size * RES));
  const n = size * size;
  const alb = new Uint8Array(n * 4), nor = new Uint8Array(n * 4), rgh = new Uint8Array(n * 4);
  const hgt = new Float32Array(n);
  const o: Px = { r: 0, g: 0, b: 0, h: 0, rough: 0.8 };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      o.r = o.g = o.b = 0.5; o.h = 0; o.rough = 0.8;
      fn(u, v, u * metres, v * metres, o);
      const i = y * size + x, k = i * 4;
      alb[k] = clamp01(o.r) * 255; alb[k + 1] = clamp01(o.g) * 255; alb[k + 2] = clamp01(o.b) * 255; alb[k + 3] = 255;
      hgt[i] = o.h;
      const r = clamp01(o.rough) * 255;
      rgh[k] = r; rgh[k + 1] = r; rgh[k + 2] = r; rgh[k + 3] = 255;
    }
  // normals from the height field (metres), DataTexture rows run bottom → top
  const texel = metres / size;
  const s = (bump / (2 * texel));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const xl = wrap(x - 1, size), xr = wrap(x + 1, size), yd = wrap(y - 1, size), yu = wrap(y + 1, size);
      const dx = (hgt[y * size + xr] - hgt[y * size + xl]) * s;
      const dy = (hgt[yu * size + x] - hgt[yd * size + x]) * s;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const k = (y * size + x) * 4;
      nor[k] = (-dx * inv * 0.5 + 0.5) * 255;
      nor[k + 1] = (-dy * inv * 0.5 + 0.5) * 255;
      nor[k + 2] = (inv * 0.5 + 0.5) * 255;
      nor[k + 3] = 255;
    }
  return { map: dataTex(alb, size, true), normalMap: dataTex(nor, size, false), roughnessMap: dataTex(rgh, size, false), metres };
}

/* ---------- generators ---------- */
type RGB = [number, number, number];
const rgb = (h: string): RGB => {
  const c = parseInt(h.slice(1), 16);
  return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
};

/** stretcher-bond brick: 8 bricks × 24 courses per 1.8 m tile */
export function brick(base: string, mortar = '#b8b0a2', seed = 1): TexSet {
  const B = rgb(base), M = rgb(mortar);
  const pitch = 0.225, course = 0.075, joint = 0.011;
  return build(1024, 1.8, (u, v, xm, ym, o) => {
    const row = Math.floor(ym / course);
    const xo = xm + (row % 2) * pitch * 0.5;
    const col = Math.floor(xo / pitch);
    const fx = xo - col * pitch, fy = ym - row * course;
    const id = hash(wrap(col, 8), row, seed);
    const id2 = hash(wrap(col, 8), row, seed + 5);
    const grain = fbm(u, v, 96, 3, seed + 3);
    const edge = Math.min(fx, pitch - joint - fx, fy, course - joint - fy);
    const chip = fbm(u, v, 48, 2, seed + 9) * 0.004;
    if (fx > pitch - joint || fy > course - joint || edge < chip * 0.5) {
      const m = 0.9 + fbm(u, v, 160, 2, seed + 4) * 0.2;
      o.r = M[0] * m; o.g = M[1] * m; o.b = M[2] * m;
      o.h = -0.007 + grain * 0.002; o.rough = 0.96;
      return;
    }
    // per-brick colour: lightness and hue drift, a few overfired dark bricks
    const dark = id2 > 0.9 ? 0.62 : 1;
    const l = (0.82 + id * 0.3) * dark * (0.9 + grain * 0.2);
    const warm = (hash(wrap(col, 8), row, seed + 11) - 0.5) * 0.08;
    const soot = fbm(u, v, 6, 3, seed + 21);
    const sootK = smooth(0.55, 0.8, soot) * 0.25;
    o.r = B[0] * l * (1 + warm) * (1 - sootK);
    o.g = B[1] * l * (1 - sootK);
    o.b = B[2] * l * (1 - warm) * (1 - sootK);
    const round = smooth(0, 0.006, edge);
    o.h = round * 0.004 + grain * 0.0015;
    o.rough = 0.82 + grain * 0.12;
  }, 1.2);
}

/** smooth or roughcast render; tinted by vertex colour, so keep it pale */
export function render(seed = 2): TexSet {
  return build(512, 3, (u, v, _x, _y, o) => {
    const n = fbm(u, v, 24, 4, seed);
    const f = fbm(u, v, 128, 2, seed + 1);
    const stain = smooth(0.62, 0.9, fbm(u, v, 4, 3, seed + 2)) * 0.05;
    const l = 0.9 + n * 0.08 + f * 0.04 - stain;
    o.r = l; o.g = l * 0.985; o.b = l * 0.96;
    o.h = f * 0.0015 + n * 0.001;
    o.rough = 0.88 + f * 0.1;
  }, 1);
}

/** clay pantiles, 8 × 8 per 2 m tile */
export function clayTiles(seed = 3): TexSet {
  const W = 0.25, H = 0.25;
  return build(1024, 2, (u, v, xm, ym, o) => {
    const row = Math.floor(ym / H);
    const xo = xm + (row % 2) * W * 0.5;
    const col = Math.floor(xo / W);
    const fx = (xo - col * W) / W, fy = (ym - row * H) / H;
    const id = hash(wrap(col, 8), wrap(row, 8), seed);
    // S-curve across the tile, lower edge of each course casts a lip
    const curve = Math.sin(fx * Math.PI * 2) * 0.5 + 0.5;
    const lip = smooth(0.0, 0.12, fy);
    const n = fbm(u, v, 64, 3, seed + 2);
    const lichen = smooth(0.62, 0.78, fbm(u, v, 12, 4, seed + 5));
    const l = (0.75 + id * 0.35) * (0.72 + curve * 0.35) * (0.6 + lip * 0.4) * (0.9 + n * 0.2);
    o.r = mix(0.62 * l, 0.42, lichen * 0.5);
    o.g = mix(0.3 * l, 0.42, lichen * 0.5);
    o.b = mix(0.2 * l, 0.3, lichen * 0.5);
    o.h = curve * 0.025 + fy * 0.012 + n * 0.002;
    o.rough = 0.7 + n * 0.2 + lichen * 0.1;
  }, 0.8);
}

/** natural slate, offset courses */
export function slate(seed = 4): TexSet {
  const W = 0.3, H = 0.22;
  return build(1024, 2.4, (u, v, xm, ym, o) => {
    const row = Math.floor(ym / H);
    const xo = xm + (row % 2) * W * 0.5;
    const col = Math.floor(xo / W);
    const fx = xo - col * W, fy = ym - row * H;
    const id = hash(wrap(col, 8), wrap(row, 11), seed);
    const n = fbm(u, v, 80, 3, seed + 1);
    const gap = fx < 0.006 || fy < 0.01 ? 1 : 0;
    const l = gap ? 0.08 : (0.22 + id * 0.12) * (0.85 + n * 0.3);
    o.r = l * 0.9; o.g = l * 0.95; o.b = l * 1.08;
    o.h = gap ? -0.004 : fy * 0.03 + n * 0.002;
    o.rough = 0.55 + n * 0.25;
  }, 0.8);
}

/** worn asphalt with exposed aggregate */
export function asphalt(seed = 5): TexSet {
  return build(1024, 4, (u, v, _x, _y, o) => {
    const n = fbm(u, v, 8, 4, seed);
    const f = fbm(u, v, 256, 2, seed + 1);
    const w = worley(u, v, 900, seed + 2);
    const stone = smooth(0.42, 0.3, w.d);
    const pale = w.id > 0.6 ? 1 : 0;
    const base = 0.2 + n * 0.06 + f * 0.04;
    const l = base + stone * (pale ? 0.16 : 0.06) * w.id;
    o.r = l; o.g = l * 1.0; o.b = l * 1.04;
    o.h = stone * 0.0025 + f * 0.0008;
    o.rough = 0.88 - stone * 0.15 + (n - 0.5) * 0.08;
  }, 1);
}

/** 600 mm concrete flags with slightly tilted slabs */
export function paving(seed = 6): TexSet {
  const S = 0.6, J = 0.006;
  return build(1024, 2.4, (u, v, xm, ym, o) => {
    const cx = Math.floor(xm / S), cy = Math.floor(ym / S);
    const fx = xm - cx * S, fy = ym - cy * S;
    const id = hash(wrap(cx, 4), wrap(cy, 4), seed);
    const tiltX = (hash(wrap(cx, 4), wrap(cy, 4), seed + 1) - 0.5) * 0.008;
    const tiltY = (hash(wrap(cx, 4), wrap(cy, 4), seed + 2) - 0.5) * 0.008;
    const f = fbm(u, v, 300, 2, seed + 3);
    const n = fbm(u, v, 12, 3, seed + 4);
    const edge = Math.min(fx, S - fx, fy, S - fy);
    if (edge < J) {
      o.r = 0.32; o.g = 0.31; o.b = 0.29;
      o.h = -0.004; o.rough = 0.95;
      return;
    }
    const l = (0.6 + id * 0.1) * (0.92 + f * 0.12) * (0.94 + n * 0.1);
    o.r = l * 1.0; o.g = l * 0.98; o.b = l * 0.94;
    o.h = tiltX * (fx / S - 0.5) + tiltY * (fy / S - 0.5) + f * 0.0008 + smooth(J, J + 0.01, edge) * 0.001;
    o.rough = 0.82 + f * 0.1;
  }, 1);
}

/** speckled granite for kerbs and copings */
export function granite(seed = 7): TexSet {
  return build(512, 1, (u, v, _x, _y, o) => {
    const f = fbm(u, v, 160, 2, seed);
    const w = worley(u, v, 140, seed + 1);
    const crystal = w.id > 0.82 ? 0.75 : w.id < 0.16 ? -0.25 : 0;
    const l = 0.52 + (f - 0.5) * 0.18 + crystal * smooth(0.5, 0.2, w.d) * 0.4;
    o.r = l; o.g = l * 0.99; o.b = l * 0.98;
    o.h = f * 0.0006;
    o.rough = 0.6 + f * 0.2;
  }, 1);
}

/** ground under the grass: greens, browns and soil showing through */
export function grassGround(seed = 8): TexSet {
  return build(1024, 8, (u, v, _x, _y, o) => {
    const big = fbm(u, v, 4, 4, seed);
    const mid = fbm(u, v, 40, 3, seed + 1);
    const fine = fbm(u, v, 320, 2, seed + 2);
    const soil = smooth(0.7, 0.86, fbm(u, v, 20, 3, seed + 3));
    const dry = smooth(0.5, 0.75, big);
    let r = mix(0.27, 0.42, dry), g = mix(0.44, 0.46, dry), b = mix(0.13, 0.16, dry);
    const l = 0.8 + mid * 0.32 + fine * 0.22;
    r *= l; g *= l; b *= l;
    o.r = mix(r, 0.2, soil * 0.35); o.g = mix(g, 0.16, soil * 0.35); o.b = mix(b, 0.1, soil * 0.35);
    o.h = fine * 0.006 + mid * 0.004;
    o.rough = 0.95;
  }, 0.6);
}

/** beach sand with wind ripples */
export function sand(seed = 16): TexSet {
  return build(512, 4, (u, v, xm, ym, o) => {
    const f = fbm(u, v, 200, 2, seed);
    const n = fbm(u, v, 6, 3, seed + 1);
    const ripple = Math.sin((xm * 0.8 + ym * 0.35) * 9 + fbm(u, v, 8, 2, seed + 2) * 6) * 0.5 + 0.5;
    const l = 0.72 + n * 0.12 + f * 0.08 - ripple * 0.04;
    o.r = l * 0.93; o.g = l * 0.84; o.b = l * 0.64;
    o.h = ripple * 0.006 + f * 0.001;
    o.rough = 0.92;
  }, 1);
}

/** weathered mountain rock: fractured slabs, lichen, scree */
export function rock(seed = 17): TexSet {
  return build(1024, 6, (u, v, _x, _y, o) => {
    const w = worley(u, v, 18, seed);
    const crack = smooth(0.06, 0.0, w.d2 - w.d);
    const n = fbm(u, v, 24, 4, seed + 1);
    const f = fbm(u, v, 160, 2, seed + 2);
    const lichen = smooth(0.62, 0.75, fbm(u, v, 10, 3, seed + 3));
    const l = (0.36 + w.id * 0.12 + n * 0.14 + f * 0.06) * (1 - crack * 0.55);
    o.r = mix(l * 1.02, 0.45, lichen * 0.35); o.g = mix(l * 0.99, 0.47, lichen * 0.35); o.b = mix(l * 0.94, 0.32, lichen * 0.35);
    o.h = (1 - crack) * 0.03 + n * 0.02 + f * 0.003;
    o.rough = 0.85 + f * 0.1;
  }, 1);
}

/** compacted gravel path */
export function gravel(seed = 9): TexSet {
  return build(512, 2, (u, v, _x, _y, o) => {
    const w = worley(u, v, 180, seed);
    const stone = smooth(0.55, 0.15, w.d);
    const n = fbm(u, v, 16, 3, seed + 1);
    const l = 0.42 + stone * (0.12 + w.id * 0.22) + n * 0.06;
    o.r = l * 1.02; o.g = l * 0.96; o.b = l * 0.86;
    o.h = stone * 0.006;
    o.rough = 0.9;
  }, 1);
}

/** flower-bed soil */
export function soil(seed = 10): TexSet {
  return build(512, 2, (u, v, _x, _y, o) => {
    const w = worley(u, v, 60, seed);
    const clod = smooth(0.6, 0.1, w.d);
    const n = fbm(u, v, 30, 3, seed + 1);
    const l = 0.18 + clod * 0.08 + n * 0.06;
    o.r = l * 1.25; o.g = l * 0.95; o.b = l * 0.7;
    o.h = clod * 0.01;
    o.rough = 0.97;
  }, 1);
}

/** furrowed bark: u around the trunk, v along it */
export function bark(seed = 11, birch = false): TexSet {
  return build(512, 1, (u, v, _x, _y, o) => {
    if (birch) {
      const n = fbm(u, v, 8, 4, seed);
      const lent = smooth(0.78, 0.86, fbm(u * 0.3, v * 6, 24, 3, seed + 1));
      const patch = smooth(0.7, 0.8, fbm(u, v, 5, 4, seed + 2));
      const l = 0.85 + n * 0.1;
      const d = Math.max(lent, patch) * 0.85;
      o.r = l * (1 - d) * 0.97; o.g = l * (1 - d) * 0.95; o.b = l * (1 - d) * 0.9;
      o.h = -d * 0.002;
      o.rough = 0.6;
      return;
    }
    const ridge = Math.abs(fbm(u, v * 0.25, 12, 4, seed) * 2 - 1);
    const n = fbm(u, v, 64, 3, seed + 1);
    const moss = smooth(0.6, 0.75, fbm(u, v, 6, 3, seed + 2));
    const l = 0.18 + (1 - ridge) * 0.2 + n * 0.06;
    o.r = mix(l * 1.15, 0.22, moss * 0.6); o.g = mix(l * 0.98, 0.3, moss * 0.6); o.b = mix(l * 0.85, 0.12, moss * 0.6);
    o.h = (1 - ridge) * 0.02 + n * 0.003;
    o.rough = 0.92;
  }, 1);
}

/** ashlar stone blocks (embankment, plinths, sills) */
export function ashlar(base = '#a9a191', seed = 12): TexSet {
  const B = rgb(base);
  const W = 0.6, H = 0.3, J = 0.008;
  return build(1024, 2.4, (u, v, xm, ym, o) => {
    const row = Math.floor(ym / H);
    const xo = xm + (row % 2) * W * 0.5;
    const col = Math.floor(xo / W);
    const fx = xo - col * W, fy = ym - row * H;
    const id = hash(wrap(col, 4), wrap(row, 8), seed);
    const n = fbm(u, v, 40, 4, seed + 1);
    const f = fbm(u, v, 220, 2, seed + 2);
    const edge = Math.min(fx, W - fx, fy, H - fy);
    if (edge < J) {
      o.r = B[0] * 0.55; o.g = B[1] * 0.55; o.b = B[2] * 0.55;
      o.h = -0.008; o.rough = 0.95;
      return;
    }
    const wet = smooth(0.55, 0.8, fbm(u, v, 3, 3, seed + 3)) * 0.18;
    const l = (0.82 + id * 0.25) * (0.88 + n * 0.2 + f * 0.08) * (1 - wet);
    o.r = B[0] * l; o.g = B[1] * l; o.b = B[2] * l;
    o.h = smooth(J, J + 0.03, edge) * 0.006 + n * 0.004;
    o.rough = 0.85 + f * 0.1;
  }, 1);
}

/** weathered timber planks running along v */
export function planks(seed = 13): TexSet {
  const P = 0.15;
  return build(512, 1.2, (u, v, xm, _y, o) => {
    const k = Math.floor(xm / P);
    const fx = xm - k * P;
    const id = hash(wrap(k, 8), 0, seed);
    const grain = fbm(u * 8, v * 0.5, 16, 4, seed + k);
    const gap = fx < 0.004 ? 1 : 0;
    const l = gap ? 0.1 : (0.4 + id * 0.15) * (0.8 + grain * 0.4);
    o.r = l * 1.1; o.g = l * 0.92; o.b = l * 0.72;
    o.h = gap ? -0.003 : grain * 0.0015;
    o.rough = 0.8;
  }, 1);
}

/** white thermoplastic road paint, worn; alpha in the map */
export function roadPaint(seed = 14): THREE.Texture {
  const size = 512, n = size * size;
  const d = new Uint8Array(n * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const wear = fbm(u, v, 12, 4, seed);
      const pits = fbm(u, v, 160, 2, seed + 1);
      const a = smooth(0.28, 0.4, wear) * smooth(0.25, 0.4, pits);
      const k = (y * size + x) * 4;
      const l = 0.86 + pits * 0.1;
      d[k] = l * 255; d[k + 1] = l * 255; d[k + 2] = l * 250; d[k + 3] = a * 255;
    }
  return dataTex(d, size, true);
}

/* ---------- foliage cards (canvas-drawn, alpha) ---------- */
function canvasTex(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  ALL.push(t);
  return t;
}
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** a sprig of broad leaves; `hue` shifts green ↔ yellow */
export function leafCard(seed = 1, small = false): THREE.Texture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const R = rng(seed);
  // twig spine
  g.strokeStyle = '#4a3a28';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(S * 0.5, S * 0.98);
  g.quadraticCurveTo(S * 0.45, S * 0.6, S * 0.52, S * 0.12);
  g.stroke();
  const count = small ? 90 : 46;
  for (let i = 0; i < count; i++) {
    const t = R();
    const bx = S * (0.5 + (R() - 0.5) * 0.15), by = S * (0.95 - t * 0.85);
    const ang = (R() - 0.5) * 2.6 + (R() > 0.5 ? 0.6 : -0.6);
    const len = S * (small ? 0.07 + R() * 0.05 : 0.13 + R() * 0.09) * (1 - t * 0.35);
    const wid = len * (0.42 + R() * 0.12);
    const off = len * 0.8;
    const lx = bx + Math.sin(ang) * off, ly = by - Math.cos(ang) * off * 0.9;
    g.save();
    g.translate(lx, ly);
    g.rotate(ang);
    const l = 0.75 + R() * 0.4;
    const hue = 95 + (R() - 0.5) * 22;
    const grad = g.createLinearGradient(-wid, 0, wid, 0);
    grad.addColorStop(0, `hsl(${hue}, 48%, ${20 * l}%)`);
    grad.addColorStop(0.5, `hsl(${hue + 4}, 52%, ${32 * l}%)`);
    grad.addColorStop(1, `hsl(${hue}, 46%, ${24 * l}%)`);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, len * 0.55);
    g.bezierCurveTo(wid, len * 0.3, wid * 0.9, -len * 0.3, 0, -len * 0.6);
    g.bezierCurveTo(-wid * 0.9, -len * 0.3, -wid, len * 0.3, 0, len * 0.55);
    g.fill();
    g.strokeStyle = `hsla(${hue}, 40%, ${45 * l}%, 0.6)`;
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(0, len * 0.5);
    g.lineTo(0, -len * 0.5);
    g.stroke();
    g.restore();
  }
  return canvasTex(c);
}

/** a spruce branchlet: a woody stem with dense needles */
export function needleCard(seed = 2): THREE.Texture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const R = rng(seed);
  const stems: [number, number, number, number][] = [[S * 0.5, S * 0.98, S * 0.5, S * 0.05]];
  for (let i = 0; i < 9; i++) {
    const t = 0.15 + i * 0.09;
    const y = S * (0.98 - t * 0.95);
    const side = i % 2 ? 1 : -1;
    const len = S * (0.38 - t * 0.25);
    stems.push([S * 0.5, y, S * 0.5 + side * len, y - len * 0.45]);
  }
  for (const [x0, y0, x1, y1] of stems) {
    g.strokeStyle = '#3c2e1e';
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    const n = Math.hypot(x1 - x0, y1 - y0) / 2.4;
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
      for (const side of [-1, 1]) {
        const a = Math.atan2(y1 - y0, x1 - x0) + side * (0.9 + R() * 0.4);
        const L = 14 + R() * 10;
        const l = 14 + R() * 14;
        g.strokeStyle = `hsl(${128 + R() * 16}, ${32 + R() * 15}%, ${l}%)`;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(px, py);
        g.lineTo(px + Math.cos(a) * L, py + Math.sin(a) * L);
        g.stroke();
      }
    }
  }
  return canvasTex(c);
}

/** striped awning canvas */
export function awningCanvas(a: string, b: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? b : a;
    g.fillRect(i * 32, 0, 32, 64);
  }
  const img = g.getImageData(0, 0, 256, 64);
  for (let i = 0; i < img.data.length; i += 4) {
    const k = 0.92 + Math.random() * 0.08;
    img.data[i] *= k; img.data[i + 1] *= k; img.data[i + 2] *= k;
  }
  g.putImageData(img, 0, 0);
  const t = canvasTex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** painted shop fascia with serif lettering */
export function signTex(text: string, bg: string, fg: string, gold = false): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 160;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 1024, 160);
  g.strokeStyle = gold ? '#c9a24a' : fg;
  g.lineWidth = 6;
  g.strokeRect(14, 14, 996, 132);
  g.font = '600 88px Georgia, "Times New Roman", serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (gold) {
    const gr = g.createLinearGradient(0, 30, 0, 130);
    gr.addColorStop(0, '#f3dc8e'); gr.addColorStop(0.5, '#c9a24a'); gr.addColorStop(1, '#8d6a24');
    g.fillStyle = gr;
  } else g.fillStyle = fg;
  g.fillText(text, 512, 86);
  return canvasTex(c);
}

/** small street-name plate */
export function plateTex(text: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f4f2ea';
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = '#1b1b1b';
  g.lineWidth = 8;
  g.strokeRect(8, 8, 496, 112);
  g.fillStyle = '#1b1b1b';
  g.font = '700 58px "Helvetica Neue", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text.toUpperCase(), 256, 68);
  return canvasTex(c);
}

/** soft round sprite (snowflakes, light glows) */
export function softDot(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.75)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = canvasTex(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/** detail normal map for water: two octaves of soft ripples, tileable */
export function waterNormals(seed = 15): THREE.Texture {
  const size = 512, n = size * size;
  const h = new Float32Array(n);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      h[y * size + x] = fbm(u, v, 8, 5, seed) + 0.5 * fbm(u, v, 24, 3, seed + 9);
    }
  const d = new Uint8Array(n * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (h[y * size + wrap(x + 1, size)] - h[y * size + wrap(x - 1, size)]) * 6;
      const dy = (h[wrap(y + 1, size) * size + x] - h[wrap(y - 1, size) * size + x]) * 6;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const k = (y * size + x) * 4;
      d[k] = (-dx * inv * 0.5 + 0.5) * 255;
      d[k + 1] = (-dy * inv * 0.5 + 0.5) * 255;
      d[k + 2] = (inv * 0.5 + 0.5) * 255;
      d[k + 3] = 255;
    }
  return dataTex(d, size, false);
}

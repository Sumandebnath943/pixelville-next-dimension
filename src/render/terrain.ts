/* ============================================================
   Terrain (V2 look): the ground, water, mountains, trees, roads,
   rails and street lamps, built from the sim's tile maps with
   real materials. The map is cut into 32×32-tile chunks; a chunk
   is rebuilt only when a hash of its tiles (plus a one-tile
   border) or the season changes. Beyond the map: rolling hills
   and woods to the horizon, and the sea to the south.
   ============================================================ */
import * as THREE from 'three';
import { GW, GH, G_WATER, G_SAND, G_ROCK, MSIZE, World } from '../sim/world';
import { PAVEMENT_M, railBend } from '../sim/traffic';
import { PEAK_R, Peak, peakHeight, peakTrail, trailhead } from '../sim/peak';
import { Weather } from '../sim/weather';
import { Calamity } from '../sim/calamity';
import { MAT, hash2 } from './kit';
import { Kit, Palette, sharedPalette } from '../gfx/architecture';
import * as P from '../gfx/props';
import { WaterSystem } from '../gfx/water';
import { TreeLayer, TreeInstance, GrassStream, Species } from '../gfx/vegetation';
import { fbm, hash } from '../gfx/textures';
import { surface } from '../gfx/surface';
import { ENV } from '../gfx/env';
import { QualityProfile, PROFILES, LAYER_NO_REFLECT } from '../gfx/pipeline';

const TM = 8; // metres per tile
const CH = 32; // tiles per chunk side
const NCX = GW / CH, NCY = GH / CH;
const BED = -1.6; // river/lake bed depth
const WATER_Y = -0.35;
const KERB_H = 0.15;
/** how far in from the tile's edge a street lamp stands (the pavement is PAVEMENT_M wide) */
export const LAMP_IN = 1.15;
const MAP_W = GW * TM, MAP_H = GH * TM;
const UP = new THREE.Vector3(0, 1, 0);
const v3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/* ---------- a lamp's pool of light: brightest under the post, fading out ---------- */
function poolTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.62)');
  gr.addColorStop(0.6, 'rgba(255,255,255,0.18)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/* ---------- mountains ---------- */
interface Mtn { x: number; y: number; v?: number }
function mtnParams(m: Mtn) {
  const cx = (m.x + MSIZE / 2) * TM, cz = (m.y + MSIZE / 2) * TM;
  const seed = hash2(m.x, m.y);
  const H = 38 + (seed % 23) + ((m.v || 0) % 3) * 5;
  return { cx, cz, seed, H, half: (MSIZE * TM) / 2 };
}
export function mtnHeight(m: Mtn, x: number, z: number): number {
  const p = mtnParams(m);
  const u = (x - p.cx) / p.half, v = (z - p.cz) / p.half;
  const d = Math.pow(Math.pow(Math.abs(u), 4) + Math.pow(Math.abs(v), 4), 0.25);
  if (d >= 1) return 0;
  const s = (p.seed % 1000) / 100;
  // a main peak, a shoulder and ridges — rugged, but always a single massif
  const ridge = 0.12 * Math.sin(u * 5.3 + s) * Math.cos(v * 4.1 - s) + 0.06 * Math.sin((u + v) * 9.7 + s * 2);
  const shoulder = 0.35 * Math.exp(-((u - 0.35) ** 2 + (v + 0.25) ** 2) * 6);
  const base = Math.pow(1 - d, 1.35);
  return Math.max(0, p.H * (base * (1 + ridge) + shoulder * base));
}

/* ---------- V2 (Milestone 8): the shoreline ----------
   The sim's water is tiles, and V1's banks were their stair-stepped edges. Here the water
   mask is smoothed (a blur, then sampled between the tile corners) into a field that is ½
   on the old tile edges and rounds every corner; the ground near water follows it down a
   sloping bank to the bed, and the flat water surface cuts that slope along a smooth curve.
   Land that's built on (a building, a road, the railway, rock) never slopes. Walking, trees
   and grass follow the same field. */
const SHORE = { dirty: true, corner: new Float32Array((GW + 1) * (GH + 1)), zone: new Uint8Array(GW * GH) };
/** the field value where the bank meets the water's surface */
export const WATER_LINE = 0.62;
/** mark the shoreline for rebuilding (the map changed) */
export function shoreChanged(): void { SHORE.dirty = true; }
function shoreField(): typeof SHORE {
  if (!SHORE.dirty) return SHORE;
  SHORE.dirty = false;
  const N = GW * GH, wet = new Float32Array(N), blur = new Float32Array(N);
  for (let i = 0; i < N; i++) wet[i] = World.ground[i] === G_WATER ? 1 : 0;
  const hard = (i: number): boolean => World.ground[i] !== G_WATER && (!!World.bmap[i] || !!World.roadMap[i] || !!World.railMap[i] || World.ground[i] === G_ROCK);
  const at = (x: number, y: number): number => (y >= GH ? 1 : wet[World.idx(Math.max(0, Math.min(GW - 1, x)), Math.max(0, Math.min(GH - 1, y)))]);
  for (let y = 0; y < GH; y++)
    for (let x = 0; x < GW; x++) {
      let s = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += at(x + i, y + j) * (i ? 1 : 2) * (j ? 1 : 2);
      blur[World.idx(x, y)] = s / 16;
    }
  const bAt = (x: number, y: number): number => (y >= GH ? 1 : blur[World.idx(Math.max(0, Math.min(GW - 1, x)), Math.max(0, Math.min(GH - 1, y)))]);
  for (let cy = 0; cy <= GH; cy++)
    for (let cx = 0; cx <= GW; cx++) {
      let v = (bAt(cx - 1, cy - 1) + bAt(cx, cy - 1) + bAt(cx - 1, cy) + bAt(cx, cy)) / 4;
      for (const [i, j] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) if (World.inB(cx + i, cy + j) && hard(World.idx(cx + i, cy + j))) v = Math.min(v, 0.5);
      SHORE.corner[cy * (GW + 1) + cx] = v;
    }
  SHORE.zone.fill(0);
  for (let y = 0; y < GH; y++)
    for (let x = 0; x < GW; x++) {
      const i = World.idx(x, y);
      if (hard(i)) continue;
      let near = false;
      for (let j = -1; j <= 1 && !near; j++) for (let k = -1; k <= 1; k++) if (World.inB(x + k, y + j) && wet[World.idx(x + k, y + j)]) { near = true; break; }
      if (near) SHORE.zone[i] = 1;
    }
  return SHORE;
}
/** the smoothed water field at a point (0 dry land … 1 open water) */
export function waterField(x: number, z: number): number {
  const S = shoreField();
  const u = Math.max(0, Math.min(GW - 1e-4, x / TM)), v = Math.max(0, Math.min(GH - 1e-4, z / TM));
  const cx = Math.floor(u), cy = Math.floor(v), fx = u - cx, fy = v - cy, W = GW + 1;
  const c = S.corner;
  return (c[cy * W + cx] * (1 - fx) + c[cy * W + cx + 1] * fx) * (1 - fy) + (c[(cy + 1) * W + cx] * (1 - fx) + c[(cy + 1) * W + cx + 1] * fx) * fy;
}
/** the bank's height for a field value: level ground down a slope to the bed */
export function bankHeight(w: number): number {
  return w <= 0.5 ? 0 : BED * THREE.MathUtils.smoothstep(w, 0.5, 0.9);
}
/** is the tile near water (its ground is the sloping bank)? */
function inShore(tx: number, tz: number): boolean {
  return World.inB(tx, tz) && shoreField().zone[World.idx(tx, tz)] === 1;
}

/* ---------- V2 (Milestone 8): posts in the street (lamp posts, signal poles), solid to the Founder ---------- */
const POSTS = new Map<number, { x: number; z: number; r: number }[]>();
/** the posts on the tiles around (x, z) metres */
export function postsNear(x: number, z: number, out: { x: number; z: number; r: number }[] = []): { x: number; z: number; r: number }[] {
  out.length = 0;
  const tx = Math.floor(x / TM), tz = Math.floor(z / TM);
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) for (const p of POSTS.get(World.idx(tx + i, tz + j)) || []) out.push(p);
  return out;
}
function addPost(x: number, z: number, r: number): void {
  const k = World.idx(Math.floor(x / TM), Math.floor(z / TM));
  let l = POSTS.get(k);
  if (!l) POSTS.set(k, (l = []));
  l.push({ x, z, r });
}

/** V2 (Milestone 8): is the tile under one of the big peaks? */
function inPeak(tx: number, tz: number): boolean {
  for (const pk of World.peaks as Peak[]) if ((tx - pk.x) ** 2 + (tz - pk.y) ** 2 <= PEAK_R * PEAK_R) return true;
  return false;
}

/** ground height (m) at a world point: 0 on land, mountains rise, bridges sit on decks */
export function heightAt(x: number, z: number): number {
  let h = 0;
  for (const m of World.mountains as Mtn[]) {
    const p0x = m.x * TM, p0z = m.y * TM;
    if (x < p0x || z < p0z || x > p0x + MSIZE * TM || z > p0z + MSIZE * TM) continue;
    h = Math.max(h, mtnHeight(m, x, z));
  }
  // V2 (Milestone 8): the big peak
  for (const pk of World.peaks as Peak[]) {
    const R = (PEAK_R + 1) * TM, cx = (pk.x + 0.5) * TM, cz = (pk.y + 0.5) * TM;
    if (Math.abs(x - cx) > R || Math.abs(z - cz) > R) continue;
    h = Math.max(h, peakHeight(pk, x, z));
  }
  if (h > 0) return h;
  const tx = Math.floor(x / TM), tz = Math.floor(z / TM);
  if (World.inB(tx, tz)) {
    const i = World.idx(tx, tz);
    if (World.ground[i] === G_WATER && World.roadMap[i]) return 0.25;
    // (V2 (Milestone 8): down the bank into the water)
    if (inShore(tx, tz)) return bankHeight(waterField(x, z));
  }
  return 0;
}
/** true where the Founder can't walk or drive: open water without a bridge (V2 (Milestone 8): beyond the
 *  water's edge on the bank, not at the old tile line) */
export function isWaterAt(x: number, z: number): boolean {
  const tx = Math.floor(x / TM), tz = Math.floor(z / TM);
  if (!World.inB(tx, tz)) return true;
  const i = World.idx(tx, tz);
  if (World.roadMap[i] || World.railMap[i]) return false;
  if (!inShore(tx, tz)) return World.ground[i] === G_WATER;
  return waterField(x, z) > WATER_LINE;
}

/* ---------- tree placement (deterministic, shared with collisions) ---------- */
export function treeSpot(tx: number, ty: number): { x: number; z: number; s: number } {
  const h = hash2(tx * 3 + 1, ty * 5 + 2);
  return {
    x: tx * TM + 4 + ((h % 1000) / 1000 - 0.5) * 4.4,
    z: ty * TM + 4 + (((h >> 10) % 1000) / 1000 - 0.5) * 4.4,
    s: 0.85 + ((h >> 20) % 100) / 250,
  };
}
/** V1 tree values → V2 species (1 round, 2 pine, 3 poplar, 4 oak, 5 birch, 6 fruit) */
const SPECIES_OF: Species[] = ['lime', 'lime', 'spruce', 'lime', 'oak', 'birch', 'oak'];

/* ---------- seasonal ground tints ---------- */
const GRASS_TINT = [new THREE.Color(0.95, 1.06, 0.84), new THREE.Color(1, 1, 1), new THREE.Color(1.14, 0.98, 0.7), new THREE.Color(0.86, 0.86, 0.8)];
const DRY = new THREE.Color(1.3, 1.08, 0.6);
const WHITE = new THREE.Color(1, 1, 1);

/* ---------- beyond the map ---------- */
function outside(x: number, z: number): number {
  const dx = Math.max(0, -x, x - MAP_W), dz = Math.max(0, -z, z - MAP_H);
  return Math.hypot(dx, dz);
}
function backdropHeight(x: number, z: number): number {
  const d = outside(x, z);
  const k = THREE.MathUtils.smoothstep(d, 120, 1300) * (1 - THREE.MathUtils.smoothstep(z, MAP_H - 500, MAP_H + 50));
  if (k <= 0) return -0.15;
  const n = fbm((x + 9000) / 18000, (z + 9000) / 18000, 9, 5, 4);
  const ridge = fbm((x + 9000) / 18000, (z + 9000) / 18000, 22, 3, 9);
  return -0.15 + k * (Math.pow(n, 1.5) * 300 + ridge * 45);
}

interface Chunk { sig: string; meshes: THREE.Mesh[]; water?: THREE.Mesh }

export class Terrain {
  group = new THREE.Group();
  chunks: Chunk[] = [];
  water: WaterSystem;
  trees: TreeLayer;
  grass: GrassStream;
  lampSpots: { x: number; z: number }[] = [];
  private pal: Palette;
  private mtnMeshes: THREE.Mesh[] = [];
  private mtnSig = '';
  private treeSig = '';
  private lampMeshes: THREE.Mesh[] = [];
  private lampSig = '';
  private floodMesh: THREE.Mesh | null = null;
  private floodN = -1;
  private season = -1;
  private wasDry = false;
  private profile: QualityProfile;

  constructor(scene: THREE.Scene, profile?: QualityProfile) {
    this.profile = profile || PROFILES.medium;
    scene.add(this.group);
    this.pal = sharedPalette();
    P.registerGlow(this.pal);
    for (let i = 0; i < NCX * NCY; i++) this.chunks.push({ sig: '', meshes: [] });
    this.water = new WaterSystem(WATER_Y, this.profile.waterReflScale, 9); // (the town's water is a 4 m mesh)
    // (V2 (Milestone 8): the forest thins out with the quality: the far crowns go cheap sooner, and the haze
    // takes the farthest woods on the lighter presets)
    const q = this.profile.grassRange > 40 ? 'high' : this.profile.grassRange > 30 ? 'medium' : 'low';
    this.trees = new TreeLayer(scene, q === 'high' ? 170 : 95, 32000, q === 'high' ? 520 : q === 'medium' ? 380 : 240, q === 'high' ? 1500 : q === 'medium' ? 1100 : 700);
    this.grass = new GrassStream(scene, (x, z) => this.grassAt(x, z), this.profile.grassPerM2 * 0.8, this.profile.grassRange);
    this.buildBackdrop();
  }

  /* ---------- the world beyond the edges ---------- */
  private buildBackdrop(): void {
    const E = 3600;
    const lines = (lo: number, hi: number, inner0: number, inner1: number): number[] => {
      const out = new Set<number>([inner0, inner1]);
      for (let v = inner0; v <= inner1; v += 64) out.add(v);
      let v = inner1, step = 32;
      while (v < hi) { v += step; step *= 1.15; out.add(Math.min(v, hi)); }
      v = inner0; step = 32;
      while (v > lo) { v -= step; step *= 1.15; out.add(Math.max(v, lo)); }
      return [...out].sort((a, b) => a - b);
    };
    const xs = lines(-E, MAP_W + E, 0, MAP_W);
    const zs = lines(-E, MAP_H, 0, MAP_H).filter((z) => z <= MAP_H);
    const nx = xs.length, nz = zs.length;
    const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2);
    const c = new THREE.Color();
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const x = xs[i], z = zs[j], k = j * nx + i;
        pos.set([x, backdropHeight(x, z), z], k * 3);
        uv.set([x / 8, z / 8], k * 2);
        const fid = hash(Math.floor((x + 40) / 150), Math.floor((z + 30) / 100), 3);
        const field = fid < 0.5 ? c.setRGB(1, 1, 1) : fid < 0.72 ? c.setRGB(1.05, 1.12, 0.85) : fid < 0.88 ? c.setRGB(1.5, 1.22, 0.6) : c.setRGB(0.9, 0.65, 0.45);
        col.set([field.r, field.g, field.b], k * 3);
      }
    const idx: number[] = [];
    for (let j = 0; j < nz - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
        if (cx > 0 && cx < MAP_W && cz > 0 && cz < MAP_H) continue; // the map itself is drawn by chunks
        const a = j * nx + i, b = a + 1, cc = a + nx, d = cc + 1;
        idx.push(a, cc, b, b, cc, d);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const land = new THREE.Mesh(g, this.pal.mat('grass'));
    land.receiveShadow = true;
    this.group.add(land);

    // the open sea to the south, foaming on the coast (V2 (Milestone 8): a grid fine along the coast, coarser
    // out to the horizon; one 58 m quad across had every wave shimmer)
    const grow = (from: number, to: number, step: number, k: number): number[] => {
      const out: number[] = [];
      for (let v = from, s = step; from < to ? v < to : v > to; v += from < to ? s : -s, s *= k) out.push(v);
      out.push(to);
      return out;
    };
    const sxs = [...grow(0, -E, 12, 1.14).reverse(), ...grow(12, MAP_W, 12, 1).slice(0, -1), ...grow(MAP_W, MAP_W + E, 12, 1.14)];
    const szs = grow(MAP_H, MAP_H + E, 8, 1.09);
    const sv: number[] = [], shoreA: number[] = [], sidx: number[] = [];
    for (let j = 0; j < szs.length; j++) for (let i = 0; i < sxs.length; i++) { sv.push(sxs[i], WATER_Y, szs[j]); shoreA.push(szs[j] - MAP_H + 0.5); }
    for (let j = 0; j < szs.length - 1; j++)
      for (let i = 0; i < sxs.length - 1; i++) {
        const a = j * sxs.length + i, b = a + 1, c = a + sxs.length, d = c + 1;
        sidx.push(a, c, b, b, c, d);
      }
    const sea = new THREE.BufferGeometry();
    sea.setAttribute('position', new THREE.Float32BufferAttribute(sv, 3));
    sea.setAttribute('aShore', new THREE.Float32BufferAttribute(shoreA, 1));
    sea.setIndex(sidx);
    const seaMesh = new THREE.Mesh(sea);
    this.group.add(seaMesh);
    this.water.add(seaMesh);
    const bed = new THREE.Mesh(new THREE.PlaneGeometry(MAP_W + E * 2, E).rotateX(-Math.PI / 2).translate(MAP_W / 2, BED - 1.5, MAP_H + E / 2), this.pal.mat('sand'));
    this.group.add(bed);

    // woods on the hills (far away and hazy: 20-triangle crowns are plenty)
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const gp = geo.attributes.position;
    for (let i = 0; i < gp.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(gp, i);
      v.multiplyScalar(0.85 + hash(Math.round(v.x * 100), Math.round(v.y * 100 + v.z * 7), 1) * 0.3);
      gp.setXYZ(i, v.x, v.y + 1, v.z);
    }
    geo.computeVertexNormals();
    const mat = surface(new THREE.MeshStandardMaterial({ color: 0x2a3a1e, roughness: 0.95 }), { snow: 0.8, antiTile: 0.3 }, 'farTree');
    const N = 6000;
    const mesh = new THREE.InstancedMesh(geo, mat, N);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    let n = 0;
    for (let k = 0; k < N * 8 && n < N; k++) {
      const x = -E + hash(k, 1, 4) * (MAP_W + E * 2), z = -E + hash(k, 2, 4) * (MAP_H + E);
      if (outside(x, z) < 60 || z > MAP_H - 100) continue;
      const wood = fbm((x + 9000) / 18000, (z + 9000) / 18000, 14, 4, 12);
      if (wood < 0.52 && hash(k, 3, 4) > 0.05) continue;
      const h = 9 + hash(k, 5, 4) * 9;
      s.set(h * 0.42, h * 0.6, h * 0.42);
      q.setFromAxisAngle(UP, hash(k, 6, 4) * 6.28);
      p.set(x, backdropHeight(x, z) - 1, z);
      mesh.setMatrixAt(n, m4.compose(p, q, s));
      mesh.setColorAt(n, new THREE.Color().setHSL(0.24 + hash(k, 7, 4) * 0.08, 0.35, 0.5 + hash(k, 8, 4) * 0.3));
      n++;
    }
    mesh.count = n;
    mesh.computeBoundingSphere();
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  /** call when World changed (mapVersion bump) or every few seconds */
  update(force = false): void {
    const season = Weather.season;
    const dry = Calamity.droughtLevel >= 0.5;
    if (season !== this.season || dry !== this.wasDry) {
      this.season = season;
      this.wasDry = dry;
      force = true;
    }
    let changed = false;
    shoreChanged();
    for (let cy = 0; cy < NCY; cy++)
      for (let cx = 0; cx < NCX; cx++) {
        const sig = this.chunkSig(cx, cy) + '|' + season + (dry ? 'd' : '');
        const ch = this.chunks[cy * NCX + cx];
        if (sig === ch.sig) continue;
        ch.sig = sig;
        this.buildChunk(cx, cy, ch);
        changed = true;
      }
    if (changed || force) this.grass.reset();
    this.updateMountains();
    this.updateTrees();
    this.updateLamps();
  }

  private chunkSig(cx: number, cy: number): string {
    let h1 = 0, h2 = 0;
    const x0 = cx * CH - 1, y0 = cy * CH - 1;
    for (let y = y0; y <= y0 + CH + 1; y++)
      for (let x = x0; x <= x0 + CH + 1; x++) {
        if (!World.inB(x, y)) continue;
        const i = World.idx(x, y);
        // (V2 (Milestone 8): built-on land never slopes down to the water, so a building's plot counts too)
        const v = World.ground[i] | (World.roadMap[i] << 2) | (World.railMap[i] << 3) | (World.bmap[i] ? 16 : 0);
        h1 = (Math.imul(h1, 31) + v * (x + 1)) | 0;
        h2 = (Math.imul(h2, 17) + v * (y + 3)) | 0;
      }
    return h1 + ':' + h2;
  }

  private buildChunk(cx: number, cy: number, ch: Chunk): void {
    for (const m of ch.meshes) { this.group.remove(m); m.geometry.dispose(); }
    ch.meshes = [];
    if (ch.water) { this.group.remove(ch.water); this.water.remove(ch.water); ch.water.geometry.dispose(); ch.water = undefined; }
    const kit = new Kit(this.pal);
    const season = this.season;
    const tint = this.wasDry && season !== 3 ? GRASS_TINT[season].clone().multiply(DRY) : GRASS_TINT[season];
    const keyOf = (tx: number, ty: number): string => {
      const i = World.idx(tx, ty), gr = World.ground[i];
      if (gr === G_WATER) return 'water';
      if (World.roadMap[i]) return 'road';
      if (inShore(tx, ty)) return 'shore'; // (V2 (Milestone 8): the sloping bank, drawn on its own below)
      if (gr === G_ROCK && inPeak(tx, ty)) return 'peak'; // (V2 (Milestone 8): the big mountain draws its own ground)
      return gr === G_SAND ? 'sand' : gr === G_ROCK ? 'rock' : 'grass';
    };
    const soilC = new THREE.Color(0.62, 0.55, 0.46);
    for (let ty = cy * CH; ty < cy * CH + CH; ty++) {
      // land in runs of the same surface along the row
      let tx = cx * CH;
      while (tx < cx * CH + CH) {
        const k = keyOf(tx, ty);
        let end = tx + 1;
        while (end < cx * CH + CH && keyOf(end, ty) === k) end++;
        const x0 = tx * TM, x1 = end * TM, z0 = ty * TM, z1 = z0 + TM;
        if (k === 'grass' || k === 'sand' || k === 'rock') {
          const c = k === 'grass' ? tint : k === 'sand' && season === 3 ? new THREE.Color(0.95, 0.95, 0.95) : WHITE;
          kit.quad(k, v3(x0, 0, z1), v3(x1, 0, z1), v3(x1, 0, z0), v3(x0, 0, z0), UP, c);
        }
        tx = end;
      }
      for (let tx2 = cx * CH; tx2 < cx * CH + CH; tx2++) {
        const i = World.idx(tx2, ty);
        // V2 (Milestone 8): water and the land around it: the bank sloping down along the smoothed shoreline
        // (V1's sheer earth walls along the tile edges are gone)
        if (inShore(tx2, ty)) this.bankTile(kit, tx2, ty, tint, soilC);
        if (World.roadMap[i]) this.roadTile(kit, tx2, ty, World.ground[i] === G_WATER);
        if (World.railMap[i]) this.railTile(kit, tx2, ty, World.ground[i] === G_WATER, World.isRoad(tx2, ty));
      }
    }
    kit.base = new THREE.Matrix4();
    ch.meshes = kit.build(this.group, true);
    for (const m of ch.meshes) m.castShadow = m.name !== 'grass' && m.name !== 'sand' && m.name !== 'soil';
    this.buildWater(cx, cy, ch);
  }

  /* V2 (Milestone 8): which way the water runs, tile by tile: downhill to the sea along the river's own course
     (a walk outwards from the sea through the water), quick where the river is narrow, slow across the lakes,
     still at sea. Rebuilt when the water changes. */
  private flow: Float32Array | null = null;
  private flowStamp = -1;
  private flowField(): Float32Array {
    if (this.flow && this.flowStamp === World.waterStamp) return this.flow;
    this.flowStamp = World.waterStamp;
    const N = GW * GH, dist = new Float32Array(N).fill(1e9), q = new Int32Array(N);
    const wet = (x: number, y: number): boolean => World.inB(x, y) && World.ground[World.idx(x, y)] === G_WATER;
    let qn = 0, qi = 0;
    for (let x = 0; x < GW; x++) if (wet(x, GH - 1)) { dist[World.idx(x, GH - 1)] = 0; q[qn++] = World.idx(x, GH - 1); }
    // (a river or lake that never reaches the sea runs towards its own southern end; an older map's river stops at
    // the beach)
    const body = new Int32Array(N).fill(-1);
    const walk = (seeds: number[], tag: number): void => {
      for (const s0 of seeds) body[s0] = tag;
      for (let h = 0; h < seeds.length; h++) {
        const c = seeds[h], x = c % GW, y = (c / GW) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          if (!wet(x + dx, y + dy)) continue;
          const ni = World.idx(x + dx, y + dy);
          if (body[ni] >= 0) continue;
          body[ni] = tag;
          seeds.push(ni);
        }
      }
    };
    walk(Array.from(q.subarray(0, qn)), 0);
    let tag = 1;
    for (let i = 0; i < N; i++) {
      if (body[i] >= 0 || World.ground[i] !== G_WATER) continue;
      const members = [i];
      walk(members, tag++);
      let low = members[0];
      for (const m of members) if (((m / GW) | 0) > ((low / GW) | 0)) low = m;
      dist[low] = 0;
      q[qn++] = low;
    }
    while (qi < qn) {
      const c = q[qi++], x = c % GW, y = (c / GW) | 0;
      // (eight ways round: a river carved on the slant touches only corner to corner here and there)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!wet(nx, ny)) continue;
        const ni = World.idx(nx, ny);
        if (dist[ni] <= dist[c] + 1) continue;
        dist[ni] = dist[c] + 1;
        q[qn++] = ni;
      }
    }
    const f = new Float32Array(N * 2);
    const d = (x: number, y: number, fb: number): number => (wet(x, y) && dist[World.idx(x, y)] < 1e8 ? dist[World.idx(x, y)] : fb);
    for (let y = 0; y < GH; y++)
      for (let x = 0; x < GW; x++) {
        const i = World.idx(x, y);
        if (!wet(x, y) || dist[i] > 1e8) continue;
        const here = dist[i];
        // down the slope of the distance to the sea
        let gx = d(x - 1, y, here) - d(x + 1, y, here), gy = d(x, y - 1, here) - d(x, y + 1, here);
        const gl = Math.hypot(gx, gy);
        if (gl < 1e-3) continue;
        gx /= gl; gy /= gl;
        let n = 0;
        for (let j = -2; j <= 2; j++) for (let k = -2; k <= 2; k++) if (wet(x + k, y + j)) n++;
        const sea = body[i] === 0 ? THREE.MathUtils.smoothstep(here, 4, 14) : 1; // (the open sea doesn't run)
        const v = THREE.MathUtils.clamp((27 - n) / 20, 0.1, 0.6) * sea; // (a three-tile river runs; a lake barely)
        f[i * 2] = gx * v; f[i * 2 + 1] = gy * v;
      }
    this.flow = f;
    return f;
  }
  /** the current at a point (metres): blended between the tile centres around it */
  private flowAt(x: number, z: number, f: Float32Array): [number, number] {
    const u = x / TM - 0.5, v = z / TM - 0.5, x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
    let ax = 0, az = 0;
    for (const [i, j, w] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]]) {
      if (!World.inB(x0 + i, y0 + j)) continue;
      const k = World.idx(x0 + i, y0 + j) * 2;
      ax += f[k] * w; az += f[k + 1] * w;
    }
    return [ax, az];
  }

  /* V2 (Milestone 8): one tile of shore: a 2 m grid whose height follows the smoothed water field, grass (or the
     beach's sand) above the water line, earth (or sand) down the bank and on the bed */
  private bankTile(kit: Kit, tx: number, ty: number, grass: THREE.Color, soil: THREE.Color): void {
    const N = 4, s = TM / N, x0 = tx * TM, z0 = ty * TM;
    const gr = World.ground[World.idx(tx, ty)];
    let beach = gr === G_SAND;
    for (let j = -1; j <= 1 && !beach; j++) for (let i = -1; i <= 1; i++) if (World.inB(tx + i, ty + j) && World.ground[World.idx(tx + i, ty + j)] === G_SAND) { beach = true; break; }
    const winterSand = this.season === 3 ? new THREE.Color(0.95, 0.95, 0.95) : WHITE;
    const bedC = this.wasDry && this.season !== 3 ? new THREE.Color(0.95, 0.85, 0.65) : soil;
    const H: number[] = [];
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) H.push(bankHeight(waterField(x0 + i * s, z0 + j * s)));
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    const tri = (p: THREE.Vector3, q: THREE.Vector3, r: THREE.Vector3): void => {
      n.crossVectors(e1.subVectors(r, p), e2.subVectors(q, p)).normalize();
      if (n.y < 0) n.negate();
      // (grass, or the beach's sand, all the way down to the water: the surface cuts the bank along a smooth
      // line, where a change of ground triangle by triangle would show a sawtooth; the bed below is earth)
      const h = Math.max(p.y, q.y, r.y);
      const dry = h > WATER_Y - 0.06;
      const key = dry ? (beach ? 'sand' : 'grass') : beach ? 'sand' : 'soil';
      const col = key === 'grass' ? grass : key === 'sand' ? winterSand : bedC;
      kit.tri(key, p.clone(), q.clone(), r.clone(), n.clone(), col);
    };
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const k = j * (N + 1) + i;
        a.set(x0 + i * s, H[k], z0 + j * s);
        b.set(x0 + (i + 1) * s, H[k + 1], z0 + j * s);
        c.set(x0 + (i + 1) * s, H[k + N + 2], z0 + (j + 1) * s);
        const d = new THREE.Vector3(x0 + i * s, H[k + N + 1], z0 + (j + 1) * s);
        tri(a.clone(), d, c.clone());
        tri(a.clone(), c.clone(), b.clone());
      }
  }

  /** the water surface of one chunk, 4 m quads, with distance-to-shore per vertex */
  private buildWater(cx: number, cy: number, ch: Chunk): void {
    const pos: number[] = [], shore: number[] = [], idx: number[] = [], flow: number[] = [];
    const ff = this.flowField();
    const isWater = (x: number, y: number): boolean => !World.inB(x, y) ? y >= GH : World.ground[World.idx(x, y)] === G_WATER;
    const shoreAt = (x: number, z: number): number => {
      const tx = Math.floor(x / TM), tz = Math.floor(z / TM);
      let best = 12;
      for (let j = -2; j <= 2; j++)
        for (let i = -2; i <= 2; i++) {
          if (isWater(tx + i, tz + j)) continue;
          const rx0 = (tx + i) * TM, rz0 = (tz + j) * TM;
          const dx = Math.max(rx0 - x, 0, x - (rx0 + TM)), dz = Math.max(rz0 - z, 0, z - (rz0 + TM));
          best = Math.min(best, Math.hypot(dx, dz));
        }
      return best;
    };
    const S = 2;
    for (let ty = cy * CH; ty < cy * CH + CH; ty++)
      for (let tx = cx * CH; tx < cx * CH + CH; tx++) {
        const i = World.idx(tx, ty);
        // (V2 (Milestone 8): and the land tiles whose rounded bank dips under the surface)
        if (World.ground[i] !== G_WATER) {
          if (!inShore(tx, ty)) continue;
          let deep = 0;
          for (const [cx2, cz2] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]]) deep = Math.max(deep, waterField((tx + cx2) * TM, (ty + cz2) * TM));
          if (deep < WATER_LINE - 0.02) continue;
        }
        const base = pos.length / 3;
        for (let j = 0; j <= S; j++)
          for (let k = 0; k <= S; k++) {
            const x = tx * TM + (k / S) * TM, z = ty * TM + (j / S) * TM;
            pos.push(x, WATER_Y, z);
            // metres out from the water's edge on the bank (the foam and the shallows' colour follow it)
            shore.push(Math.max(0, (waterField(x, z) - WATER_LINE) * 16) + Math.max(0, shoreAt(x, z) - 4));
            flow.push(...this.flowAt(x, z, ff));
          }
        for (let j = 0; j < S; j++)
          for (let k = 0; k < S; k++) {
            const a = base + j * (S + 1) + k, b = a + 1, c = a + S + 1, d = c + 1;
            idx.push(a, c, b, b, c, d);
          }
      }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aShore', new THREE.Float32BufferAttribute(shore, 1));
    g.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 2));
    g.setIndex(idx);
    const m = new THREE.Mesh(g);
    m.position.y = this.water.level - WATER_Y;
    this.group.add(m);
    m.updateMatrixWorld();
    this.water.add(m);
    ch.water = m;
  }

  private roadTile(kit: Kit, tx: number, ty: number, bridge: boolean): void {
    const x0 = tx * TM, z0 = ty * TM, x1 = x0 + TM, z1 = z0 + TM;
    const y = bridge ? 0.25 : 0.02;
    const R = (x: number, yy: number): boolean => World.isRoad(x, yy);
    const n = R(tx, ty - 1), s = R(tx, ty + 1), w = R(tx - 1, ty), e = R(tx + 1, ty);
    const kc = new THREE.Color(0.9, 0.9, 0.88);
    kit.base = new THREE.Matrix4();
    if (bridge) {
      kit.box('ashlar', x0, -0.55, z0, x1, y - 0.02, z1, new THREE.Color(0.9, 0.88, 0.84));
      kit.box('ashlar', x0 + 3.2, BED - 0.2, z0 + 3.2, x0 + 4.8, -0.55, z0 + 4.8, new THREE.Color(0.85, 0.83, 0.8));
    }
    kit.quad('asphalt', v3(x0, y, z1), v3(x1, y, z1), v3(x1, y, z0), v3(x0, y, z0), UP);
    // pavements with granite kerbs on every edge facing open ground; stone parapets on bridges
    // (V2 (Milestone 8): 1.4 m, was 1.8: the carriageway between the kerbs is now 5.2 m, two real lanes)
    const SW = PAVEMENT_M;
    const strip = (ax0: number, az0: number, ax1: number, az1: number, side: 'n' | 's' | 'w' | 'e'): void => {
      if (bridge) {
        const t = 0.35;
        const [bx0, bz0, bx1, bz1] = side === 'n' ? [ax0, az0, ax1, az0 + t] : side === 's' ? [ax0, az1 - t, ax1, az1] : side === 'w' ? [ax0, az0, ax0 + t, az1] : [ax1 - t, az0, ax1, az1];
        kit.box('ashlar', bx0, y, bz0, bx1, y + 0.95, bz1, new THREE.Color(0.9, 0.88, 0.84));
        kit.box('granite', bx0 - 0.03, y + 0.95, bz0 - 0.03, bx1 + 0.03, y + 1.05, bz1 + 0.03, kc);
        return;
      }
      kit.box('paving', ax0, 0, az0, ax1, KERB_H, az1);
      const k = 0.26;
      const [kx0, kz0, kx1, kz1] = side === 'n' ? [ax0, az1 - k, ax1, az1] : side === 's' ? [ax0, az0, ax1, az0 + k] : side === 'w' ? [ax1 - k, az0, ax1, az1] : [ax0, az0, ax0 + k, az1];
      kit.box('granite', kx0, 0, kz0, kx1, KERB_H + 0.008, kz1, kc);
    };
    if (!n) strip(x0, z0, x1, z0 + (bridge ? 0.35 : SW), 'n');
    if (!s) strip(x0, z1 - (bridge ? 0.35 : SW), x1, z1, 's');
    if (!w) strip(x0, z0, x0 + (bridge ? 0.35 : SW), z1, 'w');
    if (!e) strip(x1 - (bridge ? 0.35 : SW), z0, x1, z1, 'e');
    if (!bridge) {
      // inner corners of junctions and bends: the pavement turns the corner on a quarter-round kerb
      // (V2 (Milestone 8): was a square, whose sharp corner the turning cars ran over)
      const corner = (cx: number, cz: number, a0: number): void => {
        const N = 7, k = 0.26, top = KERB_H, o = v3(cx, top, cz);
        for (let i = 0; i < N; i++) {
          const t0 = a0 + (i / N) * Math.PI * 0.5, t1 = a0 + ((i + 1) / N) * Math.PI * 0.5;
          const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
          const pIn0 = v3(cx + c0 * (SW - k), top, cz + s0 * (SW - k)), pIn1 = v3(cx + c1 * (SW - k), top, cz + s1 * (SW - k));
          kit.tri('paving', o, pIn0, pIn1, UP);
          const g = top + 0.008;
          kit.quad('granite', v3(cx + c0 * (SW - k), g, cz + s0 * (SW - k)), v3(cx + c0 * SW, g, cz + s0 * SW), v3(cx + c1 * SW, g, cz + s1 * SW), v3(cx + c1 * (SW - k), g, cz + s1 * (SW - k)), UP, kc);
          const tm = (t0 + t1) / 2;
          kit.quad('granite', v3(cx + c0 * SW, 0, cz + s0 * SW), v3(cx + c1 * SW, 0, cz + s1 * SW), v3(cx + c1 * SW, g, cz + s1 * SW), v3(cx + c0 * SW, g, cz + s0 * SW), v3(Math.cos(tm), 0, Math.sin(tm)), kc);
        }
      };
      if (n && w && !R(tx - 1, ty - 1)) corner(x0, z0, 0);
      if (n && e && !R(tx + 1, ty - 1)) corner(x1, z0, Math.PI * 0.5);
      if (s && e && !R(tx + 1, ty + 1)) corner(x1, z1, Math.PI);
      if (s && w && !R(tx - 1, ty + 1)) corner(x0, z1, Math.PI * 1.5);
    }
    // the avenue's dashed centre line, between its two lanes
    const my = y + 0.012;
    const dash = (ax0: number, az0: number, ax1: number, az1: number): void => kit.quad('roadPaint', v3(ax0, my, az1), v3(ax1, my, az1), v3(ax1, my, az0), v3(ax0, my, az0), UP);
    if (s && !n && !R(tx, ty + 2) && (w || e) && !R(tx - 1, ty + 1) === !w && !R(tx + 1, ty + 1) === !e) {
      for (const dx of [1.0, 5.0]) dash(x0 + dx, z1 - 0.07, x0 + dx + 2.4, z1 + 0.07);
    }
    if (e && !w && !R(tx + 2, ty) && (n || s) && !R(tx + 1, ty - 1) === !n && !R(tx + 1, ty + 1) === !s) {
      for (const dz of [1.0, 5.0]) dash(x1 - 0.07, z0 + dz, x1 + 0.07, z0 + dz + 2.4);
    }
  }

  private railTile(kit: Kit, tx: number, ty: number, overWater: boolean, crossing: boolean): void {
    const cx = tx * TM + 4, cz = ty * TM + 4;
    const m = World.railMask(tx, ty);
    const dirs: [number, number][] = [];
    if (m & 1) dirs.push([0, -1]);
    if (m & 2) dirs.push([1, 0]);
    if (m & 4) dirs.push([0, 1]);
    if (m & 8) dirs.push([-1, 0]);
    if (!dirs.length) dirs.push([1, 0], [-1, 0]);
    const base = crossing ? 0.06 : overWater ? 0.35 : 0.0;
    const ballast = new THREE.Color(0.75, 0.7, 0.66), sleeper = new THREE.Color(0.38, 0.3, 0.24), steel = new THREE.Color(0.55, 0.55, 0.56);
    kit.base = new THREE.Matrix4();
    // V2 (Milestone 8): a bend is a curve (through half of each neighbour where the track runs straight on, as the
    // trains take it: sim/traffic.ts railBend); its neighbours leave those halves to it
    const bend = railBend(tx, ty);
    if (bend) { this.railCurve(kit, tx, ty, bend.a, bend.b, bend.wide ? 1 : 0.5, base, overWater, crossing, ballast, sleeper, steel); return; }
    for (const [dx, dz] of dirs) {
      if (railBend(tx + dx, ty + dz)?.wide) continue;
      const ax = cx, az = cz, bx = cx + dx * 4, bz = cz + dz * 4;
      const lo = Math.min, hi = Math.max;
      const horiz = dx !== 0;
      const ext = 3.7;
      if (!crossing) {
        if (overWater) {
          kit.box('timber', lo(ax, bx) - (horiz ? 0 : ext), base - 0.3, lo(az, bz) - (horiz ? ext : 0), hi(ax, bx) + (horiz ? 0 : ext), base, hi(az, bz) + (horiz ? ext : 0), new THREE.Color(0.6, 0.48, 0.36));
          kit.box('timber', bx - 0.25 - dx * 2, -2.0, bz - 0.25 - dz * 2, bx + 0.25 - dx * 2, base - 0.3, bz + 0.25 - dz * 2, new THREE.Color(0.5, 0.4, 0.3));
        } else kit.box('gravel', lo(ax, bx) - (horiz ? 0 : ext), 0, lo(az, bz) - (horiz ? ext : 0), hi(ax, bx) + (horiz ? 0 : ext), 0.22, hi(az, bz) + (horiz ? ext : 0), ballast);
        for (let t = 0.3; t < 4; t += 0.65) {
          const px = ax + dx * t, pz = az + dz * t;
          if (horiz) kit.box('timber', px - 0.13, base + 0.22, cz - 3.5, px + 0.13, base + 0.32, cz + 3.5, sleeper);
          else kit.box('timber', cx - 3.5, base + 0.22, pz - 0.13, cx + 3.5, base + 0.32, pz + 0.13, sleeper);
        }
      }
      const ry0 = crossing ? base : base + 0.32;
      for (const lane of [-2.5, 0, 2.5])
        for (const g of [-0.72, 0.72]) {
          const o = lane + g;
          if (horiz) kit.box('metal', lo(ax, bx), ry0, cz + o - 0.04, hi(ax, bx), ry0 + 0.14, cz + o + 0.04, steel);
          else kit.box('metal', cx + o - 0.04, ry0, lo(az, bz), cx + o + 0.04, ry0 + 0.14, hi(az, bz), steel);
        }
    }
  }

  /* V2 (Milestone 8): a curved stretch of the three-track mainline about a bend at (tx, ty), radius R tiles for the
     middle track: from arm a's side round to arm b's, ballast, sleepers laid radially, and every rail an arc, the
     inner, middle and outer tracks running on unbroken */
  private railCurve(kit: Kit, tx: number, ty: number, a: [number, number], b: [number, number], R: number, base: number, overWater: boolean, crossing: boolean, ballast: THREE.Color, sleeper: THREE.Color, steel: THREE.Color): void {
    const cx = tx * TM + 4, cz = ty * TM + 4, Rm = R * TM;
    // travelling in from arm a and out by arm b
    const d1x = -a[0], d1z = -a[1], d2x = b[0], d2z = b[1];
    const qx = cx - d1x * Rm + d2x * Rm, qz = cz - d1z * Rm + d2z * Rm;
    const ex = cx - d1x * Rm, ez = cz - d1z * Rm, xx = cx + d2x * Rm, xz = cz + d2z * Rm;
    const a0 = Math.atan2(ez - qz, ex - qx);
    let da = Math.atan2(xz - qz, xx - qx) - a0;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    // the right-hand side of the way through is towards or away from the curve's centre
    const n1x = -d1z, n1z = d1x, out = (ex + n1x - qx) ** 2 + (ez + n1z - qz) ** 2 > (ex - qx) ** 2 + (ez - qz) ** 2 ? 1 : -1;
    const rAt = (o: number): number => Rm + o * out; // radius of a line `o` m right of the middle track
    const P = (r: number, ang: number, y: number): THREE.Vector3 => v3(qx + Math.cos(ang) * r, y, qz + Math.sin(ang) * r);
    const N = R >= 1 ? 14 : 8;
    const ext = 3.7;
    if (!crossing) {
      const top = overWater ? base : 0.22, key = overWater ? 'timber' : 'gravel', col = overWater ? new THREE.Color(0.6, 0.48, 0.36) : ballast;
      for (let i = 0; i < N; i++) {
        const t0 = a0 + (da * i) / N, t1 = a0 + (da * (i + 1)) / N;
        const ri = Math.max(0.05, Rm - ext), ro = Rm + ext;
        kit.quad(key, P(ri, t0, top), P(ro, t0, top), P(ro, t1, top), P(ri, t1, top), UP, col);
        // the ballast's shoulders
        if (!overWater) {
          const tm = (t0 + t1) / 2;
          kit.quad(key, P(ro, t0, 0), P(ro, t1, 0), P(ro, t1, top), P(ro, t0, top), v3(Math.cos(tm), 0, Math.sin(tm)), col);
          kit.quad(key, P(ri, t1, 0), P(ri, t0, 0), P(ri, t0, top), P(ri, t1, top), v3(-Math.cos(tm), 0, -Math.sin(tm)), col);
        }
      }
      // sleepers, radial, about every 0.65 m along the middle track
      const len = Math.abs(da) * Rm, ns = Math.max(2, Math.round(len / 0.65));
      for (let i = 0; i < ns; i++) {
        const t = a0 + (da * (i + 0.5)) / ns;
        const g = new THREE.BoxGeometry(7, 0.1, 0.26);
        g.rotateY(-t);
        g.translate(qx + Math.cos(t) * Rm, base + 0.27, qz + Math.sin(t) * Rm);
        kit.add('timber', g, sleeper);
      }
    }
    const ry = (crossing ? base : base + 0.32) + 0.07;
    for (const lane of [-2.5, 0, 2.5])
      for (const g of [-0.72, 0.72]) {
        const r = rAt(lane + g);
        for (let i = 0; i < N; i++) kit.rod('metal', P(r, a0 + (da * i) / N, ry), P(r, a0 + (da * (i + 1)) / N, ry), 0.05, steel, 4);
      }
  }

  private updateMountains(): void {
    const sig = (World.mountains as Mtn[]).map((m) => m.x + ',' + m.y).join(';') + '|' + (World.peaks as Peak[]).map((p) => `${p.x},${p.y},${p.seed}`).join(';') + '|' + this.season;
    if (sig === this.mtnSig) return;
    this.mtnSig = sig;
    for (const m of this.mtnMeshes) { this.group.remove(m); m.geometry.dispose(); }
    this.mtnMeshes = [];
    const kit = new Kit(this.pal);
    const N = 34;
    for (const m of World.mountains as Mtn[]) {
      const p = mtnParams(m);
      const x0 = m.x * TM - 2, z0 = m.y * TM - 2, size = MSIZE * TM + 4, step = size / N;
      const H = (i: number, j: number): number => mtnHeight(m, x0 + i * step, z0 + j * step);
      for (let j = 0; j < N; j++)
        for (let i = 0; i < N; i++) {
          const a = v3(x0 + i * step, H(i, j), z0 + j * step);
          const b = v3(x0 + (i + 1) * step, H(i + 1, j), z0 + j * step);
          const c = v3(x0 + (i + 1) * step, H(i + 1, j + 1), z0 + (j + 1) * step);
          const d = v3(x0 + i * step, H(i, j + 1), z0 + (j + 1) * step);
          if (a.y + b.y + c.y + d.y < 0.05) continue;
          const hm = (a.y + b.y + c.y + d.y) / 4;
          const slope = Math.max(Math.abs(a.y - c.y), Math.abs(b.y - d.y)) / step;
          const f = hm / p.H;
          // grassy foothills, bare rock on the steeps, a permanent cap of snow and ice up top
          const key = f > 0.18 || slope > 0.9 ? 'rock' : 'grass';
          const col = f > 0.74 ? new THREE.Color(1.9, 1.95, 2.05) : key === 'grass' ? GRASS_TINT[this.season] : WHITE;
          const n1 = new THREE.Vector3().subVectors(d, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
          kit.tri(key, a, d, c, n1, col);
          const n2 = new THREE.Vector3().subVectors(c, a).cross(new THREE.Vector3().subVectors(b, a)).normalize();
          kit.tri(key, a, c, b, n2, col);
        }
    }
    for (const pk of World.peaks as Peak[]) this.buildPeak(kit, pk);
    this.mtnMeshes = kit.build(this.group, true);
  }

  /* V2 (Milestone 8): the big peak: a 4 m grid of its slopes (meadow at the foot, rock where it's steep or high, a
     cap of snow), the trail as a ribbon of beaten earth up its switchbacks, a cairn and a bench on the summit, and
     the trailhead: a sign and a rack of hire bikes */
  private buildPeak(kit: Kit, pk: Peak): void {
    kit.base = new THREE.Matrix4();
    const R = (PEAK_R + 1) * TM, cx = (pk.x + 0.5) * TM, cz = (pk.y + 0.5) * TM, H = pk.h || 125, step = 4;
    const n = Math.ceil((R * 2) / step), x0 = cx - R, z0 = cz - R;
    const hgt: number[] = [];
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) hgt.push(peakHeight(pk, x0 + i * step, z0 + j * step));
    const at = (i: number, j: number): THREE.Vector3 => v3(x0 + i * step, hgt[j * (n + 1) + i], z0 + j * step);
    const grass = GRASS_TINT[this.season], snowC = new THREE.Color(1.9, 1.95, 2.05);
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
        for (const [p, q, r] of [[a, d, c], [a, c, b]]) {
          const nr = e1.subVectors(q, p).cross(e2.subVectors(r, p)).normalize().clone();
          if (nr.y < 0) nr.negate();
          const f = (p.y + q.y + r.y) / 3 / H, steep = nr.y < 0.72;
          const snow = f > 0.8 || (this.season === 3 && f > 0.35);
          const key = snow ? 'rock' : f > 0.42 || (steep && f > 0.06) ? 'rock' : 'grass';
          kit.tri(key, p, q, r, nr, snow ? snowC : key === 'grass' ? grass : WHITE);
        }
      }
    // the trail: a strip of beaten earth a little under 2 m wide, over the slope
    const trail = peakTrail(pk), dirt = new THREE.Color(0.78, 0.66, 0.52);
    for (let k = 0; k < trail.length - 1; k++) {
      const [ax, az] = trail[k], [bx, bz] = trail[k + 1];
      const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1, sx = (-dz / l) * 0.9, sz = (dx / l) * 0.9;
      const y = (x: number, z: number): number => heightAt(x, z) + 0.07;
      kit.quad('soil', v3(ax - sx, y(ax - sx, az - sz), az - sz), v3(ax + sx, y(ax + sx, az + sz), az + sz), v3(bx + sx, y(bx + sx, bz + sz), bz + sz), v3(bx - sx, y(bx - sx, bz - sz), bz - sz), UP, dirt);
    }
    // the summit: a cairn of stones, a flag, a bench to take in the view
    const sy = peakHeight(pk, cx, cz);
    const stone = new THREE.Color(0.7, 0.68, 0.64);
    for (let k = 0; k < 7; k++) {
      const r = 1.1 - k * 0.14;
      kit.box('stone', cx - r, sy - 0.2 + k * 0.32, cz - r, cx + r, sy + 0.12 + k * 0.32, cz + r, stone);
    }
    kit.cyl('metal', 0.04, 3.2, 6, new THREE.Matrix4().makeTranslation(cx, sy + 3.5, cz), new THREE.Color(0.6, 0.6, 0.62));
    kit.box('paint', cx + 0.04, sy + 4.3, cz - 0.02, cx + 1.1, sy + 4.95, cz + 0.02, new THREE.Color(0.85, 0.15, 0.12));
    const bench = trail[Math.max(0, trail.length - 6)];
    P.bench(kit, bench[0], bench[1], Math.atan2(cx - bench[0], cz - bench[1]) + Math.PI);
    kit.base = new THREE.Matrix4();
    // the trailhead: a signboard on two posts, and a rack of mountain bikes for hire
    const th = trailhead(pk), fx = Math.sin(th.yaw), fz = Math.cos(th.yaw), rx = Math.cos(th.yaw), rz = -Math.sin(th.yaw);
    const wood = new THREE.Color(0.55, 0.4, 0.28);
    for (const s of [-0.9, 0.9]) kit.box('timber', th.x + rx * s - 0.06, 0, th.z + rz * s - 0.06, th.x + rx * s + 0.06, 2.2, th.z + rz * s + 0.06, wood);
    const board = new THREE.BoxGeometry(2.2, 1.0, 0.08);
    board.rotateY(th.yaw);
    board.translate(th.x, 1.7, th.z);
    kit.add('timber', board, new THREE.Color(0.42, 0.3, 0.2));
    const rackX = th.x + rx * 3.2 - fx * 1.2, rackZ = th.z + rz * 3.2 - fz * 1.2;
    const rail = new THREE.BoxGeometry(3.6, 0.06, 0.06);
    rail.rotateY(th.yaw);
    rail.translate(rackX, 0.72, rackZ);
    kit.add('metal', rail, new THREE.Color(0.5, 0.52, 0.55));
  }

  private updateTrees(): void {
    let h = 0;
    for (let i = 0; i < World.tree.length; i += 1) if (World.tree[i]) h = (Math.imul(h, 31) + i * World.tree[i]) | 0;
    const sig = h + '|' + this.season;
    if (sig === this.treeSig) return;
    this.treeSig = sig;
    const list: TreeInstance[] = [];
    const spring = this.season === 0;
    for (let ty = 0; ty < GH; ty++)
      for (let tx = 0; tx < GW; tx++) {
        const v = World.tree[World.idx(tx, ty)];
        if (!v) continue;
        const s = Math.max(1, Math.min(6, v));
        const sp = treeSpot(tx, ty);
        const hv = hash2(tx, ty);
        // V2 (Milestone 8): V1's "pine" stands are a mix of spruce, tall Scots pine and Christmas-tree fir, and here and
        // there a tree of any kind grows taller than the rest
        const cone = (hv >> 5) % 20;
        const species: Species = s === 2 ? (cone < 8 ? 'spruce' : cone < 14 ? 'pine' : 'fir') : SPECIES_OF[s];
        const tall = (hv >> 11) % 9 === 0 ? 1.32 : 1;
        const tint = s === 6 && spring ? new THREE.Color(1.5, 1.25, 1.2) : spring && species !== 'fir' && species !== 'pine' && species !== 'spruce' ? new THREE.Color(1.1, 1.15, 0.85) : undefined;
        list.push({ x: sp.x, z: sp.z, y: heightAt(sp.x, sp.z), species, scale: sp.s * (s === 6 ? 0.7 : 0.85) * tall, sx: s === 3 ? 0.55 : undefined, rot: (hv % 628) / 100, tint });
      }
    this.baseTrees = list;
    this.trees.setTrees(this.baseTrees.concat(this.extraTrees));
  }
  private baseTrees: TreeInstance[] = [];
  private extraTrees: TreeInstance[] = [];
  /** trees planted by buildings (parks, gardens) join the forest */
  setExtraTrees(list: TreeInstance[]): void {
    this.extraTrees = list;
    this.trees.setTrees(this.baseTrees.concat(list));
  }

  /** V1's lamp rule: regular posts along the outer kerbs, alternating sides */
  private updateLamps(): void {
    const sig = World.roadStamp + ':' + World.railStamp + ':' + ((World.signalHeads || []).length);
    if (sig === this.lampSig) return;
    this.lampSig = sig;
    for (const m of this.lampMeshes) { this.group.remove(m); m.geometry.dispose(); }
    const kit = new Kit(this.pal);
    this.lampSpots = [];
    POSTS.clear();
    // the traffic signals' poles (where the actors draw them)
    for (const [hx, hy, aspect] of (World.signalHeads || []) as [number, number, number][])
      addPost(aspect === 0 ? hx * TM + TM - 0.9 : hx * TM + 0.9, aspect === 0 ? hy * TM + TM - 0.9 : hy * TM + 0.9, 0.16);
    const popcount = (m: number): number => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
    for (let y = 0; y < GH; y++)
      for (let x = 0; x < GW; x++) {
        const i = World.idx(x, y);
        if (!World.roadMap[i] || World.ground[i] === G_WATER || World.railMap[i]) continue;
        const m = World.roadMask(x, y);
        if (popcount(m) === 4) continue;
        const horiz = (m & 10) !== 0, vert = (m & 5) !== 0;
        let px: number, pz: number;
        // (V2 (Milestone 8): at the kerb side of the narrower pavement, clear of the people walking along it)
        if (horiz && !World.isRoad(x, y - 1) && x % 6 === 0) { px = x * TM + 4; pz = y * TM + LAMP_IN; }
        else if (horiz && !World.isRoad(x, y + 1) && x % 6 === 3) { px = x * TM + 4; pz = y * TM + TM - LAMP_IN; }
        else if (vert && !World.isRoad(x - 1, y) && y % 6 === 0) { px = x * TM + LAMP_IN; pz = y * TM + 4; }
        else if (vert && !World.isRoad(x + 1, y) && y % 6 === 3) { px = x * TM + TM - LAMP_IN; pz = y * TM + 4; }
        else continue;
        const lantern = P.lampPost(kit, px, pz);
        this.lampSpots.push({ x: lantern.x, z: lantern.z });
        addPost(px, pz, 0.17);
      }
    // the posts stand on the pavement
    kit.base = new THREE.Matrix4();
    this.lampMeshes = kit.build(this.group, true);
    for (const m of this.lampMeshes) m.position.y = KERB_H;
    this.buildPools();
  }

  /* V2 (Milestone 8): the pool of light each street lamp throws on the road and pavement. Only a few lamps
     can be real lights (four on medium), so from the Planner the streets used to lie dark at night; now every
     lamp lights its patch of ground, softly, in one cheap additive mesh (the shader of the headlight pools) */
  private pools: THREE.Mesh | null = null;
  poolMat = new THREE.MeshBasicMaterial({ map: poolTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0x000000 });
  private buildPools(): void {
    if (this.pools) { this.group.remove(this.pools); this.pools.geometry.dispose(); this.pools = null; }
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    const R = 6.5, Y = KERB_H + 0.03;
    for (const l of this.lampSpots) {
      const b = pos.length / 3;
      pos.push(l.x - R, Y, l.z - R, l.x + R, Y, l.z - R, l.x + R, Y, l.z + R, l.x - R, Y, l.z + R);
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    this.pools = new THREE.Mesh(g, this.poolMat);
    this.pools.renderOrder = 2;
    this.pools.layers.set(LAYER_NO_REFLECT);
    this.group.add(this.pools);
  }
  /** how bright the lamps' pools are (scene radiance; the stage sets it at dusk) */
  setPools(k: number): void {
    // (always drawn, black by day: its shader is compiled with everything else before the first frame)
    this.poolMat.color.setRGB(1, 0.74, 0.44).multiplyScalar(k);
  }

  /** grass grows on open grassland: not on roads, rails, water, plots or mountains */
  private grassAt(x: number, z: number): [number, number, number] {
    const tx = Math.floor(x / TM), tz = Math.floor(z / TM);
    if (!World.inB(tx, tz)) return [0, 0, 0];
    const i = World.idx(tx, tz);
    if (World.ground[i] !== 0 || World.roadMap[i] || World.railMap[i] || World.bmap[i]) return [0, 0, 0];
    if (World.tree[i] && Math.hypot(x - (tx * TM + 4), z - (tz * TM + 4)) < 0.6) return [0, 0, 0];
    // (none down the bank: V2 (Milestone 8))
    if (inShore(tx, tz) && waterField(x, z) > 0.52) return [0, 0, 0];
    // shorter by the roads and plots, longer in open meadow
    const fx = x - tx * TM, fz = z - tz * TM;
    const edge = Math.min(fx, TM - fx, fz, TM - fz);
    const nearBuilt = World.isRoad(tx - 1, tz) || World.isRoad(tx + 1, tz) || World.isRoad(tx, tz - 1) || World.isRoad(tx, tz + 1);
    const tall = 0.35 + fbm(x / 400, z / 400, 4, 2, 7) * 0.45;
    return [edge < 0.3 && nearBuilt ? 0 : 0.9, nearBuilt ? 0.22 : tall, 0];
  }

  /** per-frame: water level (drought), flood sheet, trees and grass around the camera */
  frame(_night: number, cam?: THREE.Vector3): void {
    const level = WATER_Y - 1.15 * Math.min(1, Calamity.droughtLevel);
    this.water.setLevel(level);
    if (cam) {
      this.trees.frame(cam);
      this.grass.update(cam);
    }
    const n = Calamity.flooded ? Calamity.flooded.size : 0;
    if (n !== this.floodN) {
      this.floodN = n;
      if (this.floodMesh) {
        this.group.remove(this.floodMesh);
        this.floodMesh.geometry.dispose();
        this.floodMesh = null;
      }
      if (n) {
        const pos: number[] = [];
        for (const i of Calamity.flooded as Set<number>) {
          const x0 = (i % GW) * TM, z0 = Math.floor(i / GW) * TM;
          pos.push(x0, 0.55, z0 + TM, x0 + TM, 0.55, z0 + TM, x0 + TM, 0.55, z0, x0, 0.55, z0 + TM, x0 + TM, 0.55, z0, x0, 0.55, z0);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
        this.floodMesh = new THREE.Mesh(g, MAT.water);
        this.group.add(this.floodMesh);
      }
    }
  }

  /** frozen in deep winter */
  get ice(): number {
    return Weather.season === 3 ? Math.min(1, ENV.snow.value * 1.1) : 0;
  }
}

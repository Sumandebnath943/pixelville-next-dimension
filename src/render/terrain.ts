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
import { QualityProfile, PROFILES } from '../gfx/pipeline';

const TM = 8; // metres per tile
const CH = 32; // tiles per chunk side
const NCX = GW / CH, NCY = GH / CH;
const BED = -1.6; // river/lake bed depth
const WATER_Y = -0.35;
const KERB_H = 0.15;
const MAP_W = GW * TM, MAP_H = GH * TM;
const UP = new THREE.Vector3(0, 1, 0);
const v3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

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

/** ground height (m) at a world point: 0 on land, mountains rise, bridges sit on decks */
export function heightAt(x: number, z: number): number {
  let h = 0;
  for (const m of World.mountains as Mtn[]) {
    const p0x = m.x * TM, p0z = m.y * TM;
    if (x < p0x || z < p0z || x > p0x + MSIZE * TM || z > p0z + MSIZE * TM) continue;
    h = Math.max(h, mtnHeight(m, x, z));
  }
  if (h > 0) return h;
  const tx = Math.floor(x / TM), tz = Math.floor(z / TM);
  if (World.inB(tx, tz)) {
    const i = World.idx(tx, tz);
    if (World.ground[i] === G_WATER) return World.roadMap[i] ? 0.25 : BED;
  }
  return 0;
}
/** true where the Founder can't walk or drive: open water without a bridge */
export function isWaterAt(x: number, z: number): boolean {
  const tx = Math.floor(x / TM), tz = Math.floor(z / TM);
  if (!World.inB(tx, tz)) return true;
  const i = World.idx(tx, tz);
  return World.ground[i] === G_WATER && !World.roadMap[i] && !World.railMap[i];
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
    this.water = new WaterSystem(WATER_Y, this.profile.waterReflScale);
    this.trees = new TreeLayer(scene, this.profile.grassRange > 40 ? 170 : 95);
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

    // the open sea to the south, foaming on the coast
    const sea = new THREE.PlaneGeometry(MAP_W + E * 2, E, 160, 90);
    sea.rotateX(-Math.PI / 2);
    sea.translate(MAP_W / 2, WATER_Y, MAP_H + E / 2);
    const sp = sea.attributes.position;
    const shore = new Float32Array(sp.count);
    for (let i = 0; i < sp.count; i++) shore[i] = Math.max(0, sp.getZ(i) - MAP_H) + 0.5;
    sea.setAttribute('aShore', new THREE.BufferAttribute(shore, 1));
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
        const v = World.ground[i] | (World.roadMap[i] << 2) | (World.railMap[i] << 3);
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
    const isWater = (x: number, y: number): boolean => World.inB(x, y) && World.ground[World.idx(x, y)] === G_WATER;
    const keyOf = (tx: number, ty: number): string => {
      const i = World.idx(tx, ty), gr = World.ground[i];
      if (gr === G_WATER) return 'water';
      if (World.roadMap[i]) return 'road';
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
        } else if (k === 'water') {
          kit.quad('soil', v3(x0, BED, z1), v3(x1, BED, z1), v3(x1, BED, z0), v3(x0, BED, z0), UP, this.wasDry && season !== 3 ? new THREE.Color(0.95, 0.85, 0.65) : soilC);
        }
        tx = end;
      }
      for (let tx2 = cx * CH; tx2 < cx * CH + CH; tx2++) {
        const i = World.idx(tx2, ty);
        const x0 = tx2 * TM, z0 = ty * TM, x1 = x0 + TM, z1 = z0 + TM;
        if (World.ground[i] === G_WATER) {
          // earth banks where water meets land
          if (!isWater(tx2, ty - 1)) kit.quad('soil', v3(x0, BED, z0), v3(x1, BED, z0), v3(x1, 0, z0), v3(x0, 0, z0), v3(0, 0, 1), soilC);
          if (!isWater(tx2, ty + 1)) kit.quad('soil', v3(x1, BED, z1), v3(x0, BED, z1), v3(x0, 0, z1), v3(x1, 0, z1), v3(0, 0, -1), soilC);
          if (!isWater(tx2 - 1, ty)) kit.quad('soil', v3(x0, BED, z1), v3(x0, BED, z0), v3(x0, 0, z0), v3(x0, 0, z1), v3(1, 0, 0), soilC);
          if (!isWater(tx2 + 1, ty)) kit.quad('soil', v3(x1, BED, z0), v3(x1, BED, z1), v3(x1, 0, z1), v3(x1, 0, z0), v3(-1, 0, 0), soilC);
        }
        if (World.roadMap[i]) this.roadTile(kit, tx2, ty, World.ground[i] === G_WATER);
        if (World.railMap[i]) this.railTile(kit, tx2, ty, World.ground[i] === G_WATER, World.isRoad(tx2, ty));
      }
    }
    kit.base = new THREE.Matrix4();
    ch.meshes = kit.build(this.group, true);
    for (const m of ch.meshes) m.castShadow = m.name !== 'grass' && m.name !== 'sand' && m.name !== 'soil';
    this.buildWater(cx, cy, ch);
  }

  /** the water surface of one chunk, 4 m quads, with distance-to-shore per vertex */
  private buildWater(cx: number, cy: number, ch: Chunk): void {
    const pos: number[] = [], shore: number[] = [], idx: number[] = [];
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
        if (World.ground[i] !== G_WATER) continue;
        const base = pos.length / 3;
        for (let j = 0; j <= S; j++)
          for (let k = 0; k <= S; k++) {
            const x = tx * TM + (k / S) * TM, z = ty * TM + (j / S) * TM;
            pos.push(x, WATER_Y, z);
            shore.push(shoreAt(x, z));
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
    const SW = 1.8;
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
      // inner corners of junctions get a pavement square too
      const sq = (ax0: number, az0: number): void => kit.box('paving', ax0, 0, az0, ax0 + SW, KERB_H, az0 + SW);
      if (n && w && !R(tx - 1, ty - 1)) sq(x0, z0);
      if (n && e && !R(tx + 1, ty - 1)) sq(x1 - SW, z0);
      if (s && w && !R(tx - 1, ty + 1)) sq(x0, z1 - SW);
      if (s && e && !R(tx + 1, ty + 1)) sq(x1 - SW, z1 - SW);
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
    for (const [dx, dz] of dirs) {
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

  private updateMountains(): void {
    const sig = (World.mountains as Mtn[]).map((m) => m.x + ',' + m.y).join(';');
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
    this.mtnMeshes = kit.build(this.group, true);
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
        const species = SPECIES_OF[s];
        const tint = s === 6 && spring ? new THREE.Color(1.5, 1.25, 1.2) : spring ? new THREE.Color(1.1, 1.15, 0.85) : undefined;
        list.push({ x: sp.x, z: sp.z, y: heightAt(sp.x, sp.z), species, scale: sp.s * (s === 6 ? 0.7 : 0.85), sx: s === 3 ? 0.55 : undefined, rot: (hv % 628) / 100, tint });
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
    const sig = World.roadStamp + ':' + World.railStamp;
    if (sig === this.lampSig) return;
    this.lampSig = sig;
    for (const m of this.lampMeshes) { this.group.remove(m); m.geometry.dispose(); }
    const kit = new Kit(this.pal);
    this.lampSpots = [];
    const popcount = (m: number): number => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
    for (let y = 0; y < GH; y++)
      for (let x = 0; x < GW; x++) {
        const i = World.idx(x, y);
        if (!World.roadMap[i] || World.ground[i] === G_WATER || World.railMap[i]) continue;
        const m = World.roadMask(x, y);
        if (popcount(m) === 4) continue;
        const horiz = (m & 10) !== 0, vert = (m & 5) !== 0;
        let px: number, pz: number;
        if (horiz && !World.isRoad(x, y - 1) && x % 6 === 0) { px = x * TM + 4; pz = y * TM + 1.35; }
        else if (horiz && !World.isRoad(x, y + 1) && x % 6 === 3) { px = x * TM + 4; pz = y * TM + TM - 1.35; }
        else if (vert && !World.isRoad(x - 1, y) && y % 6 === 0) { px = x * TM + 1.35; pz = y * TM + 4; }
        else if (vert && !World.isRoad(x + 1, y) && y % 6 === 3) { px = x * TM + TM - 1.35; pz = y * TM + 4; }
        else continue;
        const lantern = P.lampPost(kit, px, pz);
        this.lampSpots.push({ x: lantern.x, z: lantern.z });
      }
    // the posts stand on the pavement
    kit.base = new THREE.Matrix4();
    this.lampMeshes = kit.build(this.group, true);
    for (const m of this.lampMeshes) m.position.y = KERB_H;
  }

  /** grass grows on open grassland: not on roads, rails, water, plots or mountains */
  private grassAt(x: number, z: number): [number, number, number] {
    const tx = Math.floor(x / TM), tz = Math.floor(z / TM);
    if (!World.inB(tx, tz)) return [0, 0, 0];
    const i = World.idx(tx, tz);
    if (World.ground[i] !== 0 || World.roadMap[i] || World.railMap[i] || World.bmap[i]) return [0, 0, 0];
    if (World.tree[i] && Math.hypot(x - (tx * TM + 4), z - (tz * TM + 4)) < 0.6) return [0, 0, 0];
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

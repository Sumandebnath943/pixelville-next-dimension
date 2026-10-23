/* ============================================================
   Terrain: the ground, water, mountains, trees, roads, rails and
   street lamps, built from the sim's tile maps. The map is cut
   into 32×32-tile chunks; a chunk is rebuilt only when a hash of
   its tiles (plus a one-tile border) changes.
   ============================================================ */
import * as THREE from 'three';
import { GW, GH, G_WATER, G_SAND, G_ROCK, MSIZE, World } from '../sim/world';
import { Weather } from '../sim/weather';
import { Calamity } from '../sim/calamity';
import { MeshBuilder, MAT, hex, hash2, InstancedPool, shade } from './kit';

const TM = 8; // metres per tile
const CH = 32; // tiles per chunk side
const NCX = GW / CH, NCY = GH / CH;
const BED = -1.6; // river/lake bed depth
const WATER_Y = -0.35;

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

/* ---------- colours ---------- */
const GRASS = ['#7bbb58', '#6aa84a', '#a7a24e', '#dfe7ee'];
const SAND = hex('#e4d199');
const SAND_W = hex('#e9ecf0');
const BEDC = hex('#a8946a');
const BANK = hex('#9c8458');
const ROCKG = hex('#8e9a70');
const ASPHALT = hex('#3b3e45');
const ASPHALT_B = hex('#46494f');
const WALK = hex('#b8b5ac');
const KERB = hex('#d2cfc6');
const MARK = hex('#eee9d6');
const RAILC = hex('#a7adb5');
const SLEEPER = hex('#6b4a32');
const BALLAST = hex('#857b6c');
const TRESTLE = hex('#7a5a3a');

interface Chunk { sig: string; ground?: THREE.Mesh; water?: THREE.Mesh; roads?: THREE.Mesh }

export class Terrain {
  group = new THREE.Group();
  chunks: Chunk[] = [];
  waterMeshes: THREE.Mesh[] = [];
  private mtnMesh: THREE.Mesh | null = null;
  private mtnSig = '';
  private treeSig = '';
  private trunks: InstancedPool[] = [];
  private crowns: InstancedPool[] = [];
  private lampPoles: InstancedPool;
  private lampBulbs: InstancedPool;
  lampSpots: { x: number; z: number }[] = [];
  private lampSig = '';
  private floodMesh: THREE.Mesh | null = null;
  private floodN = -1;
  private season = -1;
  private wasDry = false;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    for (let i = 0; i < NCX * NCY; i++) this.chunks.push({ sig: '' });
    this.buildBackdrop();
    // six tree species (V1 tree values 1..6), each a trunk + a tinted crown
    for (let s = 1; s <= 6; s++) {
      const { trunk, crown } = treeTemplate(s);
      this.trunks.push(new InstancedPool(trunk, MAT.solid, 30000, this.group));
      this.crowns.push(new InstancedPool(crown, MAT.tint, 30000, this.group));
    }
    const pole = new MeshBuilder();
    pole.box(-0.09, 0, -0.09, 0.09, 6.2, 0.09, hex('#55595f'));
    pole.box(-0.06, 6.0, -0.06, 0.06, 6.12, 1.5, hex('#55595f'));
    this.lampPoles = new InstancedPool(pole.build(), MAT.solid, 6000, this.group);
    const bulb = new MeshBuilder();
    bulb.box(-0.22, 5.78, 1.15, 0.22, 5.98, 1.65, hex('#ffffff'));
    this.lampBulbs = new InstancedPool(bulb.build(), MAT.tintGlow, 6000, this.group, false);
  }

  /** endless land beyond the map edge, and the open sea to the south */
  private buildBackdrop(): void {
    const land = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.MeshStandardMaterial({ color: 0x6c9e4e, roughness: 1 }));
    land.rotation.x = -Math.PI / 2;
    land.position.set((GW * TM) / 2, -0.12, (GH * TM) / 2 - 2000);
    land.receiveShadow = true;
    this.group.add(land);
    this.backdropLand = land;
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(9000, 4000), MAT.water);
    sea.rotation.x = -Math.PI / 2;
    sea.position.set((GW * TM) / 2, WATER_Y - 0.02, GH * TM + 2000 - 1);
    this.group.add(sea);
    const seabed = new THREE.Mesh(new THREE.PlaneGeometry(9000, 4000), new THREE.MeshStandardMaterial({ color: 0x8a7a5a }));
    seabed.rotation.x = -Math.PI / 2;
    seabed.position.set((GW * TM) / 2, BED - 0.05, GH * TM + 2000 - 1);
    this.group.add(seabed);
    this.waterMeshes.push(sea);
  }
  backdropLand!: THREE.Mesh;

  /** call when World changed (mapVersion bump) or every few seconds */
  update(force = false): void {
    const season = Weather.season;
    const dry = Calamity.droughtLevel >= 0.5;
    if (season !== this.season || dry !== this.wasDry) {
      this.season = season;
      this.wasDry = dry;
      force = true;
      (this.backdropLand.material as THREE.MeshStandardMaterial).color.set(shade(GRASS[season], -0.12));
    }
    for (let cy = 0; cy < NCY; cy++)
      for (let cx = 0; cx < NCX; cx++) {
        const sig = this.chunkSig(cx, cy) + '|' + season + (dry ? 'd' : '');
        const ch = this.chunks[cy * NCX + cx];
        if (!force && sig === ch.sig) continue;
        if (sig === ch.sig) continue;
        ch.sig = sig;
        this.buildChunk(cx, cy, ch);
      }
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
    for (const k of ['ground', 'water', 'roads'] as const) {
      const m = ch[k];
      if (m) {
        this.group.remove(m);
        m.geometry.dispose();
        if (k === 'water') this.waterMeshes.splice(this.waterMeshes.indexOf(m), 1);
        ch[k] = undefined;
      }
    }
    const season = this.season;
    const grass = hex(GRASS[season]);
    const g = new MeshBuilder();
    const w = new MeshBuilder();
    const r = new MeshBuilder();
    const isRoad = (x: number, y: number) => World.isRoad(x, y);
    const isWater = (x: number, y: number) => World.inB(x, y) && World.ground[World.idx(x, y)] === G_WATER;
    for (let ty = cy * CH; ty < cy * CH + CH; ty++)
      for (let tx = cx * CH; tx < cx * CH + CH; tx++) {
        const i = World.idx(tx, ty), gr = World.ground[i];
        const x0 = tx * TM, z0 = ty * TM, x1 = x0 + TM, z1 = z0 + TM;
        const hv = hash2(tx, ty);
        if (gr === G_WATER) {
          const bed = this.wasDry && season !== 3 ? shade('#b59a6a', ((hv % 7) - 3) * 0.02) : BEDC;
          g.quad([x0, BED, z1], [x1, BED, z1], [x1, BED, z0], [x0, BED, z0], bed);
          // banks: vertical earth walls where water meets land
          if (!isWater(tx, ty - 1)) g.quad([x0, BED, z0], [x1, BED, z0], [x1, 0, z0], [x0, 0, z0], BANK);
          if (!isWater(tx, ty + 1)) g.quad([x1, BED, z1], [x0, BED, z1], [x0, 0, z1], [x1, 0, z1], BANK);
          if (!isWater(tx - 1, ty)) g.quad([x0, BED, z1], [x0, BED, z0], [x0, 0, z0], [x0, 0, z1], BANK);
          if (!isWater(tx + 1, ty)) g.quad([x1, BED, z0], [x1, BED, z1], [x1, 0, z1], [x1, 0, z0], BANK);
          w.quad([x0, WATER_Y, z1], [x1, WATER_Y, z1], [x1, WATER_Y, z0], [x0, WATER_Y, z0], hex('#ffffff'));
        } else {
          let c: THREE.Color;
          if (gr === G_SAND) c = season === 3 ? SAND_W : shade(SAND, ((hv % 9) - 4) * 0.012);
          else if (gr === G_ROCK) c = shade(ROCKG, ((hv % 9) - 4) * 0.02);
          else c = shade(grass, ((hv % 11) - 5) * 0.014);
          g.quad([x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [x0, 0, z0], c);
        }
        if (isRoad(tx, ty)) this.roadTile(r, tx, ty, gr === G_WATER);
        if (World.railMap[i]) this.railTile(r, tx, ty, gr === G_WATER, isRoad(tx, ty));
      }
    if (!g.empty) {
      ch.ground = new THREE.Mesh(g.build(), MAT.ground);
      ch.ground.receiveShadow = true;
      this.group.add(ch.ground);
    }
    if (!w.empty) {
      ch.water = new THREE.Mesh(w.build(), season === 3 ? MAT.ice : MAT.water);
      ch.water.receiveShadow = season === 3;
      this.group.add(ch.water);
      this.waterMeshes.push(ch.water);
    }
    if (!r.empty) {
      ch.roads = new THREE.Mesh(r.build(), MAT.road);
      ch.roads.receiveShadow = true;
      ch.roads.castShadow = true;
      this.group.add(ch.roads);
    }
  }

  private roadTile(r: MeshBuilder, tx: number, ty: number, bridge: boolean): void {
    const x0 = tx * TM, z0 = ty * TM, x1 = x0 + TM, z1 = z0 + TM;
    const y = bridge ? 0.25 : 0.03;
    const R = (x: number, yy: number) => World.isRoad(x, yy);
    const n = R(tx, ty - 1), s = R(tx, ty + 1), wv = R(tx - 1, ty), e = R(tx + 1, ty);
    const tone = (hash2(tx, ty) % 5) === 0 ? ASPHALT_B : ASPHALT;
    if (bridge) {
      r.box(x0, -0.2, z0, x1, y, z1, hex('#8d8b86'), tone);
      r.box(x0 + 3.4, -2.2, z0 + 3.4, x0 + 4.6, -0.2, z0 + 4.6, hex('#7d7a74'));
    } else r.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], tone);
    // pavements along every edge that faces open ground (or a railing on bridges)
    const SW = 1.8, KH = 0.17;
    const strip = (ax0: number, az0: number, ax1: number, az1: number) => {
      if (bridge) r.box(ax0, y, az0, ax1, y + 1.0, az1, hex('#9a978f'));
      else r.box(ax0, y, az0, ax1, y + KH, az1, WALK, KERB);
    };
    if (!n) strip(x0, z0, x1, z0 + (bridge ? 0.3 : SW));
    if (!s) strip(x0, z1 - (bridge ? 0.3 : SW), x1, z1);
    if (!wv) strip(x0, z0, x0 + (bridge ? 0.3 : SW), z1);
    if (!e) strip(x1 - (bridge ? 0.3 : SW), z0, x1, z1);
    if (!bridge) {
      // inner corners of junctions get a pavement square too
      if (n && wv && !R(tx - 1, ty - 1)) r.box(x0, y, z0, x0 + SW, y + KH, z0 + SW, WALK, KERB);
      if (n && e && !R(tx + 1, ty - 1)) r.box(x1 - SW, y, z0, x1, y + KH, z0 + SW, WALK, KERB);
      if (s && wv && !R(tx - 1, ty + 1)) r.box(x0, y, z1 - SW, x0 + SW, y + KH, z1, WALK, KERB);
      if (s && e && !R(tx + 1, ty + 1)) r.box(x1 - SW, y, z1 - SW, x1, y + KH, z1, WALK, KERB);
    }
    // the avenue's dashed centre line, between its two lanes
    const my = y + 0.012;
    if (s && !n && !R(tx, ty + 2) && (wv || e) && !R(tx - 1, ty + 1) === !wv && !R(tx + 1, ty + 1) === !e) {
      for (const dx of [1.0, 5.0]) r.quad([x0 + dx, my, z1 + 0.12], [x0 + dx + 2.2, my, z1 + 0.12], [x0 + dx + 2.2, my, z1 - 0.12], [x0 + dx, my, z1 - 0.12], MARK);
    }
    if (e && !wv && !R(tx + 2, ty) && (n || s) && !R(tx + 1, ty - 1) === !n && !R(tx + 1, ty + 1) === !s) {
      for (const dz of [1.0, 5.0]) r.quad([x1 - 0.12, my, z0 + dz + 2.2], [x1 + 0.12, my, z0 + dz + 2.2], [x1 + 0.12, my, z0 + dz], [x1 - 0.12, my, z0 + dz], MARK);
    }
  }

  private railTile(r: MeshBuilder, tx: number, ty: number, overWater: boolean, crossing: boolean): void {
    const cx = tx * TM + 4, cz = ty * TM + 4;
    const m = World.railMask(tx, ty);
    const dirs: [number, number][] = [];
    if (m & 1) dirs.push([0, -1]);
    if (m & 2) dirs.push([1, 0]);
    if (m & 4) dirs.push([0, 1]);
    if (m & 8) dirs.push([-1, 0]);
    if (!dirs.length) dirs.push([1, 0], [-1, 0]);
    const base = crossing ? 0.06 : overWater ? 0.35 : 0.0;
    for (const [dx, dz] of dirs) {
      // a half-segment from the tile centre to this edge; three tracks wide
      const ax = cx, az = cz, bx = cx + dx * 4, bz = cz + dz * 4;
      const lo = (a: number, b: number) => Math.min(a, b), hi = (a: number, b: number) => Math.max(a, b);
      const horiz = dx !== 0;
      const ext = 3.7;
      if (!crossing) {
        if (overWater) {
          r.box(lo(ax, bx) - (horiz ? 0 : ext), base - 0.3, lo(az, bz) - (horiz ? ext : 0), hi(ax, bx) + (horiz ? 0 : ext), base, hi(az, bz) + (horiz ? ext : 0), TRESTLE);
          r.box(bx - 0.25 - dx * 2, -2.0, bz - 0.25 - dz * 2, bx + 0.25 - dx * 2, base - 0.3, bz + 0.25 - dz * 2, TRESTLE);
        } else r.box(lo(ax, bx) - (horiz ? 0 : ext), 0, lo(az, bz) - (horiz ? ext : 0), hi(ax, bx) + (horiz ? 0 : ext), 0.22, hi(az, bz) + (horiz ? ext : 0), BALLAST);
        // sleepers across all three tracks
        for (let t = 0.5; t < 4; t += 1.0) {
          const px = ax + dx * t, pz = az + dz * t;
          if (horiz) r.box(px - 0.18, base + 0.22, cz - 3.5, px + 0.18, base + 0.32, cz + 3.5, SLEEPER);
          else r.box(cx - 3.5, base + 0.22, pz - 0.18, cx + 3.5, base + 0.32, pz + 0.18, SLEEPER);
        }
      }
      const ry0 = crossing ? base : base + 0.32;
      for (const lane of [-2.5, 0, 2.5])
        for (const g of [-0.72, 0.72]) {
          const o = lane + g;
          if (horiz) r.box(lo(ax, bx), ry0, cz + o - 0.07, hi(ax, bx), ry0 + 0.14, cz + o + 0.07, RAILC);
          else r.box(cx + o - 0.07, ry0, lo(az, bz), cx + o + 0.07, ry0 + 0.14, hi(az, bz), RAILC);
        }
    }
  }

  private updateMountains(): void {
    const sig = (World.mountains as Mtn[]).map((m) => m.x + ',' + m.y).join(';');
    if (sig === this.mtnSig) return;
    this.mtnSig = sig;
    if (this.mtnMesh) {
      this.group.remove(this.mtnMesh);
      this.mtnMesh.geometry.dispose();
      this.mtnMesh = null;
    }
    const b = new MeshBuilder();
    const N = 26;
    for (const m of World.mountains as Mtn[]) {
      const p = mtnParams(m);
      const x0 = m.x * TM - 2, z0 = m.y * TM - 2, size = MSIZE * TM + 4, step = size / N;
      const H = (i: number, j: number) => mtnHeight(m, x0 + i * step, z0 + j * step);
      const col = (h: number, slope: number) => {
        const f = h / p.H;
        if (f > 0.72) return hex('#eef2f6');
        if (f > 0.5 || slope > 1.1) return shade('#8a8378', (hash2(Math.round(h * 10), m.x) % 9 - 4) * 0.03);
        if (f > 0.12) return shade('#7a8a58', -0.05);
        return hex('#6f9a4e');
      };
      for (let j = 0; j < N; j++)
        for (let i = 0; i < N; i++) {
          const a = [x0 + i * step, H(i, j), z0 + j * step];
          const bq = [x0 + (i + 1) * step, H(i + 1, j), z0 + j * step];
          const c = [x0 + (i + 1) * step, H(i + 1, j + 1), z0 + (j + 1) * step];
          const d = [x0 + i * step, H(i, j + 1), z0 + (j + 1) * step];
          if (a[1] + bq[1] + c[1] + d[1] < 0.05) continue;
          const hm = (a[1] + bq[1] + c[1] + d[1]) / 4;
          const slope = Math.abs(a[1] - c[1]) / step;
          // counter-clockwise from above: a(-x,-z) d(-x,+z) c(+x,+z) b(+x,-z)
          b.tri(a, d, c, col(hm, slope));
          b.tri(a, c, bq, col(hm, slope));
        }
    }
    if (b.empty) return;
    this.mtnMesh = new THREE.Mesh(b.build(), MAT.ground);
    this.mtnMesh.castShadow = true;
    this.mtnMesh.receiveShadow = true;
    this.group.add(this.mtnMesh);
  }

  private updateTrees(): void {
    let h = 0;
    for (let i = 0; i < World.tree.length; i += 1) if (World.tree[i]) h = (Math.imul(h, 31) + i * World.tree[i]) | 0;
    const sig = h + '|' + this.season;
    if (sig === this.treeSig) return;
    this.treeSig = sig;
    for (const p of [...this.trunks, ...this.crowns]) p.begin();
    const season = this.season;
    for (let ty = 0; ty < GH; ty++)
      for (let tx = 0; tx < GW; tx++) {
        const v = World.tree[World.idx(tx, ty)];
        if (!v) continue;
        const s = Math.max(1, Math.min(6, v));
        const sp = treeSpot(tx, ty);
        const hv = hash2(tx, ty);
        const yaw = (hv % 628) / 100;
        this.trunks[s - 1].add(sp.x, 0, sp.z, yaw, sp.s);
        const crown = crownColour(s, season, hv);
        if (crown) this.crowns[s - 1].add(sp.x, 0, sp.z, yaw, sp.s, crown);
      }
    for (const p of [...this.trunks, ...this.crowns]) p.end();
  }

  /** V1's lamp rule: regular posts along the outer kerbs, alternating sides */
  private updateLamps(): void {
    const sig = World.roadStamp + ':' + World.railStamp;
    if (sig === this.lampSig) return;
    this.lampSig = sig;
    this.lampPoles.begin();
    this.lampBulbs.begin();
    this.lampSpots = [];
    const popcount = (m: number) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
    for (let y = 0; y < GH; y++)
      for (let x = 0; x < GW; x++) {
        const i = World.idx(x, y);
        if (!World.roadMap[i] || World.ground[i] === G_WATER || World.railMap[i]) continue;
        const m = World.roadMask(x, y);
        if (popcount(m) === 4) continue;
        const horiz = (m & 10) !== 0, vert = (m & 5) !== 0;
        let px: number, pz: number, yaw: number;
        if (horiz && !World.isRoad(x, y - 1) && x % 6 === 0) { px = x * TM + 4; pz = y * TM + 0.6; yaw = 0; }
        else if (horiz && !World.isRoad(x, y + 1) && x % 6 === 3) { px = x * TM + 4; pz = y * TM + TM - 0.6; yaw = Math.PI; }
        else if (vert && !World.isRoad(x - 1, y) && y % 6 === 0) { px = x * TM + 0.6; pz = y * TM + 4; yaw = Math.PI / 2; }
        else if (vert && !World.isRoad(x + 1, y) && y % 6 === 3) { px = x * TM + TM - 0.6; pz = y * TM + 4; yaw = -Math.PI / 2; }
        else continue;
        this.lampPoles.add(px, 0.2, pz, yaw);
        this.lampBulbs.add(px, 0.2, pz, yaw);
        this.lampSpots.push({ x: px + Math.sin(yaw) * 1.4, z: pz + Math.cos(yaw) * 1.4 });
      }
    this.lampPoles.end();
    this.lampBulbs.end();
  }

  /** per-frame: water level (drought), flood sheet, lamp glow */
  frame(night: number): void {
    const level = WATER_Y - 1.15 * Math.min(1, Calamity.droughtLevel);
    for (const m of this.waterMeshes) m.position.y = level - WATER_Y;
    (MAT.tintGlow as THREE.MeshBasicMaterial).color.setRGB(0.35 + night * 0.65, 0.33 + night * 0.55, 0.28 + night * 0.25);
    const n = Calamity.flooded ? Calamity.flooded.size : 0;
    if (n !== this.floodN) {
      this.floodN = n;
      if (this.floodMesh) {
        this.group.remove(this.floodMesh);
        this.floodMesh.geometry.dispose();
        this.floodMesh = null;
      }
      if (n) {
        const b = new MeshBuilder();
        const c = hex('#ffffff');
        for (const i of Calamity.flooded as Set<number>) {
          const x0 = (i % GW) * TM, z0 = Math.floor(i / GW) * TM;
          b.quad([x0, 0.55, z0 + TM], [x0 + TM, 0.55, z0 + TM], [x0 + TM, 0.55, z0], [x0, 0.55, z0], c);
        }
        this.floodMesh = new THREE.Mesh(b.build(), new THREE.MeshStandardMaterial({ color: 0x7a7a5a, transparent: true, opacity: 0.78, roughness: 0.2 }));
        this.group.add(this.floodMesh);
      }
    }
  }
}

/* ---------- trees ---------- */
function treeTemplate(s: number): { trunk: THREE.BufferGeometry; crown: THREE.BufferGeometry } {
  const t = new MeshBuilder();
  const c = new MeshBuilder();
  const bark = hex(s === 5 ? '#e8e4dc' : '#6e4f33');
  const W = hex('#ffffff');
  switch (s) {
    case 2: // pine
      t.cyl(0, 0, 0, 0.28, 2.2, 5, bark);
      c.cone(0, 1.6, 0, 2.6, 3.6, 7, W).cone(0, 3.6, 0, 2.0, 3.2, 7, W).cone(0, 5.4, 0, 1.3, 2.8, 7, W);
      break;
    case 3: // poplar
      t.cyl(0, 0, 0, 0.25, 2.4, 5, bark);
      c.blob(0, 5.4, 0, 1.4, 3.6, 1.4, W);
      break;
    case 4: // oak
      t.cyl(0, 0, 0, 0.42, 2.8, 6, bark);
      c.blob(-0.8, 4.2, 0.3, 2.6, 2.0, 2.4, W).blob(1.0, 4.8, -0.4, 2.3, 2.0, 2.2, W);
      break;
    case 5: // birch
      t.cyl(0, 0, 0, 0.2, 4.0, 5, bark);
      c.blob(0, 5.2, 0, 1.8, 2.2, 1.8, W);
      break;
    case 6: // fruit / blossom tree
      t.cyl(0, 0, 0, 0.3, 2.0, 5, bark);
      c.blob(0, 3.6, 0, 2.4, 1.9, 2.4, W);
      break;
    default: // round deciduous
      t.cyl(0, 0, 0, 0.32, 2.6, 5, bark);
      c.blob(0, 4.4, 0, 2.5, 2.4, 2.5, W);
  }
  return { trunk: t.build(), crown: c.build() };
}

function crownColour(s: number, season: number, hv: number): THREE.Color | null {
  const j = ((hv % 13) - 6) * 0.018;
  if (s === 2) return shade('#2f6b3a', j); // evergreen
  if (season === 3) return null; // bare branches in winter
  if (season === 0) return s === 6 ? shade(hv % 3 ? '#f2b8cc' : '#fbe0ea', j) : shade('#7fc35a', j);
  if (season === 2) return shade(['#d9822b', '#c4532d', '#e3b23c', '#b8742a'][hv % 4], j);
  return shade(s === 5 ? '#76b04f' : '#4e9a3e', j);
}

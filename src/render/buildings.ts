/* ============================================================
   Buildings (V2 look): every catalog type is still described by
   V1's builder functions below, but the toolkit they draw with
   is real architecture — walls of brick, render or stone cut
   around recessed sash windows (with rooms behind the glass),
   curtain walls on glazed blocks, panelled doors, tiled roofs
   with fascias and gutters, flat roofs with parapets and plant,
   striped awnings, backlit name boards, brick chimneys, stone
   columns and pediments, fences and railings, and real trees.
   The layer merges finished buildings per map chunk (one mesh
   per material) and keeps construction sites separate so they
   can rise inside their scaffolds.
   Local frame: plot centred on the origin, front (door) at +Z.
   ============================================================ */
import * as THREE from 'three';
import { CAT } from '../sim/catalog';
import { World } from '../sim/world';
import { Weather } from '../sim/weather';
import { hex, shade, hash2 } from './kit';
import { Kit, Packed, Palette, sharedPalette, Frame, Hole, wallFace, obox, sashWindow, frontDoor, glassPane, chimney as brickChimney, TRIM, meshesFromParts, freeAfterUpload } from '../gfx/architecture';
import * as TX from '../gfx/textures';
import { TreeInstance, Species } from '../gfx/vegetation';

const TM = 8;
const FLOOR = 3.2;
type Box2 = [number, number, number, number]; // x0 z0 x1 z1 (local)
type P3 = number[];

const HOUSE_WALLS = ['#f0e0bd', '#e6c69c', '#d8e4ef', '#f2d4cc', '#e4e0d4', '#cfe0c2'];
const HOUSE_ROOFS = ['#c0574f', '#7a8fb1', '#8a9a5b', '#a86f4f', '#6d5b8e', '#b0883f'];

/** buildings you can walk straight into (open venues): no collision box */
const OPEN = new Set(['park', 'playground', 'grandpark', 'plaza', 'pool', 'busstop', 'taxistand', 'heliport', 'dock']);
const CLASSICAL = new Set(['bank', 'exchange', 'museum', 'library', 'courthouse', 'townhall', 'college', 'theater', 'mansion']);
const INDUSTRIAL = new Set(['factory', 'steelworks', 'sawmill', 'brickworks', 'textilemill', 'cannery', 'glassworks', 'warehouse', 'powerplant']);

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const WHITE = new THREE.Color(1, 1, 1);
const _T = new THREE.Matrix4();
/** a translation, inside a local transform when there is one (scratch: use it at once) */
function at(mat: THREE.Matrix4 | null, x: number, y: number, z: number): THREE.Matrix4 {
  _T.makeTranslation(x, y, z);
  return mat ? _T.premultiply(mat) : _T;
}
const _hsl = { h: 0, s: 0, l: 0 };
const hslOf = (c: THREE.Color): { h: number; s: number; l: number } => c.getHSL(_hsl);

/* ---------- picking a real material for a V1 colour ---------- */
function roofKey(c: THREE.Color): string {
  const { h, s } = hslOf(c);
  return (h < 0.11 || h > 0.94) && s > 0.22 ? 'clay' : 'slate';
}
function detailKey(c: THREE.Color, flatGround: boolean): string {
  const { h, s, l } = hslOf(c);
  if (flatGround) {
    if (h > 0.17 && h < 0.45 && s > 0.18 && l < 0.78) return 'grass';
    if (l < 0.42 && s < 0.2) return 'asphalt';
    if (h > 0.06 && h < 0.16 && s > 0.22) return 'gravel';
    return 'paving';
  }
  if (l < 0.3 && s < 0.35) return 'metal';
  if (h > 0.03 && h < 0.12 && s > 0.2 && l < 0.5) return 'timber';
  if (s > 0.42) return 'paint';
  return 'render';
}
/** keep tints believable on textured materials */
function tintFor(key: string, c: THREE.Color): THREE.Color {
  if (key === 'grass' || key.startsWith('brick') || key === 'clay' || key === 'asphalt') return WHITE;
  if (key === 'slate' || key === 'stone' || key === 'paving' || key === 'gravel') return WHITE.clone().lerp(c, 0.35).multiplyScalar(1.15);
  if (key === 'render') return c.clone().lerp(WHITE, 0.15);
  return c;
}

/* ---------- adapters: V1's MeshBuilder calls, drawn into a Kit ---------- */
function polyGeo(pts: P3[]): THREE.BufferGeometry {
  const a = V(pts[0][0], pts[0][1], pts[0][2]), b = V(pts[1][0], pts[1][1], pts[1][2]), c = V(pts[2][0], pts[2][1], pts[2][2]);
  const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
  const tris = pts.length === 4 ? [0, 1, 2, 0, 2, 3] : [0, 1, 2];
  const pos: number[] = [], nor: number[] = [];
  for (const i of tris) { pos.push(pts[i][0], pts[i][1], pts[i][2]); nor.push(n.x, n.y, n.z); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

class KBody {
  /** optional local transform (like V1's MeshBuilder.mat) */
  mat: THREE.Matrix4 | null = null;
  /** force a material key for the next calls */
  force: string | null = null;
  constructor(private c: Ctx) {}
  get empty(): boolean { return false; }
  private keyOf(color: THREE.Color, flat: boolean, roofish: boolean): string {
    return this.force || (roofish ? roofKey(color) : detailKey(color, flat));
  }
  put(geo: THREE.BufferGeometry, color: THREE.Color, flat = false, roofish = false): this {
    if (this.mat) geo.applyMatrix4(this.mat);
    const key = this.keyOf(color, flat, roofish);
    this.c.kit.add(key, geo, tintFor(key, color));
    return this;
  }
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: THREE.Color, _top?: THREE.Color, _o?: unknown): this {
    // solid-looking pieces above head height stop the camera (balconies, porch roofs, stands)
    if (!this.mat && Math.max(y0, y1) > 1.2 && Math.min(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)) >= 0.2) this.c.camBox(x0, y0, z0, x1, y1, z1);
    const key = this.keyOf(color, Math.abs(y1 - y0) < 0.25 && Math.min(y0, y1) < 0.35, false);
    this.c.kit.boxAt(key, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.max(0.001, Math.abs(x1 - x0)), Math.max(0.001, Math.abs(y1 - y0)), Math.max(0.001, Math.abs(z1 - z0)), this.mat, tintFor(key, color));
    return this;
  }
  boxC(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: THREE.Color, top?: THREE.Color): this {
    return this.box(cx - sx / 2, cy - sy / 2, cz - sz / 2, cx + sx / 2, cy + sy / 2, cz + sz / 2, color, top);
  }
  quad(a: P3, b: P3, c: P3, d: P3, color: THREE.Color): this {
    const flat = Math.abs(a[1] - c[1]) < 0.05 && a[1] < 0.35;
    return this.put(polyGeo([a, b, c, d]), color, flat);
  }
  tri(a: P3, b: P3, c: P3, color: THREE.Color): this {
    return this.put(polyGeo([a, b, c]), color);
  }
  cyl(cx: number, y0: number, cz: number, r: number, h: number, n: number, color: THREE.Color, _top?: THREE.Color, rTop?: number): this {
    if (!this.mat && r >= 0.4 && y0 + h > 1.2) this.c.camBox(cx - r, y0, cz - r, cx + r, y0 + h, cz + r);
    const key = this.keyOf(color, h < 0.25 && y0 < 0.35, false);
    this.c.kit.cylinder(key, rTop === undefined ? r : rTop, r, Math.max(0.01, h), Math.max(12, n * 2), at(this.mat, cx, y0 + h / 2, cz), tintFor(key, color));
    return this;
  }
  cone(cx: number, y0: number, cz: number, r: number, h: number, n: number, color: THREE.Color): this {
    const g = new THREE.ConeGeometry(r, h, Math.max(n, 4) === 4 ? 4 : Math.max(16, n * 2));
    if (n === 4) g.rotateY(Math.PI / 4);
    g.translate(cx, y0 + h / 2, cz);
    return this.put(g, color, false, hslOf(color).s < 0.4);
  }
  blob(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, color: THREE.Color): this {
    const g = new THREE.SphereGeometry(1, 16, 12);
    g.scale(rx, ry, rz).translate(cx, cy, cz);
    return this.put(g, color);
  }
  gableX(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: THREE.Color, gable: THREE.Color): this {
    const zm = (z0 + z1) / 2;
    this.put(polyGeo([[x0, y0, z1], [x1, y0, z1], [x1, y1, zm], [x0, y1, zm]]), color, false, true);
    this.put(polyGeo([[x1, y0, z0], [x0, y0, z0], [x0, y1, zm], [x1, y1, zm]]), color, false, true);
    this.put(polyGeo([[x0, y0, z0], [x0, y0, z1], [x0, y1, zm]]), gable);
    this.put(polyGeo([[x1, y0, z1], [x1, y0, z0], [x1, y1, zm]]), gable);
    return this;
  }
  gableZ(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: THREE.Color, gable: THREE.Color): this {
    const xm = (x0 + x1) / 2;
    this.put(polyGeo([[x1, y0, z1], [x1, y0, z0], [xm, y1, z0], [xm, y1, z1]]), color, false, true);
    this.put(polyGeo([[x0, y0, z0], [x0, y0, z1], [xm, y1, z1], [xm, y1, z0]]), color, false, true);
    this.put(polyGeo([[x0, y0, z1], [x1, y0, z1], [xm, y1, z1]]), gable);
    this.put(polyGeo([[x1, y0, z0], [x0, y0, z0], [xm, y1, z0]]), gable);
    return this;
  }
  pyramid(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: THREE.Color, inset = 0): this {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const ax = inset ? Math.min(inset, (x1 - x0) / 2) : 0;
    const p0 = [cx - ax, y1, cz], p1 = [cx + ax, y1, cz];
    this.put(polyGeo([[x0, y0, z1], [x1, y0, z1], p1, p0]), color, false, true);
    this.put(polyGeo([[x1, y0, z0], [x0, y0, z0], p0, p1]), color, false, true);
    this.put(polyGeo([[x1, y0, z1], [x1, y0, z0], p1]), color, false, true);
    this.put(polyGeo([[x0, y0, z0], [x0, y0, z1], p0]), color, false, true);
    return this;
  }
}

/** windows drawn directly by builders: glass with a room behind it, in a slim frame */
class KWin {
  constructor(private c: Ctx, private kind: number) {}
  quad(a: P3, b: P3, _c: P3, d: P3, _color?: THREE.Color): this {
    const A = V(a[0], a[1], a[2]), B = V(b[0], b[1], b[2]), D = V(d[0], d[1], d[2]);
    const u = new THREE.Vector3().subVectors(B, A);
    const w = u.length();
    u.normalize();
    const up = new THREE.Vector3().subVectors(D, A);
    const n = new THREE.Vector3().crossVectors(u, up).normalize();
    if (Math.abs(n.y) > 0.5 || w < 0.05) { // roof lights and odd shapes: plain glass
      this.c.kit.add('glassPlain', polyGeo([a, b, _c, d]));
      return this;
    }
    const F = new Frame(V(A.x, 0, A.z), u, n);
    const h: Hole = { a0: 0, b0: Math.min(A.y, D.y), a1: w, b1: Math.max(A.y, D.y) };
    const tall = h.b1 - h.b0 > 2.2;
    const seed = this.c.hv + Math.round(A.x * 7 + A.y * 13 + A.z * 3);
    const lit = TX.hash(seed, 3, 9) > 0.4;
    glassPane(this.c.kit, F, h, 0, tall ? Math.max(0.1, h.b0 - 0.3) : h.b0 - 0.9, seed, lit, this.kind);
    const fc = new THREE.Color(0.08, 0.08, 0.09);
    obox(this.c.kit, 'metal', F, h.a0 - 0.05, h.b0 - 0.05, -0.02, h.a0 + 0.02, h.b1 + 0.05, 0.05, fc);
    obox(this.c.kit, 'metal', F, h.a1 - 0.02, h.b0 - 0.05, -0.02, h.a1 + 0.05, h.b1 + 0.05, 0.05, fc);
    obox(this.c.kit, 'metal', F, h.a0, h.b1 - 0.02, -0.02, h.a1, h.b1 + 0.05, 0.05, fc);
    obox(this.c.kit, 'metal', F, h.a0, h.b0 - 0.05, -0.02, h.a1, h.b0 + 0.02, 0.05, fc);
    return this;
  }
  cyl(cx: number, y0: number, cz: number, r: number, h: number, n: number, _color?: THREE.Color): this {
    this.c.kit.cylinder('glassPlain', r, r, h, Math.max(16, n * 2), at(null, cx, y0 + h / 2, cz), WHITE, true);
    return this;
  }
}

/** lit things (signs, neon, beacons): coloured panels by day, glowing after dusk */
class KGlow {
  constructor(private c: Ctx) {}
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: THREE.Color): this {
    this.c.kit.boxAt('glowPanel', (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), null, color);
    return this;
  }
  boxC(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: THREE.Color): this {
    return this.box(cx - sx / 2, cy - sy / 2, cz - sz / 2, cx + sx / 2, cy + sy / 2, cz + sz / 2, color);
  }
  cyl(cx: number, y0: number, cz: number, r: number, h: number, n: number, color: THREE.Color): this {
    this.c.kit.cylinder('glowPanel', r, r, Math.max(0.02, h), Math.max(16, n), at(null, cx, y0 + h / 2, cz), color);
    return this;
  }
}

export interface Built {
  height: number;
  solids: Box2[];
  trees: TreeInstance[];
  /** volumes the street camera can't enter (local x0 y0 z0 x1 y1 z1); null top = the building's height */
  cam: (number | null)[][];
}

class Ctx implements Built {
  kit: Kit;
  body: KBody;
  win: KWin[];
  shopWin: KWin;
  glow: KGlow;
  height = 4;
  solids: Box2[] = [];
  trees: TreeInstance[] = [];
  cam: (number | null)[][] = [];
  W: number;
  D: number;
  hv: number;
  winK = 0;
  private wall = { key: 'render', tint: WHITE };
  constructor(public b: any, public key: string, kit?: Kit) {
    const d = CAT[key];
    this.W = (d.w || 1) * TM;
    this.D = (d.h || 1) * TM;
    this.hv = hash2(b.id || 1, b.x * 7 + b.y);
    this.kit = kit || new Kit(sharedPalette());
    this.body = new KBody(this);
    // window interiors: 0 homes, 3 offices and halls, 1 shops, 4 stained glass
    this.win = [new KWin(this, 0), new KWin(this, 3), new KWin(this, 4)];
    // V2: a shop's own window: the shop it is, seen through the glass (gfx/architecture.ts pvShopSeen)
    this.shopWin = new KWin(this, 1 + 8 * (SHOP_STYLE[key] ?? 0));
    this.glow = new KGlow(this);
  }
  get hw(): number { return this.W / 2; }
  get hd(): number { return this.D / 2; }
  c(h: string, j = 0): THREE.Color {
    return j ? shade(h, j) : hex(h);
  }
  /** plot surface */
  // (V2: almost to the plot's edge: a 15 cm inset left a strip of lawn between every shop's paving and the pavement,
  // a green line down the high street that read as a mistake)
  lot(color: string, inset = 0.02): this {
    this.body.box(-this.hw + inset, 0, -this.hd + inset, this.hw - inset, 0.1, this.hd - inset, this.c(color));
    return this;
  }
  /** a footprint people can't walk through (and the camera can't enter, up to `top`) */
  solid(x0: number, z0: number, x1: number, z1: number, top: number | null = null): this {
    this.solids.push([x0, z0, x1, z1]);
    this.cam.push([x0, 0, z0, x1, top, z1]);
    return this;
  }
  /** a volume only the camera bumps into (awnings, balconies, roofs) */
  camBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    this.cam.push([Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)]);
  }

  /** which real wall finish a V1 wall colour becomes on this building */
  private wallFor(wall: string): { key: string; tint: THREE.Color } {
    const col = hex(wall);
    const { h, s, l } = hslOf(col);
    if (s > 0.35 && (h < 0.05 || h > 0.96) && l < 0.62) return { key: 'brickRed', tint: WHITE };
    if (s > 0.25 && h >= 0.03 && h < 0.1 && l < 0.55) return { key: 'brickBrown', tint: WHITE };
    if (CLASSICAL.has(this.key)) return { key: 'stone', tint: WHITE.clone().lerp(col, 0.4).multiplyScalar(1.1) };
    if (INDUSTRIAL.has(this.key)) return { key: this.hv % 2 ? 'brickRed' : 'brickBrown', tint: WHITE };
    if (CAT[this.key]?.res || this.key.startsWith('house') || this.key === 'cottage') {
      const k = this.hv % 4;
      if (k === 1) return { key: 'brickRed', tint: WHITE };
      if (k === 2) return { key: this.hv % 8 < 4 ? 'brickYellow' : 'brickBrown', tint: WHITE };
    }
    if (l < 0.35) return { key: 'render', tint: col.clone().multiplyScalar(1.3) };
    return { key: 'render', tint: col.clone().lerp(WHITE, 0.12) };
  }

  /** a walled block with windows on every face; returns its top */
  block(x0: number, z0: number, x1: number, z1: number, y0: number, floors: number, wall: string, o: { door?: boolean; doorC?: string; glass?: boolean; noWin?: boolean; winGap?: number; band?: string; floorH?: number } = {}): number {
    const fh = o.floorH || FLOOR;
    const y1 = y0 + floors * fh;
    const glass = !!o.glass;
    const w = glass ? { key: hslOf(hex(wall)).s > 0.15 ? 'metal' : 'render', tint: hex(wall).lerp(WHITE, 0.2) } : this.wallFor(wall);
    this.wall = w;
    this.solid(x0, z0, x1, z1, y1);
    const gap = o.winGap || 2.6;
    const ww = glass ? gap - 0.28 : 1.15, wh = glass ? fh - 0.75 : 1.45;
    const faces: { F: Frame; len: number; front: boolean }[] = [
      { F: new Frame(V(x0, 0, z1), V(1, 0, 0), V(0, 0, 1)), len: x1 - x0, front: true },
      { F: new Frame(V(x1, 0, z0), V(-1, 0, 0), V(0, 0, -1)), len: x1 - x0, front: false },
      { F: new Frame(V(x1, 0, z1), V(0, 0, -1), V(1, 0, 0)), len: z1 - z0, front: false },
      { F: new Frame(V(x0, 0, z0), V(0, 0, 1), V(-1, 0, 0)), len: z1 - z0, front: false },
    ];
    const trim = glass ? new THREE.Color(0.12, 0.13, 0.14) : TRIM;
    const kind = glass ? (this.winK === 1 && !['office', 'skyscraper', 'airport'].includes(this.key) ? 1 + 8 * (SHOP_STYLE[this.key] ?? 0) : 3) : this.winK === 0 ? 0 : 3;
    faces.forEach(({ F, len, front }, fi) => {
      const holes: Hole[] = [];
      const wins: { h: Hole; floorY: number; k: number }[] = [];
      let door: Hole | null = null;
      // the door sits at the centre of the front (x = 0 in plot space)
      const doorA = x0 < 0 && x1 > 0 ? -x0 : len / 2;
      if (front && o.door) {
        const dw = this.winK >= 1 || glass ? 1.9 : 1.15;
        door = { a0: doorA - dw / 2, b0: y0, a1: doorA + dw / 2, b1: y0 + Math.min(fh - 0.4, glass ? 2.7 : 2.45) };
        holes.push(door);
      }
      if (!o.noWin) {
        for (let f = 0; f < floors; f++) {
          const wy = y0 + f * fh + (glass ? 0.4 : 0.95);
          const n = Math.max(1, Math.floor((len - 1) / gap));
          const start = (len - (n - 1) * gap) / 2;
          for (let k = 0; k < n; k++) {
            const a = start + k * gap;
            if (door && f === 0 && Math.abs(a - doorA) < (door.a1 - door.a0) / 2 + ww / 2 + 0.15) continue;
            if (a - ww / 2 < 0.25 || a + ww / 2 > len - 0.25) continue;
            const h = { a0: a - ww / 2, b0: wy, a1: a + ww / 2, b1: Math.min(wy + wh, y0 + (f + 1) * fh - 0.25) };
            holes.push(h);
            wins.push({ h, floorY: y0 + f * fh, k: fi * 400 + f * 20 + k });
          }
        }
      }
      wallFace(this.kit, w.key, F, 0, y0, len, y1, holes, w.tint, glass ? 0.08 : 0.14);
      for (const wn of wins) {
        const seed = this.hv * 31 + wn.k;
        const lit = TX.hash(this.hv, wn.k, 5) > 0.42;
        if (glass) {
          glassPane(this.kit, F, wn.h, -0.06, wn.floorY, seed, lit, kind);
          for (const a of [wn.h.a0, wn.h.a1]) obox(this.kit, 'metal', F, a - 0.04, wn.h.b0, -0.08, a + 0.04, wn.h.b1, 0.03, trim);
          obox(this.kit, 'metal', F, wn.h.a0, wn.h.b0 - 0.04, -0.08, wn.h.a1, wn.h.b0 + 0.03, 0.03, trim);
          obox(this.kit, 'metal', F, wn.h.a0, wn.h.b1 - 0.03, -0.08, wn.h.a1, wn.h.b1 + 0.04, 0.03, trim);
        } else {
          sashWindow(this.kit, F, wn.h, wn.floorY, seed, lit, trim, { lintel: w.key === 'render' ? 'trim' : 'stone', sill: 'stone', bars: this.winK === 0 ? 2 : 1 });
        }
      }
      if (door) {
        if (this.winK >= 1 || glass) {
          // a glazed entrance: double doors in a dark frame, a canopy over
          const fc = new THREE.Color(0.1, 0.1, 0.11);
          glassPane(this.kit, F, { a0: door.a0 + 0.08, b0: door.b0 + 0.02, a1: door.a1 - 0.08, b1: door.b1 - 0.08 }, -0.12, door.b0, this.hv + 7, true, 1);
          for (const a of [door.a0, (door.a0 + door.a1) / 2 - 0.03, door.a1 - 0.08]) obox(this.kit, 'metal', F, a, door.b0, -0.16, a + 0.08, door.b1, -0.06, fc);
          obox(this.kit, 'metal', F, door.a0, door.b1 - 0.08, -0.16, door.a1, door.b1, -0.06, fc);
          obox(this.kit, 'metal', F, door.a0 - 0.5, door.b1 + 0.05, 0, door.a1 + 0.5, door.b1 + 0.18, 1.1, fc);
          this.camBox(x0 + door.a0 - 0.5, door.b1 + 0.05, z1, x0 + door.a1 + 0.5, door.b1 + 0.18, z1 + 1.1);
        } else {
          frontDoor(this.kit, F, door, hex(o.doorC || ['#1f3a5f', '#7a1f1f', '#1f4a2f', '#2a2a2a', '#5a3e2b'][this.hv % 5]), TRIM, this.hv, TX.hash(this.hv, 99, 5) > 0.4, w.key.startsWith('brick') && this.hv % 3 === 0);
        }
      }
      // plinth and string courses
      if (!glass) {
        const plinth = w.key === 'render' ? 'stone' : 'brickBrown';
        const spans: [number, number][] = door ? [[0, door.a0 - 0.12], [door.a1 + 0.12, len]] : [[0, len]];
        for (const [a, b2] of spans) if (b2 - a > 0.05) obox(this.kit, plinth, F, a, y0, -0.02, b2, y0 + 0.42, 0.035, plinth === 'stone' ? new THREE.Color(0.85, 0.83, 0.8) : new THREE.Color(0.7, 0.66, 0.64));
      }
      if (o.band) for (let f = 1; f < floors; f++) obox(this.kit, glass ? 'metal' : 'stone', F, -0.05, y0 + f * fh - 0.14, -0.01, len + 0.05, y0 + f * fh + 0.04, 0.05, glass ? trim : WHITE.clone().lerp(hex(o.band), 0.4));
    });
    this.height = Math.max(this.height, y1);
    return y1;
  }
  windows(): void {
    /* V2: windows are cut into the walls by block() */
  }
  /** a door set proud of an existing wall (where the builder didn't cut one) */
  door(x: number, z: number, y0: number, col = '#5a3e2b', w = 1.4, h = 2.3): void {
    const F = new Frame(V(x - w / 2, 0, z), V(1, 0, 0), V(0, 0, 1));
    const c = hex(col);
    obox(this.kit, 'trim', F, -0.12, y0, 0, 0, y0 + h + 0.12, 0.08, TRIM);
    obox(this.kit, 'trim', F, w, y0, 0, w + 0.12, y0 + h + 0.12, 0.08, TRIM);
    obox(this.kit, 'trim', F, -0.12, y0 + h, 0, w + 0.12, y0 + h + 0.12, 0.08, TRIM);
    obox(this.kit, 'paint', F, 0, y0, 0, w, y0 + h, 0.05, c);
    const pw = (w - 0.3) / 2;
    for (const [a, b0, b1] of [[0.1, y0 + 0.15, y0 + h * 0.42], [0.2 + pw, y0 + 0.15, y0 + h * 0.42], [0.1, y0 + h * 0.5, y0 + h - 0.12], [0.2 + pw, y0 + h * 0.5, y0 + h - 0.12]] as [number, number, number][])
      obox(this.kit, 'paint', F, a, b0, 0.05, a + pw, b1, 0.07, c);
    obox(this.kit, 'brass', F, w - 0.2, y0 + 1.0, 0.05, w - 0.14, y0 + 1.07, 0.1);
    obox(this.kit, 'stone', F, -0.15, y0 - 0.12, 0, w + 0.15, y0, 0.4);
  }
  flatRoof(x0: number, z0: number, x1: number, z1: number, y: number, col = '#8a8f96', parapet = 0.5): void {
    this.kit.box('gravel', x0, y, z0, x1, y + 0.12, z1, hex(col).lerp(new THREE.Color(0.45, 0.45, 0.45), 0.6));
    if (parapet) {
      this.camBox(x0, y, z0, x1, y + parapet + 0.08, z1);
      const k = this.wall.key, t = this.wall.tint;
      this.kit.box(k, x0 - 0.02, y, z0 - 0.02, x1 + 0.02, y + parapet, z0 + 0.28, t);
      this.kit.box(k, x0 - 0.02, y, z1 - 0.28, x1 + 0.02, y + parapet, z1 + 0.02, t);
      this.kit.box(k, x0 - 0.02, y, z0, x0 + 0.28, y + parapet, z1, t);
      this.kit.box(k, x1 - 0.28, y, z0, x1 + 0.02, y + parapet, z1, t);
      const cp = new THREE.Color(0.86, 0.85, 0.82);
      this.kit.box('stone', x0 - 0.08, y + parapet, z0 - 0.08, x1 + 0.08, y + parapet + 0.08, z0 + 0.36, cp);
      this.kit.box('stone', x0 - 0.08, y + parapet, z1 - 0.36, x1 + 0.08, y + parapet + 0.08, z1 + 0.08, cp);
      this.kit.box('stone', x0 - 0.08, y + parapet, z0, x0 + 0.36, y + parapet + 0.08, z1, cp);
      this.kit.box('stone', x1 - 0.36, y + parapet, z0, x1 + 0.08, y + parapet + 0.08, z1, cp);
    }
    // rooftop plant: AC units with fans, a vent stack (V2: placed with an unsigned shift: the hash is a full 32 bits,
    // and for half the buildings `>>` made it negative, which put the units up to 17 m off the roof, in the air)
    const n = 1 + (this.hv % 3);
    const plant = new THREE.Color(0.72, 0.74, 0.76);
    for (let i = 0; i < n && x1 - x0 > 5; i++) {
      const ax = x0 + 1.5 + (((this.hv >>> (i * 3)) % 7) / 7) * (x1 - x0 - 4);
      const az = z0 + 1.5 + (((this.hv >>> (i * 5)) % 5) / 5) * (z1 - z0 - 4);
      this.kit.box('metal', ax, y + 0.12, az, ax + 1.6, y + 1.0, az + 1.2, plant);
      this.kit.cyl('metal', 0.38, 0.06, 16, new THREE.Matrix4().makeTranslation(ax + 0.8, y + 1.03, az + 0.6), new THREE.Color(0.15, 0.15, 0.16));
    }
    this.height = Math.max(this.height, y + parapet);
  }
  /** a tiled roof with overhangs, fascias, gutters and ridge tiles; gable ends in the wall finish */
  gable(x0: number, z0: number, x1: number, z1: number, y: number, rise: number, roof: string, _wall: string, alongX = true): void {
    const key = roofKey(hex(roof));
    const tint = key === 'clay' ? WHITE.clone().lerp(hex(roof), 0.25).multiplyScalar(1.1) : WHITE.clone().lerp(hex(roof), 0.3).multiplyScalar(1.05);
    this.camBox(x0 - 0.35, y - 0.3, z0 - 0.35, x1 + 0.35, y + rise, z1 + 0.35);
    const base = this.kit.base.clone();
    // a local frame where the ridge runs along +x and the front eave is at z = 0
    const L = alongX ? x1 - x0 : z1 - z0, D = alongX ? z1 - z0 : x1 - x0;
    const local = alongX ? new THREE.Matrix4().makeTranslation(x0, 0, z1) : new THREE.Matrix4().makeTranslation(x0, 0, z0).multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2));
    this.kit.base = base.clone().multiply(local);
    const ov = 0.35, t = rise / (D / 2);
    const ye = y - ov * t, R = y + rise;
    const vx0 = -0.25, vx1 = L + 0.25;
    this.kit.slab(key, V(vx0, ye, ov), V(vx1, ye, ov), V(vx1, R, -D / 2), V(vx0, R, -D / 2), 0.07, tint);
    this.kit.slab(key, V(vx1, ye, -D - ov), V(vx0, ye, -D - ov), V(vx0, R, -D / 2), V(vx1, R, -D / 2), 0.07, tint);
    const ridge = new THREE.CylinderGeometry(0.13, 0.13, vx1 - vx0, 10, 1, false, 0, Math.PI);
    ridge.rotateZ(Math.PI / 2);
    ridge.translate((vx0 + vx1) / 2, R - 0.02, -D / 2);
    this.kit.add(key === 'clay' ? 'pot' : 'lead', ridge);
    // gable ends in the wall finish, with bargeboards
    for (const x of [0, L]) {
      const nx = x === 0 ? -1 : 1;
      this.kit.tri(this.wall.key, V(x, y, 0), V(x, y, -D), V(x, R, -D / 2), V(nx, 0, 0), this.wall.tint);
    }
    for (const [z, s] of [[ov, 1], [-D - ov, -1]] as [number, number][]) {
      this.kit.box('trim', vx0, ye - 0.22, z - 0.03, vx1, ye - 0.02, z + 0.03, TRIM);
      const zw = s > 0 ? 0 : -D;
      this.kit.quad('trim', V(vx0, ye - 0.2, zw), V(vx1, ye - 0.2, zw), V(vx1, ye - 0.2, z), V(vx0, ye - 0.2, z), V(0, -1, 0), TRIM);
      const g = new THREE.CylinderGeometry(0.065, 0.065, vx1 - vx0, 8, 1, true, Math.PI, Math.PI);
      g.rotateZ(Math.PI / 2);
      g.translate((vx0 + vx1) / 2, ye - 0.12, z + s * 0.08);
      this.kit.add('metal', g, new THREE.Color(0.06, 0.065, 0.07));
    }
    this.kit.base = base;
    this.height = Math.max(this.height, y + rise);
  }
  awning(x0: number, x1: number, z: number, y: number, a: string, b2: string): void {
    const pal = this.kit.pal;
    const k = pal.custom(`awn:${a}|${b2}`, () => TX.awningCanvas(a, b2), { roughness: 0.85, side: THREE.DoubleSide });
    const rep = (x1 - x0) / 2;
    const depth = 1.5;
    this.camBox(x0, y - 0.98, z, x1, y, z + depth);
    this.kit.quad(k, V(x0, y, z), V(x1, y, z), V(x1, y - 0.7, z + depth), V(x0, y - 0.7, z + depth), V(0, 1, 0.45), WHITE, [0, 0, rep, 0, rep, 1, 0, 1]);
    this.kit.quad(k, V(x0, y - 0.7, z + depth), V(x1, y - 0.7, z + depth), V(x1, y - 0.98, z + depth), V(x0, y - 0.98, z + depth), V(0, 0, 1), WHITE, [0, 0, rep, 0, rep, 0.3, 0, 0.3]);
    for (const x of [x0 + 0.05, x1 - 0.05]) this.kit.rod('metal', V(x, y - 0.6, z + 0.05), V(x, y - 0.7, z + depth - 0.05), 0.018, new THREE.Color(0.1, 0.1, 0.1));
  }
  /** a painted name board, lit after dusk */
  sign(x: number, z: number, y: number, w: number, col: string, h = 0.9): void {
    const name = (CAT[this.key]?.name as string) || this.key;
    const bg = hex(col);
    const light = hslOf(bg).l > 0.6;
    const k = this.kit.pal.sign(name, '#' + bg.getHexString(), light ? '#1a1a1a' : hslOf(bg).s < 0.2 ? '#c9a64a' : '#ffffff');
    this.kit.box('paint', x - w / 2 - 0.06, y - 0.06, z, x + w / 2 + 0.06, y + h + 0.06, z + 0.16, bg.clone().multiplyScalar(0.5));
    this.kit.quad(k, V(x - w / 2, y, z + 0.17), V(x + w / 2, y, z + 0.17), V(x + w / 2, y + h, z + 0.17), V(x - w / 2, y + h, z + 0.17), V(0, 0, 1), WHITE, [0, 0, 1, 0, 1, 1, 0, 1]);
  }
  chimney(x: number, z: number, y: number, h: number, r = 0.5, col = '#8a5a4a'): void {
    const brick = hslOf(hex(col)).s > 0.15;
    brickChimney(this.kit, brick ? 'brickBrown' : 'stone', brick ? WHITE : hex(col).lerp(WHITE, 0.5), x, z, y - 0.4, y + h, r > 0.52 ? 2 : 2 + (this.hv % 2));
    this.height = Math.max(this.height, y + h);
  }
  smokestack(x: number, z: number, h: number, r: number, _col = '#9a8f86'): void {
    this.kit.cyl('brickRed', r, h, 20, new THREE.Matrix4().makeTranslation(x, h / 2, z), WHITE, false, Math.PI * 2, r * 0.82);
    for (const f of [0.35, 0.7, 0.92]) this.kit.cyl('metal', r * (1.02 - f * 0.18) + 0.03, 0.18, 20, new THREE.Matrix4().makeTranslation(x, h * f, z), new THREE.Color(0.12, 0.12, 0.12));
    this.kit.cyl('metal', r * 0.86, 0.3, 20, new THREE.Matrix4().makeTranslation(x, h + 0.1, z), new THREE.Color(0.08, 0.08, 0.08), true);
    this.solid(x - r, z - r, x + r, z + r);
    this.height = Math.max(this.height, h);
  }
  /** a real tree (it joins the forest layer) */
  tree(x: number, z: number, s = 1): void {
    const p = V(x, 0, z).applyMatrix4(this.kit.base);
    const pick: Species[] = ['lime', 'oak', 'birch', 'lime', 'oak'];
    const k = Math.abs(Math.round(this.hv + x * 3 + z * 7));
    this.trees.push({ x: p.x, z: p.z, y: 0.1, species: pick[k % pick.length], scale: s * 0.62, rot: (k % 628) / 100 });
  }
  bench(x: number, z: number, yaw = 0): void {
    // (V2 (Milestone 8): solid: its footprint, turned)
    const ex = Math.abs(Math.cos(yaw)) * 0.95 + Math.abs(Math.sin(yaw)) * 0.27, ez = Math.abs(Math.sin(yaw)) * 0.95 + Math.abs(Math.cos(yaw)) * 0.27;
    this.solid(x - ex, z - ez, x + ex, z + ez, 0.9);
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, 0, z);
    this.body.mat = m;
    const iron = new THREE.Color(0.04, 0.04, 0.045), wood = new THREE.Color(0.72, 0.55, 0.38);
    this.body.force = 'metal';
    for (const sx of [-0.8, 0.8]) {
      this.body.box(sx - 0.03, 0, -0.25, sx + 0.03, 0.44, 0.22, iron);
      this.body.box(sx - 0.03, 0.44, -0.27, sx + 0.03, 0.9, -0.21, iron);
    }
    this.body.force = 'timber';
    for (let i = 0; i < 4; i++) this.body.box(-0.95, 0.42, -0.2 + i * 0.105, 0.95, 0.46, -0.2 + i * 0.105 + 0.085, wood);
    for (let i = 0; i < 3; i++) this.body.box(-0.95, 0.55 + i * 0.12, -0.27, 0.95, 0.64 + i * 0.12, -0.235, wood);
    this.body.force = null;
    this.body.mat = null;
  }
  columns(x0: number, x1: number, z: number, y0: number, h: number, n: number, col = '#efe9dc'): void {
    const t = WHITE.clone().lerp(hex(col), 0.4).multiplyScalar(1.05);
    for (let i = 0; i < n; i++) {
      const x = x0 + ((x1 - x0) * (i + 0.5)) / n;
      this.camBox(x - 0.4, y0, z - 0.4, x + 0.4, y0 + h, z + 0.4);
      this.kit.box('stone', x - 0.45, y0, z - 0.45, x + 0.45, y0 + 0.3, z + 0.45, t);
      this.kit.cyl('stone', 0.32, h - 0.75, 20, new THREE.Matrix4().makeTranslation(x, y0 + 0.3 + (h - 0.75) / 2, z), t, false, Math.PI * 2, 0.28);
      this.kit.cyl('stone', 0.36, 0.15, 20, new THREE.Matrix4().makeTranslation(x, y0 + h - 0.38, z), t);
      this.kit.box('stone', x - 0.46, y0 + h - 0.3, z - 0.46, x + 0.46, y0 + h, z + 0.46, t);
    }
  }
  pediment(x0: number, x1: number, z0: number, z1: number, y: number, rise: number, col = '#e8e2d2'): void {
    const t = WHITE.clone().lerp(hex(col), 0.4).multiplyScalar(1.05);
    const xm = (x0 + x1) / 2;
    this.camBox(x0 - 0.2, y - 0.1, z0, x1 + 0.2, y + rise, z1 + 0.2);
    this.kit.box('stone', x0 - 0.15, y - 0.1, z0, x1 + 0.15, y + 0.12, z1 + 0.15, t);
    this.kit.tri('stone', V(x0, y + 0.12, z1), V(x1, y + 0.12, z1), V(xm, y + rise, z1), V(0, 0, 1), t);
    this.kit.slab('slate', V(x1 + 0.2, y + 0.1, z1 + 0.2), V(x1 + 0.2, y + 0.1, z0), V(xm, y + rise + 0.12, z0), V(xm, y + rise + 0.12, z1 + 0.2), 0.08, new THREE.Color(0.8, 0.82, 0.84));
    this.kit.slab('slate', V(x0 - 0.2, y + 0.1, z0), V(x0 - 0.2, y + 0.1, z1 + 0.2), V(xm, y + rise + 0.12, z1 + 0.2), V(xm, y + rise + 0.12, z0), 0.08, new THREE.Color(0.8, 0.82, 0.84));
    this.height = Math.max(this.height, y + rise);
  }
  /** a fence round the plot; V2 (Milestone 8): solid, and with openings in its front run (`gaps`, ranges of x)
   *  for the path to the door and the drive (people and cars passed straight through it before) */
  fence(x0: number, z0: number, x1: number, z1: number, col = '#a5824f', h = 0.9, gaps: [number, number][] = [[-1.6, 1.6]]): void {
    const c = hex(col);
    const iron = hslOf(c).l < 0.3;
    const runs: [number, number, number, number][] = [[x0, z0, x1, z0], [x0, z0, x0, z1], [x1, z0, x1, z1]];
    // the front run, between its openings
    let from = x0;
    for (const [g0, g1] of [...gaps].sort((a, b) => a[0] - b[0])) {
      if (g0 > from + 0.3) runs.push([from, z1, Math.min(x1, g0), z1]);
      from = Math.max(from, g1);
    }
    if (from < x1 - 0.3) runs.push([from, z1, x1, z1]);
    for (const [ax, az, bx, bz] of runs) {
      this.solid(Math.min(ax, bx) - 0.06, Math.min(az, bz) - 0.06, Math.max(ax, bx) + 0.06, Math.max(az, bz) + 0.06, h);
      const len = Math.hypot(bx - ax, bz - az);
      if (iron) {
        for (const y of [0.1, h - 0.08]) this.kit.rod('metal', V(ax, y, az), V(bx, y, bz), 0.015, c, 5);
        const n = Math.max(1, Math.round(len / 0.16));
        for (let i = 0; i <= n; i++) {
          const t = i / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
          this.kit.cylinder('metal', 0.011, 0.011, h, 4, at(null, x, h / 2, z), c);
        }
      } else {
        const paint = c.clone().lerp(WHITE, 0.55);
        for (const y of [0.25, h - 0.2]) this.kit.box('paint', Math.min(ax, bx) - 0.02, y, Math.min(az, bz) - 0.02, Math.max(ax, bx) + 0.02, y + 0.07, Math.max(az, bz) + 0.02, paint);
        const n = Math.max(1, Math.round(len / 0.24));
        for (let i = 0; i <= n; i++) {
          const t = i / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
          this.kit.box('paint', x - 0.04, 0, z - 0.04, x + 0.04, h, z + 0.04, paint);
        }
      }
    }
  }
}

/* ---------- shop & venue looks ---------- */
/** V2: what a shop window shows (gfx/architecture.ts pvShopSeen): 0 shelves of goods, 1 a pharmacy, 2 a barber's,
 *  3 a florist's, 4 books, 5 clothes, 6 a jeweller's, 7 a café or bakery, 8 a butcher's or fishmonger's, 9 screens,
 *  10 toys, 11 a laundrette, 12 a pet shop, 13 furniture, 14 an arcade, 15 a showroom */
const SHOP_STYLE: Record<string, number> = {
  shop: 0, market: 0, hardware: 0, postoffice: 0, gas: 0, autoshop: 15, pharmacy: 1, barber: 2, florist: 3, bookshop: 4,
  tailor: 5, mall: 5, deptstore: 5, jeweler: 6, bakery: 7, cafe: 7, restaurant: 7, icecream: 7, pizzeria: 7, teastall: 7,
  butcher: 8, fishmarket: 8, electronics: 9, toyshop: 10, laundry: 11, petshop: 12, furniture: 13, arcade: 14, motoshowroom: 15, carshowroom: 15,
};
const SHOP_LOOK: Record<string, [string, string, string, string?]> = {
  // wall, awning A, awning B, sign
  shop: ['#e8d8b8', '#4f7ed0', '#ffffff', '#4f7ed0'],
  bakery: ['#f2e2c4', '#c98a4b', '#ffffff', '#c98a4b'],
  cafe: ['#d9c2a4', '#3f7a52', '#f4efe6', '#3f7a52'],
  restaurant: ['#c9a27e', '#a8323a', '#f4efe6', '#a8323a'],
  pharmacy: ['#eef4f0', '#2e9a5a', '#ffffff', '#2e9a5a'],
  barber: ['#e9e4f0', '#d03a3a', '#ffffff', '#3a5ad0'],
  florist: ['#f4e8ee', '#e07aa0', '#ffffff', '#e07aa0'],
  bookshop: ['#d8cbb5', '#6a4a8a', '#f2ede0', '#6a4a8a'],
  butcher: ['#f0e6e0', '#b03030', '#ffffff', '#b03030'],
  tailor: ['#e8e0d8', '#5a6a9a', '#ffffff', '#5a6a9a'],
  electronics: ['#dfe6ee', '#2a4a7a', '#7ab0e0', '#2a7ad0'],
  toyshop: ['#f6e6a8', '#e05050', '#f6d040', '#e05050'],
  jeweler: ['#efe8dc', '#1a1a1a', '#c9a64a', '#c9a64a'],
  petshop: ['#e6f0dc', '#5aa04a', '#ffffff', '#5aa04a'],
  hardware: ['#d8d0c0', '#e08a2a', '#3a3a3a', '#e08a2a'],
  furniture: ['#d6c8b0', '#8a6a4a', '#efe6d6', '#8a6a4a'],
  icecream: ['#fbe9f0', '#f08ab0', '#ffffff', '#f08ab0'],
  pizzeria: ['#efdcc0', '#2e8a3e', '#c83a2a', '#c83a2a'],
  arcade: ['#3a2a5a', '#e040c0', '#40e0e0', '#e040c0'],
  laundry: ['#e0eef6', '#3a8ad0', '#ffffff', '#3a8ad0'],
  fishmarket: ['#dceaf0', '#2a6a9a', '#ffffff', '#2a6a9a'],
  postoffice: ['#e8e2d0', '#d0302a', '#f2c230', '#d0302a'],
  motoshowroom: ['#e4e8ec', '#1a1a1a', '#e0a020', '#e0a020'],
  teastall: ['#c9a27e', '#c0392b', '#f4d03f', '#c0392b'],
};
const FAST_FOOD: Record<string, [string, string]> = {
  burgerpalace: ['#d0302a', '#f2c230'], goldenarches: ['#c8102e', '#ffc72c'], crispycluck: ['#a8202a', '#ffffff'],
  tacobelle: ['#6a2a8a', '#f0a8d0'], pizzapalace: ['#2e7a3e', '#e04030'],
};

/* ---------- builders ---------- */
function buildHouse(c: Ctx, level: number): void {
  const v = c.b.variant || 0;
  const wall = HOUSE_WALLS[(v + c.hv) % HOUSE_WALLS.length], roof = HOUSE_ROOFS[(v + (c.hv >> 3)) % HOUSE_ROOFS.length];
  const res = !!CAT[c.key].res;
  c.lot(Weather.season === 3 ? '#e6ecf2' : '#93c46c', 0.2);
  // (openings for the path to the door and the drive, where the cars stand: sim/parking.ts)
  if (res || c.key === 'lodge') c.fence(-c.hw + 0.35, -c.hd + 0.35, c.hw - 0.35, c.hd - 0.35, undefined, undefined, [[-1.4, 1.4], [c.hw - 7.4, c.hw]]);
  // the house sits back on its plot with a front garden and a driveway
  const x0 = -c.hw + 2.2, x1 = c.hw - 2.6, z0 = -c.hd + 1.6, z1 = c.hd - 4.2;
  const floors = Math.min(3, level);
  const top = c.block(x0, z0, x1, z1, 0.1, floors, wall, { door: true });
  c.gable(x0, z0, x1, z1, top, 2.6, roof, wall, (c.hv & 1) === 0);
  c.chimney(x0 + 1.6, z0 + 1.2, top, 3.2);
  c.body.box(-1.4, 0.1, z1, 1.4, 0.35, z1 + 1.2, c.c('#b8b0a0')); // front step
  c.body.box(x1 + 0.2, 0.1, -c.hd + 1.2, c.hw - 0.4, 0.13, c.hd - 0.4, c.c('#9a968e')); // driveway
  if (level >= 3) { // villa: a wing and a terrace
    const wy = c.block(x0 - 1.2, z1 - 3.4, x0 + 3.2, z1 - 0.1, 0.1, 1, shade(wall, -0.04).getStyle());
    c.flatRoof(x0 - 1.2, z1 - 3.4, x0 + 3.2, z1 - 0.1, wy, '#c8c2b6', 0.35);
  }
  if (Weather.season !== 3) c.tree(-c.hw + 1.6, c.hd - 1.8, 0.7);
}

function buildMansion(c: Ctx): void {
  c.lot('#8fbd68');
  c.fence(-c.hw + 0.3, -c.hd + 0.3, c.hw - 0.3, c.hd - 0.3, '#3a3a3a', 1.3);
  const top = c.block(-7, -8, 7, 4, 0.1, 2, '#efe6d2', { door: true, band: '#d8ccb4' });
  c.body.pyramid(-7.5, 7.5, top, top + 3.4, -8.5, 4.5, c.c('#5a6a7a'), 4);
  c.block(-10.5, -6, -7, 2, 0.1, 1, '#e8dcc6');
  c.flatRoof(-10.5, -6, -7, 2, 3.3, '#5a6a7a', 0.3);
  c.block(7, -6, 10.5, 2, 0.1, 1, '#e8dcc6');
  c.flatRoof(7, -6, 10.5, 2, 3.3, '#5a6a7a', 0.3);
  c.columns(-3, 3, 4.6, 0.1, 6.3, 4);
  c.body.box(-3.6, 6.3, 3.9, 3.6, 6.7, 5.2, c.c('#efe6d2'));
  c.body.cyl(0, 0.1, 8, 1.2, 0.5, 10, c.c('#c8c2b6'));
  c.body.cyl(0, 0.6, 8, 0.25, 1.2, 6, c.c('#a8b8c8'));
  c.tree(-9, 8, 0.9); c.tree(9, 8, 0.9);
  c.height = top + 3.4;
}

function buildApartment(c: Ctx): void {
  c.lot('#b8b4a8');
  const floors = 5 + (c.hv % 3);
  const wall = ['#d8cfc0', '#c9d2dc', '#e0c8b8'][c.b.variant % 3 || 0];
  const top = c.block(-c.hw + 1.5, -c.hd + 1.5, c.hw - 1.5, c.hd - 2.5, 0.1, floors, wall, { door: true, band: shade(wall, -0.15).getStyle() });
  // balconies on the front
  for (let f = 1; f < floors; f++)
    for (const x of [-c.hw + 4, 0, c.hw - 4])
      c.body.box(x - 1.2, 0.1 + f * FLOOR - 0.1, c.hd - 2.5, x + 1.2, 0.1 + f * FLOOR + 0.9, c.hd - 1.6, c.c('#9aa0a8'));
  c.flatRoof(-c.hw + 1.5, -c.hd + 1.5, c.hw - 1.5, c.hd - 2.5, top);
}

function buildRowhouse(c: Ctx): void {
  c.lot('#93c46c');
  const n = 3, w = (c.W - 2) / n;
  for (let i = 0; i < n; i++) {
    const x0 = -c.hw + 1 + i * w, x1 = x0 + w - 0.1;
    const wall = HOUSE_WALLS[(c.hv + i * 2) % HOUSE_WALLS.length];
    const top = c.block(x0, -c.hd + 1.4, x1, c.hd - 3, 0.1, 2, wall, { door: false });
    c.door((x0 + x1) / 2, c.hd - 3, 0.1);
    c.gable(x0, -c.hd + 1.4, x1, c.hd - 3, top, 2.2, HOUSE_ROOFS[(c.hv + i) % HOUSE_ROOFS.length], wall, true);
    c.chimney(x0 + 1, -c.hd + 2.5, top, 2.6);
  }
}

function buildOffice(c: Ctx, tower: boolean): void {
  c.lot('#c8c4b8');
  c.winK = 1;
  if (tower) {
    const floors = 18 + (c.hv % 8);
    const glass = ['#7a9ab8', '#8aa8a0', '#6a7a9a'][c.hv % 3];
    let top = c.block(-c.hw + 2.5, -c.hd + 2.5, c.hw - 2.5, c.hd - 2.5, 0.1, Math.floor(floors * 0.6), glass, { door: true, glass: true, winGap: 2.2 });
    top = c.block(-c.hw + 4.5, -c.hd + 4.5, c.hw - 4.5, c.hd - 4.5, top, Math.ceil(floors * 0.4), glass, { glass: true, winGap: 2.2 });
    c.flatRoof(-c.hw + 4.5, -c.hd + 4.5, c.hw - 4.5, c.hd - 4.5, top, '#5a6068');
    c.body.box(-0.2, top, -0.2, 0.2, top + 9, 0.2, c.c('#aaaaaa'));
    c.glow.box(-0.35, top + 9, -0.35, 0.35, top + 9.6, 0.35, c.c('#ff3030'));
    c.height = top + 9.6;
    return;
  }
  const top = c.block(-c.hw + 2, -c.hd + 2, c.hw - 2, c.hd - 3, 0.1, 5, '#b8c4cc', { door: true, glass: true, winGap: 2.4, doorC: '#5a7a90' });
  c.flatRoof(-c.hw + 2, -c.hd + 2, c.hw - 2, c.hd - 3, top, '#7a8088');
}

function buildShop(c: Ctx): void {
  const look = SHOP_LOOK[c.key] || SHOP_LOOK.shop;
  c.lot('#c9c5b8');
  const deep = c.D > 16 ? 6 : 3;
  const x0 = -c.hw + 0.8, x1 = c.hw - 0.8, z0 = -c.hd + 1, z1 = c.hd - deep;
  const floors = c.W > 16 ? 1 : 2;
  const top = c.block(x0, z0, x1, z1, 0.1, floors, look[0], { door: true });
  if (floors === 2) c.gable(x0, z0, x1, z1, top, 2, '#8a5a4a', look[0], true);
  else c.flatRoof(x0, z0, x1, z1, top, '#9a968e', 0.4);
  // big shop window either side of the door
  // (V2: these were the offices' windows, desks and partitions behind a pharmacy's or a barber's glass)
  const wb = c.shopWin;
  const g = hex('#ffffff');
  for (const sx of [-1, 1]) {
    const xa = sx > 0 ? 1.0 : x0 + 0.5, xb = sx > 0 ? x1 - 0.5 : -1.0;
    if (xb - xa > 0.8) wb.quad([xa, 0.6, z1 + 0.07], [xb, 0.6, z1 + 0.07], [xb, 2.5, z1 + 0.07], [xa, 2.5, z1 + 0.07], g);
  }
  c.awning(x0 + 0.2, x1 - 0.2, z1, 3.3, look[1], look[2]);
  c.sign(0, z1 + 0.05, 3.4, Math.min(5, c.W - 2), look[3] || look[1], 0.8);
  if (c.key === 'autoshop') c.body.quad([1.2, 0.1, z1 + 0.08], [x1 - 0.6, 0.1, z1 + 0.08], [x1 - 0.6, 2.8, z1 + 0.08], [1.2, 2.8, z1 + 0.08], c.c('#7a7f86'));
  if (c.key === 'teastall') { c.height = 3.5; }
}

function buildFastFood(c: Ctx): void {
  const [a, b] = FAST_FOOD[c.key];
  c.lot('#9a968e');
  const top = c.block(-c.hw + 2, -c.hd + 1.5, c.hw - 9, c.hd - 3, 0.1, 1, '#efe6d6', { door: true });
  c.flatRoof(-c.hw + 2, -c.hd + 1.5, c.hw - 9, c.hd - 3, top, a, 1.0);
  c.body.box(-c.hw + 2, top - 0.6, c.hd - 3, c.hw - 9, top + 1.0, c.hd - 2.85, c.c(a));
  c.sign(-6, c.hd - 2.8, top + 1.2, 6, b, 1.2);
  // the tall roadside pylon
  c.body.box(c.hw - 4.2, 0.1, c.hd - 3, c.hw - 3.8, 9, c.hd - 2.6, c.c('#555'));
  c.glow.box(c.hw - 6, 9, c.hd - 3.1, c.hw - 2, 11.5, c.hd - 2.5, c.c(b));
  c.glow.box(c.hw - 5.6, 9.3, c.hd - 2.49, c.hw - 2.4, 11.2, c.hd - 2.45, c.c(a));
  c.height = 11.5;
  // drive-thru lane & parked car bays
  c.body.box(c.hw - 9, 0.1, -c.hd + 1, c.hw - 1, 0.13, c.hd - 1, c.c('#5a5d63'));
}

function buildMarket(c: Ctx, big: boolean): void {
  c.lot('#8f9298');
  c.winK = 1;
  const floors = big ? 2 : 1;
  const wall = big ? '#dcd6ca' : '#e6e2d6';
  const top = c.block(-c.hw + 1, -c.hd + 1, c.hw - 1, c.hd - 5, 0.1, floors, wall, { door: true, glass: !big, winGap: 3 });
  c.flatRoof(-c.hw + 1, -c.hd + 1, c.hw - 1, c.hd - 5, top, '#8a8f96');
  c.body.box(-c.hw + 1, 2.9, c.hd - 5, c.hw - 1, 3.4, c.hd - 3.2, c.c(big ? '#2a6aa0' : '#3a9a4a'));
  c.sign(0, c.hd - 4.95, top - 1.3, Math.min(10, c.W - 4), big ? '#2a6aa0' : '#e04a3a', 1.1);
  // parking lines in front
  for (let x = -c.hw + 3; x < c.hw - 2; x += 3) c.body.box(x, 0.1, c.hd - 3, x + 0.15, 0.12, c.hd - 0.6, c.c('#eeeeee'));
}

function buildDeptStore(c: Ctx, mall: boolean): void {
  c.lot('#8f9298');
  c.winK = 1;
  const floors = mall ? 2 : 3;
  const top = c.block(-c.hw + 1, -c.hd + 1, c.hw - 1, c.hd - 3, 0.1, floors, mall ? '#d6dbe0' : '#e2d8c8', { door: true, glass: true, winGap: 3.2, band: '#b0a898' });
  c.flatRoof(-c.hw + 1, -c.hd + 1, c.hw - 1, c.hd - 3, top, '#7a8088');
  if (mall) for (let x = -c.hw + 6; x < c.hw - 4; x += 8) c.body.pyramid(x - 2, x + 2, top + 0.15, top + 2, -3, 3, c.c('#9ec6e0'));
  c.sign(0, c.hd - 2.95, top - 1.6, Math.min(12, c.W - 6), mall ? '#c03a8a' : '#2a5a9a', 1.2);
}

function buildHotel(c: Ctx): void {
  c.lot('#b8b4a8');
  const top = c.block(-c.hw + 1.5, -c.hd + 1.5, c.hw - 1.5, c.hd - 3, 0.1, 6, '#e8dcc8', { door: true, band: '#b8a888' });
  c.flatRoof(-c.hw + 1.5, -c.hd + 1.5, c.hw - 1.5, c.hd - 3, top);
  c.body.box(-3, 3.0, c.hd - 3, 3, 3.3, c.hd - 0.6, c.c('#8a2a3a'));
  c.sign(0, c.hd - 2.9, top - 1.4, 6, '#e0b040', 1);
}

function buildClassical(c: Ctx, wall: string, floors: number, tower: boolean): void {
  c.lot('#cdc8bb');
  const x0 = -c.hw + 1.5, x1 = c.hw - 1.5, z0 = -c.hd + 1.5, z1 = c.hd - 5;
  const top = c.block(x0, z0, x1, z1, 0.6, floors, wall, { door: true, band: shade(wall, -0.1).getStyle() });
  c.body.box(x0 - 0.6, 0, z0 - 0.6, x1 + 0.6, 0.6, z1 + 3.2, c.c('#d8d2c4')); // plinth & steps
  const pw = Math.min(x1 - x0 - 2, 12);
  c.columns(-pw / 2, pw / 2, z1 + 2, 0.6, top - 0.6, Math.max(4, Math.round(pw / 2)));
  c.body.box(-pw / 2 - 0.4, top, z1, pw / 2 + 0.4, top + 0.5, z1 + 2.7, c.c(wall));
  c.pediment(-pw / 2 - 0.4, pw / 2 + 0.4, z1, z1 + 2.7, top + 0.5, 1.8, shade(wall, 0.05).getStyle());
  c.flatRoof(x0, z0, x1, z1, top, '#8a8f96', 0.4);
  if (tower) { // clock tower with a flag
    const ty = c.block(-1.8, z0 + 1, 1.8, z0 + 4.6, top, 2, wall, { noWin: true });
    c.glow.cyl(0, ty - 3.2, z0 + 4.65, 1.0, 0.1, 12, c.c('#f4eedc'));
    c.body.pyramid(-2.1, 2.1, ty, ty + 2.6, z0 + 0.7, z0 + 4.9, c.c('#4a6a5a'));
    c.body.box(-0.05, ty + 2.6, z0 + 2.75, 0.05, ty + 6, z0 + 2.85, c.c('#666'));
    c.body.box(0.05, ty + 4.8, z0 + 2.75, 1.8, ty + 5.9, z0 + 2.8, c.c('#3a6ad0'));
    c.height = ty + 6;
  }
}

function buildCivicBlock(c: Ctx, wall: string, floors: number, accent: string): number {
  c.lot('#c8c4b8');
  const x0 = -c.hw + 1.2, x1 = c.hw - 1.2, z0 = -c.hd + 1.2, z1 = c.hd - 3;
  const top = c.block(x0, z0, x1, z1, 0.1, floors, wall, { door: true, band: accent });
  c.flatRoof(x0, z0, x1, z1, top);
  return top;
}

function buildIndustry(c: Ctx): void {
  c.lot('#8e8a82');
  c.winK = 1;
  const k = c.key;
  const wall = { steelworks: '#8a7a6a', sawmill: '#a8845a', brickworks: '#b0604a', textilemill: '#c8b8a0', cannery: '#a8b0b8', glassworks: '#9ab8c0', warehouse: '#a0a4a8', factory: '#b8a890' }[k as 'factory'] || '#a8a090';
  const x0 = -c.hw + 1, x1 = c.hw - 1, z0 = -c.hd + 1, z1 = c.hd - 3;
  const top = c.block(x0, z0, x1, z1, 0.1, 2, wall, { door: true, winGap: 3.4, floorH: 3.6 });
  // sawtooth north-light roof
  const n = Math.max(2, Math.floor((x1 - x0) / 4));
  const w = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    const a = x0 + i * w;
    c.body.quad([a, top, z1], [a + w, top, z1], [a + w, top + 2.2, z0], [a, top + 2.2, z0], c.c('#6a6e74'));
    c.body.tri([a + w, top, z1], [a + w, top, z0], [a + w, top + 2.2, z0], c.c(wall, -0.1));
    c.body.tri([a, top, z0], [a, top, z1], [a, top + 2.2, z0], c.c(wall, -0.1));
    // the glazed north face of each tooth
    c.win[1].quad([a + w, top, z0 - 0.02], [a, top, z0 - 0.02], [a, top + 2.2, z0 - 0.02], [a + w, top + 2.2, z0 - 0.02], hex('#ffffff'));
  }
  c.height = top + 2.2;
  if (k === 'steelworks' || k === 'factory' || k === 'brickworks' || k === 'glassworks') {
    c.smokestack(x1 - 2, z0 + 2.2, top + 10 + (c.hv % 6), 1.1);
    if (k === 'steelworks') c.smokestack(x1 - 5.5, z0 + 2.2, top + 13, 1.3);
  }
  if (k === 'sawmill') for (let i = 0; i < 4; i++) c.body.cyl(x0 + 2 + i * 0.9, 0.5, c.hd - 1.5, 0.45, 0.01, 6, c.c('#7a5a3a'));
  if (k === 'sawmill') c.body.box(x0 + 1, 0.1, c.hd - 2.5, x0 + 6, 1.2, c.hd - 0.6, c.c('#8a6a42'));
  if (k === 'warehouse') for (let x = x0 + 2; x < x1 - 2; x += 4) c.body.quad([x, 0.1, z1 + 0.07], [x + 3, 0.1, z1 + 0.07], [x + 3, 3.4, z1 + 0.07], [x, 3.4, z1 + 0.07], c.c('#7a7f86'));
  c.sign(0, z1 + 0.05, 5.2, Math.min(8, c.W - 4), '#e0b040', 0.8);
}

function buildPowerPlant(c: Ctx): void {
  c.lot('#8e8a82');
  c.winK = 2;
  const top = c.block(-c.hw + 1.5, 2, c.hw - 1.5, c.hd - 3, 0.1, 3, '#b8b0a4', { door: true, winGap: 3 });
  c.flatRoof(-c.hw + 1.5, 2, c.hw - 1.5, c.hd - 3, top);
  for (const x of [-7.5, 6.5]) { // cooling towers
    c.body.cyl(x, 0, -8, 6, 9, 14, c.c('#d8d4cc'), undefined, 4.2);
    c.body.cyl(x, 9, -8, 4.2, 7, 14, c.c('#d0ccc4'), c.c('#5a5a5a'), 5);
    c.solid(x - 6, -14, x + 6, -2);
  }
  c.smokestack(0, -3, 26, 1.1);
  c.height = 26;
}

function buildSchool(c: Ctx, college: boolean): void {
  if (college) { buildClassical(c, '#c8a888', 3, true); return; }
  c.lot('#b8b4a8');
  const top = c.block(-c.hw + 1, -c.hd + 1, c.hw - 1, c.hd - 6, 0.1, 2, '#d89a6a', { door: true, band: '#f0e6d0' });
  c.flatRoof(-c.hw + 1, -c.hd + 1, c.hw - 1, c.hd - 6, top, '#7a6a5a');
  c.body.box(-c.hw + 1, 0.1, c.hd - 6, c.hw - 1, 0.14, c.hd - 0.6, c.c('#8a5a4a')); // playground court
  c.body.box(c.hw - 3, 0.1, c.hd - 2, c.hw - 2.85, 8, c.hd - 1.85, c.c('#aaaaaa'));
  c.body.box(c.hw - 2.85, 6.6, c.hd - 1.95, c.hw - 1.0, 7.8, c.hd - 1.9, c.c('#3a6ad0'));
  c.sign(0, c.hd - 5.95, top - 1.5, 6, '#f2c230', 0.9);
}

function buildHospital(c: Ctx): void {
  c.winK = 2;
  const top = buildCivicBlock(c, '#eef2f4', 4, '#c8d4dc');
  c.glow.box(-1.6, top - 2.6, c.hd - 2.9, 1.6, top - 1.8, c.hd - 2.8, c.c('#e03030'));
  c.glow.box(-0.4, top - 3.8, c.hd - 2.9, 0.4, top - 0.6, c.hd - 2.8, c.c('#e03030'));
  c.body.cyl(c.hw - 6, top + 0.15, -c.hd + 6, 3.2, 0.1, 12, c.c('#5a5f66'));
  c.body.box(c.hw - 7, top + 0.27, -c.hd + 5.8, c.hw - 5, top + 0.3, -c.hd + 6.2, c.c('#f0f0f0'));
}

function buildPolice(c: Ctx): void {
  c.winK = 2;
  const top = buildCivicBlock(c, '#c8d2dc', 2, '#2a4a8a');
  c.sign(0, c.hd - 2.95, top - 1.3, 5, '#2a5ad0', 0.8);
  c.glow.box(-1.2, top + 0.2, -0.3, -0.4, top + 0.6, 0.3, c.c('#e03030'));
  c.glow.box(0.4, top + 0.2, -0.3, 1.2, top + 0.6, 0.3, c.c('#3060f0'));
}

function buildFireStation(c: Ctx): void {
  c.winK = 2;
  c.lot('#c8c4b8');
  const x0 = -c.hw + 1, x1 = c.hw - 1, z0 = -c.hd + 1, z1 = c.hd - 3;
  const top = c.block(x0, z0, x1, z1, 0.1, 2, '#c84a3a', { door: false, band: '#f0e0d0' });
  for (const x of [-6.5, -2, 2.5]) c.body.quad([x, 0.1, z1 + 0.07], [x + 3.6, 0.1, z1 + 0.07], [x + 3.6, 3.6, z1 + 0.07], [x, 3.6, z1 + 0.07], c.c('#e8e4dc'));
  c.door(8.5, z1, 0.1);
  c.flatRoof(x0, z0, x1, z1, top);
  c.block(x1 - 3.4, z0, x1, z0 + 3.4, top, 2, '#b84030', { noWin: true });
  c.height = top + 6.4;
}

function buildChurch(c: Ctx): void {
  c.lot('#bdb6a6');
  const x0 = -4, x1 = 4, z0 = -c.hd + 1.5, z1 = c.hd - 6;
  c.winK = 2;
  const top = c.block(x0, z0, x1, z1, 0.1, 2, '#e8e0d0', { door: false, noWin: true });
  // tall stained-glass windows down both sides
  for (let z = z0 + 2; z < z1 - 1; z += 3) {
    c.win[2].quad([x0 - 0.05, 2, z], [x0 - 0.05, 2, z + 1.2], [x0 - 0.05, 5.4, z + 1.2], [x0 - 0.05, 5.4, z], hex('#ffffff'));
    c.win[2].quad([x1 + 0.05, 2, z + 1.2], [x1 + 0.05, 2, z], [x1 + 0.05, 5.4, z], [x1 + 0.05, 5.4, z + 1.2], hex('#ffffff'));
  }
  c.gable(x0, z0, x1, z1, top, 4, '#5a4a4a', '#e8e0d0', false);
  // the steeple over the door
  const sy = c.block(-2, z1 - 3.6, 2, z1 + 0.4, 0.1, 5, '#e8e0d0', { noWin: true });
  c.door(0, z1 + 0.4, 0.1, '#6a3a2a', 1.6, 2.8);
  c.body.cone(0, sy, z1 - 1.6, 2.4, 9, 4, c.c('#4a4a5a'));
  c.body.box(-0.08, sy + 9, z1 - 1.68, 0.08, sy + 11, z1 - 1.52, c.c('#d0b040'));
  c.body.box(-0.7, sy + 10, z1 - 1.68, 0.7, sy + 10.16, z1 - 1.52, c.c('#d0b040'));
  c.height = sy + 11;
}

function buildTemple(c: Ctx): void {
  c.lot('#d8cdb2');
  const top = c.block(-c.hw + 3, -c.hd + 2, c.hw - 3, c.hd - 4, 0.6, 1, '#f0dcb0', { door: true });
  c.body.box(-c.hw + 2, 0, -c.hd + 1, c.hw - 2, 0.6, c.hd - 2, c.c('#e0d0b0'));
  // tiered roofs with a golden finial
  let y = top, inset = 2.6;
  for (let t = 0; t < 3; t++) {
    c.body.pyramid(-c.hw + inset - 1, c.hw - inset + 1, y, y + 1.6, -c.hd + 1.2 + t * 0.9, c.hd - 3.2 - t * 0.9, c.c('#b83a2a'), 2);
    y += 1.4; inset += 1.4;
  }
  c.body.cyl(0, y, -0.5, 0.35, 2.6, 6, c.c('#e0b040'), undefined, 0.05);
  c.height = y + 2.6;
}

function buildPark(c: Ctx, grand: boolean, plaza: boolean): void {
  const winter = Weather.season === 3;
  c.lot(plaza ? '#cfc8b8' : winter ? '#e6ecf2' : '#7cbc58', 0.05);
  const pathC = c.c(plaza ? '#bdb5a2' : '#d8c9a2');
  c.body.box(-0.9, 0.1, -c.hd + 0.2, 0.9, 0.14, c.hd - 0.2, pathC);
  c.body.box(-c.hw + 0.2, 0.1, -0.9, c.hw - 0.2, 0.14, 0.9, pathC);
  const fountain = plaza || grand;
  if (fountain) {
    c.body.cyl(0, 0.1, 0, 3, 0.7, 14, c.c('#bdb8ac'));
    c.body.cyl(0, 0.75, 0, 2.6, 0.02, 14, c.c(winter ? '#dde8f0' : '#5a9ad8'));
    c.body.cyl(0, 0.7, 0, 0.4, 2.2, 8, c.c('#bdb8ac'));
    c.body.cyl(0, 2.6, 0, 1.0, 0.25, 10, c.c('#bdb8ac'));
  }
  const n = grand ? 14 : plaza ? 4 : 6;
  for (let i = 0; i < n; i++) {
    const h = hash2(c.hv, i);
    // (V2: unsigned: a signed shift threw half the park's trees out of the park, onto the road)
    const x = ((h % 1000) / 1000 - 0.5) * (c.W - 6), z = (((h >>> 10) % 1000) / 1000 - 0.5) * (c.D - 6);
    if (Math.abs(x) < 2.5 || Math.abs(z) < 2.5) continue;
    if (plaza) {
      c.body.cyl(x, 0.1, z, 1.2, 0.8, 8, c.c('#8a8478'));
      c.tree(x, z, 0.7);
    }
    else c.tree(x, z, 0.9 + (h % 5) / 10);
  }
  c.bench(3, 2.4, Math.PI); c.bench(-3, -2.4, 0); c.bench(2.4, -3, Math.PI / 2);
  if (grand && !winter) c.body.cyl(c.hw - 9, 0.1, c.hd - 8, 4, 0.05, 12, c.c('#5a9ad8'));
  c.height = 6;
}

function buildPlayground(c: Ctx): void {
  c.lot('#d8b884', 0.1);
  c.body.box(-6, 0, -1.5, -5.8, 2.6, -1.3, c.c('#c03a3a')).box(-2, 0, -1.5, -1.8, 2.6, -1.3, c.c('#c03a3a'));
  c.body.box(-6, 2.5, -1.5, -1.8, 2.7, -1.3, c.c('#c03a3a'));
  c.body.box(-4.6, 0.6, -1.6, -3.4, 0.7, -1.2, c.c('#3a3a3a'));
  c.body.box(1, 0, 1, 3, 2.2, 3, c.c('#3a8ad0'));
  c.body.quad([3, 2.2, 1], [3, 2.2, 3], [6.5, 0.1, 3], [6.5, 0.1, 1], c.c('#f2c230'));
  c.body.quad([6.5, 0.1, 1], [6.5, 0.1, 3], [3, 2.2, 3], [3, 2.2, 1], c.c('#f2c230'));
  c.body.cyl(-3, 0.1, 4, 2, 0.4, 10, c.c('#e8d8a8'));
  c.height = 3;
}

function buildPool(c: Ctx): void {
  c.lot('#dfe6ea', 0.1);
  c.body.box(-c.hw + 2, 0.1, -c.hd + 2, c.hw - 2, 0.12, c.hd - 2, c.c(Weather.season === 3 ? '#cfe0ec' : '#3aa0e0'));
  c.fence(-c.hw + 0.3, -c.hd + 0.3, c.hw - 0.3, c.hd - 0.3, '#c8ccd0', 1.2);
  c.body.box(c.hw - 4, 0.1, -c.hd + 1, c.hw - 1, 3, -c.hd + 3.5, c.c('#e6e2d6'));
  c.height = 3;
}

function buildStadium(c: Ctx): void {
  c.lot('#9a968e', 0.1);
  const W = c.W - 4, D = c.D - 4;
  c.body.box(-W / 2 + 7, 0.1, -D / 2 + 7, W / 2 - 7, 0.16, D / 2 - 7, c.c('#4aa04a'));
  c.body.box(-0.1, 0.16, -D / 2 + 7, 0.1, 0.18, D / 2 - 7, c.c('#ffffff'));
  // stepped stands all the way round
  for (let s = 0; s < 4; s++) {
    const o = 7 - s * 1.6, y = 1 + s * 2.4;
    const col = c.c(s % 2 ? '#c8c4bc' : '#b0aca4');
    c.body.box(-W / 2 + o - 1.6, 0, -D / 2 + o - 1.6, W / 2 - o + 1.6, y, -D / 2 + o, col);
    c.body.box(-W / 2 + o - 1.6, 0, D / 2 - o, W / 2 - o + 1.6, y, D / 2 - o + 1.6, col);
    c.body.box(-W / 2 + o - 1.6, 0, -D / 2 + o, -W / 2 + o, y, D / 2 - o, col);
    c.body.box(W / 2 - o, 0, -D / 2 + o, W / 2 - o + 1.6, y, D / 2 - o, col);
  }
  for (const [x, z] of [[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2]]) {
    c.body.box(x - 0.3, 0, z - 0.3, x + 0.3, 22, z + 0.3, c.c('#888'));
    c.glow.box(x - 1.4, 21, z - 1.4, x + 1.4, 22.5, z + 1.4, c.c('#fff6d0'));
  }
  c.solid(-W / 2 + 0.4, -D / 2 + 0.4, W / 2 - 0.4, -D / 2 + 7);
  c.solid(-W / 2 + 0.4, D / 2 - 7, W / 2 - 0.4, D / 2 - 0.4);
  c.height = 22.5;
}

function buildAmusement(c: Ctx): void {
  c.lot('#cfc0a0', 0.1);
  // the ferris wheel
  const R = 11, cx = -c.hw + 15, cz = -4, cy = R + 2;
  const rim = c.c('#e04a8a');
  for (let i = 0; i < 16; i++) {
    const a0 = (i / 16) * Math.PI * 2, a1 = ((i + 1) / 16) * Math.PI * 2;
    const p0 = [cx + Math.cos(a0) * R, cy + Math.sin(a0) * R], p1 = [cx + Math.cos(a1) * R, cy + Math.sin(a1) * R];
    c.body.box(Math.min(p0[0], p1[0]) - 0.15, Math.min(p0[1], p1[1]) - 0.15, cz - 0.15, Math.max(p0[0], p1[0]) + 0.15, Math.max(p0[1], p1[1]) + 0.15, cz + 0.15, rim);
    c.glow.box(p0[0] - 0.6, p0[1] - 1.6, cz - 0.6, p0[0] + 0.6, p0[1] - 0.6, cz + 0.6, c.c(['#ffd040', '#40c0ff', '#ff6060', '#80ff90'][i % 4]));
  }
  c.body.box(cx - 2, 0, cz - 0.4, cx - 1.5, cy, cz + 0.4, c.c('#888')).box(cx + 1.5, 0, cz - 0.4, cx + 2, cy, cz + 0.4, c.c('#888'));
  c.solid(cx - 2.5, cz - 1, cx + 2.5, cz + 1);
  // a coaster loop and a carousel
  const lx = c.hw - 12, lz = -6;
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    c.body.boxC(lx + Math.cos(a) * 5, 6 + Math.sin(a) * 5, lz, 1.2, 1.2, 1.4, c.c('#3a8ad0'));
  }
  c.body.box(lx - 9, 0, lz - 0.5, lx + 9, 1.2, lz + 0.5, c.c('#3a8ad0'));
  c.body.cyl(4, 0.1, 8, 4, 0.5, 12, c.c('#f2c230'));
  c.body.cyl(4, 0.6, 8, 0.3, 3.4, 6, c.c('#ffffff'));
  c.body.cone(4, 4, 8, 4.4, 2.2, 12, c.c('#e04040'));
  c.height = cy + R + 1;
}

function buildZoo(c: Ctx): void {
  c.lot(Weather.season === 3 ? '#e6ecf2' : '#8cc062', 0.05);
  for (let i = 0; i < 4; i++) {
    const x = -c.hw + 3 + (i % 2) * (c.W / 2 - 1), z = -c.hd + 3 + Math.floor(i / 2) * (c.D / 2 - 2);
    c.fence(x, z, x + c.W / 2 - 5, z + c.D / 2 - 5, '#7a5a3a', 1.4);
    c.tree(x + 3, z + 3, 0.8);
  }
  c.body.box(-3, 0.1, c.hd - 4, 3, 3.2, c.hd - 1, c.c('#a07a4a'));
  c.sign(0, c.hd - 0.95, 3.3, 5, '#3a8a3a', 0.9);
  c.solid(-3, c.hd - 4, 3, c.hd - 1);
  c.height = 5;
}

function buildFarm(c: Ctx): void {
  const season = Weather.season;
  const crop = ['#8ab84a', '#c8b040', '#c88a3a', '#e6ecf2'][season];
  c.lot('#9a7a52', 0.05);
  for (let x = -c.hw + 1; x < c.hw - 18; x += 2.2) c.body.box(x, 0.05, -c.hd + 1, x + 1.4, season === 3 ? 0.12 : 0.6, c.hd - 1, c.c(crop, (x % 3) * 0.02));
  const bx0 = c.hw - 15, bx1 = c.hw - 6, bz0 = -c.hd + 3, bz1 = 2;
  const top = c.block(bx0, bz0, bx1, bz1, 0.1, 1, '#b83a2a', { door: true, noWin: true, floorH: 5 });
  c.gable(bx0, bz0, bx1, bz1, top, 4, '#6a6a6a', '#b83a2a', false);
  c.body.cyl(c.hw - 3, 0.1, -6, 2.0, 11, 10, c.c('#c8ccd0'));
  c.body.cyl(c.hw - 3, 11.1, -6, 2.0, 1.6, 10, c.c('#9aa0a8'), undefined, 0.3);
  c.solid(c.hw - 5, -8, c.hw - 1, -4);
  c.height = 12.7;
}

function buildTrainStation(c: Ctx): void {
  c.lot('#b8b2a4', 0.05);
  const top = c.block(-9, -c.hd + 1.5, 9, c.hd - 4, 0.1, 2, '#d8c4a4', { door: true, band: '#b89a7a' });
  c.gable(-9, -c.hd + 1.5, 9, c.hd - 4, top, 3, '#8a5a4a', '#d8c4a4', true);
  c.glow.cyl(0, top - 0.8, c.hd - 3.95, 1.0, 0.1, 12, c.c('#f4eedc'));
  c.sign(0, c.hd - 3.95, top - 2.6, 7, '#2a4a8a', 0.8);
  // long platforms with canopies off each end
  for (const sx of [-1, 1]) {
    c.body.box(sx * 9, 0.1, -c.hd + 3, sx * (c.hw - 0.3), 1.0, c.hd - 6, c.c('#c8c0b0'));
    c.body.box(sx * 9, 4, -c.hd + 3, sx * (c.hw - 0.3), 4.2, c.hd - 6, c.c('#5a6a7a'));
    for (let x = 10; x < c.hw - 1; x += 4) c.body.box(sx * x - 0.15, 1, -c.hd + 4.5, sx * x + 0.15, 4, -c.hd + 4.8, c.c('#555'));
  }
}

function buildDock(c: Ctx): void {
  c.lot('#a89a80', 0.05);
  // the pier runs out past the plot edge over the water side
  c.body.box(-c.hw + 1, 0.3, -c.hd + 0.5, c.hw - 1, 0.7, c.hd - 0.5, c.c('#8a6a4a'));
  for (let x = -c.hw + 2; x < c.hw - 1; x += 3) for (const z of [-c.hd + 1, c.hd - 1]) c.body.cyl(x, -2, z, 0.25, 3, 6, c.c('#6a4a2a'));
  c.body.box(c.hw - 5, 0.7, -c.hd + 2, c.hw - 4.4, 9, -c.hd + 2.6, c.c('#e0a020'));
  c.body.box(c.hw - 9, 8.6, -c.hd + 2, c.hw - 4.4, 9, -c.hd + 2.6, c.c('#e0a020'));
  c.body.box(-c.hw + 2, 0.7, -2, -c.hw + 8, 3.6, 2, c.c('#c86a4a'));
  c.solid(-c.hw + 2, -2, -c.hw + 8, 2);
  c.height = 9;
}

function buildHeliport(c: Ctx): void {
  c.lot('#9aa0a8', 0.05);
  c.body.cyl(0, 0.1, 0, 12, 0.3, 16, c.c('#5a5f66'));
  c.body.box(-3, 0.4, -4, -1.6, 0.42, 4, c.c('#f0f0f0')).box(1.6, 0.4, -4, 3, 0.42, 4, c.c('#f0f0f0')).box(-1.6, 0.4, -0.7, 1.6, 0.42, 0.7, c.c('#f0f0f0'));
  const top = c.block(c.hw - 7, c.hd - 7, c.hw - 1.5, c.hd - 1.5, 0.1, 3, '#c8ccd0', { door: false });
  c.flatRoof(c.hw - 7, c.hd - 7, c.hw - 1.5, c.hd - 1.5, top);
  c.glow.box(c.hw - 4.6, top + 0.5, c.hd - 4.6, c.hw - 3.8, top + 1.3, c.hd - 3.8, c.c('#ff4040'));
}

function buildAirport(c: Ctx): void {
  c.lot('#7f9a5c', 0.05); // (grass between the paved areas)
  // V2 (Milestone 6): a real airfield (the layout is Life.airfield's): a long runway along the south edge,
  // a parallel taxiway with links at both ends, and an apron with four stands in front of the terminal
  const rz = c.hd - 12, tw = c.hd - 32, dark = c.c('#3a3d44'), conc = c.c('#a4a7ad');
  c.body.box(-c.hw + 2, 0.1, rz - 7, c.hw - 2, 0.14, rz + 7, dark);
  for (let x = -c.hw + 14; x < c.hw - 14; x += 14) c.body.box(x, 0.14, rz - 0.3, x + 7, 0.16, rz + 0.3, c.c('#f0f0f0'));
  for (const sx of [-1, 1]) for (let k = 0; k < 6; k++) c.body.box(sx * (c.hw - 9) - 1, 0.14, rz - 6 + k * 2.2, sx * (c.hw - 9) + 1, 0.16, rz - 5 + k * 2.2, c.c('#f0f0f0')); // threshold bars
  for (let x = -c.hw + 4; x < c.hw - 3; x += 12) for (const z of [rz - 7.2, rz + 7.2]) c.glow.box(x - 0.2, 0.14, z - 0.2, x + 0.2, 0.42, z + 0.2, c.c(z < rz ? '#80c0ff' : '#ffd060'));
  c.body.box(-c.hw + 20, 0.1, tw - 4, c.hw - 20, 0.13, tw + 4, dark);
  for (const sx of [-1, 1]) c.body.box(sx * (c.hw - 24) - 4, 0.1, tw, sx * (c.hw - 24) + 4, 0.13, rz, dark);
  for (let x = -c.hw + 22; x < c.hw - 22; x += 6) c.body.box(x, 0.13, tw - 0.15, x + 3, 0.15, tw + 0.15, c.c('#e8c040'));
  // the apron and its stands (an airliner spans 30 m: the stands are 45 m apart)
  c.body.box(-c.hw + 66, 0.1, -c.hd + 26, -c.hw + 252, 0.12, tw - 4, conc);
  for (let k = 0; k < 4; k++) {
    const sx = -c.hw + 92 + k * 45;
    c.body.box(sx - 0.2, 0.12, -c.hd + 30, sx + 0.2, 0.14, tw - 5, c.c('#e8c040'));
    c.body.box(sx - 16, 0.12, -c.hd + 28, sx + 16, 0.14, -c.hd + 28.4, c.c('#e8c040'));
  }
  const top = c.block(-c.hw + 6, -c.hd + 3, -c.hw + 64, -c.hd + 22, 0.1, 2, '#d8dde2', { door: true, glass: true, winGap: 3, floorH: 4 });
  c.body.box(-c.hw + 5, top, -c.hd + 2, -c.hw + 65, top + 1.2, -c.hd + 23, c.c('#e8ecf0'));
  // control tower
  const tx = -c.hw + 72, tz = -c.hd + 10;
  c.body.cyl(tx, 0, tz, 2, 24, 8, c.c('#d8dde2'));
  c.win[2].cyl(tx, 24, tz, 3.4, 3, 8, hex('#ffffff'));
  c.body.cyl(tx, 27, tz, 3.6, 0.6, 8, c.c('#5a6068'));
  c.solid(tx - 2, tz - 2, tx + 2, tz + 2);
  c.height = 28;
}

function buildGas(c: Ctx): void {
  c.lot('#8f9298', 0.05);
  c.body.box(-6.5, 5, -3, 6.5, 5.7, 3.5, c.c('#e8e8e8'));
  c.glow.box(-6.6, 5, 3.5, 6.6, 5.6, 3.6, c.c('#d0302a'));
  for (const x of [-4, 4]) { c.body.box(x - 0.3, 0.1, -0.3, x + 0.3, 5, 0.3, c.c('#cccccc')); c.body.box(x - 0.5, 0.1, 0.8, x + 0.5, 1.6, 1.4, c.c('#d0302a')); }
  c.block(-c.hw + 1, -c.hd + 1, 0, -c.hd + 5, 0.1, 1, '#f0ece4', { door: true });
  c.flatRoof(-c.hw + 1, -c.hd + 1, 0, -c.hd + 5, 3.3);
  c.height = 6;
}

function buildBusStop(c: Ctx): void {
  c.lot('#b8b5ac', 0.1);
  c.body.box(-3, 0.1, -1.3, 3, 2.6, -1.15, c.c('#9ec6e0'));
  c.body.box(-3.2, 2.6, -1.4, 3.2, 2.8, 1.2, c.c('#3a5a8a'));
  for (const x of [-3, 3]) c.body.box(x - 0.08, 0.1, -1.3, x + 0.08, 2.6, 1.0, c.c('#555'));
  c.body.box(-2, 0.1, -1.0, 2, 0.55, -0.6, c.c('#8a5a3a'));
  c.body.box(4.6, 0.1, 1.6, 4.75, 2.8, 1.75, c.c('#777'));
  c.glow.box(4.2, 2.6, 1.5, 5.1, 3.3, 1.9, c.c('#2a8ad0'));
  c.height = 3.3;
}

function buildTaxiStand(c: Ctx): void {
  c.lot('#b8b5ac', 0.1);
  c.body.box(-2, 0.1, -1.6, 0.5, 2.6, 0.5, c.c('#f2c230'));
  c.body.box(-2.2, 2.6, -1.8, 0.7, 2.8, 0.7, c.c('#3a3a3a'));
  c.glow.box(1.8, 2.4, 1.2, 3.6, 3.0, 1.5, c.c('#f2c230'));
  c.body.box(2.6, 0.1, 1.3, 2.75, 2.4, 1.45, c.c('#777'));
  c.solid(-2, -1.6, 0.5, 0.5);
  c.height = 3;
}

function buildCasino(c: Ctx): void {
  const top = buildCivicBlock(c, '#3a2a4a', 3, '#e0b040');
  c.sign(0, c.hd - 2.95, top - 2.6, Math.min(12, c.W - 4), '#ff40c0', 1.4);
  let k = 0;
  for (let x = -c.hw + 2; x < c.hw - 2; x += 1.2) c.glow.box(x, top - 0.25, c.hd - 3, x + 0.4, top + 0.15, c.hd - 2.85, c.c(['#ffd040', '#ff40c0', '#40e0ff'][k++ % 3]));
}

function buildShowroom(c: Ctx): void {
  c.lot('#8f9298');
  c.winK = 1;
  const top = c.block(-c.hw + 1, -c.hd + 1, c.hw - 1, c.hd - 4, 0.1, 1, '#dfe6ee', { door: true, glass: true, winGap: 3, floorH: 4.6 });
  c.flatRoof(-c.hw + 1, -c.hd + 1, c.hw - 1, c.hd - 4, top, '#5a6068');
  c.sign(0, c.hd - 3.95, top - 1.2, 10, '#c0392b', 1);
}

function buildTV(c: Ctx): void {
  const top = buildCivicBlock(c, '#c8ccd8', 3, '#3a3a6a');
  c.sign(0, c.hd - 2.95, top - 1.3, 6, '#e03a3a', 0.9);
  // lattice mast with a blinking tip
  const mx = c.hw - 4, mz = -c.hd + 4;
  for (let i = 0; i < 8; i++) {
    const y = top + i * 3, w = 1.6 - i * 0.16;
    c.body.box(mx - w, y, mz - w, mx - w + 0.15, y + 3, mz - w + 0.15, c.c('#c03030'));
    c.body.box(mx + w - 0.15, y, mz - w, mx + w, y + 3, mz - w + 0.15, c.c('#c03030'));
    c.body.box(mx - w, y, mz + w - 0.15, mx - w + 0.15, y + 3, mz + w, c.c('#e8e8e8'));
    c.body.box(mx + w - 0.15, y, mz + w - 0.15, mx + w, y + 3, mz + w, c.c('#e8e8e8'));
  }
  c.glow.boxC(mx, top + 24.4, mz, 0.6, 0.6, 0.6, c.c('#ff3030'));
  c.height = top + 25;
}

function buildWaterTower(c: Ctx): void {
  c.lot('#a8a49a', 0.1);
  for (const [x, z] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) c.body.box(x - 0.2, 0, z - 0.2, x + 0.2, 12, z + 0.2, c.c('#7a7f86'));
  c.body.cyl(0, 12, 0, 3.6, 4.5, 12, c.c('#5a8ab8'), undefined, 3.6);
  c.body.cone(0, 16.5, 0, 3.8, 1.8, 12, c.c('#3a5a7a'));
  c.body.box(-c.hw + 1, 0.1, c.hd - 4, -c.hw + 4.5, 2.8, c.hd - 1, c.c('#c8c0b0'));
  c.solid(-2.4, -2.4, 2.4, 2.4);
  c.height = 18.3;
}

function buildBoatClub(c: Ctx): void {
  c.lot('#c8b890', 0.05);
  const top = c.block(-c.hw + 1.5, -c.hd + 1.5, 2, c.hd - 3, 0.1, 1, '#f0f0f0', { door: true });
  c.gable(-c.hw + 1.5, -c.hd + 1.5, 2, c.hd - 3, top, 2.2, '#2a6a9a', '#f0f0f0', true);
  c.body.box(3, 0.4, -c.hd + 0.5, c.hw - 0.5, 0.7, -c.hd + 2.5, c.c('#8a6a4a'));
  c.sign(-3, c.hd - 2.95, 2.4, 4, '#2a6a9a', 0.7);
}

function buildLodge(c: Ctx): void {
  c.lot('#86b862', 0.2);
  c.fence(-c.hw + 0.35, -c.hd + 0.35, c.hw - 0.35, c.hd - 0.35, '#6a4a2a');
  const x0 = -c.hw + 2, x1 = c.hw - 2, z0 = -c.hd + 1.8, z1 = c.hd - 4;
  // a log cabin: stacked log courses, a deep porch, a lantern
  for (let y = 0.1; y < 3.4; y += 0.42) c.body.box(x0 - 0.2, y, z0 - 0.2, x1 + 0.2, y + 0.38, z1 + 0.2, c.c('#7a5232', ((y * 10) % 3) * 0.03));
  c.solid(x0, z0, x1, z1);
  c.door(0, z1 + 0.2, 0.1, '#3a2414');
  c.win[0].quad([x0 + 1, 1.2, z1 + 0.25], [x0 + 2.4, 1.2, z1 + 0.25], [x0 + 2.4, 2.4, z1 + 0.25], [x0 + 1, 2.4, z1 + 0.25], hex('#fff'));
  c.win[0].quad([x1 - 2.4, 1.2, z1 + 0.25], [x1 - 1, 1.2, z1 + 0.25], [x1 - 1, 2.4, z1 + 0.25], [x1 - 2.4, 2.4, z1 + 0.25], hex('#fff'));
  c.gable(x0 - 0.2, z0 - 0.2, x1 + 0.2, z1 + 1.8, 3.5, 2.8, '#3a4a3a', '#7a5232', true);
  c.body.box(x0, 0.1, z1, x1, 0.4, z1 + 1.8, c.c('#8a6a42'));
  for (const x of [x0 + 0.3, x1 - 0.3]) c.body.box(x - 0.15, 0.4, z1 + 1.5, x + 0.15, 3.5, z1 + 1.8, c.c('#6a4a2a'));
  c.chimney(x1 - 1.2, z0 + 1.2, 3.5, 3.4, 0.55, '#7a7a7a');
  c.glow.boxC(1.4, 2.6, z1 + 0.35, 0.3, 0.45, 0.3, c.c('#ffcf70'));
  c.sign(0, z1 + 1.85, 3.9, 3.2, '#c9a64a', 0.5);
}

/* ---------- dispatch ---------- */
export function buildFor(b: any, kit?: Kit): Built {
  const key = b.type;
  const c = new Ctx(b, key, kit);
  c.winK = 0;
  switch (key) {
    case 'house': case 'cottage': buildHouse(c, key === 'house' ? b.level || 1 : 1); break;
    case 'house2': buildHouse(c, 2); break;
    case 'house3': buildHouse(c, 3); break;
    case 'mansion': buildMansion(c); break;
    case 'apartment': buildApartment(c); break;
    case 'rowhouse': buildRowhouse(c); break;
    case 'lodge': buildLodge(c); break;
    case 'office': buildOffice(c, false); break;
    case 'skyscraper': buildOffice(c, true); break;
    case 'factory': case 'steelworks': case 'sawmill': case 'brickworks': case 'textilemill':
    case 'cannery': case 'glassworks': case 'warehouse': buildIndustry(c); break;
    case 'powerplant': buildPowerPlant(c); break;
    case 'farm': buildFarm(c); break;
    case 'airport': buildAirport(c); break;
    case 'market': buildMarket(c, false); break;
    case 'deptstore': buildDeptStore(c, false); break;
    case 'mall': buildDeptStore(c, true); break;
    case 'hotel': buildHotel(c); break;
    case 'bank': buildClassical(c, '#e2dccc', 2, false); break;
    case 'exchange': buildClassical(c, '#d8d2c2', 3, false); break;
    case 'museum': buildClassical(c, '#e6e0d0', 2, false); break;
    case 'library': buildClassical(c, '#d4c0a0', 2, false); break;
    case 'courthouse': buildClassical(c, '#e8e2d4', 3, false); break;
    case 'townhall': buildClassical(c, '#e0d6c0', 2, true); break;
    case 'theater': buildClassical(c, '#c8786a', 2, false); c.sign(0, c.hd - 2.2, 4.6, 7, '#ffd040', 1); break;
    case 'cinema': { const t = buildCivicBlock(c, '#5a4a7a', 3, '#e0b040'); c.sign(0, c.hd - 2.95, t - 2.4, Math.min(9, c.W - 3), '#ff5050', 1.3); c.body.box(-4, 3, c.hd - 3, 4, 3.3, c.hd - 0.8, c.c('#e0b040')); break; }
    case 'gym': { const t = buildCivicBlock(c, '#c8d0d8', 2, '#e05a2a'); c.sign(0, c.hd - 2.95, t - 1.2, 4, '#e05a2a', 0.7); break; }
    case 'gas': buildGas(c); break;
    case 'school': buildSchool(c, false); break;
    case 'college': buildSchool(c, true); break;
    case 'hospital': buildHospital(c); break;
    case 'police': buildPolice(c); break;
    case 'fire': buildFireStation(c); break;
    case 'church': buildChurch(c); break;
    case 'temple': buildTemple(c); break;
    case 'park': buildPark(c, false, false); break;
    case 'grandpark': buildPark(c, true, false); break;
    case 'plaza': buildPark(c, false, true); break;
    case 'playground': buildPlayground(c); break;
    case 'pool': buildPool(c); break;
    case 'stadium': buildStadium(c); break;
    case 'amusement': buildAmusement(c); break;
    case 'zoo': buildZoo(c); break;
    case 'casino': buildCasino(c); break;
    case 'carshowroom': buildShowroom(c); break;
    case 'tvstation': buildTV(c); break;
    case 'watertower': buildWaterTower(c); break;
    case 'trainstation': buildTrainStation(c); break;
    case 'dock': buildDock(c); break;
    case 'heliport': buildHeliport(c); break;
    case 'busstop': buildBusStop(c); break;
    case 'taxistand': buildTaxiStand(c); break;
    case 'boatclub': buildBoatClub(c); break;
    default:
      if (FAST_FOOD[key]) buildFastFood(c);
      else buildShop(c);
  }
  if (OPEN.has(key)) {
    c.solids = c.solids.filter((s) => (s[2] - s[0]) * (s[3] - s[1]) < 60);
    c.cam = c.cam.filter((s) => (s[3]! - s[0]!) * (s[5]! - s[2]!) < 60);
  }
  return c;
}

/* ---------- ruins & construction props ---------- */
function rubble(kit: Kit, b: any): void {
  const W = b.w * TM, D = b.h * TM;
  kit.box('gravel', -W / 2 + 0.3, 0, -D / 2 + 0.3, W / 2 - 0.3, 0.14, D / 2 - 0.3, new THREE.Color(0.55, 0.52, 0.5));
  for (let i = 0; i < 18; i++) {
    const h = hash2(b.id, i);
    // (V2: unsigned shifts: signed, half the rubble landed off the plot, some of it in the street)
    const x = ((h % 1000) / 1000 - 0.5) * (W - 3), z = (((h >>> 10) % 1000) / 1000 - 0.5) * (D - 3);
    const s = 0.5 + ((h >>> 20) % 10) / 6;
    const g = new THREE.BoxGeometry(s * 1.4, s, s);
    g.rotateY((h % 628) / 100).rotateZ(((h >>> 4) % 60) / 100);
    g.translate(x, s / 2, z);
    kit.add(i % 3 ? 'brickBrown' : 'stone', g, new THREE.Color(0.6, 0.55, 0.5));
  }
  // a gable end still standing, blackened
  kit.box('brickBrown', -W / 2 + 1, 0, -D / 2 + 1, -W / 2 + 1.4, 4.5, -D / 2 + 3.5, new THREE.Color(0.35, 0.32, 0.3));
}
function scaffold(kit: Kit, W: number, D: number, H: number): void {
  const pole = new THREE.Color(0.7, 0.72, 0.74), plank = new THREE.Color(0.8, 0.68, 0.5);
  const x0 = -W / 2 + 0.4, x1 = W / 2 - 0.4, z0 = -D / 2 + 0.4, z1 = D / 2 - 0.4;
  const tube = (ax: number, az: number): void => kit.cylinder('metal', 0.03, 0.03, H, 6, at(null, ax, H / 2, az), pole);
  for (let x = x0; x <= x1 + 0.01; x += Math.max(2, (x1 - x0) / Math.ceil((x1 - x0) / 2.6))) for (const z of [z0, z1]) tube(x, z);
  for (let z = z0; z <= z1 + 0.01; z += Math.max(2, (z1 - z0) / Math.ceil((z1 - z0) / 2.6))) for (const x of [x0, x1]) tube(x, z);
  for (let y = 2; y < H; y += 2.0) {
    kit.box('timber', x0, y, z0 - 0.3, x1, y + 0.05, z0 + 0.3, plank);
    kit.box('timber', x0, y, z1 - 0.3, x1, y + 0.05, z1 + 0.3, plank);
    kit.box('timber', x0 - 0.3, y, z0, x0 + 0.3, y + 0.05, z1, plank);
    kit.box('timber', x1 - 0.3, y, z0, x1 + 0.3, y + 0.05, z1, plank);
    for (const z of [z0 - 0.3, z1 + 0.3]) kit.rod('metal', V(x0, y + 1, z), V(x1, y + 1, z), 0.025, pole, 5);
  }
}
/* V2: a tower crane that reads as one from anywhere: a lattice mast on a concrete footing, the slewing unit and the
   operator's cab on top of it, a lattice jib and counter-jib held by tie rods from an A-frame, concrete
   counterweights, and a trolley with its hoist ropes and hook block. (It was a thin mast that all but vanished at a
   distance, a plank of a jib, and a grey box and a glass box hung on it: from the street they looked like boxes
   floating in the sky.) */
function crane(kit: Kit, H: number, W: number, ox: number, oz: number): void {
  const y = new THREE.Color(0.95, 0.68, 0.12), dark = new THREE.Color(0.16, 0.17, 0.18), grey = new THREE.Color(0.3, 0.31, 0.32);
  const conc = new THREE.Color(0.66, 0.64, 0.6);
  // (turned so the jib reaches back over the site from the mast at its corner)
  const m = new THREE.Matrix4().makeTranslation(ox, 0, oz).multiply(new THREE.Matrix4().makeRotationY(Math.PI));
  const save = kit.base.clone();
  kit.base = save.clone().multiply(m);
  const bar = (a: THREE.Vector3, b: THREE.Vector3, r = 0.045, c = y): void => kit.rod('paint', a, b, r, c, 4);
  // footing and lattice mast: four chords, braced on every face
  kit.box('stone', -1.6, 0, -1.6, 1.6, 0.6, 1.6, conc);
  const M = 0.8, step = 2;
  for (const [x, z] of [[-M, -M], [M, -M], [-M, M], [M, M]]) kit.box('paint', x - 0.09, 0.6, z - 0.09, x + 0.09, H, z + 0.09, y);
  const faces: [number, number, number, number][] = [[-M, -M, M, -M], [M, -M, M, M], [M, M, -M, M], [-M, M, -M, -M]];
  for (let h = 0.6, i = 0; h < H - 0.1; h += step, i++) {
    const h1 = Math.min(H, h + step);
    for (const [ax, az, bx, bz] of faces) {
      bar(V(ax, h, az), V(bx, h, bz));
      if (i % 2) bar(V(ax, h, az), V(bx, h1, bz)); else bar(V(bx, h, bz), V(ax, h1, az));
    }
  }
  // slewing unit, and the cab beside the root of the jib
  const T = H + 0.9; // the jib's underside
  kit.box('paint', -1.1, H, -1.1, 1.1, T, 1.1, grey);
  kit.box('paint', 0.15, H - 1.3, 1.1, 1.75, T + 0.2, 2.6, y);
  kit.box('glassPlain', 0.1, H - 1.0, 2.6, 1.8, T - 0.05, 2.66);
  kit.box('glassPlain', 1.75, H - 1.0, 1.25, 1.81, T - 0.05, 2.5);
  // the jib: a triangular lattice, its top chord falling towards the tip
  const L = Math.max(14, W * 0.85), h0 = 1.6, h1 = 0.7, zj = 0.6;
  const top = (x: number): number => T + h0 + (h1 - h0) * ((x - 1.1) / (L - 1.1));
  for (const z of [-zj, zj]) kit.box('paint', 1.1, T, z - 0.08, L, T + 0.16, z + 0.08, y);
  bar(V(1.1, top(1.1), 0), V(L, top(L), 0), 0.08);
  for (let x = 1.1, i = 0; x < L - 0.05; x += 1.6, i++) {
    const x1 = Math.min(L, x + 1.6);
    bar(V(x, T, -zj), V(x, T, zj));
    for (const z of [-zj, zj]) bar(i % 2 ? V(x, T, z) : V(x, top(x), 0), i % 2 ? V(x1, top(x1), 0) : V(x1, T, z));
  }
  // the counter-jib with its walkway, and the concrete counterweights at its end
  const C = Math.max(6, W * 0.3), zc = 0.75;
  for (const z of [-zc, zc]) kit.box('paint', -C, T, z - 0.1, -1.1, T + 0.3, z + 0.1, y);
  for (let x = -1.1; x > -C; x -= 1.4) bar(V(x, T + 0.15, -zc), V(x, T + 0.15, zc));
  kit.box('metal', -C + 0.2, T + 0.3, -0.55, -1.1, T + 0.36, 0.55, dark);
  for (let k = 0; k < 3; k++) kit.box('stone', -C + 0.15 + k * 0.8, T - 2.4, -0.95, -C + 0.85 + k * 0.8, T + 0.25, 0.95, conc);
  // the A-frame over the slewing unit, and its tie rods out to the jib and the counter-jib
  const apex = V(0, T + 5.5, 0);
  for (const [x, z] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) bar(V(x, T, z), apex, 0.09);
  const tie = 1.1 + (L - 1.1) * 0.62;
  kit.rod('paint', apex, V(tie, top(tie), 0), 0.05, dark, 4);
  kit.rod('paint', apex, V(-C + 0.4, T + 0.3, 0), 0.05, dark, 4);
  // the trolley partway out, its hoist ropes and the hook block
  const tx = 1.1 + (L - 1.1) * 0.55, drop = Math.min(8, H * 0.45);
  kit.box('metal', tx - 0.55, T - 0.35, -0.65, tx + 0.55, T, 0.65, dark);
  for (const z of [-0.18, 0.18]) kit.rod('metal', V(tx, T - 0.35, z), V(tx, T - drop, z), 0.02, dark, 4);
  kit.box('paint', tx - 0.3, T - drop - 0.7, -0.22, tx + 0.3, T - drop, 0.22, y);
  kit.box('metal', tx - 0.08, T - drop - 1.05, -0.06, tx + 0.08, T - drop - 0.7, 0.06, dark);
  kit.base = save;
}

/* ---------- the layer ---------- */
/** let the page paint a frame; a hidden page has nothing to paint (and throttles timers), so carry on */
export function yieldFrame(): Promise<void> {
  if (document.hidden) return Promise.resolve();
  return new Promise((r) => {
    requestAnimationFrame(() => r());
    setTimeout(r, 100);
  });
}
const BCH = 16; // tiles per building chunk
const NBCX = Math.ceil(256 / BCH);
interface Entry {
  sig: string;
  b: any;
  parts: Map<string, Packed[]> | null;
  height: number;
  solids: Box2[]; // world-space AABBs
  cam: Float32Array; // world-space camera volumes, 6 floats each
  box: THREE.Box3;
  chunk: number;
  dyn: THREE.Group | null;
  trees: TreeInstance[];
}

export class BuildingLayer {
  group = new THREE.Group();
  entries = new Map<number, Entry>();
  private chunkMeshes = new Map<number, THREE.Mesh[]>();
  private dirty = new Set<number>();
  private pal: Palette = sharedPalette();
  private first = true;
  /** bumps when the trees planted by buildings change */
  treesVersion = 0;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  /** the coarse look signature: rebuild only when it changes */
  private sigOf(b: any): string {
    const k = b.type === 'house' && b.level > 1 ? 'house' + Math.min(3, b.level) : b.type;
    const seasonal = k === 'farm' || k === 'pool' || k === 'park' || k === 'grandpark' || k === 'zoo' || k === 'plaza';
    return `${k}|${b.x},${b.y}|${b.variant}|${b.facing || 0}|${b.ruined ? 'R' : ''}|${b.construction > 0 ? 'C' : ''}|${b.upgrading > 0 || b.renovating > 0 ? 'S' : ''}|${seasonal ? Weather.season : ''}`;
  }

  sync(): void {
    const seen = new Set<number>();
    let treesChanged = false;
    for (const b of World.buildings) {
      seen.add(b.id);
      let e = this.entries.get(b.id);
      const sig = this.sigOf(b);
      if (!e || e.sig !== sig) {
        if (e) { this.drop(e); treesChanged ||= e.trees.length > 0; }
        e = this.make(b, sig);
        this.entries.set(b.id, e);
        treesChanged ||= e.trees.length > 0;
      }
      // a construction site rises inside its scaffold
      if (e.dyn) {
        const body = e.dyn.userData.body as THREE.Object3D | undefined;
        if (body) {
          const p = b.construction > 0 ? Math.max(0.04, 1 - b.construction / Math.max(1, b.conTotal || 40 + b.w * b.h * 22)) : 1;
          body.scale.y = p;
        }
      }
    }
    for (const [id, e] of this.entries)
      if (!seen.has(id)) {
        this.drop(e);
        this.entries.delete(id);
        treesChanged ||= e.trees.length > 0;
      }
    if (treesChanged) this.treesVersion++;
    // re-merge changed chunks (all at once on the first sync, then a couple per frame)
    let budget = this.first ? 1e9 : 2;
    this.first = false;
    for (const ci of this.dirty) {
      if (budget-- <= 0) break;
      this.dirty.delete(ci);
      this.mergeChunk(ci);
    }
  }

  private chunkOf(b: any): number {
    const cx = Math.floor((b.x + b.w / 2) / BCH), cy = Math.floor((b.y + b.h / 2) / BCH);
    return cy * NBCX + cx;
  }

  private make(b: any, sig: string): Entry {
    const place = new THREE.Matrix4().makeRotationY(((b.facing || 0) * Math.PI) / 2).setPosition((b.x + b.w / 2) * TM, 0, (b.y + b.h / 2) * TM);
    const kit = new Kit(this.pal);
    kit.base = place.clone();
    const e: Entry = { sig, b, parts: null, height: 4, solids: [], cam: new Float32Array(0), box: new THREE.Box3(), chunk: this.chunkOf(b), dyn: null, trees: [] };
    if (b.ruined) {
      // rubble uses world-aligned w/h
      kit.base = new THREE.Matrix4().setPosition((b.x + b.w / 2) * TM, 0, (b.y + b.h / 2) * TM);
      rubble(kit, b);
      e.height = 2;
    } else {
      const key = b.type === 'house' && b.level > 1 ? 'house' + Math.min(3, b.level) : b.type;
      const c = buildFor({ ...b, type: key }, kit);
      e.height = c.height;
      e.trees = c.trees;
      // collision boxes, rotated into world space (quarter turns stay axis-aligned)
      const f = (b.facing || 0) & 3;
      const gx = (b.x + b.w / 2) * TM, gz = (b.y + b.h / 2) * TM;
      const world = (x0: number, z0: number, x1: number, z1: number): Box2 => {
        const pts = [[x0, z0], [x1, z1]].map(([x, z]) => {
          const [rx, rz] = f === 0 ? [x, z] : f === 1 ? [z, -x] : f === 2 ? [-x, -z] : [-z, x];
          return [rx + gx, rz + gz];
        });
        return [Math.min(pts[0][0], pts[1][0]), Math.min(pts[0][1], pts[1][1]), Math.max(pts[0][0], pts[1][0]), Math.max(pts[0][1], pts[1][1])];
      };
      for (const [x0, z0, x1, z1] of c.solids) e.solids.push(world(x0, z0, x1, z1));
      e.cam = new Float32Array(c.cam.length * 6);
      c.cam.forEach(([x0, y0, z0, x1, y1, z1], i) => {
        const [wx0, wz0, wx1, wz1] = world(x0!, z0!, x1!, z1!);
        e.cam.set([wx0, y0!, wz0, wx1, y1 ?? c.height, wz1], i * 6);
      });
    }
    e.box.set(V(b.x * TM, 0, b.y * TM), V((b.x + b.w) * TM, e.height + 1, (b.y + b.h) * TM));
    const building = b.construction > 0 || b.upgrading > 0 || b.renovating > 0;
    if (building && !b.ruined) {
      // a live site: its own meshes, so the body can rise inside the scaffold
      kit.take();
      const g = new THREE.Group();
      const body = new THREE.Group();
      g.applyMatrix4(place);
      e.dyn = g;
      g.add(body);
      g.userData.body = body;
      // the body scales up from the ground in its own frame: build it again without placement
      const local = new Kit(this.pal);
      const key = b.type === 'house' && b.level > 1 ? 'house' + Math.min(3, b.level) : b.type;
      buildFor({ ...b, type: key }, local);
      meshesFromParts(this.pal, local.take(), body, true);
      const d = CAT[b.type];
      const W = (d.w || 1) * TM, D = (d.h || 1) * TM;
      const sk = new Kit(this.pal);
      scaffold(sk, W, D, Math.max(4, e.height * (b.construction > 0 ? 1 : 0.9)));
      if (b.construction > 0 && W * D >= 9 * 64) crane(sk, Math.max(14, e.height + 6), W, W / 2 - 1.5, -D / 2 + 1.5);
      meshesFromParts(this.pal, sk.take(), g, true);
      g.traverse((o) => (o.userData.bid = b.id));
      this.group.add(g);
    } else {
      e.parts = kit.take();
      this.dirty.add(e.chunk);
    }
    return e;
  }

  private drop(e: Entry): void {
    if (e.dyn) {
      this.group.remove(e.dyn);
      e.dyn.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      e.dyn = null;
    }
    if (e.parts) {
      e.parts = null;
      this.dirty.add(e.chunk);
    }
  }

  /** one mesh per material for every finished building in the chunk */
  private mergeChunk(ci: number): void {
    const old = this.chunkMeshes.get(ci);
    if (old) for (const m of old) { this.group.remove(m); m.geometry.dispose(); }
    const all = new Map<string, Packed[]>();
    for (const e of this.entries.values()) {
      if (e.chunk !== ci || !e.parts) continue;
      for (const [k, list] of e.parts) {
        if (!all.has(k)) all.set(k, []);
        all.get(k)!.push(...list);
      }
    }
    const meshes = meshesFromParts(this.pal, all, this.group, true);
    // the merged copy lives on the GPU; drop its CPU arrays after upload
    freeAfterUpload(meshes);
    for (const m of meshes) m.userData.chunk = ci;
    this.chunkMeshes.set(ci, meshes);
  }

  /** drop every mesh (a new map or a loaded save reuses building ids) */
  clear(): void {
    for (const e of this.entries.values()) this.drop(e);
    this.entries.clear();
    for (const ci of [...this.dirty, ...this.chunkMeshes.keys()]) this.mergeChunk(ci);
    this.dirty.clear();
    this.treesVersion++;
    this.first = true;
  }

  /** build the whole town from scratch a slice at a time, yielding between slices (the loading screen) */
  async buildAll(progress: (done: number, total: number) => void, sliceMs = 40): Promise<void> {
    this.clear();
    const list = [...World.buildings];
    let i = 0;
    while (i < list.length) {
      const t0 = performance.now();
      while (i < list.length && performance.now() - t0 < sliceMs) {
        const b = list[i++];
        const sig = this.sigOf(b);
        this.entries.set(b.id, this.make(b, sig));
      }
      progress(i, list.length);
      await yieldFrame();
    }
    this.sync(); // anything the sim changed meanwhile, then every chunk at once
    this.treesVersion++;
  }

  /** the building a ray hits first (Planner clicks) */
  pick(ray: THREE.Ray): any | null {
    let best: any = null, bd = Infinity;
    const p = new THREE.Vector3();
    for (const e of this.entries.values()) {
      if (!ray.intersectBox(e.box, p)) continue;
      const d = p.distanceToSquared(ray.origin);
      if (d < bd) { bd = d; best = e.b; }
    }
    return best;
  }

  /** every tree planted by a building (parks, gardens, the zoo) */
  trees(): TreeInstance[] {
    const out: TreeInstance[] = [];
    for (const e of this.entries.values()) out.push(...e.trees);
    return out;
  }

  /** world-space collision boxes near a point (metres) */
  solidsNear(x: number, z: number, r: number): Box2[] {
    const out: Box2[] = [];
    const tx0 = Math.floor((x - r) / TM) - 1, tx1 = Math.floor((x + r) / TM) + 1;
    const tz0 = Math.floor((z - r) / TM) - 1, tz1 = Math.floor((z + r) / TM) + 1;
    const ids = new Set<number>();
    for (let tz = tz0; tz <= tz1; tz++)
      for (let tx = tx0; tx <= tx1; tx++) {
        const b = World.buildingAt(tx, tz);
        if (b && !ids.has(b.id)) {
          ids.add(b.id);
          const e = this.entries.get(b.id);
          if (e) out.push(...e.solids);
        }
      }
    return out;
  }

  heightOf(id: number): number {
    return this.entries.get(id)?.height || 4;
  }

  /** camera volumes (6 floats per box, world space) of every building touching the rectangle */
  camBoxes(x0: number, z0: number, x1: number, z1: number, out: Float32Array[] = []): Float32Array[] {
    out.length = 0;
    for (const e of this.entries.values())
      if (e.cam.length && e.box.max.x >= x0 && e.box.min.x <= x1 && e.box.max.z >= z0 && e.box.min.z <= z1) out.push(e.cam);
    return out;
  }
}

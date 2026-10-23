/* ============================================================
   Buildings: a procedural low-poly builder for every catalog
   type, in V1's visual language (wall/roof palettes, awnings,
   signs, glowing windows), plus the layer that keeps the 3D
   town in sync with the sim — construction sites rising inside
   scaffolds, extra floors, ruins, and collision boxes.
   Local frame: plot centred on the origin, front (door) at +Z.
   ============================================================ */
import * as THREE from 'three';
import { CAT } from '../sim/catalog';
import { World } from '../sim/world';
import { Weather } from '../sim/weather';
import { MeshBuilder, MAT, hex, shade, hash2 } from './kit';

const TM = 8;
const FLOOR = 3.2;
type Box2 = [number, number, number, number]; // x0 z0 x1 z1 (local)

const HOUSE_WALLS = ['#f0e0bd', '#e6c69c', '#d8e4ef', '#f2d4cc', '#e4e0d4', '#cfe0c2'];
const HOUSE_ROOFS = ['#c0574f', '#7a8fb1', '#8a9a5b', '#a86f4f', '#6d5b8e', '#b0883f'];

/** buildings you can walk straight into (open venues): no collision box */
const OPEN = new Set(['park', 'playground', 'grandpark', 'plaza', 'pool', 'busstop', 'taxistand', 'heliport', 'dock']);

export interface Built {
  body: MeshBuilder;
  win: MeshBuilder[]; // three window materials
  glow: MeshBuilder;
  height: number;
  solids: Box2[];
}

class Ctx implements Built {
  body = new MeshBuilder();
  win = [new MeshBuilder(), new MeshBuilder(), new MeshBuilder()];
  glow = new MeshBuilder();
  height = 4;
  solids: Box2[] = [];
  W: number;
  D: number;
  hv: number;
  winK = 0;
  constructor(public b: any, public key: string) {
    const d = CAT[key];
    this.W = (d.w || 1) * TM;
    this.D = (d.h || 1) * TM;
    this.hv = hash2(b.id || 1, b.x * 7 + b.y);
  }
  get hw(): number { return this.W / 2; }
  get hd(): number { return this.D / 2; }
  c(h: string, j = 0): THREE.Color {
    return j ? shade(h, j) : hex(h);
  }
  /** plot surface */
  lot(color: string, inset = 0.15): this {
    this.body.box(-this.hw + inset, 0, -this.hd + inset, this.hw - inset, 0.1, this.hd - inset, this.c(color));
    return this;
  }
  solid(x0: number, z0: number, x1: number, z1: number): this {
    this.solids.push([x0, z0, x1, z1]);
    return this;
  }
  /** a walled block with windows on every face; returns its top */
  block(x0: number, z0: number, x1: number, z1: number, y0: number, floors: number, wall: string, o: { door?: boolean; doorC?: string; glass?: boolean; noWin?: boolean; winGap?: number; band?: string; floorH?: number } = {}): number {
    const fh = o.floorH || FLOOR;
    const y1 = y0 + floors * fh;
    this.body.box(x0, y0, z0, x1, y1, z1, this.c(wall), this.c(wall, -0.25));
    this.solid(x0, z0, x1, z1);
    if (o.band) for (let f = 1; f < floors; f++) this.body.box(x0 - 0.05, y0 + f * fh - 0.15, z0 - 0.05, x1 + 0.05, y0 + f * fh + 0.1, z1 + 0.05, this.c(o.band));
    if (!o.noWin) this.windows(x0, z0, x1, z1, y0, floors, fh, o.glass ? 0.85 : 0, o.winGap || 2.6, !!o.door);
    if (o.door) this.door(0, z1, y0, o.doorC);
    this.height = Math.max(this.height, y1);
    return y1;
  }
  windows(x0: number, z0: number, x1: number, z1: number, y0: number, floors: number, fh: number, glass: number, gap: number, doorFront: boolean): void {
    const wb = this.win[this.winK];
    const wc = hex('#ffffff');
    const ww = glass ? gap - 0.25 : 1.1, wh = glass ? fh - 0.7 : 1.35, e = 0.05;
    for (let f = 0; f < floors; f++) {
      const wy = y0 + f * fh + (glass ? 0.35 : 1.0);
      const run = (len: number, place: (t: number) => void) => {
        const n = Math.max(1, Math.floor((len - 1) / gap));
        const start = (len - (n - 1) * gap) / 2;
        for (let k = 0; k < n; k++) place(start + k * gap);
      };
      run(x1 - x0, (t) => {
        const x = x0 + t;
        if (!(doorFront && f === 0 && Math.abs(x) < 1.4)) wb.quad([x - ww / 2, wy, z1 + e], [x + ww / 2, wy, z1 + e], [x + ww / 2, wy + wh, z1 + e], [x - ww / 2, wy + wh, z1 + e], wc);
        wb.quad([x + ww / 2, wy, z0 - e], [x - ww / 2, wy, z0 - e], [x - ww / 2, wy + wh, z0 - e], [x + ww / 2, wy + wh, z0 - e], wc);
      });
      run(z1 - z0, (t) => {
        const z = z0 + t;
        wb.quad([x1 + e, wy, z + ww / 2], [x1 + e, wy, z - ww / 2], [x1 + e, wy + wh, z - ww / 2], [x1 + e, wy + wh, z + ww / 2], wc);
        wb.quad([x0 - e, wy, z - ww / 2], [x0 - e, wy, z + ww / 2], [x0 - e, wy + wh, z + ww / 2], [x0 - e, wy + wh, z - ww / 2], wc);
      });
    }
  }
  door(x: number, z: number, y0: number, col = '#5a3e2b', w = 1.4, h = 2.3): void {
    this.body.quad([x - w / 2, y0, z + 0.06], [x + w / 2, y0, z + 0.06], [x + w / 2, y0 + h, z + 0.06], [x - w / 2, y0 + h, z + 0.06], this.c(col));
    this.body.box(x - w / 2 - 0.15, y0 + h, z, x + w / 2 + 0.15, y0 + h + 0.18, z + 0.12, this.c('#3a3a3a'));
  }
  flatRoof(x0: number, z0: number, x1: number, z1: number, y: number, col = '#8a8f96', parapet = 0.5): void {
    const c = this.c(col);
    this.body.box(x0, y, z0, x1, y + 0.15, z1, c);
    if (parapet) {
      const p = this.c(col, -0.15);
      this.body.box(x0, y, z0, x1, y + parapet, z0 + 0.3, p);
      this.body.box(x0, y, z1 - 0.3, x1, y + parapet, z1, p);
      this.body.box(x0, y, z0, x0 + 0.3, y + parapet, z1, p);
      this.body.box(x1 - 0.3, y, z0, x1, y + parapet, z1, p);
    }
    // rooftop AC units
    const n = 1 + (this.hv % 3);
    for (let i = 0; i < n && x1 - x0 > 5; i++) {
      const ax = x0 + 1.5 + ((this.hv >> (i * 3)) % 7) / 7 * (x1 - x0 - 4);
      const az = z0 + 1.5 + ((this.hv >> (i * 5)) % 5) / 5 * (z1 - z0 - 4);
      this.body.box(ax, y + 0.15, az, ax + 1.6, y + 1.1, az + 1.2, this.c('#b9bcc2'));
    }
    this.height = Math.max(this.height, y + parapet);
  }
  gable(x0: number, z0: number, x1: number, z1: number, y: number, rise: number, roof: string, wall: string, alongX = true): void {
    const o = 0.45; // eaves overhang
    if (alongX) this.body.gableX(x0 - o, x1 + o, y, y + rise, z0 - o, z1 + o, this.c(roof), this.c(wall));
    else this.body.gableZ(x0 - o, x1 + o, y, y + rise, z0 - o, z1 + o, this.c(roof), this.c(wall));
    this.height = Math.max(this.height, y + rise);
  }
  awning(x0: number, x1: number, z: number, y: number, a: string, b2: string): void {
    const n = Math.max(2, Math.round((x1 - x0) / 0.9));
    const w = (x1 - x0) / n;
    for (let i = 0; i < n; i++) {
      const c = this.c(i % 2 ? a : b2);
      const xa = x0 + i * w, xb = xa + w;
      this.body.quad([xa, y - 0.7, z + 1.5], [xb, y - 0.7, z + 1.5], [xb, y, z], [xa, y, z], c);
      this.body.quad([xb, y - 0.7, z + 1.5], [xa, y - 0.7, z + 1.5], [xa, y, z], [xb, y, z], c);
    }
  }
  sign(x: number, z: number, y: number, w: number, col: string, h = 0.9): void {
    this.glow.box(x - w / 2, y, z, x + w / 2, y + h, z + 0.25, this.c(col));
  }
  chimney(x: number, z: number, y: number, h: number, r = 0.5, col = '#8a5a4a'): void {
    this.body.box(x - r, y, z - r, x + r, y + h, z + r, this.c(col));
    this.height = Math.max(this.height, y + h);
  }
  smokestack(x: number, z: number, h: number, r: number, col = '#9a8f86'): void {
    this.body.cyl(x, 0, z, r, h, 8, this.c(col), this.c('#3a3a3a'), r * 0.85);
    this.body.cyl(x, h * 0.82, z, r * 0.92, h * 0.06, 8, this.c('#c0392b'));
    this.solid(x - r, z - r, x + r, z + r);
    this.height = Math.max(this.height, h);
  }
  tree(x: number, z: number, s = 1): void {
    this.body.cyl(x, 0, z, 0.25 * s, 2 * s, 5, this.c('#6e4f33'));
    const crown = Weather.season === 3 ? null : Weather.season === 2 ? '#d38a2e' : '#4e9a3e';
    if (crown) this.body.blob(x, 3.2 * s, z, 1.8 * s, 1.7 * s, 1.8 * s, this.c(crown, ((this.hv + x * 3) % 7 - 3) * 0.03));
  }
  bench(x: number, z: number, yaw = 0): void {
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, 0, z);
    this.body.mat = m;
    this.body.box(-0.9, 0.4, -0.25, 0.9, 0.5, 0.25, this.c('#8a5a3a'));
    this.body.box(-0.9, 0.5, -0.3, 0.9, 0.95, -0.2, this.c('#8a5a3a'));
    this.body.box(-0.8, 0, -0.2, -0.7, 0.4, 0.2, this.c('#444'));
    this.body.box(0.7, 0, -0.2, 0.8, 0.4, 0.2, this.c('#444'));
    this.body.mat = null;
  }
  columns(x0: number, x1: number, z: number, y0: number, h: number, n: number, col = '#efe9dc'): void {
    for (let i = 0; i < n; i++) {
      const x = x0 + ((x1 - x0) * (i + 0.5)) / n;
      this.body.cyl(x, y0, z, 0.32, h, 8, this.c(col));
    }
  }
  pediment(x0: number, x1: number, z0: number, z1: number, y: number, rise: number, col = '#e8e2d2'): void {
    this.body.gableZ(x0, x1, y, y + rise, z0, z1, this.c(col), this.c(col, -0.06));
    this.height = Math.max(this.height, y + rise);
  }
  fence(x0: number, z0: number, x1: number, z1: number, col = '#a5824f', h = 0.9): void {
    const c = this.c(col);
    this.body.box(x0, 0.4, z0, x1, 0.55, z0 + 0.08, c).box(x0, 0.4, z1 - 0.08, x1, 0.55, z1, c);
    this.body.box(x0, 0.4, z0, x0 + 0.08, 0.55, z1, c).box(x1 - 0.08, 0.4, z0, x1, 0.55, z1, c);
    for (let x = x0; x <= x1; x += 1.6) { this.body.box(x - 0.05, 0, z0, x + 0.05, h, z0 + 0.1, c); this.body.box(x - 0.05, 0, z1 - 0.1, x + 0.05, h, z1, c); }
    for (let z = z0; z <= z1; z += 1.6) { this.body.box(x0, 0, z - 0.05, x0 + 0.1, h, z + 0.05, c); this.body.box(x1 - 0.1, 0, z - 0.05, x1, h, z + 0.05, c); }
  }
}

/* ---------- shop & venue looks ---------- */
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
  if (res || c.key === 'lodge') c.fence(-c.hw + 0.35, -c.hd + 0.35, c.hw - 0.35, c.hd - 0.35);
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
  const wb = c.win[1];
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
    const x = ((h % 1000) / 1000 - 0.5) * (c.W - 6), z = (((h >> 10) % 1000) / 1000 - 0.5) * (c.D - 6);
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
  c.lot('#9a9ea6', 0.05);
  // the runway along the south apron (V1 lands its planes there)
  const rz = c.hd - 9.5;
  c.body.box(-c.hw + 1, 0.1, rz - 5, c.hw - 1, 0.13, rz + 5, c.c('#3a3d44'));
  for (let x = -c.hw + 6; x < c.hw - 6; x += 9) c.body.box(x, 0.13, rz - 0.25, x + 5, 0.15, rz + 0.25, c.c('#f0f0f0'));
  for (let x = -c.hw + 3; x < c.hw - 2; x += 6) for (const z of [rz - 5.2, rz + 5.2]) c.glow.box(x - 0.2, 0.13, z - 0.2, x + 0.2, 0.4, z + 0.2, c.c(z < rz ? '#80c0ff' : '#ffd060'));
  const top = c.block(-c.hw + 6, -c.hd + 3, 6, -c.hd + 22, 0.1, 2, '#d8dde2', { door: true, glass: true, winGap: 3, floorH: 4 });
  c.body.box(-c.hw + 5, top, -c.hd + 2, 7, top + 1.2, -c.hd + 23, c.c('#e8ecf0'));
  // control tower
  const tx = 18, tz = -c.hd + 10;
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
export function buildFor(b: any): Built {
  const key = b.type;
  const c = new Ctx(b, key);
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
  if (OPEN.has(key)) c.solids = c.solids.filter((s) => (s[2] - s[0]) * (s[3] - s[1]) < 60);
  return c;
}

/* ---------- ruins & construction props ---------- */
function rubble(b: any): MeshBuilder {
  const m = new MeshBuilder();
  const W = b.w * TM, D = b.h * TM;
  m.box(-W / 2 + 0.3, 0, -D / 2 + 0.3, W / 2 - 0.3, 0.12, D / 2 - 0.3, hex('#5a564e'));
  for (let i = 0; i < 14; i++) {
    const h = hash2(b.id, i);
    const x = ((h % 1000) / 1000 - 0.5) * (W - 3), z = (((h >> 10) % 1000) / 1000 - 0.5) * (D - 3);
    const s = 0.6 + ((h >> 20) % 10) / 6;
    m.boxC(x, s / 2, z, s * 1.4, s, s, hex(i % 3 ? '#4a4540' : '#2a2622'));
  }
  m.box(-W / 2 + 1, 0, -D / 2 + 1, -W / 2 + 1.5, 4.5, -D / 2 + 1.5, hex('#3a3632'));
  return m;
}
function scaffold(W: number, D: number, H: number): MeshBuilder {
  const m = new MeshBuilder();
  const pole = hex('#c0a060'), plank = hex('#8a6a42');
  const x0 = -W / 2 + 0.4, x1 = W / 2 - 0.4, z0 = -D / 2 + 0.4, z1 = D / 2 - 0.4;
  for (let x = x0; x <= x1 + 0.01; x += Math.max(2, (x1 - x0) / Math.ceil((x1 - x0) / 3)))
    for (const z of [z0, z1]) m.box(x - 0.07, 0, z - 0.07, x + 0.07, H, z + 0.07, pole);
  for (let z = z0; z <= z1 + 0.01; z += Math.max(2, (z1 - z0) / Math.ceil((z1 - z0) / 3)))
    for (const x of [x0, x1]) m.box(x - 0.07, 0, z - 0.07, x + 0.07, H, z + 0.07, pole);
  for (let y = 2; y < H; y += 2.4) {
    m.box(x0, y, z0 - 0.3, x1, y + 0.08, z0 + 0.3, plank).box(x0, y, z1 - 0.3, x1, y + 0.08, z1 + 0.3, plank);
    m.box(x0 - 0.3, y, z0, x0 + 0.3, y + 0.08, z1, plank).box(x1 - 0.3, y, z0, x1 + 0.3, y + 0.08, z1, plank);
  }
  return m;
}
function crane(H: number, W: number): MeshBuilder {
  const m = new MeshBuilder();
  const y = hex('#e0a020');
  m.box(-0.5, 0, -0.5, 0.5, H, 0.5, y);
  m.box(-W * 0.3, H, -0.35, W * 0.8, H + 0.7, 0.35, y);
  m.box(-W * 0.3, H - 1, -0.6, -W * 0.3 + 2, H + 0.7, 0.6, hex('#7a7f86'));
  m.box(W * 0.6 - 0.05, H - 6, -0.05, W * 0.6 + 0.05, H, 0.05, hex('#333'));
  return m;
}

/* ---------- the layer ---------- */
interface Entry {
  sig: string;
  group: THREE.Group;
  body?: THREE.Object3D;
  scaf?: THREE.Object3D;
  height: number;
  solids: Box2[]; // world-space AABBs
}

export class BuildingLayer {
  group = new THREE.Group();
  entries = new Map<number, Entry>();
  private season = -1;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  /** the coarse look signature: rebuild only when it changes */
  private sigOf(b: any): string {
    const k = b.type === 'house' && b.level > 1 ? 'house' + Math.min(3, b.level) : b.type;
    return `${k}|${b.x},${b.y}|${b.variant}|${b.facing || 0}|${b.ruined ? 'R' : ''}|${b.construction > 0 ? 'C' : ''}|${b.upgrading > 0 || b.renovating > 0 ? 'S' : ''}|${this.season}`;
  }

  sync(): void {
    const season = Weather.season;
    const seasonChanged = season !== this.season;
    this.season = season;
    const seen = new Set<number>();
    for (const b of World.buildings) {
      seen.add(b.id);
      let e = this.entries.get(b.id);
      const sig = this.sigOf(b);
      if (!e || e.sig !== sig || seasonChanged) {
        if (e) this.dispose(e);
        e = this.make(b, sig);
        this.entries.set(b.id, e);
      }
      // a construction site rises inside its scaffold
      if (b.construction > 0 && e.body) {
        const p = Math.max(0.04, 1 - b.construction / Math.max(1, b.conTotal || 40 + b.w * b.h * 22));
        e.body.scale.y = p;
      } else if (e.body && e.body.scale.y !== 1) e.body.scale.y = 1;
    }
    for (const [id, e] of this.entries)
      if (!seen.has(id)) {
        this.dispose(e);
        this.entries.delete(id);
      }
  }

  private make(b: any, sig: string): Entry {
    const g = new THREE.Group();
    g.position.set((b.x + b.w / 2) * TM, 0, (b.y + b.h / 2) * TM);
    g.rotation.y = ((b.facing || 0) * Math.PI) / 2;
    g.userData.bid = b.id;
    const e: Entry = { sig, group: g, height: 4, solids: [] };
    if (b.ruined) {
      const r = new THREE.Mesh(rubble(b).build(), MAT.solid);
      r.castShadow = r.receiveShadow = true;
      r.rotation.y = -g.rotation.y; // rubble uses world-aligned w/h
      g.add(r);
      e.height = 1;
    } else {
      const key = b.type === 'house' && b.level > 1 ? 'house' + Math.min(3, b.level) : b.type;
      const built = buildFor({ ...b, type: key });
      const body = new THREE.Group();
      const add = (mb: MeshBuilder, mat: THREE.Material, shadow: boolean) => {
        if (mb.empty) return;
        const m = new THREE.Mesh(mb.build(), mat);
        m.castShadow = shadow;
        m.receiveShadow = shadow;
        m.userData.bid = b.id;
        body.add(m);
      };
      add(built.body, MAT.solid, true);
      add(built.win[0], MAT.windowA, false);
      add(built.win[1], MAT.windowB, false);
      add(built.win[2], MAT.windowC, false);
      add(built.glow, MAT.glow, false);
      g.add(body);
      e.body = body;
      e.height = built.height;
      const d = CAT[b.type];
      const W = (d.w || 1) * TM, D = (d.h || 1) * TM;
      if (b.construction > 0 || b.upgrading > 0 || b.renovating > 0) {
        const sc = new THREE.Mesh(scaffold(W, D, Math.max(4, built.height * (b.construction > 0 ? 1 : 0.9))).build(), MAT.solid);
        sc.castShadow = true;
        g.add(sc);
        e.scaf = sc;
        if (b.construction > 0 && W * D >= 9 * 64) {
          const cr = new THREE.Mesh(crane(Math.max(14, built.height + 6), W).build(), MAT.solid);
          cr.position.set(W / 2 - 1.5, 0, -D / 2 + 1.5);
          cr.castShadow = true;
          g.add(cr);
        }
      }
      // collision boxes, rotated into world space (quarter turns stay axis-aligned)
      const f = (b.facing || 0) & 3;
      for (const [x0, z0, x1, z1] of built.solids) {
        const pts = [[x0, z0], [x1, z1]].map(([x, z]) => {
          const [rx, rz] = f === 0 ? [x, z] : f === 1 ? [z, -x] : f === 2 ? [-x, -z] : [-z, x];
          return [rx + g.position.x, rz + g.position.z];
        });
        e.solids.push([Math.min(pts[0][0], pts[1][0]), Math.min(pts[0][1], pts[1][1]), Math.max(pts[0][0], pts[1][0]), Math.max(pts[0][1], pts[1][1])]);
      }
    }
    this.group.add(g);
    return e;
  }

  private dispose(e: Entry): void {
    this.group.remove(e.group);
    e.group.traverse((o) => {
      if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose();
    });
  }

  /** drop every mesh (a new map or a loaded save reuses building ids) */
  clear(): void {
    for (const e of this.entries.values()) this.dispose(e);
    this.entries.clear();
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
}

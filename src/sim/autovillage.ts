/* ============================================================
   Auto village (V2): a bustling, ready-made village to watch.
   A fresh valley laid out the way a well-loved village grows:
   the two highways carried in as avenues that meet at the
   square; a grid of side streets; the town hall, the church and
   the shops round the square; the school, the hospital, the
   police and fire stations, parks and a cinema in the streets
   beyond; homes with gardens filling the blocks; the power plant,
   the mill, the brickworks and the farms out on the edge, and
   traffic lights at every crossing. Everyone moves in
   at once, every place opens with its till stocked, and then the
   sim takes over: the village lives its days and grows on its
   own, with nobody building but the villagers.
   ============================================================ */
import type { Building } from './types';
import { CAT } from './catalog';
import { World, GW, GH, G_GRASS, G_SAND, footprint, originForDoor } from './world';
import { mulberry32 } from './core';
import { Sim } from './agents';
import { Game } from './game';
import { Gov } from './gov';
import { Life } from './life';
import { Economy } from './economy';

const NAMES = ['Willowmere', 'Brookhaven', 'Larkspur', 'Ambleside', 'Thornbury', 'Marigold Vale', 'Fernwick', 'Oakridge',
  'Sunnymead', 'Kingsbridge', 'Rosedale', 'Elderglen', 'Hollybrook', 'Ashcombe', 'Meadowford', 'Juniper Hill'];
/** street spacing in tiles: a two-lane street and a twelve-tile block */
const BLOCK = 14;

interface Rect { x0: number; y0: number; x1: number; y1: number }
export interface AutoPlan { name: string; centre: { x: number; z: number }; sights: { x: number; z: number; label: string }[] }
/** V2: how big an Auto village: 0 a hamlet, 1 a village, 2 a town, 3 the full town (every kind of building, every
 *  network: the railway, the airport, the harbour and its ferry, the heliport) */
export type AutoSize = 0 | 1 | 2 | 3;

export const AutoVillage = {
  /** found a brand-new village and fill it; returns where to look */
  build(seed = (Math.random() * 1e9) | 0, size: AutoSize = 1): AutoPlan {
    const R = mulberry32(seed ^ 0x5eed);
    const pick = <T>(a: T[]): T => a[Math.floor(R() * a.length)];
    const name = pick(NAMES);
    Game.newMap(name, 'sandbox', seed, true);
    const X0 = World.highway?.north?.x ?? GW >> 1, Y0 = World.highway?.west?.y ?? GH >> 1;
    // (blocks either side of the square: the hamlet a crossroads with a block in each corner, the town a wider grid)
    const N = size === 0 ? 1 : size === 1 ? 2 : 3;
    const span = BLOCK * N;

    /* ---------- the streets ---------- */
    const open = (x: number, y: number): boolean => {
      if (!World.inB(x, y)) return false;
      const k = World.idx(x, y), g = World.ground[k];
      return (g === G_GRASS || g === G_SAND) && !World.bmap[k] && !World.railMap[k];
    };
    const row = (y: number, xa: number, xb: number): void => { for (let x = xa; x <= xb; x++) if (open(x, y)) World.setRoadWide(x, y, true); };
    const col = (x: number, ya: number, yb: number): void => { for (let y = ya; y <= yb; y++) if (open(x, y)) World.setRoadWide(x, y, false); };
    // the highways come in as the avenues
    row(Y0, Math.min(X0 - span, (GW >> 1) - 40), X0 + span + 1);
    col(X0, Math.min(Y0 - span, (GH >> 1) - 40), Y0 + span + 1);
    // the grid
    for (let k = -N; k <= N; k++) {
      row(Y0 + k * BLOCK, X0 - span, X0 + span + 1);
      col(X0 + k * BLOCK, Y0 - span, Y0 + span + 1);
    }
    // out east to the works, out south to the farms
    row(Y0, X0 + span, X0 + span + 24);
    col(X0, Y0 + span, Y0 + span + 18);

    /* ---------- the blocks ---------- */
    const blocks: (Rect & { ring: number })[] = [];
    for (let bj = -N; bj < N; bj++) for (let bi = -N; bi < N; bi++) {
      blocks.push({ x0: X0 + bi * BLOCK + 2, x1: X0 + (bi + 1) * BLOCK - 1, y0: Y0 + bj * BLOCK + 2, y1: Y0 + (bj + 1) * BLOCK - 1, ring: Math.max(Math.abs(bi + 0.5), Math.abs(bj + 0.5)) });
    }
    // (a hamlet's four blocks are all round the crossroads: its homes share them with the shops)
    const centre = blocks.filter((b) => b.ring < 1), outer = size === 0 ? centre : blocks.filter((b) => b.ring > 1);
    const works: Rect = { x0: X0 + span + 2, x1: X0 + span + 24, y0: Y0 - 9, y1: Y0 + 11 };
    const fields: Rect = { x0: X0 - 14, x1: X0 + 16, y0: Y0 + span + 2, y1: Y0 + span + 20 };
    const gate: Rect = { x0: X0 - span - 12, x1: X0 - span - 1, y0: Y0 - 5, y1: Y0 + 7 };

    const placed: Building[] = [];
    /** a `key` building with its door on a street round one of `rects`, as near `near` as can be (`gap`: tiles of
     *  garden kept clear around it) */
    const place = (key: string, rects: Rect[], near: { x: number; y: number } | null, gap = 0): Building | null => {
      const cands: { x: number; y: number; r: Rect; s: number }[] = [];
      // (the streets round the rect, and any running through it: the road out to the works)
      for (const r of rects)
        for (let y = r.y0 - 1; y <= r.y1 + 1; y++) for (let x = r.x0 - 1; x <= r.x1 + 1; x++)
          if (World.isRoad(x, y)) cands.push({ x, y, r, s: (near ? Math.abs(x - near.x) + Math.abs(y - near.y) : 0) + R() * (near ? 4 : 1000) });
      cands.sort((a, b) => a.s - b.s);
      const fs = [0, 1, 2, 3].sort(() => R() - 0.5);
      for (const c of cands) {
        for (const f of fs) {
          const o = originForDoor(key, f, c.x, c.y), fp = footprint(key, f);
          if (o.x < c.r.x0 || o.y < c.r.y0 || o.x + fp.w - 1 > c.r.x1 || o.y + fp.h - 1 > c.r.y1) continue;
          // (the corners of a block stay open: that's where a crossing's traffic lights stand, and without them a busy
          // four-way crossing can lock solid)
          if ((o.x === c.r.x0 || o.x + fp.w - 1 === c.r.x1) && (o.y === c.r.y0 || o.y + fp.h - 1 === c.r.y1)) continue;
          if (!World.canPlace(key, o.x, o.y, f)) continue;
          if (gap && !clear(o.x - gap, o.y - gap, fp.w + gap * 2, fp.h + gap * 2)) continue;
          const b = World.placeBuilding(key, o.x, o.y, true, f);
          if (b) { placed.push(b); return b; }
        }
      }
      return null;
    };
    const clear = (x: number, y: number, w: number, h: number): boolean => {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (World.inB(x + i, y + j) && World.bmap[World.idx(x + i, y + j)]) return false;
      return true;
    };
    const mid = { x: X0, y: Y0 };
    const blockOf = (i: number): Rect[] => [outer[i % outer.length]];

    if (size === 0) {
      // V2: a hamlet: a crossroads with a shop, a café and a bakery, the church, a stop at either end, a dozen homes
      for (const key of ['cafe', 'shop', 'bakery', 'church', 'busstop', 'busstop']) place(key, centre, mid);
      for (let i = 0; i < 12; i++) place(R() < 0.6 ? 'cottage' : 'house', centre, null, 1);
      place('farm', [fields], { x: X0, y: Y0 + span + 4 });
    } else {
      // round the square: the town hall, the church, the shops, cafés and the market
      for (const key of ['plaza', 'townhall', 'church', 'cafe', 'bakery', 'market', 'restaurant', 'bank', 'pharmacy', 'library', 'postoffice',
        'florist', 'bookshop', 'icecream', 'barber', 'butcher', 'pizzeria', 'shop', 'tailor', 'taxistand', 'busstop']) place(key, centre, mid);
      // V2: car parks off the square and by the services, for visitors to places with no room of their own
      if (!place('carpark', centre, mid)) place('carpark', outer, mid);
      place('carpark', outer, mid);
      // the streets beyond: services spread round the blocks, a stop at either end of the line
      const services = ['school', 'hospital', 'police', 'fire', 'park', 'cinema', 'gym', 'park', 'playground', 'temple', 'watertower', 'shop', 'cafe', 'busstop', 'busstop', 'hotel'];
      // (V2: a town has more of them, and a college, a theatre, a museum, a department store, more car parks)
      if (size >= 2) services.push('college', 'theater', 'museum', 'deptstore', 'courthouse', 'pool', 'cafe', 'restaurant', 'shop', 'busstop', 'busstop', 'carpark', 'carpark', 'park', 'school');
      services.forEach((key, i) => place(key, blockOf(i * 5 + (seed & 7)), null) || place(key, outer, null));
      // homes with gardens fill the rest: a mansion on a corner, a few blocks of flats, houses and cottages
      place('mansion', [outer[(seed >> 3) % outer.length]], null, 1);
      for (let i = 0; i < (size >= 2 ? 6 : 3); i++) place('apartment', outer, null, 1);
      for (let i = 0; i < (size >= 2 ? 70 : 46); i++) place(R() < 0.75 ? 'house' : 'cottage', [...outer, ...centre], null, 1);
      // the works out east, the farms to the south, a gas station at the gate
      // (a power plant of its own: a village this size is more than the county's line can carry)
      for (const key of ['powerplant', 'sawmill', 'brickworks', 'warehouse', ...(size >= 2 ? ['factory', 'textilemill'] : [])]) place(key, [works], { x: X0 + span, y: Y0 });
      for (let i = 0; i < (size >= 2 ? 3 : 2); i++) place('farm', [fields], { x: X0, y: Y0 + span + 4 });
      place('gas', [gate], { x: X0 - span, y: Y0 });
    }
    // V2: a town's railway: stations north of the grid, joined by a line that crosses the highway on a level crossing
    if (size >= 2) this.railway(X0, Y0 - span - 9, span, placed);
    // V2: the full town: the harbour and its ferry, the airport, the heliport, and one of every kind of building there
    // is, each on a street (or a lane laid to it)
    if (size === 3) {
      this.harbour(X0, Y0, placed);
      const air = this.anywhere('airport', { x: X0, y: Y0 + span + 30 }, 90);
      if (air) placed.push(air);
      const have = new Set(placed.map((b) => b.type));
      for (const key of Object.keys(CAT)) {
        const d = CAT[key];
        if (!d.building || d.cat === 'hidden' || have.has(key) || d.needsWater) continue;
        const b = place(key, outer, null) || place(key, [works, fields], null) || this.anywhere(key, mid, 60);
        if (b) { if (!placed.includes(b)) placed.push(b); have.add(key); }
      }
    }

    /* ---------- trees: gardens, the verges, and the edge of the village ---------- */
    const nearRoad = (x: number, y: number): boolean => World.isRoad(x + 1, y) || World.isRoad(x - 1, y) || World.isRoad(x, y + 1) || World.isRoad(x, y - 1);
    for (let y = Y0 - span - 6; y <= Y0 + span + 8; y++) for (let x = X0 - span - 6; x <= X0 + span + 8; x++) {
      if (!open(x, y) || World.roadMap[World.idx(x, y)] || nearRoad(x, y)) continue;
      const inside = Math.abs(x - X0) <= span && Math.abs(y - Y0) <= span;
      if (R() < (inside ? 0.2 : 0.3)) World.tree[World.idx(x, y)] = 1 + Math.floor(R() * 6);
    }

    /* ---------- move in, open up ---------- */
    // (the places open first so the families arriving find work)
    const homes = placed.filter((b) => CAT[b.type].res), rest = placed.filter((b) => !CAT[b.type].res);
    for (const b of rest) {
      Sim.onBuildingAdded(b);
      b.funds = Economy.openingCapital(b); // (its till stocked to open with, as the Founder's own places are)
    }
    for (const b of homes) {
      if (b.type === 'house') b.level = R() < 0.12 ? 3 : R() < 0.35 ? 2 : 1;
      Sim.onBuildingAdded(b);
    }
    Gov.treasury = 1200; // the county's grant to a new village, so its services pay their staff from the first day
    Economy.budgets();
    Sim.clock = 7 * 60 + 30; // a morning, the commute just starting
    Game.afterMapEdit();
    Life.busT = 0; // the bus line, at once

    const sights = placed.filter((b) => ['plaza', 'school', 'market', 'park', 'hospital', 'church', 'farm', 'sawmill', 'cinema', 'trainstation', 'airport', 'dock', 'stadium'].includes(b.type))
      .map((b) => ({ x: (b.x + b.w / 2) * 8, z: (b.y + b.h / 2) * 8, label: CAT[b.type].name }));
    return { name, centre: { x: X0 * 8 + 8, z: Y0 * 8 + 8 }, sights };
  },

  /** V2: a finished `key` building as near (cx, cy) as there's room (within `r` tiles), on a street or with a lane laid
   *  to one; null if it won't go */
  anywhere(key: string, near: { x: number; y: number }, r: number): Building | null {
    for (let d = 0; d < r; d++)
      for (let t = 0; t < 32; t++) {
        const x = Math.round(near.x + Math.cos(t) * d), y = Math.round(near.y + Math.sin(t) * d);
        for (let f = 0; f < 4; f++) {
          if (!World.canPlace(key, x, y, f)) continue;
          const b = World.placeBuilding(key, x, y, true, f);
          if (b && b.connected) return b;
          if (b) World.removeBuilding(b); // (no way to a street from there)
        }
      }
    return null;
  },

  /** V2: three stations along row y, west, middle and east of the town, joined into one line by track along their
   *  backs (it crosses the highway coming in from the north: a level crossing) */
  railway(X0: number, y: number, span: number, placed: Building[]): void {
    const st: Building[] = [];
    for (const x of [X0 - span + 4, X0 + 10, X0 + span + 4]) {
      const b = this.anywhere('trainstation', { x, y }, 12);
      if (b) { st.push(b); placed.push(b); }
    }
    st.sort((a, b) => a.x - b.x);
    // (from the side of one station to the side of the next, along the line)
    const ends = (s: Building): number[][] => [[s.x + s.w, s.y + 1], [s.x - 1, s.y + 1], [s.x + 1, s.y - 1], [s.x + 1, s.y + s.h]];
    for (let i = 0; i + 1 < st.length; i++) {
      let done = false;
      for (const p of ends(st[i])) {
        for (const q of ends(st[i + 1])) if (World.connectRail(p[0], p[1], q[0], q[1]) >= 0) { done = true; break; }
        if (done) break;
      }
    }
  },

  /** V2: two docks on the nearest stretch of open water, far enough apart for a ferry between them, with a fish market
   *  and a boat club on the shore */
  harbour(X0: number, Y0: number, placed: Building[]): void {
    const a = this.anywhere('dock', { x: X0, y: Y0 }, 110);
    if (!a) return;
    placed.push(a);
    // (the second along the same water, a good way off)
    for (let d = 14; d < 70; d += 4) {
      let b: Building | null = null;
      for (let t = 0; t < 24 && !b; t++) {
        const x = Math.round(a.x + Math.cos((t / 24) * Math.PI * 2) * d), y = Math.round(a.y + Math.sin((t / 24) * Math.PI * 2) * d);
        for (let f = 0; f < 4 && !b; f++) if (World.canPlace('dock', x, y, f)) { b = World.placeBuilding('dock', x, y, true, f); if (b && !b.connected) { World.removeBuilding(b); b = null; } }
      }
      if (b) { placed.push(b); break; }
    }
    for (const key of ['fishmarket', 'boatclub']) { const b = this.anywhere(key, { x: a.x, y: a.y }, 30); if (b) placed.push(b); }
  },
};

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

export const AutoVillage = {
  /** found a brand-new village and fill it; returns where to look */
  build(seed = (Math.random() * 1e9) | 0): AutoPlan {
    const R = mulberry32(seed ^ 0x5eed);
    const pick = <T>(a: T[]): T => a[Math.floor(R() * a.length)];
    const name = pick(NAMES);
    Game.newMap(name, 'sandbox', seed, true);
    const X0 = World.highway?.north?.x ?? GW >> 1, Y0 = World.highway?.west?.y ?? GH >> 1;
    const span = BLOCK * 2;

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
    for (let k = -2; k <= 2; k++) {
      row(Y0 + k * BLOCK, X0 - span, X0 + span + 1);
      col(X0 + k * BLOCK, Y0 - span, Y0 + span + 1);
    }
    // out east to the works, out south to the farms
    row(Y0, X0 + span, X0 + span + 24);
    col(X0, Y0 + span, Y0 + span + 18);

    /* ---------- the blocks ---------- */
    const blocks: (Rect & { ring: number })[] = [];
    for (let bj = -2; bj < 2; bj++) for (let bi = -2; bi < 2; bi++) {
      blocks.push({ x0: X0 + bi * BLOCK + 2, x1: X0 + (bi + 1) * BLOCK - 1, y0: Y0 + bj * BLOCK + 2, y1: Y0 + (bj + 1) * BLOCK - 1, ring: Math.max(Math.abs(bi + 0.5), Math.abs(bj + 0.5)) });
    }
    const centre = blocks.filter((b) => b.ring < 1), outer = blocks.filter((b) => b.ring > 1);
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

    // round the square: the town hall, the church, the shops, cafés and the market
    for (const key of ['plaza', 'townhall', 'church', 'cafe', 'bakery', 'market', 'restaurant', 'bank', 'pharmacy', 'library', 'postoffice',
      'florist', 'bookshop', 'icecream', 'barber', 'butcher', 'pizzeria', 'shop', 'tailor', 'taxistand', 'busstop']) place(key, centre, mid);
    // the streets beyond: services spread round the blocks, a stop at either end of the line
    const services = ['school', 'hospital', 'police', 'fire', 'park', 'cinema', 'gym', 'park', 'playground', 'temple', 'watertower', 'shop', 'cafe', 'busstop', 'busstop', 'hotel'];
    services.forEach((key, i) => place(key, blockOf(i * 5 + (seed & 7)), null) || place(key, outer, null));
    // homes with gardens fill the rest: a mansion on a corner, a few blocks of flats, houses and cottages
    place('mansion', [outer[(seed >> 3) % outer.length]], null, 1);
    for (let i = 0; i < 3; i++) place('apartment', outer, null, 1);
    for (let i = 0; i < 46; i++) place(R() < 0.75 ? 'house' : 'cottage', [...outer, ...centre], null, 1);
    // the works out east, the farms to the south, a gas station at the gate
    // (a power plant of its own: a village this size is more than the county's line can carry)
    for (const key of ['powerplant', 'sawmill', 'brickworks', 'warehouse']) place(key, [works], { x: X0 + span, y: Y0 });
    for (let i = 0; i < 2; i++) place('farm', [fields], { x: X0, y: Y0 + span + 4 });
    place('gas', [gate], { x: X0 - span, y: Y0 });

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

    const sights = placed.filter((b) => ['plaza', 'school', 'market', 'park', 'hospital', 'church', 'farm', 'sawmill', 'cinema'].includes(b.type))
      .map((b) => ({ x: (b.x + b.w / 2) * 8, z: (b.y + b.h / 2) * 8, label: CAT[b.type].name }));
    return { name, centre: { x: X0 * 8 + 8, z: Y0 * 8 + 8 }, sights };
  },
};

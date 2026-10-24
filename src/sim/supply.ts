/* ============================================================
   The supply chain (V2, design §9.2).
   Four goods keep it readable: food, materials, textiles and
   products. Producers make them while their staff are on shift
   (farms slow in winter and drought, nothing runs in a blackout)
   and pile them in the yard. Delivery trucks, visible in the
   traffic, carry loads to the shops that sell them, to the
   warehouse, and to building sites. A shop sells from its
   shelves: scarce stock costs more, empty shelves sell nothing
   and send customers home disappointed. Building eats
   materials: a site that runs out stands idle until a load
   arrives. What the town can't make comes in from off the map
   (dearer, and only so much a day); the freight train brings
   bulk to the station and takes surpluses away; full yards
   export by road. The tickers feel all of it.
   ============================================================ */
import { CAT } from './catalog';
import { MIN_PER_SEC, T } from './core';
import { World } from './world';
import { Sim } from './agents';
import { Life } from './life';
import { Weather } from './weather';
import { Calamity } from './calamity';
import { Tasks } from './tasks';
import { News } from './news';
import { Gov } from './gov';
import { Mind } from './mind';
import { Power, nearlyThere } from './power';
import { Traffic } from './traffic';

export type Good = 'food' | 'mats' | 'tex' | 'prod';
export const GOODS: Record<Good, { name: string; emoji: string; color: string; unit: number }> = {
  food: { name: 'Food', emoji: '🥕', color: '#5a9a4a', unit: 2 },
  mats: { name: 'Materials', emoji: '🧱', color: '#a8643a', unit: 3 },
  tex: { name: 'Textiles', emoji: '🧶', color: '#8a5ac8', unit: 3 },
  prod: { name: 'Products', emoji: '📦', color: '#3a6ab8', unit: 4 },
};
export const GOOD_KEYS: Good[] = ['food', 'mats', 'tex', 'prod'];

/** producers: what they make, per worker on shift per hour */
export const MAKES: Record<string, { g: Good; rate: number }> = {
  farm: { g: 'food', rate: 1.6 }, cannery: { g: 'food', rate: 2 }, fishmarket: { g: 'food', rate: 1.4 }, bakery: { g: 'food', rate: 1.4 },
  sawmill: { g: 'mats', rate: 1.8 }, brickworks: { g: 'mats', rate: 1.8 }, steelworks: { g: 'mats', rate: 1.4 }, glassworks: { g: 'mats', rate: 1.6 },
  textilemill: { g: 'tex', rate: 1.6 }, factory: { g: 'prod', rate: 1.6 },
};
/** sellers: the good on their shelves, and how much the shelves hold */
export const SELLS: Record<string, { g: Good; cap: number }> = {
  shop: { g: 'food', cap: 30 }, market: { g: 'food', cap: 60 }, restaurant: { g: 'food', cap: 30 }, cafe: { g: 'food', cap: 24 },
  bakery: { g: 'food', cap: 24 }, butcher: { g: 'food', cap: 24 }, pizzeria: { g: 'food', cap: 24 }, icecream: { g: 'food', cap: 20 },
  teastall: { g: 'food', cap: 12 }, fishmarket: { g: 'food', cap: 24 }, hotel: { g: 'food', cap: 40 }, florist: { g: 'food', cap: 16 },
  burgerpalace: { g: 'food', cap: 36 }, goldenarches: { g: 'food', cap: 36 }, crispycluck: { g: 'food', cap: 36 }, tacobelle: { g: 'food', cap: 36 }, pizzapalace: { g: 'food', cap: 36 },
  hardware: { g: 'mats', cap: 30 }, furniture: { g: 'mats', cap: 30 },
  tailor: { g: 'tex', cap: 24 }, deptstore: { g: 'tex', cap: 60 },
  electronics: { g: 'prod', cap: 30 }, toyshop: { g: 'prod', cap: 24 }, jeweler: { g: 'prod', cap: 16 }, petshop: { g: 'prod', cap: 24 },
  bookshop: { g: 'prod', cap: 24 }, pharmacy: { g: 'prod', cap: 30 }, mall: { g: 'prod', cap: 70 },
};
/** a producer's yard holds this much before work stops */
export const YARD = 90;
/** a warehouse holds this much of everything together; the station's goods shed less */
export const STORE_CAP: Record<string, number> = { warehouse: 300, trainstation: 160 };
/** what a truck carries */
export const LOAD = 20;
/** what comes in from off the map each day without a railway */
export const IMPORTS: Record<Good, number> = { food: 60, mats: 40, tex: 30, prod: 40 };
const TRUCK_SPEED = 1.3; // tiles/s, ~37 km/h with a load

const now = (): number => Sim.day * 1440 + Sim.clock;
const active = (b: any): boolean => b.connected && !b.construction && !b.ruined;
const near = (a: any, b: any): number => Math.abs(a.door.x - b.door.x) + Math.abs(a.door.y - b.door.y);
const selfMade = (type: string): boolean => !!MAKES[type] && !!SELLS[type];

export const Supply = {
  /** what can still come in from off the map today */
  allow: { ...IMPORTS } as Record<Good, number>,
  /** game-minutes each good has gone wanting lately */
  short: { food: 0, mats: 0, tex: 0, prod: 0 } as Record<Good, number>,
  /** goods going wanting right now (announced once per episode) */
  wanting: new Set<Good>(),
  made: { food: 0, mats: 0, tex: 0, prod: 0 } as Record<Good, number>,
  sold: { food: 0, mats: 0, tex: 0, prod: 0 } as Record<Good, number>,
  emptyVisits: 0,
  prodT: 0,
  dispT: 0,
  stallSaid: 0,

  reset(): void {
    this.allow = { ...IMPORTS };
    this.short = { food: 0, mats: 0, tex: 0, prod: 0 };
    this.wanting.clear();
    this.made = { food: 0, mats: 0, tex: 0, prod: 0 };
    this.sold = { food: 0, mats: 0, tex: 0, prod: 0 };
    this.emptyVisits = 0;
    this.prodT = 0; this.dispT = 0; this.stallSaid = 0;
    Life.trucks = [];
  },

  /** opening stock for a shop, an empty yard for a producer */
  init(b: any): void {
    if (b.stock !== undefined) return;
    const s = SELLS[b.type];
    b.stock = s ? Math.round(s.cap * 0.6) : MAKES[b.type] ? 0 : undefined;
    if (STORE_CAP[b.type] && !b.store) b.store = { food: 0, mats: 0, tex: 0, prod: 0 };
  },
  /** a building site's materials: the builders bring the first loads with them */
  initSite(b: any): void {
    if (b.matsNeed !== undefined) return;
    b.matsNeed = Math.round(8 + b.w * b.h * 2.5);
    const total = b.conTotal || b.construction || 1;
    b.matsUsed = b.matsNeed * Math.max(0, 1 - b.construction / total);
    b.mats = Math.min(b.matsNeed - b.matsUsed, Math.ceil(b.matsNeed * 0.4));
    b.stalled = false;
  },
  storeUsed(b: any): number {
    return b.store ? b.store.food + b.store.mats + b.store.tex + b.store.prod : 0;
  },

  /* ---------- shops: selling from the shelves ---------- */
  /** price multiplier: full shelves sell at list price, thin ones dearer */
  priceMult(b: any): number {
    const s = SELLS[b.type];
    if (!s) return 1;
    this.init(b);
    const r = b.stock / s.cap;
    return r >= 0.4 ? 1 : 1 + (0.4 - r);
  },
  /** a customer at the counter: the price multiplier, or null for empty shelves */
  sale(b: any, p?: any): number | null {
    const s = SELLS[b.type];
    if (!s) return 1;
    this.init(b);
    if (b.stock < 1) {
      b.emptyToday = (b.emptyToday || 0) + 1;
      this.emptyVisits++;
      if (p) {
        p.mood = Math.max(5, (p.mood ?? 60) - 2);
        p.bubble = '😞'; p.bubbleUntil = performance.now() + 2500;
        if (Math.random() < 0.2) Mind.remember(p, 'shortage', `found the shelves bare at the ${CAT[b.type].name.toLowerCase()}`, -1, b.id);
      }
      return null;
    }
    const m = this.priceMult(b);
    b.stock -= 1;
    this.sold[s.g] += 1;
    return m;
  },
  /** what the counter shows the Founder: "In stock", "Running low", "Sold out" */
  shelf(b: any): { label: string; empty: boolean; mult: number } | null {
    const s = SELLS[b.type];
    if (!s) return null;
    this.init(b);
    const r = b.stock / s.cap;
    return { label: b.stock < 1 ? 'Sold out' : r < 0.25 ? 'Running low' : r < 0.6 ? 'Some on the shelves' : 'Well stocked', empty: b.stock < 1, mult: this.priceMult(b) };
  },

  /* ---------- building sites ---------- */
  /** `work` minutes of building at site `b`: returns the work actually done (materials allowing) */
  build(b: any, work: number): number {
    this.initSite(b);
    const per = b.matsNeed / Math.max(1, b.conTotal || 1);
    const left = b.matsNeed - b.matsUsed;
    if (left <= 0.05) { if (b.stalled) this.resume(b); return work; } // every brick is in: only finishing work left
    if (b.stalled && b.mats < Math.min(1, left)) return 0; // crumbs don't restart a stalled site: a delivery does
    const need = Math.min(work * per, left);
    if (b.mats >= need) {
      b.mats -= need;
      b.matsUsed += need;
      if (b.stalled) this.resume(b);
      return work;
    }
    if (b.mats > 0.01) {
      const k = b.mats / need;
      b.matsUsed += b.mats;
      b.mats = 0;
      return work * k;
    }
    if (!b.stalled) {
      b.stalled = true;
      b.stalledAt = now();
      Tasks.add('mats' + b.id, '🧱', `Get materials to the ${CAT[b.type].name} site`);
      if (now() - this.stallSaid > 30) {
        this.stallSaid = now();
        Life.say(`⏸️ Work stopped on the ${CAT[b.type].name} site — the builders are waiting for materials`, { x: b.door.x * T + 8, y: b.door.y * T + 8 });
      }
    }
    return 0;
  },
  resume(b: any): void {
    b.stalled = false;
    Tasks.done('mats' + b.id, true, `Materials reached the ${CAT[b.type].name} site`);
    if (now() - (b.stalledAt || 0) > 20) Life.say(`🧱 Materials arrived — work resumes on the ${CAT[b.type].name}`);
  },
  /** materials a site still needs brought (beyond what's on site and on the way) */
  siteWant(b: any): number {
    this.initSite(b);
    return Math.max(0, b.matsNeed - b.matsUsed - b.mats - this.incoming(b));
  },

  /* ---------- trucks ---------- */
  incoming(b: any): number {
    let n = 0;
    for (const t of Life.trucks) if (t.to === b && t.phase === 'go') n += t.n;
    return n;
  },
  /** where a load of `g` can come from for `to`: a producer's yard, the warehouse, the station's shed */
  source(g: Good, to: any, n: number): any {
    let best: any = null, bd = 1e9;
    for (const b of World.buildings) {
      if (b === to || !active(b)) continue;
      let have = 0;
      if (MAKES[b.type] && MAKES[b.type].g === g && !selfMade(b.type)) have = b.stock || 0;
      else if (b.store) have = b.store[g] || 0;
      if (have < Math.min(6, n)) continue;
      const d = near(b, to);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  },
  edgePath(to: any, outward = false): number[][] | null {
    const edges = (Life.edgeRoads || []).slice().sort((a: number[], b: number[]) => (Math.abs(a[0] - to.door.x) + Math.abs(a[1] - to.door.y)) - (Math.abs(b[0] - to.door.x) + Math.abs(b[1] - to.door.y)));
    for (const [ex, ey] of edges.slice(0, 5)) {
      const r = outward ? World.roadPath(to.door.x, to.door.y, ex, ey) : World.roadPath(ex, ey, to.door.x, to.door.y);
      if (r && r.length >= 2) return r;
    }
    return null;
  },
  /** send a truck along `path` carrying `n` of `g` to `to` (from `from`, or null for off the map) */
  send(kind: 'deliver' | 'import' | 'export' | 'haul', g: Good, n: number, path: number[][], to: any, from: any): void {
    if (path.length < 2) path = [path[0], path[0]];
    const [sx, sy] = path[0];
    Life.trucks.push({ path, prog: 0, x: sx * T + 8, y: sy * T + 8, dirx: 1, diry: 0, phase: 'go', kind, g, n, to, from, t: 0, seed: (Math.random() * 1e6) | 0 });
  },
  maxTrucks(): number {
    let k = 3;
    for (const b of World.buildings) if (active(b) && (MAKES[b.type] || STORE_CAP[b.type])) k++;
    return Math.min(16, k);
  },

  /** every quarter hour: shops and sites that are running low get a load */
  dispatch(): void {
    if (Life.trucks.length >= this.maxTrucks()) return;
    const needs: { b: any; g: Good; n: number; prio: number; site: boolean }[] = [];
    for (const b of World.buildings) {
      if (!b.connected || b.ruined) continue;
      if (b.construction > 0) {
        const want = this.siteWant(b);
        if (want > 0 && b.mats < Math.max(6, b.matsNeed * 0.25)) needs.push({ b, g: 'mats', n: want, prio: b.stalled ? 3 : 2, site: true });
        continue;
      }
      const s = SELLS[b.type];
      if (!s || selfMade(b.type)) continue;
      this.init(b);
      const have = b.stock + this.incoming(b);
      if (have < s.cap * 0.45) needs.push({ b, g: s.g, n: s.cap - have, prio: 1 + (1 - b.stock / s.cap), site: false });
    }
    needs.sort((a, b) => b.prio - a.prio);
    const wanting = new Set<Good>();
    for (const nd of needs) {
      if (Life.trucks.length >= this.maxTrucks()) break;
      const n = Math.min(LOAD, Math.ceil(nd.n));
      const src = this.source(nd.g, nd.b, n);
      if (src) {
        const path = World.roadPath(src.door.x, src.door.y, nd.b.door.x, nd.b.door.y);
        if (path) {
          const take = Math.min(n, Math.floor(src.store ? src.store[nd.g] : src.stock));
          if (src.store) src.store[nd.g] -= take; else src.stock -= take;
          this.send('deliver', nd.g, take, path, nd.b, src);
          continue;
        }
      }
      // nothing in town: bring it in from off the map, while today's allowance lasts
      if (this.allow[nd.g] >= 4) {
        const path = this.edgePath(nd.b);
        if (path) {
          const take = Math.min(n, Math.floor(this.allow[nd.g]));
          this.allow[nd.g] -= take;
          this.send('import', nd.g, take, path, nd.b, null);
          continue;
        }
      }
      wanting.add(nd.g);
    }
    this.track(wanting);
    // full yards: haul to the warehouse, ship by rail, or export by road
    for (const b of World.buildings) {
      if (Life.trucks.length >= this.maxTrucks()) break;
      const m = MAKES[b.type];
      if (!m || selfMade(b.type) || !active(b) || (b.stock || 0) < YARD * 0.7) continue;
      if (Life.trucks.some((t: any) => t.from === b && t.phase === 'go' && t.kind !== 'deliver')) continue;
      const n = Math.min(30, Math.floor(b.stock));
      const shed = World.buildings
        .filter((w: any) => STORE_CAP[w.type] && active(w) && (w.type === 'warehouse' || Life.trains.some((tr: any) => tr.type === 'freight')) && STORE_CAP[w.type] - this.storeUsed(w) >= n)
        .sort((a: any, c: any) => near(a, b) - near(c, b))[0];
      const path = shed ? World.roadPath(b.door.x, b.door.y, shed.door.x, shed.door.y) : this.edgePath(b, true);
      if (!path) continue;
      b.stock -= n;
      this.send(shed ? 'haul' : 'export', m.g, n, path, shed || null, b);
    }
  },

  /** shortages begin and end in the news */
  track(wanting: Set<Good>): void {
    for (const g of GOOD_KEYS) {
      if (wanting.has(g)) {
        this.short[g] += 15;
        if (!this.wanting.has(g) && this.short[g] >= 45) {
          this.wanting.add(g);
          const sites = World.buildings.filter((b: any) => b.construction > 0 && b.stalled).length;
          const fix = g === 'mats' ? 'a sawmill or brickworks would help' : g === 'food' ? 'more farms would help' : g === 'tex' ? 'a textile mill would help' : 'a factory would help';
          Life.say(`${GOODS[g].emoji} ${GOODS[g].name} are short in ${World.name}${g === 'mats' && sites ? ` — ${sites} building site${sites > 1 ? 's' : ''} waiting` : ' — shelves are emptying'}; ${fix}`);
          Tasks.add('short-' + g, GOODS[g].emoji, `Ease the shortage of ${GOODS[g].name.toLowerCase()}`);
          News.breaking(`${GOODS[g].name} shortage hits ${World.name}`);
        }
      } else {
        this.short[g] = Math.max(0, this.short[g] - 15);
        if (this.wanting.has(g) && this.short[g] <= 0) {
          this.wanting.delete(g);
          Life.say(`${GOODS[g].emoji} ${GOODS[g].name} are flowing again — the shortage is over`);
          Tasks.done('short-' + g, true, `The ${GOODS[g].name.toLowerCase()} shortage eased`);
        }
      }
    }
  },

  /** a truck reached the end of its run */
  unload(t: any): void {
    const to = t.to;
    const u = GOODS[t.g as Good].unit;
    if (t.kind === 'export') {
      // sold on the open market, beyond the map's edge
      if (t.from && World.buildings.includes(t.from)) t.from.funds += t.n * u * 0.8;
      Gov.treasury += t.n * u * 0.15;
      return;
    }
    if (!to || !World.buildings.includes(to) || to.ruined) return;
    this.init(to);
    if (to.type === 'trainstation' && t.kind === 'haul') {
      // onto the freight train's next run: sold by rail
      if (t.from && World.buildings.includes(t.from)) t.from.funds += t.n * u * 0.9;
      Gov.treasury += t.n * u * 0.1;
      return;
    }
    if (to.construction > 0) {
      this.initSite(to);
      to.mats += t.n;
      if (t.kind === 'import') Gov.treasury = Math.max(0, Gov.treasury - t.n * u * 0.5);
      else if (t.from && World.buildings.includes(t.from)) t.from.funds += t.n * u * 0.5;
      return;
    }
    if (to.store) {
      to.store[t.g] = (to.store[t.g] || 0) + t.n;
      return;
    }
    const s = SELLS[to.type];
    if (!s) return;
    this.init(to);
    to.stock = Math.min(s.cap, to.stock + t.n);
    // the shop pays wholesale (dearer for imports), as far as its till allows
    const cost = t.n * u * (t.kind === 'import' ? 1 : 0.5);
    const paid = Math.min(cost, Math.max(0, to.funds));
    to.funds -= paid;
    if (t.from && World.buildings.includes(t.from)) t.from.funds += paid;
  },

  /** the freight train calls at a terminus: bulk for the station's goods shed */
  freightCall(station: any): void {
    if (!station || !active(station)) return;
    this.init(station);
    if (!station.store) station.store = { food: 0, mats: 0, tex: 0, prod: 0 };
    let room = STORE_CAP.trainstation - this.storeUsed(station);
    for (const g of GOOD_KEYS) {
      if (room <= 0) break;
      const want = this.short[g] > 0 || this.wanting.has(g) ? 40 : 15;
      const n = Math.max(0, Math.min(room, want - station.store[g]));
      station.store[g] += n;
      room -= n;
      Gov.treasury = Math.max(0, Gov.treasury - n * GOODS[g].unit * 0.25);
    }
  },

  /* ---------- the frame tick ---------- */
  tick(dt: number): void {
    const gm = dt * MIN_PER_SEC;
    for (const t of Life.trucks) {
      if (t.phase === 'go' || t.phase === 'back') {
        const step = Traffic.advance(t, t, t.path, t.prog, 1, TRUCK_SPEED, dt, 0.9);
        t.prog += step;
        Life.followPath(t, t.path, Math.min(t.prog, t.path.length - 1), Traffic.lanePx(t));
        if (nearlyThere(t, step, dt)) {
          if (t.phase === 'back') t.done = true;
          else { t.phase = 'drop'; t.t = 5; }
        }
      } else if (t.phase === 'drop') {
        t.t -= gm;
        if (t.t <= 0) {
          this.unload(t);
          // imports and exports leave the way they came; deliveries go back to the yard
          if (t.kind === 'export') t.done = true;
          else { t.phase = 'back'; t.prog = Math.max(0, t.path.length - 1 - t.prog); t.path = [...t.path].reverse(); }
        }
      }
    }
    if (Life.trucks.length) Life.trucks = Life.trucks.filter((t: any) => !t.done);
    this.prodT += gm;
    if (this.prodT >= 10) { this.produce(this.prodT); this.prodT = 0; }
    this.dispT += gm;
    if (this.dispT >= 15) { this.dispT = 0; this.dispatch(); }
  },

  /** every ten game-minutes: the works on shift fill their yards */
  produce(step: number): void {
    const s = Weather.season;
    for (const b of World.buildings) {
      if (STORE_CAP[b.type] || SELLS[b.type]) this.init(b);
      const m = MAKES[b.type];
      if (!m) continue;
      this.init(b);
      if (!active(b) || Power.isDark(b)) continue;
      let present = 0;
      for (const w of b.workers) if (w.state === 'in' && w.at === b) present++;
      if (!present) continue;
      let rate = m.rate * present * (step / 60);
      if (b.type === 'farm') rate *= (s === 3 ? 0.35 : s === 1 ? 1.2 : 1) * (Calamity.droughtLevel >= 0.6 ? 0.5 : 1);
      if (b.type === 'fishmarket' && s === 3) rate *= 0.3;
      const cap = selfMade(b.type) ? SELLS[b.type].cap : YARD;
      const before = b.stock;
      b.stock = Math.min(cap, b.stock + rate);
      this.made[m.g] += b.stock - before;
    }
    // finished sites keep nothing
    for (const b of World.buildings) if (b.matsNeed !== undefined && !(b.construction > 0)) { delete b.matsNeed; delete b.mats; delete b.matsUsed; b.stalled = false; }
  },

  /** the stock tickers feel the goods: plenty lifts them, shortages sink them */
  marketMood(sym: string): number {
    const sh = (g: Good): number => (this.wanting.has(g) ? 1 : 0);
    if (sym === 'AGRI') return this.made.food > 20 ? 0.01 - sh('food') * 0.04 : -sh('food') * 0.04;
    if (sym === 'INDL') return (this.made.mats + this.made.prod > 30 ? 0.01 : 0) - (sh('mats') + sh('prod')) * 0.025;
    if (sym === 'RETL') {
      const sellers = World.buildings.filter((b: any) => SELLS[b.type] && active(b));
      const bare = sellers.filter((b: any) => (b.stock ?? 1) < 1).length;
      return sellers.length ? -0.05 * (bare / sellers.length) : 0;
    }
    return 0;
  },

  /** once a day: a fresh import allowance (more by rail), the day's numbers reset */
  daily(): void {
    const freight = Life.trains.some((tr: any) => tr.type === 'freight');
    for (const g of GOOD_KEYS) this.allow[g] = IMPORTS[g] * (freight ? 1.5 : 1);
    for (const b of World.buildings) b.emptyToday = 0;
    this.made = { food: 0, mats: 0, tex: 0, prod: 0 };
    this.sold = { food: 0, mats: 0, tex: 0, prod: 0 };
    this.emptyVisits = 0;
  },

  /** the mayor's report: stalled sites, bare shelves, goods going wanting */
  report(): { stalled: number; bare: number; wanting: Good[]; trucks: number } {
    let stalled = 0, bare = 0;
    for (const b of World.buildings) {
      if (b.construction > 0 && b.stalled) stalled++;
      if (SELLS[b.type] && active(b) && (b.stock ?? 1) < 1) bare++;
    }
    return { stalled, bare, wanting: [...this.wanting], trucks: Life.trucks.length };
  },

  serialize(): any {
    return { a: this.allow, s: this.short, w: [...this.wanting] };
  },
  restoreState(s: any): void {
    this.reset();
    if (!s) return;
    if (s.a) Object.assign(this.allow, s.a);
    if (s.s) Object.assign(this.short, s.s);
    for (const g of s.w || []) this.wanting.add(g);
  },
};

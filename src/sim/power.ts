/* ============================================================
   Power & blackouts (V2, design §9.4).
   Every building draws power; every power plant supplies it
   (fully only when staffed, with engineers), and a little comes
   in on the county line along the highway. The grid is modelled
   per district: 32 × 32-tile squares, no wires to lay. When the
   town wants more than it has, districts are cut in turn (rolling
   blackouts; the hospital's district last). Storms bring faults:
   a lightning strike on a substation, a tree on the lines, ice in
   a snowstorm, the tornado's path, the earthquake, a flooded
   substation. A blacked-out district goes dark (windows, signs,
   street lamps and traffic lights), its shops shut, its works
   stop, and families sit by candlelight. A repair crew drives
   out from the power plant (or the county, slowly, from the
   highway) and works on the lines until the lights come back.
   The hospital keeps its own generator.
   ============================================================ */
import { CAT } from './catalog';
import { MIN_PER_SEC, T } from './core';
import { GW, World } from './world';
import { Sim } from './agents';
import { Life } from './life';
import { Weather } from './weather';
import { Calamity } from './calamity';
import { Tasks } from './tasks';
import { News } from './news';
import { Gov } from './gov';
import { Mind } from './mind';
import { Edu } from './education';
import { Traffic, kerbside } from './traffic';
import { Approach } from './approach';

/** tiles per side of a grid district */
export const DIST = 32;
/** districts across the 256-tile map (a literal: GW isn't initialised yet while the sim's modules load in a cycle) */
export const ND = 8;
/** what a fully staffed plant with its engineers supplies */
export const PLANT_CAP = 160;
/** what the county line along the highway brings in (a village always has a little) */
export const COUNTY_CAP = 60;
/** tiles per second for a repair van (~43 km/h) */
const CREW_SPEED = 1.5;
/** a county crew needs this long to set out (game-minutes) */
const COUNTY_DELAY = 60;
/** rolling blackouts move on to the next district this often */
const ROLL_EVERY = 90;

/** units drawn, by type (a family home is 1); everything else draws 1 */
const DEMAND: Record<string, number> = {
  apartment: 4, rowhouse: 2, mansion: 2,
  office: 4, skyscraper: 14, factory: 8, airport: 12, farm: 1, exchange: 4,
  steelworks: 12, sawmill: 5, brickworks: 6, textilemill: 6, cannery: 5, glassworks: 7, warehouse: 2, powerplant: 0,
  market: 4, mall: 8, deptstore: 6, hotel: 5, restaurant: 2, cafe: 1.5, bakery: 2, bank: 2, gas: 1.5,
  school: 3, college: 4, hospital: 6, police: 2, fire: 2, townhall: 3, courthouse: 3, library: 2, tvstation: 4, watertower: 2,
  cinema: 3, theater: 3, museum: 2, gym: 2, pool: 2, stadium: 8, amusement: 6, casino: 4, arcade: 3, zoo: 2,
  park: 0.4, playground: 0.2, plaza: 0.5, grandpark: 0.6,
  trainstation: 3, heliport: 2, dock: 1, busstop: 0.2, taxistand: 0.5,
  burgerpalace: 2, goldenarches: 2, crispycluck: 2, tacobelle: 2, pizzapalace: 2, electronics: 2, carshowroom: 2,
};

/** `founder`: the Founder, on shift at the power plant, took the job (Milestone 6) */
interface Fault { cause: string; since: number; crew: boolean; fixAt?: number; founder?: boolean }

/** at the end of its run, or held up within a tile and a half of it for 3 s (something parked
    on the very spot): a van or truck stops where it is and gets on with the job */
export function nearlyThere(v: any, path: number[][], step: number, dt: number): boolean {
  const left = path.length - 1 - v.prog;
  v.stuck = step < 1e-4 && left < 1.6 ? (v.stuck || 0) + dt : 0;
  if (left > 0.001 && v.stuck <= 3) return false;
  v.stuck = 0;
  return true;
}

const COMPASS = ['eastern', 'south-eastern', 'southern', 'south-western', 'western', 'north-western', 'northern', 'north-eastern'];
const now = (): number => Sim.day * 1440 + Sim.clock;
const hm = (min: number): string => {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
};

export const Power = {
  faults: new Map<number, Fault>(),
  /** districts cut by rolling blackouts right now */
  shed: new Set<number>(),
  /** 1 where a district is dark this moment */
  dark: new Uint8Array(ND * ND),
  /** bumped whenever the dark set changes (the renderer redraws its power map) */
  version: 0,
  demand: 0,
  capacity: 0,
  plantCap: 0,
  overloaded: false,
  rollOffset: 0,
  rollT: 0,
  evalT: 0,
  gloomT: 0,
  flashArmed: true,
  stormT: 0,
  quakeSeen: null as any,
  floodSeen: null as any,
  tornadoHit: new Set<number>(),
  /** outages lately (a fading count: the grievance list and the mayor read it) */
  recent: 0,
  outagesToday: 0,
  /** V2 (Milestone 6): districts whose substation the Founder serviced, until this day */
  serviced: new Map<number, number>(),

  reset(): void {
    this.faults.clear();
    this.serviced.clear();
    this.shed.clear();
    this.dark.fill(0);
    this.version++;
    this.demand = 0; this.capacity = COUNTY_CAP; this.plantCap = 0; this.overloaded = false;
    this.rollOffset = 0; this.rollT = 0; this.evalT = 0; this.gloomT = 0;
    this.flashArmed = true; this.stormT = 0;
    this.quakeSeen = null; this.floodSeen = null; this.tornadoHit.clear();
    this.recent = 0; this.outagesToday = 0;
    World.darkSignals.clear();
    World.darkZone.clear();
    Life.crews = [];
  },

  districtOf(tx: number, ty: number): number {
    const dx = Math.max(0, Math.min(ND - 1, Math.floor(tx / DIST)));
    const dy = Math.max(0, Math.min(ND - 1, Math.floor(ty / DIST)));
    return dy * ND + dx;
  },
  districtOfB(b: any): number {
    return this.districtOf(b.x + (b.w >> 1), b.y + (b.h >> 1));
  },
  tileDark(tx: number, ty: number): boolean {
    return this.dark[this.districtOf(tx, ty)] === 1;
  },
  /** is the building without power? (the hospital runs on its own generator) */
  isDark(b: any): boolean {
    if (!b || b.type === 'hospital') return false;
    return this.dark[this.districtOfB(b)] === 1;
  },
  /** a shop or venue in the dark shuts its doors */
  closed(b: any): boolean {
    return !!CAT[b.type].visit && this.isDark(b);
  },
  demandOf(b: any): number {
    if (b.ruined) return 0;
    if (b.construction > 0) return 0.5;
    const d = CAT[b.type];
    if (d.res === 'family') return b.level || 1;
    return DEMAND[b.type] ?? 1;
  },
  /** the built middle of a district (tile), for crews and names */
  centre(d: number): { x: number; y: number } {
    const x0 = (d % ND) * DIST, y0 = Math.floor(d / ND) * DIST;
    let sx = 0, sy = 0, n = 0;
    for (const b of World.buildings) {
      if (b.ruined || this.districtOfB(b) !== d) continue;
      sx += b.door.x; sy += b.door.y; n++;
    }
    return n ? { x: Math.round(sx / n), y: Math.round(sy / n) } : { x: x0 + DIST / 2, y: y0 + DIST / 2 };
  },
  /** a district in words: "the town centre", "the north-eastern outskirts" */
  where(d: number): string {
    const c = this.centre(d), tc = Gov.townCenter();
    const band = Gov.districtName(c.x, c.y);
    if (band === 'town centre') return 'the town centre';
    const a = Math.atan2(c.y - tc.y, c.x - tc.x);
    const k = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
    return `the ${COMPASS[k]} ${band}`;
  },
  /** districts with anything built in them */
  builtDistricts(): number[] {
    const set = new Set<number>();
    for (const b of World.buildings) if (!b.ruined) set.add(this.districtOfB(b));
    return [...set];
  },

  /* ---------- supply and demand ---------- */
  plantOutput(b: any): number {
    const staff = 0.5 + 0.5 * Math.min(1, b.workers.length / Math.max(1, b.jobs));
    const eng = 0.6 + 0.4 * Edu.ratio(b);
    return PLANT_CAP * staff * eng;
  },
  balance(): void {
    const hour = Sim.clock / 60;
    const load = hour < 6 ? 0.6 : hour >= 18 && hour < 22 ? 1.2 : 1;
    const per = new Map<number, number>();
    let plants = 0;
    for (const b of World.buildings) {
      if (b.type === 'powerplant' && b.connected && !b.construction && !b.ruined) plants += this.plantOutput(b);
      const d = this.districtOfB(b);
      per.set(d, (per.get(d) || 0) + this.demandOf(b) * load);
    }
    this.plantCap = plants;
    this.capacity = COUNTY_CAP + plants;
    let total = 0;
    for (const [d, v] of per) if (!this.faults.has(d)) total += v;
    this.demand = total;
    const over = total > this.capacity;
    if (over !== this.overloaded) {
      this.overloaded = over;
      if (over) {
        this.recent += 1;
        Life.say(`⚡ The grid can't keep up (${Math.round(total)} wanted, ${Math.round(this.capacity)} to give) — rolling blackouts until there's more power`);
        Tasks.add('pw-grid', '⚡', plants ? 'Add power: the grid is overloaded' : 'Build a power plant: the county line can\'t carry the town');
        News.breaking('Rolling blackouts: the grid is overloaded');
      } else {
        Life.say('💡 The grid has enough power again — the rolling blackouts are over');
        Tasks.done('pw-grid', true, 'The grid caught up with the town');
      }
    }
    // rolling blackouts: cut districts in turn until the rest fits (the hospital's last)
    this.shed.clear();
    if (over) {
      const hosp = new Set(World.buildings.filter((b: any) => b.type === 'hospital' && !b.ruined).map((b: any) => this.districtOfB(b)));
      const list = [...per.keys()].filter((d) => !this.faults.has(d) && (per.get(d) || 0) > 0).sort((a, b) => a - b);
      const order = list.map((_, i) => list[(i + this.rollOffset) % list.length]).sort((a, b) => Number(hosp.has(a)) - Number(hosp.has(b)));
      let left = total;
      for (const d of order) {
        if (left <= this.capacity * 0.98) break;
        this.shed.add(d);
        left -= per.get(d) || 0;
      }
    }
    this.refreshDark();
  },

  /** recompute which districts are dark; the signals and the renderer follow */
  signalStamp: -1,
  refreshDark(): void {
    let changed = World.derivedStamp !== this.signalStamp; // the junctions themselves changed
    this.signalStamp = World.derivedStamp;
    for (let d = 0; d < ND * ND; d++) {
      const v = this.faults.has(d) || this.shed.has(d) ? 1 : 0;
      if (this.dark[d] !== v) { this.dark[d] = v; changed = true; }
    }
    if (!changed) return;
    this.version++;
    World.darkSignals.clear();
    World.darkZone.clear();
    for (const i of World.signals as Set<number>) {
      const tx = i % GW, ty = Math.floor(i / GW);
      if (!this.dark[this.districtOf(tx, ty)]) continue;
      World.darkSignals.add(i);
      for (let j = -2; j <= 2; j++) for (let k = -2; k <= 2; k++) if (World.inB(tx + k, ty + j)) World.darkZone.add(World.idx(tx + k, ty + j));
    }
  },

  /* ---------- faults and the crews that fix them ---------- */
  fault(d: number, cause: string): boolean {
    if (d < 0 || this.faults.has(d) || this.faults.size >= 3) return false;
    if (!World.buildings.some((b: any) => !b.ruined && this.districtOfB(b) === d)) return false;
    this.faults.set(d, { cause, since: now(), crew: false });
    this.recent += 1;
    this.outagesToday++;
    this.refreshDark();
    const crew = this.dispatchCrew(d);
    const where = this.where(d);
    const c = this.centre(d);
    Life.say(`⚡ Power cut in ${where} — ${cause}. ${crew === 'plant' ? 'A repair crew is on its way from the power plant.' : crew === 'county' ? 'No power plant in town: the county is sending a crew from the highway.' : 'Nobody can reach the lines — it will take the county hours.'}`, { x: c.x * T + 8, y: c.y * T + 8 });
    Tasks.add('pw' + d, '⚡', `Get the lights back on in ${where}`);
    News.breaking(`Power cut in ${where}`);
    return true;
  },

  /** send a van to district `d`: 'plant', 'county', or null when no road reaches it */
  dispatchCrew(d: number): 'plant' | 'county' | null {
    const f = this.faults.get(d);
    if (!f) return null;
    // V2 (Milestone 6): the Founder, on shift at the plant, takes the van out
    if (Life.claim && Life.claim('power', d)) { f.crew = true; f.founder = true; return 'plant'; }
    f.founder = false;
    const c = this.centre(d);
    const spot = World.nearestRoad(c.x, c.y, 10);
    if (!spot) { f.fixAt = now() + 240; return null; }
    let path: number[][] | null = null, county = false;
    for (const p of World.buildings) {
      if (p.type !== 'powerplant' || !p.connected || p.construction || p.ruined) continue;
      const r = World.roadPath(p.door.x, p.door.y, spot.x, spot.y);
      if (r && (!path || r.length < path.length)) path = r;
    }
    if (!path) {
      // the county's crew comes in off the map edge
      let best: number[][] | null = null;
      const edges = (Life.edgeRoads || []).slice().sort((a: number[], b: number[]) => (Math.abs(a[0] - spot.x) + Math.abs(a[1] - spot.y)) - (Math.abs(b[0] - spot.x) + Math.abs(b[1] - spot.y)));
      for (const [ex, ey] of edges.slice(0, 6)) {
        const r = World.roadPath(ex, ey, spot.x, spot.y);
        if (r && (!best || r.length < best.length)) best = r;
      }
      path = best;
      county = true;
    }
    if (!path) { f.fixAt = now() + 240; return null; }
    if (path.length < 2) path = [path[0], path[0]];
    path = kerbside(path); // (V2: it works from the near row of an avenue, in line with the traffic)
    f.crew = true;
    const [sx, sy] = path[0];
    Life.crews.push({ path, prog: 0, x: sx * T + 8, y: sy * T + 8, dirx: 1, diry: 0, phase: county ? 'wait' : 'go', t: county ? COUNTY_DELAY : 0, d, county, seed: (d * 97 + Sim.day) >>> 0 });
    return county ? 'county' : 'plant';
  },

  restore(d: number, by: string): void {
    const f = this.faults.get(d);
    if (!f) return;
    this.faults.delete(d);
    this.refreshDark();
    const where = this.where(d);
    Life.say(`💡 The lights are back on in ${where} — ${by} after ${hm(now() - f.since)} in the dark`);
    Tasks.done('pw' + d, true, `Power restored in ${where}`);
    this.evalT = 99; // rebalance at once: the district draws again
  },

  /* ---------- the frame tick ---------- */
  tick(dt: number): void {
    const gm = dt * MIN_PER_SEC;
    this.storms(gm);
    // repair vans
    for (const c of Life.crews) {
      if (Approach.away(c)) continue; // (V2: out on the road beyond the map's edge)
      if (c.phase === 'wait') {
        c.t -= gm;
        // (V2: the county's van drives in along the road from beyond the map's edge: sim/approach.ts)
        if (c.t <= 0) { c.phase = 'go'; if (c.county) Approach.arrive(c, c.path, 0.7); }
      } else if (c.phase === 'go' || c.phase === 'back') {
        const step = Traffic.advance(c, c, c.path, c.prog, 1, CREW_SPEED, dt, 0.7);
        c.prog += step;
        Life.followPath(c, c.path, Math.min(c.prog, c.path.length - 1), Traffic.lanePx(c));
        if (nearlyThere(c, c.path, step, dt)) {
          if (c.phase === 'back') { if (!(c.county && Approach.depart(c, c.path, 0.7))) c.done = true; }
          else if (!this.faults.has(c.d)) { c.phase = 'back'; c.path = Life.backPath(c.path, c.prog); c.prog = 0; }
          else { c.phase = 'fix'; c.t = 40 + Math.random() * 35; }
        }
      } else if (c.phase === 'fix') {
        c.t -= gm;
        if (c.t <= 0 && !c.mended) {
          c.mended = true;
          this.restore(c.d, c.county ? "the county's crew mended the lines" : 'the repair crew mended the lines');
        }
        // V2: it turns round once there's room in the lane it pulls out into (it used to jump into whatever was there)
        if (c.mended) {
          const back = (c.turn ??= Life.backPath(c.path, c.prog));
          if (Traffic.roomToJoin(c, back, c.t < -20) || c.t < -120) { c.phase = 'back'; c.path = back; c.prog = 0; c.turn = null; }
        }
      }
    }
    if (Life.crews.length) Life.crews = Life.crews.filter((c: any) => !c.done);
    // faults waiting on a crew, or on the county's own good time
    for (const [d, f] of this.faults) {
      if (f.fixAt !== undefined && now() >= f.fixAt) this.restore(d, 'the county got to it at last');
      else if (!f.crew && f.fixAt === undefined) this.dispatchCrew(d);
      else if (f.crew && !f.founder && !Life.crews.some((c: any) => c.d === d)) { f.crew = false; } // the van was lost: send another
    }
    // the balance of the grid, every ten game-minutes; rolling blackouts move on
    this.evalT += gm;
    this.rollT += gm;
    if (this.rollT >= ROLL_EVERY) { this.rollT = 0; this.rollOffset++; if (this.overloaded) this.evalT = 99; }
    if (this.evalT >= 10) { this.evalT = 0; this.balance(); }
    // sitting in the dark: evenings by candlelight
    this.gloomT += gm;
    if (this.gloomT >= 30) {
      this.gloomT = 0;
      const night = Sim.clock < 360 || Sim.clock > 1110;
      if (night && this.dark.some((v) => v)) {
        for (const p of Sim.people) {
          if (p.state !== 'in' || p.at !== p.home || !this.isDark(p.home)) continue;
          p.mood = Math.max(5, (p.mood ?? 60) - 0.8);
          if (p.darkDay !== Sim.day) { p.darkDay = Sim.day; if (Math.random() < 0.3) Mind.remember(p, 'blackout', 'sat through a power cut by candlelight', -1); }
        }
      }
    }
  },

  /** storms, snow, the tornado, the earthquake and floods break the lines */
  storms(gm: number): void {
    const built = this.builtDistricts();
    if (!built.length) return;
    // (a substation serviced this week mostly shrugs it off: -1 is no fault at all)
    const pick = (): number => {
      const d = built[(Math.random() * built.length) | 0];
      return (this.serviced.get(d) ?? 0) > Sim.day && Math.random() < 0.65 ? -1 : d;
    };
    // a lightning flash: sometimes it was a substation
    if (Weather.flash > 0.4 && this.flashArmed) {
      this.flashArmed = false;
      if (Math.random() < 0.18) this.fault(pick(), 'lightning struck a substation');
    }
    if (Weather.flash <= 0.05) this.flashArmed = true;
    this.stormT += gm;
    if (this.stormT >= 1) {
      const k = this.stormT;
      this.stormT = 0;
      if (Weather.kind === 'heavy' && Weather.intensity > 0.75 && Math.random() < 0.0018 * k) this.fault(pick(), 'a falling tree brought the lines down');
      if (Weather.kind === 'snow' && Weather.intensity > 0.7 && Math.random() < 0.0007 * k) this.fault(pick(), 'ice brought the lines down');
    }
    const A = Calamity.active;
    if (A && A.type === 'quake' && this.quakeSeen !== A) {
      this.quakeSeen = A;
      const n = 1 + (Math.random() < 0.5 ? 1 : 0);
      for (let i = 0; i < n; i++) this.fault(pick(), 'the earthquake snapped the lines');
    }
    if (A && A.type === 'flood' && this.floodSeen !== A && Calamity.flooded.size) {
      this.floodSeen = A;
      const i = [...Calamity.flooded][0] as number;
      this.fault(this.districtOf(i % GW, Math.floor(i / GW)), 'floodwater got into a substation');
    }
    const tn = Calamity.tornado;
    if (tn) {
      const d = this.districtOf(Math.floor(tn.x / T), Math.floor(tn.y / T));
      if (!this.tornadoHit.has(d)) { this.tornadoHit.add(d); if (built.includes(d)) this.fault(d, 'the tornado tore the lines down'); }
    } else if (this.tornadoHit.size) this.tornadoHit.clear();
  },

  /** once a day: the county bills for what it carried, and memories of outages fade */
  daily(): void {
    const imported = Math.max(0, Math.min(COUNTY_CAP, this.demand - this.plantCap));
    if (imported > 0) Gov.treasury = Math.max(0, Gov.treasury - imported * 0.15);
    this.recent *= 0.8;
    this.outagesToday = 0;
  },

  report(): { demand: number; capacity: number; plants: number; dark: number; faults: number; overloaded: boolean } {
    return {
      demand: Math.round(this.demand), capacity: Math.round(this.capacity), plants: Math.round(this.plantCap),
      dark: this.dark.reduce((n, v) => n + v, 0), faults: this.faults.size, overloaded: this.overloaded,
    };
  },

  serialize(): any {
    return { f: [...this.faults].map(([d, f]) => [d, f.cause, f.since]), r: Math.round(this.recent * 10) / 10, o: this.rollOffset };
  },
  restoreState(s: any): void {
    this.reset();
    if (!s) return;
    for (const [d, cause, since] of s.f || []) this.faults.set(d, { cause, since, crew: false });
    this.recent = s.r || 0;
    this.rollOffset = s.o || 0;
    this.evalT = 99;
    this.refreshDark();
  },
};

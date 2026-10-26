/* ============================================================
   The world beyond the map (V2, design §13).
   Other cities are destinations, not maps: named places reached
   by the highways, the national railway, the sea lanes, the air
   and (for the capital) the air taxi. This module keeps them,
   and runs what flows through the gateways:
   - the national line: when the village opens a train station,
     a branch line is laid from it to the map edge, and the
     Intercity Express runs it every three hours, in from the
     edge, a dwell at the platform, and out again;
   - visitors who come off the intercity, the planes and the
     ferry, walk to the shops and venues, spend, and go home;
   - newcomers who move in arrive through a gateway (the train,
     or the airport for skilled families) and walk to their door;
   - and the Founder's own trips, so the village knows they're away.
   Headless: positions are V1 px like the rest of the sim.
   ============================================================ */
import { CAT } from './catalog';
import { MIN_PER_SEC, T } from './core';
import { GW, GH, World } from './world';
import { Sim, PRICES } from './agents';
import { Life } from './life';
import { FOOT_PX } from './traffic';
import { Mind } from './mind';
import { Tasks } from './tasks';

export type Mode = 'road' | 'rail' | 'sea' | 'air' | 'heli';
export interface Leg { hours: number; fare: number; gate?: 'west' | 'north' }
export interface City {
  id: string; name: string; emoji: string; blurb: string;
  modes: Partial<Record<Mode, Leg>>;
  souvenir: { name: string; price: number };
  /** things that can happen on a walk round town (the client picks one) */
  sights: string[];
}

export const CITIES: City[] = [
  {
    id: 'westmere', name: 'Westmere', emoji: '🧀', blurb: 'A market town down the west highway, all cobbles, cheese and a covered market older than anyone can remember.',
    modes: { road: { hours: 2.5, fare: 0, gate: 'west' }, rail: { hours: 2, fare: 12 } },
    souvenir: { name: 'Westmere cheese', price: 9 },
    sights: ['wandered the covered market', 'watched the cheese rolling on the green', 'had lunch at a tavern by the old bridge'],
  },
  {
    id: 'northbridge', name: 'Northbridge', emoji: '🌉', blurb: 'An old mill city up the north road, famous for its seven bridges and its noisy football ground.',
    modes: { road: { hours: 3, fare: 0, gate: 'north' }, rail: { hours: 2.5, fare: 14 } },
    souvenir: { name: 'Northbridge scarf', price: 12 },
    sights: ['walked all seven bridges', 'caught the second half of a match', 'toured the old mills along the river'],
  },
  {
    id: 'avalon', name: 'Avalon City', emoji: '🏛️', blurb: 'The capital: towers, museums, the national parliament and more people in one street than in all of PixelVille.',
    modes: { rail: { hours: 4, fare: 26 }, air: { hours: 1.5, fare: 120 }, heli: { hours: 1, fare: 140 } },
    souvenir: { name: 'Avalon snow globe', price: 15 },
    sights: ['queued for the national museum', 'watched the changing of the guard', 'rode to the top of the Avalon tower'],
  },
  {
    id: 'harbourton', name: 'Harbourton', emoji: '⚓', blurb: 'The big port down the coast, cranes and container ships, fish suppers on the sea wall.',
    modes: { rail: { hours: 3.5, fare: 20 }, sea: { hours: 4, fare: 20 } },
    souvenir: { name: 'ship in a bottle', price: 18 },
    sights: ['watched the container ships come in', 'ate fish on the sea wall', 'toured the old lighthouse'],
  },
  {
    id: 'saltmarsh', name: 'Saltmarsh Isle', emoji: '🏝️', blurb: 'A fishing island across the bay: one pub, a hundred gulls and the best crab in the country.',
    modes: { sea: { hours: 2, fare: 12 } },
    souvenir: { name: 'jar of island honey', price: 7 },
    sights: ['walked the dunes to the lighthouse', 'watched the boats unload crab', 'sat in the island pub listening to sea shanties'],
  },
  {
    id: 'solano', name: 'Solano', emoji: '🌴', blurb: 'A sunny resort far to the south: white sand, warm sea, and nothing at all to do.',
    modes: { air: { hours: 3, fare: 210 } },
    souvenir: { name: 'Solano straw hat', price: 14 },
    sights: ['lay on the beach all afternoon', 'swam out to the reef', 'watched the sun go down over the bay'],
  },
];
export const city = (id: string): City | undefined => CITIES.find((c) => c.id === id);
export const MODE_LABEL: Record<Mode, string> = { road: 'by road', rail: 'by intercity train', sea: 'by sea', air: 'by air', heli: 'by air taxi' };

/** the intercity calls at the station at these times (game-minutes): 07:00 … 22:00, every three hours */
export const INTERCITY_SLOTS = [420, 600, 780, 960, 1140, 1320];
/** minutes it waits at the platform */
const DWELL = 14;
/** tiles per second (~80 km/h on the open line) */
const IC_SPEED = 2.8;

const active = (b: any): boolean => b.connected && !b.construction && !b.ruined;
const doorPx = (b: any): { x: number; y: number } => ({ x: b.door.x * T + 8, y: b.door.y * T + 8 });

export interface Trip { city: string; mode: Mode; since: number }

export const Gateways = {
  /** the station the national line starts from, and the line to the map edge */
  line: null as null | { station: number; route: number[][]; edge: string },
  lineStamp: -1,
  lineTried: '',
  /** the intercity train (drawn like the village's trains) */
  ic: null as any,
  /** visitors from out of town, on foot */
  visitors: [] as any[],
  /** where the Founder is, when they're away */
  away: null as Trip | null,
  /** visitors today (for the mayor's report) */
  today: { visitors: 0, newcomers: 0 },
  evalT: 0,

  reset(): void {
    this.line = null;
    this.lineStamp = -1;
    this.lineTried = '';
    this.ic = null;
    this.visitors = [];
    this.away = null;
    this.today = { visitors: 0, newcomers: 0 };
    this.evalT = 0;
    Life.intercity = null;
  },

  /* ---------- the national line ---------- */
  /** a rail tile on the map edge that this station's track reaches, with the route to it */
  findLine(): void {
    this.lineStamp = World.railStamp;
    this.line = null;
    const stations = World.buildings.filter((b: any) => b.type === 'trainstation' && active(b));
    for (const st of stations) {
      for (const d of Life.stationRailDoors(st)) {
        const path = this.toEdge(d.x, d.y);
        if (path) {
          const [ex, ey] = path[path.length - 1];
          this.line = { station: st.id, route: path, edge: ex <= 0 ? 'west' : ey <= 0 ? 'north' : ex >= GW - 1 ? 'east' : 'south' };
          return;
        }
      }
    }
  },
  /** BFS along the track from (x, y) to any rail tile on the map's edge */
  toEdge(x: number, y: number): number[][] | null {
    const prev = new Int32Array(GW * GH).fill(-1);
    const start = World.idx(x, y);
    prev[start] = start;
    const q = [start];
    for (let qi = 0; qi < q.length; qi++) {
      const cur = q[qi], cx = cur % GW, cy = (cur / GW) | 0;
      if (cx === 0 || cy === 0 || cx === GW - 1) {
        const path: number[][] = [];
        let c = cur;
        while (c !== start) { path.push([c % GW, (c / GW) | 0]); c = prev[c]; }
        path.push([x, y]);
        return path.reverse();
      }
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const nx = cx + dx, ny = cy + dy;
        if (!World.isRail(nx, ny)) continue;
        const ni = World.idx(nx, ny);
        if (prev[ni] !== -1) continue;
        prev[ni] = cur;
        q.push(ni);
      }
    }
    return null;
  },
  /** the national railway reaches the village: a branch from the station to the nearest edge (west, north or east) */
  layLine(): boolean {
    const stations = World.buildings.filter((b: any) => b.type === 'trainstation' && active(b));
    const sig = stations.map((s: any) => s.id).join(',');
    if (!stations.length || sig === this.lineTried) return false;
    this.lineTried = sig;
    for (const st of stations) {
      // start beside the station (its first rail door, or a free tile against a wall)
      const starts: { x: number; y: number }[] = Life.stationRailDoors(st);
      if (!starts.length) {
        for (let j = -1; j <= st.h; j++) for (let i = -1; i <= st.w; i++) {
          if (i >= 0 && i < st.w && j >= 0 && j < st.h) continue;
          if ((i === -1 || i === st.w) && (j === -1 || j === st.h)) continue; // not the corners
          const x = st.x + i, y = st.y + j;
          if (World.railEnterCost(x, y) < 2 && !World.isRoad(x, y)) starts.push({ x, y });
        }
      }
      const cx = st.x + st.w / 2, cy = st.y + st.h / 2;
      const edges = [
        { d: cx, at: (s: { x: number; y: number }) => ({ x: 0, y: s.y }) },
        { d: cy, at: (s: { x: number; y: number }) => ({ x: s.x, y: 0 }) },
        { d: GW - 1 - cx, at: (s: { x: number; y: number }) => ({ x: GW - 1, y: s.y }) },
      ].sort((a, b) => a.d - b.d);
      for (const e of edges)
        for (const s of starts.slice(0, 4)) {
          // the edge tile nearest that start, nudged along the edge until the ground allows it
          const g = e.at(s);
          for (let k = 0; k < 24; k++) {
            const off = (k % 2 ? 1 : -1) * Math.ceil(k / 2);
            const tx = g.x === 0 || g.x === GW - 1 ? g.x : Math.max(0, Math.min(GW - 1, g.x + off));
            const ty = g.y === 0 ? 0 : Math.max(0, Math.min(GH - 1, g.y + off));
            if (World.railEnterCost(tx, ty) === Infinity) continue;
            if (World.connectRail(s.x, s.y, tx, ty) > 0) {
              World.dirty = true;
              this.findLine();
              if (this.line) {
                Life.say(`🚆 The national railway has reached ${World.name}: a branch line runs from the station to the ${this.line.edge}, and the Intercity Express calls every three hours`, doorPx(st));
                Tasks.log(`🚆 ${World.name} joined the national railway`);
                return true;
              }
            }
            break;
          }
        }
    }
    return false;
  },

  /* ---------- the Intercity Express ---------- */
  station(): any {
    return this.line ? World.buildings.find((b: any) => b.id === this.line!.station && active(b)) || null : null;
  },
  /** minutes the run between the station and the edge takes */
  runMinutes(): number {
    return this.line ? Math.ceil((this.line.route.length - 1) / IC_SPEED) : 0;
  },
  /** the next time the intercity leaves the station (game-minutes, may be tomorrow: +1440) */
  nextDeparture(): number {
    const ic = this.ic;
    if (ic && (ic.phase === 'in' || ic.phase === 'dwell')) return ic.leaveAt < Sim.clock - 60 ? ic.leaveAt + 1440 : ic.leaveAt;
    const run = this.runMinutes();
    for (const s of INTERCITY_SLOTS) if (s > Sim.clock) return s + run + DWELL;
    return INTERCITY_SLOTS[0] + run + DWELL + 1440;
  },
  /** is the intercity standing at the platform right now? */
  boarding(): boolean {
    return !!this.ic && this.ic.phase === 'dwell';
  },
  tickIntercity(dt: number): void {
    const gm = dt * MIN_PER_SEC;
    if (!this.line) { this.ic = null; Life.intercity = null; return; }
    const route = this.line.route, end = route.length - 1;
    let ic = this.ic;
    if (!ic) {
      ic = this.ic = { route, prog: end, dir: -1, cars: 6, type: 'intercity', hidden: true, lane: 0, phase: 'off', pause: 0, x: 0, y: 0, dirx: 0, diry: 0, leaveAt: 0, nextIn: this.nextSlot() };
      Life.intercity = ic;
    }
    ic.route = route;
    if (ic.phase === 'off') {
      ic.hidden = true;
      if (this.clockReached(ic.nextIn)) {
        ic.phase = 'in'; ic.hidden = false; ic.prog = end; ic.dir = -1;
        ic.leaveAt = (Sim.clock + this.runMinutes() + DWELL) % 1440;
      }
      return;
    }
    if (ic.phase === 'dwell') {
      ic.pause -= gm;
      if (ic.pause <= 0) { ic.phase = 'out'; ic.dir = 1; }
    } else {
      ic.prog = Math.max(0, Math.min(end, ic.prog + IC_SPEED * dt * ic.dir));
      if (ic.phase === 'in' && ic.prog <= 0) {
        ic.phase = 'dwell'; ic.pause = DWELL;
        this.arrivals(ic);
      } else if (ic.phase === 'out' && ic.prog >= end) {
        ic.phase = 'off'; ic.hidden = true; ic.nextIn = this.nextSlot();
      }
    }
    Life.followRail(ic, route, ic.prog, ic.dir); // V2 (Milestone 8): round the curves
  },
  nextSlot(): number {
    for (const s of INTERCITY_SLOTS) if (s > Sim.clock) return s;
    return INTERCITY_SLOTS[0];
  },
  /** has the clock reached `t` (allowing for midnight)? */
  clockReached(t: number): boolean {
    return Sim.clock >= t && Sim.clock < t + 120;
  },

  /* ---------- visitors from out of town ---------- */
  /** someone steps off at gateway building `g` and goes to see the town */
  visit(g: any, from: string): boolean {
    if (this.visitors.length >= 24) return false;
    const venues = World.buildings.filter((b: any) => CAT[b.type].visit && active(b) && b !== g);
    if (!venues.length) return false;
    // the hotel, the sights and the shops, the nearest more often
    venues.sort((a: any, b: any) => (Math.abs(a.x - g.x) + Math.abs(a.y - g.y)) - (Math.abs(b.x - g.x) + Math.abs(b.y - g.y)));
    const v = venues[Math.min(venues.length - 1, Math.floor(Math.random() ** 1.6 * venues.length))];
    const path = World.walkPath(g.door.x, g.door.y, v.door.x, v.door.y);
    if (!path || path.length < 3) return false;
    const seed = (Math.random() * 1e6) | 0;
    this.visitors.push({ path, prog: 0, phase: 'in', venue: v, gate: g, stay: 50 + Math.random() * 120, seed, kind: seed % 3 === 0 ? 'woman' : seed % 3 === 1 ? 'man' : seed % 7 === 0 ? 'kid' : 'woman', from, x: g.door.x * T + 8, y: g.door.y * T + 8, dirx: 0, diry: 1 });
    this.today.visitors++;
    return true;
  },
  tickVisitors(dt: number): void {
    const gm = dt * MIN_PER_SEC;
    for (const v of this.visitors) {
      if (v.phase === 'stay') {
        v.stay -= gm;
        if (v.stay <= 0 || !World.buildings.includes(v.venue)) { v.phase = 'out'; v.path = [...v.path].reverse(); v.prog = 0; v.venue.inside = Math.max(0, v.venue.inside - 1); }
        continue;
      }
      v.prog += 0.3 * dt; // walking pace, like the villagers
      Life.followPath(v, v.path, Math.min(v.prog, v.path.length - 1), FOOT_PX); // V2 (Milestone 8): on the pavement
      if (v.prog >= v.path.length - 1) {
        if (v.phase === 'in') {
          v.phase = 'stay';
          v.venue.visitors++; v.venue.inside++;
          v.venue.funds += ((PRICES as Record<string, number>)[v.venue.type] || 4) * 1.2; // visitors spend a little more
        } else v.done = true;
      }
    }
    if (this.visitors.length) this.visitors = this.visitors.filter((v: any) => !v.done);
  },
  /** the intercity is in: visitors step off (and sometimes a villager comes home from a trip) */
  arrivals(ic: any): void {
    const st = this.station();
    if (!st) return;
    const n = 1 + Math.floor(Math.random() * (Sim.people.length > 60 ? 4 : 2));
    const from = CITIES.filter((c) => c.modes.rail)[Math.floor(Math.random() * 4)].name;
    for (let i = 0; i < n; i++) this.visit(st, from);
    st.visitors += n;
    void ic;
  },

  /* ---------- newcomers ---------- */
  /** a family that just moved into `home` arrives through a gateway instead of appearing at the door.
      Skilled families fly in when there's an airport; everyone else takes the intercity, when it runs. */
  welcome(home: any, surname: string, skilled = false): string | null {
    const airport = skilled ? World.buildings.find((b: any) => b.type === 'airport' && active(b)) : null;
    const st = this.station();
    const gate = airport || st;
    if (!gate) return null;
    const fam = home.residents.filter((p: any) => p.surname === surname && p.state === 'in' && p.at === home);
    if (!fam.length) return null;
    const from = airport ? CITIES.filter((c) => c.modes.air)[Math.floor(Math.random() * 2)] : CITIES.filter((c) => c.modes.rail)[Math.floor(Math.random() * 4)];
    for (const p of fam) {
      p.at = gate; gate.inside++;
      p.events = [];
      Sim.startTrip(p, home, null);
      Mind.remember(p, 'move', `moved to ${World.name} from ${from.name}`, 1, home.id);
    }
    this.today.newcomers += fam.length;
    return airport ? `flew in from ${from.name}` : `came in on the intercity from ${from.name}`;
  },

  /* ---------- the frame tick ---------- */
  tick(dt: number): void {
    this.evalT += dt * MIN_PER_SEC;
    if (this.evalT >= 30) {
      this.evalT = 0;
      if (World.railStamp !== this.lineStamp) this.findLine();
      if (!this.line) this.layLine();
    }
    this.tickIntercity(dt);
    this.tickVisitors(dt);
  },
  /** the planes and the ferry bring visitors too (called by Life when they land and dock) */
  landed(airport: any): void {
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) this.visit(airport, CITIES.filter((c) => c.modes.air)[Math.floor(Math.random() * 2)].name);
  },
  docked(dock: any): void {
    if (Math.random() < 0.5) this.visit(dock, CITIES.filter((c) => c.modes.sea)[Math.floor(Math.random() * 2)].name);
  },

  daily(): void {
    this.today = { visitors: 0, newcomers: 0 };
  },

  /** the Founder sets off / comes home (the village's news knows) */
  leave(c: City, mode: Mode): void {
    this.away = { city: c.id, mode, since: Sim.day * 1440 + Sim.clock };
    Tasks.log(`${mode === 'air' ? '✈️' : mode === 'rail' ? '🚆' : mode === 'sea' ? '⛴️' : mode === 'heli' ? '🚁' : '🚗'} The Founder left ${World.name} for ${c.name}`);
  },
  back(): void {
    const t = this.away;
    this.away = null;
    const c = t ? city(t.city) : null;
    if (c) Tasks.log(`🏡 The Founder is back in ${World.name} after a trip to ${c.name}`);
  },

  serialize(): any {
    return { lt: this.lineTried };
  },
  restore(s: any): void {
    this.reset();
    if (s) this.lineTried = s.lt || '';
  },
};

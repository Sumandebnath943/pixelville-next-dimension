/* ============================================================
   Trips off the map (Milestone 5b–c, design §13). Other cities
   are destinations, not maps. A trip:
   - leaves from a gateway, seen in the world: the Intercity
     Express pulls out and runs to the map's edge with you
     aboard; a plane takes off from the airport after check-in;
     a steamer sails from the dock out to sea; the air taxi lifts
     off; or you simply drive off the end of a highway;
   - then a journey screen while the hours pass at home (the
     village lives on: the time skip runs the real simulation),
     with something that happened on the way;
   - the city itself: look around, buy a souvenir, stay the
     night, or head home;
   - the way back, the same way, ending in the world again (the
     train pulls in, the plane lands, the steamer docks, your car
     comes in off the highway);
   - and a card of what happened while you were away.
   ============================================================ */
import { Game } from '../sim/game';
import { Sim } from '../sim/agents';
import { World, GW, GH, G_WATER } from '../sim/world';
import { Life } from '../sim/life';
import { CAT } from '../sim/catalog';
import { T } from '../sim/core';
import { Tasks } from '../sim/tasks';
import { Gateways, CITIES, City, Mode, city, MODE_LABEL } from '../sim/gateways';
import type { Founder } from './founder';
import type { Transit } from './transit';
import { tripTicket, punch } from './tickets';

const TM = 8, PX = 0.5;
/** flights leave at these times (game-minutes): 06:30 … 21:30, every three hours */
export const FLIGHTS = [390, 570, 750, 930, 1110, 1290];
/** check-in closes this long before a flight */
const CHECKIN_CLOSES = 20;

export const hhmm = (m: number): string => {
  const t = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};
export const hoursLabel = (h: number): string => (h % 1 ? `${Math.floor(h)} h ${Math.round((h % 1) * 60)} min` : `${h} h`);
const ICON: Record<Mode, string> = { road: '🚗', rail: '🚆', sea: '⛴️', air: '✈️', heli: '🚁' };

export interface TravelView {
  /** the journey screen: from, to, how, how far along (0…1), the clock, what happened */
  journey(o: { from: string; to: string; mode: Mode; icon: string; k: number; clock: string; event: string | null; back: boolean }): void;
  /** the city: its card, what's happened there, and the buttons */
  city(o: { c: City; clock: string; notes: string[]; actions: { label: string; sub?: string; act: () => void }[] }): void;
  /** while you were away */
  summary(o: { title: string; lines: string[]; headlines: string[]; done: () => void }): void;
  hide(): void;
}
interface Snap { at: number; pop: number; maxId: number; sites: Set<number> }
interface Trip {
  c: City; mode: Mode; gate: any | null; edge: 'west' | 'north' | null;
  phase: 'board' | 'depart' | 'journey' | 'city' | 'arrive' | 'summary';
  back: boolean; minutes: number; left: number; t0: number; minMs: number;
  event: string | null; eventAt: number; notes: string[]; looked: boolean; snap: Snap; prepaid: boolean;
  /** the flight checked in for (absolute game-minutes: day × 1440 + time) */
  flightAt: number;
  /** what carries you in the world (a plane, the steamer, the air taxi), metres */
  craft: any | null;
}

export class Travel {
  trip: Trip | null = null;

  constructor(
    private founder: Founder,
    private transit: Transit,
    private view: TravelView,
    private toast: (m: string) => void,
    private hooks: { hideCar: () => void; carBack: (x: number, z: number, yaw: number) => void },
  ) {}

  /** the journey and city screens cover the world (the frame loop runs only `frame`) */
  get overlay(): boolean {
    const p = this.trip?.phase;
    return p === 'journey' || p === 'city' || p === 'summary';
  }
  get active(): boolean {
    return !!this.trip;
  }

  /* ---------- what each gateway offers (the departures board) ---------- */
  options(b: any): { label: string; sub: string; act: () => void }[] {
    const out: { label: string; sub: string; act: () => void }[] = [];
    const bag = this.founder.bag;
    const add = (c: City, mode: Mode, label: string, when: string): void => {
      const leg = c.modes[mode]!;
      const tk = tripTicket(bag, c.id, mode);
      out.push({ label, sub: `${hoursLabel(leg.hours)} · ${tk ? 'your ticket' : `$${leg.fare} each way`} · ${when}`, act: () => this.start(c, mode, b) });
    };
    if (b.type === 'trainstation') {
      if (Gateways.line && Gateways.station() === b) {
        const dep = Gateways.boarding() ? 'boarding now' : `next departure ${hhmm(Gateways.nextDeparture())}`;
        for (const c of CITIES) if (c.modes.rail) add(c, 'rail', `Intercity Express to ${c.name}`, dep);
      }
    } else if (b.type === 'airport') {
      const f = this.nextFlight();
      for (const c of CITIES) if (c.modes.air) add(c, 'air', `Flight to ${c.name}`, `check in for the ${hhmm(f)}`);
    } else if (b.type === 'dock') {
      if (this.seaLane(b)) for (const c of CITIES) if (c.modes.sea) add(c, 'sea', `Sea crossing to ${c.name}`, 'sails when you board');
    } else if (b.type === 'heliport') {
      for (const c of CITIES) if (c.modes.heli) add(c, 'heli', `Air taxi to ${c.name}`, 'lifts off when you board');
    }
    return out;
  }
  /** at a highway's end, in your own vehicle: where that road goes */
  roadTrip(edge: 'west' | 'north'): City | null {
    return CITIES.find((c) => c.modes.road?.gate === edge) || null;
  }
  nextFlight(): number {
    for (const f of FLIGHTS) if (f - CHECKIN_CLOSES > Sim.clock) return f;
    return FLIGHTS[0] + 1440;
  }
  /** a water route from the dock to the open sea at the map's southern edge */
  seaLane(dock: any): number[][] | null {
    let start: { x: number; y: number } | null = null;
    for (let j = -1; j <= dock.h && !start; j++) for (let i = -1; i <= dock.w; i++) {
      if (i >= 0 && i < dock.w && j >= 0 && j < dock.h) continue;
      const x = dock.x + i, y = dock.y + j;
      if (World.inB(x, y) && World.ground[World.idx(x, y)] === G_WATER) { start = { x, y }; break; }
    }
    if (!start) return null;
    for (let x = start.x, k = 0; k < GW; k++, x = (start.x + (k % 2 ? 1 : -1) * Math.ceil(k / 2) + GW) % GW) {
      if (World.ground[World.idx(x, GH - 1)] !== G_WATER) continue;
      return World.waterPath(start.x, start.y, x, GH - 1);
    }
    return null;
  }

  /* ---------- setting off ---------- */
  start(c: City, mode: Mode, gate: any | null, edge: 'west' | 'north' | null = null): boolean {
    if (this.trip || this.transit.riding()) return false;
    const leg = c.modes[mode];
    if (!leg) return false;
    const tk = mode === 'road' ? null : tripTicket(this.founder.bag, c.id, mode);
    let prepaid = false;
    if (tk) { punch(this.founder.bag, tk); prepaid = true; }
    else if (leg.fare && !this.founder.purse.spend(leg.fare, `${c.name} ${MODE_LABEL[mode]}`, 'purchase', gate || undefined)) {
      this.toast(`👛 The fare to ${c.name} is $${leg.fare} — you have $${Math.floor(this.founder.purse.balance)}`);
      return false;
    }
    this.trip = {
      c, mode, gate, edge, phase: 'board', back: false, minutes: 0, left: 0, t0: 0, minMs: 0,
      event: null, eventAt: 0, notes: [], looked: false, snap: this.snapshot(), prepaid, craft: null,
      flightAt: Sim.day * 1440 + this.nextFlight(),
    };
    if (mode === 'road') { this.hooks.hideCar(); this.beginJourney(); return true; }
    if (mode === 'rail') {
      this.toast(Gateways.boarding() ? `🚆 The Intercity Express to ${c.name} is at the platform — all aboard!` : `🚆 Ticket to ${c.name}. The Intercity Express leaves at ${hhmm(Gateways.nextDeparture())} — wait on the platform`);
      return true;
    }
    if (mode === 'air') {
      this.toast(`✈️ Checked in for the ${hhmm(this.trip.flightAt)} to ${c.name}${prepaid ? ' (ticket from your bag)' : ` ($${leg.fare})`} — to the gate`);
      return true;
    }
    this.depart();
    return true;
  }
  cancel(): void {
    const t = this.trip;
    if (!t || t.phase !== 'board') return;
    this.trip = null;
    this.toast(`🚶 You decided not to go to ${t.c.name}`);
  }

  /** the craft leaves, the camera following it out of the village */
  private depart(): void {
    const t = this.trip!;
    t.phase = 'depart';
    Gateways.leave(t.c, t.mode);
    if (t.mode === 'rail') {
      const ic = Gateways.ic;
      this.transit.follow(() => (ic && !ic.hidden ? { x: ic.x * PX, y: 1.6, z: ic.y * PX } : null), 20, () => this.beginJourney());
    } else if (t.mode === 'air') {
      const a = t.gate;
      const ry = Life.airfield(a).ry * 2, rx0 = a.x * T + 4, rx1 = a.x * T + a.w * T - 4;
      const pl: any = { mode: 'takeoff', x: rx0, y: ry, alt: 0, v: 14, rx1, founder: true };
      Life.planes.push(pl);
      t.craft = pl;
      this.transit.follow(() => (!pl.done && Life.planes.includes(pl) ? { x: pl.x * PX, y: pl.alt * 0.5 + 2, z: pl.y * PX } : null), 38, () => this.beginJourney());
    } else if (t.mode === 'sea') {
      const lane = this.seaLane(t.gate);
      if (!lane) { this.beginJourney(); return; }
      const boat = { route: lane, prog: 0, x: lane[0][0] * T + 8, y: lane[0][1] * T + 8, dirx: 0, diry: 1, t: 0, ph: 0 };
      t.craft = boat;
      this.transit.follow((dt) => {
        boat.t += dt;
        boat.prog = Math.min(lane.length - 1, boat.prog + 9.6 * dt);
        Life.followPath(boat, lane, boat.prog, 0);
        return boat.t < 9 && boat.prog < lane.length - 1 ? { x: boat.x * PX, y: 2.6, z: boat.y * PX } : null;
      }, 24, () => this.beginJourney());
    } else if (t.mode === 'heli') {
      const p = t.gate;
      const h = { x: (p.x + p.w / 2) * TM, z: (p.y + p.h / 2) * TM, alt: 0, yaw: Math.PI / 2, rot: 0, t: 0 };
      t.craft = h;
      this.transit.follow((dt) => {
        h.t += dt; h.rot += 24 * dt;
        if (h.alt < 50) h.alt += 21 * dt; else h.x += 54 * dt;
        return h.t < 7 ? { x: h.x, y: h.alt, z: h.z } : null;
      }, 18, () => this.beginJourney());
    }
  }

  /* ---------- the journey screen: the hours pass at home ---------- */
  private beginJourney(): void {
    const t = this.trip!;
    if (t.mode === 'road' && !t.back) Gateways.leave(t.c, t.mode);
    t.phase = 'journey';
    t.craft = null;
    t.minutes = t.left = Math.round(t.c.modes[t.mode]!.hours * 60);
    t.t0 = performance.now();
    t.minMs = 4200 + Math.min(2500, t.minutes * 8);
    t.event = null;
    t.eventAt = 0.45 + Math.random() * 0.2;
    Game.setSpeed(1);
  }
  /** a frame while the overlay is up */
  frame(now: number): void {
    const t = this.trip;
    if (!t) return;
    if (t.phase === 'journey') {
      if (t.left > 0) {
        const n = Math.min(t.left, 30);
        Game.catchUp(n);
        t.left -= n;
      }
      const k = Math.min(1, (now - t.t0) / t.minMs);
      if (!t.event && k >= t.eventAt) t.event = this.wayEvent(t);
      this.view.journey({ from: t.back ? t.c.name : World.name, to: t.back ? World.name : t.c.name, mode: t.mode, icon: ICON[t.mode], k, clock: `Day ${Sim.day} · ${Sim.timeStr()}`, event: t.event, back: t.back });
      if (t.left <= 0 && now - t.t0 >= t.minMs) {
        if (!t.back) this.arriveCity();
        else this.homecoming();
      }
    }
  }

  /** something that happens on the way: a chat, a find, a delay, a view */
  private wayEvent(t: Trip): string {
    const r = Math.random();
    const purse = this.founder.purse;
    const by = { road: 'at a roadside café', rail: 'in the dining car', sea: 'on deck', air: 'on the plane', heli: 'in the back seat' }[t.mode];
    if (r < 0.25) {
      const pay = 10 + Math.floor(Math.random() * 20);
      purse.earn(pay, `A job lead ${by}`, 'income');
      return `You got talking to a trader ${by} who needed a hand with some figures — they paid you $${pay}.`;
    }
    if (r < 0.45) return `${t.back ? 'Coming home' : 'On the way'} you read the ${t.back ? World.name : t.c.name} papers ${by}: ${t.back ? `"${World.name} keeps growing", it says` : t.c.blurb.split(':')[0].toLowerCase()}.`;
    if (r < 0.6 && t.mode !== 'heli') { if (t.left > 0) t.left += 20; return `A delay ${t.mode === 'road' ? 'at the roadworks' : t.mode === 'rail' ? 'outside a junction' : t.mode === 'sea' ? 'while a tanker crossed' : 'circling for a slot'} — twenty minutes lost.`; }
    if (r < 0.8) return `${t.mode === 'air' || t.mode === 'heli' ? 'The clouds parted' : 'The view opened up'} and you could see for miles: ${t.back ? `${World.name}'s rooftops ahead` : 'the whole valley behind you'}.`;
    return `A family ${by} asked where you were from. "${World.name}," you said. They'd heard of it.`;
  }

  /* ---------- the city ---------- */
  private arriveCity(): void {
    const t = this.trip!;
    t.phase = 'city';
    if (t.event) t.notes.push(t.event);
    this.showCity();
  }
  private showCity(): void {
    const t = this.trip!;
    const c = t.c;
    const purse = this.founder.purse;
    const leg = c.modes[t.mode]!;
    const actions: { label: string; sub?: string; act: () => void }[] = [];
    if (!t.looked) actions.push({ label: 'Look around', sub: 'a couple of hours', act: () => {
      t.looked = true;
      Game.catchUp(60); Game.catchUp(60);
      const sight = c.sights[Math.floor(Math.random() * c.sights.length)];
      t.notes.push(`You ${sight}.`);
      if (Math.random() < 0.3) { const pay = 15 + Math.floor(Math.random() * 25); purse.earn(pay, `Odd job in ${c.name}`, 'income'); t.notes.push(`A shopkeeper paid you $${pay} to help shift some stock.`); }
      this.showCity();
    } });
    actions.push({ label: `Buy a souvenir: ${c.souvenir.name}`, sub: `$${c.souvenir.price}`, act: () => {
      if (!purse.spend(c.souvenir.price, `${c.souvenir.name} · ${c.name}`, 'purchase')) { t.notes.push(`You can't afford the ${c.souvenir.name}.`); this.showCity(); return; }
      this.founder.bag.push({ name: c.souvenir.name, from: c.name, day: Sim.day });
      while (this.founder.bag.length > 16) this.founder.bag.shift();
      t.notes.push(`You bought a ${c.souvenir.name} — it's in your bag.`);
      this.showCity();
    } });
    const night = Sim.clock >= 1080 || Sim.clock < 360;
    actions.push({ label: 'Stay the night', sub: `$30 at a guesthouse · on your way by 08:00`, act: () => {
      if (!purse.spend(30, `A night in ${c.name}`, 'purchase')) { t.notes.push('You can\'t afford a room.'); this.showCity(); return; }
      let m = (8 * 60 - Sim.clock + 1440) % 1440;
      Game.setSpeed(1);
      while (m > 0) { const n = Math.min(m, 60); Game.catchUp(n); m -= n; }
      t.notes.push(`You slept in ${c.name} and woke to ${Sim.timeStr()}.`);
      this.showCity();
    } });
    const fare = t.prepaid || t.mode === 'road' ? 0 : leg.fare;
    actions.push({ label: `Head home ${MODE_LABEL[t.mode]}`, sub: `${hoursLabel(leg.hours)}${fare ? ` · $${fare}` : t.prepaid ? ' · return ticket' : ''}`, act: () => this.headHome() });
    this.view.city({ c, clock: `Day ${Sim.day} · ${Sim.timeStr()}${night ? ' · night' : ''}`, notes: t.notes.slice(-4), actions });
  }
  private headHome(): void {
    const t = this.trip!;
    const leg = t.c.modes[t.mode]!;
    if (!t.prepaid && leg.fare && !this.founder.purse.spend(leg.fare, `${t.c.name} ${MODE_LABEL[t.mode]} (home)`, 'purchase')) {
      t.notes.push(`The fare home is $${leg.fare} and you only have $${Math.floor(this.founder.purse.balance)}. You'll have to find some work here first.`);
      // a day's casual work in town: enough for the fare home
      t.notes.push('You spent the day carrying crates at the market for the fare home.');
      Game.setSpeed(1);
      for (let m = 480; m > 0; m -= 60) Game.catchUp(60);
      this.founder.purse.earn(leg.fare + 5, `A day's work in ${t.c.name}`, 'income');
      this.founder.purse.spend(leg.fare, `${t.c.name} ${MODE_LABEL[t.mode]} (home)`, 'purchase');
    }
    t.back = true;
    this.beginJourney();
  }

  /* ---------- home again ---------- */
  private homecoming(): void {
    const t = this.trip!;
    t.phase = 'arrive';
    this.view.hide();
    const done = (): void => this.showSummary();
    if (t.mode === 'road') {
      // in off the end of the highway, at the wheel
      const hw = World.highway?.[t.edge || 'west'];
      const x = t.edge === 'north' ? (hw?.x ?? GW / 2) * TM + 6 : 6, z = t.edge === 'north' ? 6 : (hw?.y ?? GH / 2) * TM + 6;
      this.hooks.carBack(x, z, t.edge === 'north' ? 0 : Math.PI / 2);
      done();
      return;
    }
    if (t.mode === 'rail') {
      const ic = Gateways.ic, st = Gateways.station();
      if (!ic || !st) { if (t.gate) this.founder.stepOutOf(t.gate); done(); return; }
      // the next service comes in with you aboard
      ic.phase = 'in'; ic.hidden = false; ic.prog = ic.route.length - 1; ic.dir = -1;
      ic.leaveAt = (Sim.clock + Gateways.runMinutes() + 14) % 1440;
      this.transit.follow(() => (ic.phase === 'in' ? { x: ic.x * PX, y: 1.6, z: ic.y * PX } : null), 20, () => { this.founder.stepOutOf(st); done(); });
      return;
    }
    const g = t.gate && World.buildings.includes(t.gate) && !t.gate.ruined ? t.gate : null;
    if (t.mode === 'air' && g) {
      const ry = Life.airfield(g).ry * 2;
      const pl = { mode: 'land', x: -40 + Math.max(0, g.x * T - 900), y: ry, alt: 70, v: 85, rx0: g.x * T + 4, rx1: g.x * T + g.w * T - 4, stop: g.x * T + g.w * T - 34, founder: true };
      Life.planes.push(pl);
      this.transit.follow(() => (Life.planes.includes(pl) && !(pl as any).done ? { x: pl.x * PX, y: pl.alt * 0.5 + 2, z: pl.y * PX } : null), 38, () => { this.founder.stepOutOf(g); done(); });
      return;
    }
    if (t.mode === 'sea' && g) {
      const lane = this.seaLane(g);
      if (lane) {
        const path = [...lane].reverse();
        const boat = { route: path, prog: Math.max(0, path.length - 1 - 90), x: 0, y: 0, dirx: 0, diry: -1, ph: 0 };
        t.craft = boat;
        this.transit.follow((dt) => {
          boat.prog = Math.min(path.length - 1, boat.prog + 9.6 * dt);
          Life.followPath(boat, path, boat.prog, 0);
          return boat.prog < path.length - 1 ? { x: boat.x * PX, y: 2.6, z: boat.y * PX } : null;
        }, 24, () => { t.craft = null; this.founder.stepOutOf(g); done(); });
        return;
      }
    }
    if (t.mode === 'heli' && g) {
      const px = (g.x + g.w / 2) * TM, pz = (g.y + g.h / 2) * TM;
      const h = { x: px + 260, z: pz, alt: 50, yaw: -Math.PI / 2, rot: 0, t: 0 };
      t.craft = h;
      this.transit.follow((dt) => {
        h.rot += 24 * dt;
        if (h.x > px + 0.5) h.x = Math.max(px, h.x - 54 * dt); else h.alt = Math.max(0, h.alt - 21 * dt);
        return h.alt > 0 ? { x: h.x, y: h.alt, z: h.z } : null;
      }, 18, () => { t.craft = null; this.founder.stepOutOf(g); done(); });
      return;
    }
    if (g) this.founder.stepOutOf(g);
    else { const l = Game.lodge(); if (l) this.founder.stepOutOf(l); }
    done();
  }

  /* ---------- what changed while you were away ---------- */
  snapshot(): Snap {
    const sites = new Set<number>(World.buildings.filter((b: any) => b.construction > 0).map((b: any) => b.id));
    const maxId = World.buildings.reduce((m: number, b: any) => Math.max(m, b.id), 0);
    return { at: Sim.day * 1440 + Sim.clock, pop: Sim.people.length, maxId, sites };
  }
  private showSummary(): void {
    const t = this.trip!;
    t.phase = 'summary';
    Gateways.back();
    const s = t.snap;
    const mins = Sim.day * 1440 + Sim.clock - s.at;
    const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60);
    const lines: string[] = [];
    const away = d ? `${d} day${d > 1 ? 's' : ''}${h ? ` and ${h} hour${h > 1 ? 's' : ''}` : ''}` : `${h} hour${h !== 1 ? 's' : ''}`;
    lines.push(`You were away ${away}, in ${t.c.name}.`);
    const dp = Sim.people.length - s.pop;
    lines.push(dp > 0 ? `${dp} more villager${dp > 1 ? 's' : ''} now (${Sim.people.length}).` : dp < 0 ? `${-dp} fewer villager${dp < -1 ? 's' : ''} (${Sim.people.length}).` : `Still ${Sim.people.length} villagers.`);
    const finished = World.buildings.filter((b: any) => !b.construction && !b.ruined && (s.sites.has(b.id) || b.id > s.maxId)).map((b: any) => CAT[b.type].name);
    if (finished.length) lines.push(`Finished while you were gone: ${finished.slice(0, 5).join(', ')}${finished.length > 5 ? ` and ${finished.length - 5} more` : ''}.`);
    const started = World.buildings.filter((b: any) => b.construction > 0 && b.id > s.maxId).length;
    if (started) lines.push(`${started} new building${started > 1 ? 's' : ''} going up.`);
    // (the news log keeps only its last 250 lines, so go by when each was written, not where it sits)
    const when = (n: any): number => n.day * 1440 + (parseInt(n.time, 10) || 0) * 60 + (parseInt(String(n.time).slice(3), 10) || 0);
    const news = Tasks.news.filter((n: any) => when(n) >= s.at).map((n: any) => n.text)
      .filter((x: string) => !/regular at|became a regular|hot-air balloon|strange lights|The Founder (left|is back)/i.test(x));
    this.view.summary({ title: `Back in ${World.name}`, lines, headlines: news.slice(-6).reverse(), done: () => { this.view.hide(); this.trip = null; } });
  }

  /* ---------- per frame, in the world (boarding and the craft) ---------- */
  update(): void {
    const t = this.trip;
    if (!t) return;
    // the platform: aboard as soon as the intercity stands there
    if (t.phase === 'board' && t.mode === 'rail' && Gateways.boarding()) this.depart();
    // the gate: boarding when the flight is called
    if (t.phase === 'board' && t.mode === 'air' && t.flightAt - (Sim.day * 1440 + Sim.clock) <= 5) this.gateWait();
  }
  /** the prompt line while the trip is waiting to leave */
  interaction(): { text: string; act: () => void; alt?: { text: string; act: () => void } } | null {
    const t = this.trip;
    if (!t || t.phase !== 'board') return null;
    if (t.mode === 'rail') return { text: `🚆 Waiting for the Intercity Express to ${t.c.name} (leaves ${hhmm(Gateways.nextDeparture())}) · <b>{vehicle}</b> don't go`, act: () => this.cancel() };
    if (t.mode === 'air') return { text: `✈️ Checked in for the ${hhmm(t.flightAt)} to ${t.c.name} · <b>{interact}</b> wait at the gate until boarding · <b>{vehicle}</b> don't go`, act: () => this.cancel(), alt: { text: '', act: () => this.gateWait() } };
    return null;
  }
  /** wait at the gate: the time passes until the flight is called, then off you go */
  gateWait(): void {
    const t = this.trip;
    if (!t || t.mode !== 'air' || t.phase !== 'board') return;
    let m = t.flightAt - (Sim.day * 1440 + Sim.clock) - 5; // the flight checked in for
    Game.setSpeed(1);
    while (m > 0) { const n = Math.min(m, 60); Game.catchUp(n); m -= n; }
    this.toast(`✈️ Flight to ${t.c.name}: now boarding`);
    this.depart();
  }
  /** what to draw: the steamer and the air taxi */
  draw(vehicle: (type: string, x: number, y: number, z: number, yaw: number, paint: string, rotor: number) => void): void {
    const c = this.trip?.craft;
    if (!c || c.mode) return; // planes are drawn with the village's own
    if (c.route) vehicle('ferry', c.x * PX, -0.35, c.y * PX, Math.atan2(c.dirx || 0, c.diry || 1), '#7a2a2a', 0);
    else vehicle('heli', c.x, c.alt, c.z, c.yaw, '#2a4a8a', c.rot);
  }
}

export { city };

/* ============================================================
   Riding (Milestone 5a): the Founder takes the village's own
   transport as a passenger. At a bus stop, a station or a dock,
   F waits for the next bus, train or ferry; when it pulls in
   and stops, on you get (paying the fare, or showing a ticket
   or pass from the bag). The camera rides along; at each stop
   F gets off (or it's automatic at the stop you chose). A cab
   is called from the phone or taken at the rank: it drives to
   you, and on to the GPS destination, and you pay the meter.
   At a heliport, the sightseeing flight circles the village.
   The same follow-camera carries the departures and arrivals
   of trips off the map (src/player/travel.ts).
   ============================================================ */
import { World } from '../sim/world';
import { Life } from '../sim/life';
import { CAT } from '../sim/catalog';
import { Gov } from '../sim/gov';
import { T } from '../sim/core';
import { Traffic } from '../sim/traffic';
import { nearlyThere } from '../sim/power';
import type { Founder } from './founder';
import type { Gps } from './gps';
import { ticketFor, punch } from './tickets';

const TM = 8, PX = 0.5;
export const FARES = { bus: 2, train: 4, express: 6, ferry: 5, cabBase: 3, cabTile: 0.12, tour: 60 };
export type RideKind = 'bus' | 'train' | 'ferry' | 'taxi' | 'tour' | 'follow';

interface Aboard {
  kind: RideKind;
  v: any;
  from: any | null;
  /** where to get off without asking (null: choose at a stop) */
  to: any | null;
  /** the stop the vehicle is standing at right now */
  stop: any | null;
  moved: number;
  last: { x: number; y: number };
  dist: number;
  /** follow mode: where the vehicle is (metres) */
  get?: (dt: number) => { x: number; y: number; z: number } | null;
  done?: () => void;
}
interface Waiting { kind: 'bus' | 'train' | 'ferry'; at: any; to: any | null }

/** how far (tiles) a sim object (px) is from a building's plot */
export function tilesTo(o: { x: number; y: number }, b: any): number {
  const tx = o.x / T, ty = o.y / T;
  const dx = Math.max(b.x - tx, 0, tx - (b.x + b.w)), dy = Math.max(b.y - ty, 0, ty - (b.y + b.h));
  return Math.hypot(dx, dy);
}
const active = (b: any): boolean => b.connected && !b.construction && !b.ruined;
/** "the stop by the Bakery": a stop or station named after its most notable neighbour */
export function placeName(b: any): string {
  if (b.type !== 'busstop') return `the ${CAT[b.type].name}`;
  let best: any = null, bd = 1e9;
  for (const o of World.buildings) {
    if (o === b || o.ruined || ['busstop', 'house', 'cottage', 'house2', 'house3'].includes(o.type)) continue;
    const d = Math.abs(o.x - b.x) + Math.abs(o.y - b.y);
    if (d < bd) { bd = d; best = o; }
  }
  return best && bd < 18 ? `the stop by the ${CAT[best.type].name}` : 'the bus stop';
}

export class Transit {
  aboard: Aboard | null = null;
  waiting: Waiting | null = null;
  /** a cab hired from the rank: coming to you, waiting, or carrying you */
  cab: { v: any; phase: 'coming' | 'waiting' | 'riding'; stand: any; fare: number } | null = null;
  /** the sightseeing flight (metres) */
  tour: { x: number; z: number; alt: number; yaw: number; phase: string; ang: number; cx: number; cz: number; r: number; rot: number; pad: any; t: number } | null = null;

  constructor(private founder: Founder, private gps: Gps, private toast: (m: string) => void, private openMap: () => void) {}

  /* ---------- what's on offer at a stop, station, dock, rank or heliport (for the departures board) ---------- */
  options(b: any): { label: string; sub: string; act: () => void }[] {
    const out: { label: string; sub: string; act: () => void }[] = [];
    const bag = this.founder.bag;
    if (b.type === 'busstop' && Life.buses.some((bus: any) => bus.stops.includes(b))) {
      const line = Life.buses.find((bus: any) => bus.stops.includes(b));
      out.push({ label: 'Wait for the next bus', sub: `$${FARES.bus} · ${line.stops.length} stops on the loop · get off at any stop`, act: () => this.wait('bus', b, null) });
      for (const s of line.stops) if (s !== b) out.push({ label: `Bus to ${placeName(s)}`, sub: `$${FARES.bus} · gets you off there`, act: () => this.wait('bus', b, s) });
    }
    if (b.type === 'trainstation' && Life.trains.some((tr: any) => tr.type !== 'freight' && this.servesStation(tr, b))) {
      const pass = ticketFor(bag, 'train');
      const fare = pass ? (pass.pass ? 'your pass' : 'your ticket') : `$${FARES.train} (express $${FARES.express})`;
      for (const s of World.buildings) if (s !== b && s.type === 'trainstation' && active(s) && Life.trains.some((tr: any) => tr.type !== 'freight' && this.servesStation(tr, s)))
        out.push({ label: `Train to the station ${this.dirWord(b, s)}`, sub: `${fare} · the next train that stops there`, act: () => this.wait('train', b, s) });
    }
    if (b.type === 'dock' && Life.ferry) {
      const other = World.buildings.find((d: any) => d !== b && ['dock', 'boatclub', 'fishmarket'].includes(d.type) && active(d) && Life.ferry.route && tilesTo({ x: Life.ferry.route[Life.ferry.route.length - 1][0] * T, y: Life.ferry.route[Life.ferry.route.length - 1][1] * T }, d) < 5);
      const tk = ticketFor(bag, 'ferry');
      out.push({ label: 'Ferry across the water', sub: `${tk ? 'your ticket' : `$${FARES.ferry}`} · to the ${other ? CAT[other.type].name : 'far dock'}`, act: () => this.wait('ferry', b, other || null) });
    }
    if (b.type === 'taxistand') out.push({ label: 'Take a cab', sub: `$${FARES.cabBase} + by the mile · to your GPS destination`, act: () => this.callCab(b) });
    if (b.type === 'heliport') {
      const tk = ticketFor(bag, 'tour');
      out.push({ label: `Sightseeing flight over ${World.name}`, sub: `${tk ? 'your ticket' : `$${FARES.tour}`} · about a minute in the air`, act: () => this.startTour(b) });
    }
    return out;
  }
  private dirWord(a: any, b: any): string {
    const dx = b.x - a.x, dy = b.y - a.y;
    const k = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'east' : 'west') : dy > 0 ? 'south' : 'north';
    return `${k} (${Math.round((Math.abs(dx) + Math.abs(dy)) * TM / 100) / 10} km)`;
  }
  /** does this train call at station `s`? (locals and commuters at every station; the express at its ends) */
  servesStation(tr: any, s: any): boolean {
    if (!tr.route) return false;
    return tr.stopIdx.some((i: number) => tilesTo({ x: tr.route[i][0] * T + 8, y: tr.route[i][1] * T + 8 }, s) < 2.5);
  }

  /* ---------- waiting and boarding ---------- */
  wait(kind: Waiting['kind'], at: any, to: any | null): void {
    this.waiting = { kind, at, to };
    this.toast(`${kind === 'bus' ? '🚏' : kind === 'train' ? '🚉' : '⚓'} Waiting at ${placeName(at)} for the ${kind === 'train' ? 'next train' : kind}${to ? ` to ${placeName(to)}` : ''} — {vehicle} to stop waiting`);
  }
  /** the vehicle standing at `at` right now that we can board */
  private arrived(w: Waiting): any {
    if (w.kind === 'bus') return Life.buses.find((bus: any) => !bus.hidden && bus.pause > 0 && tilesTo(bus, w.at) < 2.6 && (!w.to || bus.stops.includes(w.to))) || null;
    if (w.kind === 'train') return Life.trains.find((tr: any) => !tr.hidden && tr.type !== 'freight' && tr.pause > 0 && tilesTo(tr, w.at) < 3 && (!w.to || this.servesStation(tr, w.to))) || null;
    const f = Life.ferry;
    return f && f.pause > 0 && tilesTo(f, w.at) < 5 ? f : null;
  }
  private board(w: Waiting, v: any): void {
    // the fare: a ticket or pass from the bag, or cash to the stop, station or dock
    const ride = w.kind === 'bus' ? null : w.kind;
    const tk = ride ? ticketFor(this.founder.bag, ride) : null;
    const fare = w.kind === 'bus' ? FARES.bus : w.kind === 'ferry' ? FARES.ferry : v.type === 'express' || v.type === 'nightliner' ? FARES.express : FARES.train;
    if (tk) { punch(this.founder.bag, tk.item); }
    else if (!this.founder.purse.spend(fare, `${w.kind === 'bus' ? 'Bus' : w.kind === 'train' ? 'Train' : 'Ferry'} fare`, 'purchase', w.at)) {
      this.toast(`👛 The fare is $${fare} — you have $${Math.floor(this.founder.purse.balance)}`);
      this.waiting = null;
      return;
    }
    this.waiting = null;
    this.aboard = { kind: w.kind, v, from: w.at, to: w.to, stop: null, moved: 0, last: { x: v.x, y: v.y }, dist: w.kind === 'bus' ? 17 : w.kind === 'train' ? 20 : 22 };
    this.toast(`${w.kind === 'bus' ? '🚌' : w.kind === 'train' ? '🚆' : '⛴️'} You're on the ${w.kind === 'train' ? `${v.type} train` : w.kind}${tk ? (tk.pass ? ' (pass shown)' : ' (ticket punched)') : ` — $${fare}`}. ${w.to ? `It'll let you off at ${placeName(w.to)}.` : 'F gets you off at a stop.'}`);
  }

  /* ---------- the cab ---------- */
  callCab(standHint?: any): boolean {
    if (this.cab || this.aboard) return false;
    const fx = this.founder.pos.x, fz = this.founder.pos.z;
    const here = World.nearestRoad(Math.floor(fx / TM), Math.floor(fz / TM), 6);
    if (!here) { this.toast('🚕 No road here for a cab to reach'); return false; }
    const stands = World.buildings.filter((b: any) => b.type === 'taxistand' && active(b));
    if (!stands.length) { this.toast('🚕 There is no taxi stand in the village yet'); return false; }
    // V2: no cab comes out for a fare that can't pay even the flag-fall (a broke Founder used to ride free)
    if (this.founder.purse.balance < FARES.cabBase + FARES.cabTile * 10) { this.toast(`👛 A cab is at least $${Math.ceil(FARES.cabBase + FARES.cabTile * 10)} — you have $${Math.floor(this.founder.purse.balance)}`); return false; }
    // a free cab from the nearest rank that can reach us
    stands.sort((a: any, b: any) => (a === standHint ? -1 : b === standHint ? 1 : 0) || (Math.abs(a.x * TM - fx) + Math.abs(a.y * TM - fz)) - (Math.abs(b.x * TM - fx) + Math.abs(b.y * TM - fz)));
    for (const st of stands) {
      const cab = Life.taxis.find((c: any) => c.home === st && !c.hired);
      if (!cab) continue;
      const from = { x: Math.floor(cab.x / T), y: Math.floor(cab.y / T) };
      const start = World.isRoad(from.x, from.y) ? from : World.nearestRoad(from.x, from.y, 3);
      const route = start && World.roadPath(start.x, start.y, here.x, here.y);
      if (!route) continue;
      cab.hired = true; cab.pax = []; cab.pause = 0;
      cab.route = route.length > 1 ? route : [route[0], route[0]]; cab.prog = 0; cab.dir = 1; cab.v = 0;
      this.cab = { v: cab, phase: 'coming', stand: st, fare: 0 };
      this.toast(`🚕 A cab is on its way from the ${CAT[st.type].name}${this.gps.dest ? ` — it'll take you to ${this.gps.dest.label}` : ' — set a destination on the phone\'s Map'}`);
      return true;
    }
    this.toast('🚕 All the cabs are out on fares — try again in a few minutes');
    return false;
  }
  private getInCab(): void {
    const c = this.cab!;
    const d = this.gps.dest;
    if (!d) { this.toast('🧭 Where to? Pick a place on the phone\'s Map, then {vehicle} to get in'); this.openMap(); return; }
    const cab = c.v;
    const at = World.nearestRoad(Math.floor(cab.x / T), Math.floor(cab.y / T), 3);
    const to = World.nearestRoad(Math.floor(d.x / TM), Math.floor(d.z / TM), 6);
    const route = at && to && World.roadPath(at.x, at.y, to.x, to.y);
    if (!route || route.length < 2) { this.toast('🚕 "Can\'t get there by road, sorry"'); return; }
    // V2: the fare is quoted before the meter starts, and the driver wants to know you can pay it
    const fare = Math.round(FARES.cabBase + FARES.cabTile * route.length);
    if (this.founder.purse.balance < fare) {
      this.toast(`🚕 "${d.label}? That's about $${fare}." You have $${Math.floor(this.founder.purse.balance)} — pick somewhere nearer on the Map, or walk`);
      return;
    }
    cab.route = route; cab.prog = 0; cab.dir = 1;
    c.fare = fare;
    c.phase = 'riding';
    this.aboard = { kind: 'taxi', v: cab, from: null, to: null, stop: null, moved: 0, last: { x: cab.x, y: cab.y }, dist: 8 };
    this.toast(`🚕 "${d.label}? About $${c.fare}." Off you go`);
  }
  private releaseCab(): void {
    const c = this.cab;
    if (!c) return;
    const cab = c.v;
    cab.hired = false;
    // back to its rank, like any cab after a fare
    const at = World.nearestRoad(Math.floor(cab.x / T), Math.floor(cab.y / T), 3);
    // (V2 (Milestone 8): its own way back, keeping right, rather than the way out driven backwards)
    const back = at && cab.standTile && World.roadPath(at.x, at.y, cab.standTile.x, cab.standTile.y);
    if (back && back.length > 1) { cab.route = back; cab.prog = 0; cab.dir = 1; cab.returning = true; cab.pause = 2; }
    this.cab = null;
  }

  /* ---------- the sightseeing flight ---------- */
  startTour(pad: any): boolean {
    const tk = ticketFor(this.founder.bag, 'tour');
    if (tk) punch(this.founder.bag, tk.item);
    else if (!this.founder.purse.spend(FARES.tour, 'Sightseeing flight', 'purchase', pad)) { this.toast(`👛 The flight is $${FARES.tour}`); return false; }
    const px = (pad.x + pad.w / 2) * TM, pz = (pad.y + pad.h / 2) * TM;
    const c = Gov.townCenter();
    const cx = c.x * TM + 4, cz = c.y * TM + 4;
    const r = Math.max(140, Math.min(260, Math.hypot(px - cx, pz - cz) * 0.8 + 90));
    this.tour = { x: px, z: pz, alt: 0, yaw: 0, phase: 'up', ang: Math.atan2(pz - cz, px - cx), cx, cz, r, rot: 0, pad, t: 0 };
    this.aboard = { kind: 'tour', v: this.tour, from: pad, to: pad, stop: null, moved: 0, last: { x: 0, y: 0 }, dist: 22 };
    this.founder.camPitch = -0.55; // look down over the village (drag to look around)
    this.toast(`🚁 Lifting off from the heliport — ${World.name} from the air${tk ? ' (ticket punched)' : ` ($${FARES.tour})`}`);
    return true;
  }
  private flyTour(dt: number): void {
    const h = this.tour!;
    h.rot += dt * 22;
    h.t += dt;
    const head = (tx: number, tz: number, sp: number): number => {
      const dx = tx - h.x, dz = tz - h.z, d = Math.hypot(dx, dz);
      if (d < 1e-3) return 0;
      const step = Math.min(d, sp * dt);
      h.x += (dx / d) * step; h.z += (dz / d) * step;
      h.yaw = Math.atan2(dx, dz);
      return d - step;
    };
    const padX = (h.pad.x + h.pad.w / 2) * TM, padZ = (h.pad.y + h.pad.h / 2) * TM;
    if (h.phase === 'up') { h.alt += 14 * dt; if (h.alt >= 75) h.phase = 'out'; }
    else if (h.phase === 'out') { if (head(h.cx + Math.cos(h.ang) * h.r, h.cz + Math.sin(h.ang) * h.r, 32) < 2) { h.phase = 'circle'; h.t = 0; } }
    else if (h.phase === 'circle') {
      h.ang += (30 / h.r) * dt;
      head(h.cx + Math.cos(h.ang) * h.r, h.cz + Math.sin(h.ang) * h.r, 40);
      // the view swings round to the village in the middle (a drag still looks wherever you like, for a while)
      let d = Math.atan2(h.cx - h.x, h.cz - h.z) - this.founder.camYaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.founder.camYaw += d * Math.min(1, dt * 0.8);
      if (h.t > (Math.PI * 2.2 * h.r) / 30) h.phase = 'home';
    } else if (h.phase === 'home') { if (head(padX, padZ, 34) < 1) h.phase = 'down'; }
    else if (h.phase === 'down') {
      h.alt -= 12 * dt;
      if (h.alt <= 0) {
        h.alt = 0;
        this.tour = null;
        this.aboard = null;
        this.founder.endRide();
        this.founder.stepOutOf(h.pad);
        this.toast(`🚁 Back on the pad — what a view of ${World.name}`);
      }
    }
  }

  /* ---------- a generic follow-camera (trips: take-offs, landings, the intercity to the edge) ---------- */
  follow(get: (dt: number) => { x: number; y: number; z: number } | null, dist: number, done: () => void): void {
    this.waiting = null;
    this.aboard = { kind: 'follow', v: null, from: null, to: null, stop: null, moved: 0, last: { x: 0, y: 0 }, dist, get, done };
  }
  stopFollowing(): void {
    if (this.aboard?.kind === 'follow') { this.aboard = null; this.founder.endRide(); }
  }

  /* ---------- per frame ---------- */
  riding(): boolean {
    return !!this.aboard;
  }
  update(dt: number): void {
    // a hired cab drives itself through the traffic
    const c = this.cab;
    if (c && c.phase !== 'waiting') {
      const cab = c.v;
      const step = Traffic.advance(cab, cab, cab.route, cab.prog, 1, 1.6, dt);
      cab.prog += step;
      Life.followPath(cab, cab.route, Math.min(cab.prog, cab.route.length - 1), Traffic.lanePx(cab), 1);
      if (nearlyThere(cab, cab.route, step, dt)) {
        if (c.phase === 'coming') { c.phase = 'waiting'; cab.v = 0; this.toast('🚕 Your cab is here — {vehicle} to get in'); }
        else this.dropOff();
      }
    }
    const w = this.waiting;
    if (w) {
      // waiting at the kerb, not standing in the road: the bus mustn't stop short for you
      Traffic.guests = Traffic.guests.filter((g) => g.car);
      if (Math.hypot(this.founder.pos.x - w.at.door.x * TM, this.founder.pos.z - w.at.door.y * TM) > 22) { this.waiting = null; this.toast('🚶 You stopped waiting'); }
      else { const v = this.arrived(w); if (v) this.board(w, v); }
    }
    const a = this.aboard;
    if (!a) return;
    if (a.kind === 'tour') {
      this.flyTour(dt);
      if (this.tour) this.founder.passengerAt(this.tour.x, this.tour.alt, this.tour.z, a.dist);
      return;
    }
    if (a.kind === 'follow') {
      const p = a.get!(dt);
      if (!p) { const d = a.done; this.aboard = null; this.founder.endRide(); d?.(); return; }
      this.founder.passengerAt(p.x, p.y, p.z, a.dist);
      return;
    }
    const v = a.v;
    if (a.kind !== 'taxi' && (a.kind === 'ferry' ? !Life.ferry : a.kind === 'bus' ? !Life.buses.includes(v) || v.hidden : !Life.trains.includes(v) || v.hidden)) {
      // the line closed under us (the stops were bulldozed): off at the nearest door
      this.alight(a.from);
      return;
    }
    a.moved += Math.hypot(v.x - a.last.x, v.y - a.last.y) / T;
    a.last = { x: v.x, y: v.y };
    // standing at a stop? (not the one we got on at, until we've been somewhere)
    a.stop = null;
    if (a.kind !== 'taxi' && v.pause > 0 && a.moved > 2) {
      const types = a.kind === 'bus' ? ['busstop'] : a.kind === 'train' ? ['trainstation'] : ['dock', 'boatclub', 'fishmarket'];
      let best: any = null, bd = a.kind === 'ferry' ? 5 : 3;
      for (const b of World.buildings) {
        if (!types.includes(b.type) || !active(b)) continue;
        const d = tilesTo(v, b);
        if (d < bd) { bd = d; best = b; }
      }
      a.stop = best;
      if (best && (best === a.to || (a.to === null && this.gpsWants(best)))) { this.alight(best); return; }
    }
    const y = a.kind === 'ferry' ? 2.4 : a.kind === 'train' ? 1.6 : 1.1;
    this.founder.passengerAt(v.x * PX, y, v.y * PX, a.dist);
  }
  /** with a GPS destination set and no stop chosen: the stop on the line nearest it */
  private gpsWants(b: any): boolean {
    const d = this.gps.dest;
    const a = this.aboard;
    if (!d || !a || a.kind === 'taxi') return false;
    const types = a.kind === 'bus' ? ['busstop'] : a.kind === 'train' ? ['trainstation'] : ['dock'];
    const cands = World.buildings.filter((o: any) => types.includes(o.type) && active(o));
    const dist = (o: any): number => Math.hypot(o.door.x * TM - d.x, o.door.y * TM - d.z);
    const best = cands.sort((p: any, q: any) => dist(p) - dist(q))[0];
    return best === b && best !== a.from;
  }
  alight(b: any | null): void {
    const a = this.aboard;
    this.aboard = null;
    this.founder.endRide();
    if (b) this.founder.stepOutOf(b);
    if (a && b && a.kind !== 'follow') this.toast(`👋 You got off at ${placeName(b)}`);
  }
  private dropOff(): void {
    const c = this.cab!;
    const cab = c.v;
    // (V2: the meter is paid; if fines took the money on the way, the rest is owed to the rank: no ride is free)
    const paid = this.founder.purse.charge(c.fare, 'Taxi fare', World.buildings.includes(c.stand) ? c.stand : undefined);
    this.aboard = null;
    this.founder.endRide();
    // out on the kerb side
    const side = Math.atan2(cab.dirx || 0, cab.diry || 1) + Math.PI / 2;
    this.founder.placeAt(cab.x * PX + Math.sin(side) * 2.2, cab.y * PX + Math.cos(side) * 2.2, Math.atan2(cab.dirx || 0, cab.diry || 1));
    this.toast(paid >= c.fare ? `🚕 "That's $${c.fare}, thanks!" You're here.` : `🚕 "That's $${c.fare}." You had $${paid} — the other $${c.fare - paid} is owed to the rank, taken as money comes in`);
    this.releaseCab();
  }

  /** the prompt line while waiting or riding (and F's action), or null */
  interaction(): { text: string; act: () => void } | null {
    const c = this.cab;
    if (c && c.phase === 'waiting' && !this.aboard) {
      const d = Math.hypot(c.v.x * PX - this.founder.pos.x, c.v.y * PX - this.founder.pos.z);
      if (d < 7) return { text: `<b>{vehicle}</b> get in the cab${this.gps.dest ? ` to ${this.gps.dest.label}` : ''}`, act: () => this.getInCab() };
    }
    const a = this.aboard;
    if (a) {
      if (a.kind === 'tour') return { text: `🚁 Sightseeing over ${World.name} · drag to look around`, act: () => {} };
      if (a.kind === 'follow') return null;
      if (a.kind === 'taxi') return { text: `🚕 On the way to ${this.gps.dest?.label || 'your stop'} · about $${c?.fare ?? 0}`, act: () => {} };
      if (a.stop) return { text: `<b>{vehicle}</b> get off at ${placeName(a.stop)}`, act: () => this.alight(a.stop) };
      return { text: `${a.kind === 'bus' ? '🚌 On the bus' : a.kind === 'train' ? '🚆 On the train' : '⛴️ On the ferry'}${a.to ? ` to ${placeName(a.to)}` : ' · F at a stop to get off'}`, act: () => {} };
    }
    const w = this.waiting;
    if (w) return { text: `${w.kind === 'bus' ? '🚏' : w.kind === 'train' ? '🚉' : '⚓'} Waiting for the ${w.kind === 'train' ? 'train' : w.kind}${w.to ? ` to ${placeName(w.to)}` : ''} · <b>{vehicle}</b> stop waiting`, act: () => { this.waiting = null; } };
    return null;
  }

  /** extra things to draw: the sightseeing helicopter */
  draw(vehicle: (type: string, x: number, y: number, z: number, yaw: number, paint: string, rotor: number) => void): void {
    const h = this.tour;
    if (h) vehicle('heli', h.x, h.alt, h.z, h.yaw, '#c8302a', h.rot);
  }

  reset(): void {
    if (this.cab) this.releaseCab();
    if (this.aboard) this.founder.endRide();
    this.aboard = null;
    this.waiting = null;
    this.tour = null;
  }
}

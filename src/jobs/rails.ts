/* ============================================================
   Wave 6c — rails and skies (design §11).
   - Train driver: the cab of the village line's own passenger
     service (the all-stops local if it runs, else the commuter
     or the express). W for power, S for the brake; stop with the
     cab at each platform and the doors open: riders off, the
     waiting on. Overshoot a platform and it's missed; come in
     too fast at the end of the line and it's the buffers. Keep
     to the timetable for a bonus. The level crossings hold for
     you like for any train.
   - Pilot: the airport's airliner. Throttle up along the runway,
     lift the nose (E; Q puts it down), climb out and fly off the
     map's edge for the city; the hours pass at home behind the
     journey screen, the passengers swap at the other end, and
     the flight home comes back in over the fields: line up with
     the runway and land it yourself. The visitors it brings walk
     into town, and the hold carries trade.
   ============================================================ */
import { Game } from '../sim/game';
import { Sim } from '../sim/agents';
import { World, GW, GH } from '../sim/world';
import { Life } from '../sim/life';
import { CAT } from '../sim/catalog';
import { Gov } from '../sim/gov';
import { T } from '../sim/core';
import { Gateways, CITIES, City } from '../sim/gateways';
import { Supply } from '../sim/supply';
import { tilesTo } from '../player/transit';
import { hoursLabel } from '../player/travel';
import * as THREE from 'three';
import { Act, Draw, Job, ShiftCtx, PX, TM, wrap } from './common';

const kmh = (mps: number): number => Math.round(mps * 3.6);
const metres = (d: number): string => (d < 1000 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toFixed(1)} km`);

/** "the station by the Bakery": a station named after its most notable neighbour */
export function stationName(st: any): string {
  if (!st) return 'the next station';
  let best: any = null, bd = 1e9;
  for (const o of World.buildings) {
    if (o === st || o.ruined || ['trainstation', 'busstop', 'house', 'cottage', 'house2', 'house3'].includes(o.type) || CAT[o.type].cat === 'nature') continue;
    const d = Math.abs(o.x - st.x) + Math.abs(o.y - st.y);
    if (d < bd) { bd = d; best = o; }
  }
  if (best && bd < 24) return `the station by the ${CAT[best.type].name}`;
  // nothing much near it: by which side of the village it's on
  const c = Gov.townCenter(), dx = st.x + st.w / 2 - c.x, dy = st.y + st.h / 2 - c.y;
  return `the ${Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'east' : 'west') : dy > 0 ? 'south' : 'north'} station`;
}
const cap = (s: string): string => s[0].toUpperCase() + s.slice(1);

/* ---------- train driver ---------- */
/** tiles per second² under power and on the brake; the line's top speeds */
const POWER = 0.3, BRAKE = 0.85, TOP: Record<string, number> = { express: 4.4, nightliner: 3.6, local: 3.4, commuter: 3.4 };
const DWELL = 6;

export class TrainJob implements Job {
  tr: any = null;
  /** tiles a second */
  v = 0;
  stopAt = -1;
  dwell = 0;
  pax = 0;
  calls = 0;
  private legT = 0;
  private legDue = 60;

  constructor(private c: ShiftCtx) {
    const order = ['local', 'commuter', 'express', 'nightliner'];
    const tr = Life.trains.filter((t: any) => t.type !== 'freight' && t.route && t.route.length > 3)
      .sort((a: any, b: any) => order.indexOf(a.type) - order.indexOf(b.type))[0];
    if (!tr) return;
    this.tr = tr;
    tr.driver = true; // (the sim leaves it to you: src/sim/life.ts)
    tr.hidden = false;
    tr.pause = 0;
    // the cab at this station's platform
    let k = 0, bd = Infinity;
    tr.route.forEach((_: any, i: number) => { const d = tilesTo(this.pt(i), c.b); if (d < bd) { bd = d; k = i; } });
    const end = tr.route.length - 1;
    tr.prog = k;
    tr.dir = k >= end ? -1 : k <= 0 ? 1 : end - k > k ? 1 : -1;
    tr.lastStop = k;
    Life.followPath(tr, tr.route, tr.prog, 0);
    this.next();
    c.f.camPitch = -0.5; // (high enough to see over the lineside trees)
  }
  private pt(i: number): { x: number; y: number } {
    const [x, y] = this.tr.route[Math.max(0, Math.min(this.tr.route.length - 1, i))];
    return { x: x * T + 8, y: y * T + 8 };
  }
  /** the station at route index `i` */
  stationAt(i: number): any {
    let best: any = null, bd = 3.5;
    for (const b of World.buildings) {
      if (b.type !== 'trainstation' || b.ruined || b.construction) continue;
      const d = tilesTo(this.pt(i), b);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
  /** the next platform ahead (turning round at the end of the line) */
  private next(): void {
    const tr = this.tr;
    const find = (): number => {
      const idx = tr.stopIdx.filter((i: number) => (i - tr.prog) * tr.dir > 0.5);
      return idx.length ? (tr.dir > 0 ? Math.min(...idx) : Math.max(...idx)) : -1;
    };
    let s = find();
    if (s < 0) { tr.dir = -tr.dir; s = find(); }
    this.stopAt = s;
    this.legT = 0;
    this.legDue = s >= 0 ? Math.abs(s - tr.prog) / 2.4 + 12 : 60;
  }
  private call(): void {
    const tr = this.tr, st = this.stationAt(this.stopAt);
    this.dwell = DWELL;
    this.v = 0;
    let homes = 0;
    if (st) for (const b of World.buildings) if (CAT[b.type].res && !b.ruined && Math.abs(b.x - st.x) + Math.abs(b.y - st.y) < 24) homes++;
    const end = this.stopAt === 0 || this.stopAt === tr.route.length - 1;
    const off = end ? this.pax : Math.min(this.pax, Math.floor(this.pax * (0.3 + Math.random() * 0.4)));
    const on = st ? Math.min(60, 2 + Math.floor(homes / 2) + Math.floor(Math.random() * 5)) : 0;
    this.pax = this.pax - off + on;
    if (st) st.visitors = (st.visitors || 0) + on;
    const onTime = this.legT <= this.legDue;
    this.calls++;
    this.c.earn(3 + on + (onTime ? 3 : 0), `Train: ${stationName(st)}`);
    this.c.good(onTime ? 0.5 : 0.2);
    this.c.toast(`🚉 ${cap(stationName(st))}: ${on} aboard, ${off} off${onTime ? ' — right on time' : ''}`);
    tr.lastStop = this.stopAt;
    this.stopAt = -1;
  }

  carrying(): boolean { return !!this.tr; }
  update(dt: number): void {
    const tr = this.tr, f = this.c.f;
    if (!tr) return;
    if (!Life.trains.includes(tr)) { // the line was rebuilt under us
      this.tr = null;
      f.endRide();
      f.stepOutOf(this.c.b);
      this.c.toast('🛤️ The line was closed for works — the shift ends at the platform');
      return;
    }
    const ctl = this.c.controls(), top = TOP[tr.type] ?? 3.4;
    if (this.dwell > 0) {
      this.v = 0;
      this.dwell -= dt;
      if (this.dwell <= 0) this.next();
    } else {
      if (ctl.gas > 0) this.v = Math.min(top, this.v + POWER * ctl.gas * dt);
      if (ctl.brake > 0) this.v = Math.max(0, this.v - BRAKE * ctl.brake * dt);
      if (!ctl.gas && !ctl.brake) this.v = Math.max(0, this.v - 0.02 * dt);
      this.legT += dt;
    }
    tr.prog += this.v * dt * tr.dir;
    const end = tr.route.length - 1;
    if (tr.prog >= end || tr.prog <= 0) {
      tr.prog = Math.max(0, Math.min(end, tr.prog));
      if (this.v > 0.6) this.c.bad('Into the buffers — far too fast at the end of the line');
      this.v = 0;
    }
    Life.followPath(tr, tr.route, tr.prog, 0);
    if (this.stopAt >= 0 && this.dwell <= 0) {
      const ahead = (this.stopAt - tr.prog) * tr.dir;
      if (ahead < -1) { this.c.bad(`Ran through ${stationName(this.stationAt(this.stopAt))} without stopping`); tr.lastStop = this.stopAt; this.next(); }
      else if (Math.abs(ahead) < 0.8 && this.v < 0.15) this.call();
    }
    f.passengerAt(tr.x * PX, 3.1, tr.y * PX, 16);
  }
  line(): Act | null {
    if (!this.tr) return null;
    const speed = kmh(this.v * TM);
    return { text: this.dwell > 0 ? `🚆 Doors open — passengers boarding · ${Math.ceil(this.dwell)} s` : `🚆 <b>W</b> power · <b>S</b> brake · ${speed} km/h`, act: () => {} };
  }
  interaction(): Act | null { return null; }
  objective(): { text: string; sub?: string; k?: number } {
    const tr = this.tr;
    if (!tr) return { text: 'No passenger trains run on the village line', sub: 'Two stations joined by rail start the trains' };
    if (this.dwell > 0) return { text: `Doors open at ${stationName(this.stationAt(tr.lastStop))}`, sub: `${this.pax} aboard`, k: 1 - this.dwell / DWELL };
    const st = this.stopAt >= 0 ? this.stationAt(this.stopAt) : null;
    const ahead = this.stopAt >= 0 ? Math.abs(this.stopAt - tr.prog) * TM : 0;
    const late = this.legT > this.legDue;
    return {
      text: `Next: ${stationName(st)}`,
      sub: `${metres(ahead)} · ${kmh(this.v * TM)} km/h · ${this.pax} aboard · ${late ? 'running late' : `due in ${Math.ceil(this.legDue - this.legT)} s`} · stop with the cab at the platform`,
      k: Math.min(1, this.legT / this.legDue),
    };
  }
  marker(): { x: number; y: number; z: number; icon: string } | null {
    if (!this.tr || this.stopAt < 0) return null;
    const p = this.pt(this.stopAt);
    return { x: p.x * PX, y: 4, z: p.y * PX, icon: '🚉' };
  }
  busy(): boolean { return !!this.tr && this.dwell <= 0 && this.v > 0.2; }
  end(): void {
    const tr = this.tr, f = this.c.f;
    this.tr = null;
    if (!tr) return;
    tr.driver = false; // back to the timetable
    tr.pause = 3;
    tr.lastStop = Math.round(tr.prog);
    f.endRide();
    let st: any = null, bd = Infinity;
    for (const b of World.buildings) if (b.type === 'trainstation' && !b.ruined) { const d = tilesTo(tr, b); if (d < bd) { bd = d; st = b; } }
    f.stepOutOf(st || this.c.b);
  }
}

/* ---------- pilot ---------- */
type Phase = 'roll' | 'climb' | 'out' | 'away' | 'approach' | 'rollout' | 'gate';
/** lift-off speed, and the slowest the airliner flies (m/s) */
const ROTATE = 38, STALL = 30;
const PAINT = new THREE.Color('#f4f6f7');

export class PilotJob implements Job {
  phase: Phase = 'roll';
  /** the airliner (metres; `vs` is the climb rate, `thr` the throttle 0…1) */
  pl = { x: 0, z: 0, alt: 0, yaw: Math.PI / 2, v: 0, vs: 0, thr: 0, roll: 0 };
  dest: City;
  pax = 0;
  flights = 0;
  trip: { left: number; t0: number; minMs: number; back: boolean; city: boolean; event: string | null } | null = null;
  private legs = 0;

  constructor(private c: ShiftCtx) {
    this.dest = this.pickDest();
    this.toRunway();
  }
  private pickDest(): City {
    const air = CITIES.filter((q) => q.modes.air);
    return air[this.legs++ % air.length];
  }
  /** the runway along the airport's south apron, as the village's own planes use it (metres) */
  runway(): { y: number; x0: number; x1: number } {
    const f = Life.airfield(this.c.b);
    return { y: f.ry, x0: f.rx0, x1: f.rx1 };
  }
  private toRunway(): void {
    const r = this.runway();
    Object.assign(this.pl, { x: r.x0 + 4, z: r.y, alt: 0, yaw: Math.PI / 2, v: 0, vs: 0, thr: 0, roll: 0 });
    this.phase = 'roll';
  }

  carrying(): boolean { return true; }
  overlay(): boolean { return this.phase === 'away'; }
  locked(): string | null {
    return this.phase === 'roll' || this.phase === 'gate' ? null : 'You\'re flying — land her first';
  }
  busy(): boolean { return this.phase !== 'gate' && this.phase !== 'roll'; }

  update(dt: number): void {
    const p = this.pl, ctl = this.c.controls();
    // the village's planes keep off the runway while the Founder takes off or comes in
    Life.runwayHeld = this.phase === 'roll' || this.phase === 'climb' || this.phase === 'rollout' || (this.phase === 'approach' && p.alt < 90);
    const ground = this.phase === 'roll' || this.phase === 'rollout' || this.phase === 'gate';
    if (this.phase === 'gate') { p.v = 0; }
    else if (ground) {
      p.thr = Math.max(0, Math.min(1, p.thr + (ctl.gas - ctl.brake) * dt * 0.7));
      const acc = p.thr * 13 - 0.0009 * p.v * p.v - (ctl.brake > 0 || this.phase === 'rollout' ? 7 + ctl.brake * 9 : 0.6);
      p.v = Math.max(0, p.v + acc * dt);
      p.yaw -= ctl.steer * 0.35 * Math.min(1, p.v / 12) * dt;
      p.vs = 0;
      p.alt = 0;
      p.roll *= 0.9;
      if (this.phase === 'roll' && p.v > ROTATE && ctl.pitch > 0.2) { this.phase = 'climb'; p.vs = 3; this.c.toast('✈️ Wheels up — climb out (E), A/D to turn'); }
      if (this.phase === 'rollout' && p.v < 2) this.landed();
    } else {
      p.thr = Math.max(0, Math.min(1, p.thr + (ctl.gas - ctl.brake) * dt * 0.5));
      p.v = Math.max(0, Math.min(95, p.v + (p.thr * 9 - 0.0011 * p.v * p.v - p.vs * 0.08) * dt));
      // (the last few metres down, the airliner flares and settles by itself; E still pulls up to go around)
      const flare = this.phase === 'approach' && p.alt < 6 && ctl.pitch <= 0.2;
      const want = p.v < STALL ? -10 : flare ? Math.max(-3, Math.min(-1.8, ctl.pitch * 12)) : ctl.pitch * 12;
      p.vs += (want - p.vs) * Math.min(1, dt * 1.5);
      p.alt += p.vs * dt;
      p.roll += (ctl.steer * 0.6 - p.roll) * Math.min(1, dt * 2);
      p.yaw -= p.roll * 0.9 * dt;
      if (this.phase === 'climb' && p.alt > 40) this.phase = 'out';
      if (p.alt <= 0) this.touchdown();
    }
    p.x += Math.sin(p.yaw) * p.v * dt;
    p.z += Math.cos(p.yaw) * p.v * dt;
    const edge = GW * TM;
    if (this.phase === 'out' && (p.x < -30 || p.z < -30 || p.x > edge + 30 || p.z > GH * TM + 30) && p.alt > 35) this.leave();
    this.c.f.passengerAt(p.x, p.alt + 2.5, p.z, 32);
  }

  /** the wheels met the ground: on the runway, gently, it's a landing */
  private touchdown(): void {
    const p = this.pl, r = this.runway();
    const lined = Math.abs(wrap(p.yaw - Math.PI / 2)) < 0.4 || Math.abs(wrap(p.yaw + Math.PI / 2)) < 0.4;
    // (on the runway, from just short of the threshold to with room left to stop)
    const onRunway = p.x > r.x0 - 40 && p.x < r.x1 - 90 && Math.abs(p.z - r.y) < 10;
    const vs = p.vs;
    p.alt = 0; p.vs = 0;
    if (onRunway && lined && vs > -6 && p.v < 64) {
      this.phase = 'rollout';
      this.c.toast(vs > -2.5 ? '✈️ A butter-smooth touchdown — S to brake' : '✈️ Down — a firm one. S to brake');
      this.gentle = vs > -2.5;
      return;
    }
    // anywhere else: a rough landing in the fields (everyone walks away; the airline isn't pleased)
    this.c.bad('A rough landing off the runway — the plane is towed back to the stand');
    this.c.earn(15, 'Flight (rough landing)');
    this.flights++;
    Gateways.landed(this.c.b);
    this.phase = 'gate';
    this.atStand();
  }
  private gentle = false;
  private landed(): void {
    const a = this.c.b;
    this.flights++;
    this.c.earn(70 + (this.gentle ? 20 : 8), `Flight to ${this.dest.name} and back`);
    this.c.good(this.gentle ? 2.5 : 1.5);
    // the visitors walk into town; the hold brings trade (a little more room for imports today)
    Gateways.landed(a);
    a.visitors = (a.visitors || 0) + this.pax;
    a.funds = (a.funds || 0) + this.pax * 1.2;
    Supply.allow.prod += 8;
    Supply.allow.tex += 4;
    this.c.toast(`✈️ Landed at ${World.name}! ${this.pax} passengers off — the visitors head into town`, undefined, true);
    this.phase = 'gate';
    this.atStand();
  }
  /** taxied in to the Founder's stand (the last on the apron), nose to the taxiway */
  private atStand(): void {
    const s = Life.airfield(this.c.b).stands[3];
    Object.assign(this.pl, { x: s.x, z: s.z, alt: 0, yaw: 0, v: 0, vs: 0, thr: 0, roll: 0 });
    this.dest = this.pickDest();
  }

  /** off the map's edge: the hours pass at home behind the journey screen */
  private leave(): void {
    this.pax = 60 + Math.floor(Math.random() * 90);
    // the airline's takings go to the airport (it pays its pilot at clock-off)
    this.c.b.visitors = (this.c.b.visitors || 0) + this.pax;
    this.c.b.funds = (this.c.b.funds || 0) + this.pax * 1.2;
    Gateways.leave(this.dest, 'air');
    this.phase = 'away';
    this.beginLeg(false);
  }
  private beginLeg(back: boolean): void {
    const mins = Math.round((this.dest.modes.air?.hours ?? 1.5) * 60);
    this.trip = { left: mins, t0: performance.now(), minMs: 4200 + Math.min(2500, mins * 8), back, city: false, event: null };
    Game.setSpeed(1);
  }
  frame(now: number): void {
    const t = this.trip, view = this.c.travelView();
    if (!t || this.phase !== 'away') return;
    if (t.city) return; // (the turnaround card waits for its button)
    if (t.left > 0) { const n = Math.min(t.left, 30); Game.catchUp(n); t.left -= n; }
    const k = Math.min(1, (now - t.t0) / t.minMs);
    if (!t.event && k > 0.5) t.event = t.back ? `Cruising home at 11,000 m — ${World.name} on the horizon.` : `Smooth air over the hills; the cabin crew serve coffee.`;
    view?.journey({ from: t.back ? this.dest.name : World.name, to: t.back ? World.name : this.dest.name, mode: 'air', icon: '✈️', k, clock: `Day ${Sim.day} · ${Sim.timeStr()}`, event: t.event, back: t.back });
    if (t.left > 0 || now - t.t0 < t.minMs) return;
    if (!t.back) {
      t.city = true;
      const home = 40 + Math.floor(Math.random() * 80);
      view?.city({
        c: this.dest, clock: `Day ${Sim.day} · ${Sim.timeStr()}`,
        notes: [`You flew ${this.pax} passengers into ${this.dest.name}.`, `${home} are boarding for ${World.name} — visitors, and people coming home.`],
        actions: [{ label: `Fly home to ${World.name}`, sub: hoursLabel(this.dest.modes.air?.hours ?? 1.5), act: () => { this.pax = home; this.beginLeg(true); } }],
      });
      if (!view) { this.pax = home; this.beginLeg(true); }
      return;
    }
    this.approach();
  }
  /** home: in over the fields, lined up with the runway, and the landing is yours */
  private approach(): void {
    this.c.travelView()?.hide();
    this.trip = null;
    Gateways.back();
    const r = this.runway();
    Object.assign(this.pl, { x: r.x0 - 1100, z: r.y, alt: 120, yaw: Math.PI / 2, v: 66, vs: -1, thr: 0.42, roll: 0 });
    this.phase = 'approach';
    this.c.toast(`✈️ Back over ${World.name}: the runway is dead ahead — ease down (Q), throttle back (S), and land her gently`);
  }

  line(): Act | null {
    const p = this.pl;
    if (this.phase === 'gate') return { text: `✈️ At the stand · <b>E</b> fly the next flight, to ${this.dest.name}`, act: () => this.toRunway() };
    const keys = this.phase === 'rollout' ? '<b>S</b> brake' : this.phase === 'roll' ? '<b>W</b>/<b>S</b> throttle · <b>E</b> nose up' : '<b>E</b>/<b>Q</b> climb, descend · <b>A</b>/<b>D</b> turn · <b>W</b>/<b>S</b> throttle';
    return { text: `✈️ ${kmh(p.v)} km/h · ${Math.round(p.alt)} m · throttle ${Math.round(p.thr * 100)}% · ${keys}`, act: () => {} };
  }
  interaction(): Act | null { return null; }
  objective(): { text: string; sub?: string; k?: number } {
    const p = this.pl, r = this.runway();
    switch (this.phase) {
      case 'roll': return { text: `Take off for ${this.dest.name}`, sub: `${kmh(p.v)} km/h · throttle up (W); at ${kmh(ROTATE)} km/h lift the nose (E)`, k: Math.min(1, p.v / ROTATE) };
      case 'climb': return { text: 'Climb out', sub: `${Math.round(p.alt)} m · keep the speed up` };
      case 'out': {
        const edge = Math.min(p.x, p.z, GW * TM - p.x, GH * TM - p.z);
        return { text: `Fly out of ${World.name}'s airspace`, sub: `${metres(Math.max(0, edge))} to the edge of the map · ${Math.round(p.alt)} m up` };
      }
      case 'away': return { text: `Flying to ${this.dest.name}`, sub: `${this.pax} passengers` };
      case 'approach': {
        const ahead = r.x0 - p.x;
        return { text: `Land at ${World.name}`, sub: `runway ${metres(Math.abs(ahead))} ${ahead >= 0 ? 'ahead' : 'behind'} · ${Math.round(p.alt)} m · ${kmh(p.v)} km/h · cross the airport fence low (10 m), under ${kmh(64)} km/h: it flares by itself` };
      }
      case 'rollout': return { text: 'Touchdown — brake to a stop', sub: `${kmh(p.v)} km/h · hold S` };
      default: return { text: 'At the stand', sub: this.flights ? `${this.flights} flight${this.flights > 1 ? 's' : ''} today · E for the next, or clock off` : 'E for the next flight' };
    }
  }
  marker(): { x: number; y: number; z: number; icon: string } | null {
    if (this.phase !== 'approach') return null;
    const r = this.runway();
    return { x: (r.x0 + r.x1) / 2, y: 2, z: r.y, icon: '🛬' };
  }
  draw(d: Draw): void {
    if (this.phase === 'away') return;
    const p = this.pl;
    d.vehicle('plane', p.x, p.alt, p.z, p.yaw, PAINT, { pitch: Math.max(-0.25, Math.min(0.12, -p.vs * 0.014)), roll: -p.roll * 0.6 });
  }
  end(): void {
    const f = this.c.f;
    Life.runwayHeld = false;
    this.c.travelView()?.hide();
    if (this.phase === 'away') Gateways.back();
    this.trip = null;
    f.endRide();
    f.stepOutOf(this.c.b);
  }
}

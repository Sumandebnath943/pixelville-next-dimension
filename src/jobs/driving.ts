/* ============================================================
   Wave 6b — driving for a living (design §11).
   - Taxi driver: the fares are real villagers: someone at a
     venue who wants to get home, or at home with an evening out
     in mind. They wait at the kerb; pull up beside them, drive
     them there, and the meter comes out of their household's
     purse (the rank takes its cut). Keep them waiting too long
     and they give up.
   - Bus driver: the village line, stop to stop. Pull in at each
     stop and the real queue boards (riders get off along the
     way); keep to the timetable for a bonus.
   - Delivery driver: the loads the village's own trucks would
     carry: a producer's yard or the warehouse to a shop running
     low or a building site waiting for materials. Load up,
     drive, unload: the shelves fill, the site restarts.
   ============================================================ */
import { Sim } from '../sim/agents';
import { World } from '../sim/world';
import { Life } from '../sim/life';
import { CAT } from '../sim/catalog';
import { T } from '../sim/core';
import { Rep } from '../sim/reputation';
import { Health } from '../sim/health';
import { Power } from '../sim/power';
import { Supply, SELLS, MAKES, LOAD, GOODS, Good } from '../sim/supply';
import { Economy } from '../sim/economy';
import { placeName } from '../player/transit';
import {
  Act, Draw, Job, ShiftCtx, active, distTo, doorM, here, kerbM, nowAbs, stoppedNear,
} from './common';

const nameOf = (b: any): string => CAT[b.type].name;
const metres = (d: number): string => (d < 1000 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toFixed(1)} km`);
/** a building in a few words: "home", "the Bakery" */
const spot = (p: any, b: any): string => (b === p.home ? 'home' : `the ${nameOf(b)}`);

/* ---------- taxi driver ---------- */
export const METER = { base: 3, tile: 0.12 };
/** game-minutes a fare waits at the kerb before giving up */
const FARE_WAIT = 25;

interface Fare { p: any; from: any; to: any; phase: 'hail' | 'ride'; at: number; kerb: { x: number; z: number }; cost: number }

export class TaxiJob implements Job {
  fare: Fare | null = null;
  private next = 3;
  served = 0;

  constructor(private c: ShiftCtx) {}

  /** somewhere to go for someone at home: an open venue, the ones near home most likely */
  private outing(p: any): any {
    const open = World.buildings.filter((b: any) => {
      const h = CAT[b.type].hours;
      return CAT[b.type].visit && active(b) && !Power.closed(b) && (!h || (Sim.clock >= h.s && Sim.clock < h.e - 60));
    });
    if (!open.length) return null;
    open.sort((a: any, b: any) => (Math.abs(a.x - p.home.x) + Math.abs(a.y - p.home.y)) - (Math.abs(b.x - p.home.x) + Math.abs(b.y - p.home.y)));
    return open[Math.floor(Math.random() ** 1.5 * Math.min(10, open.length))];
  }
  /** a real villager who'd like a cab, near the cab */
  findFare(): boolean {
    const h = here(this.c.f);
    const evening = Sim.clock > 540 && Sim.clock < 1290;
    // (someone about to leave a venue or their work, or at home with an evening ahead; nobody who's just had a ride)
    const leaving = (p: any): boolean => p.returnAt !== undefined && p.returnAt - Sim.clock < 40;
    const t = nowAbs();
    const cands = Sim.people.filter((p: any) => p.kind !== 'kid' && p.state === 'in' && p.at?.connected && !p.ward && !Health.resting(p) && !p.carHeld && !p.backTo &&
      t - (p.cabAt ?? -1e9) > 180 && (p.at === p.home ? evening : leaving(p)))
      .map((p: any) => ({ p, d: Math.hypot(doorM(p.at).x - h.x, doorM(p.at).z - h.z) }))
      .filter((o: any) => o.d < 700)
      .sort((a: any, b: any) => a.d - b.d)
      .slice(0, 14);
    for (const { p } of cands) {
      const from = p.at, to = from !== p.home ? p.home : this.outing(p);
      if (!to || to === from || !to.connected) continue;
      const a = Life.streetTile(from), b = Life.streetTile(to);
      const path = a && b && World.roadPath(a.x, a.y, b.x, b.y);
      if (!path || path.length < 10) continue; // not worth a cab
      if ((p.home?.funds || 0) - 5 < Math.round(METER.base + METER.tile * path.length)) continue; // (V2: nor one they can't pay for)
      this.hail(p, from, to, path.length);
      return true;
    }
    return false;
  }
  private hail(p: any, from: any, to: any, tiles: number): void {
    const k = kerbM(from), d = doorM(from);
    p.state = 'hail'; // (out at the kerb, waiting: the sim leaves them be)
    p.x = (d.x * 0.35 + k.x * 0.65) * 2;
    p.y = (d.z * 0.35 + k.z * 0.65) * 2;
    this.fare = { p, from, to, phase: 'hail', at: nowAbs(), kerb: k, cost: Math.round(METER.base + METER.tile * tiles) };
    this.c.gps.set(k.x, k.z, `Fare · ${p.name} at ${spot(p, from)}`);
    this.c.toast(`🚕 A fare: ${Sim.fullName(p)} at ${spot(p, from)} wants to go ${to === p.home ? 'home' : `to the ${nameOf(to)}`}`, { x: k.x * 2, y: k.z * 2 });
  }
  private pickUp(): void {
    const fr = this.fare!, p = fr.p;
    if (fr.from !== p.home) fr.from.inside = Math.max(0, fr.from.inside - 1);
    p.state = 'cab';
    p.cabAt = nowAbs();
    fr.phase = 'ride';
    fr.at = nowAbs();
    const k = kerbM(fr.to);
    this.c.gps.set(k.x, k.z, `${p.name} · ${spot(p, fr.to)}`);
    this.c.toast(`🚕 "${fr.to === p.home ? 'Home' : `The ${nameOf(fr.to)}`}, please." The meter's running — about $${fr.cost}`);
  }
  /** out at the door: the sim's own arrival does the rest (visit, purchase, home for the night) */
  private arrive(fr: Fare): void {
    const p = fr.p, to = fr.to;
    p.state = 'walk';
    p.dest = to;
    p.until = to === p.home ? undefined : Math.min(1435, Sim.clock + 60 + Math.random() * 60);
    p.trip = { path: [[to.door.x, to.door.y], [to.door.x, to.door.y]], prog: 1, car: null, taxi: false, moto: false };
    p.x = to.door.x * T + 8; p.y = to.door.y * T + 8;
    p.freezeT = 0; p.knocked = false;
  }
  private dropOff(): void {
    const fr = this.fare!, p = fr.p;
    this.fare = null;
    this.next = 3;
    this.arrive(fr);
    // the meter (and a tip), from the household's purse into the rank's till: the driver's 60% is paid at clock-off
    // (V2: a fare short of the meter owes the rank the rest: it used to be let off)
    const stand = World.buildings.includes(this.c.b) ? this.c.b : null;
    const paid = Math.min(fr.cost, Math.max(0, Math.floor(p.home.funds)));
    if (paid < fr.cost) Economy.owe(p.home, stand, fr.cost - paid);
    const tip = Rep.of(p) >= 1 && p.home.funds - paid > 30 ? 1 + Math.round(Math.random()) : 0;
    p.home.funds -= paid + tip;
    if (stand) { stand.funds = (stand.funds || 0) + paid + tip; stand.visitors = (stand.visitors || 0) + 1; }
    this.c.earn(paid * 0.6 + tip, `Fare: ${p.name} to ${spot(p, fr.to)}`);
    this.c.good(nowAbs() - fr.at < 20 ? 0.7 : 0.4);
    this.served++;
    Rep.feel(p, 1, 'the Founder drove me across town in their cab', `drove ${p.name} across town in a cab`);
    this.c.toast(paid >= fr.cost ? `🚕 "Thanks!" — $${paid} on the meter${tip ? `, and a $${tip} tip` : ''}` : `🚕 ${p.name} paid $${paid} of the $${fr.cost} — the rest is owed to the rank`);
    this.c.gps.clear();
  }
  private giveUp(): void {
    const fr = this.fare!, p = fr.p;
    this.fare = null;
    this.next = 5;
    p.state = 'in'; // back inside
    p.bubble = '😒'; p.bubbleUntil = performance.now() + 3000;
    this.c.bad(`${p.name} gave up waiting for the cab`);
    this.c.gps.clear();
  }

  update(dt: number): void {
    const fr = this.fare, f = this.c.f;
    if (!fr) {
      this.next -= dt;
      if (this.next <= 0) { this.next = 6; this.findFare(); }
      return;
    }
    const p = fr.p;
    if (!Sim.people.includes(p) || p.state !== (fr.phase === 'hail' ? 'hail' : 'cab')) { this.fare = null; return; }
    if (fr.phase === 'hail') {
      if (nowAbs() - fr.at > FARE_WAIT) { this.giveUp(); return; }
      if (this.c.atWheel() && Math.abs(f.car.speed) < 0.8 && stoppedNear(f, fr.kerb.x, fr.kerb.z, 10)) this.pickUp();
      return;
    }
    const k = kerbM(fr.to);
    if (!World.buildings.includes(fr.to) || fr.to.ruined) fr.to = p.home;
    if (this.c.atWheel() && Math.abs(f.car.speed) < 0.8 && stoppedNear(f, k.x, k.z, 12)) this.dropOff();
  }
  interaction(): Act | null { return null; }
  objective(): { text: string; sub?: string; k?: number } {
    const fr = this.fare, f = this.c.f;
    if (!fr) return { text: 'Cruising for a fare', sub: this.served ? `${this.served} fare${this.served > 1 ? 's' : ''} so far` : 'Someone will want a cab soon' };
    const p = fr.p;
    if (fr.phase === 'hail') {
      const left = Math.max(0, FARE_WAIT - (nowAbs() - fr.at));
      return { text: `Pick up ${p.name} at ${spot(p, fr.from)}`, sub: `${metres(distTo(f, fr.kerb.x, fr.kerb.z))} · stop beside them · they'll wait ${Math.ceil(left)} min`, k: left / FARE_WAIT };
    }
    const k = kerbM(fr.to);
    return { text: `Take ${p.name} to ${spot(p, fr.to)}`, sub: `${metres(distTo(f, k.x, k.z))} · about $${fr.cost} on the meter` };
  }
  marker(): { x: number; y: number; z: number; icon: string } | null {
    const fr = this.fare;
    if (!fr) return null;
    if (fr.phase === 'hail') return { x: fr.p.x / 2, y: 2.4, z: fr.p.y / 2, icon: '🙋' };
    const k = kerbM(fr.to);
    return { x: k.x, y: 2.6, z: k.z, icon: '🏁' };
  }
  busy(): boolean { return this.fare?.phase === 'ride'; }
  draw(d: Draw): void {
    const fr = this.fare;
    if (!fr || fr.phase !== 'hail') return;
    const p = fr.p, x = p.x / 2, z = p.y / 2;
    d.person({ x, y: this.c.f.groundAt(x, z), z, yaw: Math.atan2(fr.kerb.x - x, fr.kerb.z - z), kind: p.kind, seed: p.seed, mode: 'stand', phase: 0 });
  }
  end(): void {
    const fr = this.fare;
    this.fare = null;
    if (!fr) return;
    if (fr.phase === 'hail' && fr.p.state === 'hail') fr.p.state = 'in';
    else if (fr.phase === 'ride' && fr.p.state === 'cab') this.arrive(fr); // dropped off on the way back to the rank
  }
}

/* ---------- bus driver ---------- */
const BUS_CAP = 40;

export class BusJob implements Job {
  idx = -1;
  dir = 1;
  pax: { seed: number; kind: string }[] = [];
  private dwell = 0;
  private legT = 0;
  private legDue = 90;
  served = 0;

  constructor(private c: ShiftCtx) {}

  private stops(): any[] {
    return (Life.buses[0]?.stops || []).filter((s: any) => active(s));
  }
  private target(): any {
    const st = this.stops();
    if (!st.length) return null;
    if (this.idx < 0 || this.idx >= st.length) {
      // the first stop: the one after where the shift began
      const h = here(this.c.f);
      let best = 0, bd = Infinity;
      st.forEach((s: any, i: number) => { const d = Math.hypot(doorM(s).x - h.x, doorM(s).z - h.z); if (d < bd) { bd = d; best = i; } });
      this.idx = bd < 30 ? (best + 1) % st.length : best;
      this.dir = 1;
      this.setLeg(st[this.idx]);
    }
    return st[this.idx];
  }
  private setLeg(s: any): void {
    const h = here(this.c.f);
    const a = World.nearestRoad(Math.floor(h.x / 8), Math.floor(h.z / 8), 3), b = Life.streetTile(s);
    const path = a && b && World.roadPath(a.x, a.y, b.x, b.y);
    this.legT = 0;
    this.legDue = (path ? path.length : 30) / 1.0 + 15; // real seconds at 1×, with a little slack
    const k = kerbM(s);
    this.c.gps.set(k.x, k.z, `Bus · ${placeName(s)}`);
  }

  update(dt: number): void {
    const s = this.target(), f = this.c.f;
    if (!s) return;
    this.legT += dt;
    const k = kerbM(s);
    if (this.c.atWheel() && Math.abs(f.car.speed) < 0.8 && stoppedNear(f, k.x, k.z, 15)) {
      this.dwell += dt;
      if (this.dwell > 1.5) this.serve(s);
    } else this.dwell = 0;
  }
  /** at the stop: riders off, the queue on */
  private serve(s: any): void {
    const st = this.stops();
    const end = this.idx + this.dir < 0 || this.idx + this.dir >= st.length;
    const door = { x: s.door.x * T + 8, y: s.door.y * T + 6 };
    const ax = s.door.x - (s.x + s.w / 2), ay = s.door.y - (s.y + s.h / 2) || 1;
    const off = end ? this.pax.length : Math.min(this.pax.length, 1 + Math.floor(Math.random() * 3));
    for (let i = 0; i < off; i++) Life.spawnAlighter(door.x, door.y, ax, ay, this.pax.shift());
    const q = Life.stopQueues.get(s.id);
    const on = q ? Math.min(q.waiting.length, BUS_CAP - this.pax.length) : 0;
    for (let i = 0; i < on; i++) this.pax.push(q.waiting.shift());
    s.visitors = (s.visitors || 0) + on;
    const onTime = this.legT <= this.legDue;
    this.served += on;
    this.c.earn(2 + on * 1.5 + (onTime ? 2 : 0), `Bus stop: ${placeName(s)}`);
    this.c.good(onTime ? 0.4 : 0.1);
    if (on >= 3) this.c.toast(`🚌 ${on} aboard at ${placeName(s)}${onTime ? ' — right on time' : ''}`);
    // on to the next stop (back the other way at the end of the line)
    if (end) this.dir = -this.dir;
    this.idx = Math.max(0, Math.min(st.length - 1, this.idx + this.dir));
    this.dwell = 0;
    this.setLeg(st[this.idx]);
  }

  interaction(): Act | null { return null; }
  objective(): { text: string; sub?: string; k?: number } {
    const s = this.target(), f = this.c.f;
    if (!s) return { text: 'No bus line runs today', sub: 'The village needs two stops joined by road' };
    const k = kerbM(s), q = Life.stopQueues.get(s.id);
    const late = this.legT > this.legDue;
    return {
      text: `Next stop: ${placeName(s)}`,
      sub: `${metres(distTo(f, k.x, k.z))} · ${q?.waiting.length || 0} waiting · ${this.pax.length} aboard · ${late ? 'running late' : `due in ${Math.ceil(this.legDue - this.legT)} s`}`,
      k: Math.min(1, this.legT / this.legDue),
    };
  }
  marker(): { x: number; y: number; z: number; icon: string } | null {
    const s = this.target();
    if (!s) return null;
    const k = kerbM(s);
    return { x: k.x, y: 3, z: k.z, icon: '🚏' };
  }
  end(): void {
    // everyone off at the last stop
    this.pax = [];
  }
}

/* ---------- delivery driver ---------- */
interface Load { src: any; dst: any; g: Good; n: number; phase: 'load' | 'drop'; load: number }

export class TruckJob implements Job {
  job: Load | null = null;
  private scanT = 0;
  done = 0;

  constructor(private c: ShiftCtx) {}

  /** the most pressing load the village needs carried that has something in town to carry */
  plan(): boolean {
    const needs: { b: any; g: Good; n: number; prio: number }[] = [];
    for (const b of World.buildings) {
      if (!b.connected || b.ruined) continue;
      if (b.construction > 0) {
        const want = Supply.siteWant(b);
        if (want > 0 && b.mats < Math.max(6, b.matsNeed * 0.4)) needs.push({ b, g: 'mats', n: want, prio: b.stalled ? 3 : 2 });
        continue;
      }
      const s = SELLS[b.type];
      if (!s || MAKES[b.type]) continue;
      Supply.init(b);
      const have = b.stock + Supply.incoming(b);
      if (have < s.cap * 0.6) needs.push({ b, g: s.g, n: s.cap - have, prio: 1 + (1 - b.stock / s.cap) });
    }
    needs.sort((a, b) => b.prio - a.prio);
    for (const nd of needs) {
      const n = Math.min(LOAD, Math.ceil(nd.n));
      const src = Supply.source(nd.g, nd.b, n);
      if (!src || !World.roadPath(src.door.x, src.door.y, nd.b.door.x, nd.b.door.y)) continue;
      this.job = { src, dst: nd.b, g: nd.g, n, phase: 'load', load: 0 };
      Supply.founderLoad = { to: nd.b, g: nd.g, n }; // (the village's trucks leave this one to you)
      const k = kerbM(src);
      this.c.gps.set(k.x, k.z, `Pick up · the ${nameOf(src)}`);
      this.c.toast(`📦 A load: ${n} ${GOODS[nd.g].name.toLowerCase()} from the ${nameOf(src)} for the ${nameOf(nd.b)}${nd.b.stalled ? ' — the site is waiting' : ''}`);
      return true;
    }
    return false;
  }
  private loadUp(): void {
    const j = this.job!, src = j.src;
    const have = Math.floor(src.store ? src.store[j.g] || 0 : src.stock || 0);
    const take = Math.min(j.n, have);
    if (take < 1) { this.drop(); this.c.toast(`📦 The ${nameOf(src)}'s yard is bare — someone got there first`); return; }
    if (src.store) src.store[j.g] -= take; else src.stock -= take;
    j.load = take;
    j.phase = 'drop';
    Supply.founderLoad = { to: j.dst, g: j.g, n: take };
    const k = kerbM(j.dst);
    this.c.gps.set(k.x, k.z, `Deliver · the ${nameOf(j.dst)}`);
    this.c.toast(`📦 ${take} ${GOODS[j.g].name.toLowerCase()} aboard — off to the ${nameOf(j.dst)}`);
  }
  private unload(): void {
    const j = this.job!;
    this.job = null;
    Supply.founderLoad = null;
    // the village's own delivery: the shop pays wholesale to the yard, a site's materials go on the pile
    Supply.unload({ kind: 'deliver', g: j.g, n: j.load, to: j.dst, from: j.src });
    this.done++;
    this.c.earn(8 + j.load * 0.4, `Delivered ${GOODS[j.g].name.toLowerCase()} to the ${nameOf(j.dst)}`);
    this.c.good(j.dst.stalled || j.dst.stock < 3 ? 1.5 : 1);
    for (const w of j.dst.workers || []) Rep.feel(w, 0.5, `the Founder brought a delivery to the ${nameOf(j.dst)}`);
    this.c.toast(`📦 Delivered ${j.load} ${GOODS[j.g].name.toLowerCase()} to the ${nameOf(j.dst)}${j.dst.construction > 0 ? ' — the builders get going again' : ' — the shelves are stocked'}`);
    this.c.gps.clear();
    this.scanT = 2;
  }
  /** give the job up: anything aboard goes back to where it came from */
  private drop(): void {
    const j = this.job;
    this.job = null;
    Supply.founderLoad = null;
    if (j && j.load > 0 && World.buildings.includes(j.src)) { if (j.src.store) j.src.store[j.g] += j.load; else j.src.stock += j.load; }
  }

  update(dt: number): void {
    const j = this.job;
    if (!j) {
      this.scanT -= dt;
      if (this.scanT <= 0) { this.scanT = 4; this.plan(); }
      return;
    }
    if (!World.buildings.includes(j.dst) || j.dst.ruined || (j.phase === 'load' && !active(j.src))) this.drop();
  }
  interaction(): Act | null {
    const j = this.job, f = this.c.f;
    if (!j) return null;
    const at = j.phase === 'load' ? j.src : j.dst, k = kerbM(at), d = doorM(at);
    if (!stoppedNear(f, k.x, k.z, 16) && !stoppedNear(f, d.x, d.z, 12)) return null;
    return j.phase === 'load'
      ? { text: `<b>{interact}</b> load ${j.n} ${GOODS[j.g].name.toLowerCase()} at the ${nameOf(j.src)}`, act: () => this.loadUp() }
      : { text: `<b>{interact}</b> unload at the ${nameOf(j.dst)}`, act: () => this.unload() };
  }
  objective(): { text: string; sub?: string; k?: number } {
    const j = this.job, f = this.c.f;
    if (!j) return { text: 'Waiting for a load', sub: this.done ? `${this.done} delivered so far` : 'The shelves and the sites have what they need for now' };
    const at = j.phase === 'load' ? j.src : j.dst, k = kerbM(at), far = metres(distTo(f, k.x, k.z));
    return j.phase === 'load'
      ? { text: `Pick up at the ${nameOf(j.src)}`, sub: `${far} · ${j.n} ${GOODS[j.g].name.toLowerCase()} for the ${nameOf(j.dst)}` }
      : { text: `Deliver to the ${nameOf(j.dst)}`, sub: `${far} · ${j.load} ${GOODS[j.g].name.toLowerCase()} aboard · stop at the door, {interact}` };
  }
  marker(): { x: number; y: number; z: number; icon: string } | null {
    const j = this.job;
    if (!j) return null;
    const d = doorM(j.phase === 'load' ? j.src : j.dst);
    return { x: d.x, y: 3.4, z: d.z, icon: j.phase === 'load' ? GOODS[j.g].emoji : '📦' };
  }
  busy(): boolean { return this.job?.phase === 'drop'; }
  end(): void { this.drop(); }
}

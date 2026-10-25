/* ============================================================
   Wave 6d — the town's own work (design §11).
   - Electrician: the power plant's van. A power cut comes to
     you: at the pole, isolate the line, replace what blew and
     restore the supply, and the district lights up. Between
     faults, service the substations (they ride out the next
     storm far better).
   - Construction worker: any building site. Carry the bricks
     from the pallet to the scaffold and the walls rise faster;
     when the pallet's bare, take the van to a yard for a load.
   - Shop worker / chef: behind the counter of a shop, café or
     restaurant. The real customers inside give their orders;
     make it at the counter and take it to them. Served well,
     they grow fond of the place (and come back); kept waiting,
     they don't.
   - PVTV reporter: the editor's assignment, from what's really
     happening: a fire, a crash, a power cut, a stalled site,
     bare shelves, a business booming. Get there, film it (on
     foot, the subject in shot), and file it at the station: it
     goes out on PVTV, and a story about a shortage gets the
     county moving.
   - Farmer: the tractor, the field and the season: sow in
     spring, harvest in summer and autumn (the food goes to the
     yard), plough and muck-spread in winter. Drive along each
     row; a tended field yields more all week.
   ============================================================ */
import { Sim } from '../sim/agents';
import { World } from '../sim/world';
import { Life } from '../sim/life';
import { CAT } from '../sim/catalog';
import { Rep } from '../sim/reputation';
import { Mind } from '../sim/mind';
import { News } from '../sim/news';
import { Tasks } from '../sim/tasks';
import { Power } from '../sim/power';
import { Weather } from '../sim/weather';
import { Supply, GOODS, SELLS, YARD, Good } from '../sim/supply';
import { WARES, Ware } from '../interiors/plan';
import {
  Act, Draw, Job, ShiftCtx, TM, Work, active, distTo, doorM, facing, here, kerbM, midM, nearestDoor, nowAbs, onFootNear, stoppedNear, toPlot,
} from './common';

const nameOf = (b: any): string => CAT[b.type].name;
const metres = (d: number): string => (d < 1000 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toFixed(1)} km`);
/** a point in a building's own frame (x across its front, z toward the door), in the world */
export function local(b: any, lx: number, lz: number): { x: number; z: number } {
  const f = b.facing || 0, m = midM(b);
  const [rx, rz] = f === 0 ? [lx, lz] : f === 1 ? [lz, -lx] : f === 2 ? [-lx, -lz] : [-lz, lx];
  return { x: m.x + rx, z: m.z + rz };
}

/* ---------- electrician ---------- */
const POWER_WAIT = 90;
const STAGES = [[0.35, 'Isolating the line'], [0.8, 'Replacing the blown gear'], [1.01, 'Restoring the supply']] as const;

export class PowerJob implements Job {
  call: { d: number; key: string; at: number; arrived: boolean; w: Work; spot: { x: number; z: number } } | null = null;
  service: { d: number; spot: { x: number; z: number }; w: Work } | null = null;
  private released = new Set<string>();
  private scanT = 0;

  constructor(private c: ShiftCtx) {}

  /** the pole at the kerb in the middle of a district (metres) */
  spotFor(d: number): { x: number; z: number } | null {
    const cen = Power.centre(d);
    const r = World.nearestRoad(cen.x, cen.y, 10);
    if (!r) return null;
    for (const [dx, dz] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) if (!World.isRoad(r.x + dx, r.y + dz)) return { x: r.x * TM + 4 + dx * 3.6, z: r.y * TM + 4 + dz * 3.6 };
    return { x: r.x * TM + 1, z: r.y * TM + 1 };
  }
  claim(kind: string, d: number): boolean {
    const f = Power.faults.get(d);
    if (kind !== 'power' || !f) return false;
    const key = `${d}:${f.since}`;
    if (this.released.has(key)) return false;
    if (this.call) return this.call.key === key;
    const spot = this.spotFor(d);
    if (!spot) return false;
    this.call = { d, key, at: nowAbs(), arrived: false, w: new Work(9), spot };
    this.service = null;
    this.c.toast(`⚡ Power cut in ${Power.where(d)} — the lines are yours to mend`, { x: spot.x * 2, y: spot.z * 2 });
    this.c.gps.set(spot.x, spot.z, `Power cut · ${Power.where(d)}`);
    return true;
  }
  private release(): void {
    const call = this.call!, f = Power.faults.get(call.d);
    this.released.add(call.key);
    this.call = null;
    if (f) { f.crew = false; f.founder = false; } // (the plant's own van goes on the next tick)
    this.c.bad(`Too slow to the power cut in ${Power.where(call.d)} — the plant sent its own crew`);
  }

  update(dt: number): void {
    const f = this.c.f, call = this.call;
    f.beacon = !!call || !!this.service;
    if (call) {
      if (!Power.faults.has(call.d)) { this.call = null; return; } // mended by someone else
      if (!call.arrived && distTo(f, call.spot.x, call.spot.z) < 25) call.arrived = true;
      if (!call.arrived && nowAbs() - call.at > POWER_WAIT) { this.release(); return; }
      if (call.w.t > 0 && call.w.step(dt, onFootNear(f, call.spot.x, call.spot.z, 4.5))) {
        const mins = nowAbs() - call.at;
        this.call = null;
        Power.restore(call.d, 'the Founder mended the lines');
        this.c.earn(30 + (mins < 40 ? 10 : 0), `Mended the lines in ${Power.where(call.d)}`);
        this.c.good(2);
        Rep.broadcast(0.1);
        this.c.gps.clear();
      }
      return;
    }
    // between faults: service the substations not seen this week
    this.scanT -= dt;
    if (!this.service && this.scanT <= 0) {
      this.scanT = 3;
      const h = here(f);
      let best: PowerJob['service'] = null, bd = Infinity;
      for (const d of Power.builtDistricts()) {
        if ((Power.serviced.get(d) ?? 0) > Sim.day || Power.faults.has(d)) continue;
        const spot = this.spotFor(d);
        if (!spot) continue;
        const dd = Math.hypot(spot.x - h.x, spot.z - h.z);
        if (dd < bd) { bd = dd; best = { d, spot, w: new Work(5) }; }
      }
      if (best) { this.service = best; this.c.gps.set(best.spot.x, best.spot.z, `Substation · ${Power.where(best.d)}`); }
    }
    const s = this.service;
    if (s && s.w.t > 0 && s.w.step(dt, onFootNear(f, s.spot.x, s.spot.z, 4.5))) {
      Power.serviced.set(s.d, Sim.day + 7);
      this.service = null;
      this.c.earn(6, `Serviced a substation`);
      this.c.good(0.4);
      this.c.toast(`🔧 Serviced the substation in ${Power.where(s.d)} — it'll ride out a storm far better this week`);
    }
  }
  interaction(): Act | null {
    const f = this.c.f, call = this.call, s = this.service;
    if (call && call.w.t === 0 && onFootNear(f, call.spot.x, call.spot.z, 4.5)) return { text: '<b>E</b> climb the pole and mend the lines', act: () => { call.w.t = 1e-3; } };
    if (!call && s && s.w.t === 0 && onFootNear(f, s.spot.x, s.spot.z, 4.5)) return { text: `<b>E</b> service the substation`, act: () => { s.w.t = 1e-3; } };
    return null;
  }
  objective(): { text: string; sub?: string; k?: number } {
    const f = this.c.f, call = this.call, s = this.service;
    if (call) {
      if (call.w.t > 0) return { text: STAGES.find(([k]) => call.w.k < k)![1], sub: `Power cut in ${Power.where(call.d)}`, k: call.w.k };
      return { text: `Power cut in ${Power.where(call.d)}`, sub: `${metres(distTo(f, call.spot.x, call.spot.z))} · ${call.arrived ? 'on foot at the pole, E' : 'the district is in the dark'}` };
    }
    if (s) return s.w.t > 0 ? { text: 'Servicing the substation', sub: Power.where(s.d), k: s.w.k } : { text: `Service the substation in ${Power.where(s.d)}`, sub: `${metres(distTo(f, s.spot.x, s.spot.z))} · on foot at the pole, E` };
    return { text: 'Standing by at the plant', sub: 'Every substation has been serviced this week' };
  }
  marker(): { x: number; y: number; z: number; icon: string } | null {
    const t = this.call?.spot || this.service?.spot;
    return t ? { x: t.x, y: 8.4, z: t.z, icon: this.call ? '⚡' : '🔧' } : null;
  }
  busy(): boolean { return !!this.call && this.call.w.t > 0; }
  draw(d: Draw): void {
    const t = this.call?.spot || this.service?.spot;
    if (t) d.prop('pole', t.x, this.c.f.groundAt(t.x, t.z), t.z, 0);
  }
  end(): void {
    const call = this.call;
    if (call) {
      this.released.add(call.key);
      const f = Power.faults.get(call.d);
      if (f) { f.crew = false; f.founder = false; }
    }
    this.call = null;
    this.service = null;
    this.c.f.beacon = false;
  }
}

/* ---------- construction worker ---------- */
/** game-minutes of building one load on the scaffold is worth */
const LOAD_WORK = 18;

export class BuildJob implements Job {
  site: any;
  holding = false;
  run: { src: any; phase: 'fetch' | 'bring'; load: number } | null = null;
  loads = 0;
  private scanT = 0;

  constructor(private c: ShiftCtx) {
    this.site = c.b && c.b.construction > 0 ? c.b : null;
  }
  private pallet(b: any): { x: number; z: number } {
    const d = CAT[b.type];
    return local(b, ((d.w || 1) * TM) / 2 - 1.2, ((d.h || 1) * TM) / 2 - 1.1);
  }
  private nextSite(): void {
    const h = here(this.c.f);
    const sites = World.buildings.filter((b: any) => b.construction > 0 && b.connected && !b.ruined);
    this.site = nearestDoor(sites, h.x, h.z);
    if (this.site) { const k = kerbM(this.site); this.c.gps.set(k.x, k.z, `Building site · the ${nameOf(this.site)}`); }
  }

  update(dt: number): void {
    const s = this.site;
    if (!s || !(s.construction > 0) || !World.buildings.includes(s) || s.ruined) {
      if (s && !s.construction && !s.ruined && World.buildings.includes(s)) {
        this.c.earn(10, `Topped out the ${nameOf(s)}`);
        this.c.good(1);
        this.c.toast(`🏗️ The ${nameOf(s)} is finished — on to the next site`);
      }
      this.holding = false;
      this.scanT -= dt;
      if (this.scanT <= 0) { this.scanT = 3; this.nextSite(); }
      return;
    }
    Supply.initSite(s);
    // a bare pallet and bricks still to lay: a run to a yard for a load
    if (!this.run && !this.holding && s.mats < 1 && Supply.siteWant(s) > 0) {
      this.scanT -= dt;
      if (this.scanT <= 0) {
        this.scanT = 4;
        const src = Supply.source('mats', s, 6);
        if (src) {
          this.run = { src, phase: 'fetch', load: 0 };
          const k = kerbM(src);
          this.c.gps.set(k.x, k.z, `Materials · the ${nameOf(src)}`);
          this.c.toast(`🧱 The pallet's bare — take the van to the ${nameOf(src)} for a load`);
        }
      }
    }
  }
  private lay(): void {
    const s = this.site;
    this.holding = false;
    const done = Supply.build(s, LOAD_WORK); // (uses the bricks; the sim finishes the job when the work runs out)
    s.construction = Math.max(0.5, s.construction - done);
    this.loads++;
    this.c.earn(4, `Laid a load at the ${nameOf(s)}`);
    this.c.good(0.3);
  }
  private fetch(): void {
    const r = this.run!, src = r.src;
    const have = Math.floor(src.store ? src.store.mats || 0 : src.stock || 0);
    const take = Math.min(12, have, Math.ceil(Supply.siteWant(this.site)));
    if (take < 1) { this.run = null; this.c.toast(`🧱 Nothing left at the ${nameOf(src)}`); return; }
    if (src.store) src.store.mats -= take; else src.stock -= take;
    r.load = take;
    r.phase = 'bring';
    Supply.founderLoad = { to: this.site, g: 'mats', n: take };
    const k = kerbM(this.site);
    this.c.gps.set(k.x, k.z, `Building site · the ${nameOf(this.site)}`);
  }
  private bring(): void {
    const r = this.run!;
    this.run = null;
    Supply.founderLoad = null;
    Supply.unload({ kind: 'deliver', g: 'mats', n: r.load, to: this.site, from: r.src });
    this.c.earn(8, `Brought materials to the ${nameOf(this.site)}`);
    this.c.good(this.site.stalled ? 1.5 : 1);
    this.c.toast(`🧱 ${r.load} loads of materials on the pallet — back to the scaffold`);
  }
  interaction(): Act | null {
    const s = this.site, f = this.c.f;
    if (!s || !(s.construction > 0)) return null;
    const r = this.run;
    if (r) {
      const at = r.phase === 'fetch' ? r.src : s, k = kerbM(at), d = doorM(at);
      if (!stoppedNear(f, k.x, k.z, 16) && !stoppedNear(f, d.x, d.z, 12)) return null;
      return r.phase === 'fetch' ? { text: `<b>E</b> load the van at the ${nameOf(r.src)}`, act: () => this.fetch() } : { text: '<b>E</b> unload the materials onto the site', act: () => this.bring() };
    }
    if (f.driving) return null;
    if (this.holding) return toPlot(s, f.pos.x, f.pos.z) < 2.6 ? { text: '<b>E</b> set the load on the scaffold', act: () => this.lay() } : null;
    const p = this.pallet(s);
    if (s.mats >= 1 && Math.hypot(f.pos.x - p.x, f.pos.z - p.z) < 2.8) return { text: '<b>E</b> pick up a load of bricks', act: () => { this.holding = true; } };
    return null;
  }
  objective(): { text: string; sub?: string; k?: number } {
    const s = this.site, f = this.c.f;
    if (!s || !(s.construction > 0)) return { text: 'No building sites in town', sub: 'Put something up in the Planner and there will be' };
    const k = 1 - s.construction / Math.max(1, s.conTotal || s.construction);
    const r = this.run;
    if (r) {
      const at = r.phase === 'fetch' ? r.src : s, kb = kerbM(at);
      return r.phase === 'fetch' ? { text: `Fetch materials from the ${nameOf(r.src)}`, sub: `${metres(distTo(f, kb.x, kb.z))} · stop at the door, E`, k } : { text: `Bring the materials to the ${nameOf(s)}`, sub: `${metres(distTo(f, kb.x, kb.z))} · ${r.load} aboard`, k };
    }
    if (this.holding) return { text: 'Carry the load to the scaffold', sub: `The ${nameOf(s)} · ${Math.round(k * 100)}% built`, k };
    if (s.mats < 1) return { text: `The ${nameOf(s)} is out of materials`, sub: 'Looking for a yard with bricks and timber…', k };
    return { text: `Build the ${nameOf(s)}`, sub: `${Math.round(k * 100)}% built · the pallet by the site, E · ${this.loads} loads laid`, k };
  }
  marker(): { x: number; y: number; z: number; icon: string } | null {
    const s = this.site;
    if (!s || !(s.construction > 0)) return null;
    if (this.run) { const d = doorM(this.run.phase === 'fetch' ? this.run.src : s); return { x: d.x, y: 3.4, z: d.z, icon: '🧱' }; }
    if (this.holding) { const m = midM(s); return { x: m.x, y: 6, z: m.z, icon: '🏗️' }; }
    const p = this.pallet(s);
    return s.mats >= 1 ? { x: p.x, y: 1.8, z: p.z, icon: '🧱' } : null;
  }
  busy(): boolean { return this.run?.phase === 'bring'; }
  draw(d: Draw): void {
    const f = this.c.f;
    if (this.holding && !f.driving) d.prop('carry', f.pos.x, f.pos.y, f.pos.z, f.yaw);
  }
  end(): void {
    const r = this.run;
    this.run = null;
    Supply.founderLoad = null;
    if (r && r.phase === 'bring' && r.load > 0 && World.buildings.includes(r.src)) { if (r.src.store) r.src.store.mats += r.load; else r.src.stock += r.load; }
    this.holding = false;
  }
}

/* ---------- shop worker / chef ---------- */
/** seconds a customer waits for what they ordered */
const PATIENCE = 90;
interface Order { item: Ware | null; state: 'wait' | 'ordered'; at: number }

export class ShopJob implements Job {
  orders = new Map<any, Order>();
  served = new Set<any>();
  carry: { p: any; item: Ware } | null = null;
  prep: { p: any; w: Work } | null = null;
  count = 0;

  constructor(private c: ShiftCtx) {}

  private room(): any {
    const r = this.c.indoors();
    return r && r.active && r.b === this.c.b ? r : null;
  }
  private wares(): Ware[] {
    return WARES[this.c.b.type] || [{ name: 'cup of tea', price: 2, food: true }];
  }
  update(dt: number): void {
    const room = this.room();
    if (!room) return;
    const now = performance.now();
    const here = new Set(room.people.filter((o: any) => !o.staff).map((o: any) => o.p));
    // newcomers give their orders; those who leave take theirs with them
    for (const p of here) if (!this.served.has(p) && !this.orders.has(p)) this.orders.set(p, { item: null, state: 'wait', at: now });
    for (const [p, o] of this.orders) {
      if (!here.has(p)) { this.orders.delete(p); continue; }
      if (o.state === 'ordered' && now - o.at > PATIENCE * 1000 && this.prep?.p !== p && this.carry?.p !== p) {
        this.orders.delete(p);
        this.served.add(p);
        p.mood = Math.max(5, (p.mood ?? 60) - 3);
        this.c.bad(`${p.name} got tired of waiting for their ${o.item?.name.toLowerCase()}`);
      }
    }
    if (this.carry && !here.has(this.carry.p)) this.carry = null;
    if (this.prep) {
      const s = room.L.spots.find((q: any) => q.kind === 'counter');
      const near = s && Math.hypot(room.pos.x - s.x, room.pos.y - s.z) < 1.8;
      if (!here.has(this.prep.p)) this.prep = null;
      else if (this.prep.w.step(dt, !!near)) {
        const o = this.orders.get(this.prep.p);
        this.carry = { p: this.prep.p, item: o!.item! };
        this.prep = null;
      }
    }
  }
  private serve(): void {
    const { p, item } = this.carry!, b = this.c.b;
    this.carry = null;
    this.orders.delete(p);
    this.served.add(p);
    const mult = Supply.sale(b, p); // (from the shelves: bare ones send them away disappointed)
    if (mult === null) { this.c.bad(`Sold out — no ${item.name.toLowerCase()} for ${p.name}`); return; }
    const price = Math.round(item.price * mult);
    if (p.home.funds > price + 5) { p.home.funds -= price; b.funds = (b.funds || 0) + price; }
    // (a tip goes in the till with the price: the business pays its staff, the Founder included, at clock-off)
    const tip = Rep.of(p) >= 0.5 && p.home.funds > 25 ? 1 + Math.round(Math.random() * 2) : 0;
    p.home.funds -= tip;
    b.funds = (b.funds || 0) + tip;
    p.mood = Math.min(98, (p.mood ?? 60) + 4);
    Mind.enjoy(p, b, 0.6); // fond of the place: they'll be back
    Rep.feel(p, 0.8, `the Founder served me at the ${nameOf(b)}`);
    this.count++;
    this.c.earn(2 + tip, `Served ${p.name}`);
    this.c.good(0.5);
    this.c.toast(`😋 ${p.name} enjoys the ${item.name.toLowerCase()}${tip ? ` — a $${tip} tip` : ''}`);
  }
  interaction(): Act | null {
    const room = this.room();
    if (!room || room.seated) return null;
    const u = room.use();
    if (this.carry) {
      if (u?.kind === 'person' && u.who.p === this.carry.p) return { text: `<b>E</b> serve ${this.carry.p.name} the ${this.carry.item.name.toLowerCase()}`, act: () => this.serve() };
      return null;
    }
    if (u?.kind === 'person' && !u.who.staff) {
      const p = u.who.p, o = this.orders.get(p);
      if (o?.state === 'wait') {
        return {
          text: `<b>E</b> take ${p.name}'s order`, act: () => {
            const w = this.wares();
            o.item = w[Math.floor(Math.random() * w.length)];
            o.state = 'ordered';
            o.at = performance.now();
            this.c.toast(`🛎️ ${p.name}: "${/^[aeiou]/i.test(o.item.name) ? 'An' : 'A'} ${o.item.name.toLowerCase()}, please."`);
          },
        };
      }
    }
    if (u?.kind === 'spot' && u.spot.kind === 'counter' && !this.prep) {
      const next = [...this.orders].find(([, o]) => o.state === 'ordered');
      if (next) return { text: `<b>E</b> make ${next[0].name}'s ${next[1].item!.name.toLowerCase()}`, act: () => { this.prep = { p: next[0], w: new Work(3) }; } };
    }
    return null;
  }
  objective(): { text: string; sub?: string; k?: number } {
    const room = this.room();
    if (!room) return { text: `Into the ${nameOf(this.c.b)} — your shift's behind the counter`, sub: 'E at the door' };
    if (this.carry) return { text: `Take the ${this.carry.item.name.toLowerCase()} to ${this.carry.p.name}`, sub: 'Face them, E' };
    if (this.prep) return { text: `Making ${this.prep.p.name}'s order`, sub: 'At the counter', k: this.prep.w.k };
    const ordered = [...this.orders].filter(([, o]) => o.state === 'ordered');
    if (ordered.length) return { text: `Make ${ordered[0][0].name}'s ${ordered[0][1].item!.name.toLowerCase()}`, sub: `At the counter · ${ordered.length} order${ordered.length > 1 ? 's' : ''} waiting`, k: 1 - Math.min(1, (performance.now() - ordered[0][1].at) / (PATIENCE * 1000)) };
    const waiting = [...this.orders].filter(([, o]) => o.state === 'wait');
    if (waiting.length) return { text: `${waiting.length} customer${waiting.length > 1 ? 's' : ''} to serve`, sub: 'Face them, E to take the order' };
    return { text: 'Quiet in here', sub: this.count ? `${this.count} served so far · customers come and go with the hour` : 'Customers come and go with the hour' };
  }
  marker(): { x: number; y: number; z: number; icon: string } | null {
    const room = this.room();
    if (!room) { const d = doorM(this.c.b); return { x: d.x, y: 3.2, z: d.z, icon: '🛎️' }; }
    const at = (p: any): any => room.people.find((o: any) => o.p === p);
    if (this.carry) { const o = at(this.carry.p); return o ? { x: o.place.x, y: o.place.pose === 'sit' ? 1.6 : 2.15, z: o.place.z, icon: '🍽️' } : null; }
    if (this.prep) return null;
    if ([...this.orders.values()].some((o) => o.state === 'ordered')) {
      const s = room.L.spots.find((q: any) => q.kind === 'counter');
      return s ? { x: s.x, y: 1.6, z: s.z - 0.9, icon: '🍳' } : null;
    }
    const w = [...this.orders].find(([, o]) => o.state === 'wait');
    const o = w && at(w[0]);
    return o ? { x: o.place.x, y: o.place.pose === 'sit' ? 1.6 : 2.15, z: o.place.z, icon: '🛎️' } : null;
  }
  busy(): boolean { return !!this.carry || !!this.prep; }
  end(): void {
    this.orders.clear();
    this.carry = this.prep = null;
  }
}

/* ---------- PVTV reporter ---------- */
interface Story { key: string; head: string; x: number; z: number; live: () => boolean; w: Work; filmed: boolean; hot: boolean; effect?: () => void }

export class ReporterJob implements Job {
  story: Story | null = null;
  filming = false;
  private filed = new Set<string>();
  private scanT = 0;
  stories = 0;

  constructor(private c: ShiftCtx) {}

  /** what's really happening that's worth a report: live incidents first, then features */
  assignments(): Story[] {
    const day = Sim.day, out: Story[] = [];
    const mk = (key: string, head: string, at: { x: number; z: number }, live: () => boolean, hot: boolean, effect?: () => void): void => {
      if (!this.filed.has(`${key}@${day}`)) out.push({ key: `${key}@${day}`, head, x: at.x, z: at.z, live, w: new Work(8), filmed: false, hot, effect });
    };
    for (const b of World.buildings) if (b.fire) mk(`fire${b.id}`, `Fire at the ${nameOf(b)}: PVTV on the scene`, midM(b), () => !!b.fire, true);
    const cr = Life.crash;
    if (cr) mk(`crash${Math.round(cr.x)}`, 'Collision on a village street: PVTV at the scene', { x: cr.x / 2, z: cr.y / 2 }, () => Life.crash === cr, true);
    const dsp = Life.dispute;
    if (dsp) mk(`dispute${Math.round(dsp.x)}`, 'A shouting match in the street', { x: dsp.x / 2, z: dsp.y / 2 }, () => Life.dispute === dsp, true);
    const cm = Life.crime;
    if (cm && cm.burglar.phase !== 'approach') mk(`crime${cm.target.id}`, `Break-in at the ${nameOf(cm.target)}`, doorM(cm.target), () => Life.crime === cm, true);
    const rl = Life.rally;
    if (rl) mk('rally', 'On the campaign trail: the rally in town', { x: rl.x / 2, z: rl.y / 2 }, () => Life.rally === rl, true);
    for (const [d] of Power.faults) {
      const cen = Power.centre(d);
      mk(`power${d}`, `In the dark: the power cut in ${Power.where(d)}`, { x: cen.x * TM + 4, z: cen.y * TM + 4 }, () => Power.faults.has(d), true);
    }
    // features
    for (const b of World.buildings) {
      if (b.ruined || !b.connected) continue;
      if (b.construction > 0 && b.stalled) mk(`stall${b.id}`, `Stalled: the ${nameOf(b)} site waits for materials`, midM(b), () => b.construction > 0, false, () => { Supply.allow.mats += 10; });
      else if (b.construction > 0) mk(`rise${b.id}`, `Going up: a new ${nameOf(b)} for ${World.name}`, midM(b), () => b.construction > 0, false);
      else if (SELLS[b.type] && (b.stock ?? 1) < 1 && active(b)) {
        const g: Good = SELLS[b.type].g;
        mk(`bare${b.id}`, `Bare shelves at the ${nameOf(b)}: ${GOODS[g].name.toLowerCase()} run short`, doorM(b), () => true, false, () => { Supply.allow[g] += 10; });
      } else if (CAT[b.type].visit && (b.lastVisitors ?? 0) >= 6 && active(b)) mk(`boom${b.id}`, `Business is booming at the ${nameOf(b)}`, doorM(b), () => true, false, () => { for (const w of b.workers) w.mood = Math.min(98, (w.mood ?? 60) + 4); });
    }
    if (!Weather.isRaining() && !Weather.isSnowing()) {
      const park = World.buildings.find((b: any) => ['park', 'grandpark', 'plaza'].includes(b.type) && active(b));
      if (park) mk(`park${park.id}`, `A fine day in the ${nameOf(park).toLowerCase()}`, midM(park), () => true, false);
    }
    return out;
  }
  private pick(): void {
    const all = this.assignments();
    const h = here(this.c.f);
    const hot = all.filter((s) => s.hot);
    const pool = hot.length ? hot : all;
    pool.sort((a, b) => Math.hypot(a.x - h.x, a.z - h.z) - Math.hypot(b.x - h.x, b.z - h.z));
    const s = pool[0];
    if (!s) return;
    this.story = s;
    this.c.gps.set(s.x, s.z, `Story · ${s.head.split(':')[0]}`);
    this.c.toast(`📺 The editor's on the phone: "${s.head}" — ${s.hot ? "get down there before it's over" : 'film it and bring it in'}`);
  }

  update(dt: number): void {
    const s = this.story, f = this.c.f;
    this.filming = false;
    if (!s) {
      this.scanT -= dt;
      if (this.scanT <= 0) { this.scanT = 3; this.pick(); }
      return;
    }
    if (!s.filmed) {
      if (!s.live()) { this.story = null; this.c.toast('📺 That story\'s moved on — the editor has another'); return; }
      // the subject in shot, close enough, on foot
      if (!f.driving && Math.hypot(f.pos.x - s.x, f.pos.z - s.z) < 38 && facing(f, s.x, s.z, 0.6)) {
        this.filming = true;
        if (s.w.step(dt, true)) {
          s.filmed = true;
          const d = doorM(this.c.b);
          this.c.gps.set(d.x, d.z, 'PVTV · file the story');
          this.c.toast('🎥 Got it — back to the station to file the story');
        }
      }
    }
  }
  private file(): void {
    const s = this.story!;
    this.story = null;
    this.filed.add(s.key);
    this.stories++;
    News.breaking(s.head);
    Tasks.log(`📺 PVTV: ${s.head} — a report by the Founder`);
    s.effect?.();
    Rep.broadcast(0.05);
    this.c.earn(s.hot ? 30 : 15, `Filed: ${s.head.split(':')[0]}`);
    this.c.good(s.hot ? 2 : 1.2);
    this.c.toast(`📡 On air: "${s.head}"`);
    this.c.gps.clear();
  }
  interaction(): Act | null {
    const s = this.story, f = this.c.f;
    if (!s || !s.filmed) return null;
    const d = doorM(this.c.b);
    return stoppedNear(f, d.x, d.z, 14) ? { text: '<b>E</b> file the story for the next bulletin', act: () => this.file() } : null;
  }
  objective(): { text: string; sub?: string; k?: number } {
    const s = this.story, f = this.c.f;
    if (!s) return { text: 'Waiting for the editor', sub: this.stories ? `${this.stories} stor${this.stories > 1 ? 'ies' : 'y'} on air today` : 'A quiet news day — so far' };
    if (s.filmed) { const d = doorM(this.c.b); return { text: 'File the story at the station', sub: `${metres(distTo(f, d.x, d.z))} · "${s.head}"` }; }
    const far = Math.hypot(here(f).x - s.x, here(f).z - s.z);
    return { text: s.head, sub: this.filming ? '● REC — keep it in shot' : far < 38 ? 'On foot, the subject in shot' : `${metres(far)} · ${s.hot ? 'it won\'t wait' : 'film it on foot'}`, k: s.w.k };
  }
  marker(): { x: number; y: number; z: number; icon: string } | null {
    const s = this.story;
    if (!s) return null;
    if (s.filmed) { const d = doorM(this.c.b); return { x: d.x, y: 3.4, z: d.z, icon: '📡' }; }
    return { x: s.x, y: 6, z: s.z, icon: '🎥' };
  }
  busy(): boolean { return !!this.story?.filmed; }
  draw(d: Draw): void {
    const f = this.c.f;
    if (this.filming) d.prop('camera', f.pos.x, f.pos.y, f.pos.z, f.camYaw);
  }
  end(): void { this.story = null; }
}

/* ---------- farmer ---------- */
type Field = 'sow' | 'harvest' | 'plough';
const VERB: Record<Field, string> = { sow: 'Sow', harvest: 'Harvest', plough: 'Plough and spread' };

export class FarmJob implements Job {
  rows: { pts: { x: number; z: number; done: boolean }[]; done: boolean }[] = [];
  mode: Field;
  finished = false;

  constructor(private c: ShiftCtx) {
    const s = Weather.season;
    this.mode = s === 0 ? 'sow' : s === 3 ? 'plough' : 'harvest';
    const b = c.b, d = CAT[b.type];
    const hw = ((d.w || 7) * TM) / 2, hd = ((d.h || 5) * TM) / 2;
    // every other crop row, six marks along each
    const prev: boolean[] = b.fieldDay === Sim.day && b.fieldMode === this.mode ? b.rowsDone || [] : [];
    for (let x = -hw + 1.7, i = 0; x < hw - 18; x += 4.4, i++) {
      const pts = [];
      for (let k = 0; k < 6; k++) pts.push({ ...local(b, x, -hd + 3 + (k * (2 * hd - 6)) / 5), done: !!prev[i] });
      this.rows.push({ pts, done: !!prev[i] });
    }
    this.finished = this.rows.every((r) => r.done);
  }
  private save(): void {
    const b = this.c.b;
    b.fieldDay = Sim.day;
    b.fieldMode = this.mode;
    b.rowsDone = this.rows.map((r) => r.done);
  }
  update(_dt: number): void {
    const f = this.c.f;
    if (this.finished || !this.c.atWheel() || Math.abs(f.car.speed) < 0.3) return;
    for (const r of this.rows) {
      if (r.done) continue;
      for (const p of r.pts) if (!p.done && Math.hypot(f.car.x - p.x, f.car.z - p.z) < 2.6) p.done = true;
      if (r.pts.every((p) => p.done)) this.rowDone(r);
    }
  }
  private rowDone(r: FarmJob['rows'][number]): void {
    const b = this.c.b;
    r.done = true;
    if (this.mode === 'harvest') {
      const add = Math.min(3, YARD - (b.stock || 0));
      Supply.init(b);
      b.stock = (b.stock || 0) + Math.max(0, add);
      Supply.made.food += Math.max(0, add);
    }
    this.c.earn(this.mode === 'harvest' ? 2.5 : 2, `${VERB[this.mode]}: a row`);
    this.save();
    if (this.rows.every((q) => q.done)) {
      this.finished = true;
      if (this.mode !== 'harvest') b.tended = Sim.day + (this.mode === 'sow' ? 7 : 4);
      this.c.earn(10, `${VERB[this.mode]}: the whole field`);
      this.c.good(1.5);
      for (const w of b.workers || []) Rep.feel(w, 1, 'the Founder worked the field with us');
      this.c.toast(this.mode === 'harvest' ? `🌾 The field's in — ${this.rows.length * 3} loads of food to the yard` : `🚜 The field is ${this.mode === 'sow' ? 'sown' : 'ploughed'} — it'll yield more all week`);
    }
  }
  interaction(): Act | null { return null; }
  objective(): { text: string; sub?: string; k?: number } {
    const done = this.rows.filter((r) => r.done).length;
    if (this.finished) return { text: `The field is ${this.mode === 'harvest' ? 'harvested' : this.mode === 'sow' ? 'sown' : 'ploughed'}`, sub: 'Nothing more today — clock off when you like', k: 1 };
    return { text: `${VERB[this.mode]} the field`, sub: `${done} of ${this.rows.length} rows · drive the tractor along each row`, k: done / Math.max(1, this.rows.length) };
  }
  marker(): { x: number; y: number; z: number; icon: string } | null {
    const r = this.rows.find((q) => !q.done);
    const p = r?.pts.find((q) => !q.done);
    return p ? { x: p.x, y: 1.6, z: p.z, icon: this.mode === 'harvest' ? '🌾' : '🌱' } : null;
  }
  draw(d: Draw): void {
    if (this.mode !== 'harvest') return;
    for (const r of this.rows) for (const p of r.pts) if (p.done) d.prop('bale', p.x, 0.05, p.z, p.x);
  }
  end(): void { this.save(); }
}

/* ============================================================
   Work shifts (Milestone 6, design §11): the thirteen playable
   jobs. A shift is started at the workplace (its card, or the
   counter inside) or from the phone's Jobs app (which routes you
   there; it starts at the door). The workplace lends its vehicle
   (the fire engine, the bus, the tractor…) at the kerb, and your
   own waits where you left it. The job (src/jobs/) is a loop of
   real tasks from the simulation; calls the village would send
   its own crews to come to you first while you're on shift
   (Life.claim). Every task pays into the shift, and the stars
   follow how it went; at clock-off the hours and the tasks are
   paid, scaled by the stars, by the village fund for public
   services and by the workplace's own till for a business (as
   far as it can). Shifts never replace a villager's job: you
   work alongside the staff.
   ============================================================ */
import * as THREE from 'three';
import { World } from '../sim/world';
import { Life } from '../sim/life';
import { CAT } from '../sim/catalog';
import { Gov } from '../sim/gov';
import { Rep } from '../sim/reputation';
import { Input } from '../input/input';
import { INTERIOR, WARES } from '../interiors/plan';
import type { Founder } from './founder';
import type { Gps } from './gps';
import type { Spec, Vehicle } from './fleet';
import type { TravelView } from './travel';
import { Act, Controls, Draw, Job, ShiftCtx, TM, doorM, nowAbs, roadYaw, distTo, here } from '../jobs/common';
import { FireJob, PoliceJob, MedicJob } from '../jobs/emergency';
import { TaxiJob, BusJob, TruckJob } from '../jobs/driving';
import { TrainJob, PilotJob } from '../jobs/rails';
import { PowerJob, BuildJob, ShopJob, ReporterJob, FarmJob } from '../jobs/town';

export type JobId = 'fire' | 'police' | 'medic' | 'taxi' | 'bus' | 'truck' | 'train' | 'pilot' | 'power' | 'build' | 'shop' | 'reporter' | 'farm';
export interface JobDef {
  id: JobId;
  title: string;
  emoji: string;
  wave: string;
  /** where you report for it (building types; the construction worker reports to any site) */
  places: string[];
  /** the vehicle the workplace lends (driven like your own, drawn as the village's) */
  vehicle?: { type: string; name: string; paint: string; spec: Partial<Spec> };
  /** standby pay per game hour on shift */
  hourly: number;
  /** a public service: paid by the village fund (else by the workplace's till) */
  pub: boolean;
  /** the longest shift (game hours) */
  hours: number;
  blurb: string;
  make: (c: ShiftCtx) => Job;
}

const FAR = 400; // km on a tank: the depot keeps the work vehicles fuelled
/** the counters a shop worker or a chef can stand behind */
const COUNTERS = Object.keys(INTERIOR).filter((t) => (INTERIOR[t] === 'shop' || INTERIOR[t] === 'food') && WARES[t] && !['carshowroom', 'motoshowroom'].includes(t));
const YARDS = ['warehouse', 'factory', 'sawmill', 'brickworks', 'steelworks', 'glassworks', 'textilemill', 'cannery'];

export const JOBS: JobDef[] = [
  { id: 'fire', title: 'Firefighter', emoji: '🚒', wave: 'Emergency', places: ['fire'], hourly: 4, pub: true, hours: 8,
    vehicle: { type: 'fire', name: 'fire engine', paint: '#c0302a', spec: { max: 24, accel: 5, reach: 2.6, radius: 1.25, turn: 1.5, len: 0.9, range: FAR } },
    blurb: 'Every fire in town comes to you first; fire safety inspections between calls', make: (c) => new FireJob(c) },
  { id: 'police', title: 'Police officer', emoji: '🚓', wave: 'Emergency', places: ['police'], hourly: 4, pub: true, hours: 8,
    vehicle: { type: 'police', name: 'patrol car', paint: '#f4f6f7', spec: { max: 33, accel: 10, range: FAR } },
    blurb: 'Break-ins, street fights and crashes; walk the beat between calls', make: (c) => new PoliceJob(c) },
  { id: 'medic', title: 'Paramedic', emoji: '🚑', wave: 'Emergency', places: ['hospital'], hourly: 4, pub: true, hours: 8,
    vehicle: { type: 'ambulance', name: 'ambulance', paint: '#f6f6f2', spec: { max: 27, accel: 6.5, reach: 1.9, radius: 1.1, turn: 1.7, len: 0.75, range: FAR } },
    blurb: 'Treat the casualty, drive them to the ward; home visits to the sick between calls', make: (c) => new MedicJob(c) },
  { id: 'taxi', title: 'Taxi driver', emoji: '🚕', wave: 'Driving', places: ['taxistand'], hourly: 2, pub: false, hours: 8,
    vehicle: { type: 'taxi', name: 'cab', paint: '#f2c230', spec: { range: FAR } },
    blurb: 'Real villagers who want a ride; the meter comes out of their purse', make: (c) => new TaxiJob(c) },
  { id: 'bus', title: 'Bus driver', emoji: '🚌', wave: 'Driving', places: ['busstop'], hourly: 3, pub: true, hours: 8,
    vehicle: { type: 'bus', name: 'bus', paint: '#2a6ab8', spec: { max: 16, accel: 3.2, reach: 3.7, radius: 1.3, turn: 1.25, len: 1.3, range: FAR } },
    blurb: 'The village line, stop to stop: the real queues board; keep to the timetable', make: (c) => new BusJob(c) },
  { id: 'truck', title: 'Delivery driver', emoji: '📦', wave: 'Driving', places: YARDS, hourly: 2, pub: false, hours: 8,
    vehicle: { type: 'truck', name: 'delivery truck', paint: '#3a6ab8', spec: { max: 20, accel: 4, reach: 2.3, radius: 1.2, turn: 1.45, len: 0.85, range: FAR } },
    blurb: 'Loads from the yards to shops running low and sites waiting for materials', make: (c) => new TruckJob(c) },
  { id: 'train', title: 'Train driver', emoji: '🚆', wave: 'Rails & skies', places: ['trainstation'], hourly: 3, pub: true, hours: 8,
    blurb: 'The cab of the village line: stop at every platform, keep the timetable', make: (c) => new TrainJob(c) },
  { id: 'pilot', title: 'Pilot', emoji: '✈️', wave: 'Rails & skies', places: ['airport'], hourly: 4, pub: false, hours: 14,
    blurb: 'Take off, fly to the city and back, land it yourself: visitors and trade', make: (c) => new PilotJob(c) },
  { id: 'power', title: 'Electrician', emoji: '⚡', wave: 'Town', places: ['powerplant'], hourly: 3, pub: false, hours: 8,
    vehicle: { type: 'van', name: 'power company van', paint: '#f2f0e8', spec: { max: 25, accel: 6, reach: 1.7, radius: 1.0, turn: 1.75, len: 0.62, range: FAR } },
    blurb: 'Power cuts come to you; service the substations between faults', make: (c) => new PowerJob(c) },
  { id: 'build', title: 'Construction worker', emoji: '🏗️', wave: 'Town', places: [], hourly: 3, pub: true, hours: 8,
    vehicle: { type: 'van', name: "builders' van", paint: '#d9822b', spec: { max: 24, accel: 6, reach: 1.7, radius: 1.0, turn: 1.75, len: 0.62, range: FAR } },
    blurb: 'Carry the bricks to the scaffold; fetch a load when the pallet runs out', make: (c) => new BuildJob(c) },
  { id: 'shop', title: 'Shop worker / chef', emoji: '🧑‍🍳', wave: 'Town', places: COUNTERS, hourly: 2, pub: false, hours: 8,
    blurb: 'Take the real customers\' orders, make them at the counter, serve them', make: (c) => new ShopJob(c) },
  { id: 'reporter', title: 'PVTV reporter', emoji: '📺', wave: 'Town', places: ['tvstation'], hourly: 2, pub: true, hours: 8,
    vehicle: { type: 'van', name: 'PVTV van', paint: '#c03030', spec: { max: 26, accel: 6.5, reach: 1.7, radius: 1.0, turn: 1.75, len: 0.62, range: FAR } },
    blurb: 'Rush to what\'s happening, film it, file it: it goes out on PVTV', make: (c) => new ReporterJob(c) },
  { id: 'farm', title: 'Farmer', emoji: '🚜', wave: 'Town', places: ['farm'], hourly: 2, pub: false, hours: 8,
    vehicle: { type: 'tractor', name: 'tractor', paint: '#2f7a3a', spec: { max: 9, accel: 3, reach: 1.15, radius: 1.05, turn: 1.6, len: 0.55, range: FAR } },
    blurb: 'Sow, harvest or plough by the season: food to the yard, a better yield', make: (c) => new FarmJob(c) },
];
export const JOB = Object.fromEntries(JOBS.map((j) => [j.id, j])) as Record<JobId, JobDef>;

export interface Shift {
  def: JobDef; b: any; job: Job; v: Vehicle | null;
  /** when it began and when it ends (absolute game-minutes) */
  t0: number; until: number;
  /** pay for the tasks done, so far; stars 1…5; tasks paid and things gone wrong */
  earned: number; stars: number; tasks: number; fails: number;
}
/** shifts worked by job, all pay received, hours, best stars; and wages the village fund still owes */
export interface Career { n: Partial<Record<JobId, number>>; earned: number; hours: number; best: Partial<Record<JobId, number>>; owed: number }
type Toast = (m: string, at?: { x: number; y: number }, news?: boolean) => void;

const live = (b: any): boolean => !!b && b.connected && !b.ruined && World.buildings.includes(b);
const stars = (k: number): string => '★'.repeat(Math.round(k)) + '☆'.repeat(5 - Math.round(k));
const hoursText = (h: number): string => (h < 1 ? `${Math.round(h * 60)} min` : `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, '0')}`);

/** throttle, brake, steering and the plane's pitch (E up, Q down; the right stick on a pad) */
function readControls(): Controls {
  const { gas, brake } = Input.pedals();
  const k = Input.keys;
  let pitch = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
  const ay = Input.pad?.axes[3] || 0;
  if (Math.abs(ay) > 0.15) pitch -= ay;
  return { gas, brake, steer: Input.steer(), pitch: Math.max(-1, Math.min(1, pitch)) };
}

export class Shifts {
  cur: Shift | null = null;
  /** booked from the phone: starts when the Founder reaches the workplace */
  booked: { id: JobId; b: any } | null = null;
  record: Career = { n: {}, earned: 0, hours: 0, best: {}, owed: 0 };
  /** the panel's "+$12" (each task's pay as it's earned) */
  onEarn: ((amount: number, why: string) => void) | null = null;
  /** why a shift can't start right now (the police after you, a trip under way), set by the client */
  blocked: () => string | null = () => null;
  controls: () => Controls = readControls;
  indoors: () => any = () => null;
  travelView: () => TravelView | null = () => null;
  private paints = new Map<string, THREE.Color>();

  constructor(private f: Founder, private gps: Gps, private toast: Toast) {
    // calls the village would send its own crews to come to the Founder first while on shift
    Life.claim = (kind: string, scene: any) => !!this.cur?.job.claim?.(kind, scene);
  }

  /* ---------- where each job is worked ---------- */
  placesFor(def: JobDef): any[] {
    if (def.id === 'build') return World.buildings.filter((b: any) => b.construction > 0 && b.connected && !b.ruined);
    const list = World.buildings.filter((b: any) => def.places.includes(b.type) && live(b) && !b.construction);
    if (def.id === 'bus') return list.filter((b: any) => Life.buses[0]?.stops.includes(b));
    return list;
  }
  /** the jobs that can be worked at `b` */
  offers(b: any): JobId[] {
    return JOBS.filter((d) => this.placesFor(d).includes(b)).map((d) => d.id);
  }
  /** why a shift can't start at `b` (null: it can) */
  whyNot(id: JobId, b: any): string | null {
    const def = JOB[id];
    if (this.cur) return `You're already on shift as a ${this.cur.def.title.toLowerCase()}`;
    const blocked = this.blocked();
    if (blocked) return blocked;
    if (!b || !this.placesFor(def).includes(b)) return `There's no ${def.title.toLowerCase()}'s work there`;
    const h = CAT[b.type].hours;
    if (id !== 'build' && h && h.e - h.s < 1440 && (nowAbs() % 1440 < h.s || nowAbs() % 1440 >= h.e - 30)) return `The ${CAT[b.type].name} is closed — shifts start in opening hours`;
    if (id === 'train' && !Life.trains.some((t: any) => t.type !== 'freight')) return 'No passenger trains run on the line yet';
    if (id === 'bus' && !Life.buses.length) return 'No bus line runs yet — two stops joined by road start one';
    return null;
  }

  /* ---------- on and off ---------- */
  start(id: JobId, b: any): boolean {
    const why = this.whyNot(id, b);
    if (why) { this.toast(`🦺 ${why}`); return false; }
    const def = JOB[id];
    let v: Vehicle | null = null;
    if (def.vehicle) {
      // the workplace's vehicle, at the kerb in front of it, along the road
      v = { id: -1, model: 'work', name: def.vehicle.name, kind: 'car', style: 'sedan', color: def.vehicle.paint, price: 0, fuel: 1, damage: 0, where: 'out', work: { type: def.vehicle.type, spec: def.vehicle.spec } };
      const r = World.nearestRoad(b.door.x, b.door.y, 4);
      const d = doorM(b);
      if (r) {
        // a few metres along the kerb from the doorstep, on the building's side of the road
        const yaw = roadYaw(r.x, r.y), ew = yaw !== 0;
        const ahead = ew ? (World.isRoad(r.x + 1, r.y) ? 1 : -1) : World.isRoad(r.x, r.y + 1) ? 1 : -1;
        const side = ew ? Math.sign(b.y + b.h / 2 - r.y - 0.5) : Math.sign(b.x + b.w / 2 - r.x - 0.5);
        const x = r.x * TM + 4 + (ew ? ahead * 6 : side * 1.8), z = r.y * TM + 4 + (ew ? side * 1.8 : ahead * 6);
        this.f.takeWork(v, x, z, ew ? (ahead > 0 ? Math.PI / 2 : -Math.PI / 2) : ahead > 0 ? 0 : Math.PI);
      } else this.f.takeWork(v, d.x, d.z, 0);
    }
    const t = nowAbs();
    this.cur = { def, b, job: null as unknown as Job, v, t0: t, until: t + def.hours * 60, earned: 0, stars: 3, tasks: 0, fails: 0 };
    this.booked = null;
    this.cur.job = def.make(this.ctx(this.cur));
    this.toast(`${def.emoji} On shift: ${def.title.toLowerCase()} at the ${CAT[b.type].name}${v ? ` — the ${v.name} is at the kerb (F)` : ''}. The phone's Jobs app clocks you off`);
    return true;
  }
  private ctx(s: Shift): ShiftCtx {
    return {
      f: this.f, gps: this.gps, b: s.b,
      toast: (m, at, news) => this.toast(m, at, news),
      earn: (a, why) => { const n = Math.max(0, a); s.earned += n; s.tasks++; this.onEarn?.(n, why); },
      good: (k = 1) => { s.stars = Math.min(5, s.stars + 0.35 * k); },
      bad: (why) => { s.stars = Math.max(1, s.stars - 0.6); s.fails++; this.toast(`⚠️ ${why}`); },
      vehicle: () => s.v,
      atWheel: () => !!s.v && this.f.driving && this.f.work === s.v,
      controls: () => this.controls(),
      indoors: () => this.indoors(),
      travelView: () => this.travelView(),
    };
  }

  /** the phone's "Go" (or a card's "Start a shift"): start here, or route to the workplace and start at its door */
  go(id: JobId, at?: any): void {
    const def = JOB[id], h = here(this.f);
    const list = this.placesFor(def).sort((a: any, b: any) => Math.hypot(doorM(a).x - h.x, doorM(a).z - h.z) - Math.hypot(doorM(b).x - h.x, doorM(b).z - h.z));
    const b = at || list.find((q: any) => !this.whyNot(id, q)) || list[0];
    if (!b) { this.toast(`🦺 No ${def.id === 'build' ? 'building site' : CAT[def.places[0]]?.name || 'workplace'} in ${World.name} yet`); return; }
    const why = this.whyNot(id, b);
    if (why) { this.toast(`🦺 ${why}`); return; }
    const d = doorM(b);
    if (distTo(this.f, d.x, d.z) < 40) { this.start(id, b); return; }
    this.booked = { id, b };
    this.gps.set(d.x, d.z, `${def.title} shift · the ${CAT[b.type].name}`);
    this.toast(`${def.emoji} Your ${def.title.toLowerCase()} shift starts at the ${CAT[b.type].name} — follow the arrows`);
  }

  /** clock off: the job hands everything back and the shift is paid. Returns false if it can't end yet */
  end(why = '', force = false): boolean {
    const s = this.cur;
    if (!s) return false;
    const lock = s.job.locked?.();
    if (lock && !force) { this.toast(`🦺 ${lock}`); return false; }
    s.job.end();
    this.cur = null;
    this.f.siren = this.f.beacon = this.f.exempt = false;
    if (s.v && this.f.work === s.v) this.f.dropWork();
    const hours = Math.max(0, (nowAbs() - s.t0) / 60);
    const gross = Math.round((s.def.hourly * hours + s.earned) * (0.7 + 0.1 * s.stars));
    const label = `Wages · ${s.def.title.toLowerCase()} shift (${hoursText(hours)})`;
    // a public service is paid from the village fund; a business pays from its own till (as far as it can)
    let paid = 0;
    if (gross > 0) {
      if (s.def.pub) {
        paid = Math.min(gross, Math.max(0, Math.floor(Gov.treasury)));
        Gov.treasury -= paid;
        if (paid) this.f.purse.earn(paid, label, 'income');
      } else paid = this.f.purse.earn(gross, label, 'income', World.buildings.includes(s.b) ? s.b : { funds: 0 });
    }
    const r = this.record;
    r.n[s.def.id] = (r.n[s.def.id] || 0) + 1;
    r.earned += paid;
    r.hours = Math.round((r.hours + hours) * 10) / 10;
    r.best[s.def.id] = Math.max(r.best[s.def.id] || 0, Math.round(s.stars * 2) / 2);
    // the village fund owes what it couldn't pay (as the taxes come in); a business just pays what it can
    if (s.def.pub && paid < gross) r.owed += gross - paid;
    // the staff warm to a good colleague
    if (s.stars >= 4) for (const w of (s.b.workers || []).slice(0, 8)) Rep.feel(w, 0.6, `the Founder did a good shift with us at the ${CAT[s.b.type].name}`);
    const short = paid < gross ? (s.def.pub ? ` now, $${gross - paid} owed by the village fund until the taxes come in` : ` (all the ${CAT[s.b.type].name} could pay)`) : '';
    this.toast(`🦺 Clocked off: ${hoursText(hours)} as a ${s.def.title.toLowerCase()} · ${stars(s.stars)} · $${paid}${short}${why ? ` — ${why}` : ''}`);
    this.gps.clear();
    return true;
  }
  /** a new map or a loaded save: the shift is simply over (nothing paid: that village is gone) */
  reset(): void {
    const s = this.cur;
    this.cur = null;
    this.booked = null;
    if (s) { try { s.job.end(); } catch { /* its world went with the old map */ } }
    this.f.siren = this.f.beacon = this.f.exempt = false;
    if (this.f.work) this.f.dropWork();
  }

  /* ---------- per frame ---------- */
  private backT = 0;
  update(dt: number): void {
    // back pay, once the village fund has something in it (it keeps a little in hand)
    this.backT -= dt;
    if (this.backT <= 0) {
      this.backT = 5;
      const r = this.record, can = Math.min(Math.round(r.owed), Math.floor(Gov.treasury - 40));
      if (can > 0) {
        Gov.treasury -= can;
        r.owed -= can;
        r.earned += can;
        this.f.purse.earn(can, 'Back pay from the village fund', 'income');
        this.toast(`🏛️ The village fund paid ${r.owed > 0.5 ? 'part of ' : ''}what it owed you: $${can}`);
      }
    }
    if (!this.cur && this.booked) {
      const { id, b } = this.booked, d = live(b) ? doorM(b) : null;
      if (!d) this.booked = null;
      else if (distTo(this.f, d.x, d.z) < 16) this.start(id, b);
      return;
    }
    const s = this.cur;
    if (!s) return;
    if (s.v && this.f.work !== s.v) { this.end(`you handed the ${s.v.name} back`, true); return; }
    if (s.v && s.v.damage >= 100) { s.stars = Math.max(1, s.stars - 1.5); this.end(`the ${s.v.name} is a wreck`, true); return; }
    if (!World.buildings.includes(s.b) || s.b.ruined) { this.end(`the ${CAT[s.b.type].name} is gone`, true); return; }
    s.job.update(dt);
    // the end of the shift (with a little overtime to finish what's in hand)
    const t = nowAbs();
    if (t >= s.until && !(s.job.busy?.() && t < s.until + 60) && !s.job.locked?.()) this.end('the end of your shift');
  }
  interaction(): Act | null { return this.cur?.job.interaction() ?? null; }
  carrying(): boolean { return !!this.cur?.job.carrying?.(); }
  line(): Act | null { return this.cur?.job.line?.() ?? null; }
  overlay(): boolean { return !!this.cur?.job.overlay?.(); }
  frame(now: number): void { this.cur?.job.frame?.(now); }
  marker(): { x: number; y: number; z: number; icon: string } | null { return this.cur?.job.marker?.() ?? null; }

  /** the work vehicle (when it's one of the village's instanced models) and whatever the job draws */
  draw(d: Draw): void {
    const s = this.cur;
    if (!s) return;
    const v = this.f.work;
    if (v?.work && v === s.v && v.work.type !== 'police' && v.work.type !== 'taxi') {
      const c = this.f.car;
      let col = this.paints.get(v.color);
      if (!col) { col = new THREE.Color(v.color); this.paints.set(v.color, col); }
      d.vehicle(v.work.type, c.x, c.y, c.z, c.yaw, col, v.work.type === 'van' || v.work.type === 'tractor' ? { beacon: this.f.beacon, pitch: c.pitch } : { siren: this.f.siren, pitch: c.pitch });
    }
    s.job.draw?.(d);
  }

  /** what the shift panel shows */
  panel(): { emoji: string; title: string; place: string; text: string; sub: string; k: number | null; left: string; earned: number; stars: string; starsN: number; lock: string | null } | null {
    const s = this.cur;
    if (!s) return null;
    const o = s.job.objective();
    const left = s.until - nowAbs();
    return {
      emoji: s.def.emoji, title: s.def.title, place: `the ${CAT[s.b.type].name}`,
      text: o.text, sub: o.sub || '', k: o.k ?? null,
      left: left > 0 ? `${hoursText(left / 60)} left` : 'overtime',
      earned: Math.round(s.def.hourly * Math.max(0, (nowAbs() - s.t0) / 60) + s.earned), stars: stars(s.stars), starsN: Math.round(s.stars), lock: s.job.locked?.() ?? null,
    };
  }
  /** the phone's Jobs app: every job, where it's worked nearest, and whether it can start */
  listing(): { id: JobId; title: string; emoji: string; wave: string; blurb: string; where: string; ok: boolean; why: string | null; pay: string; worked: number; best: number }[] {
    const h = here(this.f);
    return JOBS.map((def) => {
      const list = this.placesFor(def);
      let near: any = null, nd = Infinity;
      for (const b of list) { const d = Math.hypot(doorM(b).x - h.x, doorM(b).z - h.z); if (d < nd) { nd = d; near = b; } }
      const why = near ? this.whyNot(def.id, near) : null;
      const where = near ? `${def.id === 'build' ? `Site: the ${CAT[near.type].name}` : `The ${CAT[near.type].name}`} · ${nd < 1000 ? `${Math.round(nd / 10) * 10} m` : `${(nd / 1000).toFixed(1)} km`}`
        : def.id === 'build' ? 'No building sites right now' : def.id === 'shop' ? 'No shop or café yet'
          : def.id === 'bus' && World.buildings.some((b: any) => b.type === 'busstop') ? 'No bus line running yet (it starts within the hour of two stops joined by road)'
            : `No ${CAT[def.places[0]]?.name || 'workplace'} in ${World.name} yet`;
      return { id: def.id, title: def.title, emoji: def.emoji, wave: def.wave, blurb: def.blurb, where, ok: !!near && !why, why, pay: `$${def.hourly}/h + per task · ${def.pub ? 'the village fund' : 'the workplace'} pays`, worked: this.record.n[def.id] || 0, best: this.record.best[def.id] || 0 };
    });
  }

  serialize(): Career { return JSON.parse(JSON.stringify(this.record)); }
  restore(s: Partial<Career> | null | undefined): void {
    this.record = { n: { ...(s?.n || {}) }, earned: s?.earned || 0, hours: s?.hours || 0, best: { ...(s?.best || {}) }, owed: s?.owed || 0 };
  }
}

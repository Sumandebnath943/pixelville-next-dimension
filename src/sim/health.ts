/* ============================================================
   Health & ambulances (V2, design §9.1).
   Every villager has health (0–100) and, at times, a condition:
   a cold or the flu (waves in autumn and winter, harder on the
   old), or an injury from a crash, a fire, a collapse, a scuffle
   or the Founder's car. A serious one puts them on the ground
   until an ambulance comes from a hospital by road, exactly like
   the fire brigade; the paramedics treat them where they lie and
   drive them to the ward. Hospitals have beds (fewer when short
   of staff); a full ward patches people up and sends them home.
   Recovery is fastest in hospital with doctors, slower at home,
   slowest in a town with no hospital at all, which also weighs
   on families. Health sharpens V1's old-age odds. Nobody dies of
   an injury.
   ============================================================ */
import { MIN_PER_SEC, Snd, T, midPx } from './core';
import { World } from './world';
import { Sim } from './agents';
import { Life } from './life';
import { Traffic } from './traffic';
import { Mind } from './mind';
import { Weather } from './weather';
import { Tasks } from './tasks';
import { News } from './news';
import { Gov } from './gov';
import { Edu } from './education';
import { Economy, OUTPATIENT_FEE, AMBULANCE_FEE } from './economy';

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

/** a condition this bad needs a hospital (an ambulance, if it struck in the street) */
export const SERIOUS = 35;
/** beds on a fully staffed ward */
export const BEDS = 12;
/** what a day on the ward costs the household */
export const BILL_PER_DAY = 14;
/** tiles per second on blue lights (~70 km/h) */
const AMB_SPEED = 2.4;
/** how far short of the casualty the ambulance stops (tiles: the van is ~6 m long) */
const STOP_SHORT = 0.7;
/** condition points healed per day: on a staffed ward, at home near a hospital, at home with none */
const HEAL = { ward: 34, home: 13, alone: 7 };

export interface Condition { k: string; sev: number; day: number; cause?: string }

const doorPx = (b: any): { x: number; y: number } => ({ x: b.door.x * T + 8, y: b.door.y * T + 8 });
const NAMES: Record<string, string> = { flu: 'Flu', cold: 'A cold', bug: 'A stomach bug', pneumonia: 'Pneumonia', injury: 'Injured' };

export const Health = {
  /** the flu wave runs until this day (0: none) */
  wave: 0,
  waveYear: -1,
  tickT: 0,
  /** ambulances dispatched (counted for the mayor's report) */
  calls: 0,

  reset(): void {
    this.wave = 0;
    this.waveYear = -1;
    this.tickT = 0;
    this.calls = 0;
    Life.ambulances = [];
  },

  hp(p: any): number {
    return p.hp ?? 100;
  },
  /** the healthiest someone can be at their age */
  baseline(p: any): number {
    return clamp(100 - Math.max(0, (p.age ?? 30) - 55) * 1.3, 45, 100);
  },
  hospitals(): any[] {
    return World.buildings.filter((b: any) => b.type === 'hospital' && b.connected && !b.construction && !b.ruined && !b.fire);
  },
  /** staffed beds: nurses keep the ward open, doctors make it work */
  beds(b: any): number {
    const staff = b.workers.length / Math.max(1, b.jobs);
    return Math.max(3, Math.round(BEDS * (0.3 + 0.7 * Math.min(1, staff))));
  },
  patients(b: any): any[] {
    return Sim.people.filter((p: any) => p.ward === b.id && p.at === b && p.state === 'in');
  },
  freeBed(b: any): boolean {
    return this.patients(b).length < this.beds(b);
  },
  /** is `p` too unwell for work, school or an evening out? */
  resting(p: any): boolean {
    return !!p.ward || p.state === 'hurt' || p.state === 'amb' || (!!p.cond && p.cond.sev >= 12);
  },
  /** V1's old-age odds, sharpened by poor health */
  frailty(p: any): number {
    let k = 0.6 + (100 - this.hp(p)) / 60;
    if (p.cond && p.cond.sev >= SERIOUS && !p.ward) k += 0.5;
    return k;
  },
  label(p: any): string {
    if (p.state === 'hurt') return 'Hurt · waiting for help';
    if (p.state === 'amb') return 'In the ambulance';
    const c: Condition | null = p.cond || null;
    if (p.ward) return `${c ? NAMES[c.k] || 'Unwell' : 'Recovering'} · in hospital`;
    if (!c) return this.hp(p) >= 75 ? 'Healthy' : 'Getting on, but well';
    const how = c.sev >= SERIOUS ? 'badly' : c.sev >= 12 ? 'in bed' : 'mild';
    return `${NAMES[c.k] || 'Unwell'} · ${how}`;
  },

  /* ---------- harm ---------- */
  /** `p` is hurt (`cause` reads after "was hurt …"). `at` (px) is where they fell; without it they
      are carried out of wherever they are. Returns true if it needs an ambulance. */
  injure(p: any, sev: number, cause: string, at?: { x: number; y: number }): boolean {
    if (!Sim.people.includes(p) || p.state === 'hurt' || p.state === 'amb' || p.ward) return false;
    sev = clamp(Math.round(sev), 5, 95);
    p.cond = { k: 'injury', sev: Math.max(sev, p.cond?.sev || 0), day: Sim.day, cause };
    p.hp = Math.min(this.hp(p), 100 - sev);
    p.mood = Math.max(5, (p.mood ?? 60) - (sev >= SERIOUS ? 14 : 6));
    Mind.remember(p, 'health', `was hurt ${cause}`, sev >= SERIOUS ? -2 : -1);
    if (sev < SERIOUS) return false; // bumps and bruises: sore, but on their feet
    this.down(p, at);
    return true;
  },

  /** on the ground until the ambulance comes (or the neighbours, where none can) */
  down(p: any, at?: { x: number; y: number }): void {
    let spot = at;
    if (p.state === 'walk' && p.trip) {
      if (p.trip.car) p.trip.car.free = true; // the car is towed home
      spot = spot || { x: p.x, y: p.y };
    } else if (p.state === 'in' && p.at) {
      if (p.at !== p.home) {
        p.at.inside = Math.max(0, p.at.inside - 1);
        if (p.carHeld) p.at.parked = Math.max(0, p.at.parked - 1);
      }
      if (!spot) { const d = doorPx(p.at); spot = { x: d.x + (Math.random() - 0.5) * 8, y: d.y + 5 }; }
    }
    if (p.carHeld) { p.carHeld.free = true; p.carHeld = null; }
    spot = spot || { x: p.x, y: p.y };
    p.state = 'hurt';
    p.downT = 0;
    p.at = p.home;
    p.trip = null; p.dest = null; p.events = []; p.returnAt = undefined; p.backTo = null;
    p.x = spot.x; p.y = spot.y;
    p.freezeT = 0; p.knocked = false;
    p.helpT = undefined;
    p.bubble = '🤕'; p.bubbleUntil = performance.now() + 9000;
    if (!this.dispatch(p)) p.helpT = 25 + Math.random() * 20;
  },

  /** the nearest hospital sends an ambulance by road; false if none can reach them */
  dispatch(p: any): boolean {
    const tx = Math.floor(p.x / T), ty = Math.floor(p.y / T);
    const spot = World.nearestRoad(tx, ty, 6);
    if (!spot) return false;
    // V2 (Milestone 6): the Founder's ambulance takes the call
    if (Life.claim && Life.claim('ambulance', p)) return true;
    let best: any = null, bp: number[][] | null = null;
    for (const h of this.hospitals()) {
      const path = World.roadPath(h.door.x, h.door.y, spot.x, spot.y);
      if (path && (!bp || path.length < bp.length)) { best = h; bp = path; }
    }
    if (!best || !bp) return false;
    if (bp.length < 2) bp = [bp[0], bp[0]];
    const d = doorPx(best);
    Life.ambulances.push({ path: bp, prog: 0, x: d.x, y: d.y, dirx: 1, diry: 0, phase: 'go', from: best, patient: p, t: 0 });
    this.calls++;
    Snd.siren(midPx(best));
    return true;
  },

  /** neighbours help them home (no ambulance could come), or a full ward sends them home */
  homeCare(p: any, why: 'neighbours' | 'full' | 'none'): void {
    if (p.state === 'in' && p.at && p.at !== p.home) p.at.inside = Math.max(0, p.at.inside - 1);
    p.state = 'in'; p.at = p.home; p.trip = null; p.dest = null; p.returnAt = undefined; p.backTo = null;
    p.helpT = undefined; p.ward = 0;
    if (why === 'neighbours') Life.say(`🤝 With no ambulance to call, neighbours helped ${Sim.fullName(p)} home to mend in their own bed`);
    else if (why === 'full') Life.say(`🏥 The ward is full — ${Sim.fullName(p)} was patched up and sent home to rest`);
    Sim.planDay(p);
  },

  /** onto the ward at `h` (the patient is already inside) */
  admit(p: any, h: any): void {
    if (!this.freeBed(h)) {
      // seen in casualty and sent home with instructions (V2: and billed for it, the ambulance too if it brought them)
      this.charge(p, h, OUTPATIENT_FEE + (p.byAmbulance ? AMBULANCE_FEE : 0));
      p.byAmbulance = false;
      if (p.cond) p.cond.sev = Math.max(0, p.cond.sev - 12);
      p.returnAt = Sim.clock + 30 > 1435 ? 1435 : Sim.clock + 30;
      Life.say(`🏥 The ward at the Hospital is full — ${Sim.fullName(p)} was seen in casualty and sent home`);
      return;
    }
    p.ward = h.id;
    p.wardDay = Sim.day;
    p.returnAt = undefined; p.backTo = null; p.events = [];
    Mind.learnPlace(p, h);
  },

  /** V2: the hospital's bill for `p`: the household pays what it can; the village fund covers the rest while it has the
   *  money (it used to cover it even with none, and the hospital was paid from thin air); what's left after that the
   *  household owes the hospital, paid off as money comes in (sim/economy.ts) */
  charge(p: any, h: any, bill: number): void {
    const paid = Math.min(bill, Math.max(0, Math.floor((p.home?.funds || 0) - 10)));
    if (p.home) p.home.funds -= paid;
    const cover = Math.min(bill - paid, Math.max(0, Gov.treasury));
    Gov.treasury -= cover;
    if (h) h.funds = (h.funds || 0) + paid + cover;
    if (p.home) Economy.owe(p.home, h, bill - paid - cover);
  },

  /** discharged: pay the bill, walk out */
  discharge(p: any): void {
    const h = World.buildings.find((b: any) => b.id === p.ward);
    const days = Math.max(1, Sim.day - (p.wardDay ?? Sim.day) + 1);
    p.ward = 0;
    this.charge(p, h, BILL_PER_DAY * days + (p.byAmbulance ? AMBULANCE_FEE : 0));
    p.byAmbulance = false;
    p.mood = Math.min(98, (p.mood ?? 60) + 6);
    Mind.remember(p, 'health', 'came home from the hospital', 1, h ? h.id : 0);
    if (h && p.at === h && p.state === 'in') Sim.startTrip(p, p.home, null);
  },

  /** the Sim's arrival hook: someone who walked to the hospital to be seen */
  arrive(p: any, dest: any): void {
    if (dest.type !== 'hospital' || !p.toWard) return;
    p.toWard = false;
    if (p.cond && p.cond.sev >= SERIOUS - 10) this.admit(p, dest);
    else { // seen, given something, sent home (V2: billed for it)
      this.charge(p, dest, OUTPATIENT_FEE);
      p.returnAt = Math.min(1435, Sim.clock + 40);
    }
  },

  /** feeling poorly: off to the hospital on foot (or by ambulance, for the frail) */
  seekCare(p: any): void {
    if (p.state !== 'in' || p.at !== p.home || p.ward) return;
    const hs = this.hospitals();
    if (!hs.length) return;
    if ((p.age ?? 30) >= 72 || p.cond.sev >= 60) {
      this.down(p); // too weak to go alone: the ambulance comes to the door
      return;
    }
    const h = hs.reduce((a: any, b: any) => (Math.abs(a.x - p.home.x) + Math.abs(a.y - p.home.y) <= Math.abs(b.x - p.home.x) + Math.abs(b.y - p.home.y) ? a : b));
    p.toWard = true;
    p.events = [];
    Sim.startTrip(p, h, null);
  },

  fallIll(p: any): void {
    const s = Weather.season;
    const old = (p.age ?? 30) >= 65;
    const r = Math.random();
    let k = this.wave || s >= 2 ? (r < 0.72 ? 'flu' : 'cold') : s === 1 && r < 0.4 ? 'bug' : r < 0.35 ? 'flu' : 'cold';
    let sev = k === 'flu' ? 16 + Math.random() * 24 : k === 'bug' ? 10 + Math.random() * 14 : 6 + Math.random() * 12;
    if (old) sev *= 1.45;
    if (p.kind === 'kid') sev *= 0.85;
    if (k === 'flu' && old && sev >= SERIOUS + 5) k = 'pneumonia';
    p.cond = { k, sev: Math.round(sev), day: Sim.day };
    p.hp = Math.min(this.hp(p), 100 - p.cond.sev);
    p.mood = Math.max(5, (p.mood ?? 60) - 5);
    if (p.cond.sev >= SERIOUS) this.seekCare(p);
  },

  /* ---------- the frame tick: ambulances, casualties, recovery ---------- */
  tick(dt: number): void {
    const gm = dt * MIN_PER_SEC;
    for (const a of Life.ambulances) {
      const p = a.patient;
      if (a.phase === 'go') {
        if (p.state !== 'hurt' || !Sim.people.includes(p)) { this.turnBack(a); continue; }
        // it pulls up just short of the casualty, not on top of them
        const stop = Math.max(0, a.path.length - 1 - STOP_SHORT);
        // V2: on blue lights in the traffic (sim/traffic.ts): through red lights and first across junctions, past a
        // queue when the other lane is clear, never through a car (it used to drive through them)
        const step = Traffic.advance(a, (a.drv ??= {}), a.path, a.prog, 1, AMB_SPEED, dt, 0.75, true);
        a.prog = Math.min(stop, a.prog + step);
        Life.followPath(a, a.path, a.prog, Traffic.lanePx(a.drv));
        // (V2: or held up just short of the spot: the crew walk the last few metres; and, held up a while within a
        // few tiles of it (behind the very crash it was called to, the wrecks across the junction), they walk the rest)
        a.heldT = step > 0.002 ? 0 : (a.heldT || 0) + dt;
        if (Traffic.there(a.drv, stop - a.prog, step, dt) || (a.heldT > 6 && stop - a.prog < 4.5)) {
          // (V2: pulled up behind whatever already stands there: a second ambulance at a crash, a squad car)
          a.prog = Traffic.settle(a, a.path, a.prog, Traffic.lanePx(a.drv), 0.75);
          Life.followPath(a, a.path, a.prog, Traffic.lanePx(a.drv));
          a.phase = 'treat'; a.t = 8;
        }
      } else if (a.phase === 'treat') {
        a.t -= gm;
        if (p.state !== 'hurt') { this.turnBack(a); continue; }
        if (a.t <= 0) {
          p.state = 'amb';
          this.turnBack(a);
        }
      } else {
        const fast = p.state === 'amb';
        const step = Traffic.advance(a, (a.drv ??= {}), a.path, a.prog, 1, fast ? AMB_SPEED : 1.6, dt, 0.75, fast);
        a.prog = Math.min(a.path.length - 1, a.prog + step);
        Life.followPath(a, a.path, a.prog, Traffic.lanePx(a.drv));
        if (Traffic.there(a.drv, a.path.length - 1 - a.prog, step, dt)) {
          a.done = true;
          if (fast) this.deliver(p, a.from);
        }
      }
    }
    if (Life.ambulances.length) Life.ambulances = Life.ambulances.filter((a: any) => !a.done);

    // every ten game-minutes: casualties nobody reached, the ward, recovery
    this.tickT += gm;
    if (this.tickT < 10) return;
    const step = this.tickT;
    this.tickT = 0;
    const hospital = this.hospitals().length > 0;
    for (const p of Sim.people) {
      if (p.state === 'hurt') {
        // V2: an ambulance that can't get through (the streets locked solid round them): after two hours the neighbours
        // carry them home, as they do where no ambulance can come at all (lying in the road, they held up the very
        // traffic the ambulance was stuck in, for good). The ambulance turns back on its own
        p.downT = (p.downT || 0) + step;
        if (p.downT >= 120 && p.helpT === undefined) { this.homeCare(p, 'neighbours'); continue; }
        if (p.helpT !== undefined) {
          p.helpT -= step;
          if (p.helpT <= 0) this.homeCare(p, 'neighbours');
        } else if (!Life.ambulances.some((a: any) => a.patient === p) && !this.dispatch(p)) p.helpT = 20;
        continue;
      }
      if (p.ward) {
        // the hospital burned or fell while they were in: home to finish mending
        if (p.state !== 'in' || !p.at || p.at.id !== p.ward) { p.ward = 0; }
      }
      const c: Condition | null = p.cond;
      if (!c) continue;
      let rate = p.ward ? HEAL.ward * (0.45 + 0.55 * Edu.ratio(p.at)) : hospital ? HEAL.home : HEAL.alone;
      if ((p.age ?? 30) >= 70) rate *= 0.75;
      c.sev -= rate * (step / 1440);
      p.hp = Math.min(this.hp(p), 100 - Math.max(0, c.sev));
      if (p.ward && c.sev < 14 && Sim.clock >= 540 && Sim.clock < 1080) this.discharge(p);
      if (c.sev <= 0) p.cond = null;
    }
  },

  turnBack(a: any): void {
    a.phase = 'return';
    // from the same spot, its own way back (V2 (Milestone 8): keeping right, not the way out backwards)
    a.path = Life.backPath(a.path, a.prog);
    a.prog = 0;
    a.drv = {};
  },

  /** the ambulance reached the hospital with its patient */
  deliver(p: any, h: any): void {
    if (!Sim.people.includes(p)) return;
    const there = World.buildings.includes(h) && !h.ruined;
    if (!there || h.fire || !this.freeBed(h)) {
      // (V2: patched up in casualty and sent home: the ambulance and the visit are still on the bill)
      if (there) this.charge(p, h, OUTPATIENT_FEE + AMBULANCE_FEE);
      this.homeCare(p, 'full');
      return;
    }
    p.state = 'in'; p.at = h; h.inside++;
    p.byAmbulance = true; // (V2: on the bill when they're discharged)
    this.admit(p, h);
    Life.say(`🏥 ${Sim.fullName(p)} is on the ward at the Hospital${p.cond?.cause ? ` after being hurt ${p.cond.cause}` : ''}`, doorPx(h));
  },

  /* ---------- once a day: illness, waves, health drifting back ---------- */
  daily(): void {
    const s = Weather.season;
    const year = Math.floor((Sim.day - 1) / 28);
    if (!this.wave && this.waveYear !== year && Sim.people.length >= 12 && (s === 3 || (s === 2 && Math.random() < 0.25)) && Math.random() < 0.3) {
      this.wave = Sim.day + 3 + ((Math.random() * 3) | 0);
      this.waveYear = year;
      Life.say(`🤧 Flu season has reached ${World.name} — coughs on every corner, and ${World.buildings.some((b: any) => b.type === 'pharmacy' && !b.ruined) ? 'a queue at the pharmacy' : 'no pharmacy to queue at'}`);
      News.breaking('Flu wave sweeps the village — stay warm, check on the elderly');
      Tasks.add('flu', '🤧', 'See the village through the flu wave');
    }
    if (this.wave && Sim.day > this.wave) {
      this.wave = 0;
      Life.say('🌤️ The flu wave has passed — the village is back on its feet');
      Tasks.done('flu', true, 'The village came through the flu wave');
    }
    const hospital = this.hospitals().length > 0;
    for (const p of Sim.people) {
      if (p.cond) {
        // seriously ill with no hospital in town: the whole family frets
        if (!hospital && p.cond.sev >= SERIOUS) {
          for (const r of p.home.residents) r.mood = Math.max(5, (r.mood ?? 60) - 3);
        } else if (hospital && p.cond.sev >= SERIOUS && !p.ward && p.state === 'in' && p.at === p.home) this.seekCare(p);
        continue;
      }
      if (p.state !== 'in' && p.state !== 'walk') continue;
      let risk = 0.003 * [1, 0.6, 1.6, 3][s];
      const age = p.age ?? 30;
      if (age >= 60) risk *= 1 + (age - 60) * 0.06;
      if (p.kind === 'kid') risk *= 1.4;
      if ((p.mood ?? 60) < 35) risk *= 1.4;
      if (this.wave) risk *= 5;
      if (p.home.residents.some((r: any) => r !== p && r.cond && (r.cond.k === 'flu' || r.cond.k === 'cold'))) risk += 0.05; // it goes round the house
      if (Math.random() < risk) this.fallIll(p);
    }
    for (const p of Sim.people) {
      if (p.cond) p.hp = Math.min(this.hp(p), 100 - Math.max(0, p.cond.sev));
      else p.hp = this.hp(p) + (this.baseline(p) - this.hp(p)) * 0.3;
      p.hp = Math.round(clamp(p.hp, 5, 100) * 10) / 10;
    }
  },

  /** a sick day: in bed, perhaps a trip to the pharmacy */
  sickPlan(p: any): void {
    if (p.ward || p.state !== 'in' || p.kind === 'kid' || !p.cond || p.cond.sev >= SERIOUS) return;
    const ph = World.buildings.find((b: any) => b.type === 'pharmacy' && b.connected && !b.construction && !b.ruined);
    if (ph && Math.random() < 0.6) {
      const t = 560 + Math.random() * 300;
      p.events.push({ t, dest: ph, until: t + 25 });
      p.pharmacyDay = Sim.day;
    }
  },
  /** a visit to the pharmacy takes the edge off */
  medicine(p: any): void {
    if (p.cond && p.cond.k !== 'injury') p.cond.sev = Math.max(0, p.cond.sev - 6);
  },

  /** people inside `b` when disaster strikes there: a share are hurt and carried out */
  casualties(b: any, chance: number, sev: [number, number], cause: string): number {
    let n = 0;
    for (const p of Sim.people.slice()) {
      if (p.state !== 'in' || p.at !== b || p.ward) continue;
      if (Math.random() >= chance) continue;
      if (this.injure(p, sev[0] + Math.random() * (sev[1] - sev[0]), cause)) n++;
    }
    return n;
  },

  /** what the mayor's report and the hospital card show */
  report(): { sick: number; serious: number; ward: number; beds: number; hospitals: number } {
    const hs = this.hospitals();
    let sick = 0, serious = 0, ward = 0;
    for (const p of Sim.people) {
      if (p.cond || p.state === 'hurt') sick++;
      if ((p.cond && p.cond.sev >= SERIOUS) || p.state === 'hurt' || p.state === 'amb') serious++;
      if (p.ward) ward++;
    }
    return { sick, serious, ward, beds: hs.reduce((n: number, h: any) => n + this.beds(h), 0), hospitals: hs.length };
  },

  /** after a load: patients go back onto their ward */
  afterLoad(): void {
    for (const p of Sim.people) {
      if (!p.ward) continue;
      const h = World.buildings.find((b: any) => b.id === p.ward && b.type === 'hospital' && !b.ruined);
      if (!h) { p.ward = 0; continue; }
      p.state = 'in'; p.at = h; h.inside++; p.events = []; p.returnAt = undefined;
    }
  },
  /** what's saved per villager */
  pack(p: any): any {
    return { hp: Math.round(this.hp(p)), cd: p.cond ? { k: p.cond.k, s: Math.round(p.cond.sev), d: p.cond.day, c: p.cond.cause || 0 } : 0, wd: p.ward || 0, wy: p.wardDay || 0 };
  },
  unpack(p: any, s: any): void {
    p.hp = s.hp ?? 100;
    p.cond = s.cd ? { k: s.cd.k, sev: s.cd.s, day: s.cd.d, cause: s.cd.c || undefined } : null;
    p.ward = s.wd || 0;
    p.wardDay = s.wy || 0;
  },
};

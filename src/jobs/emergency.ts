/* ============================================================
   Wave 6a — the emergency services (design §11).
   - Firefighter: the engine on call. A fire anywhere in town comes
     to you first (blue lights: the road rules give way); out of
     the cab, face the flames and the hose beats them. Between
     calls, fire safety inspections cut a business's risk of fire
     for a week.
   - Police officer: break-ins, street arguments and crashes come
     to you; catch the burglar on foot, talk the quarrel down,
     secure a crash. Between calls, walking the beat keeps the
     town safer and the burglars away.
   - Paramedic: the ambulance on call. Treat the casualty where
     they fell, drive them to the ward, hand them over. Between
     calls, look in on the sick at home.
   Each call waits for you a while; take too long and the
   village's own crew goes instead (and the call goes on the
   record).
   ============================================================ */
import { Sim } from '../sim/agents';
import { World } from '../sim/world';
import { Life } from '../sim/life';
import { CAT } from '../sim/catalog';
import { T } from '../sim/core';
import { Rep } from '../sim/reputation';
import { Tasks } from '../sim/tasks';
import { Health } from '../sim/health';
import {
  Act, Draw, Job, ShiftCtx, Work, active, distTo, doorM, facing, here, midM, nearestDoor, nowAbs, onFootNear, stoppedNear, toPlot,
} from './common';

const nameOf = (b: any): string => CAT[b.type].name;
const metres = (d: number): string => (d < 1000 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toFixed(1)} km`);

/* ---------- firefighter ---------- */
/** game-minutes the fire waits for the Founder's engine before the station sends its own */
const FIRE_WAIT = 45;
/** seconds of hosing a small house takes (bigger buildings take longer) */
const HOSE_SECONDS = 20;
/** the businesses most likely to catch fire, inspected first */
const RISKY = ['factory', 'restaurant', 'bakery', 'sawmill', 'steelworks', 'cannery', 'glassworks', 'textilemill', 'brickworks', 'pizzeria', 'pizzapalace',
  'burgerpalace', 'goldenarches', 'crispycluck', 'tacobelle', 'hotel', 'mall', 'warehouse', 'cafe', 'deptstore', 'cinema', 'theater'];

export class FireJob implements Job {
  call: { b: any; at: number; arrived: boolean; douse: number } | null = null;
  inspect: { b: any; w: Work } | null = null;
  spraying = false;
  private released = new WeakSet<object>();
  private scanT = 0;

  constructor(private c: ShiftCtx) {}

  claim(kind: string, b: any): boolean {
    if (kind !== 'fire' || this.released.has(b)) return false;
    if (this.call) return this.call.b === b;
    this.call = { b, at: nowAbs(), arrived: false, douse: 0 };
    this.inspect = null;
    const m = midM(b);
    this.c.toast(`🚒 Fire at the ${nameOf(b)}! You're the engine on call — blue lights on`, { x: m.x * 2, y: m.z * 2 });
    this.c.gps.set(m.x, m.z, `Fire · the ${nameOf(b)}`);
    return true;
  }
  /** too slow: the station's own engine goes (at once, on the next dispatch) */
  private release(): void {
    const b = this.call!.b;
    this.released.add(b);
    this.call = null;
    b.fireDispatchRetry = 0;
    this.c.bad(`Too slow to the fire at the ${nameOf(b)} — the station sent its own engine`);
  }

  update(dt: number): void {
    const f = this.c.f, call = this.call;
    f.siren = f.exempt = !!call && !call.arrived;
    this.spraying = false;
    if (call) {
      const b = call.b;
      if (!b.fire || !World.buildings.includes(b)) {
        // out without the hose (a bucket line), or lost
        this.call = null;
        b.hosed = false;
        if (b.ruined) this.c.bad(`The ${nameOf(b)} burned down`);
        else this.c.toast(`🚒 The fire at the ${nameOf(b)} is out`);
        return;
      }
      const h = here(f), m = midM(b);
      if (!call.arrived && toPlot(b, h.x, h.z) < 30) {
        call.arrived = true;
        this.c.toast('🧯 On scene — out of the cab ({vehicle}), face the flames and the hose does the rest');
      }
      if (!call.arrived && nowAbs() - call.at > FIRE_WAIT) { this.release(); return; }
      // the hose: on foot, close to the building, facing it
      if (!f.driving && toPlot(b, f.pos.x, f.pos.z) < 16 && facing(f, m.x, m.z, 0.75)) {
        this.spraying = true;
        b.hosed = true; // (flames don't leap to the neighbours while a hose is on them)
        call.douse += dt / (HOSE_SECONDS * (0.8 + b.w * b.h * 0.05));
        if (call.douse >= 1) this.putOut(b);
      }
      return;
    }
    // between calls: fire safety inspections, the riskiest businesses first
    this.scanT -= dt;
    if (!this.inspect && this.scanT <= 0) {
      this.scanT = 2;
      const h = here(f);
      const due = World.buildings.filter((b: any) => RISKY.includes(b.type) && active(b) && !b.fire && !(b.inspected > Sim.day));
      const b = nearestDoor(due, h.x, h.z);
      if (b) {
        this.inspect = { b, w: new Work(4) };
        const d = doorM(b);
        this.c.gps.set(d.x, d.z, `Inspection · the ${nameOf(b)}`);
      }
    }
    const ins = this.inspect;
    if (!ins) return;
    if (!active(ins.b) || ins.b.inspected > Sim.day) { this.inspect = null; return; }
    if (ins.w.t > 0) {
      const d = doorM(ins.b);
      if (ins.w.step(dt, onFootNear(f, d.x, d.z, 9))) {
        ins.b.inspected = Sim.day + 7;
        this.inspect = null;
        this.c.earn(6, `Inspected the ${nameOf(ins.b)}`);
        this.c.good(0.4);
        this.c.toast(`📋 The ${nameOf(ins.b)} passed its fire safety inspection — far less risk of fire this week`);
      }
    }
  }

  private putOut(b: any): void {
    const call = this.call!;
    b.fire = 0;
    b.hosed = false;
    this.call = null;
    const name = nameOf(b), mins = nowAbs() - call.at;
    Life.say(`🧯 The Founder's crew put out the fire at the ${name} — building saved!`);
    Tasks.done('fire' + b.id, true, `The Founder's crew saved the ${name}`);
    this.c.earn(30 + (mins < 20 ? 10 : 0), `Saved the ${name}`);
    this.c.good(2);
    for (const r of [...(b.residents || []), ...(b.workers || [])]) Rep.feel(r, 3, `the Founder put out the fire at the ${name}`, `put out the fire at the ${name}`);
    Rep.broadcast(0.2);
    Sim.safety = Math.min(100, Sim.safety + 1);
    this.c.gps.clear();
  }

  interaction(): Act | null {
    const ins = this.inspect, f = this.c.f;
    if (this.call || !ins || ins.w.t > 0) return null;
    const d = doorM(ins.b);
    if (!onFootNear(f, d.x, d.z, 9)) return null;
    return { text: `<b>{interact}</b> inspect the ${nameOf(ins.b)} for fire safety`, act: () => { ins.w.t = 1e-3; } };
  }

  objective(): { text: string; sub?: string; k?: number } {
    const f = this.c.f, call = this.call;
    if (call) {
      const m = midM(call.b);
      if (!call.arrived) return { text: `Fire at the ${nameOf(call.b)}`, sub: `${metres(distTo(f, m.x, m.z))} · blue lights on: the road rules give way` };
      return { text: `Put out the fire at the ${nameOf(call.b)}`, sub: this.spraying ? 'Water on the flames…' : 'On foot, face the flames within reach of the hose', k: call.douse };
    }
    const ins = this.inspect;
    if (ins) {
      const d = doorM(ins.b);
      return ins.w.t > 0
        ? { text: `Inspecting the ${nameOf(ins.b)}`, sub: 'Exits, wiring, the kitchen, the extinguishers…', k: ins.w.k }
        : { text: `Fire safety inspection: the ${nameOf(ins.b)}`, sub: `${metres(distTo(f, d.x, d.z))} · {interact} at the door` };
    }
    return { text: 'Standing by for calls', sub: 'Every business has been inspected this week' };
  }
  marker(): { x: number; y: number; z: number; icon: string } | null {
    if (this.call) { const m = midM(this.call.b); return { x: m.x, y: 14, z: m.z, icon: '🔥' }; }
    if (this.inspect) { const d = doorM(this.inspect.b); return { x: d.x, y: 3.2, z: d.z, icon: '📋' }; }
    return null;
  }
  busy(): boolean { return !!this.call?.arrived; }
  draw(d: Draw): void {
    if (!this.spraying || !this.call) return;
    const f = this.c.f, b = this.call.b, m = midM(b);
    // the jet arcs onto the building, a third of the way in from its near side
    const px = Math.max(b.x * 8 + 1, Math.min((b.x + b.w) * 8 - 1, f.pos.x)), pz = Math.max(b.y * 8 + 1, Math.min((b.y + b.h) * 8 - 1, f.pos.z));
    const tx = px + (m.x - px) * 0.4, tz = pz + (m.z - pz) * 0.4;
    d.spray(f.pos.x + Math.sin(f.camYaw) * 0.6, f.pos.y + 1.2, f.pos.z + Math.cos(f.camYaw) * 0.6, tx, 5, tz);
  }
  end(): void {
    if (this.call) {
      const b = this.call.b;
      this.released.add(b);
      b.fireDispatchRetry = 0;
      b.hosed = false;
      this.call = null;
    }
    this.inspect = null;
  }
}

/* ---------- police officer ---------- */
const POLICE_WAIT = 45;
const BEATS = ['bank', 'mall', 'market', 'shop', 'deptstore', 'jeweler', 'hotel', 'park', 'plaza', 'grandpark', 'trainstation', 'busstop', 'cinema', 'casino', 'school', 'restaurant', 'pub', 'arcade'];
type PoliceCall = { scene: any; kind: 'burglary' | 'dispute' | 'crash'; at: number; arrived: boolean; done: boolean };

export class PoliceJob implements Job {
  call: PoliceCall | null = null;
  beat: any = null;
  private visited = new Map<number, number>();
  private released = new WeakSet<object>();
  private scanT = 0;
  private gpsT = 0;

  constructor(private c: ShiftCtx) {}

  /** where the call is (metres) */
  private where(call: PoliceCall): { x: number; z: number } {
    const s = call.scene;
    if (call.kind === 'burglary') return s.burglar.phase === 'rob' ? doorM(s.target) : { x: s.burglar.x / 2, z: s.burglar.y / 2 };
    return { x: s.x / 2, z: s.y / 2 };
  }
  private live(call: PoliceCall): boolean {
    return call.kind === 'burglary' ? Life.crime === call.scene : call.kind === 'dispute' ? Life.dispute === call.scene : Life.crash === call.scene;
  }

  claim(kind: string, scene: any): boolean {
    if (kind !== 'police' || this.released.has(scene)) return false;
    if (this.call) return this.call.scene === scene;
    const k: PoliceCall['kind'] = scene.burglar ? 'burglary' : scene.ppl ? 'dispute' : 'crash';
    this.call = { scene, kind: k, at: nowAbs(), arrived: false, done: false };
    this.beat = null;
    const at = this.where(this.call);
    const what = k === 'burglary' ? `Break-in at the ${nameOf(scene.target)}` : k === 'dispute' ? 'A fight brewing in the street' : 'A car crash';
    this.c.toast(`📻 ${what} — you're the car on call`, { x: at.x * 2, y: at.z * 2 });
    this.c.gps.set(at.x, at.z, what);
    return true;
  }
  /** too slow: dispatch sends a squad car from the station instead */
  private release(): void {
    const call = this.call!, s = call.scene;
    this.released.add(s);
    this.call = null;
    if (call.kind === 'burglary') { if (Life.crime === s) Life.dispatchPolice(s); }
    else {
      if (s.unit?.founder) s.unit.done = true;
      const u = Life.dispatchTo(Math.round(s.x / T), Math.round(s.y / T), s, call.kind === 'dispute' ? 8 : 12);
      if (u) s.unit = u;
    }
    this.c.bad('Too slow to the call — dispatch sent a squad car instead');
  }

  update(dt: number): void {
    const f = this.c.f, call = this.call;
    f.siren = f.exempt = !!call && !call.done && !call.arrived;
    if (call) {
      if (!this.live(call)) {
        this.call = null;
        if (call.kind === 'burglary' && !call.done) this.c.bad('The burglar got away');
        else if (!call.done) this.c.toast('📻 That one was over before you got there');
        return;
      }
      const at = this.where(call);
      if (!call.arrived && distTo(f, at.x, at.z) < 25) call.arrived = true;
      if (!call.arrived && nowAbs() - call.at > POLICE_WAIT) { this.release(); return; }
      // a fleeing burglar: the GPS keeps up with them
      this.gpsT -= dt;
      if (call.kind === 'burglary' && call.scene.burglar.phase === 'flee' && this.gpsT <= 0) { this.gpsT = 1.5; this.c.gps.set(at.x, at.z, 'The burglar'); }
      return;
    }
    // between calls: walk (or drive) the beat — the busy places, one after another
    this.scanT -= dt;
    if (!this.beat && this.scanT <= 0) {
      this.scanT = 2;
      const h = here(f), t = nowAbs();
      const due = World.buildings.filter((b: any) => BEATS.includes(b.type) && active(b) && t - (this.visited.get(b.id) ?? -1e9) > 180)
        .map((b: any) => ({ b, d: Math.hypot(doorM(b).x - h.x, doorM(b).z - h.z) }))
        .sort((a: any, b: any) => (a.d < 40 ? 1e6 : a.d) - (b.d < 40 ? 1e6 : b.d)); // not the one you're standing at
      if (due.length) {
        this.beat = due[Math.floor(Math.random() * Math.min(3, due.length))].b;
        const d = doorM(this.beat);
        this.c.gps.set(d.x, d.z, `Beat · the ${nameOf(this.beat)}`);
      }
    }
    const b = this.beat;
    if (!b) return;
    if (!active(b)) { this.beat = null; return; }
    const d = doorM(b);
    if (distTo(f, d.x, d.z) < 22) {
      this.beat = null;
      this.visited.set(b.id, nowAbs());
      Life.cooldown = Math.max(0, Life.cooldown) + 30; // a uniform about the place keeps the burglars away
      Sim.safety = Math.min(100, Sim.safety + 0.6);
      this.c.earn(5, 'Walked the beat');
      this.c.good(0.3);
      this.c.toast(`🚓 Beat checked: the ${nameOf(b)} — all quiet`);
    }
  }

  interaction(): Act | null {
    const call = this.call, f = this.c.f;
    if (!call || call.done) return null;
    const s = call.scene;
    if (call.kind === 'burglary') {
      const B = s.burglar;
      if (B.phase === 'approach') return null;
      const bx = B.x / 2, bz = B.y / 2;
      const ok = onFootNear(f, bx, bz, 2.8) || (f.driving && Math.abs(f.car.speed) < 4 && Math.hypot(f.car.x - bx, f.car.z - bz) < 5);
      if (!ok) return null;
      return { text: '<b>{interact}</b> arrest the burglar', act: () => this.arrest() };
    }
    const at = this.where(call);
    if (call.kind === 'dispute') {
      if (!onFootNear(f, at.x, at.z, 7)) return null;
      return {
        text: '<b>{interact}</b> calm them down', act: () => {
          call.done = true;
          s.arrived = true; // (the sim talks them down: the quarrel ends)
          this.c.earn(12, 'Calmed a street argument');
          this.c.good(1);
          for (const p of s.ppl) Rep.feel(p, 1, 'the Founder calmed things down in the street', 'broke up an argument in the street');
        },
      };
    }
    if (!onFootNear(f, at.x, at.z, 11)) return null;
    return {
      text: '<b>{interact}</b> secure the scene and take statements', act: () => {
        call.done = true;
        s.arrived = true; // (statements taken, tow truck called)
        this.c.earn(12, 'Secured a crash scene');
        this.c.good(1);
      },
    };
  }
  private arrest(): void {
    const call = this.call!, c = call.scene, target = c.target;
    call.done = true;
    Life.resolve(true, null);
    this.c.earn(25, 'Arrested a burglar');
    this.c.good(2);
    for (const r of [...(target.residents || []), ...(target.workers || [])]) Rep.feel(r, 2, `the Founder caught the burglar at the ${nameOf(target)}`, `caught the burglar who broke into the ${nameOf(target)}`);
    Rep.broadcast(0.15);
    this.c.toast('🚔 Got them! The burglar is in cuffs and on the way to the station');
    this.c.gps.clear();
  }

  objective(): { text: string; sub?: string; k?: number } {
    const f = this.c.f, call = this.call;
    if (call) {
      const at = this.where(call), far = metres(distTo(f, at.x, at.z));
      if (call.done) return { text: call.kind === 'dispute' ? 'Quarrel calmed' : 'Scene secured', sub: 'Back to the beat in a moment' };
      if (call.kind === 'burglary') {
        const B = call.scene.burglar;
        if (B.phase === 'rob') return { text: `Break-in at the ${nameOf(call.scene.target)}`, sub: `${far} · catch them before they get out` };
        return { text: 'The burglar is running — chase them down', sub: `${far} · on foot or alongside, {interact} to arrest` };
      }
      if (!call.arrived) return { text: call.kind === 'dispute' ? 'An argument in the street' : 'A car crash', sub: `${far} · blue lights on` };
      return call.kind === 'dispute' ? { text: 'Calm the argument down', sub: 'On foot, {interact} beside them' } : { text: 'Secure the crash scene', sub: 'On foot, {interact} by the wreck' };
    }
    if (this.beat) { const d = doorM(this.beat); return { text: `Patrol: the ${nameOf(this.beat)}`, sub: `${metres(distTo(f, d.x, d.z))} · burglars stay away from a busy beat` }; }
    return { text: 'On patrol', sub: 'Listening to the radio' };
  }
  marker(): { x: number; y: number; z: number; icon: string } | null {
    const call = this.call;
    if (call && !call.done) { const at = this.where(call); return { x: at.x, y: 2.6, z: at.z, icon: call.kind === 'burglary' ? '🚨' : call.kind === 'dispute' ? '💢' : '💥' }; }
    if (this.beat) { const d = doorM(this.beat); return { x: d.x, y: 3.2, z: d.z, icon: '👮' }; }
    return null;
  }
  busy(): boolean { return !!this.call && !this.call.done && this.call.arrived; }
  end(): void {
    const call = this.call;
    if (call && !call.done && this.live(call)) {
      // the call goes to the station on the way out
      this.released.add(call.scene);
      this.call = null;
      if (call.kind === 'burglary') Life.dispatchPolice(call.scene);
      else {
        if (call.scene.unit?.founder) call.scene.unit.done = true;
        const u = Life.dispatchTo(Math.round(call.scene.x / T), Math.round(call.scene.y / T), call.scene, 8);
        if (u) call.scene.unit = u;
      }
    }
    this.call = null;
    this.beat = null;
  }
}

/* ---------- paramedic ---------- */
const AMB_WAIT = 40;

export class MedicJob implements Job {
  call: { p: any; at: number; phase: 'go' | 'treat' | 'carry'; arrived: boolean; w: Work; h: any } | null = null;
  visit: { p: any; w: Work } | null = null;
  private released = new WeakSet<object>();
  private scanT = 0;

  constructor(private c: ShiftCtx) {}

  claim(kind: string, p: any): boolean {
    if (kind !== 'ambulance' || this.released.has(p)) return false;
    if (this.call) return this.call.p === p;
    this.call = { p, at: nowAbs(), phase: 'go', arrived: false, w: new Work(5), h: null };
    this.visit = null;
    const why = p.cond?.cause ? ` — hurt ${p.cond.cause}` : '';
    this.c.toast(`🚑 Call: ${Sim.fullName(p)}${why}. You're the ambulance on call`, { x: p.x, y: p.y });
    this.c.gps.set(p.x / 2, p.y / 2, `${p.name} ${p.surname} · casualty`);
    return true;
  }
  private release(): void {
    const p = this.call!.p;
    this.released.add(p);
    this.call = null;
    if (p.state === 'hurt') Health.dispatch(p); // the hospital's own crew goes
    this.c.bad('Too slow to the casualty — the hospital sent its own crew');
  }
  /** the ward to take them to: the shift's own hospital if it has a bed, else the nearest that does */
  private ward(): any {
    const hs = Health.hospitals();
    if (hs.includes(this.c.b) && Health.freeBed(this.c.b)) return this.c.b;
    const h = here(this.c.f);
    return nearestDoor(hs.filter((q: any) => Health.freeBed(q)), h.x, h.z) || nearestDoor(hs, h.x, h.z);
  }

  update(dt: number): void {
    const f = this.c.f, call = this.call;
    f.siren = f.exempt = !!call && call.phase !== 'treat' && !(call.phase === 'go' && call.arrived);
    if (call) {
      const p = call.p;
      if (!Sim.people.includes(p) || (call.phase !== 'carry' && p.state !== 'hurt') || (call.phase === 'carry' && p.state !== 'amb')) {
        this.call = null; // someone else reached them, or they're gone
        return;
      }
      if (call.phase !== 'carry') {
        const x = p.x / 2, z = p.y / 2;
        if (!call.arrived && distTo(f, x, z) < 30) call.arrived = true;
        if (!call.arrived && nowAbs() - call.at > AMB_WAIT) { this.release(); return; }
        if (call.phase === 'treat' && call.w.step(dt, onFootNear(f, x, z, 3.4))) {
          p.state = 'amb'; // on the stretcher, into the back
          call.phase = 'carry';
          call.h = this.ward();
          if (!call.h) { Health.homeCare(p, 'none'); this.call = null; this.c.toast('🩹 No hospital to take them to — patched up and helped home'); return; }
          const d = doorM(call.h);
          this.c.gps.set(d.x, d.z, 'The Hospital');
          this.c.toast(`🚑 ${p.name} is stable and aboard — to the Hospital, blue lights`);
        }
      } else if (!World.buildings.includes(call.h) || call.h.ruined) call.h = this.ward();
      return;
    }
    // between calls: the sick at home, the worst first
    this.scanT -= dt;
    if (!this.visit && this.scanT <= 0) {
      this.scanT = 2.5;
      const h = here(f);
      const sick = Sim.people.filter((p: any) => p.cond && p.cond.k !== 'injury' && p.cond.sev >= 10 && p.state === 'in' && p.at === p.home && !p.ward && p.visitDay !== Sim.day);
      const p = nearestDoor(sick, h.x, h.z, (q: any) => doorM(q.home));
      if (p) {
        this.visit = { p, w: new Work(4) };
        const d = doorM(p.home);
        this.c.gps.set(d.x, d.z, `Home visit · ${p.name} ${p.surname}`);
      }
    }
    const v = this.visit;
    if (!v) return;
    const p = v.p;
    if (!Sim.people.includes(p) || !p.cond || p.state !== 'in' || p.at !== p.home) { this.visit = null; return; }
    if (v.w.t > 0) {
      const d = doorM(p.home);
      if (v.w.step(dt, onFootNear(f, d.x, d.z, 9))) {
        p.cond.sev -= 10;
        if (p.cond.sev <= 0) p.cond = null;
        p.mood = Math.min(98, (p.mood ?? 60) + 4);
        p.visitDay = Sim.day;
        Rep.feel(p, 2, 'the Founder came round to check on me when I was ill', `looked in on ${p.name} when they were ill`);
        this.c.earn(8, `Home visit to ${p.name}`);
        this.c.good(0.5);
        this.c.toast(`🩺 ${p.name} ${p.surname} is on the mend — medicine, a check-up and a few kind words`);
        this.visit = null;
      }
    }
  }

  private deliver(): void {
    const call = this.call!, p = call.p, h = call.h;
    this.call = null;
    Health.deliver(p, h);
    if (p.cond) p.cond.sev = Math.max(1, p.cond.sev - 6); // stabilised quickly: a head start on the mend
    const mins = nowAbs() - call.at;
    this.c.earn(20 + (mins < 30 ? 10 : 0), `Took ${p.name} to the ward`);
    this.c.good(2);
    Rep.feel(p, 3, 'the Founder got me to the hospital in the ambulance', `drove ${p.name} to the hospital in the ambulance`);
    for (const r of p.home.residents) if (r !== p) Rep.feel(r, 1, `the Founder got ${p.name} to the hospital`);
    this.c.gps.clear();
  }

  interaction(): Act | null {
    const f = this.c.f, call = this.call;
    if (call) {
      const p = call.p;
      if (call.phase === 'go' && onFootNear(f, p.x / 2, p.y / 2, 2.8)) return { text: `<b>{interact}</b> treat ${p.name}`, act: () => { call.phase = 'treat'; call.arrived = true; } };
      if (call.phase === 'carry' && call.h) {
        const d = doorM(call.h);
        if (stoppedNear(f, d.x, d.z, 18)) return { text: `<b>{interact}</b> hand ${p.name} over to the ward`, act: () => this.deliver() };
      }
      return null;
    }
    const v = this.visit;
    if (!v || v.w.t > 0) return null;
    const d = doorM(v.p.home);
    if (!onFootNear(f, d.x, d.z, 9)) return null;
    return { text: `<b>{interact}</b> check on ${v.p.name} (${Health.label(v.p).toLowerCase()})`, act: () => { v.w.t = 1e-3; } };
  }

  objective(): { text: string; sub?: string; k?: number } {
    const f = this.c.f, call = this.call;
    if (call) {
      const p = call.p, far = metres(distTo(f, p.x / 2, p.y / 2));
      if (call.phase === 'go') return { text: `Casualty: ${p.name} ${p.surname}`, sub: call.arrived ? 'On foot, {interact} beside them' : `${far} · blue lights on` };
      if (call.phase === 'treat') return { text: `Treating ${p.name}`, sub: 'Stay with them', k: call.w.k };
      const d = call.h ? doorM(call.h) : null;
      return { text: `${p.name} aboard — to the Hospital`, sub: d ? `${metres(distTo(f, d.x, d.z))} · stop at the door, {interact} to hand over` : '' };
    }
    const v = this.visit;
    if (v) {
      const d = doorM(v.p.home);
      return v.w.t > 0 ? { text: `With ${v.p.name}`, sub: 'A check-up and some medicine', k: v.w.k } : { text: `Home visit: ${v.p.name} ${v.p.surname}`, sub: `${Health.label(v.p)} · ${metres(distTo(f, d.x, d.z))}` };
    }
    return { text: 'Standing by for calls', sub: 'Nobody ill at home needs a visit right now' };
  }
  marker(): { x: number; y: number; z: number; icon: string } | null {
    const call = this.call;
    if (call && call.phase !== 'carry') return { x: call.p.x / 2, y: 1.4, z: call.p.y / 2, icon: '🤕' };
    if (call?.h) { const d = doorM(call.h); return { x: d.x, y: 3.4, z: d.z, icon: '🏥' }; }
    if (this.visit) { const d = doorM(this.visit.p.home); return { x: d.x, y: 3.2, z: d.z, icon: '🩺' }; }
    return null;
  }
  busy(): boolean { return !!this.call && (this.call.phase !== 'go' || this.call.arrived); }
  end(): void {
    const call = this.call;
    if (call) {
      // a colleague takes over: a patient aboard is driven in, one still on the ground gets the hospital's crew
      if (call.phase === 'carry' && call.h) this.deliver();
      else { this.released.add(call.p); this.call = null; if (call.p.state === 'hurt') Health.dispatch(call.p); }
    }
    this.call = null;
    this.visit = null;
  }
}

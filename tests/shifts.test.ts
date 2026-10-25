/* Work shifts (Milestone 6): each job starts at its workplace, plays as a loop of real sim
   events, pays into the wallet at clock-off (the village fund for public services, the
   workplace's till for a business), and changes the village: fires saved, arrests made,
   patients on the ward, the lights back on, shelves restocked, fares carried, queues
   boarded, a train calling at the platform, visitors flown in, walls built, customers
   served, headlines filed and a field harvested. */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Game } from '../src/sim/game';
import { Sim } from '../src/sim/agents';
import { Life } from '../src/sim/life';
import { World } from '../src/sim/world';
import { Gov } from '../src/sim/gov';
import { Health } from '../src/sim/health';
import { Power } from '../src/sim/power';
import { Supply } from '../src/sim/supply';
import { News } from '../src/sim/news';
import { Weather } from '../src/sim/weather';
import { Gateways } from '../src/sim/gateways';
import { Wallet } from '../src/player/wallet';
import { Shifts } from '../src/player/shifts';
import { doorM, kerbM, midM } from '../src/jobs/common';
import type { FireJob, PoliceJob, MedicJob } from '../src/jobs/emergency';
import type { TaxiJob, BusJob, TruckJob } from '../src/jobs/driving';
import type { TrainJob, PilotJob } from '../src/jobs/rails';
import type { PowerJob, BuildJob, ShopJob, ReporterJob, FarmJob } from '../src/jobs/town';
import { C, build, town } from './town';

/** just enough of the Founder for working shifts */
function founder(): any {
  return {
    pos: new THREE.Vector3(), yaw: 0, camYaw: 0, purse: new Wallet(), car: { x: 0, z: 0, yaw: 0, speed: 0, y: 0, pitch: 0 }, driving: false,
    work: null, siren: false, beacon: false, exempt: false, bag: [], fleet: { cur: null }, riding: false,
    takeWork(v: any, x: number, z: number, yaw: number) { this.work = v; Object.assign(this.car, { x, z, yaw, speed: 0 }); },
    dropWork() { this.work = null; this.driving = false; },
    passengerAt(x: number, y: number, z: number) { this.pos.set(x, y, z); this.riding = true; },
    endRide() { this.riding = false; },
    stepOutOf(b: any) { this.pos.set(b.door.x * 8 + 4, 0, b.door.y * 8 + 4); this.driving = false; },
    groundAt() { return 0; },
  };
}
const gps = (): any => ({ dest: null, set(x: number, z: number, label: string) { this.dest = { x, z, label }; }, clear() { this.dest = null; } });
/** on foot at (x, z), looking toward (tx, tz) */
function standAt(f: any, x: number, z: number, tx = x + 1, tz = z): void {
  f.driving = false;
  f.pos.set(x, 0, z);
  f.camYaw = Math.atan2(tx - x, tz - z);
}
/** at the wheel at (x, z), stopped (or rolling at `speed`) */
function driveTo(f: any, x: number, z: number, speed = 0): void {
  f.driving = true;
  f.car.x = x; f.car.z = z; f.car.speed = speed;
}
function shift(f: any): { s: Shifts; log: string[] } {
  const log: string[] = [];
  const s = new Shifts(f, gps(), (m) => log.push(m));
  return { s, log };
}
const frames = (s: Shifts, n: number, each?: () => void): void => { for (let i = 0; i < n; i++) { each?.(); s.update(0.1); } };

describe('6a — the emergency services', () => {
  it('a firefighter takes the call, hoses the fire out and is paid from the village fund', () => {
    town(701);
    const st = build('fire', C.x + 6, C.y + 8);
    const bakery = build('bakery', C.x - 8, C.y + 6);
    const f = founder(), { s } = shift(f);
    Sim.clock = 600;
    expect(s.start('fire', st)).toBe(true);
    expect(f.work?.work?.type).toBe('fire');
    Life.fireTrucks = [];
    Life.igniteBuilding(bakery);
    expect(Life.fireTrucks.length).toBe(0); // the call came to the Founder, not the station's own engine
    const job = s.cur!.job as FireJob;
    expect(job.call?.b).toBe(bakery);
    // out of the cab beside it, facing the flames
    const m = midM(bakery);
    standAt(f, bakery.x * 8 - 6, m.z, m.x, m.z);
    frames(s, 600, () => { if (!bakery.fire) return; });
    expect(bakery.fire).toBe(0);
    expect(bakery.ruined).toBeFalsy();
    Gov.treasury = 600;
    const before = f.purse.balance;
    s.end();
    expect(f.purse.balance).toBeGreaterThan(before + 25);
    expect(Gov.treasury).toBeLessThan(600);
    expect(s.record.n.fire).toBe(1);
    expect(f.work).toBe(null); // the engine went back to the station
  });

  it('a call the firefighter is too slow to reach goes to the station after all', () => {
    town(702);
    const st = build('fire', C.x + 6, C.y + 8);
    const far = build('bakery', C.x + 30, C.y - 20);
    const f = founder(), { s, log } = shift(f);
    Sim.clock = 600;
    s.start('fire', st);
    standAt(f, doorM(st).x, doorM(st).z);
    Life.fireTrucks = [];
    Life.igniteBuilding(far);
    expect(Life.fireTrucks.length).toBe(0);
    Sim.clock += 50;
    s.update(0.1);
    expect((s.cur!.job as FireJob).call).toBe(null);
    expect(log.some((l) => /station sent its own engine/.test(l))).toBe(true);
    Game.streetMode = false; Game.setSpeed(1);
    Game.tick(0.1);
    expect(Life.fireTrucks.some((u: any) => u.target === far)).toBe(true);
  });

  it('a police officer talks a street argument down and arrests a burglar', () => {
    const hs = town(703);
    const ps = build('police', C.x + 6, C.y + 8);
    build('shop', C.x - 6, C.y + 6);
    const f = founder(), { s } = shift(f);
    Sim.clock = 700;
    s.start('police', ps);
    const [a, b] = Sim.people.filter((p: any) => p.kind !== 'kid');
    const at = { x: hs[0].door.x * 16 + 8, y: hs[0].door.y * 16 + 20 };
    Life.police = [];
    Life.dispute = { x: at.x, y: at.y, t: 9, ppl: [a, b] };
    Life.dispute.unit = Life.dispatchTo(Math.round(at.x / 16), Math.round(at.y / 16), Life.dispute, 8);
    expect(Life.police.length).toBe(0);
    expect(Life.dispute.unit.founder).toBe(true);
    const job = s.cur!.job as PoliceJob;
    expect(job.call?.kind).toBe('dispute');
    standAt(f, at.x / 2, at.y / 2);
    const calm = job.interaction();
    expect(calm?.text).toMatch(/calm/);
    calm!.act();
    expect(Life.dispute.arrived).toBe(true);
    Life.dispute = null;
    s.update(0.1);
    // a break-in: the alarm comes to the Founder; catch the burglar on foot
    Life.crime = null;
    for (let i = 0; i < 20 && !Life.crime; i++) Life.startCrime();
    expect(Life.crime).toBeTruthy();
    const c = Life.crime;
    c.burglar.phase = 'rob';
    Life.dispatchPolice(c);
    expect(Life.police.length).toBe(0);
    expect(job.call?.kind).toBe('burglary');
    standAt(f, c.burglar.x / 2, c.burglar.y / 2);
    const arrests = Life.arrests;
    job.interaction()!.act();
    expect(Life.arrests).toBe(arrests + 1);
    expect(Life.crime).toBe(null);
  });

  it('a paramedic treats a casualty where they fell and hands them over to the ward', () => {
    town(704);
    const h = build('hospital', C.x + 4, C.y + 10);
    const f = founder(), { s } = shift(f);
    Sim.clock = 600;
    s.start('medic', h);
    const p = Sim.people.find((q: any) => q.kind !== 'kid');
    Life.ambulances = [];
    expect(Health.injure(p, 60, 'in a test', { x: p.home.door.x * 16 + 8, y: p.home.door.y * 16 + 24 })).toBe(true);
    expect(Life.ambulances.length).toBe(0);
    const job = s.cur!.job as MedicJob;
    expect(job.call?.p).toBe(p);
    standAt(f, p.x / 2, p.y / 2);
    job.interaction()!.act();
    frames(s, 70);
    expect(p.state).toBe('amb');
    const d = doorM(h);
    driveTo(f, d.x, d.z);
    const hand = job.interaction();
    expect(hand?.text).toMatch(/ward/);
    hand!.act();
    expect(p.ward).toBe(h.id);
    expect(s.cur!.earned).toBeGreaterThan(15);
  });
});

describe('6b — driving for a living', () => {
  it('a taxi driver picks up a real villager and drops them where they wanted to go; the meter pays', () => {
    town(711, 8);
    const stand = build('taxistand', C.x + 10, C.y + 6);
    build('cafe', C.x - 22, C.y + 12);
    build('shop', C.x + 34, C.y - 8);
    const f = founder(), { s } = shift(f);
    Sim.clock = 700;
    s.start('taxi', stand);
    const job = s.cur!.job as TaxiJob;
    driveTo(f, kerbM(stand).x, kerbM(stand).z); // (in the cab at the rank)
    expect(job.findFare()).toBe(true);
    const fare = job.fare!, p = fare.p;
    expect(p.state).toBe('hail');
    driveTo(f, fare.kerb.x, fare.kerb.z);
    s.update(0.1);
    expect(p.state).toBe('cab');
    const k = kerbM(fare.to), till = stand.funds || 0;
    driveTo(f, k.x, k.z);
    s.update(0.1);
    expect(job.served).toBe(1);
    expect(stand.funds).toBeGreaterThan(till);
    Game.streetMode = false; Game.setSpeed(1);
    Game.tick(0.1); // (the sim's own arrival: through the door)
    expect(p.state).toBe('in');
    expect(p.at).toBe(fare.to);
    // the rank pays the driver's share at clock-off, from its till
    const before = f.purse.balance, t2 = stand.funds;
    s.end();
    expect(f.purse.balance).toBeGreaterThan(before);
    expect(stand.funds).toBeLessThan(t2);
  });

  it('a bus driver pulls in at the next stop and the queue boards', () => {
    town(712);
    const a = build('busstop', C.x - 10, C.y + 4), b = build('busstop', C.x + 30, C.y + 4);
    Life.busT = 0; Life.busSig = '';
    Life.tickBuses(0.01);
    expect(Life.buses.length).toBeGreaterThan(0);
    const f = founder(), { s } = shift(f);
    Sim.clock = 600;
    standAt(f, doorM(a).x, doorM(a).z);
    expect(s.start('bus', a)).toBe(true);
    const job = s.cur!.job as BusJob;
    const next = (job as any).target();
    expect(next).toBe(b);
    Life.stopQueues.set(b.id, { waiting: [{ seed: 1, kind: 'man' }, { seed: 2, kind: 'woman' }, { seed: 3, kind: 'kid' }] });
    const k = kerbM(b);
    driveTo(f, k.x, k.z);
    frames(s, 20);
    expect(job.pax.length).toBe(3);
    expect(job.served).toBe(3);
    expect(Life.stopQueues.get(b.id).waiting.length).toBe(0);
  });

  it('a delivery driver carries a load from a yard to a shop running low', () => {
    town(713);
    const wh = build('warehouse', C.x + 12, C.y + 10);
    const shop = build('shop', C.x - 8, C.y + 6);
    const farm = build('farm', C.x + 6, C.y - 16);
    Supply.init(shop); Supply.init(farm);
    shop.stock = 2; farm.stock = 40; shop.funds = 200;
    const f = founder(), { s } = shift(f);
    Sim.clock = 600;
    s.start('truck', wh);
    s.update(0.1);
    const job = s.cur!.job as TruckJob;
    expect(job.job?.dst).toBe(shop);
    expect(job.job?.src).toBe(farm);
    expect(Supply.incoming(shop)).toBeGreaterThan(0); // (the village's own trucks leave it to you)
    let k = kerbM(farm);
    driveTo(f, k.x, k.z);
    job.interaction()!.act();
    expect(farm.stock).toBeLessThan(40);
    k = kerbM(shop);
    driveTo(f, k.x, k.z);
    job.interaction()!.act();
    expect(shop.stock).toBeGreaterThan(15);
    expect(job.done).toBe(1);
  });
});

describe('6c — rails and skies', () => {
  it('a train driver takes the local out and calls at the next platform', () => {
    town(721);
    const a = build('trainstation', C.x - 22, C.y - 16), b = build('trainstation', C.x + 26, C.y - 16);
    // track from the side of one station to the other
    const sides = (st: any): number[][] => [[st.x + st.w, st.y + 1], [st.x - 1, st.y + 1], [st.x + 1, st.y + st.h], [st.x + 1, st.y - 1]];
    let laid = -1;
    for (const p of sides(a)) { for (const q of sides(b)) { laid = World.connectRail(p[0], p[1], q[0], q[1]); if (laid >= 0) break; } if (laid >= 0) break; }
    expect(laid).toBeGreaterThan(0);
    Game.afterMapEdit();
    Life.trainT = 0; Life.trainSig = '';
    Life.tickTrains(0.01);
    expect(Life.trains.some((t: any) => t.type !== 'freight')).toBe(true);
    const f = founder(), { s } = shift(f);
    Sim.clock = 700;
    s.start('train', a);
    const job = s.cur!.job as TrainJob;
    expect(job.tr.driver).toBe(true);
    s.update(0.1);
    expect(f.riding).toBe(true); // (in the cab)
    // power on, and brake for the platform in time
    s.controls = () => {
      const ahead = job.stopAt >= 0 ? (job.stopAt - job.tr.prog) * job.tr.dir : 99;
      const stopping = (job.v * job.v) / (2 * 0.85) + 0.25;
      return ahead <= stopping ? { gas: 0, brake: 1, steer: 0, pitch: 0 } : { gas: 1, brake: 0, steer: 0, pitch: 0 };
    };
    for (let i = 0; i < 3000 && job.calls === 0; i++) s.update(0.1);
    expect(job.calls).toBe(1);
    expect(job.pax).toBeGreaterThan(0);
    s.end();
    expect(job.tr === null && Life.trains.every((t: any) => !t.driver)).toBe(true);
  });

  it('a pilot takes off, flies out of the map, comes home and lands; the visitors walk into town', () => {
    town(722);
    const ap = build('airport', C.x + 30, C.y + 20);
    build('cafe', C.x - 6, C.y + 6);
    expect(ap).toBeTruthy();
    const f = founder(), { s } = shift(f);
    Sim.clock = 600;
    s.start('pilot', ap);
    expect(s.carrying()).toBe(true);
    expect(s.end()).toBe(true); // (on the ground, before the roll, you can still clock off)
    // start again and fly
    s.start('pilot', ap);
    const pj = s.cur!.job as PilotJob;
    s.controls = () => ({ gas: 1, brake: 0, steer: 0, pitch: pj.phase === 'roll' || pj.pl.alt < 80 ? 1 : 0 });
    for (let i = 0; i < 6000 && pj.phase !== 'away'; i++) s.update(0.1);
    expect(pj.phase).toBe('away');
    expect(s.overlay()).toBe(true);
    expect(Gateways.away).toBeTruthy();
    expect(pj.locked()).toBeTruthy(); // (no clocking off in the air)
    const t0 = Sim.day * 1440 + Sim.clock;
    let now = performance.now();
    for (let i = 0; i < 400 && pj.phase === 'away'; i++) { now += 100; pj.frame(now); }
    expect(pj.phase).toBe('approach');
    expect(Sim.day * 1440 + Sim.clock - t0).toBeGreaterThan(120); // the hours passed at home
    expect(Gateways.away).toBe(null);
    // over the runway threshold, gently down
    const r = pj.runway();
    Object.assign(pj.pl, { x: r.x0 + 6, z: r.y, alt: 0.3, yaw: Math.PI / 2, v: 40, vs: -1.5, thr: 0 });
    s.controls = () => ({ gas: 0, brake: 1, steer: 0, pitch: -0.1 });
    Gateways.visitors = [];
    for (let i = 0; i < 400 && pj.phase !== 'gate'; i++) s.update(0.1);
    expect(pj.phase).toBe('gate');
    expect(pj.flights).toBe(1);
    expect(Gateways.visitors.length).toBeGreaterThan(0);
    const before = f.purse.balance;
    expect(s.end()).toBe(true);
    expect(f.purse.balance).toBeGreaterThan(before + 40); // the airline's takings pay the pilot
  });
});

describe('6d — the town\'s own work', () => {
  it('an electrician mends the lines and the district lights up again', () => {
    const hs = town(731);
    const pp = build('powerplant', C.x + 14, C.y + 14);
    const f = founder(), { s } = shift(f);
    Sim.clock = 600;
    s.start('power', pp);
    const d = Power.districtOfB(hs[0]);
    Life.crews = [];
    expect(Power.fault(d, 'a test')).toBe(true);
    expect(Life.crews.length).toBe(0); // the Founder's van takes the job
    const job = s.cur!.job as PowerJob;
    const spot = job.call!.spot;
    standAt(f, spot.x, spot.z);
    job.interaction()!.act();
    frames(s, 120);
    expect(Power.faults.has(d)).toBe(false);
    expect(Power.dark[d]).toBe(0);
  });

  it('a construction worker carries bricks to the scaffold and the walls rise faster', () => {
    town(732);
    const site = build('shop', C.x + 8, C.y + 10, false);
    Game.afterMapEdit();
    expect(site.construction).toBeGreaterThan(0);
    const f = founder(), { s } = shift(f);
    Sim.clock = 600;
    expect(s.start('build', site)).toBe(true);
    const job = s.cur!.job as BuildJob;
    s.update(0.1);
    const left = site.construction;
    const pallet = (job as any).pallet(site);
    standAt(f, pallet.x, pallet.z);
    job.interaction()!.act();
    expect(job.holding).toBe(true);
    const m = midM(site);
    standAt(f, site.x * 8 - 1, m.z);
    job.interaction()!.act();
    expect(site.construction).toBeLessThan(left - 10);
    expect(job.loads).toBe(1);
  });

  it('a café worker takes a real customer\'s order, makes it at the counter and serves it', () => {
    town(733);
    const cafe = build('cafe', C.x - 6, C.y + 6);
    const p = Sim.people.find((q: any) => q.kind !== 'kid');
    p.home.funds = 200;
    p.mood = 50;
    Supply.init(cafe);
    const before = cafe.funds || 0;
    // the room as the Founder sees it: one customer at a table, the counter
    let facing: 'person' | 'counter' = 'person';
    const occ = { p, staff: false, place: { x: 1, z: 0, face: 0, pose: 'sit' } };
    const counter = { kind: 'counter', x: 0, z: -2, yaw: 0, label: 'The counter', post: 0 };
    const room: any = { active: true, b: cafe, people: [occ], L: { spots: [counter] }, pos: new THREE.Vector2(0, -2), seated: null, use: () => (facing === 'person' ? { kind: 'person', who: occ } : { kind: 'spot', spot: counter }) };
    const f = founder(), { s } = shift(f);
    s.indoors = () => room;
    Sim.clock = 700;
    s.start('shop', cafe);
    const job = s.cur!.job as ShopJob;
    s.update(0.1);
    job.interaction()!.act(); // take the order
    facing = 'counter';
    job.interaction()!.act(); // make it
    frames(s, 40);
    expect(job.carry?.p).toBe(p);
    facing = 'person';
    job.interaction()!.act(); // serve it
    expect(job.count).toBe(1);
    expect(cafe.funds).toBeGreaterThan(before);
    expect(p.mood).toBeGreaterThan(50);
  });

  it('a PVTV reporter films a fire and files the story: it goes out on PVTV', () => {
    town(734);
    const tv = build('tvstation', C.x + 10, C.y + 8);
    const bakery = build('bakery', C.x - 8, C.y + 6);
    const f = founder(), { s } = shift(f);
    Sim.clock = 600;
    s.start('reporter', tv);
    Life.igniteBuilding(bakery);
    s.update(0.1);
    const job = s.cur!.job as ReporterJob;
    expect(job.story?.head).toMatch(/Fire at the Bakery/);
    const m = midM(bakery);
    standAt(f, m.x - 20, m.z, m.x, m.z);
    frames(s, 100);
    expect(job.story?.filmed).toBe(true);
    const d = doorM(tv);
    standAt(f, d.x, d.z);
    job.interaction()!.act();
    expect(News.breakingText).toMatch(/PVTV on the scene/);
    expect(job.stories).toBe(1);
  });

  it('a farmer harvests the field on the tractor: food into the yard', () => {
    town(735);
    const farm = build('farm', C.x + 6, C.y - 16);
    Supply.init(farm);
    farm.stock = 0;
    Weather.season = 1;
    const f = founder(), { s } = shift(f);
    Sim.clock = 600;
    s.start('farm', farm);
    const job = s.cur!.job as FarmJob;
    expect(job.mode).toBe('harvest');
    expect(job.rows.length).toBeGreaterThan(4);
    for (const r of job.rows) for (const p of r.pts) { driveTo(f, p.x, p.z, 3); s.update(0.1); }
    expect(job.finished).toBe(true);
    expect(farm.stock).toBeGreaterThan(10);
  });
});

describe('the shift itself', () => {
  it('books from the phone, starts at the door, and a business pays only what its till holds', () => {
    town(741);
    const stand = build('taxistand', C.x + 10, C.y + 6);
    const f = founder(), { s } = shift(f);
    Sim.clock = 700;
    f.pos.set(0, 0, 0);
    s.go('taxi');
    expect(s.booked?.b).toBe(stand);
    expect(s.cur).toBe(null);
    const d = doorM(stand);
    standAt(f, d.x, d.z);
    s.update(0.1);
    expect(s.cur?.def.id).toBe('taxi');
    stand.funds = 3;
    s.cur!.earned = 50;
    const before = f.purse.balance;
    s.end();
    expect(f.purse.balance - before).toBe(3);
    expect(stand.funds).toBe(0);
    expect(s.record.owed).toBe(0); // (a business pays what it can; it owes nothing)
  });

  it('an empty village fund owes a public servant their wages, and pays when the taxes come in', () => {
    town(742);
    const ps = build('police', C.x + 6, C.y + 8);
    const f = founder(), { s } = shift(f);
    Sim.clock = 700;
    s.start('police', ps);
    s.cur!.earned = 40;
    Gov.treasury = 0;
    const before = f.purse.balance;
    s.end();
    expect(f.purse.balance).toBe(before);
    expect(s.record.owed).toBeGreaterThan(25);
    Gov.treasury = 400;
    s.update(0.1);
    expect(s.record.owed).toBe(0);
    expect(f.purse.balance).toBeGreaterThan(before + 25);
    expect(Gov.treasury).toBeGreaterThanOrEqual(40);
  });
});

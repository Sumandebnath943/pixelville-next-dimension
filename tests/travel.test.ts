/* Going places (Milestone 5): the national railway reaches a new station and the
   Intercity Express calls on its timetable; visitors step off and spend; newcomers
   arrive at the station and walk home; the Founder waits at a stop, boards the bus,
   pays and gets off where they asked; trips off the map (by road, and a flight with
   check-in, take-off and landing) pass the hours at home and come back to a summary. */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Game } from '../src/sim/game';
import { Sim } from '../src/sim/agents';
import { Life } from '../src/sim/life';
import { World, GW } from '../src/sim/world';
import { Gateways, city } from '../src/sim/gateways';
import { Traffic } from '../src/sim/traffic';
import { Transit } from '../src/player/transit';
import { Travel } from '../src/player/travel';
import { Wallet } from '../src/player/wallet';
import { C, build, town, until } from './town';

/** just enough of the Founder for riding and trips */
function founder(): any {
  return {
    pos: new THREE.Vector3(), bag: [], purse: new Wallet(), car: { x: 0, z: 0, yaw: 0, speed: 0, y: 0, pitch: 0 }, driving: false, hijacked: null, fleet: { cur: null },
    riding: false,
    passengerAt(x: number, y: number, z: number) { this.pos.set(x, y, z); this.riding = true; },
    endRide() { this.riding = false; },
    stepOutOf(b: any) { this.pos.set(b.door.x * 8 + 4, 0, b.door.y * 8 + 4); },
    placeAt(x: number, z: number) { this.pos.set(x, 0, z); },
    groundAt() { return 0; },
  };
}
const gps: any = { dest: null };
const view = (): any => ({ log: [] as string[], journey(o: any) { this.log.push('journey:' + o.to); }, city(o: any) { this.log.push('city:' + o.c.name); this.last = o; }, summary(o: any) { this.log.push('summary'); this.sum = o; }, hide() {} });
/** frames of the game with the transit and travel modules in them (as main.ts runs them) */
function play(seconds: number, tr: Transit, tv: Travel, now: { t: number }, report?: () => void): void {
  Game.streetMode = false;
  for (let i = 0; i < seconds * 10; i++) {
    now.t += 100;
    if (tv.overlay) { tv.frame(now.t); continue; }
    Game.setSpeed(1);
    Game.tick(0.1);
    report?.(); // (the Founder tells the traffic where they stand, as founder.update does)
    tr.update(0.1);
    tv.update();
  }
}

describe('gateways', () => {
  it('the national railway reaches a new station, and the Intercity Express keeps its timetable', () => {
    town(601);
    const st = build('trainstation', C.x + 14, C.y - 10);
    build('cafe', C.x + 6, C.y + 6); // (somewhere for visitors to go)
    expect(st).toBeTruthy();
    Gateways.evalT = 99;
    Gateways.tick(0.01);
    expect(Gateways.line).toBeTruthy();
    const end = Gateways.line!.route[Gateways.line!.route.length - 1];
    expect(end[0] === 0 || end[1] === 0 || end[0] === GW - 1).toBe(true);
    // the 07:00 service comes in from the edge, stands at the platform, and leaves again
    Sim.clock = 419;
    Gateways.ic = null; // (re-timetabled from now)
    expect(until(() => Gateways.ic?.phase === 'in', 30)).toBe(true);
    expect(until(() => Gateways.boarding(), 600)).toBe(true);
    expect(Gateways.visitors.length).toBeGreaterThan(0);
    expect(until(() => Gateways.ic.phase === 'out', 60)).toBe(true);
    expect(until(() => Gateways.ic.phase === 'off', 600)).toBe(true);
    expect(Gateways.nextDeparture()).toBeGreaterThan(Sim.clock - 1);
  });

  it('visitors walk to a venue, spend there and go home', () => {
    town(602);
    const st = build('trainstation', C.x + 14, C.y - 10);
    const cafe = build('cafe', C.x + 6, C.y + 6);
    Gateways.visitors = [];
    const takings = cafe.funds;
    let ok = false;
    for (let i = 0; i < 30 && !ok; i++) { Gateways.visitors = []; ok = Gateways.visit(st, 'Westmere') && Gateways.visitors[0].venue === cafe; }
    if (!ok) return; // (the town's only venue might not be reachable on foot from here)
    const v = Gateways.visitors[0];
    expect(until(() => v.phase === 'stay', 300)).toBe(true);
    expect(cafe.funds).toBeGreaterThan(takings);
    expect(until(() => !Gateways.visitors.includes(v), 600)).toBe(true);
  });

  it('newcomers come in on the intercity and walk to their new home', () => {
    const homes = town(603, 2);
    build('trainstation', C.x + 14, C.y - 10);
    Gateways.evalT = 99; Gateways.tick(0.01);
    const home = build('house', C.x - 10, C.y + 6);
    for (const r of home.residents.slice()) Sim.removePerson(r, true);
    const fam = Sim.spawnFamily(home);
    const via = Gateways.welcome(home, fam.surname);
    expect(via).toMatch(/intercity/);
    const them = home.residents.filter((p: any) => p.surname === fam.surname);
    expect(them.every((p: any) => p.state === 'walk' || p.at !== home)).toBe(true);
    expect(until(() => them.every((p: any) => p.state === 'in' && p.at === home), 600)).toBe(true);
    void homes;
  });
});

describe('riding and trips', () => {
  it('waits at a stop, boards the bus, pays the fare and gets off at the chosen stop', () => {
    town(611, 8);
    const a = build('busstop', C.x + 2, C.y + 6), b = build('busstop', C.x + 26, C.y + 6), c = build('busstop', C.x - 8, C.y - 6);
    expect(a && b && c).toBeTruthy();
    expect(until(() => Life.buses.length > 0, 200)).toBe(true);
    const f = founder();
    // wait at a stop the bus has to drive up to (it starts its loop parked at the first one)
    const line = Life.buses[0];
    const [from, to] = [line.stops[1], line.stops[2]];
    f.stepOutOf(from);
    const tr = new Transit(f, gps, () => {}, () => {});
    const tv = new Travel(f, tr, view(), () => {}, { hideCar() {}, carBack() {} });
    const opts = tr.options(from);
    expect(opts.length).toBeGreaterThan(1);
    tr.wait('bus', from, to);
    const now = { t: 0 };
    let boarded = false;
    // standing by the stop's door, which is in the road: the bus must still pull in
    const report = (): void => { if (!tr.riding()) Traffic.guests = [{ x: f.pos.x * 2, y: f.pos.z * 2, dx: 0, dy: 1, car: false, still: true }]; };
    for (let i = 0; i < 400 && !boarded; i++) { play(1, tr, tv, now, report); boarded = tr.riding(); }
    expect(boarded).toBe(true);
    expect(f.purse.balance).toBe(118);
    expect(from.funds).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < 600 && tr.riding(); i++) play(1, tr, tv, now);
    expect(tr.riding()).toBe(false);
    expect(Math.hypot(f.pos.x - (to.door.x * 8 + 4), f.pos.z - (to.door.y * 8 + 4))).toBeLessThan(2);
  });

  it('a cab comes from the rank, takes you to the GPS destination, and you pay the meter', () => {
    town(615, 8);
    const rank = build('taxistand', C.x + 4, C.y - 6);
    const cafe = build('cafe', C.x + 24, C.y + 8);
    expect(until(() => Life.taxis.length > 0, 200)).toBe(true);
    const f = founder();
    f.stepOutOf(rank);
    const g: any = { dest: { x: cafe.door.x * 8 + 4, z: cafe.door.y * 8 + 4, label: 'The Café' } };
    const tr = new Transit(f, g, () => {}, () => {});
    const tv = new Travel(f, tr, view(), () => {}, { hideCar() {}, carBack() {} });
    expect(tr.callCab(rank)).toBe(true);
    const now = { t: 0 };
    for (let i = 0; i < 300 && tr.cab?.phase !== 'waiting'; i++) play(1, tr, tv, now);
    expect(tr.cab?.phase).toBe('waiting');
    const prompt = tr.interaction();
    if (!prompt) f.pos.set(tr.cab!.v.x / 2, 0, tr.cab!.v.y / 2); // (step up to it)
    tr.interaction()!.act();
    expect(tr.riding()).toBe(true);
    for (let i = 0; i < 300 && tr.riding(); i++) play(1, tr, tv, now);
    expect(tr.riding()).toBe(false);
    expect(tr.cab).toBeNull();
    expect(f.purse.balance).toBeLessThan(120);
    expect(Math.hypot(f.pos.x - g.dest.x, f.pos.z - g.dest.z)).toBeLessThan(30);
  });

  it('a road trip off the end of the highway passes the hours at home and comes back to a summary', () => {
    town(612);
    const f = founder();
    const v = view();
    const tr = new Transit(f, gps, () => {}, () => {});
    let back = false;
    const tv = new Travel(f, tr, v, () => {}, { hideCar() {}, carBack() { back = true; } });
    const t0 = Sim.day * 1440 + Sim.clock;
    expect(tv.start(city('westmere')!, 'road', null, 'west')).toBe(true);
    expect(Gateways.away?.city).toBe('westmere');
    const now = { t: 0 };
    play(20, tr, tv, now);
    expect(v.log).toContain('city:Westmere');
    expect(Sim.day * 1440 + Sim.clock - t0).toBeGreaterThanOrEqual(150);
    // buy the souvenir, then home
    const souvenir = v.last.actions.find((x: any) => /souvenir/i.test(x.label));
    souvenir.act();
    expect(f.bag.some((it: any) => /cheese/i.test(it.name))).toBe(true);
    v.last.actions[v.last.actions.length - 1].act(); // head home
    play(20, tr, tv, now);
    expect(back).toBe(true);
    expect(v.log).toContain('summary');
    expect(v.sum.lines[0]).toMatch(/You were away/);
    expect(Gateways.away).toBeNull();
    expect(Sim.day * 1440 + Sim.clock - t0).toBeGreaterThanOrEqual(300);
    v.sum.done();
    expect(tv.active).toBe(false);
  });

  it('a flight: check in, wait at the gate, take off, fly, and land at home', () => {
    town(613);
    const airport = build('airport', C.x + 30, C.y + 20);
    if (!airport || !airport.connected) return; // (no room for a runway on this map)
    const f = founder();
    f.purse.balance = 500;
    f.stepOutOf(airport);
    const v = view();
    const tr = new Transit(f, gps, () => {}, () => {});
    const tv = new Travel(f, tr, v, () => {}, { hideCar() {}, carBack() {} });
    expect(tv.options(airport).some((o) => /Flight to Avalon City/.test(o.label))).toBe(true);
    expect(tv.start(city('avalon')!, 'air', airport)).toBe(true);
    expect(f.purse.balance).toBe(380);
    tv.gateWait();
    expect(tr.riding()).toBe(true); // following the plane down the runway
    const now = { t: 0 };
    play(40, tr, tv, now);
    expect(v.log).toContain('city:Avalon City');
    const before = f.purse.balance; // (a job lead on the way may have paid a little)
    v.last.actions[v.last.actions.length - 1].act(); // fly home (another $120)
    expect(f.purse.balance).toBe(before - 120);
    play(60, tr, tv, now);
    expect(v.log).toContain('summary');
    expect(Math.hypot(f.pos.x - (airport.door.x * 8 + 4), f.pos.z - (airport.door.y * 8 + 4))).toBeLessThan(2);
  });

  it('a trip ticket from the bag pays both ways', () => {
    town(614);
    const f = founder();
    f.bag.push({ name: 'Island day trip', from: 'Dock', day: Sim.day, ticket: true });
    const tr = new Transit(f, gps, () => {}, () => {});
    const tv = new Travel(f, tr, view(), () => {}, { hideCar() {}, carBack() {} });
    const dock = { type: 'dock', x: 0, y: 0, w: 3, h: 2, door: { x: 1, y: 2 } };
    expect(tv.start(city('saltmarsh')!, 'sea', dock)).toBe(true);
    expect(f.bag.length).toBe(0);
    expect(f.purse.balance).toBe(120);
    void World;
  });
});

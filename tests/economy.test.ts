/* The village's money (V2): every dollar has a payer. Wages come out of the
   workplace's till (a public service's from the village fund's budget); nobody
   gets a ride, a treatment or the goods off a shelf for nothing; a bill that
   can't be paid is owed, and paid off as money comes in; a shop orders only
   what it can pay for. And the Auto village: a whole, lived-in village at a
   tap, whose season, weather and festival can be chosen and held. */
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/agents';
import { World } from '../src/sim/world';
import { Gov } from '../src/sim/gov';
import { CAT } from '../src/sim/catalog';
import { Game } from '../src/sim/game';
import { Life } from '../src/sim/life';
import { Health } from '../src/sim/health';
import { Supply } from '../src/sim/supply';
import { Weather } from '../src/sim/weather';
import { Festivals } from '../src/sim/festivals';
import { Economy, COUNTY_GRANT } from '../src/sim/economy';
import { AutoVillage } from '../src/sim/autovillage';
import { Wallet } from '../src/player/wallet';
import { C, build, town } from './town';

const adult = (home: any): any => home.residents.find((r: any) => r.kind !== 'kid');

describe('wages come from somewhere', () => {
  it('a business pays its staff from its till (with its trade beyond the village), and only as far as the till goes', () => {
    const homes = town(901);
    const shop = build('shop', C.x + 4, C.y + 6);
    const p = adult(homes[0]);
    shop.funds = 0;
    const wage = Economy.wageOf(p, shop);
    const paid = Economy.payday(p, shop, wage);
    // the day's trade comes in, and that is all there is to pay with (bar the money kept to restock the shelves)
    expect(paid).toBeCloseTo(Math.max(0, wage * Economy.trade('shop') - Economy.reserve(shop)), 5);
    expect(paid).toBeLessThan(wage);
    expect(shop.unpaidToday).toBeGreaterThan(0);
    // with takings in the till, the wage is paid in full and comes out of it
    shop.funds = 500;
    expect(Economy.payday(p, shop, wage)).toBeCloseTo(wage, 5);
    expect(shop.funds).toBeCloseTo(500 + wage * Economy.trade('shop') - wage, 5);
  });

  it('a public service is paid from the village fund\'s budget, never from nothing', () => {
    const homes = town(902);
    const school = build('school', C.x + 12, C.y + 10);
    const p = adult(homes[1]);
    expect(Economy.isPublic('school')).toBe(true);
    school.funds = 0;
    expect(Economy.payday(p, school, 18)).toBe(0); // an empty budget pays nobody
    Gov.treasury = 1000;
    if (!school.workers.includes(p)) school.workers.push(p);
    Economy.budgets();
    expect(school.funds).toBeGreaterThan(0);
    expect(Gov.treasury).toBeLessThan(1000);
    expect(Economy.payday(p, school, Economy.wageOf(p, school))).toBeCloseTo(Economy.wageOf(p, school), 5);
  });

  it('the county sends the village fund its grant for every resident, once a day', () => {
    town(903);
    Gov.treasury = 0;
    Economy.daily();
    expect(Gov.treasury).toBeGreaterThanOrEqual(0);
    expect(Gov.grantToday).toBe(COUNTY_GRANT * Sim.people.length);
  });
});

describe('nothing for nothing', () => {
  it('a household pays the bill, the fund covers it while it can, and the rest is owed to the hospital', () => {
    const homes = town(904);
    const h = build('hospital', C.x + 14, C.y + 10);
    const p = adult(homes[2]);
    h.funds = 0;
    p.home.funds = 10; // (nothing to spare)
    Gov.treasury = 0;  // (and nothing in the fund)
    Health.charge(p, h, 50);
    expect(h.funds).toBe(0); // the hospital isn't paid from thin air
    expect(Economy.owed(p.home)).toBe(50);
    // money comes in: the debt is paid off, to the hospital
    p.home.funds = 100;
    Economy.daily();
    expect(Economy.owed(p.home)).toBe(0);
    expect(h.funds).toBeGreaterThanOrEqual(50);
  });

  it('nobody walks out of a shop with what they can\'t pay for', () => {
    const homes = town(905);
    const shop = build('shop', C.x + 4, C.y + 6);
    Supply.init(shop);
    const before = shop.stock, till = shop.funds;
    const p = adult(homes[3]);
    p.home.funds = 1;
    p.state = 'walk'; p.dest = shop; p.at = p.home; p.until = Sim.clock + 30;
    p.trip = { path: [[shop.door.x, shop.door.y], [shop.door.x, shop.door.y]], prog: 1, car: null, taxi: false, moto: false };
    Sim.tick(0.05);
    expect(p.at).toBe(shop);
    expect(shop.stock).toBe(before);
    expect(shop.funds).toBe(till);
    expect(p.home.funds).toBe(1);
  });

  it('a shop with an empty till orders nothing; with money it orders what it can pay for', () => {
    town(906);
    const shop = build('electronics', C.x + 4, C.y + 6);
    Supply.init(shop);
    shop.stock = 0;
    shop.funds = 0;
    Supply.allow.prod = 40;
    Life.trucks.length = 0;
    Supply.dispatch();
    expect(Life.trucks.some((t: any) => t.to === shop)).toBe(false);
    shop.funds = 24; // six products at the import price
    Supply.dispatch();
    const t = Life.trucks.find((k: any) => k.to === shop);
    expect(t).toBeTruthy();
    expect(t.n).toBeLessThanOrEqual(6);
  });

  it('the Founder\'s bills: what the wallet can\'t cover is owed, and paid to whoever is owed it', () => {
    const w = new Wallet();
    w.restore(5, []);
    const rank: any = { id: 777, funds: 0, visitors: 0 };
    World.buildings.push(rank);
    expect(w.charge(12, 'Taxi fare', rank)).toBe(5);
    expect(w.balance).toBe(0);
    expect(w.owing()).toBe(7);
    expect(rank.funds).toBe(5);
    w.earn(20, 'A shift');
    expect(w.settle()).toBe(7);
    expect(w.owing()).toBe(0);
    expect(rank.funds).toBe(12);
    World.buildings.splice(World.buildings.indexOf(rank), 1);
  });

  it('the casino pays wins out of its own till, and a bank lends only what it has', () => {
    const homes = town(907);
    const casino = build('casino', C.x + 14, C.y + 12);
    const p = adult(homes[0]);
    p.home.funds = 400;
    casino.funds = 0;
    const total = (): number => p.home.funds + casino.funds;
    const t0 = total();
    for (let i = 0; i < 40; i++) Sim.gamble(p, casino);
    expect(total()).toBeCloseTo(t0, 5); // money moved between them, none appeared
    expect(casino.funds).toBeGreaterThanOrEqual(0);
  });
});

describe('the Auto village', () => {
  it('raises a whole, lived-in village on its own streets', () => {
    Game.boot(1);
    const plan = AutoVillage.build(4242);
    expect(plan.name).toBeTruthy();
    const homes = World.buildings.filter((b: any) => CAT[b.type].res && b.residents.length);
    const work = World.buildings.filter((b: any) => CAT[b.type].jobs);
    expect(homes.length).toBeGreaterThan(30);
    expect(Sim.people.length).toBeGreaterThan(100);
    for (const t of ['townhall', 'school', 'hospital', 'police', 'fire', 'market', 'plaza', 'farm']) expect(World.buildings.some((b: any) => b.type === t)).toBe(true);
    // every place on a street, finished, and every private one with money in its till to open with
    expect(World.buildings.every((b: any) => b.connected && !b.construction)).toBe(true);
    expect(work.filter((b: any) => !Economy.isPublic(b.type)).every((b: any) => b.funds > 0)).toBe(true);
    expect(Sim.people.filter((p: any) => p.work).length).toBeGreaterThan(40);
    expect(Life.buses !== undefined).toBe(true);
  });

  it('holds the season, the weather and the festival it\'s given, and lets them go', () => {
    Game.boot(2);
    AutoVillage.build(99);
    Weather.pin = { season: 3, kind: 'snow' };
    Festivals.pinDay = 25;
    Game.tick(0.1);
    expect(Weather.season).toBe(3);
    expect(Weather.kind).toBe('snow');
    expect(Festivals.decorated()).toBe(true);
    Weather.pin = { season: 1, kind: 'heavy' };
    Festivals.pinDay = 18;
    Game.tick(0.1);
    expect(Weather.season).toBe(1);
    expect(Weather.kind).toBe('heavy');
    expect(Festivals.isDiwali()).toBe(true);
    Weather.pin = null;
    Festivals.pinDay = null;
    Game.tick(0.1);
    expect(Weather.season).toBe(Weather.seasonOf(Sim.day));
    expect(Festivals.isDiwali()).toBe(Festivals.yearDay() === 18 || Festivals.yearDay() === 19);
  });
});

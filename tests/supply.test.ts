/* The supply chain (Milestone 4d): a building site that runs out of materials
   stands idle until a delivery truck brings a load; shops sell from their
   shelves (dearer when thin, nothing when bare); producers fill their yards on
   shift and not in a blackout; imports come in from the map edge within the
   day's allowance; the freight train stocks the station; saves keep it all. */
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { Sim } from '../src/sim/agents';
import { Life } from '../src/sim/life';
import { World } from '../src/sim/world';
import { Power } from '../src/sim/power';
import { LOAD, SELLS, Supply } from '../src/sim/supply';
import { C, build, run, town, until } from './town';

describe('the supply chain', () => {
  it('a site with no materials stalls, and resumes when a truck brings a load', () => {
    town(401);
    const site = build('office', C.x + 10, C.y + 8, false);
    expect(site.construction).toBeGreaterThan(0);
    Supply.initSite(site);
    site.mats = 0;
    Supply.allow.mats = 0; // nothing more from off the map today, nothing made in town
    const left = site.construction;
    run(30);
    expect(site.stalled).toBe(true);
    expect(site.construction).toBe(left);
    expect(Supply.report().stalled).toBeGreaterThan(0);
    // a sawmill on the same streets with a full yard
    const mill = build('sawmill', C.x + 4, C.y - 10);
    mill.stock = 60;
    expect(until(() => Life.trucks.some((t: any) => t.to === site && t.from === mill), 40)).toBe(true);
    const truck = Life.trucks.find((t: any) => t.to === site);
    expect(truck.g).toBe('mats');
    expect(truck.n).toBeLessThanOrEqual(LOAD);
    expect(mill.stock).toBeLessThan(60);
    expect(until(() => !site.stalled, 300)).toBe(true);
    expect(site.construction).toBeLessThan(left);
  });

  it('crumbs left on a stalled site don\'t restart it; a real load does', () => {
    town(407);
    const site = build('office', C.x + 10, C.y + 8, false);
    Supply.initSite(site);
    site.mats = 0;
    expect(Supply.build(site, 1)).toBe(0);
    expect(site.stalled).toBe(true);
    site.mats = 0.0004;
    expect(Supply.build(site, 0.001)).toBe(0);
    expect(site.stalled).toBe(true);
    site.mats = 5;
    expect(Supply.build(site, 1)).toBe(1);
    expect(site.stalled).toBe(false);
  });

  it('shops sell from their shelves: dearer when thin, nothing when bare', () => {
    town(402);
    const shop = build('shop', C.x + 4, C.y + 6);
    Supply.init(shop);
    const cap = SELLS.shop.cap;
    expect(shop.stock).toBe(Math.round(cap * 0.6));
    expect(Supply.sale(shop)).toBe(1);
    shop.stock = 3;
    const m = Supply.sale(shop)!;
    expect(m).toBeGreaterThan(1.2);
    expect(shop.stock).toBe(2);
    shop.stock = 0;
    const p = Sim.people[0];
    const mood = p.mood;
    expect(Supply.sale(shop, p)).toBeNull();
    expect(p.mood).toBeLessThan(mood);
    expect(Supply.shelf(shop)!.empty).toBe(true);
  });

  it('producers fill their yards while staffed, and stop in a blackout', () => {
    town(403, 8);
    const farm = build('farm', C.x + 6, C.y + 14);
    Supply.init(farm);
    farm.stock = 0;
    const crew = Sim.people.filter((p: any) => p.kind !== 'kid').slice(0, 3);
    for (const p of crew) { if (p.work) p.work.workers = p.work.workers.filter((q: any) => q !== p); p.work = farm; farm.workers.push(p); p.state = 'in'; p.at = farm; }
    Sim.clock = 600;
    Supply.produce(60);
    expect(farm.stock).toBeGreaterThan(3);
    const before = farm.stock;
    Power.fault(Power.districtOfB(farm), 'a test');
    Supply.produce(60);
    expect(farm.stock).toBe(before);
  });

  it('what the town cannot make comes in from the map edge, within the allowance', () => {
    town(404);
    const shop = build('electronics', C.x + 4, C.y + 6);
    Supply.init(shop);
    shop.stock = 0;
    shop.funds = 200; // (V2: a shop pays for what it orders)
    Supply.allow.prod = 20;
    Supply.dispatch();
    const t = Life.trucks.find((k: any) => k.to === shop);
    expect(t).toBeTruthy();
    expect(t.kind).toBe('import');
    expect(t.from).toBeNull();
    expect(Supply.allow.prod).toBeLessThan(20);
    expect(until(() => shop.stock > 0, 600)).toBe(true);
    // the allowance spent, a bare shop waits
    shop.stock = 0;
    Supply.allow.prod = 0;
    Life.trucks.length = 0;
    Supply.dispatch();
    expect(Life.trucks.some((k: any) => k.to === shop)).toBe(false);
  });

  it('the freight train stocks the station, and the station supplies the shops', () => {
    town(405);
    const st = build('trainstation', C.x + 16, C.y - 8);
    st.funds = 200; // (V2: the station buys the freight it sells on)
    Supply.freightCall(st);
    expect(Supply.storeUsed(st)).toBeGreaterThan(0);
    const shop = build('toyshop', C.x + 4, C.y + 6);
    Supply.init(shop);
    shop.stock = 0;
    const src = Supply.source('prod', shop, 10);
    expect(src).toBe(st);
  });

  it('stock, stores and a site\'s materials survive a save and load', () => {
    town(406);
    const shop = build('shop', C.x + 4, C.y + 6);
    Supply.init(shop);
    shop.stock = 7;
    const site = build('office', C.x + 10, C.y + 8, false);
    Supply.initSite(site);
    site.mats = 3.5;
    const s = Game.buildSaveString();
    expect(Game.performLoad(s).ok).toBe(true);
    const s2 = World.buildings.find((b: any) => b.id === shop.id);
    const site2 = World.buildings.find((b: any) => b.id === site.id);
    expect(s2.stock).toBe(7);
    expect(site2.mats).toBe(3.5);
    expect(site2.matsNeed).toBe(site.matsNeed);
  });
});

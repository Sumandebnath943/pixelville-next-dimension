/* Power & blackouts (Milestone 4b): demand against capacity, rolling blackouts
   (the hospital's district last) that lift when a plant comes online; a storm
   fault darkens a district, kills its traffic lights and shuts its shops; a
   repair crew drives out and restores it; lightning can cause it; saves keep it. */
import { describe, expect, it, vi } from 'vitest';
import { Game } from '../src/sim/game';
import { Sim } from '../src/sim/agents';
import { Life } from '../src/sim/life';
import { World } from '../src/sim/world';
import { Weather } from '../src/sim/weather';
import { COUNTY_CAP, Power } from '../src/sim/power';
import { C, build, town, until } from './town';

describe('the power grid', () => {
  it('a small village runs on the county line with nothing dark', () => {
    town(201, 4);
    Power.balance();
    expect(Power.capacity).toBe(COUNTY_CAP);
    expect(Power.demand).toBeGreaterThan(0);
    expect(Power.demand).toBeLessThan(Power.capacity);
    expect(Power.report().dark).toBe(0);
  });

  it('overload brings rolling blackouts, sparing the hospital, until a plant comes online', () => {
    town(202, 4);
    const far = build('skyscraper', C.x + 40, C.y + 40); // a second district, hungry for power
    const h = build('hospital', C.x + 8, C.y + 8);
    for (let i = 0; i < 4; i++) build('skyscraper', C.x - 40 + i * 6, C.y - 36);
    Sim.clock = 720;
    Power.balance();
    expect(Power.overloaded).toBe(true);
    expect(Power.shed.size).toBeGreaterThan(0);
    expect(Power.shed.has(Power.districtOfB(h))).toBe(false);
    expect(Power.isDark(h)).toBe(false); // its own generator, whatever happens
    expect(Power.dark.some((v) => v === 1)).toBe(true);
    void far;
    // a power plant (staffed or not) brings enough
    build('powerplant', C.x - 20, C.y + 20);
    build('powerplant', C.x - 26, C.y + 26);
    Power.balance();
    expect(Power.overloaded).toBe(false);
    expect(Power.shed.size).toBe(0);
    expect(Power.report().dark).toBe(0);
  });

  it('a storm fault darkens the district, its lights stop governing traffic, a crew restores it', () => {
    const homes = town(203);
    const shop = build('shop', C.x + 4, C.y + 6);
    build('powerplant', C.x + 8, C.y - 8); // on the homes' own streets
    const d = Power.districtOfB(homes[0]);
    // a signalled junction tile in the district (the starter map may not have one of its own)
    const r = World.nearestRoad(homes[0].door.x, homes[0].door.y, 6);
    const key = World.idx(r.x, r.y);
    World.signals.add(key);
    Power.refreshDark();
    expect(World.signalOn(key)).toBe(true);
    expect(Power.fault(d, 'a falling tree brought the lines down')).toBe(true);
    expect(Power.tileDark(r.x, r.y)).toBe(true);
    expect(World.signalOn(key)).toBe(false);
    expect(World.darkZone.has(key)).toBe(true);
    if (shop && Power.districtOfB(shop) === d) expect(Power.closed(shop)).toBe(true);
    expect(Life.crews.length).toBe(1);
    expect(Life.crews[0].county).toBe(false);
    // the van drives out, works on the lines, the lights come back
    expect(until(() => !Power.faults.has(d), 600)).toBe(true);
    expect(Power.tileDark(r.x, r.y)).toBe(false);
    expect(World.signalOn(key)).toBe(true);
    expect(until(() => Life.crews.length === 0, 400)).toBe(true);
  });

  it('with no power plant, the county sends a crew from the highway, later', () => {
    const homes = town(204);
    const d = Power.districtOfB(homes[0]);
    Power.fault(d, 'ice brought the lines down');
    const c = Life.crews[0];
    expect(c).toBeTruthy();
    expect(c.county).toBe(true);
    expect(c.phase).toBe('wait');
    expect(until(() => c.phase !== 'wait', 120)).toBe(true);
  });

  it('a lightning flash can strike a substation', () => {
    town(205);
    Power.flashArmed = true;
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.01);
    Weather.flash = 0.55;
    Power.storms(0.01);
    spy.mockRestore();
    Weather.flash = 0;
    expect(Power.faults.size).toBe(1);
    expect([...Power.faults.values()][0].cause).toMatch(/lightning/);
  });

  it('a fault survives a save and load, and its crew is sent again', () => {
    const homes = town(206);
    build('powerplant', C.x - 24, C.y - 10);
    const d = Power.districtOfB(homes[0]);
    Power.fault(d, 'lightning struck a substation');
    const s = Game.buildSaveString();
    expect(Game.performLoad(s).ok).toBe(true);
    expect(Power.faults.has(d)).toBe(true);
    expect(Power.dark[d]).toBe(1);
    Game.streetMode = false; Game.setSpeed(4); Game.tick(0.1);
    expect(Life.crews.some((c: any) => c.d === d)).toBe(true);
  });
});

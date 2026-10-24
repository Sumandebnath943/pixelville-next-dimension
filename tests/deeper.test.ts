/* Milestone 4's "done when", end to end in the simulation: a storm blacks out
   a district, a crash at a junction whose lights went dark sends a villager to
   hospital by ambulance, and a materials shortage stalls a construction site. */
import { describe, expect, it, vi } from 'vitest';
import { Sim } from '../src/sim/agents';
import { Life } from '../src/sim/life';
import { World } from '../src/sim/world';
import { Weather } from '../src/sim/weather';
import { Power } from '../src/sim/power';
import { Health } from '../src/sim/health';
import { Supply } from '../src/sim/supply';
import { C, build, run, town, until } from './town';

describe('a deeper village', () => {
  it('storm → blackout → crash at a dark junction → ambulance → hospital', () => {
    const homes = town(501, 8);
    const h = build('hospital', C.x + 8, C.y + 10);
    build('powerplant', C.x + 8, C.y - 8);
    const d = Power.districtOfB(homes[0]);
    // the junction by the first house has traffic lights
    const r = World.nearestRoad(homes[0].door.x, homes[0].door.y, 6);
    const key = World.idx(r.x, r.y);
    World.signals.add(key);
    // a thunderstorm: lightning strikes the district's substation
    Weather.kind = 'heavy'; Weather.intensity = 1;
    const built = Power.builtDistricts;
    Power.builtDistricts = () => [d];
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.05);
    Weather.flash = 0.55; Power.flashArmed = true;
    Power.storms(0.01);
    rnd.mockRestore();
    Power.builtDistricts = built;
    Weather.flash = 0;
    expect(Power.faults.has(d)).toBe(true);
    expect(World.signalOn(key)).toBe(false);
    // two villagers drive into the dark junction from crossing directions
    const [a, b] = Sim.people.filter((p: any) => p.kind !== 'kid' && p.home.cars.length);
    for (const [p, dx, dy] of [[a, 1, 0], [b, 0, 1]] as [any, number, number][]) {
      const car = p.home.cars[0];
      car.free = false;
      p.state = 'walk'; p.trip = { path: [[r.x, r.y], [r.x + dx, r.y + dy]], prog: 0, car }; p.dest = h;
      p.x = r.x * 16 + 8 + dx * 4; p.y = r.y * 16 + 8 + dy * 4; p.dirx = dx; p.diry = dy;
    }
    // (the dice: drivers misjudge each other, and the knocks are hard ones)
    const rnd2 = vi.spyOn(Math, 'random').mockReturnValueOnce(0.1).mockReturnValue(0.55);
    Life.crash = null; Life.darkT = 1;
    Life.tickIncidents(0.01);
    rnd2.mockRestore();
    expect(Life.crash).toBeTruthy();
    expect(Life.crash.dark).toBe(true);
    const hurt = [a, b].filter((p) => p.state === 'hurt');
    expect(hurt.length).toBeGreaterThan(0);
    const victim = hurt[0];
    expect(Life.ambulances.some((u: any) => u.patient === victim && u.from === h)).toBe(true);
    expect(until(() => !!victim.ward, 400)).toBe(true);
    expect(victim.at).toBe(h);
    expect(Health.patients(h)).toContain(victim);
  });

  it('a materials shortage stalls a building site in plain sight', () => {
    town(502, 4);
    // a building boom with nothing made in town and the day's imports spent
    const sites = [build('skyscraper', C.x + 14, C.y + 12, false), build('apartment', C.x - 10, C.y + 10, false)].filter(Boolean);
    Supply.allow.mats = 0;
    for (const s of sites) { Supply.initSite(s); s.mats = 0.5; }
    run(120);
    for (const s of sites) expect(s.stalled).toBe(true);
    expect(Supply.wanting.has('mats')).toBe(true);
    expect(Supply.report().stalled).toBe(sites.length);
  });
});

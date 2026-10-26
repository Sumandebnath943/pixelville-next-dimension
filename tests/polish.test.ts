/* Milestone 8 (the owner's polish list): people keep to the pavement and don't walk as one body; the timetable
   (last bus and train at 23:30, flights round the clock); villagers ticketed for the wrong side of the road;
   vehicles that run into people hurt (never kill) villagers; the big peak and its trail; the great tree's year,
   Rockefeller-style, and its lighting hours. */
import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { Sim } from '../src/sim/agents';
import { Life, LAST_TRAIN } from '../src/sim/life';
import { Gov } from '../src/sim/gov';
import { Traffic, FOOT_PX, LANE, PAVEMENT_M } from '../src/sim/traffic';
import { Walk } from '../src/sim/walking';
import { Festivals } from '../src/sim/festivals';
import { PEAK_R, peakHeight, peakTrail } from '../src/sim/peak';
import { FLIGHTS } from '../src/player/travel';
import { C, build, run, town } from './town';

const T = 16;
const line = (x0: number, y0: number, dx: number, dy: number, n: number): number[][] => Array.from({ length: n }, (_, i) => [x0 + dx * i, y0 + dy * i]);

describe('Milestone 8 polish', () => {
  it('a walker keeps to the pavement along a street and rounds a corner on the kerb, never down the middle', () => {
    World.roadMap.fill(0);
    // an L: east along y = 10, then north up x = 20
    const path = [...line(10, 10, 1, 0, 11), ...line(20, 9, 0, -1, 8)];
    for (const [x, y] of path) World.roadMap[World.idx(x, y)] = 1;
    World.roadStamp++;
    Traffic.reset();
    const p: any = { seed: 7, x: 0, y: 0 };
    const t: any = { path, prog: 0 };
    Walk.plan(p, t, { x: 10, y: 11, w: 1, h: 1 }, { x: 21, y: 4, w: 1, h: 1 }); // from a door on the south side
    let minOff = Infinity, crossings = 0, wasCrossing = false;
    for (let i = 0; i < 2000 && t.prog < path.length - 1; i++) {
      Traffic.begin([], {});
      t.prog += Walk.step(p, t, 0.05, 0.3);
      Walk.pose(p, t);
      const crossing = t.walk.lat !== null;
      if (crossing && !wasCrossing) crossings++;
      wasCrossing = crossing;
      if (crossing) continue;
      // distance from the road's centreline (the nearest tile centre's axis)
      const tx = Math.floor(p.x / T), ty = Math.floor(p.y / T);
      const off = Math.min(Math.abs(p.x - (tx * T + 8)), Math.abs(p.y - (ty * T + 8)));
      if (World.isRoad(tx, ty) && !(World.isRoad(tx - 1, ty) && World.isRoad(tx, ty - 1))) minOff = Math.min(minOff, Math.max(Math.abs(p.x - (tx * T + 8)), Math.abs(p.y - (ty * T + 8))));
      void off;
    }
    expect(t.prog).toBeGreaterThanOrEqual(path.length - 1 - 0.02);
    // on the pavement: well clear of the carriageway's lanes
    expect(minOff).toBeGreaterThan((8 - PAVEMENT_M * 2) - 0.5);
    // the door at the end is on the far side: it crosses the road (once at the turn, or at the end), not at every corner
    expect(crossings).toBeLessThanOrEqual(2);
    expect(Math.abs(FOOT_PX)).toBeGreaterThan(6);
  });

  it('a family leaving together walks as a group, not one body', () => {
    town(811);
    const h = World.buildings.find((b: any) => b.residents?.length >= 2);
    expect(h).toBeTruthy();
    const [a, b] = h.residents;
    const dest = World.buildings.find((o: any) => o !== h && o.type === 'house');
    for (const q of [a, b]) { q.state = 'in'; q.at = h; Sim.startTrip(q, dest, 1e9, null); q.trip.car = null; q.trip.taxi = false; q.trip.moto = false; delete q.trip.joined; }
    let apart = 0, both = 0;
    for (let i = 0; i < 400; i++) {
      Traffic.begin(Sim.people, Life);
      for (const q of [a, b]) if (q.state === 'walk') Sim.tickPerson(q, 0.05);
      if (a.state === 'walk' && b.state === 'walk') { both++; if (Math.hypot(a.x - b.x, a.y - b.y) > 0.8) apart++; }
    }
    expect(both).toBeGreaterThan(10);
    expect(apart / both).toBeGreaterThan(0.6); // side by side or one behind the other, not stacked
  });

  it('the last bus and the last train leave at 23:30; flights run round the clock', () => {
    expect(LAST_TRAIN).toBe(23 * 60 + 30);
    Sim.clock = 2 * 60;
    expect(Life.transitHours()).toBe(false);
    expect(Life.serviceWindow('local')).toBe(false);
    expect(Life.serviceWindow('express')).toBe(false);
    expect(Life.serviceWindow('nightliner')).toBe(false);
    expect(Life.serviceWindow('freight')).toBe(true); // goods run at night
    Sim.clock = 8 * 60;
    expect(Life.transitHours()).toBe(true);
    // flights at least every three hours, day and night
    expect(FLIGHTS.some((f) => f < 6 * 60)).toBe(true);
    for (let i = 1; i < FLIGHTS.length; i++) expect(FLIGHTS[i] - FLIGHTS[i - 1]).toBeLessThanOrEqual(180);
  });

  it('a villager who drives on the wrong side is ticketed: the household pays the village fund', () => {
    town(812);
    const p = Sim.people.find((q: any) => q.kind !== 'kid');
    const path = line(C.x - 10, C.y - 30, 1, 0, 20);
    for (const [x, y] of path) World.roadMap[World.idx(x, y)] = 1;
    p.state = 'walk';
    p.trip = { path, prog: 5, car: { seed: 1 }, lat: -LANE, v: 1 };
    p.home.funds = 100;
    const fund = Gov.treasury;
    for (let i = 0; i < 120; i++) Sim.roadRules(p, p.trip, 0.05);
    expect(p.trip.ticketed).toBe(true);
    expect(p.home.funds).toBeLessThan(100);
    expect(Gov.treasury).toBeGreaterThan(fund);
  });

  it('a vehicle that runs into someone hurts them, by its speed and size, but never kills a villager', () => {
    town(813);
    const p = Sim.people.find((q: any) => q.kind !== 'kid');
    p.state = 'walk';
    p.trip = { path: [[1, 1], [2, 1]], prog: 0 };
    Life.vehicleHitPerson(Life.buses[0] || {}, p, 22, 1.6); // a bus at 80 km/h
    expect(p.knocked || p.state === 'hurt').toBe(true);
    expect(Sim.people).toContain(p);
    expect(p.cond?.sev ?? 0).toBeGreaterThan(30);
    expect(p.cond.sev).toBeLessThan(100);
  });

  it('the peak: a mountain on open land with a trail gentle enough to walk and ride, removable as a whole', () => {
    town(814);
    const before = World.peaks.length; // (a new map comes with one already)
    const spot = World.findPeakSpot();
    expect(spot).toBeTruthy();
    const pk = World.placePeak(spot.x, spot.y, 5);
    expect(pk).toBeTruthy();
    expect(World.ground[World.idx(spot.x, spot.y)]).toBe(2); // rock: nothing is built on a mountainside
    const cx = (pk.x + 0.5) * 8, cz = (pk.y + 0.5) * 8;
    expect(peakHeight(pk, cx, cz)).toBeGreaterThan(100);
    expect(peakHeight(pk, cx + (PEAK_R + 1) * 8, cz)).toBe(0);
    const trail = peakTrail(pk);
    let worst = 0;
    for (let i = 1; i < trail.length; i++) {
      const [ax, az] = trail[i - 1], [bx, bz] = trail[i];
      const run2 = Math.hypot(bx - ax, bz - az);
      if (run2 < 1) continue;
      worst = Math.max(worst, Math.abs(peakHeight(pk, bx, bz) - peakHeight(pk, ax, az)) / run2);
    }
    expect(worst).toBeLessThan(0.35); // switchbacks keep it climbable (about one in six, a little steeper over a ridge)
    expect(World.bulldoze(spot.x, spot.y)?.kind).toBe('mountain');
    expect(World.peaks.length).toBe(before);
  });

  it("the great tree's year: scouting, cut, haul, raise, decorate, the lighting, then lit 05:00–midnight", () => {
    town(815, 8);
    Festivals.tree = null;
    const at = (day: number, clock: number): void => { Sim.day = day; Sim.clock = clock; Festivals.tickTree(1); };
    at(15, 600);
    expect(Festivals.tree.phase).toBe('scouting');
    at(16, 600);
    expect(Festivals.tree.chosen).toBe(true);
    at(17, 560);
    expect(Festivals.tree.phase).toBe('cutting');
    for (let i = 0; i < 260; i++) at(17, 560 + i);
    expect(Festivals.tree.phase).toBe('loaded');
    at(18, 605);
    expect(['hauling', 'arrived']).toContain(Festivals.tree.phase);
    for (let i = 0; i < 400 && Festivals.tree.phase === 'hauling'; i++) Festivals.tickTree(10);
    expect(Festivals.tree.phase).toBe('arrived');
    at(19, 610);
    expect(Festivals.tree.phase).toBe('raising');
    for (let i = 0; i < 130; i++) at(19, 610 + i);
    expect(Festivals.tree.phase).toBe('decorating');
    at(21, 670);
    expect(Festivals.tree.star).toBe(true);
    at(22, 1250);
    expect(Festivals.tree.phase).toBe('ceremony');
    at(22, 1312);
    expect(Festivals.tree.phase).toBe('lit');
    Sim.day = 23; Sim.clock = 2 * 60;
    expect(Festivals.treeLightsOn()).toBe(false); // off from midnight to 05:00
    Sim.clock = 6 * 60;
    expect(Festivals.treeLightsOn()).toBe(true);
    Sim.day = 24; Sim.clock = 3 * 60;
    expect(Festivals.treeLightsOn()).toBe(true); // all night on Christmas Eve
    Sim.day = 28; Sim.clock = 21 * 60 + 30;
    expect(Festivals.treeLightsOn()).toBe(false); // New Year's Eve: till 21:00
    // down on the second day of the new year
    Sim.day = 30; Sim.clock = 600;
    Festivals.tickTree(1);
    expect(Festivals.tree).toBeNull();
    void build; void run;
  });
});

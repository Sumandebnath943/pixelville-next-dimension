/* V2: the jams that locked busy towns solid (introduced with "nothing passes through anything"): people standing on
   the pavement held the drivers beside them for as long as they stood; a car held for someone on foot in the other
   lane waited for good; queues at the stops and crowds at incidents stood in the lanes; a casualty lay in the road
   while the ambulance sat in the queue behind; and nothing ever let a gridlock go. */
import { beforeEach, describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { Sim, GIVE_UP_AFTER } from '../src/sim/agents';
import { Life } from '../src/sim/life';
import { Health } from '../src/sim/health';
import { Traffic, FOOT_PX, LANE_PX, lanePose } from '../src/sim/traffic';
import { C, build, roadPx, town } from './town';

const T = 16;
const DT = 0.05;
const line = (x0: number, y0: number, dx: number, dy: number, n: number): number[][] => Array.from({ length: n }, (_, i) => [x0 + dx * i, y0 + dy * i]);
function rider(path: number[][], prog: number): any {
  const p: any = { state: 'walk', trip: { path, prog, car: {} }, x: 0, y: 0, dirx: 1, diry: 0 };
  place(p);
  return p;
}
function place(p: any): void {
  const pose = lanePose(p.trip.path, p.trip.prog, Traffic.lanePx(p.trip));
  p.x = pose.x; p.y = pose.y; p.dirx = pose.dx; p.diry = pose.dy;
}
function drive(all: any[], car: any, seconds: number, life: any, each?: () => void): void {
  for (let s = 0; s < seconds / DT; s++) {
    Traffic.begin(all, life);
    const t = car.trip;
    if (t.prog < t.path.length - 1) t.prog = Math.min(t.path.length - 1, t.prog + Traffic.advance(car, t, t.path, t.prog, 1, 1.6, DT));
    place(car);
    each?.();
  }
}

describe('traffic that keeps moving', () => {
  beforeEach(() => {
    World.roadMap.fill(0);
    World.signals.clear();
    Traffic.reset();
  });

  it('someone standing on the pavement never holds the traffic; someone standing in the lane is passed', () => {
    const road = line(10, 10, 1, 0, 24);
    for (const [x, y] of road) World.roadMap[World.idx(x, y)] = 1;
    // (east-bound: the near pavement is to the south)
    const kerb = { x: 16 * T + 8, y: 10 * T + 8 + FOOT_PX, f: 1 }, lane = { x: 20 * T + 8, y: 10 * T + 8 + LANE_PX, f: 1 };
    const passTime = (life: any): number => {
      const car = rider(road, 0);
      let t = 0, at = -1;
      drive([car], car, 30, life, () => { t += DT; if (at < 0 && car.x > kerb.x + 16) at = t; });
      expect(car.trip.prog).toBe(road.length - 1);
      return at;
    };
    const clear = passTime({});
    expect(passTime({ gawkers: [kerb] })).toBeLessThan(clear + 0.2); // straight past, as if nobody were there
    const car2 = rider(road, 0);
    let closest = Infinity;
    drive([car2], car2, 40, { gawkers: [lane] }, () => { closest = Math.min(closest, Math.hypot(car2.x - lane.x, car2.y - lane.y)); });
    expect(car2.trip.prog).toBe(road.length - 1); // round them
    expect(closest).toBeGreaterThan(2); // and never through them
  });

  it('trucks sent from one yard at once, stacked on one spot, all get away across the avenue', () => {
    // an east-west avenue (rows 10 and 11); the yard's gate on the north row, the way out along the south one
    for (let x = 6; x <= 30; x++) for (const y of [10, 11]) World.roadMap[World.idx(x, y)] = 1;
    World.roadStamp++;
    const path = [[12, 10], [12, 11], ...line(13, 11, 1, 0, 15)];
    const trucks = Array.from({ length: 5 }, () => ({ phase: 'go', path, prog: 0, x: 0, y: 0, dirx: 1, diry: 0 } as any));
    const pose = (k: any): void => { const p = lanePose(k.path, k.prog, Traffic.lanePx(k)); Object.assign(k, { x: p.x, y: p.y, dirx: p.dx, diry: p.dy }); };
    trucks.forEach(pose);
    const life = { trucks, trainNearTile: () => false };
    for (let s = 0; s < 60 / DT; s++) {
      Traffic.begin([], life);
      for (const k of trucks) if (k.prog < path.length - 1) { k.prog = Math.min(path.length - 1, k.prog + Traffic.advance(k, k, k.path, k.prog, 1, 1.3, DT, 0.9)); pose(k); }
    }
    expect(trucks.every((k) => k.prog > 5)).toBe(true); // (they used to wait on each other for good)
  });

  it('held by someone on foot out in the other lane, a driver waits a few seconds, then edges past', () => {
    const road = line(10, 10, 1, 0, 24);
    for (const [x, y] of road) World.roadMap[World.idx(x, y)] = 1;
    // (someone on foot, out in the west-bound lane, not moving)
    const walker: any = { state: 'walk', trip: { path: [[18, 10], [18, 11]], prog: 0, car: null }, x: 18 * T + 8, y: 10 * T + 8 - LANE_PX, dirx: 0, diry: 1 };
    const car = rider(road, 0);
    let held = 0, closest = Infinity;
    drive([car, walker], car, 40, {}, () => {
      if ((car.trip.v || 0) < 0.05 && car.trip.prog < 8) held += DT;
      closest = Math.min(closest, Math.hypot(car.x - walker.x, car.y - walker.y));
    });
    expect(held).toBeGreaterThan(2); // they did wait for them
    expect(car.trip.prog).toBe(road.length - 1); // and didn't wait for ever
    expect(closest).toBeGreaterThan(3); // never touching them
  });
});

describe('the people who stood in the road', () => {
  it('queues at a stop and crowds at an incident stand on the pavement in front of their building', () => {
    town(951);
    const stop = build('busstop', C.x + 6, C.y + 6);
    const d = stop.door, cx = d.x * T + 8, cy = d.y * T + 8;
    const u = d.y >= stop.y + stop.h ? [0, -1] : d.y < stop.y ? [0, 1] : d.x >= stop.x + stop.w ? [-1, 0] : [1, 0];
    for (let i = 0; i < 14; i++) {
      const s = Life.queueSpot(stop, i);
      expect((s.x - cx) * u[0] + (s.y - cy) * u[1]).toBeGreaterThanOrEqual(FOOT_PX - 0.01); // out of the lanes, at the shelter
      expect(Math.abs((s.x - cx) * -u[1] + (s.y - cy) * u[0])).toBeLessThan(8); // in front of it, not along into a junction
    }
    for (const s of Life.crowdSpots(cx, cy, 40)) {
      const h = World.buildings.find((b: any) => b.id === s.id)!;
      expect(Math.hypot(s.x - (h.door.x * T + 8), s.y - (h.door.y * T + 8))).toBeCloseTo(FOOT_PX, 3);
    }
  });

  it('a casualty the ambulance can\'t get to is helped home by the neighbours after two hours', () => {
    const homes = town(952);
    build('hospital', C.x + 14, C.y + 10);
    const p = homes[0].residents.find((r: any) => r.kind !== 'kid');
    expect(Health.injure(p, 60, 'in a test', roadPx(homes[0]))).toBe(true);
    expect(p.state).toBe('hurt');
    p.downT = 125; // (two hours down, the ambulance still stuck somewhere behind)
    Health.tickT = 10;
    Health.tick(0);
    expect(p.state).not.toBe('hurt');
    expect(p.at).toBe(p.home);
  });

  it('a car that can\'t move for a couple of hours is left, and its driver walks on', () => {
    const homes = town(953);
    const shop = build('market', C.x + 16, C.y + 8);
    const p = adult(homes[1]);
    const car = homes[1].cars[0] || { free: true, seed: 1 };
    car.free = false;
    const a = World.nearestRoad(p.home.door.x, p.home.door.y, 3), b = World.nearestRoad(shop.door.x, shop.door.y, 3);
    const path = World.roadPath(a.x, a.y, b.x, b.y);
    expect(path && path.length > 6).toBe(true);
    p.state = 'walk'; p.at = p.home; p.dest = shop; p.until = Sim.clock + 60;
    p.trip = { path, prog: 2, car, taxi: false, moto: false, joined: true };
    // a wreck across both lanes just ahead (nothing gets past it)
    const at = lanePose(path, 3.2, 0);
    Life.crash = { x: at.x, y: at.y, a1: 0, a2: 0, founder: false, parts: [-1, 1].map((s) => ({ x: at.x - at.dy * s * 3, y: at.y + at.dx * s * 3, hx: -at.dy, hy: at.dx })), t: 1e9 };
    for (let i = 0; i < (GIVE_UP_AFTER + 10) / DT; i++) Sim.tick(DT);
    expect(p.trip?.car ?? null).toBe(null); // on foot now (or already there)
    expect(car.free).toBe(true); // the car is fetched home
  });
});

function adult(home: any): any {
  return home.residents.find((r: any) => r.kind !== 'kid');
}

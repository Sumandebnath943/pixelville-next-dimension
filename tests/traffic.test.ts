/* Traffic (V2): drivers keep their distance, stop for people on the
   carriageway, and take turns at junctions without gridlock. */
import { beforeEach, describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { Traffic, CAR_LEN } from '../src/sim/traffic';

const T = 16;
const DT = 0.05;

/** a road user on a tile path, positioned the way the sim does it (lane 3.5 px right of centre) */
function rider(path: number[][], prog: number, car = true): any {
  const p: any = { state: 'walk', trip: { path, prog, car: car ? {} : null }, x: 0, y: 0, dirx: 1, diry: 0 };
  place(p);
  return p;
}
function place(p: any): void {
  const t = p.trip, path = t.path;
  const i = Math.min(Math.floor(t.prog), path.length - 2), f = t.prog - i;
  const [ax, ay] = path[i], [bx, by] = path[i + 1];
  const dx = bx - ax, dy = by - ay;
  const off = t.car ? Traffic.lanePx(t) : 0;
  p.x = (ax + dx * f) * T + 8 + (dy !== 0 ? (dy > 0 ? -off : off) : 0);
  p.y = (ay + dy * f) * T + 8 + (dx !== 0 ? (dx > 0 ? off : -off) : 0);
  p.dirx = dx; p.diry = dy;
}
const line = (x0: number, y0: number, dx: number, dy: number, n: number): number[][] =>
  Array.from({ length: n }, (_, i) => [x0 + dx * i, y0 + dy * i]);

/** step every car in `cars` (others stand still); `life` holds buses and the like */
function run(all: any[], cars: any[], seconds: number, each?: () => void, life: any = {}): void {
  for (let s = 0; s < seconds / DT; s++) {
    Traffic.begin(all, life);
    for (const c of cars) {
      const t = c.trip;
      if (t.prog >= t.path.length - 1) continue;
      t.prog = Math.min(t.path.length - 1, t.prog + Traffic.advance(c, t, t.path, t.prog, 1, 1.6, DT));
      place(c);
    }
    each?.();
  }
}

beforeEach(() => {
  World.roadMap.fill(0);
  World.signals.clear();
  World.crossings.clear();
  Traffic.reset();
});

describe('traffic', () => {
  it('a car pulls up behind a stopped one and keeps a gap', () => {
    const road = line(10, 10, 1, 0, 20);
    for (const [x, y] of road) World.roadMap[World.idx(x, y)] = 1;
    const leader = rider(road, 8);
    const follower = rider(road, 0);
    let minGap = Infinity;
    run([leader, follower], [follower], 30, () => {
      minGap = Math.min(minGap, leader.trip.prog - follower.trip.prog - CAR_LEN);
    });
    expect(minGap).toBeGreaterThan(0.15);                        // never touched
    expect(leader.trip.prog - follower.trip.prog).toBeLessThan(CAR_LEN + 0.6); // and closed right up
    expect(follower.trip.v).toBeLessThan(0.01);
  });

  it('stops for someone crossing the road, then carries on once they have gone', () => {
    const road = line(10, 10, 1, 0, 20);
    for (const [x, y] of road) World.roadMap[World.idx(x, y)] = 1;
    const car = rider(road, 0);
    // a pedestrian standing on the centreline of tile 18
    const walker: any = { state: 'walk', trip: { path: [[18, 10], [18, 11]], prog: 0, car: null }, x: 18 * T + 8, y: 10 * T + 8, dirx: 0, diry: 1 };
    run([car, walker], [car], 20);
    expect(car.trip.prog).toBeLessThan(8);
    expect(car.trip.prog).toBeGreaterThan(6.5);
    walker.state = 'in';
    run([car, walker], [car], 15);
    expect(car.trip.prog).toBe(road.length - 1);
  });

  it('two cars meeting at an unsignalled junction take turns, without gridlock', () => {
    // a crossroads at (20, 20)
    const ew = line(10, 20, 1, 0, 21), ns = line(20, 10, 0, 1, 21);
    for (const [x, y] of [...ew, ...ns]) World.roadMap[World.idx(x, y)] = 1;
    const a = rider(ew, 0), b = rider(ns, 0.3);
    let closest = Infinity;
    run([a, b], [a, b], 40, () => {
      closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y) / T);
    });
    expect(a.trip.prog).toBe(ew.length - 1);
    expect(b.trip.prog).toBe(ns.length - 1);
    expect(closest).toBeGreaterThan(CAR_LEN * 0.9); // never drove through each other
  });

  it('overtakes a bus at its stop through the clear oncoming lane, then pulls back in', () => {
    const road = line(10, 10, 1, 0, 24);
    for (const [x, y] of road) World.roadMap[World.idx(x, y)] = 1;
    // a bus standing at a stop in our lane, tile 18 (path index 8)
    const bus = { x: 18 * T + 8, y: 10 * T + 8 + 3.5, dirx: 1, diry: 0, pause: 99 };
    const car = rider(road, 0);
    let closest = Infinity, pulledOut = false;
    run([car], [car], 40, () => {
      closest = Math.min(closest, Math.hypot(car.x - bus.x, car.y - bus.y) / T);
      if ((car.trip.lat ?? 1) < 0) pulledOut = true;
    }, { buses: [bus] });
    expect(pulledOut).toBe(true);
    expect(closest).toBeGreaterThan(0.38); // passed beside it, never through it
    expect(car.trip.prog).toBe(road.length - 1);
    expect(car.trip.lat).toBeCloseTo(3.5 / 16, 3); // back in its own lane
  });

  it('overtakes on a two-tile avenue too (its twin row is not a side street)', () => {
    for (let x = 10; x <= 34; x++) for (const y of [10, 11]) World.roadMap[World.idx(x, y)] = 1;
    const road = line(10, 10, 1, 0, 24);
    const bus = { x: 18 * T + 8, y: 10 * T + 8 + 3.5, dirx: 1, diry: 0, pause: 99 };
    const car = rider(road, 0);
    run([car], [car], 40, undefined, { buses: [bus] });
    expect(car.trip.prog).toBe(road.length - 1);
  });

  it("doesn't pull out while something is coming the other way", () => {
    const road = line(10, 10, 1, 0, 24);
    for (const [x, y] of road) World.roadMap[World.idx(x, y)] = 1;
    const bus = { x: 18 * T + 8, y: 10 * T + 8 + 3.5, dirx: 1, diry: 0, pause: 99 };
    const car = rider(road, 0);
    // an oncoming car parked in the other lane just past the bus
    const oncoming = rider(line(33, 10, -1, 0, 24), 13.5);
    let pulledOut = false;
    run([car, oncoming], [car], 15, () => { if ((car.trip.lat ?? 1) < 0.1) pulledOut = true; }, { buses: [bus] });
    expect(pulledOut).toBe(false);
    expect(car.trip.prog).toBeLessThan(8 - 0.5);
  });

  it('stops for the Founder standing in the road and sounds the horn', () => {
    const road = line(10, 10, 1, 0, 20);
    for (const [x, y] of road) World.roadMap[World.idx(x, y)] = 1;
    const car = rider(road, 0);
    Traffic.guests = [{ x: 17 * T + 8, y: 10 * T + 8 + 3, dx: 0, dy: 1, car: false, still: true }];
    let honks = 0;
    Traffic.onHonk = () => honks++;
    run([car], [car], 20);
    expect(car.trip.prog).toBeLessThan(7);
    expect(car.trip.prog).toBeGreaterThan(5.5);
    expect(honks).toBeGreaterThan(0);
    Traffic.onHonk = null;
  });

  it("passes the Founder's parked car while the Founder stands on the pavement behind it", () => {
    const road = line(10, 10, 1, 0, 24);
    for (const [x, y] of road) World.roadMap[World.idx(x, y)] = 1;
    Traffic.guests = [
      { x: 18 * T + 8, y: 10 * T + 8 + 3.5, dx: 1, dy: 0, car: true, still: true },
      { x: 16 * T + 8, y: 10 * T + 8 - 6.5, dx: 0, dy: 1, car: false, still: true },
    ];
    const car = rider(road, 0);
    run([car], [car], 40);
    expect(car.trip.prog).toBe(road.length - 1);
  });

  it('two cars that set off from the very same spot separate into a queue', () => {
    const road = line(10, 10, 1, 0, 20);
    for (const [x, y] of road) World.roadMap[World.idx(x, y)] = 1;
    const a = rider(road, 2), b = rider(road, 2);
    const blocker = rider(road, 12); // something to queue behind
    run([a, b, blocker], [a, b], 30);
    const gap = Math.abs(a.trip.prog - b.trip.prog);
    expect(gap).toBeGreaterThan(CAR_LEN + 0.15);
  });

  it('waits at a red light and goes on green', () => {
    const road = line(10, 10, 1, 0, 20);
    for (const [x, y] of road) World.roadMap[World.idx(x, y)] = 1;
    World.signals.add(World.idx(16, 10));
    const nsGreen = World.nsGreen;
    World.nsGreen = () => true; // red for east-west traffic
    const car = rider(road, 0);
    run([car], [car], 20);
    expect(car.trip.prog).toBeLessThan(6 - 0.5);
    expect(car.trip.prog).toBeGreaterThan(4.5);
    World.nsGreen = () => false;
    run([car], [car], 20);
    expect(car.trip.prog).toBe(road.length - 1);
    World.nsGreen = nsGreen;
  });
});

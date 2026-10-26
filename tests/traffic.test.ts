/* Traffic (V2): drivers keep their distance, stop for people on the
   carriageway, and take turns at junctions without gridlock. */
import { beforeEach, describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { Traffic, CAR_LEN, LANE, LANE_PX, PAVEMENT_M, lanePose, kerbside } from '../src/sim/traffic';

const T = 16;
const DT = 0.05;

/** a road user on a tile path, positioned the way the sim does it (in its lane, round the bends on arcs) */
function rider(path: number[][], prog: number, car = true): any {
  const p: any = { state: 'walk', trip: { path, prog, car: car ? {} : null }, x: 0, y: 0, dirx: 1, diry: 0 };
  place(p);
  return p;
}
function place(p: any): void {
  const t = p.trip;
  const pose = lanePose(t.path, t.prog, t.car ? Traffic.lanePx(t) : 0);
  p.x = pose.x; p.y = pose.y;
  p.dirx = pose.dx; p.diry = pose.dy;
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
    const bus = { x: 18 * T + 8, y: 10 * T + 8 + LANE_PX, dirx: 1, diry: 0, pause: 99 };
    const car = rider(road, 0);
    let closest = Infinity, pulledOut = false;
    run([car], [car], 40, () => {
      closest = Math.min(closest, Math.hypot(car.x - bus.x, car.y - bus.y) / T);
      if ((car.trip.lat ?? 1) < 0) pulledOut = true;
    }, { buses: [bus] });
    expect(pulledOut).toBe(true);
    expect(closest).toBeGreaterThan(0.3); // passed beside it (a lane's width), never through it
    expect(car.trip.prog).toBe(road.length - 1);
    expect(car.trip.lat).toBeCloseTo(LANE, 3); // back in its own lane
  });

  it('overtakes on a two-tile avenue too (its twin row is not a side street)', () => {
    for (let x = 10; x <= 34; x++) for (const y of [10, 11]) World.roadMap[World.idx(x, y)] = 1;
    const road = line(10, 10, 1, 0, 24);
    const bus = { x: 18 * T + 8, y: 10 * T + 8 + LANE_PX, dirx: 1, diry: 0, pause: 99 };
    const car = rider(road, 0);
    run([car], [car], 40, undefined, { buses: [bus] });
    expect(car.trip.prog).toBe(road.length - 1);
  });

  it("doesn't pull out while something is coming the other way", () => {
    const road = line(10, 10, 1, 0, 24);
    for (const [x, y] of road) World.roadMap[World.idx(x, y)] = 1;
    const bus = { x: 18 * T + 8, y: 10 * T + 8 + LANE_PX, dirx: 1, diry: 0, pause: 99 };
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
      { x: 18 * T + 8, y: 10 * T + 8 + LANE_PX, dx: 1, dy: 0, car: true, still: true },
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

  /* ---------- V2 (Milestone 8): bends, keeping right, slowing for turns ---------- */
  it('takes a bend on an arc in its own lane: clear of the kerbs, the heading turning smoothly', () => {
    // east, then a right turn south, then a left turn east again
    const path = [...line(10, 10, 1, 0, 6), ...line(15, 11, 0, 1, 5), ...line(16, 15, 1, 0, 5)];
    for (const [x, y] of path) World.roadMap[World.idx(x, y)] = 1;
    const SW = PAVEMENT_M * 2; // px
    /** px from (x, y) to the nearest kerb: the strips on sides facing open ground, the quarter-round inner corners */
    const kerb = (x: number, y: number): number => {
      const tx = Math.floor(x / T), ty = Math.floor(y / T), lx = x - tx * T, ly = y - ty * T;
      const R = (i: number, j: number) => World.isRoad(tx + i, ty + j);
      let d = Infinity;
      if (!R(0, -1)) d = Math.min(d, ly - SW);
      if (!R(0, 1)) d = Math.min(d, T - SW - ly);
      if (!R(-1, 0)) d = Math.min(d, lx - SW);
      if (!R(1, 0)) d = Math.min(d, T - SW - lx);
      for (const [i, j, cx, cy] of [[-1, -1, 0, 0], [1, -1, T, 0], [-1, 1, 0, T], [1, 1, T, T]] as const)
        if (R(i, 0) && R(0, j) && !R(i, j)) d = Math.min(d, Math.hypot(lx - cx, ly - cy) - SW);
      return d;
    };
    let lastYaw: number | null = null, maxJump = 0, minKerb = Infinity;
    for (let prog = 0; prog <= path.length - 1; prog += 0.02) {
      const p = lanePose(path, prog, LANE_PX);
      const tx = Math.floor(p.x / T), ty = Math.floor(p.y / T);
      expect(path.some(([x, y]) => x === tx && y === ty)).toBe(true); // always on the road
      minKerb = Math.min(minKerb, kerb(p.x, p.y));
      const yaw = Math.atan2(p.hx, p.hy);
      if (lastYaw !== null) { let d = yaw - lastYaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; maxJump = Math.max(maxJump, Math.abs(d)); }
      lastYaw = yaw;
    }
    expect(minKerb).toBeGreaterThan(2.2); // the car's centre stays over a metre from every kerb (it's 1.8 m wide)
    expect(maxJump).toBeLessThan(0.15);   // no snap at the corners
    // and on the straights it is in the right-hand lane
    const mid = lanePose(path, 2.5, LANE_PX);
    expect(mid.y - (10 * T + 8)).toBeCloseTo(LANE_PX, 5);
  });

  it('keeps right on a two-tile avenue: eastbound on the south row, westbound on the north', () => {
    for (let x = 10; x <= 40; x++) for (const y of [10, 11]) World.roadMap[World.idx(x, y)] = 1;
    World._pathCache?.clear?.();
    World.roadStamp++;
    const east = World.roadPath(10, 10, 40, 10)!, west = World.roadPath(40, 11, 10, 11)!;
    const onRow = (path: number[][], y: number) => path.filter(([, py]) => py === y).length / path.length;
    expect(onRow(east, 11)).toBeGreaterThan(0.8);
    expect(onRow(west, 10)).toBeGreaterThan(0.8);
  });

  it('routes run straight rather than zigzagging through a grid of streets', () => {
    for (let y = 10; y <= 30; y++) for (let x = 10; x <= 30; x++) if (x % 5 === 0 || y % 5 === 0) World.roadMap[World.idx(x, y)] = 1;
    World.roadStamp++;
    const path = World.roadPath(10, 10, 30, 30)!;
    let turns = 0;
    for (let i = 1; i < path.length - 1; i++) {
      const a = [path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]], b = [path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]];
      if (a[0] !== b[0] || a[1] !== b[1]) turns++;
    }
    expect(path.length).toBe(41); // still the shortest way
    expect(turns).toBeLessThanOrEqual(2);
  });

  it('slows for a left turn ahead and takes it at turning speed', () => {
    const path = [...line(10, 10, 1, 0, 12), ...line(21, 9, 0, -1, 10)];
    for (const [x, y] of path) World.roadMap[World.idx(x, y)] = 1;
    const car = rider(path, 0);
    let inBend = Infinity;
    run([car], [car], 30, () => { const s = car.trip.prog; if (s > 10.6 && s < 11.4) inBend = Math.min(inBend, 1); if (s > 10.5 && s < 11.5) inBend = Math.max(inBend === Infinity ? 0 : inBend, car.trip.v); });
    expect(inBend).toBeLessThan(0.8);
    expect(car.trip.prog).toBe(path.length - 1);
  });

  /* ---------- V2: junction boxes: nothing drives through anything, and the town never jams ---------- */
  it('cars from all four sides of a crossroads take turns across it without ever touching', () => {
    const ew = line(10, 20, 1, 0, 21), we = line(30, 20, -1, 0, 21), ns = line(20, 10, 0, 1, 21), sn = line(20, 30, 0, -1, 21);
    for (const [x, y] of [...ew, ...ns]) World.roadMap[World.idx(x, y)] = 1;
    // two cars in each direction, one turning at the crossroads
    const turnL = [...line(10, 20, 1, 0, 11), ...line(20, 19, 0, -1, 10)], turnR = [...line(30, 20, -1, 0, 11), ...line(20, 19, 0, -1, 10)];
    const cars = [rider(ew, 4), rider(we, 4.4), rider(ns, 4.2), rider(sn, 4.6), rider(turnL, 2), rider(turnR, 2.3), rider(ns, 2.5), rider(sn, 2.8)];
    let closest = Infinity;
    run(cars, cars, 60, () => {
      for (const c of cars) if (c.trip.prog >= c.trip.path.length - 1) c.state = 'in'; // (there: off the road)
      for (let i = 0; i < cars.length; i++)
        for (let j = i + 1; j < cars.length; j++)
          if (cars[i].state === 'walk' && cars[j].state === 'walk') closest = Math.min(closest, Math.hypot(cars[i].x - cars[j].x, cars[i].y - cars[j].y) / T);
    });
    for (const c of cars) expect(c.trip.prog).toBe(c.trip.path.length - 1);
    expect(closest).toBeGreaterThan(0.24); // (a car is 0.23 tiles wide: side by side at the least, never one inside another)
  });

  it('a busy grid of streets and avenues, with lights, trucks unloading and cars parking, never jams', () => {
    let seed = 3;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const x of [20, 30, 50, 60]) for (let y = 20; y <= 60; y++) World.roadMap[World.idx(x, y)] = 1;
    for (const y of [20, 45, 60]) for (let x = 20; x <= 60; x++) World.roadMap[World.idx(x, y)] = 1;
    for (let x = 20; x <= 60; x++) for (const y of [30, 31]) World.roadMap[World.idx(x, y)] = 1;
    for (let y = 20; y <= 60; y++) for (const x of [40, 41]) World.roadMap[World.idx(x, y)] = 1;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) World.signals.add(World.idx(40 + dx, 30 + dy));
    World.roadStamp++;
    const roads: number[][] = [];
    for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) if (World.isRoad(x, y)) roads.push([x, y]);
    const route = (from: number[]): number[][] => {
      for (;;) {
        const to = roads[(rnd() * roads.length) | 0];
        const p = Math.abs(to[0] - from[0]) + Math.abs(to[1] - from[1]) > 10 && World.roadPath(from[0], from[1], to[0], to[1]);
        if (p && p.length > 6) return kerbside(p).map((q: number[]) => q.slice());
      }
    };
    let t = 0;
    const nsGreen = World.nsGreen;
    World.nsGreen = () => Math.floor(t / 8) % 2 === 0;
    const people: any[] = [], life: any = { trucks: [], trainNearTile: () => false };
    const all: any[] = [];
    for (let i = 0; i < 50; i++) {
      const truck = i % 8 === 0, path = route(roads[(i * 37) % roads.length]);
      const o: any = truck ? { phase: 'go', x: 0, y: 0, dirx: 1, diry: 0 } : { state: 'walk', trip: { path, prog: 0, car: {}, joined: true }, x: 0, y: 0, dirx: 1, diry: 0 };
      (truck ? life.trucks : people).push(o);
      all.push({ o, st: truck ? o : o.trip, path, prog: 0, len: truck ? 0.9 : CAR_LEN, truck, still: 0, wait: 0, away: 0 });
    }
    const place = (a: any): void => {
      const p = lanePose(a.path, a.prog, Traffic.lanePx(a.st));
      Object.assign(a.o, { x: p.x, y: p.y, dirx: p.dx, diry: p.dy, hx: p.hx, hy: p.hy });
      if (!a.truck) Object.assign(a.o.trip, { prog: a.prog, path: a.path });
    };
    all.forEach(place);
    let longest = 0, trips = 0;
    for (let s = 0; s < 400 / 0.1; s++) {
      t += 0.1;
      Traffic.begin(people, life);
      for (const a of all) {
        if (a.away > 0) { // parked inside, or unloading: then back out when there's room
          a.away -= 0.1;
          if (a.away > 0 || !Traffic.roomToJoin(a.o, a.next, false, a.away < -120)) continue;
          a.path = a.next; a.prog = 0; a.st.v = 0; a.st.over = null; a.st.lat = undefined; a.st.box = null;
          if (a.truck) a.o.phase = 'go'; else a.o.state = 'walk';
          place(a);
          continue;
        }
        if (!a.truck && a.o.trip.joined === false) {
          if (!Traffic.roomToJoin(a.o, a.path)) continue;
          a.o.trip.joined = true;
        }
        a.prog = Math.min(a.path.length - 1, a.prog + Traffic.advance(a.o, a.st, a.path, a.prog, 1, a.truck ? 1.3 : 1.6, 0.1, a.len));
        place(a);
        a.still = (a.st.v || 0) < 0.03 ? a.still + 0.1 : 0;
        longest = Math.max(longest, a.still);
        if (a.prog >= a.path.length - 1) {
          trips++;
          a.still = 0; a.away = a.truck ? 20 : 3; a.next = route(a.path[a.path.length - 1]);
          if (a.truck) a.o.phase = 'drop'; else a.o.state = 'in';
        }
      }
    }
    World.nsGreen = nsGreen;
    expect(trips).toBeGreaterThan(250);
    expect(longest).toBeLessThan(150); // nobody waits for ever: no box is ever blocked both ways at once
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

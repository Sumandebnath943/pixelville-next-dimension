/* Parking (batch 10): a place with no bay free sends its visitors' cars to the nearest public car park, the driver
   walking the rest of the way, and the drive home starts from that car park. */
import { afterEach, describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { Game } from '../src/sim/game';
import { Sim } from '../src/sim/agents';
import { Lots, bayCount, carParkNear, bayHeld, leaveBay, spotTile, inPlan } from '../src/sim/parking';
import { Traffic, lanePose } from '../src/sim/traffic';
import { C, build, town } from './town';

describe('parking', () => {
  afterEach(() => { Lots.of = null; });

  it('a full place sends the car to the car park, and the driver walks on from it', () => {
    const homes = town(77, 3);
    const shop = build('shop', C.x + 6, C.y + 8);
    const lot = build('carpark', C.x + 14, C.y + 8);
    expect(shop && lot).toBeTruthy();
    // the shop's plot has no room for a car; the car park its bays (where they stand on its plot)
    Lots.of = (b) => (b.type === 'carpark' ? null : { park: [], drive: [] });
    expect(bayCount(shop)).toBe(0);
    expect(bayCount(lot)).toBeGreaterThan(0);
    expect(carParkNear(shop, World.buildings)).toBe(lot);
    const p = Sim.people.find((q: any) => q.kind !== 'kid' && homes.includes(q.home))!;
    const car = p.home.cars[0];
    expect(car).toBeTruthy();
    p.state = 'in'; p.at = p.home; p.carHeld = car; car.free = false;
    Sim.startTrip(p, shop, 1e9, null);
    expect(p.trip.car).toBe(car);
    expect(p.trip.lot).toBe(lot);
    // drive it to the end, parked
    p.trip.prog = p.trip.path.length - 1; p.trip.joined = true; p.trip.parkT = 99;
    Sim.tickPerson(p, 0.1);
    const t = p.trip;
    expect(t && !t.car).toBe(true);
    {
      // on foot from the car park, the car kept for the way back
      expect(t.keepCar).toBe(car);
      expect(lot.parked).toBe(1);
      expect(p.carLotId).toBe(lot.id);
    }
  });

  it('every car has a bay of its own: booked on setting off, never one a car still stands in', () => {
    const homes = town(79, 4);
    const shop = build('shop', C.x + 6, C.y + 8);
    // three bays across the shop's front
    Lots.of = (b) => (b === shop ? { park: [0, 1, 2].map((k) => ({ x: (shop.door.x + 0.5) * 8 - 2.7 + k * 2.7, z: (shop.door.y + 0.5) * 8 - 9, yaw: 0 })), drive: [] } : null);
    const drivers = Sim.people.filter((q: any) => q.kind !== 'kid' && homes.includes(q.home) && q.home.cars.length).slice(0, 4);
    expect(drivers.length).toBe(4);
    for (const p of drivers) { p.state = 'in'; p.at = p.home; p.carHeld = null; for (const c of p.home.cars) c.free = true; Sim.startTrip(p, shop, 1e9, null); }
    const bays = drivers.map((p: any) => bayHeld(shop, p));
    // three got a bay each, all different; the fourth, with none left and no car park, left the car at home
    expect(bays.filter((k: number) => k >= 0).sort()).toEqual([0, 1, 2]);
    expect(drivers.filter((p: any) => p.trip.car).length).toBe(3);
    // the one in bay 0 has gone; a newcomer gets bay 0, not a bay someone still stands in
    const first = drivers[bays.indexOf(0)];
    leaveBay(shop, first); first.trip = null; first.state = 'in'; first.at = first.home;
    const late = Sim.people.find((q: any) => q.kind !== 'kid' && !drivers.includes(q) && q.home.cars.length)!;
    late.state = 'in'; late.at = late.home; for (const c of late.home.cars) c.free = true;
    Sim.startTrip(late, shop, 1e9, null);
    expect(bayHeld(shop, late)).toBe(0);
  });

  it('a car parks from the street in front of its spot, backing a few metres in, never along the road', () => {
    town(80, 2);
    const shop = build('shop', C.x + 6, C.y + 8);
    const d = shop.door, f = (shop.facing || 0) * Math.PI / 2;
    // a bay on the plot, 9 m in from the door's street tile, nose to the street
    const s = { x: (d.x + 0.5) * 8 - Math.sin(f) * 9, z: (d.y + 0.5) * 8 - Math.cos(f) * 9, yaw: f };
    Lots.of = (b) => (b === shop ? { park: [s], drive: [] } : null);
    const p = Sim.people.find((q: any) => q.kind !== 'kid' && q.home.cars.length)!;
    p.state = 'in'; p.at = p.home; p.carHeld = null; for (const c of p.home.cars) c.free = true;
    Sim.startTrip(p, shop, 1e9, null);
    const t = p.trip;
    expect(t.car).toBeTruthy();
    // the drive ends on the street tile its spot's drive comes out on
    const end = t.path[t.path.length - 1], st = spotTile(t.to)!;
    expect(end).toEqual([st.x, st.y]);
    // and the way in: on a little past the drive, then back in, a few metres
    const pose = lanePose(t.path, t.path.length - 1, Traffic.lanePx(t));
    const hl = Math.hypot(pose.hx, pose.hy);
    const plan = inPlan(t.to, pose.x / 2, pose.y / 2, pose.hx / hl, pose.hy / hl);
    expect(plan.roll).toBeLessThan(9);
    expect(plan.c.len).toBeLessThan(16);
  });

  it('a building off the street gets a tidy lane to it, square on, and loses it when it goes', () => {
    Game.boot(82);
    // a street along row y0, and a house five tiles north of it, facing it
    const y0 = C.y + 10;
    for (let x = C.x - 10; x <= C.x + 10; x++) World.setRoad(x, y0);
    const b = World.placeBuilding('house', C.x, y0 - 7, true, 0); // (door on row y0 - 5)
    expect(b).toBeTruthy();
    expect(b.connected).toBe(true);
    // one tile wide, straight down from the door to the street
    for (let y = b.door.y; y < y0; y++) {
      expect(World.isRoad(b.door.x, y)).toBe(true);
      expect(World.isRoad(b.door.x - 1, y) || World.isRoad(b.door.x + 1, y)).toBe(false);
    }
    // demolished, the lane goes too; the street stays
    Game.bulldozeAt(b.x, b.y);
    for (let y = b.door.y; y < y0; y++) expect(World.isRoad(b.door.x, y)).toBe(false);
    expect(World.isRoad(b.door.x, y0)).toBe(true);
  });

  it('with room on the plot, the car parks there as before', () => {
    town(78, 2);
    const shop = build('shop', C.x + 6, C.y + 8);
    Lots.of = () => ({ park: [{ x: 0, z: 0, yaw: 0 }], drive: [] });
    const p = Sim.people.find((q: any) => q.kind !== 'kid')!;
    const car = p.home.cars[0];
    p.state = 'in'; p.at = p.home; p.carHeld = car; car.free = false;
    Sim.startTrip(p, shop, 1e9, null);
    expect(p.trip.lot).toBeUndefined();
    expect(p.trip.to).toBeTruthy();
  });
});

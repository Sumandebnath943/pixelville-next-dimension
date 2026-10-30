/* Parking (batch 10): a place with no bay free sends its visitors' cars to the nearest public car park, the driver
   walking the rest of the way, and the drive home starts from that car park. */
import { afterEach, describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { Sim } from '../src/sim/agents';
import { Lots, bayCount, carParkNear } from '../src/sim/parking';
import { C, build, town } from './town';

describe('parking', () => {
  afterEach(() => { Lots.of = null; });

  it('a full place sends the car to the car park, and the driver walks on from it', () => {
    const homes = town(77, 3);
    const shop = build('shop', C.x + 6, C.y + 8);
    const lot = build('carpark', C.x + 14, C.y + 8);
    expect(shop && lot).toBeTruthy();
    // the shop's plot has no room for a car; the car park its nine bays
    Lots.of = (b) => (b.type === 'carpark' ? { park: Array.from({ length: 9 }, (_, k) => ({ x: k, z: 0, yaw: 0 })), drive: [] } : { park: [], drive: [] });
    expect(bayCount(shop)).toBe(0);
    expect(bayCount(lot)).toBe(9);
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

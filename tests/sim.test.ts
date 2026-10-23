/* Headless simulation tests: the V1 port must boot, grow a village and keep
   its invariants over many in-game days — no NaN money, no leaked cars,
   no negative head-counts, no orphaned tasks (V1's historic bug classes). */
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { World, GW, GH, footprint, doorOf } from '../src/sim/world';
import { Sim } from '../src/sim/agents';
import { Gov } from '../src/sim/gov';
import { CAT } from '../src/sim/catalog';

function placeNear(key: string, cx: number, cy: number): any {
  for (let r = 0; r < 40; r++)
    for (let t = 0; t < 32; t++) {
      const x = Math.round(cx + Math.cos(t) * r), y = Math.round(cy + Math.sin(t) * r);
      for (let f = 0; f < 4; f++) {
        if (World.canPlace(key, x, y, f)) {
          Game.placeAt(key, x, y, f);
          return World.buildingAt(x, y);
        }
      }
    }
  return null;
}

function runDays(days: number): void {
  // 1 real second = 1 game-minute at 1×; step the sim at 8× in 0.1 s frames
  Game.streetMode = false;
  Game.setSpeed(4);
  const frames = Math.ceil((days * 1440) / (0.1 * 8));
  for (let i = 0; i < frames; i++) Game.tick(0.1);
}

describe('world', () => {
  it('generates a 256² starter map with highways and the Founder\'s Lodge', () => {
    Game.boot(12345);
    expect(GW).toBe(256);
    expect(GH).toBe(256);
    let roads = 0;
    for (let i = 0; i < World.roadMap.length; i++) roads += World.roadMap[i];
    expect(roads).toBeGreaterThan(100);
    const lodge = Game.lodge();
    expect(lodge).toBeTruthy();
    expect(lodge.connected).toBe(true);
  });

  it('rotates footprints and doors with the facing', () => {
    expect(footprint('factory', 0)).toEqual({ w: CAT.factory.w, h: CAT.factory.h });
    expect(footprint('factory', 1)).toEqual({ w: CAT.factory.h, h: CAT.factory.w });
    expect(doorOf(10, 10, 4, 3, 0)).toEqual({ x: 12, y: 13 });
    expect(doorOf(10, 10, 4, 3, 1)).toEqual({ x: 14, y: 11 });
    expect(doorOf(10, 10, 4, 3, 2)).toEqual({ x: 12, y: 9 });
    expect(doorOf(10, 10, 4, 3, 3)).toEqual({ x: 9, y: 11 });
  });

  it('auto-connects a placed house to the road network', () => {
    Game.boot(777);
    const b = placeNear('house', GW >> 1, GH >> 1);
    expect(b).toBeTruthy();
    expect(b.connected).toBe(true);
  });
});

describe('village life (soak)', () => {
  it('grows a village over 20 days and keeps its invariants', () => {
    Game.boot(4242);
    const c = { x: GW >> 1, y: GH >> 1 };
    for (let i = 0; i < 6; i++) placeNear('house', c.x + i * 4, c.y);
    placeNear('shop', c.x, c.y + 8);
    placeNear('office', c.x + 10, c.y + 8);
    placeNear('school', c.x - 10, c.y + 8);
    placeNear('park', c.x - 6, c.y - 8);
    placeNear('police', c.x + 16, c.y - 4);
    placeNear('fire', c.x - 16, c.y - 4);
    runDays(20);

    expect(Sim.day).toBeGreaterThanOrEqual(20);
    expect(Sim.people.length).toBeGreaterThan(8);
    for (const p of Sim.people) {
      expect(Number.isFinite(p.savings)).toBe(true);
      expect(Number.isFinite(p.mood)).toBe(true);
      expect(Sim.people.filter((q: any) => q.id === p.id).length).toBe(1);
      expect(World.buildings.includes(p.home)).toBe(true);
    }
    for (const b of World.buildings) {
      expect(Number.isFinite(b.funds)).toBe(true);
      expect(b.inside).toBeGreaterThanOrEqual(0);
      expect(b.parked ?? 0).toBeGreaterThanOrEqual(0);
    }
    // every car is either parked at home, out with its driver, or held at a venue
    const inUse = new Set<any>();
    for (const p of Sim.people) {
      if (p.trip && p.trip.car) inUse.add(p.trip.car);
      if (p.carHeld) inUse.add(p.carHeld);
    }
    for (const b of World.buildings) for (const car of b.cars) if (!car.free) expect(inUse.has(car)).toBe(true);
    // by now the village has held its first election
    expect(Gov.leader || Gov.campaign).toBeTruthy();
  });

  it('round-trips a save', () => {
    const pop = Sim.people.length, n = World.buildings.length, day = Sim.day;
    const s = Game.buildSaveString();
    const r = Game.performLoad(s);
    expect(r.ok).toBe(true);
    expect(Sim.people.length).toBe(pop);
    expect(World.buildings.length).toBe(n);
    expect(Sim.day).toBe(day);
  });
});

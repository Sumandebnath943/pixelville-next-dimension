/* A small finished town for the Milestone 4 tests: a starter map with
   buildings placed complete (roads auto-connect), families moved in. */
import { Game } from '../src/sim/game';
import { World, GW, GH } from '../src/sim/world';
import { Sim } from '../src/sim/agents';

export const C = { x: GW >> 1, y: GH >> 1 };

/** place a finished building near (cx, cy); null if no room */
export function build(key: string, cx: number, cy: number, done = true): any {
  for (let r = 0; r < 40; r++)
    for (let t = 0; t < 32; t++) {
      const x = Math.round(cx + Math.cos(t) * r), y = Math.round(cy + Math.sin(t) * r);
      for (let f = 0; f < 4; f++) {
        if (!World.canPlace(key, x, y, f)) continue;
        const b = World.placeBuilding(key, x, y, done, f);
        if (!b) continue;
        if (done) Sim.onBuildingAdded(b);
        Game.afterMapEdit();
        return b;
      }
    }
  return null;
}

/** a fresh map and a handful of homes (with families) around the centre */
export function town(seed = 4242, homes = 6): any[] {
  Game.boot(seed);
  const hs: any[] = [];
  for (let i = 0; i < homes; i++) hs.push(build('house', C.x + i * 4, C.y));
  return hs.filter(Boolean);
}

/** run the sim for `minutes` game-minutes at 8× in 0.1 s frames (street mode off) */
export function run(minutes: number): void {
  Game.streetMode = false;
  Game.setSpeed(4);
  const steps = Math.ceil(minutes / 0.8);
  for (let i = 0; i < steps; i++) Game.tick(0.1);
}

/** run until `done()` or `minutes` pass; returns whether it happened */
export function until(done: () => boolean, minutes: number): boolean {
  Game.streetMode = false;
  Game.setSpeed(4);
  for (let i = 0; i < minutes / 0.8; i++) {
    Game.tick(0.1);
    if (done()) return true;
  }
  return done();
}

/** a road tile near a building's door, in sim px */
export function roadPx(b: any): { x: number; y: number } {
  const r = World.nearestRoad(b.door.x, b.door.y, 6);
  return { x: r.x * 16 + 8, y: r.y * 16 + 8 };
}

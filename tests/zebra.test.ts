/* Zebra crossings (V2): every street into a junction has one; people cross on it, and drivers waiting at the lights
   or to go into the junction stop at the line behind it: never on it, so nobody crosses through a waiting car. */
import { describe, expect, it, vi } from 'vitest';
import { Game } from '../src/sim/game';
import { Sim } from '../src/sim/agents';
import { AutoVillage } from '../src/sim/autovillage';
import { zebraAt, ZEBRA_OUT, CAR_LEN } from '../src/sim/traffic';

// (the traffic lights change on the page's clock: keep it in step with the sim)
let NOW = 0;
vi.spyOn(performance, 'now').mockImplementation(() => NOW);

describe('zebra crossings', () => {
  it('cars wait behind the zebra, and nobody crosses through one', () => {
    Game.boot(5);
    AutoVillage.build(777);
    Game.streetMode = true;
    Game.setSpeed(1);
    Sim.clock = 7 * 60 + 45;
    let waiting = 0, onZebra = 0, throughCar = 0, crossed = 0;
    for (let s = 0; s < 60 * 20 * 3; s++) {
      Game.tick(0.05);
      NOW += 50;
      const cars: any[] = [];
      for (const p of Sim.people) {
        const t = p.trip;
        if (p.state !== 'walk' || !t) continue;
        if (t.car && t.joined !== false && !(t.parkT > 0) && t.outT === undefined) cars.push(p);
      }
      for (const p of cars) {
        const t = p.trip;
        if ((t.v ?? 1) > 0.02) continue;
        const hx = Math.round(p.hx ?? p.dirx), hy = Math.round(p.hy ?? p.diry);
        if (Math.abs(hx) + Math.abs(hy) !== 1) continue;
        // the tile its nose is on: is that a zebra, into a junction ahead?
        const x = p.x / 16 + hx * (CAR_LEN / 2), y = p.y / 16 + hy * (CAR_LEN / 2), tx = Math.floor(x), ty = Math.floor(y);
        if (!zebraAt(tx, ty, hx, hy)) continue;
        waiting++;
        const edge = hx ? (hx > 0 ? tx + 1 : tx) : hy > 0 ? ty + 1 : ty;
        const nose = hx ? (edge - x) * hx : (edge - y) * hy;
        if (nose < ZEBRA_OUT - 0.02) onZebra++;
      }
      for (const w of Sim.people) {
        const wk = w.trip?.walk;
        if (w.state !== 'walk' || !wk || wk.lat === null) continue;
        crossed++;
        for (const c of cars) {
          const hl = Math.hypot(c.hx ?? c.dirx, c.hy ?? c.diry) || 1, fx = (c.hx ?? c.dirx) / hl, fy = (c.hy ?? c.diry) / hl;
          const rx = (w.x - c.x) / 16, ry = (w.y - c.y) / 16;
          if (Math.abs(rx * fx + ry * fy) < CAR_LEN / 2 - 0.02 && Math.abs(rx * -fy + ry * fx) < 0.1) throughCar++;
        }
      }
    }
    expect(waiting).toBeGreaterThan(20); // (cars did wait at the junctions)
    expect(crossed).toBeGreaterThan(20); // (and people did cross)
    expect(onZebra).toBe(0);
    expect(throughCar).toBe(0);
  }, 240000);
});

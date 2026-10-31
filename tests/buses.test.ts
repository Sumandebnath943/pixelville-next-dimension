/* The village bus (V2): a loop driven one way round, that pulls up at each
   shelter along the kerb, nose on, with the shelter on its right, and never
   turns round in the road (not on the spot, nor back across an avenue). */
import { describe, expect, it, vi } from 'vitest';
import { Game } from '../src/sim/game';
import { Life } from '../src/sim/life';
import { AutoVillage } from '../src/sim/autovillage';
import { lanePose, turnAt, zebraAt } from '../src/sim/traffic';

// (the traffic lights change on the clock of the page: keep it in step with the sim, or the bus waits at a red for good)
let NOW = 0;
vi.spyOn(performance, 'now').mockImplementation(() => NOW);

/** headings two steps apart that are opposite, with a turn between: a U-turn across the two rows of an avenue */
function backAcross(r: number[][]): number[] {
  const out: number[] = [];
  for (let k = 3; k < r.length; k++) {
    const z = [r[k - 2][0] - r[k - 3][0], r[k - 2][1] - r[k - 3][1]], a = [r[k - 1][0] - r[k - 2][0], r[k - 1][1] - r[k - 2][1]];
    const c = [r[k][0] - r[k - 1][0], r[k][1] - r[k - 1][1]];
    if (z[0] === -c[0] && z[1] === -c[1] && (a[0] !== z[0] || a[1] !== z[1])) out.push(k);
  }
  return out;
}

describe('the village bus', () => {
  for (const seed of [4242, 123, 8]) {
    it(`runs its loop and pulls up at every shelter on the kerb (village ${seed})`, () => {
      Game.boot(1);
      AutoVillage.build(seed);
      Game.tick(0.2);
      const bus = Life.buses[0];
      expect(bus).toBeTruthy();
      const r: number[][] = bus.route;
      // a closed loop, turning nowhere back on itself
      expect(r[0]).toEqual(r[r.length - 1]);
      for (let k = 1; k < r.length - 1; k++) expect(turnAt(r, k, 1)).not.toBe(2);
      expect(backAcross(r)).toEqual([]);
      // round the end of the loop without a jump or a swing
      const e = lanePose(r, r.length - 1 - 1e-3, 2.7, 1), s = lanePose(r, 1e-3, 2.7, 1);
      expect(Math.hypot(e.x - s.x, e.y - s.y)).toBeLessThan(0.1);
      expect(e.hx * s.hx + e.hy * s.hy).toBeGreaterThan(0.999);
      // each stop on a straight, with its shelter on the bus's right
      bus.stopIdx.forEach((k: number, i: number) => {
        expect(turnAt(r, k, 1)).toBe(0);
        // (its 12 m clear of the zebras at the junctions either side)
        const hx = r[k + 1][0] - r[k][0], hy = r[k + 1][1] - r[k][1];
        expect(zebraAt(r[k][0], r[k][1], hx, hy) || zebraAt(r[k][0], r[k][1], -hx, -hy)).toBe(false);
        const p = lanePose(r, k, 2.7, 1), st = bus.stops[i];
        const ox = (st.x + st.w / 2) * 16 - p.x, oy = (st.y + st.h / 2) * 16 - p.y;
        expect(-p.hy * ox + p.hx * oy).toBeGreaterThan(0);
      });
      // and driven: it stops level with each shelter it comes to, along the road
      const served: number[] = [];
      let was = 0;
      for (let t = 0; t < 2400 && served.length < 2; t++) {
        Game.tick(0.1);
        NOW += 100;
        if (bus.pause > 0 && was <= 0) {
          const d = r[bus.lastStop];
          expect(Math.hypot(bus.x / 16 - d[0] - 0.5, bus.y / 16 - d[1] - 0.5)).toBeLessThan(0.3);
          expect(Math.abs(bus.hx) + Math.abs(bus.hy)).toBeCloseTo(1, 3); // (square to the road, not mid-turn)
          served.push(bus.lastStop);
        }
        was = bus.pause;
      }
      expect(served.length).toBe(2);
    });
  }
});

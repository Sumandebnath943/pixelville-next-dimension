/* The railway (V2): bends as wide as the line allows, so the carriages ride round them; and level crossings whose
   lights and booms close the road well before a train comes, with nothing ever left on the tracks when it does. */
import { describe, expect, it, vi } from 'vitest';
import { Game } from '../src/sim/game';
import { World } from '../src/sim/world';
import { Life } from '../src/sim/life';
import { Sim } from '../src/sim/agents';
import { railPose } from '../src/sim/traffic';
import { C, build, town } from './town';

// (the traffic lights change on the page's clock: keep it in step with the sim)
let NOW = 0;
vi.spyOn(performance, 'now').mockImplementation(() => NOW);

/** an L of track: east along row y0 from x0 to x1, then south down column x1 to y1 */
function layL(x0: number, y0: number, x1: number, y1: number): number[][] {
  const route: number[][] = [];
  for (let x = x0; x <= x1; x++) { World.setRail(x, y0); route.push([x, y0]); }
  for (let y = y0 + 1; y <= y1; y++) { World.setRail(x1, y); route.push([x1, y]); }
  return route;
}
/** a train of our own on `route`, kept running back and forth (the timetable left out of it) */
function ourTrain(route: number[][], prog = 0): any {
  Life.trainT = 1e9;
  const tr = { route, stopIdx: [0, route.length - 1], prog, dir: 1, pause: 0, type: 'local', speed: 2.6, cars: 4, lastStop: -1, lane: 0, x: 0, y: 0, dirx: 1, diry: 0 };
  Life.trains = [tr];
  Life.serviceWindow = () => true;
  return tr;
}

describe('the railway', () => {
  it('takes a bend on a curve as wide as the line has room for, and keeps that ground clear', () => {
    Game.boot(31);
    const route = layL(C.x - 30, C.y - 30, C.x - 10, C.y - 10);
    const bend = [C.x - 10, C.y - 30];
    expect(World.bendRadius(bend[0], bend[1])).toBe(3);
    // nothing can be built on the ground the curve sweeps across
    const inner = { x: bend[0] - 1, y: bend[1] + 1 };
    expect(World.curveTile(World.idx(inner.x, inner.y))).toBe(true);
    expect(World.canPlace('house', inner.x - 1, inner.y, 0)).toBe(false);
    // and the train goes round it smoothly: no step in its heading or its place anywhere along the line
    let prev = railPose(route, 0, 0, { x: 0, y: 0, hx: 1, hy: 0, dx: 1, dy: 0 });
    let px = prev.x, py = prev.y, ph = Math.atan2(prev.hx, prev.hy);
    for (let s = 0.02; s <= route.length - 1; s += 0.02) {
      const q = railPose(route, s, 0);
      expect(Math.hypot(q.x - px, q.y - py)).toBeLessThan(0.02 * 16 * 1.05);
      let dh = Math.abs(Math.atan2(q.hx, q.hy) - ph);
      if (dh > Math.PI) dh = 2 * Math.PI - dh;
      expect(dh).toBeLessThan(0.02 / 2.5); // (a curve of three tiles' radius turns ≤ 1/3 rad a tile)
      px = q.x; py = q.y; ph = Math.atan2(q.hx, q.hy);
    }
    void prev;
  });

  it('closes a level crossing in good time, and nothing is ever on the tracks while the train is', () => {
    const homes = town(4321, 8);
    for (let i = 0; i < 6; i++) build('house', C.x - 24 + i * 4, C.y + 10);
    build('office', C.x + 20, C.y + 12); build('shop', C.x - 18, C.y - 8); build('cafe', C.x + 14, C.y - 10);
    // a line straight down through the town, across its streets (in a column with no building in its way)
    let x = -1;
    for (let dx = -20; dx <= 30 && x < 0; dx++) {
      let clear = true, roads = 0;
      for (let y = C.y - 40; y <= C.y + 40 && clear; y++) { const i = World.idx(C.x + dx, y); if (World.bmap[i]) clear = false; if (World.roadMap[i]) roads++; }
      if (clear && roads >= 2) x = C.x + dx;
    }
    expect(x).toBeGreaterThan(0);
    const route: number[][] = [];
    for (let y = C.y - 40; y <= C.y + 40; y++) { World.setRail(x, y); route.push([x, y]); }
    Game.afterMapEdit();
    const crossings = route.map((t, k) => (World.crossings.has(World.idx(t[0], t[1])) ? k : -1)).filter((k) => k >= 0);
    expect(crossings.length).toBeGreaterThan(0);
    const tr = ourTrain(route, 0);
    Game.streetMode = true;
    Game.setSpeed(1);
    Sim.clock = 7 * 60 + 40;
    let onTracks = 0, early = Infinity, booms = Infinity, passes = 0;
    const warnedAt = new Map<number, number>(), crossed = new Set<string>();
    for (let step = 0; step < 6000; step++) {
      Game.tick(0.05);
      NOW += 50;
      const len = Life.trainLen(tr);
      for (const k of crossings) {
        const t = route[k], g = Life.gates.get(World.idx(t[0], t[1]));
        const ahead = (k - tr.prog) * tr.dir;
        if (g?.warn > 0 && !warnedAt.has(k)) warnedAt.set(k, ahead);
        if (!(g?.warn > 0)) warnedAt.delete(k);
        // the train's front gets there: how long ago did the lights start, and are the booms down?
        if (ahead <= 0 && ahead > -0.15 && warnedAt.has(k)) { early = Math.min(early, warnedAt.get(k)! / tr.speed); booms = Math.min(booms, g.lower); passes++; }
        for (const p of Sim.people) if (p.state === 'walk' && p.trip && Math.abs(p.x / 16 - t[0] - 0.5) < 0.5 && Math.abs(p.y / 16 - t[1] - 0.5) < 0.5) crossed.add(p.id + (p.trip.car ? 'c' : 'w'));
        // while any of the train is over the crossing, no one else is on it
        if (ahead <= 0.5 && ahead >= -(len + 0.5)) {
          for (const p of Sim.people) {
            if (p.state !== 'walk' || !p.trip) continue;
            if (Math.abs(p.x / 16 - t[0] - 0.5) < 0.5 && Math.abs(p.y / 16 - t[1] - 0.5) < 0.5) onTracks++;
          }
        }
      }
    }
    void homes;
    // (and the village did use the crossings meanwhile, by car)
    expect([...crossed].filter((s) => s.endsWith('c')).length).toBeGreaterThan(0);
    expect(passes).toBeGreaterThan(2);
    expect(early).toBeGreaterThan(9); // the lights flashing ten seconds or more before the train
    expect(booms).toBe(1); // and the booms right down
    expect(onTracks).toBe(0);
  }, 240000);
});

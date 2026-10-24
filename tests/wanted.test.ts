/* Crime and the wanted level (Milestone 2d): stars depend on who saw it,
   buildings hide the Founder and parks don't, stars drop out of sight,
   squad cars come by road from the station, and a stolen car goes home. */
import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { World } from '../src/sim/world';
import { Life } from '../src/sim/life';
import { Sim } from '../src/sim/agents';
import { emit } from '../src/sim/core';
import { Mind } from '../src/sim/mind';
import { Wanted } from '../src/player/wanted';

const TM = 8;

/** just enough of the Founder: a car (in hand), a body, and the hooks Wanted fills in */
function founder(x = 100, z = 100): any {
  return {
    driving: true, car: { x, z, yaw: 0, speed: 0 }, pos: { x, z }, yaw: 0, hijacked: null, vehicle: null,
    offence(kind: string) { emit('founderOffence', { kind, day: 1, clock: 0, x: 0, z: 0, at: 0 }); },
    hijack(v: any, hx: number, hz: number, yaw: number) { this.hijacked = v; Object.assign(this.car, { x: hx, z: hz, yaw }); },
    dropHijacked() { const v = this.hijacked; this.hijacked = null; this.onAbandon?.(v, this.car.x, this.car.z, this.car.yaw); },
  };
}
let current: Wanted | null = null;
function setup(): { f: any; w: Wanted; toasts: string[] } {
  const f = founder(), toasts: string[] = [];
  current?.dispose(); // one listening at a time
  current = new Wanted(f, (m) => toasts.push(m));
  return { f, w: current, toasts };
}
/** a building standing on one tile */
function building(b: any, tx: number, tz: number): any {
  World.buildings.push({ x: tx, y: tz, w: 1, h: 1, connected: true, residents: [], ...b });
  World.bmap[World.idx(tx, tz)] = World.buildings.length;
  return World.buildings[World.buildings.length - 1];
}
const crew = (x: number, z: number): any => ({ x: x * 2, y: z * 2, dirx: 1, diry: 0, phase: 'scene', wait: 1e9, path: [[0, 0]], prog: 0 });

beforeEach(() => {
  World.roadMap.fill(0);
  World.bmap.fill(0);
  World.buildings.length = 0;
  World.roadStamp = (World.roadStamp || 0) + 1;
  Life.police = [];
  Sim.people = [];
});

describe('the wanted level', () => {
  it('a traffic offence needs a crew to see it; a fresh crime while wanted adds a star', () => {
    const { f, w } = setup();
    f.offence('speeding');
    expect(w.stars).toBe(0); // nobody around
    Life.police.push(crew(130, 100));
    f.offence('red light');
    expect(w.stars).toBe(1);
    f.offence('speeding'); // mid-chase, the least of it
    expect(w.stars).toBe(1);
    f.offence('hit');
    expect(w.stars).toBe(2);
    (w as any).raiseCd = 0;
    f.offence('crash'); // only ★, but on top of a chase it's one more
    expect(w.stars).toBe(3);
  });

  it('a building in between hides the Founder; a park does not', () => {
    const { f, w } = setup();
    Life.police.push(crew(140, 100));
    const b = building({ id: 1, type: 'house' }, Math.floor(120 / TM), Math.floor(100 / TM));
    f.offence('speeding');
    expect(w.stars).toBe(0);
    b.type = 'park';
    f.offence('speeding');
    expect(w.stars).toBe(1);
  });

  it('villagers who see a crime call it in, and remember it', () => {
    const { f, w, toasts } = setup();
    const p: any = { state: 'walk', trip: {}, x: 110 * 2, y: 100 * 2, seed: 3, home: { x: 0, y: 0 } };
    Sim.people.push(p);
    f.offence('speeding'); // villagers don't report driving
    expect(w.stars).toBe(0);
    f.offence('hit');
    expect(w.stars).toBe(2);
    expect(toasts.join(' ')).toContain('a witness called it in');
    expect(p.mind.memories.at(-1).text).toContain('knock someone down');
  });

  it("a villager who can't stand the Founder reports their driving; loyal fans look the other way", () => {
    const { f, w, toasts } = setup();
    const p: any = { state: 'walk', trip: {}, x: 110 * 2, y: 100 * 2, seed: 3, home: { x: 0, y: 0 }, name: 'Ada', surname: 'Berg' };
    Sim.people.push(p);
    Mind.ensure(p).fo = 8;
    f.hijacked = { stolen: { home: 1, family: 'Bergs' } };
    f.offence('theft'); // a fan saw it: not reported
    expect(w.stars).toBe(0);
    p.mind.fo = -6;
    f.offence('red light');
    expect(w.stars).toBe(1);
    expect(toasts.join(' ')).toContain("a villager who can't stand you called it in");
  });

  it('while the Founder hides, someone who dislikes them tells the police where they are', () => {
    const { w } = setup();
    const p: any = { state: 'walk', trip: {}, x: 0, y: 0, seed: 3, home: { x: 0, y: 0 }, name: 'Ada', surname: 'Berg' };
    Mind.ensure(p).fo = 1;
    w.raise(2, 'a test', true);
    for (let s = 0; s < 10; s++) w.update(1);
    expect(w.tipOff(p)).toBe(false); // she doesn't mind the Founder
    p.mind.fo = -4;
    expect(w.tipOff(p)).toBe(true);
    expect(w.unseen).toBeLessThan(3);
    expect(w.tipOff(p)).toBe(false); // once in a while, not every step
  });

  it('out of sight long enough, a star drops, then the chase is over', () => {
    const { w, toasts } = setup();
    w.raise(2, 'a test', true);
    for (let s = 0; s < 25; s++) w.update(1);
    expect(w.stars).toBe(1);
    for (let s = 0; s < 17; s++) w.update(1);
    expect(w.stars).toBe(0);
    expect(toasts.at(-1)).toContain('lost the police');
  });

  it('squad cars drive from the station by road, and arrest a Founder who stops', () => {
    for (let x = 0; x <= 40; x++) World.roadMap[World.idx(x, 12)] = 1;
    building({ id: 9, type: 'police', door: { x: 2, y: 12 } }, 2, 11);
    const { f, w } = setup();
    Object.assign(f.car, { x: 30 * TM + 4, z: 12 * TM + 4 });
    let busted = 0;
    w.onBusted = (stars) => { busted = stars; };
    w.raise(1, 'speeding', true);
    w.update(0.05);
    const u = Life.police.find((q: any) => q.pursuit);
    expect(u).toBeTruthy();
    const d0 = Math.hypot(u.x / 2 - f.car.x, u.y / 2 - f.car.z);
    for (let s = 0; s < 3 / 0.05; s++) w.update(0.05);
    expect(Math.hypot(u.x / 2 - f.car.x, u.y / 2 - f.car.z)).toBeLessThan(d0 - 50); // ~85 km/h along the road
    for (let s = 0; s < 12 / 0.05 && !busted; s++) w.update(0.05);
    expect(busted).toBe(1);
  });

  it('a stolen car comes off the drive, and goes home once the Founder is well away', () => {
    const { f, w } = setup();
    const home = building({ id: 7, type: 'house', residents: [{ surname: 'Kim', seed: 1, home: { x: 0, y: 0 } }], cars: [{ free: true, seed: 3 }] }, 6, 6);
    w.steal({ b: home, car: home.cars[0], x: 50, z: 50, yaw: 0, color: new THREE.Color('#c0392b') });
    expect(home.cars.length).toBe(0);
    expect(f.hijacked.name).toBe("Kims' car");
    expect(w.stars).toBe(0); // nobody saw: the family will notice later
    f.dropHijacked();
    expect(f.pendingReturns()).toEqual([{ home: 7, car: { free: true, seed: 3 } }]);
    w.update(0.1);
    expect(home.cars.length).toBe(0); // the Founder is still beside it
    f.car.x = 500;
    w.update(0.1);
    expect(home.cars.length).toBe(1);
    expect(w.abandoned.length).toBe(0);
  });
});

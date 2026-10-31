/* The Auto village's sizes (V2): a hamlet, a village, a town with its railway, and the full town with one of every
   kind of building and every network (rail, airport, harbour and ferry), everything joined to the streets. */
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { World } from '../src/sim/world';
import { Sim } from '../src/sim/agents';
import { Life } from '../src/sim/life';
import { CAT } from '../src/sim/catalog';
import { AutoVillage } from '../src/sim/autovillage';

const count = (t: string): number => World.buildings.filter((b: any) => b.type === t).length;

describe('the Auto village, by size', () => {
  it('a hamlet is a crossroads with a dozen homes', () => {
    Game.boot(3);
    AutoVillage.build(4242, 0);
    expect(World.buildings.length).toBeLessThan(30);
    expect(World.buildings.filter((b: any) => CAT[b.type].res).length).toBeGreaterThanOrEqual(10);
    expect(Sim.people.length).toBeGreaterThan(15);
    expect(World.buildings.every((b: any) => b.connected)).toBe(true);
  });

  it('a town has a railway with stations, level crossings and trains', () => {
    Game.boot(3);
    AutoVillage.build(4242, 2);
    for (let i = 0; i < 20; i++) Game.tick(0.1);
    expect(count('trainstation')).toBeGreaterThanOrEqual(2);
    expect(World.crossings.size).toBeGreaterThan(0);
    expect(Life.trains.length).toBeGreaterThan(0);
    expect(World.buildings.length).toBeGreaterThan(120);
    expect(World.buildings.every((b: any) => b.connected)).toBe(true);
  });

  it('the full town has one of every kind of building, an airport, a harbour with its ferry, all connected', () => {
    Game.boot(3);
    AutoVillage.build(4242, 3);
    for (let i = 0; i < 20; i++) Game.tick(0.1);
    const types = new Set(World.buildings.map((b: any) => b.type));
    const missing = Object.keys(CAT).filter((k) => CAT[k].building && CAT[k].cat !== 'hidden' && !types.has(k));
    expect(missing).toEqual([]);
    expect(count('dock')).toBeGreaterThanOrEqual(2);
    expect(!!Life.ferry).toBe(true);
    expect(Life.trains.length).toBeGreaterThan(0);
    expect(World.buildings.every((b: any) => b.connected)).toBe(true);
  });
});

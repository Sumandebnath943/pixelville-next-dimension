/* Reputation (Milestone 2e): what villagers saw moves their opinion of the
   Founder, stories travel when neighbours chat (believed more between
   friends, passed on a limited number of times), opinions cool overnight,
   and the staff's view sets a business's prices. */
import { beforeEach, describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { Sim } from '../src/sim/agents';
import { Mind } from '../src/sim/mind';
import { Rep } from '../src/sim/reputation';

let nextId = 1;
/** a villager with a steady temperament (traits fixed so the numbers are predictable) */
function villager(name = 'Ada'): any {
  const p: any = { id: nextId++, name, surname: 'Berg', seed: 5, home: { x: 0, y: 0 }, kind: 'man' };
  Mind.init(p);
  p.mind.traits.caution = 0.5;
  p.mind.traits.curiosity = 0.5;
  Sim.people.push(p);
  return p;
}

beforeEach(() => {
  Sim.people = [];
  World.buildings.length = 0;
  Sim.day = 10;
});

describe('reputation', () => {
  it('what a villager sees moves their opinion, and they remember the story', () => {
    const p = villager();
    expect(Rep.of(p)).toBe(0);
    Rep.feel(p, -6, "was knocked down by the Founder's car", 'knocked Ada down with their car');
    expect(Rep.of(p)).toBeCloseTo(-6, 5); // caution 0.5: taken at face value
    expect(Rep.label(Rep.of(p))).toBe('Dislikes you');
    const mm = p.mind.memories.at(-1);
    expect(mm.kind).toBe('founder');
    expect(mm.gist).toBe('knocked Ada down with their car');
    Rep.feel(p, 20, 'something wonderful');
    expect(Rep.of(p)).toBe(10); // capped
  });

  it('stories travel when neighbours chat, believed more between friends, and only so far', () => {
    const victim = villager('Ada'), friend = villager('Bo'), stranger = villager('Cy'), far = villager('Di'), farther = villager('Ed');
    Rep.feel(victim, -6, "was knocked down by the Founder's car", 'knocked Ada down with their car');
    victim.mind.friends.set(friend.id, 1);
    expect(Rep.hearsay(victim, friend)).toBe(true);
    expect(Rep.hearsay(victim, stranger)).toBe(true);
    expect(Rep.of(friend)).toBeLessThan(Rep.of(stranger)); // a friend is believed
    expect(Rep.of(stranger)).toBeLessThan(0);
    expect(friend.mind.memories.at(-1).text).toBe('heard from Ada that the Founder knocked Ada down with their car');
    // the same story isn't heard twice
    expect(Rep.hearsay(victim, friend)).toBe(false);
    // passed on: victim → friend → far → farther, and no further
    expect(Rep.hearsay(friend, far)).toBe(true);
    expect(Rep.hearsay(far, farther)).toBe(true);
    const last = villager('Flo');
    expect(Rep.hearsay(farther, last)).toBe(false);
    // stale stories aren't worth telling
    const late = villager('Gus');
    Sim.day = 30;
    expect(Rep.hearsay(victim, late)).toBe(false);
  });

  it('a family shares the day over dinner', () => {
    const a = villager('Ada'), b = villager('Bo'), c = villager('Cy');
    Rep.feel(a, 4, 'the Founder brought Rex home', 'found the Bergs\' dog Rex and brought it home');
    Rep.household({ residents: [a, b, c] });
    expect(Rep.of(b)).toBeGreaterThan(0);
    expect(Rep.of(c)).toBeGreaterThan(0);
    expect(c.mind.memories.filter((m: any) => m.kind === 'founder').length).toBe(1); // heard once, not from everyone
  });

  it("a bad story can't raise the listener's view, even from a fan", () => {
    const fan = villager('Ada'), listener = villager('Bo');
    fan.mind.fo = 8;
    Rep.feel(fan, -0.5, 'saw the Founder run a red light', 'ran a red light');
    Rep.hearsay(fan, listener);
    expect(Rep.of(listener)).toBeLessThan(0);
  });

  it('opinions cool overnight and survive a save', () => {
    const p = villager();
    p.mind.fo = -5;
    Mind.reflect(p);
    expect(Rep.of(p)).toBeCloseTo(-4.85, 5);
    const q: any = { id: 99, seed: 1, home: { x: 0, y: 0 } };
    Mind.unpack(q, JSON.parse(JSON.stringify(Mind.pack(p))));
    expect(Rep.of(q)).toBeCloseTo(-4.85, 5);
    // a save from before opinions were kept: pieced together from what they remember
    const old: any = { id: 98, seed: 1, home: { x: 0, y: 0 } };
    Mind.unpack(old, { m: [{ day: 3, kind: 'founder', text: 'saw the Founder steal a car', feel: -2 }, { day: 4, kind: 'love', text: 'married', feel: 2 }] });
    expect(Rep.of(old)).toBe(-3);
  });

  it('the town has a view once enough people know the Founder', () => {
    for (let i = 0; i < 20; i++) villager();
    expect(Rep.town().label).toBe('A newcomer');
    for (const p of Sim.people.slice(0, 12)) p.mind.fo = -6;
    const t = Rep.town();
    expect(t.known).toBeCloseTo(0.6, 5);
    expect(t.label).toBe('Notorious');
    for (const p of Sim.people) p.mind.fo = 2;
    expect(Rep.town().label).toBe('Well liked');
  });

  it("staff who like the Founder give a discount; staff who can't stand them won't serve", () => {
    const a = villager(), b = villager();
    const shop: any = { workers: [a, b] };
    expect(Rep.price({ workers: [] }, 50)).toEqual({ cost: 50, rate: 1, note: '', refused: false });
    a.mind.fo = 5; b.mind.fo = 4;
    expect(Rep.price(shop, 50).cost).toBe(45);
    a.mind.fo = 9; b.mind.fo = 8;
    expect(Rep.price(shop, 50).cost).toBe(40);
    a.mind.fo = -7; b.mind.fo = -6;
    expect(Rep.price(shop, 50).refused).toBe(true);
    // a good customer is warmed to, but money only buys so much affection
    a.mind.fo = 0; b.mind.fo = 3.9;
    Rep.patron(shop, 300);
    expect(Rep.of(a)).toBeCloseTo(0.4, 5);
    expect(Rep.of(b)).toBe(4);
    Rep.patron(shop, 300);
    expect(Rep.of(b)).toBe(4);
  });

  it('PVTV spreads the big stories, but only if the village has a station', () => {
    const p = villager();
    expect(Rep.broadcast(-1)).toBe(false);
    expect(Rep.of(p)).toBe(0);
    World.buildings.push({ type: 'tvstation', connected: true } as any);
    expect(Rep.broadcast(-1)).toBe(true);
    expect(Rep.of(p)).toBeCloseTo(-0.9, 5);
  });
});

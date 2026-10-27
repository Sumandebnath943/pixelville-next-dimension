/* Interiors (Milestone 3a): every enterable building type has a room;
   rooms are the same every visit; the door, the counters, the seats and the
   machines can all be reached; and the door rules (hours, homes, ruins)
   hold. Buying over a counter pays the business and the server remembers. */
import { beforeEach, describe, expect, it } from 'vitest';
import { CAT } from '../src/sim/catalog';
import { Sim } from '../src/sim/agents';
import { Mind } from '../src/sim/mind';
import { INTERIOR, WARES, layoutFor, walkable } from '../src/interiors/plan';
import { doorState } from '../src/player/indoors';
import { buy, a, useOf } from '../src/player/shopping';
import { Wallet } from '../src/player/wallet';

// (V2: the farm's barn and the cab office at a taxi rank have rooms too)
const OUTDOOR = ['park', 'grandpark', 'plaza', 'playground', 'zoo', 'amusement', 'busstop', 'forest', 'pond', 'lake', 'river', 'mountain', 'peak', 'road', 'rail', 'bulldoze'];

describe('interiors', () => {
  beforeEach(() => { Sim.people = []; Sim.clock = 12 * 60; });

  it('every building you can walk into has a room; parks and roads do not', () => {
    for (const type of Object.keys(CAT)) {
      if (OUTDOOR.includes(type)) expect(INTERIOR[type], type).toBeUndefined();
      else expect(INTERIOR[type], type).toBeTruthy();
    }
    expect(layoutFor({ id: 1, type: 'park', w: 3, h: 3 })).toBeNull();
  });

  it('a room is the same every visit, and everything in it can be reached', () => {
    for (const type of Object.keys(INTERIOR)) {
      for (const [w, h] of [[1, 1], [2, 2], [4, 3]]) {
        const L = layoutFor({ id: 42, type, w, h })!;
        expect(layoutFor({ id: 42, type, w, h })).toEqual(L);
        // the way in and out is clear
        const exit = L.spots.find((s) => s.kind === 'exit')!;
        expect(walkable(L, exit.x, exit.z), `${type} exit`).toBe(true);
        expect(walkable(L, 0, L.d / 2 - 1.1), `${type} entrance`).toBe(true);
        for (const s of L.spots) {
          expect(Math.abs(s.x) < L.w / 2 && Math.abs(s.z) < L.d / 2, `${type} ${s.kind} inside`).toBe(true);
          if (s.kind !== 'seat') expect(walkable(L, s.x, s.z, 0.2), `${type} ${s.kind} at ${s.x},${s.z}`).toBe(true);
          // a counter has someone's place behind it
          if (s.kind === 'counter') expect(L.posts[s.post!], `${type} counter post`).toBeTruthy();
        }
        for (const q of [...L.posts, ...L.places]) expect(Math.abs(q.x) < L.w / 2 && Math.abs(q.z) < L.d / 2, `${type} place inside`).toBe(true);
      }
    }
  });

  it('furniture is in the way, the open floor is not', () => {
    const L = layoutFor({ id: 3, type: 'bakery', w: 2, h: 2 })!;
    const c = L.spots.find((s) => s.kind === 'counter')!;
    // the counter itself, just behind the customer's spot
    expect(walkable(L, c.x, c.z - 0.95)).toBe(false);
    expect(walkable(L, L.w, 0)).toBe(false); // through the wall
  });

  it('doors open by the hours; homes only to a welcome visitor; never into a ruin', () => {
    const shop: any = { type: 'bakery', residents: [] };
    expect(doorState(shop)).toBeNull();
    Sim.clock = 3 * 60;
    expect(doorState(shop)).toMatch(/^Closed/);
    expect(doorState({ ...shop, ruined: true })).toMatch(/ruin/);
    expect(doorState({ type: 'park' })).toBe('outdoor');
    const r: any = { state: 'in', seed: 1, home: { x: 0, y: 0 } };
    const home: any = { type: 'house', residents: [r] };
    r.at = home;
    expect(doorState(home, 0)).toMatch(/won't ask you in/);
    expect(doorState(home, 2)).toBeNull();
    r.state = 'walk';
    expect(doorState(home, 2)).toMatch(/Nobody/);
    expect(doorState({ type: 'lodge', residents: [] })).toBeNull();
  });

  it('buying pays the business, fills the bag, and the server remembers', () => {
    const w = new Wallet(), bag: any[] = [];
    const baker: any = { id: 1, name: 'Greta', seed: 2, home: { x: 0, y: 0 } };
    Mind.ensure(baker);
    const bakery: any = { type: 'bakery', funds: 0, workers: [baker] };
    const croissant = WARES.bakery[0];
    const r = buy(w, bag, bakery, croissant, baker);
    expect(r.ok).toBe(true);
    expect(r.msg).toContain('Greta hands you a croissant');
    expect(w.balance).toBe(120 - croissant.price);
    expect(bakery.funds).toBe(croissant.price);
    // (V2: food is had there and then, and picks the Founder up; things to keep go in the bag)
    expect(bag.length).toBe(0);
    expect(r.use?.heal).toBeGreaterThan(0);
    expect(baker.mind.memories.at(-1).text).toBe('served the Founder: croissant');
    // staff who like you knock some off; staff who can't stand you won't serve
    baker.mind.fo = 5;
    expect(buy(w, bag, bakery, WARES.bakery[2], baker).msg).toMatch(/\$4 \(10% off\)/); // a $5 loaf
    baker.mind.fo = -8;
    expect(buy(w, bag, bakery, croissant, baker)).toMatchObject({ ok: false });
    expect(a('Apple turnover')).toBe('an apple turnover');
    // V2: every trading place sells something, and what it sells is for something
    const florist: any = { type: 'florist', funds: 0, workers: [] }, tailor: any = { type: 'tailor', funds: 0, workers: [] };
    const tulips = buy(w, bag, florist, WARES.florist[0], null);
    expect(tulips.use?.gift).toBeGreaterThan(0);
    expect(bag.at(-1)).toMatchObject({ name: 'Bunch of tulips', gift: tulips.use!.gift });
    expect(buy(w, bag, tailor, WARES.tailor[1], null).use?.wear?.part).toBe('top');
    expect(useOf(WARES.barber[0], 'barber').groom).toBe(true);
    expect(useOf(WARES.pharmacy[1], 'pharmacy').heal).toBeGreaterThan(5);
    for (const t of ['autoshop', 'bank', 'farm', 'sawmill', 'taxistand', 'hospital', 'fire', 'school', 'church']) expect(WARES[t]?.length, t).toBeGreaterThan(0);
    expect(a('Tokens')).toBe('tokens');
  });
});

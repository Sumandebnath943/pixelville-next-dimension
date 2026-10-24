/* The Founder's wallet and GPS (Milestone 2b): money moves between the
   Founder and real balances, never from nowhere; routes follow the roads,
   shorten as the Founder goes, and end on arrival. */
import { beforeEach, describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { Wallet } from '../src/player/wallet';
import { Gps, distLabel } from '../src/player/gps';

describe('wallet', () => {
  it('pays out of a household and into a shop, and keeps the ledger', () => {
    const w = new Wallet();
    const home: any = { funds: 30 }, shop: any = { funds: 0, visitors: 0 };
    expect(w.earn(50, 'A thank-you', 'reward', home)).toBe(30); // only what they have
    expect(home.funds).toBe(0);
    expect(w.balance).toBe(150);
    expect(w.spend(2, 'Scratch card', 'purchase', shop)).toBe(true);
    expect(shop.funds).toBe(2);
    expect(shop.visitors).toBe(1);
    expect(w.spend(1000, 'Too dear')).toBe(false);
    expect(w.balance).toBe(148);
    expect(w.ledger.map((e) => e.amount)).toEqual([30, -2]);
    expect(w.day()).toEqual({ in: 30, out: 2 });
  });

  it('restores from a save, or starts fresh', () => {
    const w = new Wallet();
    w.restore(77, [{ day: 3, time: '09:00', amount: 5, label: 'x', kind: 'reward' }]);
    expect(w.balance).toBe(77);
    expect(w.ledger.length).toBe(1);
    w.restore(undefined, undefined);
    expect(w.balance).toBe(120);
    expect(w.ledger).toEqual([]);
  });
});

describe('gps', () => {
  beforeEach(() => {
    World.roadMap.fill(0);
    // an L of road: east along y = 20 from x = 10 to 30, then south along x = 30 to y = 40
    for (let x = 10; x <= 30; x++) World.roadMap[World.idx(x, 20)] = 1;
    for (let y = 20; y <= 40; y++) World.roadMap[World.idx(30, y)] = 1;
    World.roadStamp = (World.roadStamp || 0) + 1; // drop cached paths
  });

  it('routes along the roads and counts down as the Founder goes', () => {
    const g = new Gps();
    let arrived = '';
    g.onArrive = (d) => { arrived = d.label; };
    g.set(30 * 8 + 4, 40 * 8 + 4, 'The corner shop');
    g.update(0.1, 10 * 8 + 4, 20 * 8 + 4);
    expect(g.route.length).toBe(41); // 20 tiles east, 20 south, and the start
    expect(g.left).toBeCloseTo(40 * 8, 0);
    // halfway along the first leg the tiles behind are dropped
    g.update(0.1, 20 * 8 + 4, 20 * 8 + 4);
    expect(g.route[0]).toEqual([20, 20]);
    expect(g.left).toBeCloseTo(30 * 8, 0);
    // at the door: arrived, and the route is gone
    g.update(0.1, 30 * 8 + 4, 40 * 8 + 1);
    expect(arrived).toBe('The corner shop');
    expect(g.dest).toBeNull();
  });

  it('labels distances the way a phone would', () => {
    expect(distLabel(4)).toBe('10 m');
    expect(distLabel(236)).toBe('240 m');
    expect(distLabel(1530)).toBe('1.5 km');
  });
});

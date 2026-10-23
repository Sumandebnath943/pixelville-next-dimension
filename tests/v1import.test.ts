/* A PixelVille V1 save (v4, 128×128) must import into the 256² map: the
   village lands bottom-centre (offset 64, 128), keeps its building ids,
   people, minds and mayor, and its edge roads run on to the new map edge. */
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { World, GW } from '../src/sim/world';
import { Sim } from '../src/sim/agents';
import { Gov } from '../src/sim/gov';

function b64(arr: Uint8Array): string {
  let s = '';
  for (let i = 0; i < arr.length; i += 8192) s += String.fromCharCode(...arr.subarray(i, i + 8192));
  return btoa(s);
}

function v1Save(): string {
  const N = 128;
  const ground = new Uint8Array(N * N), tree = new Uint8Array(N * N), road = new Uint8Array(N * N), rail = new Uint8Array(N * N);
  // V1's starter road enters from the west edge on row 60 (two lanes)
  for (let x = 0; x < 40; x++) { road[60 * N + x] = 1; road[61 * N + x] = 1; }
  // V1 paves each building's door tile when it connects the auto-road
  road[59 * N + 21] = 1;
  road[59 * N + 27] = 1;
  // V1's sea along the bottom rows
  for (let y = 120; y < N; y++) for (let x = 0; x < N; x++) ground[y * N + x] = 1;
  return JSON.stringify({
    v: 4, gw: 128, name: 'Oldtown',
    ground: b64(ground), tree: b64(tree), road: b64(road), rail: b64(rail),
    mountains: [], nextId: 3,
    buildings: [
      { id: 1, t: 'house', x: 20, y: 57, variant: 1, level: 2, funds: 300, ruined: 0, con: 0, up: 0, ren: 0, own: 0, fdr: 0, lp: 0, cars: [3], bikes: 0, boat: 0, bad: 0 },
      { id: 2, t: 'shop', x: 26, y: 57, variant: 0, level: 1, funds: 90, ruined: 0, con: 0, up: 0, ren: 0, own: 0, fdr: 0, lp: 0, cars: [], bikes: 0, boat: 0, bad: 0 },
    ],
    extra: {
      clock: 600, day: 40, safety: 88, arrests: 2, crimes: 1, firesRecent: 0, graveCases: 0,
      gov: { leader: { name: 'Asha Okafor', kind: 'steady', personId: 1, electedDay: 29, term: 2, voteShare: 61, promise: null, built: ['Park'] }, treasury: 420, approval: 70, lastElection: 29, scandals: 0, needTimers: {}, unmetNeeds: {}, riotCd: 0, election: null, taxRate: 'normal' },
      people: [
        { id: 1, k: 'woman', sn: 'Okafor', n: 'Asha', s: 1234, a: 41, h: 1, w: 2, sc: 0, pt: 2, md: 1, ds: 3, ls: 'worker', asp: 'career', fp: 'wages', sr: 0.22, bk: 0, sv: 55, wm: 1.16, jd: 12, hu: 0, mo: 72, ob: 0, ln: 0, pf: 0, pg: 0,
          mind: { t: { social: 0.6, caution: 0.4, ambition: 0.7, thrift: 0.3, curiosity: 0.5 }, k: [1, 2], f: [[2, 0.8]], v: [[2, 3]], m: [{ day: 30, kind: 'love', text: 'married Dev Okafor', feel: 2, venueId: 0 }], g: {} } },
        { id: 2, k: 'man', sn: 'Okafor', n: 'Dev', s: 4321, a: 43, h: 1, w: 0, sc: 0, pt: 1, md: 1, ds: 3, ls: 'shopkeeper', asp: 'business', fp: 'wages', sr: 0.46, bk: 'bakery', sv: 80, wm: 1, jd: 0, hu: 0, mo: 64, ob: 0, ln: 0, pf: 0, pg: 0, mind: 0 },
      ],
      nextPid: 3, stocks: null, drought: 0, tasks: { items: [], news: [] }, history: [], tier: 0, scenario: null,
      meta: { name: 'Oldtown', day: 40, pop: 2, at: 0 },
    },
  });
}

describe('V1 save import', () => {
  it('stamps a V1 village into the bottom-centre of the 256² map', () => {
    Game.boot(1);
    const r = Game.performLoad(v1Save());
    expect(r.ok).toBe(true);
    expect(World.name).toBe('Oldtown');
    const house = World.buildings.find((b: any) => b.id === 1);
    expect(house).toBeTruthy();
    expect([house.x, house.y]).toEqual([20 + 64, 57 + 128]);
    expect(house.level).toBe(2);
    expect(house.connected).toBe(true);
    // the people, their family ties, job and memories survive
    expect(Sim.day).toBe(40);
    const asha = Sim.people.find((p: any) => p.name === 'Asha');
    expect(asha.home).toBe(house);
    expect(asha.work && asha.work.type).toBe('shop');
    expect(asha.partnerId).toBe(2);
    expect(asha.mind.memories[0].text).toBe('married Dev Okafor');
    expect(Gov.leader.name).toBe('Asha Okafor');
    // V1's west-edge road now runs all the way to the new map's west edge
    expect(World.isRoad(0, 60 + 128)).toBe(true);
    // the Founder's Lodge is added to an imported village
    expect(Game.lodge()).toBeTruthy();
    expect(GW).toBe(256);
  });
});

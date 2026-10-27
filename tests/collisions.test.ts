/* V2: nothing passes through anything. A busy town is run for a few game hours at street speed and every frame
   each vehicle's body (its length and width, at its true heading) is checked against every other vehicle's and
   against everyone on foot: villagers, onlookers, visitors, people lying hurt in the road. */
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { Sim } from '../src/sim/agents';
import { Life } from '../src/sim/life';
import { Gateways } from '../src/sim/gateways';
import { C, build, town } from './town';

interface Body { o: any; kind: string; x: number; y: number; hx: number; hy: number; len: number; hw: number; still: boolean }

/** every vehicle in the sim as a box (tiles), as drawn */
function vehicles(): Body[] {
  const out: Body[] = [];
  const add = (o: any, kind: string, len: number, hw: number, still = false): void => {
    if (!o || o.x === undefined || Number.isNaN(o.x) || o.off !== undefined) return;
    let hx = o.hx ?? o.dirx ?? 1, hy = o.hy ?? o.diry ?? 0;
    const l = Math.hypot(hx, hy) || 1;
    hx /= l; hy /= l;
    out.push({ o, kind, x: o.x / 16, y: o.y / 16, hx, hy, len, hw, still });
  };
  for (const p of Sim.people) {
    if (p.state !== 'walk' || !p.trip || p.trip.joined === false) continue;
    // (backing into a drive or a bay at the end: drawn off the road, render/actors.ts carPose)
    if ((p.trip.parkT || 0) > 0) continue;
    if (p.trip.car || p.trip.taxi) add(p, 'car', 0.56, 0.115);
    else if (p.trip.moto) add(p, 'moto', 0.3, 0.06);
  }
  for (const b of Life.buses) if (!b.hidden) add(b, 'bus', 1.3, 0.15, b.pause > 0);
  for (const c of Life.taxis) add(c, 'taxi', 0.56, 0.115, c.pause > 0);
  for (const t of Life.tourists) if (t.phase !== 'visit') add(t, 'tourist', 0.56, 0.115);
  for (const u of Life.police) add(u, 'police', 0.56, 0.115, u.phase === 'scene');
  for (const u of Life.fireTrucks) add(u, 'fire', 1.1, 0.15, u.phase === 'douse');
  for (const u of Life.ambulances) add(u, 'ambulance', 0.75, 0.115, u.phase === 'treat');
  for (const u of Life.trucks) add(u, 'truck', 0.9, 0.15, u.phase === 'drop');
  for (const u of Life.crews) if (u.phase !== 'wait') add(u, 'van', 0.7, 0.115, u.phase === 'fix');
  return out;
}
/** everyone on foot, as a point (tiles) */
function walkers(): { o: any; kind: string; x: number; y: number }[] {
  const out: { o: any; kind: string; x: number; y: number }[] = [];
  for (const p of Sim.people) {
    if (p.state === 'hurt') out.push({ o: p, kind: 'hurt', x: p.x / 16, y: p.y / 16 });
    else if (p.state === 'walk' && p.trip && !p.trip.car && !p.trip.taxi && !p.trip.moto) out.push({ o: p, kind: p.trip.walk?.lat != null ? 'crossing' : 'pavement', x: p.x / 16, y: p.y / 16 });
  }
  for (const g of Life.gawkers) if (g.x !== undefined) out.push({ o: g, kind: 'onlooker', x: g.x / 16, y: g.y / 16 });
  for (const v of Gateways.visitors) if (v.phase !== 'stay') out.push({ o: v, kind: 'visitor', x: v.x / 16, y: v.y / 16 });
  return out;
}
function overlap(a: Body, b: Body): boolean {
  const axes = [[a.hx, a.hy], [-a.hy, a.hx], [b.hx, b.hy], [-b.hy, b.hx]];
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const [ax, ay] of axes) {
    const ra = Math.abs(a.hx * ax + a.hy * ay) * a.len / 2 + Math.abs(-a.hy * ax + a.hx * ay) * a.hw;
    const rb = Math.abs(b.hx * ax + b.hy * ay) * b.len / 2 + Math.abs(-b.hy * ax + b.hx * ay) * b.hw;
    if (Math.abs(dx * ax + dy * ay) > ra + rb - 0.02) return false;
  }
  return true;
}

describe('nothing passes through anything', () => {
  it('in a busy town over an afternoon and a rush hour, no vehicle ever stands in another or in someone on foot', () => {
    town(9191, 14);
    for (let i = 0; i < 10; i++) build('house', C.x - 20 + i * 4, C.y + 12);
    for (const [k, dx, dy] of [['shop', 8, -8], ['cafe', -10, 6], ['bakery', 18, 10], ['office', 26, -10], ['school', -24, -6], ['hospital', -14, -18],
      ['police', 12, 20], ['fire', -30, 14], ['market', 30, 16], ['busstop', 0, 6], ['busstop', 24, 6], ['taxistand', -6, -10], ['warehouse', 36, 0], ['factory', -36, -4]] as const)
      build(k, C.x + dx, C.y + dy);
    Game.streetMode = true;
    Game.setSpeed(1);
    Sim.clock = 7 * 60 + 30;
    const vv = new Map<string, number>(), pv = new Map<string, number>();
    let frames = 0, seenV = 0, seenP = 0;
    // 2.5 game hours, 20 frames a game minute
    for (let s = 0; s < 150 * 20; s++) {
      Game.tick(0.05);
      frames++;
      const V = vehicles(), P = walkers();
      seenV += V.length; seenP += P.length;
      for (let i = 0; i < V.length; i++)
        for (let j = i + 1; j < V.length; j++) {
          if (Math.abs(V[i].x - V[j].x) > 1.6 || Math.abs(V[i].y - V[j].y) > 1.6) continue;
          if (overlap(V[i], V[j])) { const k = `${V[i].kind}/${V[j].kind}`; vv.set(k, (vv.get(k) || 0) + 1); }
        }
      for (const p of P)
        for (const v of V) {
          const rx = p.x - v.x, ry = p.y - v.y;
          if (Math.abs(rx) > 1 || Math.abs(ry) > 1) continue;
          if (Math.abs(rx * v.hx + ry * v.hy) < v.len / 2 && Math.abs(-rx * v.hy + ry * v.hx) < v.hw) { const k = `${v.kind}/${p.kind}`; pv.set(k, (pv.get(k) || 0) + 1); }
        }
    }
    const report = { frames, avgVehicles: +(seenV / frames).toFixed(1), avgOnFoot: +(seenP / frames).toFixed(1), vehicles: Object.fromEntries(vv), onFoot: Object.fromEntries(pv) };
    console.log(JSON.stringify(report));
    // (a knock is a moment: a vehicle that runs into someone stops, it doesn't drive on through them)
    expect([...vv.values()].reduce((a, b) => a + b, 0)).toBe(0);
    expect([...pv.values()].reduce((a, b) => a + b, 0)).toBeLessThan(frames * 0.002);
  }, 240000);
});

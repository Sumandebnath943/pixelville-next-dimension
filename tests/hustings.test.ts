/* V2: an election on the ground — rallies on a green before dark and a polling station open 08:00–18:00,
   with real villagers walking there and home; nothing of it in the road, nothing of it out at night */
import { describe, it, expect } from 'vitest';
import { town, build, until, C } from './town';
import { Sim } from '../src/sim/agents';
import { Gov } from '../src/sim/gov';
import { Life } from '../src/sim/life';
import { World } from '../src/sim/world';
import { Weather } from '../src/sim/weather';
import { Hustings, sunset } from '../src/sim/hustings';

const onRoad = (x: number, y: number): boolean => World.isRoad(Math.floor(x / 16), Math.floor(y / 16));
const civic = (): any[] => Sim.people.filter((p: any) => p.trip && p.trip.civic);
/** standing on the ground (not walking onto it or off it) */
const standing = (p: any): boolean => ['at', 'climb', 'queue', 'booth', 'mark', 'box'].includes(p.trip.civic.phase);

/** a village with a town hall on weekday `day`, in fine weather that holds */
function village(day: number): void {
  town(4242, 12);
  build('townhall', C.x + 4, C.y + 7);
  Sim.day = day;
  Sim.clock = 30;
  Weather.season = Weather.seasonOf(day);
  Weather.kind = 'clear'; Weather.intensity = 0; Weather.target = 0; Weather.nextChange = 1e9;
  for (const p of Sim.people) p.cond = null; // (a candidate down with flu calls their rally off)
}

/** run today's rally through; what was seen of it */
function rally(): { spoke: number; crowd: number; offGround: number; night: number; log: string } {
  const day = Sim.day, dusk = sunset();
  let spoke = 0, crowd = 0, offGround = 0, night = 0, log = '', last = '';
  until(() => {
    const r = Life.rally;
    if (r) {
      // (what happened, for a failure message)
      const sp = r.speakerId ? Sim.people.find((p: any) => p.id === r.speakerId) : null;
      const s = `${r.phase} ${sp ? sp.state + '@' + (sp.at && sp.at.type) + ':' + (sp.trip && sp.trip.civic ? sp.trip.civic.phase : '-') : 'stand-in'}`;
      if (s !== last) { log += `${Math.round(Sim.clock)} ${s}; `; last = s; }
      if (Sim.clock < 540 || Sim.clock > 1290) night++;
      if (onRoad(r.x, r.y)) offGround++;
      if (r.phase === 'speech') {
        spoke++;
        if (Sim.clock > dusk) night++; // (the speech is over before the sun sets)
      }
    }
    const here = civic().filter((p) => p.trip.civic.kind === 'rally' && standing(p));
    crowd = Math.max(crowd, here.length);
    for (const p of here) if (onRoad(p.x, p.y)) offGround++;
    return Sim.day > day;
  }, 1500);
  return { spoke, crowd, offGround, night, log };
}

describe('hustings', () => {
  it('holds a summer rally on a green at 18:00, with villagers who walk there and back home', () => {
    village(9);
    Gov.startCampaign(Sim.day + 4, false, 'test');
    Gov.campaignTick(); // (as at the start of the day) plans today's rally
    expect(Hustings.plan.speech).toBe(1080);
    const seen = rally();
    expect(seen.spoke, seen.log).toBeGreaterThan(0);
    expect(seen.crowd).toBeGreaterThan(2);
    expect(seen.offGround).toBe(0);
    expect(seen.night).toBe(0);
    // over, packed away, and everyone home
    expect(Life.rally).toBeNull();
    expect(civic().length).toBe(0);
  });

  it('holds a winter rally in the afternoon, over before dark', () => {
    village(23);
    Gov.startCampaign(Sim.day + 4, false, 'test');
    Gov.campaignTick();
    expect(Hustings.plan.speech + 75).toBeLessThan(sunset());
    const seen = rally();
    expect(seen.spoke, seen.log).toBeGreaterThan(0);
    expect(seen.offGround).toBe(0);
    expect(seen.night).toBe(0);
    expect(civic().length).toBe(0);
  });

  it('runs polling day 08:00–18:00, voters queueing on the green, gone by night', () => {
    village(9);
    Gov.startCampaign(Sim.day, false, 'test'); // polling day today
    Gov.campaignTick();
    const day = Sim.day;
    let open = false, offGround = 0, outOfHours = 0, voted = 0, queued = 0;
    until(() => {
      const vb = Life.votingBooths;
      if (vb) {
        open = true;
        if (Sim.clock < 450 || Sim.clock > 1170) outOfHours++; // (up 07:30, closed 18:00, packed away soon after)
        voted = Math.max(voted, vb.voted.size);
        queued = Math.max(queued, vb.queue.length);
        for (const b of vb.booths) if (onRoad(b.x, b.y)) offGround++;
      }
      for (const p of civic()) if (standing(p) && onRoad(p.x, p.y)) offGround++;
      if (Sim.clock > 1290 && Sim.clock < 1430 && civic().length) outOfHours++;
      return Sim.day > day;
    }, 1500);
    expect(open).toBe(true);
    expect(voted).toBeGreaterThan(3);
    expect(queued).toBeGreaterThan(0);
    expect(offGround).toBe(0);
    expect(outOfHours).toBe(0);
    expect(Life.votingBooths).toBeNull();
    // whoever drove over to vote took their car home again: no family car left stranded at the hall
    const inUse = new Set(Sim.people.flatMap((p: any) => [p.carHeld, p.trip && p.trip.car].filter(Boolean)));
    const stranded = World.buildings.flatMap((b: any) => b.cars || []).filter((c: any) => !c.free && !inUse.has(c));
    expect(stranded.length).toBe(0);
    expect(World.buildings.every((b: any) => (b.parked || 0) >= 0 && (b.inside || 0) >= 0)).toBe(true);
  });
});

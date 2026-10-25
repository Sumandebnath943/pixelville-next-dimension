/* Health & ambulances (Milestone 4a): a serious injury brings an ambulance from
   the hospital by road and a bed on the ward; recovery, the bill and discharge;
   no hospital means neighbours help them home; a full ward sends people home;
   the frail get the flu worse; the Founder's car hurts at speed; saves keep it. */
import { describe, expect, it, vi } from 'vitest';
import { Game } from '../src/sim/game';
import { Sim } from '../src/sim/agents';
import { Life } from '../src/sim/life';
import { World } from '../src/sim/world';
import { Health, SERIOUS } from '../src/sim/health';
import { C, build, roadPx, run, town, until } from './town';

describe('health and ambulances', () => {
  it('a serious injury in the street brings an ambulance, then a bed on the ward, then home', () => {
    const homes = town(101);
    const h = build('hospital', C.x + 14, C.y + 10);
    expect(h).toBeTruthy();
    const p = homes[0].residents.find((r: any) => r.kind !== 'kid');
    const at = roadPx(homes[0]);
    expect(Health.injure(p, 60, 'in a test', at)).toBe(true);
    expect(p.state).toBe('hurt');
    expect(p.cond.sev).toBe(60);
    expect(Life.ambulances.length).toBe(1);
    expect(Life.ambulances[0].from).toBe(h);
    // the crew reaches them, treats them, drives them in
    expect(until(() => p.state === 'amb', 240)).toBe(true);
    expect(until(() => !!p.ward, 240)).toBe(true);
    expect(p.at).toBe(h);
    expect(p.state).toBe('in');
    expect(Health.patients(h)).toContain(p);
    // (no ambulance still carries them; another villager may have been hurt meanwhile)
    expect(Life.ambulances.some((a: any) => a.patient === p)).toBe(false);
    // mends on the ward and is discharged (with a bill) by day
    const takings = h.funds;
    expect(until(() => !p.ward, 1440 * 4)).toBe(true);
    expect(h.funds).toBeGreaterThan(takings); // the bill
    // (they may since have caught a cold; the injury itself is mostly mended)
    expect(!p.cond || p.cond.k !== 'injury' || p.cond.sev < 14).toBe(true);
  });

  it('with no hospital in town, the neighbours help the injured home', () => {
    const homes = town(102);
    const p = homes[1].residents.find((r: any) => r.kind !== 'kid');
    expect(Health.injure(p, 50, 'in a test', roadPx(homes[1]))).toBe(true);
    expect(Life.ambulances.length).toBe(0);
    expect(p.helpT).toBeGreaterThan(0);
    expect(until(() => p.state === 'in', 120)).toBe(true);
    expect(p.at).toBe(p.home);
    expect(p.cond.sev).toBeGreaterThan(0); // still mending, more slowly
    expect(Health.resting(p)).toBe(true);
  });

  it('mild knocks keep people on their feet, and nobody dies of an injury', () => {
    const homes = town(103);
    const p = homes[0].residents.find((r: any) => r.kind !== 'kid');
    expect(Health.injure(p, 15, 'in a scuffle')).toBe(false);
    expect(p.state).toBe('in');
    expect(p.cond.k).toBe('injury');
    expect(Health.injure(p, 95, 'by a falling tree', roadPx(homes[0]))).toBe(true);
    run(600);
    expect(Sim.people).toContain(p);
  });

  it('a full ward patches people up and sends them home', () => {
    const homes = town(104, 8);
    const h = build('hospital', C.x + 14, C.y + 10);
    h.workers.length = 0; // no staff: the fewest beds
    const beds = Health.beds(h);
    expect(beds).toBe(4);
    const adults = Sim.people.filter((r: any) => r.kind !== 'kid').slice(0, beds + 1);
    for (const p of adults) { p.state = 'in'; p.at = h; h.inside++; p.cond = { k: 'injury', sev: 50, day: Sim.day }; Health.admit(p, h); }
    expect(Health.patients(h).length).toBe(beds);
    expect(adults[beds].ward).toBeFalsy();
    expect(adults[beds].returnAt).toBeGreaterThan(0); // seen in casualty, sent home
    void homes;
  });

  it('the old take the flu harder, and the seriously ill go to hospital', () => {
    town(105);
    const h = build('hospital', C.x + 14, C.y + 10);
    const young = Sim.people.find((r: any) => r.kind !== 'kid');
    const old = Sim.people.find((r: any) => r.kind !== 'kid' && r !== young);
    young.age = 25; old.age = 82;
    // the same illness on the same dice: the older one has it worse
    const dice = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    young.cond = null; old.cond = null; old.state = 'walk'; young.state = 'walk'; // (no hospital trips while sampling)
    Health.fallIll(young); Health.fallIll(old);
    dice.mockRestore();
    expect(old.cond.sev).toBeGreaterThan(young.cond.sev * 1.3);
    // pneumonia at 82: the ambulance comes to the door
    old.state = 'in'; old.at = old.home; old.cond = { k: 'pneumonia', sev: SERIOUS + 20, day: Sim.day };
    Health.seekCare(old);
    expect(old.state).toBe('hurt');
    expect(Life.ambulances.some((a: any) => a.patient === old && a.from === h)).toBe(true);
  });

  it("the Founder's car at speed puts someone in hospital; a nudge doesn't", () => {
    const homes = town(106);
    build('hospital', C.x + 14, C.y + 10);
    const [a, b] = Sim.people.filter((r: any) => r.kind !== 'kid');
    const at = roadPx(homes[0]);
    a.x = at.x; a.y = at.y; b.x = at.x; b.y = at.y;
    Life.founderHitPerson(a, 2);
    expect(a.state).toBe('in');
    expect(a.knocked).toBe(true);
    Life.founderHitPerson(b, 12);
    expect(b.state).toBe('hurt');
    expect(Life.ambulances.some((u: any) => u.patient === b)).toBe(true);
  });

  it('a patient on the ward is still there after a save and load', () => {
    const homes = town(107);
    const h = build('hospital', C.x + 14, C.y + 10);
    const p = homes[0].residents.find((r: any) => r.kind !== 'kid');
    p.state = 'in'; p.at = h; h.inside++; p.cond = { k: 'injury', sev: 70, day: Sim.day, cause: 'in a test' };
    Health.admit(p, h);
    const s = Game.buildSaveString();
    expect(Game.performLoad(s).ok).toBe(true);
    const q = Sim.people.find((r: any) => r.id === p.id);
    expect(q.ward).toBe(h.id);
    expect(q.at.id).toBe(h.id);
    expect(q.cond.sev).toBe(70);
    expect(q.cond.cause).toBe('in a test');
    expect(World.buildings.find((b: any) => b.id === h.id).inside).toBeGreaterThan(0);
  });
});

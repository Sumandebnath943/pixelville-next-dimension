/* Education (Milestone 4c): graduate posts need a degree and pay more; days at
   college earn a degree (slower without lecturers); kids who went to school
   leave with a certificate; a post nobody can fill draws a skilled family in. */
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/agents';
import { DEGREE_DAYS, Edu, SKILL_PAY } from '../src/sim/education';
import { C, build, town } from './town';

describe('education', () => {
  it('graduate posts need a degree, and graduates in them earn more', () => {
    town(301, 8);
    const h = build('hospital', C.x + 14, C.y + 10);
    expect(Edu.posts(h)).toBe(7); // half of 14: the doctors
    for (const p of h.workers.slice()) { p.work = null; }
    h.workers.length = 0;
    const school = Sim.people.find((p: any) => p.kind !== 'kid');
    school.edu = 1;
    // ordinary posts fill first; then only graduates get in
    for (let i = 0; i < 7; i++) h.workers.push({ edu: 1 });
    expect(Edu.canTake(school, h)).toBe(false);
    const grad = { edu: 2 };
    expect(Edu.canTake(grad, h)).toBe(true);
    expect(Edu.open(h)).toBe(7);
    expect(Edu.payMult(grad, h)).toBe(SKILL_PAY);
    expect(Edu.payMult(school, h)).toBe(1);
    const shop = build('shop', C.x + 4, C.y + 6);
    expect(Edu.posts(shop)).toBe(0);
    expect(Edu.payMult(grad, shop)).toBe(1);
  });

  it('days at the college earn a degree, more slowly without lecturers', () => {
    town(302);
    const college = build('college', C.x + 12, C.y + 12);
    const p = Sim.people.find((q: any) => q.kind !== 'kid');
    p.edu = 1; p.collegeDays = 0;
    college.workers.length = 0; // no lecturers: each day counts for 0.4
    for (let d = 0; d < DEGREE_DAYS; d++) { Sim.day = 100 + d; Edu.arrive(p, college); }
    expect(p.edu).toBe(1);
    expect(p.collegeDays).toBeCloseTo(DEGREE_DAYS * 0.4, 5);
    // fully staffed with graduate lecturers: full days
    for (let i = 0; i < Edu.posts(college); i++) college.workers.push({ edu: 2 });
    for (let d = 0; d < DEGREE_DAYS; d++) { Sim.day = 200 + d; Edu.arrive(p, college); }
    expect(p.edu).toBe(2);
    expect(p.enrolled).toBe(false);
  });

  it('kids who went to school leave with a certificate', () => {
    town(303);
    const kid: any = { kind: 'kid', schoolDays: 12 };
    Edu.comeOfAge(kid);
    expect(kid.edu).toBe(1);
    const truant: any = { kind: 'kid', schoolDays: 3 };
    Edu.comeOfAge(truant);
    expect(truant.edu).toBe(0);
  });

  it('a graduate post nobody in town can fill draws a skilled family in', () => {
    town(304, 3);
    const h = build('hospital', C.x + 14, C.y + 10);
    for (const p of Sim.people) if (p.edu >= 2) p.edu = 1; // nobody here holds a degree
    const vacant = build('house', C.x - 10, C.y + 4, true);
    for (const r of vacant.residents.slice()) Sim.removePerson(r, true);
    const before = Sim.people.length;
    let moved = false;
    for (let i = 0; i < 40 && !moved; i++) { Edu.migrateDay = -1; moved = Edu.migrate([vacant]); }
    expect(moved).toBe(true);
    expect(Sim.people.length).toBeGreaterThan(before);
    const doctor = vacant.residents.find((r: any) => r.edu === 2);
    expect(doctor).toBeTruthy();
    expect(doctor.work).toBe(h);
  });

  it('essential services hire first, and graduate promotions leave them alone', () => {
    town(305, 8);
    const shop = build('market', C.x + 4, C.y + 8);
    const plant = build('powerplant', C.x + 8, C.y - 8);
    // everyone works at the market; the plant stands empty
    for (const p of Sim.people) if (p.kind !== 'kid') { if (p.work) p.work.workers = p.work.workers.filter((q: any) => q !== p); p.work = null; }
    for (const w of [shop, plant]) w.workers.length = 0;
    shop.jobs = 99;
    for (const p of Sim.people) if (p.kind !== 'kid') { p.work = shop; shop.workers.push(p); p.edu = 2; }
    Sim.staffEssentials();
    expect(plant.workers.length).toBe(2);
    const hired = plant.workers[0];
    expect(Edu.promote(hired)).toBe(false); // a graduate at the power plant stays put
  });

  it('old saves get seeded schooling: mostly school leavers, some graduates', () => {
    const counts = [0, 0, 0];
    for (let s = 0; s < 1000; s++) { const p: any = { kind: 'man', seed: s * 7919 }; Edu.init(p); counts[p.edu]++; }
    expect(counts[1]).toBeGreaterThan(counts[2]);
    expect(counts[2]).toBeGreaterThan(100);
    expect(counts[0]).toBeGreaterThan(50);
  });
});

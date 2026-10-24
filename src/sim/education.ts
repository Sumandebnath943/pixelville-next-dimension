/* ============================================================
   Education that matters (V2, design §9.3).
   Every villager carries a level of schooling: none, a school
   leaving certificate, or a college degree. Kids earn the
   certificate by turning up to school; adults earn a degree by
   sitting enough days at the college (the jobless go most days,
   the ambitious take study days off work). Some posts need a
   degree (doctors, engineers, lecturers, bankers, pilots, …)
   and pay graduates more. Posts nobody in town can fill stay
   empty, or draw a skilled family in from outside.
   ============================================================ */
import { CAT } from './catalog';
import { Sim } from './agents';
import { Life } from './life';
import { Mind } from './mind';
import { World } from './world';
import { Settings } from './settings';
import { Gateways } from './gateways';

export const EDU_NONE = 0, EDU_SCHOOL = 1, EDU_DEGREE = 2;
export const EDU_LABEL = ['No schooling', 'School leaver', 'College degree'];

/** the share of a workplace's posts that need a degree, and what those people are called */
export const SKILLED: Record<string, { k: number; title: string }> = {
  hospital: { k: 0.5, title: 'doctors' },
  college: { k: 0.7, title: 'lecturers' },
  school: { k: 0.5, title: 'teachers' },
  powerplant: { k: 0.4, title: 'engineers' },
  bank: { k: 0.5, title: 'bankers' },
  exchange: { k: 0.7, title: 'traders' },
  airport: { k: 0.35, title: 'pilots' },
  tvstation: { k: 0.5, title: 'broadcasters' },
  courthouse: { k: 0.5, title: 'lawyers' },
  office: { k: 0.3, title: 'managers' },
  skyscraper: { k: 0.35, title: 'managers' },
  townhall: { k: 0.25, title: 'officials' },
  pharmacy: { k: 0.34, title: 'pharmacists' },
};
/** services that hire first and keep their people (agents.ts staffEssentials) */
export const ESSENTIAL = ['hospital', 'powerplant', 'fire', 'police', 'watertower', 'school'];
/** a graduate in a graduate post earns this much more */
export const SKILL_PAY = 1.45;
/** days at college for a degree (fully staffed); days at school for the certificate */
export const DEGREE_DAYS = 12, SCHOOL_DAYS = 10;

const isGrad = (p: any): boolean => (p.edu || 0) >= EDU_DEGREE;

export const Edu = {
  /** graduate posts at a workplace */
  posts(b: any): number {
    const s = SKILLED[b.type];
    return s ? Math.ceil((b.jobs || 0) * s.k) : 0;
  },
  graduates(b: any): number {
    return b.workers.filter(isGrad).length;
  },
  /** graduate posts filled by graduates */
  filled(b: any): number {
    return Math.min(this.posts(b), this.graduates(b));
  },
  /** how well staffed with graduates a place is, 0…1 (1 where none are needed) */
  ratio(b: any): number {
    const n = this.posts(b);
    return n ? this.filled(b) / n : 1;
  },
  /** graduate posts still waiting for a graduate (only while there's a vacancy at all) */
  open(b: any): number {
    if (b.workers.length >= b.jobs) return 0;
    return Math.max(0, this.posts(b) - this.graduates(b));
  },
  /** may `p` be hired at `w`? Everyone but graduates is limited to the ordinary posts */
  canTake(p: any, w: any): boolean {
    if (w.workers.length >= w.jobs) return false;
    if (isGrad(p)) return true;
    const ordinary = w.workers.filter((q: any) => !isGrad(q)).length;
    return ordinary < w.jobs - this.posts(w);
  },
  payMult(p: any, w: any): number {
    return isGrad(p) && SKILLED[w.type] ? SKILL_PAY : 1;
  },
  title(type: string): string {
    return SKILLED[type]?.title || 'staff';
  },
  label(p: any): string {
    if (p.kind === 'kid') return p.school ? `At school · ${p.schoolDays || 0} days so far` : 'Not at school';
    const base = EDU_LABEL[p.edu || 0];
    if (p.enrolled && !isGrad(p)) return `${base} · studying at the college (${Math.round(p.collegeDays || 0)} of ${DEGREE_DAYS} days)`;
    return base;
  },

  /** a newcomer's schooling: most adults left school, some hold a degree (seeded, so old saves agree) */
  init(p: any): void {
    if (p.edu !== undefined) return;
    if (p.kind === 'kid') { p.edu = EDU_NONE; return; }
    const r = ((p.seed * 2654435761) >>> 0) % 100;
    p.edu = r < 14 ? EDU_NONE : r < 80 ? EDU_SCHOOL : EDU_DEGREE;
  },

  /** someone walked in at `dest`: a school day for a kid, a study day at the college */
  arrive(p: any, dest: any): void {
    const d = CAT[dest.type];
    if (d.school && p.kind === 'kid' && p.schoolDay !== Sim.day) {
      p.schoolDay = Sim.day;
      p.schoolDays = (p.schoolDays || 0) + 1;
    }
    if (d.college && p.kind !== 'kid' && p.studyDay !== Sim.day) {
      p.studyDay = Sim.day;
      // a college short of lecturers teaches slowly
      p.collegeDays = (p.collegeDays || 0) + 0.4 + 0.6 * this.ratio(dest);
      if (!isGrad(p) && p.collegeDays >= DEGREE_DAYS) this.graduate(p, dest);
    }
  },

  graduate(p: any, college: any): void {
    p.edu = EDU_DEGREE;
    p.enrolled = false;
    p.mood = Math.min(98, (p.mood ?? 60) + 10);
    Mind.remember(p, 'career', 'graduated from the college', 2, college.id);
    Life.say(`🎓 ${Sim.fullName(p)} graduated from the College — a degree, and the posts that need one`);
    this.promote(p);
  },

  /** coming of age: the school leaving certificate goes to those who went */
  comeOfAge(p: any): void {
    p.edu = (p.schoolDays || 0) >= SCHOOL_DAYS ? EDU_SCHOOL : EDU_NONE;
  },

  /** an enrolled worker takes some weekdays off to study */
  studyDay(p: any): boolean {
    return !!p.enrolled && !isGrad(p) && Math.random() < 0.4;
  },

  /** a graduate in an ordinary job moves to an open graduate post when there is one */
  promote(p: any): boolean {
    if (!isGrad(p) || p.kind === 'kid') return false;
    if (p.work && (SKILLED[p.work.type] || ESSENTIAL.includes(p.work.type))) return false; // (essential services keep their people)
    let best: any = null, bd = 1e9;
    for (const w of Sim.workplaces()) {
      if (w === p.work || !this.open(w)) continue;
      const d = Math.abs(w.x - p.home.x) + Math.abs(w.y - p.home.y);
      if (d < bd) { bd = d; best = w; }
    }
    if (!best) return false;
    const old = p.work;
    if (old) old.workers = old.workers.filter((q: any) => q !== p);
    p.work = best;
    best.workers.push(p);
    p.wageMult = 1;
    p.jobDays = 0;
    Mind.remember(p, 'career', `took up a post at the ${CAT[best.type].name.toLowerCase()}`, 2, best.id);
    if (old) Life.say(`📈 ${Sim.fullName(p)} left the ${CAT[old.type].name} for a graduate post at the ${CAT[best.type].name}`);
    return true;
  },

  /** once a day: the ambitious enrol, graduates find graduate posts */
  daily(): void {
    const college = World.buildings.some((b: any) => CAT[b.type].college && b.connected && !b.construction && !b.ruined);
    for (const p of Sim.people) {
      if (p.kind === 'kid') continue;
      Edu.init(p);
      if (isGrad(p)) { if (Math.random() < 0.25) this.promote(p); continue; }
      if (!college || p.enrolled || (p.age ?? 30) >= 42) continue;
      const amb = Mind.ensure(p).traits.ambition;
      if (amb > 0.62 && Math.random() < 0.08) {
        p.enrolled = true;
        if (Math.random() < 0.3) Life.say(`📚 ${Sim.fullName(p)} enrolled at the College — evenings with textbooks from now on`);
      }
    }
  },

  /** graduate posts nobody in town can fill draw a skilled family in (one a day at most) */
  migrateDay: -1,
  migrate(vacantHomes: any[]): boolean {
    if (!vacantHomes.length || this.migrateDay === Sim.day) return false;
    const want = Sim.workplaces().filter((w: any) => this.open(w) > 0);
    if (!want.length) return false;
    // a jobless graduate in town will take it first
    if (Sim.people.some((p: any) => isGrad(p) && !p.work && p.kind !== 'kid' && (p.age ?? 30) < 65)) return false;
    if (Math.random() > 0.5 * Settings.growthMult()) return false;
    this.migrateDay = Sim.day;
    const w = want[(Math.random() * want.length) | 0];
    const home = vacantHomes[(Math.random() * vacantHomes.length) | 0];
    const fam = Sim.spawnFamily(home);
    home.funds = Math.max(home.funds, 90 + Math.random() * 80);
    if (CAT[home.type].cars && !home.cars.length) home.cars.push({ free: true, seed: (Math.random() * 8) | 0 });
    const adult = home.residents.find((r: any) => r.kind !== 'kid' && r.surname === fam.surname);
    if (adult) {
      if (adult.work) adult.work.workers = adult.work.workers.filter((q: any) => q !== adult);
      adult.work = null;
      adult.edu = EDU_DEGREE;
      Sim.assignJobs();
    }
    const title = this.title(w.type);
    const via = Gateways.welcome(home, fam.surname, true); // V2 (Milestone 5): they fly in, or come by intercity
    Life.say(`🎓 The ${fam.surname} family ${via ? `${via} and moved in` : 'moved in'} — ${adult ? adult.name : 'one of them'} is one of the ${title} the ${CAT[w.type].name} was short of`);
    return true;
  },
};

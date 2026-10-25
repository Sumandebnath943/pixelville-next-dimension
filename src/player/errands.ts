/* ============================================================
   Small kindnesses and small luck (design §4.2): the ways the
   Founder earns a little before there are jobs to work —
   finding a villager's runaway dog and walking it home,
   lending a hand at a fire or a crash, and a scratch card at
   a village shop now and then. Every dollar comes from
   somewhere real: the grateful household, the village fund,
   the shop that sold the card.
   ============================================================ */
import { Sim } from '../sim/agents';
import { World } from '../sim/world';
import { Life } from '../sim/life';
import { Rep } from '../sim/reputation';
import { Tasks } from '../sim/tasks';
import { Gov } from '../sim/gov';
import { CAT } from '../sim/catalog';
import { family } from '../sim/core';
import { isWaterAt } from '../render/terrain';
import type { Founder } from './founder';
import type { Gps } from './gps';

const TM = 8;
const DOG_NAMES = ['Biscuit', 'Pepper', 'Rex', 'Luna', 'Bramble', 'Toffee', 'Scout', 'Maple', 'Ziggy', 'Bonnie', 'Otis', 'Juniper', 'Pickle', 'Waffles'];
const DOG_COLORS = ['#8a6a42', '#e8e0d0', '#3a2a1e', '#c8a070', '#f0ece4'];
/** in-game minutes, comparable across days */
const now = (): number => Sim.day * 1440 + Sim.clock;

interface LostDog {
  home: any; name: string; fam: string; color: string;
  x: number; z: number; yaw: number; sx: number; sz: number; tx: number; tz: number; rest: number;
  following: boolean; until: number; task: string;
}

export interface Interaction { text: string; act: () => void }
/** `news`: the village hears of it too (the task book's news log, PVTV); otherwise it's the Founder's own business */
type Toast = (msg: string, at?: { x: number; y: number }, news?: boolean) => void;

export class Errands {
  dog: LostDog | null = null;
  private dogT = 45; // real seconds before the first chance of a runaway
  private helped = new WeakSet<object>();
  private helpT = 0;
  private helpAt: object | null = null;

  /** V2 (Milestone 6): on an emergency shift, helping at a fire or a crash is the job itself (and paid as such) */
  onDuty: () => boolean = () => false;

  constructor(private founder: Founder, private gps: Gps, private toast: Toast) {}

  /** a new map or a loaded save: nothing carries over */
  reset(): void {
    this.dog = null;
    this.dogT = 45;
    this.helpT = 0;
    this.helpAt = null;
  }

  update(dt: number, street: boolean): void {
    this.tickDog(dt, street);
    if (street && !this.onDuty()) this.tickHelping(dt);
  }

  /* ---------- the runaway dog ---------- */
  private tickDog(dt: number, street: boolean): void {
    const d = this.dog;
    if (!d) {
      this.dogT -= dt;
      if (this.dogT <= 0) {
        this.dogT = 240 + Math.random() * 360; // every few real minutes, a chance
        if (street && Sim.clock > 480 && Sim.clock < 1200 && Math.random() < 0.6) this.loseDog();
      }
      return;
    }
    // the family moved away or the house is gone
    if (!World.buildings.includes(d.home) || !d.home.residents.length) {
      Tasks.done(d.task, false, `${d.name} went with the ${d.fam}`);
      this.dog = null;
      return;
    }
    // left to it, a dog finds its own way home in the end
    if (!d.following && now() > d.until) {
      Tasks.done(d.task, false, `${d.name} found the way home without you`);
      this.dog = null;
      return;
    }
    const f = this.founder;
    if (d.following) {
      // at the Founder's heel (in the car while driving)
      const tx = f.driving ? f.car.x : f.pos.x - Math.sin(f.yaw) * 1.2 + Math.cos(f.yaw) * 0.5;
      const tz = f.driving ? f.car.z : f.pos.z - Math.cos(f.yaw) * 1.2 - Math.sin(f.yaw) * 0.5;
      const dx = tx - d.x, dz = tz - d.z, dist = Math.hypot(dx, dz);
      if (f.driving || dist > 30) { d.x = tx; d.z = tz; }
      else if (dist > 0.3) {
        const step = Math.min(dist, Math.max(1.5, dist * 2.2) * dt);
        d.x += (dx / dist) * step; d.z += (dz / dist) * step;
        d.yaw = Math.atan2(dx, dz);
      }
      return;
    }
    // sniffing about near where it was last seen
    if (d.rest > 0) { d.rest -= dt; return; }
    const dx = d.tx - d.x, dz = d.tz - d.z, dist = Math.hypot(dx, dz);
    if (dist < 0.4) {
      d.rest = 1 + Math.random() * 4;
      for (let k = 0; k < 6; k++) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 12;
        const x = d.x + Math.cos(a) * r, z = d.z + Math.sin(a) * r;
        if (Math.hypot(x - d.sx, z - d.sz) < 30 && this.walkable(x, z)) { d.tx = x; d.tz = z; break; }
      }
      return;
    }
    const step = Math.min(dist, 1.6 * dt);
    d.x += (dx / dist) * step; d.z += (dz / dist) * step;
    d.yaw = Math.atan2(dx, dz);
  }

  private walkable(x: number, z: number): boolean {
    const tx = Math.floor(x / TM), tz = Math.floor(z / TM);
    return World.inB(tx, tz) && !World.buildingAt(tx, tz) && !isWaterAt(x, z);
  }

  /** a dog slips out of a yard somewhere not too far from the Founder */
  private loseDog(): void {
    const f = this.founder;
    const homes = World.buildings.filter((b: any) => CAT[b.type].res && b.connected && !b.ruined && !b.construction &&
      b.residents.some((r: any) => r.kind !== 'kid') && (() => {
        const d = Math.hypot(b.door.x * TM + 4 - f.pos.x, b.door.y * TM + 4 - f.pos.z);
        return d > 50 && d < 320;
      })());
    if (!homes.length) return;
    const home = homes[(Math.random() * homes.length) | 0];
    const hx = home.door.x * TM + 4, hz = home.door.y * TM + 4;
    for (let k = 0; k < 16; k++) {
      const a = Math.random() * Math.PI * 2, r = 20 + Math.random() * 25;
      const x = hx + Math.cos(a) * r, z = hz + Math.sin(a) * r;
      if (!this.walkable(x, z)) continue;
      const name = DOG_NAMES[(Math.random() * DOG_NAMES.length) | 0];
      const fam = family(home.residents[0].surname);
      const task = 'dog' + home.id + '_' + Sim.day;
      this.dog = {
        home, name, fam, color: DOG_COLORS[(home.id * 7) % DOG_COLORS.length],
        x, z, yaw: a, sx: x, sz: z, tx: x, tz: z, rest: 2, following: false, until: now() + 2 * 1440, task,
      };
      Tasks.add(task, '🐕', `Find ${name}, the ${fam}' dog, and walk it home`);
      this.toast(`🐕 ${name} slipped out of the ${fam}' yard — they're asking the whole street. Last seen here.`, { x: x * 2, y: z * 2 }, true);
      return;
    }
  }

  /* ---------- lending a hand ---------- */
  private tickHelping(dt: number): void {
    const f = this.founder;
    if (f.driving) { this.helpT = 0; return; }
    let at: object | null = null, label = '', fireB: any = null;
    const c = Life.crash;
    if (c && !this.helped.has(c) && Math.hypot(c.x * 0.5 - f.pos.x, c.y * 0.5 - f.pos.z) < 16) { at = c; label = 'crash'; }
    if (!at) for (const b of World.buildings) {
      if (!b.fire || this.helped.has(b)) continue;
      const cx = (b.x + b.w / 2) * TM, cz = (b.y + b.h / 2) * TM;
      if (Math.hypot(cx - f.pos.x, cz - f.pos.z) < Math.max(b.w, b.h) * TM * 0.5 + 10) { at = b; label = 'fire'; fireB = b; break; }
    }
    if (at !== this.helpAt) { this.helpAt = at; this.helpT = 0; }
    if (!at) return;
    this.helpT += dt;
    if (this.helpT < 8) return;
    this.helped.add(at);
    this.helpAt = null;
    const pay = label === 'fire' ? 15 : 10;
    const got = Math.min(pay, Math.max(0, Math.floor(Gov.treasury)));
    Gov.treasury -= got;
    if (got) f.purse.earn(got, label === 'fire' ? 'Helped the bucket line' : 'Helped at a crash', 'reward');
    if (fireB) {
      const fam = fireB.residents[0] ? `the ${family(fireB.residents[0].surname)}'` : 'a';
      for (const r of fireB.residents) Rep.feel(r, 3, 'the Founder joined the bucket line at our fire', `helped put out the fire at ${fam} place`);
      Rep.broadcast(0.3);
    } else {
      // the people standing around the crash saw who stopped to help
      for (const q of Sim.people) if (q.state === 'walk' && q.trip && Math.hypot(q.x * 0.5 - f.pos.x, q.y * 0.5 - f.pos.z) < 30) Rep.feel(q, 1, 'saw the Founder help out at a crash', 'helped out at a crash');
    }
    this.toast(label === 'fire'
      ? `🧯 You joined the bucket line — the village thanks you${got ? ` with $${got} from the fund` : ''}`
      : `🙏 You helped wave traffic around the crash — the village thanks you${got ? ` with $${got} from the fund` : ''}`);
  }

  /* ---------- scratch cards ---------- */
  /** a shop that's open, and the Founder at its door */
  canScratch(b: any): boolean {
    const d = CAT[b.type];
    if (!d || d.cat !== 'shop' || b.ruined || b.construction) return false;
    // the corner shops and the gas station sell them; showrooms and the auto garage don't
    if (d.visit !== 'shop' && b.type !== 'gas') return false;
    if (b.type === 'carshowroom' || b.type === 'motoshowroom' || b.type === 'autoshop') return false;
    if (d.hours && (Sim.clock < d.hours.s || Sim.clock >= d.hours.e)) return false;
    const f = this.founder;
    return !f.driving && Math.hypot(b.door.x * TM + 4 - f.pos.x, b.door.y * TM + 4 - f.pos.z) < 14;
  }
  scratch(b: any): void {
    const f = this.founder;
    const name = CAT[b.type].name;
    if (Rep.price(b, 2).refused) { this.toast(`🙅 The staff at the ${name} won't serve you`); return; }
    if (!f.purse.spend(2, `Scratch card · ${name}`, 'purchase', b)) { this.toast('👛 Not enough money for a scratch card'); return; }
    const r = Math.random();
    const win = r < 1 / 250 ? 200 : r < 1 / 250 + 1 / 40 ? 20 : r < 1 / 250 + 1 / 40 + 1 / 8 ? 3 : 0;
    if (!win) { this.toast(`🎟️ No luck this time at the ${name}`); return; }
    // prizes come out of the village fund
    const got = Math.min(win, Math.max(0, Math.floor(Gov.treasury)));
    Gov.treasury -= got;
    if (got) f.purse.earn(got, win >= 200 ? 'Scratch card jackpot!' : 'Scratch card win', 'win');
    this.toast(win >= 200 ? `🎉 JACKPOT! $${got} on a scratch card from the ${name}!` : `🎟️ A winner — $${got} on a scratch card`, undefined, win >= 200);
  }

  /* ---------- what E does here ---------- */
  interaction(): Interaction | null {
    const d = this.dog, f = this.founder;
    if (!d || f.driving) return null;
    if (!d.following && Math.hypot(d.x - f.pos.x, d.z - f.pos.z) < 2.6) {
      return {
        text: `<b>E</b> call ${d.name} over`,
        act: () => {
          d.following = true;
          this.gps.set(d.home.door.x * TM + 4, d.home.door.y * TM + 4, `The ${d.fam}' home`);
          this.toast(`🐕 ${d.name} trots along at your heel. The GPS shows the way to the ${d.fam}.`);
        },
      };
    }
    const hx = d.home.door.x * TM + 4, hz = d.home.door.y * TM + 4;
    if (d.following && Math.hypot(hx - f.pos.x, hz - f.pos.z) < 9) {
      return { text: `<b>E</b> return ${d.name} to the ${d.fam}`, act: () => this.returnDog() };
    }
    return null;
  }

  private returnDog(): void {
    const d = this.dog!;
    const home = d.home;
    const want = Math.max(15, Math.min(60, Math.round(15 + (home.funds || 0) * 0.04)));
    const got = this.founder.purse.earn(want, `Brought ${d.name} home to the ${d.fam}`, 'reward', home);
    for (const r of home.residents) {
      Rep.feel(r, 4, `the Founder brought ${d.name} home`, `found the ${d.fam}' dog ${d.name} and brought it home`);
      r.mood = Math.min(98, (r.mood ?? 60) + 6);
    }
    Tasks.done(d.task, true, `Brought ${d.name} home to the ${d.fam}`);
    this.toast(got ? `🐕 The ${d.fam} are overjoyed to have ${d.name} back — they press $${got} into your hand`
      : `🐕 The ${d.fam} are overjoyed to have ${d.name} back — they've nothing to give but thanks`, undefined, true);
    if (this.gps.dest && Math.hypot(this.gps.dest.x - (home.door.x * TM + 4), this.gps.dest.z - (home.door.y * TM + 4)) < 5) this.gps.clear();
    this.dog = null;
  }

  /** the dog, for the renderer */
  draw(prop: (k: string, x: number, y: number, z: number, yaw: number, scale: number, color: string) => void, ground: (x: number, z: number) => number): void {
    const d = this.dog;
    if (!d || (d.following && this.founder.driving)) return;
    prop('dog', d.x, ground(d.x, d.z), d.z, d.yaw, 1, d.color);
  }
}

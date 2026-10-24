/* ============================================================
   Inside a building (design §8): through the door into its room,
   on foot and in first person. The people in it are the real
   ones the sim says are there: the staff on shift at their posts
   (the first one serving at the counter), customers at the tables
   and aisles, a family at home. They come and go as the sim
   moves them. E uses what's in front of you: the counter, a seat,
   the cash or ticket machine, or someone to talk to.
   ============================================================ */
import * as THREE from 'three';
import { Sim } from '../sim/agents';
import { CAT } from '../sim/catalog';
import { mulberry32 } from '../sim/core';
import { Rep } from '../sim/reputation';
import { Person, randomLook } from '../gfx/person';
import { InteriorScene } from '../render/interior';
import { INTERIOR, layoutFor, walkable, Layout, Place, Spot } from '../interiors/plan';
import type { Stage } from '../render/stage';

const EYE = 1.62, SEATED = 1.18;
/** skinned people are dear on an integrated GPU: this many at most in a room */
const MAX_PEOPLE = 14;

export interface Occupant { p: any; body: Person; place: Place; staff: boolean; post: number; facing: number }
export type Use = { kind: 'spot'; spot: Spot; text: string } | { kind: 'person'; who: Occupant; text: string };

/** can the Founder go in? (null: yes; otherwise why not) */
export function doorState(b: any, founderOpinionOfHome?: number): string | null {
  if (!INTERIOR[b.type]) return 'outdoor';
  if (b.ruined) return 'It\'s a ruin';
  if (b.construction > 0) return 'Still being built';
  if (b.fire) return 'It\'s on fire!';
  if (b.type === 'lodge') return null;
  const d = CAT[b.type];
  if (d.res) {
    const home = (b.residents || []).filter((r: any) => r.state === 'in' && r.at === b);
    if (!home.length) return 'Nobody\'s home';
    if ((founderOpinionOfHome ?? 0) < 1) return 'They won\'t ask you in';
    return null;
  }
  if (d.hours && (Sim.clock < d.hours.s || Sim.clock >= d.hours.e)) return `Closed (opens ${String(Math.floor(d.hours.s / 60)).padStart(2, '0')}:${String(d.hours.s % 60).padStart(2, '0')})`;
  return null;
}
/** what the household thinks of the Founder, on average (for being asked in) */
export function householdView(b: any): number {
  const rs = (b.residents || []).filter((r: any) => r.state === 'in' && r.at === b);
  return rs.length ? rs.reduce((s: number, r: any) => s + Rep.of(r), 0) / rs.length : 0;
}

export class Indoors {
  active = false;
  b: any = null;
  L: Layout | null = null;
  room: InteriorScene | null = null;
  pos = new THREE.Vector2();
  yaw = 0;
  pitch = 0;
  seated: Spot | null = null;
  people: Occupant[] = [];
  /** someone in a conversation turns to face the Founder */
  talkingTo: Occupant | null = null;
  private syncT = 0;
  private bob = 0;

  constructor(private stage: Stage) {}

  enter(b: any): void {
    const L = layoutFor(b);
    if (!L) return;
    this.b = b;
    this.L = L;
    this.room = new InteriorScene(L, this.stage.renderer, this.stage.quality !== 'low');
    this.stage.setIndoor(this.room.scene);
    this.stage.camera.near = 0.08;
    this.stage.camera.updateProjectionMatrix();
    this.pos.set(0, L.d / 2 - 1.1);
    this.yaw = 0;
    this.pitch = -0.05;
    this.seated = null;
    this.active = true;
    this.people = [];
    this.sync(true);
  }

  exit(): void {
    if (!this.active) return;
    for (const o of this.people) this.room!.scene.remove(o.body.root);
    this.people = [];
    this.stage.setIndoor(null);
    this.stage.camera.near = 0.25;
    this.stage.camera.updateProjectionMatrix();
    this.room!.dispose();
    this.room = null;
    this.active = false;
    this.talkingTo = null;
    this.b = this.L = null;
  }

  /** who the sim says is in here right now: staff on shift, and everyone else */
  inside(): { staff: any[]; others: any[] } {
    const b = this.b;
    const here = (p: any): boolean => p.state === 'in' && p.at === b;
    const staff = CAT[b.type].res ? [] : (b.workers || []).filter(here);
    const others = Sim.people.filter((p: any) => here(p) && !staff.includes(p));
    return { staff, others };
  }

  /** match the people drawn to the people inside: newcomers take a free post or place, leavers go */
  private sync(first = false): void {
    const L = this.L!, { staff, others } = this.inside();
    const want = new Set([...staff, ...others]);
    for (const o of [...this.people]) {
      if (want.has(o.p) || o === this.talkingTo) continue;
      this.room!.scene.remove(o.body.root);
      this.people.splice(this.people.indexOf(o), 1);
    }
    const taken = new Set(this.people.map((o) => o.place));
    const add = (p: any, place: Place, isStaff: boolean, post: number): void => {
      if (this.people.length >= MAX_PEOPLE || this.people.some((o) => o.p === p)) return;
      const body = new Person(lookFor(p));
      body.root.position.set(place.x, 0, place.z);
      body.root.rotation.y = place.face + Math.PI;
      body.animate(0.016, place.pose, 0, 0);
      this.room!.scene.add(body.root);
      this.people.push({ p, body, place, staff: isStaff, post, facing: place.face + Math.PI });
      taken.add(place);
    };
    // staff fill the posts in order: the first is always the counter
    for (const p of staff) {
      if (this.people.some((o) => o.p === p)) continue;
      const post = L.posts.findIndex((q) => !taken.has(q));
      if (post >= 0) add(p, L.posts[post], true, post);
    }
    // customers and family: a stable shuffle of the free places
    const rnd = mulberry32(this.b.id * 31 + (first ? 0 : Sim.day));
    const free = L.places.filter((q) => !taken.has(q)).sort(() => rnd() - 0.5);
    for (const p of others) {
      if (this.people.some((o) => o.p === p)) continue;
      const place = free.shift();
      if (!place) break;
      add(p, place, false, -1);
    }
  }

  /** the person serving at the counter of `spot` (post index), if they're at it */
  server(spot: Spot): Occupant | null {
    return this.people.find((o) => o.staff && o.post === spot.post) ?? null;
  }

  /** one frame: walk (unless seated), look, the people, the light */
  update(dt: number, move: { x: number; y: number }, look: { dx: number; dy: number }, run: boolean, day: number, lampsOn: number): void {
    this.yaw -= look.dx;
    this.pitch = THREE.MathUtils.clamp(this.pitch - look.dy, -1.2, 1.2);
    if (!this.seated && (move.x || move.y)) {
      const sp = (run ? 3 : 1.5) * dt;
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
      const dx = (fx * move.y + rx * move.x) * sp, dz = (fz * move.y + rz * move.x) * sp;
      // slide along walls and furniture, one axis at a time; people are in the way too
      if (this.clear(this.pos.x + dx, this.pos.y)) this.pos.x += dx;
      if (this.clear(this.pos.x, this.pos.y + dz)) this.pos.y += dz;
      this.bob += dt * (run ? 11 : 7.5);
    }
    const eye = this.seated ? SEATED : EYE + (this.seated ? 0 : Math.sin(this.bob) * 0.018);
    const cam = this.stage.camera;
    cam.position.set(this.pos.x, eye, this.pos.y);
    cam.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    // the people: idle or sitting; whoever's talking turns to the Founder
    this.syncT -= dt;
    if (this.syncT <= 0) { this.syncT = 2; this.sync(); }
    for (const o of this.people) {
      let target = o.place.face + Math.PI;
      if (o === this.talkingTo) target = Math.atan2(this.pos.x - o.place.x, this.pos.y - o.place.z);
      o.facing += wrap(target - o.facing) * Math.min(1, dt * 4);
      o.body.root.rotation.y = o.facing;
      o.body.animate(dt, o.place.pose, 0, 0);
    }
    this.room!.light(day, lampsOn);
  }
  private clear(x: number, z: number): boolean {
    if (!walkable(this.L!, x, z)) return false;
    for (const o of this.people) if (Math.hypot(o.place.x - x, o.place.z - z) < 0.5) return false;
    return true;
  }

  /** what E would do here: the nearest thing in front of the Founder */
  use(): Use | null {
    const L = this.L!;
    if (this.seated) return { kind: 'spot', spot: this.seated, text: '<b>E</b> stand up' };
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const ahead = (x: number, z: number, reach: number): number => {
      const dx = x - this.pos.x, dz = z - this.pos.y, d = Math.hypot(dx, dz);
      if (d > reach) return Infinity;
      return d < 0.6 || (dx * fx + dz * fz) / d > 0.45 ? d : Infinity;
    };
    let best: Use | null = null, bd = Infinity;
    for (const s of L.spots) {
      const d = ahead(s.x, s.z, 1.4);
      if (d < bd) {
        const who = s.kind === 'counter' ? this.server(s) : null;
        const text = s.kind === 'counter' ? (who ? `<b>E</b> ${s.label} · ${who.p.name} is serving` : `${s.label} — nobody's serving`) : `<b>E</b> ${s.label}`;
        bd = d;
        best = { kind: 'spot', spot: s, text };
      }
    }
    for (const o of this.people) {
      const d = ahead(o.place.x, o.place.z, 2.2);
      if (d < bd - 0.3) {
        bd = d;
        best = { kind: 'person', who: o, text: `<b>E</b> talk to ${o.p.name} ${o.p.surname}${o.staff ? ` (${jobName(o.p)})` : ''}` };
      }
    }
    return best;
  }

  sit(s: Spot): void {
    this.seated = s;
    this.pos.set(s.x, s.z);
    this.yaw = s.yaw;
    this.pitch = -0.1;
  }
  stand(): void {
    const s = this.seated;
    if (!s) return;
    this.seated = null;
    // step back from the chair
    const bx = s.x + Math.sin(s.yaw) * 0.6, bz = s.z + Math.cos(s.yaw) * 0.6;
    if (walkable(this.L!, bx, bz)) this.pos.set(bx, bz);
  }

  /** the building's name for prompts and cards */
  name(): string {
    return this.b?.type === 'lodge' ? "the Founder's Lodge" : `the ${CAT[this.b.type].name}`;
  }
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
/** a villager's look, the same every time they're drawn */
export function lookFor(p: any): ReturnType<typeof randomLook> {
  const rnd = mulberry32((p.seed || p.id || 1) * 9301 + 49297);
  const look = randomLook(rnd);
  if (p.kind === 'woman') look.female = true;
  else if (p.kind === 'man') look.female = false;
  if (p.kind === 'kid') look.height = 1.1 + (p.age || 8) * 0.03;
  else if (look.height < 1.5) look.height = look.female ? 1.62 : 1.74;
  look.longHair = look.female ? look.longHair || rnd() < 0.5 : false;
  look.skirt = look.female && look.skirt;
  return look;
}
/** what someone does for a living, in a word or two */
export function jobName(p: any): string {
  const w = p.work;
  if (!w) return p.kind === 'kid' ? 'pupil' : 'villager';
  const JOBS: Record<string, string> = {
    bakery: 'baker', cafe: 'barista', restaurant: 'waiter', pizzeria: 'pizza chef', pizzapalace: 'pizza chef', icecream: 'ice-cream server',
    shop: 'shopkeeper', market: 'cashier', mall: 'sales assistant', deptstore: 'sales assistant', pharmacy: 'pharmacist', barber: 'barber',
    florist: 'florist', bookshop: 'bookseller', butcher: 'butcher', tailor: 'tailor', school: 'teacher', college: 'lecturer', library: 'librarian',
    hospital: 'nurse', police: 'police officer', fire: 'firefighter', bank: 'bank clerk', postoffice: 'postal clerk', townhall: 'council clerk',
    courthouse: 'court clerk', church: 'vicar', temple: 'priest', factory: 'factory hand', warehouse: 'warehouse hand', office: 'office worker',
    skyscraper: 'office worker', hotel: 'receptionist', autoshop: 'mechanic', gas: 'attendant', farm: 'farmer', trainstation: 'station staff',
    airport: 'airport staff', tvstation: 'reporter', exchange: 'trader', cinema: 'usher', theater: 'usher', museum: 'curator', gym: 'trainer',
    pool: 'lifeguard', casino: 'croupier', laundry: 'attendant', carshowroom: 'car salesperson', motoshowroom: 'sales rep',
  };
  return JOBS[w.type] || `works at the ${CAT[w.type]?.name.toLowerCase() || 'works'}`;
}

/* ============================================================
   Fauna (Milestone 9): the animals that live about the village
   but aren't villagers' business, worked out only round the
   camera and only as long as anyone could see them. Each farm
   keeps cows, sheep, a horse and a donkey in its yard; the zoo
   its elephant, lions, zebras, penguins and petting farm in the
   enclosures of its plan (render/zoo.ts); pigeons work the
   parks, the plaza and the pavement outside shops; a hare (and,
   in the big park, deer) come out at dawn and dusk; some houses
   have a cat on the front step.
   V2: each one has something to do. They drink at the water and
   eat at the rack (the zoo's keepers put the food out at noon
   and the animals gather for it), the cows go to the barn door
   to be milked morning and evening, and the farm horse works
   the fields on weekdays with the farmer walking behind. They
   walk round what stands in their way (trees, benches, rocks,
   pools, fences) rather than through it. Out in the
   countryside, wherever the village hasn't built, deer keep to
   the edges of the woods and hares to the open meadows, more of
   them the more open country there is, and they run from the
   Founder.
   ============================================================ */
import { World, G_GRASS } from '../sim/world';
import { CAT } from '../sim/catalog';
import { Sim } from '../sim/agents';
import { Weather } from '../sim/weather';
import { hash2 } from './kit';
import { zooPlan } from './zoo';
import type { BeastPose } from '../gfx/animals';

const TM = 8;

/** an animal to draw; `handler`: someone with it (a farmer behind the plough horse, a keeper at feeding time) */
export interface BeastDraw { id: string; key: string; x: number; z: number; yaw: number; pose: BeastPose; speed: number; handler?: { x: number; z: number; yaw: number; walk: boolean; job: string } }

interface Spot { x: number; z: number; pose: BeastPose; kind: 'water' | 'food' | 'barn' }
interface Critter {
  id: string; key: string; x: number; z: number; yaw: number; tx: number; tz: number;
  rest: number; pose: BeastPose; speed: number;
  /** its patch (world metres) */
  area: [number, number, number, number];
  /** what it does when it stops: graze, peck, sit, look about */
  stop: BeastPose[];
  /** out only at dawn and dusk (and gone otherwise) */
  shy: boolean;
  /** V2: where it drinks, eats, is milked */
  spots: Spot[];
  /** V2: the pose for the spot it's heading to (or null: one of its stops) */
  then: BeastPose | null;
  /** V2: wild: runs from the Founder */
  wild: boolean;
  /** V2: the farm horse at work: the field it ploughs ([x0, z0, x1, z1]), the row it's on, which way */
  field?: [number, number, number, number]; row?: number; dir?: number;
  /** V2: a keeper or a farmer is with it at this spot (world) */
  keeper?: { x: number; z: number };
  /** V2: lives at the zoo (fed by a keeper at noon) */
  zoo?: boolean;
}

/** how fast each kind ambles (m/s) */
const PACE: Record<string, number> = { cow: 0.9, sheep: 0.8, horse: 1.1, donkey: 0.9, elephant: 0.9, zebra: 1.0, lion: 0.9, penguin: 0.35, pigeon: 0.35, hare: 1.6, deer: 1.0, cat: 0.6 };
const STOPS: Record<string, BeastPose[]> = {
  cow: ['graze', 'graze', 'idle'], sheep: ['graze', 'graze', 'idle'], horse: ['graze', 'idle'], donkey: ['graze', 'idle'], zebra: ['graze', 'idle'],
  elephant: ['idle'], lion: ['idle', 'lie', 'lie'], penguin: ['idle'], pigeon: ['peck', 'peck', 'idle'], hare: ['graze', 'idle'], deer: ['graze', 'idle'], cat: ['sit', 'sit', 'idle'],
};
/** how near the Founder may come before a wild animal bolts (m), and how fast it goes */
const SHY: Record<string, [number, number]> = { deer: [26, 5.5], hare: [11, 6] };

export class Fauna {
  private places = new Map<string, Critter[]>();
  private seen = new Map<string, number>();
  private t = 0;
  /** V2: is a circle of radius r at (x, z) inside something solid? (set by the actors layer from the buildings) */
  blocked: (x: number, z: number, r: number) => boolean = () => false;
  /** V2: the Founder, on foot or at the wheel (null in the Planner) */
  player: { x: number; z: number; fast: boolean } | null = null;

  /** every animal within `range` of the camera this frame */
  collect(dt: number, camX: number, camZ: number, range: number, out: (d: BeastDraw) => void): void {
    this.t += dt;
    const night = Sim.clock < 330 || Sim.clock > 1230;
    const twilight = (Sim.clock > 330 && Sim.clock < 480) || (Sim.clock > 1080 && Sim.clock < 1230);
    const emit = (list: Critter[]): void => {
      for (const c of list) {
        if (c.shy && !twilight) continue;
        this.step(c, dt, night);
        const d: BeastDraw = { id: c.id, key: c.key, x: c.x, z: c.z, yaw: c.yaw, pose: c.pose, speed: c.speed };
        if (c.field && c.speed > 0) {
          // the farmer walks behind the horse, hands on the plough
          d.handler = { x: c.x - Math.sin(c.yaw) * 2.6, z: c.z - Math.cos(c.yaw) * 2.6, yaw: c.yaw, walk: true, job: 'farmer' };
        } else if (c.keeper) d.handler = { x: c.keeper.x, z: c.keeper.z, yaw: Math.atan2(c.x - c.keeper.x, c.z - c.keeper.z), walk: false, job: 'zookeeper' };
        out(d);
      }
    };
    for (const b of World.buildings) {
      if (b.ruined || b.construction > 0) continue;
      const type = b.type, d = CAT[type];
      const want = type === 'farm' || type === 'zoo' ? 260 : type === 'grandpark' || type === 'park' || type === 'plaza' ? 90 : 60;
      const cx = (b.x + b.w / 2) * TM, cz = (b.y + b.h / 2) * TM;
      if (Math.abs(cx - camX) > Math.min(range, want) + 30 || Math.abs(cz - camZ) > Math.min(range, want) + 30) continue;
      const list = this.herd(b, d, type);
      if (!list) continue;
      this.seen.set(String(b.id), this.t);
      emit(list);
    }
    // V2: the countryside's own animals, in the open land round the camera (cells of 48 m, each the same every time)
    const R = Math.min(range, 200), C = 48;
    for (let gz = Math.floor((camZ - R) / C); gz <= Math.floor((camZ + R) / C); gz++)
      for (let gx = Math.floor((camX - R) / C); gx <= Math.floor((camX + R) / C); gx++) {
        const list = this.wilds(gx, gz, C);
        if (!list.length) continue;
        this.seen.set(`w${gx},${gz}`, this.t);
        emit(list);
      }
    // (a place out of sight a while forgets its animals; they're dealt afresh when it's next near)
    if (Math.floor(this.t) % 10 === 0) for (const [k, s] of this.seen) if (this.t - s > 30) { this.places.delete(k); this.seen.delete(k); }
  }

  /** is a tile open country an animal can stand on (grass, no road, rail, building or tree trunk)? */
  private open(x: number, z: number): boolean {
    const tx = Math.floor(x / TM), tz = Math.floor(z / TM);
    if (!World.inB(tx, tz)) return false;
    const i = World.idx(tx, tz);
    return World.ground[i] === G_GRASS && !World.roadMap[i] && !World.railMap[i] && !World.bmap[i] && !World.tree[i];
  }

  /** V2: the deer and hares of one stretch of open country (none where the village has built) */
  private wilds(gx: number, gz: number, C: number): Critter[] {
    const key = `w${gx},${gz}`;
    let list = this.places.get(key);
    if (list) return list;
    list = [];
    const x0 = gx * C, z0 = gz * C, h = hash2(gx * 7 + 3, gz * 13 + 5);
    // how open it is, and how wooded
    let open = 0, trees = 0;
    for (let k = 0; k < 36; k++) {
      const tx = Math.floor((x0 + ((k % 6) + 0.5) * (C / 6)) / TM), tz = Math.floor((z0 + (Math.floor(k / 6) + 0.5) * (C / 6)) / TM);
      if (!World.inB(tx, tz)) continue;
      const i = World.idx(tx, tz);
      if (World.bmap[i] || World.roadMap[i]) { open = -99; break; }
      if (World.tree[i]) trees++;
      else if (World.ground[i] === G_GRASS) open++;
    }
    const area: [number, number, number, number] = [x0 + 2, z0 + 2, x0 + C - 2, z0 + C - 2];
    const roll = h % 100;
    const kinds = open >= 18 && trees >= 4 && roll < 22 ? ['deer', 'deer', ...(roll < 10 ? ['deer'] : [])] : open >= 24 && roll >= 22 && roll < 40 ? ['hare', ...(roll < 30 ? ['hare'] : [])] : [];
    let n = 0;
    for (const id of kinds) {
      // a spot of open ground for each (a few tries), near its fellows
      for (let k = 0; k < 8; k++) {
        const hh = hash2(h + n * 17, k * 31 + 1);
        const x = area[0] + ((hh % 1000) / 1000) * (area[2] - area[0]), z = area[1] + (((hh >>> 10) % 1000) / 1000) * (area[3] - area[1]);
        if (!this.open(x, z)) continue;
        list.push({ id, key: `${key}:${n++}`, x, z, yaw: (hh % 628) / 100, tx: x, tz: z, rest: (hh % 9) + 2, pose: 'graze', speed: 0, area, stop: STOPS[id], shy: false, spots: [], then: null, wild: true });
        break;
      }
    }
    this.places.set(key, list);
    return list;
  }

  /** the animals that belong to a place (made the first time it's near) */
  private herd(b: any, d: any, type: string): Critter[] | null {
    const key = String(b.id);
    let list = this.places.get(key);
    if (list) return list;
    const W = (d.w || 1) * TM, D = (d.h || 1) * TM, hw = W / 2, hd = D / 2;
    const f = b.facing || 0, cx = (b.x + b.w / 2) * TM, cz = (b.y + b.h / 2) * TM;
    // the lot's own frame (as it's built) to the world
    const world = (lx: number, lz: number): [number, number] => {
      const [rx, rz] = f === 0 ? [lx, lz] : f === 1 ? [lz, -lx] : f === 2 ? [-lx, -lz] : [-lz, lx];
      return [cx + rx, cz + rz];
    };
    const patch = (x0: number, z0: number, x1: number, z1: number): [number, number, number, number] => {
      const [ax, az] = world(x0, z0), [bx, bz] = world(x1, z1);
      return [Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz)];
    };
    const spot = (lx: number, lz: number, pose: BeastPose, kind: Spot['kind']): Spot => { const [x, z] = world(lx, lz); return { x, z, pose, kind }; };
    list = [];
    let n = 0;
    const add = (id: string, area: [number, number, number, number], shy = false, spots: Spot[] = []): Critter => {
      let x = 0, z = 0;
      for (let k = 0; k < 8; k++) {
        const h = hash2(b.id, n * 31 + 7 + k * 101);
        x = area[0] + ((h % 1000) / 1000) * (area[2] - area[0]); z = area[1] + (((h >>> 10) % 1000) / 1000) * (area[3] - area[1]);
        if (!this.blocked(x, z, 0.5)) break;
      }
      const h = hash2(b.id, n * 31 + 7);
      const c: Critter = { id, key: `${key}:${n++}`, x, z, yaw: (h % 628) / 100, tx: x, tz: z, rest: (h % 7) + 1, pose: 'idle', speed: 0, area, stop: STOPS[id] ?? ['idle'], shy, spots, then: null, wild: false };
      list!.push(c);
      return c;
    };
    const h0 = hash2(b.id, 99);
    if (type === 'farm') {
      // the yard in front of the barn: cows, sheep, a horse and a donkey, with a trough, a hay rack and the barn door
      const yard = patch(hw - 17, 3, hw - 1.5, hd - 1.5);
      const sp = [spot(hw - 3, 6.5, 'graze', 'water'), spot(hw - 9, hd - 3.2, 'graze', 'food')];
      for (const id of ['cow', 'cow', 'sheep', 'sheep', 'sheep', 'donkey']) add(id, yard, false, id === 'cow' ? [...sp, spot(hw - 10.5, 3.6, 'idle', 'barn')] : sp);
      const horse = add('horse', yard, false, sp);
      // (the crop rows, which the horse ploughs on working days)
      horse.field = patch(-hw + 1.5, -hd + 2, hw - 19, hd - 2);
      horse.row = 0; horse.dir = 1;
    } else if (type === 'zoo') {
      // the enclosures of the plan, each herd in its own, with its water and its feeding place
      for (const p of zooPlan(hw, hd).pens) {
        const area = patch(p.x0 + 1, p.z0 + 1, p.x1 - 1, p.z1 - 1);
        const sp: Spot[] = [spot(p.feed.x, p.feed.z + (p.feed.z < 0 ? 1.2 : -1.2), p.kind === 'lion' ? 'lie' : 'graze', 'food')];
        if (p.pool) sp.push(spot(p.pool.x + (p.pool.rx + 0.9) * (p.pool.x < (p.x0 + p.x1) / 2 ? 1 : -1), p.pool.z, p.kind === 'penguin' ? 'idle' : 'graze', 'water'));
        for (const id of p.herd) add(id, area, false, sp).zoo = true;
      }
    } else if (type === 'park' || type === 'grandpark' || type === 'plaza') {
      const lawn = patch(-hw + 2, -hd + 2, hw - 2, hd - 2);
      for (let i = 0; i < (type === 'plaza' ? 6 : 4); i++) add('pigeon', lawn);
      if (type !== 'plaza') add('hare', lawn, true);
      if (type === 'grandpark') { add('deer', lawn, true); add('deer', lawn, true); }
    } else if (d.cat === 'shop' && h0 % 2 === 0) {
      // a few pigeons on the pavement in front
      const front = patch(-hw + 1, hd - 1.6, hw - 1, hd - 0.4);
      for (let i = 0; i < 3; i++) add('pigeon', front);
    } else if (d.res && h0 % 4 === 0) {
      // a cat about the front garden
      add('cat', patch(-hw + 1, hd - 3, hw - 1, hd - 0.6));
    } else return (this.places.set(key, []), []);
    this.places.set(key, list);
    return list;
  }

  /** a clear way from (x, z) to (tx, tz)? (a few points along it) */
  private clear(x: number, z: number, tx: number, tz: number, r: number): boolean {
    const n = Math.max(2, Math.ceil(Math.hypot(tx - x, tz - z) / 1.2));
    for (let i = 1; i <= n; i++) if (this.blocked(x + ((tx - x) * i) / n, z + ((tz - z) * i) / n, r)) return false;
    return true;
  }

  /** amble to a spot in its patch, stop there a while, go again; after dark, settle down */
  private step(c: Critter, dt: number, night: boolean): void {
    const pace = PACE[c.id] ?? 0.8;
    const clock = Sim.clock;
    c.keeper = undefined;
    // a wild animal bolts from the Founder, away and out of sight
    const shy = SHY[c.id];
    if (c.wild && shy && this.player) {
      const dx = c.x - this.player.x, dz = c.z - this.player.z, d = Math.hypot(dx, dz);
      if (d < shy[0] * (this.player.fast ? 1.4 : 1)) {
        const k = 1 / (d || 1);
        const nx = c.x + dx * k * shy[1] * dt, nz = c.z + dz * k * shy[1] * dt;
        if (this.open(nx, nz)) { c.x = nx; c.z = nz; }
        c.yaw = Math.atan2(dx, dz);
        c.pose = 'trot';
        c.speed = shy[1];
        c.rest = 0.5;
        c.tx = c.x; c.tz = c.z;
        return;
      }
    }
    if (night && c.id !== 'cat') {
      // (cattle and sheep lie down; the rest stand dozing)
      c.pose = c.id === 'cow' || c.id === 'sheep' || c.id === 'lion' || c.id === 'deer' ? 'lie' : 'idle';
      c.speed = 0;
      return;
    }
    // the farm horse at work: up one crop row and down the next, weekdays 09:00–16:00
    if (c.field && clock > 540 && clock < 960 && Sim.day % 7 < 5) { this.plough(c, dt); return; }
    if (c.rest > 0) {
      c.rest -= dt;
      c.speed = 0;
      if (c.then === 'graze' && c.spots.some((s) => s.kind === 'food' && Math.hypot(s.x - c.x, s.z - c.z) < 2)) {
        // (at the zoo, a keeper puts the food out at noon)
        if (clock > 690 && clock < 750 && c.zoo) {
          const f = c.spots.find((s) => s.kind === 'food')!;
          c.keeper = { x: f.x + 1.6, z: f.z + 0.6 };
        }
      }
      if (c.rest <= 0) this.choose(c, clock);
      return;
    }
    const dx = c.tx - c.x, dz = c.tz - c.z, dist = Math.hypot(dx, dz);
    if (dist < 0.15) {
      c.pose = c.then ?? c.stop[(Math.random() * c.stop.length) | 0];
      // (in the rain nothing stands about as long; a meal or a drink takes its time)
      c.rest = (c.then ? 6 : c.id === 'pigeon' ? 1.5 : 4) + Math.random() * (c.id === 'pigeon' ? 4 : 14) * (Weather.isRaining() ? 0.5 : 1);
      c.speed = 0;
      return;
    }
    const v = Math.min(pace, dist * 1.5);
    const nx = c.x + (dx / dist) * v * dt, nz = c.z + (dz / dist) * v * dt;
    // (something in the way after all: stop here and choose again)
    if (this.blocked(nx, nz, c.id === 'pigeon' ? 0.15 : 0.45)) { c.tx = c.x; c.tz = c.z; c.rest = 0.3; c.then = null; return; }
    c.x = nx;
    c.z = nz;
    let dy = Math.atan2(dx, dz) - c.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    c.yaw += dy * Math.min(1, dt * 3);
    c.pose = c.id === 'hare' ? 'trot' : 'walk';
    c.speed = v;
  }

  /** where next: the water, the food (gathering at feeding time), the barn door at milking time, or a wander */
  private choose(c: Critter, clock: number): void {
    const [x0, z0, x1, z1] = c.area;
    const r = c.id === 'pigeon' ? 0.15 : 0.45;
    const feeding = clock > 680 && clock < 760, milking = (clock > 360 && clock < 420) || (clock > 1020 && clock < 1080);
    const pick = (k: Spot['kind']): Spot | undefined => c.spots.find((s) => s.kind === k);
    const goal = (milking && pick('barn')) || (feeding && Math.random() < 0.8 && pick('food')) || (Math.random() < 0.2 ? c.spots[(Math.random() * c.spots.length) | 0] : undefined);
    if (goal) {
      // (a little apart from the others at the same trough)
      const a = Math.random() * Math.PI * 2, s = 0.5 + Math.random() * 1.2;
      const gx = goal.x + Math.cos(a) * s, gz = goal.z + Math.sin(a) * s;
      if (!this.blocked(gx, gz, r)) { c.tx = gx; c.tz = gz; c.then = goal.pose; return; }
    }
    c.then = null;
    // a short way most times, across the patch now and then, round what's in the way
    const far = Math.random() < 0.25, span = far ? 1 : c.id === 'pigeon' ? 0.15 : 0.35;
    for (let k = 0; k < 6; k++) {
      const tx = Math.min(x1, Math.max(x0, c.x + (Math.random() - 0.5) * (x1 - x0) * span * 2));
      const tz = Math.min(z1, Math.max(z0, c.z + (Math.random() - 0.5) * (z1 - z0) * span * 2));
      if (c.wild ? this.open(tx, tz) : !this.blocked(tx, tz, r) && this.clear(c.x, c.z, tx, tz, r)) { c.tx = tx; c.tz = tz; return; }
    }
    c.tx = c.x; c.tz = c.z;
    c.rest = 2;
  }

  /** the plough horse: along a row of the field, over to the next, back down it */
  private plough(c: Critter, dt: number): void {
    const [x0, z0, x1, z1] = c.field!;
    const rows = Math.max(1, Math.floor((x1 - x0) / 2.2));
    const rx = x0 + 1.1 + (c.row! % rows) * 2.2;
    const tz = c.dir! > 0 ? z1 : z0;
    // first to the head of the current row
    const tx = rx, dx = tx - c.x, dz = tz - c.z, dist = Math.hypot(dx, dz);
    if (dist < 0.3) { c.row = (c.row! + 1) % rows; c.dir = -c.dir!; return; }
    const v = Math.min(1.0, dist);
    c.x += (dx / dist) * v * dt;
    c.z += (dz / dist) * v * dt;
    let dy = Math.atan2(dx, dz) - c.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    c.yaw += dy * Math.min(1, dt * 2);
    c.pose = 'walk';
    c.speed = v;
    c.tx = c.x; c.tz = c.z;
  }
}

/* ============================================================
   Fauna (Milestone 9): the animals that live about the village
   but aren't villagers' business, worked out only round the
   camera and only as long as anyone could see them. Each farm
   keeps cows, sheep, a horse and a donkey in its yard; the zoo
   an elephant, zebras, a lion and penguins in its four pens;
   pigeons work the parks, the plaza and the pavement outside
   shops; a hare (and, in the big park, deer) come out at dawn
   and dusk; some houses have a cat on the front step. Each one
   wanders its patch on a loop of its own (amble somewhere,
   graze or peck or look about a while, go again), lies down
   after dark, and keeps where it was while the camera's near.
   ============================================================ */
import { World } from '../sim/world';
import { CAT } from '../sim/catalog';
import { Sim } from '../sim/agents';
import { Weather } from '../sim/weather';
import { hash2 } from './kit';
import type { BeastPose } from '../gfx/animals';

const TM = 8;

export interface BeastDraw { id: string; key: string; x: number; z: number; yaw: number; pose: BeastPose; speed: number }

interface Critter {
  id: string; key: string; x: number; z: number; yaw: number; tx: number; tz: number;
  rest: number; pose: BeastPose; speed: number;
  /** its patch (world metres) */
  area: [number, number, number, number];
  /** what it does when it stops: graze, peck, sit, look about */
  stop: BeastPose[];
  /** out only at dawn and dusk (and gone otherwise) */
  shy: boolean;
}

/** how fast each kind ambles (m/s) */
const PACE: Record<string, number> = { cow: 0.9, sheep: 0.8, horse: 1.1, donkey: 0.9, elephant: 0.9, zebra: 1.0, lion: 0.9, penguin: 0.35, pigeon: 0.35, hare: 1.6, deer: 1.0, cat: 0.6 };
const STOPS: Record<string, BeastPose[]> = {
  cow: ['graze', 'graze', 'idle'], sheep: ['graze', 'graze', 'idle'], horse: ['graze', 'idle'], donkey: ['graze', 'idle'], zebra: ['graze', 'idle'],
  elephant: ['idle'], lion: ['idle', 'lie', 'lie'], penguin: ['idle'], pigeon: ['peck', 'peck', 'idle'], hare: ['graze', 'idle'], deer: ['graze', 'idle'], cat: ['sit', 'sit', 'idle'],
};

export class Fauna {
  private places = new Map<string, Critter[]>();
  private seen = new Map<string, number>();
  private t = 0;

  /** every animal within `range` of the camera this frame */
  collect(dt: number, camX: number, camZ: number, range: number, out: (d: BeastDraw) => void): void {
    this.t += dt;
    const night = Sim.clock < 330 || Sim.clock > 1230;
    const twilight = (Sim.clock > 330 && Sim.clock < 480) || (Sim.clock > 1080 && Sim.clock < 1230);
    for (const b of World.buildings) {
      if (b.ruined || b.construction > 0) continue;
      const type = b.type, d = CAT[type];
      const want = type === 'farm' || type === 'zoo' ? 260 : type === 'grandpark' || type === 'park' || type === 'plaza' ? 90 : 60;
      const cx = (b.x + b.w / 2) * TM, cz = (b.y + b.h / 2) * TM;
      if (Math.abs(cx - camX) > Math.min(range, want) + 30 || Math.abs(cz - camZ) > Math.min(range, want) + 30) continue;
      const list = this.herd(b, d, type);
      if (!list) continue;
      this.seen.set(String(b.id), this.t);
      for (const c of list) {
        if (c.shy && !twilight) continue;
        this.step(c, dt, night);
        out({ id: c.id, key: c.key, x: c.x, z: c.z, yaw: c.yaw, pose: c.pose, speed: c.speed });
      }
    }
    // (a place out of sight a while forgets its animals; they're dealt afresh when it's next near)
    if (Math.floor(this.t) % 10 === 0) for (const [k, s] of this.seen) if (this.t - s > 30) { this.places.delete(k); this.seen.delete(k); }
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
    list = [];
    let n = 0;
    const add = (id: string, area: [number, number, number, number], shy = false): void => {
      const h = hash2(b.id, n * 31 + 7);
      const x = area[0] + ((h % 1000) / 1000) * (area[2] - area[0]), z = area[1] + (((h >>> 10) % 1000) / 1000) * (area[3] - area[1]);
      list!.push({ id, key: `${key}:${n++}`, x, z, yaw: (h % 628) / 100, tx: x, tz: z, rest: (h % 7) + 1, pose: 'idle', speed: 0, area, stop: STOPS[id] ?? ['idle'], shy });
    };
    const h0 = hash2(b.id, 99);
    if (type === 'farm') {
      // the yard in front of the barn: cows, sheep, a horse and a donkey
      const yard = patch(hw - 17, 3, hw - 1.5, hd - 1.5);
      for (const id of ['cow', 'cow', 'sheep', 'sheep', 'sheep', 'horse', 'donkey']) add(id, yard);
    } else if (type === 'zoo') {
      // four pens, as the zoo is built: the elephant, two zebras, the lion, and the penguins
      const pens = [0, 1, 2, 3].map((i) => {
        const x0 = -hw + 3 + (i % 2) * (W / 2 - 1), z0 = -hd + 3 + Math.floor(i / 2) * (D / 2 - 2);
        return patch(x0 + 0.8, z0 + 0.8, x0 + W / 2 - 5.8, z0 + D / 2 - 5.8);
      });
      add('elephant', pens[0]);
      add('zebra', pens[1]); add('zebra', pens[1]);
      add('lion', pens[2]);
      for (let i = 0; i < 4; i++) add('penguin', pens[3]);
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

  /** amble to a spot in its patch, stop there a while, go again; after dark, settle down */
  private step(c: Critter, dt: number, night: boolean): void {
    const pace = PACE[c.id] ?? 0.8;
    if (night && c.id !== 'cat') {
      // (cattle and sheep lie down; the rest stand dozing)
      c.pose = c.id === 'cow' || c.id === 'sheep' || c.id === 'lion' || c.id === 'deer' ? 'lie' : 'idle';
      c.speed = 0;
      return;
    }
    if (c.rest > 0) {
      c.rest -= dt;
      c.speed = 0;
      if (c.rest <= 0) {
        const [x0, z0, x1, z1] = c.area;
        const r = Math.random();
        // a short way most times, across the patch now and then
        const far = r < 0.25;
        const span = far ? 1 : c.id === 'pigeon' ? 0.15 : 0.35;
        c.tx = Math.min(x1, Math.max(x0, c.x + (Math.random() - 0.5) * (x1 - x0) * span * 2));
        c.tz = Math.min(z1, Math.max(z0, c.z + (Math.random() - 0.5) * (z1 - z0) * span * 2));
      }
      return;
    }
    const dx = c.tx - c.x, dz = c.tz - c.z, dist = Math.hypot(dx, dz);
    if (dist < 0.15) {
      c.pose = c.stop[(Math.random() * c.stop.length) | 0];
      // (in the rain nothing stands about as long)
      c.rest = (c.id === 'pigeon' ? 1.5 : 4) + Math.random() * (c.id === 'pigeon' ? 4 : 14) * (Weather.isRaining() ? 0.5 : 1);
      c.speed = 0;
      return;
    }
    const v = Math.min(pace, dist * 1.5);
    c.x += (dx / dist) * v * dt;
    c.z += (dz / dist) * v * dt;
    let dy = Math.atan2(dx, dz) - c.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    c.yaw += dy * Math.min(1, dt * 3);
    c.pose = c.id === 'hare' ? 'trot' : 'walk';
    c.speed = v;
  }
}

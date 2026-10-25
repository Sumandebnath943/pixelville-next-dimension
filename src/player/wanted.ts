/* ============================================================
   Crime and the wanted level (design §4.4). The Founder can take
   a family's car from its drive, and break the road rules, knock
   people down, ram the police. What happens next depends on who
   saw it: a squad car with eyes on the Founder, or villagers who
   call it in (and remember it). Stars bring units from the real
   police stations by road — none at all where there's no station
   — then roadblocks from every station (★★★), spike strips (★★★★)
   and the helicopter if there's a heliport (★★★★★). Out of sight
   long enough, a star drops; caught, it's a fine, a night in the
   cells and the impound lot; a violent enough crash and the
   Founder wakes up in hospital.
   ============================================================ */
import * as THREE from 'three';
import { World } from '../sim/world';
import { Life } from '../sim/life';
import { Sim } from '../sim/agents';
import { Mind } from '../sim/mind';
import { Rep } from '../sim/reputation';
import { family, on, emit } from '../sim/core';
import { isJunction } from '../sim/traffic';
import { drivewayCars, DrivewayCar, styleForPaint } from '../render/parked';
import type { Founder } from './founder';
import type { Vehicle } from './fleet';
import type { Actors } from '../render/actors';

const BARRIER = new THREE.Color('#e8e4dc'), SPIKES = new THREE.Color('#222226'), HELI = new THREE.Color('#1d2a44');

const TM = 8;
const UNITS = [0, 1, 2, 4, 6, 8]; // squad cars hunting at each level
const ESCAPE = [0, 16, 24, 34, 46, 60]; // seconds out of sight before a star drops
export const FINES = [0, 40, 90, 160, 250, 360];
const SIGHT = 70; // metres a crew can see
const WASTED = 22; // m/s (~80 km/h): a crash that hard puts the Founder in hospital
/** buildings you can see across */
const OPEN = new Set(['park', 'grandpark', 'plaza', 'playground', 'pool', 'busstop', 'taxistand', 'heliport', 'dock', 'farm', 'lake', 'mountain']);
/** each crime: the stars, what an onlooker remembers and passes on (`gist`, after "the Founder …"), and how much it costs
    the Founder in their eyes. `policeOnly`: villagers don't report it (unless they can't stand the Founder) */
const CRIME: Record<string, { stars: number; label: string; memory: string; gist: string; opinion: number; policeOnly: boolean }> = {
  'red light': { stars: 1, label: 'running a red light', memory: 'saw the Founder run a red light', gist: 'ran a red light', opinion: -0.5, policeOnly: true },
  speeding: { stars: 1, label: 'speeding', memory: 'saw the Founder tear through town', gist: 'tore through town far too fast', opinion: -0.5, policeOnly: true },
  'wrong side': { stars: 1, label: 'driving on the wrong side', memory: 'saw the Founder drive on the wrong side', gist: 'drove on the wrong side of the road', opinion: -0.5, policeOnly: true },
  bump: { stars: 1, label: 'a collision', memory: 'saw the Founder bump into a car', gist: 'bumped into a car', opinion: -0.7, policeOnly: true },
  crash: { stars: 1, label: 'causing a crash', memory: 'saw the Founder cause a crash', gist: 'caused a crash', opinion: -2, policeOnly: false },
  hit: { stars: 2, label: 'a hit-and-run', memory: "saw the Founder's car knock someone down", gist: 'knocked someone down', opinion: -3, policeOnly: false },
  theft: { stars: 2, label: 'car theft', memory: 'saw the Founder steal a car', gist: 'stole a car', opinion: -2, policeOnly: false },
  ram: { stars: 3, label: 'ramming the police', memory: 'saw the Founder ram a police car', gist: 'rammed a police car', opinion: -2, policeOnly: false },
};
/** villagers this hostile report even the Founder's driving, and tell the police where they're hiding */
const INFORMER = -5, TELLTALE = -3;
/** villagers this fond of the Founder look the other way (except at a hit-and-run or an attack on the police) */
const LOYAL = 6;

type Toast = (msg: string, at?: { x: number; y: number }, news?: boolean) => void;
/** a roadblock: squad cars across the road at (x, z), a barrier at (bx, bz), maybe spikes; `w` is how many road rows wide */
interface Block { x: number; z: number; bx: number; bz: number; yaw: number; w: number; units: any[]; spike: { x: number; z: number; yaw: number; w: number } | null }

export class Wanted {
  stars = 0;
  /** seconds since a crew last had eyes on the Founder */
  unseen = 0;
  /** a crew (or the helicopter) sees the Founder right now */
  seen = false;
  /** what the Founder is wanted for */
  why = '';
  /** driving a car its family has reported stolen */
  hot = false;
  private last: { x: number; z: number } | null = null;
  private units: any[] = [];
  blocks: Block[] = [];
  heli: { x: number; z: number; alt: number; yaw: number; rot: number; t: number } | null = null;
  /** stolen cars left standing; each goes home once the Founder is well away */
  abandoned: { v: Vehicle; x: number; z: number; yaw: number; t: number; reported: boolean; paint?: THREE.Color }[] = [];
  private heliCd = 0;
  private raiseCd = 0;
  private spawnT = 0;
  private blockT = 0;
  private closeT = 0;
  private sightT = 0;
  private turn = 0;
  private tipCd = 0;
  private report: { v: Vehicle; due: number } | null = null;
  private stolenReported = new WeakSet<Vehicle>();
  /** stolen cars whose family knows the Founder took them */
  private blamed = new WeakSet<Vehicle>();
  onBusted: ((stars: number) => void) | null = null;
  onWasted: (() => void) | null = null;

  private off: () => void;

  constructor(private f: Founder, private toast: Toast) {
    this.off = on('founderOffence', (o) => this.offence(o.kind));
    f.onAbandon = (v, x, z, yaw) => this.abandoned.push({ v, x, z, yaw, t: 0, reported: this.stolenReported.has(v) });
    f.onWreck = (impact) => { if (impact >= WASTED) this.onWasted?.(); };
    f.pendingReturns = () => this.abandoned.filter((a) => a.v.stolen).map((a) => ({ home: a.v.stolen!.home, car: a.v.stolen!.car }));
  }

  /** where the Founder is (the car while driving) */
  private here(): { x: number; z: number } {
    const f = this.f;
    return f.driving ? { x: f.car.x, z: f.car.z } : { x: f.pos.x, z: f.pos.z };
  }

  /* ---------- taking a car ---------- */
  /** a family's car standing in its drive, within reach of the Founder on foot */
  parkedNear(): DrivewayCar | null {
    const f = this.f;
    if (f.driving) return null;
    const tx = Math.floor(f.pos.x / TM), tz = Math.floor(f.pos.z / TM);
    let best: DrivewayCar | null = null, bd = 2.8;
    const seen = new Set<any>();
    for (let j = -3; j <= 3; j++)
      for (let i = -3; i <= 3; i++) {
        const b = World.buildingAt(tx + i, tz + j);
        if (!b || seen.has(b)) continue;
        seen.add(b);
        for (const c of drivewayCars(b)) {
          const d = Math.hypot(c.x - f.pos.x, c.z - f.pos.z);
          if (d < bd) { bd = d; best = c; }
        }
      }
    return best;
  }
  steal(p: DrivewayCar): void {
    const home = p.b;
    const fam = family(home.residents[0]?.surname || 'neighbour');
    home.cars.splice(home.cars.indexOf(p.car), 1);
    const v: Vehicle = {
      id: -1, model: 'stolen', name: `${fam}' car`, kind: 'car', style: styleForPaint(p.color), color: '#' + p.color.getHexString(),
      price: 300, fuel: 0.35 + Math.random() * 0.5, damage: 0, where: 'out', stolen: { home: home.id, car: p.car, family: fam },
    };
    this.f.hijack(v, p.x, p.z, p.yaw);
    this.f.offence('theft');
  }

  /* ---------- who saw it ---------- */
  /** can a crew at (ax, az) see (bx, bz)? Buildings in between block the view */
  private los(ax: number, az: number, bx: number, bz: number): boolean {
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.floor(d / 4);
    // the plot the Founder stands on (a drive, a forecourt) doesn't hide them
    const here = World.buildingAt(Math.floor(bx / TM), Math.floor(bz / TM));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const b = World.buildingAt(Math.floor((ax + (bx - ax) * t) / TM), Math.floor((az + (bz - az) * t) / TM));
      if (b && b !== here && !OPEN.has(b.type)) return false;
    }
    return true;
  }
  /** a crew or the helicopter has eyes on the Founder */
  private policeSee(): boolean {
    const p = this.here();
    if (this.heli && Math.hypot(this.heli.x - p.x, this.heli.z - p.z) < 160) return true;
    for (const u of Life.police) {
      const ux = u.x * 0.5, uz = u.y * 0.5;
      if (Math.hypot(ux - p.x, uz - p.z) < SIGHT && this.los(ux, uz, p.x, p.z)) return true;
    }
    return false;
  }
  /** villagers out and about close enough to see */
  private onlookers(): any[] {
    const p = this.here();
    return Sim.people.filter((q: any) => q.state === 'walk' && q.trip && !q.knocked && Math.hypot(q.x * 0.5 - p.x, q.y * 0.5 - p.z) < 32);
  }

  private offence(kind: string): void {
    const c = CRIME[kind];
    if (!c) return;
    const police = this.policeSee();
    const people = this.onlookers().slice(0, 8);
    // who picks up the phone (by how they felt about the Founder until now): anyone at a hit-and-run or an
    // attack on the police; for the rest, not the Founder's loyal fans; for driving, only those who can't stand them
    const callers = people.filter((q) => (kind === 'hit' || kind === 'ram' ? true : c.policeOnly ? Rep.of(q) <= INFORMER : Rep.of(q) < LOYAL));
    // everyone who saw it thinks less of the Founder, and will tell their friends
    for (const q of people) Rep.feel(q, c.opinion, c.memory, c.gist);
    const v = this.f.hijacked;
    if (!police && !callers.length) {
      // nobody reported the theft: the family will notice in a while and report it
      if (kind === 'theft' && v) this.report = { v, due: Sim.day * 1440 + Sim.clock + 20 + Math.random() * 25 };
      return;
    }
    if (kind === 'theft' && v) { this.noticed(v); this.blame(v); }
    // in the middle of a chase, running a light or speeding is the least of it
    if (c.policeOnly && this.stars > 0) return;
    this.raise(c.stars, c.label, police, c.policeOnly);
  }
  /** the family knows their car is gone, and the police have its plate */
  private noticed(v: Vehicle): void {
    this.stolenReported.add(v);
    const home = World.buildings.find((b: any) => b.id === v.stolen?.home);
    for (const q of home?.residents || []) Mind.remember(q, 'crime', 'had their car stolen', -1);
  }
  /** …and that it was the Founder who took it */
  private blame(v: Vehicle): void {
    if (this.blamed.has(v)) return;
    this.blamed.add(v);
    const home = World.buildings.find((b: any) => b.id === v.stolen?.home);
    for (const q of home?.residents || []) Rep.feel(q, -4, 'had their car stolen by the Founder', `stole the ${v.stolen?.family}' car`);
  }

  /** a villager who dislikes the Founder spots them while the police are looking, and calls it in */
  tipOff(q: any): boolean {
    if (!this.stars || this.seen || this.tipCd > 0 || Rep.of(q) > TELLTALE) return false;
    this.tipCd = 12;
    this.last = this.here();
    this.unseen = Math.max(0, this.unseen - 8);
    q.bubble = '📞';
    q.bubbleUntil = performance.now() + 4000;
    this.toast(`📞 ${q.name} ${q.surname} spotted you and called the police`);
    return true;
  }

  raise(level: number, why: string, byPolice: boolean, informer = false): void {
    const before = this.stars;
    // a fresh crime while already wanted adds a star (one at a time)
    this.stars = Math.min(5, before > 0 && this.raiseCd <= 0 ? Math.max(before + 1, level) : Math.max(before, level));
    if (this.stars !== before) this.raiseCd = 6;
    if (this.stars === before) return;
    this.why = why;
    this.unseen = 0;
    this.last = this.here();
    const p = this.here();
    const who = byPolice ? '' : informer ? ' (a villager who can\'t stand you called it in)' : ' (a witness called it in)';
    this.toast(`🚨 Wanted ${'★'.repeat(this.stars)} — ${why}${who}`, { x: p.x * 2, y: p.z * 2 }, this.stars >= 3);
    // a big chase makes the news
    if (this.stars >= 3 && before < 3) Rep.broadcast(-0.5);
    if (!World.buildings.some((b: any) => b.type === 'police' && b.connected && !b.ruined)) this.toast('🚨 …but the village has no police station: nobody is coming');
  }

  /* ---------- every frame ---------- */
  update(dt: number): void {
    this.raiseCd -= dt;
    this.tipCd -= dt;
    this.returns(dt);
    this.reports();
    this.hot = !!this.f.hijacked && this.stolenReported.has(this.f.hijacked);
    // eyes on the Founder? (checked a few times a second)
    this.sightT -= dt;
    if (this.sightT <= 0) { this.sightT = 0.25; this.seen = (this.stars > 0 || this.hot) && this.policeSee(); }
    if (this.stars === 0) {
      // a stolen car the family reported: any crew that spots it gives chase (and now the family knows who took it)
      if (this.hot && this.seen && this.f.driving) {
        this.blame(this.f.hijacked!);
        this.raise(2, 'driving a stolen car', true);
      }
      if (this.stars === 0) return;
    }
    if (this.seen) { this.unseen = 0; this.last = this.here(); }
    else {
      this.unseen += dt;
      if (this.unseen > ESCAPE[this.stars]) {
        this.stars--;
        this.unseen = 0;
        this.toast(this.stars ? `🚨 They've lost sight of you — ${'★'.repeat(this.stars)}` : '🚨 You lost the police');
        if (!this.stars) { this.standDown(); return; }
      }
    }
    this.pursue(dt);
    this.roadblocks(dt);
    this.helicopter(dt);
    this.spikes();
    this.caught(dt);
  }

  /** the family notices the car is gone */
  private reports(): void {
    const r = this.report;
    if (!r || Sim.day * 1440 + Sim.clock < r.due) return;
    this.report = null;
    this.noticed(r.v);
    if (this.f.hijacked === r.v) this.toast(`📻 The ${r.v.stolen?.family || 'family'} have reported their car stolen — the police are looking for it`, undefined, true);
    else {
      const a = this.abandoned.find((q) => q.v === r.v);
      if (a) a.reported = true;
    }
  }

  /** stolen cars left standing go home once the Founder is well away */
  private returns(dt: number): void {
    const f = this.f, p = this.here();
    // walked off and left it: it stays where it is, and the Founder's own vehicle is theirs again
    if (f.hijacked && !f.driving && Math.hypot(f.car.x - f.pos.x, f.car.z - f.pos.z) > 90) f.dropHijacked();
    for (const a of this.abandoned) {
      a.t += dt;
      if (Math.hypot(a.x - p.x, a.z - p.z) < 60 && a.t < 1e6) continue;
      const s = a.v.stolen!;
      const home = World.buildings.find((b: any) => b.id === s.home);
      if (home && home.cars) {
        home.cars.push({ ...s.car, free: true });
        if (a.reported) {
          for (const q of home.residents) Mind.remember(q, 'crime', 'got their stolen car back', 1);
          this.toast(`🚗 The ${s.family}' stolen car was found and taken home`);
        }
      }
      a.t = -1;
    }
    this.abandoned = this.abandoned.filter((a) => a.t >= 0);
  }

  /* ---------- the response ---------- */
  private stations(): any[] {
    return World.buildings.filter((b: any) => b.type === 'police' && b.connected && !b.ruined && !b.construction);
  }
  private roadNear(x: number, z: number): { x: number; y: number } | null {
    return World.nearestRoad(Math.floor(x / TM), Math.floor(z / TM), 6);
  }
  /** a road tile `min`–`max` tiles' drive from (x, y) on the same network (the farthest reached if none is that far) */
  private roadAway(x: number, y: number, min: number, max: number): [number, number] | null {
    const seen = new Set<number>([World.idx(x, y)]);
    let ring: [number, number][] = [[x, y]], far: [number, number] | null = null;
    const pick: [number, number][] = [];
    for (let d = 1; d <= max && ring.length; d++) {
      const next: [number, number][] = [];
      for (const [cx, cy] of ring)
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
          const nx = cx + dx, ny = cy + dy;
          if (!World.isRoad(nx, ny) || seen.has(World.idx(nx, ny))) continue;
          seen.add(World.idx(nx, ny));
          next.push([nx, ny]);
          if (d >= min) pick.push([nx, ny]);
        }
      if (next.length) far = next[0];
      ring = next;
    }
    return pick.length ? pick[Math.floor(Math.random() * pick.length)] : far;
  }
  private pursue(dt: number): void {
    this.units = this.units.filter((u) => u.pursuit && Life.police.includes(u));
    const stations = this.stations();
    if (!stations.length) return;
    this.spawnT -= dt;
    const target = this.seen ? this.here() : this.last || this.here();
    if (this.units.length < UNITS[this.stars] && this.spawnT <= 0) {
      this.spawnT = 2.5;
      // the nearest station answers first; from three stars every station sends cars
      const st = this.stars >= 3 ? stations[this.turn++ % stations.length]
        : stations.reduce((a: any, b: any) => (Math.hypot(a.door.x * TM - target.x, a.door.y * TM - target.z) <= Math.hypot(b.door.x * TM - target.x, b.door.y * TM - target.z) ? a : b));
      const t = this.roadNear(target.x, target.z);
      let s = World.nearestRoad(st.door.x, st.door.y, 3);
      let path = s && t && World.roadPath(s.x, s.y, t.x, t.y);
      if (t && !path) {
        // no road from the station to there: a patrol car already out on that side of town takes the call
        const a = this.roadAway(t.x, t.y, 14, 24);
        s = a && { x: a[0], y: a[1] };
        path = s && World.roadPath(s.x, s.y, t.x, t.y);
      }
      if (path && path.length === 1) path = [path[0], path[0]]; // wanted on the station's own doorstep
      if (s && path) {
        const u = { pursuit: true, path, prog: 0, x: s.x * 16 + 8, y: s.y * 16 + 8, dirx: 1, diry: 0, phase: 'go', station: st, patrol: true, wait: 6, replanT: 2 };
        Life.police.push(u);
        this.units.push(u);
        emit('sound', { name: 'siren', at: { x: u.x, y: u.y } });
      }
    }
    const speed = this.stars >= 3 ? 3.3 : 2.9; // tiles/s with the siren on (~95 / 85 km/h)
    const t = this.roadNear(target.x, target.z);
    for (const u of this.units) {
      u.replanT -= dt;
      if (t && (u.replanT <= 0 || u.prog >= u.path.length - 1)) {
        u.replanT = 1.5;
        // no road from here to the Founder (off across the fields, onto another network): it gives up and another comes
        u.lost = this.steer(u, t) ? 0 : (u.lost || 0) + 1;
        if (u.lost > 3) { this.sendHome(u); continue; }
      }
      u.prog = Math.min(u.path.length - 1, u.prog + speed * dt);
      Life.followPath(u, u.path, u.prog, 3.5);
    }
  }
  /** a new route to the target from wherever the car is now, without a jump: from its exact spot to the next tile, then on */
  private steer(u: any, t: { x: number; y: number }): boolean {
    const i = Math.min(Math.floor(u.prog), u.path.length - 1), fr = u.prog - i;
    const a = u.path[i], b = u.path[Math.min(i + 1, u.path.length - 1)];
    const path = World.roadPath(Math.round(b[0]), Math.round(b[1]), t.x, t.y);
    if (!path) return false;
    u.path = [[a[0] + (b[0] - a[0]) * fr, a[1] + (b[1] - a[1]) * fr], ...path];
    u.prog = 0;
    return true;
  }

  /** squad cars across the road ahead of the Founder (three stars and up), spikes before them at four */
  private roadblocks(dt: number): void {
    const p = this.here();
    // blocks left far behind, or no longer wanted at this level, pack up
    for (const b of this.blocks) if (this.stars < 3 || Math.hypot(b.x - p.x, b.z - p.z) > 260) this.packUp(b);
    this.blocks = this.blocks.filter((b) => b.units.length);
    if (this.stars < 3 || this.blocks.length >= 2) return;
    this.blockT -= dt;
    if (this.blockT > 0) return;
    this.blockT = 16;
    const stations = this.stations();
    if (!stations.length) return;
    const f = this.f, yaw = f.driving ? f.car.yaw : f.yaw;
    const hx = Math.sin(yaw), hz = Math.cos(yaw);
    for (const ahead of [100, 80, 120, 140, 70]) {
      const tx = Math.floor((p.x + hx * ahead) / TM), tz = Math.floor((p.z + hz * ahead) / TM);
      if (!World.isRoad(tx, tz) || isJunction(tx, tz) || World.signals.has(World.idx(tx, tz))) continue;
      // a straight stretch, running one way or the other
      const ew = World.isRoad(tx - 1, tz) && World.isRoad(tx + 1, tz), ns = World.isRoad(tx, tz - 1) && World.isRoad(tx, tz + 1);
      if (ew === ns) continue;
      // an avenue (two rows of road side by side) is closed across both carriageways
      const twin = ew ? (World.isRoad(tx, tz + 1) ? 1 : World.isRoad(tx, tz - 1) ? -1 : 0) : World.isRoad(tx + 1, tz) ? 1 : World.isRoad(tx - 1, tz) ? -1 : 0;
      const x = tx * TM + 4 + (ew ? 0 : twin * 4), z = tz * TM + 4 + (ew ? twin * 4 : 0);
      // which way along the road the Founder is coming from
      const sx = ew ? Math.sign(p.x - x) || 1 : 0, sz = ew ? 0 : Math.sign(p.z - z) || 1;
      // squad cars across the road, a barrier in front of them
      const across = ew ? Math.PI / 2 : 0;
      const st = stations[this.turn++ % stations.length];
      const units = (twin ? [-5.4, 0, 5.4] : [-2.3, 2.3]).map((o) => {
        const ux = ew ? x : x + o, uz = ew ? z + o : z;
        const u = { block: true, path: [[tx, tz]], prog: 0, x: ux * 2, y: uz * 2, dirx: ew ? 0 : 1, diry: ew ? 1 : 0, phase: 'scene', station: st, patrol: true, wait: 1e9 };
        Life.police.push(u);
        return u;
      });
      // spikes a little way up the road, on the Founder's side
      const spikeT = this.stars >= 4 && World.isRoad(tx + sx * 2, tz + sz * 2);
      const spike = spikeT ? { x: x + sx * 16, z: z + sz * 16, yaw: across, w: twin ? 2 : 1 } : null;
      this.blocks.push({ x, z, bx: x + sx * 4.5, bz: z + sz * 4.5, yaw: across, w: twin ? 2 : 1, units, spike });
      this.toast(`🚧 Roadblock ahead${spike ? ' — and a spike strip' : ''}`);
      return;
    }
  }
  private packUp(b: Block): void {
    for (const u of b.units) this.sendHome(u);
    b.units = [];
  }
  private sendHome(u: any): void {
    u.pursuit = false;
    u.block = false;
    const s = World.nearestRoad(Math.floor(u.x / 16), Math.floor(u.y / 16), 3);
    const st = u.station;
    const home = st && World.nearestRoad(st.door.x, st.door.y, 3);
    let path = s && home && World.roadPath(s.x, s.y, home.x, home.y);
    if (s && !path) {
      // no road back to the station from here: drive off out of sight
      const a = this.roadAway(s.x, s.y, 18, 26);
      path = a && World.roadPath(s.x, s.y, a[0], a[1]);
    }
    if (path && path.length > 1) { u.path = path; u.prog = 0; u.phase = 'return'; }
    else u.done = true;
  }

  private spikes(): void {
    const f = this.f, v = f.vehicle;
    if (!f.driving || !v || v.flat || Math.abs(f.car.speed) < 2) return;
    for (const b of this.blocks) {
      const s = b.spike;
      if (!s) continue;
      // the strip lies across the road: close along it, anywhere across it
      const along = s.yaw ? Math.abs(f.car.x - s.x) : Math.abs(f.car.z - s.z), side = s.yaw ? Math.abs(f.car.z - s.z) : Math.abs(f.car.x - s.x);
      if (along > 1.4 || side > 3.7 * s.w) continue;
      v.flat = true;
      v.damage = Math.min(100, v.damage + 15);
      emit('sound', { name: 'crunch' });
      this.toast('💥 Spike strip! The tyres are shredded');
    }
  }

  /** the police helicopter, if the village has a heliport (five stars) */
  private helicopter(dt: number): void {
    this.heliCd -= dt;
    const p = this.here();
    if (!this.heli) {
      if (this.stars < 5 || this.heliCd > 0) return;
      const port = World.buildings.find((b: any) => b.type === 'heliport' && b.connected && !b.ruined && !b.construction);
      if (!port) return;
      this.heli = { x: (port.x + port.w / 2) * TM, z: (port.y + port.h / 2) * TM, alt: 2, yaw: 0, rot: 0, t: 0 };
      this.toast('🚁 The police helicopter is up');
      return;
    }
    const h = this.heli;
    h.t += dt;
    h.rot += dt * 32;
    h.alt = Math.min(45, h.alt + dt * 8);
    const leaving = h.t > 90 || this.stars < 4;
    const tx = leaving ? h.x + Math.sin(h.yaw) * 200 : p.x + 10, tz = leaving ? h.z + Math.cos(h.yaw) * 200 : p.z + 10;
    const dx = tx - h.x, dz = tz - h.z, d = Math.hypot(dx, dz);
    if (d > 1) {
      const step = Math.min(d, 45 * dt); // ~160 km/h
      h.x += (dx / d) * step; h.z += (dz / d) * step;
      h.yaw = Math.atan2(dx, dz);
    }
    if (leaving && (h.t > 100 || d > 600)) {
      this.heli = null;
      this.heliCd = 90;
      if (this.stars) this.toast('🚁 The helicopter turns back to refuel');
    }
  }

  /** a crew alongside the Founder (on foot, or stopped) for a couple of seconds makes the arrest */
  private caught(dt: number): void {
    const f = this.f, p = this.here();
    let near = Infinity;
    for (const u of Life.police) if (u.pursuit || u.block) near = Math.min(near, Math.hypot(u.x * 0.5 - p.x, u.y * 0.5 - p.z));
    // the crew pulls up at the kerb and the officers walk over
    const close = this.seen && near < 14 && (!f.driving || Math.abs(f.car.speed) < 3);
    this.closeT = close ? this.closeT + dt : Math.max(0, this.closeT - dt);
    if (this.closeT > 2) {
      this.closeT = 0;
      // an arrest in the street: people talk
      for (const q of this.onlookers().slice(0, 8)) Rep.feel(q, -1, 'saw the Founder arrested', 'got arrested in the street');
      Rep.broadcast(-0.3);
      this.onBusted?.(this.stars);
    }
  }

  /** stand every unit down and forget the chase */
  standDown(): void {
    for (const u of this.units) this.sendHome(u);
    for (const b of this.blocks) this.packUp(b);
    this.units = [];
    this.blocks = [];
    this.heli = null;
    this.stars = 0;
    this.unseen = 0;
    this.seen = false;
    this.closeT = 0;
    this.why = '';
  }

  /** every stolen car goes straight home (an arrest, a stay in hospital) */
  returnAll(): void {
    if (this.f.hijacked) this.f.dropHijacked();
    for (const a of this.abandoned) a.t = 1e6;
    this.returns(0);
  }

  /** stop listening for the Founder's offences (a test that's done with this one) */
  dispose(): void {
    this.off();
  }

  /** everything forgotten (a new map, a loaded save, a night in the cells) */
  reset(): void {
    this.standDown();
    this.hot = false;
    this.report = null;
    this.abandoned = [];
  }

  /** progress towards losing a star (0…1) while out of sight */
  escape(): number {
    return this.stars ? Math.min(1, this.unseen / ESCAPE[this.stars]) : 0;
  }

  /** roadblock barriers, spike strips, the helicopter and abandoned stolen cars, for the renderer */
  draw(a: Actors): void {
    for (const b of this.blocks) {
      // one barrier per carriageway; the strip is a low dark band right across
      for (let k = 0; k < b.w; k++) {
        const o = b.w > 1 ? (k ? 3.8 : -3.8) : 0;
        a.prop('barrier', b.bx + (b.yaw ? 0 : o), 0.03, b.bz + (b.yaw ? o : 0), b.yaw, 1.3, BARRIER);
        if (b.spike) a.prop('barrier', b.spike.x + (b.yaw ? 0 : o), 0.03, b.spike.z + (b.yaw ? o : 0), b.yaw, 2.3, SPIKES, 0.06);
      }
    }
    if (this.heli) a.vehicle('heli', this.heli.x, this.heli.alt, this.heli.z, this.heli.yaw, HELI, { rotor: this.heli.rot });
    for (const c of this.abandoned) a.vehicle('car', c.x, 0.13, c.z, c.yaw, (c.paint ??= new THREE.Color(c.v.color)));
  }
}

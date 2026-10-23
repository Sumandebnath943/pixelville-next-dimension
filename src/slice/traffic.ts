/* ============================================================
   Street life for the slice, with awareness:
   - Cars drive routes through the junction with the Intelligent
     Driver Model: they keep a safe time gap, slow for corners,
     stop at red and amber lights, turning cars give way to
     oncoming traffic and to anyone on the crossing they turn
     over, and everyone stops for people at the zebra. A car
     never drives into another car or a person: the road ahead
     is scanned along its own path.
   - Pedestrians walk a pavement graph, keep to the right, slow
     behind slower walkers and sidestep people coming the other
     way, wait at the kerb (looking both ways) for the green man
     or a safe gap at the zebra, then cross briskly.
   ============================================================ */
import * as THREE from 'three';
import { Car, CarStyle } from '../gfx/car';
import { Person, randomLook } from '../gfx/person';
import { SignalHead } from '../gfx/props';
import { KERB } from './street';

/* ---------- paths ---------- */
type XZ = [number, number];
class Path {
  cum: number[] = [0];
  len: number;
  /** speed limits from curvature: [s0, s1, vmax] */
  slow: [number, number, number][] = [];
  constructor(public pts: XZ[]) {
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    this.len = this.cum[this.cum.length - 1];
  }
  at(s: number, out = { x: 0, z: 0, hx: 0, hz: 1 }): typeof out {
    s = THREE.MathUtils.clamp(s, 0, this.len);
    let lo = 0, hi = this.cum.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (this.cum[m] <= s) lo = m; else hi = m;
    }
    const a = this.pts[lo], b = this.pts[hi];
    const seg = this.cum[hi] - this.cum[lo] || 1;
    const t = (s - this.cum[lo]) / seg;
    out.x = a[0] + (b[0] - a[0]) * t;
    out.z = a[1] + (b[1] - a[1]) * t;
    out.hx = (b[0] - a[0]) / seg;
    out.hz = (b[1] - a[1]) / seg;
    return out;
  }
}
function arc(sx: number, sz: number, hx: number, hz: number, left: boolean, r: number, n = 14): XZ[] {
  // left of heading (hx, hz) is (hz, -hx); turning left is a positive rotation about +y
  const lx = left ? hz : -hz, lz = left ? -hx : hx;
  const cx = sx + lx * r, cz = sz + lz * r;
  const rx = sx - cx, rz = sz - cz;
  const out: XZ[] = [];
  for (let i = 1; i <= n; i++) {
    const th = ((left ? 1 : -1) * (Math.PI / 2) * i) / n;
    const c = Math.cos(th), s = Math.sin(th);
    out.push([cx + rx * c + rz * s, cz - rx * s + rz * c]);
  }
  return out;
}

/* ---------- the junction ---------- */
const E = 330;
interface Route { path: Path; entry: 'W' | 'E' | 'N'; oncoming?: boolean; turnLeft?: boolean; gates: Gate[]; weight: number; wb?: boolean }
type Gate =
  | { kind: 'signal'; s: number; group: 'A' | 'B' }
  | { kind: 'cross'; s: number; sOut: number; id: string }
  | { kind: 'yield'; s: number; conflict: XZ };

const CROSSINGS: Record<string, { x0: number; x1: number; z0: number; z1: number; zebra?: boolean; walk?: 'A' | 'B' }> = {
  sigW: { x0: -12.6, x1: -9.4, z0: -3.6, z1: 3.6, walk: 'B' },
  sigE: { x0: 9.4, x1: 12.6, z0: -3.6, z1: 3.6, walk: 'B' },
  sigX: { x0: -3.6, x1: 3.6, z0: -12.6, z1: -9.4, walk: 'A' },
  zebra: { x0: 38.4, x1: 41.6, z0: -3.6, z1: 3.6, zebra: true },
};

function makeRoutes(): Route[] {
  const r: Route[] = [];
  const mk = (pts: XZ[], entry: Route['entry'], weight: number, extra: Partial<Route> = {}): void => {
    const path = new Path(pts);
    r.push({ path, entry, gates: [], weight, ...extra });
  };
  mk([[-E, 1.7], [E, 1.7]], 'W', 0.7);
  mk([[-E, 1.7], [-6.8, 1.7], ...arc(-6.8, 1.7, 1, 0, true, 8.5), [1.7, -E]], 'W', 0.3, { turnLeft: true });
  mk([[E, -1.7], [-E, -1.7]], 'E', 0.72, { wb: true });
  mk([[E, -1.7], [6.7, -1.7], ...arc(6.7, -1.7, -1, 0, false, 5), [1.7, -E]], 'E', 0.28, { wb: true });
  mk([[-1.7, -E], [-1.7, -6.7], ...arc(-1.7, -6.7, 0, 1, false, 5), [-E, -1.7]], 'N', 0.5);
  mk([[-1.7, -E], [-1.7, -6.8], ...arc(-1.7, -6.8, 0, 1, true, 8.5), [E, 1.7]], 'N', 0.5);
  for (const rt of r) {
    const p = rt.path;
    // stop lines (front bumper positions)
    const pos = { x: 0, z: 0, hx: 0, hz: 0 };
    let sigDone = false;
    for (let s = 0; s < p.len; s += 0.25) {
      p.at(s, pos);
      if (!sigDone && rt.entry === 'W' && pos.x >= -14.8) { rt.gates.push({ kind: 'signal', s, group: 'A' }); sigDone = true; }
      if (!sigDone && rt.entry === 'E' && pos.x <= 14.8) { rt.gates.push({ kind: 'signal', s, group: 'A' }); sigDone = true; }
      if (!sigDone && rt.entry === 'N' && pos.z >= -14.8) { rt.gates.push({ kind: 'signal', s, group: 'B' }); sigDone = true; }
    }
    // crossings the route passes over
    for (const [id, c] of Object.entries(CROSSINGS)) {
      let sIn = -1, sOut = -1;
      for (let s = 0; s < p.len; s += 0.25) {
        p.at(s, pos);
        const inside = pos.x > c.x0 - 0.4 && pos.x < c.x1 + 0.4 && pos.z > c.z0 && pos.z < c.z1;
        if (inside && sIn < 0) sIn = s;
        if (inside) sOut = s;
      }
      if (sIn >= 0) rt.gates.push({ kind: 'cross', s: sIn, sOut, id });
    }
    // turning left across the oncoming lane: give way where the paths meet
    if (rt.turnLeft && rt.entry === 'W') {
      let best = 0;
      for (let s = 0; s < p.len; s += 0.25) { p.at(s, pos); if (pos.z < -1.0) { best = s; break; } }
      rt.gates.push({ kind: 'yield', s: best - 2.2, conflict: [0.6, -1.7] });
    }
    // corner speed: radius 8.5 → ~5.6 m/s, radius 5 → ~4.3 m/s
    let a0 = -1;
    let prevH: XZ | null = null;
    for (let s = 0; s < p.len; s += 1) {
      p.at(s, pos);
      const turning = prevH ? Math.abs(prevH[0] * pos.hz - prevH[1] * pos.hx) > 0.01 : false;
      if (turning && a0 < 0) a0 = s;
      if (!turning && a0 >= 0) { p.slow.push([a0 - 1, s, rt.turnLeft || (rt.entry === 'N' && pos.x > 0) ? 5.8 : 4.4]); a0 = -1; }
      prevH = [pos.hx, pos.hz];
    }
    rt.gates.sort((a, b) => a.s - b.s);
  }
  return r;
}

/* ---------- signals ---------- */
export type Light = 'green' | 'amber' | 'red' | 'redamber';
export type Walk = 'green' | 'flash' | 'red';
class Signals {
  t = 5;
  A: Light = 'green';
  B: Light = 'red';
  walkA: Walk = 'green';
  walkB: Walk = 'red';
  /** seconds of green-man left for each group */
  walkLeftA = 0;
  walkLeftB = 0;
  update(dt: number): void {
    this.t = (this.t + dt) % 49;
    const t = this.t;
    this.A = t < 1.5 ? 'redamber' : t < 23.5 ? 'green' : t < 26.5 ? 'amber' : 'red';
    this.B = t < 28.5 ? 'red' : t < 30 ? 'redamber' : t < 44 ? 'green' : t < 47 ? 'amber' : 'red';
    this.walkA = t >= 1.5 && t < 15.5 ? 'green' : t >= 15.5 && t < 20 ? 'flash' : 'red';
    this.walkB = t >= 28.5 && t < 38 ? 'green' : t >= 38 && t < 42.5 ? 'flash' : 'red';
    this.walkLeftA = this.walkA === 'green' ? 15.5 - t : 0;
    this.walkLeftB = this.walkB === 'green' ? 38 - t : 0;
  }
}

/* ---------- cars ---------- */
interface Driver {
  car: Car;
  route: Route;
  s: number;
  v: number;
  a: number;
  v0: number;
  yaw: number;
  prevYaw: number;
  L: number;
  alive: boolean;
  wait: number;
  blocker: Driver | null;
}
const STYLES: CarStyle[] = ['hatch', 'sedan', 'estate', 'suv', 'hatch', 'sedan'];
const PAINTS = ['#1b2a44', '#7a1214', '#e9e9e6', '#121212', '#5a6068', '#2d4a34', '#a8acb0', '#3a2a22', '#c8b48a', '#1d5a7a', '#8a1a3a', '#f2f2ee'];

/* ---------- pedestrians ---------- */
interface Edge { a: number; b: number; pts: XZ[]; crossing?: string }
interface Walker {
  p: Person;
  edge: Edge;
  forward: boolean;
  path: Path;
  s: number;
  speed: number;
  off: number;
  side: number;
  pose: 'walk' | 'wait';
  waitAt: number;
  on: string | null;
  x: number;
  z: number;
  yaw: number;
  v: number;
}

const NODES: XZ[] = [
  [-200, -5.6], [-60, -5.6], [-11, -5.6], [-6.8, -6.8], [-5.6, -11], [-5.6, -60], [-5.6, -200],
  [5.6, -11], [5.6, -60], [5.6, -200], [6.8, -6.8], [11, -5.6], [40, -5.6], [90, -5.6], [200, -5.6],
  [-200, 5.6], [-22, 5.6], [-11, 5.6], [11, 5.6], [40, 5.6], [58, 5.6], [200, 5.6],
  [-22, 31.6], [58, 31.6], [-150, 31.6], [150, 31.6],
];
const FAR = new Set([0, 6, 9, 14, 15, 21, 24, 25]);
function makeEdges(): Edge[] {
  const e: Edge[] = [];
  const walk = (a: number, b: number): void => { e.push({ a, b, pts: [NODES[a], NODES[b]] }); };
  const cross = (a: number, b: number, id: string, ka: XZ, kb: XZ): void => { e.push({ a, b, pts: [NODES[a], ka, kb, NODES[b]], crossing: id }); };
  [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [7, 8], [8, 9], [7, 10], [10, 11], [11, 12], [12, 13], [13, 14],
    [15, 16], [16, 17], [17, 18], [18, 19], [19, 20], [20, 21], [16, 22], [20, 23], [22, 23], [24, 22], [23, 25]].forEach(([a, b]) => walk(a, b));
  cross(2, 17, 'sigW', [-11, -3.85], [-11, 3.85]);
  cross(11, 18, 'sigE', [11, -3.85], [11, 3.85]);
  cross(4, 7, 'sigX', [-3.85, -11], [3.85, -11]);
  cross(12, 19, 'zebra', [40, -3.85], [40, 3.85]);
  return e;
}

export class StreetLife {
  signals = new Signals();
  private routes = makeRoutes();
  private drivers: Driver[] = [];
  private walkers: Walker[] = [];
  private edges = makeEdges();
  private spawnT = 0;
  private rand: () => number;
  private occupied: Record<string, Set<Walker>> = { sigW: new Set(), sigE: new Set(), sigX: new Set(), zebra: new Set() };
  private waiting: Record<string, Set<Walker>> = { sigW: new Set(), sigE: new Set(), sigX: new Set(), zebra: new Set() };
  carCount = 16;

  constructor(private scene: THREE.Scene, seed = 3, people = 28) {
    let st = seed;
    this.rand = () => { st = (Math.imul(st, 1664525) + 1013904223) >>> 0; return st / 4294967296; };
    // start the street already busy: cars spread along routes, people along the pavements
    for (let i = 0; i < this.carCount; i++) this.spawnCar(true);
    for (let i = 0; i < people; i++) this.spawnWalker();
  }

  get cars(): Car[] {
    return this.drivers.map((d) => d.car);
  }
  get people(): Person[] {
    return this.walkers.map((w) => w.p);
  }

  private pickRoute(): Route {
    const tot = this.routes.reduce((a, r) => a + r.weight, 0);
    let k = this.rand() * tot;
    for (const r of this.routes) { k -= r.weight; if (k <= 0) return r; }
    return this.routes[0];
  }
  private spawnCar(initial: boolean): void {
    const route = this.pickRoute();
    let s = initial ? 30 + this.rand() * (route.path.len - 60) : 0;
    // keep a clear gap to anything already on the road near the spawn point
    const pos = route.path.at(s);
    for (const d of this.drivers) {
      const q = d.route.path.at(d.s);
      if (Math.hypot(q.x - pos.x, q.z - pos.z) < 22) {
        if (!initial) return;
        s = Math.max(0, s - 30);
      }
    }
    let car: Car | undefined;
    const dead = this.drivers.find((d) => !d.alive);
    if (dead) { car = dead.car; this.drivers.splice(this.drivers.indexOf(dead), 1); }
    else {
      const style = STYLES[Math.floor(this.rand() * STYLES.length)];
      car = new Car(style, new THREE.Color(PAINTS[Math.floor(this.rand() * PAINTS.length)]), this.rand() > 0.25);
      this.scene.add(car.root);
    }
    car.root.visible = true;
    const v0 = 10.5 + this.rand() * 3;
    this.drivers.push({ car, route, s, v: initial ? v0 * 0.7 : v0 * 0.8, a: 0, v0, yaw: 0, prevYaw: 0, L: car.dims.L, alive: true, wait: 0, blocker: null });
  }

  private spawnWalker(): void {
    const look = randomLook(this.rand);
    const p = new Person(look);
    this.scene.add(p.root);
    const edge = this.edges[Math.floor(this.rand() * this.edges.length)];
    const forward = this.rand() < 0.5;
    const pts = forward ? edge.pts : [...edge.pts].reverse();
    const w: Walker = {
      p, edge, forward, path: new Path(pts), s: 0, speed: (1.15 + this.rand() * 0.4) * (look.height < 1.4 ? 0.85 : 1),
      off: 0.5, side: 0.4 + this.rand() * 0.3, pose: 'walk', waitAt: -1, on: null, x: 0, z: 0, yaw: 0, v: 0,
    };
    w.s = edge.crossing ? 0 : this.rand() * w.path.len;
    this.setupEdge(w);
    this.walkers.push(w);
  }
  private setupEdge(w: Walker): void {
    w.waitAt = w.edge.crossing ? w.path.cum[1] : -1;
  }
  private nextEdge(w: Walker): void {
    const node = w.forward ? w.edge.b : w.edge.a;
    let options = this.edges.filter((e) => (e.a === node || e.b === node) && e !== w.edge);
    if (FAR.has(node) || !options.length) options = this.edges.filter((e) => e.a === node || e.b === node);
    // prefer carrying on along the pavement over doubling back
    const e = options[Math.floor(this.rand() * options.length)];
    w.edge = e;
    w.forward = e.a === node;
    w.path = new Path(w.forward ? e.pts : [...e.pts].reverse());
    w.s = 0;
    this.setupEdge(w);
  }

  /** is it safe to step onto the zebra? no car close enough that it couldn't stop */
  private zebraClear(): boolean {
    for (const d of this.drivers) {
      if (!d.alive) continue;
      const g = d.route.gates.find((x) => x.kind === 'cross' && x.id === 'zebra');
      if (!g) continue;
      const front = d.s + d.L / 2;
      const dist = g.s - front;
      if (dist < -1 || dist > 45) continue;
      if (front > g.s && front < (g as { sOut: number }).sOut + d.L) return false;
      const need = (d.v * d.v) / (2 * 3.0) + 3;
      if (d.v > 1.2 && dist < need) return false;
    }
    return true;
  }

  update(dt: number): void {
    dt = Math.min(dt, 0.05);
    this.signals.update(dt);
    this.updateCars(dt);
    this.updateWalkers(dt);
  }

  private updateCars(dt: number): void {
    this.spawnT -= dt;
    if (this.spawnT <= 0 && this.drivers.filter((d) => d.alive).length < this.carCount) {
      this.spawnT = 1.2 + this.rand() * 2;
      this.spawnCar(false);
    }
    const tmp = { x: 0, z: 0, hx: 0, hz: 0 };
    const tmp2 = { x: 0, z: 0, hx: 0, hz: 0 };
    const alive = this.drivers.filter((d) => d.alive);
    const positions = alive.map((d) => d.route.path.at(d.s, { x: 0, z: 0, hx: 0, hz: 0 }));
    alive.forEach((d, di) => {
      const p = d.route.path;
      const front = d.s + d.L / 2;
      // obstacles along our own path: cars and people within a lane's half-width
      let gap = 200, vLead = d.v;
      let blocker: Driver | null = null;
      // two cars waiting on each other: the one going straight has priority
      const mutual = d.wait > 2.5 && d.blocker && d.blocker.blocker === d && d.blocker.wait > 2.5;
      const yieldsInDeadlock = !!d.route.turnLeft || d.route.entry === 'N';
      for (let k = 1; k <= 22; k++) {
        const ds = k * 2;
        p.at(front + ds, tmp);
        for (let j = 0; j < alive.length; j++) {
          if (j === di) continue;
          const q = positions[j];
          const e = alive[j];
          if (mutual && e === d.blocker && !yieldsInDeadlock) continue;
          const dx = q.x - tmp.x, dz = q.z - tmp.z;
          const lat = Math.abs(dx * tmp.hz - dz * tmp.hx);
          const along = dx * tmp.hx + dz * tmp.hz;
          if (lat < 1.5 && Math.abs(along) < e.L / 2 + 1) {
            const g = ds - e.L / 2 + along;
            if (g < gap) { gap = Math.max(0.1, g); vLead = e.v * Math.max(0, q.hx * tmp.hx + q.hz * tmp.hz); blocker = e; }
          }
        }
        for (const w of this.walkers) {
          if (Math.hypot(w.x - tmp.x, w.z - tmp.z) < 1.6 && (w.on || this.onRoad(w.x, w.z))) {
            const g = ds - 1.2;
            if (g < gap) { gap = Math.max(0.1, g); vLead = 0; blocker = null; }
          }
        }
        if (gap < ds) break;
      }
      d.blocker = blocker;
      // gates: lights, crossings, giving way
      let stop = 1e9;
      for (const g of d.route.gates) {
        const dist = g.s - front;
        if (dist < -0.5 || dist > 70) continue;
        if (g.kind === 'signal') {
          const light = this.signals[g.group];
          const canStop = dist > (d.v * d.v) / (2 * 3.2) + 0.5;
          if (light === 'red' || light === 'redamber' || (light === 'amber' && canStop)) stop = Math.min(stop, dist - 0.3);
        } else if (g.kind === 'cross') {
          if (front > g.s - 0.3) continue;
          const occ = this.occupied[g.id].size > 0;
          const zebraWait = CROSSINGS[g.id].zebra && this.waiting[g.id].size > 0 && dist > (d.v * d.v) / (2 * 3.5);
          if (occ || zebraWait) stop = Math.min(stop, dist - 1.2);
        } else if (g.kind === 'yield') {
          if (front > g.s + 0.5) continue;
          let clear = true;
          for (let j = 0; j < alive.length; j++) {
            const e = alive[j];
            if (!e.route.wb) continue;
            const q = positions[j];
            const toConf = q.x - g.conflict[0];
            if (toConf < -3 || toConf > 70) continue;
            if (toConf < 6 || toConf / Math.max(e.v, 0.5) < 4.5) { clear = false; break; }
          }
          if (!clear) stop = Math.min(stop, dist);
        }
      }
      if (stop < gap) { gap = Math.max(0.05, stop); vLead = 0; }
      // corner speed limits, anticipated with comfortable braking
      let v0 = d.v0;
      for (const [a, b, vm] of p.slow) {
        const dist = a - front;
        if (front > b) continue;
        const allowed = dist > 0 ? Math.sqrt(vm * vm + 2 * 1.8 * dist) : vm;
        v0 = Math.min(v0, allowed);
      }
      // IDM
      const A = 1.6, Bc = 2.6, s0 = 2.2, T = 1.25;
      const sStar = s0 + d.v * T + (d.v * (d.v - vLead)) / (2 * Math.sqrt(A * Bc));
      let acc = A * (1 - Math.pow(d.v / Math.max(v0, 0.1), 4) - Math.pow(Math.max(0, sStar) / gap, 2));
      acc = Math.max(acc, -7.5);
      d.a += (acc - d.a) * Math.min(1, dt * 6);
      d.v = Math.max(0, d.v + d.a * dt);
      if (gap < 0.6) d.v = Math.min(d.v, 0.2);
      d.s += d.v * dt;
      d.wait = d.v < 0.2 ? d.wait + dt : 0;
      if (d.s > p.len - 2) { d.alive = false; d.car.root.visible = false; return; }
      p.at(d.s, tmp2);
      const yaw = Math.atan2(tmp2.hx, tmp2.hz);
      let dy = yaw - d.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      d.yaw += dy * Math.min(1, dt * 12);
      const turn = dy * Math.min(1, dt * 12) / Math.max(dt, 1e-4);
      d.car.drive(dt, tmp2.x, tmp2.z, d.yaw, d.v, d.a, turn, 0.04);
    });
  }

  private onRoad(x: number, z: number): boolean {
    return (Math.abs(z) < 3.6 && Math.abs(x) < 330) || (Math.abs(x) < 3.6 && z < 0);
  }

  private updateWalkers(dt: number): void {
    const tmp = { x: 0, z: 0, hx: 0, hz: 0 };
    for (const w of this.walkers) {
      const cross = w.edge.crossing;
      let target = w.speed;
      let pose: 'walk' | 'wait' = 'walk';
      // waiting at the kerb
      if (cross && w.waitAt >= 0 && w.s >= w.waitAt - 0.05 && !w.on) {
        const c = CROSSINGS[cross];
        const crossT = 7.7 / (w.speed * 1.15);
        // zebra: step out once no car is too close to stop; signals: only with enough green man left
        const go = c.zebra ? this.zebraClear() : (c.walk === 'A' ? this.signals.walkLeftA : this.signals.walkLeftB) > crossT * 0.55;
        if (go) {
          this.waiting[cross].delete(w);
          this.occupied[cross].add(w);
          w.on = cross;
        } else {
          this.waiting[cross].add(w);
          target = 0;
          pose = 'wait';
          w.s = w.waitAt;
        }
      }
      if (w.on) target = w.speed * 1.15;
      // keep right and give other walkers room
      let side = w.side;
      for (const o of this.walkers) {
        if (o === w) continue;
        const dx = o.x - w.x, dz = o.z - w.z;
        const d = Math.hypot(dx, dz);
        if (d > 3.2 || d < 1e-3) continue;
        const fx = Math.sin(w.yaw), fz = Math.cos(w.yaw);
        const along = dx * fx + dz * fz, lat = -dx * fz + dz * fx;
        if (along <= 0) continue;
        const sameWay = Math.sin(o.yaw) * fx + Math.cos(o.yaw) * fz > 0.3;
        if (Math.abs(lat) < 0.75) {
          if (sameWay && o.v < w.v) target = Math.min(target, o.v * (along > 1.2 ? 1 : 0.6));
          else if (!sameWay) side += 0.6;
        }
        if (d < 0.7) target = Math.min(target, 0.4);
      }
      w.off += (side - w.off) * Math.min(1, dt * 2);
      w.v += (target - w.v) * Math.min(1, dt * 3);
      w.s += w.v * dt;
      if (w.on && w.s > w.path.cum[2]) {
        this.occupied[w.on].delete(w);
        w.on = null;
        w.waitAt = -1;
      }
      if (w.s >= w.path.len) this.nextEdge(w);
      w.path.at(w.s, tmp);
      // right of travel direction is (-hz, hx) in this frame
      const tx = tmp.x - tmp.hz * w.off, tz = tmp.z + tmp.hx * w.off;
      const pyaw = Math.atan2(tmp.hx, tmp.hz);
      let faceYaw = pyaw;
      if (pose === 'wait' && cross) {
        const c = CROSSINGS[cross];
        faceYaw = c.z1 - c.z0 > c.x1 - c.x0 ? (tmp.z < 0 ? 0 : Math.PI) : tmp.x < 0 ? Math.PI / 2 : -Math.PI / 2;
      }
      let dy = faceYaw - w.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      w.yaw += dy * Math.min(1, dt * 5);
      w.x = tx;
      w.z = tz;
      const y = this.onRoad(tx, tz) ? 0.04 : KERB;
      w.p.root.position.set(tx, y, tz);
      w.p.root.rotation.y = w.yaw;
      w.pose = pose;
    }
  }

  /** advance the animation of every visible person */
  animate(dt: number, rain: number, cam: THREE.Vector3): void {
    for (const w of this.walkers) {
      const far = Math.hypot(w.x - cam.x, w.z - cam.z) > 140;
      w.p.root.visible = !far;
      if (!far) w.p.animate(dt, w.pose === 'wait' ? 'wait' : w.v > 0.15 ? 'walk' : 'idle', w.v, rain);
    }
  }

  /** drive the lamps on every signal head */
  showSignals(heads: { A: SignalHead[]; B: SignalHead[]; walkA: SignalHead[]; walkB: SignalHead[] }, k: number, t: number): void {
    for (const h of heads.A) h.set(this.signals.A, k);
    for (const h of heads.B) h.set(this.signals.B, k);
    const ped = (w: Walk): 'red' | 'green' => (w === 'green' || (w === 'flash' && Math.floor(t * 2.5) % 2 === 0) ? 'green' : 'red');
    for (const h of heads.walkA) h.set(this.signals.walkA === 'red' ? 'red' : ped(this.signals.walkA), k);
    for (const h of heads.walkB) h.set(this.signals.walkB === 'red' ? 'red' : ped(this.signals.walkB), k);
  }
}

/* ============================================================
   The soundscape (V2): what is around the listener, measured a
   few times a second for audio/sounds.ts to mix: how open the
   place is and how high up, the trees, the sea or a river, the
   traffic and the people, the building sites, fires and works,
   the nearest vehicles (each gets an engine voice), the nearest
   siren, a crowd gathered; and every frame, the Founder's own
   driving and footsteps, and the room they're in.
   Positions in metres; the sim's are V1 pixels (×0.5).
   ============================================================ */
import { Snd, type Scene } from './sounds';
import { Sim } from '../sim/agents';
import { Life } from '../sim/life';
import { World, G_SAND, G_ROCK } from '../sim/world';
import { CAT } from '../sim/catalog';
import { Weather } from '../sim/weather';
import { Festivals } from '../sim/festivals';
import { railPose } from '../sim/traffic';
import { ENV } from '../gfx/env';
import { isWaterAt, heightAt } from '../render/terrain';
import { Input } from '../input/input';
import type { Founder } from '../player/founder';
import type { Indoors } from '../player/indoors';
import type { TreeLayer } from '../gfx/vegetation';

const TM = 8, PX = 0.5;
const INDUSTRY = new Set(['factory', 'steelworks', 'sawmill', 'brickworks', 'textilemill', 'cannery', 'glassworks', 'powerplant', 'warehouse', 'watertower']);
/** rooms with music playing */
const MUSIC = new Set(['shop', 'market', 'mall', 'deptstore', 'cafe', 'restaurant', 'icecream', 'pizzeria', 'pizzapalace', 'burgerpalace', 'goldenarches', 'crispycluck', 'tacobelle', 'teastall', 'barber', 'florist', 'toyshop', 'electronics', 'gym', 'arcade', 'casino', 'boatclub', 'hotel', 'bakery', 'tailor', 'furniture']);

export class Soundscape {
  private scene: Scene = {
    indoors: false, height: 1.7, open: 0.5, trees: 0, water: 0, sea: 0, traffic: 0, crowd: 0, dark: 0, clock: 720, season: 0,
    rain: 0, snow: 0, wind: 0.3, sites: [], fires: [], works: [], cars: [],
  };
  private t = 0;
  private lastPhase = 0;

  constructor(private founder: Founder, private indoors: Indoors, private trees: () => TreeLayer | null) {}

  /** one frame: the listener at (x, y, z) metres (the camera, or the view's centre in the Planner) */
  frame(dt: number, x: number, y: number, z: number, o: { dark: number; planner?: boolean; street?: boolean }): void {
    const s = this.scene;
    this.t -= dt;
    if (this.t <= 0) { this.t = 0.25; this.measure(x, y, z); }
    s.dark = o.dark;
    s.clock = Sim.clock;
    s.season = Weather.season;
    s.rain = Weather.isRaining() ? Weather.intensity : 0;
    s.snow = Weather.isSnowing() ? Weather.intensity : 0;
    s.wind = ENV.wind.value;
    // the Founder: at the wheel, or footsteps on whatever they walk on
    const f = this.founder;
    s.drive = undefined;
    s.step = undefined;
    if (o.street && !o.planner && !s.indoors && f.driving && f.vehicle) {
      const v = f.vehicle, p = Input.pedals();
      const kind = v.work?.type === 'bike' ? 'bike' : v.kind === 'moto' ? 'moto' : ['bus', 'fire', 'truck'].includes(v.work?.type ?? '') ? (v.work?.type === 'bus' ? 'bus' : 'truck') : 'car';
      s.drive = { v: f.car.speed, gas: p.gas, brake: p.brake, skid: Input.handbrake() && Math.abs(f.car.speed) > 5 ? 1 : p.brake > 0.8 && Math.abs(f.car.speed) > 14 ? 0.6 : 0, kind };
    } else if (o.street && !o.planner) {
      // a step lands twice a stride (the walk cycle's phase crossing each half turn)
      const ph = (f as unknown as { phase: number }).phase ?? 0;
      if (Math.floor(ph / Math.PI) !== Math.floor(this.lastPhase / Math.PI) && f.mesh.userData.moving) s.step = { surface: this.surface(), run: !!f.mesh.userData.run };
      this.lastPhase = ph;
    }
    if (s.indoors) {
      const I = this.indoors;
      if (I.active && I.L) {
        const ph = I.bobPhase();
        if (Math.floor(ph / Math.PI) !== Math.floor(this.lastPhase / Math.PI)) s.step = { surface: I.L.theme.floor === 'wood' ? 'wood' : I.L.theme.floor === 'carpet' ? 'carpet' : I.L.theme.floor === 'tile' ? 'tile' : 'hard', run: false };
        this.lastPhase = ph;
      }
    }
    Snd.tick(dt, s);
  }

  /** what the Founder is walking on */
  private surface(): 'hard' | 'grass' | 'snow' | 'gravel' | 'sand' {
    const p = this.founder.pos, tx = Math.floor(p.x / TM), tz = Math.floor(p.z / TM);
    if (ENV.snow.value > 0.35) return 'snow';
    if (World.isRoad(tx, tz) || World.buildingAt(tx, tz)) return 'hard';
    if (heightAt(p.x, p.z) > 0.6) return 'gravel';
    const g = World.inB(tx, tz) ? World.ground[World.idx(tx, tz)] : 0;
    return g === G_SAND ? 'sand' : g === G_ROCK ? 'gravel' : 'grass';
  }

  /** a few times a second: what's around */
  private measure(x: number, y: number, z: number): void {
    const s = this.scene;
    const I = this.indoors;
    s.indoors = I.active && !!I.L;
    s.room = s.indoors ? { template: I.L!.template, type: I.b?.type ?? '', w: I.L!.w, d: I.L!.d, h: I.L!.h, people: I.people.length, music: MUSIC.has(I.b?.type ?? '') && Sim.clock > 420 && Sim.clock < 1320 } : undefined;
    s.height = Math.max(0, y - Math.max(0, heightAt(x, z)));
    // open ground: few buildings round about
    let built = 0;
    const tx = Math.floor(x / TM), tz = Math.floor(z / TM);
    for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) if (World.inB(tx + i, tz + j) && World.buildingAt(tx + i, tz + j)) built++;
    s.open = Math.max(0, 1 - built / 18);
    // trees within 45 m (the forest's own list, which reaches beyond the map's edge too)
    let tr = 0;
    const T = this.trees();
    if (T) for (const t of (T as unknown as { trees: { x: number; z: number }[] }).trees) { const d = Math.abs(t.x - x) + Math.abs(t.z - z); if (d < 60) tr += 1 - d / 60; }
    s.trees = Math.min(1, tr / 14);
    // water: how much of a ring round the listener is water, close and further out
    let wn = 0, wf = 0;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      if (isWaterAt(x + c * 18, z + sn * 18)) wn++;
      if (isWaterAt(x + c * 60, z + sn * 60)) wf++;
    }
    s.water = Math.min(1, wn / 4 + wf / 10);
    s.sea = wf >= 5 ? Math.min(1, wf / 8 + wn / 8) : 0;
    // traffic and people
    const cars: Scene['cars'] = [];
    let traffic = 0, crowd = 0;
    const lx = x, lz = z;
    const veh = (who: unknown, px: number, py: number, v: number, kind: Scene['cars'][number]['kind']): void => {
      const mx = px * PX, mz = py * PX, d = Math.hypot(mx - lx, mz - lz);
      if (d > 900) return;
      if (kind !== 'plane' && kind !== 'heli' && kind !== 'train') traffic += (v > 0.3 ? 1 : 0.3) * Math.max(0, 1 - d / 260) ** 1.5;
      if (d < (kind === 'plane' || kind === 'heli' ? 900 : kind === 'train' ? 420 : 200)) cars.push({ who, x: mx, z: mz, v, kind });
    };
    for (const p of Sim.people) {
      if (p.state !== 'walk' || !p.trip) continue;
      const t = p.trip;
      if (t.car || t.taxi || t.moto) { if (t.joined !== false) veh(p, p.x, p.y, (t.v ?? 0) * TM, t.moto ? 'moto' : 'car'); }
      else { const d = Math.hypot(p.x * PX - lx, p.y * PX - lz); if (d < 30) crowd += 1 - d / 30; }
    }
    const L = Life as any;
    for (const b of L.buses || []) if (!b.hidden) veh(b, b.x, b.y, (b.v ?? 1) * TM * (b.pause > 0 ? 0 : 1), 'bus');
    for (const c of L.taxis || []) veh(c, c.x, c.y, (c.v ?? 1.4) * TM * (c.pause > 0 ? 0 : 1), 'car');
    for (const u of [...(L.police || []), ...(L.ambulances || []), ...(L.tourists || []), ...(L.campaignCars || [])]) if (u.off === undefined && u.x !== undefined) veh(u, u.x, u.y, ((u.drv ?? u).v ?? 1.5) * TM, 'car');
    for (const u of [...(L.fireTrucks || []), ...(L.trucks || []), ...(L.crews || [])]) if (u.x !== undefined && u.phase !== 'wait') veh(u, u.x, u.y, ((u.drv ?? u).v ?? 1.2) * TM, 'truck');
    for (const tr of L.intercity ? L.trains.concat([L.intercity]) : L.trains || []) {
      if (tr.hidden || !tr.route) continue;
      const pt = railPose(tr.route, Math.max(0, Math.min(tr.route.length - 1, tr.prog)), (tr.lane || 0));
      veh(tr, pt.x, pt.y, Math.abs(tr.speed ?? 4) * TM * (tr.stopT > 0 ? 0 : 1), 'train');
    }
    for (const pl of L.planes || []) veh(pl, pl.x, pl.y, 40, 'plane');
    for (const h of L.helis || []) veh(h, h.x, h.y, 20, 'heli');
    for (const bt of [...(L.boats || []), ...(L.ferry ? [L.ferry] : [])]) if (bt.x !== undefined) veh(bt, bt.x, bt.y, 4, 'boat');
    cars.sort((a, b) => Math.hypot(a.x - lx, a.z - lz) - Math.hypot(b.x - lx, b.z - lz));
    s.cars = cars.filter((c) => c.v > 0.4 || c.kind === 'plane' || c.kind === 'heli').slice(0, 6);
    s.traffic = Math.min(1, traffic / 5);
    for (const g of [...(L.gawkers || []), ...(L.alighters || [])]) if (g.x !== undefined) { const d = Math.hypot(g.x * PX - lx, g.y * PX - lz); if (d < 30) crowd += 1 - d / 30; }
    s.crowd = Math.min(1, crowd / 6);
    // the nearest siren on blue lights
    let best = 1e9;
    s.siren = undefined;
    const blue = (u: any, kind: 'police' | 'fire' | 'ambulance'): void => {
      if (u.x === undefined) return;
      const mx = u.x * PX, mz = u.y * PX, d = Math.hypot(mx - lx, mz - lz);
      if (d < best && d < 420) { best = d; s.siren = { x: mx, z: mz, kind }; }
    };
    for (const u of L.police || []) if (u.phase === 'go' || u.pursuit) blue(u, 'police');
    for (const u of L.fireTrucks || []) if (u.phase === 'go') blue(u, 'fire');
    for (const a of L.ambulances || []) if (a.phase === 'go' || a.patient?.state === 'amb') blue(a, 'ambulance');
    // a crowd gathered: the rally on its green
    s.gathering = undefined;
    if (L.rally && L.rally.x !== undefined) {
      const mx = L.rally.x * PX, mz = L.rally.y * PX, d = Math.hypot(mx - lx, mz - lz);
      if (d < 160) s.gathering = { x: mx, z: mz, k: Math.max(0, 1 - d / 160), cheer: Math.random() < 0.25 };
    }
    if (Festivals.santa) { const d = Math.hypot(Festivals.santa.x * PX - lx, Festivals.santa.y * PX - lz); if (d < 30) s.crowd = Math.min(1, s.crowd + 0.3); }
    // building sites at work, fires, the works
    s.sites = []; s.fires = []; s.works = [];
    const hours = Sim.clock > 400 && Sim.clock < 1110;
    for (const b of World.buildings) {
      const bx = (b.x + b.w / 2) * TM, bz = (b.y + b.h / 2) * TM, d = Math.hypot(bx - lx, bz - lz);
      if (d > 160) continue;
      if (b.fire) s.fires.push({ x: bx, z: bz, k: Math.min(1, 0.5 + (b.fire.level ?? b.fire) * 0.1) });
      else if (hours && (b.construction > 0 || b.upgrading > 0) && !b.stalled) s.sites.push({ x: bx, z: bz, k: 1 });
      else if (INDUSTRY.has(b.type) && !b.ruined && !b.construction && (b.workers || []).some((w: any) => w.state === 'in' && w.at === b)) s.works.push({ x: bx, z: bz, k: CAT[b.type]?.smoke ? 1 : 0.6 });
    }
  }
}

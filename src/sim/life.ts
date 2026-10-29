// Ported from PixelVille V1 js/life.js (see docs/DESIGN.md §3), typed against src/sim/types.ts. Behaviour changes for 3D are marked "V2:".
import type { Building, Person } from './types';
import { Tasks } from './tasks';
import { GH, GW, G_WATER, MSIZE, World } from './world';
import { MIN_PER_SEC, Snd, T, midPx } from './core';
import { News } from './news';
import { Weather } from './weather';
import { Sim } from './agents';
import { CAT } from './catalog';
import { Mind } from './mind';
import { Calamity } from './calamity';
import { Gov } from './gov';
import { Festivals } from './festivals';
import { Traffic, lanePose, railPose, kerbside, isBox, CAR_LEN, FOOT_PX } from './traffic';
import { Walk, Stroll } from './walking';
/** V2: seconds a visitor's car, a cab or a delivery truck can stand without moving before it leaves the jam (gridlock
 *  relief, as for the villagers' cars) */
export const STUCK_RELIEF = 150;
import { peakTrail } from './peak';
import { Rep } from './reputation';
import { Health } from './health';
import { Supply } from './supply';
import { Gateways } from './gateways';
import { Hustings } from './hustings';
import { Approach } from './approach';
/* ============================================================
   PixelVille — ambient life & the crime and justice system.
   Hikers trek up mountains (torches at night), birds cross the
   sky, and unemployment breeds night-time burglaries that the
   police (and courthouse) answer.
   ============================================================ */

/** V2 (Milestone 8): the last bus and the last train of the night leave at 23:30 (game-minutes) */
export const LAST_TRAIN = 1410;

export const Life: any = {
  hikers: [],           // {route, idx, f, pause, seed, x, y, done}
  convoy: null,         // V2 (Milestone 8): the Christmas tree on its flatbed, while it's hauled (sim/festivals.ts)
  birds: [],            // {x, y, vx, ph}
  ducks: [],            // {x, y, tx, ty, flip}
  butterflies: [],      // {ax, ay, ph, v}
  tourists: [],         // out-of-town cars visiting venues
  rockets: [], sparks: [],
  fireflySpots: [],     // filled by main on ground rebuild (tree positions)
  waterTiles: [], edgeRoads: [],  // filled by main on ground rebuild
  crime: null,          // {burglar, target, phase, robT, fled}
  police: [],           // {path, prog, x, y, dirx, phase, station}
  // V2: ambulances (health.ts), delivery trucks (supply.ts), power repair crews (power.ts)
  ambulances: [], trucks: [], crews: [],
  intercity: null,      // V2: the Intercity Express on the national line (gateways.ts)
  arrests: 0, crimes: 0,
  cooldown: 240,        // game-min until first possible crime
  onEvent: null,        // toast hook
  // V2 (Milestone 6): the Founder on a shift answers calls (src/player/shifts.ts):
  // (kind: 'fire' | 'police' | 'ambulance' | 'power', scene) => true if they take it
  claim: null,

  reset() {
    this.hikers = []; this.birds = []; this.ducks = []; this.butterflies = []; this.convoy = null;
    this.tourists = []; this.rockets = []; this.sparks = [];
    this.crime = null; this.police = []; this.arrests = 0; this.crimes = 0; this.cooldown = 240;
    this.ambulances = []; this.trucks = []; this.crews = []; this.intercity = null;
    this.fireTrucks = []; this.firesRecent = 0; this.buckets = [];
    this.disaster = null; this.collapseCd = 1440;
    this.dispute = null; this.crash = null; this.incidentCd = 120; this.gawkers = [];
    this.riot = null; this.roadworks = []; this.workT = 200;
    this.rally = null;
    this.buses = []; this.busSig = ''; this.busT = 0;
    this.taxis = []; this.taxiSig = ''; this.taxiT = 0;
    this.stopQueues = new Map(); this.alighters = []; this.queueT = 0;
    this.trains = []; this.trainSig = ''; this.trainT = 0;
    this.boats = []; this.ferry = null; this.ferrySig = '';
    this.helis = []; this.heliCd = 300;
    this.campaignCars = []; this.votingBooths = null;
    Hustings.reset();
    this.trials = []; this.graveCases = 0; this.graveCd = 2400; this.graveCrime = null;
    this.reporters = []; this.beachfolk = []; this.sandTiles = [];
    Approach.reset();
    Tasks.reset();
  },
  /* `at` (optional, world px {x,y}) makes the toast clickable — one click
     pans the camera to the scene, and the minimap gets a flashing pin */
  say(m: string, at: any) { if (this.onEvent) this.onEvent(m, at); },

  tick(dtSim: number, dtReal: number) {
    this.tickHikers(dtSim);
    this.tickBirds(dtSim);
    this.tickDucks(dtSim);
    this.tickButterflies(dtReal);
    this.tickTourists(dtSim);
    Approach.tick(dtSim); // V2: traffic on the roads beyond the map's edge
    this.tickFireworks(dtReal);
    this.tickCrime(dtSim);
    this.tickFires(dtSim);
    this.tickPlanes(dtSim, dtReal);
    this.tickWorks(dtSim);
    this.tickIncidents(dtSim);
    this.tickGawkers(dtSim);
    this.tickDisaster(dtSim);
    this.tickRiot(dtSim);
    this.tickRally(dtSim);
    this.tickSky(dtSim, dtReal);
    this.tickBuses(dtSim);
    this.tickTaxis(dtSim);
    this.tickTransitQueues(dtSim);
    this.tickTrains(dtSim);
    this.tickBoats(dtSim);
    this.tickHelis(dtSim, dtReal);
    this.tickCampaignLife(dtSim);
    this.tickJustice(dtSim);
    this.tickReporters(dtSim);
    this.tickBeach(dtSim);
  },

  /* ---------------- the press: PVTV reporters cover every incident ---------------- */
  reporters: [],
  coverStory(cx: number, cy: number, ref: any, headline: string) {
    const station = World.buildings.find((b: Building) => b.type === 'tvstation' && b.connected && !b.construction && !b.ruined);
    if (!station || this.reporters.length >= 3) return;
    // (V2: filming from the pavement, not the middle of the road)
    const spot = Stroll.offRoad(cx + 10, cy + 6);
    this.reporters.push({
      sx: station.door.x * T + 8, sy: station.door.y * T + 8,
      tx: spot.x, ty: spot.y,
      f: 0, phase: 'come', stay: 30, age: 0, ref: ref || null,
      seed: (station.id * 131 + this.reporters.length * 17) >>> 0,
    });
    if (headline) News.breaking(headline);
  },
  /** V2: someone in a gathering crowd moves along their route (sim/walking.ts Stroll) at `px` pixels a second */
  stroll(o: any, px: number, dt: number) {
    // (and they wait for a car in their way, as anyone on foot does)
    // (for a while: something left standing across their way for good, they go round it)
    const there = px > 0 ? o.f >= 1 : o.f <= 0;
    // (V2: and once they've waited their while, they do go on, for a few seconds, rather than waiting again at once: the
    // count went back to nothing the moment it ran out, so they stood for good, often out in the road, with the car
    // they were waiting for waiting for them)
    if ((o.goT || 0) > 0) o.goT -= dt;
    const wait = !there && (o.goT || 0) <= 0 && Stroll.blocked(o, Math.sign(px));
    o.waitB = wait ? (o.waitB || 0) + dt : 0;
    if (o.waitB >= 8) { o.waitB = 0; o.goT = 4; }
    if (!there && !wait) o.f = Math.max(0, Math.min(1, o.f + dt * Stroll.rate(o, Math.abs(px)) * Math.sign(px)));
    Stroll.place(o);
  },
  tickReporters(dt: number) {
    const gm = dt * MIN_PER_SEC;
    for (const r of this.reporters) {
      r.age += gm;
      if (r.phase === 'come') {
        this.stroll(r, 5, dt); // (hurrying with the camera)
        if (r.f >= 1) r.phase = 'report';
      } else if (r.phase === 'report') {
        r.stay -= gm;
        const live = r.ref && !r.ref.over && r.age < 200;
        if (r.stay <= 0 && !live) r.phase = 'leave';
      } else {
        this.stroll(r, -2.8, dt);
      }
    }
    this.reporters = this.reporters.filter((r: any) => r.phase !== 'leave' || r.f > 0);
  },

  /* ---------------- beach days: towels, umbrellas & waders on the sand ---------------- */
  beachfolk: [], sandTiles: [],
  tickBeach(dt: number) {
    const warm = Weather.season <= 1 && !Weather.isRaining();
    const daytime = Sim.clock > 540 && Sim.clock < 1140;
    const want = (warm && daytime && this.sandTiles.length > 20)
      ? Math.min(14, 2 + (Sim.people.length / 6 | 0)) : 0;
    while (this.beachfolk.length < want) {
      const [tx, ty] = this.sandTiles[(Math.random() * this.sandTiles.length) | 0];
      this.beachfolk.push({
        x: tx * T + 3 + Math.random() * 10, y: ty * T + 3 + Math.random() * 10,
        seed: (Math.random() * 1e6) | 0,
        kind: ['man', 'woman', 'kid'][(Math.random() * 3) | 0],
        mode: Math.random() < 0.4 ? 'towel' : Math.random() < 0.5 ? 'stand' : 'wade',
        towelC: ['#e05a5a', '#4f9ed0', '#f2c14f', '#5fae62'][(Math.random() * 4) | 0],
        umbrella: Math.random() < 0.45,
        ph: Math.random() * 7,
      });
    }
    if (this.beachfolk.length > want) this.beachfolk.length = want;
    for (const bf of this.beachfolk) bf.ph += dt;
  },

  /* ---------------- election rallies & celebrations ----------------
     V2: the rally (and polling day) happen on open ground, in daylight, with real villagers walking there and
     back: sim/hustings.ts. `rally` and `votingBooths` are what's standing there now (for the renderer and PVTV). */
  rally: null,
  tickRally(dt: number) {
    Hustings.tick(dt);
  },
  celebrate(x: number, y: number, color: string) {
    for (let i = 0; i < 44; i++) {
      const a = Math.random() * 6.283, sp = 14 + Math.random() * 34;
      this.sparks.push({
        x: x + (Math.random() * 20 - 10), y: y - 6 - Math.random() * 8, gy: y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 14,
        life: 1 + Math.random() * 0.5,
        hue: Math.random() < 0.6 ? (color || '#ffd160') : ['#ffd160', '#ff90e0', '#80ff90'][(Math.random() * 3) | 0],
      });
    }
  },

  /* ---------------- building fires & the fire brigade ---------------- */
  fireTrucks: [], buckets: [],
  /* neighbours grab buckets and run over — the fire can only be contained
     when a crew is visibly on the scene */
  formBucket(b: Building) {
    if (this.buckets.some((k: any) => k.b === b)) return;
    const cx = b.x * T + b.w * 8, cy = b.y * T + b.h * 8;
    const helpers = [];
    for (const h of World.buildings) {
      if (helpers.length >= 4) break;
      if (!CAT[h.type].res || !h.residents.length || h === b || h.ruined) continue;
      if (Math.abs(h.x - b.x) + Math.abs(h.y - b.y) > 22) continue;
      // (V2: where they stand with the buckets: off the road, out of the traffic)
      const at = Stroll.offRoad(cx + Math.cos(helpers.length * 1.6 + b.id) * (b.w * 8 + 9), cy + Math.sin(helpers.length * 1.6 + b.id) * (b.h * 8 + 7) + 5);
      helpers.push({
        sx: h.door.x * T + 8, sy: h.door.y * T + 8,
        tx: at.x, ty: at.y,
        f: 0, seed: (h.id * 613 + helpers.length * 7) >>> 0,
        kind: helpers.length % 2 ? 'woman' : 'man',
      });
    }
    if (helpers.length) this.buckets.push({ b, helpers });
  },
  dispatchFire(b: Building, announce: boolean) {
    if (!b || !b.fire || this.fireTrucks.some((u: any) => u.target === b && !u.done)) return false;
    if (this.claim && this.claim('fire', b)) return true; // V2: the Founder's engine is on its way
    const stations = World.buildings.filter((s: Building) => s.type === 'fire' && s.connected && !s.construction && !s.ruined);
    let best = null, bp = null;
    for (const s of stations) {
      const path = World.roadPath(s.door.x, s.door.y, b.door.x, b.door.y);
      if (path && (!bp || path.length < bp.length)) { best = s; bp = path; }
    }
    if (!best) {
      if (announce && !b.fireNoStationAnnounced) {
        b.fireNoStationAnnounced = true;
        this.say('🪣 No fire station — neighbours are forming a bucket brigade while the village considers one.');
      }
      return false;
    }
    this.fireTrucks.push({ path: kerbside(bp), prog: 0, x: best.door.x * T + 8, y: best.door.y * T + 8, dirx: 1, diry: 0, phase: 'go', target: b, douse: 0 });
    this.say(`🚒 Fire brigade dispatched from the ${CAT[best.type].name}!`);
    return true;
  },
  /* set a building alight with the full emergency response — used by random
     ignition, spreading flames and earthquake gas ruptures alike */
  igniteBuilding(b: Building, causeMsg: string) {
    if (!b || b.fire || b.ruined || b.construction) return false;
    // Fires are emergencies, not an instant demolition timer.  A building
    // has time for a truck to cross town, and neighbours can still limit
    // the damage when the village has not built a station yet.
    b.fire = 1; b.fireT = 300 + Math.random() * 120;
    b.fireNoStationAnnounced = false; b.fireDispatchRetry = 0; b.hosed = false;
    this.firesRecent = (this.firesRecent || 0) + 1;
    for (const r of b.residents) {
      r.mood = Math.max(5, (r.mood === undefined ? 60 : r.mood) - 15); // shock
      Mind.remember(r, 'fire', 'watched their home catch fire', -2, b.id);
    }
    if (b.ownerId) { // the owner family takes it hard too
      const oh = World.buildings.find((o: Building) => o.id === b.ownerId);
      if (oh) for (const r of oh.residents) r.mood = Math.max(5, (r.mood === undefined ? 60 : r.mood) - 10);
    }
    this.say(causeMsg || `🔥 Fire at the ${CAT[b.type].name}!`, { x: b.x * T + b.w * 8, y: b.y * T + b.h * 8 });
    Tasks.add('fire' + b.id, '🔥', `Put out the fire at the ${CAT[b.type].name}`);
    Snd.siren(midPx(b));
    // V2: whoever was inside gets out — a few with smoke in their lungs
    const hurt = Health.casualties(b, 0.22, [24, 55], `in the fire at the ${CAT[b.type].name.toLowerCase()}`);
    if (hurt) this.say(`🚑 ${hurt === 1 ? 'Someone was' : `${hurt} people were`} carried out of the ${CAT[b.type].name} — ${Health.hospitals().length ? 'ambulance called' : 'no hospital to send them to'}`);
    this.dispatchFire(b, true);
    this.coverStory(b.x * T + b.w * 8, (b.y + b.h) * T, b, `Fire at the ${CAT[b.type].name} — crews responding`);
    return true;
  },

  tickFires(dt: number) {
    const gm = dt * MIN_PER_SEC;
    this.firesRecent = Math.max(0, (this.firesRecent || 0) - gm / 7200); // memory fades over ~5 days
    // ignition
    for (const b of World.buildings) {
      if (b.fire || b.ruined || b.construction) continue;
      // V2 (Milestone 6): a fire safety inspection this week takes most of the risk away
      const mult = (b.type === 'factory' ? 3 : (b.type === 'restaurant' || b.type === 'bakery') ? 2 : 1) * (b.inspected > Sim.day ? 0.35 : 1);
      if (Math.random() < 0.000007 * mult * gm) this.igniteBuilding(b);
    }
    // burn down
    for (const b of World.buildings) {
      if (!b.fire) continue;
      // If a fire station is completed while a blaze is active, it can still
      // answer the call instead of waiting for the next fire.
      b.fireDispatchRetry = Math.max(0, (b.fireDispatchRetry || 0) - gm);
      if (b.fireDispatchRetry <= 0 && !this.dispatchFire(b, false)) {
        b.fireDispatchRetry = 90;
        this.formBucket(b); // no truck coming — neighbours run over themselves
      }
      // flames LEAP: a blaze burning with no truck on scene can catch the
      // neighbours — fire is a real threat to a dense street now
      if (Math.random() < 0.0009 * gm &&
          !this.fireTrucks.some((u: any) => u.target === b && u.phase === 'douse') && !b.hosed && // (V2: or the Founder's hose)
          World.buildings.filter((q: Building) => q.fire).length < 3) {
        const near = World.buildings.find((q: Building) => q !== b && !q.fire && !q.ruined && !q.construction &&
          Math.abs(q.x - b.x) < b.w + 3 && Math.abs(q.y - b.y) < b.h + 3);
        if (near) this.igniteBuilding(near, `🔥 The flames LEAPT to the ${CAT[near.type].name} next door!`);
      }
      b.fireT -= gm;
      if (b.fireT <= 0) {
        // Saving the structure requires responders visibly on the scene: a
        // bucket crew that actually made it, or a fire truck still dousing.
        const bucket = this.buckets.find((k: any) => k.b === b);
        const crew = bucket ? bucket.helpers.filter((h: any) => h.f >= 1).length : 0;
        if (crew >= 2 && Math.random() < 0.78) {
          b.fire = 0;
          b.renovating = Math.max(b.renovating || 0, 260);
          b.fireDamage = true;
          this.say(`🪣 The bucket brigade beat the flames at the ${CAT[b.type].name} — repairs are under way.`);
          Tasks.done('fire' + b.id, true, `Fire at the ${CAT[b.type].name} beaten by the bucket brigade`);
        } else {
          Tasks.done('fire' + b.id, false, `The ${CAT[b.type].name} burned down`);
          b.fire = 0; b.ruined = true; b.ruinedAt = Sim.day;
          Sim.onBuildingRemoved(b);
          b.jobs = 0; b.level = 1;
          World.dirty = true;
          Sim.safety = Math.max(20, Sim.safety - 4);
          this.say(`💔 The ${CAT[b.type].name} burned down — but the neighbors won't let it end there…`);
          this.startDisaster(b, 'fire');
        }
      }
    }
    // bucket crews hurry over; disband when the fire is over
    for (const k of this.buckets) for (const h of k.helpers) this.stroll(h, 6, dt); // (V2: running with the buckets, by the streets)
    this.buckets = this.buckets.filter((k: any) => k.b.fire);
    // trucks
    for (const u of this.fireTrucks) {
      if (u.phase === 'go') {
        // V2: fire engines ~72 km/h, on blue lights in the traffic (sim/traffic.ts): through red lights and first across
        // junctions, past a queue when the other lane is clear, never through a car (they used to drive through them)
        const step = Traffic.advance(u, (u.drv ??= {}), u.path, u.prog, 1, 2.5, dt, 1.1, true);
        u.prog += step;
        this.followPath(u, u.path, Math.min(u.prog, u.path.length - 1), Traffic.lanePx(u.drv));
        if (Traffic.there(u.drv, u.path.length - 1 - u.prog, step, dt)) {
          // (V2: behind anything already standing at the fire, not on top of it)
          u.prog = Traffic.settle(u, u.path, Math.min(u.prog, u.path.length - 1), Traffic.lanePx(u.drv), 1.1);
          this.followPath(u, u.path, u.prog, Traffic.lanePx(u.drv));
          u.phase = 'douse'; u.douse = 22;
        }
      } else if (u.phase === 'douse') {
        u.douse -= gm;
        if (u.douse <= 0 || !u.target.fire) {
          if (u.target.fire) {
            u.target.fire = 0;
            this.say(`🧯 Fire at the ${CAT[u.target.type].name} put out — building saved!`);
            Tasks.done('fire' + u.target.id, true, `Fire brigade saved the ${CAT[u.target.type].name}`);
          }
          u.phase = 'return'; u.path = this.backPath(u.path, u.prog); u.prog = 0; u.drv = {};
        }
      } else {
        const step = Traffic.advance(u, (u.drv ??= {}), u.path, u.prog, 1, 2.5, dt, 1.1);
        u.prog += step;
        this.followPath(u, u.path, Math.min(u.prog, u.path.length - 1), Traffic.lanePx(u.drv));
        if (Traffic.there(u.drv, u.path.length - 1 - u.prog, step, dt)) u.done = true;
      }
    }
    this.fireTrucks = this.fireTrucks.filter((u: any) => !u.done);
  },

  /* ---------------- public buses between bus stops ---------------- */
  buses: [], busSig: '', busT: 0,
  activeOf(type: string) {
    return World.buildings.filter((b: Building) => b.type === type && b.connected && !b.construction && !b.ruined);
  },
  tickBuses(dt: number) {
    const gm = dt * MIN_PER_SEC;
    this.busT -= gm;
    if (this.busT <= 0) {
      this.busT = 90;
      const stops = this.activeOf('busstop');
      // the road stamp keeps the route honest: bulldozed streets re-route the
      // line instead of buses driving over the grass where a road used to be
      const sig = stops.map((s: Building) => s.id).join(',') + '|' + World.roadStamp;
      if (sig !== this.busSig) {
        this.busSig = sig;
        this.buses = [];
        if (stops.length >= 2) {
          // chain the stops by proximity into one looping route
          const chain = [stops[0]];
          const rest = stops.slice(1);
          while (rest.length) {
            const last = chain[chain.length - 1];
            let bi = 0, bd = 1e9;
            rest.forEach((s: any, i: number) => {
              const d = Math.abs(s.x - last.x) + Math.abs(s.y - last.y);
              if (d < bd) { bd = d; bi = i; }
            });
            chain.push(rest.splice(bi, 1)[0]);
          }
          // V2 (Milestone 8): a true loop, back round to the first stop, driven one way: running the same
          // road back and forth had the bus on the wrong carriageway of every avenue on the way back
          let route: number[][] = [], stopIdx = [0];
          let ok = true;
          for (let i = 0; i < chain.length; i++) {
            const a = chain[i], b = chain[(i + 1) % chain.length];
            const seg = World.roadPath(a.door.x, a.door.y, b.door.x, b.door.y);
            if (!seg) { ok = false; break; }
            route = route.concat(i === 0 ? seg : seg.slice(1));
            if (i < chain.length - 1) stopIdx.push(route.length - 1);
          }
          if (ok && route.length > 3) {
            const nBuses = Math.min(3, 1 + ((chain.length / 3) | 0));
            for (let k = 0; k < nBuses; k++)
              this.buses.push({
                route, stopIdx, stops: chain, prog: this.unseenProg(route, (route.length - 1) * (k / nBuses)), dir: 1,
                pause: 0, x: route[0][0] * T + 8, y: route[0][1] * T + 8, dirx: 1, diry: 0,
                lastStop: -1, pax: [], cap: 6,
              });
            this.say(`🚌 The village bus line is running — ${chain.length} stops on the loop!`);
          }
        }
      }
    }
    // V2 (Milestone 8): the timetable. Every bus 05:30–21:00, one in the evening, none after the last bus at 23:30:
    // a bus whose service is over finishes its loop and goes back to the depot (out of sight) till morning
    // (V2: and it comes out, and goes back, somewhere on the loop out of the player's sight: it used to appear at the
    // first stop in the morning, and vanish there at night, in front of whoever was waiting)
    const running = !this.transitHours() ? 0 : Sim.clock >= 1260 ? 1 : this.buses.length;
    this.buses.forEach((bus: any, k: number) => {
      if (k < running) {
        if (bus.hidden) { bus.hidden = false; bus.prog = this.unseenProg(bus.route, 0); bus.lastStop = -1; bus.pause = 3; this.followPath(bus, bus.route, bus.prog, Traffic.lanePx(bus), bus.dir); }
        bus.last = bus.home = false;
      } else if (!bus.hidden) bus.last = true;
    });
    for (const bus of this.buses) {
      if (bus.hidden) continue;
      if (bus.home && !Approach.seen(bus.x, bus.y)) { bus.hidden = true; bus.home = false; bus.prog = 0; continue; }
      if (bus.pause > 0) { bus.pause -= gm; bus.v = 0; continue; }
      // V2: in the traffic like everyone else — queues, junctions, crossings, gates (sim/traffic.ts)
      bus.prog += Traffic.advance(bus, bus, bus.route, bus.prog, bus.dir, 1.3, dt, 1.3) * bus.dir; // ~37 km/h
      // round the loop again (V2 (Milestone 8); an old save's back-and-forth bus turns round as before)
      if (bus.prog >= bus.route.length - 1) {
        const loop = bus.route.length > 2 && bus.route[0][0] === bus.route[bus.route.length - 1][0] && bus.route[0][1] === bus.route[bus.route.length - 1][1];
        if (loop) { bus.prog -= bus.route.length - 1; bus.lastStop = -1; if (bus.last) bus.home = true; }
        else { bus.prog = bus.route.length - 1; bus.dir = -1; bus.pause = 5; }
      }
      if (bus.prog <= 0 && bus.dir < 0) { bus.prog = 0; bus.dir = 1; bus.pause = 5; }
      // brief stop at each bus shelter on the way — real passengers get on & off
      const at = Math.round(bus.prog);
      if (bus.stopIdx.includes(at) && at !== bus.lastStop) {
        bus.lastStop = at; bus.pause = 4;
        const stop = bus.stops[bus.stopIdx.indexOf(at)];
        if (stop) this.serveStop(bus, stop);
      }
      this.followPath(bus, bus.route, bus.prog, Traffic.lanePx(bus), bus.dir);
    }
  },

  /** V2: a point on a bus's loop out of the player's sight, at or before `want` (or `want`, if all of it is in view) */
  unseenProg(route: number[][], want: number): number {
    const n = route.length - 1;
    if (n < 1) return want;
    for (let d = 0; d < n; d++) {
      const k = (((Math.floor(want) - d) % n) + n) % n;
      if (!Approach.seen(route[k][0] * T + 8, route[k][1] * T + 8)) return k;
    }
    return want;
  },

  /* ---------------- taxi cabs cruising from the ranks ---------------- */
  taxis: [], taxiSig: '', taxiT: 0,
  /* the road tile a building meets the street on — where a cab picks up */
  streetTile(b: Building) {
    const d = b.door;
    if (World.isRoad(d.x, d.y)) return { x: d.x, y: d.y };
    return World.nearestRoad(d.x, d.y, 3);
  },
  /* send a cab from its rank to a random fare somewhere across town */
  pickTaxiRoute(stand: Building, standTile: any) {
    const dests = World.buildings.filter((b: Building) =>
      b !== stand && b.connected && !b.ruined && !b.construction);
    for (let tries = 0; tries < 8 && dests.length; tries++) {
      const dst = dests[(Math.random() * dests.length) | 0];
      const dt2 = this.streetTile(dst);
      if (!dt2) continue;
      const route = World.roadPath(standTile.x, standTile.y, dt2.x, dt2.y);
      if (route && route.length > 4) return route;
    }
    return null;
  },
  tickTaxis(dt: number) {
    const gm = dt * MIN_PER_SEC;
    this.taxiT -= gm;
    if (this.taxiT <= 0) {
      this.taxiT = 90;
      const stands = this.activeOf('taxistand');
      // re-plan the fleet when the ranks or the roads change
      const sig = stands.map((s: any) => s.id).join(',') + '|' + World.roadStamp;
      if (sig !== this.taxiSig) {
        this.taxiSig = sig;
        this.taxis = [];
        const pop = Sim.people.length;
        for (const stand of stands) {
          const tile = this.streetTile(stand);
          if (!tile) continue;
          const nCabs = Math.min(2, 1 + (pop > 70 ? 1 : 0));
          for (let k = 0; k < nCabs; k++) {
            const route = this.pickTaxiRoute(stand, tile);
            if (!route) continue;
            this.taxis.push({
              home: stand, standTile: tile, route, prog: 0, dir: 1, pause: 1 + k * 3,
              x: tile.x * T + 8, y: tile.y * T + 8, dirx: 1, diry: 0, pax: [], cap: 1,
            });
          }
        }
        if (this.taxis.length) this.say(`🚕 Cabs are working the streets — ${this.taxis.length} on the road.`);
      }
    }
    for (const cab of this.taxis) {
      if (cab.hired) continue; // V2: hired by the Founder (src/player/transit.ts drives it)
      if (cab.pause > 0) { cab.pause -= gm; cab.v = 0; this.rankSlot(cab); continue; }
      // V2: cabs drive in the traffic (queues, junctions, crossings, gates)
      const moved = Traffic.advance(cab, cab, cab.route, cab.prog, cab.dir, 1.6, dt);
      cab.prog += moved * cab.dir; // ~46 km/h
      // (V2: gridlock relief: a cab stuck for good is back at its rank for the next fare, any passenger dropped)
      cab.stuckT = moved > 0.002 ? 0 : (cab.stuckT || 0) + dt;
      if (cab.stuckT > STUCK_RELIEF) {
        cab.stuckT = 0; cab.pax = []; cab.returning = false; cab.dir = 1; cab.prog = 0; cab.pause = 4; cab.v = 0;
        const nr = this.pickTaxiRoute(cab.home, cab.standTile);
        if (nr) cab.route = nr;
        cab.x = cab.standTile.x * T + 8; cab.y = cab.standTile.y * T + 8;
        continue;
      }
      if (cab.prog >= cab.route.length - 1 && cab.dir > 0) {
        cab.prog = cab.route.length - 1;
        if (!cab.returning) {                            // dropped the fare across town
          cab.pause = 3;
          if (cab.pax.length)
            this.spawnAlighter(cab.x, cab.y, cab.dirx || 1, cab.diry || 0, cab.pax.shift());
          // V2 (Milestone 8): it drives its own way back to the rank (keeping right), not the fare's route backwards
          const end = cab.route[cab.route.length - 1];
          const back = World.roadPath(end[0], end[1], cab.standTile.x, cab.standTile.y);
          if (back && back.length > 1) { cab.route = back; cab.prog = 0; cab.returning = true; }
          else cab.dir = -1;
        } else {                                         // back at the rank: next fare
          cab.returning = false;
          cab.prog = 0; cab.pause = 4;
          this.serveStop(cab, cab.home);
          const nr = this.pickTaxiRoute(cab.home, cab.standTile);
          if (nr) cab.route = nr;
        }
      }
      if (cab.prog <= 0 && cab.dir < 0) {               // back at the rank (the old way round): next fare
        cab.prog = 0; cab.dir = 1; cab.pause = 4;
        this.serveStop(cab, cab.home);
        const nr = this.pickTaxiRoute(cab.home, cab.standTile);
        if (nr) cab.route = nr;
      }
      this.followPath(cab, cab.route, cab.prog, Traffic.lanePx(cab), cab.dir);
    }
  },

  /* V2 (Milestone 8): cabs waiting at a rank line up along the kerb one behind another (they all stood on
     the same spot, one inside the next) */
  rankSlot(cab: any) {
    if (cab.prog !== 0 || cab.dir < 0 || !cab.route) return;
    let slot = 0;
    for (const o of this.taxis) if (o !== cab && o.home === cab.home && !o.hired && o.prog === 0 && o.pause > 0 && o.dir > 0 && (o.pause < cab.pause || (o.pause === cab.pause && this.taxis.indexOf(o) < this.taxis.indexOf(cab)))) slot++;
    this.followPath(cab, cab.route, 0, Traffic.lanePx(cab), 1);
    if (slot) { cab.x -= (cab.hx || cab.dirx || 1) * slot * 0.8 * T; cab.y -= (cab.hy || cab.diry || 0) * slot * 0.8 * T; }
  },

  /* ---------------- queues, boarding & alighting at stops ---------------- */
  stopQueues: new Map(), alighters: [], queueT: 0,
  /* a vehicle at a stop: drop passengers off, then take the head of the queue */
  serveStop(vehicle: any, stop: Building) {
    const q = this.stopQueues.get(stop.id);
    const cx = stop.x + stop.w / 2, cy = stop.y + stop.h / 2;
    const doorPx = { x: stop.door.x * T + 8, y: stop.door.y * T + 6 };
    let ax = stop.door.x - cx, ay = stop.door.y - cy;              // step out toward the kerb
    if (!ax && !ay) ay = 1;
    // V2: off a bus or a cab, they step down from its kerbside door onto the pavement and walk away from the road
    // (they used to appear in the middle of the road, inside the bus, and walk out through its side)
    const road = this.buses.includes(vehicle) || this.taxis.includes(vehicle);
    const hx = vehicle.hx ?? vehicle.dirx ?? 1, hy = vehicle.hy ?? vehicle.diry ?? 0, hl = Math.hypot(hx, hy) || 1;
    const nx = -hy / hl, ny = hx / hl, out = (this.buses.includes(vehicle) ? 2.4 : 1.9) + 1.3;
    if (vehicle.pax && vehicle.pax.length && Math.random() < 0.85) {
      const n = 1 + (Math.random() < 0.35 ? 1 : 0);
      for (let i = 0; i < n && vehicle.pax.length; i++) {
        if (road) this.spawnAlighter(vehicle.x + nx * out + (hx / hl) * (2.5 - i * 1.6), vehicle.y + ny * out + (hy / hl) * (2.5 - i * 1.6), nx * 0.3 + (hx / hl) * (i ? -0.95 : 0.95), ny * 0.3 + (hy / hl) * (i ? -0.95 : 0.95), vehicle.pax.shift(), 2.8);
        else this.spawnAlighter(doorPx.x, doorPx.y, ax, ay, vehicle.pax.shift());
      }
    }
    if (q && q.waiting.length && vehicle.pax.length < vehicle.cap) {
      const room = vehicle.cap - vehicle.pax.length;
      const n = Math.min(room, q.waiting.length, 2);
      for (let i = 0; i < n; i++) vehicle.pax.push(q.waiting.shift());
      stop.visitors += n;                                          // the stop earns its keep
    }
  },
  /** V2: where the i-th person in the queue at a stop stands (px): along the pavement by the shelter, a step apart
   *  (render/actors.ts draws them there; the traffic indexes them so passers-by walk round them) */
  queueSpot(stop: Building, i: number): { x: number; y: number; yaw: number } {
    const x0 = stop.door.x * T + 8, y0 = stop.door.y * T + 8;
    const bx = (stop.x + stop.w / 2) * T, by = (stop.y + stop.h / 2) * T;
    // V2: on the pavement in front of the shelter, along its front, the shelter at their backs: the queue used to run
    // across the street when the stop stood at the end of one (or along the kerb into the junction beside it), out in
    // the lanes, where the traffic waited on it until a bus came, and the bus was stuck in that traffic. Seven to a row,
    // then a second row a step in, staggered
    const d = stop.door, u = d.y >= stop.y + stop.h ? [0, -1] : d.y < stop.y ? [0, 1] : d.x >= stop.x + stop.w ? [-1, 0] : [1, 0];
    const row = Math.floor(i / 7), k = (i % 7) * 1.6 - 4.8 + (row % 2) * 0.8, out = FOOT_PX + Math.min(1, row * 0.6);
    return { x: x0 + u[0] * out - u[1] * k, y: y0 + u[1] * out + u[0] * k, yaw: Math.atan2(x0 - bx, y0 - by) };
  },
  /* a passenger hops off and wanders a few steps onto the pavement, then fades */
  spawnAlighter(px: number, py: number, awayX: number, awayY: number, pax: any, speed = 12) {
    if (this.alighters.length > 50 || !pax) return;
    if (World.isRail((px / T) | 0, (py / T) | 0)) return;   // never set foot on the tracks
    const m = Math.hypot(awayX, awayY) || 1;
    this.alighters.push({
      seed: pax.seed, kind: pax.kind, x: px, y: py,
      vx: (awayX / m) * speed, vy: (awayY / m) * speed, hx: awayX / m, hy: awayY / m,
      life: 3.5 + Math.random() * 1.5, ph: Math.random() * 7,
    });
  },
  tickTransitQueues(dt: number) {
    const gm = dt * MIN_PER_SEC;
    if (this.alighters.length) {
      for (const a of this.alighters) {
        a.life -= dt; a.ph += dt * 7;
        // step forward, but stop dead at the kerb — passengers never stray onto the rails
        const nx = a.x + a.vx * dt, ny = a.y + a.vy * dt;
        if (World.isRail((nx / T) | 0, (ny / T) | 0)) { a.vx = 0; a.vy = 0; }
        else { a.x = nx; a.y = ny; }
      }
      this.alighters = this.alighters.filter((a: any) => a.life > 0);
    }
    this.queueT -= gm;
    if (this.queueT > 0) return;
    this.queueT = 8;   // re-poll the queues every ~8 game-minutes
    const stops = [...this.activeOf('busstop'), ...this.activeOf('taxistand')];
    const live = new Set();
    const commute = (Sim.clock > 420 && Sim.clock < 600) || (Sim.clock > 1000 && Sim.clock < 1150);
    const daytime = Sim.clock > 340 && Sim.clock < 1200;
    for (const stop of stops) {
      live.add(stop.id);
      let q = this.stopQueues.get(stop.id);
      if (!q) { q = { waiting: [] }; this.stopQueues.set(stop.id, q); }
      // busier stops (more homes nearby, rush hour) grow a longer line
      let homesNear = 0;
      for (const b of World.buildings)
        if (CAT[b.type].res && !b.ruined && Math.abs(b.x - stop.x) + Math.abs(b.y - stop.y) < 22) homesNear++;
      let target = Math.min(6, 1 + ((homesNear / 3) | 0));
      if (commute) target += 2;
      if (!daytime) target = Math.min(target, 1);
      const service = stop.type === 'busstop' ? this.buses.length : this.taxis.length;
      if (!service) target = Math.min(target, 2);   // no service yet — a small waiting hint
      target = Math.min(6, target);
      if (q.waiting.length < target && Math.random() < 0.7) {
        const seed = (stop.id * 97 + q.waiting.length * 41 + Sim.day * 7 + (Sim.clock | 0)) >>> 0;
        q.waiting.push({ seed, kind: ['man', 'woman', 'man', 'woman', 'kid'][seed % 5] });
      } else if (q.waiting.length > target && Math.random() < 0.3) {
        q.waiting.pop();   // gave up waiting / walked instead
      }
    }
    for (const id of [...this.stopQueues.keys()]) if (!live.has(id)) this.stopQueues.delete(id);
  },

  /* ---------------- trains on player-laid rails ---------------- */
  trains: [], trainSig: '', trainT: 0,
  /* every rail tile touching the station — a station can face several tracks,
     and only one of them may lead to the other station */
  stationRailDoors(st: any) {
    const doors = [];
    for (let j = -1; j <= st.h; j++) for (let i = -1; i <= st.w; i++) {
      if (i >= 0 && i < st.w && j >= 0 && j < st.h) continue;
      if (World.isRail(st.x + i, st.y + j)) doors.push({ x: st.x + i, y: st.y + j });
    }
    return doors;
  },
  stationRailDoor(st: any) { return this.stationRailDoors(st)[0] || null; },
  tickTrains(dt: number) {
    const gm = dt * MIN_PER_SEC;
    this.trainT -= gm;
    if (this.trainT <= 0) {
      this.trainT = 120;
      const stations = World.buildings.filter((b: Building) => b.type === 'trainstation' && !b.construction && !b.ruined);
      const industry = World.buildings.some((b: Building) =>
        ['factory', 'steelworks', 'warehouse', 'sawmill', 'brickworks', 'cannery', 'glassworks', 'powerplant'].includes(b.type) &&
        !b.construction && !b.ruined);
      const sig = stations.map((s: Building) => s.id).join(',') + '|' + World.railStamp + '|' + (industry ? 'f' : '');
      if (sig !== this.trainSig) {
        this.trainSig = sig;
        const hadTrain = this.trains.length > 0;
        this.trains = [];
        if (stations.length >= 2) {
          // label each connected piece of track; "connected stations" then
          // simply means "stations touching the same piece"
          const comp = new Int32Array(GW * GH).fill(-1);
          let nc = 0;
          for (let i = 0; i < World.railMap.length; i++) {
            if (!World.railMap[i] || comp[i] !== -1) continue;
            const q = [i]; comp[i] = nc;
            let qi = 0;
            while (qi < q.length) {
              const cur = q[qi++], cx = cur % GW, cy = (cur / GW) | 0;
              for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
                if (!World.isRail(cx + dx, cy + dy)) continue;
                const ni = World.idx(cx + dx, cy + dy);
                if (comp[ni] === -1) { comp[ni] = nc; q.push(ni); }
              }
            }
            nc++;
          }
          const perComp = new Map(); // component id -> [{s, d}] stations on it
          let railless = 0;
          for (const s of stations) {
            const doors = this.stationRailDoors(s);
            if (!doors.length) { railless++; continue; }
            const seen = new Set();
            for (const d of doors) {
              const c = comp[World.idx(d.x, d.y)];
              if (seen.has(c)) continue;
              seen.add(c);
              if (!perComp.has(c)) perComp.set(c, []);
              perComp.get(c).push({ s, d });
            }
          }
          let best = null;
          for (const list of perComp.values())
            if (!best || list.length > best.length) best = list;
          if (best && best.length >= 2) {
            // chain the stations along the track, nearest-first; every path
            // exists because they all sit on the same piece of track
            const left = best.slice();
            let cur = left.shift();
            let route = [[cur.d.x, cur.d.y]], served = 1;
            const stopIdx = [0];
            while (left.length) {
              let picked = -1, seg = null;
              for (let i = 0; i < left.length; i++) {
                const s2 = World.railPath(cur.d.x, cur.d.y, left[i].d.x, left[i].d.y);
                if (s2 && (!seg || s2.length < seg.length)) { seg = s2; picked = i; }
              }
              if (picked < 0) break;
              route = route.concat(seg.slice(1));
              stopIdx.push(route.length - 1);
              cur = left.splice(picked, 1)[0];
              served++;
            }
            if (served >= 2 && route.length >= 2) {
              // a fleet grows with the line: the local calls at every station,
              // an express dashes end-to-end, freight rumbles through for industry.
              // Each service runs on its OWN track of the three-track mainline
              // (lane = px offset onto its rails), so trains never overlap.
              const mk = (type: string, speed: number, cars: any, prog: number) => ({
                route, stopIdx: (type === 'local' || type === 'commuter') ? stopIdx : [0, route.length - 1],
                prog: prog || 0, dir: 1, pause: 8, type, speed, cars, lastStop: -1,
                lane: (type === 'express' || type === 'nightliner') ? -5 : type === 'freight' ? 5 : 0,
                x: route[0][0] * T + 8, y: route[0][1] * T + 8, dirx: 1, diry: 0,
              });
              // a real fleet, LONG consists — each track carries one service
              // at a time thanks to the timetable (see serviceWindow):
              //   centre track: local (midday/weekend) + commuter (rush hours)
              //   fast track:   express (day) + nightliner (the sleeper)
              //   goods track:  freight, round the clock
              this.trains.push(mk('local', 2.6, 5, 0)); // V2: train speeds ×0.62 for a 2 km map
              this.trains.push(mk('commuter', 2.9, 3, (route.length - 1) * 0.3));
              if (served >= 3 && route.length > 26) this.trains.push(mk('express', 4.0, 4, (route.length - 1) * 0.5));
              if (industry && route.length > 18) this.trains.push(mk('freight', 1.9, 7, (route.length - 1) * 0.82));
              if (!hadTrain || served > 2) {
                const names: Record<string, string> = { local: 'the all-stops local', commuter: 'a rush-hour commuter', express: 'an express', nightliner: 'the night sleeper', freight: 'a freight run' };
                this.say(`🚂 All aboard! The railway serves ${served} station${served > 1 ? 's' : ''} with ${this.trains.map((t2: any) => names[t2.type]).join(', ')}.`);
              }
              Tasks.done('railway1', true, 'The first railway line is open — trains are running');
            }
          } else if (railless) {
            this.say('🛤️ A train station has no track touching it — drag the railway right up to the station walls.');
          } else {
            this.say('🛤️ Each station has track, but the tracks aren\'t joined into one line yet.');
          }
        }
      }
    }
    for (const tr of this.trains) {
      if (tr.driver) continue; // V2 (Milestone 6): the Founder has the controls (src/jobs/rails.ts)
      // the timetable: outside its window a service is stabled at the
      // terminus (hidden), so two services never share a track at once
      const active = this.serviceWindow(tr.type);
      // (V2 (Milestone 8): a train out on the line when its service ends runs on to the terminus first,
      // rather than vanishing from the track; that's the last train)
      const atEnd = tr.prog <= 0 || tr.prog >= tr.route.length - 1;
      if (!active && (tr.hidden || atEnd)) { tr.hidden = true; tr.prog = 0; tr.dir = 1; tr.pause = 2; tr.lastStop = 0; continue; }
      if (active && tr.hidden) { tr.hidden = false; }
      if (!active) tr.last = true;
      else if (tr.last) tr.last = false;
      if (tr.pause > 0) { tr.pause -= gm; continue; }
      tr.prog += (tr.speed || 4.2) * dt * tr.dir;
      if (tr.prog >= tr.route.length - 1) { tr.prog = tr.route.length - 1; tr.dir = -1; tr.pause = 12; tr.lastStop = tr.route.length - 1; if (tr.type === 'freight') this.freightAt(tr.route[tr.route.length - 1]); if (tr.last) { tr.hidden = true; tr.prog = 0; tr.dir = 1; continue; } }
      else if (tr.prog <= 0) { tr.prog = 0; tr.dir = 1; tr.pause = 12; tr.lastStop = 0; if (tr.type === 'freight') this.freightAt(tr.route[0]); }
      else if (tr.stopIdx) {
        const at = Math.round(tr.prog);
        if (tr.stopIdx.includes(at) && at !== tr.lastStop && at !== 0 && at !== tr.route.length - 1) {
          tr.lastStop = at; tr.pause = 6; // calling at an intermediate station
        }
      }
      this.followRail(tr, tr.route, tr.prog, tr.dir);
    }
  },

  /* V2: the freight train unloads at the terminus station nearest the end of its run */
  freightAt([x, y]: number[]) {
    let best = null, bd = 1e9;
    for (const s of World.buildings) {
      if (s.type !== 'trainstation' || s.construction || s.ruined) continue;
      const d = Math.abs(s.x + s.w / 2 - x) + Math.abs(s.y + s.h / 2 - y);
      if (d < bd) { bd = d; best = s; }
    }
    if (best && bd < 12) Supply.freightCall(best);
  },

  /* ---------------- boats & the ferry ---------------- */
  boats: [], ferry: null, ferrySig: '',
  tickBoats(dt: number) {
    if (Weather.season === 3) { this.boats = []; this.ferry = null; return; } // frozen water
    if (Calamity.droughtLevel > 0.5) { this.boats = []; this.ferry = null; return; } // no water!
    const docks = this.activeOf('dock').concat(this.activeOf('boatclub'), this.activeOf('fishmarket'));
    // rowboats pottering about near the waterfront — villager-owned fishing
    // boats join the fleet
    const owned = World.buildings.filter((b: Building) => b.boat && !b.ruined).length;
    const cap = Math.min(9, docks.length * 2 + owned);
    if (docks.length && this.waterTiles.length > 6 && this.boats.length < cap && Math.random() < dt * 0.04) {
      const d = docks[(Math.random() * docks.length) | 0];
      let best = null, bd = 1e9;
      for (const [tx, ty] of this.waterTiles) {
        if (!this.openWater(tx, ty)) continue; // (V2: not under a bridge)
        const dd = Math.abs(tx - d.x) + Math.abs(ty - d.y);
        if (dd < bd) { bd = dd; best = [tx, ty]; }
      }
      if (best && bd < 8)
        this.boats.push({ x: best[0] * T + 8, y: best[1] * T + 8, tx: best[0] * T + 8, ty: best[1] * T + 8, flip: 1, ph: Math.random() * 7 });
    }
    for (const b of this.boats) {
      b.ph += dt;
      const dx = b.tx - b.x, dy = b.ty - b.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 2) {
        // (V2: somewhere it can row to in a straight line over open water: a river's bends used to have boats rowing
        // across the meadow from one reach to the next, and under the bridges' decks)
        for (let tries = 0; tries < 12; tries++) {
          const [tx, ty] = this.waterTiles[(Math.random() * this.waterTiles.length) | 0];
          const nx = tx * T + 6 + Math.random() * 4, ny = ty * T + 6 + Math.random() * 4;
          if (Math.abs(nx - b.x) + Math.abs(ny - b.y) < 90 && this.waterClear(b.x, b.y, nx, ny)) {
            b.tx = nx; b.ty = ny;
            break;
          }
        }
      } else {
        b.x += dx / dist * 7 * dt; b.y += dy / dist * 7 * dt;
        b.dirx = dx / dist; b.diry = dy / dist;
        if (Math.abs(dx) > 0.5) b.flip = Math.sign(dx);
      }
    }
    // a ferry shuttles between two docks joined by open water (V2: under no bridge: a road or railway over the water
    // stands too low for it; the bridges count towards the route's signature too)
    if (docks.length >= 2) {
      const sig = docks.map((d: any) => d.id).join(',') + '|' + World.waterStamp + '|' + World.roadStamp + '|' + World.railStamp;
      if (sig !== this.ferrySig) {
        this.ferrySig = sig;
        const had = this.ferry;
        this.ferry = null;
        const waterNear = (d: any) => {
          for (let j = -1; j <= d.h; j++) for (let i = -1; i <= d.w; i++) {
            if (i >= 0 && i < d.w && j >= 0 && j < d.h) continue;
            if (World.inB(d.x + i, d.y + j) && this.openWater(d.x + i, d.y + j))
              return { x: d.x + i, y: d.y + j };
          }
          return null;
        };
        const a = waterNear(docks[0]), b = waterNear(docks[1]);
        if (a && b) {
          const path = World.waterPath(a.x, a.y, b.x, b.y);
          if (path && path.length > 8) {
            // (V2: steering a smooth course over the water, not tile by tile round every corner of the grid)
            const route = this.waterCourse(path);
            // (the same crossing as before, a road built somewhere else: it sails on where it was)
            const same = had && had.route.length === route.length && had.route.every((p: number[], k: number) => p[0] === route[k][0] && p[1] === route[k][1]);
            this.ferry = same ? had : { route, prog: 0, dir: 1, pause: 10, x: (route[0][0] + 0.5) * T, y: (route[0][1] + 0.5) * T, dirx: 1, diry: 0 };
            if (!had) this.say('⛴️ A ferry now sails between the docks!');
          } else if (!path && World.waterPath(a.x, a.y, b.x, b.y, true)) this.say('⛴️ No ferry between the docks: a bridge across the water stands too low for it to pass');
        }
      }
      if (this.ferry) {
        const gm = dt * MIN_PER_SEC;
        // (V2 (Milestone 8): the last crossing is at 22:00; it lies at the dock overnight, sailing again at 06:00)
        const sailing = Sim.clock >= 360 && Sim.clock < 1320;
        if (this.ferry.pause > 0) this.ferry.pause -= gm;
        else if (!sailing && (this.ferry.prog <= 0 || this.ferry.prog >= this.ferry.route.length - 1)) this.ferry.pause = 5;
        else {
          this.ferry.prog += 1.0 * dt * this.ferry.dir; // V2: ferry pace
          if (this.ferry.prog >= this.ferry.route.length - 1) { this.ferry.prog = this.ferry.route.length - 1; this.ferry.dir = -1; this.ferry.pause = 14; this.ferry.at = docks[1]; Gateways.docked(docks[1]); }
          if (this.ferry.prog <= 0) { this.ferry.prog = 0; this.ferry.dir = 1; this.ferry.pause = 14; this.ferry.at = docks[0]; Gateways.docked(docks[0]); }
          this.followWater(this.ferry, this.ferry.route, this.ferry.prog, this.ferry.dir);
        }
      }
    } else this.ferry = null;
  },
  /** V2: open water a boat can be on: water with no bridge over it (a road's deck or a railway's trestle) */
  openWater(tx: number, ty: number): boolean {
    if (!World.inB(tx, ty)) return false;
    const i = World.idx(tx, ty);
    return World.ground[i] === G_WATER && !World.roadMap[i] && !World.railMap[i];
  },
  /** V2: can a boat go straight from (ax, ay) to (bx, by) (px), a couple of metres clear of the banks all the way? */
  waterClear(ax: number, ay: number, bx: number, by: number, margin = 5): boolean {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 4));
    for (let k = 0; k <= n; k++) {
      const x = ax + ((bx - ax) * k) / n, y = ay + ((by - ay) * k) / n;
      for (const [ox, oy] of [[-margin, -margin], [margin, -margin], [-margin, margin], [margin, margin]])
        if (!this.openWater(Math.floor((x + ox) / T), Math.floor((y + oy) / T))) return false;
    }
    return true;
  },
  /** V2: a tile path over the water as a boat would steer it: the corners cut wherever there's open water to cut them,
   *  rounded off, then marked out a tile apart (tile units, fractional) so a boat's pace along it stays the same */
  waterCourse(path: number[][]): number[][] {
    const px = (p: number[]): number[] => [(p[0] + 0.5) * T, (p[1] + 0.5) * T];
    // the farthest point still in a straight line (up to 40 tiles on), again and again
    const way: number[][] = [px(path[0])];
    let i = 0;
    while (i < path.length - 1) {
      let j = Math.min(path.length - 1, i + 40);
      const w = way[way.length - 1];
      while (j > i + 1 && !this.waterClear(w[0], w[1], px(path[j])[0], px(path[j])[1], 4)) j--;
      way.push(px(path[j]));
      i = j;
    }
    // rounded at the turns: each corner cut (up to 2½ tiles back along either leg) where the cut stays on open water
    let pts = way;
    for (let r = 0; r < 2; r++) {
      const out: number[][] = [pts[0]];
      for (let k = 1; k < pts.length - 1; k++) {
        const p = pts[k - 1], c = pts[k], q = pts[k + 1];
        const l0 = Math.hypot(c[0] - p[0], c[1] - p[1]) || 1, l1 = Math.hypot(q[0] - c[0], q[1] - c[1]) || 1;
        const c0 = Math.min(0.25 * l0, 40) / l0, c1 = Math.min(0.25 * l1, 40) / l1;
        const a = [c[0] + (p[0] - c[0]) * c0, c[1] + (p[1] - c[1]) * c0], b = [c[0] + (q[0] - c[0]) * c1, c[1] + (q[1] - c[1]) * c1];
        if (this.waterClear(a[0], a[1], b[0], b[1], 3)) out.push(a, b);
        else out.push(a, c, b);
      }
      out.push(pts[pts.length - 1]);
      pts = out;
    }
    // a point every tile along it
    const res: number[][] = [[pts[0][0] / T - 0.5, pts[0][1] / T - 0.5]];
    let carry = 0;
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k], b = pts[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      let d = T - carry;
      while (d <= L) {
        res.push([(a[0] + ((b[0] - a[0]) * d) / L) / T - 0.5, (a[1] + ((b[1] - a[1]) * d) / L) / T - 0.5]);
        d += T;
      }
      carry = L - (d - T);
    }
    const last = path[path.length - 1];
    if (carry > 1) res.push([last[0], last[1]]);
    else res[res.length - 1] = [last[0], last[1]];
    return res;
  },
  /** V2: a boat `prog` points along a water course (waterCourse's), heading eased round each point */
  followWater(o: any, route: number[][], prog: number, dir = 1) {
    const n = route.length;
    if (n < 2) return;
    const s = Math.max(0, Math.min(n - 1, prog)), i = Math.min(n - 2, Math.floor(s)), f = s - i;
    const a = route[i], b = route[i + 1];
    o.x = (a[0] + (b[0] - a[0]) * f + 0.5) * T;
    o.y = (a[1] + (b[1] - a[1]) * f + 0.5) * T;
    const leg = (p: number[], q: number[]): number[] => { const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1; return [(q[0] - p[0]) / l, (q[1] - p[1]) / l]; };
    const d0 = leg(a, b), d1 = f < 0.5 ? (i > 0 ? leg(route[i - 1], a) : d0) : route[i + 2] ? leg(b, route[i + 2]) : d0;
    const w = f < 0.5 ? 0.5 - f : f - 0.5;
    let hx = d0[0] * (1 - w) + d1[0] * w, hy = d0[1] * (1 - w) + d1[1] * w;
    const hl = Math.hypot(hx, hy) || 1;
    hx = (hx / hl) * dir; hy = (hy / hl) * dir;
    o.hx = o.dirx = hx; o.hy = o.diry = hy;
  },

  /* ---------------- helicopters between helipads ---------------- */
  helis: [], heliCd: 300,
  heliPads() {
    return World.buildings.filter((b: Building) => ['heliport', 'hospital', 'skyscraper'].includes(b.type) &&
      !b.construction && !b.ruined);
  },
  tickHelis(dtSim: number, dtReal: number) {
    const gm = dtSim * MIN_PER_SEC;
    if (this.heliCd > 0) this.heliCd -= gm;
    const pads = this.heliPads();
    const hasPort = pads.some((p: Person) => p.type === 'heliport');
    if (hasPort && !this.helis.length && this.heliCd <= 0 && Sim.clock > 420 && Sim.clock < 1200) {
      const from = pads[(Math.random() * pads.length) | 0];
      const others = pads.filter((p: Person) => p !== from);
      const to = others.length && Math.random() < 0.7 ? others[(Math.random() * others.length) | 0] : null;
      this.helis.push({
        x: -30, y: Math.random() * GH * T * 0.6 + 40,
        tx: from.x * T + from.w * 8, ty: from.y * T + from.h * 8,
        next: to, alt: 44, phase: 'in', wait: 0, rot: 0,
      });
      this.heliCd = 500 + Math.random() * 500;
    }
    for (const h of this.helis) {
      h.rot += dtReal * 20;
      const dx = h.tx - h.x, dy = h.ty - h.y;
      const dist = Math.hypot(dx, dy);
      if (h.phase === 'in' || h.phase === 'hop') {
        if (dist > 3) {
          const sp = 46 * dtSim;
          h.x += dx / dist * Math.min(sp, dist); h.y += dy / dist * Math.min(sp, dist);
          if (dist < 60) h.alt = Math.max(12, h.alt - 22 * dtSim);
        } else h.phase = 'land';
      } else if (h.phase === 'land') {
        h.alt -= 14 * dtSim;
        if (h.alt <= 0) { h.alt = 0; h.phase = 'wait'; h.wait = 14 + Math.random() * 12; }
      } else if (h.phase === 'wait') {
        h.wait -= gm;
        if (h.wait <= 0) h.phase = 'takeoff';
      } else if (h.phase === 'takeoff') {
        h.alt += 16 * dtSim;
        if (h.alt >= 44) {
          h.alt = 44;
          if (h.next) {
            h.tx = h.next.x * T + h.next.w * 8; h.ty = h.next.y * T + h.next.h * 8;
            h.next = null; h.phase = 'hop';
          } else { h.tx = GW * T + 60; h.ty = h.y - 30; h.phase = 'out'; }
        }
      } else { // out
        const sp = 52 * dtSim;
        h.x += dx / dist * sp; h.y += dy / dist * sp;
        if (h.x > GW * T + 40) h.done = true;
      }
    }
    this.helis = this.helis.filter((h: any) => !h.done);
  },

  /* ---------------- campaign cars & voting day ---------------- */
  campaignCars: [], votingBooths: null,
  tickCampaignLife(dt: number) {
    const campaigning = Gov.campaign && !Gov.campaign.votingDay;
    const hours = Sim.clock >= 540 && Sim.clock < 1200;
    // (V2: off the streets when the campaign is over, but each only once it's out of the player's sight: they all
    // used to vanish at once, wherever they were)
    if (!campaigning) {
      this.campaignCars = this.campaignCars.filter((c: any) => Approach.seen(c.x, c.y));
      if (!this.campaignCars.length) return;
    }
    const roads: number[][] = [];
    const anyRoad = (): number[] => {
      if (!roads.length) for (let i = 0; i < World.roadMap.length; i++) if (World.roadMap[i]) roads.push([i % GW, (i / GW) | 0]);
      return roads[(Math.random() * roads.length) | 0];
    };
    // a couple of cars with candidate banners cruise the streets with a megaphone (V2: in the daytime, not at 3 a.m.)
    if (campaigning && this.campaignCars.length < 2 && hours && Math.random() < dt * 0.05) {
      // (V2: setting out from somewhere out of the player's sight: it used to appear on any street, in plain view)
      let a = anyRoad();
      for (let k = 0; k < 12 && a && Approach.seen(a[0] * T + 8, a[1] * T + 8); k++) a = anyRoad();
      if (roads.length > 10 && !Approach.seen(a[0] * T + 8, a[1] * T + 8)) {
        const b = anyRoad();
        const path = World.roadPath(a[0], a[1], b[0], b[1]);
        if (path && path.length > 10) {
          const ci = (Math.random() * Gov.campaign.candidates.length) | 0;
          this.campaignCars.push({ path, prog: 0, ci, x: a[0] * T + 8, y: a[1] * T + 8, dirx: 1, diry: 0, seed: ci * 3 });
        }
      }
    }
    for (const c of this.campaignCars) {
      c.prog += Traffic.advance(c, c, c.path, c.prog, 1, 1.2, dt); // V2: campaign cars crawl with the megaphone, in the traffic
      this.followPath(c, c.path, c.prog, Traffic.lanePx(c));
      if (c.prog >= c.path.length - 1) {
        // (V2: done for the day only out of sight; otherwise on round another street)
        const end = c.path[c.path.length - 1];
        if ((!campaigning || !hours) && !Approach.seen(c.x, c.y)) { c.done = true; continue; }
        const b = anyRoad(), next = b && World.roadPath(end[0], end[1], b[0], b[1]);
        if (next && next.length > 2) { c.path = next; c.prog = 0; }
        else if (!Approach.seen(c.x, c.y)) c.done = true;
      }
    }
    this.campaignCars = this.campaignCars.filter((c: any) => !c.done);
  },
  /* ---------------- grave crimes, trials & the ultimate penalty ---------------- */
  trials: [], graveCases: 0, graveCd: 2400, graveCrime: null,
  tickJustice(dt: number) {
    const gm = dt * MIN_PER_SEC;
    if (this.graveCd > 0) this.graveCd -= gm;

    // scheduled trials reach their verdict
    for (const trial of this.trials) {
      if (Sim.day < trial.day) continue;
      trial.done = true;
      const p = Sim.people.find((q: Person) => q.id === trial.pid);
      // conviction follows the evidence: a police force that worked the case
      // makes the charge stick far more often
      const policeWorked = World.buildings.some((q: Building) => q.type === 'police' && q.connected && !q.construction && !q.ruined);
      const guilty = Math.random() < (policeWorked ? 0.85 : 0.55);
      if (!guilty) {
        this.say(`⚖️ The court found ${trial.name} NOT GUILTY of ${trial.charge} — released for lack of proof.`);
        if (p) { p.heldUntil = 0; p.mood = Math.min(98, (p.mood || 60) + 5); }
        Tasks.done('trial' + trial.pid, true, `Trial of ${trial.name}: acquitted`);
      } else if (trial.capital) {
        this.say(`⚖️ VERDICT: ${trial.name} was found guilty of ${trial.charge}. The sentence is death — carried out at dawn. The village is silent.`);
        if (p) Sim.removePerson(p, true);
        Sim.safety = Math.min(100, Sim.safety + 6);
        Tasks.done('trial' + trial.pid, true, `Trial of ${trial.name}: guilty — capital sentence carried out`);
      } else {
        this.say(`⚖️ VERDICT: ${trial.name} was found guilty of ${trial.charge} and sent to prison.`);
        if (p) { p.heldUntil = Sim.day + 14; p.mood = 15; }
        Sim.safety = Math.min(100, Sim.safety + 3);
        Tasks.done('trial' + trial.pid, true, `Trial of ${trial.name}: guilty — imprisoned`);
      }
    }
    this.trials = this.trials.filter((t: any) => !t.done);

    // very rare, very serious crime — the darkest day a village can have
    if (this.graveCd > 0 || Sim.people.length < 14) return;
    const badMood = Sim.people.filter((p: Person) => p.kind !== 'kid' && (p.mood === undefined ? 60 : p.mood) < 38 && p.heldUntil <= Sim.day);
    const risk = gm * 0.000012 * Math.min(2, Math.max(1, Sim.people.length / 40)) *
      (Sim.safety < 60 ? 1.8 : 1) * (badMood.length >= 3 ? 1.6 : 0.5);
    if (Math.random() >= risk) return;
    this.graveCd = 5000 + Math.random() * 4000;
    this.graveCases++;
    const adults = Sim.people.filter((p: Person) => p.kind !== 'kid');
    const perp = badMood.length ? badMood[(Math.random() * badMood.length) | 0] : adults[(Math.random() * adults.length) | 0];
    const victims = adults.filter((p: Person) => p !== perp && p.home !== perp.home);
    if (!victims.length || !perp) return;
    const victim = victims[(Math.random() * victims.length) | 0];
    const murder = Math.random() < 0.55;
    const charge = murder ? 'murder' : 'a violent assault';
    Sim.safety = Math.max(10, Sim.safety - (murder ? 14 : 8));
    if (murder) {
      this.say(`🕯️ DARK DAY: ${Sim.fullName(victim)} was found murdered. The village is in shock and demands justice.`, { x: victim.home.x * T + 8, y: victim.home.y * T + 8 });
      for (const r of victim.home.residents) if (r !== victim) r.mood = Math.max(5, (r.mood || 60) - 30);
      Sim.removePerson(victim);
    } else {
      this.say(`🚨 ${Sim.fullName(victim)} was violently attacked — the village demands the culprit is found.`);
      victim.mood = Math.max(5, (victim.mood || 60) - 25);
    }
    Tasks.add('trial' + perp.id, '⚖️', `Bring the ${charge} case to justice`);
    const police = World.buildings.some((b: Building) => b.type === 'police' && b.connected && !b.construction && !b.ruined);
    this.dispatchTo(perp.home.door.x, perp.home.door.y);
    const caught = Math.random() < (police ? 0.82 : 0.3);
    if (!caught) {
      this.say(`🌫️ The culprit slipped away in the night — ${police ? 'the manhunt continues' : 'without police, there was no one to give chase'}.`);
      Sim.safety = Math.max(10, Sim.safety - 5);
      if (Math.random() < 0.5) Sim.removePerson(perp, true); // fled the village for good
      Tasks.done('trial' + perp.id, false, `The ${charge} case went cold — culprit at large`);
      return;
    }
    perp.heldUntil = Sim.day + 30;
    this.arrests++;
    const court = World.buildings.some((b: Building) => b.type === 'courthouse' && b.connected && !b.construction && !b.ruined);
    if (court) {
      this.trials.push({ pid: perp.id, name: Sim.fullName(perp), charge, capital: murder, day: Sim.day + 2 });
      this.say(`🚔 ${Sim.fullName(perp)} was arrested for ${charge}. Trial at the courthouse in 2 days${murder ? ' — the gravest charge carries the ultimate penalty' : ''}.`);
    } else {
      this.say(`🚔 ${Sim.fullName(perp)} was arrested for ${charge} — held in the cells. Without a courthouse there can be no proper trial!`);
      Tasks.done('trial' + perp.id, true, `${Sim.fullName(perp)} held for ${charge} (no courthouse for a trial)`);
    }
  },

  /* ---------------- air traffic ---------------- */
  planes: [], planeT: 0,
  /* V2 (Milestone 6): the airfield (metres): the runway along the south edge, a taxiway beside it,
     and four stands in front of the terminal, 45 m apart (an airliner spans 30 m) */
  airfield(a: any) {
    const x0 = a.x * 8, z0 = a.y * 8, W = a.w * 8, D = a.h * 8;
    return {
      ry: z0 + D - 12, rx0: x0 + 6, rx1: x0 + W - 6, ty: z0 + D - 32,
      stands: [0, 1, 2, 3].map(k => ({ x: x0 + 92 + k * 45, z: z0 + 50 })),
    };
  },
  /* the Founder's airliner is using the runway (no village plane may until it's clear) */
  runwayHeld: false,
  tickPlanes(dtSim: number, dtReal: number) {
    const airport = World.buildings.find((b: Building) => b.type === 'airport' && !b.construction && !b.ruined);
    if (!airport) { this.planes = []; return; }
    this.planeT -= dtSim * MIN_PER_SEC;
    // one plane on the runway at a time: the next waits until the last is well up (or down and stopped)
    if (this.planeT <= 0 && !this.runwayHeld && !this.planes.some((p: Person) => p.alt < 60)) {
      this.planeT = 100 + Math.random() * 140;
      const f = this.airfield(airport);
      const ry = f.ry * 2; // (V1 px)
      const rx0 = f.rx0 * 2, rx1 = f.rx1 * 2;
      if (Math.random() < 0.5) this.planes.push({ mode: 'takeoff', x: rx0, y: ry, alt: 0, v: 14, rx1 });
      else this.planes.push({ mode: 'land', x: -40, y: ry, alt: 70, v: 85, rx0, rx1, stop: rx1 - 30 });
    }
    for (const pl of this.planes) {
      if (pl.mode === 'takeoff') {
        pl.v = Math.min(110, pl.v + 40 * dtReal);
        pl.x += pl.v * dtReal;
        if (pl.x > pl.rx1 - 30) pl.alt += 34 * dtReal;
        if (pl.x > GW * T + 60 || pl.alt > 110) pl.done = true;
      } else {
        pl.x += pl.v * dtReal;
        if (pl.x < pl.rx0 + 20) pl.alt = Math.max(0, pl.alt - 20 * dtReal * (pl.v / 60));
        else if (pl.alt > 0) pl.alt = Math.max(0, pl.alt - 30 * dtReal);
        if (pl.alt <= 0) pl.v = Math.max(0, pl.v - 55 * dtReal);
        if (pl.v <= 1 || pl.x > pl.stop + 60) {
          pl.done = true; airport.visitors += 3 + (Math.random() * 4 | 0);
          if (!pl.founder) Gateways.landed(airport); // V2: visitors come off the plane and see the town
        }
      }
    }
    this.planes = this.planes.filter((p: Person) => !p.done);
  },

  /* ---------------- road works & renovations ---------------- */
  roadworks: [], workT: 200,
  tickWorks(dt: number) {
    const gm = dt * MIN_PER_SEC;
    this.workT -= gm;
    if (this.workT <= 0) {
      this.workT = 260 + Math.random() * 300;
      if (this.roadworks.length < 2) {
        const straights = [];
        for (let i = 0; i < World.roadMap.length; i++) {
          if (!World.roadMap[i]) continue;
          const x = i % GW, y = (i / GW) | 0;
          const m = World.roadMask(x, y);
          // (V2: and not just past a junction: drivers wait at a junction for room on its far side, and a coned-off
          // lane there would hold them at the line for ever)
          const ax = m === 10 ? 1 : 0, ay = m === 5 ? 1 : 0;
          const nearBox = [-2, -1, 1, 2].some((k) => isBox(x + ax * k, y + ay * k));
          if ((m === 5 || m === 10) && World.ground[i] !== G_WATER && !nearBox) straights.push([x, y]);
        }
        if (straights.length > 6) {
          const [x, y] = straights[(Math.random() * straights.length) | 0];
          this.roadworks.push({ x, y, t: 150 });
          this.say('🚧 Road maintenance crew at work');
        }
      }
      // building renovation
      const cands = World.buildings.filter((b: Building) => !b.construction && !b.ruined && !b.fire && !b.upgrading && !b.renovating && (CAT[b.type].ex ?? 0) > 6);
      if (cands.length > 3 && Math.random() < 0.5) {
        const b = cands[(Math.random() * cands.length) | 0];
        b.renovating = 170;
      }
    }
    for (const rw of this.roadworks) rw.t -= gm;
    this.roadworks = this.roadworks.filter((rw: any) => rw.t > 0);
    for (const b of World.buildings) if (b.renovating > 0) {
      b.renovating -= gm;
      if (b.renovating <= 0) { b.renovating = 0; b.quakeDamage = false; } // repairs done, cracks patched
    }
  },

  /* ---------------- collapse, solidarity & rebuilding ----------------
     When a building falls (collapse or fire), neighbors run to the site,
     emergency services roll out, the rubble is cleared together and the
     community rebuilds the same building. */
  disaster: null, firesRecent: 0, collapseCd: 1440,
  startDisaster(b: Building, cause: string) {
    if (this.disaster) return; // one crisis at a time
    const cx = b.x * T + b.w * 8, cy = b.y * T + b.h * 8;
    // neighbours AND nearby shopkeepers/workers run over — a ruin in a
    // commercial district must draw a visible crowd too
    const helpers = [];
    for (const spot of this.crowdSpots(cx, cy, 40)) {
      if (helpers.length >= 7) break;
      const at = Stroll.offRoad(cx + Math.cos(helpers.length * 1.3) * (b.w * 8 + 10), cy + Math.sin(helpers.length * 1.3) * (b.h * 8 + 8));
      helpers.push({
        sx: spot.x, sy: spot.y,
        tx: at.x, ty: at.y,
        f: 0, seed: (spot.id * 977 + helpers.length) >>> 0,
        kind: ['man', 'woman'][helpers.length % 2],
      });
    }
    this.disaster = { b, cause, phase: 'respond', t: 70, helpers };
    this.disaster.unit = this.dispatchTo(b.door.x, b.door.y, this.disaster, 18); // police secure the area
    this.coverStory(cx, cy, this.disaster, `${CAT[b.type].name} down — neighbours rush to help`);
    if (cause === 'collapse') { // fire brigade checks for survivors
      const st = World.buildings.find((s: Building) => s.type === 'fire' && s.connected && !s.construction);
      if (st) {
        const path = World.roadPath(st.door.x, st.door.y, b.door.x, b.door.y);
        if (path) this.fireTrucks.push({ path: kerbside(path), prog: 0, x: st.door.x * T + 8, y: st.door.y * T + 8, dirx: 1, diry: 0, phase: 'go', target: b, douse: 8 });
      }
    }
  },
  tickDisaster(dt: number) {
    const gm = dt * MIN_PER_SEC;
    if (this.collapseCd > 0) this.collapseCd -= gm;
    // rare structural collapse
    if (!this.disaster && this.collapseCd <= 0) {
      const cands = World.buildings.filter((b: Building) => !b.ruined && !b.construction && !b.fire &&
        b.type !== 'airport' && (CAT[b.type].ex ?? 0) > 4 && Math.random() < 0.002);
      if (cands.length && Math.random() < gm * 0.0006) {
        const b = cands[(Math.random() * cands.length) | 0];
        Health.casualties(b, 0.5, [30, 75], `when the ${CAT[b.type].name.toLowerCase()} collapsed`); // V2
        b.ruined = true; b.ruinedAt = Sim.day;
        Sim.onBuildingRemoved(b);
        World.dirty = true;
        Sim.safety = Math.max(20, Sim.safety - 3);
        this.say(`💥 The ${CAT[b.type].name} suddenly collapsed! Neighbors are rushing to help`, { x: b.x * T + b.w * 8, y: b.y * T + b.h * 8 });
        Snd.crunch(midPx(b));
        this.startDisaster(b, 'collapse');
        this.collapseCd = 4000;
      }
    }
    const D = this.disaster;
    if (!D) {
      // old ruins the player ignores get rebuilt by the community after a day
      const ruin = World.buildings.find((b: Building) => b.ruined && b.ruinedAt !== undefined && Sim.day - b.ruinedAt >= 2);
      if (ruin) this.startDisaster(ruin, 'rebuild');
      return;
    }
    for (const h of D.helpers) this.stroll(h, 6, dt); // hurry to the site (V2: by the streets, at a run)
    D.t -= gm;
    if (D.phase === 'respond' && D.t <= 30) {
      D.phase = 'clear';
      this.say('🤝 The whole street is out clearing the rubble together');
    }
    if (D.t <= 0) {
      const b = D.b;
      const type = b.type, x = b.x, y = b.y, f = b.facing || 0;
      World.removeBuilding(b);
      const nb = World.placeBuilding(type, x, y, false, f);
      if (nb) {
        nb.construction = Math.max(nb.construction, 60);
        this.say(`🧱 Community rebuild started — the ${CAT[type].name} will rise again!`);
      }
      World.refreshConnections();
      D.over = true;
      this.disaster = null;
    }
  },

  /* ---------------- riots: the people vs. city hall ---------------- */
  riot: null,
  tickRiot(dt: number) {
    const gm = dt * MIN_PER_SEC;
    if (this.riot) {
      this.riot.t -= gm;
      if (this.riot.t <= 0) {
        this.say('🕊️ The protest disperses… for now.');
        if (Gov.leader && (Gov.leader.type.kind === 'corrupt' || Gov.approval < 15))
          Gov.forceResign('under public pressure');
        this.riot = null;
      }
      return;
    }
    if (!Gov.leader || Gov.riotCd > 0) return;
    // the grievance survey is O(people × buildings) — take it every ~25
    // game-minutes, not every frame, and roll the odds for the whole gap
    this.riotEvalT = (this.riotEvalT || 0) - gm;
    if (this.riotEvalT > 0) return;
    const evalGap = 25;
    this.riotEvalT = evalGap;
    const s = Sim.stats();
    const grievance = Gov.grievanceReport();
    // Protests grow from specific, visible failures (unsafe streets, missing
    // emergency cover, unemployment or corruption), rather than appearing
    // just because a random approval number happened to be low.
    const riotChance = evalGap * 0.00045 * (grievance.severity / 100);
    if (Gov.approval < 45 && grievance.severity >= 42 && s.pop >= 10 && Math.random() < riotChance) {
      const hall = World.buildings.find((b: Building) => b.type === 'townhall' && !b.ruined) ||
                   World.buildings.find((b: Building) => !b.ruined && b.connected);
      if (!hall) return;
      // protests are made of the actually-unhappy, not extras from casting
      const angry = Sim.people.filter((p: Person) => p.kind !== 'kid' && (p.mood === undefined ? 60 : p.mood) < 46);
      if (angry.length < 4) return; // not enough genuinely upset villagers to riot
      const cx = hall.door.x * T + 8, cy = hall.door.y * T + 20;
      const crowd = [];
      const n = Math.min(9, angry.length);
      for (let i = 0; i < n; i++)
        crowd.push({ x: cx + (i % 4) * 9 - 14, y: cy + ((i / 4) | 0) * 9, seed: angry[i].seed, kind: angry[i].kind });
      this.riot = { x: cx, y: cy, t: 40, crowd, reason: grievance.reason };
      Gov.approval = Math.max(5, Gov.approval - 6);
      Sim.safety = Math.max(20, Sim.safety - 3);
      Gov.riotCd = 6;
      this.say(`📢 Villagers are rioting outside ${hall.type === 'townhall' ? 'town hall' : 'in the street'} over ${grievance.reason} — they demand better from Mayor ${Gov.leader.name}!`, { x: cx, y: cy });
      this.dispatchTo(hall.door.x, hall.door.y, this.riot, 25);
      this.coverStory(cx, cy, this.riot, `Protest over ${grievance.reason} outside town hall`);
    }
  },

  /* ---------------- onlookers: crowds gather at incidents ----------------
     Anywhere something dramatic happens, people from nearby occupied
     buildings walk over, stand in a loose ring and watch until it's over. */
  gawkers: [],
  /* doors of nearby occupied buildings (homes or staffed workplaces),
     closest first — the pool that crowds and helpers are drawn from */
  crowdSpots(cx: number, cy: number, maxTiles: number) {
    const spots = [];
    for (const h of World.buildings) {
      if (h.ruined || h.construction) continue;
      const occupied = (h.residents && h.residents.length) || (h.workers && h.workers.length);
      if (!occupied) continue;
      const d = Math.abs(h.door.x * T + 8 - cx) + Math.abs(h.door.y * T + 8 - cy);
      if (d > maxTiles * T) continue;
      // (V2: on the pavement at the door, the building at their back: it was the middle of the road, where they set out
      // from and came back to, with the traffic waiting on them)
      const u = h.door.y >= h.y + h.h ? [0, -1] : h.door.y < h.y ? [0, 1] : h.door.x >= h.x + h.w ? [-1, 0] : [1, 0];
      spots.push({ x: h.door.x * T + 8 + u[0] * FOOT_PX, y: h.door.y * T + 8 + u[1] * FOOT_PX, d, id: h.id });
    }
    spots.sort((a, b) => a.d - b.d);
    return spots;
  },
  spawnGawkers(cx: number, cy: number, n: number, ref: any) {
    const spots = this.crowdSpots(cx, cy, 40);
    for (let i = 0; i < n && i < spots.length; i++) {
      const a = i * 2.4 + (cx + cy) * 0.01;
      // (V2: watching from the pavement or the verge, never standing in the road the traffic still uses)
      const at = Stroll.offRoad(cx + Math.cos(a) * (11 + (i % 2) * 4), cy + Math.sin(a) * 8 + 3);
      this.gawkers.push({
        sx: spots[i].x, sy: spots[i].y,
        tx: at.x, ty: at.y,
        f: 0, phase: 'come', stay: 14 + i * 4, age: 0, ref: ref || null, gawk: true,
        seed: (spots[i].id * 389 + i * 31) >>> 0, kind: i % 2 ? 'woman' : 'man',
      });
    }
  },
  tickGawkers(dt: number) {
    const gm = dt * MIN_PER_SEC;
    for (const g of this.gawkers) {
      g.age += gm;
      if (g.phase === 'come') {
        this.stroll(g, 4, dt); // (V2: walking briskly over, by the streets)
        if (g.f >= 1) g.phase = 'watch';
      } else if (g.phase === 'watch') {
        g.stay -= gm;
        // stay as long as the incident is live (with a hard cap), wander home after
        const live = g.ref && !g.ref.over && g.age < 240;
        if (g.stay <= 0 && !live) g.phase = 'leave';
      } else {
        this.stroll(g, -2.8, dt);
      }
    }
    this.gawkers = this.gawkers.filter((g: any) => g.phase !== 'leave' || g.f > 0);
  },

  /* ---------------- disputes & crashes ---------------- */
  dispute: null, crash: null, incidentCd: 120,
  tickIncidents(dt: number) {
    const gm = dt * MIN_PER_SEC;
    if (this.incidentCd > 0) this.incidentCd -= gm;
    // shop alarms triggered by petty thefts wind down on their own
    for (const b of World.buildings) {
      if (!b.alarmT) continue;
      b.alarmT -= gm;
      if (b.alarmT <= 0) { b.alarmT = 0; if (!this.crime || this.crime.target !== b) b.alarm = false; }
    }

    if (this.dispute) {
      const d0 = this.dispute;
      // if a squad car is on the way the quarrel keeps simmering until it
      // pulls up (capped, in case the car can never make it there)
      if (d0.unit && !d0.unit.done && !d0.arrived && (d0.stall = (d0.stall || 0) + gm) < 120) {
        if (d0.t < 3) d0.t = 3;
        for (const p of d0.ppl) p.freezeT = Math.max(p.freezeT || 0, 4);
      }
      if (d0.arrived && !d0.calmed) {
        d0.calmed = true;
        d0.t = Math.min(d0.t, 4);
        for (const p of d0.ppl) { p.bubble = '🚔'; p.bubbleUntil = performance.now() + 1800; }
        this.say('🚔 An officer talked the quarrellers down');
      }
      d0.t -= gm;
      if (!d0.calmed && d0.t % 2 < 0.3) for (const p of d0.ppl) { p.bubble = Math.random() < 0.5 ? '💢' : '😠'; p.bubbleUntil = performance.now() + 1500; }
      if (d0.t <= 0) {
        // V2: now and then nobody calms it down in time and it comes to blows (bruises, a split lip)
        if (!d0.calmed && Math.random() < 0.15) {
          const p = d0.ppl[(Math.random() * 2) | 0];
          Health.injure(p, 10 + Math.random() * 18, 'in a scuffle in the street');
          this.say(`🤕 The argument came to blows — ${Sim.fullName(p)} walked away bruised`);
        }
        for (const p of d0.ppl) { p.freezeT = 0; p.bubble = '🤝'; p.bubbleUntil = performance.now() + 2000; }
        d0.over = true;
        this.dispute = null;
      }
    }
    if (this.crash) {
      const c = this.crash;
      // the wreck stays on the road until the squad car actually arrives
      if (c.unit && !c.unit.done && !c.arrived && (c.stall = (c.stall || 0) + gm) < 180) {
        if (c.t < 5) c.t = 5;
      }
      if (c.arrived && !c.secured) {
        c.secured = true;
        c.t = Math.min(c.t, 10);
        this.say('🚔 Police reached the crash — statements taken, tow truck called');
      }
      c.t -= gm;
      if (c.t <= 0) { c.over = true; this.say('🛻 Tow truck cleared the crash site'); this.crash = null; }
    }
    // V2: where a blackout has killed the traffic lights, drivers misjudge each other
    this.darkT = (this.darkT || 0) + gm;
    if (!this.crash && World.darkZone && World.darkZone.size && this.darkT >= 1) {
      this.darkT = 0;
      const cars = Sim.travelers().filter((p: Person) => p.trip.car && World.darkZone.has(World.idx(Math.floor(p.x / T), Math.floor(p.y / T))));
      for (let i = 0; i < cars.length && !this.crash; i++) for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i], b = cars[j];
        if ((a.dirx !== 0) !== (b.dirx !== 0) && Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < 26 && Math.random() < 0.3) {
          this.carCrash(a, b, true);
          break;
        }
      }
    }
    if (this.incidentCd > 0 || Sim.clock < 420 || Sim.clock > 1320) return;

    // dispute: two pedestrians clash
    if (!this.dispute && Math.random() < gm * 0.0012) {
      const walkers = Sim.travelers().filter((p: Person) => !p.trip.car && p.kind !== 'kid');
      for (let i = 0; i < walkers.length && !this.dispute; i++) for (let j = i + 1; j < walkers.length; j++) {
        const a = walkers[i], b = walkers[j];
        if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < 16) {
          a.freezeT = b.freezeT = 9;
          this.dispute = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, t: 9, ppl: [a, b] };
          this.dispute.unit = this.dispatchTo(Math.round(a.x / T), Math.round(a.y / T), this.dispute, 8);
          this.say(this.dispute.unit ? '😠 Public dispute in the street — police en route!' : '😠 A loud argument breaks out in the street', { x: this.dispute.x, y: this.dispute.y });
          this.spawnGawkers(this.dispute.x, this.dispute.y, 3, this.dispute);
          this.incidentCd = 300;
          break;
        }
      }
    }
    // crash: two cars collide
    if (!this.crash && Math.random() < gm * 0.0009) {
      const cars = Sim.travelers().filter((p: Person) => p.trip.car);
      for (let i = 0; i < cars.length && !this.crash; i++) for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i], b = cars[j];
        // a real crash is a JUNCTION collision: one car crossing the other's
        // path (one moving horizontally, the other vertically), right on top
        // of each other. Cars merely passing in opposite lanes are just
        // traffic and must never "crash" and vanish.
        const crossing = (a.dirx !== 0) !== (b.dirx !== 0);
        if (crossing && Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < 11) {
          this.carCrash(a, b, false);
          break;
        }
      }
    }
  },
  /* two villagers' cars collide: a wreck in the road, police, onlookers, and (V2) the injured */
  carCrash(a: any, b: Building, dark: number) {
    this.crash = {
      x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, t: 30, t0: 30,
      s1: a.trip.car.seed, s2: b.trip.car.seed,
      a1: (Math.random() - 0.5) * 1.1, a2: (Math.random() - 0.5) * 1.1 + 1.5, dark: !!dark,
    };
    let hurt = 0;
    const lie = [[-11, 7], [11, -7]];
    [a, b].forEach((p, i) => {
      // V2: a hard knock puts a driver on the tarmac until the ambulance comes
      const sev = 20 + Math.random() * (dark ? 55 : 45);
      if (Math.random() < (dark ? 0.6 : 0.4) && Health.injure(p, sev, 'in a car crash', { x: this.crash.x + lie[i][0], y: this.crash.y + lie[i][1] })) { hurt++; return; }
      if (p.trip.car) p.trip.car.free = true; // shaken drivers head home
      p.state = 'in'; p.at = p.home; p.trip = null; p.dest = null; p.returnAt = undefined; p.backTo = null;
    });
    Snd.crunch(this.crash ? { x: this.crash.x, y: this.crash.y } : undefined);
    this.crash.unit = this.dispatchTo(Math.round(this.crash.x / T), Math.round(this.crash.y / T), this.crash, 12);
    const where = dark ? ' at a junction with its lights out' : '';
    const amb = hurt ? (Health.hospitals().length ? ` — ${hurt > 1 ? 'two drivers' : 'a driver'} hurt, ambulance on the way` : ` — ${hurt > 1 ? 'two drivers' : 'a driver'} hurt, and no hospital to call`) : '';
    this.say(this.crash.unit ? `💥 Car crash${where}! Police are on the way${amb}` : `💥 Car crash${where}! No squad car can respond${amb || ' — the drivers sort it out themselves'}`, { x: this.crash.x, y: this.crash.y });
    this.spawnGawkers(this.crash.x, this.crash.y, 5, this.crash);
    this.coverStory(this.crash.x, this.crash.y, this.crash, dark ? 'Blackout crash: collision at a dark junction' : 'Two-car collision snarls traffic');
    Sim.safety = Math.max(20, Sim.safety - 2);
    this.incidentCd = 400;
  },
  /* send the nearest squad car to a tile; `scene` (optional) is the incident
     object — it gets .arrived stamped when the car pulls up, and the car then
     holds the scene for `wait` game-minutes before heading back */
  dispatchTo(tx: number, ty: number, scene: any, wait: boolean) {
    const spot = World.nearestRoad(tx, ty, 4);
    if (!spot) return null;
    // V2 (Milestone 6): the Founder on patrol takes the call (the scene waits for them as for a squad car)
    if (this.claim && scene && this.claim('police', scene)) return { founder: true, done: false, phase: 'go' };
    const stations = World.buildings.filter((s: Building) => s.type === 'police' && s.connected && !s.construction && !s.ruined);
    let best = null, bp = null;
    for (const s of stations) {
      const path = World.roadPath(s.door.x, s.door.y, spot.x, spot.y);
      if (path && (!bp || path.length < bp.length)) { best = s; bp = path; }
    }
    if (!best) return null;
    const u = { path: kerbside(bp), prog: 0, x: best.door.x * T + 8, y: best.door.y * T + 8, dirx: 1, diry: 0, phase: 'go', station: best, patrol: true, scene: scene || null, wait: wait || 10 };
    this.police.push(u);
    Snd.siren(midPx(best));
    return u;
  },

  /* ---------------- V2: the Founder on the road ----------------
     The Founder's car hit another vehicle hard. A villager's or a visitor's car
     is wrecked like a V1 crash (the Founder's own car is the other one): the
     shaken driver heads home, onlookers gather, police come. Returns true if
     it became an incident (one wreck at a time, like V1). */
  founderCrash(o: any) {
    if (this.crash) return false;
    const p = o && o.trip ? o : null;
    const visitor = !p && this.tourists.includes(o) ? o : null;
    if (!p && !visitor) return false;
    const seed = p ? (p.trip.car ? p.trip.car.seed : p.seed) : visitor.seed;
    const yaw = Math.atan2(o.dirx || 0, o.diry || 1);
    this.crash = {
      x: o.x, y: o.y, t: 30, t0: 30, s1: seed || 0, s2: 0,
      a1: yaw + (Math.random() - 0.5) * 0.9, a2: 0, founder: true, taxi: !!(p && p.trip.taxi),
    };
    if (p) {
      p.mood = Math.max(5, (p.mood === undefined ? 60 : p.mood) - 12);
      Rep.feel(p, -4, "had their car wrecked by the Founder's driving", `crashed into ${p.name}'s car`);
      // V2: a hard enough hit leaves the other driver hurt on the road
      if (!(Math.random() < 0.5 && Health.injure(p, 25 + Math.random() * 45, "when the Founder crashed into their car", { x: o.x + 10, y: o.y + 6 }))) {
        if (p.trip && p.trip.car) p.trip.car.free = true; // the car is towed home
        p.state = 'in'; p.at = p.home; p.trip = null; p.dest = null; p.returnAt = undefined; p.backTo = null;
      }
    } else {
      visitor.phase = 'out'; visitor.done = true;
    }
    Snd.crunch({ x: o.x, y: o.y });
    this.crash.unit = this.dispatchTo(Math.round(this.crash.x / T), Math.round(this.crash.y / T), this.crash, 12);
    const whose = p ? `${Sim.fullName(p)}'s ${p.trip === null && this.crash.taxi ? 'cab' : 'car'}` : "a visitor's car";
    this.say(`💥 The Founder crashed into ${whose} — ${this.crash.unit ? 'police are on the way' : 'no squad car can respond'}`, { x: this.crash.x, y: this.crash.y });
    this.spawnGawkers(this.crash.x, this.crash.y, 5, this.crash);
    this.coverStory(this.crash.x, this.crash.y, this.crash, 'The Founder in a collision on a village street');
    Rep.broadcast(-0.3); // on the evening news, if there is a station
    Sim.safety = Math.max(20, Sim.safety - 2);
    this.incidentCd = Math.max(this.incidentCd, 200);
    return true;
  },
  /* the Founder's car knocked a villager down: they lie stunned, get up shaken, and remember */
  founderHitPerson(p: Person, speed: number) {
    if (p.knocked) return;
    p.knocked = true;
    p.freezeT = 18 + Math.min(20, speed * 2);
    p.bubble = '🤕'; p.bubbleUntil = performance.now() + 7000;
    p.mood = Math.max(5, (p.mood === undefined ? 60 : p.mood) - 15);
    Rep.feel(p, -6, "was knocked down by the Founder's car", `knocked ${p.name} down with their car`);
    Rep.broadcast(-0.4);
    Sim.safety = Math.max(20, Sim.safety - 1);
    Snd.crunch({ x: p.x, y: p.y });
    // V2: at speed it's an injury: they stay down until the ambulance comes (speed in m/s)
    const down = Health.injure(p, speed * 5.5, "by the Founder's car", { x: p.x, y: p.y });
    this.say(`🤕 ${Sim.fullName(p)} was knocked down by the Founder's car${down ? (Health.hospitals().length ? ' — an ambulance is on its way' : ' — and there is no hospital') : ''}`, { x: p.x, y: p.y });
  },

  /* V2 (Milestone 8): any vehicle that runs into someone on foot. A knock at walking pace is a fright; faster, a
     fall and bruises; faster still (or something big), an injury that waits for the ambulance. Villagers are
     hurt, never killed: the worst is critical, and the hospital mends it. (`speed` m/s; `mass` 0.6 … 1.6) */
  vehicleHitPerson(veh: any, p: Person, speed: number, mass: number) {
    if (p.knocked || p.state !== 'walk') return;
    const what = this.buses.includes(veh) ? 'the bus' : this.taxis.includes(veh) ? 'a cab' : this.trucks?.includes(veh) ? 'a delivery truck'
      : this.police.includes(veh) ? 'a police car' : this.fireTrucks.includes(veh) ? 'a fire engine' : this.ambulances?.includes(veh) ? 'an ambulance' : veh?.trip?.moto ? 'a motorbike' : 'a car';
    const force = speed * mass;
    p.knocked = true;
    p.freezeT = 10 + Math.min(25, force * 2);
    // V2: thrown ahead of what hit them, clear of it (they used to fall where they stood, under the car, and lie there
    // with the car on top of them until the ambulance came)
    if (veh && veh.x !== undefined) {
      let hx = veh.hx ?? veh.dirx ?? 0, hy = veh.hy ?? veh.diry ?? 0;
      const hl = Math.hypot(hx, hy);
      if (hl > 1e-6) {
        hx /= hl; hy /= hl;
        const half = (mass >= 1.6 ? 1.3 : mass >= 1.25 ? 0.75 : mass < 0.7 ? 0.3 : 0.56) * 8;
        const ahead = (p.x - veh.x) * hx + (p.y - veh.y) * hy;
        if (ahead < half + 2.5) { p.x += hx * (half + 2.5 - ahead); p.y += hy * (half + 2.5 - ahead); }
      }
    }
    p.bubble = '🤕'; p.bubbleUntil = performance.now() + 6000;
    p.mood = Math.max(5, (p.mood === undefined ? 60 : p.mood) - 10);
    Snd.crunch({ x: p.x, y: p.y });
    if (veh?.trip) veh.trip.v = 0; // the driver stops
    if (force < 3) return; // shaken, not hurt
    const sev = Math.min(88, force * 5);
    const down = Health.injure(p, sev, `by ${what}`, { x: p.x, y: p.y });
    Mind.remember(p, 'health', `was knocked down by ${what}`, -1, 0);
    if (down || sev > 25) this.say(`🚑 ${Sim.fullName(p)} was knocked down by ${what}${down ? (Health.hospitals().length ? ' — an ambulance is on its way' : ' — and there is no hospital') : ''}`, { x: p.x, y: p.y });
  },

  /* ---------------- sky events: balloons, UFO ---------------- */
  balloons: [], ufo: null, ufoCd: 0,
  tickSky(dtSim: number, dtReal: number) {
    // hot-air balloons on calm days
    const calm = Weather.kind === 'clear' && Weather.season !== 3 && Sim.clock > 420 && Sim.clock < 1100;
    if (calm && this.balloons.length < 2 && Math.random() < dtSim * 0.006) {
      this.balloons.push({ x: -20, y: 60 + Math.random() * (GH * T - 160), vx: 6 + Math.random() * 4, ph: Math.random() * 7 });
      this.say('🎈 A hot-air balloon drifts over the valley');
    }
    for (const b of this.balloons) { b.x += b.vx * dtSim; b.ph += dtReal; } // V2: dtSim replaces the UI speed lookup
    this.balloons = this.balloons.filter((b: Building) => b.x < GW * T + 40);
    // …and something stranger, on dark nights
    const night = Sim.clock >= 1380 || Sim.clock < 180;
    if (this.ufoCd > 0) this.ufoCd -= dtSim * MIN_PER_SEC;
    if (!this.ufo && night && this.ufoCd <= 0 && Math.random() < dtSim * 0.0022) {
      let x = Math.random() * GW * T, y = Math.random() * GH * T * 0.5;
      // the mountains draw it sometimes — but never predictably
      if (World.mountains.length && Math.random() < 0.5) { const m = World.mountains[(Math.random() * World.mountains.length) | 0]; x = m.x * T + 40; y = m.y * T - 40; }
      this.ufo = { x, y, t: 13, ph: 0 };
      this.say('👽 Strange lights reported in the night sky…');
    }
    if (this.ufo) {
      const u = this.ufo;
      u.t -= dtReal; u.ph += dtReal * 2;
      u.x += Math.sin(u.ph) * 14 * dtReal; u.y += Math.cos(u.ph * 0.7) * 8 * dtReal;
      if (u.t <= 0) { u.x += 900 * dtReal; if (u.t < -0.6) this.ufo = null; } // zips away
    }
  },

  /* ---------------- ducks on the water ---------------- */
  tickDucks(dt: number) {
    if (Weather.season === 3) { this.ducks = []; return; } // frozen over
    const cap = Math.min(9, (this.waterTiles.length / 12) | 0);
    if (this.waterTiles.length > 5 && this.ducks.length < cap && Math.random() < dt * 0.06) {
      const [tx, ty] = this.waterTiles[(Math.random() * this.waterTiles.length) | 0];
      this.ducks.push({ x: tx * T + 8, y: ty * T + 8, tx: tx * T + 8, ty: ty * T + 8, flip: 1, ph: Math.random() * 7 });
    }
    if (this.ducks.length > cap) this.ducks.length = Math.max(0, cap);
    for (const d of this.ducks) {
      d.ph += dt * 2;
      const dx = d.tx - d.x, dy = d.ty - d.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 2) {
        // paddle toward a nearby water tile
        for (let tries = 0; tries < 8; tries++) {
          const [tx, ty] = this.waterTiles[(Math.random() * this.waterTiles.length) | 0];
          if (Math.abs(tx * T + 8 - d.x) + Math.abs(ty * T + 8 - d.y) < 70) {
            d.tx = tx * T + 4 + Math.random() * 8; d.ty = ty * T + 4 + Math.random() * 8;
            break;
          }
        }
      } else {
        d.x += dx / dist * 1.6 * dt; d.y += dy / dist * 1.6 * dt; // V2: duck paddling pace
        if (Math.abs(dx) > 0.5) d.flip = Math.sign(dx);
      }
    }
  },

  /* ---------------- butterflies ---------------- */
  tickButterflies(dt: number) {
    const want = (Weather.season <= 1 && !Weather.isRaining() && Sim.clock > 420 && Sim.clock < 1100)
      ? Math.min(8, this.fireflySpots.length) : 0;
    while (this.butterflies.length < want) {
      const s = this.fireflySpots[(Math.random() * this.fireflySpots.length) | 0];
      if (!s) break;
      this.butterflies.push({ ax: s.x, ay: s.y, ph: Math.random() * 7, v: (Math.random() * 3) | 0 });
    }
    if (this.butterflies.length > want) this.butterflies.length = want;
    for (const b of this.butterflies) b.ph += dt * 2.4;
  },

  /* ---------------- tourists (out-of-town visitors) ---------------- */
  tickTourists(dt: number) {
    const daytime = Sim.clock > 570 && Sim.clock < 1230;
    if (daytime && this.tourists.length < 4 && this.edgeRoads.length && Math.random() < dt * 0.045) {
      const venues = World.buildings.filter((b: Building) => CAT[b.type].visit && b.connected);
      if (venues.length) {
        const v = venues[(Math.random() * venues.length) | 0];
        const e = this.edgeRoads[(Math.random() * this.edgeRoads.length) | 0];
        const path = World.roadPath(e[0], e[1], v.door.x, v.door.y);
        if (path && path.length > 6) {
          const t = {
            path, prog: 0, phase: 'in', venue: v, stay: 20 + Math.random() * 25,
            seed: (Math.random() * 8) | 0, x: e[0] * T + 8, y: e[1] * T + 8, dirx: 1, diry: 0,
          };
          // (V2: driving in along the road from beyond the map's edge)
          Approach.arrive(t, path);
          this.tourists.push(t);
        }
      }
    }
    for (const t of this.tourists) {
      if (Approach.away(t)) continue; // (V2: still out on the road beyond the edge)
      if (t.phase === 'visit') {
        t.stay -= dt * MIN_PER_SEC;
        if (t.stay <= 0) {
          // (V2: out into the traffic once there's room, as a villager pulls out of a drive: it used to appear in the road
          // at once, inside whatever stood there, and a door on a junction locked the junction)
          const back = (t.back ??= this.backPath(t.path));
          t.waitJ = (t.waitJ || 0) + dt;
          if (Traffic.roomToJoin(t, back, t.waitJ > 20, t.waitJ > 120)) { t.phase = 'out'; t.path = back; t.back = null; t.prog = 0; t.v = 0; }
        }
        continue;
      }
      const moved = Traffic.advance(t, t, t.path, t.prog, 1, 1.6, dt); // V2: tourist cars at town speed, in the traffic
      t.prog += moved;
      this.followPath(t, t.path, t.prog, Traffic.lanePx(t));
      // (V2: gridlock relief, as for the villagers' cars: stuck for good, the visitors give up and go home)
      t.stuckT = moved > 0.002 ? 0 : (t.stuckT || 0) + dt;
      if (t.stuckT > STUCK_RELIEF) { t.done = true; if (t.phase === 'in') t.venue.visitors++; continue; }
      if (t.prog >= t.path.length - 1) {
        if (t.phase === 'in') { t.phase = 'visit'; t.venue.visitors++; }
        // (V2: and away down the road beyond the edge, out of sight before it's gone)
        else if (!Approach.depart(t, t.path)) t.done = true;
      }
    }
    this.tourists = this.tourists.filter((t: any) => !t.done);
  },

  /* ---------------- fireworks ---------------- */
  fireworkVenues() {
    const always = World.buildings.filter((b: Building) => b.type === 'amusement' && b.connected);
    if (Weather.season === 1 && Sim.day % 7 === 0)
      return always.concat(World.buildings.filter((b: Building) => (b.type === 'stadium' || b.type === 'park') && b.connected));
    return always;
  },
  /* on festival nights the WHOLE town becomes a launch pad */
  festiveLaunchSites() {
    if (this._festDay !== Sim.day || !this._festSites) {
      this._festDay = Sim.day;
      const all = World.buildings.filter((b: Building) => !b.ruined && !b.construction && b.connected);
      const picks = [];
      for (let i = 0; i < 14 && all.length; i++) picks.push(all[(Math.random() * all.length) | 0]);
      this._festSites = picks;
    }
    return this._festSites;
  },
  tickFireworks(dt: number) {
    const festive = Festivals.fireworksNight();
    const show = (Sim.clock >= 21 * 60 && Sim.clock <= 22.5 * 60) ||
                 (festive && (Sim.clock >= 19.5 * 60 || Sim.clock < 40));
    const cap = festive ? 420 : 120; // festival skies are LOUD
    if (show && this.rockets.length + this.sparks.length < cap) {
      const sites = festive ? this.fireworkVenues().concat(this.festiveLaunchSites()) : this.fireworkVenues();
      for (const v of sites) {
        if (Math.random() < dt * (festive ? 0.4 : 0.5)) {
          this.rockets.push({
            x: v.x * T + Math.random() * v.w * T, y: v.y * T + v.h * T / 2, gy: v.y * T + v.h * T / 2, // V2: gy = ground row; altitude = gy - y
            vy: -(46 + Math.random() * 22), t: 0.9 + Math.random() * 0.5,
            hue: ['#ff6060', '#ffd160', '#60c0ff', '#80ff90', '#ff90e0', '#c0a0ff'][(Math.random() * 6) | 0],
          });
          Snd.launch(midPx(v));
        }
      }
    }
    for (const r of this.rockets) {
      r.y += r.vy * dt; r.t -= dt;
      if (r.t <= 0) {
        const n = 22 + (Math.random() * 10 | 0);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * 6.283, sp = 26 + Math.random() * 30;
          this.sparks.push({ x: r.x, y: r.y, gy: r.gy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1.1, hue: r.hue });
        }
        Snd.pop({ x: r.x, y: r.gy ?? r.y });
        r.dead = true;
      }
    }
    this.rockets = this.rockets.filter((r: any) => !r.dead);
    for (const s of this.sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 26 * dt; s.life -= dt * 0.85; }
    this.sparks = this.sparks.filter((s: any) => s.life > 0);
  },

  /* ---------------- hikers ---------------- */
  tickHikers(dt: number) {
    // V2 (Milestone 8): on the big peak's trail, walkers and mountain bikers in daylight: up to the summit, a rest
    // to take in the view, and back down (the bikes faster, and much faster downhill)
    const day = Sim.clock > 420 && Sim.clock < 1110 && !Weather.isRaining();
    if (World.peaks.length && day && this.hikers.filter((h: any) => h.trail).length < 9 && Math.random() < dt * 0.05) {
      const pk = World.peaks[(Math.random() * World.peaks.length) | 0];
      const up = peakTrail(pk).map(([x, z]: number[]) => [x * 2, z * 2]);
      const bike = Math.random() < 0.4;
      this.hikers.push({ route: up.concat(up.slice(0, -1).reverse()), topIdx: up.length - 1, idx: 0, f: 0, pause: 0, paused: false, seed: (Math.random() * 1e6) | 0, x: up[0][0], y: up[0][1], trail: true, bike });
    }
    const cap = Math.min(5, World.mountains.length * 2);
    if (World.mountains.length && this.hikers.length < cap && Math.random() < dt * 0.03) {
      const m = World.mountains[(Math.random() * World.mountains.length) | 0];
      // V2: the summit is the massif's centre (V1 read it off the 2D sprite);
      // the renderer lifts hikers onto the slope's real height
      const bx = m.x * T + 8 + Math.random() * (MSIZE * T - 16);
      const by = (m.y + MSIZE) * T - 3;
      const px = (m.x + MSIZE / 2) * T, py = (m.y + MSIZE / 2) * T;
      const up = [[bx, by]];
      const steps = 5;
      for (let i = 1; i <= steps; i++) {
        const f = i / steps;
        up.push([
          bx + (px - bx) * f + (i < steps ? (Math.random() * 26 - 13) : 0),
          by + (py - by) * f,
        ]);
      }
      const route = up.concat(up.slice(0, -1).reverse());
      this.hikers.push({ route, topIdx: steps, idx: 0, f: 0, pause: 0, paused: false, seed: (Math.random() * 1e6) | 0, x: bx, y: by });
    }
    for (const h of this.hikers) {
      if (h.pause > 0) { h.pause -= dt; continue; }
      const a = h.route[h.idx], b = h.route[h.idx + 1];
      if (!b) { h.done = true; continue; }
      const dist = Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1]));
      // (V2 (Milestone 8): a mountain bike climbs at a walk and a half, and comes down at a lick)
      const pace = h.bike ? (h.idx < h.topIdx ? 4.4 : 11) : 3;
      h.f += dt * pace / dist; // V2: 8.5 → 3 px/s, a real walking pace in 3D
      if (h.f >= 1) {
        h.f = 0; h.idx++;
        if (h.idx === h.topIdx && !h.paused) { h.pause = 14 + Math.random() * 16; h.paused = true; } // admire the view
      }
      const na = h.route[h.idx], nb = h.route[h.idx + 1] || na;
      h.x = na[0] + (nb[0] - na[0]) * h.f;
      h.y = na[1] + (nb[1] - na[1]) * h.f;
    }
    this.hikers = this.hikers.filter((h: any) => !h.done);
  },

  /* ---------------- birds ---------------- */
  tickBirds(dt: number) {
    const day = Sim.clock > 330 && Sim.clock < 1180;
    if (day && this.birds.length < 12 && Math.random() < dt * 0.045) {
      const ltr = Math.random() < 0.5;
      const y = Math.random() * GH * T;
      const n = 3 + (Math.random() * 4 | 0);
      for (let i = 0; i < n; i++)
        this.birds.push({
          x: ltr ? -30 - i * 14 : GW * T + 30 + i * 14,
          y: y + (Math.random() * 30 - 15),
          vx: (ltr ? 1 : -1) * (30 + Math.random() * 14),
          ph: Math.random() * 7,
        });
    }
    for (const b of this.birds) { b.x += b.vx * dt; b.ph += dt * 9; }
    this.birds = this.birds.filter((b: Building) => b.x > -90 && b.x < GW * T + 90);
  },

  /* ---------------- crime & justice ---------------- */
  unemployedCount() { return Sim.people.filter((p: Person) => p.kind !== 'kid' && !p.work).length; },

  tickCrime(dtSim: number) {
    const gm = dtSim * MIN_PER_SEC; // game-minutes elapsed
    if (this.cooldown > 0) this.cooldown -= gm;
    const night = Sim.clock >= 1290 || Sim.clock < 270;

    if (!this.crime && night && this.cooldown <= 0 && Sim.people.length >= 4) {
      const chance = (0.10 + this.unemployedCount() * 0.06) * (gm / 60); // per game-hour
      if (Math.random() < chance) this.startCrime();
    }

    const c = this.crime;
    if (c) {
      const B = c.burglar;
      if (B.phase === 'approach' || B.phase === 'flee') {
        // V2: a burglar on foot runs ~5.6 m/s, on the pavement, round people and cars (sim/walking.ts)
        if (!B.trip || B.trip.path !== B.path) { B.trip = { path: B.path, prog: B.prog }; Walk.plan(B, B.trip, null, null); }
        B.trip.prog = Math.min(B.path.length - 1, B.trip.prog + Walk.step(B, B.trip, dtSim, 0.7));
        Walk.pose(B, B.trip);
        B.prog = B.trip.prog;
        if (B.prog >= B.path.length - 1) {
          if (B.phase === 'approach') {
            B.phase = 'rob'; c.robT = 26;
            c.target.alarm = true;
            this.say(`🚨 Break-in at the ${CAT[c.target.type].name}!`, { x: c.target.x * T + c.target.w * 8, y: c.target.y * T + c.target.h * 8 });
            this.crimeN = (this.crimeN || 0) + 1;
            c.taskId = 'burglary' + this.crimeN;
            Tasks.add(c.taskId, '🚨', `Catch the burglar at the ${CAT[c.target.type].name}`);
            this.dispatchPolice(c);
          } else this.resolve(false); // reached the edge of town with the loot
        }
      } else if (B.phase === 'rob') {
        c.robT -= gm;
        if (c.robT <= 0) {
          c.target.alarm = false;
          B.phase = 'flee'; B.prog = 0;
          B.path = this.escapePath(c.target);
          if (!B.path) this.resolve(false);
        }
      }
    }

    // police movement
    for (const u of this.police) {
      if (u.pursuit || u.block) continue; // V2: chasing the Founder, or manning a roadblock (src/player/wanted.ts)
      if (u.phase === 'scene') { // parked at the incident, lights flashing
        u.wait -= gm;
        if (u.wait <= 0) { u.phase = 'return'; u.path = this.backPath(u.path, u.prog); u.prog = 0; u.drv = {}; }
        continue;
      }
      // V2: squad cars ~70 km/h through town, on blue lights to a call, in the traffic (sim/traffic.ts; they used to
      // drive through it), and at town pace back to the station
      const step = Traffic.advance(u, (u.drv ??= {}), u.path, u.prog, 1, 2.4, dtSim, undefined, u.phase === 'go');
      u.prog += step;
      this.followPath(u, u.path, Math.min(u.prog, u.path.length - 1), Traffic.lanePx(u.drv));
      if (Traffic.there(u.drv, u.path.length - 1 - u.prog, step, dtSim)) {
        if (u.phase === 'go') {
          // (V2: pulled up behind anything already standing at the scene)
          u.prog = Traffic.settle(u, u.path, Math.min(u.prog, u.path.length - 1), Traffic.lanePx(u.drv), CAR_LEN);
          this.followPath(u, u.path, u.prog, Traffic.lanePx(u.drv));
          // arrived at the scene
          const cc = u.patrol ? null : this.crime;
          if (cc && (cc.burglar.phase === 'rob' ||
                     (cc.burglar.phase === 'flee' && this.tileDist(u, cc.burglar) < 9))) {
            const court = World.buildings.some((b: Building) => b.type === 'courthouse' && b.connected);
            if (Math.random() < (court ? 0.95 : 0.8)) { this.resolve(true, u); }
            else { this.say('💨 The burglar slipped away in the chaos!'); this.resolve(false, null, true); }
          } else if (cc) { /* too late — burglar still fleeing; wait it out */ }
          if (u.scene) u.scene.arrived = true;
          if (u.patrol) { // hold the scene instead of an instant U-turn
            u.phase = 'scene';
            if (u.wait === undefined) u.wait = 6;
            continue;
          }
          u.phase = 'return';
          u.path = this.backPath(u.path, u.prog); u.prog = 0; u.drv = {};
        } else u.done = true;
      }
    }
    this.police = this.police.filter((u: any) => !u.done);
  },

  startCrime() {
    const weights: Record<string, number> = { bank: 5, mall: 3, market: 2.5, shop: 2, restaurant: 1.5, hotel: 1.5, house: 1, cottage: 1 };
    const targets = World.buildings.filter((b: Building) => weights[b.type] && b.connected);
    if (!targets.length) return;
    let sum = 0; for (const t of targets) sum += weights[t.type];
    let r = Math.random() * sum, target = targets[0];
    for (const t of targets) { r -= weights[t.type]; if (r <= 0) { target = t; break; } }
    // burglar sneaks in from a distant road tile
    const roads = [];
    for (let i = 0; i < World.roadMap.length; i++)
      if (World.roadMap[i]) roads.push([i % GW, (i / GW) | 0]);
    if (roads.length < 8) return;
    let spawn: number[] | null = null, bd = -1;
    for (let tries = 0; tries < 14; tries++) {
      const rt = roads[(Math.random() * roads.length) | 0];
      const d = Math.abs(rt[0] - target.door.x) + Math.abs(rt[1] - target.door.y);
      if (d > bd) { bd = d; spawn = rt; }
    }
    if (!spawn) return;
    const path = World.roadPath(spawn[0], spawn[1], target.door.x, target.door.y);
    if (!path || path.length < 4) return;
    this.crime = {
      target,
      burglar: { phase: 'approach', path, prog: 0, x: spawn[0] * T + 8, y: spawn[1] * T + 8, seed: (Math.random() * 1e6) | 0 },
    };
  },

  escapePath(from: Building) {
    const roads = [];
    for (let i = 0; i < World.roadMap.length; i++)
      if (World.roadMap[i]) roads.push([i % GW, (i / GW) | 0]);
    let best = null, bd = -1;
    for (let tries = 0; tries < 12; tries++) {
      const rt = roads[(Math.random() * roads.length) | 0];
      const d = Math.abs(rt[0] - from.door.x) + Math.abs(rt[1] - from.door.y);
      if (d > bd) { bd = d; best = rt; }
    }
    return best ? World.roadPath(from.door.x, from.door.y, best[0], best[1]) : null;
  },

  dispatchPolice(c: any) {
    if (this.claim && this.claim('police', c)) return; // V2 (Milestone 6): the Founder on patrol answers the alarm
    const stations = World.buildings.filter((b: Building) => b.type === 'police' && b.connected);
    let best = null, bp = null;
    for (const s of stations) {
      const p = World.roadPath(s.door.x, s.door.y, c.target.door.x, c.target.door.y);
      if (p && (!bp || p.length < bp.length)) { best = s; bp = p; }
    }
    if (!best) { this.say('😰 No police in town — nobody answers the alarm…'); return; }
    this.police.push({ path: kerbside(bp), prog: 0, x: best.door.x * T + 8, y: best.door.y * T + 8, dirx: 1, diry: 0, phase: 'go', station: best });
    this.say('🚔 Police dispatched!');
    Snd.siren(midPx(best));
  },

  resolve(arrested: boolean, unit: any, vanished: boolean) {
    const c = this.crime;
    if (!c) return;
    c.target.alarm = false;
    if (c.taskId)
      Tasks.done(c.taskId, arrested, arrested ? 'Burglar arrested' : `The burglar got away from the ${CAT[c.target.type].name}`);
    if (arrested) {
      this.arrests++;
      Sim.safety = Math.min(100, Sim.safety + 3);
      const court = World.buildings.some((b: Building) => b.type === 'courthouse' && b.connected);
      this.say(court ? '⚖️ Burglar arrested and convicted — justice served!' : '🚔 Burglar arrested!');
      if (unit && unit.station) unit.station.visitors++;
    } else if (!vanished) {
      this.crimes++;
      Sim.safety = Math.max(20, Sim.safety - 9);
      // the loot is REAL money now — it leaves the till (or the family savings)
      const loot = Math.min(Math.floor(c.target.funds || 0), 25 + ((Math.random() * 55) | 0));
      if (loot > 0) c.target.funds -= loot;
      this.say(`💰 The burglar got away with ${loot > 0 ? '$' + loot + ' in loot' : 'the loot'} from the ${CAT[c.target.type].name}…`);
    } else {
      this.crimes++;
      Sim.safety = Math.max(20, Sim.safety - 5);
    }
    this.crime = null;
    this.cooldown = 380 + Math.random() * 400;
  },

  /* V2 (Milestone 8): the village's public transport runs to a timetable: first services at 05:30, the
     last bus and the last train at 23:30 (then the buses go back to the depot); one bus in the evening */
  transitHours() {
    const c = Sim.clock;
    return c >= 330 && c < LAST_TRAIN;
  },
  /* which service runs when — one train per track at any moment */
  serviceWindow(type: string) {
    const c = Sim.clock;
    switch (type) {
      // V2 (Milestone 8): passenger trains stop for the night: the first at 05:30, the last away at 23:30
      // (they used to run all night: the sleeper, and the weekend local round the clock)
      case 'local': return Sim.isWeekend() ? c >= 330 && c < LAST_TRAIN : (c >= 330 && c < 390) || (c >= 600 && c < 960) || (c >= 1200 && c < LAST_TRAIN); // early, midday, evening & weekends
      case 'commuter': return !Sim.isWeekend() && ((c >= 390 && c < 600) || (c >= 960 && c < 1200)); // rush hours
      case 'express': return c >= 390 && c < 1260;                                 // daytime dash
      case 'nightliner': return false;                                             // (retired: no passenger trains overnight)
      default: return true;                                                        // freight never sleeps
    }
  },

  /* is any train within r tiles of this spot? (level-crossing gates ask)
     A train dwelling at a station platform doesn't keep distant gates
     down for the whole stop — only one actually ON the crossing does. */
  trainNearTile(x: number, y: number, r: any) {
    for (const tr of this.intercity ? this.trains.concat([this.intercity]) : this.trains) { // V2: the intercity holds the gates too
      if (tr.hidden) continue; // stabled services don't hold gates
      const d = Math.abs(tr.x / T - x) + Math.abs(tr.y / T - y);
      if (d >= r) continue;
      if (tr.pause > 3 && d > 2.5) continue;
      return true;
    }
    return false;
  },

  /* V2 (Milestone 8): a train on its track: round the bends on their curves, on its own track of the mainline
     (`o.lane` px right of the line as the route runs), facing the way it's going */
  followRail(o: any, path: any, prog: number, dir = 1) {
    if (!path || !path.length) return;
    const p = railPose(path, prog, o.lane || 0);
    o.x = p.x; o.y = p.y;
    o.dirx = p.dx * dir; o.diry = p.dy * dir;
    o.hx = p.hx * dir; o.hy = p.hy * dir;
  },

  /* V2 (Milestone 8): the way back for a vehicle at step `at` of `path` to where it set out (path[0]), planned
     afresh so it keeps right (the route out driven backwards is on the wrong side of every avenue) */
  backPath(path: number[][], at = path.length - 1): number[][] {
    const i = Math.max(0, Math.min(path.length - 1, Math.round(at)));
    const a = path[i];
    // (V2: back out of the map along the other row of a dual carriageway than the one it came in by)
    const g = Approach.gateAt(path[0][0], path[0][1]), out = g && Approach.outGate(g);
    const b = out ? [out.x, out.y] : path[0];
    const p = World.roadPath(a[0], a[1], b[0], b[1]);
    return p && p.length > 1 ? p : path.slice(0, i + 1).reverse();
  },

  /* shared path-follower (tile paths → px position with lane offset). V2: heading and lane follow the way it's
     travelling (a bus on its return leg keeps right); V2 (Milestone 8): round the bends on an arc in its lane
     (sim/traffic.ts lanePose). `dirx, diry` stay the axis of the stretch it's on; `hx, hy` is the true heading. */
  followPath(o: any, path: any, prog: number, off: number, dir = 1) {
    if (!path || !path.length) return;
    const p = lanePose(path, prog, off, dir);
    o.x = p.x; o.y = p.y;
    o.dirx = p.dx; o.diry = p.dy;
    o.hx = p.hx; o.hy = p.hy;
  },

  tileDist(a: any, b: Building) { return (Math.abs(a.x - b.x) + Math.abs(a.y - b.y)) / T; },
};

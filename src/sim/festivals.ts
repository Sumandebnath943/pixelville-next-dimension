// Ported from PixelVille V1 js/festivals.js (see docs/DESIGN.md §3), typed against src/sim/types.ts. Behaviour changes for 3D are marked "V2:".
import type { Building, XY } from './types';
import { GH, GW, G_GRASS, World } from './world';
import { Life } from './life';
import { FOOT_PX, LANE_PX } from './traffic';
import { Sim } from './agents';
import { Settings } from './settings';
import { MIN_PER_SEC, T } from './core';
import { CAT } from './catalog';
import { News } from './news';
import { Gov } from './gov';
/* ============================================================
   PixelVille — festivals & traditions.
   The village year is 28 days (7 per season). Feasts fall on the
   same days every year, so traditions really are traditions:

     day  1        New Year's Day (fireworks spill past midnight)
     day  4–5      Easter — painted eggs, park picnics
     day 18–19     DIWALI — diyas on every sill, two nights of
                   town-wide fireworks
     day 15–16     tree scouting      ┐
     day 17–18     the cut & the haul │ the Christmas tree (V2 (Milestone 8): Rockefeller's way)
     day 19–21     raising & lights   │ tradition, every winter
     day 22–28     THE TREE IS LIT — a month of celebration,
                   every building decorated, lights all night,
                   carols round the tree (Eve 24, Christmas 25)
     day 27–28     New Year fireworks — two nights, all rooftops
   ============================================================ */

export const Festivals: any = {
  tree: null,          // { year, x, y, src, phase, prog, haulPath }
  markets: [],         // {x, y, seed} — big Christmas markets, all season
  carolers: [],        // {x, y, seed} — singing groups outside homes
  santa: null,         // Santa walking the streets by day
  sleigh: null,        // …and flying at midnight
  sleighDay: 0,
  carolT: 0,
  _seasonOn: false,
  lastAnnounce: '',

  reset() {
    this.tree = null; this.lastAnnounce = '';
    this.markets = []; this.carolers = []; this.santa = null; this.sleigh = null;
    this.sleighDay = 0; this.carolT = 0; this._seasonOn = false;
    if (World.clearReserved) World.clearReserved();
  },

  /* mark the ground under the markets (and the great tree's base) as held, so
     the auto-road planner never runs a street through the festival */
  reserveGround() {
    if (!World.reserveRect) return;
    World.clearReserved();
    for (const mk of this.markets) World.reserveRect(mk.x, mk.y, 5, 4);
    if (this.tree && !['scouting', 'cutting', 'loaded', 'hauling'].includes(this.tree.phase))
      World.reserveRect(this.tree.x - 1, this.tree.y - 1, 4, 4);
  },
  say(m: string) { Life.say(m); },

  yearDay() { return ((Sim.day - 1) % 28) + 1; },
  year() { return Math.floor((Sim.day - 1) / 28); },

  isEaster() { const d = this.yearDay(); return d === 4 || d === 5; },
  isDiwali() { const d = this.yearDay(); return d === 18 || d === 19; },
  isChristmasSeason() { return this.yearDay() >= 22; },   // the whole of winter
  decorated() { return this.isChristmasSeason(); },        // lights on every building
  /* does the season lock fast-forward right now? The player chooses how much
     of Christmas is savoured at 1x: just Eve & Day (default), the whole
     festive week, or not at all. */
  speedLocked() {
    const mode = Settings.get('xmasLock');
    if (mode === 'off') return false;
    if (mode === 'season') return this.isChristmasSeason();
    const d = this.yearDay();
    return d === 24 || d === 25;
  },
  diyasTonight() { return this.isDiwali(); },
  fireworksNight() {
    const d = this.yearDay();
    return d === 18 || d === 19 ||            // Diwali, two nights
           d === 27 || d === 28 ||            // New Year, two nights
           (d === 1 && Sim.clock < 90);       // …and past midnight
  },

  tick(dtSim: number) {
    const gm = dtSim * MIN_PER_SEC;
    this.tickTree(gm);
    this.tickSeason(gm);
    this.announce();
  },

  /* ---------- the Christmas month: markets, carolers, Santa ---------- */
  tickSeason(gm: number) {
    const on = this.isChristmasSeason() && Sim.people.length >= 8;
    if (on && !this._seasonOn) { this._seasonOn = true; this.setupMarkets(); this.reserveGround(); }
    if (!on) {
      if (this._seasonOn) {
        this._seasonOn = false; this.markets = []; this.carolers = []; this.santa = null; this.sleigh = null;
        if (World.clearReserved) World.clearReserved();
      }
      return;
    }
    // carol groups move from doorstep to doorstep
    this.carolT -= gm;
    if (this.carolT <= 0) {
      this.carolT = 90 + Math.random() * 70;
      this.carolers = [];
      const spots = World.buildings.filter((b: Building) => b.connected && !b.ruined && !b.construction &&
        (CAT[b.type].res && b.residents.length || b.type === 'church'));
      for (let k = 0; k < Math.min(4, 1 + (spots.length / 8 | 0)); k++) {
        const b = spots[(Math.random() * spots.length) | 0];
        this.carolers.push({ x: b.door.x * T + 8, y: b.door.y * T + 12, seed: b.id * 31 + k });
      }
    }
    // Santa strolls the streets by day, sack over his shoulder
    if (!this.santa && Sim.clock > 540 && Sim.clock < 1200 && Math.random() < gm * 0.012) {
      const roads = [];
      for (let i = 0; i < World.roadMap.length; i++) if (World.roadMap[i]) roads.push(i);
      if (roads.length > 20) {
        const a = roads[(Math.random() * roads.length) | 0], b = roads[(Math.random() * roads.length) | 0];
        const path = World.roadPath(a % GW, (a / GW) | 0, b % GW, (b / GW) | 0);
        if (path && path.length > 14) this.santa = { path, prog: 0, x: path[0][0] * T + 8, y: path[0][1] * T + 8, dirx: 1, diry: 0 };
      }
    }
    if (this.santa) {
      this.santa.prog += 0.25 * (gm / MIN_PER_SEC); // V2: Santa strolls at walking pace
      Life.followPath(this.santa, this.santa.path, this.santa.prog, FOOT_PX); // V2 (Milestone 8): on the pavement
      if (this.santa.prog >= this.santa.path.length - 1) this.santa = null;
    }
    // …and at midnight, the sleigh crosses the sky, dropping gifts
    const midnight = Sim.clock >= 1420 || Sim.clock < 30;
    if (!this.sleigh && midnight && this.sleighDay !== Sim.day) {
      this.sleighDay = Sim.day;
      this.sleigh = { x: -50, y: 50 + Math.random() * (GH * T * 0.5), ph: Math.random() * 7 };
      this.say('🛷 Bells in the midnight sky — SANTA is over the village, delivering gifts rooftop to rooftop!');
    }
    if (this.sleigh) {
      const dts = gm / MIN_PER_SEC;
      this.sleigh.x += 66 * dts;
      this.sleigh.ph += dts * 2;
      if (Math.random() < dts * 2.2 && Life.sparks.length < 220)
        Life.sparks.push({ // a gift twinkles down over the rooftops
          x: this.sleigh.x - 8, y: this.sleigh.y + 10 + Math.random() * 8, gy: this.sleigh.y + 150, // V2: falls from ~70 m
          vx: (Math.random() - 0.5) * 6, vy: 14 + Math.random() * 10,
          life: 1.5, hue: Math.random() < 0.5 ? '#ffd160' : '#ff90e0',
        });
      if (this.sleigh.x > GW * T + 60) this.sleigh = null;
    }
  },

  /* the big Christmas markets: 2–3 of them, placed on open ground by the roads */
  setupMarkets() {
    this.markets = [];
    const roads = [];
    for (let i = 0; i < World.roadMap.length; i++) if (World.roadMap[i]) roads.push(i);
    if (roads.length < 20) return;
    const want = Math.min(3, 1 + Math.floor(Sim.people.length / 50));
    for (let tries = 0; tries < 500 && this.markets.length < want; tries++) {
      const r = roads[(Math.random() * roads.length) | 0];
      const rx = r % GW, ry = (r / GW) | 0;
      const x = rx - 2 + ((Math.random() * 6) | 0) - 2, y = ry + 1 + ((Math.random() * 3) | 0);
      let ok = true;
      for (let j = 0; j < 4 && ok; j++) for (let i2 = 0; i2 < 5; i2++) {
        const xx = x + i2, yy = y + j;
        if (!World.inB(xx, yy)) { ok = false; break; }
        const k = World.idx(xx, yy);
        if (World.ground[k] !== G_GRASS || World.bmap[k] || World.roadMap[k] || World.railMap[k]) { ok = false; break; }
      }
      if (!ok) continue;
      if (this.markets.some((m: XY) => Math.abs(m.x - x) + Math.abs(m.y - y) < 30)) continue;
      if (this.tree && Math.abs(this.tree.x - x) + Math.abs(this.tree.y - y) < 9) continue;
      this.markets.push({ x, y, seed: (Math.random() * 1e6) | 0 });
    }
    if (this.markets.length) {
      this.say(`🎪 The Christmas markets are OPEN — ${this.markets.length} of them across town! Stalls, lights, roast chestnuts and mulled cocoa.`);
      News.breaking('Christmas markets open across town — lights, stalls and cocoa');
    }
  },

  /* ---------- once-a-day festival announcements & effects ---------- */
  announce() {
    const yd = this.yearDay(), key = this.year() + ':' + yd;
    if (this.lastAnnounce === key) return;
    this.lastAnnounce = key;
    if (Sim.people.length < 4) return;
    const boost = (n: number) => { for (const p of Sim.people) p.mood = Math.min(98, (p.mood === undefined ? 60 : p.mood) + n); };
    if (yd === 1) {
      this.say('🎆 HAPPY NEW YEAR, PixelVille! Confetti in the streets and resolutions all round.');
      boost(6);
    } else if (yd === 4) {
      this.say('🐣 Easter morning! Painted eggs on every doorstep and egg hunts in the parks.');
      boost(4);
    } else if (yd === 18) {
      this.say('🪔 DIWALI! The festival of lights — every home glows with diyas tonight, and the sky will burn with fireworks.');
      News.breaking('Diwali tonight — diyas on every sill, fireworks over the whole town');
      boost(6);
    } else if (yd === 24) {
      this.say('🎄 Christmas Eve — stockings hung, the great tree shining, carols around the square.');
      boost(5);
    } else if (yd === 25) {
      this.say('🎁 MERRY CHRISTMAS! Presents under every tree — the whole village gathers at the great one.');
      News.breaking('Merry Christmas from PVTV — scenes of joy at the great tree');
      boost(8);
      for (const b of World.buildings) // presents aren't free
        if (CAT[b.type].res && b.residents.length) b.funds = Math.max(0, b.funds - 5);
    } else if (yd === 28) {
      this.say("🎇 New Year's Eve — the countdown is on. Fireworks at midnight over every rooftop!");
      News.breaking("New Year's Eve — town-wide fireworks at midnight");
    }
  },

  /* ---------- the Christmas tree: an annual, visible tradition ----------
     V2 (Milestone 8): told the way New York's great tree comes to Rockefeller Center, stretched over the
     village's autumn and winter so every stage can be watched:
       day 15–16  the head gardener scouts by helicopter; a family offers the giant spruce in its garden
       day 17     cut: a crane holds the tree while the crew saws, then lays it on a flatbed
       day 18     the haul: the flatbed crawls through town at 10:00 with a police escort, crowds watching
       day 19     raised: a crane stands it up in the square (from 10:00); scaffolding goes up round it
       day 19–21  decorated: 50,000 lights strung from the bottom up; on day 21 the star is hoisted to the top
       day 22     the lighting ceremony on PVTV: stage and crowd from 20:00, the lights go on at 21:50
       then       lit 05:00–midnight daily, all night Christmas Eve and Day, till 21:00 on New Year's Eve
       day 2      taken down in the new year; its lumber goes to build homes */
  findTreeSpot() {
    const c = Gov.townCenter();
    const plaza = World.buildings.find((b: Building) => (b.type === 'plaza' || b.type === 'grandpark') && !b.ruined);
    const cx = plaza ? plaza.x + (plaza.w >> 1) : c.x, cy = plaza ? Math.max(2, plaza.y - 2) : c.y;
    for (let r = 0; r < 24; r++) for (let t = 0; t < Math.max(1, r * 8); t++) {
      const a = (t / Math.max(1, r * 8)) * 6.283;
      const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r);
      let ok = true;
      for (let j = 0; j < 2 && ok; j++) for (let i = 0; i < 2; i++) {
        if (!World.inB(x + i, y + j)) { ok = false; break; }
        const k = World.idx(x + i, y + j);
        if (World.ground[k] !== G_GRASS || World.bmap[k] || World.roadMap[k] || World.railMap[k]) { ok = false; break; }
      }
      if (ok) return { x, y };
    }
    return null;
  },
  /** the tree to bring: a conifer in a family's garden (they offer it, as families do for New York's), else the
   *  grandest in the farthest woods */
  findTreeSource(spot: XY): { src: XY | null; family: string | null } {
    let best: XY | null = null, bd = -1, family: string | null = null;
    for (const b of World.buildings as Building[]) {
      if (!CAT[b.type]?.res || !b.residents?.length || b.type === 'lodge') continue;
      for (let j = -3; j <= b.h + 2; j++) for (let i = -3; i <= b.w + 2; i++) {
        const x = b.x + i, y = b.y + j;
        if (!World.inB(x, y) || World.tree[World.idx(x, y)] !== 2) continue;
        const d = Math.abs(x - spot.x) + Math.abs(y - spot.y);
        if (d > bd && d > 12) { bd = d; best = { x, y }; family = b.residents[0].surname; }
      }
    }
    if (best) return { src: best, family };
    for (let i = 0; i < World.tree.length; i++) {
      if (!World.tree[i]) continue;
      const x = i % GW, y = (i / GW) | 0;
      const d = Math.abs(x - spot.x) + Math.abs(y - spot.y) + (World.tree[i] === 2 ? 40 : 0);
      if (d > bd) { bd = d; best = { x, y }; }
    }
    return { src: best, family: null };
  },
  /** are the great tree's lights on right now? */
  treeLightsOn(): boolean {
    const tr = this.tree;
    if (!tr || tr.phase !== 'lit') return false;
    const yd = this.yearDay(), c = Sim.clock;
    if (yd === 24 || yd === 25) return true;           // all night on Christmas Eve and Christmas Day
    if (yd === 28) return c >= 300 && c < 1260;         // New Year's Eve: till 21:00
    return c >= 300;                                    // 05:00 to midnight
  },

  tickTree(gm: number) {
    const yd = this.yearDay(), yr = this.year(), c = Sim.clock;
    if (Sim.people.length < 8) { this.tree = null; Life.convoy = null; return; } // traditions need a village
    // the new year: on its second day the tree comes down, and its timber builds homes
    if (this.tree && yd >= 2 && yd < 15) {
      if (this.tree.phase === 'lit') {
        const site = World.buildings.find((b: Building) => b.construction > 0 && CAT[b.type].res);
        if (site) site.mats = (site.mats || 0) + 12;
        this.say(`🎄 The great tree came down for another year — its timber goes to build homes${site ? ` (the ${CAT[site.type].name} going up has it)` : ''}. See you next winter.`);
        News.breaking('The great tree comes down — its lumber will build homes');
      }
      this.tree = null;
      return;
    }
    if (yd < 15) return;
    if (!this.tree || this.tree.year !== yr) {
      const spot = this.findTreeSpot();
      if (!spot) return;
      const { src, family } = this.findTreeSource(spot);
      this.tree = { year: yr, x: spot.x, y: spot.y, src, family, phase: 'scouting', prog: 0, haulPath: null, chosen: false };
      if (yd <= 16) {
        this.say("🚁 The head gardener is up in the helicopter, scouting the countryside for this year's Christmas tree — the great tradition begins!");
        News.breaking("The hunt is on: the head gardener scouts for this year's great tree");
      } else {
        // a village loaded part-way through the season picks the tradition up where it would be, quietly
        const t = this.tree;
        t.chosen = true;
        const felled = (): void => { if (t.src) { World.tree[World.idx(t.src.x, t.src.y)] = 0; World.dirty = true; } };
        if (yd >= 23 || (yd === 22 && c >= 1310)) { t.phase = 'lit'; t.prog = 1; t.star = true; t.starT = 1; felled(); this.reserveGround(); }
        else if (yd === 22) { t.phase = 'ceremony'; t.prog = 1; t.star = true; t.starT = 1; felled(); this.reserveGround(); }
        else if (yd >= 19) {
          t.phase = 'decorating'; t.prog = Math.min(1, (yd - 19 + c / 1440) / 2.1); t.star = yd === 21 && c >= 660; t.starT = t.star ? 1 : 0;
          felled(); this.reserveGround();
        } else if (yd === 18 || c >= 780) { t.phase = 'loaded'; felled(); }
      }
    }
    const tr = this.tree;
    if (tr.phase === 'scouting') {
      if (!tr.chosen && (yd > 15 || c >= 900)) {
        tr.chosen = true;
        const where = tr.src ? Gov.districtName(tr.src.x, tr.src.y) : 'the deep woods';
        this.say(tr.family ? `🎄 This year's tree is chosen: a giant spruce from the ${tr.family} family's garden in ${where} — they've offered it to the village!` : `🎄 This year's tree is chosen: a giant spruce from ${where}.`);
        News.breaking(tr.family ? `The ${tr.family} family gives the village its Christmas tree` : "This year's Christmas tree is chosen");
      }
      if (yd >= 17 && c >= 540) { tr.phase = 'cutting'; tr.prog = 0; this.say('🪚 The crew is at the tree: a crane takes its weight while they saw through the trunk.'); }
    }
    if (tr.phase === 'cutting') {
      tr.prog = Math.min(1, tr.prog + gm / 240); // four hours with the crane and the saws
      if (tr.prog >= 1 || yd >= 18) {
        tr.phase = 'loaded'; tr.prog = 0;
        if (tr.src) { World.tree[World.idx(tr.src.x, tr.src.y)] = 0; World.dirty = true; } // felled
        this.say('🌲 Down, wrapped and lashed to a flatbed: the great tree sets off for the square tomorrow at 10:00.');
      }
    }
    if (tr.phase === 'loaded' && yd >= 18 && c >= 600) {
      const a = tr.src ? World.nearestRoad(tr.src.x, tr.src.y, 30) : null;
      const b = World.nearestRoad(tr.x, tr.y, 12);
      tr.haulPath = a && b ? World.roadPath(a.x, a.y, b.x, b.y) : null;
      tr.phase = 'hauling'; tr.prog = 0;
      this.say('🚛 The great tree is on the move! A police escort leads the flatbed through town — whole streets are out to watch it pass.');
      News.breaking('LIVE: the great tree rolls through town under police escort');
    }
    if (tr.phase === 'hauling') {
      const path = tr.haulPath;
      if (path && path.length > 1) {
        tr.prog += 0.45 * (gm / MIN_PER_SEC); // a procession's pace, about 13 km/h
        // (the flatbed's own position: the tree's x, y are the square it's bound for)
        tr.cv ??= { x: 0, y: 0, dirx: 1, diry: 0 };
        Life.followPath(tr.cv, path, Math.min(tr.prog, path.length - 1), LANE_PX);
        Life.convoy = tr.cv;
      }
      if (!path || path.length < 2 || tr.prog >= path.length - 1 || yd >= 19) {
        Life.convoy = null;
        tr.phase = 'arrived'; tr.prog = 0; this.reserveGround();
        this.say('🎄 The great tree has arrived in the square. Tomorrow a crane stands it up.');
      }
    }
    if (tr.phase === 'arrived' && yd >= 19 && c >= 600) { tr.phase = 'raising'; tr.prog = 0; this.say('🏗️ The crane lifts the great tree upright in the square — slowly, slowly…'); }
    if (tr.phase === 'raising') {
      tr.prog = Math.min(1, tr.prog + gm / 120); // two hours on the crane
      if (tr.prog >= 1) {
        tr.phase = 'decorating'; tr.prog = 0;
        this.say('🪜 The tree stands tall! Scaffolding goes up around it, and the crew begins stringing 50,000 lights.');
      }
    }
    if (tr.phase === 'decorating') {
      // the lights go on from the bottom up through days 19–21 (working hours); the star on day 21 at 11:00
      if (c > 420 && c < 1080) tr.prog = Math.min(1, tr.prog + gm / (2.1 * 660));
      if (yd >= 21 && c >= 660 && !tr.star) {
        tr.star = true; tr.starT = 0;
        this.say('⭐ The crane hoists the great star to the very top of the tree. Everything is ready for the lighting.');
        News.breaking('The star is on top — the lighting ceremony is tomorrow night');
      }
      if (tr.star) tr.starT = Math.min(1, (tr.starT || 0) + gm / 60);
      if (yd >= 22) { tr.prog = 1; tr.star = true; tr.starT = 1; tr.phase = 'ceremony'; }
    }
    if (tr.phase === 'ceremony') {
      if (c >= 1200 && !tr.stage) {
        tr.stage = true;
        this.say('🎤 The tree-lighting ceremony is starting in the square — singers on the stage, PVTV live, half the village in scarves!');
        News.breaking('LIVE on PVTV: the tree-lighting ceremony');
      }
      if (c >= 1310 || yd >= 23) {
        tr.phase = 'lit'; tr.stage = false;
        this.say('✨ 3… 2… 1… The great tree blazes into light! Cheers, carols and cocoa all round.');
        News.breaking('The Christmas tree is LIT — lit every day 05:00 to midnight, all night on Christmas Eve and Day');
        Life.celebrate(tr.x * T + 16, tr.y * T + 16, '#ffd160');
        for (const p of Sim.people) p.mood = Math.min(98, (p.mood === undefined ? 60 : p.mood) + 8);
      }
    }
  },
};

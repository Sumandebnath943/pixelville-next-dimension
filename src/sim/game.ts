/* ============================================================
   PixelVille — Next Dimension · the game orchestrator.
   The non-rendering half of V1's main.js: the tick order, map
   edits (place / drag tools / bulldoze / undo), new maps and
   scenarios, saves with rollback, the Founder's Lodge, gossip
   between passers-by and the church bells. Headless: it talks
   to the client only through the event bus in core.ts.
   ============================================================ */
import { CAT } from './catalog';
import { emit, on, Snd, T } from './core';
import { G_WATER, GW, GH, MSIZE, World, footprint, originForDoor } from './world';
import { Weather, SEASONS, SEASON_EMOJI } from './weather';
import { Sim, SCENARIOS } from './agents';
import { Life } from './life';
import { Gov } from './gov';
import { Calamity } from './calamity';
import { Festivals } from './festivals';
import { Mind } from './mind';
import { Tasks } from './tasks';
import { News } from './news';
import { Settings } from './settings';
import { Traffic } from './traffic';

/** Speed steps (× real time). Street mode is capped at 1× (design §6). */
export const SPEEDS = [0, 1, 2, 4, 8];

export interface UndoEntry {
  kind: string;
  x: number;
  y: number;
  type?: string;
  bx?: number;
  by?: number;
  f?: number;
  level?: number;
  funds?: number;
}

export interface FounderSave {
  x: number;
  y: number;
  z: number;
  yaw: number;
  car?: { x: number; z: number; yaw: number } | null;
  wallet: number;
  /** V2: the wallet's ledger (newest last) and the car's dents */
  ledger?: { day: number; time: string; amount: number; label: string; kind: string }[];
  damage?: number;
}

export const Game = {
  speedIdx: 1,
  /** true while the Founder is on the street: fast-forward is not allowed */
  streetMode: true,
  /** bumped whenever terrain, roads, rails or the building set change */
  mapVersion: 0,
  undoStack: [] as UndoEntry[],
  lodgeId: 0,
  prevClock: -1,
  thundered: false,
  lastChat: 0,
  /** the client registers these so the Founder travels with saves */
  founderHooks: null as null | { get: () => FounderSave; set: (s: FounderSave | null) => void },

  /* ---------- boot & new maps ---------- */
  boot(seed?: number): void {
    Settings.load();
    this.resetAll();
    World.genStarterMap(seed);
    Weather.init();
    this.ensureLodge();
    this.afterMapEdit();
  },

  resetAll(): void {
    Sim.reset();
    Life.reset();
    Gov.reset();
    Calamity.reset();
    Festivals.reset();
    News.reset();
    Traffic.reset();
    Life.onEvent = (msg: string, at?: { x: number; y: number }) => this.toast(msg, at);
    this.undoStack = [];
  },

  newMap(name: string, scenarioId: string, seed?: number): void {
    World.genStarterMap(seed);
    this.resetAll();
    Weather.init();
    World.name = (name || 'PixelVille').slice(0, 24);
    this.ensureLodge();
    this.founderHooks?.set(null);
    const scenarios: Record<string, any> = SCENARIOS;
    if (scenarioId !== 'sandbox' && scenarios[scenarioId]) {
      Sim.scenario = { id: scenarioId, startDay: Sim.day, done: false, failed: false, zeroDays: 0 };
      const def = scenarios[scenarioId];
      Tasks.add('scenario', def.emoji, `Scenario: ${def.desc}`);
      this.toast(`🎯 Scenario: ${def.name} — ${def.desc}. Good luck!`);
    }
    this.afterMapEdit();
    this.toast(`New land discovered 🗺️ — open the Planner (P) and drop a house to found ${World.name}!`);
  },

  /** The Founder's Lodge: the player's home base beside the west highway. */
  ensureLodge(): void {
    const existing = World.buildings.find((b: any) => b.type === 'lodge');
    if (existing) {
      this.lodgeId = existing.id;
      return;
    }
    let spot: { x: number; y: number; f: number } | null = null;
    const hw = World.highway && World.highway.west;
    if (hw) {
      // the highway is laid along row hw.y (plus its partner lane below)
      for (let x = (GW >> 1) - 40; x > 8 && !spot; x--) {
        const o = originForDoor('lodge', 0, x, hw.y - 1);
        if (World.canPlace('lodge', o.x, o.y, 0)) spot = { ...o, f: 0 };
      }
    }
    if (!spot) spot = World.findPlannedSpot('lodge');
    if (!spot) return;
    const b = World.placeBuilding('lodge', spot.x, spot.y, true, spot.f);
    if (b) this.lodgeId = b.id;
  },

  lodge(): any {
    return World.buildings.find((b: any) => b.id === this.lodgeId) || null;
  },

  /* ---------- speed ---------- */
  setSpeed(i: number): void {
    i = Math.max(0, Math.min(SPEEDS.length - 1, i));
    if (this.streetMode && i > 1) i = 1;
    // Christmas is savoured, not skipped: fast-forward closes per the setting
    if (i > 1 && Festivals.speedLocked()) {
      if (this.speedIdx === 1) this.toast('🎄 Christmas runs at its own unhurried pace — fast-forward reopens after the celebrations');
      i = 1;
    }
    this.speedIdx = i;
  },
  speed(): number {
    return SPEEDS[this.speedIdx];
  },

  /* ---------- the frame tick ---------- */
  tick(dt: number): void {
    dt = Math.min(0.1, dt);
    if ((this.streetMode || Festivals.speedLocked()) && this.speedIdx > 1) this.speedIdx = 1;
    const spd = this.speed();
    if (spd > 0) {
      const dts = dt * spd;
      Sim.tick(dts);
      Life.tick(dts, dt);
      Calamity.tick(dts);
      Festivals.tick(dts);
    }
    // ribbon-cuttings: construction sites that just finished
    while (Sim.completed.length) {
      const b = Sim.completed.shift();
      this.afterMapEdit();
      Snd.place();
      this.toast(`✅ ${CAT[b.type].name} completed!`);
      emit('buildingDone', { id: b.id });
      for (const m of Sim.onBuildingAdded(b)) this.toast(m);
    }
    Weather.tick(dt * spd, dt);
    // church bells at 9:00 and 18:00, thunder after lightning
    if (this.prevClock >= 0 && spd > 0)
      for (const bellT of [540, 1080]) if (this.prevClock < bellT && Sim.clock >= bellT) Snd.bell();
    this.prevClock = Sim.clock;
    if (Weather.flash > 0.4 && !this.thundered) {
      this.thundered = true;
      Snd.thunder();
    }
    if (Weather.flash <= 0) this.thundered = false;
    // neighbours greet each other when paths cross — tips and gossip pass along
    const now = performance.now();
    if (now - this.lastChat > 650 && spd > 0) {
      this.lastChat = now;
      const walkers = Sim.travelers().filter((p: any) => !p.trip.car && !p.trip.taxi && !p.trip.moto);
      for (let i = 0; i < walkers.length; i++)
        for (let j = i + 1; j < walkers.length; j++) {
          const a = walkers[i], b = walkers[j];
          if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < 13 && now > (a.chatCd || 0) && now > (b.chatCd || 0)) {
            a.bubble = b.bubble = '💬';
            a.bubbleUntil = b.bubbleUntil = now + 1900;
            a.chatCd = b.chatCd = now + 26000;
            Mind.gossip(a, b);
          }
        }
    }
    if (World.dirty) this.refreshDerived();
  },

  /** idle progress while the tab is hidden: catch up in small steady steps */
  catchUp(seconds: number): void {
    let remaining = Math.min(seconds, 90);
    const spd = Math.min(this.speed(), 1);
    if (spd <= 0) return;
    while (remaining > 0) {
      const step = Math.min(0.5, remaining);
      remaining -= step;
      Sim.tick(step);
      Life.tick(step, step);
      Calamity.tick(step);
      Festivals.tick(step);
      Weather.tick(step, step);
    }
    while (Sim.completed.length) {
      const b = Sim.completed.shift();
      this.afterMapEdit();
      this.toast(`✅ ${CAT[b.type].name} completed!`);
      for (const m of Sim.onBuildingAdded(b)) this.toast(m);
    }
    if (World.dirty) this.refreshDerived();
  },

  refreshDerived(): void {
    World.rebuildDerived(Weather.season, Calamity.droughtLevel >= 0.5);
    World.dirty = false;
    this.mapVersion++;
  },

  /* ---------- toasts: everything also lands in the task book ---------- */
  toast(msg: string, at?: { x: number; y: number }): void {
    Tasks.log(msg);
    emit('toast', { msg, at });
  },

  /* ---------- map editing (the Planner) ---------- */
  afterMapEdit(): void {
    World.refreshConnections();
    Sim.assignJobs();
    Sim.assignSchools();
    World.dirty = true;
    Life.trainT = 0; // re-check the railway right away
    this.refreshDerived();
    emit('mapEdited', {});
  },

  canPlace(key: string, x: number, y: number, f: number): boolean {
    return World.canPlace(key, x, y, f);
  },

  /** click-to-place for buildings and point tools; returns true if anything changed */
  placeAt(key: string, x: number, y: number, f = 0): boolean {
    const d = CAT[key];
    if (!d) return false;
    if (d.building) {
      const b = World.placeBuilding(key, x, y, false, f);
      if (!b) return false;
      this.afterMapEdit();
      Snd.place();
      this.toast(`🏗️ ${d.name} under construction${b.connected ? '' : ' — ⚠️ no road access!'}`);
      return true;
    }
    switch (d.tool) {
      case 'forest':
        World.placeForest(x, y);
        World.dirty = true;
        this.refreshDerived();
        return true;
      case 'pond':
        World.stampWaterDisc(x, y, 1.8);
        World.waterStamp++;
        this.afterMapEdit();
        return true;
      case 'lake':
        World.stampLake(x, y, 4 + Math.random() * 1.5, 2.8 + Math.random(), null);
        World.waterStamp++;
        this.afterMapEdit();
        return true;
      case 'mountain':
        if (World.placeMountain(x - (MSIZE >> 1), y - (MSIZE >> 1)))
          this.toast('Mountain range raised ⛰️ — roads will carve around it');
        this.afterMapEdit();
        return true;
      case 'bulldoze':
        return this.bulldozeAt(x, y);
    }
    return false;
  },

  bulldozeAt(x: number, y: number): boolean {
    const target = World.buildingAt(x, y);
    if (target && target.type === 'lodge') {
      this.toast("🛖 The Founder's Lodge is your home base — it can't be demolished");
      return false;
    }
    const r = World.bulldoze(x, y);
    if (!r) return false;
    if (r.kind === 'building') {
      Sim.onBuildingRemoved(r.b);
      this.toast(`${CAT[r.b.type].name} demolished 🚜 — Ctrl+Z to undo`);
    }
    this.recordBulldoze(r, x, y);
    this.afterMapEdit();
    Snd.crunch();
    return true;
  },

  /** drag tools: road, rail, river, bulldoze (applied on release, as V1) */
  dragTool(key: string, x0: number, y0: number, x1: number, y1: number): void {
    const d = CAT[key];
    if (!d) return;
    if (d.tool === 'road') {
      World.layRoadLine(x0, y0, x1, y1);
      this.afterMapEdit();
    } else if (d.tool === 'rail') {
      World.layRailLine(x0, y0, x1, y1);
      this.afterMapEdit();
      const nst = World.buildings.filter((b: any) => b.type === 'trainstation' && !b.ruined).length;
      this.toast(nst >= 2 ? 'Railway track laid 🛤️' : 'Railway track laid 🛤️ — build two train stations to start a service');
    } else if (d.tool === 'river') {
      World.carveRiver(x0, y0, x1, y1, null);
      World.waterStamp++;
      this.afterMapEdit();
      this.toast('River carved 🏞️');
    } else if (d.tool === 'bulldoze') {
      const sx = Math.sign(x1 - x0) || 1, sy = Math.sign(y1 - y0) || 1;
      for (let y = y0; y !== y1 + sy; y += sy) for (let x = x0; x !== x1 + sx; x += sx) this.bulldozeAt(x, y);
    }
  },

  /* ---------- bulldoze undo (Ctrl+Z) ---------- */
  recordBulldoze(r: any, x: number, y: number): void {
    const entry: UndoEntry = { kind: r.kind, x, y };
    if (r.kind === 'building') {
      const b = r.b;
      Object.assign(entry, { type: b.type, bx: b.x, by: b.y, f: b.facing || 0, level: b.level, funds: Math.round(b.funds) });
    }
    this.undoStack.push(entry);
    if (this.undoStack.length > 40) this.undoStack.shift();
  },

  undo(): void {
    const e = this.undoStack.pop();
    if (!e) {
      this.toast('Nothing to undo');
      return;
    }
    switch (e.kind) {
      case 'road': World.setRoad(e.x, e.y); break;
      case 'rail': World.setRail(e.x, e.y); break;
      case 'tree': World.placeTree(e.x, e.y); break;
      case 'water': {
        const i = World.idx(e.x, e.y);
        if (!World.bmap[i] && !World.roadMap[i]) {
          World.ground[i] = G_WATER;
          World.waterStamp++;
        }
        break;
      }
      case 'rock':
        this.toast("A levelled mountain stays levelled — some things can't be undone");
        return;
      case 'building': {
        const b = World.placeBuilding(e.type, e.bx, e.by, true, e.f || 0);
        if (!b) {
          this.toast("The plot is blocked now — couldn't rebuild");
          return;
        }
        b.level = e.level || 1;
        for (const m of Sim.onBuildingAdded(b)) this.toast(m);
        b.funds = e.funds || b.funds;
        break;
      }
    }
    this.afterMapEdit();
    this.toast('↩️ Bulldoze undone');
  },

  /* ---------- save / load ---------- */
  buildSaveString(): string {
    return World.serialize({
      clock: Sim.clock, day: Sim.day, safety: Sim.safety,
      arrests: Life.arrests, crimes: Life.crimes,
      firesRecent: Life.firesRecent || 0, graveCases: Life.graveCases || 0,
      gov: Gov.serialize(),
      people: Sim.serializePeople(),
      nextPid: Sim.nextPid,
      stocks: Sim.stocks || null,
      drought: Math.round(Calamity.droughtLevel * 100) / 100,
      tasks: { items: Tasks.items.slice(-120), news: Tasks.news.slice(-250) },
      history: Sim.history || [],
      tier: Sim.tierReached || 0,
      scenario: Sim.scenario || null,
      lodge: this.lodgeId,
      founder: this.founderHooks ? this.founderHooks.get() : null,
      meta: { name: World.name, day: Sim.day, pop: Sim.people.length, at: Date.now() },
    });
  },

  applyLoadedState(extra: any): void {
    this.resetAll();
    Sim.clock = extra.clock || 420;
    Sim.day = extra.day || 1;
    Sim.safety = extra.safety || 92;
    Life.arrests = extra.arrests || 0;
    Life.crimes = extra.crimes || 0;
    Life.firesRecent = extra.firesRecent || 0;
    Life.graveCases = extra.graveCases || 0;
    if (extra.drought) Calamity.droughtLevel = extra.drought;
    Weather.init();
    if (extra._v >= 4 && extra.people) {
      Sim.restorePeople(extra.people, extra.nextPid);
      Sim.stocks = extra.stocks || null;
      Sim.history = extra.history || [];
      Sim.tierReached = extra.tier || 0;
      Sim.scenario = extra.scenario || null;
      if (extra.tasks) {
        Tasks.items = extra.tasks.items || [];
        Tasks.news = extra.tasks.news || [];
        Tasks._dirty = true;
      }
    } else {
      // legacy v3 save: the town survives, and new families move into the homes
      for (const b of World.buildings) {
        if (b.construction > 0 || b.ruined) continue;
        const funds = b.funds;
        Sim.onBuildingAdded(b);
        b.funds = funds;
      }
    }
    Sim.grandOpening = null;
    Gov.restore(extra.gov);
    this.lodgeId = extra.lodge || 0;
    this.ensureLodge();
    this.founderHooks?.set(extra._fromV1 ? null : extra.founder || null);
    this.afterMapEdit();
  },

  /** load a save string; a bad file must never cost the running village */
  performLoad(data: string | null): { ok: boolean; msg: string } {
    if (!data) return { ok: false, msg: 'That slot is empty' };
    const backup = this.buildSaveString();
    try {
      const extra = World.deserialize(data);
      if (extra._incompat) return { ok: false, msg: "⚠️ That save is from a very old PixelVille map and can't be loaded" };
      this.applyLoadedState(extra);
      if (extra._fromV1) this.toast(`📦 ${World.name} arrived from PixelVille V1 — the whole village, now in 3D`);
      return { ok: true, msg: 'Village loaded 📂' };
    } catch (e) {
      this.applyLoadedState(World.deserialize(backup));
      return { ok: false, msg: `⚠️ Load failed (${(e as Error).message}) — your current village is untouched` };
    }
  },

  /* ---------- small helpers for the client ---------- */
  dateLine(): string {
    const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const vYear = Math.floor((Sim.day - 1) / 28) + 1;
    const seasonDay = ((Sim.day - 1) % 7) + 1;
    return `Day ${Sim.day} · ${WEEKDAYS[Sim.day % 7]} ${seasonDay} ${SEASONS[Weather.season]}, Yr ${vYear} · ${Sim.timeStr()}`;
  },
  seasonToast(season: number): void {
    this.toast(`${SEASON_EMOJI[season]} ${SEASONS[season]} has arrived`);
  },
  /** sim px → tile */
  tileOf(px: number): number {
    return Math.floor(px / T);
  },
  footprint,
  mapSize: { w: GW, h: GH },
};

on('seasonChange', ({ season }) => Game.seasonToast(season));

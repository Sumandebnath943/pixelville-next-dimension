/* ============================================================
   Hustings (V2): an election as the village lives it, on open
   ground and in daylight. (It used to be a figure on a box in
   the road outside the town hall from midnight, a ring of stand-
   ins around it, and the traffic driving through them; polling
   day was a fixed queue that stood there all night.)

   Campaign week: each day one candidate holds a rally on a green
   (open grass beside a street, near the town hall; never the
   road itself). Volunteers put up a little stage two hours
   before; villagers, mostly that candidate's supporters, walk
   over on the pavements in their own time, step onto the grass
   and stand in front of it; the candidate arrives, climbs up and
   speaks for an hour and a quarter while the crowd claps now and
   then; afterwards everyone drifts home and the stage comes
   down. Weekdays at 18:00 after work, or in the afternoon when
   the evenings are dark: it is always over before sunset (fewer
   can come then); weekends late morning. A downpour rains it off.

   Polling day: a polling station (booths under a canopy) stands
   on the same kind of ground, open 08:00–18:00. Villagers walk
   over when their day allows (before or after work), join the
   queue, which moves up as booths free, mark their ballot,
   post it and walk home. Whoever is queueing at 18:00 still
   votes; then it is packed away. Nothing of it is out at night.

   Everyone you see there is a real villager on a real walk
   (sim/agents.ts hands them over at the end of the pavement);
   positions are V1 px (16 a tile).
   ============================================================ */
import type { Person } from './types';
import { World, G_GRASS, G_SAND } from './world';
import { T } from './core';
import { Sim, WALK_SPEED } from './agents';
import { Life } from './life';
import { Gov } from './gov';
import { Weather } from './weather';
import { Health } from './health';
import { Walk } from './walking';

/** the speech: 18:00 on weekdays (after work) when the evenings are light, earlier when they aren't (it's over
 *  before sunset); 11:30 at the weekend (game-minutes) */
const SPEECH_WEEKDAY = 1080, SPEECH_WEEKEND = 690, SPEECH_EARLIEST = 780;
/** the stage goes up two hours before the speech; the speech runs 75 minutes; the stage comes down within the hour */
const SETUP_BEFORE = 120, SPEECH_LEN = 75, DOWN_AFTER = 60;
/** a late candidate is waited for this long before the crowd gives up */
const LATE = 45;
/** the polling station: up at 07:30, open 08:00–18:00 */
export const POLLS_OPEN = 480, POLLS_CLOSE = 1080;
/** nobody is still out at a rally or the polls after 21:30, nor before 06:00 */
const CURFEW = 1290, DAWN = 360;
/** the farthest a villager walks to a rally (tiles as the crow flies, door to green: the walk itself must fit
 *  between the stage going up and the speech) */
const RALLY_REACH = 22;
/** how high the stage deck stands (m): the renderer lifts the speaker onto it */
export const STAGE_DECK = 0.56;

export interface Ground {
  /** the road tile people walk to, and the way from it into the open ground (tiles) */
  ax: number; ay: number; dx: number; dy: number;
  /** the ground's tiles as a rectangle: the walkers' "destination", so they finish on its side of the street */
  rect: { x: number; y: number; w: number; h: number };
}
interface Pt { x: number; y: number }

/** open grass a crowd can stand on: no road, rail, building, tree, water or anything else on it */
function clear(x: number, y: number): boolean {
  if (!World.inB(x, y)) return false;
  const i = World.idx(x, y), g = World.ground[i];
  return (g === G_GRASS || g === G_SAND) && !World.roadMap[i] && !World.railMap[i] && !World.bmap[i] && !World.reserved[i] && !World.tree[i];
}
/** a point on the ground (px): `k` tiles in from the road tile (0.5 its near edge, 3.5 its far edge), `j` tiles across */
export function onGround(g: Ground, k: number, j: number): Pt {
  return { x: (g.ax + 0.5 + g.dx * k - g.dy * j) * T, y: (g.ay + 0.5 + g.dy * k + g.dx * j) * T };
}
/** a green near tile (cx, cy): three tiles wide and three deep, off a street, clear of everything (and of the
 *  campaign's own banners and camps) */
export function findGround(cx: number, cy: number): Ground | null {
  const busy = new Set<number>();
  const camp = Gov.campaign;
  if (camp) for (const o of [...(camp.banners || []), ...(camp.camps || [])]) busy.add(World.idx(o.x, o.y));
  const roads: [number, number, number][] = [];
  for (let y = cy - 16; y <= cy + 16; y++)
    for (let x = cx - 16; x <= cx + 16; x++) if (World.isRoad(x, y)) roads.push([x, y, Math.abs(x - cx) + Math.abs(y - cy)]);
  roads.sort((a, b) => a[2] - b[2]);
  for (const [x, y] of roads)
    for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      let ok = true;
      for (let k = 1; k <= 3 && ok; k++)
        for (let j = -1; j <= 1 && ok; j++) {
          const tx = x + dx * k - dy * j, ty = y + dy * k + dx * j;
          ok = clear(tx, ty) && !busy.has(World.idx(tx, ty));
        }
      if (!ok) continue;
      const xs = [x + dx + dy, x + dx - dy, x + 3 * dx + dy, x + 3 * dx - dy], ys = [y + dy - dx, y + dy + dx, y + 3 * dy - dx, y + 3 * dy + dx];
      const x0 = Math.min(...xs), y0 = Math.min(...ys);
      return { ax: x, ay: y, dx, dy, rect: { x: x0, y: y0, w: Math.max(...xs) - x0 + 1, h: Math.max(...ys) - y0 + 1 } };
    }
  return null;
}
/** where the village's civic life happens: the town hall, else the school, else the middle of the homes (tiles) */
function civicCentre(): Pt {
  const b = World.buildings.find((o: any) => o.type === 'townhall' && !o.ruined && !o.construction) ||
            World.buildings.find((o: any) => o.type === 'school' && !o.ruined && !o.construction);
  if (b) return { x: b.door.x, y: b.door.y };
  const homes = World.buildings.filter((o: any) => o.residents && o.residents.length);
  if (!homes.length) return { x: 128, y: 128 };
  let x = 0, y = 0;
  for (const h of homes) { x += h.door.x; y += h.door.y; }
  return { x: Math.round(x / homes.length), y: Math.round(y / homes.length) };
}
/** free to go out until `until` (game-minutes): at home, well, not behind bars, no shift starting meanwhile */
function free(p: Person, until: number): boolean {
  if (p.state !== 'in' || p.at !== p.home || !p.home || !p.home.connected) return false;
  if (p.heldUntil > Sim.day || Health.resting(p)) return false;
  return !(p.events || []).some((e: any) => e.dest && e.dest === p.work && e.t < until && e.until > Sim.clock);
}
/** a candidate can also leave work early for their own rally (a car they came in waits in its bay till they're back) */
function freeSpeaker(p: Person, until: number): boolean {
  if (p.state === 'in' && p.at && p.at === p.work && p.heldUntil <= Sim.day && !Health.resting(p)) return true;
  return free(p, until);
}
/** how long the walk from `b`'s door to the ground's road tile really takes (game-minutes), or null: no way there */
function walkTo(b: any, g: Ground): number | null {
  const path = World.walkPath(b.door.x, b.door.y, g.ax, g.ay);
  return path && path.length >= 2 ? path.length / (WALK_SPEED * 0.72) : null;
}
/** today's sunset (game-minutes): the sky's own sun (gfx/sky.ts sunAt: 46°N, solar time) on the day of the year the
 *  stage gives the season and the day within it (render/stage.ts dayOfYear) */
export function sunset(): number {
  const mids = [105, 196, 288, 15];
  const doy = (mids[Weather.season] + (((Sim.day - 1) % 7 + 0.5) / 7 - 0.5) * 91 + 365) % 365;
  const lat = (46 * Math.PI) / 180, decl = ((-23.44 * Math.PI) / 180) * Math.cos(((2 * Math.PI) / 365) * (doy + 10));
  const h0 = Math.acos(Math.max(-1, Math.min(1, -Math.tan(lat) * Math.tan(decl))));
  return 720 + ((h0 * 180) / Math.PI / 15) * 60;
}
const hhmm = (m: number): string => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;

/** step `o` (px) towards (x, y) by up to `v` px, facing the way it goes; true once there */
function moveTo(o: any, x: number, y: number, v: number): boolean {
  const dx = x - o.x, dy = y - o.y, d = Math.hypot(dx, dy);
  if (d <= v || d < 1e-3) { o.x = x; o.y = y; return true; }
  o.x += (dx / d) * v; o.y += (dy / d) * v;
  o.dirx = o.hx = dx / d; o.diry = o.hy = dy / d;
  return false;
}
/** turn `o` to face (x, y) */
function face(o: any, x: number, y: number): void {
  const dx = x - o.x, dy = y - o.y, d = Math.hypot(dx, dy) || 1;
  o.dirx = o.hx = dx / d; o.diry = o.hy = dy / d;
}

export const Hustings: any = {
  /** today's rally, before its stage is up: { day, cand, ci, speech } */
  plan: null,
  /** polling day, before the station is up: { day } */
  pollPlan: null,

  reset() { this.plan = null; this.pollPlan = null; Life.rally = null; Life.votingBooths = null; },
  /** the campaign is over (or overtaken by events): everything is packed away and everyone walks home */
  clear() { this.plan = null; this.pollPlan = null; Life.rally = null; Life.votingBooths = null; },

  /* ---------- the campaign: today's rally (Gov plans it at the start of the day) ---------- */
  planRally(cand: any, ci: number) {
    // (in winter that's an afternoon rally, and fewer can come: most are still at work)
    const speech = Sim.isWeekend() ? SPEECH_WEEKEND : Math.round(Math.max(SPEECH_EARLIEST, Math.min(SPEECH_WEEKDAY, sunset() - SPEECH_LEN - 20)));
    this.plan = { day: Sim.day, cand, ci, speech };
  },
  /** polling day (Gov opens it at the start of the day; the station goes up at 07:30) */
  openPolls() {
    this.pollPlan = { day: Sim.day };
  },

  tick(dt: number) {
    const now = Sim.clock;
    const pl = this.plan;
    if (pl && pl.day !== Sim.day) this.plan = null;
    else if (pl && !Life.rally && now >= pl.speech - SETUP_BEFORE && now < pl.speech) this.raiseStage(pl);
    if (Life.rally) this.tickRally(Life.rally, now, dt);
    const pp = this.pollPlan;
    if (pp && pp.day !== Sim.day) this.pollPlan = null;
    else if (pp && !Life.votingBooths && now >= POLLS_OPEN - 30 && now < POLLS_CLOSE - 60) this.setUpPolls();
    if (Life.votingBooths) this.tickPolls(Life.votingBooths, now);
  },

  raiseStage(pl: any) {
    this.plan = null;
    const camp = Gov.campaign;
    if (!camp || camp.votingDay) return;
    const cand = pl.cand;
    if (Weather.kind === 'heavy' || (Weather.isSnowing() && Weather.intensity > 0.6)) {
      Life.say(`☔ ${cand.name}'s rally is rained off — the volunteers knock on doors instead`);
      return;
    }
    const speaker = cand.personId ? Sim.people.find((p: Person) => p.id === cand.personId) : null;
    if (speaker && (speaker.heldUntil > Sim.day || Health.resting(speaker) || speaker.state === 'hurt')) {
      Life.say(`📣 ${cand.name} is unable to campaign today — tonight's rally is called off`);
      return;
    }
    // on a green in the candidate's own neighbourhood (their neighbours walk over; so do they), else by the town hall
    const c = civicCentre();
    const g = (speaker && speaker.home && findGround(speaker.home.door.x, speaker.home.door.y)) || findGround(c.x, c.y);
    if (!g) return; // no open ground anywhere near: the campaign stays on the doorsteps today
    const s = onGround(g, 3.2, 0);
    const r: any = {
      day: Sim.day, ci: pl.ci, cand, name: cand.name, color: cand.color || '#4f8ede', g,
      x: s.x, y: s.y, fx: -g.dx, fy: -g.dy,             // the stage, and the way it faces (the crowd, the street)
      speech: pl.speech, start: 0, overAt: 0, phase: 'up', // up → speech → over
      spots: [], taken: [], list: [],
      speakerId: speaker ? speaker.id : 0, speakerSent: false, onStage: false,
      standIn: speaker ? null : { x: 0, y: 0, lift: 0, shown: false, phase: 'wait', kind: (cand.name.length % 3) ? 'man' : 'woman', seed: cand.name.length * 37 + pl.ci },
      cheerUntil: 0, nextCheer: 0,
    };
    r.spots = this.crowdSpots(r);
    r.taken = r.spots.map(() => false);
    r.list = this.attendees(r);
    Life.rally = r;
    Life.say(`🎪 Volunteers are putting up a stage on the green for ${cand.name}'s rally at ${hhmm(pl.speech)}`);
  },

  /** where the crowd stands: rows on arcs in front of the stage, the front rows and the middle first */
  crowdSpots(r: any): Pt[] {
    const out: { x: number; y: number; row: number; a: number }[] = [];
    const rx = -r.fy, ry = r.fx; // across the stage
    for (let row = 0; row < 5; row++) {
      const rad = 6.4 + row * 2; // px (3.2 m for the front row, a metre a row after)
      const n = Math.max(3, Math.floor((rad * 2.1) / 1.7));
      for (let i = 0; i < n; i++) {
        const a = (i / (n - 1) - 0.5) * 2.1 + (row % 2 ? 0.08 : -0.08);
        const jx = Math.sin(i * 12.9898 + row * 7.233) * 0.35, jy = Math.cos(i * 4.1414 + row * 3.71) * 0.35;
        out.push({ x: r.x + (r.fx * Math.cos(a) + rx * Math.sin(a)) * rad + jx, y: r.y + (r.fy * Math.cos(a) + ry * Math.sin(a)) * rad + jy, row, a: Math.abs(a) });
      }
    }
    out.sort((p, q) => p.row - q.row || p.a - q.a);
    return out;
  },

  /** who comes: mostly the candidate's own supporters, a few of the curious; only those within a walk. Each sets
   *  off in their own time, to be there before the speech */
  attendees(r: any): { p: Person; at: number; sent: boolean }[] {
    const camp = Gov.campaign, cands = camp.candidates;
    const adults = Sim.people.filter((p: Person) => p.kind !== 'kid' && p.id !== r.speakerId && p.home && p.home.connected);
    const want = Math.round(Math.min(r.spots.length, 3 + adults.length / 4) * (Weather.isRaining() || Weather.isSnowing() ? 0.6 : 1));
    const scored: { p: Person; w: number; d: number }[] = [];
    for (const p of adults) {
      const d = Math.abs(p.home.door.x - r.g.ax) + Math.abs(p.home.door.y - r.g.ay);
      if (d > RALLY_REACH) continue;
      let fav = 0, best = -Infinity;
      for (let i = 0; i < cands.length; i++) {
        const s = Gov.candidateScore(p, cands[i], i);
        if (s > best) { best = s; fav = i; }
      }
      scored.push({ p, d, w: (fav === r.ci ? 1 : 0.2) * (1 - d / (RALLY_REACH * 1.6)) * (0.6 + Math.random() * 0.8) });
    }
    scored.sort((a, b) => b.w - a.w);
    const out: { p: Person; at: number; sent: boolean }[] = [];
    for (const { p } of scored) {
      if (out.length >= want) break;
      const m = walkTo(p.home, r.g);
      if (m === null || m > SETUP_BEFORE - 10) continue; // (too far to walk to)
      out.push({ p, sent: false, at: Math.max(Sim.clock, r.speech - m - 8 - Math.random() * 45) });
    }
    return out;
  },

  tickRally(r: any, now: number, dt: number) {
    // never out at night, and nothing of it outlasts its campaign
    if (now >= CURFEW || now < DAWN || r.day !== Sim.day || !Gov.campaign) { Life.rally = null; return; }
    if (r.phase === 'up' || r.phase === 'speech') {
      for (const a of r.list) {
        if (a.sent || now < a.at) continue;
        if (now > r.speech + 20) { a.sent = true; continue; } // too late to bother now
        if (free(a.p, r.speech + SPEECH_LEN + 60)) a.sent = this.send(a.p, r, 'crowd');
      }
    }
    // the candidate: out of the door in time to be on the stage at the hour (a stand-in, if not a villager)
    if (r.phase === 'up' && r.speakerId && !r.speakerSent) {
      const p = Sim.people.find((q: Person) => q.id === r.speakerId);
      if (!p) { r.speakerId = 0; r.standIn = { x: 0, y: 0, lift: 0, shown: false, phase: 'wait', kind: 'man', seed: r.ci * 37 }; }
      else {
        const at = p.state === 'in' && p.at ? p.at : p.home;
        if (r.speakerFrom !== at) { r.speakerFrom = at; r.speakerWalk = walkTo(at, r.g) ?? 60; }
        if (now >= r.speech - r.speakerWalk - 20 && freeSpeaker(p, r.speech + SPEECH_LEN + 60)) r.speakerSent = this.send(p, r, 'speaker');
      }
    }
    if (r.standIn) this.tickStandIn(r, now, dt);
    if (r.phase === 'up') {
      if (r.onStage && now >= r.speech) {
        r.phase = 'speech';
        r.start = now;
        r.nextCheer = now + 3;
        const cand = r.cand;
        if (cand.incumbent) {
          const rec = (Gov.leader && Gov.leader.built || []).slice(-3);
          Life.say(rec.length
            ? `📣 Rally: Mayor ${cand.name} points at the new ${rec.join(', ')} — "four more seasons!"`
            : `📣 Rally: Mayor ${cand.name} asks the village for more time to deliver.`);
        } else Life.say(`📣 Rally: ${cand.name} ${cand.type.emoji} promises ${cand.promise}.`);
      } else if (now >= r.speech + LATE) {
        r.phase = 'over';
        r.overAt = now;
        Life.say(`📣 ${r.name} never made it to their own rally — the crowd drifts home`);
      }
    } else if (r.phase === 'speech') {
      // applause now and then, and a big one at the end
      if (now >= r.nextCheer) { r.cheerUntil = now + 1 + Math.random() * 1.2; r.nextCheer = now + 5 + Math.random() * 9; }
      if (now >= r.start + SPEECH_LEN) { r.phase = 'over'; r.overAt = now; r.cheerUntil = now + 2.5; }
    } else if (r.phase === 'over') {
      const anyone = Sim.people.some((p: Person) => p.trip && p.trip.civic && p.trip.civic.ref === r && p.trip.civic.phase !== 'go');
      if (now >= r.overAt + DOWN_AFTER || (!anyone && !(r.standIn && r.standIn.shown) && now >= r.overAt + 25)) Life.rally = null;
    }
  },

  /** a candidate who isn't a villager arrives on foot from the street (dropped off by the campaign car) */
  tickStandIn(r: any, now: number, dt: number) {
    const si = r.standIn, v = WALK_SPEED * T * dt;
    const foot = this.stageFoot(r), deck = this.deckSpot(r);
    if (si.phase === 'wait' && r.phase === 'up' && now >= r.speech - 12) {
      const o = onGround(r.g, 0.6, 0.6);
      si.x = o.x; si.y = o.y; si.shown = true; si.phase = 'in';
    } else if (si.phase === 'in') { if (moveTo(si, foot.x, foot.y, v)) si.phase = 'climb'; }
    else if (si.phase === 'climb') {
      const there = moveTo(si, deck.x, deck.y, v * 0.6);
      si.lift = Math.min(1, si.lift + dt * 1.5);
      if (there && si.lift >= 1) { si.phase = 'at'; r.onStage = true; }
    } else if (si.phase === 'at') {
      face(si, si.x + r.fx, si.y + r.fy);
      if (r.phase === 'over' && now >= r.overAt + 6) { si.phase = 'down'; r.onStage = false; }
    } else if (si.phase === 'down') {
      const there = moveTo(si, foot.x, foot.y, v * 0.6);
      si.lift = Math.max(0, si.lift - dt * 1.5);
      if (there && si.lift <= 0) si.phase = 'out';
    } else if (si.phase === 'out') {
      const o = onGround(r.g, 0.6, 0.6);
      if (moveTo(si, o.x, o.y, v)) { si.shown = false; si.phase = 'gone'; }
    }
  },
  /** the foot of the stage's steps (px), and the speaker's place on the deck behind the lectern */
  stageFoot(r: any): Pt {
    const rx = -r.fy, ry = r.fx;
    return { x: r.x - rx * 4.6 + r.fx * 1.0, y: r.y - ry * 4.6 + r.fy * 1.0 };
  },
  deckSpot(r: any): Pt { return { x: r.x - r.fx * 0.3, y: r.y - r.fy * 0.3 }; },

  /* ---------- polling day ---------- */
  setUpPolls() {
    this.pollPlan = null;
    const c = civicCentre();
    const g = findGround(c.x, c.y);
    if (!g) return; // (the count goes ahead as ever; there's just no station to see)
    const back = onGround(g, 3.1, 0);
    const hall = World.buildings.find((b: any) => b.door.x === c.x && b.door.y === c.y && !b.ruined && !b.construction) || null;
    const vb: any = {
      day: Sim.day, g, hall, driving: new Set<Person>(), x: back.x, y: back.y, fx: -g.dx, fy: -g.dy, phase: 'setup',
      booths: [-0.21, 0, 0.21].map((j) => ({ ...onGround(g, 3.15, j), who: 0, until: 0 })),
      box: onGround(g, 2.75, 0.62),
      sign: onGround(g, 0.75, 1.15),
      slots: [] as Pt[], queue: [] as Person[], plans: new Map<number, number>(), voted: new Set<number>(),
    };
    // the queue: a line from the booths towards the street, then back up a second line beside it
    for (let k = 2.5; k >= 0.85; k -= 0.14) vb.slots.push(onGround(g, k, 0));
    for (let k = 0.85; k <= 2.4; k += 0.14) vb.slots.push(onGround(g, k, -0.48));
    Life.votingBooths = vb;
    this.planVoters(vb);
  },

  /** who votes, and when: most of the village, at a time their day allows (before work, after it, or whenever) */
  planVoters(vb: any) {
    for (const p of Gov.voters()) {
      if (Math.random() > 0.78) continue; // (some don't)
      const job = (p.events || []).find((e: any) => e.dest && e.dest === p.work);
      let at: number;
      if (job) at = job.t >= 560 && Math.random() < 0.35 ? job.t - 70 - Math.random() * 30 : job.until + 15 + Math.random() * 100;
      else at = 540 + Math.random() * 560;
      vb.plans.set(p.id, Math.max(POLLS_OPEN + 2, Math.min(POLLS_CLOSE - 30, at)));
    }
  },

  tickPolls(vb: any, now: number) {
    if (now >= CURFEW || now < DAWN || vb.day !== Sim.day || !Gov.campaign) { Life.votingBooths = null; return; }
    if (vb.phase === 'setup' && now >= POLLS_OPEN) {
      vb.phase = 'open';
      Life.say('🗳️ The polls are open until 18:00 — villagers are walking over to vote');
    }
    if (vb.phase === 'open') {
      // off to vote, when the moment comes and they're at home with the time to spare
      for (const [id, at] of vb.plans as Map<number, number>) {
        if (now < at) continue;
        const p = Sim.people.find((q: Person) => q.id === id);
        if (!p || vb.voted.has(id)) { vb.plans.delete(id); continue; }
        const m = walkTo(p.home, vb.g);
        if (m === null || now + Math.min(m, 60) > POLLS_CLOSE - 5) { vb.plans.delete(id); continue; }
        if (m <= 65) {
          // near enough to walk over
          if (free(p, now + m * 2 + 20) && this.send(p, vb, 'voter')) vb.plans.delete(id);
          else vb.plans.set(id, now + 20 + Math.random() * 40); // busy: later, then
        } else if (vb.hall && vb.hall.connected) {
          // farther: off to the town hall like any visit (by car, mostly), parked in its bays, then over on foot
          if (free(p, now + 150)) {
            Sim.startTrip(p, vb.hall, now + 150);
            if (p.state === 'walk') { vb.driving.add(p); vb.plans.delete(id); }
            else vb.plans.delete(id);
          } else vb.plans.set(id, now + 20 + Math.random() * 40);
        } else vb.plans.delete(id); // (and with no hall to park at, a postal vote)
      }
      if (now >= POLLS_CLOSE) {
        vb.phase = 'closing';
        vb.plans.clear();
        Life.say('🗳️ The polls have closed — the count begins; results at midnight');
      }
    }
    // those who drove in walk over from the hall
    for (const p of vb.driving as Set<Person>) {
      if (p.state === 'walk') continue;
      vb.driving.delete(p);
      if (p.state === 'in' && p.at === vb.hall) this.send(p, vb, 'voter');
    }
    // the next in line takes a free booth
    for (const b of vb.booths) {
      if (b.who) continue;
      const p = vb.queue[0];
      if (!p || !p.trip || !p.trip.civic || p.trip.civic.phase !== 'queue') break;
      vb.queue.shift();
      b.who = p.id;
      p.trip.civic.phase = 'booth';
      p.trip.civic.booth = b;
    }
    if (vb.phase === 'closing') {
      const busy = vb.queue.length || vb.booths.some((b: any) => b.who) ||
        Sim.people.some((p: Person) => p.trip && p.trip.civic && p.trip.civic.ref === vb && ['in', 'queue', 'booth', 'mark', 'box'].includes(p.trip.civic.phase));
      if (!busy) { vb.phase = 'done'; vb.doneAt = now; }
    }
    if (vb.phase === 'done' && now >= vb.doneAt + 20) Life.votingBooths = null; // packed away
  },

  /* ---------- the walk there and back ---------- */
  /** set `p` walking from home to the ground on foot; at the end of the pavement `step` takes over */
  send(p: Person, ev: any, role: string): boolean {
    const from = p.at || p.home;
    let out = World.walkPath(from.door.x, from.door.y, ev.g.ax, ev.g.ay);
    if (!out) return false;
    if (out.length < 2) out = [out[0], out[0]]; // (the door opens onto the very street)
    // leaving a building that isn't home: a candidate leaving work early, or a voter who parked at the hall; a car
    // they came in stays in its bay, and they walk back to it afterwards and drive home
    if (from !== p.home) from.inside = Math.max(0, from.inside - 1);
    const back = from !== p.home && (from === ev.hall || p.carHeld) ? from : null;
    p.state = 'walk';
    p.dest = p.home;
    p.until = null;
    p.returnAt = undefined;
    p.trip = { path: out, prog: 0, car: null, civic: { kind: role === 'voter' ? 'vote' : 'rally', role, phase: 'go', ref: ev, g: ev.g, back, lift: 0 } };
    Walk.plan(p, p.trip, from, ev.g.rect);
    const [sx, sy] = out[0];
    p.x = sx * T + 8; p.y = sy * T + 8;
    p.bubble = role === 'voter' ? '🗳️' : '📣';
    p.bubbleUntil = performance.now() + 2600;
    return true;
  },

  /** one tick of someone who has walked to the end of the pavement by the ground: onto the grass, whatever they
   *  came for, and back to the pavement, then home on foot */
  step(p: Person, t: any, dt: number) {
    const c = t.civic, now = Sim.clock;
    if (c.phase === 'go') {
      t.prog = t.path.length - 1;
      Walk.pose(p, t);
      c.ox = p.x; c.oy = p.y;
      c.phase = 'in';
      if (c.kind === 'rally' && c.role === 'crowd') this.takeSpot(c);
      if (c.kind === 'vote') this.joinQueue(p, c);
    }
    const ev = c.kind === 'rally' ? Life.rally : Life.votingBooths;
    // packed away (or out too late): straight back
    if ((ev !== c.ref || now >= CURFEW) && !['out', 'down'].includes(c.phase)) this.leave(p, c);
    const v = WALK_SPEED * T * (t.walk ? t.walk.pace : 1) * dt;
    c.cheer = false;
    c.speak = false;
    if (c.kind === 'rally') this.stepRally(p, c, now, v, dt);
    else this.stepVote(p, c, now, v);
    if (c.phase === 'home') this.homeward(p, c);
  },

  stepRally(p: Person, c: any, now: number, v: number, dt: number) {
    const r = c.ref;
    if (c.role === 'speaker') {
      const foot = this.stageFoot(r), deck = this.deckSpot(r);
      if (c.phase === 'in') { if (moveTo(p, foot.x, foot.y, v)) c.phase = 'climb'; }
      else if (c.phase === 'climb') {
        const there = moveTo(p, deck.x, deck.y, v * 0.6);
        c.lift = Math.min(1, c.lift + dt * 1.5);
        if (there && c.lift >= 1) { c.phase = 'at'; r.onStage = true; }
      } else if (c.phase === 'at') {
        face(p, p.x + r.fx, p.y + r.fy);
        c.speak = r.phase === 'speech';
        if (r.phase === 'over' && now >= r.overAt + 6) { c.phase = 'down'; r.onStage = false; }
      } else if (c.phase === 'down') {
        const there = moveTo(p, foot.x, foot.y, v * 0.6);
        c.lift = Math.max(0, c.lift - dt * 1.5);
        if (there && c.lift <= 0) c.phase = 'out';
      } else if (c.phase === 'out') { if (moveTo(p, c.ox, c.oy, v)) c.phase = 'home'; }
      return;
    }
    if (c.phase === 'in') { if (moveTo(p, c.spot.x, c.spot.y, v)) c.phase = 'at'; }
    else if (c.phase === 'at') {
      face(p, r.x, r.y);
      // clapping along when the crowd does (not everyone, every time)
      c.cheer = now < r.cheerUntil && ((p.seed + Math.floor(r.cheerUntil)) % 5) !== 0;
      if (c.cheer && Math.random() < dt * 0.02) { p.bubble = Math.random() < 0.5 ? '👏' : '📣'; p.bubbleUntil = performance.now() + 1600; }
      if (r.phase === 'over') {
        if (c.leaveAt === undefined) c.leaveAt = r.overAt + 1 + Math.random() * 14; // some linger, chatting
        if (now >= c.leaveAt) this.leave(p, c);
      }
    } else if (c.phase === 'out') { if (moveTo(p, c.ox, c.oy, v)) c.phase = 'home'; }
  },

  stepVote(p: Person, c: any, now: number, v: number) {
    const vb = c.ref;
    if (c.phase === 'in' || c.phase === 'queue') {
      const i = vb.queue.indexOf(p);
      if (i < 0) { this.leave(p, c); return; }
      const s = vb.slots[Math.min(i, vb.slots.length - 1)];
      if (moveTo(p, s.x, s.y, v)) { c.phase = 'queue'; face(p, vb.x, vb.y); }
    } else if (c.phase === 'booth') {
      const b = c.booth, sx = b.x + vb.fx * 1.3, sy = b.y + vb.fy * 1.3; // standing at the booth's open side
      if (moveTo(p, sx, sy, v)) { c.phase = 'mark'; c.until = now + 2 + Math.random() * 2.5; face(p, b.x, b.y); }
    } else if (c.phase === 'mark') {
      if (now >= c.until) { c.booth.who = 0; c.phase = 'box'; }
    } else if (c.phase === 'box') {
      if (moveTo(p, vb.box.x + vb.fx * 1.2, vb.box.y + vb.fy * 1.2, v)) {
        face(p, vb.box.x, vb.box.y);
        if (c.posted === undefined) c.posted = now + 0.6;
        if (now >= c.posted) {
          vb.voted.add(p.id);
          p.bubble = '🗳️'; p.bubbleUntil = performance.now() + 2200;
          this.leave(p, c);
        }
      }
    } else if (c.phase === 'out') { if (moveTo(p, c.ox, c.oy, v)) c.phase = 'home'; }
  },

  /** the front rows fill first */
  takeSpot(c: any) {
    const r = c.ref;
    let i = r.taken.indexOf(false);
    if (i < 0) i = (Math.random() * r.spots.length) | 0; // (squeezing in at the back)
    else r.taken[i] = true;
    c.spotI = i;
    c.spot = r.spots[i];
  },
  /** on the end of the queue, unless it already reaches back to the street: then home, to come back later */
  joinQueue(p: Person, c: any) {
    const vb = c.ref;
    if (vb.phase !== 'open' && vb.phase !== 'setup') { c.phase = 'out'; return; }
    if (vb.queue.length >= vb.slots.length) {
      if (vb.phase === 'open') vb.plans.set(p.id, Sim.clock + 60 + Math.random() * 60);
      p.bubble = '😩'; p.bubbleUntil = performance.now() + 2200;
      c.phase = 'out';
      return;
    }
    vb.queue.push(p);
  },
  leave(p: Person, c: any) {
    if (c.kind === 'rally' && c.spotI !== undefined && c.ref && c.ref.taken) c.ref.taken[c.spotI] = false;
    if (c.kind === 'vote' && c.ref) {
      const i = c.ref.queue.indexOf(p);
      if (i >= 0) c.ref.queue.splice(i, 1);
      if (c.booth && c.booth.who === p.id) c.booth.who = 0;
    }
    if (c.role === 'speaker' && c.lift > 0) { c.phase = 'down'; if (c.ref) c.ref.onStage = false; return; }
    c.phase = 'out';
  },
  /** back on the pavement: the walk home (or back to where they left the car, to drive home) */
  homeward(p: Person, c: any) {
    if (c.back) {
      let back = World.walkPath(c.g.ax, c.g.ay, c.back.door.x, c.back.door.y);
      if (back && back.length < 2) back = [back[0], back[0]];
      if (back) {
        p.trip = { path: back, prog: 0, car: null, keepCar: p.carHeld || null };
        Walk.plan(p, p.trip, c.g.rect, c.back);
        p.dest = c.back;
        p.until = Sim.clock + 2; // (in, and straight out to the car)
        return;
      }
    }
    const back = World.walkPath(c.g.ax, c.g.ay, p.home.door.x, p.home.door.y);
    if (!back || back.length < 2) {
      p.state = 'in'; p.at = p.home; p.trip = null; p.dest = null;
      return;
    }
    p.trip = { path: back, prog: 0, car: null };
    Walk.plan(p, p.trip, c.g.rect, p.home);
    p.dest = p.home;
  },
};

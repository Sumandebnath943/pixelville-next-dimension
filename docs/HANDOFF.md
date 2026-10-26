# PixelVille — Next Dimension · Project bible & handoff

> Written 2026-10-25 at the end of Milestone 6, for whoever picks the project up next (a new Claude session on a new account included).
> Read this first (the A–Z reference is [PROJECT_BOOK.md](PROJECT_BOOK.md)), then [DESIGN.md](DESIGN.md) (the full design) and [MILESTONES.md](MILESTONES.md) (what each milestone delivered, in detail).
> Anything learned in earlier sessions lived in that account's private memory; everything worth keeping from it is copied here.

---

## 1. What this is

**PixelVille — Next Dimension** is the 3D remake of **PixelVille V1**, a living village simulation you watched from above. V2 keeps every V1 system (families, jobs, minds, elections, crime, fires, festivals, disasters) and puts the player *on the street* as **the Founder**: walk, drive, ride, work shifts, talk to villagers, and rise into the sky (the Planner) to build, like V1.

| | |
| --- | --- |
| V2 repo | https://github.com/Sumandebnath943/pixelville-next-dimension (branch `main`) |
| V1 repo (reference only) | https://github.com/Sumandebnath943/pixelville, live at pixelville.houseofnamus.com |
| Planned V2 host | pixelville.next.houseofnamus.com (Vercel; not deployed yet) |
| Owner | Suman Debnath |

**Never modify the V1 repo.** It is the behavioural reference.

### Status (2026-10-26)
- **Milestone 8 (the owner's 33-point polish list)** is built on branch `milestone-8` (traffic lanes, bends, keep-right routing, parking, tickets, hits, the night timetable; pavements for walkers; site crews; a steady camera; bloom, sunrise, headlamps, the Planner at night, water; curved shores and rails; pines and firs, light forests; the peak and its trail with bike hire; solid street furniture; Rockefeller-style Christmas; the logo, loading, landing and controls screens). Details in MILESTONES.md. 130 tests pass. Not yet merged or pushed.
- **Key art**: drop the owner's image at `public/art/keyart.jpg` (1920×1080) and the loading screen uses it.
- Milestones 1, 1.5, 2 (2a–2f), 3, 4, 5 and 6 are done, merged into `main` and pushed (`3f529f9`).
- **Milestone 7 (launch polish) is built**, merged into `main` and pushed: Milestone 6 fixes, rebindable controls and gamepad menus, accessibility, the first-day guide, phones, performance, balance, chat guards, launch prep (details in MILESTONES.md).
- 118 tests pass (`npm test`), typecheck clean (`npm run typecheck`), lint has warnings only (`any` in ported code).
- **Not yet deployed**: the Vercel project, the Groq key in Vercel and the domain's DNS need the owner (step by step in [LAUNCH.md](LAUNCH.md)).

---

## 2. Decisions already made (don't reopen without the owner)

Settled 2026-10-23, before any code:
- **Browser game: TypeScript (strict) + Vite + Three.js.** Rapier was planned for physics but isn't used: V1's world is a tile grid of rectangles, so a light custom collision does the job.
- **Single-player first**, structured so co-op can come later (the sim is headless and could move to a worker or server).
- **Player = the Founder**: a god with an avatar. Free building through the aerial Planner, first/third-person roaming, a light wallet (jobs pay; spend on food, tickets, cars, flights, fines). No needs, no ageing for the Founder.
- **Time:** a day ≈ 24 real minutes at 1× (1 game minute per real second); villagers age a year per in-game week. The street runs at 1× only; fast-forward is for the Planner.
- **Map:** 256 × 256 tiles (8 m a tile, so 2 km across), plus off-map trips to six named cities. V1 saves import into the centre.
- **Look: semi-realistic PBR**, chosen over voxel or low-poly after the owner called Milestone 1's flat-shaded look "very childish" (see §3).
- **Interiors:** 12 room templates re-themed across ~81 building types.
- **Villager AI chat via Groq** (free tier), grounded in each villager's mind, the world and their memories of the Founder. Villagers know the player as the mysterious "Founder" (in-world, never fourth-wall). The key stays server-side (`api/chat.ts`, gitignored `.env.local`, `GROQ_MODEL` to pick a model); template dialogue is the fallback.
- **Mature V1 themes stay**, plus GTA-style player crime: 1–5 stars, police from real stations, busted = fine + a night in the cells + impound; witnesses remember. **No killing villagers**: injury → hospital.
- **Founder's Lodge** is the player's home; building rotation exists; Planner is locked while wanted; the Founder can't run for mayor.
- **Controls:** keyboard + mouse, gamepad and touch from the same action map.
- **Money is never conjured:** every dollar comes from somewhere real (a household's funds, a business's till, the village fund `Gov.treasury`). New features must follow this.

---

## 3. The owner: preferences and how to work with them

- **Hardware:** an Intel UHD (Tiger Lake) laptop, 1366×768 screen, ~12 GB RAM, 4 logical cores. Visuals are judged on this machine, on the **medium** quality tier. The desktop app's Browser pane runs on the same machine, so its numbers are the owner's numbers.
- **Visual bar: maximum realism and detail.** Procedural box models don't count as finished art. The owner's original 20-point wish list: richer graphics, lush realistic trees and ground, realistic roads and water, a sky that isn't a flat wall, detailed buildings, people and cars that look real (not "inflated 2D"), good eye-level views; real water physics, wind in trees, traffic that yields, realistic walking/driving; realistic snow and effects; weather and seasons blending in; a sea and a river; a tall beautiful Christmas tree in a Rockefeller-style plaza and vivid festival lights; a V2-specific HUD; nicer thought bubbles (one at a time). Most are done; **real rigged people and car models are still code-built stand-ins** (asset licensing is undecided: CC0-only vs CC-BY/Mixamo vs paid — ask before adding assets).
- **Show a small vertical slice before rolling a new look out everywhere.**
- **Raise new feature ideas before building them**; build to the agreed design otherwise.
- **Workflow they've used:** each milestone on its own branch (`milestone-N`), merged into `main` and pushed when they ask (they usually ask "merge and push, then start the next milestone"). Commit only when asked or at milestone ends; push only when asked.
- They like being told plainly what was verified in the game vs only in tests, and what's left.
- Commit attribution line used so far: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (use whatever the new session's instructions say).

---

## 4. Running it

```bash
npm install
npm run dev          # Vite dev server (http://localhost:5173)
npm test             # Vitest, headless sim + player-logic tests (~10 s)
npm run typecheck    # tsc --noEmit
npm run build        # typecheck + production build
npx vite preview --port 4173 --strictPort   # serve the production build
```
- `.claude/launch.json` has two configs: **`pixelville-nd`** (dev server, port 5173; moves to 5174 if taken) and **`pixelville-nd-build`** (production preview on 4173).
- **AI chat:** `.env.local` (gitignored) holds `GROQ_API_KEY=` and optionally `GROQ_MODEL=`. The owner's local file has a key — never print it. `GET /api/chat` reports only whether a key is set. Chat requests send real villager context to Groq; keep test calls few. In dev, the proxy is served by the Vite config; in production by the Vercel function `api/chat.ts`.
- **Debug handle:** `window.PV` exposes `tour, padNav, applyAccess, Subs, Settings, Game, Sim, World, stage, founder, planner, actors, buildings, terrain, Input, gps, errands, phone, motoring, showroom, wanted, Life, Rep, streetLife, panels, photo, enterPhoto, leavePhoto, indoors, goIn, goOut, counter, dialogue, chatClient, Health, Power, Supply, Edu, Gateways, transit, travel, openDepartures, shifts, JOBS, Weather`. (`News` is not on it: read `#tv-headline` instead.)

---

## 5. Architecture

```
src/
  sim/        headless simulation: no Three.js, no DOM, no player code. Positions in V1 px (16 px a tile).
              world (grid, roads, rails, buildings, saves), agents (Sim: people, schedules, wages),
              life (Life: transit, fires, police, crime, incidents, planes, the press…), gov, mind, reputation,
              health, power, education, supply, gateways, traffic, calamity, festivals, weather, news, tasks, game
  render/     the 3D layers: stage (renderer, sky, post), terrain, buildings (procedural builders → merged chunks),
              actors (people/vehicles/props, near = full models, far = instanced pools), interior, kit, models
  gfx/        the look: PBR textures (workers + IndexedDB cache), surface shader (wet/snow), sky, water, vegetation,
              person (skinned), car (extruded profiles), fire, precipitation, festive
  player/     the Founder (founder.ts), Planner, wallet, fleet, motoring, wanted, errands, street reactions, photo,
              indoors, gps, transit (riding), travel (trips), tickets, shifts (Milestone 6)
  jobs/       the 13 job loops (Milestone 6): common.ts, emergency.ts, driving.ts, rails.ts, town.ts
  ui/         hud, panels (cards, modals), phone (apps), dialogue, counter, showroom, departures, travelui,
              photopanel, shiftpanel, touch, tour (the first-day guide), access (subtitles, interface size, colour vision)
  ai/         chat client, context builder, templates, effects, memory
  interiors/  plan.ts: room layouts as plain data (tested without WebGL)
  audio/, input/ (one action map for all devices, rebindable; padnav = the gamepad through menus), save/ (IndexedDB slots + autosave)
public/       manifest.webmanifest + icon.svg (installable on phones)
api/          chat.ts (Vercel function) + _chat.ts (the Groq proxy, persona rules, limits)
tests/        Vitest: one file per system; tests/town.ts builds a small finished town (build(), town(), run(), until())
docs/         DESIGN.md, MILESTONES.md, HANDOFF.md (this file)
slice.html + src/slice/   the "look lab" vertical slice (Milestone 1.5)
```

**Frame loop** (`src/main.ts`): input → overlays (busted/wasted curtain; travel or the pilot's journey screen) → photo mode → global keys → `Game.tick` (the sim) → indoors or street (Founder, transit, travel, interactions) → `shifts.update` → Planner → errands, motoring, wanted, street life, GPS → cameras → render → shift marker → HUD (every 400 ms) → phone.

**Key patterns**
- **Sim ↔ client hooks**, set by the client, never imported by the sim: `Game.founderHooks` (the Founder in saves), `Traffic.guests` (the Founder in traffic), `Traffic.onHonk`, `Life.onEvent` (toasts), **`Life.claim`** (Milestone 6: a shift takes a fire / police / ambulance / power call before the village's crews; returns true if taken), `Life.runwayHeld`, `Supply.founderLoad`.
- **V1 code** in `src/sim` was ported verbatim; V2 changes inside it are marked `V2:` / `V2 (Milestone N):`. Since the typing pass (2026-10-26) nothing is `@ts-nocheck`: the shared entity types live in `src/sim/types.ts` (`Building`, `Person`, `Car`, `XY`, each with an open index for the long tail) and every parameter is typed. The V1 module objects themselves (`World`, `Sim`, `Life`, `Gov`, `Calamity`, `Festivals`, `Weather`, `Mind`, `Tasks`, `Settings`) are still declared `any`: typing them is the next level.
- **Sounds the sim asks for** carry where they happen: `Snd.siren(midPx(b))` (V1 px). The audio engine (`Snd.at` in `src/audio/sounds.ts`) plays them quieter with distance and panned to their side; the listener is set each frame from the camera (`Snd.listen`).
- **Interactions:** `E` = interact/use/talk, `F` = vehicle (and departures at transit buildings). Modules return `{ text, act }` prompt lines; `main.ts` decides priority.
- **Naming a control in text (Milestone 7):** never write `E` or `F` into a prompt or toast: write `{interact}`, `{vehicle}`, `{forward}`, `{climb}`… and it's filled in (`keys()` in `src/input/input.ts`) with the player's own key, the pad's button or the touch button. Gameplay reads `Input.held(action)`, `Input.move()`, `Input.rise()`, never raw key codes.
- **Toasts:** `hud.toast(m, at?, fromSim?)`; "personal" toasts (the Founder's own business) stay out of the village news log.
- **Rendering new things:** reuse the instanced pools (`actors.vehicle(type…)`, `actors.prop(k…)`, `actors.person(...)`) and existing materials. **Never introduce a new shader that first compiles on frame 1** (see §7).
- **Saves:** `Game.buildSaveString()` / `Game.performLoad()`; the Founder's part is `FounderSave` (wallet, ledger, fleet, bag, jobs record…). Transient state (trips, shifts) is not saved; a load starts the Founder on the street, off shift.

---

## 6. What each milestone delivered (short; details in MILESTONES.md)

| # | Done | Headline |
| --- | --- | --- |
| 1 | 2026-10-23 | All V1 systems in 3D; walk, drive, build from the sky; saves incl. V1 import |
| 1.5 | 2026-10-24 | The semi-realistic look across the game; V2 HUD; traffic that gives way; camera collision; fast loading |
| 2 | 2026-10-24 | 2a traffic sees the Founder · 2b wallet, phone, GPS, errands · 2c owning vehicles · 2d crime & wanted · 2e reputation · 2f photo mode |
| 3 | 2026-10-24 | Interiors (12 templates), template dialogue, Groq AI chat, phone Contacts |
| 4 | 2026-10-24 | Health & ambulances, power & blackouts, education, supply chain, rebalance |
| 5 | 2026-10-25 | Riding buses/trains/ferry/cabs/heli tours, six off-map cities, flights, visitors & newcomers through gateways |
| 6 | 2026-10-25 | **13 playable job shifts** + the 48×15 airfield |
| 7 | 2026-10-25 | **Launch polish**: rebindable keys, gamepad menus, subtitles and accessibility, the first-day guide, phones, balance, chat guards (deploy pending) |

### Milestone 6 in a page (the newest code)
- **`src/player/shifts.ts`** — `JOBS` table (title, workplaces, lent vehicle + handling, hourly pay, public or business, max hours, factory), `Shifts` manager: `placesFor`, `offers(b)`, `whyNot`, `start(id, b)`, `go(id, b?)` (phone booking: GPS to the workplace, starts at the door), `end()` (pays: hourly × hours + task pay, × (0.7 + 0.1 × stars); public services from `Gov.treasury`, which **owes** what it can't pay and settles when taxes arrive; businesses from their till, as far as it goes), `update`, `interaction`, `carrying` (train/plane cab), `overlay/frame` (pilot's journey screen), `draw`, `panel()`, `listing()`, `record` (saved in `FounderSave.jobs`).
- **Work vehicles:** `Founder.takeWork(v, x, z, yaw)` / `dropWork()`; `Vehicle.work = { type, spec }`; handling via `specOf(v)` in `fleet.ts`; police/taxi are full car models, the rest are drawn by `shifts.draw` with the instanced models (`fire, ambulance, bus, truck, van, tractor`). Blue lights set `founder.exempt` (no speeding/red-light offences).
- **Jobs** (`src/jobs/`): Fire (claim → hose on foot facing the flames; inspections set `b.inspected`), Police (dispute/crash/burglary claims; beats raise `Life.cooldown`), Medic (treat → `state 'amb'` → `Health.deliver`; home visits), Taxi (real villagers: `state 'hail'` at the kerb → `'cab'` → a 2-point trip so the sim's own arrival runs; meter + tip to the rank's till; per-person 3 h cooldown), Bus (serves `Life.stopQueues`), Truck (`Supply` needs/sources; `Supply.founderLoad` reserves the order), Train (`tr.driver = true`, the sim skips it; platform calls, missed stops, buffers), Pilot (flight model; edge of map → journey screen → city card → approach; auto-flare under 6 m; touchdown zone on the runway), Power (claim faults → 3-stage repair at a pole; substation servicing → `Power.serviced`), Build (pallet → scaffold `Supply.build`; materials runs by van), Shop (indoors: orders from the real occupants, make at the counter, serve; `Mind.enjoy`), Reporter (assignments from live incidents and features; film on foot; file at the TV station → `News.breaking`; shortage stories raise `Supply.allow`), Farm (drive the rows; harvest → yard food; sow/plough → `b.tended` +30 % yield).
- **Airfield:** `Life.airfield(a)` → `{ ry, rx0, rx1, ty, stands[4] }` in metres: 372 m runway on the south edge, taxiway, four stands 45 m apart. Used by `Life.tickPlanes` (one plane on the runway at a time), `actors.collectSky` (parked planes), `travel.ts` and the pilot. Old saves: an airport that no longer fits moves to the nearest spot that does (`world.ts` restore).
- **UI:** shift card (`#shift`, `src/ui/shiftpanel.ts`) top left, the floating marker (`#shift-mark`), the phone's **Jobs** app, "Start a shift / Clock off" on workplace cards and counters.
- Tests: `tests/shifts.test.ts` (18).

---

## 7. Testing playbook (hard-won)

**Headless first:** most behaviour is covered by Vitest using `tests/town.ts` and stub Founders (see `tests/shifts.test.ts`, `travel.test.ts`). Every sim change should ship with a test.

**In the browser (the desktop app's Browser pane):**
- **WebGL pitfall:** if shader programs first compile on frame 1 (e.g. `scene.environment` unset before `compileAsync`, or compiled against the screen instead of the composer's HDR target), the Intel GPU stalls 18+ s, the watchdog kills the context, and **Chromium then blocks WebGL for that origin**. Test on fresh `*.localhost` subdomains (`m6b.localhost:5173`, `t5.localhost:5174`…); `127.0.0.1` is refused. Keep per-material strengths as uniforms, not `#define`s.
- **Saves are per origin** (IndexedDB), including the port. A fresh origin starts an empty map, and **an empty map isn't autosaved**.
- **Editing a `.ts` file reloads the page** (Vite) and loses any unsaved scripted setup — finish a browser check before editing, or save first (below). Editing `index.html` also reloads.
- **When the pane is hidden, `requestAnimationFrame` stops** and timers throttle to ~1 s: villagers stop moving and scripted waits stall. Take a screenshot to keep it visible. Screenshots can lag a few seconds behind scripted changes; check state in JS.
- `Game.catchUp(n)` advances the clock and the daily logic but **does not walk villagers**; they move with frames.
- The pane's fps counter lies (throttled). For timing, pause and step (`LOOK.dbg.paused`, `LOOK.step()` in the slice).
- After a hot update, `await import('/src/x.ts')` may give a second, empty module copy; find the live URL with `performance.getEntriesByType('resource')…` or reload first. `/src/save/store.ts` (rarely edited) is safe to import.
- Keep each `javascript_tool` script under ~40 s (it times out at 45 s).
- **Exceptions in a per-frame update stop the whole frame loop** (the scene freezes while state looks fine): read console errors first.
- Setting `Weather.kind` outside `clear/clouds/rain/heavy/snow` throws in the HUD and stops the loop.

**Build a test town on a fresh origin and keep it** (paste into the page; then reloads keep it):
```js
const { Game, World, Sim, panels, Life } = PV; panels.closeAll();
const L = Game.lodge();
function build(key, cx, cy, done = true) {
  for (let r = 0; r < 40; r++) for (let t = 0; t < 32; t++) {
    const x = Math.round(cx + Math.cos(t) * r), y = Math.round(cy + Math.sin(t) * r);
    for (let f = 0; f < 4; f++) { if (!World.canPlace(key, x, y, f)) continue;
      const b = World.placeBuilding(key, x, y, done, f); if (!b) continue;
      if (done) Sim.onBuildingAdded(b); Game.afterMapEdit(); return b; } }
  return null;
}
const c = { x: L.x, y: L.y };
for (let i = 0; i < 8; i++) build('house', c.x + 6 + i * 4, c.y + 6);
for (let i = 0; i < 4; i++) build('house', c.x - 30 + i * 4, c.y - 4);
['fire',-8,8,'police',10,-8,'hospital',-14,-6,'taxistand',4,12,'cafe',-4,16,'bakery',20,14,'shop',26,-4,
 'warehouse',34,10,'farm',-24,18,'powerplant',40,-14,'tvstation',-20,-18,'busstop',-2,4,'busstop',30,4]
  .reduce((a, v, i, arr) => (i % 3 === 0 && build(v, c.x + arr[i + 1], c.y + arr[i + 2]), a), 0);
build('cafe', c.x + 14, c.y + 20, false);                 // a building site
build('airport', c.x + 10, c.y - 50);
const s1 = build('trainstation', c.x - 30, c.y - 30), s2 = build('trainstation', c.x + 30, c.y - 28);
const sides = (st) => [[st.x + st.w, st.y + 1], [st.x - 1, st.y + 1], [st.x + 1, st.y + st.h], [st.x + 1, st.y - 1]];
outer: for (const p of sides(s1)) for (const q of sides(s2)) if (World.connectRail(p[0], p[1], q[0], q[1]) >= 0) break outer;
Game.afterMapEdit(); Life.busT = 0; Life.busSig = ''; Life.trainT = 0; Life.trainSig = '';
const store = await import('/src/save/store.ts'); await store.put(store.AUTO, Game.buildSaveString());
```
**Milestone 7 test tricks:** a stand-in gamepad: `navigator.getGamepads = () => [pad]` with `pad = { connected: true, mapping: 'standard', axes: [0,0,0,0], buttons: [17 × { pressed, value }] }`; nudge an axis once so the device switches to "pad", then hold a button for two frames. A phone: the pane's `mobile` preset emulates touch (reload after switching); a landscape phone is a custom 812×375 plus `document.body.classList.add('touch')`. The guide: `PV.tour.start()` / `.finish()`; `Settings.set('tourDone', false)` brings it back on the next load. Subtitles: `PV.Subs.say(who, line)`, `PV.Subs.sound(kind, text, 0)`. Shader programs: `PV.stage.renderer.info.programs.length` should not grow during play (65 at boot on medium).

**Handy calls by system** — shifts: `PV.shifts.start('fire', b)`, `.end('', true)`, `.cur.job`, `.controls = () => ({gas, brake, steer, pitch})` to script the train/plane, `.panel()`, `.listing()`. Crime: `PV.wanted.raise(n, why, true)`, `wanted.onBusted = () => {}` before visual checks. Rep: `PV.Rep.feel(p, delta, text, gist)`. Interiors: `PV.goIn(b)`, `PV.goOut()`, `PV.indoors`. Chat: `PV.dialogue.start(p)`. Health: `PV.Health.injure(p, sev, cause, {x,y})`. Power: `PV.Power.fault(d, cause)`, `districtOfB(b)`. Supply: `PV.Supply.report()`, `dispatch()`. Transit/trips: `PV.transit.wait(kind, at, to)`, `callCab()`, `PV.travel.start(city, mode, gate, edge)`, `PV.openDepartures(b)`. Photo: `PV.enterPhoto()`; stub `HTMLAnchorElement.prototype.click` before saving a photo (it downloads a file). Planner camera: `planner.enter(pos)`, then `planner.focus(x, z)`, `dist`, `pitch`, `yaw`. At night set `Sim.clock = 760` for a daylight look.

---

## 8. Known issues and polish backlog

- **Real rigged people and cars** (still code-built stand-ins) — waiting on the owner's asset-licensing decision.
- **The deploy** ([LAUNCH.md](LAUNCH.md)): the owner's Vercel project, `GROQ_API_KEY` in its settings, the DNS record.
- Not checked on real hardware: a gamepad (tested with a scripted stand-in pad), a real phone (tested in the pane's phone emulation at 812×375 and 375×812), iPhone full screen (Safari has no element full screen on iPhone; the Home Screen app is full screen).
- Chat limits are per server instance (Vercel runs several): a shared store (Vercel KV) would make the daily cap exact.
- With a very large interface size on a narrow window, the hint and the news can overlap.
- The airport's runway is at game scale (372 m), not real scale; the pilot's auto-flare and touchdown zone are tuned to it.
- Taxi fares depend on villagers' schedules: midday in a town where everyone works can be quiet (fares come from people leaving work within 40 min, leaving venues, or at home 09:00–21:30).
- The V1 module objects are still typed `any` (see §5); lint warnings for `any` throughout.
- Ambience (wind, rain, crickets, birdsong) is all around you rather than positional; interiors don't muffle the street yet. Gamepad mapping untested on hardware.
- `health.test.ts`'s ambulance test failed once under the full suite: it assumed no other ambulance would be out after the delivery, which another villager's accident can break. It now checks only its own patient (2026-10-26); watch for any other test that leans on a quiet village.
- Nothing is deployed; the Vercel project, preview deploys and the domain are still to set up.

---

## 9. What's next

- **Launch** (the owner's steps in [LAUNCH.md](LAUNCH.md)), then play-test on a real phone and a real gamepad.
- **The asset-licensing decision** (CC0-only, CC-BY/Mixamo, or paid) for real rigged people and cars; they'll change the performance budgets (today: ~9 ms GPU a frame at medium on the Intel laptop).
- Typing the V1 module objects (the entities are typed), muffled sound indoors.
- New feature ideas go to the owner first (§3).

---

## 10. Git and handoff checklist for a new session

1. `git pull` on `main` (latest: Milestone 7).
2. `npm install && npm test && npm run typecheck` — expect 118 passing tests.
3. Start the dev server from `.claude/launch.json` (`pixelville-nd`), open a **fresh** `*.localhost` origin, build the test town (§7).
4. Branch `milestone-7` for new work; merge and push when the owner asks.
5. Update `docs/MILESTONES.md` (and this file's status) at the end of each milestone.

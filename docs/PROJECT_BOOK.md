# The PixelVille — Next Dimension Project Book

> The A–Z of the project: every system, place, rule, file and idea, in one alphabetical book.
> For getting started, read [HANDOFF.md](HANDOFF.md); for the design, [DESIGN.md](DESIGN.md); for what each milestone delivered, [MILESTONES.md](MILESTONES.md).
> State as of 2026-10-25, Milestone 7 built and merged into `main` (the deploy waits on the owner).

---

## How to read this book
Entries are alphabetical. **Bold** words inside an entry are entries of their own. File paths are relative to the repo root. "M3" means Milestone 3, and so on.

---

## A

**Accessibility** — **M7**, Settings → Accessibility (`src/ui/access.ts`): interface size, **Subtitles** (street speech, and optionally sound captions), colour vision (red–green or blue–yellow safe: the `--ok`/`--bad` colours swap; struggling stats are underlined too), camera shake, first-person head bob, reduce motion. With the field of view (Graphics) these are the motion-sickness options. Keys are rebindable (**Controls**).

**Actors** — `src/render/actors.ts`. Draws everything that moves: villagers (the nearest 32 are skinned **Person** models, the rest instanced), vehicles (the nearest 22 cars are full **Car** models, the rest instanced from `src/render/models.ts`), props, fires, sparks, bubbles, traffic-signal lenses, parked planes. The client adds its own things each frame via `actors.extra` (the dog, the wanted level's units, the sightseeing heli, shift vehicles). Public helpers: `vehicle()`, `prop()`, `person()`, `spray()`.

**Afterload / afterMapEdit** — `Game.afterMapEdit()` must be called after placing or removing buildings by script: it refreshes connections, roads and derived maps.

**AI chat** — Villager conversations through Groq (**M3**). `api/_chat.ts` is the proxy (persona rules, rate limits: 12/min and 400/day per address, retired-model fallback, broken-JSON recovery); `api/chat.ts` is the Vercel function; the dev server serves it from `vite.config.ts`. Client: `src/ai/client.ts` (one request in flight, 8/min, 150/session, 12 s timeout, falls back to **Templates**). Context: `src/ai/context.ts`. Effects (opinion, mood, a memory, a place) are clamped in `src/ai/effects.ts`. The key lives in `.env.local` (`GROQ_API_KEY`, optional `GROQ_MODEL`); never print it.

**Airfield / Airport** — 48×15 tiles since M6 (was 13×8). `Life.airfield(a)` gives, in metres: the runway along the south edge (`ry`, `rx0`→`rx1`, 372 m), the taxiway (`ty`), and four **stands** 45 m apart (airliners span 30 m). Only one plane uses the runway at a time; up to three airliners stand parked; the fourth stand is the Founder's. Old saves with the small airport move it to the nearest spot it fits. Always faces south (`normFacing`). See **Flights**, **Pilot**.

**Alerts** — The street HUD's one-line warning (power cut here, rolling blackouts, a shortage, flu season); click opens the **Mayor's report**. `villageAlert()` in `src/main.ts`.

**Ambulance** — See **Health**. Also the **Paramedic** shift's vehicle.

**Architecture** — Headless **Sim** (`src/sim`, no Three.js/DOM) → 3D layers (`src/render`, `src/gfx`) → the player (`src/player`, `src/jobs`) → UI (`src/ui`). The sim talks to the client only through hooks the client sets (see **Hooks**).

**Arrest** — The Founder can be arrested (**Busted**) or, on a **Police** shift, arrest a burglar (`Life.resolve(true)`).

**Assets** — Everything is procedural (no downloaded models or textures). Real rigged people and cars are waiting on the owner's licensing decision (CC0-only vs CC-BY/Mixamo vs paid). Any assets must be listed in `public/assets/LICENSES.md`.

**Auto resolution** — M7: Settings → Graphics → Resolution "auto" (`Stage.autoRes`) drops the world's render resolution 10% at a time while frames run under ~30 fps, back up when there's room, never below 70%; or a fixed 100/85/70/55%. A 30 fps cap saves battery.

**Autosave** — Every 2 or 5 minutes (setting), and when the tab is hidden; written to IndexedDB slot `AUTO` (`src/save/store.ts`). An empty map is not autosaved. Saves are per browser origin, port included.

---

## B

**Bag** — What the Founder carries (food, tickets, souvenirs), up to 16 items, saved. Shown in the phone's **Wallet** app.

**Blackouts** — See **Power**. Districts go dark (windows, signs, lamps, traffic lights) via `src/render/powermap.ts`.

**Booking a shift** — The phone's Jobs app routes you to the workplace; the shift starts when you reach the door (`shifts.go()`, `shifts.booked`).

**Buildings (catalog)** — `src/sim/catalog.ts` (`CAT`): 97 V1 entries — 87 placeable building types (5 fast-food chains among them), 2 house upgrade levels and 8 tools/terrain — with footprint, jobs, opening hours, visit type and residents. Rendered by procedural builders in `src/render/buildings.ts` using the architecture **Kit**; finished buildings merge per 16×16-tile chunk.

**Building sites** — `b.construction` = minutes of work left, `b.conTotal` the total. Sites eat materials (`Supply.build`); a site without materials stalls. The **Construction worker** shift speeds them up.

**Bus** — The village line chains bus stops by proximity (`Life.tickBuses`), up to 3 buses, queues at stops (`Life.stopQueues`, anonymous riders). Ride it (**M5**), or drive it on the **Bus driver** shift (**M6**).

**Busted** — Caught while wanted: a fine by stars, impound if driving your own car, then a night in the cells (or five hours by day) behind the **Curtain**. Ends any shift.

---

## C

**Calamities** — `src/sim/calamity.ts`: drought, flood, earthquake, tornado (V1), plus their V2 effects on power and health.

**Camera** — Street third-person orbit with collision against building volumes (exact ray-box tests, 0.45 m radius), first-person toggle (`V`), chase and cockpit cameras when driving (further back for big work vehicles), a follow camera when riding (`founder.passengerAt`), the Planner's aerial camera, the interior's own camera, and **Photo mode**'s free camera.

**Career** — The Founder's shift record (`shifts.record`): shifts by job, hours, earnings, best stars, and wages the village fund still owes. Saved as `FounderSave.jobs`.

**Catch-up** — `Game.catchUp(minutes)` advances the clock and daily logic (used behind curtains, journeys and when the tab is hidden). It does not walk villagers.

**Christmas** — A 24 m spruce in a plaza, 1,400 lights, a star, garlands, a rink with skaters, eave lights, markets (`src/gfx/festive.ts`, **Festivals**). A setting locks fast-forward over Christmas.

**Cities** — Six off-map destinations (`src/sim/gateways.ts`): Westmere (road/rail), Northbridge (road/rail), Avalon City (rail/air/air taxi), Harbourton (rail/sea), Saltmarsh Isle (sea), Solano (air). Each has a blurb, sights and a souvenir.

**Claims** — `Life.claim(kind, scene)`: while on an emergency/power shift, fires, police calls, ambulance calls and power faults go to the Founder first. Not reached in time (40–90 game minutes) → released to the village's own crews.

**Clock** — `Sim.clock` in game minutes (0–1440), `Sim.day`; 1 game minute per real second at 1×. Day 0 mod 7 is Sunday. Seasons: 0 spring, 1 summer, 2 autumn, 3 winter; a year is 28 days.

**Collision** — The Founder's custom circle-vs-box collision (`founder.collide`) against building solids, tree trunks, open water and the map edge. No Rapier.

**Colour vision** — See **Accessibility**.

**Commits** — One commit per milestone (plus fixes), on branch `milestone-N`, fast-forwarded into `main` when the owner asks.

**Controls** — `src/input/input.ts` (M7): an action map with default keys (`DEFAULT_KEYS`), rebound in Settings → Controls and kept in this browser (`Settings.keys`); a key taken from another action leaves it without one. Text names controls with `{action}` tokens filled in by `keys()` for the device in use (keyboard, pad, touch). See **Gamepad**, **Input**.

**Construction worker** — M6 job (any building site): carry loads from the pallet to the scaffold (each lays 18 minutes of work), fetch materials by van when the pallet is bare. Paid by the village fund.

**Contacts** — The phone app listing villagers you've talked to; call them or find them (**M3**).

**Counter** — Inside a shop: buy the place's own wares (`WARES` in `src/interiors/plan.ts`) at the staff's price for you; also the place for a shop shift's orders. `src/ui/counter.ts`.

**Crime** — V1 burglaries at night (more with unemployment), disputes and crashes by day (`Life.tickCrime`, `tickIncidents`); the Founder's own crimes raise the **Wanted level**.

**Curtain** — The full-screen black card for Busted / Wasted while hours pass.

---

## D

**Debug handle** — `window.PV` (see HANDOFF §4 for the full list).

**Delivery driver** — M6 job (warehouse or a factory/works): load at a yard with stock, unload at a shop running low or a site waiting for materials (`Supply.unload`). The order is reserved with `Supply.founderLoad`.

**Departures board** — `F` at a stop, station, dock, rank, airport or heliport: what leaves from here (`src/ui/departures.ts`).

**Design doc** — `docs/DESIGN.md`: the full design (§ numbers referenced throughout the code).

**Dialogue** — `src/ui/dialogue.ts`: talk to anyone with `E` (in the street they stop; indoors they turn to you); topics, a text box, AI or template answers.

**Districts** — 32×32-tile squares (8×8 grid) used by **Power**.

**Dog (lost)** — An **Errand**: a villager's dog slips out; find it, call it (`E`), walk it home for a thank-you from the household.

---

## E

**Economy** — V1 wages per day by workplace (`WAGES`), prices per visit (`PRICES`), household funds, savings, taxes into `Gov.treasury`, business funds and failure, loans, the stock exchange. The Founder's money follows the **Money rule**.

**Education** — `src/sim/education.ts`: none / school certificate / degree; graduate-only posts pay 45% more; skilled families move in for posts nobody can fill.

**Electrician** — M6 job (power plant): power cuts come to you; at the pole, a three-stage repair; between faults, service substations (65% less storm damage there for a week).

**Emergency services** — Fire brigade, police, ambulances: the village's own crews, or the Founder on a shift (**Claims**).

**Errands** — `src/player/errands.ts`: the lost dog, helping at a fire or crash (a thank-you from the fund; not while on an emergency shift), scratch cards.

**Events (sim)** — `emit`/`on` in `src/sim/core.ts` (toasts, breaking news, offences, sounds).

---

## F

**Facing** — A building's door side (0 south, 1 east, 2 north, 3 west); east/west swap the footprint. The airport is always 0.

**Farmer** — M6 job (farm): drive the tractor along each crop row: harvest (summer/autumn: food to the yard), sow (spring) or plough (winter) for +30% yield for a week (`b.tended`).

**Festivals** — Christmas, Diwali, Easter, New Year fireworks (`src/sim/festivals.ts`).

**First-day guide** — See **Guide**.

**Fines** — Paid to the village fund; what the wallet can't cover is owed (`fleet.owed`) and taken as money comes in.

**Fire** — Buildings ignite at random (factories ×3, restaurants/bakeries ×2; ×0.35 if inspected this week), burn for 5–7 game hours, spread to neighbours unless a hose is on them, and are saved by an engine dousing or a bucket brigade; otherwise they become ruins and get rebuilt.

**Firefighter** — M6 job (fire station): every fire comes to you; on foot, face the flames near the building and the hose does the rest; fire safety inspections between calls.

**Fleet** — The Founder's vehicles (`src/player/fleet.ts`): models, paints, fuel, damage, where each is (out, Lodge garage, impound). Work vehicles are not in the fleet.

**Flights** — Passenger flights (**M5**) to Avalon City and Solano every three hours 06:30–21:30, with check-in and the gate; or fly them yourself as **Pilot**.

**Founder** — The player: `src/player/founder.ts`. A violet coat, gold scarf, wide-brimmed hat, and a faint golden ring at the feet. Walks, runs, jumps, drives (arcade handling per vehicle **Spec**), rides, works.

**Founder's Lodge** — The player's home and garage; the drive is always legal parking.

**Frame loop** — `frame()` in `src/main.ts` (order in HANDOFF §5).

---

## G

**Gamepad** — Standard layout: sticks move and look, A jump, B back, X use, Y vehicle, triggers drive, LB photo mode, RB turn the door, View phone, Menu Planner, R3 camera, L3 run, d-pad up the task book. In any menu the d-pad (or left stick) moves a highlight and A presses (`src/input/padnav.ts`, M7). In the Planner a ring at the centre is the cursor: A places or picks, LB the next palette tab, X pauses. Tested with a scripted pad, not yet on hardware.

**Game** — `src/sim/game.ts`: boot, new maps and scenarios, ticking at the chosen speed, undo, save/load (`buildSaveString`, `performLoad`), `founderHooks`.

**Gateways** — `src/sim/gateways.ts`: the national railway (a branch line from the village station to the map edge) and the **Intercity Express**, visitors arriving by train, plane and ferry, newcomers arriving, and the Founder's trips (`Gateways.away`).

**Guide (the first day)** — `src/ui/tour.ts` (M7): nine steps that found the village with a new player (look around, rise, place a house, the first family, work, come down, meet the neighbours, the phone, off you go), ringing what to press, worded for the device, advancing when done, resuming after a reload. Shown once per browser (`Settings.tourDone`); "Skip the guide"; Settings → Village → "Show me around again". Replaced the help page on first load.

**Gov** — `src/sim/gov.ts`: the mayor, elections, campaigns, tax policy, the treasury (the **Village fund**), the government's road and rail builders, the mayor's needs list.

**GPS** — `src/player/gps.ts`: road-following routes, re-planning, amber chevrons on the road (`src/render/gpsarrows.ts`), a pill with the distance.

**Groq** — The LLM provider for **AI chat** (free tier). Default model: a small Llama, else a current model from Groq's own list (`openai/gpt-oss-20b` on this account).

---

## H

**Health** — `src/sim/health.ts`: health 0–100, colds/flu/stomach bugs/pneumonia and injuries; serious cases lie down until an ambulance comes by road; the ward (12 beds when staffed); recovery fastest in hospital; bills. Nobody dies of an injury.

**Hooks** — How the client plugs into the headless sim: `Game.founderHooks`, `Traffic.guests`, `Traffic.onHonk`, `Life.onEvent`, `Life.claim`, `Life.runwayHeld`, `Supply.founderLoad`, `Health`/`Power` dispatch via claims.

**HUD** — `src/ui/hud.ts` + `index.html`: the two-part frosted top bar, the street HUD (wallet, reputation, alerts, speedometer, fuel, GPS), toasts, PVTV, the minimap with R/C/I demand, the task book, the Planner palette, the shift card. Line icons are SVG symbols in `index.html`.

---

## I

**Impound** — Where a towed or busted car goes (the police station); $40 to collect.

**Indoors** — `src/player/indoors.ts` + `src/render/interior.ts`: going through a door (`E`), the room's own scene, the real occupants at posts and places, seats, counters, machines.

**Input** — `src/input/input.ts`: one action map (keyboard+mouse, gamepad, touch): `E` interact, `F` vehicle, `V` camera, `P` Planner, `Tab` phone, `F2` photo, `J` journal, `F1` help, `Esc` cancel; `W/S` gas/brake, `A/D` steer, `Space` handbrake/jump; in a plane `E/Q` climb/descend.

**Inspections** — See **Firefighter**.

**Intercity Express** — Every three hours 07:00–22:00 on the national line; ride it to Westmere, Northbridge, Avalon City or Harbourton.

**Knocking** — M7: at a home whose household won't ask you in yet, `E` knocks and the eldest at home comes to the door to talk.

**Interiors** — `src/interiors/plan.ts`: 12 templates (home, shop, food, office, workshop, classroom, hospital, police, fire, terminal, venue, civic), themed per type, laid out from the building's seed as plain data.

---

## J

**Jobs (V1)** — Villagers' workplaces, wages, promotions, graduate posts; essential services hire first.

**Jobs (Founder)** — The 13 playable **Shifts** (M6): firefighter, police officer, paramedic, taxi driver, bus driver, delivery driver, train driver, pilot, electrician, construction worker, shop worker/chef, PVTV reporter, farmer. Table in `src/player/shifts.ts` (`JOBS`), loops in `src/jobs/`.

**Jobs app** — The phone app listing every job, where it's worked nearest, pay, your record; start or clock off.

**Journal** — The village task book and news log (`J`; `src/sim/tasks.ts`).

---

## K

**Kit** — `src/render/kit.ts` (`MeshBuilder`: box, cyl, cone, blob, gables) and the architecture kit in `src/gfx/architecture.ts` (walls, sash windows, curtain walls with interior mapping, tiled roofs, parapets, signs) writing straight into packed per-material arrays.

---

## L

**Launch** — **M7**: everything's ready in the repo (`vercel.json` caching and headers, the chat guards, the manifest); the owner's steps (Vercel project, `GROQ_API_KEY`, DNS) are in `docs/LAUNCH.md`. Host: `pixelville.next.houseofnamus.com`.

**Life** — `src/sim/life.ts` (V1 "ambient life & justice"): hikers, birds, tourists, fireworks, crime and police, fires and the brigade, buses, taxis, queues, trains, boats and the ferry, helicopters, planes, campaigns, trials, road works, disasters, riots, incidents, the press.

**Loading** — Buildings are generated behind a progress bar a slice at a time; textures are painted in Web Workers (cached in IndexedDB in production); shaders are compiled off-frame before the first frame (`stage.warmUp()`).

**Look lab** — `slice.html` + `src/slice/`: the Milestone 1.5 vertical slice (one street block) where the realistic look was proven.

---

## M

**Map** — 256×256 tiles of 8 m (2 km square), a sea to the south, hills and woods beyond the edges, highways west and north, rivers and mountains.

**Mayor's report** — The civic card: needs list, tax policy, grid, hospital, graduates, goods.

**Milestones** — 1 Living town · 1.5 New look · 2 Street life · 3 Doors open · 4 Deeper village · 5 Going places · 6 Work shifts · 7 Launch polish (built; deploy pending). Details in `docs/MILESTONES.md`.

**Mind** — `src/sim/mind.ts`: each villager's traits, memories, friends, known and loved places, opinions; saved with them.

**Money rule** — Money is never conjured or destroyed: purchases are a business's income, rewards come from a household or the village fund, shift pay comes from the fund (public services) or the workplace's till. When the fund is empty it **owes** shift wages and pays them as taxes arrive.

**Motoring** — `src/player/motoring.ts`: fuel at gas stations, repairs at the auto garage, parking rules, tickets, towing, the impound, the Lodge garage.

---

## N

**News** — `src/sim/news.ts` (breaking headlines) and the task book's news log; shown on **PVTV**.

**Newcomers** — Families moving in arrive through a gateway (the train, or by air for skilled families).

**No killing** — Villagers are never killed by the player: injuries go to hospital.

---

## O

**Offences** — The Founder's road record (`founder.offences`): red lights, speeding over 60 km/h, the wrong side, bumps, crashes, people hit, ramming police, theft. On blue lights during a shift, the road-rule offences don't count (`founder.exempt`).

**Opinion** — See **Reputation**.

**Owner** — Suman Debnath. Judges on an Intel UHD laptop at 1366×768; wants maximum realism; wants slices before big visual changes; wants to be asked before new features. See HANDOFF §3.

---

## P

**Panels** — `src/ui/panels.ts`: building and villager cards, modals (settings, saves, new map, history chart, help).

**Paramedic** — M6 job (hospital): casualties come to you; treat them on foot, drive them in, hand them over to the ward; home visits to the sick between calls.

**Performance** — Medium tier on the Intel laptop ≈ 27 ms/frame at 1016×550 with a 42-building town. Integrated GPUs get **medium** (no MSAA/AO, 2K shadows refreshed on alternate frames, half-resolution textures); discrete get high. Never compile a shader on frame 1.

**Phones (playing on one)** — M7: touch controls from the start, full screen on the first tap (landscape where allowed), a "turn your phone sideways" card when upright, a compact layout for short screens, Low quality by default, two-finger twist to turn the Planner, installable (manifest + icon in `public/`).

**Phone** — `Tab` (`src/ui/phone.ts`): Map/GPS, Jobs, Ride, Contacts, Wallet, Garage, PVTV, Tasks, Camera, Planner, Settings.

**Photo mode** — `F2` (`src/player/photo.ts`, `src/ui/photopanel.ts`): the world pauses; free camera; lens, exposure, depth of field, looks, hour and weather previews; saves a PNG.

**Pilot** — M6 job (airport): throttle up the runway, lift the nose (`E`), climb out, fly off the map's edge; the hours pass behind the journey screen; a turnaround card in the city; then the approach home: line up, cross the fence low, the plane flares itself; land on the runway and it taxis to its stand. Brings visitors and import allowance; paid by the airport (the airline's takings).

**Planner** — `P`: rise into the aerial builder (`src/player/planner.ts`): V1's palette, roads, rails, rivers, terrain, bulldozer, undo, cards. Locked while wanted or on shift.

**Police officer** — M6 job (police station): break-ins, street arguments and crashes come to you; catch the burglar (`E` beside them), calm the quarrel, secure the crash; walk the beat to deter crime.

**Power** — `src/sim/power.ts`: demand vs capacity (plants 160 each staffed, the county line 60), rolling blackouts every 90 minutes, faults from storms, ice, the quake, floods and the tornado, repair crews, dark districts and traffic lights.

**PVTV** — The village TV channel: the HUD panel, breaking headlines, the stock ticker; the **Reporter** shift files stories to it. A TV station makes news reach every home (`Rep.broadcast`).

---

## Q

**Quality tiers** — `detectQuality()`: low / medium / high (see **Performance**); a setting overrides, applied after reload.

**Queues** — Anonymous riders waiting at bus stops and taxi ranks (`Life.stopQueues`), longer at rush hour.

---

## R

**Reputation** — `src/sim/reputation.ts`: each villager's opinion of the Founder (−10…+10), moved by what they see or suffer, spread by gossip and PVTV, cooling 3% a night; shown as a word and a meter on the HUD; sets prices (10–20% off from fans, refusal from those who can't stand you) and street reactions.

**Reporter (PVTV)** — M6 job (TV station): the editor assigns real stories (fires, crashes, disputes, break-ins, rallies, power cuts, stalled sites, bare shelves, booming businesses); film on foot with the subject in shot; file at the station; it airs. Shortage stories raise the county's import allowance.

**Riding** — `src/player/transit.ts` (**M5**): wait at a stop, board, get off; cabs from the phone or the rank; the sightseeing helicopter.

**Roads** — The road grid (`World.roadMap`), two-lane avenues, junctions, signals (the sim lights the busy ones), level crossings, bridges.

**Runway** — See **Airfield**.

---

## S

**Saves** — v5 format: the world, buildings, people, government, systems, and the Founder (`FounderSave`); 3 slots + autosave + export/import; V1 saves import into the centre. Stolen cars go home and shifts end on load.

**Scenarios** — New-map modes: sandbox, The First Hundred, The Rail Age, A Year Without Loss.

**Seasons** — See **Clock**; trees, crops, snow cover, ice, festivals follow them.

**Settings** — `src/sim/settings.ts` (kept in this browser): village name, growth pace, Christmas lock, autosave, volume; quality, resolution, frame cap, FOV; look sensitivity, invert, key bindings; interface size, subtitles, colour vision, shake, head bob, reduce motion; whether the guide was seen. Four tabs in the modal (M7).

**Shifts** — `src/player/shifts.ts`: start at the workplace or from the phone; the workplace lends its vehicle at the kerb; the job loop runs; tasks pay into the shift; stars 1–5; up to 8 hours (14 for the pilot) with a little overtime to finish; clock off for pay = (hourly × hours + task pay) × (0.7 + 0.1 × stars). See **Jobs (Founder)**, **Claims**, **Money rule**.

**Shift card** — The HUD panel top left during a shift (`src/ui/shiftpanel.ts`): job, place, objective, progress, time left, pay so far, stars, clock-off button; and the floating marker over the next target.

**Shop worker / chef** — M6 job (any shop or café with wares): inside, take each real customer's order, make it at the counter, serve it; customers pay the till and may tip; served well they grow fond of the place. Paid by the business.

**Showrooms** — Car Showroom (Pixel Hatch, Ville Saloon, Meadow Estate, Ridge 4×4, $280–520) and Motorcycle Showroom (Sprite 125, Ridge 650, $160–260), ten paints, part exchange (`src/ui/showroom.ts`).

**Sim** — `src/sim/agents.ts` (`Sim`): the people: families, schedules, trips, commuting, wages, savings, ambitions, businesses, weddings, births, ageing; plus stats.

**Sounds** — `src/audio/sounds.ts`: V1's procedural audio. One-shots are positional (`Snd.at`): the sim's `Snd.siren(at)` etc. carry a place, heard quieter with distance and panned to their side of the listener (`Snd.listen`, set from the camera each frame); ambience is all around.

**Subtitles** — M7 (`Subs` in `src/ui/access.ts`): villagers' street lines with their names (every greeting) and, if chosen, captions for horns, sirens, thunder, bells, crashes, fireworks; lower centre (lower left on narrower windows).

**Spec** — A vehicle's handling (`src/player/fleet.ts`): top speed, acceleration, range, tank, contact circles, repair cost, turn rate, length in traffic; `specOf(v)` covers work vehicles.

**Stage** — `src/render/stage.ts`: the renderer, physical sky, sun, moon, stars, clouds, environment lighting, post-processing (HDR, bloom, grading, auto-exposure), weather, the water reflection.

**Stars (shift)** — How a shift is going, 1–5; up with good work, down 0.6 with each failure. Not to be confused with **Wanted** stars.

**Stealing a car** — `F` beside a family's car in its drive (crime). Ends any shift.

**Supply** — `src/sim/supply.ts`: four goods (food, materials, textiles, products), producers' yards, shop shelves (thin = dearer, bare = no sale), delivery trucks, the warehouse, freight trains, daily import allowances, exports, sites eating materials, shortages in the news.

---

## T

**Taxi driver** — M6 job (taxi stand): real villagers want rides (leaving work or a venue, or at home with a day out in mind); they wait at the kerb; pull up beside them, drive them, drop them at the door (the sim's own arrival runs). The meter and any tip go into the rank's till; the driver's share is paid at clock-off. Each passenger rides at most once every 3 game hours.

**Templates (dialogue)** — `src/ai/templates.ts`: greetings by opinion and time, topics from the villager's life and the news; the fallback when AI chat is off or fails.

**Terrain** — `src/render/terrain.ts`: textured grass/sand/rock, kerbed roads, bridges, ballasted rails, lamps, animated water with foam and ice, trees in two LODs (32k), streamed grass, hills and the sea beyond the map.

**Tests** — Vitest in `tests/`, one file per system (sim, traffic, founder, wanted, reputation, photo, interiors, chat, health, power, education, supply, deeper, travel, shifts, V1 import); `tests/town.ts` builds towns. 118 tests at M7 (`controls.test.ts` added).

**Tickets** — Machine tickets kept in the bag (`src/player/tickets.ts`): singles, day returns, week rovers, ferry, island day trip, flights, the air taxi, the sightseeing flight.

**Time** — See **Clock**. The street runs at 1×; the Planner allows up to 8×.

**Traffic** — `src/sim/traffic.ts`: every vehicle looks ahead along its path, keeps its distance, stops for people, brakes for red lights and gates, takes turns at junctions, overtakes stopped vehicles when clear, and sees the Founder (`Traffic.guests`).

**Train driver** — M6 job (train station): drive the village line's passenger service (the local first); `W` power, `S` brake; stop with the cab at each platform (doors open, riders on and off); overrunning a platform or hitting the buffers counts against you; timetable bonus.

**Trains** — V1 services on player-laid rails (local, commuter, express, nightliner, freight), each on its own track with a timetable; plus the **Intercity Express**.

**Travel** — `src/player/travel.ts` + `src/ui/travelui.ts` (**M5**): leave from a gateway (seen in the world), the journey screen while hours pass at home, the city (look around, souvenir, stay the night, head home), the way back, and "while you were away".

---

## U

**UI language** — The V2 frosted-glass design: glass panels, line icons, overline/title/pills/facts cards, toasts with a lead emoji set apart, accent gold `#f0c27a`.

**Undo** — `Ctrl+Z` in the Planner (`Game.undo`).

---

## V

**Types (sim)** — `src/sim/types.ts`: `Building`, `Person`, `Car`, `XY`, the shared entity types the V1 code is now checked against (each with an open index for the long tail).

**V1** — The original PixelVille (2D, top-down). Its modules were ported into `src/sim` verbatim; changes are marked `V2:`. Since 2026-10-26 they're type-checked (no `@ts-nocheck`), the module objects still `any`. Never modify the V1 repo.

**Vehicles (models)** — Full models: `src/gfx/car.ts` (Car with extruded profiles in hatch/sedan/estate/suv; taxi sign; police light bar; Moto). Instanced: `src/render/models.ts` (car, taxi, police, fire, ambulance, truck, van, tractor, bus, moto, loco, coach, wagon, boat, ferry, raft, heli, plane, balloon, ufo, sleigh).

**Village fund** — `Gov.treasury`: taxes in; civic costs, county power, imports, prizes, the Founder's public-service wages out.

**Visitors** — Out-of-town people arriving by train, plane or ferry, spending in town and leaving (`Gateways.visitors`).

---

## W

**Wallet** — `src/player/wallet.ts`: balance and ledger (last 80 entries); `earn(amount, label, kind, from?)` takes from a building's funds; `spend(amount, label, kind, to?)` pays a building. Starts at $120.

**Wanted level** — `src/player/wanted.ts`: 1–5 stars from what squad cars or witnesses see; squad cars from real stations by road; roadblocks, spike strips, the helicopter; stars drop out of sight; Busted or Wasted.

**Wasted** — A violent crash: patched up at the hospital (a bill), hours pass, the car towed. Ends any shift.

**Weather** — `src/sim/weather.ts` (`clear, clouds, rain, heavy, snow`) driving wet streets with reflections, puddles, settling snow with tyre tracks, lightning, fog and leaf fall.

**Work vehicle** — Lent by the workplace for a shift (`founder.work`, `takeWork/dropWork`); drawn as the village's own; your own car waits where you left it.

**World** — `src/sim/world.ts`: the grid (ground, trees, roads, rails, building map), placement rules, path finding (roads, footpaths, rails, water), the railway builder, signals, serialize/restore.

---

## X

**XP / progression** — There is no XP system. Progression is the village itself, the Founder's wallet and fleet, reputation, and the shift record (stars per job).

---

## Y

**Yard** — A producer's stock of its good (up to 90); trucks haul from it; the **Farmer**'s harvest fills it.

**Year** — 28 game days (four seasons of seven); villagers age a year every in-game week.

---

## Z

**Zones / districts** — There is no zoning: buildings are placed directly. "Districts" exist only for **Power** (32×32 tiles), and "town centre / outskirts" bands for naming places (`Gov.districtName`).

**Zoom** — Mouse wheel: the street camera's distance (2.5–14 m), the Planner's height, a rider's view distance; in photo mode, the lens (12–114 mm).

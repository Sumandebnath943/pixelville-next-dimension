# PixelVille — Next Dimension · Milestone Plan

> Companion to [DESIGN.md](DESIGN.md). Each milestone ends with a playable, deployable build.
> Order follows dependencies: later jobs need the systems they run on (paramedics need health, electricians need power, train drivers need rideable trains).

| # | Milestone | Headline |
| --- | --- | --- |
| 1 | **Living town** | All V1 simulation in a 3D town you can walk, drive and build |
| 2 | **Street life** | Own vehicles, real traffic, wanted level, reputation, phone, photo mode |
| 3 | **Doors open** | Interiors and villager AI chat |
| 4 | **Deeper village** | Health, supply chain, education, power |
| 5 | **Going places** | Ride every transit line; travel off-map |
| 6 | **Work shifts** | All playable jobs |
| 7 | **Launch polish** | Mobile tuning, performance, balance, accessibility, launch |

---

## Milestone 1 — Living town

**Goal:** everything V1 does, running in 3D, with the Founder walking and driving through it and able to build from the sky.

**Status (2026-10-23): playable, not yet deployed.** Done: 1a–1h below, except the Vercel deploy. Deviations from the design, to revisit:

- **Characters and vehicles are procedural low-poly models**, generated in code like V1's sprites, instead of CC0 model packs. That means no downloads and no licensing. Rigged models can replace them later without touching the sim.
- **No Rapier yet.** V1's world is a tile grid of rectangular plots, so walking and driving use a light custom collision against building boxes, tree trunks, water and the map edge. Rapier can come in M2 if crashes and pursuits need real physics.
- **The sim modules are ported verbatim with `// @ts-nocheck`.** The new client code is strictly typed; a typing pass over `src/sim` (shared entity interfaces) is pending.
- **Sounds are not yet positional**, and there is no separate mid-distance LOD tier: everything within range is instanced at full detail.
- **The gamepad mapping** follows the standard layout but hasn't been tested on hardware yet.

### 1a · Foundations
- Vite + TypeScript (strict) + Three.js + Rapier project; ESLint, Prettier, Vitest.
- Vercel project with a preview deploy per push; `api/` folder ready.
- `.env.example` and gitignored `.env.local` with `GROQ_API_KEY=` / `GROQ_MODEL=` (used from Milestone 3).
- Fixed-step game loop, command queue and event bus between sim and the rest.

### 1b · Headless simulation port
- Port V1 modules into `src/sim/` as typed, DOM-free code: world, catalog data, mind, agents, gov, life, calamity, festivals, weather, news, tasks, settings.
- Grid → 256 × 256; review map-size-dependent constants (pioneer distance, district bands, coverage radii, starter map layout).
- Building **facing** (door side from orientation).
- New time model: 1 game-minute per real second at 1×, aging one year per 7 days; review life-stage timings.
- Parity tests for core behaviours and a 100-day soak test (invariants: money finite, cars returned, tasks closed, head-counts ≥ 0).

### 1c · The 3D world
- Chunked terrain (16 × 16 tiles): grass, sand, water surface, sculpted mountains, instanced seasonal trees.
- Road meshes from the road grid: lanes, sidewalks, junctions, bridges, traffic lights, level crossings, street lamps.
- Rail tracks with sleepers and trestle bridges.
- Procedural low-poly builders for all 87 building types + upgrade levels, construction stages, renovation, fire, ruins.
- Chunk rebuild on edit.

### 1d · The Founder on foot and at the wheel
- Character controller (walk, run, jump), third-person camera with collision, first-person toggle.
- Enter/exit vehicles; arcade car physics on Rapier; chase and cockpit cameras.
- Input action map for keyboard + mouse, gamepad, and a first pass of touch controls.

### 1e · Planner mode
- Fly-up transition to the aerial camera (V1's gliding WASD pan, zoom, rotate, tilt).
- V1 palette in full: place, rotate, drag roads/rails/rivers, terrain stamps, bulldoze, undo, ghost preview, road-access warnings.
- Building cards, villager inspector, mayor's report with tax policy, history charts.

### 1f · Villagers and vehicles
- CC0 rigged characters (adults, kids, elders) with walk/idle/sit animations; CC0 low-poly cars, buses, taxis, trucks, emergency vehicles, trains, boats, helicopters, planes.
- LOD tiers (near / mid / far) on top of the sim.
- Pedestrians on sidewalks, cars in lanes, stopping at lights and gates, queueing.
- Every V1 set-piece visible: commutes, school runs, evenings out, buses & queues, taxis, 5 train services, ferry, helicopters, planes, fires & engines & bucket brigades, burglaries & police, disputes, crashes, collapses & rebuilds, riots, rallies, voting booths, reporters, hikers, beachgoers, tourists, wildlife.

### 1g · Atmosphere
- Day/night cycle with sun/moon, glowing windows and lamps, headlights near the player.
- Seasons (blossom, summer, autumn leaves, snow cover), weather (rain, storms with lightning, snow, puddles, cloud shadows, rainbows).
- Festivals: Christmas tree tradition & markets, Diwali lights, Easter, New Year fireworks.
- Calamities: drought (water drops), flood (water over streets, rafts), earthquake (shake, cracks), tornado.
- Procedural audio from V1, made positional.

### 1h · UI, saves, ship
- HUD from V1 (clock, season, weather, tier, stats, leader chip, task book, PVTV, R/C/I, minimap, clickable toasts).
- Saves v5 in IndexedDB: 3 slots + autosave + export/import; **V1 save import**.
- New-map screen with scenarios; settings (growth pace, Christmas lock, volume, autosave, graphics quality, controls).
- Deploy.

**Done when:** a fresh map grows from the first family to a town with a mayor, a railway and a festival, entirely visible from street level; the player can build anything V1 could, walk and drive anywhere, and a V1 save imports and keeps running.

---

## Milestone 1.5 — New look (done, except real character and car models)

**Goal:** replace Milestone 1's flat-shaded box look with a semi-realistic one (real materials, physically based sky and light, weather that settles into the town), proven first on one street block before it touches the game.

**Status (2026-10-24): done.** The look was signed off on 2026-10-23 and ported into the game; the rest of the milestone followed:
- **Interface (V2):** the look lab's frosted-glass language across the game. A two-part top bar (village, date, large clock, weather with forecast, tier; population, jobs, wealth, safety and happiness with warning colours, leadership, a speed control, Planner, task book, history and a menu holding save, load, new map, settings, sound and help). Line icons replace emoji chrome. The Planner palette shows one category at a time under tabs. Building, villager and mayor cards share one layout: overline, title, status pills, a facts list, notes and actions. Toasts and PVTV set the sim's lead emoji apart as an icon, and clickable toasts carry a pin. Settings, saves, new map, history chart, help and the loading screen are restyled to match. The layout adapts below 1240 px.
- **Traffic gives way** (`src/sim/traffic.ts`): every vehicle in the sim (villagers' cars, cabs and motorbikes, buses, taxis, tourists, campaign cars) looks along the path it is about to drive. It keeps its distance in queues, stops for people on the carriageway, brakes for red lights and lowered gates at a stop line, and takes turns at unsignalled junctions (first come, first through). Speeds follow from stopping distance, so traffic pulls away and closes up smoothly at any game speed. Jams resolve themselves: a driver stuck behind crossing traffic edges out after 6 s, and one stuck behind something parked (a bus at its stop, a squad car at a scene, a wreck) squeezes past after 10 s. Emergency vehicles keep right of way. Buses and cabs on their return leg now keep right and face forward. Covered by `tests/traffic.test.ts`.
- **Camera:** the street camera stops short of walls, roofs, awnings, balconies, porticoes and canopies. Each building records the volumes the camera may not enter, and the camera does an exact ray test with a 0.45 m radius, so the near plane never clips. It snaps in at once and eases back out, and the Founder fades out when the camera is pushed right up to them.
- **Loading:** buildings generate about 10× faster (all 98 types in 0.18 s instead of 1.8 s), because the kit writes straight into packed per-material arrays. A town is built behind the loading screen a slice at a time, with a progress bar. Procedural textures are painted in parallel Web Workers while the town loads, and production builds cache them in IndexedDB. Measured on the Intel UHD laptop: the first frame comes in about 2.9 s (it was about 4.5 s, plus ~25 ms for every building in big towns), and a production build that has cached its textures starts in about 1.3 s.

`src/render` draws with `src/gfx`:
- **Stage:** physical sky, sun, moon, stars and clouds; the weather, season and clock drive wet streets with reflections, settling snow, leaf fall and wind.
- **Terrain:** textured grass, sand and rock; kerbed and paved roads; stone bridges; ballasted rails; heritage lamps; shared animated water with shore foam and winter ice; hills and woods beyond the map; the sea to the south. Trees are drawn in two levels of detail (32k capacity) and grass streams in around the camera.
- **Buildings:** V1's 87 builders are untouched, but their toolkit now draws real architecture: brick, render or stone walls; sash windows and curtain walls with interiors; tiled roofs; parapets; lit name signs; real trees. Finished buildings merge per 16×16-tile chunk; construction sites rise inside scaffolds. The Planner picks buildings by bounding box.
- **Actors:** the nearest 32 villagers are skinned, gait-animated people and the nearest 22 cars are full models (taxi signs, police light bars). Everything farther is instanced. The Founder is a skinned person with a hat, and drives a sedan.
- **Effects:** GPU fire with embers and smoke; redesigned thought bubbles, one per head; eave lights at Christmas; the Christmas plaza with a 24 m spruce, 1,400 lights, a star, garlands, flagpoles, a rink and skaters.
- **Performance:** medium on an Intel UHD laptop is ~27 ms/frame at 1016×550 with a 42-building test town.

Left for later, by choice: real rigged people and cars up close (the asset licensing is still to be decided). Until then the nearest villagers and cars are the code-built skinned people and extruded-profile cars.

The vertical slice is still at `slice.html` (the "look lab"):

- `src/gfx/`: the new graphics layer. Physical sky with clouds, stars and moon, which also lights everything through an environment map. Shared surface shader for wetness, puddles with street reflections, settling snow with tyre tracks, and height fog. Procedural PBR textures. Detailed building kit with interior-mapped windows. Wind-driven trees, bushes and grass. River with Gerstner waves and buoyancy. Extruded-profile cars. Skinned people with a gait-data walk cycle. GPU rain and snow. Quality tiers.
- `src/slice/`: the block (Founders Lane × Mill Street, terraces, bakery, pub, riverside park), traffic that follows, yields and stops for pedestrians, and the control panel.
- **Quality tiers** (`detectQuality`): integrated GPUs get *medium* (no MSAA/AO, 2K shadows, shadows and mirrors refreshed on alternate frames, half-resolution textures); discrete GPUs get *high*.
- **Known limits:** people and cars are code-built stand-ins. Realistic ones need real rigged models; the asset licensing for those is still to be decided.

**Next:** Milestone 2. Real character and vehicle models join whenever the licensing is settled.

---

## Milestone 2 — Street life (in progress)

- **Vehicle ownership:** buy at car/motorcycle showrooms, fuel at gas stations, damage & repair at the auto garage, parking, tickets, towing, Founder's Lodge garage.
- **Traffic AI polish:** car-following, yielding, honking, swerving, player-caused crashes feeding V1 incidents.
- **Player crime & wanted level** (1–5 stars, police from real stations, roadblocks, helicopter with a heliport, fines, a night in the cells, impound). Planner locked while wanted. "Wasted" → hospital.
- **Reputation:** witness memories about the Founder, gossip spreading them, street reactions, HUD indicator.
- **Phone v1:** Map/GPS with route arrows, Wallet, PVTV, Tasks, Camera, Planner, Settings.
- **Photo mode.**
- **Wallet** with small rewards so money exists before jobs arrive.

**Done when:** you can buy a car, drive across town obeying (or ignoring) the lights, get chased by the police for stealing one, and watch villagers react to you differently afterwards.

**Order of work** (each step builds on the one before):

### 2a · On the road with everyone (done 2026-10-24)
- The village's traffic sees the Founder (`Traffic.guests`): drivers queue behind the Founder's car, stop for the Founder on foot in the road, and sound the horn (positional, with a 😤 over the driver) when held up for two seconds.
- Overtaking: a driver stuck behind something stopped in its lane (the Founder's parked car, a bus at its stop, a squad car at a scene, a wreck) pulls out into the oncoming lane when the road ahead runs straight with no junction, lights or crossing and nothing is coming, passes, and pulls back in. Vehicles carry their lane offset, so the pass is drawn.
- The Founder's car collides with the village's vehicles instead of driving through them. A hard hit on a villager's or visitor's car becomes V1's crash incident (one wreck where it happened, onlookers, police, a PVTV reporter); the driver heads home shaken and remembers who did it. A person in the way is knocked down, lies in the road for a while, gets up, and remembers it.
- The Founder's road offences are recorded (`founder.offences`, `founderOffence` event): red lights, speeding over 60 km/h, the wrong side of a two-way street, bumps, crashes and people hit. The car keeps a damage value for the garage in 2c.
- Fixed on the way: every tile of a two-tile avenue counted as a junction; two cars setting off from the same spot drove as one. Covered by `tests/traffic.test.ts` (overtaking, not overtaking into oncoming traffic, avenues, stopping and honking for the Founder, twins).

### 2b · Wallet and phone (done 2026-10-24)
- **Wallet** (`src/player/wallet.ts`): a balance and a ledger of every reward, win, purchase and (later) fine, saved with the village. Money is never conjured: what the Founder spends in a business is its income, and a household's thank-you comes out of its savings. The wallet pill flashes green or red with each change.
- **Small rewards** (`src/player/errands.ts`): now and then a villager's dog slips out of the yard. A toast with a pin and a task-book entry go out; find the dog, call it over (<kbd>E</kbd>), and it follows you while the GPS routes you to the family, who pay what they can and remember who brought it back (left alone, it finds its own way home in two days). Standing by to help at a fire or a crash earns a thank-you from the village fund. Open shops sell scratch cards at the door ($2 to the shop; prizes from the village fund).
- **GPS** (`src/player/gps.ts`, `src/render/gpsarrows.ts`): routes follow the roads, re-plan when you stray, and drop the stretch behind you; amber chevrons drift along the road ahead (they hold their colour in sunshine and at night), the route shows on the minimap, and a pill shows where you're going and how far. On the street, "Go there", "Find home", the minimap and pinned toasts set a route; in the Planner they still fly the camera.
- **Phone** (`src/ui/phone.ts`) on <kbd>Tab</kbd> or the top-bar button: home screen with the clock, the wallet and the current route; Map (tap any place or building, or search the village's places by name, sorted by distance), Wallet (balance, today in and out, history), PVTV (markets and headlines), Tasks, Camera (a clean photo of the view, kept for the session, saved as a JPEG), Planner and Settings. The mouse stays free while it's out; <kbd>Esc</kbd> puts it away. Personal moments (a scratch card, a route) stay out of the village news.
- Covered by `tests/founder.test.ts` (wallet and GPS).

### 2c · Vehicle ownership (done 2026-10-24)
- **The fleet** (`src/player/fleet.ts`): the Founder starts with their own saloon; everything bought is kept with the village save (paint, fuel, dents, where it is). One vehicle is out at a time, the one you drive; the rest wait in the **Lodge garage** (at the Lodge door: take one out, put the one that's home away).
- **Showrooms** (`src/ui/showroom.ts`): the Car Showroom sells the Pixel Hatch, Ville Saloon, Meadow Estate and Ridge 4×4 ($280–520), the Motorcycle Showroom the Sprite 125 and Ridge 650 ($160–260), each in ten paints. The new one is parked at the kerb outside; whatever you were driving goes home to the garage. Part exchange buys back anything in the garage or parked outside, at 55% of the price less wear, paid from the showroom's own till.
- **Motorcycles**: a new model built from the car's materials (no new shaders), quicker off the mark and sharper to turn; the Founder rides it in plain sight and leans with it.
- **Fuel** drains with distance (about 26 km a tank for a car, 20 for a motorcycle); a dry tank only crawls. Pull onto a gas station's forecourt and stop: <kbd>E</kbd> fills up, paid to the station (or as much as the wallet allows). A warning with a pin to the nearest pumps comes at 15%.
- **Damage** from knocks and crashes costs top speed past 50% and leaves a wreck at 100%. Stop at an open auto garage (8:00–18:00) and <kbd>E</kbd> repairs it, paid to the garage; a wreck can be towed there from the phone.
- **Parking, tickets, towing**: where there's a police station there are wardens. Park at the kerb; in or next to a junction, lights or level crossing, in a bus stop or taxi rank, on the railway or out in the carriageway earns a $15 ticket after 45 game minutes and a tow to the impound lot at the station after two more hours; collect it there for $40. Fines go to the village fund; what the wallet can't cover is owed and taken as money comes in. The Lodge's own drive is always fine.
- **HUD and phone**: a fuel gauge and a condition warning next to the speedometer; a **Garage** app lists every vehicle with its fuel, condition and whereabouts, finds it (GPS), and calls a tow ($35: home to the Lodge, or a wreck to the auto garage).
- Covered by `tests/founder.test.ts` (fleet values and saves, the parking rules).

### 2d · Crime and the wanted level (done 2026-10-24)
- **Stealing a car** (`src/player/wanted.ts`): on foot beside a family's car in its drive, <kbd>F</kbd> steals it (the drawn driveway cars and the stealable ones are the same spots, `src/render/parked.ts`). Your own vehicle stays where you left it; walk back to it and <kbd>F</kbd> swaps back. A stolen car left standing goes home to its family once you're 60 m away (or walk 90 m from it). A save never keeps a stolen car: it goes home on load.
- **Who saw it decides**: road offences (red lights, speeding, the wrong side, bumps) count only if a squad car sees them; crashes, people knocked down, car theft and ramming the police also count if a villager within 32 m sees them ("a witness called it in"), and those villagers remember it. Buildings block a crew's view (parks, plazas and the like don't). An unwitnessed theft is reported by the family 20–45 game minutes later; from then the car is "hot" and any crew that spots it gives chase.
- **Stars**: ★ road offences and crashes, ★★ hit-and-run and car theft, ★★★ ramming the police; a fresh crime mid-chase adds one more (traffic offences don't). Out of sight for 16/24/34/46/60 s, a star drops. Stars sit under the top bar, flashing while a crew has eyes on you, with a gauge filling towards the next drop.
- **The response**: 1/2/4/6/8 squad cars from the real police stations by road (the nearest at ★–★★, every station from ★★★), re-routing to where you were last seen; where no road joins the station to you, a patrol already out on that side of town comes instead. No police station, nobody comes. From ★★★, roadblocks of two or three cars across the road ahead (both carriageways of an avenue) behind a barrier; from ★★★★ a spike strip in front of them that shreds the tyres; at ★★★★★ the helicopter, if the village has a heliport (it sees 160 m and stays 90 s). Ramming a squad car is ★★★.
- **Busted**: a crew alongside for two seconds while you're on foot or stopped. Fine $40–360 by stars (to the village fund; what you can't pay is owed), your own vehicle goes to the impound lot if you were driving it (a stolen one goes home), and the hours pass behind a curtain: overnight in the cells till 07:00, or five hours by day. You walk out of the station.
- **Wasted**: a crash at about 80 km/h or more. Patched up at the nearest hospital (a bill up to $120, paid to the hospital; no hospital, a neighbour patches you up at the Lodge), four hours pass, your vehicle is towed to the auto garage, and the chase is forgotten.
- **Planner locked** while wanted (P, the top-bar button and the phone all say so).
- Covered by `tests/wanted.test.ts` (who saw it, line of sight, decay, the chase by road and the arrest, the stolen car going home).

### 2e · Reputation
- Witnesses remember what the Founder did; gossip spreads it; each villager's opinion drives greetings, street reactions (wave, avoid, call the police), shop discounts or refusals. A town-wide indicator in the HUD.

### 2f · Photo mode
- Pause the world, free camera, depth of field, filters, time-of-day and weather preview, hide the HUD, save a PNG.

---

## Milestone 3 — Doors open

- **Interiors:** the 12 templates, themed per building type; enter/exit transitions; real occupants from the sim; buy, order, sit, ATM, ticket machines.
- **Villager AI chat:** `api/chat.ts` Groq proxy, context builder, in-world Founder persona rules, validated effects (memory, bond, knowledge, mood), rate limiting, conversation summaries saved to minds.
- **Template dialogue** fallback driven by the same context.
- **Phone Contacts:** villagers you've met; call or chat remotely.

**Done when:** you can walk into the bakery, buy a pastry from the real baker, ask them about last week's fire, and they remember the conversation tomorrow.

---

## Milestone 4 — Deeper village

- **Health & ambulances:** health, injuries, seasonal illness, hospital beds, ambulance dispatch, recovery.
- **Supply chain:** food, materials, textiles, products; stock in producers and shops; delivery trucks; freight trains; construction consuming materials; imports/exports; prices and shortages; tickers.
- **Education:** school → degree; skilled jobs gated; skilled migration.
- **Power & blackouts:** demand vs. capacity, district blackouts, dark traffic lights, repair crews.
- Rebalance V1 economy and needs around the new systems.

**Done when:** a storm blacks out a district, an accident there sends a villager to hospital by ambulance, and a materials shortage visibly stalls a construction site — all from simulation, not scripts.

---

## Milestone 5 — Going places

- **Ride everything:** board buses at shelters, trains at stations, ferries at docks, taxis via phone or rank, helicopters at heliports. Tickets from the wallet.
- **Off-map world:** highways, rail exits, sea lanes and the airport lead to named destination cities (travel cinematic + time skip + small events).
- **Flights:** buy a ticket, check in at the terminal, board, fly, arrive.
- Tourists, migrants and trade flowing through the gateways.

**Done when:** you can take the bus to the station, ride the express to the edge of the map, fly out of the airport and come back to find the village has moved on without you.

---

## Milestone 6 — Work shifts

Playable shift loops with pay, performance and real effects on the sim:

| Wave | Jobs |
| --- | --- |
| 6a — Emergency | Firefighter · Police officer · Paramedic |
| 6b — Driving | Taxi driver · Bus driver · Delivery / trucker |
| 6c — Rails & skies | Train driver · Pilot |
| 6d — Town | Electrician · Construction worker · Shop worker / chef · PVTV reporter · Farmer |

**Done when:** each job can be started from the phone or the workplace, plays as a loop of real sim events, pays into the wallet, and changes the village (fires saved, arrests made, shops restocked, headlines filed).

---

## Milestone 7 — Launch polish

- Mobile/touch tuning and performance presets; long-session stability.
- Balance pass across economy, growth, crime, calamities, chat costs.
- Accessibility: rebinding, subtitles for chat, colour-blind-safe HUD, motion-sickness options (FOV, head-bob, camera shake).
- Onboarding: a short first-day tutorial that founds the village with you.
- Launch at `pixelville.next.houseofnamus.com`.

**Done when:** it plays well on a mid-range phone, a laptop and with a gamepad, and a new player can found a village without reading anything.

---

## Ways of working

- Every milestone: playable build deployed to a Vercel preview, then promoted.
- Sim changes ship with tests; the multi-day soak test runs on every change.
- Assets are CC0 only, tracked in `public/assets/LICENSES.md`.
- V1 is never modified; it stays the reference for behaviour.

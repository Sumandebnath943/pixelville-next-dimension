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

## Milestone 1.5 — New look (in progress)

**Goal:** replace Milestone 1's flat-shaded box look with a semi-realistic one (real materials, physically based sky and light, weather that settles into the town), proven first on one street block before it touches the game.

**Status (2026-10-23): look signed off and ported into the game.** `src/render` now draws with `src/gfx`:
- **Stage:** physical sky, sun, moon, stars and clouds; the weather, season and clock drive wet streets with reflections, settling snow, leaf fall and wind.
- **Terrain:** textured grass, sand and rock; kerbed and paved roads; stone bridges; ballasted rails; heritage lamps; shared animated water with shore foam and winter ice; hills and woods beyond the map; the sea to the south. Trees are drawn in two levels of detail (32k capacity) and grass streams in around the camera.
- **Buildings:** V1's 87 builders are untouched, but their toolkit now draws real architecture: brick, render or stone walls; sash windows and curtain walls with interiors; tiled roofs; parapets; lit name signs; real trees. Finished buildings merge per 16×16-tile chunk; construction sites rise inside scaffolds. The Planner picks buildings by bounding box.
- **Actors:** the nearest 32 villagers are skinned, gait-animated people and the nearest 22 cars are full models (taxi signs, police light bars). Everything farther is instanced. The Founder is a skinned person with a hat, and drives a sedan.
- **Effects:** GPU fire with embers and smoke; redesigned thought bubbles, one per head; eave lights at Christmas; the Christmas plaza with a 24 m spruce, 1,400 lights, a star, garlands, flagpoles, a rink and skaters.
- **Performance:** medium on an Intel UHD laptop is ~27 ms/frame at 1016×550 with a 42-building test town.

Still to do: V2 HUD and panels (point 9), traffic awareness in the game sim (the slice has it), real rigged people and cars (licensing open), camera collision with walls, and faster building generation (~25 ms each).

The vertical slice is still at `slice.html` (the "look lab"):

- `src/gfx/`: the new graphics layer. Physical sky with clouds, stars and moon, which also lights everything through an environment map. Shared surface shader for wetness, puddles with street reflections, settling snow with tyre tracks, and height fog. Procedural PBR textures. Detailed building kit with interior-mapped windows. Wind-driven trees, bushes and grass. River with Gerstner waves and buoyancy. Extruded-profile cars. Skinned people with a gait-data walk cycle. GPU rain and snow. Quality tiers.
- `src/slice/`: the block (Founders Lane × Mill Street, terraces, bakery, pub, riverside park), traffic that follows, yields and stops for pedestrians, and the control panel.
- **Quality tiers** (`detectQuality`): integrated GPUs get *medium* (no MSAA/AO, 2K shadows, shadows and mirrors refreshed on alternate frames, half-resolution textures); discrete GPUs get *high*.
- **Known limits:** people and cars are code-built stand-ins. Realistic ones need real rigged models; the asset licensing for those is still to be decided.

**Next:** sign-off on the look → port `src/gfx` into the game renderer → festival dressing (Christmas plaza) → real character and vehicle models.

---

## Milestone 2 — Street life

- **Vehicle ownership:** buy at car/motorcycle showrooms, fuel at gas stations, damage & repair at the auto garage, parking, tickets, towing, Founder's Lodge garage.
- **Traffic AI polish:** car-following, yielding, honking, swerving, player-caused crashes feeding V1 incidents.
- **Player crime & wanted level** (1–5 stars, police from real stations, roadblocks, helicopter with a heliport, fines, a night in the cells, impound). Planner locked while wanted. "Wasted" → hospital.
- **Reputation:** witness memories about the Founder, gossip spreading them, street reactions, HUD indicator.
- **Phone v1:** Map/GPS with route arrows, Wallet, PVTV, Tasks, Camera, Planner, Settings.
- **Photo mode.**
- **Wallet** with small rewards so money exists before jobs arrive.

**Done when:** you can buy a car, drive across town obeying (or ignoring) the lights, get chased by the police for stealing one, and watch villagers react to you differently afterwards.

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

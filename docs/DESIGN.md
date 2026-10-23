# PixelVille — Next Dimension · Design Document

> Status: **agreed design, pre-code** · Last updated: 2026-10-23
> Predecessor: [PixelVille V1](https://github.com/Sumandebnath943/pixelville) (live at pixelville.houseofnamus.com). V1 is frozen: nothing in that repo changes.

---

## 1. Vision

PixelVille V1 is a living village you watched from above: you drop buildings, and the village works out the rest — roads, families, jobs, minds, elections, crime, fires, festivals, disasters.

**Next Dimension keeps every one of those systems and puts you on the street.** You walk the village in first or third person, drive its roads, ride its trains, take its jobs, talk to its people — and at any moment you can still rise into the sky and build, like before.

### Design pillars

1. **The village lives without you.** Every V1 system keeps running whether you watch or not. The 3D world is a window onto the simulation, never a replacement for it.
2. **Everything you see is real.** A fire truck on the street is the fire truck V1 dispatched; a queue at the bus stop is the real queue. No fake ambient crowds.
3. **You are the Founder.** A god with a body: free to build, free to roam, with a light wallet for the fun of the world — and villagers who notice.
4. **Minds first.** Villagers know, remember, choose and now *talk*. What you do enters their memories.
5. **Cozy, then dramatic.** Calm day-to-day life, punctuated by rare, visible, survived-together events.

---

## 2. Agreed decisions

| Area | Decision |
| --- | --- |
| Platform | Browser. TypeScript + Vite + Three.js; Rapier for vehicle/character physics. |
| Players | Single-player. Simulation is engine-agnostic and command-driven so online co-op can be added later. |
| Art | Stylized low-poly. Buildings, terrain and props generated procedurally; CC0 rigged characters and vehicles. |
| Player role | God with an avatar ("the Founder"): free building in Planner view, street-level roaming, no needs, no aging. |
| Money | Light personal wallet: playable job shifts pay you; you spend on food, tickets, vehicles, flights, fines. God-mode building stays free. |
| Time | A day ≈ 24 real minutes at 1×. Villagers age one year per in-game week. A year is still 28 days (4 seasons × 7). |
| World size | 256 × 256 tiles (~2 km across), plus off-map destinations reached by highway, rail, sea and air. |
| Interiors | ~12 category templates, re-themed so every building can be entered. |
| Tone | V1's mature stories kept (never graphic). Player crime enabled with a GTA-style wanted level and light penalties. |
| Villager chat | AI chat per villager via Groq (free tier) through a serverless proxy, grounded in the villager's mind, the world and the player. Template fallback. |
| Awareness | Villagers are fully aware of their own lives and town, and know the player as the mysterious **Founder**. They never break the fourth wall. |
| Controls | Keyboard + mouse, gamepad, mobile touch. |
| New systems | Health & ambulances · supply chain · education that matters · power & blackouts · in-game phone · reputation · vehicle ownership · photo mode. |
| Milestone 1 | Port all V1 simulation + 3D town + roam/drive + aerial build + NPCs + day/night & weather. |

---

## 3. What we inherit from V1 (the systems to port)

V1 is ~12.7k lines of vanilla JS across 14 modules. Every system below is ported, behaviour-for-behaviour, into a headless TypeScript simulation, then polished.

| V1 module | Systems | Port notes |
| --- | --- | --- |
| `world.js` | Tile grid (grass/water/rock/sand), trees, roads, rails, reserved ground, mountains (11×11 massifs), starter map (forests, lakes, river, sea + beach, country roads), **auto-road A\*** (terrain costs + turn penalty, two-lane avenues), rail A\*, city-planning spot scorer, remote pioneer spots, road/walk/water/rail pathfinding with path cache, save/load | Grid grows to 256². Buildings gain a **facing** (§5.3). Pathfinding stays tile-based; a lane graph is derived from it for 3D traffic (§7). |
| `sprites.js` (`CAT`) | 97 catalog entries: 87 placeable building types (incl. 5 fast-food chains), 2 house upgrade levels, 8 terrain/tools. Footprints, jobs, opening hours, Sunday opening, visit type, residents | Draw functions are replaced by procedural 3D builders; catalog data is kept and extended (§5.4). |
| `agents.js` | Families, lifestyles (worker, shopkeeper, entrepreneur, tycoon, industrialist, farmer, neighbour, risk-taker), wages & prices, daily planner (work, lunch, school, college, errands, evenings out with friends, strolls, markets), car/moto/taxi/bus choice, life cycle (coming of age, romance, weddings, births, separations, retirement, old age), household economy (upgrades, cars, bikes, boats, rentals, lottery), utilities, side gigs, loans, business health, ambitions & startups, petty theft, hardship, wellbeing, casino, stock market, pioneers, growth, tiers, scenarios | Movement becomes position-accurate near the player (§7). Time constants re-tuned (§6). |
| `mind.js` | Traits (social, caution, ambition, thrift, curiosity), knowledge of places, episodic memories, friendships, favourites, fears, gossip, career hunting | Extended with the **Founder** as a known person, reputation, and chat memories (§10, §12). |
| `gov.js` | Elections every 28 days, 7-day campaigns, four leader personalities (visionary, business, steady, corrupt), voter quality of life, taxes & treasury, approval, grievances, needs list, mayoral spending, civic caps, service coverage, consolidation, bus network, railway programme, community self-building, road repair, land prices & districts | Unchanged in logic. Campaign banners, rallies, booths, riots become 3D set-pieces. |
| `life.js` | Hikers, birds, ducks, butterflies, tourists, fireworks, burglaries & police, fires & fire brigade & bucket brigades, buses, taxis, stop queues, 5 train services (local, commuter, express, nightliner, freight), boats & ferry, helicopters, planes, campaign cars, grave crimes & trials, road works, collapses & community rebuilds, riots, onlookers, disputes & crashes, PVTV reporters, beach life, sky events | All visible in 3D. Many become things the player can ride, join or do as a job. |
| `calamity.js` | Drought, monsoon flood (rafts), earthquake (shake, cracks, collapse), tornado | Real 3D effects: water level, flood plane, camera shake, funnel with debris. |
| `festivals.js` | New Year, Easter, Diwali, the Christmas tree tradition & markets, carolers, Santa & sleigh | Walkable markets and lit streets. |
| `weather.js` | Seasons, weather state machine, rain/snow/leaves, puddles, cloud shadows, lightning | Volumetric-feeling sky, wet roads, snow cover. |
| `news.js`, `tasks.js` | PVTV channel + ticker, task book & news log | Become phone apps + HUD. |
| `sounds.js` | Procedural WebAudio | Kept, plus positional 3D audio. |
| `settings.js` | Growth pace, Christmas speed lock, volume, autosave | Kept, plus graphics, controls, chat. |
| `main.js` | Renderer, camera, HUD, inspectors, mayor's report, history charts, saves (3 slots + autosave + export/import), undo | UI rebuilt; save format v5 with V1 import (§16). |

**Known V1 quirks to fix during the port:** README says mountains are 5×5 but code uses 11×11; doors are always on the south side; several systems assume a 128-tile map (e.g. pioneer `minDist 42`, district bands, coverage radii) and must be reviewed for 256².

---

## 4. The player — the Founder

### 4.1 Two views, one avatar

| Mode | Camera | What you do |
| --- | --- | --- |
| **Street** (default) | Third-person over-the-shoulder ⇄ first-person (toggle) | Walk, run, jump, drive, ride transit, enter buildings, talk, work shifts. |
| **Vehicle** | Chase cam ⇄ first-person cockpit | Drive cars, bikes, buses, trucks, emergency vehicles; fly helicopters/planes on jobs. |
| **Planner** | Aerial RTS camera (V1's gliding WASD pan, wheel zoom, Q/E rotate, tilt) | Everything V1's palette could do: place buildings, drag roads/rails/rivers, terrain stamps, bulldoze, undo, inspect, mayor's report, tax policy. |

- Planner is opened anywhere with a key (or the phone's *Planner* app). The camera flies up from the avatar and back down when you leave; the avatar waits where it stood.
- **Planner is locked while you have a wanted level** — god powers are not an escape hatch.
- Building is free (god mode), as in V1. Construction still takes real time and the village's shared builder crew, exactly as V1.

### 4.2 The Founder's wallet

- Starts with a modest float. Earned through **playable job shifts** (§11) and small rewards (returning a lost dog, winning the lottery, a hero's thank-you).
- Spent on: food & drinks, shop items (cosmetic or useful), tickets (bus, train, ferry, flights), taxis, vehicles, fuel, repairs, parking and fines.
- Your wallet is separate from the village economy's balances, but money you spend is real income for the businesses you spend it in.
- No hunger, sleep or aging. You can *choose* to sleep at the Founder's Lodge to skip time.

### 4.3 The Founder's Lodge

A unique small house auto-placed at the edge of the starter area (relocatable in Planner). Your spawn point, garage for owned vehicles, and wake-up spot after a night in the cells — unless you pick the hospital or the police station.

### 4.4 Crime and the wanted level

| Stars | Trigger examples | Response |
| --- | --- | --- |
| ★ | Speeding past a patrol, minor collision, trespass | Nearest patrol car investigates. |
| ★★ | Stealing a vehicle, hit-and-run, break-in, fighting | Active pursuit from the nearest police station. |
| ★★★ | Repeat offences, ramming police, resisting | Units from every station, roadblocks at junctions. |
| ★★★★ | Sustained rampage | All units, spike strips. |
| ★★★★★ | Extreme | Plus the police helicopter (needs a heliport). |

- Police units come from **real police stations** via the road network. No station = nobody comes (V1 rule). Coverage gaps are real escape routes.
- Escape by breaking line of sight; stars decay over time.
- **Caught:** fine scaled by stars, a night in the cells (time skips to morning), vehicle impounded (pay at the police station to recover it).
- **"Wasted":** the avatar never dies; it wakes at the hospital with a bill.
- **Witnesses remember.** Villagers who see an offence store a memory about the Founder, which shifts reputation (§10) and their chats.
- Hurting villagers injures them (they go to hospital, §9.1); villagers cannot be killed by the player.

### 4.5 Phone

Diegetic UI, opened with one key/button:

| App | Function |
| --- | --- |
| Map | Full map, GPS route with on-road arrows, pins from news and toasts. |
| Wallet | Balance, income, purchases, fines. |
| Jobs | Start or end a shift; job board with current openings. |
| Ride | Hail a taxi (real cab from a taxi stand); transit timetables. |
| PVTV | News feed, breaking stories, stock ticker. |
| Contacts | Villagers you've met; call or chat (AI chat). |
| Tasks | The V1 task book. |
| Camera | Photo mode (§10). |
| Planner | Jump to aerial build view. |
| Settings | Settings shortcut. |

---

## 5. The world in 3D

### 5.1 Scale and coordinates

- **1 tile = 8 m.** The 256 × 256 map is ~2 km across. A V1 two-tile avenue is a 16 m street (two lanes + sidewalks); a 2×2 house sits on a 16 m plot.
- The simulation keeps working in **tile coordinates** so V1 logic and numbers stay valid. The renderer maps tiles to metres (Y-up).
- World is split into **16 × 16-tile chunks** (128 m) for mesh batching, culling and rebuilds on edit.

### 5.2 Terrain

- Buildable land stays flat (keeps V1's grid rules and roads simple).
- **Mountains** become real sculpted massifs over V1's 11×11 rock footprint, with hiking trails and summit torches at night.
- **Water** (lakes, rivers, ponds, sea) is an animated surface at a set level; drought lowers it visibly, floods raise a plane over streets.
- **Sand** beaches along the sea, trees as instanced low-poly species with seasonal looks.
- **Off-map edges:** the V1 country roads entering from the west and north become **highways** to other cities; the rail line and sea lanes also exit the map (§13).

### 5.3 Buildings

- Each catalog type gets a **procedural low-poly builder** using V1's language: wall and roof palettes, gable/flat/tower styles, windows that glow at night, signs, awnings, AC units, chimneys.
- **Facing (new):** buildings face N/E/S/W. In Planner, `R` rotates; by default the door faces the nearest road. The sim computes the door tile from the facing (V1 always used south).
- **Visible lifecycle:** construction site → foundations → scaffold & crane → finished; upgrades add real floors (house → family house+ → villa); renovation scaffolds; fire with smoke; ruins and rubble; snow on roofs in winter; festival lights.
- Door tile, footprint, jobs, opening hours and visit type come straight from the V1 catalog.

### 5.4 Catalog (extended)

Each entry keeps V1 fields (`name, cat, w, h, jobs, hours, wkd, visit, res, fams, cars, needsWater, sandOk`) and gains:

| Field | Purpose |
| --- | --- |
| `style` | Procedural 3D style parameters. |
| `interior` | Which interior template (§8). |
| `skill` | Education needed for its jobs (§9.3). |
| `goods` | Goods produced/consumed/sold (§9.2). |
| `power` | Power demand or capacity (§9.4). |
| `playableJob` | Shift type the player can work here (§11). |

The full list of 87 placeable types is in [Appendix A](#appendix-a--building-catalog).

### 5.5 Streets

Derived from the road grid: lane markings, sidewalks with kerbs, junctions, **traffic lights** (V1 `signals`, still on real-time 8 s phases), **level-crossing gates** (V1 `crossings`), bridges where roads cross water, street lamps, bus shelters, parking bays, trees, benches, bins, post boxes.

---

## 6. Time

| Setting | V1 | Next Dimension |
| --- | --- | --- |
| Game minutes per real second (1×) | 4 | **1** (day ≈ 24 real min) |
| Aging | 1 year per day | **1 year per 7 days** |
| Year | 28 days | 28 days (unchanged) |
| Elections | every 28 days | unchanged |

- Durations in V1 are expressed in game-minutes or days, so most logic ports unchanged. Anything that assumed "a year per day" (age thresholds vs. pregnancy, dating, retirement timings) is reviewed so lives still feel paced.
- **Speed control:** pause / 1× / 2× / 4× / 8× in Planner. In Street mode speed is capped at 1× (a running avatar at 8× would be absurd); use **wait / sleep** at a bench or the Lodge to skip time.
- **Idle progress** (V1's background ticker) is kept: the village keeps living while the tab is in the background.

---

## 7. Villagers and vehicles in 3D

### 7.1 Level of detail

| Tier | Distance from player | Representation |
| --- | --- | --- |
| Near | < ~150 m | Full animated character / vehicle on the lane graph, local avoidance, reacts to the player. |
| Mid | ~150–400 m | Instanced low-detail meshes, simplified animation. |
| Far / off-screen | beyond | Pure simulation along tile paths (V1 behaviour), no rendering. |

Budgets (tuned per quality preset): desktop ~150 animated people + ~100 vehicles near; mobile about half.

### 7.2 Movement

- Sim agents keep V1's `trip.path` + `prog` model. Near the player, the renderer turns tile paths into **lane-accurate positions** (vehicles keep right, pedestrians use sidewalks — V1 already hugs the kerb).
- **Traffic AI (near tier):** car-following with safe gaps, stopping at red lights and closed gates, yielding at junctions, queueing behind the player, honking, swerving. Collisions with the player raise V1's crash incident (tow trucks, onlookers).
- Pedestrians use crossings, avoid each other and the player, open umbrellas in rain, walk dogs, form real queues at bus stops and venues.

### 7.3 Faces and feelings

V1's mood bubbles become expressions and body language: a slumped walk when unhappy, a wave to friends, a wave or a glare at the Founder depending on reputation.

---

## 8. Interiors

Twelve templates, re-themed (palette, props, signage, layout variant) per building type:

| # | Template | Used by |
| --- | --- | --- |
| 1 | Home | cottage, house (3 levels), mansion, apartments, row houses |
| 2 | Shop | shop, supermarket, mall, department store, all specialty shops, showrooms |
| 3 | Food & drink | restaurant, café, bakery, pizzeria, ice-cream, fast-food brands, tea stall |
| 4 | Office | office, skyscraper, bank, stock exchange, post office, TV station |
| 5 | Workshop & factory | factory, all industry, warehouse, power plant, auto garage, laundromat |
| 6 | Classroom | school, college, library |
| 7 | Hospital | hospital, pharmacy |
| 8 | Police | police station (with cells) |
| 9 | Fire station | fire station (engine bay) |
| 10 | Terminal | train station, airport, dock, heliport, bus/taxi depot |
| 11 | Venue hall | cinema, theater, museum, casino, arcade, gym, pool, stadium concourse |
| 12 | Civic hall | town hall, courthouse, church, temple |

- Entering a door loads the interior as a separate small scene; the street keeps simulating.
- **Occupants are real:** whoever V1's `inside` counters say is in the building is spawned inside — the workers at their posts, the customers at the counter.
- Interactions: buy, order, sit, use (ATM, ticket machine), talk, start a shift.
- Farms, parks, plazas, zoo, amusement park and stadium are **outdoor** venues you walk into rather than interiors.

---

## 9. New simulation systems

### 9.1 Health & ambulances

- Villagers gain **health** (0–100). Injuries come from crashes, fires, fights, disasters and player violence; illness comes in seasonal waves (winter flu) and rises with age.
- Hospitals have **beds**; **ambulances** are dispatched from hospitals over the road network, exactly like V1's fire trucks.
- Recovery takes days in hospital (or longer at home without one). A town without a hospital suffers worse recoveries and a mood hit — giving V1's existing "hospital need" real teeth.
- Old-age death stays V1's logic, now informed by health.
- Playable job: **paramedic**.

### 9.2 Supply chain

Four goods categories keep it readable:

| Goods | Produced by | Consumed by |
| --- | --- | --- |
| Food | farm, cannery, fish market, bakery | supermarket, market, restaurants, cafés, food shops |
| Materials | sawmill, brickworks, steelworks, glassworks | **construction sites**, hardware, furniture |
| Textiles | textile mill | tailor, department store, mall |
| Products | factory | shops, electronics, toy shop, department store |

- Producers fill stock; **delivery trucks** (visible on the roads) carry goods to warehouses and shops; **freight trains** (V1's freight service) carry bulk between stations.
- Shops sell from stock: empty shelves when short, rising prices, fewer happy customers.
- Construction consumes materials — sites stall when materials run out.
- Shortfalls are **imported** from off-map cities (costlier); surpluses are exported for treasury income.
- Feeds V1's stock tickers (AGRI, INDL, RETL…).
- Playable job: **delivery driver / trucker**.

### 9.3 Education that matters

- Levels: none → school → college degree.
- Kids graduate from school; jobless adults attending college (V1 behaviour) earn a degree after enough days; ambitious villagers enrol on purpose.
- Skilled jobs require a degree: hospital doctors, bank, stock exchange, airport pilots, college lecturers, power-plant engineers, TV station, office/skyscraper management.
- Skilled wages are higher; a town without a college imports its skilled workers (they move in) or leaves posts empty.

### 9.4 Power & blackouts

- Each building has a **demand**; each power plant has a **capacity**. Grid modelled per district (chunk clusters), no wires to lay.
- Overload or storm faults (lightning, heavy rain, tornado, earthquake) **black out a district**: windows, street lamps and **traffic lights go dark** (crash risk rises), shops close early.
- Repair crews drive out from the power plant. Playable job: **electrician**.
- V1's water tower keeps its current role (bills, mood).

---

## 10. New player-facing features

| Feature | Design |
| --- | --- |
| **Reputation** | Every villager holds a personal opinion of the Founder (−100 villain … +100 hero) built from memories of what they saw or heard (gossip spreads it, like V1 knowledge). Town-wide aggregate shown in the HUD. Drives greetings, street reactions (wave, avoid, call the police), small shop discounts or refusals, and chat tone. |
| **Vehicle ownership** | Buy cars and motorcycles at the showrooms (prices in V1's range); refuel at gas stations (fuel gauge); repair damage at the auto garage; park anywhere legal (illegal parking → ticket, eventually towed); keep them at the Lodge. Owned vehicles persist in the save. |
| **In-game phone** | See §4.5. |
| **Photo mode** | Pause the world, free camera, depth of field, filters, time-of-day and weather preview, hide HUD, save PNG. |

---

## 11. Playable jobs (shifts)

You take a shift from the phone's Jobs app or at the workplace. Each shift is a short loop of real tasks the simulation already generates, pays by performance, and changes the world.

| Job | Workplace | Shift loop | Effect on the village |
| --- | --- | --- | --- |
| Firefighter | Fire station | Drive the engine with sirens, hose the blaze, rescue | Saves buildings V1 would otherwise lose |
| Police officer | Police station | Patrol, answer alarms/disputes, chase and arrest burglars | Arrests, safety stat |
| Paramedic | Hospital | Ambulance runs, stabilise, deliver patients | Faster recovery |
| Taxi driver | Taxi stand | Ride-hail fares with real villager destinations | Fares to the stand |
| Bus driver | Bus stop network | Drive the loop, stop at shelters, board the real queues | Commuter satisfaction |
| Train driver | Train station | Drive a service (local/commuter/express/freight), obey signals, keep the timetable | Ridership, freight delivery |
| Pilot | Airport | Take off, fly to an off-map city, land | Tourists and trade |
| Delivery / trucker | Warehouse, factories | Pick up and drop goods | Shop stock (§9.2) |
| Electrician | Power plant | Repair faults in blacked-out districts | Lights back on (§9.4) |
| Construction worker | Any site | Haul materials, operate the crane | Speeds construction |
| Shop worker / chef | Shops, restaurants | Serve the real customers inside | Business health |
| PVTV reporter | TV station | Rush to incidents, film, file the story | Headlines on PVTV |
| Farmer | Farm | Plant, harvest, drive the tractor | Food supply |

Shifts never replace a villager's job: you work alongside the staff (or cover an empty post).

---

## 12. Villager AI chat

### 12.1 Experience

Walk up to anyone (or call a contact) and talk freely. Villagers answer in character, about their own lives, the town and you — *the Founder*, the stranger around whom buildings seem to appear.

### 12.2 Architecture

```
browser                                   Vercel serverless           Groq
───────                                   ─────────────────           ────
ContextBuilder(villager, world, founder)
  → POST /api/chat {context, history, msg} → api/chat.ts ─────────────→ chat completion
                                              (holds GROQ_API_KEY,       (model from GROQ_MODEL)
                                               rate limits, prompt)
  ← {reply, effects}                       ←
EffectsValidator → Mind (memory, bond, knowledge)
```

- **The key never reaches the browser.** It lives in `.env.local` (gitignored) for local dev and in Vercel's environment variables in production.
- **Context** (compact, ~1–2k tokens): name, age, family, job & wage band, savings mood, traits, current mood and why, recent memories, closest friends, favourite places, what they know, their view of the mayor (V1 voter quality), recent PVTV headlines, weather/time/place, and **everything they remember about the Founder** plus their reputation score.
- **System prompt rules:** stay in the world; never mention AI, games or players; the Founder is a mysterious, powerful local legend; speak as this person with their traits; short replies; no graphic content.
- **Effects:** the model may propose small structured effects — a bond change with the Founder, a new memory ("the Founder asked about the bakery fire"), learning of a place, a mood nudge. The client **validates and clamps** them before applying, so chat can never break the simulation.
- **Limits:** one request in flight, per-session rate limit, short history window. When the free tier is exhausted or offline, villagers fall back to **mind-driven template lines** generated from the same context.
- Conversations are summarised into a single memory per chat, so villagers remember talking to you without bloating saves.

---

## 13. Off-map world and travel

| Gateway | Inbound | Outbound (you) |
| --- | --- | --- |
| Highways (west, north) | Tourists, new families, goods trucks | Drive away → travel screen → another city or back |
| Railway exits | Freight, visitors, commuters | Board a train to another city |
| Sea lanes (dock, ferry) | Fishing, ferry visitors | Ferry trips |
| Airport | Tourists, skilled migrants | Buy a ticket, board, fly (cinematic), arrive or return |

Other cities are **destinations, not maps**: a short cinematic and a time skip, with a small event on the way (souvenir, news, a job lead). They act as the source/sink for migration, tourism and trade.

---

## 14. Controls

| Action | Keyboard + mouse | Gamepad | Touch |
| --- | --- | --- | --- |
| Move | WASD | Left stick | Left virtual stick |
| Look | Mouse | Right stick | Drag right half |
| Sprint / jump | Shift / Space | L3 / A | Buttons |
| Interact / enter | E | X | Context button |
| Enter/exit vehicle | F | Y | Context button |
| Accelerate / brake | W / S | RT / LT | Pedals |
| Toggle 1st/3rd person | V | R3 | Button |
| Phone | Tab | Select/Back | Phone button |
| Planner | P | Start → Planner | Phone app |
| Pause / speed (Planner) | Space, 1–5 | D-pad | HUD buttons |

All input goes through an **action map**, so bindings are rebindable and every device drives the same actions.

---

## 15. HUD and UI

- Carried from V1: clock & date, season, weather (+ next), village tier, population, jobs, wealth, safety, happiness, leader chip, task book, PVTV, R/C/I demand, minimap, clickable toasts (now: set a GPS pin or fly the Planner camera there), villager inspector, building cards, mayor's report with tax policy, history charts, settings.
- New: wallet, wanted stars, reputation, speedometer/fuel in vehicles, interaction prompts, shift objective panel.
- Street HUD is minimal; Planner HUD is V1's full dashboard.

---

## 16. Saves

- **Format v5**, stored in IndexedDB (worlds are larger than localStorage allows): 3 named slots + rolling autosave + export/import to file — as V1.
- Saves everything V1 saves (world, buildings with stable ids, people, minds, government, journal) plus facings, health, education, stock levels, power state, Founder (wallet, vehicles, reputation memories, wanted state cleared on save).
- **V1 import:** a V1 v4 save is placed in the centre of a new 256² map (offset 64, 64), surrounding terrain generated to match (sea continues along the south). People, minds, ownership and the mayor survive.
- Failed loads roll back to the running game (V1 behaviour).

---

## 17. Technical architecture

### 17.1 Principles

- **Headless sim.** `src/sim` has no imports from Three.js, the DOM or the player code. It advances on a fixed step and talks to the rest only through **commands** (place building, start shift, player offence…) and **events** (fire started, election won…). This makes it testable in Node, movable to a Web Worker, and ready for a co-op server later.
- **Renderer reads, never writes.** The render layer reflects sim state; anything that changes the world goes through a command.
- **Data-driven catalog.** Buildings, jobs, goods, interiors and prices come from tables, not code paths.

### 17.2 Repository layout

```
/
├─ index.html
├─ src/
│  ├─ sim/        headless simulation (world, catalog, agents, mind, gov, life,
│  │              calamity, festivals, weather, news, tasks, economy, health,
│  │              supply, education, power, founder)
│  ├─ render/     Three.js: terrain, chunks, procedural buildings, people,
│  │              vehicles, interiors, sky, weather, lights, VFX, LOD
│  ├─ player/     avatar controller, vehicle physics, cameras, wanted, shifts
│  ├─ ui/         HUD, planner palette, phone, inspector, modals
│  ├─ input/      action map: keyboard/mouse, gamepad, touch
│  ├─ audio/      procedural + positional audio
│  ├─ save/       IndexedDB slots, v5 schema, V1 importer
│  └─ ai/         chat client, context builder, effect validator, templates
├─ api/
│  └─ chat.ts     Vercel serverless proxy to Groq
├─ public/assets/ CC0 models (glTF) + LICENSES.md
├─ tests/         Vitest: sim unit tests, V1 parity tests, multi-day soak tests
└─ docs/          this document, milestones
```

### 17.3 Tooling

Vite · TypeScript (strict) · Three.js · Rapier (WASM) · Vitest · ESLint + Prettier · Vercel (static site + `api/` functions).

### 17.4 Performance

- Static geometry merged per chunk; instancing for trees, lamps, props, people and cars.
- Frustum + distance culling; cascaded shadows near the player only.
- Night lighting: emissive windows and lamp glow, real lights only for the closest sources (headlights, sirens, fires).
- Quality presets (Low / Medium / High) with automatic detection; mobile defaults to Low.
- Sim heavy passes (grievance survey, coverage, planning) stay throttled as in V1.

### 17.5 Testing

- **Parity tests:** port V1 behaviours with tests (auto-road shapes, election outcomes for fixed seeds, coverage gaps, civic caps, business failure…).
- **Soak tests:** run the headless sim for 100+ in-game days in Node and assert invariants — no NaN money, no leaked cars, no orphaned tasks, head-counts never negative (V1's historic bug classes).

---

## 18. Audio

V1's procedural WebAudio (ambience, bells, sirens, fireworks) is kept and made **positional**: sirens approach and pass, engines rev, rain is louder outdoors, interiors muffle the street, carols drift from the Christmas tree.

---

## 19. Content and tone

- V1's mature storylines remain (murder, trials and capital sentences, despair, gambling losses) and are told through news, toasts, memories and aftermath — **never shown graphically**.
- Player crime exists (§4.4) with consequences in the world and in villagers' minds.
- AI chat inherits the same rules: in-character, no graphic content, no fourth-wall breaks.

---

## 20. Resolved questions

All confirmed on 2026-10-23.

| # | Question | Decision |
| --- | --- | --- |
| 1 | Can the player kill villagers? | **No.** Violence injures; villagers go to hospital. Keeps the persistent minds and families meaningful. |
| 2 | Where will V2 be hosted? | `pixelville.next.houseofnamus.com`, on Vercel. |
| 3 | Founder's Lodge as spawn/garage? | **Yes** (§4.3). |
| 4 | Building facing / rotation in Planner? | **Yes** (§5.3). |
| 5 | Fast-forward in Street mode? | **Capped at 1×**; wait/sleep to skip time (§6). |
| 6 | Planner locked while wanted? | **Yes** (§4.1). |
| 7 | Which Groq model? | Chosen at implementation time from Groq's free-tier models; changeable via `GROQ_MODEL`. |
| 8 | Can the Founder run for mayor? | **No** — elections stay the villagers' own. The Founder influences them through reputation and conversation. |

---

## Appendix A — Building catalog

87 placeable types from V1 (plus two hidden house upgrade levels: *Family House +* and *Family Villa*). Footprints are in tiles (1 tile = 8 m).

| Category | Types (footprint · jobs) |
| --- | --- |
| Residential | House 2×2 · Cottage 2×2 · Apartments 3×3 · Row Houses 3×2 · Mansion 3×3 |
| Work & industry | Office 3×3·12 · Skyscraper 4×4·48 · Factory 4×3·16 · Airport 13×8·30 · Farm 7×5·8 · Steelworks 5×3·22 · Sawmill 4×3·10 · Brickworks 3×3·8 · Textile Mill 4×3·14 · Cannery 3×3·10 · Glassworks 3×3·8 · Warehouse 4×3·6 · Power Plant 4×4·10 · Stock Exchange 3×2·14 |
| Shops & services | Shop 2×2·3 · Supermarket 3×2·6 · Mall 5×3·24 · Departmental Store 4×3·18 · Restaurant 2×2·5 · Café 2×2·3 · Bakery 2×2·3 · Hotel 3×3·10 · Bank 3×2·6 · Gas Station 2×2·2 · Pharmacy · Barber Shop · Florist · Bookshop · Butcher · Tailor · Electronics Store · Toy Shop · Jeweler · Pet Shop · Ice-cream Parlor · Pizzeria · Arcade · Laundromat (all 2×2) · Hardware Store 3×2 · Furniture Store 3×2 · Auto Garage 3×2 · Car Showroom 4×2·6 · Motorcycle Showroom 2×2·4 · Tea & Smoke Stall 1×1·1 · Fish Market 2×2·4 · Fast-food chains (Burger Kingdom · MacRonny's · Crispy Cluck Chicken · Taco Belle · Pizza Palace, each 4×2·6) |
| Civic | School 4×3·8 · College 5×3·15 · Hospital 4×3·14 · Police 3×2·6 · Fire Station 3×2·6 · Town Hall 3×3·8 · Church 3×3·3 · Temple 3×2 · Library 3×2·4 · Courthouse 4×3·10 · Post Office 2×2·4 · Water Pump & Tower 2×2·2 · TV Station (PVTV) 3×2·8 |
| Leisure | Park 4×4 · Playground 2×2 · Amusement Park 6×5·10 · Stadium 9×6·16 · Cinema 3×3·6 · Theater 3×3·6 · Museum 3×3·5 · Gym 2×2·3 · Swimming Pool 3×2·2 · Grand Park 7×6 · Town Plaza 4×4 · Zoo 6×5·8 · Casino 3×3·10 · Boat Club 3×2·3 |
| Transport | Bus Stop 2×1 · Taxi Stand 2×1·4 · Train Station 6×3·12 · Dock 3×2·6 · Heliport 5×5·6 · Railway (drag tool) |
| Terrain & tools | Forest · Pond · Lake · River (drag) · Mountain (11×11) · Road (drag) · Bulldoze (drag) |

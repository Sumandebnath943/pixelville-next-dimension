# PixelVille — Next Dimension · Milestone Plan

> Companion to [DESIGN.md](DESIGN.md). New to the project? Start with [HANDOFF.md](HANDOFF.md). Each milestone ends with a playable, deployable build.
> Order follows dependencies: later jobs need the systems they run on (paramedics need health, electricians need power, train drivers need rideable trains).

| # | Milestone | Headline |
| --- | --- | --- |
| 1 | **Living town** | All V1 simulation in a 3D town you can walk, drive and build |
| 2 | **Street life** | Own vehicles, real traffic, wanted level, reputation, phone, photo mode |
| 3 | **Doors open** | Interiors and villager AI chat |
| 4 | **Deeper village** | Health, supply chain, education, power |
| 5 | **Going places** | Ride every transit line; travel off-map |
| 6 | **Work shifts** | All playable jobs (done) |
| 7 | **Launch polish** | Mobile tuning, performance, balance, accessibility, launch (built; the deploy waits on the owner) |

---

## Milestone 1 — Living town

**Goal:** everything V1 does, running in 3D, with the Founder walking and driving through it and able to build from the sky.

**Status (2026-10-23): playable, not yet deployed.** Done: 1a–1h below, except the Vercel deploy. Deviations from the design, to revisit:

- **Characters and vehicles are procedural low-poly models**, generated in code like V1's sprites, instead of CC0 model packs. That means no downloads and no licensing. Rigged models can replace them later without touching the sim.
- **No Rapier yet.** V1's world is a tile grid of rectangular plots, so walking and driving use a light custom collision against building boxes, tree trunks, water and the map edge. Rapier can come in M2 if crashes and pursuits need real physics.
- **The sim modules are ported verbatim with `// @ts-nocheck`.** The new client code is strictly typed; a typing pass over `src/sim` (shared entity interfaces) is pending. *(Done 2026-10-26: `src/sim/types.ts`, no file unchecked; see below.)*
- **Sounds are not yet positional**, and there is no separate mid-distance LOD tier: everything within range is instanced at full detail. *(Positional one-shots done 2026-10-26; see below.)*
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

### Milestone 1 leftovers, finished 2026-10-26
- **The typing pass**: `@ts-nocheck` is gone from all ten V1 modules. `src/sim/types.ts` holds the shared entity types (`Building`, `Person`, `Car`, `XY`: the fields the game leans on, typed, plus an open index for the long tail); all 697 untyped parameters are typed (buildings and people by what they iterate over, the rest by what they are), string-keyed tables are records, and nullable `work`/`at` are explicit. No behaviour changed (the tests are the same). The module objects (`World`, `Sim`, `Life`…) are still `any`: the next level.
- **Positional sound**: the sim's sounds say where they happen, and the audio engine plays each through a gain and a stereo panner set from the listener (the Founder on the street, the view's centre in the Planner, the camera in photo mode) and the camera's heading: quieter with distance, silent beyond each sound's reach (a crash 170 m, a siren 340 m, the church bells 750 m, fireworks 1.1 km), panned to its side, centred when close. Horns and the police chasing you are positional too; the 9:00 and 18:00 bells ring from the church or temple. Subtitles caption only what's actually heard. Covered by `tests/controls.test.ts` (a grand opening dings at the new shop).
- **Checked end to end in the game** (the 156-villager test town, then a brand-new village): a conversation; buying a flat white at the café counter ($3 to its till); driving the saloon, a parking ticket and a tow for leaving it in a junction, collecting it from the impound ($40); placing, bulldozing and undoing a building, its card; two stars, squad cars with their sirens heard from 105 m, busted ($40, five hours, released at the station); waiting for the bus, boarding ($2) and being dropped at the chosen stop; a road trip to Westmere with a souvenir and "while you were away"; photo mode (paused, saved); a save and load round trip (516 KB, everything back); every phone app, the task book and the history chart; a firefighter shift (the call came to the Founder, the fire out in 21 s, $34 at four stars); a new village with the guide, two houses built and six people in within 32 s at 8×. No console errors.

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

## Milestone 2 — Street life (done 2026-10-24: 2a–2f below)

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

### 2e · Reputation (done 2026-10-24)
- **An opinion per villager** (`src/sim/reputation.ts`), from −10 ("can't stand you") to +10 ("adores you"), saved with their mind. It moves with what they see or suffer: knocked down by the Founder's car −6, their car wrecked −4, their car stolen −4 (once they know it was the Founder: a witness, or the police catching you in it), seeing a hit-and-run −3, a crash, a theft or an attack on the police −2, an arrest −1, the Founder's driving −0.5. Good deeds count too: bringing a lost dog home +4, joining the bucket line at a fire +3, helping at a crash +1, and staff warm to a paying customer (up to "likes you"). Cautious villagers take a bad turn harder. Views cool about 3% a night. Saves from before 2e rebuild each opinion from the Founder stories the villager already remembers.
- **Stories travel**: each story carries a short gist ("…that the Founder knocked Tomas down with their car"). When neighbours stop to chat in the street, and when families sit down at night, the freshest story (up to a week old) passes on, at most three times along the chain. The listener's view moves toward the teller's, more so between friends. A bad story never makes anyone like the Founder more, even from a fan. With a TV station, PVTV carries crashes, people knocked down, big chases, arrests and help at fires to every home.
- **In the street**: villagers who like the Founder wave (👋, 😄 for fans) and now and then say good morning; those who don't scowl (😒, 😠) and hurry past. Witnesses who can't stand the Founder report even their driving ("a villager who can't stand you called it in"); loyal fans look the other way for anything short of a hit-and-run or an attack on the police. While wanted, anyone who dislikes the Founder and spots them tells the police where they are (📞), which resets the escape gauge.
- **Shops and services**: what the staff think sets the price at the gas station, the auto garage and the showrooms: 10% off from staff who like the Founder, 20% from fans, and no service at all from staff who can't stand them (the showroom says so, the pumps and the mechanics refuse, a shop won't sell a scratch card).
- **Where it shows**: a pill next to the wallet with the village's view in a word (A newcomer, Well liked, Beloved, Mixed feelings, Disliked, Notorious) and a meter either side of indifference; a villager's card shows what they think of you and the last thing they saw or heard; a business's card shows what its staff think, and any discount.
- Covered by `tests/reputation.test.ts` (opinions, hearsay and its limits, families, cooling and saves, the town's label, prices, PVTV) and `tests/wanted.test.ts` (informers, loyal fans, tip-offs).

### 2f · Photo mode (done 2026-10-24)
- **Opening it**: <kbd>F2</kbd> on the street, or the phone's Camera app. The world pauses: the clock, villagers and traffic stop, and the animation clock does too, so rain hangs in the air and the river stops. Even the idle catch-up while the tab is hidden waits. The interface steps aside for a panel (`src/ui/photopanel.ts`); <kbd>H</kbd> hides that too, and <kbd>Esc</kbd> or <kbd>F2</kbd> leaves.
- **Free camera** (`src/player/photo.ts`): <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> fly along the view, <kbd>E</kbd>/<kbd>Q</kbd> up and down, <kbd>Shift</kbd> faster, drag to look, wheel to zoom. It stays within 60 m of the Founder and above the ground, and the Founder is in the picture even if you were in first person.
- **Lens and exposure**: the zoom reads as a full-frame focal length (12 mm–114 mm); exposure compensation is ±2 stops on top of the auto-exposure.
- **Depth of field**: a bokeh pass, created the first time it's switched on and inserted in HDR before tone mapping, so bright lamps blur into soft glows rather than grey smudges. Click the picture to focus there: a 1×1 render under the cursor measures the distance. A focus slider runs 0.5–500 m, plus a blur amount.
- **Looks**: Natural, Vivid, Golden, Cool, Faded, Mono, Noir and Sepia, applied on top of the weather's own grade (saturation, contrast, tint, lifted blacks, vignette, grain).
- **Preview**: any hour of the day, with the sky, sun, auto-exposure, lit windows and lamps following it, and any weather (clear, cloudy, rain, storm, snow), with wet or snow-covered streets to match. Everything returns to the real time and weather on the way out.
- **Saving**: <kbd>Enter</kbd> or the button saves the frame as a PNG at the canvas's full resolution, named after the village, day and time (e.g. `Little-Brook-day12-0705.png`), with a shutter flash, and puts a copy in the phone's camera roll.
- Covered by `tests/photo.test.ts` (the lens, the tether and floor, previews put back, looks over the weather, file names).

---

## Milestone 3 — Doors open (done 2026-10-24: 3a–3d below)

- **Interiors:** the 12 templates, themed per building type; enter/exit transitions; real occupants from the sim; buy, order, sit, ATM, ticket machines.
- **Villager AI chat:** `api/chat.ts` Groq proxy, context builder, in-world Founder persona rules, validated effects (memory, bond, knowledge, mood), rate limiting, conversation summaries saved to minds.
- **Template dialogue** fallback driven by the same context.
- **Phone Contacts:** villagers you've met; call or chat remotely.

**Done when:** you can walk into the bakery, buy a pastry from the real baker, ask them about last week's fire, and they remember the conversation tomorrow. *(Checked in the test town: Greta Ali served a croissant at the Bakery counter, answered about the fire at the Bank, and on the phone the next morning said "You were asking me about the fire at the bank yesterday — I've been thinking about it since.")*

### 3a · Interiors
- **Rooms** (`src/interiors/plan.ts`): twelve templates (home, shop, food & drink, office, workshop, classroom, hospital, police, fire station, terminal, venue, civic hall) re-themed per type: wall and floor (wood, tile, stone, carpet, concrete), accent colours, wares, signs, and layout variants (a bakery's glass case and oven, a fast-food menu board, a bank's teller counter and cash machine, the PVTV news set, a car on the garage lift, the fire engine in its bay, a church's pews, altar and stained glass, cinema rows and screen, the station's departure board and ticket machines…). 81 building types open into a room; parks, plazas, farms, the zoo, bus stops and nature stay outdoors. A room is laid out from the building's own seed, so it's the same every visit, and plain data (furniture boxes, what you can't walk through, staff posts, customers' places, counters, seats, machines, lights), which is tested without WebGL.
- **Drawing** (`src/render/interior.ts`): a small scene of its own through the same post-processing. Textured floors, plaster walls, a front wall with glazed doors and windows that glow with the light outside (bright by day, dark at night), furniture merged per surface, ceiling lamps (four cast light, the rest glow), a shadowed daylight from the windows, a soft room environment for reflections. The street keeps simulating outside, unseen.
- **Going in** (`src/player/indoors.ts`): at a door, <kbd>E</kbd> goes in (a quick fade, a shop bell), in first person; <kbd>E</kbd> by the door goes back out to the doorstep. Closed outside opening hours, on fire, ruined or still being built: the building's card instead. Homes: only if someone's in and the household likes the Founder ("They won't ask you in"); the Founder's Lodge always. Not with the police after you. If it catches fire or comes down while you're in, everyone's out.
- **Real occupants**: the staff the sim says are on shift stand at their posts (the first serves at the counter), customers sit at tables or browse the aisles, a family is at home; they come and go as the sim moves them (at most 14 drawn, using the detailed person model). Whoever you talk to turns to face you.
- **Using things**: the **counter** (only when someone is serving: "nobody's serving" at lunch) sells the place's own goods (a croissant at the bakery, a film ticket at the cinema, stamps at the post office: every kind of business its own list), paid into the business's till at its price less any discount the staff give the Founder (rounded in your favour), or refused; the server remembers serving you. The counter also offers "Talk to …", the building card's own actions (browse the cars, collect an impounded car, a scratch card) and "About". **Seats** (sit, stand up), the **cash machine** (balance, today, recent spending, fines owed) and **ticket machines** at stations, the airport, the dock and the heliport (tickets kept for the journeys of Milestone 5). The Lodge has the garage keys on a hook.
- **The bag** (saved): what you buy goes in it; the phone's Wallet shows it, and food and drink can be eaten or drunk from there.

### 3b · Template dialogue
- **Talking** (`src/ui/dialogue.ts`): <kbd>E</kbd> beside anyone in the street (they stop to talk) or indoors. A panel with what they say, topic buttons and a box to type in; <kbd>Esc</kbd> says goodbye.
- **Context** (`src/ai/context.ts`): who they are (age, family, job and workplace, home, two strongest traits, mood), their own recent memories, everything they remember of the Founder and their opinion, friends and favourite place, the last nine days of village news (real events first: fires, burglaries, crashes, floods, storms, weddings, elections, festivals; never "a raise at the Fire Station"), the weather, the hour and where you're talking.
- **Template lines** (`src/ai/templates.ts`): greetings by opinion (warm, cool, "What do *you* want?"), time of day and whether you've met; topics built from their life: how they are (with what's on their mind), their work (in their trade's voice), their family, what's new in town, the events in the news to ask about ("Ask about the fire at the bank"), their own big news, what people say about you, where's good to go. Someone who can't stand you won't chat. A typed line without the AI goes to the nearest topic, or gets a shrug.
- **Remembered** (`src/ai/memory.ts`): one memory per conversation ("talked with the Founder about the fire at the bank"), a record of meeting you (first and last day, how often, what about) that their greeting brings up next time, and a slightly warmer view after a friendly chat (once a day).

### 3c · Villager AI chat
- **The proxy** (`api/_chat.ts`, served by the Vercel function `api/chat.ts` and, in development, by the dev server from `vite.config.ts`): the Groq key stays on the server (`.env.local` locally, Vercel's environment variables in production). The persona rules live here, not in the browser: stay in the village, never mention AI or games, the Founder is a mysterious local figure, short plain replies in your own manner, only what you'd know, no graphic content or real-world politics; the browser sends only the villager's compact context, eight turns of history and the line (system turns from the browser are dropped). 12 requests a minute and 400 a day per address. `GET /api/chat` says only whether a key is set.
- **Models**: `GROQ_MODEL` if set; otherwise a small Llama model, and if Groq has retired it, a current chat model from Groq's own model list (on this account: `openai/gpt-oss-20b`, asked for low reasoning effort). Models without JSON mode are asked again in plain text, and answers wrapped in prose or cut off part-way are still read.
- **Effects**, validated and clamped (`src/ai/effects.ts`): opinion of the Founder (±1 a turn, at most −2…+1.5 a conversation), mood (±5), a short memory, and a place they've now heard of; anything else is ignored. The model's memory, if any, becomes the conversation's.
- **The client** (`src/ai/client.ts`): asks once whether chat is on; one request in flight, 8 a minute, 150 a session, a 12 s timeout; on any failure that line falls back to template dialogue, and without a key the whole session does.

### 3d · Phone Contacts
- **Contacts** on the phone: everyone you've talked to, most recent first, with their job, when you last talked and what about, and what they think of you. **Call** opens the conversation on the phone (nobody picks up between 23:00 and 06:30); **Find** routes the GPS to where they are now (the building they're in, or where they're walking).
- The villager card shows how often you've talked and about what.

**Not in 3: (a) "start a shift" at the workplace arrives with the playable jobs of Milestone 6; (b) boarding with the tickets you buy arrives with Milestone 5; (c) photo mode works outdoors only.**
- Covered by `tests/interiors.test.ts` (every type has a reachable room, deterministic layouts, door rules, buying) and `tests/chat.test.ts` (news topics, template answers, memory and next-day greetings, clamped effects, the proxy: key, limits, persona, retired models, broken JSON).

---

## Milestone 4 — Deeper village (done 2026-10-24: 4a–4e below)

- **Health & ambulances:** health, injuries, seasonal illness, hospital beds, ambulance dispatch, recovery.
- **Supply chain:** food, materials, textiles, products; stock in producers and shops; delivery trucks; freight trains; construction consuming materials; imports/exports; prices and shortages; tickers.
- **Education:** school → degree; skilled jobs gated; skilled migration.
- **Power & blackouts:** demand vs. capacity, district blackouts, dark traffic lights, repair crews.
- Rebalance V1 economy and needs around the new systems.

**Done when:** a storm blacks out a district, an accident there sends a villager to hospital by ambulance, and a materials shortage visibly stalls a construction site — all from simulation, not scripts. *(Covered end to end by `tests/deeper.test.ts`: lightning strikes a district's substation, its junction's lights go out, two villagers' cars collide there, a hurt driver is treated in the road and taken to the ward by ambulance; and a building boom with nothing made in town and the day's imports spent stalls its sites. Checked in the browser too: rolling blackouts in the test town, the ambulance crew at a casualty, an idle building site with its card saying why, a delivery truck bringing the load, a dark traffic light, the repair van at work.)*

### 4a · Health & ambulances
- **Health** (`src/sim/health.ts`): every villager has health (0–100, lower in old age) and sometimes a condition. Colds and the flu come more in autumn and winter, more to the old, the young and the low, and go round the house; a flu wave arrives once a winter (now and then in autumn) with a PVTV bulletin. A badly ill elder gets pneumonia.
- **Injuries** from what already happens: a car crash (more often and worse at a dark junction), a fire (some of those inside are carried out with smoke in their lungs), a collapse, the earthquake, the tornado, a street argument that comes to blows, and the Founder's car (a nudge knocks someone down as before; at speed it's an injury). Nobody dies of an injury.
- **Ambulances**: a serious condition puts the villager on the ground (or on the pavement outside the building). The nearest hospital sends an ambulance by road like the fire brigade. It pulls up just short of the casualty and two paramedics treat them for a few minutes, then it drives them to the ward on blue lights. No hospital, or no road to them: after a while the neighbours help them home. The seriously ill walk in to be seen (the frail get the ambulance at their door).
- **The ward**: a hospital has 12 beds when fully staffed (at least 3); a full ward sees people in casualty and sends them home. Recovery is fastest on the ward with doctors, slower at home, slowest in a town with no hospital, where the family frets too. Patients are discharged by day, pay $14 a day (the village fund covers what they can't) and walk home. The sick stay off work and school; a pharmacy visit takes the edge off a cold. Old-age odds now follow health.

### 4b · Power & blackouts
- **The grid** (`src/sim/power.ts`): every building draws power (a home 1 per floor, an apartment block 4, a skyscraper 14, a steelworks 12…), less at night and more in the evening peak. A power plant gives up to 160 when staffed with its engineers, and the county line along the highway brings 60. Districts are 32 × 32-tile squares. When the town wants more than it has, districts take turns in the dark: rolling blackouts move on every 90 minutes, and the hospital's district goes last.
- **Faults**: a lightning flash in a thunderstorm can strike a substation; heavy rain brings trees down on the lines; ice comes with heavy snow. The tornado cuts every district it crosses, the earthquake one or two, a flood the one under water. At most three at a time.
- **Repair crews**: a van drives out from the power plant through the traffic, the linesmen work on the lines for 40–75 minutes, and the lights come back (with a toast saying how long it took). Without a power plant the county sends one from the highway an hour later; with no road at all, the county fixes it in its own time. Faults survive a save, and their crews are sent again.
- **In the dark**: windows, signs, neon and street lanterns go out across the district (a per-tile power map read by the window, sign and lantern shaders, `src/render/powermap.ts`), and street lamps cast no light. The hospital keeps its generator. **Traffic lights** are now drawn at the junctions the sim lights (red, amber, green, back to back on a post). In a blackout they go dark, drivers treat the junction as unsignalled, and they misjudge each other there. Shops and venues shut ("no power until the lights come back"), works stop producing, and families sit by candlelight (a little mood, a memory). Running a dark red light isn't an offence.

### 4c · Education
- **Schooling** (`src/sim/education.ts`): none, a school leaving certificate, or a college degree. Kids who went to school (10 days or more) leave with the certificate at 18. The jobless go to college most weekdays, and ambitious adults under 42 enrol and take two weekdays in five off work to study. A degree takes 12 days at a fully staffed college (more where it's short of lecturers). Old saves get seeded schooling.
- **Graduate posts**: half the hospital's posts (doctors), 70% of the college's (lecturers), half the school's (teachers), 40% of the power plant's (engineers), and posts at the bank, exchange, airport (pilots), TV station, courthouse, offices, skyscraper, town hall and pharmacy. Only graduates fill them, and they earn 45% more there. A graduate in an ordinary job moves to an open graduate post. A post nobody in town can fill draws a skilled family in from outside (one a day at most). Short-staffed graduate posts matter: fewer doctors heal slower, fewer engineers mean less power.
- **Essential services hire first**: in a town with more jobs than hands, a hospital, power plant, fire or police station, water tower or school that is badly short takes on two people a day from ordinary workplaces, and graduate promotions don't take people away from them.

### 4d · Supply chain
- **Goods** (`src/sim/supply.ts`): food (farms, cannery, fish market, bakery), materials (sawmill, brickworks, steelworks, glassworks), textiles (textile mill) and products (factory). Producers fill their yards while their staff are on shift (farms slow in winter and drought, nothing runs in a blackout).
- **Shops sell from their shelves**: each kind holds its own good (a supermarket 60 of food, a hardware store 30 of materials, a tailor 24 of textiles, an electronics store 30 of products…). Thin shelves cost more (up to 40%), and bare ones sell nothing: the customer goes home disappointed. The Founder's counter shows the shelves, raises its prices to match, and says "Sold out".
- **Delivery trucks**, visible in the traffic and painted by what they carry, take loads (up to 20) from yards, the warehouse or the station's goods shed to shops running low and to building sites, and the driver wheels the load in. Full yards haul to the warehouse, ship by rail (sold through the station) or export by road (income to the works and the village fund).
- **Imports**: what the town can't make comes in by truck from the map edge, dearer, and only so much a day (60 food, 40 materials, 30 textiles, 40 products; half as much again with a freight railway). The **freight train** stocks the terminus station's goods shed on every call, more of whatever is short.
- **Building eats materials**: a site needs 8 + 2.5 per tile of footprint, and the builders bring 40% with them. A site that runs out stands idle (its builders help elsewhere) with an empty yard and the crew waiting (⏳) until a load arrives. Pallets of bricks and timber stand on site as the loads come in. Shortages begin and end in the news, and the tickers feel them (AGRI, INDL, RETL).

### 4e · Rebalance and where it shows
- **The mayor**: rolling blackouts put a power plant at the top of the needs list (one plant per 120 villagers allowed now). Two or more badly hurt or ill with no ward bring a hospital forward, and a full ward asks for a second. Unfilled graduate posts ask for a college, a flu wave for a pharmacy. Shortages ask for a sawmill or brickworks, a farm or cannery, a factory or textile mill, and full yards for a warehouse. The county bills the village fund for the power it carries.
- **Grievances and votes**: blackouts, the sick with no hospital and empty shelves are reasons to protest, and they weigh on each voter (their own dark home most).
- **Cards**: a building's card shows its power (and why it's dark), its plant output, graduate posts filled, beds and who's on the ward, the shelves or the yard and what's on its way, the warehouse's store, and a site's materials, with the reason it stalled. A villager's card shows health (and how they were hurt) and schooling, and wages in graduate posts. The mayor's report adds the grid, the hospital, graduates and goods.
- **The street HUD** carries one alert line (a power cut here or elsewhere, rolling blackouts, a shortage with its waiting sites, flu season); a click opens the mayor's report.
- **Talking**: villagers know how they are, how they were hurt, their schooling and whether their lights are out (the template lines and the AI context both). "Ask about the power cut / the shortage / the flu" join the news topics.
- **Performance on the way**: footpath and road searches reuse shared scratch buffers (a cache miss used to allocate two 64k arrays, tens of milliseconds a time in a grown town), and the traffic index clears only the tiles used last frame.
- Covered by `tests/health.test.ts`, `tests/power.test.ts`, `tests/education.test.ts`, `tests/supply.test.ts` and `tests/deeper.test.ts`.

**Not in 4: the playable paramedic, electrician and delivery-driver shifts arrive with Milestone 6.**

---

## Milestone 5 — Going places (done 2026-10-25: 5a–5d below)

- **Ride everything:** board buses at shelters, trains at stations, ferries at docks, taxis via phone or rank, helicopters at heliports. Tickets from the wallet.
- **Off-map world:** highways, rail exits, sea lanes and the airport lead to named destination cities (travel cinematic + time skip + small events).
- **Flights:** buy a ticket, check in at the terminal, board, fly, arrive.
- Tourists, migrants and trade flowing through the gateways.

**Done when:** you can take the bus to the station, ride the express to the edge of the map, fly out of the airport and come back to find the village has moved on without you. *(Checked in the test town: the bus, waited for at a stop, pulls in and takes the Founder aboard for $2; a new station brought the national line, and the Intercity Express to Northbridge stood at the platform, ran out to the map's west edge with the camera aboard, and the journey screen passed the hours; the city screen, the trip home, and "while you were away" with the news missed. A flight from a new airport: check-in for the 12:30, a wait at the gate, the take-off followed out over the fields. Covered by `tests/travel.test.ts`.)*

### 5a · Riding in town
- **F at a stop, station, dock, taxi rank or heliport** opens a departures board (`src/ui/departures.ts`): what leaves from here, the fare (or "your ticket", "your pass"), and the next departure. From inside a terminal, the ticket office offers the same board ("Check in for a flight" at the airport), and you step out to the platform.
- **Buses, trains and the ferry** (`src/player/transit.ts`): you wait at the kerb (the bus doesn't stop short for you) until the village's own vehicle pulls in and stops, then you're aboard. The fare goes to the stop, station or dock, or a ticket from the bag is punched: a single, a day return or a week rover from the station's machine, a ferry ticket from the dock's. The camera rides along (drag to look around, the wheel to pull back). At each stop F gets you off, or it's automatic at the stop you chose, or at the one nearest your GPS destination. Trains go to the station you picked (locals call everywhere, the express at the ends).
- **Cabs**: call one from the phone's Ride app or take one at the rank. A real cab from the nearest rank drives to you through the traffic, waits ("F get in the cab to …"), takes you to the GPS destination (no destination: the Map opens to pick one), and you pay the meter ($3 plus a little a tile) to the rank. Then it goes back to work.
- **The sightseeing flight** from a heliport ($60, or the ticket from M3): up to 75 m, a wide circle round the village with the view swinging to the town centre, and back down to the pad.
- **The phone's Ride app**: call a cab, the timetables (the bus line, the village trains, the Intercity Express, the ferry, flights, cabs), and every city with how to get there from this village, plus a button that routes the GPS to the right gateway.

### 5b · The off-map world
- **Six cities** (`src/sim/gateways.ts`), each with its own blurb, sights and souvenir: Westmere (down the west highway, or by intercity), Northbridge (up the north highway, or by intercity), Avalon City the capital (intercity, flights, air taxi), Harbourton the port (intercity or by sea), Saltmarsh Isle (by sea) and Solano, a sunny resort (flights). Each way has a journey time and a fare.
- **The national railway**: when the village has a train station, a branch line is laid from it to the nearest map edge (west, north or east), the rails like the government builder's. The **Intercity Express** sets off for the village every three hours (07:00–22:00), runs in from the edge, stands at the platform for fourteen minutes, and runs back out; the departures board and the Ride app show when it leaves. It holds the level crossings like any train, and it's drawn in its own livery.
- **A trip** (`src/player/travel.ts`): leave from a gateway, seen in the world (ride the intercity out to the edge; watch the plane take off; the steamer sails from the dock out to sea; the air taxi lifts off; or drive your own vehicle off the end of a highway, where "E drive on to Westmere" appears). Then the **journey screen** (`src/ui/travelui.ts`): a line from here to there with the vehicle moving along it, the clock racing at home (the time skip runs the real simulation), and something on the way (a job lead that pays, the papers, a delay, a view, a chat). Then the **city**: look around (two hours: a sight, sometimes an odd job), buy its souvenir (into the bag), stay the night ($30, on your way by 08:00), or head home the same way (the fare again, unless your ticket was a return; broke, you work a day for it). The way back ends in the world again: the intercity pulls in with you aboard, the plane lands, the steamer docks, the air taxi sets down, or your vehicle comes in off the highway. Last comes **while you were away**: how long you were gone, villagers gained or lost, what was finished, what's going up, and the news you missed. The village's news notes the Founder leaving and coming back.
- **Tickets from the bag** (`src/player/tickets.ts`): the M3 machines' tickets now work. "Island day trip" is a return to Saltmarsh Isle, "Economy to the capital" a flight to Avalon City, "Weekend in the sun" a flight to Solano, "Air taxi to the city" the helicopter to Avalon City, and "Sightseeing flight" the tour.

### 5c · Flights
- At the airport (F at the door, or the check-in desk inside): flights to Avalon City and Solano, every three hours 06:30–21:30, check-in closing 20 minutes before. Checking in books the flight shown. Then wait in the terminal (E waits at the gate) until boarding, and the plane takes off from the runway with the camera following it out. Coming home, a plane comes in to land with you aboard and you step out at the terminal.

### 5d · Through the gateways
- **Visitors**: people step off the intercity (one to four on each call), the planes and the ferry, walk to the shops, sights and the hotel, spend a little more than villagers do, and walk back.
- **Newcomers**: families who move in for the jobs come in on the intercity and walk from the station to their new door; skilled families taking graduate posts fly in when there's an airport. They remember where they came from.
- **Trade**: imports already come in by truck off the highways and by freight on the national line (Milestone 4).

### Fixed on the way
- **Footpaths**: the pedestrian route search compared 64-bit costs with a 32-bit distance table, so any route through a mid-road tile was thrown away and villagers fell back to walking the carriageway (this predated Milestone 4). Footpaths now resolve.
- **Vans and trucks stuck short of their stop** call the shared "nearly there" check with their own route (a cab keeps its route under another name, and the old check crashed the frame loop).
- **"While you were away"** finds the news by when it was written (the news log keeps only its last 250 lines).
- Covered by `tests/travel.test.ts`: the national line and the intercity's timetable, visitors spending, newcomers arriving by train, the bus (including waiting by the door without blocking it), the cab and its meter, a road trip with a souvenir, a flight with check-in, the gate, take-off and landing, and a trip ticket from the bag.

**Not in 5: the bus, taxi, train and pilot shifts (driving them yourself) arrive with Milestone 6.**

---

## Milestone 6 — Work shifts (done 2026-10-25)

**What's in:** `src/player/shifts.ts` (the manager), `src/jobs/` (emergency, driving, rails, town), `src/ui/shiftpanel.ts`, the phone's **Jobs** app. Covered by `tests/shifts.test.ts` (16 tests, one per job plus booking and pay).
- **Starting**: the phone's Jobs app (routes you there; the shift starts at the door) or "Start a shift" on a workplace's card or counter. The workplace lends its vehicle at the kerb (fire engine, patrol car, ambulance, cab, bus, delivery truck, power van, builders' van, PVTV van, tractor), driven like your own and drawn as the village's own; your car waits where you left it. Planner, rides and trips are locked while on shift.
- **Calls come to you first** (`Life.claim`): fires, break-ins, street fights, crashes, casualties and power cuts go to the Founder's shift instead of the village's crews; too slow (40–90 game min) and the village's own crew goes. Blue lights exempt you from speeding and red-light offences.
- **The loops**: firefighter (hose the fire on foot; inspections cut a business's fire risk for a week), police (arrest the burglar, calm a dispute, secure a crash; beats deter crime), paramedic (treat, carry to the ward; home visits heal the sick), taxi (real villagers leaving work or venues, or at home in the day; the meter from their purse to the rank), bus (the line's real stop queues board; timetable bonus), delivery (Supply's real needs, yard to shop or site), train driver (the local's cab, stop at platforms, missed stops and buffers count against you), pilot (take off, fly off the map, journey screen and city turnaround, approach and land; visitors and import allowance), electrician (mend faults at the pole; servicing a substation cuts storm faults for a week), construction (carry loads to the scaffold, fetch materials when the pallet is bare), shop/chef (indoors: take the real customers' orders, make them at the counter, serve; they grow fond of the place), reporter (film real incidents and features, file at the station: PVTV headline; shortage stories raise the import allowance), farmer (drive the rows: harvest food to the yard, or sow/plough for +30% yield for a week).
- **Pay**: hourly standby pay plus every task, ×(0.7 + 0.1 × stars), paid at clock-off by the village fund (public services; if it's empty it owes you and pays when taxes come in) or the workplace's till (as far as it can). Stars 1–5 move with good work and failures. Record kept in the save (`FounderSave.jobs`).
- **Fixed on the way**: the travel overlay could stay stuck over the world after a trip home (a pending fade-in undid `hide()`; `src/ui/travelui.ts`).

**Checked in the game (2026-10-25):** all thirteen shifts, each through its loop: firefighter (claim, hose, building saved), police (dispute calmed), paramedic (treated, carried, on the ward), taxi (real fares, the meter), bus (the queue boards), delivery (farm to shop, 2 → 22 on the shelf), train (platform call on time), pilot (take-off, journey, city, approach, landing at the stand), electrician (fault mended), construction (a load laid), shop/chef (inside the café: order, counter, served), reporter (filmed and filed to PVTV), farmer (field harvested to the yard). Also the Jobs app, booking, the shift card and marker, clock-off pay and the village fund's IOU.

**The airfield:** the airport is 48×15 tiles: a 372 m runway along its south edge, a parallel taxiway with links at both ends, and four stands 45 m apart (airliners span 30 m), laid out once in `Life.airfield(a)` and used by the village's planes, the renderer, the passenger flights and the pilot. One plane on the runway at a time (`Life.runwayHeld` while the Founder uses it); up to three airliners stand parked, the fourth stand is the Founder's. The pilot touches down on the runway (with an automatic flare in the last 6 m) and stops on it. An airport in an older save moves to the nearest spot where the airfield fits instead of being dropped. Covered by `tests/shifts.test.ts` (18 tests).

**Polish for later:** the hose jet is faint in daylight; the train's follow camera can sit in lineside trees; work vehicles aren't solid to the Founder on foot; touch controls have no climb/descend for the plane; check the shift card on the 1366×768 laptop.

Playable shift loops with pay, performance and real effects on the sim:

| Wave | Jobs |
| --- | --- |
| 6a — Emergency | Firefighter · Police officer · Paramedic |
| 6b — Driving | Taxi driver · Bus driver · Delivery / trucker |
| 6c — Rails & skies | Train driver · Pilot |
| 6d — Town | Electrician · Construction worker · Shop worker / chef · PVTV reporter · Farmer |

**Done when:** each job can be started from the phone or the workplace, plays as a loop of real sim events, pays into the wallet, and changes the village (fires saved, arrests made, shops restocked, headlines filed).

---

## Milestone 7 — Launch polish (built 2026-10-25: 7a–7f below; the deploy itself waits on the owner)

- Mobile/touch tuning and performance presets; long-session stability.
- Balance pass across economy, growth, crime, calamities, chat costs.
- Accessibility: rebinding, subtitles for chat, colour-blind-safe HUD, motion-sickness options (FOV, head-bob, camera shake).
- Onboarding: a short first-day tutorial that founds the village with you.
- Launch at `pixelville.next.houseofnamus.com`.

**Done when:** it plays well on a mid-range phone, a laptop and with a gamepad, and a new player can found a village without reading anything.

**Where it stands:** a new player is guided through founding the village (checked end to end on a fresh village in the game); the laptop runs medium at ~9 ms of GPU a frame; a gamepad drives the street, the Planner and every menu (checked with a scripted pad: no hardware to hand); the phone layout was checked at 812×375 and 375×812 in an emulated phone, not on a real handset. **Not done:** the deploy to Vercel and the domain (needs the owner's Vercel sign-in, the Groq key in Vercel's settings and a DNS record: see [LAUNCH.md](LAUNCH.md)).

### Milestone 6 fixes (first)
- The fire hose's jet is drawn as lit slugs of water with spray where it lands (the additive glints alone vanished in daylight).
- Following a vehicle (the train's cab, a ride), the camera rises over a tree's crown rather than sitting in its leaves (`crownLift` in `founder.ts`).
- On foot, the vehicle in hand (fire engine, bus, your own car…) and the owned one left standing are solid: a capsule along each.
- Touch: ▲/▼ climb and descend on the flight deck.
- At 1366 px the top bar keeps to one row and the controls hint moves clear of the news and the map.

### 7a · Controls
- **Rebinding** (`src/input/input.ts`): every action (move, run, jump, use, vehicle, camera, phone, Planner, task book, photo, turn the door, help, climb, descend) has default keys and can be rebound in Settings → Controls (click, press the key; Esc cancels). A key taken from another action in the same group leaves that one without (the note says so); the plane's climb and descend are their own group, so they can share E/Q. Kept in this browser (`Settings.keys`), not in the village save; "Reset to the defaults". Key names follow the keyboard's layout where the browser can tell (Z on AZERTY).
- **Prompts name the controls in use**: strings carry `{interact}`, `{vehicle}`, `{forward}`… and `keys()` fills them in for the device last used: the bound key, the pad's button (X, Y, RT…) or the touch button (E, ▲…). Prompts, toasts, the shift card, the phone's Jobs and Ride apps, the Planner hint and the help screen all use it (83 strings converted).
- **Gamepad through every menu** (`src/input/padnav.ts`): whenever the phone, a card, a conversation, a modal (settings, saves, counter, departures, showroom), the journey screen or the Planner's palette is up, the d-pad (or the left stick, repeating) moves a highlight to the nearest control in that direction, A presses it, B backs out, left/right turn sliders and lists. Nothing knows the menus: it reads what's on screen. In the Planner a ring at the centre is the cursor: A places (a road or bulldozer drag: A to start, A to finish), LB turns the palette's tabs, X pauses, RB turns the door, Menu goes back down. LB is photo mode on the street, d-pad up the task book. (The design table had the d-pad for game speed in the Planner; it moves through the palette instead, and X pauses.)

### 7b · Accessibility
- **Settings in four tabs** (Village, Graphics, Controls, Accessibility); the new ones apply at once.
- **Subtitles** (`src/ui/access.ts`): what villagers say in the street (their greetings, every time, with their name) and, if chosen, captions for the sounds that matter: horns, sirens, thunder, church bells, a crash, fireworks, a fanfare. At the foot of the screen, at most three lines.
- **Interface size**: compact, standard, large, extra large (CSS zoom over the whole interface).
- **Colour vision**: standard, red–green safe (blue and orange) or blue–yellow safe (teal and pink): the good/bad colours everywhere come from two CSS variables. A struggling statistic is also underlined, so it's never colour alone.
- **Motion**: camera shake on/off (earthquakes, crashes), head bob in first person (new, gentle, on by default), reduce motion (no slides, pops, blinks, the photo flash or the scrolling ticker; lightning flashes dimmer). With the field of view (already a setting), these are the motion-sickness options.

### 7c · The first day
- **A guide instead of a page of controls** (`src/ui/tour.ts`): a new player (no guide seen in this browser) gets nine short steps: look around, rise into the Planner, place the first house, watch the first family arrive (speed up), give them work, come back down, meet the neighbours, open the phone, and off you go. Each step rings what to press (the crane, the House in the palette, the speed buttons, the Work tab, the phone), is worded for the device in use, and moves on by itself when it's done. "Skip the guide" at any point; Settings → Village → "Show me around again". After a reload it picks up where the village is (a village with houses and work starts at "meet the neighbours").
- **Knocking**: at a home that won't ask you in yet (the household hasn't warmed to you), E knocks and the eldest at home comes to the door to talk. That's how a newcomer meets the first family.
- **A fair first morning**: a new village starts in clear weather (it used to open in rain and fog, which hid the first build).
- Fixed on the way: with a tool picked, the palette snapped back to that tool's tab every 0.4 s, so other tabs couldn't be browsed.

### 7d · Phones and performance
- **Phones**: touch controls show from the start on a touch-only device (they used to wait for the first tap), the first tap goes full screen and holds landscape where the browser allows, and an upright phone gets a "turn your phone sideways" card. A compact landscape layout for short screens (≤ 520 px high): one-row top bar, the stick bottom left and the buttons bottom right, the minimap above them, the wallet and reputation up top, the hint and PVTV out of the way; in the Planner only the crane button stays and the palette narrows. A two-finger twist turns the Planner (pinch and drag already zoomed and panned). An install manifest and icon (`public/`): from the Home Screen it opens full screen, sideways.
- **Quality**: phones and tablets start on Low (design §17.4); integrated GPUs on Medium as before. **Resolution**: auto (steps down 10% at a time while frames run under ~30 fps, back up when there's room, never below 70%), or full, 85%, 70%, 55%. **Frame rate**: uncapped or 30 fps (battery).
- **Measured on the owner's Intel UHD laptop** (Browser pane, 1043×534, medium, the 81-villager test town): 9.3 ms median GPU time a frame (p90 13.1), frames every ~25 ms. Over several minutes at 8× the heap stayed between 208 and 246 MB, page elements flat at ~815, GPU geometries and textures growing only with new buildings.
- **No shader compiles mid-game**: the thought bubbles' sprite shader was the one program still compiling the first time someone had a thought; it now compiles with everything else before the first frame (65 programs at boot, none added over 30 s at 8× through the evening).

### 7e · Balance
- **What the runs showed** (two villages grown for 36 days by a scripted player who builds what the village asks for): building sites stood idle for want of materials from day 5 on in both, and one village stopped growing at ~45 people from day 13. The village fund sat at $0–$400, and safety fell to 25–33%. The new player's very first house stalled the same way.
- **The changes**: a young village's builders (under 30 villagers) bring 80% of a site's materials, and a small home's (up to 2×2) bring 70% after that (other sites 40%, as before); the county's daily import allowance grows with the village (+0.5 materials, +0.3 food, +0.2 products, +0.1 textiles a villager); imported site materials cost the village fund a quarter of their value, not half.
- **After**: the same runs reached 148 and 173 villagers by day 25 (from 118 and 51), happiness 84–90 (78, 69), safety 68–91% (33%, 25%), the fund $950 in one and spending on the mayor's builds in the other, materials rarely short. The M4 rule still holds: a building boom with nothing made in town stalls (`tests/deeper.test.ts`).
- **Shift pay vs prices** (checked, unchanged): a good 8-hour shift pays about $40–150 (cars $280–520, fines $15–360, a hospital bill up to $120), so a car is two to five good shifts.
- **Chat costs** (`api/_chat.ts`): on top of 12 a minute and 400 a day per address (and the client's 150 a session), a server-wide budget (90 a minute; `CHAT_DAILY_CAP`, default 4,000 a day per server instance), and only this site's own pages (and localhost) may call the proxy (`CHAT_ORIGINS` adds others). Groq's free tier costs nothing; past its limits villagers fall back to template dialogue.

### 7f · Launch prep
- `vercel.json`: hashed assets cached for a year, the pages always revalidated, and basic security headers (`nosniff`, a referrer policy, same-origin framing, a permissions policy allowing only the gamepad and full screen).
- The production build (`npm run build`, 1.8 MB, ~470 KB gzipped for the game) checked in the preview server: ready in 3.5 s on a fresh origin, the guide up, the manifest and icon served, no console errors.
- **The deploy steps for the owner** are in [LAUNCH.md](LAUNCH.md).
- Covered by `tests/controls.test.ts` (bindings, clashes, reset, labels per device, the young village's materials and imports) and `tests/chat.test.ts` (the budget and the origin check).

---

## Ways of working

- Every milestone: playable build deployed to a Vercel preview, then promoted.
- Sim changes ship with tests; the multi-day soak test runs on every change.
- Assets are CC0 only, tracked in `public/assets/LICENSES.md`.
- V1 is never modified; it stays the reference for behaviour.

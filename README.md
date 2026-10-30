# 🏘️ PixelVille — Next Dimension

The 3D sequel to [PixelVille](https://github.com/Sumandebnath943/pixelville): the same living village — families, minds, elections, crime, fires, festivals, disasters — now at street level.

Walk and drive through your village in first or third person, and rise into the sky to build, just like before. Villagers commute, gossip, fall in love, vote, open businesses and remember what happened to them.

> **Status:** live at **[pixelvillenextdimension.houseofnamus.com](https://pixelvillenextdimension.houseofnamus.com/)** (every push to `main` deploys). Milestones 1–8 are done (the living town, the semi-realistic look, street life, interiors and villager chat, the deeper village, going places, work shifts, launch polish, the owner's polish list), and Milestone 9's fixes from live play are on `main`: junction boxes and gridlock relief, a closed economy with tills, budgets and debts, god view, the Auto village, street trees, the spring thaw, saves that always open, a lighter frame, an Ultra graphics preset, and real models for the villagers, vehicles and animals with a choice of who the Founder is. See [the milestone plan](docs/MILESTONES.md), [the handoff](docs/HANDOFF.md) and [the game info](docs/GAME_INFO.md). The look lab, a single street block for trying the graphics, is at `/slice.html`.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Then open the address Vite prints (usually http://localhost:5173). Other scripts:

| Command | What it does |
| --- | --- |
| `npm run build` | type-check and build the static site into `dist/` |
| `npm test` | 152 headless tests (a 20-day soak, saves, V1 import, traffic jams, the economy) |
| `npm run lint` | ESLint |

## How to play

| | Keyboard + mouse | Gamepad | Touch |
| --- | --- | --- | --- |
| Move / run / jump | WASD · Shift · Space | left stick · L3 · A | left thumb-stick · 🏃 · ⤒ |
| Look | mouse (click the view first) | right stick | drag the right side |
| First / third person | V | R3 | 👁️ |
| Inspect a building or villager | E | X | E |
| Get into / out of your car | F | Y | 🚗 |
| Drive | W/S gas & brake · A/D steer · Space handbrake | triggers · left stick | thumb-stick |
| Planner (build mode) | P | Start | 🏗️ |

**In the Planner:** WASD glides, the wheel zooms, Q/E or right-drag rotates. Pick something from the palette and click to place it. R turns the door side, and roads connect themselves. Drag to lay roads, rails or rivers, or to bulldoze. Click a building or villager to inspect it. Ctrl+Z undoes a bulldoze, and keys 1–5 set the speed (up to 8×). G (god view) clears the view of storm, mist and fog. On the street, time runs at 1×.

**Auto village:** from the landing screen or Menu → Auto village, a whole village is laid out and filled at a press and shown from the air; pin the season, weather, festival and pace, then "Play this village" to take it over.

**Saves:** there are three slots plus an autosave, and the game continues your last village when you return. If a village crashed while loading last time, the loading screen offers to open it again, open it with lighter graphics, or start afresh with the old one kept safe. Export and import to a file, including **PixelVille V1 exports**: a V1 village is placed in the bottom-centre of the bigger map.

**Graphics:** Settings → Graphics → Quality: Auto picks Low, Medium or High for your device; **Ultra** (every small shadow, full reflections) is there when you want it.

## Documents

- [Handoff](docs/HANDOFF.md): start here: status, decisions, architecture, testing playbook
- [Design document](docs/DESIGN.md): vision, systems, player, world, AI chat, architecture
- [Milestone plan](docs/MILESTONES.md): what was built, in what order, including the fixes since launch
- [Game info](docs/GAME_INFO.md): every system and feature, for players and the portfolio
- [Project book](docs/PROJECT_BOOK.md): the A–Z of systems, files and rules
- [Launch checklist](docs/LAUNCH.md): the deploy

## Stack

TypeScript · Vite · Three.js · Vitest · Vercel. The world and buildings are generated in code, as in V1. The villagers (Microsoft Rocketbox, MIT), vehicles and animals (CC BY 4.0, from Sketchfab) are downloaded models, made small for the game by the scripts in `scripts/people`, `scripts/vehicles` and `scripts/animals` (sources in [docs/MODEL_SOURCES.md](docs/MODEL_SOURCES.md)).

## Credits

Every model's creator is credited in [public/models/CREDITS.md](public/models/CREDITS.md) and on the game's Credits screen. Missed a credit, or want one of your models changed or taken out? Please [open an issue](https://github.com/Sumandebnath943/pixelville-next-dimension/issues) and we'll put it right.

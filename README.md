# 🏘️ PixelVille — Next Dimension

The 3D sequel to [PixelVille](https://github.com/Sumandebnath943/pixelville): the same living village — families, minds, elections, crime, fires, festivals, disasters — now at street level.

Walk and drive through your village in first or third person, and rise into the sky to build, just like before. Villagers commute, gossip, fall in love, vote, open businesses and remember what happened to them.

> **Status:** Milestones 1–6 are done (the living town, the semi-realistic look, street life, interiors and villager chat, the deeper village, going places, work shifts). Milestone 7 (launch polish: rebindable controls, gamepad menus, accessibility, a first-day guide, phones, balance) is built; the deploy steps are in [docs/LAUNCH.md](docs/LAUNCH.md). See [the milestone plan](docs/MILESTONES.md) and [the handoff](docs/HANDOFF.md). The look lab, a single street block for trying the graphics, is at `/slice.html`.

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
| `npm test` | headless simulation tests (a 20-day soak, saves, V1 import) |
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

**In the Planner:** WASD glides, the wheel zooms, Q/E or right-drag rotates. Pick something from the palette and click to place it. R turns the door side, and roads connect themselves. Drag to lay roads, rails or rivers, or to bulldoze. Click a building or villager to inspect it. Ctrl+Z undoes a bulldoze, and keys 1–5 set the speed (up to 8×). On the street, time runs at 1×.

**Saves:** there are three slots plus an autosave, and the game continues your last village when you return. Export and import to a file, including **PixelVille V1 exports**: a V1 village is placed in the bottom-centre of the bigger map.

## Documents

- [Design document](docs/DESIGN.md): vision, systems, player, world, AI chat, architecture
- [Milestone plan](docs/MILESTONES.md): what gets built, in what order

## Stack

TypeScript · Vite · Three.js · Vitest · Vercel. There are no image or model files: the world, buildings, people and vehicles are generated in code, as in V1.

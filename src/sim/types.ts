/* ============================================================
   Shared entity types for the simulation (the typing pass that
   followed Milestone 7). The V1 code made these objects as plain
   literals and grew them as it went, so each interface names the
   fields the game leans on, with their types, and keeps an open
   index for the long tail (a field set in one system and read in
   another). Tighten them field by field; never widen a declared
   field to `any`.
   ============================================================ */

/** a tile position, or a point in V1 px (16 a tile) */
export interface XY { x: number; y: number }

/** a family's car in the drive (`free` while it's parked at home) */
export interface Car { free: boolean; seed: number; [k: string]: any }

/** a building on the map: made by `World.placeBuilding` */
export interface Building {
  id: number;
  /** the catalog key (`CAT[type]`) */
  type: string;
  /** footprint origin and size in tiles, the door's side (0 south, 1 east, 2 north, 3 west) */
  x: number; y: number; w: number; h: number; facing: number;
  door: XY;
  variant: number;
  /** joined to the road network */
  connected: boolean;
  /** game-minutes of building work left (0 = finished), and the total */
  construction: number; conTotal?: number;
  upgrading: number; renovating: number;
  level: number;
  ruined: boolean;
  /** minutes of fire left (0 = not burning) */
  fire: number;
  residents: Person[];
  workers: Person[];
  /** jobs it offers */
  jobs: number;
  cars: Car[];
  funds: number;
  visitors: number; inside: number; parked: number;
  [k: string]: any;
}

/** a villager: made by `Sim.makePerson` */
export interface Person {
  id: number;
  /** 'man' | 'woman' | 'kid' as made; elders are adults with a high age */
  kind: string;
  name: string; surname: string;
  seed: number;
  age: number;
  home: Building;
  work: Building | null;
  school: Building | null;
  partnerId: number | null;
  married: boolean;
  /** 'in' (inside `at`), 'walk' (on `trip`), 'away', 'hurt', 'amb'… */
  state: string;
  at: Building | null;
  trip: any;
  events: any[];
  savings: number;
  mood: number;
  /** health 0–100 and any condition (src/sim/health.ts; set on load by Health.unpack) */
  hp?: number; cond?: any;
  /** position in V1 px */
  x: number; y: number;
  /** minds (src/sim/mind.ts): traits, memories, friends, opinions */
  mind?: any;
  [k: string]: any;
}

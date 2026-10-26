/* ============================================================
   PixelVille — Next Dimension · simulation core.
   Shared constants and the event bus that keeps the simulation
   headless: the sim never touches the DOM, audio or Three.js —
   it emits events (toasts, sounds, news) and the client listens.
   ============================================================ */

/** Sub-tile unit used by every V1 position (px at 16 px/tile). The renderer
 *  converts: metres = px / T * TILE_M. Keeping V1's unit keeps V1's maths. */
export const T = 16;
/** Metres per tile in the 3D world. */
export const TILE_M = 8;
/** Metres per sim px. */
export const PX_M = TILE_M / T;

/** Game-minutes per real second at 1×: a day lasts 24 real minutes. */
export const MIN_PER_SEC = 1;

/* ---------- tiny seeded RNG (from V1) ---------- */
export function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- event bus ---------- */
export interface SimEvents {
  toast: { msg: string; at?: { x: number; y: number } };
  /** a one-shot sound; `at` (V1 px) makes it positional (Milestone 7 follow-up): quieter far away, panned to its side */
  sound: { name: string; at?: { x: number; y: number } };
  breaking: { text: string };
  seasonChange: { season: number };
  buildingDone: { id: number };
  mapEdited: Record<string, never>;
  /** V2: a road rule the Founder broke or harm they caused (metres) */
  founderOffence: { kind: string; day: number; clock: number; x: number; z: number; at: number };
  /** V2 (Milestone 8): a vehicle ran into the Founder on foot (speed m/s; mass 0.6 a motorbike … 1.6 a bus or truck) */
  founderHit: { speed: number; mass: number; what: string; dx: number; dy: number };
}
type Handler<K extends keyof SimEvents> = (p: SimEvents[K]) => void;
const handlers: { [K in keyof SimEvents]?: Handler<K>[] } = {};

export function on<K extends keyof SimEvents>(type: K, fn: Handler<K>): () => void {
  const list = (handlers[type] ??= []) as Handler<K>[];
  list.push(fn);
  return () => {
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  };
}

export function emit<K extends keyof SimEvents>(type: K, payload: SimEvents[K]): void {
  const list = handlers[type] as Handler<K>[] | undefined;
  if (list) for (const fn of list) fn(payload);
}

/** V1 called `Snd.siren()`, `Snd.bell()` … directly. In the headless sim those
 *  calls become `sound` events; the client's audio engine plays them. */
export const Snd: Record<string, (at?: { x: number; y: number }) => void> = new Proxy(
  {},
  { get: (_t, name: string) => (at?: { x: number; y: number }) => emit('sound', { name, at }) },
);
/** the middle of a building, in V1 px (where its sounds come from) */
export const midPx = (b: { x: number; y: number; w: number; h: number }): { x: number; y: number } => ({ x: b.x * 16 + b.w * 8, y: b.y * 16 + b.h * 8 });

/** a family name as a household: Kim → the Kims, Owens → the Owenses (V1 wrote "Owenss") */
export function family(surname: string): string {
  return /(s|x|z|ch|sh)$/.test(surname) ? surname + 'es' : surname + 's';
}

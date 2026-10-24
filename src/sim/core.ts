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
  sound: { name: string };
  breaking: { text: string };
  seasonChange: { season: number };
  buildingDone: { id: number };
  mapEdited: Record<string, never>;
  /** V2: a road rule the Founder broke or harm they caused (metres) */
  founderOffence: { kind: string; day: number; clock: number; x: number; z: number; at: number };
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
export const Snd: Record<string, () => void> = new Proxy(
  {},
  { get: (_t, name: string) => () => emit('sound', { name }) },
);

/** a family name as a household: Kim → the Kims, Owens → the Owenses (V1 wrote "Owenss") */
export function family(surname: string): string {
  return /(s|x|z|ch|sh)$/.test(surname) ? surname + 'es' : surname + 's';
}

/* ============================================================
   The zoo's plan (V2): one layout for the builder that raises it
   (render/buildings.ts) and the animals that live in it
   (render/fauna.ts), so a pen's fence, its pool and its feeder
   are where its animals look for them. In the lot's own frame
   (metres, the street side at +z): a gated entrance plaza with
   ticket kiosks, a path up the middle to a cross walk, and five
   enclosures round them, each with its own ground, fence,
   water, rocks, trees and feeding place.
   ============================================================ */
export type PenKind = 'elephant' | 'lion' | 'zebra' | 'penguin' | 'petting';
export interface Rock { x: number; z: number; r: number; h: number }
export interface Pen {
  kind: PenKind;
  /** the fence line */
  x0: number; z0: number; x1: number; z1: number;
  ground: string; fence: string; fenceH: number;
  /** a pool (centre, half sizes; round when ry is 0) */
  pool: { x: number; z: number; rx: number; rz: number } | null;
  rocks: Rock[];
  trees: { x: number; z: number; s: number }[];
  /** where the food is put out (a rack, a log, a trough) */
  feed: { x: number; z: number };
  /** the animals in it */
  herd: string[];
}
export interface ZooPlan {
  pens: Pen[];
  /** paved walks: [x0, z0, x1, z1] */
  paths: [number, number, number, number][];
  benches: [number, number, number][];
  lamps: [number, number][];
  /** the visitors' circuit (a closed loop along the walks) */
  loop: [number, number][];
}

/** the plan for a zoo lot of hw × hd half sizes (48 × 40 m as catalogued) */
export function zooPlan(hw: number, hd: number): ZooPlan {
  const back0 = -hd + 1.5, back1 = -2.6, front0 = 2.6, front1 = hd - 7.5;
  const pens: Pen[] = [
    {
      kind: 'elephant', x0: -hw + 1.5, z0: back0, x1: -7, z1: back1, ground: '#d6bd86', fence: '#5a3e24', fenceH: 1.6,
      pool: { x: -hw + 6.5, z: back0 + 5, rx: 3.4, rz: 0 },
      rocks: [{ x: -11, z: back0 + 3, r: 1.8, h: 1.6 }, { x: -9.5, z: back0 + 4.8, r: 1.1, h: 1.0 }],
      trees: [{ x: -13, z: back0 + 2.4, s: 1.15 }, { x: -hw + 3.5, z: back1 - 3, s: 1.0 }],
      feed: { x: -12, z: back1 - 2.2 }, herd: ['elephant'],
    },
    {
      kind: 'lion', x0: -5.6, z0: back0, x1: 5.6, z1: back1, ground: '#9fa85a', fence: '#26292c', fenceH: 2.4,
      pool: null,
      rocks: [{ x: -1.2, z: back0 + 3.5, r: 2.6, h: 2.2 }, { x: 1.6, z: back0 + 4.2, r: 1.8, h: 1.5 }, { x: 3.4, z: back1 - 4.5, r: 1.3, h: 0.5 }],
      trees: [{ x: -3.8, z: back1 - 3.5, s: 0.9 }],
      feed: { x: -2.8, z: back1 - 2 }, herd: ['lion', 'lion'],
    },
    {
      kind: 'zebra', x0: 7, z0: back0, x1: hw - 1.5, z1: back1, ground: '#aab262', fence: '#7a5634', fenceH: 1.4,
      pool: { x: hw - 5, z: back1 - 3.2, rx: 1.6, rz: 0 },
      rocks: [{ x: 10, z: back0 + 2.4, r: 1.0, h: 0.7 }],
      trees: [{ x: 12.5, z: back0 + 4, s: 1.25 }, { x: hw - 4.5, z: back0 + 3, s: 1.05 }],
      feed: { x: 10, z: back1 - 2 }, herd: ['zebra', 'zebra', 'zebra'],
    },
    {
      kind: 'penguin', x0: -hw + 1.5, z0: front0, x1: -8.5, z1: front1, ground: '#e7edf1', fence: '#9fb4c2', fenceH: 1.0,
      pool: { x: -hw + 8, z: (front0 + front1) / 2 + 0.6, rx: 3.6, rz: 2.4 },
      rocks: [{ x: -11.2, z: front0 + 2.2, r: 1.2, h: 0.9 }, { x: -hw + 3, z: front1 - 2, r: 1.0, h: 0.7 }],
      trees: [],
      feed: { x: -11, z: front1 - 1.8 }, herd: ['penguin', 'penguin', 'penguin', 'penguin', 'penguin', 'penguin'],
    },
    {
      kind: 'petting', x0: 8.5, z0: front0, x1: hw - 1.5, z1: front1, ground: '#86b85a', fence: '#b8915a', fenceH: 1.0,
      pool: null,
      rocks: [],
      trees: [{ x: 11, z: front1 - 2, s: 0.85 }],
      feed: { x: hw - 6, z: front0 + 2.2 }, herd: ['sheep', 'sheep', 'donkey', 'hare', 'hare'],
    },
  ];
  const paths: ZooPlan['paths'] = [
    [-hw + 1, -1.4, hw - 1, 1.4], // the cross walk, in front of the big pens
    [-1.4, 1.4, 1.4, hd - 6], // up the middle from the gate
    [-6, hd - 6, 6, hd - 0.2], // the entrance plaza
    [-8.5, front1, 8.5, front1 + 1.6], // along the front pens' far side
  ];
  const benches: [number, number, number][] = [[-4.2, 3.6, Math.PI], [4.2, 3.6, Math.PI], [-16, 2.3, Math.PI], [16, 2.3, Math.PI], [-4.2, front1 - 1.2, 0], [4.2, front1 - 1.2, 0]];
  const lamps: [number, number][] = [[-8, 0], [8, 0], [-hw + 2, 0], [hw - 2, 0], [-2.2, 7], [2.2, 7], [-5.5, hd - 1], [5.5, hd - 1]];
  const loop: [number, number][] = [[0, hd - 3], [0, 0], [-hw + 3, 0], [-hw + 3, 0.6], [-1, 0.6], [-1, front1 + 0.8], [-7.5, front1 + 0.8], [7.5, front1 + 0.8], [1, front1 + 0.8], [1, 0.6], [hw - 3, 0.6], [hw - 3, 0], [0, 0]];
  return { pens, paths, benches, lamps, loop };
}

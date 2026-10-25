/* ============================================================
   Models: the procedural low-poly people, vehicles and props.
   Everything faces +Z with its origin on the ground. Vehicles
   split into paint (tinted per instance), fixed trim, lights
   and siren bars so one template serves every colour.
   ============================================================ */
import * as THREE from 'three';
import { MeshBuilder, hex } from './kit';

const W = hex('#ffffff');

/* ---------- people: one geometry per body part (pivot at the joint) ---------- */
export const PERSON = {
  leg: new MeshBuilder().box(-0.09, -0.82, -0.1, 0.09, 0, 0.1, W).build(),
  arm: new MeshBuilder().box(-0.07, -0.62, -0.07, 0.07, 0, 0.07, W).build(),
  torso: new MeshBuilder().box(-0.23, 0, -0.13, 0.23, 0.66, 0.13, W).build(),
  head: new MeshBuilder().box(-0.15, 0, -0.15, 0.15, 0.32, 0.15, W).build(),
  hair: new MeshBuilder().box(-0.165, 0.2, -0.17, 0.165, 0.37, 0.165, W).box(-0.165, -0.05, -0.17, 0.165, 0.22, -0.1, W).build(),
  hairLong: new MeshBuilder().box(-0.165, 0.2, -0.17, 0.165, 0.37, 0.165, W).box(-0.17, -0.38, -0.19, 0.17, 0.22, -0.08, W).build(),
};

export const SKIN = ['#f1c9a5', '#e0ac85', '#c68a62', '#a86b48', '#8a5236', '#5e3a26'].map((h) => hex(h));
export const SHIRT = ['#e05a5a', '#4f8ede', '#4fae5c', '#d09a3a', '#8a5ac8', '#e08ab0', '#3ab0b0', '#f2f2f2', '#2a2a2a', '#c8743a', '#6a8a3a', '#e8d040'].map((h) => hex(h));
export const PANTS = ['#2a3a5a', '#3a3a3a', '#5a4a3a', '#6a6a72', '#2a4a3a', '#8a7a5a'].map((h) => hex(h));
export const HAIR = ['#1a1410', '#3a2a1a', '#6a4a2a', '#a8803a', '#c8b89a', '#8a3a1a'].map((h) => hex(h));

/* ---------- vehicles ---------- */
export interface VModel {
  paint: THREE.BufferGeometry;
  fixed: THREE.BufferGeometry;
  lights: THREE.BufferGeometry;
  siren?: THREE.BufferGeometry;
  rotor?: THREE.BufferGeometry;
}

function wheels(b: MeshBuilder, xs: number, zs: number[], r = 0.36, w = 0.26): void {
  const tyre = hex('#1c1c1e');
  for (const z of zs) for (const sx of [-1, 1]) b.box(sx * xs - w / 2, 0, z - r, sx * xs + w / 2, r * 2, z + r, tyre);
}
function lightsFB(l: MeshBuilder, hw: number, zf: number, zb: number, y: number): void {
  for (const sx of [-1, 1]) {
    l.box(sx * hw - 0.25 * sx - 0.12, y, zf - 0.02, sx * hw - 0.25 * sx + 0.12, y + 0.16, zf + 0.04, hex('#fff6d8'));
    l.box(sx * hw - 0.25 * sx - 0.12, y, zb - 0.04, sx * hw - 0.25 * sx + 0.12, y + 0.14, zb + 0.02, hex('#ff2a2a'));
  }
}

function car(extra?: (p: MeshBuilder, f: MeshBuilder, l: MeshBuilder, s: MeshBuilder) => void): VModel {
  const p = new MeshBuilder(), f = new MeshBuilder(), l = new MeshBuilder(), s = new MeshBuilder();
  p.box(-0.9, 0.3, -2.1, 0.9, 0.95, 2.1, W);
  p.box(-0.8, 0.95, -1.2, 0.8, 1.48, 0.9, W);
  const glass = hex('#2a3a4a');
  f.quad([-0.78, 1.0, 0.92], [0.78, 1.0, 0.92], [0.7, 1.42, 0.6], [-0.7, 1.42, 0.6], glass);
  f.quad([0.78, 1.0, -1.22], [-0.78, 1.0, -1.22], [-0.7, 1.42, -1.0], [0.7, 1.42, -1.0], glass);
  for (const sx of [-1, 1]) f.box(sx * 0.81 - 0.02, 1.02, -1.1, sx * 0.81 + 0.02, 1.4, 0.8, glass);
  f.box(-0.92, 0.3, 2.05, 0.92, 0.55, 2.18, hex('#555'));
  wheels(f, 0.82, [-1.35, 1.35]);
  lightsFB(l, 0.9, 2.12, -2.12, 0.62);
  extra?.(p, f, l, s);
  return { paint: p.build(), fixed: f.build(), lights: l.build(), siren: s.empty ? undefined : s.build() };
}

export const VEHICLES: Record<string, VModel> = {
  car: car(),
  taxi: car((_p, f) => {
    f.box(-0.35, 1.48, -0.3, 0.35, 1.72, 0.1, hex('#ffe060'));
    for (const sx of [-1, 1]) f.box(sx * 0.91 - 0.02, 0.62, -1.9, sx * 0.91 + 0.02, 0.72, 1.9, hex('#222'));
  }),
  police: car((_p, f, _l, s) => {
    for (const sx of [-1, 1]) f.box(sx * 0.91 - 0.02, 0.45, -1.4, sx * 0.91 + 0.02, 0.85, 1.6, hex('#1a3a8a'));
    s.box(-0.55, 1.48, -0.25, -0.02, 1.68, 0.05, W);
    s.box(0.02, 1.48, -0.25, 0.55, 1.68, 0.05, W);
  }),
  fire: (() => {
    const p = new MeshBuilder(), f = new MeshBuilder(), l = new MeshBuilder(), s = new MeshBuilder();
    p.box(-1.15, 0.45, -4.0, 1.15, 2.4, 2.2, W);
    p.box(-1.15, 0.45, 2.2, 1.15, 2.7, 4.0, W);
    f.box(-1.0, 2.0, 2.4, 1.0, 2.55, 4.02, hex('#2a3a4a'));
    f.box(-0.25, 2.45, -3.8, 0.25, 2.75, 2.0, hex('#c8ccd0'));
    for (let z = -3.6; z < 2; z += 0.6) f.box(-0.3, 2.75, z, 0.3, 2.82, z + 0.12, hex('#c8ccd0'));
    for (const sx of [-1, 1]) f.box(sx * 1.16 - 0.02, 1.0, -3.8, sx * 1.16 + 0.02, 1.15, 2.0, hex('#f0f0f0'));
    wheels(f, 1.05, [-2.6, -1.4, 2.8], 0.48, 0.32);
    lightsFB(l, 1.15, 4.02, -4.02, 0.9);
    s.box(-0.9, 2.7, 2.9, -0.05, 2.95, 3.3, W).box(0.05, 2.7, 2.9, 0.9, 2.95, 3.3, W);
    return { paint: p.build(), fixed: f.build(), lights: l.build(), siren: s.build() };
  })(),
  /* V2 (Milestone 4): the ambulance, the delivery truck, the power company's van */
  ambulance: (() => {
    const p = new MeshBuilder(), f = new MeshBuilder(), l = new MeshBuilder(), s = new MeshBuilder();
    p.box(-1.05, 0.4, -2.9, 1.05, 2.55, 1.0, W); // the box body
    p.box(-1.0, 0.4, 1.0, 1.0, 1.75, 2.75, W);   // the cab
    const glass = hex('#2a3a4a');
    f.quad([-0.92, 1.25, 2.76], [0.92, 1.25, 2.76], [0.86, 1.7, 2.3], [-0.86, 1.7, 2.3], glass);
    for (const sx of [-1, 1]) f.box(sx * 1.01 - 0.02, 1.2, 1.15, sx * 1.01 + 0.02, 1.65, 2.2, glass);
    for (const sx of [-1, 1]) {
      f.box(sx * 1.06 - 0.02, 1.05, -2.85, sx * 1.06 + 0.02, 1.35, 0.95, hex('#d8262a')); // red band
      f.box(sx * 1.06 - 0.02, 0.85, -2.85, sx * 1.06 + 0.02, 1.0, 0.95, hex('#f2c230'));  // and yellow
      f.box(sx * 1.07 - 0.02, 1.7, -1.4, sx * 1.07 + 0.02, 2.2, -0.9, hex('#d8262a'));   // the cross
      f.box(sx * 1.07 - 0.02, 1.85, -1.65, sx * 1.07 + 0.02, 2.05, -0.65, hex('#d8262a'));
    }
    f.box(-1.0, 0.45, -2.92, 1.0, 2.45, -2.9, hex('#e8e8e8'));
    wheels(f, 0.95, [-1.9, 1.85], 0.4, 0.28);
    lightsFB(l, 1.0, 2.77, -2.93, 0.75);
    s.box(-0.8, 2.55, 0.55, -0.05, 2.75, 0.9, W).box(0.05, 2.55, 0.55, 0.8, 2.75, 0.9, W);
    return { paint: p.build(), fixed: f.build(), lights: l.build(), siren: s.build() };
  })(),
  truck: (() => {
    const p = new MeshBuilder(), f = new MeshBuilder(), l = new MeshBuilder();
    p.box(-1.1, 0.75, -3.4, 1.1, 3.0, 1.1, W);    // the box, painted by what it carries
    f.box(-1.05, 0.45, 1.15, 1.05, 2.3, 3.1, hex('#e8e6e0')); // the cab
    const glass = hex('#2a3a4a');
    f.quad([-0.95, 1.5, 3.11], [0.95, 1.5, 3.11], [0.9, 2.2, 2.85], [-0.9, 2.2, 2.85], glass);
    for (const sx of [-1, 1]) f.box(sx * 1.06 - 0.02, 1.45, 1.4, sx * 1.06 + 0.02, 2.1, 2.6, glass);
    f.box(-1.15, 0.45, -3.45, 1.15, 0.75, 3.15, hex('#2a2a2a')); // the chassis
    f.box(-1.12, 0.9, -3.42, 1.12, 2.9, -3.4, hex('#d0d0d0'));   // the rear doors
    wheels(f, 1.0, [-2.6, -1.7, 2.2], 0.45, 0.3);
    lightsFB(l, 1.05, 3.12, -3.46, 0.8);
    return { paint: p.build(), fixed: f.build(), lights: l.build() };
  })(),
  van: (() => {
    const p = new MeshBuilder(), f = new MeshBuilder(), l = new MeshBuilder(), s = new MeshBuilder();
    p.box(-0.95, 0.38, -2.3, 0.95, 2.05, 1.2, W);
    p.box(-0.92, 0.38, 1.2, 0.92, 1.4, 2.35, W);
    const glass = hex('#2a3a4a');
    f.quad([-0.86, 1.05, 2.36], [0.86, 1.05, 2.36], [0.8, 1.9, 1.25], [-0.8, 1.9, 1.25], glass);
    for (const sx of [-1, 1]) {
      f.box(sx * 0.96 - 0.02, 1.15, 0.4, sx * 0.96 + 0.02, 1.75, 1.15, glass);
      f.box(sx * 0.97 - 0.02, 0.7, -2.25, sx * 0.97 + 0.02, 0.95, 2.3, hex('#1e5a9a')); // the company stripe
    }
    // a ladder on the roof rack
    for (const sx of [-0.35, 0.35]) f.box(sx - 0.03, 2.12, -2.2, sx + 0.03, 2.18, 1.0, hex('#9aa0a8'));
    for (let z = -2.1; z < 1.0; z += 0.4) f.box(-0.35, 2.12, z, 0.35, 2.17, z + 0.05, hex('#9aa0a8'));
    wheels(f, 0.86, [-1.5, 1.55], 0.36, 0.26);
    lightsFB(l, 0.95, 2.37, -2.32, 0.65);
    s.box(-0.5, 2.05, 1.0, -0.15, 2.22, 1.15, W).box(0.15, 2.05, 1.0, 0.5, 2.22, 1.15, W);
    return { paint: p.build(), fixed: f.build(), lights: l.build(), siren: s.build() };
  })(),
  /* V2 (Milestone 6): the farm tractor (big rear wheels, a cab with glass all round, an exhaust stack) */
  tractor: (() => {
    const p = new MeshBuilder(), f = new MeshBuilder(), l = new MeshBuilder(), s = new MeshBuilder();
    p.box(-0.55, 0.75, 0.1, 0.55, 1.45, 2.1, W);   // the bonnet
    p.box(-0.75, 0.75, -1.3, 0.75, 1.25, 0.15, W); // the body under the cab
    p.box(-1.05, 1.18, -1.55, -0.65, 1.28, -0.3, W).box(0.65, 1.18, -1.55, 1.05, 1.28, -0.3, W); // mudguards
    const glass = hex('#2a3a4a'), tyre = hex('#1c1c1e'), hub = hex('#d8b030');
    f.box(-0.7, 1.25, -1.25, 0.7, 1.3, 0.05, hex('#2a2a2a'));
    for (const sx of [-0.7, 0.7]) for (const z of [-1.2, 0.0]) f.box(sx - 0.04, 1.3, z - 0.04, sx + 0.04, 2.55, z + 0.04, hex('#2a2a2a'));
    f.box(-0.72, 2.55, -1.3, 0.72, 2.65, 0.1, hex('#2a2a2a'));               // the cab roof
    f.box(-0.68, 1.45, 0.0, 0.68, 2.45, 0.02, glass).box(-0.68, 1.45, -1.22, 0.68, 2.45, -1.2, glass);
    for (const sx of [-1, 1]) f.box(sx * 0.7 - 0.01, 1.45, -1.2, sx * 0.7 + 0.01, 2.45, 0.0, glass);
    f.box(0.3, 1.45, 1.4, 0.4, 2.5, 1.5, hex('#3a3a3a'));                      // the exhaust stack
    for (const sx of [-1, 1]) {
      f.box(sx * 0.86 - 0.22, 0, -1.55, sx * 0.86 + 0.22, 1.5, -0.25, tyre);   // big rear wheels
      f.box(sx * 0.86 - 0.23, 0.45, -1.1, sx * 0.86 + 0.23, 1.05, -0.7, hub);
      f.box(sx * 0.7 - 0.14, 0, 1.25, sx * 0.7 + 0.14, 0.8, 2.05, tyre);       // small front wheels
    }
    l.box(-0.45, 1.15, 2.1, -0.25, 1.3, 2.13, hex('#fff6d8')).box(0.25, 1.15, 2.1, 0.45, 1.3, 2.13, hex('#fff6d8'));
    s.box(-0.12, 2.65, -0.7, 0.12, 2.82, -0.46, W); // an amber beacon on the roof
    return { paint: p.build(), fixed: f.build(), lights: l.build(), siren: s.build() };
  })(),
  bus: (() => {
    const p = new MeshBuilder(), f = new MeshBuilder(), l = new MeshBuilder();
    p.box(-1.25, 0.4, -5.2, 1.25, 3.0, 5.2, W);
    const glass = hex('#2a3a4a');
    for (const sx of [-1, 1]) f.box(sx * 1.26 - 0.02, 1.5, -4.8, sx * 1.26 + 0.02, 2.6, 4.6, glass);
    f.box(-1.15, 1.3, 5.2, 1.15, 2.7, 5.24, glass);
    f.box(-1.27, 0.5, -5.2, 1.27, 0.9, 5.2, hex('#f0e6c8'));
    f.box(-0.9, 2.75, 5.21, 0.9, 2.95, 5.25, hex('#ffd040'));
    wheels(f, 1.12, [-3.4, 3.4], 0.5, 0.32);
    lightsFB(l, 1.25, 5.22, -5.22, 0.75);
    return { paint: p.build(), fixed: f.build(), lights: l.build() };
  })(),
  moto: (() => {
    const p = new MeshBuilder(), f = new MeshBuilder(), l = new MeshBuilder();
    p.box(-0.2, 0.5, -0.6, 0.2, 0.85, 0.7, W);
    f.box(-0.08, 0, -0.95, 0.08, 0.62, -0.35, hex('#1c1c1e')).box(-0.08, 0, 0.45, 0.08, 0.62, 1.05, hex('#1c1c1e'));
    f.box(-0.35, 1.0, 0.75, 0.35, 1.05, 0.8, hex('#555'));
    l.box(-0.1, 0.9, 0.95, 0.1, 1.05, 1.0, hex('#fff6d8'));
    return { paint: p.build(), fixed: f.build(), lights: l.build() };
  })(),
  loco: (() => {
    const p = new MeshBuilder(), f = new MeshBuilder(), l = new MeshBuilder();
    p.box(-1.3, 0.9, -4.4, 1.3, 3.6, 4.6, W);
    f.box(-1.2, 2.3, 4.6, 1.2, 3.2, 4.65, hex('#2a3a4a'));
    f.box(-1.32, 0.6, -4.4, 1.32, 0.95, 4.6, hex('#2a2a2a'));
    f.box(-1.32, 1.5, -4.4, 1.32, 1.75, 4.6, hex('#f2c230'));
    for (const z of [-3.2, -1.8, 1.8, 3.2]) for (const sx of [-0.72, 0.72]) f.box(sx - 0.1, 0.32, z - 0.45, sx + 0.1, 0.9, z + 0.45, hex('#1c1c1e'));
    l.box(-0.9, 1.0, 4.6, -0.5, 1.3, 4.66, hex('#fff6d8')).box(0.5, 1.0, 4.6, 0.9, 1.3, 4.66, hex('#fff6d8'));
    return { paint: p.build(), fixed: f.build(), lights: l.build() };
  })(),
  coach: (() => {
    const p = new MeshBuilder(), f = new MeshBuilder(), l = new MeshBuilder();
    p.box(-1.3, 0.9, -4.3, 1.3, 3.4, 4.3, W);
    for (const sx of [-1, 1]) f.box(sx * 1.31 - 0.02, 2.0, -3.8, sx * 1.31 + 0.02, 2.8, 3.8, hex('#ffe6a8'));
    f.box(-1.32, 0.6, -4.3, 1.32, 0.95, 4.3, hex('#2a2a2a'));
    for (const z of [-3, 3]) for (const sx of [-0.72, 0.72]) f.box(sx - 0.1, 0.32, z - 0.45, sx + 0.1, 0.9, z + 0.45, hex('#1c1c1e'));
    l.box(-0.05, 0, 0, 0.05, 0.01, 0.01, hex('#000'));
    return { paint: p.build(), fixed: f.build(), lights: l.build() };
  })(),
  wagon: (() => {
    const p = new MeshBuilder(), f = new MeshBuilder(), l = new MeshBuilder();
    p.box(-1.25, 0.95, -4.2, 1.25, 2.8, 4.2, W);
    f.box(-1.32, 0.6, -4.3, 1.32, 0.95, 4.3, hex('#2a2a2a'));
    for (let z = -3.6; z < 4; z += 1.2) f.box(-1.27, 0.95, z, 1.27, 2.8, z + 0.12, hex('#5a4a3a'));
    for (const z of [-3, 3]) for (const sx of [-0.72, 0.72]) f.box(sx - 0.1, 0.32, z - 0.45, sx + 0.1, 0.9, z + 0.45, hex('#1c1c1e'));
    l.box(-0.05, 0, 0, 0.05, 0.01, 0.01, hex('#000'));
    return { paint: p.build(), fixed: f.build(), lights: l.build() };
  })(),
  boat: (() => {
    const p = new MeshBuilder(), f = new MeshBuilder(), l = new MeshBuilder();
    p.box(-0.7, 0, -1.6, 0.7, 0.55, 1.4, W);
    p.tri([-0.7, 0, 1.4], [0.7, 0, 1.4], [0, 0.55, 2.2], W).tri([0.7, 0.55, 1.4], [-0.7, 0.55, 1.4], [0, 0.55, 2.2], W);
    f.box(-0.6, 0.45, -1.4, 0.6, 0.5, 1.3, hex('#8a6a4a'));
    f.box(-0.05, 0.5, -0.2, 0.05, 3.2, -0.1, hex('#8a6a4a'));
    f.tri([0, 0.9, -0.1], [0, 3.0, -0.1], [0, 0.9, 1.3], hex('#f4f0e4')).tri([0, 3.0, -0.1], [0, 0.9, -0.1], [0, 0.9, 1.3], hex('#f4f0e4'));
    l.box(-0.05, 0, 0, 0.05, 0.01, 0.01, hex('#000'));
    return { paint: p.build(), fixed: f.build(), lights: l.build() };
  })(),
  ferry: (() => {
    const p = new MeshBuilder(), f = new MeshBuilder(), l = new MeshBuilder();
    p.box(-2.6, -0.4, -7, 2.6, 1.4, 7, W);
    f.box(-2.2, 1.4, -5, 2.2, 3.6, 4, hex('#f4f4f4'));
    f.box(-2.25, 2.4, -4.8, 2.25, 3.0, 3.8, hex('#2a3a4a'));
    f.cyl(0, 3.6, -2, 0.6, 2, 8, hex('#c0392b'));
    l.box(-0.3, 3.0, 4.0, 0.3, 3.3, 4.05, hex('#fff6d8'));
    return { paint: p.build(), fixed: f.build(), lights: l.build() };
  })(),
  raft: (() => {
    const p = new MeshBuilder(), f = new MeshBuilder(), l = new MeshBuilder();
    for (let x = -1; x <= 1; x += 0.5) p.box(x - 0.22, 0, -1.3, x + 0.22, 0.3, 1.3, W);
    f.box(-1.2, 0.3, -0.6, 1.2, 0.36, -0.4, hex('#6a4a2a'));
    l.box(-0.05, 0, 0, 0.05, 0.01, 0.01, hex('#000'));
    return { paint: p.build(), fixed: f.build(), lights: l.build() };
  })(),
  heli: (() => {
    const p = new MeshBuilder(), f = new MeshBuilder(), l = new MeshBuilder(), r = new MeshBuilder();
    p.box(-1.1, 0.5, -1.6, 1.1, 2.3, 1.8, W);
    p.box(-0.3, 1.4, -5.5, 0.3, 1.9, -1.6, W);
    f.box(-1.0, 1.3, 1.8, 1.0, 2.1, 1.85, hex('#2a3a4a'));
    f.box(-0.05, 1.4, -5.5, 0.05, 2.6, -4.8, hex('#555'));
    f.box(-1.0, 0, -1.4, -0.9, 0.5, 1.4, hex('#333')).box(0.9, 0, -1.4, 1.0, 0.5, 1.4, hex('#333'));
    f.box(-0.1, 2.3, -0.1, 0.1, 2.7, 0.1, hex('#333'));
    r.box(-5, 2.7, -0.18, 5, 2.78, 0.18, hex('#2a2a2a')).box(-0.18, 2.7, -5, 0.18, 2.78, 5, hex('#2a2a2a'));
    l.box(-0.15, 0.6, 1.8, 0.15, 0.8, 1.86, hex('#ff3030'));
    return { paint: p.build(), fixed: f.build(), lights: l.build(), rotor: r.build() };
  })(),
  plane: (() => {
    const f = new MeshBuilder(), l = new MeshBuilder();
    const q = new MeshBuilder();
    q.box(-1.6, 1.0, -11, 1.6, 4.0, 11, W);
    q.tri([-1.6, 4.0, 11], [1.6, 4.0, 11], [0, 2.6, 14], W).tri([1.6, 1.0, 11], [-1.6, 1.0, 11], [0, 2.6, 14], W);
    q.tri([-1.6, 1.0, 11], [-1.6, 4.0, 11], [0, 2.6, 14], W).tri([1.6, 4.0, 11], [1.6, 1.0, 11], [0, 2.6, 14], W);
    f.box(-15, 2.0, -2, 15, 2.4, 2.5, hex('#c8ccd4'));
    f.box(-5.5, 4.0, -10.8, 5.5, 4.3, -8.6, hex('#c8ccd4'));
    f.box(-0.15, 4.0, -11, 0.15, 8.5, -8.4, hex('#2a5ad0'));
    for (const sx of [-6, 6]) f.cyl(sx, 1.2, 0.5, 0.9, 0.01, 8, hex('#555'));
    for (const sx of [-6, 6]) f.box(sx - 0.8, 1.0, -1, sx + 0.8, 2.0, 2.4, hex('#7a7f86'));
    f.box(-1.62, 2.8, -9, 1.62, 3.2, 9, hex('#2a3a4a'));
    f.box(-0.3, 0, 8, 0.3, 1.0, 8.6, hex('#1c1c1e')).box(-2.2, 0, -1, -1.6, 1.0, 0, hex('#1c1c1e')).box(1.6, 0, -1, 2.2, 1.0, 0, hex('#1c1c1e'));
    l.box(-15.1, 2.0, -0.2, -14.9, 2.4, 0.2, hex('#ff3030')).box(14.9, 2.0, -0.2, 15.1, 2.4, 0.2, hex('#30ff60'));
    return { paint: q.build(), fixed: f.build(), lights: l.build() };
  })(),
  balloon: (() => {
    const p = new MeshBuilder(), f = new MeshBuilder(), l = new MeshBuilder();
    p.blob(0, 9, 0, 5, 6.5, 5, W);
    f.box(-0.9, 0, -0.9, 0.9, 1.1, 0.9, hex('#8a6a42'));
    for (const [x, z] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) f.box(x - 0.03, 1.1, z - 0.03, x + 0.03, 4.4, z + 0.03, hex('#444'));
    l.box(-0.2, 1.2, -0.2, 0.2, 1.6, 0.2, hex('#ffb040'));
    return { paint: p.build(), fixed: f.build(), lights: l.build() };
  })(),
  ufo: (() => {
    const p = new MeshBuilder(), f = new MeshBuilder(), l = new MeshBuilder();
    p.cyl(0, 0, 0, 6, 0.8, 16, W, W, 3);
    p.cyl(0, -0.6, 0, 3, 0.6, 16, W, W, 6);
    f.blob(0, 1.2, 0, 2.4, 1.4, 2.4, hex('#9ae0c0'));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      l.boxC(Math.cos(a) * 5, 0.4, Math.sin(a) * 5, 0.6, 0.4, 0.6, hex(i % 2 ? '#80ffb0' : '#ffe060'));
    }
    return { paint: p.build(), fixed: f.build(), lights: l.build() };
  })(),
  sleigh: (() => {
    const p = new MeshBuilder(), f = new MeshBuilder(), l = new MeshBuilder();
    p.box(-0.9, 0.4, -1.4, 0.9, 1.3, 1.2, W);
    f.box(-1.0, 0, -1.6, -0.8, 0.15, 1.8, hex('#d0b040')).box(0.8, 0, -1.6, 1.0, 0.15, 1.8, hex('#d0b040'));
    for (let k = 0; k < 4; k++) {
      const z = 3 + k * 2.2;
      f.box(-0.35, 0.8, z - 0.8, 0.35, 1.5, z + 0.8, hex('#8a5a3a'));
      f.box(-0.2, 1.4, z + 0.6, 0.2, 2.2, z + 1.0, hex('#8a5a3a'));
    }
    l.boxC(0, 1.9, 3 + 3 * 2.2 + 1, 0.3, 0.3, 0.3, hex('#ff2020'));
    return { paint: p.build(), fixed: f.build(), lights: l.build() };
  })(),
};

/* ---------- props ---------- */
export const PROPS: Record<string, { geo: THREE.BufferGeometry; tinted?: boolean; glow?: boolean }> = {
  cone: { geo: new MeshBuilder().cone(0, 0, 0, 0.28, 0.75, 6, hex('#f26a1a')).box(-0.3, 0, -0.3, 0.3, 0.06, 0.3, hex('#222')).build() },
  barrier: { geo: new MeshBuilder().box(-1.6, 0.6, -0.06, 1.6, 1.0, 0.06, hex('#e8e8e8')).box(-1.5, 0, -0.06, -1.35, 0.6, 0.06, hex('#c03030')).box(1.35, 0, -0.06, 1.5, 0.6, 0.06, hex('#c03030')).build() },
  banner: { geo: new MeshBuilder().box(-1.8, 2.0, -0.04, 1.8, 3.3, 0.04, W).build(), tinted: true },
  bannerPoles: { geo: new MeshBuilder().box(-1.9, 0, -0.06, -1.8, 3.6, 0.06, hex('#6a5a4a')).box(1.8, 0, -0.06, 1.9, 3.6, 0.06, hex('#6a5a4a')).build() },
  tent: { geo: new MeshBuilder().gableZ(-1.8, 1.8, 0, 2.4, -1.6, 1.6, W, W).build(), tinted: true },
  stall: {
    geo: new MeshBuilder().box(-1.4, 0, -0.8, 1.4, 1.0, 0.8, hex('#8a5a3a')).box(-1.4, 1.0, -0.8, -1.3, 2.3, -0.7, hex('#6a4a2a')).box(1.3, 1.0, -0.8, 1.4, 2.3, -0.7, hex('#6a4a2a')).gableX(-1.6, 1.6, 2.2, 2.9, -1.0, 1.0, hex('#c0392b'), hex('#f4f0e4')).build(),
  },
  towel: { geo: new MeshBuilder().box(-0.45, 0, -0.9, 0.45, 0.04, 0.9, W).build(), tinted: true },
  umbrella: { geo: new MeshBuilder().box(-0.04, 0, -0.04, 0.04, 2.0, 0.04, hex('#ddd')).cone(0, 1.75, 0, 1.2, 0.45, 8, W).build(), tinted: true },
  handUmbrella: { geo: new MeshBuilder().box(-0.02, 1.3, -0.02, 0.02, 2.1, 0.02, hex('#333')).cone(0, 1.95, 0, 0.55, 0.25, 8, W).build(), tinted: true },
  bucket: { geo: new MeshBuilder().cyl(0, 0.55, 0.32, 0.13, 0.22, 6, hex('#7a7f86')).build() },
  camera: { geo: new MeshBuilder().box(0.12, 1.45, 0.05, 0.32, 1.62, 0.42, hex('#222')).build() },
  placard: { geo: new MeshBuilder().box(-0.02, 1.0, 0.3, 0.02, 2.4, 0.34, hex('#8a6a42')).box(-0.45, 2.0, 0.3, 0.45, 2.6, 0.34, W).build(), tinted: true },
  soapbox: { geo: new MeshBuilder().box(-0.6, 0, -0.5, 0.6, 0.6, 0.5, hex('#a07a4a')).build() },
  booth: { geo: new MeshBuilder().box(-0.6, 0, -0.5, 0.6, 2.1, 0.5, W).box(-0.65, 2.1, -0.55, 0.65, 2.2, 0.55, hex('#333')).build(), tinted: true },
  dog: { geo: new MeshBuilder().box(-0.13, 0.22, -0.32, 0.13, 0.45, 0.25, W).box(-0.1, 0.38, 0.22, 0.1, 0.58, 0.45, W).box(-0.12, 0, -0.3, -0.04, 0.24, -0.22, W).box(0.04, 0, -0.3, 0.12, 0.24, -0.22, W).box(-0.12, 0, 0.14, -0.04, 0.24, 0.22, W).box(0.04, 0, 0.14, 0.12, 0.24, 0.22, W).build(), tinted: true },
  duck: { geo: new MeshBuilder().box(-0.15, 0, -0.25, 0.15, 0.22, 0.2, hex('#f4f0e4')).box(-0.08, 0.2, 0.12, 0.08, 0.38, 0.28, hex('#2a7a3a')).box(-0.04, 0.26, 0.28, 0.04, 0.3, 0.38, hex('#e0a020')).build() },
  bird: { geo: new MeshBuilder().tri([-0.7, 0.1, -0.1], [0, 0, 0.2], [0, 0, -0.2], hex('#2a2a2a')).tri([0, 0, -0.2], [0, 0, 0.2], [-0.7, 0.1, -0.1], hex('#2a2a2a')).tri([0.7, 0.1, -0.1], [0, 0, -0.2], [0, 0, 0.2], hex('#2a2a2a')).tri([0, 0, 0.2], [0, 0, -0.2], [0.7, 0.1, -0.1], hex('#2a2a2a')).build() },
  flame: { geo: new MeshBuilder().cone(0, 0, 0, 0.9, 2.6, 5, W).build(), glow: true, tinted: true },
  smoke: { geo: new MeshBuilder().blob(0, 0, 0, 1, 0.9, 1, W).build(), tinted: true },
  torch: { geo: new MeshBuilder().boxC(0, 1.6, 0.35, 0.16, 0.16, 0.16, W).build(), glow: true, tinted: true },
  diya: { geo: new THREE.SphereGeometry(0.06, 8, 6).scale(1, 1.4, 1).translate(0, 0.1, 0), glow: true, tinted: true },
  puddle: { geo: new MeshBuilder().cyl(0, 0.035, 0, 1, 0.01, 8, W).build(), tinted: true },
  xtree: {
    geo: new MeshBuilder().cyl(0, 0, 0, 0.5, 2.4, 6, hex('#5a3a22')).cone(0, 2, 0, 4.6, 5.5, 9, hex('#2a6a3a')).cone(0, 5.6, 0, 3.4, 4.6, 9, hex('#2f7040')).cone(0, 8.6, 0, 2.2, 4.0, 9, hex('#347848')).build(),
  },
  xstar: { geo: new MeshBuilder().boxC(0, 12.9, 0, 0.9, 0.9, 0.3, W).boxC(0, 12.9, 0, 0.3, 0.9, 0.9, W).build(), glow: true, tinted: true },
  bulb: { geo: new THREE.SphereGeometry(0.09, 8, 6), glow: true, tinted: true },
  funnel: { geo: new MeshBuilder().cyl(0, 0, 0, 1.5, 34, 10, W, W, 9).build(), tinted: true },
  log: { geo: new MeshBuilder().box(-0.5, 0, -6, 0.5, 1.0, 6, hex('#5a3a22')).cone(0, 0.4, 5, 1.8, 4, 6, hex('#2a6a3a')).build() },
  crate: { geo: new MeshBuilder().box(-0.5, 0, -0.5, 0.5, 0.9, 0.5, hex('#a07a4a')).build() },
  /* V2 (Milestone 4): building materials on site, a traffic signal, a paramedic's bag */
  bricks: { geo: new MeshBuilder().box(-0.6, 0, -0.5, 0.6, 0.14, 0.5, hex('#8a6a46')).box(-0.55, 0.14, -0.45, 0.55, 0.78, 0.45, hex('#9a4a34')).box(-0.56, 0.4, -0.46, 0.56, 0.43, 0.46, hex('#b8ad9c')).build() },
  timber: { geo: new MeshBuilder().box(-0.6, 0, -0.5, 0.6, 0.14, 0.5, hex('#8a6a46')).box(-0.55, 0.14, -1.6, -0.05, 0.6, 1.6, hex('#c8a070')).box(0.05, 0.14, -1.6, 0.55, 0.48, 1.6, hex('#b89060')).build() },
  sigPole: {
    geo: new MeshBuilder()
      .box(-0.06, 0, -0.06, 0.06, 3.35, 0.06, hex('#141416'))
      .box(-0.17, 2.35, 0.06, 0.17, 3.35, 0.29, hex('#0c0c0e')).box(-0.26, 2.26, 0.29, 0.26, 3.44, 0.3, hex('#0c0c0e'))
      .box(-0.17, 2.35, -0.29, 0.17, 3.35, -0.06, hex('#0c0c0e')).box(-0.26, 2.26, -0.3, 0.26, 3.44, -0.29, hex('#0c0c0e'))
      .build(),
  },
  medbag: { geo: new MeshBuilder().box(-0.22, 0, -0.14, 0.22, 0.28, 0.14, hex('#2a8a4a')).box(-0.05, 0.12, 0.141, 0.05, 0.22, 0.15, hex('#f4f4f4')).build() },
  /* V2 (Milestone 6): straw bales on a harvested row, a timber pole the linesmen climb, a load carried in the arms */
  bale: { geo: new MeshBuilder().cyl(0, 0, 0, 0.62, 1.15, 10, hex('#d0b05a'), hex('#e0c878')).build() },
  pole: {
    geo: new MeshBuilder()
      .cyl(0, 0, 0, 0.13, 7.8, 8, hex('#6a4e34'))
      .box(-1.1, 7.0, -0.07, 1.1, 7.16, 0.07, hex('#5a4230'))
      .box(-0.95, 7.16, -0.04, -0.85, 7.34, 0.04, hex('#e8e4dc')).box(-0.05, 7.16, -0.04, 0.05, 7.34, 0.04, hex('#e8e4dc')).box(0.85, 7.16, -0.04, 0.95, 7.34, 0.04, hex('#e8e4dc'))
      .box(-0.25, 5.6, 0.13, 0.25, 6.3, 0.45, hex('#7a7f86'))
      .build(),
  },
  carry: { geo: new MeshBuilder().box(-0.28, 0.95, 0.22, 0.28, 1.3, 0.62, hex('#a07a4a')).build() },
  /* V2 (Milestone 7): a slug of water in a hose's jet, lit like everything else so it shows in daylight */
  jet: { geo: new MeshBuilder().blob(0, 0, 0, 0.12, 0.12, 0.42, W).build(), tinted: true },
};

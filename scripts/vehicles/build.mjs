/* ============================================================
   Vehicle build: the downloaded vehicles (assets-src/vehicles,
   credited in public/models/CREDITS.md) into small game files.
   For each vehicle in fleet.json: read the GLB, put every part
   in world space, turn it to face +z standing on the ground at
   its real size, and sort its parts: plain body paint (tinted
   per car), glass, wheels (one wheel and where the others go),
   lamps (which glow, found by name) and everything else, whose
   textures go into one 1024² atlas. Then cut a lighter model
   and a far model (one mesh, drawn instanced for distant
   traffic) and write a meshopt-compressed GLB, plus an index of
   the fleet with each one's measurements.
   Usage: node scripts/vehicles/build.mjs [id ...]
   ============================================================ */
/* global console, process, Buffer */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import sharp from 'sharp';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP } from '@gltf-transform/extensions';
import { quantize, reorder } from '@gltf-transform/functions';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '../../assets-src/vehicles');
const OUT = join(HERE, '../../public/models/vehicles');
const FLEET = JSON.parse(readFileSync(join(HERE, 'fleet.json'), 'utf8'));
const ATLAS = 1024;

/* what a part is, by its node's and material's names */
const RE = {
  drop: /(head|tail)lights?_?glass|_shadow|shadow_|wolf3d/i,
  wheel: /wheel|tire|tyre/i,
  glass: /glass|transp|window|windshield|windscreen/i,
  paint: /body_?mat/i,
  head: /head_?lights?|headlamp|front_?lights?/i,
  tail: /brake_?lights?|tail_?lights?|rear_?lights?|stop_?lights?/i,
  siren: /light_?bar|siren|strobe/i,
  beacon: /beacon|taxi_?sign|roof_?sign/i,
  inside: /interior|steering|seat|dashboard|engine/i,
};

/* ---------- soup: triangles as flat arrays, everything in world space ---------- */
class Soup {
  pos = []; nor = []; uv = []; col = []; pbr = []; glow = []; paint = [];
  get count() { return this.pos.length / 3; }
  push(p, n, uv, c, pbr, glow, paint) {
    this.pos.push(p.x, p.y, p.z); this.nor.push(n.x, n.y, n.z); this.uv.push(uv[0], uv[1]); this.col.push(c[0], c[1], c[2]); this.pbr.push(pbr[0], pbr[1]); this.glow.push(glow); this.paint.push(paint);
  }
  append(o) { for (const k of ['pos', 'nor', 'uv', 'col', 'pbr', 'glow', 'paint']) for (const v of o[k]) this[k].push(v); return this; }
  transform(m) {
    const v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(m);
    for (let i = 0; i < this.count; i++) {
      v.fromArray(this.pos, i * 3).applyMatrix4(m).toArray(this.pos, i * 3);
      v.fromArray(this.nor, i * 3).applyMatrix3(nm).normalize().toArray(this.nor, i * 3);
    }
    return this;
  }
  bounds() {
    const b = new THREE.Box3();
    const v = new THREE.Vector3();
    for (let i = 0; i < this.count; i++) b.expandByPoint(v.fromArray(this.pos, i * 3));
    return b;
  }
  filter(fn) {
    const o = new Soup();
    for (let t = 0; t < this.count; t += 3) {
      if (!fn(t)) continue;
      for (let i = t; i < t + 3; i++) for (const [k, n] of [['pos', 3], ['nor', 3], ['uv', 2], ['col', 3], ['pbr', 2], ['glow', 1], ['paint', 1]]) for (let c = 0; c < n; c++) o[k].push(this[k][i * n + c]);
    }
    return o;
  }
}

/** weld a soup into an indexed mesh (identical vertices shared), then simplify it towards `target` triangles, never
 *  moving the surface by more than `err` of the model's size (V2: it was a quarter of it, and the simplifier carved
 *  holes and dents in trucks, ambulances and the fire engine to reach its target) */
function indexed(s, target = Infinity, flags = [], err = 0.01) {
  const key = new Map(), remap = [], verts = [];
  for (let i = 0; i < s.count; i++) {
    const k = [s.pos[i * 3], s.pos[i * 3 + 1], s.pos[i * 3 + 2], s.nor[i * 3], s.nor[i * 3 + 1], s.nor[i * 3 + 2], s.uv[i * 2], s.uv[i * 2 + 1], s.col[i * 3], s.col[i * 3 + 1], s.col[i * 3 + 2], s.glow[i], s.paint[i]].map((x) => Math.round(x * 1e4)).join(',');
    let r = key.get(k);
    if (r === undefined) { r = verts.length; key.set(k, r); verts.push(i); }
    remap.push(r);
  }
  const n = verts.length;
  const A = { pos: new Float32Array(n * 3), nor: new Float32Array(n * 3), uv: new Float32Array(n * 2), col: new Float32Array(n * 3), pbr: new Float32Array(n * 2), glow: new Float32Array(n), paint: new Float32Array(n) };
  verts.forEach((i, d) => {
    A.pos.set(s.pos.slice(i * 3, i * 3 + 3), d * 3); A.nor.set(s.nor.slice(i * 3, i * 3 + 3), d * 3); A.uv.set(s.uv.slice(i * 2, i * 2 + 2), d * 2);
    A.col.set(s.col.slice(i * 3, i * 3 + 3), d * 3); A.pbr.set(s.pbr.slice(i * 2, i * 2 + 2), d * 2); A.glow[d] = s.glow[i]; A.paint[d] = s.paint[i];
  });
  let index = Uint32Array.from(remap);
  if (index.length / 3 > target) {
    const attr = new Float32Array(n * 8);
    for (let d = 0; d < n; d++) attr.set([A.nor[d * 3], A.nor[d * 3 + 1], A.nor[d * 3 + 2], A.uv[d * 2], A.uv[d * 2 + 1], A.col[d * 3], A.col[d * 3 + 1], A.col[d * 3 + 2]], d * 8);
    [index] = MeshoptSimplifier.simplifyWithAttributes(index, A.pos, 3, attr, 8, [0.4, 0.4, 0.4, 1, 1, 0.6, 0.6, 0.6], null, Math.max(3, Math.floor(target) * 3), err, flags);
  }
  // keep only the used vertices
  const used = new Int32Array(n).fill(-1);
  let m = 0;
  const idx = index.map((v) => (used[v] < 0 ? (used[v] = m++) : used[v]));
  const C = { pos: new Float32Array(m * 3), nor: new Float32Array(m * 3), uv: new Float32Array(m * 2), col: new Float32Array(m * 3), pbr: new Float32Array(m * 2), glow: new Float32Array(m), paint: new Float32Array(m) };
  for (let v = 0; v < n; v++) {
    const d = used[v];
    if (d < 0) continue;
    for (const [k, w] of [['pos', 3], ['nor', 3], ['uv', 2], ['col', 3], ['pbr', 2], ['glow', 1], ['paint', 1]]) for (let c = 0; c < w; c++) C[k][d * w + c] = A[k][v * w + c];
  }
  return { ...C, index: idx, tris: idx.length / 3 };
}

/* ---------- images ---------- */
const IMG = new Map();
async function image(tex) {
  let r = IMG.get(tex);
  if (!r) {
    const { data, info } = await sharp(Buffer.from(tex.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    r = { data, w: info.width, h: info.height, buf: Buffer.from(tex.getImage()) };
    IMG.set(tex, r);
  }
  return r;
}
async function average(tex) {
  const { data } = await sharp(Buffer.from(tex.getImage())).ensureAlpha().resize(1, 1, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  const s2l = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return [s2l(data[0]), s2l(data[1]), s2l(data[2]), data[3] / 255];
}

/* ---------- one vehicle ---------- */
async function build(entry, io) {
  const doc = await io.read(join(SRC, entry.src));
  const root = doc.getRoot(), scene = root.getDefaultScene() || root.listScenes()[0];
  const drop = new RegExp([RE.drop.source, entry.drop].filter(Boolean).join('|'), 'i');
  const wheels = entry.wheels !== false;
  const tint = entry.tint !== false;
  const glowOverride = entry.glow || {};

  /* every primitive, with its node's world matrix (or its skin at rest) */
  const prims = [];
  scene.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    for (const prim of mesh.listPrimitives()) prims.push({ node, prim, name: `${node.getName()} ${mesh.getName()}`, mat: prim.getMaterial() });
  });

  /* materials: atlas slots for textured ones with in-range uvs, flat colours otherwise */
  const slots = new Map(); // key → { tex, alpha, size }
  const flat = new Map(); // texture → average colour
  const plans = [];
  for (const p of prims) {
    const mat = p.mat, mname = mat?.getName() || '';
    const label = `${p.name} ${mname}`;
    if (drop.test(label) || (p.prim.getMode() !== 4)) { plans.push(null); continue; }
    const blend = mat && mat.getAlphaMode() === 'BLEND';
    let kind = entry.rotor && new RegExp(entry.rotor, 'i').test(label) ? 'rotor' : 'kit';
    if (kind === 'rotor') { /* the main rotor, spun on its own */ }
    else if (wheels && RE.wheel.test(p.name) && !/steer/i.test(p.name)) kind = 'wheel';
    else if (blend && RE.glass.test(label) && !/numberplate|badge|decal|sticker/i.test(label)) kind = 'glass';
    else if (tint && RE.paint.test(mname) && !mat.getBaseColorTexture()) kind = 'paint';
    let glow = 0;
    for (const [k, ch] of Object.entries(glowOverride)) if (new RegExp(k, 'i').test(label)) glow = ch;
    if (!glow) glow = RE.siren.test(p.name) ? 5 : RE.beacon.test(p.name) ? 7 : RE.tail.test(p.name) ? 4 : RE.head.test(p.name) ? 1 : 0;
    // (some models are coloured through their emissive map over a near-black base: that map is their look)
    const fac0 = mat ? mat.getBaseColorFactor() : [0.8, 0.8, 0.8, 1];
    const dark = fac0[0] * 0.3 + fac0[1] * 0.59 + fac0[2] * 0.11 < 0.3;
    let emisLook = false;
    if (mat && mat.getEmissiveTexture() && dark) { const a = await average(mat.getEmissiveTexture()); emisLook = a[0] + a[1] + a[2] > 0.15; }
    const tex = (emisLook ? mat.getEmissiveTexture() : mat?.getBaseColorTexture()) || null;
    const uv = p.prim.getAttribute('TEXCOORD_' + (mat?.getBaseColorTextureInfo()?.getTexCoord() ?? 0)) || p.prim.getAttribute('TEXCOORD_0');
    let inRange = !!uv;
    if (uv) {
      const e = [];
      for (let i = 0; i < uv.getCount(); i++) { uv.getElement(i, e); if (e[0] < -0.02 || e[0] > 1.02 || e[1] < -0.02 || e[1] > 1.02) { inRange = false; break; } }
    }
    const alpha = mat && mat.getAlphaMode() !== 'OPAQUE';
    let slot = null;
    if (tex && kind !== 'glass' && kind !== 'paint') {
      if (inRange) {
        const key = `${root.listTextures().indexOf(tex)}:${alpha ? 'a' : 'o'}`;
        if (!slots.has(key)) {
          const im = await image(tex);
          slots.set(key, { tex, alpha, size: Math.max(32, Math.min(512, Math.max(im.w, im.h) / 4)) });
        }
        slot = key;
      } else if (!flat.has(tex)) flat.set(tex, await average(tex));
    }
    // roughness and metalness: the factors, scaled by the average of a metal/rough map if there is one
    let rough = mat ? mat.getRoughnessFactor() : 0.6, metal = mat ? mat.getMetallicFactor() : 0;
    const mr = mat?.getMetallicRoughnessTexture();
    if (mr) { const a = await average(mr); rough *= Math.sqrt(a[1]); metal *= Math.sqrt(a[2]); }
    else if (!mat) { rough = 0.6; metal = 0; }
    plans.push({ kind, glow, tex, slot, uvAttr: uv, rough: Math.min(1, Math.max(0.05, rough)), metal: Math.min(1, Math.max(0, metal)), factor: emisLook ? [...mat.getEmissiveFactor(), 1] : tex && dark ? [1, 1, 1, 1] : fac0, inside: RE.inside.test(label) });
  }

  /* pack the atlas (shelves; everything halves until it fits) */
  let list = [...slots.entries()].sort((a, b) => b[1].size - a[1].size);
  for (let tries = 0; tries < 6; tries++) {
    let x = 0, y = 0, rowH = 0, ok = true;
    for (const [, s] of list) {
      if (x + s.size > ATLAS) { x = 0; y += rowH; rowH = 0; }
      if (y + s.size > ATLAS - 8) { ok = false; break; }
      s.x = x; s.y = y; x += s.size; rowH = Math.max(rowH, s.size);
    }
    if (ok) break;
    for (const [, s] of list) s.size = Math.max(16, s.size / 2);
  }
  const atlas = Buffer.alloc(ATLAS * ATLAS * 4, 255);
  for (const [, s] of list) {
    let img = sharp(Buffer.from(s.tex.getImage())).ensureAlpha().resize(s.size, s.size, { fit: 'fill' });
    // (repaint: a real operator's livery blurred and greyed, so no name, logo or registration survives)
    if (entry.repaint) img = img.blur(Math.max(1.5, s.size / 48)).modulate({ saturation: 0.25, brightness: 1.15 });
    const { data } = await img.raw().toBuffer({ resolveWithObject: true });
    for (let r = 0; r < s.size; r++) for (let c = 0; c < s.size; c++) {
      const si = (r * s.size + c) * 4, di = ((s.y + r) * ATLAS + s.x + c) * 4;
      atlas[di] = data[si]; atlas[di + 1] = data[si + 1]; atlas[di + 2] = data[si + 2]; atlas[di + 3] = s.alpha ? data[si + 3] : 255;
    }
  }
  // a white corner for untextured parts (the atlas starts white; reserve the last 8×8 by keeping slots off it)
  const WHITE = [1 - 4 / ATLAS, 1 - 4 / ATLAS];

  /* bake the primitives */
  const parts = { paint: new Soup(), glass: new Soup(), kit: new Soup(), rotor: new Soup() }, wheelParts = new Map();
  const v = new THREE.Vector3(), n = new THREE.Vector3(), M = new THREE.Matrix4(), NM = new THREE.Matrix3(), J = new THREE.Matrix4(), T = new THREE.Matrix4();
  for (let pi = 0; pi < prims.length; pi++) {
    const plan = plans[pi];
    if (!plan) continue;
    const { node, prim } = prims[pi];
    const P = prim.getAttribute('POSITION'), N = prim.getAttribute('NORMAL'), I = prim.getIndices();
    const skin = node.getSkin(), JO = prim.getAttribute('JOINTS_0'), WE = prim.getAttribute('WEIGHTS_0');
    const jointM = skin ? skin.listJoints().map((j, k) => { const ibm = []; skin.getInverseBindMatrices().getElement(k, ibm); return new THREE.Matrix4().fromArray(j.getWorldMatrix()).multiply(new THREE.Matrix4().fromArray(ibm)); }) : null;
    M.fromArray(node.getWorldMatrix());
    const count = I ? I.getCount() : P.getCount();
    const e = [], ej = [], ew = [], eu = [];
    const flatC = plan.tex && !plan.slot ? flat.get(plan.tex) : null;
    const s = plan.slot ? slots.get(plan.slot) : null;
    let target = plan.kind === 'wheel' ? null : parts[plan.kind];
    if (plan.kind === 'wheel') {
      // (by the part itself: two wheels can share a name)
      const k = pi;
      if (!wheelParts.has(k)) wheelParts.set(k, new Soup());
      target = wheelParts.get(k);
    }
    // (faces the other way round under a mirroring matrix)
    const flip = M.determinant() < 0;
    const order = flip ? [0, 2, 1] : [0, 1, 2];
    for (let t = 0; t < count; t += 3)
      for (const o of order) {
        const i = I ? I.getScalar(t + o) : t + o;
        P.getElement(i, e); v.fromArray(e);
        if (N) { N.getElement(i, e); n.fromArray(e); } else n.set(0, 1, 0);
        if (skin && JO && WE) {
          JO.getElement(i, ej); WE.getElement(i, ew);
          J.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
          let wsum = 0;
          for (let k = 0; k < 4; k++) if (ew[k]) { T.copy(jointM[ej[k]]); wsum += ew[k]; for (let q = 0; q < 16; q++) J.elements[q] += T.elements[q] * ew[k]; }
          // (a vertex no bone holds stays where its node puts it)
          if (wsum < 1e-4) J.copy(M); else if (Math.abs(wsum - 1) > 1e-3) for (let q = 0; q < 16; q++) J.elements[q] /= wsum;
          v.applyMatrix4(J); n.applyMatrix3(NM.getNormalMatrix(J)).normalize();
        } else { v.applyMatrix4(M); n.applyMatrix3(NM.getNormalMatrix(M)).normalize(); }
        let uv = WHITE, col = plan.factor.slice(0, 3);
        if (s && plan.uvAttr) {
          plan.uvAttr.getElement(i, eu);
          const u = Math.min(1, Math.max(0, eu[0])), w = Math.min(1, Math.max(0, eu[1]));
          uv = [(s.x + 0.5 + u * (s.size - 1)) / ATLAS, (s.y + 0.5 + w * (s.size - 1)) / ATLAS];
        } else if (flatC) col = col.map((c, k) => c * flatC[k]);
        if (plan.kind === 'paint') col = [1, 1, 1];
        target.push(v, n, uv, col, [plan.rough, plan.metal], plan.glow, plan.kind === 'paint' ? 1 : 0);
      }
    if (plan.inside) for (let k = target.count - count; k < target.count; k++) target.glow[k] = target.glow[k] || -1; // (marks the inside: left out of the far models)
  }

  /* turn, scale and stand it: front to +z, centred, wheels (or lowest point) on the ground */
  const all = new Soup().append(parts.paint).append(parts.kit).append(parts.glass);
  for (const w of wheelParts.values()) all.append(w);
  const b0 = all.bounds(), c0 = b0.getCenter(new THREE.Vector3()), s0 = b0.getSize(new THREE.Vector3());
  let fwd = entry.forward && entry.forward !== 'auto' ? entry.forward : null;
  if (!fwd) {
    // the axis it's longest along, pointing where its headlamps are (or failing that, its front: the lower, longer end)
    const ax = s0.x > s0.z ? 'x' : 'z', k = ax === 'x' ? 0 : 2;
    let sum = 0, cnt = 0;
    for (let i = 0; i < all.count; i++) if (all.glow[i] === 1) { sum += all.pos[i * 3 + k] - (ax === 'x' ? c0.x : c0.z); cnt++; }
    fwd = (cnt ? (sum >= 0 ? '+' : '-') : '+') + ax;
  }
  const yaw = { '+z': 0, '-z': Math.PI, '+x': -Math.PI / 2, '-x': Math.PI / 2 }[fwd];
  const R = new THREE.Matrix4().makeRotationY(yaw);
  const len = fwd.endsWith('x') ? s0.x : s0.z;
  const scale = entry.length ? entry.length / len : 1;
  const place = new THREE.Matrix4().makeScale(scale, scale, scale).multiply(R).multiply(new THREE.Matrix4().makeTranslation(-c0.x, -b0.min.y, -c0.z));
  for (const p of [parts.paint, parts.kit, parts.glass, parts.rotor, ...wheelParts.values()]) p.transform(place);

  /* wheels: their centres, and the front-left one as the wheel every corner uses */
  const wheelsAt = [];
  let wheelGeo = null, wheelR = 0.32;
  const clusters = [];
  for (const ws of wheelParts.values()) {
    const b = ws.bounds(), c = b.getCenter(new THREE.Vector3());
    const cl = clusters.find((q) => q.c.distanceTo(c) < 0.25);
    if (!cl) { clusters.push({ s: new Soup().append(ws), b: b.clone(), c, boxes: [b] }); continue; }
    if (cl.boxes.some((q) => q.min.distanceTo(b.min) < 0.005 && q.max.distanceTo(b.max) < 0.005)) continue;
    cl.s.append(ws); cl.b.union(b); cl.boxes.push(b);
  }
  if (clusters.length >= 4) {
    const w = clusters;
    for (const x of w) x.c = x.b.getCenter(new THREE.Vector3());
    const ground = Math.min(...w.map((x) => x.b.min.y));
    for (const p of [parts.paint, parts.kit, parts.glass, parts.rotor, ...w.map((x) => x.s)]) p.transform(new THREE.Matrix4().makeTranslation(0, -ground, 0));
    for (const x of w) { x.c.y -= ground; wheelsAt.push(x.c.toArray().map((q) => +q.toFixed(3))); }
    const fl = w.filter((x) => x.c.x > 0).sort((a, b) => b.c.z - a.c.z)[0] || w[0];
    wheelR = +((fl.b.max.y - fl.b.min.y) / 2).toFixed(3);
    wheelGeo = fl.s.transform(new THREE.Matrix4().makeTranslation(-fl.c.x, -fl.c.y, -fl.c.z));
    wheelsAt.sort((a, b) => b[2] - a[2] || b[0] - a[0]);
  }
  // a main rotor: centred on its hub, to spin there
  let rotorAt = null, rotorGeo = null;
  if (parts.rotor.count) {
    const rb = parts.rotor.bounds(), rc = rb.getCenter(new THREE.Vector3());
    rotorAt = rc.toArray().map((q) => +q.toFixed(3));
    rotorGeo = indexed(parts.rotor.transform(new THREE.Matrix4().makeTranslation(-rc.x, -rc.y, -rc.z)), 400);
  }
  // siren halves flash in turn: left half one colour, right half the other
  for (let i = 0; i < parts.kit.count; i++) if (parts.kit.glow[i] === 5 && parts.kit.pos[i * 3] < 0) parts.kit.glow[i] = 6;

  const B = new Soup().append(parts.paint).append(parts.kit).append(parts.glass).bounds();
  const dims = { L: +(B.max.z - B.min.z).toFixed(3), W: +(B.max.x - B.min.x).toFixed(3), H: +B.max.y.toFixed(3) };
  if (wheelsAt.length) dims.WB = +(wheelsAt[0][2] - wheelsAt[wheelsAt.length - 1][2]).toFixed(3);
  // headlamps (a point each side) and the beam's origin between them
  const lamps = { L: [], R: [] };
  for (let i = 0; i < parts.kit.count; i++) if (parts.kit.glow[i] === 1) (parts.kit.pos[i * 3] >= 0 ? lamps.L : lamps.R).push([parts.kit.pos[i * 3], parts.kit.pos[i * 3 + 1], parts.kit.pos[i * 3 + 2]]);
  const mid = (a) => a.length ? a.reduce((s, p) => [s[0] + p[0] / a.length, s[1] + p[1] / a.length, Math.max(s[2], p[2])], [0, 0, -1e9]) : null;
  const headAt = [mid(lamps.L), mid(lamps.R)].filter(Boolean).map((p) => [+p[0].toFixed(3), +p[1].toFixed(3), +(p[2] + 0.02).toFixed(3)]);
  const beamAt = headAt.length === 2 ? [0, +((headAt[0][1] + headAt[1][1]) / 2).toFixed(3), +((headAt[0][2] + headAt[1][2]) / 2 + 0.03).toFixed(3)] : null;

  /* levels of detail: near, mid (no interior), far (one mesh, everything, for instancing) */
  // (V2: the near model is the model as made, up to 24 000 triangles: drawn only within 30 m, a few at a time; it was cut
  // to 9 000, half or less of most of them, and looked unfinished)
  const tot = parts.paint.count / 3 + parts.kit.count / 3;
  const k0 = Math.min(1, 24000 / Math.max(1, tot));
  const outside = (s) => s.filter((t) => s.glow[t] !== -1);
  const near = { paint: indexed(parts.paint, (parts.paint.count / 3) * k0, [], 0.004), kit: indexed(parts.kit, (parts.kit.count / 3) * k0, [], 0.004), glass: indexed(parts.glass), wheel: wheelGeo ? indexed(wheelGeo, 900, [], 0.01) : null };
  const midL = { paint: indexed(parts.paint, Math.max(400, parts.paint.count / 3 * 0.45), [], 0.02), kit: indexed(outside(parts.kit), Math.max(400, parts.kit.count / 3 * 0.35), [], 0.02), glass: indexed(parts.glass, Math.max(50, parts.glass.count / 3 * 0.5), [], 0.02), wheel: wheelGeo ? indexed(wheelGeo, 240, [], 0.03) : null };
  const farS = new Soup().append(parts.paint).append(outside(parts.kit));
  const gl = parts.glass;
  for (let i = 0; i < gl.count; i++) farS.push(new THREE.Vector3().fromArray(gl.pos, i * 3), new THREE.Vector3().fromArray(gl.nor, i * 3), WHITE, [0.02, 0.025, 0.03], [0.1, 0.3], 0, 0);
  if (wheelGeo) for (const c of wheelsAt) {
    const w = new Soup().append(wheelGeo);
    if (c[0] < 0) w.transform(new THREE.Matrix4().makeRotationY(Math.PI));
    farS.append(w.transform(new THREE.Matrix4().makeTranslation(c[0], c[1], c[2])));
  }
  const far = indexed(farS, entry.far || 1600, ['Prune'], 0.05);

  /* the GLB */
  const out = new Document();
  const buf = out.createBuffer();
  out.createExtension(EXTTextureWebP).setRequired(true);
  const webp = await sharp(atlas, { raw: { width: ATLAS, height: ATLAS, channels: 4 } }).webp({ quality: 80, alphaQuality: 90, effort: 6 }).toBuffer();
  const tex = out.createTexture('atlas').setImage(new Uint8Array(webp)).setMimeType('image/webp');
  const mat = out.createMaterial('atlas').setBaseColorTexture(tex).setAlphaMode('MASK').setAlphaCutoff(0.5);
  const sc = out.createScene(entry.id);
  const tris = {};
  const add = (name, g, full) => {
    if (!g || !g.tris) return;
    const a = (arr, type) => out.createAccessor().setType(type).setArray(arr).setBuffer(buf);
    const prim = out.createPrimitive().setMaterial(mat).setIndices(a(g.index.length < 65536 * 3 && g.pos.length / 3 < 65536 ? Uint16Array.from(g.index) : Uint32Array.from(g.index), 'SCALAR'))
      .setAttribute('POSITION', a(g.pos, 'VEC3')).setAttribute('NORMAL', a(g.nor, 'VEC3'));
    if (full) {
      // (colours and finishes as bytes: they are factors, not fine detail)
      const u8 = (arr) => Uint8Array.from(arr, (x) => Math.round(Math.min(1, Math.max(0, x)) * 255));
      prim.setAttribute('TEXCOORD_0', a(g.uv, 'VEC2')).setAttribute('COLOR_0', a(u8(g.col), 'VEC3').setNormalized(true)).setAttribute('_PBR', a(u8(g.pbr), 'VEC2').setNormalized(true)).setAttribute('_GLOW', a(Uint8Array.from(g.glow, (x) => Math.max(0, x)), 'SCALAR'));
      if (name === 'far') prim.setAttribute('_PAINT', a(Uint8Array.from(g.paint), 'SCALAR'));
    }
    sc.addChild(out.createNode(name).setMesh(out.createMesh(name).addPrimitive(prim)));
    tris[name] = g.tris;
  };
  add('paint0', near.paint, false); add('kit0', near.kit, true); add('glass0', near.glass, false); add('wheel0', near.wheel, true);
  add('paint1', midL.paint, false); add('kit1', midL.kit, true); add('glass1', midL.glass, false); add('wheel1', midL.wheel, true);
  add('far', far, true);
  add('rotor', rotorGeo, true);
  const meta = { id: entry.id, kind: entry.kind, style: entry.style || null, tint: tint && near.paint.tris > 0, dims, wheelR, wheelsAt, headAt, beamAt, rotorAt, tris };
  sc.setExtras(meta);
  await out.transform(reorder({ encoder: MeshoptEncoder, target: 'size' }), quantize({ pattern: /^(POSITION|NORMAL|TEXCOORD_0)$/, quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }));
  out.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  const glb = await io.writeBinary(out);
  writeFileSync(join(OUT, `${entry.id}.glb`), glb);
  console.log(`${entry.id}: front ${fwd}${scale !== 1 ? ` ×${scale.toFixed(3)}` : ''}; ${dims.L}×${dims.W}×${dims.H} m; tris near ${(tris.paint0 || 0) + (tris.kit0 || 0) + (tris.glass0 || 0)}+wheel ${tris.wheel0 || 0}, mid ${(tris.paint1 || 0) + (tris.kit1 || 0) + (tris.glass1 || 0)}, far ${tris.far}; atlas ${slots.size} maps ${(webp.length / 1024).toFixed(0)} KB; wheels ${wheelsAt.length}; lamps ${headAt.length}; glb ${(glb.length / 1024).toFixed(0)} KB`);
  return { ...meta, file: `${entry.id}.glb`, bytes: glb.length };
}

const only = process.argv.slice(2);
await MeshoptDecoder.ready; await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
mkdirSync(OUT, { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const indexFile = join(OUT, 'index.json');
const prev = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')).fleet : [];
const fleet = [];
for (const entry of FLEET) {
  if (only.length && !only.includes(entry.id)) { const p = prev.find((x) => x.id === entry.id); if (p) fleet.push(p); continue; }
  try { fleet.push(await build(entry, io)); } catch (e) { console.error(`${entry.id}: ${e.stack}`); }
}
writeFileSync(indexFile, JSON.stringify({ source: 'see public/models/CREDITS.md', fleet }, null, 1) + '\n');

/* ============================================================
   People build: Microsoft Rocketbox avatars (MIT, see
   public/models/people/LICENSE-Rocketbox.md) into small game
   files. For each character in cast.json: read the FBX and its
   2048² TGA textures, lower the arms from the A-pose to hang at
   the sides with the palms in and the fingers relaxed, fold the
   81-bone Biped skeleton onto the 20 joints gfx/person.ts
   animates, cut three levels of detail, pack body, head and
   extras into one 512-wide texture pair (colour + alpha; normal
   + roughness) and write a meshopt-compressed GLB, plus an
   index of the cast.
   Usage: node scripts/people/build.mjs <raw folder> [id ...]
   (<raw folder>/<src>/ holds <src>.fbx and its TGAs)
   ============================================================ */
/* global console, process, Buffer, fetch, setTimeout */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import sharp from 'sharp';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP } from '@gltf-transform/extensions';
import { quantize, reorder } from '@gltf-transform/functions';

// FBXLoader touches these only when it meets a camera or a texture
globalThis.window ??= { innerWidth: 1, innerHeight: 1 };
globalThis.document ??= { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, setAttribute() {}, style: {} }) };

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '../../public/models/people');
const CAST = JSON.parse(readFileSync(join(HERE, 'cast.json'), 'utf8'));
const V = THREE.Vector3;
const D2R = Math.PI / 180;

/* the joints gfx/person.ts animates (same names, order and parents) */
const ORDER = ['root', 'hips', 'spine', 'chest', 'neck', 'head', 'shL', 'uaL', 'faL', 'handL', 'shR', 'uaR', 'faR', 'handR', 'thL', 'shinL', 'footL', 'thR', 'shinR', 'footR'];
const PARENT = {
  root: null, hips: 'root', spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  shL: 'chest', uaL: 'shL', faL: 'uaL', handL: 'faL', shR: 'chest', uaR: 'shR', faR: 'uaR', handR: 'faR',
  thL: 'hips', shinL: 'thL', footL: 'shinL', thR: 'hips', shinR: 'thR', footR: 'shinR',
};
const GI = Object.fromEntries(ORDER.map((n, i) => [n, i]));
/* where each game joint sits: the Biped bone of that name */
const AT = {
  hips: 'Pelvis', spine: 'Spine', chest: 'Spine2', neck: 'Neck', head: 'Head',
  shL: 'L_Clavicle', uaL: 'L_UpperArm', faL: 'L_Forearm', handL: 'L_Hand', thL: 'L_Thigh', shinL: 'L_Calf', footL: 'L_Foot',
  shR: 'R_Clavicle', uaR: 'R_UpperArm', faR: 'R_Forearm', handR: 'R_Hand', thR: 'R_Thigh', shinR: 'R_Calf', footR: 'R_Foot',
};
const LIMB = { Clavicle: 'sh', UpperArm: 'ua', Forearm: 'fa', Hand: 'hand', Thigh: 'th', Calf: 'shin', Foot: 'foot' };
/** a Biped bone's game joint (Spine1 is shared between spine and chest; the face, fingers and toes ride on head, hand and foot) */
function gameOf(suffix) {
  if (suffix === '' || suffix === 'Pelvis') return 'hips';
  if (suffix === 'Spine') return 'spine';
  if (suffix === 'Spine1') return 'spine1';
  if (suffix === 'Spine2' || suffix === 'Spine3') return 'chest';
  if (suffix === 'Neck' || suffix === 'Neck1') return 'neck';
  if (suffix === 'Head') return 'head';
  const m = suffix.match(/^([LR])_(Clavicle|UpperArm|Forearm|Hand|Thigh|Calf|Foot)$/);
  if (m) return LIMB[m[2]] + m[1];
  const f = suffix.match(/^([LR])_(Finger|Toe)/);
  if (f) return (f[2] === 'Finger' ? 'hand' : 'foot') + f[1];
  return null;
}
const suffixOf = (name) => name.replace(/^Bip\d+_?/, '');

/* ---------- textures ---------- */
function readTGA(file) {
  const b = readFileSync(file);
  const idLen = b[0], cmapType = b[1], type = b[2];
  const cmapLen = b.readUInt16LE(5), cmapDepth = b[7];
  const w = b.readUInt16LE(12), h = b.readUInt16LE(14), px = b[16] >> 3, desc = b[17];
  if (cmapType) throw new Error(`${file}: colour-mapped TGA`);
  let o = 18 + idLen + cmapLen * (cmapDepth >> 3);
  const out = new Uint8Array(w * h * 4);
  const put = (i, s) => {
    if (px === 1) { out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = b[s]; out[i * 4 + 3] = 255; return; }
    out[i * 4] = b[s + 2]; out[i * 4 + 1] = b[s + 1]; out[i * 4 + 2] = b[s]; out[i * 4 + 3] = px === 4 ? b[s + 3] : 255;
  };
  if (type === 2 || type === 3) for (let i = 0; i < w * h; i++, o += px) put(i, o);
  else if (type === 10 || type === 11) {
    for (let i = 0; i < w * h;) {
      const c = b[o++], n = (c & 127) + 1;
      if (c & 128) { for (let k = 0; k < n; k++) put(i++, o); o += px; }
      else for (let k = 0; k < n; k++, o += px) put(i++, o);
    }
  } else throw new Error(`${file}: TGA type ${type}`);
  // stored bottom-up unless the descriptor says otherwise
  if (!(desc & 0x20)) {
    const row = w * 4, tmp = new Uint8Array(row);
    for (let y = 0; y < h >> 1; y++) {
      const a = y * row, z = (h - 1 - y) * row;
      tmp.set(out.subarray(a, a + row)); out.copyWithin(a, z, z + row); out.set(tmp, z);
    }
  }
  return { w, h, data: out };
}
const S2L = Float32Array.from({ length: 256 }, (_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const L2S = (v) => { v = Math.min(1, Math.max(0, v)); return Math.round((v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055) * 255); };
/** box-filter a square image down to `size`: colour averaged in linear light (weighted by alpha), normals renormalised */
function shrink(img, size, mode) {
  const f = img.w / size, out = new Uint8Array(size * size * 4), s = img.data;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, bl = 0, a = 0, wsum = 0;
    for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) {
      const k = ((y * f + j) * img.w + x * f + i) * 4;
      if (mode === 'color') { const w = s[k + 3] / 255 + 1e-4; r += S2L[s[k]] * w; g += S2L[s[k + 1]] * w; bl += S2L[s[k + 2]] * w; wsum += w; }
      else if (mode === 'normal') { r += s[k] / 127.5 - 1; g += s[k + 1] / 127.5 - 1; bl += s[k + 2] / 127.5 - 1; }
      else { r += s[k]; g += s[k + 1]; bl += s[k + 2]; }
      a += s[k + 3];
    }
    const n = f * f, o = (y * size + x) * 4;
    if (mode === 'color') { out[o] = L2S(r / wsum); out[o + 1] = L2S(g / wsum); out[o + 2] = L2S(bl / wsum); }
    else if (mode === 'normal') { const l = Math.hypot(r, g, bl) || 1; out[o] = Math.round((r / l + 1) * 127.5); out[o + 1] = Math.round((g / l + 1) * 127.5); out[o + 2] = Math.round((bl / l + 1) * 127.5); }
    else { out[o] = r / n; out[o + 1] = g / n; out[o + 2] = bl / n; }
    out[o + 3] = Math.round(a / n);
  }
  return { w: size, h: size, data: out };
}
/** roughness from a Rocketbox specular map: glossy where it's bright */
const roughOf = (spec) => Math.min(0.95, Math.max(0.32, 0.93 - spec * 0.8));

/* ---------- skeleton re-posing ---------- */
const wpos = (b) => b.getWorldPosition(new V());
/** turn a bone about its joint by a world-space rotation */
function rotateWorld(bone, q) {
  const pw = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  const bw = bone.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(pw.invert().multiply(q.clone().multiply(bw)));
  bone.updateMatrixWorld(true);
}
/** point bone → child along a world direction */
function aim(bone, child, dir) {
  const d = wpos(child).sub(wpos(bone)).normalize();
  rotateWorld(bone, new THREE.Quaternion().setFromUnitVectors(d, dir.clone().normalize()));
}
function repose(B, log) {
  for (const [s, sx] of [['L', 1], ['R', -1]]) {
    const ua = B[`${s}_UpperArm`], fa = B[`${s}_Forearm`], hd = B[`${s}_Hand`];
    // the upper arm hangs 7° out from the side, the forearm a little forward of it
    aim(ua, fa, new V(sx * Math.sin(7 * D2R), -Math.cos(7 * D2R), 0));
    aim(fa, hd, new V(sx * 0.07, -0.97, 0.2));
    // palm in towards the thigh: turn the whole arm about the upper arm
    const palm = () => {
      const H = wpos(hd), I = wpos(B[`${s}_Finger1`]).sub(H), P = wpos(B[`${s}_Finger4`] ?? B[`${s}_Finger3`]).sub(H);
      return new V().crossVectors(I, P).normalize().multiplyScalar(-sx);
    };
    const axis = wpos(fa).sub(wpos(ua)).normalize();
    const flat = (v) => v.clone().addScaledVector(axis, -v.dot(axis)).normalize();
    const n = flat(palm()), t = flat(new V(-sx, 0, -0.2));
    let ang = Math.atan2(new V().crossVectors(n, t).dot(axis), n.dot(t));
    ang = Math.max(-80 * D2R, Math.min(80 * D2R, ang));
    rotateWorld(ua, new THREE.Quaternion().setFromAxisAngle(axis, ang));
    log.push(`${s} arm twist ${(ang / D2R).toFixed(0)}°`);
    // fingers relaxed: each joint curls a little more towards the palm, the little finger most
    const p = palm();
    const curls = { 0: [4, 10, 10], 1: [12, 24, 16], 2: [15, 27, 18], 3: [18, 29, 20], 4: [21, 31, 22] };
    for (const [k, angs] of Object.entries(curls)) {
      const chain = [`${s}_Finger${k}`, `${s}_Finger${k}1`, `${s}_Finger${k}2`].map((n2) => B[n2]);
      if (!chain[0]) continue;
      let prev = null;
      for (let i = 0; i < 3 && chain[i]; i++) {
        const d = chain[i + 1] ? wpos(chain[i + 1]).sub(wpos(chain[i])).normalize() : prev;
        if (!d) break;
        const ax = new V().crossVectors(d, p).normalize();
        if (ax.lengthSq() > 0.5) rotateWorld(chain[i], new THREE.Quaternion().setFromAxisAngle(ax, angs[i] * D2R));
        prev = d;
      }
    }
  }
}

/* ---------- one character ---------- */
async function build(entry, rawDir, io) {
  const dir = join(rawDir, entry.src);
  const fbx = readFileSync(join(dir, `${entry.src}.fbx`));
  const warn = console.warn;
  console.warn = () => {};
  const root = new FBXLoader().parse(fbx.buffer.slice(fbx.byteOffset, fbx.byteOffset + fbx.byteLength), '');
  console.warn = warn;
  root.updateMatrixWorld(true);
  let mesh = null;
  root.traverse((o) => { if (o.isSkinnedMesh && !mesh) mesh = o; });
  const bones = mesh.skeleton.bones;
  const B = Object.fromEntries(bones.map((b) => [suffixOf(b.name), b]));
  const g = mesh.geometry, mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const n = g.attributes.position.count;
  const P = g.attributes.position, N = g.attributes.normal, UV = g.attributes.uv, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;

  // as loaded, in world space
  const rest = new Float32Array(n * 3), restN = new Float32Array(n * 3);
  const skinM = bones.map((b, j) => new THREE.Matrix4().multiplyMatrices(b.matrixWorld, mesh.skeleton.boneInverses[j]));
  const v = new V(), m = new THREE.Matrix4(), acc = new THREE.Matrix4(), nm = new THREE.Matrix3();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(P, i);
    mesh.applyBoneTransform(i, v).applyMatrix4(mesh.matrixWorld);
    rest.set([v.x, v.y, v.z], i * 3);
    acc.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    for (let k = 0; k < 4; k++) {
      const w = SW.getComponent(i, k);
      if (w) { const e = skinM[SI.getComponent(i, k)].elements; for (let q = 0; q < 16; q++) acc.elements[q] += e[q] * w; }
    }
    m.multiplyMatrices(mesh.matrixWorld, mesh.bindMatrixInverse).multiply(acc).multiply(mesh.bindMatrix);
    v.fromBufferAttribute(N, i).applyMatrix3(nm.getNormalMatrix(m)).normalize();
    restN.set([v.x, v.y, v.z], i * 3);
  }
  // arms down, palms in, fingers relaxed; then every vertex follows its bones there
  const before = bones.map((b) => b.matrixWorld.clone());
  const log = [];
  repose(B, log);
  root.updateMatrixWorld(true);
  const delta = bones.map((b, j) => new THREE.Matrix4().multiplyMatrices(b.matrixWorld, before[j].clone().invert()));

  // Biped bone → game joint
  const toGame = bones.map((b) => {
    for (let o = b; o && o.isBone; o = o.parent) { const k = gameOf(suffixOf(o.name)); if (k) return k; }
    return 'hips';
  });
  const J = { root: new V(0, 0, 0) };
  for (const [k, sfx] of Object.entries(AT)) J[k] = wpos(B[sfx]).multiplyScalar(0.01);

  // the parts: which atlas square each material's triangles go to
  const parts = mats.map((mt) => {
    // (no weapons in the village: a holster stays, what was in it goes)
    const kind = /pistol|gun|rifle|weapon|knife|baton|taser/i.test(mt.name) ? 'drop' : /_body$/i.test(mt.name) ? 'body' : /_head$/i.test(mt.name) ? 'head' : /opacity/i.test(mt.name) ? 'hair' : 'extra';
    return { name: mt.name, kind };
  });
  // (V2: the head has a 512² square of its own beside the body's. Squeezed into 256² with the hair and the extras, a
  // 2048² face kept a sixty-fourth of its detail and every villager's face was a blur)
  const headPart = parts.find((p) => p.kind === 'head');
  const smalls = parts.filter((p) => p !== headPart && (p.kind === 'head' || p.kind === 'hair' || p.kind === 'extra'));
  const AW = 1024, AH = 512 + 256 * Math.ceil(smalls.length / 4);
  parts.forEach((p) => {
    if (p.kind === 'body') p.rect = [0, 0, 512, 512];
    if (p === headPart) p.rect = [512, 0, 512, 512];
    const i = smalls.indexOf(p);
    if (i >= 0) p.rect = [(i % 4) * 256, 512 + Math.floor(i / 4) * 256, 256, 256];
  });

  // posed vertices with their game weights; the body's triangles also remember what they clothe (1 top, 2 legs,
  // 3 shoes, 0 bare or not clothing), for the recolour mask
  const pos = [], nor = [], uv = [], ji = [], jw = [], hairFlag = [], region = [];
  const LEGS = new Set(['thL', 'thR', 'shinL', 'shinR']), FEET = new Set(['footL', 'footR']), TOP = new Set(['spine', 'chest', 'shL', 'shR', 'uaL', 'uaR', 'faL', 'faR']);
  const regionOf = (ws, y, part) => {
    if (part.kind !== 'body') return 0;
    const d = Object.entries(ws).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (LEGS.has(d)) return 2;
    if (FEET.has(d)) return 3;
    if (d === 'hips') return y < J.hips.y + 0.03 ? 2 : 1;
    return TOP.has(d) ? 1 : 0;
  };
  const tri = (i, part, flip) => {
    v.set(0, 0, 0);
    const out = new V(), on = new V(), tmp = new V(), tn = new V();
    const ws = {};
    for (let k = 0; k < 4; k++) {
      const w = SW.getComponent(i, k);
      if (!w) continue;
      const j = SI.getComponent(i, k);
      tmp.fromArray(rest, i * 3).applyMatrix4(delta[j]);
      out.addScaledVector(tmp, w);
      tn.fromArray(restN, i * 3).transformDirection(delta[j]);
      on.addScaledVector(tn, w);
      const gk = toGame[j];
      if (gk === 'spine1') { ws.spine = (ws.spine || 0) + w / 2; ws.chest = (ws.chest || 0) + w / 2; }
      else ws[gk] = (ws[gk] || 0) + w;
    }
    out.multiplyScalar(0.01);
    on.normalize();
    if (flip) on.negate();
    const top = Object.entries(ws).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const tot = top.reduce((s, x) => s + x[1], 0) || 1;
    while (top.length < 4) top.push(['root', 0]);
    pos.push(out.x, out.y, out.z);
    nor.push(on.x, on.y, on.z);
    const [rx, ry, rw, rh] = part.rect;
    const u = Math.min(1, Math.max(0, UV.getX(i))), vv = Math.min(1, Math.max(0, UV.getY(i)));
    uv.push((rx + u * rw) / AW, (ry + (1 - vv) * rh) / AH);
    for (const [k, w] of top) { ji.push(GI[k]); jw.push(w / tot); }
    hairFlag.push(part.kind === 'hair' ? 1 : 0);
    region.push(regionOf(ws, out.y, part));
  };
  for (const gr of g.groups) {
    const part = parts[gr.materialIndex];
    if (part.kind === 'drop') continue;
    for (let t = gr.start; t < gr.start + gr.count; t += 3) {
      tri(t, part, false); tri(t + 1, part, false); tri(t + 2, part, false);
      // hair cards are seen from both sides
      if (part.kind === 'hair') { tri(t, part, true); tri(t + 2, part, true); tri(t + 1, part, true); }
    }
  }
  let geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('ji', new THREE.Float32BufferAttribute(ji, 4));
  geo.setAttribute('jw', new THREE.Float32BufferAttribute(jw, 4));
  geo.setAttribute('hair', new THREE.Float32BufferAttribute(hairFlag, 1));
  geo = mergeVertices(geo, 1e-5);
  const full = geo.index.count / 3;

  // levels of detail
  const fp = geo.attributes.position.array, fa = new Float32Array(geo.attributes.position.count * 5);
  for (let i = 0; i < geo.attributes.position.count; i++) {
    fa.set([geo.attributes.normal.getX(i), geo.attributes.normal.getY(i), geo.attributes.normal.getZ(i), geo.attributes.uv.getX(i), geo.attributes.uv.getY(i)], i * 5);
  }
  const lockHair = Uint8Array.from(geo.attributes.hair.array, (h) => (h > 0.5 ? 1 : 0));
  const idx = new Uint32Array(geo.index.array);
  const lods = [];
  // (V2: the nearest is drawn within 20 m only: up to 8 000 triangles, moved no more than 1 % of the figure's size. It
  // was 5 000 and 8 %, some 14 cm, which flattened noses, lips and brows and made the faces unrecognisable)
  for (const [target, lock, err] of [[8000, true, 0.01], [2500, true, 0.035], [800, false, 0.08]]) {
    let out = idx;
    if (idx.length / 3 > target) [out] = MeshoptSimplifier.simplifyWithAttributes(idx, fp, 3, fa, 5, [0.5, 0.5, 0.5, 2, 2], lock ? lockHair : null, target * 3, err, lock ? [] : ['Prune']);
    lods.push(compact(geo, out));
  }

  // textures
  const tex = (part, ch) => {
    const f = join(dir, `${part.name}_${ch}.tga`);
    return existsSync(f) ? readTGA(f) : null;
  };
  const color = new Uint8Array(AW * AH * 4), normal = new Uint8Array(AW * AH * 4);
  for (const part of parts) {
    if (!part.rect) continue;
    const [rx, ry, rw] = part.rect;
    const c = tex(part, 'color'), nn = tex(part, 'normal'), sp = tex(part, 'specular');
    const cs = c ? shrink(c, rw, 'color') : null, ns = nn ? shrink(nn, rw, 'normal') : null, ss = sp ? shrink(sp, rw, 'linear') : null;
    for (let y = 0; y < rw; y++) for (let x = 0; x < rw; x++) {
      const s = (y * rw + x) * 4, d = ((ry + y) * AW + rx + x) * 4;
      if (cs) { color[d] = cs.data[s]; color[d + 1] = cs.data[s + 1]; color[d + 2] = cs.data[s + 2]; }
      color[d + 3] = part.kind === 'hair' && cs ? cs.data[s + 3] : 255;
      if (ns) { normal[d] = ns.data[s]; normal[d + 1] = ns.data[s + 1]; normal[d + 2] = ns.data[s + 2]; }
      else { normal[d] = 128; normal[d + 1] = 128; normal[d + 2] = 255; }
      const spec = ss ? (ss.data[s] + ss.data[s + 1] + ss.data[s + 2]) / 765 : part.kind === 'hair' ? 0.45 : 0.15;
      normal[d + 3] = Math.round(roughOf(spec) * 255);
    }
  }
  // the recolour mask (half size; R top, G legs, B shoes): each clothed triangle painted in, bare skin left out by
  // comparing with the face's colour, and each region's mean colour, which a tint is measured against
  const MW = AW / 2, MH = AH / 2, mask = new Uint8Array(MW * MH * 4);
  const at =(u, w) => ((Math.min(AH - 1, Math.floor(w * AH)) * AW + Math.min(AW - 1, Math.floor(u * AW))) * 4);
  const face = [0, 0, 0];
  let skinN = 0;
  for (let i = 0; i < pos.length / 3; i++) {
    // the face: head-weighted, facing forward, between the chin and the brow
    if (ji[i * 4] !== GI.head || jw[i * 4] < 0.9 || nor[i * 3 + 2] < 0.7 || hairFlag[i]) continue;
    const y = pos[i * 3 + 1];
    if (y < J.head.y - 0.02 || y > J.head.y + 0.09) continue;
    const k = at(uv[i * 2], uv[i * 2 + 1]);
    face[0] += S2L[color[k]]; face[1] += S2L[color[k + 1]]; face[2] += S2L[color[k + 2]]; skinN++;
  }
  const sk = face.map((c) => c / Math.max(1, skinN)), skS = sk[0] + sk[1] + sk[2] || 1;
  const isSkin = (k) => {
    const r = S2L[color[k]], gg = S2L[color[k + 1]], b = S2L[color[k + 2]], s = r + gg + b || 1e-6;
    return Math.hypot(r / s - sk[0] / skS, gg / s - sk[1] / skS) < 0.035 && s / skS > 0.4 && s / skS < 1.9;
  };
  for (let t = 0; t < region.length; t += 3) {
    const rg = region[t] || region[t + 1] || region[t + 2];
    const r = [region[t], region[t + 1], region[t + 2]].filter((x) => x).sort((a, b) => a - b)[0] ?? 0;
    if (!rg || hairFlag[t]) continue;
    const P2 = [0, 1, 2].map((q) => [uv[(t + q) * 2] * MW, uv[(t + q) * 2 + 1] * MH]);
    const x0 = Math.max(0, Math.floor(Math.min(...P2.map((p) => p[0])))), x1 = Math.min(MW - 1, Math.ceil(Math.max(...P2.map((p) => p[0]))));
    const y0 = Math.max(0, Math.floor(Math.min(...P2.map((p) => p[1])))), y1 = Math.min(MH - 1, Math.ceil(Math.max(...P2.map((p) => p[1]))));
    const [[ax, ay], [bx, by], [cx, cy]] = P2, den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(den) < 1e-9) continue;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den, l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den;
      if (l1 < -0.02 || l2 < -0.02 || l1 + l2 > 1.02) continue;
      if (isSkin(at(px / MW, py / MH))) continue;
      mask[(y * MW + x) * 4 + (r - 1)] = 255;
    }
  }
  // clothes are whole patches, skin misread as cloth only specks: keep a pixel where most of its 5×5 neighbourhood
  // agrees
  const clean = new Uint8Array(mask.length);
  for (let ch = 0; ch < 3; ch++)
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      let n = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < MW && yy < MH && mask[(yy * MW + xx) * 4 + ch]) n++;
      }
      if (n >= 13) clean[(y * MW + x) * 4 + ch] = 255;
    }
  mask.set(clean);
  const means = {};
  for (const [name, ch] of [['top', 0], ['legs', 1], ['shoes', 2]]) {
    const m = [0, 0, 0];
    let cnt = 0;
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      if (!mask[(y * MW + x) * 4 + ch]) continue;
      const k = at((x + 0.5) / MW, (y + 0.5) / MH);
      m[0] += S2L[color[k]]; m[1] += S2L[color[k + 1]]; m[2] += S2L[color[k + 2]]; cnt++;
    }
    if (cnt > 40) means[name] = m.map((c) => +(c / cnt).toFixed(4));
  }
  for (let i = 3; i < mask.length; i += 4) mask[i] = 255;
  // the normal map at half size (folds read as well; it's the biggest file)
  const nHalf = new Uint8Array(MW * MH * 4);
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    let nx = 0, ny = 0, nz = 0, a = 0;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const k = ((y * 2 + dy) * AW + x * 2 + dx) * 4;
      nx += normal[k] / 127.5 - 1; ny += normal[k + 1] / 127.5 - 1; nz += normal[k + 2] / 127.5 - 1; a += normal[k + 3];
    }
    const l = Math.hypot(nx, ny, nz) || 1, d = (y * MW + x) * 4;
    nHalf[d] = Math.round((nx / l + 1) * 127.5); nHalf[d + 1] = Math.round((ny / l + 1) * 127.5); nHalf[d + 2] = Math.round((nz / l + 1) * 127.5); nHalf[d + 3] = Math.round(a / 4);
  }
  const colorWebp = await sharp(Buffer.from(color), { raw: { width: AW, height: AH, channels: 4 } }).sharpen({ sigma: 0.6 }).webp({ quality: 84, alphaQuality: 90, effort: 6 }).toBuffer();
  const normalWebp = await sharp(Buffer.from(nHalf), { raw: { width: MW, height: MH, channels: 4 } }).webp({ quality: 88, alphaQuality: 80, effort: 6 }).toBuffer();
  const maskWebp = await sharp(Buffer.from(mask), { raw: { width: MW, height: MH, channels: 4 } }).removeAlpha().webp({ lossless: true, effort: 6 }).toBuffer();

  // the GLB
  const doc = new Document();
  const buf = doc.createBuffer();
  doc.createExtension(EXTTextureWebP).setRequired(true);
  const scene = doc.createScene(entry.id);
  const nodes = ORDER.map((k) => doc.createNode(k));
  ORDER.forEach((k, i) => {
    const p = PARENT[k];
    const t = p ? J[k].clone().sub(J[p]) : J[k];
    nodes[i].setTranslation([t.x, t.y, t.z]);
    if (p) nodes[GI[p]].addChild(nodes[i]);
  });
  scene.addChild(nodes[0]);
  const ibm = new Float32Array(16 * ORDER.length);
  ORDER.forEach((k, i) => ibm.set(new THREE.Matrix4().makeTranslation(-J[k].x, -J[k].y, -J[k].z).elements, i * 16));
  const skin = doc.createSkin('body').setSkeleton(nodes[0]).setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(buf));
  nodes.forEach((nd) => skin.addJoint(nd));
  const tC = doc.createTexture('color').setImage(new Uint8Array(colorWebp)).setMimeType('image/webp');
  const tN = doc.createTexture('normal').setImage(new Uint8Array(normalWebp)).setMimeType('image/webp');
  // (the recolour mask travels in the occlusion slot; the game reads it as the mask, never as shading)
  const tM = doc.createTexture('outfit').setImage(new Uint8Array(maskWebp)).setMimeType('image/webp');
  const mat = doc.createMaterial('body').setBaseColorTexture(tC).setNormalTexture(tN).setOcclusionTexture(tM).setMetallicFactor(0).setRoughnessFactor(1).setAlphaMode('MASK').setAlphaCutoff(0.5);
  const tris = [];
  lods.forEach((L, k) => {
    const a = (arr, type) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buf);
    const prim = doc.createPrimitive().setMaterial(mat)
      .setIndices(a(L.count > 65535 ? L.index : Uint16Array.from(L.index), 'SCALAR'))
      .setAttribute('POSITION', a(L.position, 'VEC3'))
      .setAttribute('NORMAL', a(L.normal, 'VEC3'))
      .setAttribute('TEXCOORD_0', a(L.uv, 'VEC2'))
      .setAttribute('JOINTS_0', a(L.joints, 'VEC4'))
      .setAttribute('WEIGHTS_0', a(L.weights, 'VEC4'));
    const node = doc.createNode(`lod${k}`).setMesh(doc.createMesh(`lod${k}`).addPrimitive(prim)).setSkin(skin);
    scene.addChild(node);
    tris.push(L.index.length / 3);
  });
  let top = 0;
  for (let i = 1; i < pos.length; i += 3) top = Math.max(top, pos[i]);
  const meta = { id: entry.id, female: entry.female, child: entry.child, job: entry.job, height: +top.toFixed(3), hipsY: +J.hips.y.toFixed(3), tris, means };
  scene.setExtras(meta);
  await doc.transform(reorder({ encoder: MeshoptEncoder, target: 'size' }), quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeWeight: 8 }));
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  const glb = await io.writeBinary(doc);
  writeFileSync(join(OUT, `${entry.id}.glb`), glb);
  console.log(`${entry.id}: ${full} tris → lods ${tris.join(' / ')}; atlas ${AW}×${AH}; colour ${(colorWebp.length / 1024).toFixed(0)} KB, normal ${(normalWebp.length / 1024).toFixed(0)} KB; glb ${(glb.length / 1024).toFixed(0)} KB; ${log.join(', ')}`);
  return { ...meta, file: `${entry.id}.glb`, bytes: glb.length };
}

/** the used vertices of a welded mesh under a new index list, in the attribute layout the GLB wants */
function compact(geo, index) {
  const remap = new Int32Array(geo.attributes.position.count).fill(-1);
  let n = 0;
  const out = new Uint32Array(index.length);
  for (let i = 0; i < index.length; i++) { let r = remap[index[i]]; if (r < 0) r = remap[index[i]] = n++; out[i] = r; }
  const position = new Float32Array(n * 3), normal = new Float32Array(n * 3), uv = new Float32Array(n * 2), joints = new Uint8Array(n * 4), weights = new Float32Array(n * 4);
  const A = geo.attributes;
  for (let s = 0; s < remap.length; s++) {
    const d = remap[s];
    if (d < 0) continue;
    for (let k = 0; k < 3; k++) { position[d * 3 + k] = A.position.getComponent(s, k); normal[d * 3 + k] = A.normal.getComponent(s, k); }
    uv[d * 2] = A.uv.getX(s); uv[d * 2 + 1] = A.uv.getY(s);
    for (let k = 0; k < 4; k++) { joints[d * 4 + k] = Math.round(A.ji.getComponent(s, k)); weights[d * 4 + k] = A.jw.getComponent(s, k); }
  }
  return { index: out, count: n, position, normal, uv, joints, weights };
}

/* ---------- fetching a character from the Rocketbox repository (listing through the GitHub CLI) ---------- */
const REPO = 'microsoft/Microsoft-Rocketbox', RAW = `https://raw.githubusercontent.com/${REPO}/master/Assets/Avatars`;
const groupOf = (src) => (/_Adult_/.test(src) ? 'Adults' : /_Child_/.test(src) ? 'Children' : 'Professions');
async function fetchRaw(entry, rawDir) {
  const dir = join(rawDir, entry.src);
  if (existsSync(join(dir, `${entry.src}.fbx`))) return;
  mkdirSync(dir, { recursive: true });
  const path = `${groupOf(entry.src)}/${entry.src}`;
  const names = execFileSync('gh', ['api', `repos/${REPO}/contents/Assets/Avatars/${path}/Textures`, '--jq', '.[].name'], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  // colour, normal and specular maps, not the weapons' or the facial wrinkle maps
  const want = names.filter((n) => /_(color|normal|specular)\.tga$/i.test(n) && !/wrinkle|pistol|gun|rifle|weapon|knife|baton|taser/i.test(n));
  for (const f of [`Export/${entry.src}.fbx`, ...want.map((n) => `Textures/${n}`)]) {
    let ok = false;
    for (let t = 0; t < 4 && !ok; t++) {
      const r = await fetch(`${RAW}/${path}/${f}`);
      if (r.ok) { writeFileSync(join(dir, f.split('/').pop()), Buffer.from(await r.arrayBuffer())); ok = true; }
      else await new Promise((res) => setTimeout(res, 2000));
    }
    if (!ok) throw new Error(`could not fetch ${path}/${f}`);
  }
  // (V2: every texture whole before anything is built: a truncated or missing file made a character with blank skin
  // and clothes, written over the good one)
  for (const n of want) {
    const p = join(dir, n);
    if (!existsSync(p) || statSync(p).size < 100 * 1024) throw new Error(`incomplete download: ${n}`);
  }
}

const args = process.argv.slice(2), flags = new Set(args.filter((a) => a.startsWith('--')));
const [rawDir, ...only] = args.filter((a) => !a.startsWith('--'));
if (!rawDir) { console.error('usage: node scripts/people/build.mjs <raw folder> [id ...] [--fetch] [--clean]'); process.exit(1); }
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
mkdirSync(OUT, { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const indexFile = join(OUT, 'index.json');
const prev = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')).cast : [];
const cast = [];
const save = () => writeFileSync(indexFile, JSON.stringify({ source: 'Microsoft Rocketbox (MIT), see LICENSE-Rocketbox.md', cast: [...cast, ...prev.filter((p) => !cast.some((c) => c.id === p.id) && CAST.some((e) => e.id === p.id))] }, null, 1) + '\n');
for (const entry of CAST) {
  if (only.length && !only.includes(entry.id)) { const p = prev.find((x) => x.id === entry.id); if (p) cast.push(p); continue; }
  try {
    // --fetch: download what's missing; --clean: delete the raw files once built (they are large)
    if (flags.has('--fetch')) await fetchRaw(entry, rawDir);
    cast.push(await build(entry, rawDir, io));
    if (flags.has('--clean')) rmSync(join(rawDir, entry.src), { recursive: true, force: true });
  } catch (e) {
    console.error(`${entry.id}: ${e.message}`);
  }
  save();
}
save();

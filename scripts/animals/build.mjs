/* ============================================================
   Animal build: the downloaded animals (assets-src/animals,
   credited in public/models/CREDITS.md) into small game files
   skinned to the game's own skeletons, so its gait code drives
   them all (most came with one clip or none, each rig its own).
   For each animal in zoo.json: pose every vertex at rest through
   its skin, find which way is up (body over feet) and forward
   (head over tail), turn it to face +z standing on y = 0 at its
   real size, and fold its bones onto the four-legged set
   (pelvis, spine, chest, neck, head, three tail joints, each leg
   upper/lower/paw) or the bird set (body, neck, head, each wing
   in two, tail, legs). Bones are read from their names split
   into words (so "LeftForeArm" is left/fore/arm, never "ear"):
   each leg is a chain of leg bones, cut by order down the chain;
   the spine is the line from the root to the head, cut where
   the hind and front legs hang from it; anything else rides on
   its nearest mapped parent; zoo.json can name a bone outright.
   Textures go into one atlas; three levels of detail.
   Usage: node scripts/animals/build.mjs [id ...]   (VERBOSE=1 lists each bone's place)
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
const SRC = join(HERE, '../../assets-src/animals');
const OUT = join(HERE, '../../public/models/animals');
const ZOO = JSON.parse(readFileSync(join(HERE, 'zoo.json'), 'utf8'));
const ATLAS = 512;

const QUAD = ['root', 'pelvis', 'spine', 'chest', 'neck', 'head', 'tail0', 'tail1', 'tail2', 'fuL', 'flL', 'fpL', 'fuR', 'flR', 'fpR', 'huL', 'hlL', 'hpL', 'huR', 'hlR', 'hpR'];
const QUAD_PARENT = { root: null, pelvis: 'root', spine: 'pelvis', chest: 'spine', neck: 'chest', head: 'neck', tail0: 'pelvis', tail1: 'tail0', tail2: 'tail1', fuL: 'chest', flL: 'fuL', fpL: 'flL', fuR: 'chest', flR: 'fuR', fpR: 'flR', huL: 'pelvis', hlL: 'huL', hpL: 'hlL', huR: 'pelvis', hlR: 'huR', hpR: 'hlR' };
const BIRD = ['root', 'body', 'neck', 'head', 'wingL', 'tipL', 'wingR', 'tipR', 'tail', 'legL', 'legR'];
const BIRD_PARENT = { root: null, body: 'root', neck: 'body', head: 'neck', wingL: 'body', tipL: 'wingL', wingR: 'body', tipR: 'wingR', tail: 'body', legL: 'body', legR: 'body' };

/** a bone name as lower-case words: "Bip01 L UpperArm_013" â†’ bip, 01, l, upper, arm, 013 */
const words = (s) => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/([a-zA-Z])(\d)/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const has = (w, list) => w.some((x) => list.includes(x));
const SKIP = ['pole', 'ik', 'fk', 'target', 'neutral', 'footstep', 'reins', 'ff', 'ffb', 'ctrl', 'control', 'cling', 'dummy'];
const HEAD = ['head', 'jaw', 'ear', 'ears', 'eye', 'eyes', 'lid', 'brow', 'tongue', 'nose', 'lip', 'chin', 'mouth', 'mandible', 'beak', 'nostril', 'face', 'teeth', 'tooth', 'cheek', 'forehead', 'horn', 'antena', 'antenna', 'proboscis', 'ponytail', 'pony', 'mane', 'trunk', 'tusk', 'gobbler', 'skull'];
const GIRDLE = ['shoulder', 'clavicle', 'collarbone', 'collar', 'scapula'];
const LEG = ['leg', 'legs', 'thigh', 'calf', 'shin', 'femur', 'tibia', 'humerus', 'radius', 'raduis', 'ulna', 'metatarsus', 'metacarpus', 'foot', 'feet', 'toe', 'toes', 'hoof', 'ankle', 'knee', 'hand', 'finger', 'digit', 'palm', 'ball', 'wrist', 'elbow', 'arm', 'forearm', 'upperarm', 'upleg', 'horselink', 'link', 'cannon', 'pastern', 'fetlock', 'hock', 'stifle', 'carpus', 'tarsus', 'paw', 'nail', 'nalils', 'claw', 'hip', ...GIRDLE];
const WING = ['wing', 'wings', 'pectoral', 'flipper', 'membrane', 'feather', 'primary', 'secondary'];

/** a bone's role from its words (null: rides on its parent) */
function roleOf(name, body) {
  const w = words(name);
  if (has(w, SKIP)) return null;
  if (w.includes('blade')) return 'spine'; // a shoulder blade rides the chest
  if (w.includes('tail') && !w.includes('pony')) return 'tail';
  if (has(w, HEAD)) return 'head';
  if (w.includes('neck')) return 'neck';
  if (body === 'bird') {
    if (has(w, WING)) return 'wing';
    if (has(w, LEG)) return 'leg';
    if (w.includes('abdomen')) return 'tail';
    return 'body';
  }
  if (has(w, LEG)) return 'leg';
  return 'spine';
}

async function build(entry, io) {
  const doc = await io.read(join(SRC, entry.src));
  const root = doc.getRoot(), scene = root.getDefaultScene() || root.listScenes()[0];
  // (a rig whose resting pose is a muddle stands as the first frame of one of its own clips)
  if (entry.pose) {
    const clip = root.listAnimations().find((a) => a.getName() === entry.pose);
    if (!clip) throw new Error(`no clip ${entry.pose}`);
    for (const ch of clip.listChannels()) {
      const s = ch.getSampler(), el = [];
      s.getOutput().getElement(s.getInterpolation() === 'CUBICSPLINE' ? 1 : 0, el);
      const nd = ch.getTargetNode(), path = ch.getTargetPath();
      if (path === 'translation') nd.setTranslation(el); else if (path === 'rotation') nd.setRotation(el); else if (path === 'scale') nd.setScale(el);
    }
  }
  // the main skin: the one with the most joints (a cat's eyes have their own little rig)
  const skins = root.listSkins().sort((a, b) => b.listJoints().length - a.listJoints().length);
  const skin = skins[0], joints = skin.listJoints();
  const restOf = (sk) => sk.listJoints().map((j, k) => { const e = []; sk.getInverseBindMatrices().getElement(k, e); return new THREE.Matrix4().fromArray(j.getWorldMatrix()).multiply(new THREE.Matrix4().fromArray(e)); });
  const rest = new Map(skins.map((sk) => [sk, restOf(sk)]));
  const jp = joints.map((j) => new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(j.getWorldMatrix())));
  // (zoo.json names bones without the exporter's _NN suffix)
  const override = Object.fromEntries(joints.map((j) => [j.getName(), entry.map?.[j.getName()] ?? entry.map?.[j.getName().replace(/_\d+$/, '')]]).filter((x) => x[1]));
  const role = joints.map((j) => roleOf(j.getName(), entry.body));

  /* every triangle at rest in world space, with its own bones' weights (other skins and loose meshes: none) */
  const tris = { pos: [], nor: [], uv: [], col: [], bw: [], tex: [] };
  const texSlots = new Map();
  const v = new THREE.Vector3(), n = new THREE.Vector3(), M = new THREE.Matrix4(), NM = new THREE.Matrix3(), A = new THREE.Matrix4(), S = new THREE.Matrix4();
  const e = [], ej = [], ew = [], eu = [];
  scene.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const sk = node.getSkin(), R = sk ? rest.get(sk) : null, own = sk === skin;
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue;
      const mat = prim.getMaterial();
      if (entry.dropMat && new RegExp(entry.dropMat, 'i').test(mat?.getName() || '')) continue;
      const P = prim.getAttribute('POSITION'), N = prim.getAttribute('NORMAL'), I = prim.getIndices(), UV = prim.getAttribute('TEXCOORD_0');
      const JO = prim.getAttribute('JOINTS_0'), WE = prim.getAttribute('WEIGHTS_0');
      // the coat: the base colour, or the diffuse of an older specular-glossiness material, or (a model lit by its
      // emissive map over a black base) that
      const sg = mat?.getExtension('KHR_materials_pbrSpecularGlossiness');
      let fac = mat ? (sg ? sg.getDiffuseFactor() : mat.getBaseColorFactor()) : [0.7, 0.7, 0.7, 1];
      let tex = mat?.getBaseColorTexture() || sg?.getDiffuseTexture() || null;
      if (mat && fac[0] + fac[1] + fac[2] < 0.05) { tex ||= mat.getEmissiveTexture(); if (tex) fac = [1, 1, 1, 1]; }
      if (tex && !texSlots.has(tex)) texSlots.set(tex, { tex, alpha: mat.getAlphaMode() !== 'OPAQUE' });
      M.fromArray(node.getWorldMatrix());
      const count = I ? I.getCount() : P.getCount();
      for (let t = 0; t < count; t++) {
        const i = I ? I.getScalar(t) : t;
        P.getElement(i, e); v.fromArray(e);
        if (N) { N.getElement(i, e); n.fromArray(e); } else n.set(0, 1, 0);
        let w = [];
        A.copy(M);
        if (R && JO && WE) {
          JO.getElement(i, ej); WE.getElement(i, ew);
          S.elements.fill(0);
          let s = 0;
          for (let k = 0; k < 4; k++) if (ew[k] > 0) { s += ew[k]; if (own) w.push([ej[k], ew[k]]); for (let q = 0; q < 16; q++) S.elements[q] += R[ej[k]].elements[q] * ew[k]; }
          if (s > 1e-4) { for (let q = 0; q < 16; q++) S.elements[q] /= s; A.copy(S); } else w = [];
        }
        v.applyMatrix4(A); n.applyMatrix3(NM.getNormalMatrix(A)).normalize();
        tris.pos.push(v.x, v.y, v.z); tris.nor.push(n.x, n.y, n.z);
        if (UV) { UV.getElement(i, eu); tris.uv.push(eu[0], eu[1]); } else tris.uv.push(-1, -1);
        tris.col.push(fac[0], fac[1], fac[2]);
        tris.bw.push(w);
        tris.tex.push(tex);
      }
    }
  });
  const count = tris.pos.length / 3;
  if (!count) throw new Error('no triangles');

  /* up (from the feet to the body) and forward (from the tail to the head), then turn, ground and scale */
  const idx = new Map(joints.map((j, k) => [j, k]));
  const parentK = joints.map((j) => { for (let p = j.getParentNode(); p; p = p.getParentNode()) { const q = idx.get(p); if (q !== undefined) return q; } return -1; });
  const kids = joints.map(() => []);
  parentK.forEach((p, k) => { if (p >= 0) kids[p].push(k); });
  const depth = joints.map((_, k) => { let d = 0; for (let p = parentK[k]; p >= 0; p = parentK[p]) d++; return d; });
  const all = joints.map((_, k) => k);
  const byDepth = (ks) => ks.slice().sort((a, b) => depth[a] - depth[b]);
  const ends = all.filter((k) => role[k] === 'leg' && !kids[k].some((c) => role[c] === 'leg'));
  const bodyKs = all.filter((k) => role[k] === 'spine' || role[k] === 'body');
  const mean = (ks) => ks.reduce((a, k) => a.add(jp[k]), new THREE.Vector3()).multiplyScalar(1 / Math.max(1, ks.length));
  const upRaw = ends.length && bodyKs.length ? mean(bodyKs).sub(mean(ends)) : new THREE.Vector3(0, 1, 0);
  if (upRaw.lengthSq() < 1e-12) upRaw.set(0, 1, 0);
  upRaw.normalize();
  // the head: an outright one, else the shallowest head bone (one called "head" before its ears)
  const named = all.findIndex((k) => override[joints[k].getName()] === 'head');
  const headK = named >= 0 ? named : all.filter((k) => role[k] === 'head').sort((a, b) => depth[a] - depth[b] || (words(joints[a].getName()).includes('head') ? 0 : 1) - (words(joints[b].getName()).includes('head') ? 0 : 1))[0];
  const tailK = byDepth(all.filter((k) => role[k] === 'tail'))[0];
  const box0 = new THREE.Box3();
  for (let i = 0; i < count; i++) box0.expandByPoint(v.fromArray(tris.pos, i * 3));
  const c0 = box0.getCenter(new THREE.Vector3());
  const fwdRaw = (headK !== undefined && tailK !== undefined ? jp[headK].clone().sub(jp[tailK]) : headK !== undefined ? jp[headK].clone().sub(c0) : new THREE.Vector3(0, 0, 1)).normalize();
  // models are made square to their axes: the pair of axes (up, forward) nearest the estimates (feet sit below
  // the body but not under its middle, and a head held high tips head-to-tail, so neither is exact on its own)
  const AX = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map((a) => new THREE.Vector3(...a));
  let up = AX[2], fwd = AX[4], best = -Infinity;
  for (const a of AX) for (const b of AX) if (Math.abs(a.dot(b)) < 0.5 && upRaw.dot(a) + fwdRaw.dot(b) > best) { best = upRaw.dot(a) + fwdRaw.dot(b); up = a; fwd = b; }
  if (entry.up) up = new THREE.Vector3(...entry.up).normalize();
  if (entry.fwd) fwd = new THREE.Vector3(...entry.fwd).normalize();
  const right = new THREE.Vector3().crossVectors(up, fwd).normalize();
  const turn = new THREE.Matrix4().makeBasis(right, up, fwd).transpose();
  const turned = new THREE.Box3();
  for (let i = 0; i < count; i++) turned.expandByPoint(v.fromArray(tris.pos, i * 3).applyMatrix4(turn));
  const ts = turned.getSize(new THREE.Vector3());
  const scale = entry.height ? entry.height / ts.y : entry.length / ts.z;
  const tc = turned.getCenter(new THREE.Vector3());
  const place = new THREE.Matrix4().makeScale(scale, scale, scale).multiply(new THREE.Matrix4().makeTranslation(-tc.x, -turned.min.y, -tc.z)).multiply(turn);
  const nplace = new THREE.Matrix3().getNormalMatrix(place);
  for (let i = 0; i < count; i++) {
    v.fromArray(tris.pos, i * 3).applyMatrix4(place).toArray(tris.pos, i * 3);
    n.fromArray(tris.nor, i * 3).applyMatrix3(nplace).normalize().toArray(tris.nor, i * 3);
  }
  for (const p of jp) p.applyMatrix4(place);
  const H = ts.y * scale, Lz = ts.z * scale;

  /* the game's joints, and each original bone's place among them */
  const names = entry.body === 'bird' ? BIRD : QUAD, parent = entry.body === 'bird' ? BIRD_PARENT : QUAD_PARENT;
  const J = {}, map = joints.map((j) => override[j.getName()] || null);
  const line = [];
  for (let k = headK; k !== undefined && k >= 0; k = parentK[k]) line.unshift(k);
  const first = (nm) => { let k = line.find((q) => map[q] === nm); if (k === undefined) k = byDepth(all.filter((q) => map[q] === nm))[0]; return k !== undefined ? jp[k].clone() : null; };
  if (entry.body === 'quad') {
    // each leg: a chain of leg bones from where it leaves the body
    // (a bone with an unknown name between two leg bones, a "HorseLink", is leg too)
    const legBelow = (q) => kids[q].some((c) => role[c] === 'leg' || legBelow(c));
    const inLeg = new Set();
    const chains = all.filter((k) => role[k] === 'leg' && !map[k] && role[parentK[k]] !== 'leg').map((k) => {
      const out = [], walk = (q) => { if (inLeg.has(q) || (role[q] !== 'leg' && !(role[q] === 'spine' && legBelow(q)))) return; inLeg.add(q); out.push(q); kids[q].forEach(walk); };
      walk(k);
      return out;
    }).filter((c) => c.length);
    const zs = chains.map((c) => jp[c[0]].z), zMid = (Math.max(...zs) + Math.min(...zs)) / 2;
    const groups = { fL: [], fR: [], hL: [], hR: [] }, attach = { f: [], h: [] };
    for (const c of chains) {
      // (its side from the whole chain: a collar bone can cross the middle, an end bone sit at the origin)
      const g = (jp[c[0]].z >= zMid ? 'f' : 'h') + (c.reduce((a, k) => a + jp[k].x, 0) >= 0 ? 'L' : 'R');
      groups[g].push(...c);
      attach[g[0]].push(parentK[c[0]]);
    }
    for (const g of ['fL', 'fR', 'hL', 'hR']) {
      const ks = groups[g];
      // shoulder and collar bones ride with the upper leg; then down the chain: upper, lower, and the rest the paw
      const girdle = ks.filter((k) => has(words(joints[k].getName()), GIRDLE));
      const rest2 = ks.filter((k) => !girdle.includes(k));
      const d0 = Math.min(...rest2.map((k) => depth[k]));
      for (const k of ks) map[k] = g[0] + (girdle.includes(k) ? 'u' : ['u', 'l', 'p'][Math.min(2, depth[k] - d0)]) + g[1];
      for (const s of ['u', 'l', 'p']) {
        const k = byDepth(rest2.filter((q) => map[q] === g[0] + s + g[1]))[0];
        J[g[0] + s + g[1]] = k !== undefined ? jp[k].clone() : null;
      }
      const u = g[0] + 'u' + g[1], l = g[0] + 'l' + g[1], p = g[0] + 'p' + g[1];
      J[u] ??= new THREE.Vector3((g[1] === 'L' ? 1 : -1) * 0.12 * H, H * 0.6, (g[0] === 'f' ? 0.3 : -0.3) * Lz);
      J[p] ??= new THREE.Vector3(J[l] ? J[l].x : J[u].x, H * 0.05, J[l] ? J[l].z : J[u].z);
      J[l] ??= J[u].clone().lerp(J[p], 0.5);
    }
    // the spine line: up to where the hind legs hang, the pelvis; from where the front legs hang, the chest
    const at = (ks) => Math.max(-1, ...ks.map((k) => line.indexOf(k)));
    const hindAt = at(attach.h), firstNeck = line.findIndex((k) => map[k] === 'neck' || (!map[k] && role[k] === 'neck'));
    let frontAt = at(attach.f);
    if (firstNeck >= 0 && (frontAt < 0 || frontAt >= firstNeck)) frontAt = firstNeck - 1;
    let headed = false;
    line.forEach((k, i) => {
      headed ||= map[k] === 'head' || (!map[k] && role[k] === 'head');
      if (map[k]) return;
      map[k] = headed ? 'head' : role[k] === 'neck' ? 'neck' : i <= hindAt ? 'pelvis' : i >= frontAt ? 'chest' : 'spine';
    });
    const tail = byDepth(all.filter((k) => role[k] === 'tail' && !map[k]));
    tail.forEach((k, i) => (map[k] = 'tail' + Math.min(2, Math.floor((i / tail.length) * 3))));
    all.forEach((k) => { if (!map[k] && (role[k] === 'head' || role[k] === 'neck')) map[k] = role[k]; });
    const pv = (a, b) => new THREE.Vector3(0, (a.y + b.y) / 2, (a.z + b.z) / 2);
    J.root = new THREE.Vector3(0, 0, 0);
    J.pelvis = pv(J.huL, J.huR);
    J.chest = pv(J.fuL, J.fuR);
    J.spine = J.pelvis.clone().lerp(J.chest, 0.5);
    J.head = first('head') || J.chest.clone().add(new THREE.Vector3(0, 0.25 * H, 0.2 * Lz));
    J.neck = first('neck') || J.chest.clone().lerp(J.head, 0.4);
    for (let i = 0; i < 3; i++) J['tail' + i] = first('tail' + i) || J.pelvis.clone().add(new THREE.Vector3(0, -0.04 * H * i, -0.06 * Lz * (i + 1)));
  } else {
    const sides = { L: { wing: [], leg: [] }, R: { wing: [], leg: [] } };
    all.forEach((k) => { if (!map[k] && (role[k] === 'wing' || role[k] === 'leg')) sides[jp[k].x >= 0 ? 'L' : 'R'][role[k]].push(k); });
    for (const s of ['L', 'R']) {
      const ws = sides[s].wing, sx = s === 'L' ? 1 : -1;
      const span = Math.max(0.001, ...ws.map((k) => Math.abs(jp[k].x)));
      ws.forEach((k) => (map[k] = !entry.rigidWings && Math.abs(jp[k].x) > span * 0.5 ? 'tip' + s : 'wing' + s));
      const inner = byDepth(ws)[0], outer = byDepth(ws.filter((k) => map[k] === 'tip' + s))[0];
      J['wing' + s] = inner !== undefined ? jp[inner].clone() : new THREE.Vector3(sx * 0.12 * Lz, H * 0.65, 0.05 * Lz);
      J['tip' + s] = outer !== undefined ? jp[outer].clone() : J['wing' + s].clone().add(new THREE.Vector3(sx * 0.25 * Lz, 0, -0.05 * Lz));
      sides[s].leg.forEach((k) => (map[k] = 'leg' + s));
      const top = byDepth(sides[s].leg)[0];
      J['leg' + s] = top !== undefined ? jp[top].clone() : new THREE.Vector3(sx * 0.06 * Lz, H * 0.35, 0);
    }
    let headed = false;
    line.forEach((k) => { headed ||= map[k] === 'head' || role[k] === 'head'; if (!map[k]) map[k] = headed ? 'head' : role[k] === 'neck' ? 'neck' : 'body'; });
    all.forEach((k) => { if (!map[k] && role[k] && role[k] !== 'body') map[k] = role[k]; });
    J.root = new THREE.Vector3(0, 0, 0);
    J.body = new THREE.Vector3(0, (J.legL.y + J.legR.y) / 2 + 0.1 * H, 0);
    J.head = first('head') || new THREE.Vector3(0, H * 0.9, 0.35 * Lz);
    J.neck = first('neck') || J.body.clone().lerp(J.head, 0.5);
    J.tail = first('tail') || new THREE.Vector3(0, H * 0.4, -0.35 * Lz);
  }
  const resolve = (k) => { for (let q = k; q >= 0; q = parentK[q]) if (map[q]) return map[q]; return entry.body === 'bird' ? 'body' : 'pelvis'; };
  const final = all.map((k) => map[k] || resolve(k));
  const GI = Object.fromEntries(names.map((nm, i) => [nm, i]));
  const nearestJoint = (p) => names.slice(1).reduce((a, b) => (J[b].distanceToSquared(p) < J[a].distanceToSquared(p) ? b : a), names[1]);

  /* the atlas: each texture in a square (four to a sheet at most, else sixteen), its uvs moved there */
  const list = [...texSlots.values()];
  const per = list.length <= 1 ? ATLAS : list.length <= 4 ? ATLAS / 2 : ATLAS / 4;
  const atlas = Buffer.alloc(ATLAS * ATLAS * 4, 255);
  let si = 0;
  for (const s of list) {
    s.x = (si % (ATLAS / per)) * per; s.y = Math.floor(si / (ATLAS / per)) * per; s.size = per; si++;
    const { data } = await sharp(Buffer.from(s.tex.getImage())).ensureAlpha().resize(per, per, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
    for (let r = 0; r < per; r++) for (let c = 0; c < per; c++) {
      const a = (r * per + c) * 4, b = ((s.y + r) * ATLAS + s.x + c) * 4;
      atlas[b] = data[a]; atlas[b + 1] = data[a + 1]; atlas[b + 2] = data[a + 2]; atlas[b + 3] = s.alpha ? data[a + 3] : 255;
    }
  }
  const slotOf = new Map(list.map((s) => [s.tex, s]));
  const WHITE = [1 - 2 / ATLAS, 1 - 2 / ATLAS];

  /* weld into an indexed mesh with the game's weights */
  const keyMap = new Map(), verts = [], index = [];
  for (let i = 0; i < count; i++) {
    const s = tris.tex[i] ? slotOf.get(tris.tex[i]) : null;
    let uv = WHITE;
    if (s && tris.uv[i * 2] >= -0.5) {
      const u = tris.uv[i * 2] - Math.floor(tris.uv[i * 2]), w = tris.uv[i * 2 + 1] - Math.floor(tris.uv[i * 2 + 1]);
      uv = [(s.x + 0.5 + u * (s.size - 1)) / ATLAS, (s.y + 0.5 + w * (s.size - 1)) / ATLAS];
    }
    const p = tris.pos.slice(i * 3, i * 3 + 3);
    const ws = {};
    for (const [k, w] of tris.bw[i]) ws[final[k]] = (ws[final[k]] || 0) + w;
    if (!tris.bw[i].length) ws[nearestJoint(new THREE.Vector3(...p))] = 1;
    const top = Object.entries(ws).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const tot = top.reduce((a, b) => a + b[1], 0) || 1;
    const vert = { p, n: tris.nor.slice(i * 3, i * 3 + 3), uv, c: tris.col.slice(i * 3, i * 3 + 3), j: top.map((t) => GI[t[0]]), w: top.map((t) => t[1] / tot) };
    while (vert.j.length < 4) { vert.j.push(0); vert.w.push(0); }
    const key = [...vert.p, ...vert.n, ...uv].map((x) => Math.round(x * 1e4)).join(',');
    let r = keyMap.get(key);
    if (r === undefined) { r = verts.length; keyMap.set(key, r); verts.push(vert); }
    index.push(r);
  }
  const nv = verts.length;
  const fp = new Float32Array(nv * 3), fa = new Float32Array(nv * 5);
  verts.forEach((q, i) => { fp.set(q.p, i * 3); fa.set([...q.n, ...q.uv], i * 5); });
  const full = Uint32Array.from(index);
  const lodsOut = [];
  const t0 = entry.tris || (entry.body === 'bird' ? 3000 : 5000);
  // (fur and mane cards are loose quads the simplifier can't fold, so the smaller levels may drop the smallest)
  for (const [t, flags, err] of [[t0, [], 0.25], [Math.round(t0 * 0.3), ['Prune', 'Permissive'], 0.5], [entry.body === 'bird' ? 300 : 700, ['Prune', 'Permissive'], 1]]) {
    let ix = full;
    if (full.length / 3 > t) [ix] = MeshoptSimplifier.simplifyWithAttributes(full, fp, 3, fa, 5, [0.5, 0.5, 0.5, 1.5, 1.5], null, t * 3, err, flags);
    const used = new Int32Array(nv).fill(-1);
    let m = 0;
    const out = Array.from(ix, (vv) => (used[vv] < 0 ? (used[vv] = m++) : used[vv]));
    const L = { index: out, n: m, pos: new Float32Array(m * 3), nor: new Float32Array(m * 3), uv: new Float32Array(m * 2), col: new Uint8Array(m * 3), j: new Uint8Array(m * 4), w: new Float32Array(m * 4) };
    for (let s = 0; s < nv; s++) {
      const d = used[s];
      if (d < 0) continue;
      const q = verts[s];
      L.pos.set(q.p, d * 3); L.nor.set(q.n, d * 3); L.uv.set(q.uv, d * 2); L.col.set(q.c.map((x) => Math.round(Math.min(1, x) * 255)), d * 3); L.j.set(q.j, d * 4); L.w.set(q.w, d * 4);
    }
    lodsOut.push(L);
  }

  /* the GLB: the game's joints (no rotations), one skin, three meshes */
  const out = new Document();
  const buf = out.createBuffer();
  out.createExtension(EXTTextureWebP).setRequired(true);
  const sc = out.createScene(entry.id);
  const nodes = names.map((nm) => out.createNode(nm));
  names.forEach((nm, i) => {
    const p = parent[nm], t = p ? J[nm].clone().sub(J[p]) : J[nm];
    nodes[i].setTranslation([t.x, t.y, t.z]);
    if (p) nodes[GI[p]].addChild(nodes[i]);
  });
  sc.addChild(nodes[0]);
  const ibmOut = new Float32Array(16 * names.length);
  names.forEach((nm, i) => ibmOut.set(new THREE.Matrix4().makeTranslation(-J[nm].x, -J[nm].y, -J[nm].z).elements, i * 16));
  const sk = out.createSkin('body').setSkeleton(nodes[0]).setInverseBindMatrices(out.createAccessor().setType('MAT4').setArray(ibmOut).setBuffer(buf));
  nodes.forEach((nd) => sk.addJoint(nd));
  const webp = await sharp(atlas, { raw: { width: ATLAS, height: ATLAS, channels: 4 } }).webp({ quality: 82, alphaQuality: 90, effort: 6 }).toBuffer();
  const mat = out.createMaterial('coat').setBaseColorTexture(out.createTexture('coat').setImage(new Uint8Array(webp)).setMimeType('image/webp')).setRoughnessFactor(0.85).setMetallicFactor(0).setAlphaMode('MASK').setAlphaCutoff(0.5).setDoubleSided(!!entry.doubleSided);
  const trisN = [];
  lodsOut.forEach((L, k) => {
    const a = (arr, type) => out.createAccessor().setType(type).setArray(arr).setBuffer(buf);
    const prim = out.createPrimitive().setMaterial(mat).setIndices(a(L.n < 65536 ? Uint16Array.from(L.index) : Uint32Array.from(L.index), 'SCALAR'))
      .setAttribute('POSITION', a(L.pos, 'VEC3')).setAttribute('NORMAL', a(L.nor, 'VEC3')).setAttribute('TEXCOORD_0', a(L.uv, 'VEC2'))
      .setAttribute('COLOR_0', a(L.col, 'VEC3').setNormalized(true)).setAttribute('JOINTS_0', a(L.j, 'VEC4')).setAttribute('WEIGHTS_0', a(L.w, 'VEC4'));
    sc.addChild(out.createNode(`lod${k}`).setMesh(out.createMesh(`lod${k}`).addPrimitive(prim)).setSkin(sk));
    trisN.push(L.index.length / 3);
  });
  const wings = entry.body === 'bird' && final.some((f) => f.startsWith('wing') || f.startsWith('tip'));
  const meta = { id: entry.id, body: entry.body, species: entry.species, height: +H.toFixed(3), length: +Lz.toFixed(3), wings, tris: trisN };
  sc.setExtras(meta);
  await out.transform(reorder({ encoder: MeshoptEncoder, target: 'size' }), quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeWeight: 8 }));
  out.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  const glb = await io.writeBinary(out);
  writeFileSync(join(OUT, `${entry.id}.glb`), glb);
  const counts = {};
  for (const f of final) counts[f] = (counts[f] || 0) + 1;
  const missing = names.filter((nm) => nm !== 'root' && !counts[nm]);
  console.log(`${entry.id}: ${count / 3} tris â†’ ${trisN.join(' / ')}; ${H.toFixed(2)} m tall, ${Lz.toFixed(2)} long (Ã—${scale.toFixed(3)}, up ${up.toArray().map((x) => x.toFixed(2))}); ${joints.length} bones${missing.length ? '; nothing on ' + missing.join(' ') : ''}; glb ${(glb.length / 1024).toFixed(0)} KB`);
  if (process.env.VERBOSE) console.log(all.map((k) => `  ${joints[k].getName()} â†’ ${final[k]}`).join('\n'));
  return { ...meta, file: `${entry.id}.glb`, bytes: glb.length };
}

const only = process.argv.slice(2);
await MeshoptDecoder.ready; await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
mkdirSync(OUT, { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const indexFile = join(OUT, 'index.json');
const prev = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')).zoo : [];
const zoo = [];
for (const entry of ZOO) {
  if (only.length && !only.includes(entry.id)) { const p = prev.find((x) => x.id === entry.id); if (p) zoo.push(p); continue; }
  try { zoo.push(await build(entry, io)); } catch (err) { console.error(`${entry.id}: ${err.stack}`); }
}
writeFileSync(indexFile, JSON.stringify({ source: 'see public/models/CREDITS.md', zoo }, null, 1) + '\n');

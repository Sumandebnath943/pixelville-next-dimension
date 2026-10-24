/* ============================================================
   Architecture kit: real materials and a procedural builder for
   terraced houses and corner shops / pubs. Walls are cut around
   their openings with proper reveals; windows have frames,
   glazing bars, stone sills and lintels; glass shows a room
   behind it (interior mapping: walls, floor, ceiling lamp,
   furniture, curtains) that lights up at night; doors have
   panels, fanlights, steps and surrounds; roofs are tiled slabs
   with fascias, soffits, gutters, downpipes, party-wall
   parapets and chimneys. All geometry for one material is
   merged, and UVs are world-projected so brick courses line up
   from house to house.
   ============================================================ */
import * as THREE from 'three';
import { surface } from './surface';
import * as TX from './textures';

/* ---------- materials ---------- */
export interface MatDef { mat: THREE.Material; metres: number }

const INTERIOR = /* glsl */ `
varying vec4 vRoom;
varying vec3 vWin;
varying vec3 vTan;
uniform float uInteriorDay;
uniform float uLightsOn;

vec3 pvPalette(float s) {
  float k = fract(s * 7.31);
  if (k < 0.2) return vec3(0.62, 0.55, 0.45);
  if (k < 0.4) return vec3(0.48, 0.55, 0.58);
  if (k < 0.6) return vec3(0.55, 0.58, 0.46);
  if (k < 0.8) return vec3(0.66, 0.62, 0.56);
  return vec3(0.58, 0.44, 0.42);
}
vec3 pvInterior() {
  vec3 T = normalize(vTan);
  vec3 N = normalize(vWNrm);
  vec3 vd = normalize(vWPos - cameraPosition);
  vec3 rd = vec3(dot(vd, T), vd.y, -dot(vd, N));
  rd.z = max(rd.z, 1e-3);
  float seed = vRoom.z;
  float kind = floor(vRoom.w / 2.0 + 0.01);
  float lit = mod(vRoom.w, 2.0);
  // a blacked-out district: every lamp in every room goes out
  float pw = pvPower(vWPos);
  float uLightsOnK = uLightsOn * pw;
  // stained glass: leaded panes of colour, glowing when the church is lit
  if (kind > 3.5) {
    vec2 q = vec2(vRoom.x * 5.0, vRoom.y * 3.2);
    vec2 cid = floor(q), fq = fract(q);
    float lead = step(0.88, max(fq.x, fq.y)) + step(max(fq.x, fq.y), 0.12);
    vec3 gl = vec3(pvHash12(cid * 1.7), pvHash12(cid * 3.1 + 2.0), pvHash12(cid * 5.3 + 7.0));
    gl = mix(vec3(0.7, 0.15, 0.12), mix(vec3(0.15, 0.25, 0.7), vec3(0.85, 0.65, 0.15), gl.y), gl.x);
    vec3 g2 = gl * (1.0 - min(1.0, lead));
    return g2 * (uInteriorDay * 0.35 + uLightsOnK * 0.5);
  }
  float W = 3.4 + fract(seed * 7.13) * 1.8;
  float Hr = 2.6;
  float D = 3.4 + fract(seed * 3.7) * 2.2;
  if (kind > 0.5) { W = 10.0; Hr = 3.3; D = 7.0; }
  if (kind > 2.5) { W = 7.0 + fract(seed * 9.1) * 6.0; Hr = 2.9; D = 9.0; }
  vec3 ro = vec3(vRoom.x + (fract(seed * 5.3) - 0.5) * 0.9 * step(kind, 0.5), vRoom.y, 0.0);

  vec3 lampC = mix(vec3(1.0, 0.68, 0.38), vec3(1.0, 0.82, 0.6), fract(seed * 17.0));
  // homes light up at dusk; shops and the pub trade with their lights on all day; offices work late
  float lampOn = (kind > 2.5 ? max(uLightsOnK * lit, 0.6 * (1.0 - uLightsOn) + 0.2) : kind > 0.5 ? max(uLightsOnK, 0.85) : lit * uLightsOnK) * pw;
  if (kind > 0.5) lampC = mix(lampC, vec3(1.0, 0.92, 0.8), 0.6);
  float day = uInteriorDay;

  // curtains, hung just behind the glass
  if (kind < 0.5) {
    float cw = 0.1 + fract(seed * 11.7) * 0.32;
    float tc = 0.1 / rd.z;
    vec3 pc = ro + rd * tc;
    if (abs(pc.x) > vWin.x - cw && abs(pc.x) < vWin.x + 0.4 && pc.y > vWin.y - 0.1 && pc.y < vWin.z + 0.15) {
      vec3 cc = mix(vec3(0.55, 0.18, 0.15), vec3(0.75, 0.68, 0.5), fract(seed * 29.0));
      if (fract(seed * 31.0) > 0.6) cc = vec3(0.32, 0.38, 0.5);
      float fold = 0.72 + 0.28 * sin(pc.x * 42.0 + seed * 10.0);
      return cc * fold * (day * 0.55 + lampOn * lampC * 0.32);
    }
  }

  vec3 bmin = vec3(-W * 0.5, 0.0, 0.0), bmax = vec3(W * 0.5, Hr, D);
  vec3 inv = 1.0 / rd;
  vec3 t0 = (bmin - ro) * inv, t1 = (bmax - ro) * inv;
  vec3 tf = max(t0, t1);
  float t = min(min(tf.x, tf.y), tf.z);
  vec3 h = ro + rd * t;
  vec3 wall = pvPalette(seed);
  vec3 col;
  if (kind > 0.5) wall = kind > 2.5 ? vec3(0.82, 0.82, 0.8) : kind > 1.5 ? vec3(0.36, 0.22, 0.14) : vec3(0.78, 0.74, 0.66);
  if (t == tf.z) {
    col = wall;
    float f = fract(seed * 13.1);
    if (kind > 2.5) {
      // an office: partitions, desks and screens
      if (h.y < 1.1 && fract(h.x * 0.45 + seed) > 0.25) col = mix(vec3(0.35, 0.33, 0.3), vec3(0.55, 0.5, 0.45), step(0.75, h.y));
      if (h.y > 0.78 && h.y < 1.05 && fract(h.x * 0.9 + seed * 3.0) < 0.2) col = vec3(0.15, 0.2, 0.28) + uLightsOnK * vec3(0.2, 0.3, 0.45);
    } else if (kind > 0.5) {
      // shop: shelves of goods; pub: a bar back with bottles
      float shelf = step(0.82, fract(h.y * 2.2));
      float goods = step(0.35, fract(h.x * 3.1 + floor(h.y * 2.2) * 0.37));
      vec3 g = mix(vec3(0.75, 0.55, 0.3), vec3(0.6, 0.35, 0.25), fract(floor(h.x * 3.1) * 0.61));
      if (kind > 1.5) g = mix(vec3(0.25, 0.4, 0.2), vec3(0.6, 0.45, 0.2), fract(floor(h.x * 8.0) * 0.61)) * 1.4;
      if (h.y > 0.9 && h.y < 2.6) col = mix(mix(col, g, goods), vec3(0.3, 0.2, 0.12), shelf);
      if (h.y < 1.05) col = kind > 1.5 ? vec3(0.22, 0.12, 0.07) : vec3(0.55, 0.42, 0.3);
    } else {
      if (f < 0.4 && abs(h.x) < 0.45 && h.y > 1.3 && h.y < 1.9) {
        col = (abs(h.x) > 0.4 || h.y < 1.35 || h.y > 1.85) ? vec3(0.2, 0.14, 0.08) : mix(vec3(0.3, 0.45, 0.6), vec3(0.7, 0.55, 0.3), h.y - 1.3);
      } else if (f >= 0.4 && f < 0.75 && h.x > 0.2 && h.x < 1.4 && h.y < 2.0) {
        float book = step(0.12, fract(h.x * 14.0)) * step(0.1, fract(h.y * 3.0));
        col = mix(vec3(0.28, 0.18, 0.1), mix(vec3(0.5, 0.2, 0.15), vec3(0.2, 0.3, 0.45), fract(floor(h.x * 14.0) * 0.37)), book);
      }
      if (abs(h.x + 0.3) < 0.9 && h.y < 0.75 && f > 0.25) col = mix(vec3(0.3, 0.32, 0.36), vec3(0.45, 0.3, 0.22), fract(seed * 41.0));
    }
  } else if (t == tf.y) {
    if (rd.y < 0.0) {
      col = mix(vec3(0.36, 0.24, 0.14), vec3(0.3, 0.2, 0.12), step(0.5, fract(h.x * 3.0))) * (0.85 + 0.15 * fract(floor(h.z * 0.8 + floor(h.x * 3.0) * 0.5) * 0.71));
      if (abs(h.x) < 1.0 && h.z > 1.0 && h.z < D - 0.8 && kind < 0.5) col = mix(vec3(0.45, 0.2, 0.18), vec3(0.3, 0.32, 0.4), fract(seed * 3.3));
    } else {
      col = vec3(0.86, 0.84, 0.8);
      if (kind > 2.5) {
        // a grid of ceiling panels
        vec2 g = fract(h.xz * vec2(0.42, 0.5));
        col += vec3(0.9, 0.95, 1.0) * lampOn * 2.0 * step(0.7, g.x) * step(0.6, g.y);
      } else col += lampC * lampOn * 2.5 * smoothstep(0.3, 0.0, length(h.xz - vec2(0.0, D * 0.5)));
    }
  } else {
    col = wall * 0.92;
    if (fract(seed * 19.0) > 0.5 && h.z > D * 0.55 && h.z < D * 0.55 + 0.9 && h.y < 2.05) col = vec3(0.55, 0.48, 0.4);
  }
  float depthK = 1.0 - h.z / D * 0.65;
  vec3 light = vec3(day) * depthK * vec3(0.95, 0.97, 1.0);
  float ld = length(h - vec3(0.0, Hr - 0.3, D * 0.45));
  if (kind > 2.5) { lampC = vec3(0.92, 0.96, 1.0); ld = 1.5; }
  light += lampC * lampOn * (kind > 2.5 ? 1.4 : kind > 0.5 ? 2.6 * (0.5 + 0.5 * uLightsOnK) + 0.6 : 0.34) * (0.7 + 0.6 * fract(seed * 23.0)) / (1.0 + ld * ld * 0.18);
  // a TV flickering in some dark rooms
  if (lit < 0.5 && fract(seed * 43.0) > 0.7 && kind < 0.5) {
    float fl = 0.6 + 0.4 * sin(uTime * 7.0 + seed * 50.0) * sin(uTime * 2.3 + seed);
    light += vec3(0.35, 0.45, 0.8) * 0.05 * fl * uLightsOnK / (1.0 + h.z * 0.5);
  }
  return col * light;
}
`;

export const interiorDay = { value: 1 };
export const lightsOn = { value: 0 };

function std(o: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, ...o });
}
function texd(set: TX.TexSet, o: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return std({ map: set.map, normalMap: set.normalMap, roughnessMap: set.roughnessMap, roughness: 1, ...o });
}

export class Palette {
  defs: Record<string, MatDef> = {};
  constructor() {
    const add = (k: string, mat: THREE.Material, metres = 1): void => {
      this.defs[k] = { mat, metres };
    };
    const brickRed = TX.brick('#9a4a34', '#b8ad9c', 1);
    const brickBrown = TX.brick('#7a5a44', '#a89a88', 2);
    const brickYellow = TX.brick('#c9a66e', '#d4c8b0', 3);
    add('brickRed', surface(texd(brickRed, { vertexColors: true }), { snow: 1, wet: 1, antiTile: 0.12 }, 'bR'), brickRed.metres);
    add('brickBrown', surface(texd(brickBrown, { vertexColors: true }), { snow: 1, wet: 1, antiTile: 0.12 }, 'bB'), brickBrown.metres);
    add('brickYellow', surface(texd(brickYellow, { vertexColors: true }), { snow: 1, wet: 1, antiTile: 0.12 }, 'bY'), brickYellow.metres);
    const rend = TX.render();
    add('render', surface(texd(rend, { vertexColors: true }), { snow: 1, wet: 0.8, antiTile: 0.03 }, 'rnd'), rend.metres);
    const clay = TX.clayTiles();
    add('clay', surface(texd(clay, { vertexColors: true }), { snow: 1.25, wet: 0.7, antiTile: 0.15 }, 'clay'), clay.metres);
    const sl = TX.slate();
    add('slate', surface(texd(sl, { vertexColors: true }), { snow: 1.25, wet: 0.5, antiTile: 0.1 }, 'slate'), sl.metres);
    const stone = TX.ashlar('#c9c1ae', 21);
    add('stone', surface(texd(stone, { vertexColors: true }), { snow: 1, wet: 0.8 }, 'stone'), stone.metres);
    const ash = TX.ashlar('#9d9686', 22);
    add('ashlar', surface(texd(ash, { vertexColors: true }), { snow: 1, wet: 0.9, antiTile: 0.15 }, 'ashlar'), ash.metres);
    add('trim', surface(std({ vertexColors: true, roughness: 0.42 }), { snow: 1, wet: 0.3 }, 'trim'));
    add('paint', surface(std({ vertexColors: true, roughness: 0.28 }), { snow: 1, wet: 0.2 }, 'paint'));
    add('metal', surface(std({ vertexColors: true, roughness: 0.35, metalness: 0.65 }), { snow: 0.9, wet: 0.2 }, 'metal'));
    add('brass', surface(std({ color: 0xc8a050, roughness: 0.25, metalness: 1 }), { snow: 0.5 }, 'brass'));
    add('pot', surface(std({ color: 0x9a5a3a, roughness: 0.75 }), { snow: 1, wet: 0.8 }, 'pot'));
    add('lead', surface(std({ color: 0x5a6068, roughness: 0.5, metalness: 0.4 }), { snow: 1.2 }, 'lead'));
    const pv = TX.paving();
    add('paving', surface(texd(pv, { vertexColors: true }), { snow: 1, wet: 1, puddles: true, wear: true, antiTile: 0.12 }, 'paving'), pv.metres);
    const gr = TX.granite();
    add('granite', surface(texd(gr, { vertexColors: true }), { snow: 1, wet: 0.8, wear: true }, 'granite'), gr.metres);
    const asp = TX.asphalt();
    add('asphalt', surface(texd(asp, { vertexColors: true }), { snow: 1, wet: 1, puddles: true, wear: true, antiTile: 0.25 }, 'asphalt'), asp.metres);
    const gg = TX.grassGround();
    add('grass', surface(texd(gg, { vertexColors: true }), { snow: 1, wet: 0.5, antiTile: 0.3 }, 'grassG'), gg.metres);
    const sd = TX.sand();
    add('sand', surface(texd(sd, { vertexColors: true }), { snow: 1, wet: 0.8, antiTile: 0.15 }, 'sand'), sd.metres);
    const rk = TX.rock();
    add('rock', surface(texd(rk, { vertexColors: true }), { snow: 1.2, wet: 0.7, antiTile: 0.25 }, 'rock'), rk.metres);
    const gv = TX.gravel();
    add('gravel', surface(texd(gv, { vertexColors: true }), { snow: 1, wet: 0.9, puddles: true, wear: true }, 'gravel'), gv.metres);
    const so = TX.soil();
    add('soil', surface(texd(so, { vertexColors: true }), { snow: 1, wet: 1 }, 'soil'), so.metres);
    const pl = TX.planks();
    add('timber', surface(texd(pl, { vertexColors: true }), { snow: 1, wet: 0.9 }, 'timber'), pl.metres);
    const paintTex = TX.roadPaint();
    const rp = std({ map: paintTex, transparent: true, roughness: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    add('roadPaint', surface(rp, { snow: 1, wet: 0.5, puddles: true, wear: true }, 'rpaint'), 1.5);

    // window glass: reflective, with the room behind it as emitted light
    const glass = std({ color: 0x000000, roughness: 0.04, metalness: 0 });
    add('glass', surface(glass, {
      snow: 0, wet: 0.1,
      vDecl: 'attribute vec4 aRoom;\nattribute vec3 aWin;\nattribute vec3 aTan;\nvarying vec4 vRoom;\nvarying vec3 vWin;\nvarying vec3 vTan;',
      vDisplace: 'vRoom = aRoom; vWin = aWin; vTan = normalize(mat3(modelMatrix) * aTan);',
      fDecl: INTERIOR,
      fEmissive: 'totalEmissiveRadiance += pvInterior();',
      uniforms: { uInteriorDay: interiorDay, uLightsOn: lightsOn },
    }, 'glass'));
    // curved and odd-shaped glazing: a dark mirror without a room behind it
    add('glassPlain', surface(std({ color: 0x0a1016, roughness: 0.05, metalness: 0.3 }), { wet: 0.1 }, 'glassPlain'));
    // lit panels (neon, beacons, signal lamps): coloured by day, glowing after dusk
    add('glowPanel', surface(std({ vertexColors: true, roughness: 0.35 }), {
      fEmissive: 'totalEmissiveRadiance += diffuseColor.rgb * (0.25 + uLightsOn * 3.5) * pvPower(vWPos);',
      fDecl: 'uniform float uLightsOn;',
      uniforms: { uLightsOn: lightsOn },
    }, 'glowPanel'));
  }
  mat(k: string): THREE.Material {
    return this.defs[k].mat;
  }
  /** register a textured, unshared material (signs, awnings); the texture is painted only on first use */
  custom(k: string, tex: () => THREE.Texture, o: THREE.MeshStandardMaterialParameters = {}, snow = 1): string {
    if (!this.defs[k]) this.defs[k] = { mat: surface(std({ map: tex(), ...o }), { snow, wet: 0.5 }, k), metres: 0 };
    return k;
  }
  /** a painted name board, backlit after dusk */
  sign(text: string, bg: string, fg: string): string {
    const k = `sign:${text}|${bg}|${fg}`;
    if (!this.defs[k]) {
      const tex = TX.signTex(text, bg, fg, fg.toLowerCase() === '#c9a64a' || fg.toLowerCase() === '#e0b040');
      this.defs[k] = {
        mat: surface(std({ map: tex, roughness: 0.4 }), {
          snow: 0.4, wet: 0.3,
          fEmissive: 'totalEmissiveRadiance += diffuseColor.rgb * uLightsOn * 2.2 * pvPower(vWPos);',
          fDecl: 'uniform float uLightsOn;',
          uniforms: { uLightsOn: lightsOn },
        }, 'signLit'),
        metres: 0,
      };
    }
    return k;
  }
}

let SHARED: Palette | null = null;
/** one palette (one set of generated textures) for the whole game */
export function sharedPalette(): Palette {
  if (!SHARED) SHARED = new Palette();
  return SHARED;
}

/* ---------- geometry kit ---------- */
type V3 = THREE.Vector3;
const v3 = (x: number, y: number, z: number): V3 => new THREE.Vector3(x, y, z);
const WHITE = new THREE.Color(1, 1, 1);

/** a growing float array */
class FBuf {
  a: Float32Array;
  n = 0;
  constructor(cap: number) { this.a = new Float32Array(cap); }
  /** room for k more floats; returns the (possibly new) backing array */
  grow(k: number): Float32Array {
    if (this.n + k > this.a.length) {
      const b = new Float32Array(Math.max(this.a.length * 2, this.n + k));
      b.set(this.a.subarray(0, this.n));
      this.a = b;
    }
    return this.a;
  }
  done(): Float32Array { return this.a.slice(0, this.n); }
}

/** one material's geometry in world space, as flat arrays per attribute */
export interface Packed { count: number; attrs: Record<string, { size: number; array: Float32Array }> }

const GLASS_ATTRS: [string, number][] = [['aRoom', 4], ['aWin', 3], ['aTan', 3]];

class Batch {
  count = 0;
  key = '';
  pos = new FBuf(1536); nor = new FBuf(1536); uv = new FBuf(1024); col = new FBuf(1536);
  extra: { name: string; size: number; buf: FBuf }[] = [];
  reset(key: string): this {
    this.key = key;
    this.count = this.pos.n = this.nor.n = this.uv.n = this.col.n = 0;
    this.extra = [];
    return this;
  }
  pack(): Packed {
    const attrs: Packed['attrs'] = {
      position: { size: 3, array: this.pos.done() },
      normal: { size: 3, array: this.nor.done() },
      uv: { size: 2, array: this.uv.done() },
      color: { size: 3, array: this.col.done() },
    };
    for (const x of this.extra) attrs[x.name] = { size: x.size, array: x.buf.done() };
    return { count: this.count, attrs };
  }
}

// scratch (the kit is single-threaded and never re-entered)
const _M = new THREE.Matrix4(), _N = new THREE.Matrix3(), _OB = new THREE.Matrix4(), _S = new THREE.Matrix4();
const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _fn = new THREE.Vector3();
const _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0), _one = new THREE.Vector3(1, 1, 1);
/** unit cylinders and cones, shared by every kit */
const CYL = new Map<string, THREE.CylinderGeometry>();
/** batches handed back by take(): their grown buffers are reused by the next kit */
const POOL: Batch[] = [];
const QUAD_IDX = [0, 1, 2, 0, 2, 3];
const UNIT_UV = [0, 0, 1, 0, 1, 1, 0, 1];
const _qP = new Float32Array(12), _qN = new Float32Array(12), _qU = new Float32Array(8);
// a unit box: 6 faces × 4 corners (sign triples) with outward normals, two triangles per face
const BOX_S: number[] = [], BOX_N: number[] = [], BOX_IDX: number[] = [];
{
  // normal axis, sign, and the two tangent axes whose cross product is the normal
  const faces: [number, number, number, number][] = [[0, 1, 1, 2], [0, -1, 2, 1], [1, 1, 2, 0], [1, -1, 0, 2], [2, 1, 0, 1], [2, -1, 1, 0]];
  faces.forEach(([ax, s, t1, t2], f) => {
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = [0, 0, 0], n = [0, 0, 0];
      p[ax] = s; p[t1] = a; p[t2] = b; n[ax] = s;
      BOX_S.push(...p); BOX_N.push(...n);
    }
    for (const i of QUAD_IDX) BOX_IDX.push(f * 4 + i);
  });
}
const _bP = new Float32Array(72);

export class Kit {
  private batches = new Map<string, Batch>();
  /** transform applied to everything added (a building's placement) */
  base = new THREE.Matrix4();
  constructor(public pal: Palette) {}

  private batch(key: string, glass = false): Batch {
    const id = glass ? key + '#glass' : key;
    let b = this.batches.get(id);
    if (!b) {
      b = (POOL.pop() || new Batch()).reset(key);
      if (glass) b.extra = GLASS_ATTRS.map(([name, size]) => ({ name, size, buf: new FBuf(256 * size) }));
      this.batches.set(id, b);
    }
    return b;
  }
  private metres(key: string): number {
    return this.pal.defs[key]?.metres || 1;
  }
  /**
   * Append n vertices (read through idx when given) transformed by M, with
   * normals by N. UVs are copied when given, otherwise projected from world
   * space onto the dominant axis so brick courses line up across buildings.
   */
  private write(b: Batch, M: THREE.Matrix4, N: THREE.Matrix3, P: ArrayLike<number>, Nr: ArrayLike<number>, idx: ArrayLike<number> | null, n: number, color: THREE.Color, metres: number, UV: ArrayLike<number> | null): void {
    const e = M.elements, ne = N.elements;
    const pos = b.pos.grow(n * 3), nor = b.nor.grow(n * 3), col = b.col.grow(n * 3), uv = b.uv.grow(n * 2);
    let o = b.pos.n, u2 = b.uv.n;
    const inv = 1 / metres, cr = color.r, cg = color.g, cb = color.b;
    for (let k = 0; k < n; k++) {
      const i = idx ? idx[k] : k, i3 = i * 3;
      const x = P[i3], y = P[i3 + 1], z = P[i3 + 2];
      const wx = e[0] * x + e[4] * y + e[8] * z + e[12];
      const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
      const wz = e[2] * x + e[6] * y + e[10] * z + e[14];
      const a = Nr[i3], bb = Nr[i3 + 1], c = Nr[i3 + 2];
      let nx = ne[0] * a + ne[3] * bb + ne[6] * c;
      let ny = ne[1] * a + ne[4] * bb + ne[7] * c;
      let nz = ne[2] * a + ne[5] * bb + ne[8] * c;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= l; ny /= l; nz /= l;
      pos[o] = wx; pos[o + 1] = wy; pos[o + 2] = wz;
      nor[o] = nx; nor[o + 1] = ny; nor[o + 2] = nz;
      col[o] = cr; col[o + 1] = cg; col[o + 2] = cb;
      o += 3;
      if (UV) {
        uv[u2] = UV[i * 2]; uv[u2 + 1] = UV[i * 2 + 1];
      } else {
        const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
        if (ay >= ax && ay >= az) { uv[u2] = wx * inv; uv[u2 + 1] = wz * inv; }
        else if (ax >= az) { uv[u2] = wz * (nx < 0 ? -1 : 1) * inv; uv[u2 + 1] = wy * inv; }
        else { uv[u2] = -wx * (nz < 0 ? -1 : 1) * inv; uv[u2 + 1] = wy * inv; }
      }
      u2 += 2;
    }
    b.pos.n = b.nor.n = b.col.n = o;
    b.uv.n = u2;
    b.count += n;
  }

  /** any three.js geometry (indexed or not); it is only read, never kept */
  add(key: string, geo: THREE.BufferGeometry, color: THREE.Color = WHITE): void {
    const p = geo.attributes.position, nr = geo.attributes.normal, ix = geo.index;
    const uv = geo.userData.keepUV ? geo.attributes.uv : null;
    this.write(this.batch(key), this.base, _N.getNormalMatrix(this.base), p.array, nr.array, ix ? ix.array : null, ix ? ix.count : p.count, color, this.metres(key), uv ? uv.array : null);
  }
  /** window glass carries interior-mapping attributes (aTan already in world space) */
  addGlass(g: THREE.BufferGeometry): void {
    const b = this.batch('glass', true);
    const n = g.attributes.position.count;
    this.write(b, this.base, _N.getNormalMatrix(this.base), g.attributes.position.array, g.attributes.normal.array, null, n, WHITE, 1, new Float32Array(n * 2));
    for (const x of b.extra) {
      x.buf.grow(n * x.size).set((g.attributes[x.name].array as Float32Array).subarray(0, n * x.size), x.buf.n);
      x.buf.n += n * x.size;
    }
  }
  /** a round bar between two local points */
  rod(key: string, a: V3, b: V3, r: number, color?: THREE.Color, seg = 6): void {
    const len = a.distanceTo(b);
    const q = _q.setFromUnitVectors(_up, _e1.subVectors(b, a).normalize());
    _OB.compose(_e2.addVectors(a, b).multiplyScalar(0.5), q, _one);
    this.cylinder(key, r, r, len, seg, _OB, color);
  }

  /** axis-aligned box in the current base frame */
  box(key: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color?: THREE.Color): void {
    this.boxAt(key, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), null, color);
  }
  /** a box of size sx·sy·sz centred on (cx, cy, cz) in the frame m (itself inside the base) */
  boxAt(key: string, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, m: THREE.Matrix4 | null, color: THREE.Color = WHITE): void {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    for (let i = 0; i < 24; i++) {
      _bP[i * 3] = cx + BOX_S[i * 3] * hx;
      _bP[i * 3 + 1] = cy + BOX_S[i * 3 + 1] * hy;
      _bP[i * 3 + 2] = cz + BOX_S[i * 3 + 2] * hz;
    }
    const M = m ? _M.multiplyMatrices(this.base, m) : this.base;
    this.write(this.batch(key), M, _N.getNormalMatrix(M), _bP, BOX_N, BOX_IDX, 36, color, this.metres(key), null);
  }
  /** quad; vertex order is fixed so its face points along `facing` */
  quad(key: string, a: V3, b: V3, c: V3, d: V3, facing: V3, color: THREE.Color = WHITE, uv?: number[]): void {
    _fn.crossVectors(_e1.subVectors(b, a), _e2.subVectors(d, a));
    const flip = _fn.dot(facing) < 0;
    const pts = flip ? [a, d, c, b] : [a, b, c, d];
    const uvs = uv || UNIT_UV;
    const uo = flip ? [0, 3, 2, 1] : [0, 1, 2, 3];
    for (let i = 0; i < 4; i++) {
      const p = pts[i];
      _qP[i * 3] = p.x; _qP[i * 3 + 1] = p.y; _qP[i * 3 + 2] = p.z;
      _qN[i * 3] = facing.x; _qN[i * 3 + 1] = facing.y; _qN[i * 3 + 2] = facing.z;
      _qU[i * 2] = uvs[uo[i] * 2]; _qU[i * 2 + 1] = uvs[uo[i] * 2 + 1];
    }
    this.write(this.batch(key), this.base, _N.getNormalMatrix(this.base), _qP, _qN, QUAD_IDX, 6, color, this.metres(key), uv ? _qU : null);
  }
  tri(key: string, a: V3, b: V3, c: V3, facing: V3, color?: THREE.Color): void {
    this.quad(key, a, b, c, c, facing, color);
  }
  cyl(key: string, r: number, h: number, seg: number, m: THREE.Matrix4, color?: THREE.Color, open = false, arc = Math.PI * 2, rTop = r): void {
    this.cylinder(key, rTop, r, h, seg, m, color, open, arc);
  }
  /** a cylinder or cone (centred on its axis, height along y) placed by m; drawn from a cached unit shape */
  cylinder(key: string, rTop: number, r: number, h: number, seg: number, m: THREE.Matrix4 | null, color?: THREE.Color, open = false, arc = Math.PI * 2): void {
    const s = Math.max(rTop, r, 1e-5);
    const id = `${(rTop / s).toFixed(4)}|${(r / s).toFixed(4)}|${seg}|${open ? 1 : 0}|${arc.toFixed(4)}`;
    let g = CYL.get(id);
    if (!g) { g = new THREE.CylinderGeometry(rTop / s, r / s, 1, seg, 1, open, 0, arc); CYL.set(id, g); }
    _S.makeScale(s, Math.max(h, 1e-5), s);
    if (m) _S.premultiply(m);
    this.addIn(key, g, _S, color);
  }
  /** a geometry placed by m inside the base frame */
  addIn(key: string, geo: THREE.BufferGeometry, m: THREE.Matrix4, color: THREE.Color = WHITE): void {
    const p = geo.attributes.position, nr = geo.attributes.normal, ix = geo.index;
    const M = _M.multiplyMatrices(this.base, m);
    this.write(this.batch(key), M, _N.getNormalMatrix(M), p.array, nr.array, ix ? ix.array : null, ix ? ix.count : p.count, color, this.metres(key), null);
  }
  /** slab whose top face is the quad p0..p3 (facing up-ish), `t` thick; UV runs along p0→p1 and p0→p3 */
  slab(key: string, p0: V3, p1: V3, p2: V3, p3: V3, t: number, color?: THREE.Color): void {
    const n = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p3, p0)).normalize();
    if (n.y < 0) n.negate();
    const q = [p0, p1, p2, p3].map((p) => p.clone().addScaledVector(n, -t));
    const m = this.pal.defs[key]?.metres || 1;
    const ua = new THREE.Vector3().subVectors(p1, p0), va = new THREE.Vector3().subVectors(p3, p0);
    const lu = ua.length(), lv = va.length();
    const ux = (p: V3): number => new THREE.Vector3().subVectors(p, p0).dot(ua) / lu / m;
    const vy = (p: V3): number => new THREE.Vector3().subVectors(p, p0).dot(va) / lv / m;
    const top = [p0, p1, p2, p3];
    this.quad(key, top[0], top[1], top[2], top[3], n, color, top.flatMap((p) => [ux(p), vy(p)]));
    this.quad(key, q[0], q[1], q[2], q[3], n.clone().negate(), color);
    const c = new THREE.Vector3().addVectors(p0, p2).multiplyScalar(0.5);
    for (let i = 0; i < 4; i++) {
      const a = top[i], b = top[(i + 1) % 4], qa = q[i], qb = q[(i + 1) % 4];
      if (a.distanceToSquared(b) < 1e-8) continue;
      const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
      const out = mid.sub(c);
      out.addScaledVector(n, -out.dot(n)).normalize();
      this.quad(key, a, b, qb, qa, out, color);
    }
  }

  /** hand over the packed geometry (world space, per material) and start afresh */
  take(): Map<string, Packed[]> {
    const out = new Map<string, Packed[]>();
    for (const b of this.batches.values()) {
      if (b.count) {
        if (!out.has(b.key)) out.set(b.key, []);
        out.get(b.key)!.push(b.pack());
      }
      // keep modest buffers only, so one huge terrain batch isn't held forever
      if (POOL.length < 64 && b.pos.a.length <= 98304) POOL.push(b);
    }
    this.batches.clear();
    return out;
  }

  /** merge per material into meshes */
  build(parent: THREE.Object3D, shadows = true): THREE.Mesh[] {
    return meshesFromParts(this.pal, this.take(), parent, shadows);
  }
}

/** join packed lists per material into meshes (glass joins glass with the same attributes) */
export function meshesFromParts(pal: Palette, parts: Map<string, Packed[]>, parent: THREE.Object3D, shadows = true): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  for (const [key, list] of parts) {
    const groups = new Map<string, Packed[]>();
    for (const p of list) {
      const sig = Object.keys(p.attrs).sort().join();
      if (!groups.has(sig)) groups.set(sig, []);
      groups.get(sig)!.push(p);
    }
    for (const gl of groups.values()) {
      const count = gl.reduce((s, p) => s + p.count, 0);
      if (!count) continue;
      const geo = new THREE.BufferGeometry();
      for (const [name, { size }] of Object.entries(gl[0].attrs)) {
        let arr: Float32Array;
        if (gl.length === 1) arr = gl[0].attrs[name].array;
        else {
          arr = new Float32Array(count * size);
          let o = 0;
          for (const p of gl) { arr.set(p.attrs[name].array, o); o += p.attrs[name].array.length; }
        }
        geo.setAttribute(name, new THREE.BufferAttribute(arr, size));
      }
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, pal.mat(key));
      mesh.castShadow = shadows && key !== 'glass' && key !== 'roadPaint' && !key.startsWith('sign');
      mesh.receiveShadow = true;
      mesh.name = key;
      parent.add(mesh);
      out.push(mesh);
    }
  }
  return out;
}

/* ---------- facades ---------- */
/** a wall plane: origin, along-wall direction u, outward normal n (house-local) */
export class Frame {
  up = v3(0, 1, 0);
  constructor(public o: V3, public u: V3, public n: V3) {}
  p(a: number, b: number, c = 0): V3 {
    return this.o.clone().addScaledVector(this.u, a).addScaledVector(this.up, b).addScaledVector(this.n, c);
  }
}
export interface Hole { a0: number; b0: number; a1: number; b1: number }

const _ob = new THREE.Matrix4(), _obP = new THREE.Vector3();
/** a box in a wall's frame: a along the wall, b up, c out of it */
export function obox(kit: Kit, key: string, F: Frame, a0: number, b0: number, c0: number, a1: number, b1: number, c1: number, color?: THREE.Color): void {
  const a = (a0 + a1) / 2, b = (b0 + b1) / 2, c = (c0 + c1) / 2;
  _obP.copy(F.o).addScaledVector(F.u, a).addScaledVector(F.up, b).addScaledVector(F.n, c);
  _ob.makeBasis(F.u, F.up, F.n).setPosition(_obP);
  kit.boxAt(key, 0, 0, 0, Math.abs(a1 - a0), Math.abs(b1 - b0), Math.abs(c1 - c0), _ob, color);
}

/** the wall face between a0..a1 × b0..b1, with rectangular holes cut out and reveals into them */
export function wallFace(kit: Kit, key: string, F: Frame, a0: number, b0: number, a1: number, b1: number, holes: Hole[], color: THREE.Color, reveal = 0.14): void {
  const ys = new Set<number>([b0, b1]);
  for (const h of holes) { ys.add(Math.max(b0, Math.min(b1, h.b0))); ys.add(Math.max(b0, Math.min(b1, h.b1))); }
  const yl = [...ys].sort((a, b) => a - b);
  for (let i = 0; i < yl.length - 1; i++) {
    const ya = yl[i], yb = yl[i + 1];
    if (yb - ya < 1e-4) continue;
    const cov = holes.filter((h) => h.b0 <= ya + 1e-4 && h.b1 >= yb - 1e-4).sort((p, q) => p.a0 - q.a0);
    let cur = a0;
    const seg = (x0: number, x1: number): void => {
      if (x1 - x0 > 1e-4) kit.quad(key, F.p(x0, ya), F.p(x1, ya), F.p(x1, yb), F.p(x0, yb), F.n, color);
    };
    for (const h of cov) { seg(cur, h.a0); cur = Math.max(cur, h.a1); }
    seg(cur, a1);
  }
  for (const h of holes) {
    const d = -reveal;
    kit.quad(key, F.p(h.a0, h.b0, 0), F.p(h.a0, h.b0, d), F.p(h.a0, h.b1, d), F.p(h.a0, h.b1, 0), F.u, color);
    kit.quad(key, F.p(h.a1, h.b0, 0), F.p(h.a1, h.b0, d), F.p(h.a1, h.b1, d), F.p(h.a1, h.b1, 0), F.u.clone().negate(), color);
    kit.quad(key, F.p(h.a0, h.b1, 0), F.p(h.a1, h.b1, 0), F.p(h.a1, h.b1, d), F.p(h.a0, h.b1, d), v3(0, -1, 0), color);
    kit.quad(key, F.p(h.a0, h.b0, 0), F.p(h.a1, h.b0, 0), F.p(h.a1, h.b0, d), F.p(h.a0, h.b0, d), v3(0, 1, 0), color);
  }
}

/** world-space directions of a frame (the kit's base rotates them) */
export function worldDir(kit: Kit, d: V3): V3 {
  return d.clone().transformDirection(kit.base);
}

/** glass pane with interior mapping data */
export function glassPane(kit: Kit, F: Frame, h: Hole, c: number, floorY: number, seed: number, lit: boolean, kind = 0): void {
  const cx = (h.a0 + h.a1) / 2;
  const hw = (h.a1 - h.a0) / 2;
  const tan = worldDir(kit, F.u);
  const g = new THREE.BufferGeometry();
  const corners = [[h.a0, h.b0], [h.a1, h.b0], [h.a1, h.b1], [h.a0, h.b0], [h.a1, h.b1], [h.a0, h.b1]];
  const pos: number[] = [], nor: number[] = [], room: number[] = [], win: number[] = [], tg: number[] = [];
  for (const [a, b] of corners) {
    const p = F.p(a, b, c);
    pos.push(p.x, p.y, p.z);
    nor.push(F.n.x, F.n.y, F.n.z);
    room.push(a - cx, b - floorY, seed, (lit ? 1 : 0) + kind * 2);
    win.push(hw, h.b0 - floorY, h.b1 - floorY);
    tg.push(tan.x, tan.y, tan.z);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aRoom', new THREE.Float32BufferAttribute(room, 4));
  g.setAttribute('aWin', new THREE.Float32BufferAttribute(win, 3));
  g.setAttribute('aTan', new THREE.Float32BufferAttribute(tg, 3));
  kit.addGlass(g);
}

export const TRIM = new THREE.Color(0.92, 0.91, 0.87);

/** a sash window set into a hole: frame, meeting rail, glazing bars, glass, sill, lintel */
export function sashWindow(kit: Kit, F: Frame, h: Hole, floorY: number, seed: number, lit: boolean, trim: THREE.Color, opts: { lintel: string; sill: string; bars: number; lintelColor?: THREE.Color }): void {
  const r = 0.14, ft = 0.065;
  const c0 = -r - 0.02, c1 = -r + 0.05;
  // outer frame
  obox(kit, 'trim', F, h.a0, h.b0, c0, h.a0 + ft, h.b1, c1, trim);
  obox(kit, 'trim', F, h.a1 - ft, h.b0, c0, h.a1, h.b1, c1, trim);
  obox(kit, 'trim', F, h.a0, h.b1 - ft, c0, h.a1, h.b1, c1, trim);
  obox(kit, 'trim', F, h.a0, h.b0, c0, h.a1, h.b0 + ft * 1.4, c1, trim);
  // meeting rail and glazing bars (lower sash slightly proud of the upper)
  const mid = (h.b0 + h.b1) / 2 + 0.05;
  obox(kit, 'trim', F, h.a0, mid - 0.035, c0 - 0.01, h.a1, mid + 0.035, c1 - 0.01, trim);
  const iw = h.a1 - h.a0 - ft * 2;
  for (let k = 1; k < opts.bars; k++) {
    const a = h.a0 + ft + (iw * k) / opts.bars;
    obox(kit, 'trim', F, a - 0.014, h.b0 + ft, c0 - 0.005, a + 0.014, h.b1 - ft, c0 + 0.035, trim);
  }
  if (opts.bars > 1) for (const yy of [(h.b0 + mid) / 2, (mid + h.b1) / 2])
    obox(kit, 'trim', F, h.a0 + ft, yy - 0.014, c0 - 0.005, h.a1 - ft, yy + 0.014, c0 + 0.035, trim);
  glassPane(kit, F, { a0: h.a0 + ft, b0: h.b0 + ft, a1: h.a1 - ft, b1: h.b1 - ft }, c0 + 0.01, floorY, seed, lit);
  // stone sill and lintel
  obox(kit, opts.sill, F, h.a0 - 0.07, h.b0 - 0.08, -r + 0.02, h.a1 + 0.07, h.b0, 0.06);
  obox(kit, opts.lintel, F, h.a0 - 0.09, h.b1, -0.02, h.a1 + 0.09, h.b1 + 0.22, 0.02, opts.lintelColor);
}

/** a panelled front door with fanlight, step, letterbox and knob */
export function frontDoor(kit: Kit, F: Frame, h: Hole, color: THREE.Color, trim: THREE.Color, seed: number, lit: boolean, surround: boolean): void {
  const r = 0.2;
  const leafTop = h.b1 - 0.48;
  obox(kit, 'stone', F, h.a0 - 0.12, 0, -r, h.a1 + 0.12, h.b0, 0.32);
  obox(kit, 'trim', F, h.a0, h.b0, -r - 0.02, h.a0 + 0.07, h.b1, -r + 0.06, trim);
  obox(kit, 'trim', F, h.a1 - 0.07, h.b0, -r - 0.02, h.a1, h.b1, -r + 0.06, trim);
  obox(kit, 'trim', F, h.a0, leafTop, -r - 0.02, h.a1, leafTop + 0.08, -r + 0.06, trim);
  obox(kit, 'trim', F, h.a0, h.b1 - 0.07, -r - 0.02, h.a1, h.b1, -r + 0.06, trim);
  const la = h.a0 + 0.07, lb = h.a1 - 0.07;
  obox(kit, 'paint', F, la, h.b0, -r - 0.05, lb, leafTop, -r, color);
  // four raised panels
  const pw = (lb - la - 0.27) / 2;
  for (const [a, b0, b1] of [[la + 0.09, h.b0 + 0.18, h.b0 + 0.9], [la + 0.18 + pw, h.b0 + 0.18, h.b0 + 0.9], [la + 0.09, h.b0 + 1.08, leafTop - 0.12], [la + 0.18 + pw, h.b0 + 1.08, leafTop - 0.12]] as [number, number, number][])
    obox(kit, 'paint', F, a, b0, -r, a + pw, b1, -r + 0.018, color);
  obox(kit, 'brass', F, la + 0.33, h.b0 + 0.96, -r, lb - 0.33, h.b0 + 1.0, -r + 0.02);
  obox(kit, 'brass', F, lb - 0.13, h.b0 + 1.0, -r, lb - 0.08, h.b0 + 1.06, -r + 0.06);
  glassPane(kit, F, { a0: h.a0 + 0.07, b0: leafTop + 0.08, a1: h.a1 - 0.07, b1: h.b1 - 0.07 }, -r - 0.01, h.b0, seed, lit);
  if (surround) {
    obox(kit, 'trim', F, h.a0 - 0.2, h.b0, 0, h.a0 - 0.04, h.b1 + 0.1, 0.07, trim);
    obox(kit, 'trim', F, h.a1 + 0.04, h.b0, 0, h.a1 + 0.2, h.b1 + 0.1, 0.07, trim);
    obox(kit, 'trim', F, h.a0 - 0.3, h.b1 + 0.1, 0, h.a1 + 0.3, h.b1 + 0.26, 0.42, trim);
    for (const a of [h.a0 - 0.22, h.a1 + 0.12]) obox(kit, 'trim', F, a, h.b1 - 0.25, 0, a + 0.1, h.b1 + 0.1, 0.35, trim);
  }
}

/* ---------- roofs ---------- */
/** half-round gutter along x, open at the top */
export function gutter(kit: Kit, x0: number, x1: number, y: number, z: number): void {
  const g = new THREE.CylinderGeometry(0.065, 0.065, x1 - x0, 8, 1, true, Math.PI, Math.PI);
  g.rotateZ(Math.PI / 2);
  g.translate((x0 + x1) / 2, y, z);
  kit.add('metal', g, new THREE.Color(0.06, 0.065, 0.07));
}
export function downpipe(kit: Kit, x: number, y0: number, y1: number, z: number): void {
  const g = new THREE.CylinderGeometry(0.04, 0.04, y1 - y0, 8);
  g.translate(x, (y0 + y1) / 2, z);
  kit.add('metal', g, new THREE.Color(0.06, 0.065, 0.07));
  const shoe = new THREE.CylinderGeometry(0.045, 0.045, 0.18, 8);
  shoe.rotateX(Math.PI / 3);
  shoe.translate(x, y0 + 0.05, z + 0.06);
  kit.add('metal', shoe, new THREE.Color(0.06, 0.065, 0.07));
}
export function chimney(kit: Kit, wall: string, wallColor: THREE.Color, x: number, z: number, y0: number, top: number, pots: number): void {
  kit.box(wall, x - 0.42, y0, z - 0.32, x + 0.42, top, z + 0.32, wallColor);
  kit.box('stone', x - 0.5, top, z - 0.4, x + 0.5, top + 0.12, z + 0.4);
  for (let i = 0; i < pots; i++) {
    const px = x + (i - (pots - 1) / 2) * 0.3;
    kit.cyl('pot', 0.12, 0.5, 10, new THREE.Matrix4().makeTranslation(px, top + 0.37, z), undefined, false, Math.PI * 2, 0.1);
  }
}

/** dual-pitch roof along x over a W × D footprint (front at z = 0) */
export function gableRoof(kit: Kit, roof: string, W: number, D: number, E: number, pitch: number, vl: number, vr: number, tint: THREE.Color, trim: THREE.Color): number {
  const ov = 0.32, t = Math.tan(pitch);
  const R = E + (D / 2) * t;
  const ye = E - ov * t;
  const x0 = -vl, x1 = W + vr;
  kit.slab(roof, v3(x0, ye, ov), v3(x1, ye, ov), v3(x1, R, -D / 2), v3(x0, R, -D / 2), 0.06, tint);
  kit.slab(roof, v3(x1, ye, -D - ov), v3(x0, ye, -D - ov), v3(x0, R, -D / 2), v3(x1, R, -D / 2), 0.06, tint);
  // ridge tiles
  const ridge = new THREE.CylinderGeometry(0.13, 0.13, x1 - x0, 8, 1, false, 0, Math.PI);
  ridge.rotateZ(Math.PI / 2);
  ridge.translate((x0 + x1) / 2, R - 0.02, -D / 2);
  kit.add(roof === 'clay' ? 'pot' : 'lead', ridge);
  // fascia, soffit, gutters (front and back)
  for (const [z, s] of [[ov, 1], [-D - ov, -1]] as [number, number][]) {
    kit.box('trim', x0, ye - 0.22, z - 0.015 * s - 0.015, x1, ye - 0.02, z + 0.015 * s + 0.015, trim);
    const zw = s > 0 ? 0 : -D;
    kit.quad('trim', v3(x0, ye - 0.2, zw), v3(x1, ye - 0.2, zw), v3(x1, ye - 0.2, z), v3(x0, ye - 0.2, z), v3(0, -1, 0), trim);
    gutter(kit, x0, x1, ye - 0.12, z + s * 0.08);
  }
  return R;
}

/** hipped roof over W × D (front at z = 0), ridge along x */
export function hipRoof(kit: Kit, roof: string, W: number, D: number, E: number, pitch: number, tint: THREE.Color, trim: THREE.Color): number {
  const ov = 0.35, t = Math.tan(pitch);
  const ye = E - ov * t;
  const half = D / 2 + ov;
  const R = ye + half * t;
  const inset = Math.min(half, (W + 2 * ov) / 2 - 0.3);
  const xa = -ov, xb = W + ov, za = ov, zb = -D - ov, zm = -D / 2;
  const r0 = v3(xa + inset, R, zm), r1 = v3(xb - inset, R, zm);
  kit.slab(roof, v3(xa, ye, za), v3(xb, ye, za), r1, r0, 0.06, tint);
  kit.slab(roof, v3(xb, ye, zb), v3(xa, ye, zb), r0, r1, 0.06, tint);
  kit.slab(roof, v3(xb, ye, za), v3(xb, ye, zb), r1, r1.clone(), 0.06, tint);
  kit.slab(roof, v3(xa, ye, zb), v3(xa, ye, za), r0, r0.clone(), 0.06, tint);
  for (const [a, b] of [[v3(xa, ye, za), v3(xb, ye, za)], [v3(xb, ye, zb), v3(xa, ye, zb)]]) {
    kit.box('trim', Math.min(a.x, b.x), ye - 0.22, a.z - 0.03, Math.max(a.x, b.x), ye - 0.02, a.z + 0.03, trim);
    gutter(kit, Math.min(a.x, b.x), Math.max(a.x, b.x), ye - 0.12, a.z + Math.sign(a.z + 0.001) * 0.08);
  }
  for (const x of [xa, xb]) kit.box('trim', x - 0.03, ye - 0.22, zb, x + 0.03, ye - 0.02, za, trim);
  kit.quad('trim', v3(0, ye - 0.2, 0), v3(W, ye - 0.2, 0), v3(W + ov, ye - 0.2, za), v3(-ov, ye - 0.2, za), v3(0, -1, 0), trim);
  return R;
}

/* ---------- buildings ---------- */
export type Wall = 'brickRed' | 'brickBrown' | 'brickYellow' | 'render';
export interface HouseSpec {
  x: number; z: number; rot: number;
  width: number; depth: number; storeys: number;
  wall: Wall; wallTint?: THREE.Color;
  roof: 'clay' | 'slate';
  door: THREE.Color; trim?: THREE.Color;
  seed: number;
  endLeft?: boolean; endRight?: boolean;
  doorSide?: 'left' | 'right';
}

function placement(x: number, z: number, rot: number): THREE.Matrix4 {
  return new THREE.Matrix4().makeRotationY(rot).setPosition(x, 0, z);
}
const rnd = (s: number, k: number): number => TX.hash(s, k, 77);
const isLit = (s: number, k: number): boolean => rnd(s, k) > 0.42;

/** a terraced house; local frame: front facade along +x at z = 0, facing +z */
export function buildHouse(kit: Kit, s: HouseSpec): { door: THREE.Vector3; eaves: number; ridge: number } {
  kit.base = placement(s.x, s.z, s.rot);
  const W = s.width, D = s.depth, gH = 3.05, uH = 2.95;
  const E = 0.3 + gH + uH * (s.storeys - 1);
  const wallKey = s.wall;
  const wc = s.wallTint || WHITE;
  const trim = s.trim || TRIM;
  const brick = s.wall !== 'render';
  const lintel = brick ? 'stone' : 'trim';
  const cols = W >= 7.4 ? 3 : 2;
  const doorCol = (s.doorSide || (rnd(s.seed, 1) > 0.5 ? 'left' : 'right')) === 'left' ? 0 : cols - 1;
  const colX = (i: number): number => (W * (i + 0.5)) / cols;
  const plinthKey = brick ? 'brickBrown' : 'render';
  const plinthC = brick ? new THREE.Color(0.55, 0.5, 0.48) : new THREE.Color(0.42, 0.42, 0.42);
  const bars = 2;

  const facades: { F: Frame; len: number; front: boolean }[] = [
    { F: new Frame(v3(0, 0, 0), v3(1, 0, 0), v3(0, 0, 1)), len: W, front: true },
    { F: new Frame(v3(W, 0, -D), v3(-1, 0, 0), v3(0, 0, -1)), len: W, front: false },
  ];
  let doorPos = new THREE.Vector3();
  for (const { F, len, front } of facades) {
    const holes: Hole[] = [];
    const wins: { h: Hole; floorY: number; k: number }[] = [];
    let door: Hole | null = null;
    for (let i = 0; i < cols; i++) {
      const cx = front ? colX(i) : len - colX(i);
      if (front && i === doorCol) {
        door = { a0: cx - 0.55, b0: 0.3, a1: cx + 0.55, b1: 2.75 };
        holes.push(door);
      } else {
        const ww = cols === 2 ? 1.25 : 1.05;
        const h = { a0: cx - ww / 2, b0: 1.1, a1: cx + ww / 2, b1: 2.75 };
        holes.push(h);
        wins.push({ h, floorY: 0.3, k: i });
      }
      for (let f = 1; f < s.storeys; f++) {
        const y0 = 0.3 + gH + (f - 1) * uH;
        const ww = cols === 2 ? 1.15 : 1.0;
        const h = { a0: cx - ww / 2, b0: y0 + 0.85, a1: cx + ww / 2, b1: y0 + 0.85 + 1.4 - (f > 1 ? 0.15 : 0) };
        holes.push(h);
        wins.push({ h, floorY: y0, k: i + f * 7 });
      }
    }
    wallFace(kit, wallKey, F, 0, 0.45, len, E, holes, wc);
    // plinth band, broken by the door
    const spans: [number, number][] = door ? [[0, door.a0 - 0.12], [door.a1 + 0.12, len]] : [[0, len]];
    for (const [a, b] of spans) if (b - a > 0.05) obox(kit, plinthKey, F, a, 0, -0.02, b, 0.45, 0.04, plinthC);
    if (door) {
      obox(kit, wallKey, F, door.a0, 0, -0.02, door.a1, 0.3, 0.0, wc);
      frontDoor(kit, F, door, s.door, trim, s.seed, isLit(s.seed, 99), brick && rnd(s.seed, 3) > 0.4);
      doorPos = F.p((door.a0 + door.a1) / 2, 0, 0.6);
    }
    for (const w of wins) sashWindow(kit, F, w.h, w.floorY, s.seed * 13 + w.k + (front ? 0 : 50), isLit(s.seed, w.k + (front ? 0 : 50)), trim, { lintel, sill: 'stone', bars, lintelColor: undefined });
    // string course between floors on brick houses
    if (brick) for (let f = 1; f < s.storeys; f++) {
      const y = 0.3 + gH + (f - 1) * uH;
      obox(kit, 'stone', F, 0, y - 0.12, -0.01, len, y + 0.02, 0.035);
    }
  }
  // end-of-terrace gables
  const t = Math.tan((38 * Math.PI) / 180);
  const R = E + (D / 2) * t;
  // side walls on every house: blind where a neighbour abuts, so a taller neighbour never shows a gap
  for (const [end, F] of [[s.endLeft, new Frame(v3(0, 0, -D), v3(0, 0, 1), v3(-1, 0, 0))], [s.endRight, new Frame(v3(W, 0, 0), v3(0, 0, -1), v3(1, 0, 0))]] as [boolean | undefined, Frame][]) {
    const holes: Hole[] = [];
    if (end && s.storeys > 1) holes.push({ a0: D / 2 - 0.45, b0: 0.3 + gH + 0.95, a1: D / 2 + 0.45, b1: 0.3 + gH + 2.0 });
    wallFace(kit, wallKey, F, 0, 0.45, D, E, holes, wc);
    obox(kit, plinthKey, F, 0, 0, -0.02, D, 0.45, 0.04, plinthC);
    kit.tri(wallKey, F.p(0, E), F.p(D, E), F.p(D / 2, R), F.n, wc);
    for (const h of holes) sashWindow(kit, F, h, 0.3 + gH, s.seed * 31 + 5, isLit(s.seed, 61), trim, { lintel, sill: 'stone', bars: 1 });
  }
  const roofTint = new THREE.Color().setHSL(0, 0, 0.85 + rnd(s.seed, 5) * 0.25);
  gableRoof(kit, s.roof, W, D, E, (38 * Math.PI) / 180, s.endLeft ? 0.25 : 0, s.endRight ? 0.25 : 0, roofTint, trim);
  // party-wall parapet with a chimney stack on it
  if (!s.endLeft) {
    const pw = 0.13;
    kit.slab(wallKey, v3(-pw, E + 0.16, 0.05), v3(pw, E + 0.16, 0.05), v3(pw, R + 0.16, -D / 2), v3(-pw, R + 0.16, -D / 2), 0.5, wc);
    kit.slab(wallKey, v3(pw, E + 0.16, -D - 0.05), v3(-pw, E + 0.16, -D - 0.05), v3(-pw, R + 0.16, -D / 2), v3(pw, R + 0.16, -D / 2), 0.5, wc);
  }
  chimney(kit, brick ? wallKey : 'brickBrown', brick ? wc : WHITE, s.endLeft ? 0.7 : 0, -D / 2, R - 0.6, R + 1.25, 2 + (s.seed % 2));
  const dpX = doorCol === 0 ? W - 0.12 : 0.12;
  downpipe(kit, dpX, 0, E - 0.15, 0.12);
  downpipe(kit, W - dpX, 0, E - 0.15, -D - 0.12);
  return { door: doorPos.applyMatrix4(kit.base), eaves: E, ridge: R };
}

export interface ShopSpec {
  x: number; z: number; rot: number;
  width: number; depth: number; storeys: number;
  kind: 'shop' | 'pub';
  name: string;
  fascia: THREE.Color; signBg: string; signFg: string;
  awning?: [string, string];
  upperWall: Wall; upperTint?: THREE.Color;
  seed: number;
  /** a corner building wraps its shopfront round this side too */
  sideFront?: 'left' | 'right';
}

/** a corner shop or pub: shopfront on the ground floor, flats above, hipped slate roof */
export function buildShop(kit: Kit, s: ShopSpec): { door: THREE.Vector3; awning: THREE.Object3D[] } {
  kit.base = placement(s.x, s.z, s.rot);
  const pal = kit.pal;
  const W = s.width, D = s.depth, gH = 3.9, uH = 2.85;
  const E = gH + uH * (s.storeys - 1);
  const wc = s.upperTint || WHITE;
  const kindN = s.kind === 'pub' ? 2 : 1;
  const sign = pal.custom(`sign:${s.name}`, () => TX.signTex(s.name, s.signBg, s.signFg, true), { roughness: 0.35 });
  const out: THREE.Object3D[] = [];
  let doorPos = new THREE.Vector3();

  const fr = [
    { F: new Frame(v3(0, 0, 0), v3(1, 0, 0), v3(0, 0, 1)), len: W, shop: true },
    { F: new Frame(v3(0, 0, -D), v3(0, 0, 1), v3(-1, 0, 0)), len: D, shop: s.sideFront === 'left' },
    { F: new Frame(v3(W, 0, -D), v3(-1, 0, 0), v3(0, 0, -1)), len: W, shop: false },
    { F: new Frame(v3(W, 0, 0), v3(0, 0, -1), v3(1, 0, 0)), len: D, shop: s.sideFront === 'right' },
  ];
  fr.forEach(({ F, len, shop }, fi) => {
    // upper floors
    const holes: Hole[] = [];
    const n = Math.max(2, Math.round(len / 2.6));
    const wins: { h: Hole; fy: number; k: number }[] = [];
    for (let f = 1; f < s.storeys; f++)
      for (let i = 0; i < n; i++) {
        const cx = (len * (i + 0.5)) / n, y0 = gH + (f - 1) * uH;
        const h = { a0: cx - 0.55, b0: y0 + 0.8, a1: cx + 0.55, b1: y0 + 2.3 };
        holes.push(h);
        wins.push({ h, fy: y0, k: fi * 40 + f * 9 + i });
      }
    wallFace(kit, s.upperWall, F, 0, gH, len, E, holes, wc);
    for (const w of wins) sashWindow(kit, F, w.h, w.fy, s.seed * 17 + w.k, isLit(s.seed, w.k), TRIM, { lintel: s.upperWall === 'render' ? 'trim' : 'stone', sill: 'stone', bars: 2 });
    obox(kit, 'stone', F, -0.05, gH - 0.05, -0.01, len + 0.05, gH + 0.1, 0.06);

    if (!shop) {
      // plain ground floor with a couple of windows
      const gh: Hole[] = [];
      for (let i = 0; i < n; i++) gh.push({ a0: (len * (i + 0.5)) / n - 0.55, b0: 1.1, a1: (len * (i + 0.5)) / n + 0.55, b1: 2.9 });
      wallFace(kit, s.upperWall, F, 0, 0, len, gH, gh, wc);
      gh.forEach((h, i) => sashWindow(kit, F, h, 0.1, s.seed * 7 + fi * 5 + i, isLit(s.seed, fi * 5 + i + 200), TRIM, { lintel: 'stone', sill: 'stone', bars: 2 }));
      return;
    }
    // shopfront: pilasters, stall riser, big glazing with transoms, recessed door, fascia + sign, cornice
    const P = 0.35;
    obox(kit, 'paint', F, -0.05, 0, -0.05, P, gH - 0.05, 0.12, s.fascia);
    obox(kit, 'paint', F, len - P, 0, -0.05, len + 0.05, gH - 0.05, 0.12, s.fascia);
    for (const a of [-0.1, len - P - 0.05]) obox(kit, 'paint', F, a, gH - 0.95, -0.05, a + P + 0.15, gH - 0.6, 0.2, s.fascia);
    const fy0 = gH - 0.95, fy1 = gH - 0.25;
    obox(kit, 'paint', F, P, fy0, -0.03, len - P, fy1, 0.1, s.fascia);
    kit.quad(sign, F.p(P + 0.15, fy0 + 0.08, 0.102), F.p(len - P - 0.15, fy0 + 0.08, 0.102), F.p(len - P - 0.15, fy1 - 0.08, 0.102), F.p(P + 0.15, fy1 - 0.08, 0.102), F.n, WHITE, [0, 0, 1, 0, 1, 1, 0, 1]);
    obox(kit, 'paint', F, P - 0.08, fy1, -0.03, len - P + 0.08, fy1 + 0.12, 0.22, s.fascia);
    obox(kit, 'paint', F, P - 0.12, fy1 + 0.12, -0.03, len - P + 0.12, fy1 + 0.2, 0.28, s.fascia);
    // the wall behind the shopfront (above the glazing, inside the fascia)
    const doorW = 1.1;
    const doorA = fi === 0 ? len * 0.5 - doorW / 2 : -10;
    const segs: [number, number][] = fi === 0 ? [[P, doorA], [doorA + doorW, len - P]] : [[P, len - P]];
    obox(kit, 'paint', F, P, 0, -0.25, len - P, 0.55, 0.0, s.fascia);
    for (const [a0, a1] of segs) {
      if (a1 - a0 < 0.3) continue;
      const panes = Math.max(1, Math.round((a1 - a0) / 1.6));
      const pw = (a1 - a0) / panes;
      for (let k = 0; k < panes; k++) {
        const pa = a0 + k * pw, pb = pa + pw;
        obox(kit, 'paint', F, pa, 0.55, -0.12, pa + 0.06, fy0, 0.0, s.fascia);
        obox(kit, 'paint', F, pb - 0.06, 0.55, -0.12, pb, fy0, 0.0, s.fascia);
        obox(kit, 'paint', F, pa, fy0 - 0.5, -0.12, pb, fy0 - 0.44, 0.0, s.fascia);
        glassPane(kit, F, { a0: pa + 0.06, b0: 0.55, a1: pb - 0.06, b1: fy0 - 0.5 }, -0.08, 0.1, s.seed + fi * 11 + k, true, kindN);
        glassPane(kit, F, { a0: pa + 0.06, b0: fy0 - 0.44, a1: pb - 0.06, b1: fy0 }, -0.08, 0.1, s.seed + fi * 11 + k + 5, true, kindN);
      }
    }
    if (fi === 0) {
      const d: Hole = { a0: doorA, b0: 0, a1: doorA + doorW, b1: fy0 };
      // recessed lobby with a glazed door
      kit.quad('stone', F.p(d.a0, 0.02, 0), F.p(d.a1, 0.02, 0), F.p(d.a1, 0.02, -0.9), F.p(d.a0, 0.02, -0.9), v3(0, 1, 0));
      for (const [a, nn] of [[d.a0, F.u], [d.a1, F.u.clone().negate()]] as [number, V3][])
        kit.quad('paint', F.p(a, 0, 0), F.p(a, 0, -0.9), F.p(a, fy0, -0.9), F.p(a, fy0, 0), nn, s.fascia);
      kit.quad('paint', F.p(d.a0, fy0, 0), F.p(d.a1, fy0, 0), F.p(d.a1, fy0, -0.9), F.p(d.a0, fy0, -0.9), v3(0, -1, 0), s.fascia);
      obox(kit, 'paint', F, d.a0, 0, -0.95, d.a1, fy0, -0.9, s.fascia);
      obox(kit, 'paint', F, d.a0 + 0.08, 0.05, -0.9, d.a1 - 0.08, 2.3, -0.86, s.fascia);
      glassPane(kit, F, { a0: d.a0 + 0.2, b0: 0.9, a1: d.a1 - 0.2, b1: 2.15 }, -0.855, 0.05, s.seed + 3, true, kindN);
      obox(kit, 'brass', F, d.a1 - 0.25, 1.0, -0.86, d.a1 - 0.2, 1.4, -0.82);
      doorPos = F.p((d.a0 + d.a1) / 2, 0, 0.8);
    }
    // awning, rolled out over the pavement
    if (s.awning) {
      const [aw0, aw1] = s.awning;
      const ak = pal.custom(`awn:${s.awning.join()}`, () => TX.awningCanvas(aw0, aw1), { roughness: 0.85, side: THREE.DoubleSide });
      const a0 = P, a1 = len - P, y0 = fy0 - 0.05, y1 = fy0 - 0.75, depth = 1.7;
      const rep = (a1 - a0) / 2;
      kit.quad(ak, F.p(a0, y0, 0.12), F.p(a1, y0, 0.12), F.p(a1, y1, depth), F.p(a0, y1, depth), v3(0, 1, 0).add(F.n.clone().multiplyScalar(0.4)), WHITE, [0, 0, rep, 0, rep, 1, 0, 1]);
      kit.quad(ak, F.p(a0, y1, depth), F.p(a1, y1, depth), F.p(a1, y1 - 0.28, depth), F.p(a0, y1 - 0.28, depth), F.n, WHITE, [0, 0, rep, 0, rep, 0.3, 0, 0.3]);
      for (const a of [a0, a1]) kit.rod('metal', F.p(a, y0 - 0.5, 0.05), F.p(a, y1, depth - 0.02), 0.018, new THREE.Color(0.1, 0.1, 0.1));
    }
  });
  hipRoof(kit, 'slate', W, D, E, (32 * Math.PI) / 180, new THREE.Color(1, 1, 1), TRIM);
  chimney(kit, 'brickBrown', WHITE, W * 0.3, -D * 0.5, E, E + 3.1, 3);
  for (const [x, z] of [[W - 0.1, 0.12], [-0.12, -D + 0.1]]) downpipe(kit, x, 0, E - 0.2, z);
  // pubs hang a painted sign on a wrought bracket
  if (s.kind === 'pub') {
    const F = fr[0].F;
    const ax = W - 0.5;
    obox(kit, 'metal', F, ax - 0.03, gH + 0.4, 0, ax + 0.03, gH + 0.46, 1.2, new THREE.Color(0.05, 0.05, 0.05));
    const board = pal.custom(`board:${s.name}`, () => TX.signTex(s.name.split(' ').slice(-1)[0], '#1d2a1e', '#e8d9a0', true), { roughness: 0.4, side: THREE.DoubleSide });
    for (const side of [1, -1]) {
      const c = 0.6;
      const p0 = F.p(ax + side * 0.035, gH - 0.7, c - 0.45), p1 = F.p(ax + side * 0.035, gH - 0.7, c + 0.45);
      const p2 = F.p(ax + side * 0.035, gH + 0.3, c + 0.45), p3 = F.p(ax + side * 0.035, gH + 0.3, c - 0.45);
      kit.quad(board, p0, p1, p2, p3, F.u.clone().multiplyScalar(side), WHITE, side > 0 ? [0, 0, 1, 0, 1, 1, 0, 1] : [1, 0, 0, 0, 0, 1, 1, 1]);
    }
    obox(kit, 'paint', F, ax - 0.03, gH - 0.75, 0.1, ax + 0.03, gH + 0.35, 1.1, s.fascia);
  }
  return { door: doorPos.applyMatrix4(kit.base), awning: out };
}

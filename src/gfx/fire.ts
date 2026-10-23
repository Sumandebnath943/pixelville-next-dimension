/* ============================================================
   Fire and smoke, simulated on the GPU. Each frame the game
   lists emitters (a burning building, a factory stack); every
   particle's life is a pure function of time and its seed, so
   there is no per-particle CPU work. Flames are additive tongues
   that flicker and narrow as they rise, with embers lifting
   above them; smoke billows, darkens over fires, widens and
   leans with the wind, lit by the sky and, near its base, by
   the flames.
   ============================================================ */
import * as THREE from 'three';
import { GLSL_COMMON, bindEnv, ENV } from './env';
import { LAYER_NO_REFLECT } from './pipeline';

const MAXE = 24;

const VERT = /* glsl */ `
${GLSL_COMMON}
attribute vec4 aSeed;
attribute float aEmit;
uniform vec4 uPos[${MAXE}];   // x, y, z, size (0 = off)
uniform vec4 uShape[${MAXE}]; // footprint w, d, height, kind (0 fire, 1 light smoke, 2 dark smoke)
uniform float uSmoke;         // 1 for the smoke mesh, 0 for flames
varying vec2 vQ;
varying float vLife;
varying float vKind;
varying float vEmber;
varying vec3 vWPos;
void main() {
  int e = int(aEmit);
  vec4 P = uPos[e];
  vec4 S = uShape[e];
  vKind = S.w;
  bool off = P.w <= 0.0 || (uSmoke < 0.5 && S.w > 0.5);
  float rate = uSmoke > 0.5 ? 0.09 + aSeed.w * 0.05 : 0.8 + aSeed.w * 0.7;
  float life = fract(uTime * rate + aSeed.x);
  vLife = life;
  vEmber = (uSmoke < 0.5 && aSeed.w > 0.82) ? 1.0 : 0.0;
  vec3 wind = vec3(uWindDir.x, 0.0, uWindDir.y) * (0.6 + uWind * 3.0);
  vec3 c = P.xyz + vec3((aSeed.y - 0.5) * S.x, 0.0, (aSeed.z - 0.5) * S.y);
  float size;
  if (uSmoke > 0.5) {
    float rise = S.z * (0.4 + aSeed.w * 0.6);
    c.y += life * rise;
    c += wind * life * life * rise * 0.35;
    c.xz += vec2(sin(uTime * 0.3 + aSeed.y * 20.0), cos(uTime * 0.27 + aSeed.z * 20.0)) * life * 2.0;
    size = P.w * (0.6 + life * (S.w > 1.5 ? 3.4 : 2.2));
  } else if (vEmber > 0.5) {
    c.y += life * S.z * 2.5;
    c += wind * life * 3.0;
    c.xz += vec2(sin(uTime * 3.0 + aSeed.y * 40.0), cos(uTime * 2.7 + aSeed.z * 40.0)) * 0.6 * life;
    size = 0.09 + aSeed.y * 0.06;
  } else {
    c.y += life * S.z * (0.7 + aSeed.w * 0.5);
    c += wind * life * life * 0.8;
    size = P.w * (1.0 - life * 0.75) * (0.55 + aSeed.z * 0.7);
  }
  if (off) size = 0.0;
  vec3 toCam = normalize(cameraPosition - c);
  vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
  vec3 up = normalize(cross(toCam, side));
  float stretch = uSmoke > 0.5 || vEmber > 0.5 ? 1.0 : 2.4;
  vec3 p = c + side * position.x * size + up * (position.y * size * stretch + size * stretch * 0.3);
  vQ = position.xy * 2.0;
  vWPos = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const FRAG = /* glsl */ `
${GLSL_COMMON}
uniform float uSmoke;
uniform vec3 uLight;
varying vec2 vQ;
varying float vLife;
varying float vKind;
varying float vEmber;
varying vec3 vWPos;
void main() {
  float r = length(vQ);
  if (r > 1.0) discard;
  if (uSmoke > 0.5) {
    // billowing puffs: soft edges broken by noise
    float n = pvFbm(vQ * 1.8 + vec2(vLife * 3.0, vLife * 1.7) + vWPos.xz * 0.05);
    float a = smoothstep(1.0, 0.25, r + (n - 0.5) * 0.7);
    float dark = vKind > 1.5 ? 0.16 : 0.62;
    vec3 col = uLight * mix(dark, dark * 1.25, n);
    // embers glow through the base of the smoke column
    col += vec3(1.0, 0.45, 0.12) * (vKind > 1.5 ? 1.0 : 0.0) * smoothstep(0.3, 0.0, vLife) * 1.4;
    a *= smoothstep(0.0, 0.08, vLife) * (1.0 - smoothstep(0.55, 1.0, vLife)) * (vKind > 1.5 ? 0.75 : 0.45);
    col = pvFog(col, vWPos);
    gl_FragColor = vec4(col, a);
    return;
  }
  if (vEmber > 0.5) {
    float a = smoothstep(1.0, 0.0, r) * (1.0 - vLife);
    gl_FragColor = vec4(vec3(1.0, 0.55, 0.15) * 6.0 * a, a);
    return;
  }
  // a flame tongue: narrower at the top, ragged with noise, white-yellow core to deep orange
  vec2 q = vQ;
  float n = pvFbm(vec2(q.x * 2.6, q.y * 1.6 - uTime * 3.5) + vWPos.xz);
  // narrower towards the tip, torn at the edges
  float shape = 1.0 - length(vec2(q.x * (1.3 + max(q.y, 0.0) * 1.4), q.y)) - (q.y * 0.25) + (n - 0.5) * 1.1;
  float a = smoothstep(0.0, 0.45, shape) * (1.0 - smoothstep(0.65, 1.0, vLife));
  vec3 hot = mix(vec3(1.0, 0.85, 0.5), vec3(1.0, 0.35, 0.05), smoothstep(0.1, 0.7, vLife));
  hot = mix(hot, vec3(0.6, 0.08, 0.02), smoothstep(0.6, 1.0, vLife));
  gl_FragColor = vec4(hot * (2.0 + smoothstep(0.3, 0.9, shape) * 5.0) * a, a);
}`;

class Layer {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  constructor(scene: THREE.Scene, perEmitter: number, smoke: boolean, pos: THREE.Vector4[], shape: THREE.Vector4[], light: THREE.Color) {
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    const n = MAXE * perEmitter;
    const seeds = new Float32Array(n * 4), emit = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 4; k++) seeds[i * 4 + k] = Math.random();
      emit[i] = i % MAXE;
    }
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    geo.setAttribute('aEmit', new THREE.InstancedBufferAttribute(emit, 1));
    geo.instanceCount = n;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uPos: { value: pos }, uShape: { value: shape }, uSmoke: { value: smoke ? 1 : 0 }, uLight: { value: light } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: smoke ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    bindEnv(this.mat.uniforms);
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = smoke ? 6 : 7;
    this.mesh.layers.set(LAYER_NO_REFLECT);
    scene.add(this.mesh);
  }
}

export class FireFX {
  private pos = Array.from({ length: MAXE }, () => new THREE.Vector4());
  private shape = Array.from({ length: MAXE }, () => new THREE.Vector4());
  private n = 0;
  private flames: Layer;
  private smoke: Layer;
  private light = new THREE.Color();
  constructor(scene: THREE.Scene) {
    this.flames = new Layer(scene, 48, false, this.pos, this.shape, this.light);
    this.smoke = new Layer(scene, 36, true, this.pos, this.shape, this.light);
  }
  begin(): void {
    this.n = 0;
  }
  /** a burning area: flames over a footprint, embers, and a dark column of smoke */
  fire(x: number, y: number, z: number, w: number, d: number, height: number, strength = 1): void {
    // flames through the roof, more bursting from the lower windows, and the smoke column
    this.add(x, y + height * 0.35, z, 1.0 * strength, w, d, Math.max(3, height * 0.45), 0);
    this.add(x, Math.max(0.5, y - height * 0.25), z, 0.7 * strength, w * 1.05, d * 1.05, 2.4, 0);
    this.add(x, y + height * 0.55, z, 2.2 * strength, w * 0.8, d * 0.8, 26, 2);
  }
  /** a working chimney or stack: a thin pale plume */
  plume(x: number, y: number, z: number, size = 1): void {
    this.add(x, y, z, 1.1 * size, 0.6, 0.6, 18, 1);
  }
  private add(x: number, y: number, z: number, size: number, w: number, d: number, h: number, kind: number): void {
    if (this.n >= MAXE) return;
    this.pos[this.n].set(x, y, z, size);
    this.shape[this.n].set(w, d, h, kind);
    this.n++;
  }
  end(ambient: number): void {
    for (let i = this.n; i < MAXE; i++) this.pos[i].w = 0;
    // smoke is lit like a grey object out in the open
    this.light.setRGB(1, 1, 1).multiplyScalar(ambient / Math.PI * 0.9 + 0.004).add(ENV.fogAway.value.clone().multiplyScalar(0.25));
    this.flames.mesh.visible = this.smoke.mesh.visible = this.n > 0;
  }
}

/* ============================================================
   Water: surfaces shaped by Gerstner waves that grow with the
   wind, drifting detail ripples along the current, rain rings,
   Fresnel-weighted planar reflection, sun glitter, foam along
   the shore, and a murky body colour lit by the sky. Every
   water mesh at one level shares a WaterSystem (one mirror, one
   wave set); the same wave sum runs on the CPU, so boats and
   ducks float, pitch and roll on the waves the camera sees.
   Meshes carry `aShore`: metres from this point to dry land.
   ============================================================ */
import * as THREE from 'three';
import { ENV, GLSL_COMMON, bindEnv } from './env';
import { waterNormals } from './textures';
import { PlanarReflection } from './pipeline';

const NW = 4;
const _vp = new THREE.Matrix4(), _fr = new THREE.Frustum(), _c4 = new THREE.Vector4();
export interface Wave { dir: THREE.Vector2; length: number; amp: number; steep: number }

const VERT = /* glsl */ `
${GLSL_COMMON}
uniform vec4 uWaves[${NW}];   // dir.xy, wavelength, amplitude
uniform float uSteep;
uniform float uMinLen;
attribute float aShore;
attribute vec2 aFlow;
varying vec3 vWPos;
varying vec3 vNrm;
varying float vShore;
varying vec2 vFlow;
void main() {
  vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
  vShore = aShore;
  vFlow = aFlow;
  // waves die down in the shallows (V2 (Milestone 8): and far away, where the mesh is coarse and the normal
  // maps carry the detail)
  float calm = smoothstep(0.0, 6.0, aShore);
  float near = 1.0 - smoothstep(260.0, 520.0, length(p.xz - cameraPosition.xz));
  vec3 disp = vec3(0.0);
  vec3 n = vec3(0.0, 1.0, 0.0);
  for (int i = 0; i < ${NW}; i++) {
    vec2 d = uWaves[i].xy;
    // (V2 (Milestone 8): a wave shorter than the mesh can carry would make its vertices hop about: those are left
    // to the normal maps)
    float L = uWaves[i].z, A = uWaves[i].w * (0.3 + 0.7 * calm) * near * smoothstep(uMinLen, uMinLen * 1.6, L);
    float k = 6.2831853 / L;
    float c = sqrt(9.8 / k);
    float f = k * (dot(d, p.xz) - c * uTime) + float(i) * 1.7;
    float cf = cos(f), sf = sin(f);
    disp.x += uSteep * A * d.x * cf;
    disp.z += uSteep * A * d.y * cf;
    disp.y += A * sf;
    n.x -= d.x * k * A * cf;
    n.z -= d.y * k * A * cf;
    n.y -= uSteep * k * A * sf;
  }
  p += disp;
  vWPos = p;
  vNrm = normalize(n);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const FRAG = /* glsl */ `
${GLSL_COMMON}
uniform sampler2D uNormals;
uniform sampler2D uRefl;
uniform mat4 uReflMat;
uniform float uReflOn;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform float uAmbient;
uniform vec2 uFlowDir;
uniform float uFlow;
uniform float uIce;
varying vec3 vWPos;
varying vec3 vNrm;
varying float vShore;
varying vec2 vFlow;

vec2 ripple(vec2 p, float t) {
  vec2 acc = vec2(0.0);
  for (int k = 0; k < 2; k++) {
    vec2 q = p * (1.6 + float(k) * 1.3) + float(k) * 5.1;
    vec2 cell = floor(q), f = fract(q);
    for (int j = -1; j <= 1; j++)
      for (int i = -1; i <= 1; i++) {
        vec2 c = cell + vec2(float(i), float(j));
        vec2 h = pvHash22(c + float(k) * 9.0);
        vec2 dv = (vec2(float(i), float(j)) + h) - f;
        float ph = fract(t * (0.7 + h.x * 0.6) + h.y);
        float x = length(dv) - ph * 0.9;
        acc += sin(x * 30.0) * smoothstep(0.12, 0.0, abs(x)) * (1.0 - ph) * (1.0 - ph) * normalize(dv + 1e-4);
      }
  }
  return acc;
}

void main() {
  vec3 V = normalize(cameraPosition - vWPos);
  float dist = length(cameraPosition - vWPos);
  // V2 (Milestone 8): the current carries the ripples downstream along the river's own course (a flow map, two
  // phases cross-faded so the pattern never stretches), slow in the lakes, still at sea; the wind ruffles on top
  vec2 fl = (vFlow + uFlowDir * 0.04) * uFlow;
  float ph0 = fract(uTime * 0.16), ph1 = fract(uTime * 0.16 + 0.5);
  vec2 base = vWPos.xz * 0.11;
  vec3 nA = texture2D(uNormals, base - fl * ph0 * 2.2).xzy * 2.0 - 1.0;
  vec3 nB = texture2D(uNormals, base - fl * ph1 * 2.2 + vec2(0.5, 0.31)).xzy * 2.0 - 1.0;
  vec3 n1 = mix(nA, nB, abs(ph0 - 0.5) * 2.0);
  vec2 uv2 = vWPos.xz * 0.29 + uWindDir * uTime * (0.02 + uWind * 0.06) + vec2(0.37, 0.71);
  vec3 n2 = texture2D(uNormals, uv2).xzy * 2.0 - 1.0;
  float detail = (0.25 + uWind * 0.9) / (1.0 + dist * 0.012) * (1.0 - uIce);
  vec3 N = normalize(vNrm + vec3(n1.x + n2.x, 0.0, n1.z + n2.z) * detail);
  if (uRain > 0.01 && uIce < 0.5) {
    vec2 r = ripple(vWPos.xz, uTime) * uRain * 0.6 / (1.0 + dist * 0.03);
    N = normalize(N + vec3(-r.x, 0.0, -r.y));
  }
  float NV = max(dot(N, V), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - NV, 5.0);

  vec3 refl = uFogAway;
  if (uReflOn > 0.5) {
    vec4 rp = uReflMat * vec4(vWPos, 1.0);
    vec2 ruv = rp.xy / rp.w + N.xz * 0.045;
    refl = texture2D(uRefl, clamp(ruv, 0.002, 0.998)).rgb;
  }
  float sunUp = max(uSunDir.y, 0.0);
  vec3 light = vec3(uAmbient) + uSunColor * sunUp * 0.12;
  vec3 body = mix(uShallow, uDeep, smoothstep(0.0, 7.0, vShore)) * light;
  body += uSunColor * uShallow * pow(max(0.0, dot(-V, uSunDir)), 4.0) * 0.2;

  vec3 col = mix(body, refl, F);
  float nh = max(dot(N, normalize(V + uSunDir)), 0.0);
  float spec = pow(nh, 1400.0) * 2.2 + pow(nh, 160.0) * 0.05;
  col += uSunColor * spec * (1.0 - uRain * 0.7) * smoothstep(0.0, 0.08, uSunDir.y) * (1.0 - uIce * 0.8);
  // foam where small waves break on the shore
  float fn = pvFbm(vWPos.xz * vec2(0.9, 1.4) - vFlow * uTime * 0.6 + vec2(0.0, uTime * 0.05));
  float foam = smoothstep(1.4, 0.0, vShore) * smoothstep(0.42, 0.72, fn + (0.12 + uWind * 0.3)) * (1.0 - uIce);
  col = mix(col, light * vec3(0.75, 0.78, 0.8) + uSunColor * sunUp * 0.06, foam * 0.6);
  // winter: a skin of ice, white where snow has settled on it (V2: it forms out from the banks and thaws back to them
  // the other way, the open water opening along the shore first and the rest breaking into floes; thin, late ice
  // goes dark and wet before it's gone)
  if (uIce > 0.01) {
    float floe = pvFbm(vWPos.xz * 0.05 + 5.0) * 0.6 + pvNoise(vWPos.xz * 0.32 + 2.0) * 0.4;
    float last = smoothstep(1.0, 14.0, vShore) * 0.5 + floe * 0.7;
    float th = mix(1.12, -0.05, uIce);
    float iceK = smoothstep(th - 0.012, th + 0.012, last);
    float thin = 1.0 - smoothstep(th, th + 0.18, last);
    vec3 ice = light * mix(vec3(0.55, 0.62, 0.66), vec3(0.88, 0.9, 0.94), smoothstep(0.35, 0.75, pvFbm(vWPos.xz * 0.12)) * smoothstep(0.1, 0.5, uSnow));
    ice = mix(ice, light * vec3(0.3, 0.36, 0.38), thin * 0.7);
    col = mix(col, mix(ice, refl, F * (0.5 + thin * 0.4)), iceK);
  }
  col = pvFog(col, vWPos);
  gl_FragColor = vec4(col, 1.0);
}`;

export class WaterSystem {
  material: THREE.ShaderMaterial;
  reflection: PlanarReflection;
  waves: Wave[] = [];
  meshes: THREE.Mesh[] = [];
  flowDir = new THREE.Vector2(1, 0);
  private wavesU: THREE.Vector4[];
  private mirrored = false;
  /** world-space boxes the water occupies (for the on-screen test) */
  bounds: THREE.Box3[] = [];

  /** V2 (Milestone 8): the shortest wave (m) the meshes can carry (about twice their vertex spacing) */
  minLen = 0;
  constructor(public level: number, reflScale = 0.5, minLen = 0) {
    this.minLen = minLen;
    this.wavesU = Array.from({ length: NW }, () => new THREE.Vector4());
    this.reflection = new PlanarReflection(level, reflScale);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uWaves: { value: this.wavesU },
        uSteep: { value: 0.6 },
        uMinLen: { value: 0 },
        uFlow: { value: 0.6 },
        uFlowDir: { value: this.flowDir },
        uNormals: { value: waterNormals() },
        uRefl: { value: this.reflection.rt.texture },
        uReflMat: { value: this.reflection.textureMatrix },
        uReflOn: { value: 1 },
        uDeep: { value: new THREE.Color(0.012, 0.035, 0.03) },
        uShallow: { value: new THREE.Color(0.05, 0.085, 0.06) },
        uAmbient: { value: 1 },
        uIce: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
    });
    bindEnv(this.material.uniforms);
    this.material.uniforms.uMinLen.value = minLen;
    this.setWind();
  }

  add(mesh: THREE.Mesh): void {
    mesh.material = this.material;
    if (!mesh.geometry.getAttribute('aFlow')) mesh.geometry.setAttribute('aFlow', new THREE.BufferAttribute(new Float32Array(mesh.geometry.getAttribute('position').count * 2), 2));
    mesh.receiveShadow = false;
    this.meshes.push(mesh);
    mesh.geometry.computeBoundingBox();
    this.bounds.push(mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld).expandByScalar(1));
  }
  remove(mesh: THREE.Mesh): void {
    const i = this.meshes.indexOf(mesh);
    if (i >= 0) { this.meshes.splice(i, 1); this.bounds.splice(i, 1); }
  }
  /** move the whole surface (a drought lowers it) */
  setLevel(y: number): void {
    const dy = y - this.level;
    if (Math.abs(dy) < 1e-4) return;
    this.level = y;
    this.reflection.y = y;
    for (const m of this.meshes) m.position.y += dy;
    for (const b of this.bounds) b.translate(new THREE.Vector3(0, dy, 0));
  }

  /** wave set follows the current wind: calm water is glassy, a gale chops it up */
  private setWind(): void {
    const wd = ENV.windDir.value;
    const w = ENV.wind.value;
    const base = Math.atan2(wd.y, wd.x);
    // (V2 (Milestone 8): two long, low swells the coarse town water can carry, and two short chops for fine meshes)
    const spec: [number, number, number][] = [[0, 21, 0.07], [0.6, 12.5, 0.045], [-0.6, 3.1, 0.03], [1.1, 1.6, 0.014]];
    this.waves = spec.map(([da, L, a]) => ({
      dir: new THREE.Vector2(Math.cos(base + da), Math.sin(base + da)),
      length: L * (0.7 + w * 0.6),
      amp: a * (0.15 + w * 1.6),
      steep: 0.6,
    }));
    this.waves.forEach((v, i) => this.wavesU[i].set(v.dir.x, v.dir.y, v.length, v.amp));
  }

  private mirrorOn = true;
  /** V2: about how much of the screen the water's boxes cover (0 … 1; all of it when one reaches behind the eye) */
  private coverage(): number {
    let sum = 0;
    for (const b of this.bounds) {
      if (!_fr.intersectsBox(b)) continue;
      let x0 = 1, y0 = 1, x1 = -1, y1 = -1;
      for (let i = 0; i < 8; i++) {
        _c4.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z, 1).applyMatrix4(_vp);
        if (_c4.w <= 0.01) return 1;
        const x = _c4.x / _c4.w, y = _c4.y / _c4.w;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      sum += (Math.max(0, Math.min(1, x1) - Math.max(-1, x0)) * Math.max(0, Math.min(1, y1) - Math.max(-1, y0))) / 4;
      if (sum >= 1) return 1;
    }
    return sum;
  }

  /** surface height at a point (CPU twin of the vertex shader, open water) */
  height(x: number, z: number): number {
    const t = ENV.time.value;
    let y = this.level;
    const m = this.minLen;
    this.waves.forEach((v, i) => {
      const k = (2 * Math.PI) / v.length;
      const c = Math.sqrt(9.8 / k);
      const keep = m <= 0 ? 1 : THREE.MathUtils.smoothstep(v.length, m, m * 1.6);
      y += v.amp * keep * Math.sin(k * (v.dir.x * x + v.dir.y * z - c * t) + i * 1.7);
    });
    return y;
  }

  update(renderer: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.PerspectiveCamera, ambient: number, reflect = true, ice = 0): void {
    this.setWind();
    const u = this.material.uniforms;
    u.uAmbient.value = (ambient / Math.PI) * 0.6;
    u.uReflOn.value = this.reflection.enabled ? 1 : 0;
    u.uIce.value = ice;
    _vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    _fr.setFromProjectionMatrix(_vp);
    const vis = this.bounds.some((b) => _fr.intersectsBox(b));
    for (const m of this.meshes) m.visible = vis;
    if (!vis) { this.mirrored = false; return; }
    // V2: the mirror is a second drawing of the whole scene (up to half the frame from the Planner); a pond in a corner
    // of the view, or the sea as a sliver on the horizon, gets the sky's colour instead (frozen water needs none)
    const cover = ice > 0.98 ? 0 : this.coverage();
    this.mirrorOn = cover > (this.mirrorOn ? 0.025 : 0.045);
    u.uReflOn.value = this.reflection.enabled && this.mirrorOn ? 1 : 0;
    if (!this.mirrorOn) { this.mirrored = false; return; }
    if (reflect || !this.mirrored) {
      this.mirrored = true;
      for (const m of this.meshes) m.visible = false;
      this.reflection.update(renderer, scene, cam);
      for (const m of this.meshes) m.visible = true;
    }
  }
}

/** a straight river channel (the slice) */
export class River extends WaterSystem {
  mesh: THREE.Mesh;
  constructor(scene: THREE.Scene, public x0: number, public x1: number, public z0: number, public z1: number, level: number) {
    super(level, 0.5);
    const w = x1 - x0, d = z1 - z0;
    const geo = new THREE.PlaneGeometry(w, d, Math.ceil(w / 1.2), Math.ceil(d / 0.8));
    geo.rotateX(-Math.PI / 2);
    geo.translate((x0 + x1) / 2, level, (z0 + z1) / 2);
    const p = geo.attributes.position;
    const shore = new Float32Array(p.count);
    for (let i = 0; i < p.count; i++) shore[i] = Math.min(Math.abs(p.getZ(i) - z0), Math.abs(p.getZ(i) - (z1 - 2.5)));
    geo.setAttribute('aShore', new THREE.BufferAttribute(shore, 1));
    const flow = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) flow[i * 2] = 0.5;
    geo.setAttribute('aFlow', new THREE.BufferAttribute(flow, 2));
    this.mesh = new THREE.Mesh(geo, this.material);
    scene.add(this.mesh);
    this.add(this.mesh);
  }
}

/* ---------- floating bodies ---------- */
export class Floater {
  y = 0;
  vy = 0;
  pitch = 0;
  roll = 0;
  constructor(public obj: THREE.Object3D, private water: WaterSystem, private length: number, private beam: number, private draft: number) {
    this.y = water.level;
  }
  update(dt: number): void {
    const o = this.obj;
    const yaw = o.rotation.y;
    const fx = (Math.sin(yaw) * this.length) / 2, fz = (Math.cos(yaw) * this.length) / 2;
    const sx = (Math.cos(yaw) * this.beam) / 2, sz = (-Math.sin(yaw) * this.beam) / 2;
    const w = this.water;
    const hb = w.height(o.position.x + fx, o.position.z + fz), hs = w.height(o.position.x - fx, o.position.z - fz);
    const hp = w.height(o.position.x + sx, o.position.z + sz), hq = w.height(o.position.x - sx, o.position.z - sz);
    const target = (hb + hs + hp + hq) / 4 - this.draft;
    // a damped spring towards the buoyant equilibrium
    this.vy += ((target - this.y) * 28 - this.vy * 4.5) * dt;
    this.y += this.vy * dt;
    const tp = Math.atan2(hs - hb, this.length), tr = Math.atan2(hp - hq, this.beam);
    this.pitch += (tp - this.pitch) * Math.min(1, dt * 3);
    this.roll += (tr - this.roll) * Math.min(1, dt * 3);
    o.position.y = this.y;
    o.rotation.set(this.pitch, yaw, this.roll, 'YXZ');
  }
}

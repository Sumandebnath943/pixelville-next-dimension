/* ============================================================
   Sky: a Preetham daylight sky (adapted from three.js' Sky,
   MIT) with drifting clouds, overcast greying, horizon haze
   that matches the scene fog, stars and a moon. The same model
   runs on the CPU so the sun's colour, the fog, the ground
   bounce and auto-exposure all agree with what the sky shows.
   The sky is also captured into a PMREM so every PBR material
   is lit and reflects it.
   ============================================================ */
import * as THREE from 'three';
import { ENV } from './env';

/* ---------- CPU Preetham (mirrors the shader) ---------- */
const TOTAL_RAYLEIGH = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
const MIE_CONST = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
const CUTOFF = 1.6110731556870734, STEEP = 1.5, EE = 1000;

export interface SkyParams { turbidity: number; rayleigh: number; mie: number; mieG: number }

function sunIntensity(zc: number): number {
  zc = Math.max(-1, Math.min(1, zc));
  return EE * Math.max(0, 1 - Math.exp(-((CUTOFF - Math.acos(zc)) / STEEP)));
}
function betas(p: SkyParams): { bR: number[]; bM: number[] } {
  const c = 0.2 * p.turbidity * 10e-18;
  return {
    bR: TOTAL_RAYLEIGH.map((v) => v * p.rayleigh),
    bM: MIE_CONST.map((v) => 0.434 * c * v * p.mie),
  };
}
/** transmittance of the atmosphere along a view direction */
function extinction(dirY: number, bR: number[], bM: number[]): number[] {
  const zen = Math.acos(Math.max(0, dirY));
  const inv = 1 / (Math.cos(zen) + 0.15 * Math.pow(93.885 - (zen * 180) / Math.PI, -1.253));
  return [0, 1, 2].map((i) => Math.exp(-(bR[i] * 8.4e3 * inv + bM[i] * 1.25e3 * inv)));
}
/** clear-sky radiance in direction `d` (same units as the shader) */
export function skyRadiance(d: THREE.Vector3, sun: THREE.Vector3, p: SkyParams, out: THREE.Color): THREE.Color {
  const { bR, bM } = betas(p);
  const Fex = extinction(d.y, bR, bM);
  const cosT = d.dot(sun);
  const rPhase = (3 / (16 * Math.PI)) * (1 + Math.pow(cosT * 0.5 + 0.5, 2));
  const g2 = p.mieG * p.mieG;
  const mPhase = (1 / (4 * Math.PI)) * ((1 - g2) / Math.pow(1 - 2 * p.mieG * cosT + g2, 1.5));
  const sunE = sunIntensity(sun.y);
  const k = Math.min(1, Math.max(0, Math.pow(1 - sun.y, 5)));
  const c = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const ratio = (bR[i] * rPhase + bM[i] * mPhase) / (bR[i] + bM[i]);
    let lin = Math.pow(sunE * ratio * (1 - Fex[i]), 1.5);
    lin *= 1 + (Math.pow(sunE * ratio * Fex[i], 0.5) - 1) * k;
    c[i] = (lin + 0.1 * Fex[i]) * 0.04;
  }
  c[1] += 0.0003;
  c[2] += 0.00075;
  return out.setRGB(c[0], c[1], c[2]);
}
/** direct sunlight colour reaching the ground, 0..~1 per channel */
export function sunTransmittance(sun: THREE.Vector3, p: SkyParams, out: THREE.Color): THREE.Color {
  const { bR, bM } = betas(p);
  const Fex = extinction(sun.y, bR, bM);
  const e = sunIntensity(sun.y) / 658;
  return out.setRGB(Fex[0] * e, Fex[1] * e, Fex[2] * e);
}

/* ---------- shader ---------- */
const SKY_VERT = /* glsl */ `
uniform vec3 sunDir;
uniform float rayleigh;
uniform float turbidity;
uniform float mieCoefficient;
varying vec3 vWorldPosition;
varying vec3 vBetaR;
varying vec3 vBetaM;
varying float vSunE;
const float e = 2.718281828459045;
const vec3 totalRayleigh = vec3(5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5);
const vec3 MieConst = vec3(1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14);
const float cutoffAngle = 1.6110731556870734;
const float steepness = 1.5;
const float EE = 1000.0;
float sunIntensity(float zc) {
  zc = clamp(zc, -1.0, 1.0);
  return EE * max(0.0, 1.0 - pow(e, -((cutoffAngle - acos(zc)) / steepness)));
}
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPosition = wp.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position.z = gl_Position.w;
  vSunE = sunIntensity(sunDir.y);
  vBetaR = totalRayleigh * rayleigh;
  float c = (0.2 * turbidity) * 10E-18;
  vBetaM = 0.434 * c * MieConst * mieCoefficient;
}`;

const SKY_FRAG = /* glsl */ `
varying vec3 vWorldPosition;
varying vec3 vBetaR;
varying vec3 vBetaM;
varying float vSunE;
uniform vec3 sunDir;
uniform vec3 moonDir;
uniform float mieDirectionalG;
uniform float cloudCoverage;
uniform float cloudDensity;
uniform float overcast;
uniform float night;
uniform float showSun;
uniform float stars;
uniform float time;
uniform vec3 groundColor;
uniform vec3 fogAway;
uniform vec3 fogSun;
uniform float haze;
uniform vec2 windDir;
uniform float wind;
uniform float skyCap;

const float pi = 3.141592653589793;
const float rayleighZenithLength = 8.4E3;
const float mieZenithLength = 1.25E3;
const float sunAngularDiameterCos = 0.99996;

float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 grad(vec2 i) { vec3 p = fract(i.xyx * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yzx + 33.33); return fract((p.xx + p.yz) * p.zy) * 2.0 - 1.0; }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(dot(grad(i), f), dot(grad(i + vec2(1, 0)), f - vec2(1, 0)), u.x),
             mix(dot(grad(i + vec2(0, 1)), f - vec2(0, 1)), dot(grad(i + vec2(1, 1)), f - vec2(1, 1)), u.x), u.y) * 1.6;
}
/* V2: noise on the sky's sphere, from the three planes weighted by how squarely each faces the direction: noise of
   one plane alone (dir.xz) stretched into streaks fanning up from the horizon */
float sphereNoise(vec3 d, float k) {
  vec3 w = pow(abs(d), vec3(4.0));
  w /= w.x + w.y + w.z;
  return w.x * noise(d.yz * k) + w.y * noise(d.xz * k) + w.z * noise(d.xy * k);
}
float fbm(vec2 p, float drift) {
  float r = 0.0, a = 1.0;
  for (int i = 0; i < 5; i++) { r += a * noise(p); a *= 0.5; p = p * 2.03 + drift; }
  return r;
}
float rayleighPhase(float c) { return 0.05968310365946075 * (1.0 + c * c); }
float hgPhase(float c, float g) { float g2 = g * g; return 0.07957747154594767 * ((1.0 - g2) / pow(1.0 - 2.0 * g * c + g2, 1.5)); }

void main() {
  vec3 dir = normalize(vWorldPosition - cameraPosition);
  float dy = max(0.0, dir.y);
  // (how big a pixel is in the star grid: worked out here, outside any branch, where derivatives are defined)
  vec3 starW = fwidth(dir * 260.0);
  float starPx = starW.x + starW.y + starW.z;
  float zen = acos(dy);
  float inv = 1.0 / (cos(zen) + 0.15 * pow(93.885 - ((zen * 180.0) / pi), -1.253));
  vec3 Fex = exp(-(vBetaR * rayleighZenithLength * inv + vBetaM * mieZenithLength * inv));
  float cosT = dot(dir, sunDir);
  vec3 bRT = vBetaR * rayleighPhase(cosT * 0.5 + 0.5);
  vec3 bMT = vBetaM * hgPhase(cosT, mieDirectionalG);
  vec3 Lin = pow(vSunE * ((bRT + bMT) / (vBetaR + vBetaM)) * (1.0 - Fex), vec3(1.5));
  Lin *= mix(vec3(1.0), pow(vSunE * ((bRT + bMT) / (vBetaR + vBetaM)) * Fex, vec3(0.5)), clamp(pow(1.0 - sunDir.y, 5.0), 0.0, 1.0));
  vec3 col = (Lin + vec3(0.1) * Fex) * 0.04 + vec3(0.0, 0.0003, 0.00075);

  // night: moonlit blue and stars
  float moonUp = smoothstep(-0.05, 0.2, moonDir.y);
  col += night * (vec3(0.0018, 0.0032, 0.0072) * (0.4 + 0.6 * moonUp) * (1.0 - 0.5 * overcast));
  if (stars > 0.0 && dir.y > 0.0) {
    vec3 p = dir * 260.0;
    vec3 c = floor(p);
    float h = h12(c.xy + c.z * 37.0);
    if (h > 0.985) {
      vec3 off = vec3(h12(c.yz), h12(c.zx), h12(c.xy + 3.0)) - 0.5;
      float d = length(fract(p) - 0.5 - off * 0.5);
      float tw = 0.65 + 0.35 * sin(time * (1.5 + h * 4.0) + h * 80.0);
      float mag = pow((h - 0.985) / 0.015, 3.0);
      vec3 tint = mix(vec3(1.0, 0.85, 0.7), vec3(0.75, 0.85, 1.0), h12(c.xz));
      // (V2: never smaller than a pixel or so, with the light kept the same: sub-pixel stars flickered as the view moved)
      float rad = max(0.32, starPx * 0.9);
      col += tint * smoothstep(rad, 0.0, d) * (0.32 * 0.32) / (rad * rad) * (0.04 + mag * 0.5) * tw * stars * Fex;
    }
    // faint milky band
    float band = exp(-pow(dot(dir, normalize(vec3(0.3, 0.2, 1.0))) * 3.5, 2.0));
    col += stars * vec3(0.004, 0.0045, 0.006) * band * (0.5 + 0.5 * sphereNoise(dir, 40.0));
  }
  // moon disc with maria, and its halo (V2: the discs are added last, over the sky's glow, behind the clouds)
  vec3 discs = vec3(0.0);
  float cm = dot(dir, moonDir);
  if (moonDir.y > -0.1) {
    float disc = smoothstep(0.99988, 0.99991, cm);
    vec2 mp = (dir - moonDir * cm).xy * 900.0;
    float maria = 0.75 + 0.25 * noise(mp * 0.25 + 3.0);
    discs += disc * vec3(0.85, 0.86, 0.82) * maria * 0.9 * night * (1.0 - overcast * 0.9);
    col += vec3(0.08, 0.1, 0.14) * pow(max(cm, 0.0), 900.0) * night * (1.0 - overcast * 0.6) * 0.25;
  }
  // sun disc
  float sund = smoothstep(sunAngularDiameterCos, sunAngularDiameterCos + 0.00002, cosT) * showSun * (1.0 - overcast);
  discs += sund * min(vSunE * Fex * 0.5, vec3(30.0));

  // clouds: two layers projected onto a dome, lit from the sky itself
  float cloudA = 0.0;
  if (dir.y > 0.0 && cloudCoverage > 0.0) {
    vec2 drift = windDir * time * (0.002 + wind * 0.006);
    vec2 uv = dir.xz / (dir.y * 0.55 + 0.08);
    float n = clamp(fbm(uv * 0.55 + drift, time * 0.004) * 0.7 + 0.5, 0.0, 1.0);
    float region = noise(uv * 0.12 + drift * 0.3) * 0.37 + 0.5;
    float cov = clamp(cloudCoverage + (region - 0.5) * 0.55, 0.0, 1.0);
    float th = 1.0 - cov;
    float depth = max(0.0, n - th);
    float horizonFade = smoothstep(0.0, 0.08, dir.y);
    float alpha = (1.0 - exp(-depth * cloudDensity * 14.0)) * horizonFade;
    float day = smoothstep(-0.08, 0.3, sunDir.y);
    vec3 sunC = vSunE * Fex * 0.0088 * (1.0 - overcast * 0.85);
    vec3 amb = Lin * 0.04 + vec3(0.0, 0.0003, 0.00075);
    float beer = exp(-depth * 4.0);
    float shade = mix(0.42, 1.0, clamp(beer * (1.0 - beer * beer) * 2.6, 0.0, 1.0));
    float silver = clamp(0.51 / pow(1.49 - cosT * 1.4, 1.5), 0.0, 3.0);
    float edge = (1.0 - smoothstep(0.0, 0.25, depth));
    vec3 cc = amb * 1.4 + sunC * shade + sunC * silver * edge * 0.5;
    cc = mix(cc, vec3(dot(cc, vec3(0.3, 0.55, 0.15))) * 0.85, overcast * 0.6);
    cc *= max(day, 0.0);
    cc += night * vec3(0.0016, 0.0022, 0.0035) * (0.4 + moonUp);
    col = mix(col, mix(col, cc, Fex), alpha);
    cloudA = alpha * Fex.g;
  }

  // overcast greys and flattens the whole dome
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  vec3 grey = vec3(lum) * vec3(0.93, 0.97, 1.03);
  col = mix(col, grey * mix(1.0, 0.75, overcast), overcast);

  // haze near the horizon, matched to the scene fog
  float sunK = pow(max(0.0, dot(normalize(vec3(dir.x, 0.0, dir.z)), normalize(vec3(sunDir.x, 0.0, sunDir.z)))), 3.0);
  vec3 fc = mix(fogAway, fogSun, sunK);
  float hz = haze * exp(-dy * 7.0);
  col = mix(col, fc, hz);
  // V2: around a low sun the sky's glow was many times brighter than white at any exposure the street could be seen
  // by (more so under cloud, which greyed it but didn't dim it): a wide patch of sky burnt out white and bloomed
  // over everything at dawn. It eases off short of white now (skyCap: set from the exposure, only round a low sun),
  // keeping its colour; the sun and moon themselves still shine past it
  float pk = max(max(col.r, col.g), col.b), knee = skyCap * 0.6;
  if (pk > knee) col *= (knee + (pk - knee) / (1.0 + (pk - knee) / (skyCap - knee))) / pk;
  col += discs * (1.0 - cloudA) * (1.0 - hz);
  if (dir.y < 0.0) col = mix(fc, groundColor, smoothstep(0.0, -0.08, dir.y));

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function makeSkyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      sunDir: ENV.sunDir,
      moonDir: { value: new THREE.Vector3(0, -1, 0) },
      rayleigh: { value: 1.2 },
      turbidity: { value: 2.5 },
      mieCoefficient: { value: 0.005 },
      mieDirectionalG: { value: 0.8 },
      cloudCoverage: { value: 0.3 },
      cloudDensity: { value: 0.5 },
      overcast: { value: 0 },
      night: { value: 0 },
      showSun: { value: 1 },
      stars: { value: 0 },
      time: ENV.time,
      groundColor: { value: new THREE.Color(0.05, 0.06, 0.04) },
      fogAway: ENV.fogAway,
      fogSun: ENV.fogSun,
      haze: { value: 0.3 },
      windDir: ENV.windDir,
      wind: ENV.wind,
      skyCap: { value: 1e6 },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
  });
}

/* ---------- the sky system ---------- */
export interface Weatherish {
  /** 0 clear … 1 fully overcast */
  overcast: number;
  /** cloud fraction 0..1 */
  clouds: number;
  /** haze / fog visibility factor 1 = clear */
  fog: number;
  /** settled snow 0..1 (brightens the ground bounce) */
  snow: number;
}

const _d = new THREE.Vector3();
const _view = new THREE.Vector3();
const _c = new THREE.Color();
const _c2 = new THREE.Color();
const _c3 = new THREE.Color();

export class SkySystem {
  mesh: THREE.Mesh;
  private envScene = new THREE.Scene();
  private envMesh: THREE.Mesh;
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private lastEnvKey = '';
  private envTimer = 0;
  sun: THREE.DirectionalLight;
  params: SkyParams = { turbidity: 2.5, rayleigh: 1.2, mie: 0.005, mieG: 0.8 };
  /** suggested exposure for the current light */
  exposure = 0.15;
  /** 0 when the sun is up, 1 in full night */
  nightK = 0;
  sunAbove = true;
  lightDir = new THREE.Vector3();
  moonDir = new THREE.Vector3();
  /** ambient level outside, used by interiors and auto exposure */
  ambient = 1;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, shadowSize: number) {
    const mat = makeSkyMaterial();
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
    this.mesh.scale.setScalar(9000);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    scene.add(this.mesh);
    const envMat = mat.clone();
    // share every uniform object, but never show the sun disc or stars in reflections
    envMat.uniforms = { ...mat.uniforms, showSun: { value: 0 }, stars: { value: 0 } };
    this.envMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), envMat);
    this.envMesh.scale.setScalar(50);
    this.envScene.add(this.envMesh);
    this.pmrem = new THREE.PMREMGenerator(renderer);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = shadowSize > 0;
    this.sun.shadow.mapSize.set(shadowSize || 1024, shadowSize || 1024);
    const sc = this.sun.shadow.camera;
    sc.left = -90; sc.right = 90; sc.top = 90; sc.bottom = -90; sc.near = 1; sc.far = 700;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 2.5;
    scene.add(this.sun, this.sun.target);
  }

  get uniforms(): Record<string, THREE.IUniform> {
    return (this.mesh.material as THREE.ShaderMaterial).uniforms;
  }

  /** solar position for a mid-latitude town: hour 0..24, day of year 0..365 */
  static sunAt(hour: number, dayOfYear: number, out: THREE.Vector3): THREE.Vector3 {
    const lat = (46 * Math.PI) / 180;
    const decl = ((-23.44 * Math.PI) / 180) * Math.cos(((2 * Math.PI) / 365) * (dayOfYear + 10));
    const H = ((hour - 12) * 15 * Math.PI) / 180;
    const up = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H);
    const east = -Math.cos(decl) * Math.sin(H);
    const north = Math.cos(lat) * Math.sin(decl) - Math.sin(lat) * Math.cos(decl) * Math.cos(H);
    return out.set(east, up, -north).normalize();
  }

  update(dt: number, hour: number, dayOfYear: number, w: Weatherish, focus: THREE.Vector3, camera: THREE.Camera): void {
    const u = this.uniforms;
    const sunDir = SkySystem.sunAt(hour, dayOfYear, ENV.sunDir.value);
    const moon = SkySystem.sunAt((hour + 12.6) % 24, (dayOfYear + 182) % 365, this.moonDir);
    moon.x += 0.15;
    moon.normalize();
    (u.moonDir.value as THREE.Vector3).copy(moon);

    // haze and turbidity rise with cloud and precipitation; V2 (Milestone 8): and with a low sun the long path
    // through the air scatters more (more Rayleigh, a little more haze): the dawn and dusk sky turns gold and rose
    // around the sun instead of a white glare
    const low = 1 - THREE.MathUtils.smoothstep(sunDir.y, 0.02, 0.35);
    this.params.turbidity = 2.2 + w.overcast * 6 + (1 - w.fog) * 3 + low * 2.4;
    this.params.rayleigh = 1.1 + w.overcast * 1.2 + low * 1.6;
    u.turbidity.value = this.params.turbidity;
    u.rayleigh.value = this.params.rayleigh;
    u.cloudCoverage.value = w.clouds;
    u.cloudDensity.value = 0.45 + w.overcast * 0.5;
    u.overcast.value = w.overcast;

    const night = 1 - THREE.MathUtils.smoothstep(sunDir.y, -0.12, 0.04);
    this.nightK = night;
    u.night.value = night;
    u.stars.value = Math.max(0, night - 0.2) * (1 - w.overcast) * (1 - w.clouds * 0.6);
    ENV.night.value = night;

    // direct light: the sun, or the moon once the sun has set
    const sunT = sunTransmittance(sunDir, this.params, _c);
    const cloudBlock = 1 - w.overcast * 0.88 - w.clouds * 0.15;
    this.sunAbove = sunDir.y > -0.02;
    if (this.sunAbove) {
      this.lightDir.copy(sunDir);
      if (this.lightDir.y < 0.04) this.lightDir.y = 0.04;
      this.sun.color.copy(sunT).multiplyScalar(1 / Math.max(0.001, Math.max(sunT.r, sunT.g, sunT.b)));
      this.sun.intensity = 30 * Math.max(sunT.r, sunT.g, sunT.b) * Math.max(0.04, cloudBlock);
    } else {
      this.lightDir.copy(moon);
      if (this.lightDir.y < 0.08) this.lightDir.y = 0.08;
      this.sun.color.setRGB(0.62, 0.74, 1.0);
      this.sun.intensity = 0.09 * THREE.MathUtils.smoothstep(moon.y, -0.05, 0.2) * Math.max(0.15, 1 - w.overcast * 0.85);
    }
    ENV.sunColor.value.copy(this.sun.color).multiplyScalar(this.sunAbove ? this.sun.intensity : this.sun.intensity * 3);
    this.lightDir.normalize();

    // shadow frustum follows the focus, snapped to texels to stop shimmering
    // (held still on frames whose shadow map isn't redrawn, so shadows never slide)
    if (!this.holdShadow) this.placeShadow(focus);
    this.fogAndBounce(dt, sunDir, moon, w, night, camera);
  }

  holdShadow = false;
  private placeShadow(focus: THREE.Vector3): void {
    const sc = this.sun.shadow.camera;
    const texel = (sc.right - sc.left) / this.sun.shadow.mapSize.x;
    const lp = _d.copy(this.lightDir);
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), lp.clone().negate(), new THREE.Vector3(0, 1, 0));
    const inv = m.clone().invert();
    const f = focus.clone().applyMatrix4(inv);
    f.x = Math.round(f.x / texel) * texel;
    f.y = Math.round(f.y / texel) * texel;
    f.applyMatrix4(m);
    this.sun.target.position.copy(f);
    this.sun.position.copy(f).addScaledVector(this.lightDir, 350);
    this.sun.target.updateMatrixWorld();
  }

  private fogAndBounce(dt: number, sunDir: THREE.Vector3, moon: THREE.Vector3, w: Weatherish, night: number, camera: THREE.Camera): void {
    const u = this.uniforms;
    // fog colours = the sky at the horizon, towards and away from the sun
    const flat = _d.set(sunDir.x, 0, sunDir.z);
    if (flat.lengthSq() < 1e-6) flat.set(1, 0, 0);
    flat.normalize();
    // sample beside the sun, not into its glare: haze is brighter that way, never white
    const side = new THREE.Vector3(-flat.z, 0, flat.x);
    const towards = new THREE.Vector3().addScaledVector(flat, 0.7).addScaledVector(side, 0.7).setY(0.05).normalize();
    const away = new THREE.Vector3(-flat.x, 0.05, -flat.z).normalize();
    const fs = skyRadiance(towards, sunDir, this.params, _c);
    const fa = skyRadiance(away, sunDir, this.params, _c2);
    const la = fa.r * 0.2126 + fa.g * 0.7152 + fa.b * 0.0722, ls = fs.r * 0.2126 + fs.g * 0.7152 + fs.b * 0.0722;
    if (ls > la * 1.6) fs.multiplyScalar((la * 1.6) / ls);
    const nightAdd = new THREE.Color(0.0018, 0.0032, 0.0072).multiplyScalar(night * (1 - 0.5 * w.overcast));
    const grey = (c: THREE.Color): THREE.Color => {
      const l = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
      return c.lerp(new THREE.Color(l * 0.93, l * 0.97, l * 1.03).multiplyScalar(0.62), w.overcast);
    };
    ENV.fogAway.value.copy(grey(fa.add(nightAdd)));
    // under cloud the sun's glow is gone: the haze is the same grey all round
    ENV.fogSun.value.copy(grey(fs.add(nightAdd))).lerp(ENV.fogAway.value, w.overcast);
    ENV.fogDensity.value = 0.0009 + (1 - w.fog) * 0.0055 + w.overcast * 0.0006;
    u.haze.value = Math.min(1, 0.25 + (1 - w.fog) * 1.6 + w.overcast * 0.3);

    // ground bounce colour for reflections below the horizon
    // sky light = the dome the scene is actually lit by (zenith and horizon, greyed by cloud)
    const zen = grey(skyRadiance(_d.set(0, 1, 0), sunDir, this.params, new THREE.Color()));
    const lum = (c: THREE.Color): number => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
    const skyIrr = (lum(zen) * 0.45 + (lum(ENV.fogAway.value) + lum(ENV.fogSun.value)) * 0.275) * Math.PI + night * 0.01;
    const sunIrr = this.sunAbove ? this.sun.intensity * Math.max(0, sunDir.y) : this.sun.intensity * Math.max(0, moon.y);
    const albedo = new THREE.Color(0.11, 0.13, 0.08).lerp(new THREE.Color(0.75, 0.78, 0.82), w.snow);
    (u.groundColor.value as THREE.Color).copy(albedo).multiplyScalar((sunIrr + skyIrr) / Math.PI);

    // exposure targets the light actually falling on the street
    this.ambient = sunIrr + skyIrr;
    // V2 (Milestone 8): …and, like an eye or a camera, what's in view: looking into a low sun the bright sky
    // around it pulls the exposure down (metering the street alone opened right up at dawn, when the street is
    // dim, and the whole sunrise burnt out to white). A quarter weight on the view keeps the street readable.
    camera.getWorldDirection(_view);
    _view.y = THREE.MathUtils.clamp(_view.y, 0.06, 1);
    _view.normalize();
    const seen = skyRadiance(_view, sunDir, this.params, _c3);
    const viewLum = (seen.r * 0.2126 + seen.g * 0.7152 + seen.b * 0.0722) * (1 - w.overcast * 0.7) * 8 * (1 - night);
    const meter = viewLum > this.ambient ? Math.pow(this.ambient + 0.02, 0.75) * Math.pow(viewLum, 0.25) : this.ambient + 0.02;
    // incident metering, a touch lower under heavy cloud so grey days stay grey
    const target = THREE.MathUtils.clamp((1.15 * (1 - w.overcast * 0.22)) / Math.pow(meter, 0.82), 0.04, 9);
    // adapt in log space like an eye; big jumps (scrubbing the clock) settle quickly
    const lr = Math.log(target / this.exposure);
    const rate = Math.abs(lr) > 1.2 ? 8 : 2;
    this.exposure *= Math.exp(lr * Math.min(1, dt * rate));
    // V2: the brightest the sky's glow may be, a little short of white at this exposure (and under the bloom's
    // threshold), round a low sun (the sun high in the sky keeps its glare)
    u.skyCap.value = THREE.MathUtils.lerp(1.4, 60, THREE.MathUtils.smoothstep(sunDir.y, 0.25, 0.5)) / this.exposure;
    ENV.interiorDay.value = Math.min(1, this.ambient * 0.012);

    this.mesh.position.copy(camera.position);

    // refresh the reflection environment when the light changes noticeably
    this.envTimer -= dt;
    const key = [sunDir.x, sunDir.y, sunDir.z].map((v) => v.toFixed(2)).join() + '|' + w.overcast.toFixed(2) + w.clouds.toFixed(2) + w.snow.toFixed(1) + w.fog.toFixed(2);
    if (key !== this.lastEnvKey && this.envTimer <= 0) {
      this.lastEnvKey = key;
      this.envTimer = 0.25;
      this.refreshEnv();
    }
  }

  envTexture: THREE.Texture | null = null;
  private refreshEnv(): void {
    const old = this.envRT;
    this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 100, { size: 128 });
    this.envTexture = this.envRT.texture;
    if (old) old.dispose();
  }
}

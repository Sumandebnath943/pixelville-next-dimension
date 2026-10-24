/* ============================================================
   Environment state shared by every V2 shader: clock, wind,
   weather surfaces (wetness, snow cover), sun & fog colours and
   the planar reflection used by wet streets. One object of
   uniforms, mutated once per frame by the sky / weather code.
   ============================================================ */
import * as THREE from 'three';

export const ENV = {
  /** seconds since start, for animation */
  time: { value: 0 },
  /** normalised horizontal wind direction (x, z) */
  windDir: { value: new THREE.Vector2(0.8, 0.6).normalize() },
  /** 0 calm … 1 gale */
  wind: { value: 0.35 },
  /** settled snow cover, 0 … 1 */
  snow: { value: 0 },
  /** surface wetness, 0 … 1 */
  wet: { value: 0 },
  /** rain falling right now, 0 … 1 (ripples) */
  rain: { value: 0 },
  /** 0 day … 1 deep night */
  night: { value: 0 },
  /** direction towards the sun (world) */
  sunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2).normalize() },
  /** sun radiance colour × intensity (linear) */
  sunColor: { value: new THREE.Color(1, 1, 1) },
  /** fog colour looking away from / towards the sun, density, height falloff */
  fogAway: { value: new THREE.Color(0.6, 0.7, 0.85) },
  fogSun: { value: new THREE.Color(0.8, 0.75, 0.7) },
  fogDensity: { value: 0.0016 },
  fogHeight: { value: 0.004 },
  /** ambient brightness inside rooms seen through windows (day) */
  interiorDay: { value: 0.12 },
  /** planar reflection of the ground plane (wet streets) */
  reflTex: { value: null as THREE.Texture | null },
  reflMat: { value: new THREE.Matrix4() },
  reflOn: { value: 0 },
  /** traffic-wear mask: R = cleared by wheels/feet, G = piled snow (kerbs) */
  wearTex: { value: null as THREE.Texture | null },
  wearRect: { value: new THREE.Vector4(-200, -200, 1 / 400, 1 / 400) },
  /** V2 (Milestone 4): one texel per map tile, 1 where the power is on (blackouts turn lit windows,
      signs and lanterns off); the map is 256 tiles of 8 m. Lit everywhere until the game says otherwise. */
  power: { value: powerTexture() as THREE.Texture },
};

function powerTexture(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array(256 * 256).fill(255), 256, 256, THREE.RedFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/** GLSL shared by every patched shader: noise, fog, wind */
export const GLSL_COMMON = /* glsl */ `
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWind;
uniform float uSnow;
uniform float uWet;
uniform float uRain;
uniform float uNight;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uFogAway;
uniform vec3 uFogSun;
uniform float uFogDensity;
uniform float uFogHeight;
uniform sampler2D uPower;

/* 1 where the power is on (the map is 256 tiles of 8 m; off the map it's always on) */
float pvPower(vec3 wp) {
  vec2 uv = wp.xz / 2048.0;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 1.0;
  return texture2D(uPower, uv).r;
}

float pvHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 pvHash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float pvNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(pvHash12(i), pvHash12(i + vec2(1.0, 0.0)), u.x),
             mix(pvHash12(i + vec2(0.0, 1.0)), pvHash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float pvFbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * pvNoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
/* gusts: slow waves of wind rolling across the land along the wind direction */
float pvGust(vec2 wp) {
  float along = dot(wp, uWindDir);
  float g = pvNoise(vec2(along * 0.045 - uTime * (0.35 + uWind * 0.9), dot(wp, vec2(-uWindDir.y, uWindDir.x)) * 0.03));
  return 0.35 + 0.65 * g;
}
/* aerial perspective: exponential height fog, warmer towards the sun */
vec3 pvFog(vec3 col, vec3 wpos) {
  vec3 d = wpos - cameraPosition;
  float dist = length(d);
  vec3 v = d / max(dist, 1e-3);
  float h = max(0.0, wpos.y) * uFogHeight;
  float dens = uFogDensity * exp(-h);
  float f = 1.0 - exp(-dist * dens);
  float sunK = pow(max(0.0, dot(v, normalize(vec3(uSunDir.x, 0.0, uSunDir.z)))), 3.0);
  vec3 fc = mix(uFogAway, uFogSun, sunK);
  return mix(col, fc, clamp(f, 0.0, 1.0));
}
`;

/** bind the shared uniforms into a shader's uniform table */
export function bindEnv(u: Record<string, THREE.IUniform>): void {
  u.uTime = ENV.time;
  u.uWindDir = ENV.windDir;
  u.uWind = ENV.wind;
  u.uSnow = ENV.snow;
  u.uWet = ENV.wet;
  u.uRain = ENV.rain;
  u.uNight = ENV.night;
  u.uSunDir = ENV.sunDir;
  u.uSunColor = ENV.sunColor;
  u.uFogAway = ENV.fogAway;
  u.uFogSun = ENV.fogSun;
  u.uFogDensity = ENV.fogDensity;
  u.uFogHeight = ENV.fogHeight;
  u.uPower = ENV.power;
}

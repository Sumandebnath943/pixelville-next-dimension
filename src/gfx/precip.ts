/* ============================================================
   Precipitation, simulated on the GPU: each drop or flake has a
   fixed seed and its position is a pure function of time, wind
   and the camera (a box that wraps around the viewer), so there
   is no per-frame CPU work. Rain falls as motion-blurred streaks
   slanted by the wind; snow drifts, flutters and tumbles in
   gusts. Both are lit by the sky and fade with distance.
   ============================================================ */
import * as THREE from 'three';
import { ENV, GLSL_COMMON, bindEnv } from './env';
import { LAYER_NO_REFLECT } from './pipeline';

const VERT = /* glsl */ `
${GLSL_COMMON}
attribute vec4 aSeed;
uniform float uBox;
uniform vec3 uFall;     // base fall velocity
uniform float uSize;
uniform float uLen;
uniform float uSnowMode;
varying vec2 vQ;
varying float vFade;
void main() {
  vec3 box = vec3(uBox, uBox * 0.6, uBox);
  vec3 wind = vec3(uWindDir.x, 0.0, uWindDir.y) * uWind * (uSnowMode > 0.5 ? 3.2 : 7.0);
  float speed = 0.75 + 0.5 * aSeed.w;
  vec3 vel = (uFall + wind) * speed;
  vec3 p = aSeed.xyz * box + vel * uTime;
  if (uSnowMode > 0.5) {
    float ph = aSeed.w * 60.0;
    p.x += sin(uTime * (0.8 + aSeed.x) + ph) * 0.45 + sin(uTime * 2.3 + ph * 1.7) * 0.12;
    p.z += cos(uTime * (0.7 + aSeed.z) + ph) * 0.45;
    p += wind * 0.3 * sin(uTime * 0.4 + p.x * 0.05);
  }
  vec3 origin = cameraPosition - box * vec3(0.5, 0.35, 0.5);
  p = origin + mod(p - origin, box);
  vec3 toCam = normalize(cameraPosition - p);
  vec3 dir = normalize(vel);
  vec3 side, along;
  if (uSnowMode > 0.5) {
    side = normalize(cross(toCam, vec3(0.0, 1.0, 0.0)));
    along = normalize(cross(side, toCam));
    float s = uSize * (0.6 + aSeed.w * 0.8);
    p += side * position.x * s + along * (position.y - 0.5) * s;
  } else {
    side = normalize(cross(dir, toCam));
    p += side * position.x * uSize + dir * (position.y - 0.5) * uLen * speed;
  }
  vQ = vec2(position.x * 2.0, position.y * 2.0 - 1.0);
  float d = length(p - cameraPosition);
  vFade = smoothstep(0.4, 1.6, d) * (1.0 - smoothstep(uBox * 0.3, uBox * 0.5, d));
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uSnowMode;
varying vec2 vQ;
varying float vFade;
void main() {
  float a;
  if (uSnowMode > 0.5) a = smoothstep(1.0, 0.25, length(vQ));
  else a = (1.0 - abs(vQ.x)) * smoothstep(1.0, 0.2, abs(vQ.y));
  a *= vFade * uAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor, a);
}`;

class Field {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  geo: THREE.InstancedBufferGeometry;
  constructor(scene: THREE.Scene, public max: number, snow: boolean) {
    const base = new THREE.PlaneGeometry(1, 1);
    base.translate(0, 0.5, 0);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.attributes.position);
    const seeds = new Float32Array(max * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    this.geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    this.geo.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uBox: { value: snow ? 34 : 30 },
        uFall: { value: new THREE.Vector3(0, snow ? -1.1 : -8.5, 0) },
        uSize: { value: snow ? 0.028 : 0.009 },
        uLen: { value: snow ? 0 : 0.55 },
        uSnowMode: { value: snow ? 1 : 0 },
        uColor: { value: new THREE.Color() },
        uAlpha: { value: snow ? 0.95 : 0.3 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
    });
    bindEnv(this.mat.uniforms);
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.layers.set(LAYER_NO_REFLECT);
    scene.add(this.mesh);
  }
}

export class Precipitation {
  private rain: Field;
  private snow: Field;
  constructor(scene: THREE.Scene) {
    this.rain = new Field(scene, 26000, false);
    this.snow = new Field(scene, 22000, true);
  }
  /** rain / snow intensity 0..1; `ambient` is the outdoor irradiance */
  update(rain: number, snow: number, ambient: number): void {
    this.rain.geo.instanceCount = Math.floor(this.rain.max * Math.min(1, rain));
    this.rain.mesh.visible = rain > 0.01;
    this.snow.geo.instanceCount = Math.floor(this.snow.max * Math.min(1, snow));
    this.snow.mesh.visible = snow > 0.01;
    // a drop is lit like a grey-white object out in the open
    const lit = ambient / Math.PI;
    (this.rain.mat.uniforms.uColor.value as THREE.Color).copy(ENV.fogAway.value).multiplyScalar(0.7).addScalar(lit * 0.25);
    (this.snow.mat.uniforms.uColor.value as THREE.Color).setRGB(0.92, 0.94, 0.97).multiplyScalar(lit * 0.85 + 0.002).add(ENV.fogAway.value.clone().multiplyScalar(0.3));
  }
}

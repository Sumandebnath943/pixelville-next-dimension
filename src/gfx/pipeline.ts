/* ============================================================
   Render pipeline: WebGL2 renderer, HDR + MSAA composer,
   ground-truth ambient occlusion, bloom whose threshold tracks
   exposure (so lamps glow at night but walls never do by day),
   filmic tone mapping and a final grade (contrast, saturation,
   tint, vignette, grain). Also the planar reflection that wet
   streets and the river sample.
   ============================================================ */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

export type Quality = 'high' | 'medium' | 'low';

/** pick a preset from the GPU: integrated and mobile GPUs get the medium tier */
export function detectQuality(): Quality {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return 'low';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    if (/SwiftShader|llvmpipe|Software/i.test(name)) return 'low';
    if (/Intel(?!.*Arc)|UHD|Iris|Mali|Adreno|PowerVR|Apple GPU|Radeon\(TM\) Graphics|Vega \d+ Graphics/i.test(name)) return 'medium';
    return 'high';
  } catch {
    return 'medium';
  }
}

export interface QualityProfile {
  dpr: number; msaa: number; shadow: number; ao: boolean; pointLights: number; spotLights: number;
  grassPerM2: number; grassRange: number; reflScale: number; waterReflScale: number; reflectActors: boolean;
  /** refresh shadows / mirrors every n-th frame */
  shadowEvery: number; reflEvery: number;
}
export const PROFILES: Record<Quality, QualityProfile> = {
  high: { dpr: 1.5, msaa: 4, shadow: 4096, ao: true, pointLights: 6, spotLights: 2, grassPerM2: 6.5, grassRange: 62, reflScale: 0.5, waterReflScale: 0.5, reflectActors: true, shadowEvery: 1, reflEvery: 1 },
  medium: { dpr: 1, msaa: 0, shadow: 2048, ao: false, pointLights: 4, spotLights: 0, grassPerM2: 3.2, grassRange: 38, reflScale: 0.3, waterReflScale: 0.35, reflectActors: false, shadowEvery: 2, reflEvery: 2 },
  low: { dpr: 0.85, msaa: 0, shadow: 1024, ao: false, pointLights: 0, spotLights: 0, grassPerM2: 1.4, grassRange: 22, reflScale: 0, waterReflScale: 0.25, reflectActors: false, shadowEvery: 3, reflEvery: 3 },
};
/** objects on this layer are skipped by reflections (grass, rain) */
export const LAYER_NO_REFLECT = 1;

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 1.05 },
    contrast: { value: 1.04 },
    tint: { value: new THREE.Vector3(1, 1, 1) },
    vignette: { value: 0.22 },
    grain: { value: 0.018 },
    time: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float saturation, contrast, vignette, grain, time;
    uniform vec3 tint;
    varying vec2 vUv;
    float h(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, saturation);
      col = (col - 0.5) * contrast + 0.5;
      col *= tint;
      vec2 d = vUv - 0.5;
      col *= 1.0 - vignette * smoothstep(0.25, 0.85, dot(d, d) * 2.2);
      col += (h(vUv * 1931.0 + fract(time) * 97.0) - 0.5) * grain;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};

export class Pipeline {
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  private renderPass: RenderPass;
  gtao: GTAOPass | null = null;
  bloom: UnrealBloomPass;
  grade: ShaderPass;
  fxaa: ShaderPass | null = null;
  quality: Quality;
  profile: QualityProfile;
  shadowSize: number;

  constructor(canvas: HTMLCanvasElement, quality: Quality, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.quality = quality;
    const P = (this.profile = PROFILES[quality]);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    const dpr = Math.min(window.devicePixelRatio, P.dpr);
    this.renderer.setPixelRatio(dpr);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.1;
    this.renderer.shadowMap.enabled = P.shadow > 0;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.shadowSize = P.shadow;

    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    const rt = new THREE.WebGLRenderTarget(w * dpr, h * dpr, { type: THREE.HalfFloatType, samples: P.msaa });
    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    if (P.ao) {
      // AO at half resolution: contact shadows under eaves, sills, kerbs and cars
      this.gtao = new GTAOPass(scene, camera, (w * dpr) / 2, (h * dpr) / 2);
      this.gtao.blendIntensity = 0.85;
      this.gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 12, screenSpaceRadius: false });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 12 });
      this.composer.addPass(this.gtao);
    }
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.18, 0.4, 8);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    if (!P.msaa) {
      this.fxaa = new ShaderPass(FXAAShader);
      this.composer.addPass(this.fxaa);
    }
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const c = this.renderer.domElement;
    const w = c.clientWidth || window.innerWidth, h = c.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    this.fxaa?.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
    this.onResize?.(w, h);
  }
  onResize?: (w: number, h: number) => void;

  render(exposure: number, dt: number, shadows = true): void {
    this.renderer.toneMappingExposure = exposure;
    // bloom acts on HDR values before exposure: keep its threshold in display terms
    this.bloom.threshold = 2.4 / exposure;
    (this.grade.uniforms.time.value as number) += dt;
    this.renderer.shadowMap.needsUpdate = shadows;
    this.composer.render(dt);
  }
}

/* ---------- planar reflection (after three.js' Reflector, MIT) ---------- */
export class PlanarReflection {
  rt: THREE.WebGLRenderTarget;
  camera = new THREE.PerspectiveCamera();
  textureMatrix = new THREE.Matrix4();
  enabled = true;
  private plane = new THREE.Plane();
  private normal = new THREE.Vector3(0, 1, 0);
  private point = new THREE.Vector3();

  constructor(public y: number, public scale = 0.5) {
    this.rt = new THREE.WebGLRenderTarget(512, 512, {
      type: THREE.HalfFloatType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
    });
  }
  setSize(w: number, h: number): void {
    this.rt.setSize(Math.max(64, Math.floor(w * this.scale)), Math.max(64, Math.floor(h * this.scale)));
  }

  update(renderer: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.PerspectiveCamera): void {
    if (!this.enabled) return;
    const camPos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    this.point.set(camPos.x, this.y, camPos.z);
    if (camPos.y < this.y + 0.01) return;
    const view = new THREE.Vector3().subVectors(this.point, camPos).reflect(this.normal).negate().add(this.point);
    const rot = new THREE.Matrix4().extractRotation(cam.matrixWorld);
    const look = new THREE.Vector3(0, 0, -1).applyMatrix4(rot).add(camPos);
    const target = new THREE.Vector3().subVectors(this.point, look).reflect(this.normal).negate().add(this.point);
    const vc = this.camera;
    vc.position.copy(view);
    vc.up.set(0, 1, 0).applyMatrix4(rot).reflect(this.normal);
    vc.lookAt(target);
    vc.far = cam.far;
    vc.near = cam.near;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(cam.projectionMatrix);
    vc.layers.mask = cam.layers.mask & ~(1 << LAYER_NO_REFLECT);
    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse);
    // oblique near plane clips everything below the mirror
    this.plane.setFromNormalAndCoplanarPoint(this.normal, this.point).applyMatrix4(vc.matrixWorldInverse);
    const cp = new THREE.Vector4(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
    const pm = vc.projectionMatrix.elements;
    const q = new THREE.Vector4((Math.sign(cp.x) + pm[8]) / pm[0], (Math.sign(cp.y) + pm[9]) / pm[5], -1, (1 + pm[10]) / pm[14]);
    cp.multiplyScalar(2 / cp.dot(q));
    pm[2] = cp.x; pm[6] = cp.y; pm[10] = cp.z + 1 - 0.003; pm[14] = cp.w;
    vc.projectionMatrixInverse.copy(vc.projectionMatrix).invert();

    const prevRT = renderer.getRenderTarget();
    const prevXr = renderer.xr.enabled;
    const prevShadow = renderer.shadowMap.autoUpdate;
    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(scene, vc);
    renderer.setRenderTarget(prevRT);
    renderer.xr.enabled = prevXr;
    renderer.shadowMap.autoUpdate = prevShadow;
  }
}

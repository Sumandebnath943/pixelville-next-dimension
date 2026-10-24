/* ============================================================
   Stage: the V2 renderer. A physical sky and sun (src/gfx/sky)
   lighting everything through an environment map, HDR post
   (AO on high, bloom, filmic grade), GPU rain and snow, wet
   streets that mirror the town, settling snow, leaf fall and
   wind — all driven by the sim's clock, season and weather.
   The public surface (scene, camera, night, update, render) is
   what the rest of the game has always used.
   ============================================================ */
import * as THREE from 'three';
import { Sim } from '../sim/agents';
import { Weather } from '../sim/weather';
import { Festivals } from '../sim/festivals';
import { Calamity } from '../sim/calamity';
import { Settings } from '../sim/settings';
import { GW, GH } from '../sim/world';
import { Pipeline, PlanarReflection, Quality, LAYER_NO_REFLECT, detectQuality, QualityProfile } from '../gfx/pipeline';
import { SkySystem } from '../gfx/sky';
import { ENV } from '../gfx/env';
import { Precipitation } from '../gfx/precip';
import { setTextureScale } from '../gfx/textures';
import { interiorDay, lightsOn } from '../gfx/architecture';
import { GLOW } from '../gfx/props';
import { leafFall } from '../gfx/vegetation';
import { setHeadlightPool } from '../gfx/car';
import { snowUniform, MAT } from './kit';

export type { Quality } from '../gfx/pipeline';

/** 0 = full day, 1 = deep night: the sky's own darkness plus weather gloom */
let lastNight = 0;
export function darkness(_clock?: number): number {
  return lastNight;
}

interface Wx { overcast: number; clouds: number; rain: number; snowfall: number; fog: number; wind: number }
function weatherTarget(): Wx {
  const k = Weather.kind as string, i = Weather.intensity as number;
  switch (k) {
    case 'clouds': return { overcast: 0.45, clouds: 0.8, rain: 0, snowfall: 0, fog: 0.9, wind: 0.42 };
    case 'rain': return { overcast: 0.7 + i * 0.2, clouds: 1, rain: Math.min(1, i * 1.4), snowfall: 0, fog: 0.72, wind: 0.5 };
    case 'heavy': return { overcast: 0.95, clouds: 1, rain: Math.min(1, 0.4 + i * 0.7), snowfall: 0, fog: 0.6, wind: 0.8 };
    case 'snow': return { overcast: 0.75 + i * 0.1, clouds: 1, rain: 0, snowfall: Math.min(1, i * 1.15), fog: 0.55, wind: 0.3 };
    default: return { overcast: 0, clouds: 0.22, rain: 0, snowfall: 0, fog: 1, wind: 0.22 };
  }
}
/** a believable day of the year for the season and the day within it */
function dayOfYear(): number {
  const mids = [105, 196, 288, 15];
  const within = (((Sim.day - 1) % 7) + (Sim.clock / 1440)) / 7 - 0.5;
  return (mids[Weather.season] + within * 91 + 365) % 365;
}

export class Stage {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  quality: Quality;
  profile: QualityProfile;
  pipe: Pipeline;
  sky: SkySystem;
  night = 0;
  shake = 0;
  private precip: Precipitation;
  private groundRefl: PlanarReflection;
  private groundReady = false;
  private lampLights: THREE.PointLight[] = [];
  private flashLight: THREE.AmbientLight;
  private rainbow: THREE.Mesh;
  private st: Wx = weatherTarget();
  private frameNo = 0;
  /** extra mirrors (the water) rendered before the frame; set by the terrain */
  waterUpdate: ((renderer: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.PerspectiveCamera, ambient: number, reflect: boolean) => void) | null = null;
  lost = false;

  constructor(canvas: HTMLCanvasElement) {
    this.quality = Stage.pickQuality();
    this.camera = new THREE.PerspectiveCamera(Settings.get('fov') || 70, 1, 0.25, 4000);
    this.camera.layers.enable(LAYER_NO_REFLECT);
    this.pipe = new Pipeline(canvas, this.quality, this.scene, this.camera);
    this.profile = this.pipe.profile;
    this.renderer = this.pipe.renderer;
    setTextureScale(this.quality === 'high' ? 1 : 0.5);
    this.sky = new SkySystem(this.renderer, this.scene, this.pipe.shadowSize);
    this.precip = new Precipitation(this.scene);
    this.groundRefl = new PlanarReflection(0.03, this.profile.reflScale || 0.25);
    for (let i = 0; i < this.profile.pointLights; i++) {
      const l = new THREE.PointLight(0xffc68a, 0, 28, 2);
      this.scene.add(l);
      this.lampLights.push(l);
    }
    this.flashLight = new THREE.AmbientLight(0xdde6ff, 0);
    this.scene.add(this.flashLight);

    // rainbow arc after a shower
    const rb = new THREE.TorusGeometry(700, 26, 6, 48, Math.PI);
    const cols: number[] = [];
    const pos = rb.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i);
      const t = (Math.hypot(v.x, v.y) - 674) / 52;
      const c = new THREE.Color().setHSL(Math.max(0, Math.min(0.78, t * 0.78)), 1, 0.55);
      cols.push(c.r, c.g, c.b);
    }
    rb.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    this.rainbow = new THREE.Mesh(rb, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.rainbow.layers.set(LAYER_NO_REFLECT);
    this.scene.add(this.rainbow);

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
      // come back one preset lighter next time
      if (Settings.get('quality') === 'auto' || Settings.get('quality') === this.quality) Settings.set('quality', this.quality === 'high' ? 'medium' : 'low');
      console.error('[stage] WebGL context lost; quality lowered for the next load');
    });
    this.pipe.onResize = () => this.resize();
    this.resize();
  }

  static pickQuality(): Quality {
    const q = Settings.get('quality');
    if (q === 'low' || q === 'medium' || q === 'high') return q;
    return detectQuality();
  }
  viewDistance(): number {
    return this.quality === 'high' ? 2600 : this.quality === 'medium' ? 2000 : 1400;
  }

  resize(): void {
    const w = this.renderer.domElement.width, h = this.renderer.domElement.height;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.groundRefl.setSize(w, h);
    this.onResize?.(w, h);
  }
  onResize?: (w: number, h: number) => void;

  /** light everything once so shaders compile with the environment map, then compile them off-frame */
  async warmUp(): Promise<void> {
    this.update(1 / 60, this.camera.position, []);
    this.renderer.setRenderTarget(this.pipe.composer.readBuffer);
    try { await this.renderer.compileAsync(this.scene, this.camera); } catch { /* compile lazily */ }
    // one frame with shadows so the shadow map exists before any mirror pass samples it
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
  }

  /** photo mode: the moment is held (rain hangs in the air, water and leaves stop, the weather stops drifting) */
  frozen = false;
  /** photo mode: exposure compensation (1 = as metered) */
  exposureBias = 1;

  /** hold the moment; returns what lets it go again, with the weather and surfaces as they were */
  hold(): () => void {
    this.frozen = true;
    const st = { ...this.st }, wet = ENV.wet.value, snow = ENV.snow.value;
    return () => {
      this.frozen = false;
      this.exposureBias = 1;
      Object.assign(this.st, st);
      ENV.wet.value = wet;
      ENV.snow.value = snowUniform.value = snow;
    };
  }
  /** jump the sky straight to the sim's weather (photo mode's preview), and the streets with it */
  snapWeather(wet: number, snow: number): void {
    Object.assign(this.st, weatherTarget());
    ENV.wet.value = wet;
    ENV.snow.value = snowUniform.value = snow;
  }

  /** per frame: sky, light and weather around the focus point */
  update(dt: number, focus: THREE.Vector3, lamps: { x: number; z: number }[]): void {
    this.frameNo++;
    if (!this.frozen) ENV.time.value += dt;
    const P = this.profile;

    // weather drifts towards the sim's state; surfaces respond on their own time
    const st = this.st;
    if (!this.frozen) this.drift(dt);
    ENV.rain.value = st.rain;
    ENV.wind.value = st.wind;
    ENV.windDir.value.set(Math.cos(ENV.time.value * 0.013) * 0.8 + 0.2, Math.sin(ENV.time.value * 0.011) * 0.6 + 0.5).normalize();

    // sky, sun and exposure (shadows refresh on alternate frames on the lighter presets)
    const doShadow = (this.frameNo + 1) % P.shadowEvery === 0;
    this.sky.holdShadow = !doShadow;
    const hour = Sim.clock / 60;
    this.sky.update(dt, hour, dayOfYear(), { overcast: st.overcast, clouds: st.clouds, fog: st.fog, snow: ENV.snow.value }, focus, this.camera);
    if (this.sky.envTexture) this.scene.environment = this.sky.envTexture;
    const gloom = Weather.gloom();
    this.night = Math.min(1, this.sky.nightK * 0.95 + gloom * 0.5);
    lastNight = this.night;

    // shadows cover more ground when the camera is high
    const sc = this.sky.sun.shadow.camera;
    const reach = THREE.MathUtils.clamp(70 + Math.max(0, this.camera.position.y - focus.y) * 0.9, 70, 320);
    if (Math.abs(sc.right - reach) > 4) {
      sc.left = -reach; sc.right = reach; sc.top = reach; sc.bottom = -reach;
      sc.updateProjectionMatrix();
    }

    // lightning: the whole town flashes
    this.flashLight.intensity = Weather.flash * 6;

    // interiors, lamps, signs
    interiorDay.value = this.sky.ambient * 0.07;
    const festive = Festivals.decorated() || Festivals.diyasTonight();
    const blackout = Calamity.active && Calamity.active.type === 'quake' ? 0.5 : 1;
    lightsOn.value = THREE.MathUtils.smoothstep(this.sky.nightK + st.overcast * 0.22, 0.12, 0.5) * blackout * (festive ? 1.15 : 1);
    // M1-style flat windows still in use (props, vehicles) glow with the same rhythm
    MAT.windowA.emissiveIntensity = lightsOn.value * 1.4;
    MAT.windowB.emissiveIntensity = lightsOn.value * 1.2;
    MAT.windowC.emissiveIntensity = lightsOn.value * 1.4;
    const lampK = THREE.MathUtils.smoothstep(this.sky.nightK + st.overcast * 0.25, 0.2, 0.55);
    GLOW.lantern.emissiveIntensity = lampK * 5;
    this.updateLamps(focus, lamps, lampK);
    setHeadlightPool(0.06 * this.sky.nightK);

    // precipitation and the rainbow
    this.precip.update(st.rain, st.snowfall, this.sky.ambient);
    const rbK = Weather.rainbowT > 0 ? Math.min(1, Weather.rainbowT / 8) * 0.35 * Math.max(0, 1 - this.night * 2.5) : 0;
    const rbm = this.rainbow.material as THREE.MeshBasicMaterial;
    rbm.opacity += (rbK - rbm.opacity) * Math.min(1, dt);
    this.rainbow.visible = rbm.opacity > 0.01;
    const sd = ENV.sunDir.value;
    this.rainbow.position.set(this.camera.position.x - sd.x * 900, -40, this.camera.position.z - sd.z * 900);
    this.rainbow.lookAt(this.camera.position.x, -40, this.camera.position.z);

    // grade: cooler and flatter in rain and snow, warmer in low sun
    const g = this.pipe.grade.uniforms;
    const warm = this.sky.sunAbove ? (1 - THREE.MathUtils.smoothstep(sd.y, 0.05, 0.4)) * (1 - st.overcast) : 0;
    (g.tint.value as THREE.Vector3).set(1 + warm * 0.04 - st.snowfall * 0.02, 1, 1 - warm * 0.05 + st.overcast * 0.03 + st.snowfall * 0.03);
    g.saturation.value = 1.06 - st.overcast * 0.16;
    g.contrast.value = 1.05 - st.overcast * 0.06;
  }

  /** the weather drifts towards the sim's; wet streets, settled snow and autumn leaves follow at their own pace */
  private drift(dt: number): void {
    const tg = weatherTarget();
    const st = this.st, k = Math.min(1, dt * 0.35);
    st.overcast += (tg.overcast - st.overcast) * k;
    st.clouds += (tg.clouds - st.clouds) * k;
    st.rain += (tg.rain - st.rain) * Math.min(1, dt * 0.5);
    st.snowfall += (tg.snowfall - st.snowfall) * Math.min(1, dt * 0.5);
    st.fog += (tg.fog - st.fog) * k;
    st.wind += (tg.wind - st.wind) * Math.min(1, dt * 0.3);
    const sunny = this.sky.sunAbove ? Math.max(0, ENV.sunDir.value.y) * (1 - st.overcast) : 0;
    if (st.rain > 0.15) ENV.wet.value = Math.min(1, ENV.wet.value + dt * 0.08 * st.rain);
    else ENV.wet.value = Math.max(ENV.snow.value > 0.3 ? 0.12 : 0, ENV.wet.value - dt * (0.004 + sunny * 0.02));
    // winter keeps its snow; it settles while it falls and melts once the season turns
    const winter = Weather.season === 3;
    if (st.snowfall > 0.15) ENV.snow.value = Math.min(1, ENV.snow.value + dt * 0.02 * st.snowfall);
    else if (!winter) ENV.snow.value = Math.max(0, ENV.snow.value - dt * (0.006 + sunny * 0.01));
    else ENV.snow.value = Math.max(0.35, ENV.snow.value - dt * sunny * 0.002);
    snowUniform.value = ENV.snow.value;
    // leaves colour through autumn and are gone by winter; spring brings them back
    const within = ((Sim.day - 1) % 7) / 7;
    const fallTarget = Weather.season === 2 ? 0.15 + within * 0.75 : winter ? 1 : 0;
    leafFall.value += (fallTarget - leafFall.value) * Math.min(1, dt * 0.1);
  }

  private updateLamps(focus: THREE.Vector3, lamps: { x: number; z: number }[], lampK: number): void {
    if (lampK < 0.01 || !this.lampLights.length) {
      for (const l of this.lampLights) l.intensity = 0;
      return;
    }
    const cam = this.camera.position;
    const near = lamps
      .map((l) => ({ l, d: (l.x - cam.x) ** 2 + (l.z - cam.z) ** 2 + ((l.x - focus.x) ** 2 + (l.z - focus.z) ** 2) * 0.5 }))
      .filter((o) => o.d < 160 * 160)
      .sort((a, b) => a.d - b.d);
    this.lampLights.forEach((pl, i) => {
      const o = near[i];
      if (!o) { pl.intensity = 0; return; }
      pl.position.set(o.l.x, 4.3, o.l.z);
      pl.intensity = 11 * lampK;
    });
  }

  /** an interior drawn instead of the world (which keeps updating outside) */
  private indoor: THREE.Scene | null = null;
  setIndoor(scene: THREE.Scene | null): void {
    this.indoor = scene;
    this.pipe.setScene(scene ?? this.scene);
    this.indoorFresh = true;
  }
  private indoorFresh = false;
  /** indoors, exposure is set for lamplight and daylight through the windows */
  indoorExposure = 1;

  render(): void {
    if (this.lost) return;
    if (this.indoor) {
      this.camera.updateMatrixWorld();
      // the room doesn't move: its shadows only need redrawing now and then
      this.pipe.render(this.indoorExposure * this.exposureBias, this.frozen ? 0 : 1 / 60, this.indoorFresh || this.frameNo % 30 === 0);
      this.indoorFresh = false;
      return;
    }
    if (this.shake > 0 || Calamity.shakeT > 0) {
      const k = Math.max(this.shake, Math.min(1, Calamity.shakeT)) * 0.6;
      this.camera.position.x += (Math.random() - 0.5) * k;
      this.camera.position.y += (Math.random() - 0.5) * k;
    }
    this.camera.updateMatrixWorld();
    const P = this.profile;
    const doShadow = (this.frameNo + 1) % P.shadowEvery === 0;
    const doWater = this.frameNo % P.reflEvery === 0;
    const doGround = (this.frameNo + 1) % P.reflEvery === 0;
    // mirrors first: the water every frame it's on screen, the streets only when wet
    ENV.reflOn.value = 0;
    ENV.reflTex.value = null;
    this.waterUpdate?.(this.renderer, this.scene, this.camera, this.sky.ambient, doWater);
    if (ENV.wet.value > 0.04 && P.reflScale > 0) {
      if (doGround || !this.groundReady) {
        this.groundRefl.update(this.renderer, this.scene, this.camera);
        ENV.reflMat.value.copy(this.groundRefl.textureMatrix);
        this.groundReady = true;
      }
      ENV.reflTex.value = this.groundRefl.rt.texture;
      ENV.reflOn.value = 1;
    } else this.groundReady = false;
    this.pipe.render(this.sky.exposure * this.exposureBias, this.frozen ? 0 : 1 / 60, doShadow);
  }

  /** map bounds in metres (for clamping cameras) */
  static bounds = { w: GW * 8, h: GH * 8 };
}

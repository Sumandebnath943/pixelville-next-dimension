/* ============================================================
   Stage: the WebGL renderer, camera, sun & moon, sky colour,
   fog, stars, clouds, rain/snow, lightning, rainbows, lit
   windows and street lamps — all driven by the sim's clock,
   season and weather.
   ============================================================ */
import * as THREE from 'three';
import { Sim } from '../sim/agents';
import { Weather } from '../sim/weather';
import { Festivals } from '../sim/festivals';
import { Calamity } from '../sim/calamity';
import { Settings } from '../sim/settings';
import { MAT, snowUniform, nightUniform, InstancedPool, hex } from './kit';
import { GW, GH } from '../sim/world';

export type Quality = 'low' | 'medium' | 'high';

/** 0 = full day, 1 = deep night (V1's darkness curve, plus weather gloom) */
export function darkness(clock: number): number {
  const h = clock / 60;
  let d: number;
  if (h >= 7 && h < 18.5) d = 0;
  else if (h >= 18.5 && h < 20.5) d = (h - 18.5) / 2;
  else if (h >= 20.5 || h < 4.5) d = 1;
  else if (h >= 4.5 && h < 7) d = 1 - (h - 4.5) / 2.5;
  else d = 0;
  return Math.min(1, d * 0.92 + Weather.gloom());
}

export class Stage {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  moon: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  quality: Quality;
  night = 0;
  private stars: THREE.Points;
  private moonDisc: THREE.Mesh;
  private rain: THREE.LineSegments;
  private rainPos: Float32Array;
  private snow: THREE.Points;
  private snowPos: Float32Array;
  private clouds: InstancedPool;
  private rainbow: THREE.Mesh;
  private lampLights: THREE.PointLight[] = [];
  private skyDay = hex('#8ec5ef');
  private skyDusk = hex('#e9a37a');
  private skyNight = hex('#0a1022');
  private skyStorm = hex('#6a7480');
  shake = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.quality = Stage.pickQuality();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality === 'high' ? 2 : this.quality === 'medium' ? 1.5 : 1));
    this.renderer.shadowMap.enabled = this.quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.camera = new THREE.PerspectiveCamera(Settings.get('fov') || 70, 1, 0.2, 4000);
    this.scene.fog = new THREE.Fog(0x8ec5ef, 300, this.viewDistance());

    this.hemi = new THREE.HemisphereLight(0xcfe6ff, 0x5a6a3a, 0.9);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff2dc, 2.2);
    this.sun.castShadow = this.quality !== 'low';
    const sm = this.quality === 'high' ? 4096 : 2048;
    this.sun.shadow.mapSize.set(sm, sm);
    const sc = this.sun.shadow.camera;
    sc.left = -140; sc.right = 140; sc.top = 140; sc.bottom = -140; sc.near = 10; sc.far = 900;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun, this.sun.target);
    this.moon = new THREE.DirectionalLight(0x9fb4ff, 0);
    this.scene.add(this.moon, this.moon.target);

    // stars
    const sp = new Float32Array(1600 * 3);
    for (let i = 0; i < 1600; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.acos(Math.random() * 0.95);
      sp[i * 3] = Math.cos(a) * Math.sin(e) * 3000;
      sp[i * 3 + 1] = Math.cos(e) * 3000;
      sp[i * 3 + 2] = Math.sin(a) * Math.sin(e) * 3000;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 4, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.scene.add(this.stars);
    this.moonDisc = new THREE.Mesh(new THREE.CircleGeometry(60, 24), new THREE.MeshBasicMaterial({ color: 0xf2f0e4, fog: false, transparent: true }));
    this.scene.add(this.moonDisc);

    // precipitation lives in a box around the camera
    const RN = 2600;
    this.rainPos = new Float32Array(RN * 6);
    for (let i = 0; i < RN; i++) {
      const x = (Math.random() - 0.5) * 90, y = Math.random() * 40, z = (Math.random() - 0.5) * 90;
      this.rainPos.set([x, y, z, x + 0.15, y - 1.1, z], i * 6);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xaac4e2, transparent: true, opacity: 0.55, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);
    const SN = 2400;
    this.snowPos = new Float32Array(SN * 3);
    for (let i = 0; i < SN; i++) this.snowPos.set([(Math.random() - 0.5) * 90, Math.random() * 40, (Math.random() - 0.5) * 90], i * 3);
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.BufferAttribute(this.snowPos, 3));
    this.snow = new THREE.Points(ng, new THREE.PointsMaterial({ color: 0xf4f8ff, size: 0.22, transparent: true, opacity: 0.95, depthWrite: false }));
    this.snow.frustumCulled = false;
    this.scene.add(this.snow);

    // clouds: clusters of soft blobs drifting overhead
    const cb = new THREE.IcosahedronGeometry(1, 2);
    cb.scale(1, 0.62, 1);
    const cm = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.88, emissive: 0x9aa4b8, emissiveIntensity: 0.35 });
    this.clouds = new InstancedPool(cb, cm, 80, this.scene, false);

    // rainbow arc
    const rb = new THREE.TorusGeometry(700, 26, 6, 48, Math.PI);
    const cols: number[] = [];
    const pos = rb.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i);
      const r = Math.hypot(v.x, v.y);
      const t = (r - 674) / 52;
      const c = new THREE.Color().setHSL(Math.max(0, Math.min(0.78, t * 0.78)), 1, 0.55);
      cols.push(c.r, c.g, c.b);
    }
    rb.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    this.rainbow = new THREE.Mesh(rb, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.scene.add(this.rainbow);

    for (let i = 0; i < (this.quality === 'low' ? 4 : 10); i++) {
      const l = new THREE.PointLight(0xffd59a, 0, 26, 1.7);
      this.scene.add(l);
      this.lampLights.push(l);
    }
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  static pickQuality(): Quality {
    const q = Settings.get('quality');
    if (q === 'low' || q === 'medium' || q === 'high') return q;
    const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 1100);
    return mobile ? 'low' : 'medium';
  }
  viewDistance(): number {
    return this.quality === 'high' ? 1500 : this.quality === 'medium' ? 1100 : 700;
  }

  resize(): void {
    const w = this.renderer.domElement.clientWidth || window.innerWidth;
    const h = this.renderer.domElement.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** per frame: lighting & weather around the focus point */
  update(dt: number, focus: THREE.Vector3, lamps: { x: number; z: number }[]): void {
    const clock = Sim.clock;
    const night = darkness(clock);
    this.night = night;
    nightUniform.value = night;
    snowUniform.value += ((Weather.season === 3 ? 1 : Weather.isSnowing() ? 0.6 : 0) - snowUniform.value) * Math.min(1, dt * 0.2);

    // the sun crosses from east to west between 06:00 and 19:00
    const t = (clock - 360) / (1140 - 360);
    const elev = Math.sin(Math.max(0, Math.min(1, t)) * Math.PI);
    const az = Math.PI * (1 - Math.max(0, Math.min(1, t)));
    const sunDir = new THREE.Vector3(Math.cos(az) * 0.8, Math.max(0.08, elev), 0.45).normalize();
    this.sun.position.copy(focus).addScaledVector(sunDir, 400);
    this.sun.target.position.copy(focus);
    const gloom = Weather.gloom();
    const dayK = Math.max(0, 1 - night);
    this.sun.intensity = 2.4 * dayK * (1 - gloom * 2.2) * Math.min(1, elev * 3 + 0.15);
    this.sun.color.setHSL(0.09, 0.6, 0.62 + elev * 0.3);
    const moonDir = new THREE.Vector3(-sunDir.x, Math.max(0.3, 0.8 - elev), -0.3).normalize();
    this.moon.position.copy(focus).addScaledVector(moonDir, 400);
    this.moon.target.position.copy(focus);
    this.moon.intensity = 0.55 * night;
    this.hemi.intensity = 0.35 + dayK * 0.65 - gloom * 0.4;
    this.hemi.color.setRGB(0.6 + dayK * 0.2, 0.68 + dayK * 0.2, 0.9);
    this.hemi.groundColor.set(Weather.season === 3 ? 0x9aa8b8 : 0x4a5a32);

    // sky colour: day → dusk glow → night; storms grey it out; lightning whitens it
    const duskK = Math.max(0, 1 - Math.abs(night - 0.45) * 2.6) * (clock > 900 || clock < 500 ? 1 : 0);
    const sky = this.skyDay.clone().lerp(this.skyStorm, Math.min(1, gloom * 3.5)).lerp(this.skyNight, night).lerp(this.skyDusk, duskK * 0.55);
    if (Weather.flash > 0) sky.lerp(new THREE.Color(0xeef2ff), Weather.flash * 0.8);
    this.scene.background = sky;
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(sky);
    const vd = this.viewDistance();
    fog.far = vd * (1 - Weather.intensity * (Weather.kind === 'heavy' || Weather.kind === 'snow' ? 0.55 : 0.2));
    fog.near = fog.far * 0.3;
    if (Weather.flash > 0) this.hemi.intensity += Weather.flash * 2.5;

    (this.stars.material as THREE.PointsMaterial).opacity = Math.max(0, night - 0.35) * (1 - Weather.intensity) * 1.4;
    this.stars.position.copy(this.camera.position);
    this.moonDisc.position.copy(this.camera.position).addScaledVector(moonDir, 2600);
    this.moonDisc.lookAt(this.camera.position);
    (this.moonDisc.material as THREE.MeshBasicMaterial).opacity = Math.max(0, night - 0.2) * 1.2;

    this.updatePrecip(dt);
    this.updateClouds();
    const rbK = Weather.rainbowT > 0 ? Math.min(1, Weather.rainbowT / 8) * 0.5 * Math.max(0, 1 - night * 2.5) : 0;
    const rbm = this.rainbow.material as THREE.MeshBasicMaterial;
    rbm.opacity += (rbK - rbm.opacity) * Math.min(1, dt);
    this.rainbow.visible = rbm.opacity > 0.01;
    this.rainbow.position.set(this.camera.position.x - sunDir.x * 900, -40, this.camera.position.z - 900);

    this.updateWindows(clock, night);
    this.updateLamps(focus, lamps, night);
  }

  private updatePrecip(dt: number): void {
    const cam = this.camera.position;
    const raining = (Weather.kind === 'rain' || Weather.kind === 'heavy') && Weather.intensity > 0.05;
    this.rain.visible = raining;
    if (raining) {
      const n = Math.floor((this.rainPos.length / 6) * Math.min(1, Weather.intensity * (Weather.kind === 'heavy' ? 1 : 0.55)));
      this.rain.geometry.setDrawRange(0, n * 2);
      const fall = 26 * dt;
      for (let i = 0; i < n; i++) {
        const k = i * 6;
        this.rainPos[k + 1] -= fall;
        this.rainPos[k + 4] -= fall;
        if (this.rainPos[k + 4] < -2) {
          const x = (Math.random() - 0.5) * 90, z = (Math.random() - 0.5) * 90, y = 36 + Math.random() * 6;
          this.rainPos.set([x, y, z, x + 0.15, y - 1.1, z], k);
        }
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
      this.rain.position.set(cam.x, cam.y - 20, cam.z);
    }
    const snowing = Weather.kind === 'snow' && Weather.intensity > 0.05;
    this.snow.visible = snowing;
    if (snowing) {
      const n = Math.floor((this.snowPos.length / 3) * Math.min(1, Weather.intensity));
      this.snow.geometry.setDrawRange(0, n);
      for (let i = 0; i < n; i++) {
        const k = i * 3;
        this.snowPos[k + 1] -= 2.2 * dt;
        this.snowPos[k] += Math.sin(this.snowPos[k + 1] * 0.7 + i) * 0.6 * dt;
        if (this.snowPos[k + 1] < -2) this.snowPos.set([(Math.random() - 0.5) * 90, 38, (Math.random() - 0.5) * 90], k);
      }
      this.snow.geometry.attributes.position.needsUpdate = true;
      this.snow.position.set(cam.x, cam.y - 20, cam.z);
    }
  }

  private updateClouds(): void {
    this.clouds.begin();
    const cover = { clear: 0.45, clouds: 1, rain: 1, heavy: 1, snow: 1 }[Weather.kind as 'clear'] || 0.6;
    const grey = new THREE.Color().setScalar(Weather.kind === 'heavy' ? 0.55 : Weather.kind === 'rain' ? 0.72 : 1).lerp(new THREE.Color(0.18, 0.2, 0.28), this.night);
    for (let i = 0; i < Weather.clouds.length; i++) {
      if (i / Weather.clouds.length > cover) break;
      const c = Weather.clouds[i];
      const x = c.x * 0.5, z = c.y * 0.5, s = c.s * 0.32;
      for (let k = 0; k < 7; k++) {
        const ox = Math.cos(k * 1.9 + i) * s * 0.85, oz = Math.sin(k * 2.3 + i) * s * 0.45;
        this.clouds.add(x + ox, 160 + (k % 3) * 6, z + oz, k, s * (0.55 + (k % 3) * 0.18), grey);
      }
    }
    this.clouds.end();
  }

  /** homes glow in the evening, businesses through working dusk, services all night */
  private updateWindows(clock: number, night: number): void {
    const festive = Festivals.decorated() || Festivals.diyasTonight();
    const h = clock / 60;
    const homeHours = (h >= 17 && h < 23.5) || (h >= 5 && h < 7.5) ? 1 : 0.18;
    const workHours = h >= 7 && h < 20 ? 1 : 0.12;
    const blackout = Calamity.active && Calamity.active.type === 'quake' ? 0.5 : 1;
    MAT.windowA.emissiveIntensity = night * (festive ? 1.2 : homeHours) * 1.1 * blackout;
    MAT.windowB.emissiveIntensity = night * (festive ? 1 : workHours) * 1.0 * blackout;
    MAT.windowC.emissiveIntensity = night * 1.1 * blackout;
  }

  private updateLamps(focus: THREE.Vector3, lamps: { x: number; z: number }[], night: number): void {
    if (night < 0.15) {
      for (const l of this.lampLights) l.intensity = 0;
      return;
    }
    const near = lamps
      .map((l) => ({ l, d: (l.x - focus.x) ** 2 + (l.z - focus.z) ** 2 }))
      .filter((o) => o.d < 120 * 120)
      .sort((a, b) => a.d - b.d);
    this.lampLights.forEach((pl, i) => {
      const o = near[i];
      if (!o) { pl.intensity = 0; return; }
      pl.position.set(o.l.x, 5.6, o.l.z);
      pl.intensity = 28 * night;
    });
  }

  render(): void {
    if (this.shake > 0 || Calamity.shakeT > 0) {
      const k = Math.max(this.shake, Math.min(1, Calamity.shakeT)) * 0.6;
      this.camera.position.x += (Math.random() - 0.5) * k;
      this.camera.position.y += (Math.random() - 0.5) * k;
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** map bounds in metres (for clamping cameras) */
  static bounds = { w: GW * 8, h: GH * 8 };
}

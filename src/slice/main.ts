/* ============================================================
   Look lab: the vertical slice of PixelVille's V2 look.
   One street block under a real sky, with time of day, four
   weathers that settle into the town (wet streets and puddles,
   snow cover and leaf fall), wind, street life, and cameras at
   eye level and from above.
   ============================================================ */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Pipeline, PlanarReflection, Quality, LAYER_NO_REFLECT, detectQuality } from '../gfx/pipeline';
import { SkySystem } from '../gfx/sky';
import { ENV } from '../gfx/env';
import { setAnisotropy, setTextureScale, texturesReady } from '../gfx/textures';
import { interiorDay, lightsOn } from '../gfx/architecture';
import { GLOW } from '../gfx/props';
import { Precipitation } from '../gfx/precip';
import { setHeadlightPool } from '../gfx/car';
import { buildStreet, farForest, groundAt, Street } from './street';
import { StreetLife } from './traffic';

type Wx = 'clear' | 'cloudy' | 'rain' | 'snow';
interface WxState { overcast: number; clouds: number; rain: number; snowfall: number; fog: number }
const WX: Record<Wx, WxState & { wind: number }> = {
  clear: { overcast: 0, clouds: 0.2, rain: 0, snowfall: 0, fog: 1, wind: 0.22 },
  cloudy: { overcast: 0.42, clouds: 0.78, rain: 0, snowfall: 0, fog: 0.9, wind: 0.42 },
  rain: { overcast: 0.92, clouds: 1, rain: 0.9, snowfall: 0, fog: 0.7, wind: 0.55 },
  snow: { overcast: 0.8, clouds: 1, rain: 0, snowfall: 0.85, fog: 0.58, wind: 0.28 },
};
interface View { pos: [number, number, number]; look: [number, number, number]; walk: boolean }
const VIEWS: Record<string, View> = {
  street: { pos: [-34, 0, -5.4], look: [10, 1.6, -4], walk: true },
  shops: { pos: [15.5, 0, 5.8], look: [12, 2.6, -8], walk: true },
  junction: { pos: [-15, 4.2, 15.5], look: [4, 1.2, -8], walk: false },
  river: { pos: [-8, 0, 32.4], look: [40, 0.5, 47], walk: true },
  aerial: { pos: [75, 62, 95], look: [0, 0, -4], walk: false },
};

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const safeGet = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k: string, v: string): void => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

async function main(): Promise<void> {
  const canvas = $<HTMLCanvasElement>('view');
  const loading = $('loading-text');
  let stepT = performance.now(), stepName = 'start';
  const progress = async (s: string): Promise<void> => {
    console.info('[look] step', stepName, Math.round(performance.now() - stepT), 'ms');
    stepT = performance.now();
    stepName = s;
    loading.textContent = s;
    await new Promise((r) => setTimeout(r, 0));
  };
  // debug switches: ?q=low|medium|high and ?off=grass,trees,people,cars,water,refl,post,shadow,forest,lights
  const params = new URLSearchParams(location.search);
  const off = new Set((params.get('off') || '').split(',').filter(Boolean));
  const qp = params.get('q') as Quality | null;
  const saved = (qp || safeGet('pv-look-quality')) as Quality | null;
  const quality: Quality = saved === 'high' || saved === 'medium' || saved === 'low' ? saved : detectQuality();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.25, 9500);
  camera.layers.enable(LAYER_NO_REFLECT);
  const pipe = new Pipeline(canvas, quality, scene, camera);
  const P = pipe.profile;
  const renderer = pipe.renderer;
  // if the GPU gives up, come back one preset lighter
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    lost = true;
    const lighter: Quality = quality === 'high' ? 'medium' : 'low';
    console.error('[look] WebGL context lost', { quality, frame: frameNo, stage: loading.textContent });
    if (!qp) safeSet('pv-look-quality', lighter);
    document.body.classList.remove('ready');
    loading.textContent = `The graphics card ran out of headroom. Reload to try the ${lighter} preset.`;
  });
  let lost = false;
  let frameNo = 0;
  let groundReady = false;
  if (off.has('shadow')) renderer.shadowMap.enabled = false;
  setTextureScale(quality === 'high' ? 1 : 0.5);
  const sky = new SkySystem(renderer, scene, pipe.shadowSize);

  const street: Street = await buildStreet(scene, progress, P.grassPerM2, off);
  setAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
  await progress('Planting the far woods…');
  if (!off.has('forest')) farForest(scene);
  await progress('Waking the villagers…');
  const life = new StreetLife(scene, 3, off.has('people') ? 0 : 28);
  if (off.has('cars')) life.carCount = 0;
  if (off.has('lights')) { P.pointLights = 0; P.spotLights = 0; }
  if (off.has('refl')) { P.reflScale = 0; }
  console.info('[look] built', { quality, off: [...off], calls: 0 });
  if (!P.reflectActors) {
    // keep reflection passes cheap: people and cars stay out of the mirrors
    for (const c of life.cars) c.root.traverse((o) => o.layers.set(LAYER_NO_REFLECT));
    for (const p of life.people) p.root.traverse((o) => o.layers.set(LAYER_NO_REFLECT));
  }
  const precip = new Precipitation(scene);
  const groundRefl = new PlanarReflection(0.03, P.reflScale || 0.25);
  street.river.reflection.scale = P.waterReflScale;
  const sizeRT = (): void => {
    const w = renderer.domElement.width, h = renderer.domElement.height;
    groundRefl.setSize(w, h);
    street.river.reflection.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  pipe.onResize = sizeRT;
  sizeRT();

  // street lamps: a pool of real lights follows the camera; every lantern glows
  const lampLights: THREE.PointLight[] = [];
  for (let i = 0; i < P.pointLights; i++) {
    const l = new THREE.PointLight(0xffc68a, 0, 28, 2);
    scene.add(l);
    lampLights.push(l);
  }
  const headLights: THREE.SpotLight[] = [];
  for (let i = 0; i < P.spotLights; i++) {
    const s = new THREE.SpotLight(0xfff0d8, 0, 45, 0.5, 0.65, 2);
    scene.add(s, s.target);
    headLights.push(s);
  }

  /* ---------- state ---------- */
  let hour = 17.4;
  let timeSpeed = 0;
  let wx: Wx = 'clear';
  const st: WxState = { ...WX.clear };
  let windUser = WX.clear.wind;
  let windAuto = true;
  let doy = 172;
  let leaf = 0;
  let walk = true;
  let yaw = 0, pitch = 0;
  const camPos = new THREE.Vector3();
  const orbit = new OrbitControls(camera, canvas);
  orbit.enableDamping = true;
  orbit.maxPolarAngle = Math.PI * 0.495;
  orbit.minDistance = 3;
  orbit.maxDistance = 900;
  orbit.enabled = false;

  let shot: THREE.Vector3 | null = null;
  const setView = (name: string): void => {
    const v = VIEWS[name];
    shot = null;
    camera.fov = 55;
    camera.updateProjectionMatrix();
    walk = v.walk;
    orbit.enabled = !walk;
    camPos.set(v.pos[0], v.pos[1], v.pos[2]);
    if (walk) camPos.y = groundAt(camPos.x, camPos.z) + 1.68;
    camera.position.copy(camPos);
    const d = new THREE.Vector3(...v.look).sub(camPos);
    yaw = Math.atan2(-d.x, -d.z);
    pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    if (!walk) { orbit.target.set(...v.look); camera.lookAt(orbit.target); orbit.update(); }
    document.querySelectorAll<HTMLButtonElement>('#cam button').forEach((b) => b.classList.toggle('on', b.dataset.v === name));
  };

  /* ---------- input ---------- */
  const keys = new Set<string>();
  addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    keys.add(e.code);
    if (e.code === 'KeyH') document.body.classList.toggle('clean');
    const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(e.code);
    if (n >= 0) setView(Object.keys(VIEWS)[n]);
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  let dragging = false, lx = 0, ly = 0;
  canvas.addEventListener('pointerdown', (e) => { if (!walk) return; dragging = true; lx = e.clientX; ly = e.clientY; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    yaw -= (e.clientX - lx) * 0.0035;
    pitch = THREE.MathUtils.clamp(pitch - (e.clientY - ly) * 0.0035, -1.2, 1.2);
    lx = e.clientX; ly = e.clientY;
  });
  canvas.addEventListener('pointerup', () => (dragging = false));
  canvas.addEventListener('wheel', (e) => { if (walk) { camera.fov = THREE.MathUtils.clamp(camera.fov + e.deltaY * 0.02, 25, 80); camera.updateProjectionMatrix(); } });

  /* ---------- panel ---------- */
  const timeIn = $<HTMLInputElement>('time'), timeOut = $('t-out');
  const windIn = $<HTMLInputElement>('wind'), windOut = $('w-out');
  const fmt = (h: number): string => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
  timeIn.addEventListener('input', () => { hour = +timeIn.value; });
  document.querySelectorAll<HTMLButtonElement>('#speed button').forEach((b) => b.addEventListener('click', () => {
    timeSpeed = +b.dataset.s!;
    document.querySelectorAll('#speed button').forEach((x) => x.classList.toggle('on', x === b));
  }));
  document.querySelectorAll<HTMLButtonElement>('#wx button').forEach((b) => b.addEventListener('click', () => {
    wx = b.dataset.w as Wx;
    if (windAuto) windUser = WX[wx].wind;
    windIn.value = String(windUser);
    document.querySelectorAll('#wx button').forEach((x) => x.classList.toggle('on', x === b));
  }));
  windIn.addEventListener('input', () => { windUser = +windIn.value; windAuto = false; });
  $('settle').addEventListener('click', () => {
    Object.assign(st, WX[wx]);
    ENV.wet.value = wx === 'rain' ? 1 : wx === 'snow' ? 0.15 : 0;
    ENV.snow.value = wx === 'snow' ? 1 : 0;
    leaf = wx === 'snow' ? 1 : 0;
    doy = wx === 'snow' ? 355 : 172;
  });
  document.querySelectorAll<HTMLButtonElement>('#cam button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.v!)));
  const qBtn = $('quality');
  qBtn.textContent = `Quality: ${quality[0].toUpperCase()}${quality.slice(1)}${saved ? '' : ' (auto)'}`;
  qBtn.addEventListener('click', () => {
    const next: Quality = quality === 'high' ? 'medium' : quality === 'medium' ? 'low' : 'high';
    safeSet('pv-look-quality', next);
    location.reload();
  });
  const windName = (w: number): string => (w < 0.12 ? 'Calm' : w < 0.35 ? 'Breeze' : w < 0.6 ? 'Windy' : w < 0.82 ? 'Strong wind' : 'Gale');

  setView('street');
  await progress('Painting textures…');
  await texturesReady();
  await progress('Compiling shaders…');
  // light the scene first: programs compiled without the environment map would all recompile on frame one
  sky.update(1 / 60, hour, doy, { overcast: st.overcast, clouds: st.clouds, fog: st.fog, snow: 0 }, camera.position, camera);
  if (sky.envTexture) scene.environment = sky.envTexture;
  const tc = performance.now();
  // compile against the HDR target the composer renders into (linear output), not the screen
  renderer.setRenderTarget(pipe.composer.readBuffer);
  if (!off.has('compile')) await renderer.compileAsync(scene, camera);
  renderer.setRenderTarget(null);
  console.info('[look] compiled', { ms: Math.round(performance.now() - tc), programs: renderer.info.programs?.length });
  document.body.classList.add('ready');

  /* ---------- frame ---------- */
  const clock = new THREE.Clock();
  let fpsAcc = 0, fpsN = 0;
  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), focus = new THREE.Vector3();

  const frame = (dtIn: number): void => {
    const dt = Math.min(0.05, dtIn);
    ENV.time.value += dt;
    hour = (hour + (dt * timeSpeed) / 60 + 24) % 24;
    if (document.activeElement !== timeIn) timeIn.value = String(hour);
    timeOut.textContent = fmt(hour);

    // weather drifts towards its target; surfaces respond on their own time
    const tg = WX[wx];
    const k = Math.min(1, dt * 0.35);
    st.overcast += (tg.overcast - st.overcast) * k;
    st.clouds += (tg.clouds - st.clouds) * k;
    st.rain += (tg.rain - st.rain) * Math.min(1, dt * 0.5);
    st.snowfall += (tg.snowfall - st.snowfall) * Math.min(1, dt * 0.5);
    st.fog += (tg.fog - st.fog) * k;
    ENV.rain.value = st.rain;
    const sunny = sky.sunAbove ? Math.max(0, ENV.sunDir.value.y) * (1 - st.overcast) : 0;
    if (st.rain > 0.15) ENV.wet.value = Math.min(1, ENV.wet.value + dt * 0.1 * st.rain);
    else ENV.wet.value = Math.max(ENV.snow.value > 0.3 ? 0.12 : 0, ENV.wet.value - dt * (0.006 + sunny * 0.03));
    if (st.snowfall > 0.15) ENV.snow.value = Math.min(1, ENV.snow.value + dt * 0.022 * st.snowfall);
    else ENV.snow.value = Math.max(0, ENV.snow.value - dt * (0.004 + sunny * 0.01));
    leaf += ((wx === 'snow' ? 1 : 0) - leaf) * Math.min(1, dt * 0.12);
    street.veg.setLeafFall(leaf < 0.002 ? 0 : leaf);
    doy += ((wx === 'snow' ? 355 : 172) - doy) * Math.min(1, dt * 0.2);
    ENV.wind.value += (windUser - ENV.wind.value) * Math.min(1, dt * 0.8);
    windOut.textContent = windName(ENV.wind.value);
    ENV.windDir.value.set(Math.cos(ENV.time.value * 0.013) * 0.8 + 0.2, Math.sin(ENV.time.value * 0.011) * 0.6 + 0.5).normalize();

    // camera
    if (shot) {
      focus.copy(shot);
    } else if (walk) {
      const run = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 4.2 : 1.6;
      fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
      right.set(-fwd.z, 0, fwd.x);
      if (keys.has('KeyW') || keys.has('ArrowUp')) camPos.addScaledVector(fwd, run * dt);
      if (keys.has('KeyS') || keys.has('ArrowDown')) camPos.addScaledVector(fwd, -run * dt);
      if (keys.has('KeyD') || keys.has('ArrowRight')) camPos.addScaledVector(right, run * dt);
      if (keys.has('KeyA') || keys.has('ArrowLeft')) camPos.addScaledVector(right, -run * dt);
      const gy = groundAt(camPos.x, camPos.z) + 1.68;
      camPos.y += (gy - camPos.y) * Math.min(1, dt * 10);
      camera.position.copy(camPos);
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
      focus.copy(camPos).addScaledVector(fwd, 28);
    } else {
      orbit.update();
      focus.copy(orbit.target);
    }
    camera.updateMatrixWorld();

    // sky, light and exposure (shadows refresh on odd frames, mirrors alternate, on lighter presets)
    const doShadow = (frameNo + 1) % P.shadowEvery === 0;
    const doRiver = frameNo % P.reflEvery === 0;
    const doGround = (frameNo + 1) % P.reflEvery === 0;
    sky.holdShadow = !doShadow;
    sky.update(dt, hour, doy, { overcast: st.overcast, clouds: st.clouds, fog: st.fog, snow: ENV.snow.value }, focus, camera);
    if (sky.envTexture) scene.environment = sky.envTexture;
    scene.environmentIntensity = 1;
    interiorDay.value = sky.ambient * 0.07;
    const dusk = THREE.MathUtils.smoothstep(sky.nightK + st.overcast * 0.22, 0.12, 0.5);
    lightsOn.value = dusk;
    const lampK = THREE.MathUtils.smoothstep(sky.nightK + st.overcast * 0.25, 0.2, 0.55);
    GLOW.lantern.emissiveIntensity = lampK * 5;
    const near = street.lamps
      .map((p) => ({ p, d: p.distanceToSquared(camera.position) }))
      .sort((a, b) => a.d - b.d);
    lampLights.forEach((l, i) => {
      const n = near[i];
      l.intensity = n && lampK > 0.01 ? lampK * 11 : 0;
      if (n) l.position.copy(n.p).add(new THREE.Vector3(0, -0.15, 0));
    });

    // street life
    life.update(dt);
    life.animate(dt, st.rain, camera.position);
    const sigK = Math.max(3, 2.2 / sky.exposure);
    life.showSignals(street.signals, sigK, ENV.time.value);
    street.beacons.emissiveIntensity = Math.floor(ENV.time.value * 1.4) % 2 ? sigK * 0.7 : 0.05;
    const headsOn = sky.nightK > 0.2 || st.rain > 0.3 || st.snowfall > 0.3 || st.fog < 0.6;
    const cars = life.cars.filter((c) => c.root.visible);
    for (const c of cars) c.lights(headsOn, sky.nightK);
    setHeadlightPool(0.06 * sky.nightK);
    const byDist = cars.filter((c) => c.headOn).sort((a, b) => a.root.position.distanceToSquared(camera.position) - b.root.position.distanceToSquared(camera.position));
    headLights.forEach((s, i) => {
      const c = byDist[i];
      if (!c || sky.nightK < 0.15) { s.intensity = 0; return; }
      const yawC = c.root.rotation.y;
      const dx = Math.sin(yawC), dz = Math.cos(yawC);
      s.position.set(c.root.position.x + dx * (c.dims.L / 2), 0.75, c.root.position.z + dz * (c.dims.L / 2));
      s.target.position.set(s.position.x + dx * 18, 0, s.position.z + dz * 18);
      s.target.updateMatrixWorld();
      s.intensity = 70 * sky.nightK;
    });
    for (const f of street.floaters) {
      const duck = f.obj.userData.duck as { phase: number; speed: number } | undefined;
      if (duck) {
        duck.phase += dt * 0.15;
        f.obj.rotation.y += Math.sin(duck.phase) * dt * 0.3;
        f.obj.position.x += Math.sin(f.obj.rotation.y) * duck.speed * dt;
        f.obj.position.z = THREE.MathUtils.clamp(f.obj.position.z + Math.cos(f.obj.rotation.y) * duck.speed * dt, 40, 62);
      }
      f.update(dt);
    }
    street.grass.update(camera.position, P.grassRange);
    precip.update(st.rain, st.snowfall, sky.ambient);

    // reflections: the river every frame it's on screen, the street only when wet
    ENV.reflOn.value = 0;
    ENV.reflTex.value = null;
    street.river.reflection.enabled = !off.has('water') && !off.has('refl');
    street.river.update(renderer, scene, camera, sky.ambient, doRiver);
    if (ENV.wet.value > 0.04 && P.reflScale > 0) {
      if (doGround || !groundReady) {
        groundRefl.update(renderer, scene, camera);
        ENV.reflMat.value.copy(groundRefl.textureMatrix);
        groundReady = true;
      }
      ENV.reflTex.value = groundRefl.rt.texture;
      ENV.reflOn.value = 1;
    } else groundReady = false;

    // grade: cooler and flatter in rain and snow, warmer in low sun
    const g = pipe.grade.uniforms;
    const warm = sky.sunAbove ? (1 - THREE.MathUtils.smoothstep(ENV.sunDir.value.y, 0.05, 0.4)) * (1 - st.overcast) : 0;
    (g.tint.value as THREE.Vector3).set(1 + warm * 0.04 - st.snowfall * 0.02, 1, 1 - warm * 0.05 + st.overcast * 0.03 + st.snowfall * 0.03);
    g.saturation.value = 1.06 - st.overcast * 0.16;
    g.contrast.value = 1.05 - st.overcast * 0.06;
    if (lost) return;
    const t0 = performance.now();
    if (off.has('post')) {
      renderer.toneMappingExposure = sky.exposure;
      renderer.shadowMap.needsUpdate = doShadow;
      renderer.render(scene, camera);
    } else pipe.render(sky.exposure, dt, doShadow);
    frameNo++;
    if (frameNo <= 3 || frameNo === 30) console.info('[look] frame', frameNo, { cpuMs: +(performance.now() - t0).toFixed(1), calls: renderer.info.render.calls, tris: renderer.info.render.triangles, programs: renderer.info.programs?.length, textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries });

    fpsAcc += dtIn; fpsN++;
    if (fpsAcc > 0.5) { $('fps').textContent = `${Math.round(fpsN / fpsAcc)} fps`; fpsAcc = 0; fpsN = 0; }
  };
  const dbg = { paused: false };
  const loop = (): void => {
    const d = clock.getDelta();
    if (!dbg.paused) frame(d);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // debug handle (the in-app browser pauses rAF while hidden; `step` advances by hand)
  (window as unknown as Record<string, unknown>).LOOK = {
    scene, camera, ENV, sky, life, street, renderer, pipe, dbg,
    step: (n = 1, dt = 1 / 30) => { for (let i = 0; i < n; i++) frame(dt); },
    /** a fixed camera for close-ups: position, look-at, field of view */
    shot: (p: [number, number, number], l: [number, number, number], fov = 35) => {
      walk = false;
      orbit.enabled = false;
      camera.position.set(...p);
      camera.fov = fov;
      camera.updateProjectionMatrix();
      camera.lookAt(...l);
      shot = new THREE.Vector3(...l);
    },
    set: (o: { hour?: number; wx?: Wx; view?: string; settle?: boolean; wind?: number }) => {
      if (o.hour !== undefined) hour = o.hour;
      if (o.wx) (document.querySelector(`#wx button[data-w="${o.wx}"]`) as HTMLButtonElement).click();
      if (o.wind !== undefined) { windUser = o.wind; windAuto = false; }
      if (o.settle) $('settle').click();
      if (o.view) setView(o.view);
    },
  };
}

main().catch((e) => {
  console.error(e);
  const el = document.getElementById('loading-text');
  if (el) el.textContent = 'Something went wrong: ' + (e as Error).message;
});

/* ============================================================
   PixelVille — Next Dimension · boot and the frame loop.
   Sim (headless, src/sim) → 3D layers (src/render) → the
   Founder & Planner (src/player) → HUD & panels (src/ui).
   ============================================================ */
import * as THREE from 'three';
import { Game } from './sim/game';
import { Sim } from './sim/agents';
import { World } from './sim/world';
import { Weather } from './sim/weather';
import { Settings } from './sim/settings';
import { CAT } from './sim/catalog';
import { Stage } from './render/stage';
import { Terrain } from './render/terrain';
import { BuildingLayer } from './render/buildings';
import { Actors } from './render/actors';
import { Founder } from './player/founder';
import { Planner } from './player/planner';
import { Input } from './input/input';
import { Hud } from './ui/hud';
import { Panels } from './ui/panels';
import { initTouch } from './ui/touch';
import { Snd } from './audio/sounds';
import { get, AUTO } from './save/store';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const $ = (id: string) => document.getElementById(id)!;
const TM = 8;

/* ---------- the world ---------- */
Game.boot();
const stage = new Stage(canvas);
const terrain = new Terrain(stage.scene);
const buildings = new BuildingLayer(stage.scene);
const actors = new Actors(stage.scene, buildings);
const founder = new Founder(stage.scene, buildings);
const planner = new Planner(stage.scene, canvas, stage.camera, buildings, actors);
Game.founderHooks = { get: () => founder.save(), set: (s) => founder.spawn(Game.lodge(), s) };
founder.spawn(Game.lodge(), null);

/* ---------- UI ---------- */
const togglePlanner = () => {
  if (planner.active && !planner.leaving) planner.exit();
  else {
    if (founder.driving) founder.car.speed = 0;
    planner.enter(founder.pos);
    Input.releaseLock();
  }
};
const hud = new Hud({
  togglePlanner,
  isPlanner: () => planner.active && !planner.leaving,
  focus: (px) => {
    // a god can always rise and look: from the street, the Planner opens over the spot
    if (!planner.active || planner.leaving) { planner.enter(founder.pos); Input.releaseLock(); }
    planner.focus(px.x * 0.5, px.y * 0.5);
  },
  founder: () => ({ x: founder.pos.x, z: founder.pos.z, yaw: founder.yaw }),
  setTool: (k) => planner.setTool(k),
  openMayor: () => panels.showMayor(),
});
const panels = new Panels({
  toast: (m) => hud.toast(m),
  focus: (px) => {
    if (!planner.active || planner.leaving) { planner.enter(founder.pos); Input.releaseLock(); }
    planner.focus(px.x * 0.5, px.y * 0.5);
  },
  afterLoad: () => { buildings.clear(); terrain.update(true); buildings.sync(); },
  isPlanner: () => planner.active && !planner.leaving,
});
planner.onBuilding = (b) => panels.showInfo(b);
planner.onPerson = (p) => panels.showPerson(p);
planner.onToolChange = (k) => hud.markTool(k);
planner.onEmptyClick = () => panels.hideInfo();
Input.attach(canvas);
initTouch();
canvas.addEventListener('click', () => {
  if (!planner.active && !panels.anyModalOpen()) Input.requestLock(canvas);
});

/* continue the last village if there is one */
get(AUTO)
  .then((data) => {
    if (!data) { panels.show('help'); return; }
    const r = Game.performLoad(data);
    if (r.ok) {
      buildings.clear();
      terrain.update(true);
      buildings.sync();
      hud.toast(`👋 Welcome back to ${World.name} — day ${Sim.day}, ${Sim.people.length} villagers`);
    } else panels.show('help');
  })
  .catch(() => panels.show('help'));

/* ---------- the frame loop ---------- */
let last = performance.now();
let lastHud = 0, lastPanel = 0, lastVersion = -1;
const tmpCam = new THREE.PerspectiveCamera();
const focus = new THREE.Vector3();

function interactions(): void {
  const prompt = $('prompt');
  let text = '';
  if (founder.driving) {
    text = '<b>F</b> get out';
    if (Input.take('vehicle')) founder.exitCar();
  } else {
    // the nearest door, villager or the Founder's car
    let near: { kind: string; ref: any; d: number } | null = null;
    if (founder.nearCar()) near = { kind: 'car', ref: null, d: 0 };
    for (const p of actors.pickables) {
      const d = Math.hypot(p.x - founder.pos.x, p.z - founder.pos.z);
      if (d < 2.6 && (!near || d < near.d)) near = { kind: 'person', ref: p.ref, d };
    }
    if (!near || near.kind !== 'car') {
      const t = founder.tile();
      for (let j = -1; j <= 1; j++)
        for (let i = -1; i <= 1; i++) {
          for (const b of World.buildings) {
            if (b.door.x !== t.x + i || b.door.y !== t.y + j) continue;
            const d = Math.hypot(b.door.x * TM + 4 - founder.pos.x, b.door.y * TM + 4 - founder.pos.z);
            if (d < 7 && (!near || d < near.d)) near = { kind: 'building', ref: b, d };
          }
        }
    }
    if (near?.kind === 'car') {
      text = '<b>F</b> drive your car';
      if (Input.take('vehicle')) founder.enterCar();
    } else if (near?.kind === 'person') {
      text = `<b>E</b> meet ${near.ref.name} ${near.ref.surname}`;
      if (Input.take('interact')) panels.showPerson(near.ref);
    } else if (near?.kind === 'building') {
      const d = CAT[near.ref.type];
      text = `<b>E</b> ${d.emoji} ${d.name}${near.ref.type === 'lodge' ? ' — your home base' : ''}`;
      if (Input.take('interact')) panels.showInfo(near.ref);
    }
  }
  prompt.innerHTML = text;
  prompt.style.display = text ? 'block' : 'none';
}

function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000 || 0.016);
  last = now;
  Input.poll();

  // global actions
  if (Input.take('planner')) togglePlanner();
  if (Input.take('journal')) hud.toggleJournal();
  if (Input.take('help')) panels.show('help');
  if (Input.take('cancel')) {
    if (planner.active && planner.tool) planner.setTool(null);
    else if (!panels.closeAll() && planner.active && !planner.leaving) planner.exit();
  }
  if (Input.take('undo') && planner.active) Game.undo();
  if (planner.active && !planner.leaving && Input.take('jump')) Game.setSpeed(Game.speedIdx === 0 ? 1 : 0);
  for (const [k, i] of [['Digit1', 0], ['Digit2', 1], ['Digit3', 2], ['Digit4', 3], ['Digit5', 4]] as [string, number][])
    if (planner.active && Input.keys.has(k)) Game.setSpeed(i);

  // the simulation
  Game.tick(dt);
  if (Game.mapVersion !== lastVersion) { lastVersion = Game.mapVersion; terrain.update(); }
  buildings.sync();
  if (Sim.welcomeAt) { // the founding moment: fly over the first doorstep
    if (planner.active) planner.focus(Sim.welcomeAt.x * 0.5, Sim.welcomeAt.y * 0.5);
    Sim.welcomeAt = null;
  }

  // the player
  const street = !planner.active;
  Input.dragLook = street;
  if (street && !panels.anyModalOpen()) {
    founder.update(dt);
    interactions();
  } else if (!street) $('prompt').style.display = 'none';
  planner.update(dt);

  // cameras: street, aerial, or a blend while rising/descending
  stage.camera.fov = Settings.get('fov') || 70;
  stage.camera.updateProjectionMatrix();
  if (planner.active) {
    planner.pose(stage.camera);
    if (planner.blend < 1) {
      tmpCam.copy(stage.camera);
      founder.applyCamera(tmpCam, dt, stage.night);
      const k = planner.blend * planner.blend * (3 - 2 * planner.blend);
      const toPos = stage.camera.position.clone(), toQ = stage.camera.quaternion.clone();
      stage.camera.position.copy(tmpCam.position).lerp(toPos, k);
      stage.camera.quaternion.copy(tmpCam.quaternion).slerp(toQ, k);
    }
    focus.copy(planner.target);
  } else {
    founder.applyCamera(stage.camera, dt, stage.night);
    focus.copy(founder.pos);
  }
  document.body.classList.toggle('planner', planner.active && !planner.leaving);
  document.body.classList.toggle('fp', street && founder.firstPerson && !founder.driving);

  const range = planner.active ? Math.min(700, planner.dist * 1.6 + 120) : 240;
  stage.update(dt, focus, terrain.lampSpots);
  terrain.frame(stage.night);
  actors.update(dt, focus.x, focus.z, range, now, stage.night);
  stage.render();

  // HUD
  if (now - lastHud > 400) {
    lastHud = now;
    hud.update();
    const w = planner.active ? planner.dist * 1.6 : 0;
    hud.drawMinimap({ x: planner.active ? planner.target.x : founder.pos.x, z: planner.active ? planner.target.z : founder.pos.z, yaw: founder.yaw, planner: planner.active, w, h: w * 0.7 });
    $('wallet').textContent = `👛 $${Math.round(founder.wallet)}`;
    $('speedo').textContent = founder.driving ? `${Math.round(founder.speedKmh)} km/h` : '';
    $('modebadge').textContent = founder.driving ? '🚗 Driving' : founder.firstPerson ? '👁️ First person' : '';
    if (planner.active) hud.markTool(planner.tool);
    else {
      $('hint').textContent = Input.usingTouch ? 'Left thumb moves · right thumb looks · 🏗️ opens the Planner'
        : Input.locked ? 'WASD move · Shift run · Space jump · V camera · F drive · P Planner · Esc frees the mouse'
          : 'Click (or drag) the view to look around · WASD move · F drive · P Planner · F1 help';
    }
  }
  if (now - lastPanel > 1200) { lastPanel = now; panels.refresh(); }

  // sound
  Snd.tick(dt, {
    dark: stage.night, rainI: Weather.isRaining() ? Weather.intensity : 0, snowI: Weather.isSnowing() ? Weather.intensity : 0,
    day: Sim.clock > 350 && Sim.clock < 1150, engine: founder.driving && !planner.active ? Math.min(1, Math.abs(founder.car.speed) / 30) : -1,
  });

  Input.endFrame();
  requestAnimationFrame(frame);
}

/* idle progress while the tab is hidden (V1 behaviour) */
let lastHidden = performance.now();
setInterval(() => {
  const now = performance.now();
  const elapsed = (now - lastHidden) / 1000;
  lastHidden = now;
  if (document.hidden) Game.catchUp(elapsed);
}, 1000);

/* first paint */
terrain.update(true);
buildings.sync();
requestAnimationFrame((t) => {
  last = t;
  frame(t);
  const l = $('loading');
  l.style.opacity = '0';
  setTimeout(() => l.remove(), 700);
});

// debugging handle for the console
(window as unknown as Record<string, unknown>).PV = { Game, Sim, World, stage, founder, planner, actors, buildings, terrain, Input };

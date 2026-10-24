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
import { family } from './sim/core';
import { Stage } from './render/stage';
import { Terrain } from './render/terrain';
import { BuildingLayer, yieldFrame } from './render/buildings';
import { Actors } from './render/actors';
import { Founder } from './player/founder';
import { Planner } from './player/planner';
import { Input } from './input/input';
import { Hud } from './ui/hud';
import { Panels } from './ui/panels';
import { initTouch } from './ui/touch';
import { Snd } from './audio/sounds';
import { get, AUTO } from './save/store';
import { texturesReady } from './gfx/textures';
import { Traffic } from './sim/traffic';
import { Life } from './sim/life';
import { Gps, distLabel } from './player/gps';
import { Errands } from './player/errands';
import { Phone } from './ui/phone';
import { GpsArrows } from './render/gpsarrows';
import { Motoring, IMPOUND_FEE } from './player/motoring';
import { Showroom } from './ui/showroom';
import { Wanted, FINES } from './player/wanted';
import { Street } from './player/street';
import { PhotoMode } from './player/photo';
import { PhotoPanel } from './ui/photopanel';
import { Indoors, doorState, householdView } from './player/indoors';
import { Counter } from './ui/counter';
import { lightsOn } from './gfx/architecture';
import { ChatClient } from './ai/client';
import { contacts } from './ai/memory';
import { jobName } from './player/indoors';
import { Dialogue } from './ui/dialogue';
import { Rep } from './sim/reputation';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const $ = (id: string) => document.getElementById(id)!;
const TM = 8;
const WASD = '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>';

/* ---------- the world ---------- */
Game.boot();
const stage = new Stage(canvas);
const terrain = new Terrain(stage.scene, stage.profile);
stage.waterUpdate = (r, s, c, ambient, reflect) => terrain.water.update(r, s, c, ambient, reflect, terrain.ice);
stage.onResize = (w, h) => terrain.water.reflection.setSize(w, h);
stage.resize();
const buildings = new BuildingLayer(stage.scene);
const actors = new Actors(stage.scene, buildings);
const founder = new Founder(stage.scene, buildings);
const planner = new Planner(stage.scene, canvas, stage.camera, buildings, actors);
Game.founderHooks = {
  get: () => founder.save(),
  set: (s) => {
    // a loaded village starts on the street
    if (indoors?.active) { dialogue.close(); indoors.exit(); document.body.classList.remove('indoors'); }
    founder.spawn(Game.lodge(), s);
    wanted.reset();
  },
};
founder.spawn(Game.lodge(), null);
// a driver held up by the Founder leans on the horn (louder the nearer it is)
Traffic.onHonk = (who) => {
  const d = Math.hypot(who.x * 0.5 - founder.pos.x, who.y * 0.5 - founder.pos.z);
  if (d < 70) Snd.horn(Math.max(0.15, 1 - d / 70));
  if (who.trip) { who.bubble = '😤'; who.bubbleUntil = performance.now() + 2500; }
};
const gps = new Gps();
const arrows = new GpsArrows(stage.scene);

/* ---------- UI ---------- */
const inPlanner = (): boolean => planner.active && !planner.leaving;
const togglePlanner = () => {
  if (inPlanner()) planner.exit();
  else if (scene) return;
  else if (wanted.stars > 0) hud.toast('🚨 The Planner is locked while the police are after you — lose them first', undefined, true);
  else {
    if (founder.driving) founder.car.speed = 0;
    planner.enter(founder.pos);
    Input.releaseLock();
  }
};
/** a place from a toast, a card or the minimap: fly the Planner over it, or on the street, route there */
const goTo = (px: { x: number; y: number }, label?: string): void => {
  if (inPlanner()) { planner.focus(px.x * 0.5, px.y * 0.5); return; }
  gps.set(px.x * 0.5, px.y * 0.5, label || 'Pinned place');
  hud.toast(`🧭 Route set: ${label || 'the pinned place'} — follow the arrows on the road`, undefined, true);
};
const hud = new Hud({
  togglePlanner,
  isPlanner: inPlanner,
  focus: goTo,
  founder: () => ({ x: founder.pos.x, z: founder.pos.z, yaw: founder.yaw }),
  setTool: (k) => planner.setTool(k),
  openMayor: () => panels.showMayor(),
  togglePhone: () => togglePhone(),
});
const panels = new Panels({
  toast: (m) => hud.toast(m),
  focus: goTo,
  extraActions: (b) => [
    ...(errands.canScratch(b) ? [{ label: 'Scratch card · $2', run: () => errands.scratch(b) }] : []),
    ...motoring.buildingActions(b),
  ],
  afterLoad: () => { buildings.clear(); terrain.update(true); buildings.sync(); errands.reset(); gps.clear(); wanted.reset(); },
  isPlanner: inPlanner,
});
// (hud.toast's third argument means "already logged": personal moments stay out of the village news)
const personalToast = (m: string, at?: { x: number; y: number }, news?: boolean): void => hud.toast(m, at, !news);
const errands = new Errands(founder, gps, personalToast);
const motoring = new Motoring(founder, gps, personalToast, () => Sim.clock, (b) => showroom.open(b));
const showroom = new Showroom(motoring, founder.purse, () => panels.show('showroomui'), () => panels.close('showroomui'));
const wanted = new Wanted(founder, personalToast);
const streetLife = new Street(founder, wanted, personalToast);

/* ---------- going inside: a fade, the room, and back out to the doorstep ---------- */
const indoors = new Indoors(stage);
const counter = new Counter({
  purse: founder.purse,
  bag: () => founder.bag,
  owed: () => founder.fleet.owed,
  toast: (m) => personalToast(m),
  show: () => panels.show('counterui'),
  close: () => panels.close('counterui'),
  extra: (b) => [
    ...(errands.canScratch(b) ? [{ label: 'Scratch card · $2', run: () => errands.scratch(b) }] : []),
    ...motoring.buildingActions(b),
  ],
  about: (b) => panels.showInfo(b),
  talk: (p) => dialogue.start(p, { building: indoors.b }),
});
/* ---------- talking: face to face, or on the phone ---------- */
const chatClient = new ChatClient();
void chatClient.probe();
const dialogue = new Dialogue({
  client: chatClient,
  showPerson: (p) => panels.showPerson(p),
  release: () => Input.releaseLock(),
  onStart: (p, onPhone) => {
    document.body.classList.add('talking');
    // someone in the street stops to talk; someone inside turns to face you
    if (!indoors.active && !onPhone && p.state === 'walk' && p.trip) p.freezeT = Math.max(p.freezeT || 0, 600);
    if (indoors.active) indoors.talkingTo = indoors.people.find((o) => o.p === p) ?? null;
  },
  onEnd: (p) => {
    document.body.classList.remove('talking');
    if (p && p.freezeT > 0 && !p.knocked) p.freezeT = 0;
    indoors.talkingTo = null;
  },
});
$('tk-input').addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Escape') dialogue.close(); });
/** ring a villager from the phone's Contacts (nobody picks up in the small hours) */
function callVillager(p: any): void {
  if (!Sim.people.includes(p)) return;
  phone.close();
  if (Sim.clock < 390 || Sim.clock >= 1380) { hud.toast(`📞 No answer — ${p.name} must be asleep`, undefined, true); return; }
  dialogue.start(p, { phone: true });
}
/** route to wherever they are now: inside a building, or out walking */
function findVillager(p: any): void {
  if (p.state === 'in' && p.at) gps.set(p.at.door.x * TM + 4, p.at.door.y * TM + 4, `${p.name} · ${p.at === p.home ? 'at home' : `the ${CAT[p.at.type].name}`}`);
  else gps.set(p.x * 0.5, p.y * 0.5, `${p.name} ${p.surname}`);
}
let fading = false;
/** black out, do `fn`, come back */
function fade(fn: () => void): void {
  if (fading) return;
  fading = true;
  const f = $('fade');
  f.classList.add('on');
  setTimeout(() => {
    fn();
    fading = false;
    requestAnimationFrame(() => f.classList.remove('on'));
  }, 260);
}
function goIn(b: any): void {
  if (wanted.stars > 0) { hud.toast('🚨 Not with the police after you', undefined, true); return; }
  phone.close();
  panels.hideInfo();
  fade(() => {
    indoors.enter(b);
    document.body.classList.add('indoors');
    if (b.type !== 'lodge') Snd.tone(1320, 1320, 0.05, 0.03, 'sine'); // the shop bell
  });
}
function goOut(): void {
  const b = indoors.b;
  panels.closeAll();
  fade(() => {
    indoors.exit();
    founder.stepOutOf(b);
    document.body.classList.remove('indoors');
  });
}
function indoorInteractions(): void {
  const u = indoors.use(), prompt = $('prompt');
  prompt.innerHTML = u?.text || '';
  prompt.style.display = u ? 'block' : 'none';
  if (!u || !Input.take('interact')) return;
  if (u.kind === 'person') { dialogue.start(u.who.p, { building: indoors.b }); return; }
  const s = u.spot;
  if (s.kind === 'exit') goOut();
  else if (s.kind === 'seat') { if (indoors.seated) indoors.stand(); else indoors.sit(s); }
  else if (s.kind === 'counter') {
    const who = indoors.server(s);
    if (who) counter.open('counter', indoors.b, who.p);
    else hud.toast('🛎️ Nobody is serving right now', undefined, true);
  } else if (s.kind === 'atm') counter.open('atm', indoors.b);
  else if (s.kind === 'tickets') counter.open('tickets', indoors.b);
  else if (s.kind === 'desk') panels.showInfo(indoors.b);
}

/* ---------- photo mode: the world holds still and the camera comes free ---------- */
const photo = new PhotoMode(stage);
let shotWanted = false;
const photoPanel = new PhotoPanel(photo, () => { shotWanted = true; }, () => leavePhoto());
function enterPhoto(): void {
  if (photo.active || inPlanner() || scene || panels.anyModalOpen()) return;
  phone.close();
  panels.hideInfo();
  Input.releaseLock();
  founder.showBody();
  const subject = founder.driving ? new THREE.Vector3(founder.car.x, founder.car.y + 1, founder.car.z) : founder.pos.clone().setY(founder.pos.y + 1.2);
  photo.enter(stage.camera, subject, (x, z) => founder.groundAt(x, z));
  $('pm-saved').textContent = '';
  photoPanel.show();
}
function leavePhoto(): void {
  photo.exit();
  photoPanel.hide();
}
/** the frame just drawn, as a PNG to keep (and a copy in the phone's camera roll) */
function savePhoto(): void {
  const name = photo.fileName(World.name);
  try {
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, 'image/png');
    phone.addPhoto(canvas.toDataURL('image/jpeg', 0.9));
    $('pm-saved').textContent = `Saved ${name} — and a copy is in the phone's camera roll.`;
    const fl = $('flash');
    fl.classList.remove('go');
    void fl.offsetWidth;
    fl.classList.add('go');
    Snd.tone(1800, 900, 0.08, 0.05, 'square');
  } catch {
    $('pm-saved').textContent = 'The photo could not be saved here.';
  }
}
let lastPhotoSync = 0;
/** one paused frame: fly the camera, dress the shot, draw it */
function photoFrame(now: number, dt: number): void {
  if (Input.take('cancel') || Input.take('photo')) { leavePhoto(); return; }
  if (Input.take('hide')) photoPanel.toggle();
  if (Input.take('shoot')) shotWanted = true;
  Input.dragLook = true;
  const k = Input.keys;
  const rise = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
  photo.fly(dt, Input.move(), rise, Input.look(Settings.get('mouseSens') || 1, !!Settings.get('invertY')), Input.running(), Input.wheel);
  photo.pose(stage.camera);
  stage.update(dt, photo.focusPoint(focus), terrain.lampSpots);
  photo.dress(stage.camera);
  terrain.frame(stage.night, stage.camera.position);
  actors.update(0, photo.pos.x, photo.pos.z, 240, now, stage.night);
  stage.render();
  if (shotWanted) { shotWanted = false; savePhoto(); }
  if (now - lastPhotoSync > 150) { lastPhotoSync = now; photoPanel.sync(); }
  Snd.tick(dt, { dark: stage.night, rainI: 0, snowI: 0, day: Sim.clock > 350 && Sim.clock < 1150, engine: -1 });
}
// in photo mode a click (not a drag) on the picture focuses there
let downAt: { x: number; y: number; t: number } | null = null;
canvas.addEventListener('mousedown', (e) => { downAt = { x: e.clientX, y: e.clientY, t: performance.now() }; });
canvas.addEventListener('mouseup', (e) => {
  const d = downAt;
  downAt = null;
  if (!photo.active || !d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4 || performance.now() - d.t > 400) return;
  const r = canvas.getBoundingClientRect();
  if (photo.focusAt(stage.camera, e.clientX - r.left, e.clientY - r.top) !== null) photoPanel.sync();
});

/* ---------- busted, wasted: the hours that pass behind a curtain ---------- */
let scene: { left: number; until: number; done: () => void } | null = null;
const curtain = $('curtain');
function blackout(kind: 'busted' | 'wasted', title: string, text: string, minutes: number, done: () => void): void {
  if (scene) return;
  Input.releaseLock();
  phone.close();
  panels.closeAll();
  gps.clear();
  $('curtain-title').textContent = title;
  $('curtain-text').textContent = text;
  curtain.className = `on ${kind}`;
  requestAnimationFrame(() => curtain.classList.add('shown'));
  Game.setSpeed(1);
  scene = { left: minutes, until: performance.now() + 4200, done };
}
/** run the skipped hours a slice per frame, then lift the curtain */
function playScene(now: number): void {
  if (!scene) return;
  if (scene.left > 0) {
    const n = Math.min(scene.left, 45);
    Game.catchUp(n);
    scene.left -= n;
  }
  $('curtain-clock').textContent = `Day ${Sim.day} · ${Sim.timeStr()}`;
  if (scene.left <= 0 && now > scene.until) {
    const d = scene.done;
    scene = null;
    d();
    curtain.classList.remove('shown');
    setTimeout(() => { if (!scene) curtain.className = ''; }, 700);
  }
}
const nearestOf = (type: string, x: number, z: number): any =>
  World.buildings.filter((b: any) => b.type === type && b.connected && !b.ruined && !b.construction)
    .sort((a: any, b: any) => Math.hypot(a.door.x * TM - x, a.door.y * TM - z) - Math.hypot(b.door.x * TM - x, b.door.y * TM - z))[0] || null;
wanted.onBusted = (stars) => {
  if (scene) return;
  const x =founder.driving ? founder.car.x : founder.pos.x, z = founder.driving ? founder.car.z : founder.pos.z;
  const station = nearestOf('police', x, z) || Game.lodge();
  const why = wanted.why || 'resisting arrest', fine = FINES[stars];
  let car = '';
  if (founder.hijacked) car = ` The ${founder.hijacked.name} goes back to its owners.`;
  else if (founder.driving && founder.fleet.cur && station?.type === 'police') {
    const v = founder.fleet.cur;
    motoring.impound(v, station);
    car = ` The ${v.name} has been taken to the impound lot ($${IMPOUND_FEE} to collect).`;
  }
  wanted.returnAll();
  wanted.reset();
  const paid = motoring.fine(fine, `Fine · ${why}`);
  // late at night it's the cells till morning; by day, a few hours and a caution
  const night = Sim.clock >= 1200 || Sim.clock < 300;
  const minutes = night ? (7 * 60 - Sim.clock + 1440) % 1440 : 300;
  const owed = paid < fine ? ` ($${fine - paid} still owed)` : '';
  blackout('busted', 'Busted', `Arrested for ${why}: a $${fine} fine${owed} and ${night ? 'a night' : 'five hours'} in the cells.${car}`, minutes, () => {
    if (station) founder.stepOutOf(station);
    hud.toast(`🚔 Released from the ${station?.type === 'police' ? 'police station' : 'Lodge'} — behave yourself`, undefined, true);
  });
};
wanted.onWasted = () => {
  if (scene) return;
  const x =founder.driving ? founder.car.x : founder.pos.x, z = founder.driving ? founder.car.z : founder.pos.z;
  const hospital = nearestOf('hospital', x, z);
  const v = founder.vehicle;
  let car = '';
  if (founder.hijacked) car = ` The ${founder.hijacked.name} goes back to its owners.`;
  else if (v && founder.driving) {
    v.damage = Math.max(v.damage, 90);
    car = ` The ${v.name} was towed away, badly damaged.`;
    motoring.tow(v);
  }
  wanted.returnAll();
  wanted.reset();
  const bill = hospital ? Math.min(120, Math.max(0, Math.floor(founder.wallet))) : 0;
  if (bill) founder.purse.spend(bill, 'Hospital bill', 'purchase', hospital);
  const where = hospital ? `Patched up at the hospital${bill ? ` — the bill was $${bill}` : ''}.` : 'No hospital in the village: a neighbour patched you up at the Lodge.';
  blackout('wasted', 'Wasted', `${where}${car}`, 240, () => {
    const at = hospital || Game.lodge();
    if (at) founder.stepOutOf(at);
    hud.toast(hospital ? '🏥 Discharged from the hospital — take it easy on the roads' : '🩹 Back on your feet at the Lodge', undefined, true);
  });
};
let photoWanted = false;
const phone = new Phone({
  founder: () => ({ x: founder.driving ? founder.car.x : founder.pos.x, z: founder.driving ? founder.car.z : founder.pos.z, yaw: founder.driving ? founder.car.yaw : founder.yaw }),
  gps,
  purse: founder.purse,
  mapImage: () => hud.mapImage(),
  openPlanner: () => { if (!inPlanner()) togglePlanner(); },
  openSettings: () => panels.openSettings(),
  photo: () => { photoWanted = true; },
  photoMode: () => enterPhoto(),
  contacts: {
    list: () => contacts(Sim.people),
    call: (p) => callVillager(p),
    find: (p) => findVillager(p),
    job: (p) => jobName(p),
    opinion: (p) => { const o = Rep.of(p); return { label: Rep.label(o), k: o >= 1 ? 'ok' : o <= -1 ? 'bad' : '' }; },
  },
  bag: () => founder.bag,
  eat: (i) => {
    const it = founder.bag[i];
    if (!it) return;
    founder.bag.splice(i, 1);
    personalToast(`😋 ${/coffee|tea|chai|shake|cola|lemonade|drink|water|milk|white/i.test(it.name) ? 'You drink' : 'You eat'} the ${it.name.toLowerCase()} from the ${it.from}`);
  },
  garage: {
    list: () => founder.fleet.list,
    where: (v) => motoring.where(v),
    find: (v) => motoring.find(v, Game.lodge()),
    tow: (v) => motoring.tow(v),
    out: () => founder.vehicle,
    driving: () => founder.driving,
    owed: () => founder.fleet.owed,
  },
});
const togglePhone = (): void => {
  phone.toggle();
  if (phone.open) Input.releaseLock();
};
gps.onArrive = (d) => hud.toast(`🧭 You've arrived: ${d.label}`, undefined, true);
gps.onChange = () => document.body.classList.toggle('gps', !!gps.dest);
$('gps-stop').addEventListener('click', () => gps.clear());
// the wallet pill flashes green or red with every change
founder.purse.onChange = (e) => {
  const pill = $('wallet-pill');
  pill.classList.remove('flash-up', 'flash-down');
  void pill.offsetWidth; // restart the animation
  pill.classList.add(e.amount >= 0 ? 'flash-up' : 'flash-down');
  $('wallet').textContent = `$${Math.round(founder.wallet)}`;
};
actors.extra = (a) => {
  errands.draw((k, x, y, z, yaw, s, col) => a.prop(k, x, y, z, yaw, s, new THREE.Color(col)), (x, z) => founder.groundAt(x, z));
  wanted.draw(a);
};
planner.onBuilding = (b) => panels.showInfo(b);
planner.onPerson = (p) => panels.showPerson(p);
planner.onToolChange = (k) => hud.markTool(k);
planner.onEmptyClick = () => panels.hideInfo();
Input.attach(canvas);
initTouch();
canvas.addEventListener('click', () => {
  // with the phone out, the mouse stays free for it
  if (!planner.active && !panels.anyModalOpen() && !phone.open && !photo.active) Input.requestLock(canvas);
});

/* ---------- the frame loop ---------- */
let last = performance.now();
let lastHud = 0, lastPanel = 0, lastPhone = 0, lastVersion = -1, lastTrees = -1;
const tmpCam = new THREE.PerspectiveCamera();
const focus = new THREE.Vector3();

function interactions(): void {
  const prompt = $('prompt');
  let text = '';
  // an errand right here (a runaway dog to call, a dog to hand back) comes first
  const errand = errands.interaction();
  if (errand) {
    text = errand.text;
    if (Input.take('interact')) errand.act();
  } else if (founder.driving) {
    // at the pumps or the garage: fill up, get it mended
    const service = motoring.interaction();
    text = (service ? `${service.text} &nbsp; ` : '') + `<b>F</b> get ${founder.vehicle?.kind === 'moto' ? 'off' : 'out'}`;
    if (service && Input.take('interact')) service.act();
    if (Input.take('vehicle')) founder.exitCar();
  } else {
    // the nearest door, villager or the Founder's car
    let near: { kind: string; ref: any; d: number } | null = null;
    if (founder.nearCar()) near = { kind: 'car', ref: null, d: 0 };
    else if (founder.nearLeft()) near = { kind: 'left', ref: null, d: 0 };
    else {
      // a family's car in its drive: the Founder can take it (it's theft)
      const p = wanted.parkedNear();
      if (p) near = { kind: 'steal', ref: p, d: Math.hypot(p.x - founder.pos.x, p.z - founder.pos.z) };
    }
    for (const p of actors.pickables) {
      const d = Math.hypot(p.x - founder.pos.x, p.z - founder.pos.z);
      if (d < 2.6 && (!near || d < near.d)) near = { kind: 'person', ref: p.ref, d };
    }
    if (!near || (near.kind !== 'car' && near.kind !== 'left')) {
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
      const v = founder.vehicle!;
      text = v.damage >= 100 ? `The ${v.name} is wrecked — call a tow from the phone` : `<b>F</b> ${v.kind === 'moto' ? 'ride' : 'drive'} the ${v.name}`;
      if (Input.take('vehicle') && v.damage < 100) founder.enterCar();
    } else if (near?.kind === 'left') {
      // back to the Founder's own vehicle; the stolen one stays where it was left
      const v = founder.fleet.cur!;
      text = `<b>F</b> ${v.kind === 'moto' ? 'ride' : 'drive'} the ${v.name} (leave the stolen car)`;
      if (Input.take('vehicle')) { founder.dropHijacked(); if (v.damage < 100) founder.enterCar(); }
    } else if (near?.kind === 'steal') {
      text = `<b>F</b> steal the ${family(near.ref.b.residents[0]?.surname || 'neighbour')}' car`;
      if (Input.take('vehicle')) wanted.steal(near.ref);
    } else if (near?.kind === 'person') {
      text = `<b>E</b> talk to ${near.ref.name} ${near.ref.surname}`;
      if (Input.take('interact')) dialogue.start(near.ref);
    } else if (near?.kind === 'building') {
      // through the door if it's open to the Founder; otherwise the building's card
      const b = near.ref, d = CAT[b.type], why = doorState(b, householdView(b));
      if (why === null) {
        text = `<b>E</b> go into ${b.type === 'lodge' ? 'the Lodge, your home' : `the ${d.name}`}`;
        if (Input.take('interact')) goIn(b);
      } else {
        text = `<b>E</b> ${d.emoji} ${d.name}${why !== 'outdoor' ? ` — ${why}` : ''}`;
        if (Input.take('interact')) panels.showInfo(b);
      }
    }
  }
  prompt.innerHTML = text;
  prompt.style.display = text ? 'block' : 'none';
}

function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000 || 0.016);
  last = now;
  Input.poll();

  // behind the curtain (busted, wasted) the hours pass and nothing else happens
  if (scene) {
    playScene(now);
    Input.endFrame();
    requestAnimationFrame(frame);
    return;
  }

  // photo mode: the world is paused
  if (photo.active) {
    photoFrame(now, dt);
    Input.endFrame();
    requestAnimationFrame(frame);
    return;
  }

  // global actions
  const inside = indoors.active;
  if (inside) {
    const ph = Input.take('photo'), pl = Input.take('planner');
    if (ph || pl) hud.toast('🚪 Step outside first', undefined, true);
  }
  if (Input.take('photo') && !planner.active) { enterPhoto(); Input.endFrame(); requestAnimationFrame(frame); return; }
  if (Input.take('planner')) togglePlanner();
  if (Input.take('journal')) hud.toggleJournal();
  if (Input.take('help')) panels.show('help');
  if (Input.take('phone')) togglePhone();
  if (Input.take('cancel')) {
    if (dialogue.open) dialogue.close();
    else if (phone.open) phone.close();
    else if (planner.active && planner.tool) planner.setTool(null);
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
  if (buildings.treesVersion !== lastTrees) { lastTrees = buildings.treesVersion; terrain.setExtraTrees(buildings.trees()); }
  if (Sim.welcomeAt) { // the founding moment: fly over the first doorstep
    if (planner.active) planner.focus(Sim.welcomeAt.x * 0.5, Sim.welcomeAt.y * 0.5);
    Sim.welcomeAt = null;
  }

  // the player: inside a building, or out on the street
  const street = !planner.active && !inside;
  const free = !panels.anyModalOpen() && !dialogue.open;
  Input.dragLook = !planner.active;
  if (inside) {
    // the building burns, falls or is pulled down around you: out you go
    const b = indoors.b;
    if (!fading && (b.fire || b.ruined || !World.buildings.includes(b))) {
      if (b.fire) hud.toast(`🔥 Fire! Everyone out of the ${CAT[b.type].name}!`, undefined, true);
      dialogue.close();
      goOut();
    }
    const look = free && !phone.open ? Input.look(Settings.get('mouseSens') || 1, !!Settings.get('invertY')) : { dx: 0, dy: 0 };
    indoors.update(dt, free && !phone.open ? Input.move() : { x: 0, y: 0 }, look, Input.running(), 1 - stage.night, lightsOn.value);
    if (free) indoorInteractions();
    else $('prompt').style.display = 'none';
  } else if (street && free) {
    founder.update(dt);
    interactions();
  } else if (!street) $('prompt').style.display = 'none';
  planner.update(dt);
  // errands and directions follow the Founder (in the car, from the car)
  const fx = founder.driving ? founder.car.x : founder.pos.x, fz = founder.driving ? founder.car.z : founder.pos.z;
  errands.update(dt, street && free);
  motoring.update(dt);
  if (street && free) {
    wanted.update(dt);
    streetLife.update(dt);
  }
  gps.update(dt, fx, fz);

  // cameras: street, aerial, or a blend while rising/descending (indoors, the room's own)
  stage.camera.fov = Settings.get('fov') || 70;
  stage.camera.updateProjectionMatrix();
  if (inside) focus.copy(founder.pos);
  else if (planner.active) {
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
  if (!inside) {
    terrain.frame(stage.night, stage.camera.position);
    actors.update(dt, focus.x, focus.z, range, now, stage.night);
  }
  if (gps.dest && street) arrows.update(dt, gps.route, fx, fz, (x, z) => founder.groundAt(x, z), stage.sky.exposure, stage.night);
  else arrows.hide();
  stage.render();
  // a photo is the frame just drawn (the canvas holds no interface), read before the browser shows it
  if (photoWanted) {
    photoWanted = false;
    try {
      phone.addPhoto(canvas.toDataURL('image/jpeg', 0.92));
      Snd.tone(1800, 900, 0.08, 0.05, 'square');
    } catch { hud.toast('📷 The camera could not take a photo here'); }
  }

  // HUD
  if (now - lastHud > 400) {
    lastHud = now;
    hud.update();
    const w = planner.active ? planner.dist * 1.6 : 0;
    hud.drawMinimap({ x: planner.active ? planner.target.x : fx, z: planner.active ? planner.target.z : fz, yaw: founder.driving ? founder.car.yaw : founder.yaw, planner: planner.active, w, h: w * 0.7, route: gps.route, dest: gps.dest });
    $('wallet').textContent = `$${Math.round(founder.wallet)}`;
    if (gps.dest) $('gps-text').textContent = `${gps.dest.label} · ${distLabel(gps.left)}`;
    const speedo = founder.driving ? `${Math.round(founder.speedKmh)} km/h` : '';
    if ($('speedo').textContent !== speedo) $('speedo').textContent = speedo;
    document.body.classList.toggle('driving', founder.driving);
    const veh = founder.vehicle;
    if (veh && founder.driving) {
      $('fuel-bar').style.width = `${Math.round(veh.fuel * 100)}%`;
      $('fuel-bar').parentElement!.classList.toggle('low', veh.fuel < 0.15);
      const cond = veh.damage >= 25 ? `<svg><use href="#i-wrench"/></svg>${Math.round(100 - veh.damage)}%` : '';
      if ($('cond').innerHTML !== cond) $('cond').innerHTML = cond;
      $('cond').classList.toggle('bad', veh.damage >= 50);
    }
    const mode = founder.driving ? 'car' : founder.firstPerson ? 'eye' : '';
    if ($('modebadge').dataset.m !== mode) {
      $('modebadge').dataset.m = mode;
      $('modebadge').innerHTML = mode ? `<svg><use href="#i-${mode}"/></svg>${mode === 'car' ? 'Driving' : 'First person'}` : '';
    }
    // what the village thinks of the Founder: a word, and a meter either side of indifference
    const town = Rep.town(), repPill = $('rep-pill'), repBar = $('rep-bar');
    if ($('rep-label').textContent !== town.label) $('rep-label').textContent = town.label;
    const rw = Math.min(50, Math.abs(town.score) * 5);
    repBar.style.left = `${town.score >= 0 ? 50 : 50 - rw}%`;
    repBar.style.width = `${rw}%`;
    repBar.classList.toggle('neg', town.score < 0);
    repPill.classList.toggle('good', town.score >= 1);
    repPill.classList.toggle('bad', town.score <= -1);
    repPill.title = `What the village thinks of you: ${town.label.toLowerCase()} · ${Math.round(town.known * 100)}% of villagers have an opinion of you`;
    // the wanted level: lit stars, flashing while a crew has eyes on the Founder, and how close they are to losing them
    document.body.classList.toggle('wanted', wanted.stars > 0);
    if (wanted.stars > 0) {
      const stars = `<b>${'★'.repeat(wanted.stars)}</b>${'★'.repeat(5 - wanted.stars)}`;
      if ($('stars').innerHTML !== stars) $('stars').innerHTML = stars;
      $('wanted').classList.toggle('seen', wanted.seen);
      $('escape').style.width = `${Math.round(wanted.escape() * 100)}%`;
    }
    if (planner.active) hud.markTool(planner.tool);
    else {
      const hint = Input.usingTouch ? 'Left thumb moves · right thumb looks'
        : indoors.active ? `${Input.locked ? '' : 'Drag to look · '}${WASD} walk · <kbd>E</kbd> use or talk · <kbd>Tab</kbd> phone`
        : Input.locked ? `${WASD} move · <kbd>Shift</kbd> run · <kbd>F</kbd> drive · <kbd>Tab</kbd> phone · <kbd>F2</kbd> photo · <kbd>P</kbd> Planner · <kbd>Esc</kbd> frees the mouse`
          : `Drag to look · ${WASD} move · <kbd>F</kbd> drive · <kbd>Tab</kbd> phone · <kbd>F2</kbd> photo · <kbd>P</kbd> Planner`;
      if ($('hint').innerHTML !== hint) $('hint').innerHTML = hint;
    }
  }
  if (now - lastPanel > 1200) { lastPanel = now; panels.refresh(); }
  if (now - lastPhone > 150) { lastPhone = now; phone.tick(); }

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
  if (document.hidden && !photo.active) Game.catchUp(elapsed); // (photo mode holds the world still)
}, 1000);

/* boot: continue the last village if there is one, build it a slice at a time
   behind the loading screen, light it and compile every shader off-frame (a cold
   compile on frame one can stall an integrated GPU long enough to lose the context) */
async function boot(): Promise<void> {
  const text = $('loading-text'), bar = $('loading-bar');
  const step = (msg: string, k: number): void => {
    if (text.textContent !== msg && !msg.startsWith('Raising')) performance.mark(`boot:${msg}`);
    text.textContent = msg;
    bar.style.width = `${Math.round(k * 100)}%`;
  };
  step('Opening the village records…', 0.05);
  let resumed = false;
  try {
    const data = await get(AUTO);
    if (data) resumed = Game.performLoad(data).ok;
  } catch { /* a fresh village */ }
  step('Laying out the land…', 0.12);
  await yieldFrame();
  terrain.update(true);
  lastVersion = Game.mapVersion;
  await buildings.buildAll((done, total) => step(`Raising the buildings… ${done} of ${total}`, 0.15 + 0.6 * (done / Math.max(1, total))));
  step('Painting textures…', 0.78);
  await texturesReady();
  step('Lighting the village…', 0.85);
  await yieldFrame();
  try { await stage.warmUp(); } catch { /* draw anyway */ }
  step('Ready', 1);
  requestAnimationFrame((t) => {
    last = t;
    frame(t);
    const l = $('loading');
    l.style.opacity = '0';
    setTimeout(() => l.remove(), 700);
    if (resumed) hud.toast(`👋 Welcome back to ${World.name} — day ${Sim.day}, ${Sim.people.length} villagers`);
    else panels.show('help');
  });
}
void boot();

// debugging handle for the console
(window as unknown as Record<string, unknown>).PV = { Game, Sim, World, stage, founder, planner, actors, buildings, terrain, Input, gps, errands, phone, motoring, showroom, wanted, Life, Rep, streetLife, panels, photo, enterPhoto, leavePhoto, indoors, goIn, goOut, counter, dialogue, chatClient };

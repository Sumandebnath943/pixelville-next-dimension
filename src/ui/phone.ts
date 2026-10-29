/* ============================================================
   The phone (design §4.5): the Founder's pocket screen, on Tab.
   Map with GPS (tap a place, or anywhere on the map, and the
   route appears on the road), Wallet with the ledger, PVTV
   with the headlines and the markets, the task book, a camera,
   and shortcuts to the Planner and Settings.
   ============================================================ */
import { Sim } from '../sim/agents';
import { World, GW, GH } from '../sim/world';
import { CAT } from '../sim/catalog';
import { Tasks } from '../sim/tasks';
import { Game } from '../sim/game';
import type { Gps } from '../player/gps';
import { distLabel } from '../player/gps';
import type { Wallet } from '../player/wallet';
import type { Vehicle } from '../player/fleet';
import { icon, splitLead } from './hud';
import { keys } from '../input/input';

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const TM = 8;

export interface PhoneApi {
  founder(): { x: number; z: number; yaw: number };
  gps: Gps;
  purse: Wallet;
  /** the minimap's picture of the map (one pixel per tile) */
  mapImage(): ImageData | null;
  openPlanner(): void;
  openSettings(): void;
  /** take a photo on the next frame; the phone gets it back through addPhoto */
  photo(): void;
  /** put the phone away and open photo mode */
  photoMode(): void;
  /** villagers the Founder has talked to */
  contacts: {
    list(): any[];
    call(p: any): void;
    find(p: any): void;
    job(p: any): string;
    opinion(p: any): { label: string; k: string };
  };
  /** what the Founder is carrying; eat or drink item `i` */
  bag(): { name: string; from: string; day: number; food?: boolean; ticket?: boolean }[];
  eat(i: number): void;
  /** Milestone 5: a cab, the timetables, and trips off the map (with the gateway to go to) */
  ride: {
    callCab(): void;
    timetable(): { title: string; sub: string }[];
    trips(): { title: string; sub: string; go?: () => void }[];
  };
  /** Milestone 6: the work shifts, for the Jobs app */
  jobs: {
    list(): { id: string; title: string; emoji: string; wave: string; blurb: string; where: string; ok: boolean; why: string | null; pay: string; worked: number; best: number }[];
    current(): { emoji: string; title: string; place: string; text: string; left: string; earned: number; stars: string; lock: string | null } | null;
    go(id: string): void;
    end(): void;
    record(): { n: Record<string, number>; earned: number; hours: number; owed: number };
  };
  /** the Founder's vehicles, for the Garage app */
  garage: {
    list(): Vehicle[];
    where(v: Vehicle): string;
    find(v: Vehicle): void;
    tow(v: Vehicle): void;
    out(): Vehicle | null;
    driving(): boolean;
    owed(): number;
  };
}

type App = 'home' | 'map' | 'wallet' | 'pvtv' | 'tasks' | 'camera' | 'garage' | 'contacts' | 'ride' | 'jobs';
const APPS: { id: App | 'planner' | 'settings'; name: string; icon: string; tint: string }[] = [
  { id: 'map', name: 'Map', icon: 'map', tint: '#3f8f86' },
  { id: 'jobs', name: 'Jobs', icon: 'hardhat', tint: '#c46a2a' },
  { id: 'ride', name: 'Ride', icon: 'bus', tint: '#c8962e' },
  { id: 'contacts', name: 'Contacts', icon: 'people', tint: '#4a8a5a' },
  { id: 'wallet', name: 'Wallet', icon: 'wallet', tint: '#c08a3a' },
  { id: 'garage', name: 'Garage', icon: 'car', tint: '#3a6a9a' },
  { id: 'pvtv', name: 'PVTV', icon: 'tv', tint: '#b8473f' },
  { id: 'tasks', name: 'Tasks', icon: 'book', tint: '#6a55a8' },
  { id: 'camera', name: 'Camera', icon: 'camera', tint: '#4a5568' },
  { id: 'planner', name: 'Planner', icon: 'crane', tint: '#8a6a2a' },
  { id: 'settings', name: 'Settings', icon: 'gear', tint: '#5a6270' },
];

export class Phone {
  open = false;
  private app: App = 'home';
  private photos: string[] = [];
  // the map app's view: centre (tiles) and zoom (tiles across)
  private mapC = { x: GW / 2, y: GH / 2 };
  private mapSpan = 96;
  private query = '';
  private follow = true;
  private tile = document.createElement('canvas');

  constructor(private api: PhoneApi) {
    this.tile.width = GW; this.tile.height = GH;
  }

  toggle(): void { if (this.open) this.close(); else this.show(); }
  show(app: App = this.app): void {
    this.open = true;
    document.body.classList.add('phone');
    this.go(app);
  }
  close(): void {
    this.open = false;
    document.body.classList.remove('phone');
  }
  private go(app: App): void {
    this.app = app;
    if (app === 'map') this.follow = true;
    this.render();
  }

  /** keep the open screen current (called a few times a second) */
  tick(): void {
    if (!this.open) return;
    $('ph-clock').textContent = Sim.timeStr();
    if (this.app === 'map') this.drawMap();
    if (this.app === 'home' || this.app === 'wallet') this.refreshNumbers();
  }

  addPhoto(url: string): void {
    this.photos.unshift(url);
    if (this.photos.length > 12) this.photos.pop();
    if (this.open && this.app === 'camera') this.render();
  }

  /* ---------- screens ---------- */
  private render(): void {
    $('ph-clock').textContent = Sim.timeStr();
    const body = $('ph-body');
    const head = (title: string): string => `<div class="ph-head"><button class="ib" data-go="home" title="Home">${icon('back')}</button><span>${title}</span></div>`;
    switch (this.app) {
      case 'home': body.innerHTML = this.homeHtml(); break;
      case 'map': body.innerHTML = head('Map') + this.mapHtml(); break;
      case 'wallet': body.innerHTML = head('Wallet') + `<div class="ph-scroll">${this.walletHtml()}</div>`; break;
      case 'pvtv': body.innerHTML = head('PVTV') + `<div class="ph-scroll">${this.pvtvHtml()}</div>`; break;
      case 'tasks': body.innerHTML = head('Tasks') + `<div class="ph-scroll">${this.tasksHtml()}</div>`; break;
      case 'camera': body.innerHTML = head('Camera') + `<div class="ph-scroll">${this.cameraHtml()}</div>`; break;
      case 'garage': body.innerHTML = head('Garage') + `<div class="ph-scroll">${this.garageHtml()}</div>`; break;
      case 'contacts': body.innerHTML = head('Contacts') + `<div class="ph-scroll">${this.contactsHtml()}</div>`; break;
      case 'ride': body.innerHTML = head('Ride') + `<div class="ph-scroll">${keys(this.rideHtml())}</div>`; break;
      case 'jobs': body.innerHTML = head('Jobs') + `<div class="ph-scroll">${keys(this.jobsHtml())}</div>`; break;
    }
    if (this.app === 'jobs') {
      body.querySelector('#ph-clockoff')?.addEventListener('click', () => { this.api.jobs.end(); this.render(); });
      body.querySelectorAll<HTMLElement>('[data-job]').forEach((el) => el.addEventListener('click', () => { this.api.jobs.go(el.dataset.job!); this.close(); }));
    }
    if (this.app === 'ride') {
      body.querySelector('#ph-cab')?.addEventListener('click', () => { this.api.ride.callCab(); this.close(); });
      const trips = this.api.ride.trips();
      body.querySelectorAll<HTMLElement>('[data-trip]').forEach((el) => el.addEventListener('click', () => { trips[+el.dataset.trip!].go?.(); this.go('map'); }));
    }
    if (this.app === 'contacts') {
      const c = this.api.contacts;
      const who = (id: string): any => c.list().find((p) => p.id === +id);
      body.querySelectorAll<HTMLElement>('[data-call]').forEach((el) => el.addEventListener('click', () => { const p = who(el.dataset.call!); if (p) c.call(p); }));
      body.querySelectorAll<HTMLElement>('[data-where]').forEach((el) => el.addEventListener('click', () => { const p = who(el.dataset.where!); if (p) { c.find(p); this.go('map'); } }));
    }
    if (this.app === 'wallet') {
      body.querySelectorAll<HTMLElement>('[data-eat]').forEach((el) => el.addEventListener('click', () => { this.api.eat(+el.dataset.eat!); this.render(); }));
    }
    if (this.app === 'garage') {
      const g = this.api.garage;
      body.querySelectorAll<HTMLElement>('[data-find]').forEach((el) => el.addEventListener('click', () => {
        const v = g.list().find((q) => q.id === +el.dataset.find!);
        if (v) { g.find(v); this.go('map'); }
      }));
      body.querySelectorAll<HTMLElement>('[data-tow]').forEach((el) => el.addEventListener('click', () => {
        const v = g.list().find((q) => q.id === +el.dataset.tow!);
        if (v) { g.tow(v); this.render(); }
      }));
    }
    body.querySelectorAll<HTMLElement>('[data-go]').forEach((b) => b.addEventListener('click', () => this.go(b.dataset.go as App)));
    body.querySelectorAll<HTMLElement>('[data-app]').forEach((b) => b.addEventListener('click', () => this.launch(b.dataset.app!)));
    if (this.app === 'map') this.wireMap();
    if (this.app === 'camera') {
      body.querySelector('#ph-shoot')?.addEventListener('click', () => this.api.photo());
      body.querySelector('#ph-photomode')?.addEventListener('click', () => this.api.photoMode());
    }
  }
  private launch(id: string): void {
    if (id === 'planner') { this.close(); this.api.openPlanner(); return; }
    if (id === 'settings') { this.close(); this.api.openSettings(); return; }
    this.go(id as App);
  }

  /** Jobs: the shift you're on (and clocking off), and every job in town with where it's worked */
  private jobsHtml(): string {
    const j = this.api.jobs, cur = j.current();
    let h = '';
    if (cur) {
      h += `<div class="ph-balance"><span>${cur.emoji} ${esc(cur.title)} · ${esc(cur.place)}</span><b>$${cur.earned}</b><small>${esc(cur.text)} · ${esc(cur.left)} · ${cur.stars}</small></div>`;
      h += `<button class="ph-wide primary" id="ph-clockoff"${cur.lock ? ` disabled title="${esc(cur.lock)}"` : ''}>${icon('hardhat')}${cur.lock ? esc(cur.lock) : 'Clock off and get paid'}</button>`;
    } else {
      const r = j.record(), n = Object.values(r.n).reduce((s, k) => s + k, 0);
      h += `<p class="note">${n ? `${n} shift${n > 1 ? 's' : ''} worked, ${r.hours} hours, $${Math.round(r.earned)} earned${r.owed >= 1 ? ` — and the village fund owes you $${Math.round(r.owed)}` : ''}.` : 'Pick a job: the phone routes you to the workplace and the shift starts at the door.'} Pay is by the hour plus every task, scaled by how well it went.</p>`;
    }
    let wave = '';
    for (const o of j.list()) {
      if (o.wave !== wave) { wave = o.wave; h += `<div class="ph-sep">${esc(wave)}</div>`; }
      const rec = o.worked ? `<span class="pill ok">${o.worked}× · ${'★'.repeat(Math.round(o.best))}</span>` : '';
      h += `<div class="ph-veh">
        <div class="ph-row"><span class="ico">${o.emoji}</span><span class="grow"><b>${esc(o.title)}</b><small>${esc(o.where)}</small></span>${rec}</div>
        <p class="ph-job">${esc(o.blurb)} · <i>${esc(o.pay)}</i></p>
        ${cur ? '' : `<div class="ph-acts"><button data-job="${o.id}"${o.ok ? '' : ' disabled'}>${icon('pin')}${o.ok ? 'Start a shift' : esc(o.why || 'Not here yet')}</button></div>`}
      </div>`;
    }
    return h;
  }

  /** Ride: a cab to the GPS destination, the timetables, and the trips off the map */
  private rideHtml(): string {
    const r = this.api.ride;
    const g = this.api.gps;
    let h = `<button class="ph-wide primary" id="ph-cab">${icon('car')}Call a cab${g.dest ? ` to ${esc(g.dest.label)}` : ''}</button>`;
    if (!g.dest) h += '<p class="note">Pick a destination on the Map first, or tell the driver when the cab comes.</p>';
    const tt = r.timetable();
    h += `<h2>Timetables</h2>${tt.length ? tt.map((t) => `<div class="save-slot"><span class="slot-name">${esc(t.title)}<small>${esc(t.sub)}</small></span></div>`).join('') : '<p class="note">No buses, trains or ferries run yet.</p>'}`;
    const trips = r.trips();
    h += `<h2>Trips off the map</h2>${trips.map((t, i) => `<div class="save-slot"><span class="slot-name">${esc(t.title)}<small>${esc(t.sub)}</small></span>${t.go ? `<button data-trip="${i}">${icon('pin')}</button>` : ''}</div>`).join('')}`;
    h += '<p class="note">At a stop, a station, a dock, a rank, the airport or a heliport, <b>{vehicle}</b> shows what leaves from there.</p>';
    return h;
  }

  private homeHtml(): string {
    const date = Game.dateLine().split(' · ');
    const g = this.api.gps;
    return `<div class="ph-home">
      <div class="ph-big" id="ph-big">${Sim.timeStr()}</div>
      <div class="ph-date">${esc(date[1] || '')}</div>
      <button class="ph-card" data-app="wallet"><span>Wallet</span><b id="ph-bal">$${Math.round(this.api.purse.balance)}</b></button>
      ${g.dest ? `<button class="ph-card route" data-app="map">${icon('pin')}<span>${esc(g.dest.label)}</span><b>${distLabel(g.left)}</b></button>` : ''}
      <div class="ph-apps">${APPS.map((a) => `<button class="ph-app" data-app="${a.id}"><i style="--tint:${a.tint}">${icon(a.icon)}</i><span>${a.name}</span></button>`).join('')}</div>
    </div>`;
  }
  private refreshNumbers(): void {
    const b = document.getElementById('ph-bal');
    if (b) b.textContent = `$${Math.round(this.api.purse.balance)}`;
    const t = document.getElementById('ph-big');
    if (t) t.textContent = Sim.timeStr();
  }

  private walletHtml(): string {
    const w = this.api.purse;
    const t = w.day();
    let h = `<div class="ph-balance"><span>Balance</span><b>$${Math.round(w.balance)}</b><small>Today: <em class="up">+$${t.in}</em> · <em class="down">−$${t.out}</em></small></div>`;
    // V2: bills for what was already had (a cab, the hospital), owed until there's money to pay them
    for (const b of w.bills) h += `<div class="ph-route"><span class="grow">Owed · ${esc(b.label)}<small>Paid off as money comes in</small></span><b class="down">$${Math.round(b.n)}</b></div>`;
    const bag = this.api.bag();
    if (bag.length) {
      h += '<div class="ph-sep">In your bag</div>';
      bag.forEach((it, i) => {
        h += `<div class="ph-row"><span class="grow">${esc(it.name)}<small>From the ${esc(it.from)} · day ${it.day}</small></span>${it.food ? `<button class="ph-mini" data-eat="${i}">${/coffee|tea|chai|shake|cola|lemonade|drink|water|milk|white/i.test(it.name) ? 'Drink' : 'Eat'}</button>` : it.ticket ? '<small>Ticket</small>' : ''}</div>`;
      });
    }
    if (!w.ledger.length) h += '<p class="ph-empty">Nothing in or out yet. Small kindnesses pay: a lost dog, a hand at a fire.</p>';
    else {
      h += '<div class="ph-sep">History</div>';
      for (const e of w.ledger.slice().reverse()) {
        h += `<div class="ph-row"><span class="grow">${esc(e.label)}<small>Day ${e.day} · ${e.time}</small></span><b class="${e.amount >= 0 ? 'up' : 'down'}">${e.amount >= 0 ? '+' : '−'}$${Math.abs(e.amount)}</b></div>`;
      }
    }
    return h;
  }

  private pvtvHtml(): string {
    let h = '';
    if (Sim.stocks) {
      h += `<div class="ph-sep">Markets · PVX ${Sim.stockIndex()}</div><div class="ph-ticks">`;
      for (const q of Sim.stocks) {
        const up = q.price >= (q.prev || q.price);
        h += `<div class="ph-tick"><b>${esc(q.sym)}</b><span>$${q.price.toFixed(1)}</span><em class="${up ? 'up' : 'down'}">${up ? '▲' : '▼'}</em></div>`;
      }
      h += '</div>';
    }
    h += '<div class="ph-sep">Headlines</div>';
    const news = Tasks.news.slice(-40).reverse();
    if (!news.length) h += '<p class="ph-empty">A quiet day. It won\'t last.</p>';
    for (const n of news) {
      const { ico, text } = splitLead(n.text);
      h += `<div class="ph-row news"><span class="ico">${ico}</span><span class="grow">${esc(text)}<small>Day ${n.day} · ${n.time}</small></span></div>`;
    }
    return h;
  }

  private tasksHtml(): string {
    const active = Tasks.items.filter((t: any) => !t.done).slice().reverse();
    const done = Tasks.items.filter((t: any) => t.done).slice().reverse().slice(0, 25);
    let h = '';
    if (!active.length && !done.length) h += '<p class="ph-empty">No village projects yet.</p>';
    for (const t of active) h += `<div class="ph-row"><span class="ico">${t.icon}</span><span class="grow">${esc(t.text)}<small>Day ${t.day}</small></span></div>`;
    if (done.length) h += '<div class="ph-sep">Completed</div>';
    for (const t of done) h += `<div class="ph-row done"><span class="ico ${t.ok ? 'up' : 'down'}">${t.ok ? '✓' : '✕'}</span><span class="grow">${esc(t.text)}<small>Day ${t.doneDay}</small></span></div>`;
    return h;
  }

  private garageHtml(): string {
    const g = this.api.garage;
    const list = g.list();
    let h = '';
    if (g.owed() > 0) h += `<div class="ph-route"><span class="grow">Unpaid fines<small>Taken from your wallet as money comes in</small></span><b class="down">$${Math.round(g.owed())}</b></div>`;
    if (!list.length) return h + '<p class="ph-empty">You own nothing on wheels. The showrooms sell cars and motorcycles.</p>';
    for (const v of list) {
      const out = g.out() === v;
      h += `<div class="ph-veh">
        <div class="ph-row"><span class="ico"><i class="dot" style="background:${v.color}"></i></span><span class="grow"><b>${esc(v.name)}</b><small>${esc(g.where(v))}</small></span></div>
        <div class="ph-meters"><span>Fuel</span><i class="gauge${v.fuel < 0.15 ? ' low' : ''}"><b style="width:${Math.round(v.fuel * 100)}%"></b></i><span>Condition</span><i class="gauge${v.damage >= 50 ? ' low' : ''}"><b style="width:${Math.round(100 - v.damage)}%"></b></i></div>
        <div class="ph-acts"><button data-find="${v.id}">${icon('pin')}Find</button>${out && !g.driving() ? `<button data-tow="${v.id}">Call a tow · $35</button>` : ''}</div>
      </div>`;
    }
    return h + '<p class="ph-empty">Only one vehicle is out at a time; the rest wait in the Lodge garage. Park at the kerb, away from junctions and bus stops: where there\'s a police station, there are wardens.</p>';
  }

  private contactsHtml(): string {
    const list = this.api.contacts.list();
    if (!list.length) return '<p class="ph-empty">Nobody yet. Talk to villagers (<kbd>E</kbd> beside them, in the street or inside) and they\'ll be here to call.</p>';
    let h = '';
    for (const p of list) {
      const met = p.mind.flags.met, op = this.api.contacts.opinion(p);
      h += `<div class="ph-veh">
        <div class="ph-row"><span class="grow"><b>${esc(p.name)} ${esc(p.surname)}</b><small>${esc(this.api.contacts.job(p))} · last talked ${met.l === Sim.day ? 'today' : met.l === Sim.day - 1 ? 'yesterday' : `day ${met.l}`}${met.s ? `, about ${esc(met.s)}` : ''}</small></span><span class="pill ${op.k}">${esc(op.label)}</span></div>
        <div class="ph-acts"><button data-call="${p.id}">${icon('phone')}Call</button><button data-where="${p.id}">${icon('pin')}Find</button></div>
      </div>`;
    }
    return h;
  }

  private cameraHtml(): string {
    let h = `<button class="primary ph-wide" id="ph-shoot">${icon('camera')}Take a photo</button>
      <button class="ph-wide" id="ph-photomode">${icon('eye')}Photo mode <kbd>F2</kbd></button>
      <p class="ph-empty">A photo is the view behind the phone, without the interface. Photo mode pauses the world and frees the camera: lens, focus, a look, another hour or weather, and a full-size PNG.</p>`;
    if (this.photos.length) {
      h += '<div class="ph-sep">This session</div><div class="ph-photos">';
      this.photos.forEach((u, i) => { h += `<a href="${u}" download="pixelville-photo-${Sim.day}-${i + 1}.jpg" title="Save this photo"><img src="${u}" alt="Photo ${i + 1}" /></a>`; });
      h += '</div>';
    }
    return h;
  }

  /* ---------- the map app ---------- */
  private mapHtml(): string {
    const g = this.api.gps;
    const route = g.dest
      ? `<div class="ph-route">${icon('pin')}<span class="grow">${esc(g.dest.label)}<small id="ph-left">${distLabel(g.left)} to go</small></span><button id="ph-stop">Stop</button></div>`
      : '<div class="ph-route hint">Tap a place below, or anywhere on the map, to get directions.</div>';
    return `<div class="ph-mapwrap"><canvas id="ph-map" width="600" height="600"></canvas>
      <div class="ph-mapbtns"><button class="ib" id="ph-zin" title="Zoom in">${icon('plus')}</button><button class="ib" id="ph-zout" title="Zoom out">${icon('minus')}</button><button class="ib" id="ph-me" title="Centre on me">${icon('locate')}</button></div></div>
      ${route}
      <label class="ph-search">${icon('search')}<input id="ph-q" placeholder="Find a place" spellcheck="false" value="${esc(this.query)}" /></label>
      <div class="ph-scroll" id="ph-places">${this.placesHtml()}</div>`;
  }
  private placesHtml(): string {
    const f = this.api.founder();
    const q = this.query.trim().toLowerCase();
    const rows = World.buildings
      .filter((b: any) => !b.ruined && (!q || CAT[b.type].name.toLowerCase().includes(q) || b.type.includes(q)))
      .map((b: any) => ({ b, d: Math.hypot(b.door.x * TM + 4 - f.x, b.door.y * TM + 4 - f.z) }))
      .sort((a: any, c: any) => a.d - c.d)
      .slice(0, 40);
    if (!rows.length) return '<p class="ph-empty">Nothing by that name.</p>';
    return rows.map(({ b, d }: any) => `<button class="ph-row place" data-b="${b.id}"><span class="ico">${CAT[b.type].emoji}</span><span class="grow">${esc(CAT[b.type].name)}${b.construction ? '<small>Under construction</small>' : ''}</span><b>${distLabel(d)}</b></button>`).join('');
  }
  private wireMap(): void {
    const c = $('ph-map') as HTMLCanvasElement;
    let drag: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
    c.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, cx: this.mapC.x, cy: this.mapC.y, moved: false }; c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const k = this.mapSpan / c.clientWidth;
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) { drag.moved = true; this.follow = false; }
      this.mapC.x = drag.cx - (e.clientX - drag.x) * k;
      this.mapC.y = drag.cy - (e.clientY - drag.y) * k;
      this.drawMap();
    });
    c.addEventListener('pointerup', (e) => {
      const d = drag;
      drag = null;
      if (!d || d.moved) return;
      // a tap: directions to whatever is there
      const r = c.getBoundingClientRect();
      const tx = this.mapC.x + ((e.clientX - r.left) / r.width - 0.5) * this.mapSpan;
      const ty = this.mapC.y + ((e.clientY - r.top) / r.height - 0.5) * this.mapSpan;
      const b = World.buildingAt(Math.floor(tx), Math.floor(ty));
      if (b) this.routeTo(b);
      else this.api.gps.set(tx * TM, ty * TM, 'Dropped pin');
      this.render();
    });
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom(e.deltaY > 0 ? 1.4 : 1 / 1.4); }, { passive: false });
    $('ph-zin').addEventListener('click', () => this.zoom(1 / 1.6));
    $('ph-zout').addEventListener('click', () => this.zoom(1.6));
    $('ph-me').addEventListener('click', () => { this.follow = true; this.drawMap(); });
    document.getElementById('ph-stop')?.addEventListener('click', () => { this.api.gps.clear(); this.render(); });
    const qi = $('ph-q') as HTMLInputElement;
    qi.addEventListener('input', () => {
      this.query = qi.value;
      $('ph-places').innerHTML = this.placesHtml();
      this.wirePlaces();
    });
    // keep typing out of the game's controls
    qi.addEventListener('keydown', (e) => e.stopPropagation());
    this.wirePlaces();
    this.drawMap();
  }
  private wirePlaces(): void {
    document.querySelectorAll<HTMLElement>('#ph-places [data-b]').forEach((el) => el.addEventListener('click', () => {
      const b = World.buildings.find((q: any) => q.id === +el.dataset.b!);
      if (b) { this.routeTo(b); this.follow = true; this.render(); }
    }));
  }
  private routeTo(b: any): void {
    this.api.gps.set(b.door.x * TM + 4, b.door.y * TM + 4, CAT[b.type].name);
  }
  private zoom(k: number): void {
    this.mapSpan = Math.max(24, Math.min(256, this.mapSpan * k));
    this.drawMap();
  }

  private drawMap(): void {
    const c = document.getElementById('ph-map') as HTMLCanvasElement | null;
    if (!c) return;
    const g = c.getContext('2d')!;
    const img = this.api.mapImage();
    const f = this.api.founder();
    if (this.follow) { this.mapC.x = f.x / TM; this.mapC.y = f.z / TM; }
    const span = this.mapSpan, W = c.width, k = W / span;
    const x0 = this.mapC.x - span / 2, y0 = this.mapC.y - span / 2;
    g.fillStyle = '#0d1117';
    g.fillRect(0, 0, W, W);
    if (img) {
      this.tile.getContext('2d')!.putImageData(img, 0, 0);
      g.imageSmoothingEnabled = false;
      g.drawImage(this.tile, x0, y0, span, span, 0, 0, W, W);
    }
    const sx = (tx: number): number => (tx - x0) * k, sy = (ty: number): number => (ty - y0) * k;
    // the route
    const gps = this.api.gps;
    if (gps.dest) {
      g.lineJoin = 'round'; g.lineCap = 'round';
      if (gps.route.length) {
        g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = Math.max(5, k * 0.9);
        g.beginPath(); g.moveTo(sx(f.x / TM), sy(f.z / TM));
        for (const [x, y] of gps.route) g.lineTo(sx(x + 0.5), sy(y + 0.5));
        g.stroke();
        g.strokeStyle = '#f0c27a'; g.lineWidth = Math.max(3, k * 0.55);
        g.stroke();
      }
      const dx = sx(gps.dest.x / TM), dy = sy(gps.dest.z / TM);
      g.fillStyle = '#f0c27a'; g.strokeStyle = '#1d160a'; g.lineWidth = 2;
      g.beginPath(); g.arc(dx, dy - 14, 9, Math.PI * 0.85, Math.PI * 2.15); g.lineTo(dx, dy); g.closePath(); g.fill(); g.stroke();
    }
    // the Founder
    g.save();
    g.translate(sx(f.x / TM), sy(f.z / TM));
    g.rotate(-f.yaw + Math.PI);
    g.fillStyle = '#ffffff'; g.strokeStyle = '#1d160a'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, -11); g.lineTo(8, 9); g.lineTo(0, 4); g.lineTo(-8, 9); g.closePath(); g.fill(); g.stroke();
    g.restore();
    const left = document.getElementById('ph-left');
    if (left && gps.dest) left.textContent = `${distLabel(gps.left)} to go`;
  }
}

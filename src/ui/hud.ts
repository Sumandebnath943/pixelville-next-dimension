/* ============================================================
   HUD: V1's dashboard carried into 3D — clock & date, season,
   weather with forecast, tier, population, jobs, wealth, safety,
   happiness, leadership; speed buttons; toasts (clickable ones
   fly the Planner there or drop a pin); PVTV with the stock
   ticker; the minimap with the Founder on it; R/C/I demand; the
   Planner palette; and the task book.
   ============================================================ */
import { Sim, TIERS } from '../sim/agents';
import { Weather } from '../sim/weather';
import { Gov } from '../sim/gov';
import { Festivals } from '../sim/festivals';
import { Calamity } from '../sim/calamity';
import { World, GW, GH, G_WATER, G_ROCK, G_SAND } from '../sim/world';
import { CAT } from '../sim/catalog';
import { Tasks } from '../sim/tasks';
import { News } from '../sim/news';
import { Game } from '../sim/game';
import { on } from '../sim/core';

const $ = (id: string) => document.getElementById(id)!;

export interface HudApi {
  togglePlanner(): void;
  isPlanner(): boolean;
  focus(px: { x: number; y: number }): void;
  founder(): { x: number; z: number; yaw: number };
  setTool(k: string | null): void;
  openMayor(): void;
}

const CAT_GROUPS: [string, string][] = [
  ['tool', '🛠️ Tools'], ['res', '🏠 Residential'], ['work', '🏭 Work & Industry'], ['shop', '🛍️ Shops & Services'],
  ['civic', '🏛️ Civic'], ['transport', '🚌 Transport'], ['leisure', '🎡 Leisure & Fun'], ['nature', '🌲 Nature'],
];
const MM: Record<string, string> = { res: '#3fae5c', shop: '#4f7ed0', work: '#d0a83f', civic: '#9aa4b4', leisure: '#c05fa8', hidden: '#b48ae8', transport: '#4fc0b0' };

/* what a palette item will actually DO for the town — V1's hover tips */
function paletteTip(key: string): string {
  const d = CAT[key];
  const bits = [d.name];
  if (d.res === 'family') bits.push('one family moves in');
  if (d.res === 'block') bits.push(`${d.fams || 4} families move in`);
  if (d.jobs) bits.push(`${d.jobs} jobs`);
  if (d.hours && d.hours.e - d.hours.s < 1440) bits.push(`open ${Math.floor(d.hours.s / 60)}:00–${Math.floor(d.hours.e / 60)}:00`);
  if (d.visit === 'shop') bits.push('villagers run errands here');
  if (d.visit === 'leisure') bits.push('evenings out & weekends');
  const notes: Record<string, string> = {
    police: 'answers crimes, crashes & disputes', fire: 'douses fires before ruin', school: 'kids enroll on weekdays',
    college: 'jobless adults study here', hospital: 'catches the unwell', courthouse: 'trials & stronger convictions',
    bank: 'founders can take business loans', townhall: "the mayor's office", busstop: 'two stops start a bus line',
    trainstation: 'two railed stations start trains', taxistand: 'cabs for the car-less', dock: 'boats, ferries & waterfront work',
    watertower: 'clean water (drought insurance)', powerplant: 'electric light for the town', park: 'free fun, happier neighbours',
    casino: 'the house usually wins', exchange: 'the five tickers get a floor', tvstation: 'news travels town-wide instantly',
    farm: 'the village grows what it eats', airport: 'planes bring extra visitors',
  };
  if (notes[key]) bits.push(notes[key]);
  if (d.building) bits.push('R rotates the door side');
  return bits.join('\n');
}

export class Hud {
  private pins: { x: number; y: number; until: number }[] = [];
  private lastRotate = 0;
  private lastSeen = -1;
  private lastTicker = 0;
  private mmImg: ImageData | null = null;
  private mmVersion = -1;
  private mmSeason = -1;
  journalOpen = false;
  journalTab = 'tasks';

  constructor(private api: HudApi) {
    this.buildPalette();
    $('stat-leader').addEventListener('click', () => api.openMayor());
    $('btn-planner').addEventListener('click', () => api.togglePlanner());
    $('btn-journal').addEventListener('click', () => this.toggleJournal());
    document.querySelectorAll<HTMLButtonElement>('#speed button').forEach((b) =>
      b.addEventListener('click', () => {
        const s = +b.dataset.s!;
        if (s > 1 && !api.isPlanner()) {
          this.toast('⏩ Fast-forward is for the Planner — on the street, time runs at 1×');
          return;
        }
        Game.setSpeed(s);
      }));
    document.querySelectorAll<HTMLButtonElement>('#journal-tabs button').forEach((b) =>
      b.addEventListener('click', () => {
        this.journalTab = b.dataset.tab!;
        document.querySelectorAll('#journal-tabs button').forEach((o) => o.classList.toggle('active', o === b));
        Tasks._dirty = true;
        this.renderJournal();
      }));
    $('minimap').addEventListener('click', (e) => {
      const c = $('minimap') as HTMLCanvasElement;
      const r = c.getBoundingClientRect();
      const tx = ((e.clientX - r.left) / r.width) * GW, ty = ((e.clientY - r.top) / r.height) * GH;
      api.focus({ x: tx * 16, y: ty * 16 });
    });
    on('toast', ({ msg, at }) => this.toast(msg, at, true));
    on('breaking', ({ text }) => {
      $('tv-headline').textContent = '🔴 BREAKING: ' + text;
      $('tv-headline').classList.add('breaking');
      $('tv').classList.add('breaking');
    });
  }

  /* ---------- toasts ---------- */
  toast(msg: string, at?: { x: number; y: number }, fromSim = false): void {
    if (!fromSim) Tasks.log(msg);
    if (at) this.pins.push({ x: at.x, y: at.y, until: performance.now() + 15000 });
    const wrap = $('toasts');
    const t = document.createElement('div');
    t.className = 'toast' + (at ? ' jump' : '');
    t.textContent = (at ? '📍 ' : '') + msg;
    if (at) t.addEventListener('click', () => this.api.focus(at));
    wrap.appendChild(t);
    const spd = Game.speed() || 1;
    const maxStack = spd >= 8 ? 2 : spd >= 3 ? 3 : 4;
    while (wrap.children.length > maxStack) wrap.removeChild(wrap.firstChild!);
    const life = at ? 9000 : Math.round(6000 / Math.sqrt(Math.max(1, spd)));
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, life);
  }
  /** most recent minimap pin (the Founder's waypoint) */
  pinsList(): { x: number; y: number; until: number }[] {
    const now = performance.now();
    this.pins = this.pins.filter((p) => p.until > now);
    return this.pins;
  }

  /* ---------- palette ---------- */
  private buildPalette(): void {
    const el = $('palette');
    for (const [cat, label] of CAT_GROUPS) {
      const h = document.createElement('div');
      h.className = 'pal-head';
      h.textContent = label;
      el.appendChild(h);
      const grid = document.createElement('div');
      grid.className = 'pal-grid';
      el.appendChild(grid);
      for (const key in CAT) {
        const d = CAT[key];
        if (d.cat !== cat) continue;
        const item = document.createElement('div');
        item.className = 'pal-item';
        item.dataset.key = key;
        item.title = paletteTip(key);
        item.innerHTML = `<div class="pal-emoji">${d.emoji}</div><div class="pal-name">${d.name}</div>`;
        item.addEventListener('pointerdown', (ev) => { ev.preventDefault(); this.api.setTool(key); });
        grid.appendChild(item);
      }
    }
  }
  markTool(key: string | null): void {
    document.querySelectorAll<HTMLElement>('.pal-item').forEach((i) => i.classList.toggle('active', !!key && i.dataset.key === key));
    const hint = $('hint');
    if (!this.api.isPlanner()) return;
    if (!key) hint.textContent = 'Click a building or villager to inspect · drag or WASD to pan · wheel zoom · Q/E rotate · P to go back down';
    else {
      const d = CAT[key];
      hint.textContent = d.drag ? `${d.name}: click & drag, release to apply · right-click cancels` : `${d.name}: click to place · R turns the door side · roads connect themselves · right-click cancels`;
    }
  }

  /* ---------- per-frame-ish HUD refresh (every ~0.4 s) ---------- */
  update(): void {
    const s = Sim.stats();
    $('village-name').textContent = World.name;
    $('clock').textContent = Game.dateLine();
    const lock = Festivals.speedLocked();
    document.querySelectorAll<HTMLButtonElement>('#speed button').forEach((b, n) => {
      b.classList.toggle('active', n === Game.speedIdx);
      b.classList.toggle('locked', (lock && n >= 2) || (!this.api.isPlanner() && n >= 2));
    });
    $('chip-season').textContent = Weather.label();
    const fc = Weather.forecastEmoji();
    $('chip-weather').textContent = Weather.weatherLabel() + (fc ? ` → ${fc}` : '');
    const ti = Sim.tierIndex();
    $('chip-tier').textContent = `${TIERS[ti].emoji} ${TIERS[ti].name}`;
    const next = TIERS[ti + 1];
    $('chip-tier').title = next ? `${s.pop}/${next.pop} residents to become a ${next.name}` : 'The summit: a Metropolis!';
    $('stat-pop').textContent = String(s.pop);
    $('stat-jobs').textContent = `${s.employed}/${s.adults}`;
    $('stat-wealth').textContent = '$' + s.wealth.toLocaleString();
    $('stat-safe').textContent = s.safety + '%';
    $('stat-hap').textContent = s.happiness + '%';
    $('stat-hap-emoji').textContent = s.happiness >= 75 ? '😊' : s.happiness >= 45 ? '🙂' : '😟';
    const L = $('stat-leader');
    if (Gov.campaign) {
      const d = Math.max(0, Gov.campaign.electionDay - Sim.day);
      L.textContent = '🗳️ ' + (d === 0 ? 'VOTING DAY' : (Gov.leader ? Gov.leader.name : 'Campaign season') + ` · ${d}d`);
    } else if (Gov.leader) L.textContent = `🎩 ${Gov.leader.name} · ${Math.round(Gov.approval)}%`;
    else L.textContent = '🗳️ Self-governing';
    ($('rci-r') as HTMLElement).style.height = Math.round(s.demand.r * 100) + '%';
    ($('rci-c') as HTMLElement).style.height = Math.round(s.demand.c * 100) + '%';
    ($('rci-i') as HTMLElement).style.height = Math.round(s.demand.i * 100) + '%';
    this.updateTV();
    this.badge();
    if (this.journalOpen) this.renderJournal();
  }

  private updateTV(): void {
    const now = performance.now();
    if (now - this.lastTicker > 12000) {
      this.lastTicker = now;
      let s = `DAY ${Sim.day} · POP ${Sim.people.length} · SAFETY ${Math.round(Sim.safety)}%`;
      if (Sim.stocks) {
        s += ` · 📊 PVX ${Sim.stockIndex()}`;
        for (const q of Sim.stocks) s += ` · ${q.sym} $${q.price.toFixed(1)} ${q.price >= (q.prev || q.price) ? '▲' : '▼'}`;
      }
      if (Gov.leader) s += ` · MAYOR ${Gov.leader.name.toUpperCase()} ${Math.round(Gov.approval)}%`;
      s += ` · ${Weather.weatherLabel().toUpperCase()}`;
      $('tv-ticker-text').textContent = s + ' ··· ';
    }
    if (now - News.breakingAt < 14000) return; // hold breaking stories on screen
    const head = $('tv-headline');
    if (head.classList.contains('breaking')) { head.classList.remove('breaking'); $('tv').classList.remove('breaking'); }
    if (now - this.lastRotate > 6000) {
      this.lastRotate = now;
      if (Tasks.news.length) {
        const pool = Tasks.news.slice(-8);
        this.lastSeen = (this.lastSeen + 1) % pool.length;
        head.textContent = pool[pool.length - 1 - this.lastSeen].text;
      } else head.textContent = `PVTV signs on — a quiet day in ${World.name}.`;
    }
  }

  /* ---------- minimap ---------- */
  drawMinimap(view: { x: number; z: number; yaw: number; planner: boolean; w: number; h: number }): void {
    const c = $('minimap') as HTMLCanvasElement;
    const g = c.getContext('2d')!;
    if (!this.mmImg || this.mmVersion !== Game.mapVersion || this.mmSeason !== Weather.season) {
      this.mmVersion = Game.mapVersion;
      this.mmSeason = Weather.season;
      const img = this.mmImg || g.createImageData(GW, GH);
      const put = (i: number, r: number, gg: number, b: number) => { img.data[i * 4] = r; img.data[i * 4 + 1] = gg; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255; };
      const winter = Weather.season === 3, dry = Calamity.droughtLevel >= 0.5;
      for (let i = 0; i < GW * GH; i++) {
        const g0 = World.ground[i];
        if (g0 === G_WATER && !World.roadMap[i]) { if (dry && !winter) put(i, 201, 180, 138); else if (winter) put(i, 210, 226, 238); else put(i, 63, 127, 208); }
        else if (World.railMap[i]) put(i, 122, 92, 56);
        else if (World.roadMap[i]) put(i, 52, 54, 60);
        else if (g0 === G_ROCK) put(i, 126, 122, 114);
        else if (g0 === G_SAND) put(i, 226, 211, 168);
        else if (World.tree[i]) put(i, winter ? 150 : 30, winter ? 160 : 70, winter ? 175 : 34);
        else put(i, winter ? 208 : 72, winter ? 216 : 120, winter ? 228 : 58);
      }
      for (const b of World.buildings) {
        let col = MM[CAT[b.type].cat] || '#b0b0b0';
        if (b.construction) col = '#e08a3c';
        if (b.ruined) col = '#5a564e';
        const r = parseInt(col.slice(1, 3), 16), gg = parseInt(col.slice(3, 5), 16), bb = parseInt(col.slice(5, 7), 16);
        for (let j = 0; j < b.h; j++) for (let k = 0; k < b.w; k++) put(World.idx(b.x + k, b.y + j), r, gg, bb);
      }
      this.mmImg = img;
    }
    g.putImageData(this.mmImg, 0, 0);
    const now = performance.now();
    for (const b of World.buildings) if (b.fire && Math.floor(now / 300) % 2 === 0) { g.fillStyle = '#ff4030'; g.fillRect(b.x, b.y, b.w, b.h); }
    if (Math.floor(now / 300) % 2 === 0) {
      g.fillStyle = '#ff4040';
      for (const p of this.pinsList()) g.fillRect(p.x / 16 - 2, p.y / 16 - 2, 5, 5);
    }
    // the Founder: a gold arrow
    const fx = view.x / 8, fz = view.z / 8;
    g.save();
    g.translate(fx, fz);
    g.rotate(-view.yaw + Math.PI);
    g.fillStyle = '#ffd060';
    g.strokeStyle = '#1a1a1a';
    g.beginPath(); g.moveTo(0, -6); g.lineTo(4.5, 5); g.lineTo(0, 2.5); g.lineTo(-4.5, 5); g.closePath();
    g.fill(); g.stroke();
    g.restore();
    if (view.planner) {
      g.strokeStyle = '#ffe066';
      g.strokeRect(view.x / 8 - view.w / 16, view.z / 8 - view.h / 16, view.w / 8, view.h / 8);
    }
  }

  /* ---------- task book ---------- */
  toggleJournal(): void {
    this.journalOpen = !this.journalOpen;
    $('journal').style.display = this.journalOpen ? 'flex' : 'none';
    Tasks.open = this.journalOpen;
    if (this.journalOpen) { Tasks.unread = 0; Tasks._dirty = true; this.renderJournal(); }
    this.badge();
  }
  private badge(): void {
    const b = $('journal-badge');
    const n = this.journalOpen ? 0 : Tasks.unread;
    b.style.display = n > 0 ? 'flex' : 'none';
    b.textContent = n > 9 ? '9+' : String(n);
  }
  renderJournal(): void {
    if (!Tasks._dirty) return;
    Tasks._dirty = false;
    let html = '';
    if (this.journalTab === 'tasks') {
      const active = Tasks.items.filter((t: any) => !t.done).slice().reverse();
      const finished = Tasks.items.filter((t: any) => t.done).slice().reverse().slice(0, 40);
      if (!active.length && !finished.length) html = '<div class="j-empty">No village projects yet — drop a building or wait for the town to act.</div>';
      for (const t of active) html += `<div class="j-item"><span>${t.icon}</span><span class="j-text">${t.text}</span><span class="j-day">d${t.day}</span></div>`;
      if (finished.length) html += '<div class="j-sep">Completed</div>';
      for (const t of finished) html += `<div class="j-item done ${t.ok ? 'ok' : 'fail'}"><span>${t.ok ? '✅' : '❌'}</span><span class="j-text">${t.text}</span><span class="j-day">d${t.doneDay}</span></div>`;
    } else {
      const news = Tasks.news.slice().reverse();
      if (!news.length) html = '<div class="j-empty">Nothing has happened yet. It will.</div>';
      for (const n of news) html += `<div class="j-item"><span class="j-day">d${n.day} ${n.time}</span><span class="j-text">${n.text}</span></div>`;
    }
    $('journal-list').innerHTML = html;
  }
}

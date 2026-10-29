/* ============================================================
   Panels: V1's building card, villager inspector and mayor's
   report, plus the modals — settings, saves (slots, autosave,
   file export/import incl. V1 files), new map, history charts
   and help. Ported from V1 main.js with 3D-era wording.
   ============================================================ */
import { Sim, WAGES, AGE_RETIRE } from '../sim/agents';
import { World } from '../sim/world';
import { CAT } from '../sim/catalog';
import { Gov } from '../sim/gov';
import { Life } from '../sim/life';
import { Mind } from '../sim/mind';
import { Rep } from '../sim/reputation';
import { Settings } from '../sim/settings';
import { Input, BINDABLE, keyName, type Action } from '../input/input';
import { Game } from '../sim/game';
import { Health } from '../sim/health';
import { Power, PLANT_CAP } from '../sim/power';
import { Supply, GOODS, SELLS, MAKES, YARD } from '../sim/supply';
import { Edu } from '../sim/education';
import { Economy, COUNTY_GRANT } from '../sim/economy';
import { SLOTS, AUTO, get, put, metaOf } from '../save/store';
import { Snd } from '../audio/sounds';

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const icon = (name: string): string => `<svg><use href="#i-${name}"/></svg>`;
const money = (n: number): string => (n < -0.5 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString();

/* ---------- the V2 card: overline, title, status pills, facts, notes, actions ---------- */
type Pill = [string, '' | 'ok' | 'warn' | 'bad'];
interface Card { over: string; title: string; emo?: string; lvl?: number; pills?: Pill[]; facts?: [string, string][]; wide?: string[]; notes?: string[]; actions?: string }
function card(c: Card): string {
  let h = `<div class="card-over">${esc(c.over)}</div>`;
  h += `<div class="card-title">${c.emo ? `<span class="emo">${c.emo}</span>` : ''}<span>${esc(c.title)}</span>${c.lvl ? `<span class="lvl">${'★'.repeat(c.lvl)}</span>` : ''}</div>`;
  if (c.pills?.length) h += `<div class="pills">${c.pills.map(([t, k]) => `<span class="pill ${k}">${esc(t)}</span>`).join('')}</div>`;
  if (c.facts?.length || c.wide?.length) {
    h += '<dl class="facts">';
    for (const [k, v] of c.facts || []) h += `<dt>${esc(k)}</dt><dd>${v}</dd>`;
    for (const w of c.wide || []) h += `<dd class="wrap">${w}</dd>`;
    h += '</dl>';
  }
  if (c.notes?.length) h += `<div class="notes">${c.notes.map((n) => `<p>${n}</p>`).join('')}</div>`;
  if (c.actions) h += `<div class="card-actions">${c.actions}</div>`;
  return h;
}
const CAT_LABEL: Record<string, string> = { res: 'Home', work: 'Workplace', shop: 'Shop & services', civic: 'Civic', transport: 'Transport', leisure: 'Leisure', nature: 'Nature', tool: 'Works' };
const person = (p: any): string => `<span class="p-link" data-pid="${p.id}">${esc(Sim.fullName(p))}</span>`;

export interface PanelApi {
  toast(msg: string): void;
  /** fly the Planner there, or (on the street) set the GPS; `label` names the place */
  focus(px: { x: number; y: number }, label?: string): void;
  /** things the Founder can do at this building right now (a scratch card at a shop) */
  extraActions?(b: any): { label: string; run: () => void }[];
  afterLoad(): void;
  isPlanner(): boolean;
  /** Milestone 7: a setting that applies at once was changed */
  settingsChanged?(): void;
  /** Milestone 7: run the first-day guide again */
  startTour?(): void;
}

export class Panels {
  selected: any = null;
  selectedPerson: any = null;
  mayorOpen = false;

  constructor(private api: PanelApi) {
    document.querySelectorAll<HTMLElement>('[data-close]').forEach((b) => b.addEventListener('click', () => this.close(b.dataset.close!)));
    $('btn-settings').addEventListener('click', () => this.openSettings());
    $('btn-save').addEventListener('click', () => this.openSaves('save'));
    $('btn-load').addEventListener('click', () => this.openSaves('load'));
    $('btn-new').addEventListener('click', () => { ($('nm-name') as HTMLInputElement).value = 'PixelVille'; this.show('newmap'); });
    $('btn-stats').addEventListener('click', () => { this.show('statsui'); this.drawStats(); });
    $('btn-help').addEventListener('click', () => this.show('help'));
    this.wireSettings();
    const sound = (on: boolean): void => { $('btn-sound').innerHTML = `${icon(on ? 'sound' : 'mute')}<span>${on ? 'Sound on' : 'Sound off'}</span>`; };
    $('btn-sound').addEventListener('click', () => sound(Snd.toggle()));
    sound(Snd.enabled);
    $('nm-start').addEventListener('click', () => {
      const nm = ($('nm-name') as HTMLInputElement).value.trim() || 'PixelVille';
      const mode = ($('nm-mode') as HTMLSelectElement).value;
      this.close('newmap');
      this.hideInfo();
      Game.newMap(nm, mode);
      this.api.afterLoad();
    });
    $('saveui-export').addEventListener('click', () => this.exportSave());
    $('saveui-import').addEventListener('click', () => ($('saveui-file') as HTMLInputElement).click());
    $('saveui-file').addEventListener('change', async (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (!f) return;
      const text = await f.text();
      const r = Game.performLoad(text);
      this.api.toast(r.msg);
      if (r.ok) { this.close('saveui'); this.api.afterLoad(); }
      (e.target as HTMLInputElement).value = '';
    });
    // autosave: quiet, regular, and on tab-hide
    let last = performance.now();
    setInterval(() => {
      const mins = Settings.get('autosaveMin');
      if (!mins || performance.now() - last < mins * 60000 || World.buildings.length < 2) return;
      last = performance.now();
      put(AUTO, Game.buildSaveString()).catch(() => {});
    }, 5000);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && World.buildings.length > 1 && Settings.get('autosaveMin')) put(AUTO, Game.buildSaveString()).catch(() => {});
    });
  }

  show(id: string): void {
    // (Milestone 7: the help names the player's own keys)
    if (id === 'help') document.querySelectorAll<HTMLElement>('#help kbd[data-k]').forEach((k) => { const c = Input.binds[k.dataset.k as Action]?.[0]; k.textContent = c ? keyName(c) : '—'; });
    $(id).style.display = 'flex';
    document.exitPointerLock?.();
  }
  close(id: string): void {
    if (id === 'settings') this.closeSettings();
    $(id).style.display = id === 'journal' ? 'none' : 'none';
  }
  anyModalOpen(): boolean {
    return [...document.querySelectorAll<HTMLElement>('#modals .modal')].some((m) => m.style.display === 'flex');
  }
  closeAll(): boolean {
    let any = false;
    document.querySelectorAll<HTMLElement>('#modals .modal').forEach((m) => { if (m.style.display === 'flex') { any = true; this.close(m.id); } });
    if ($('info').style.display === 'block') { this.hideInfo(); any = true; }
    return any;
  }

  /* ---------- the building card ---------- */
  showInfo(b: any): void {
    this.selected = b;
    this.selectedPerson = null;
    this.mayorOpen = false;
    const d = CAT[b.type];
    const el = $('info');
    el.style.display = 'block';
    const pills: Pill[] = [];
    const facts: [string, string][] = [];
    const wide: string[] = [];
    const notes: string[] = [];
    if (b.type === 'lodge') { pills.push(["The Founder's home", 'warn']); notes.push('Your home base. Your car waits beside it.'); }
    if (b.construction > 0) pills.push([b.stalled ? 'Under construction · stalled' : `Under construction · ${Math.max(1, Math.round(b.construction))} min`, 'warn']);
    if (b.ruined) { pills.push(['In ruins', 'bad']); notes.push('The neighbours will rebuild it, or bulldoze it to clear the plot.'); }
    if (b.fire) pills.push(['On fire', 'bad']);
    if (b.upgrading > 0) pills.push(['Adding a floor', 'warn']);
    if (b.renovating > 0) pills.push(['Being renovated', 'warn']);
    pills.push(b.connected ? ['Road access', 'ok'] : ['No road access', 'bad']);
    if (b.type === 'trainstation') {
      const railed = Life.stationRailDoor(b);
      pills.push(railed ? ['Rails connected', 'ok'] : ['No rails yet', 'bad']);
      if (!railed) notes.push('Drag the Railway tool up to this station to connect it.');
    }
    if (b.type === 'busstop' && World.buildings.filter((q: any) => q.type === 'busstop' && !q.construction && !q.ruined).length < 2)
      notes.push('Place a second bus stop to start the bus line.');
    if (!b.ruined) facts.push(['Land value', `${money(Gov.landPrice(b.x, b.y))} a tile`]);
    if (d.res && !b.ruined) {
      facts.push(['Savings', money(b.funds)]);
      if (b.ownerId) facts.push(['Tenure', 'Renting from another family']);
      // V2: what the household owes (bills it couldn't pay: the hospital, the power, a fine), paid off as money comes in
      const owed = Economy.owed(b);
      if (owed >= 1) facts.push(['Owes', `${money(owed)} · paid off as money comes in`]);
    }
    // V2: a workplace's money: the till its wages come out of (a public service's from the village fund's budget), and
    // whether yesterday's were paid in full
    if (d.jobs && !b.ruined && !b.construction) {
      facts.push([Economy.isPublic(b.type) ? 'Budget in hand' : 'In the till', money(b.funds || 0)]);
      if (b.lastWages !== undefined || b.lastUnpaid) facts.push(["Yesterday's wages", `${money(b.lastWages || 0)} paid${b.lastUnpaid ? ` · ${money(b.lastUnpaid)} short` : ''}`]);
      if ((b.unpaidDays || 0) >= 2) pills.push([Economy.isPublic(b.type) ? 'Village fund short · staff unpaid' : `Can't pay its staff · ${b.unpaidDays} days`, 'bad']);
      notes.push(Economy.isPublic(b.type) ? 'A public service: its staff are paid from the village fund (the county\'s grant and the taxes), plus anything it charges.'
        : `Pays its staff from its takings${Economy.trade(b.type) > 0 ? ' and its trade beyond the village' : ''}.`);
    }
    if (b.founderId) {
      const f = Sim.people.find((p: any) => p.id === b.founderId);
      if (f) {
        facts.push(['Owner', person(f)]);
        if (f.loan) facts.push(['Business loan', `${money(f.loan.balance)} left`]);
        if (b.landPrice) facts.push(['Plot bought for', money(b.landPrice)]);
        if (b.badDays >= 4) pills.push([`Struggling · ${b.badDays} slow days`, 'bad']);
      }
    }
    if (b.residents.length) {
      const fams = [...new Set(b.residents.map((r: any) => r.surname))];
      facts.push(['Residents', `${b.residents.length} · ${esc(fams.join(', '))}`]);
      wide.push(b.residents.slice(0, 8).map((r: any) => `<span class="p-link" data-pid="${r.id}">${esc(r.name)}</span> ${r.age}`).join(', ') + (b.residents.length > 8 ? '…' : ''));
      const away = b.residents.filter((r: any) => r.at !== b || r.state !== 'in').length;
      facts.push(['Out right now', String(away)]);
      const am = b.residents.reduce((s: number, r: any) => s + (r.mood ?? 60), 0) / b.residents.length;
      facts.push(['Household mood', `${Math.round(am)}%`]);
      const story = Mind.householdStory(b);
      if (story) notes.push(`<span class="day">Day ${story.memory.day}</span>${esc(story.who.name)} remembers: ${esc(story.memory.text)}`);
    }
    if (b.type === 'townhall' && Gov.leader) {
      facts.push(['Mayor', esc(Gov.leader.name)]);
      if (Gov.leader.promise) facts.push(['Promised', esc(Gov.leader.promise)]);
      facts.push(['Treasury', money(Gov.treasury)]);
    }
    if (d.jobs) facts.push(['Jobs filled', `${b.workers.length} of ${d.jobs}`]);
    this.systemFacts(b, pills, facts, wide, notes);
    const staff = d.jobs ? Rep.staff(b) : null;
    if (staff !== null && Math.abs(staff) >= 0.5) {
      const deal = Rep.price(b, 100);
      facts.push(['The staff', `${Rep.label(staff).toLowerCase()}${deal.note ? ` · ${deal.note.split(':')[0]}` : ''}`]);
    }
    if (d.visit) facts.push(['Visitors today', `${b.visitors} · ${b.inside} inside`]);
    if (b.type === 'police') facts.push(['Arrests, town-wide', String(Life.arrests)]);
    if (b.cars && b.cars.length) facts.push(['Cars at home', `${b.cars.filter((c: any) => c.free).length} of ${b.cars.length}`]);
    if (b.type === 'exchange' && Sim.stocks) {
      facts.push(['PVX index', String(Sim.stockIndex())]);
      for (const q of Sim.stocks) facts.push([`${q.sym} · ${q.name}`, `$${q.price.toFixed(1)} ${q.price >= (q.prev || q.price) ? '<span style="color:var(--ok)">▲</span>' : '<span style="color:var(--bad)">▼</span>'}`]);
    }
    const canUpgrade = b.type === 'house' && !b.upgrading && !b.construction && !b.ruined && b.residents.length && b.level < 3 && b.funds >= (b.level === 1 ? 250 : 600);
    let actions = '';
    const extra = this.api.extraActions?.(b) || [];
    extra.forEach((x, i) => { actions += `<button class="primary" data-extra="${i}">${esc(x.label)}</button>`; });
    if (canUpgrade) actions += `<button class="primary" id="upgrade-home">Add a floor · $${b.level === 1 ? 180 : 420}</button>`;
    actions += `<button id="info-go">${icon('pin')}Go there</button>`;
    if (this.api.isPlanner() && b.type !== 'lodge') actions += `<button class="danger" id="demolish">Demolish</button>`;
    actions += `<button id="info-close">Close</button>`;
    const over = [CAT_LABEL[d.cat] || 'Building', b.ruined ? '' : Gov.districtName(b.x, b.y)].filter(Boolean).join(' · ');
    el.innerHTML = card({ over, title: d.name, emo: d.emoji, lvl: b.level > 1 ? b.level - 1 : 0, pills, facts, wide, notes, actions });
    if (canUpgrade) ($('upgrade-home') as HTMLButtonElement).onclick = () => {
      // (V2: only if they can still afford it: the card may be minutes old)
      if (b.funds < (b.level === 1 ? 250 : 600) || b.upgrading) { this.showInfo(b); return; }
      if (b.level === 1) { b.funds -= 180; b.upgrading = 240; } else { b.funds -= 420; b.upgrading = 300; }
      this.api.toast(`🔨 The ${b.residents[0].surname}s are adding a floor — you talked them into it!`);
      this.showInfo(b);
    };
    el.querySelectorAll<HTMLElement>('[data-extra]').forEach((btn) => btn.addEventListener('click', () => { extra[+btn.dataset.extra!].run(); this.showInfo(b); }));
    ($('info-go') as HTMLButtonElement).onclick = () => this.api.focus({ x: (b.door.x + 0.5) * 16, y: (b.door.y + 0.5) * 16 }, d.name);
    const dem = document.getElementById('demolish');
    if (dem) dem.onclick = () => {
      Game.recordBulldoze({ kind: 'building', b }, b.x, b.y);
      World.removeBuilding(b);
      Sim.onBuildingRemoved(b);
      Game.afterMapEdit();
      this.hideInfo();
      this.api.toast(`${d.name} demolished 🚜 — Ctrl+Z to undo`);
    };
    ($('info-close') as HTMLButtonElement).onclick = () => this.hideInfo();
    this.wireLinks(el);
  }
  /* V2 (Milestone 4): power, graduate posts, the ward, the shelves and the yard, a site's materials */
  private systemFacts(b: any, pills: Pill[], facts: [string, string][], wide: string[], notes: string[]): void {
    if (b.ruined) return;
    const dark = Power.dark[Power.districtOfB(b)] === 1;
    if (dark && b.type === 'hospital') notes.push('The district is blacked out: the hospital runs on its own generator.');
    else if (dark) {
      const f = Power.faults.get(Power.districtOfB(b));
      pills.push(['No power', 'bad']);
      notes.push(f ? `Power cut: ${esc(f.cause)}. ${Life.crews.some((c: any) => c.d === Power.districtOfB(b) && c.phase === 'fix') ? 'The repair crew is at work on the lines.' : 'A repair crew is on its way.'}`
        : 'Rolling blackout: the grid is overloaded and this district is taking its turn in the dark.');
    }
    if (b.type === 'powerplant' && !b.construction) {
      facts.push(['Output', `${Math.round(Power.plantOutput(b))} of ${PLANT_CAP} (staff and engineers decide)`]);
      const r = Power.report();
      facts.push(['The grid', `${r.demand} wanted · ${r.capacity} to give${r.overloaded ? ' · overloaded' : ''}`]);
    }
    const posts = Edu.posts(b);
    if (posts && !b.construction) {
      const title = Edu.title(b.type);
      const filled = Edu.filled(b);
      facts.push([title[0].toUpperCase() + title.slice(1), `${filled} of ${posts} graduate posts filled`]);
      if (filled < posts) notes.push(`Short of ${title}: these posts need a college degree${World.buildings.some((q: any) => q.type === 'college' && !q.ruined) ? '' : ', and there is no college in town to train them'}.`);
    }
    if (b.type === 'hospital' && !b.construction) {
      const pts = Health.patients(b);
      facts.push(['Beds', `${pts.length} of ${Health.beds(b)} taken`]);
      if (pts.length) wide.push('On the ward: ' + pts.slice(0, 6).map((p: any) => `<span class="p-link" data-pid="${p.id}">${esc(Sim.fullName(p))}</span>`).join(', '));
      if (pts.length >= Health.beds(b)) pills.push(['Ward full', 'bad']);
    }
    const sells = SELLS[b.type];
    if (sells && !b.construction && b.stock !== undefined) {
      const g = GOODS[sells.g];
      facts.push(['On the shelves', `${g.emoji} ${Math.floor(b.stock)} of ${sells.cap} · ${g.name.toLowerCase()}`]);
      const m = Supply.priceMult(b);
      if (b.stock < 1) pills.push(['Sold out', 'bad']);
      else if (m > 1.04) pills.push([`Low stock · prices up ${Math.round((m - 1) * 100)}%`, 'warn']);
      const due = Supply.incoming(b);
      if (due) facts.push(['On its way', `${Math.round(due)} by truck`]);
    }
    const makes = MAKES[b.type];
    if (makes && !sells && !b.construction && b.stock !== undefined) {
      facts.push(['In the yard', `${GOODS[makes.g].emoji} ${Math.floor(b.stock)} of ${YARD} · ${GOODS[makes.g].name.toLowerCase()}`]);
      if (b.stock >= YARD) pills.push(['Yard full', 'warn']);
    }
    if (b.store) facts.push(['In store', (Object.keys(GOODS) as (keyof typeof GOODS)[]).filter((k) => b.store[k] >= 1).map((k) => `${GOODS[k].emoji} ${Math.floor(b.store[k])}`).join(' · ') || 'empty']);
    if (b.construction > 0 && b.matsNeed !== undefined) {
      facts.push(['Materials', `${Math.round(b.matsUsed + b.mats)} of ${b.matsNeed} delivered · ${Math.round(b.mats)} on site`]);
      const due = Supply.incoming(b);
      if (due) facts.push(['On its way', `${Math.round(due)} by truck`]);
      if (b.stalled) {
        pills.push(['Waiting for materials', 'bad']);
        notes.push(`Work has stopped: the builders are idle until a load arrives.${Supply.wanting.has('mats') ? ' Materials are short in town; a sawmill or brickworks would help.' : ''}`);
      }
    }
  }

  hideInfo(): void {
    $('info').style.display = 'none';
    this.selected = null;
    this.selectedPerson = null;
    this.mayorOpen = false;
  }

  /* ---------- the villager inspector ---------- */
  showPerson(p: any): void {
    if (!Sim.people.includes(p)) { this.hideInfo(); return; }
    this.selected = null;
    this.selectedPerson = p;
    this.mayorOpen = false;
    const el = $('info');
    el.style.display = 'block';
    const m = Math.round(p.mood ?? 60);
    const pills: Pill[] = [[`Mood ${m}%`, m >= 60 ? 'ok' : m >= 36 ? 'warn' : 'bad']];
    if (p.heldUntil > Sim.day) pills.push([`In custody until day ${p.heldUntil}`, 'bad']);
    // V2: health
    if (p.state === 'hurt' || p.state === 'amb') pills.push(['Hurt', 'bad']);
    else if (p.ward) pills.push(['In hospital', 'bad']);
    else if (p.cond && p.cond.sev >= 12) pills.push(['Unwell', 'warn']);
    if (p.lifestyle) pills.push([p.lifestyle, '']);
    if (p.ownsBusiness) pills.push(['Owns a business', '']);
    // what they make of the Founder, and the last thing they saw or heard
    const op = Rep.of(p);
    const heard = p.mind?.memories.filter((mm: any) => mm.kind === 'founder').at(-1);
    if (Math.abs(op) >= 0.5 || heard) pills.push([Rep.label(op), op >= 1 ? 'ok' : op <= -1 ? 'bad' : '']);
    const facts: [string, string][] = [];
    if (heard) facts.push(['About you', `${esc(heard.text)} <span class="day">day ${heard.day}</span>`]);
    facts.push(['Home', `The ${esc(p.surname)} household${p.home && p.home.ownerId ? ' (renting)' : ''}`]);
    if (p.work) facts.push(['Work', `${CAT[p.work.type].name} · $${Math.round(((WAGES as Record<string, number>)[p.work.type] || 15) * (p.wageMult || 1) * Edu.payMult(p, p.work))} a day${(p.wageMult || 1) > 1.5 ? ' · senior' : ''}${Edu.payMult(p, p.work) > 1 ? ' · graduate post' : ''}`]);
    else if (p.kind === 'kid') facts.push(['School', p.school ? 'Goes to school' : 'Too young yet']);
    else if (p.age >= AGE_RETIRE) facts.push(['Work', 'Retired']);
    else facts.push(['Work', `Between jobs${p.lastGig ? ` · lately ${esc(p.lastGig)}` : ''}`]);
    facts.push(['Health', `${Math.round(Health.hp(p))}% · ${esc(Health.label(p))}${p.cond?.cause && p.cond.k === 'injury' ? ` (hurt ${esc(p.cond.cause)})` : ''}`]);
    facts.push(['Schooling', esc(Edu.label(p))]);
    facts.push(['Savings', money(p.savings || 0)]);
    if (p.loan) facts.push(['Loan', `${money(p.loan.balance)} left`]);
    const partner = p.partnerId ? Sim.people.find((q: any) => q.id === p.partnerId) : null;
    if (partner) facts.push([p.married ? 'Married to' : 'Sweethearts with', person(partner)]);
    const notes: string[] = [];
    if (p.mind) {
      const t = p.mind.traits;
      const dom = ([['sociable', t.social], ['cautious', t.caution], ['ambitious', t.ambition], ['frugal', t.thrift], ['curious', t.curiosity]] as [string, number][]).sort((a, b) => b[1] - a[1])[0][0];
      facts.push(['Character', `The ${dom} type`]);
      facts.push(['Knows', `${p.mind.knows.size} places`]);
      const pals = Mind.friendsOf(p);
      if (pals.length) {
        const best = pals.reduce((a: any, b: any) => ((p.mind.friends.get(a.id) || 0) >= (p.mind.friends.get(b.id) || 0) ? a : b));
        facts.push([`Friends (${pals.length})`, `closest: ${person(best)}`]);
      }
      let favB: any = null, favV = 0;
      for (const [bid, v] of p.mind.favorites) if (v > favV) { favV = v; favB = World.buildings.find((q: any) => q.id === bid); }
      if (favB && favV >= 2) facts.push(['A regular at', `the ${CAT[favB.type].name}`]);
      for (const mm of p.mind.memories.slice(-3).reverse()) notes.push(`<span class="day">Day ${mm.day}</span>${esc(mm.text)}`);
    }
    const met = p.mind?.flags?.met;
    if (met) facts.push(['Talked with you', `${met.n} time${met.n > 1 ? 's' : ''} · last on day ${met.l}${met.s ? `, about ${esc(met.s)}` : ''}`]);
    const kind = p.kind === 'kid' ? 'Child' : 'Villager';
    el.innerHTML = card({
      over: `${kind} · ${p.age} years old`, title: Sim.fullName(p), pills, facts, notes,
      actions: `<button id="person-home">${icon('home')}Find home</button><button id="info-close">Close</button>`,
    });
    ($('person-home') as HTMLButtonElement).onclick = () => { if (p.home) this.api.focus({ x: (p.home.door.x + 0.5) * 16, y: (p.home.door.y + 0.5) * 16 }, `The ${p.surname} home`); };
    ($('info-close') as HTMLButtonElement).onclick = () => this.hideInfo();
    this.wireLinks(el);
  }
  private wireLinks(el: HTMLElement): void {
    el.querySelectorAll<HTMLElement>('.p-link').forEach((sp) => sp.addEventListener('click', () => {
      const q = Sim.people.find((o: any) => o.id === +sp.dataset.pid!);
      if (q) this.showPerson(q);
    }));
  }

  /* ---------- the mayor's report ---------- */
  showMayor(): void {
    this.selected = null;
    this.selectedPerson = null;
    this.mayorOpen = true;
    const el = $('info');
    el.style.display = 'block';
    const c: Card = { over: 'Village leadership', title: 'Self-governing', facts: [], notes: [] };
    if (!Gov.leader && !Gov.campaign) {
      c.notes!.push('No mayor yet: the village holds its first election once six adults live here. Until then, neighbours pool their savings for what is needed.');
    } else if (Gov.campaign) {
      const daysLeft = Math.max(0, Gov.campaign.electionDay - Sim.day);
      c.over = 'Election season';
      c.title = daysLeft === 0 ? 'The polls are open' : `Voting in ${daysLeft} day${daysLeft > 1 ? 's' : ''}`;
      c.pills = [[daysLeft === 0 ? 'Results tonight' : 'Campaigning', 'warn']];
      for (const k of Gov.campaign.candidates) c.notes!.push(`${k.type.emoji} <b>${esc(k.name)}</b>${k.incumbent ? ' (incumbent)' : ''}: ${esc(k.promise || k.type.label)}`);
    }
    if (Gov.leader && !Gov.campaign) {
      const L = Gov.leader;
      const mp = L.personId ? Sim.people.find((q: any) => q.id === L.personId) : null;
      c.over = 'Mayor';
      c.title = L.name;
      c.emo = L.type.emoji;
      const ap = Math.round(Gov.approval);
      c.pills = [[`Approval ${ap}%`, ap >= 55 ? 'ok' : ap >= 35 ? 'warn' : 'bad'], [L.type.label, '']];
      c.facts!.push(['Term', `${L.term || 1} · elected with ${L.voteShare || 0}%`], ['Treasury', money(Gov.treasury)]);
      if (L.promise) c.facts!.push(['Promised', esc(L.promise)]);
      if ((L.built || []).length) c.facts!.push(['Delivered', esc(L.built.slice(-4).join(', '))]);
      const needs = Gov.assessNeedsList().slice(0, 3);
      if (needs.length) c.facts!.push(['On the desk', needs.map((n: string) => CAT[n].name).join(', ')]);
      if (Gov.election && Gov.election.candidates) c.notes!.push(`Last election: ${Gov.election.candidates.map((k: any) => `${esc(k.name)} ${k.votes}`).join(' · ')}`);
      if (mp) c.notes!.push(`<span class="p-link" data-pid="${mp.id}">Meet the mayor in person</span>`);
    }
    // V2 (Milestone 4): how the village's systems are holding up
    const pw = Power.report(), hr = Health.report(), sr = Supply.report();
    const openPosts = Sim.workplaces().reduce((n: number, w: any) => n + Edu.open(w), 0);
    const grads = Sim.people.filter((q: any) => (q.edu || 0) >= 2).length;
    c.facts!.push(
      ['Power', `${pw.demand} wanted of ${pw.capacity}${pw.plants ? '' : ' (county line only)'}${pw.overloaded ? ' · rolling blackouts' : ''}${pw.faults ? ` · ${pw.faults} power cut${pw.faults > 1 ? 's' : ''}` : ''}`],
      ['Health', hr.hospitals ? `${hr.ward} of ${hr.beds} hospital beds taken · ${hr.sick} unwell${Health.wave ? ' · flu season' : ''}` : `No hospital · ${hr.sick} unwell${hr.serious ? `, ${hr.serious} badly` : ''}`],
      ['Graduates', `${grads}${openPosts ? ` · ${openPosts} graduate post${openPosts > 1 ? 's' : ''} unfilled` : ''}`],
      ['Goods', `${sr.wanting.length ? `short of ${sr.wanting.map((g: keyof typeof GOODS) => GOODS[g].name.toLowerCase()).join(', ')}` : 'flowing'}${sr.bare ? ` · ${sr.bare} shop${sr.bare > 1 ? 's' : ''} sold out` : ''}${sr.stalled ? ` · ${sr.stalled} site${sr.stalled > 1 ? 's' : ''} waiting for materials` : ''}`],
    );
    // V2: the village fund pays the public services' staff: what it has, what the county sends, and who went unpaid
    const unpaid = World.buildings.filter((b: any) => Economy.isPublic(b.type) && (b.unpaidDays || 0) >= 1 && !b.ruined).map((b: any) => CAT[b.type].name);
    const broke = World.buildings.filter((b: any) => CAT[b.type].jobs && !Economy.isPublic(b.type) && (b.unpaidDays || 0) >= 2 && !b.ruined).length;
    c.facts!.push(
      ['Village fund', `${money(Gov.treasury)}${Gov.treasury < 0 ? ' (owed to the county)' : ''} · the county sends ${money(Gov.grantToday || COUNTY_GRANT * Sim.people.length)} a day`],
      ['Wages', `${unpaid.length ? `the fund couldn't pay the ${[...new Set(unpaid)].join(', ').toLowerCase()} staff in full` : 'public staff paid'}${broke ? ` · ${broke} business${broke > 1 ? 'es' : ''} can't pay their staff` : ''}`],
    );
    c.notes!.push(`<b>Tax policy</b>, yours to set:<select id="tax-select">
      <option value="low"${Gov.taxRate === 'low' ? ' selected' : ''}>Low — happy homes, lean treasury</option>
      <option value="normal"${Gov.taxRate === 'normal' ? ' selected' : ''}>Normal — the steady middle</option>
      <option value="high"${Gov.taxRate === 'high' ? ' selected' : ''}>High — big projects, grumbling streets</option></select>`);
    c.actions = '<button id="info-close">Close</button>';
    el.innerHTML = card(c);
    ($('tax-select') as HTMLSelectElement).addEventListener('change', (e) => {
      Gov.taxRate = (e.target as HTMLSelectElement).value;
      this.api.toast(`💰 Tax policy set to ${Gov.taxRate} — the town hall ledger adjusts`);
    });
    ($('info-close') as HTMLButtonElement).onclick = () => this.hideInfo();
    this.wireLinks(el);
  }

  /** keep an open card live */
  refresh(): void {
    if ($('info').style.display !== 'block') return;
    const active = document.activeElement;
    if (active && active.tagName === 'SELECT') return;
    if (this.selected) {
      if (!World.buildings.includes(this.selected)) this.hideInfo();
      else this.showInfo(this.selected);
    } else if (this.selectedPerson) this.showPerson(this.selectedPerson);
  }

  /* ---------- settings ---------- */
  openSettings(): void {
    ($('set-name') as HTMLInputElement).value = World.name;
    ($('set-pace') as HTMLSelectElement).value = Settings.get('growthPace');
    ($('set-xmas') as HTMLSelectElement).value = Settings.get('xmasLock');
    ($('set-quality') as HTMLSelectElement).value = Settings.get('quality');
    ($('set-fov') as HTMLInputElement).value = String(Settings.get('fov'));
    ($('set-sens') as HTMLInputElement).value = String(Settings.get('mouseSens'));
    ($('set-invert') as HTMLInputElement).checked = !!Settings.get('invertY');
    ($('set-vol') as HTMLInputElement).value = String(Settings.get('volume'));
    ($('set-autosave') as HTMLSelectElement).value = String(Settings.get('autosaveMin'));
    // V2 (Milestone 7): graphics, controls and accessibility, applied as they change
    ($('set-res') as HTMLSelectElement).value = String(Settings.get('resScale') ?? 'auto');
    ($('set-fps') as HTMLSelectElement).value = String(Settings.get('fpsCap') || 0);
    ($('set-ui') as HTMLSelectElement).value = String(Settings.get('uiScale') || 1);
    ($('set-subs') as HTMLSelectElement).value = Settings.get('subtitles') || 'speech';
    ($('set-cv') as HTMLSelectElement).value = Settings.get('colorVision') || 'standard';
    ($('set-shake') as HTMLInputElement).checked = Settings.get('shake') !== false;
    ($('set-bob') as HTMLInputElement).checked = Settings.get('headBob') !== false;
    ($('set-calm') as HTMLInputElement).checked = !!Settings.get('calm');
    this.renderKeys();
    this.show('settings');
  }
  private closeSettings(): void {
    Input.capture = null;
    const nm = ($('set-name') as HTMLInputElement).value.trim();
    if (nm && nm !== World.name) { World.name = nm.slice(0, 24); this.api.toast(`🏷️ The village is now called ${World.name}`); }
    Settings.set('growthPace', ($('set-pace') as HTMLSelectElement).value);
    Settings.set('xmasLock', ($('set-xmas') as HTMLSelectElement).value);
    Settings.set('quality', ($('set-quality') as HTMLSelectElement).value);
    Settings.set('fov', +($('set-fov') as HTMLInputElement).value);
    Settings.set('mouseSens', +($('set-sens') as HTMLInputElement).value);
    Settings.set('invertY', ($('set-invert') as HTMLInputElement).checked);
    Settings.set('autosaveMin', +($('set-autosave') as HTMLSelectElement).value);
    Snd.setVolume(+($('set-vol') as HTMLInputElement).value);
  }
  /** the settings that take effect at once (Milestone 7) */
  private wireSettings(): void {
    document.querySelectorAll<HTMLButtonElement>('#set-tabs button').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll<HTMLElement>('#set-tabs button').forEach((t) => t.classList.toggle('on', t === b));
      document.querySelectorAll<HTMLElement>('.set-pane').forEach((p) => p.classList.toggle('on', p.dataset.pane === b.dataset.pane));
      Input.capture = null;
    }));
    const live: [string, string, (el: HTMLInputElement & HTMLSelectElement) => unknown][] = [
      ['set-res', 'resScale', (e) => (e.value === 'auto' ? 'auto' : +e.value)],
      ['set-fps', 'fpsCap', (e) => +e.value],
      ['set-ui', 'uiScale', (e) => +e.value],
      ['set-subs', 'subtitles', (e) => e.value],
      ['set-cv', 'colorVision', (e) => e.value],
      ['set-shake', 'shake', (e) => e.checked],
      ['set-bob', 'headBob', (e) => e.checked],
      ['set-calm', 'calm', (e) => e.checked],
      ['set-fov', 'fov', (e) => +e.value],
      ['set-sens', 'mouseSens', (e) => +e.value],
      ['set-invert', 'invertY', (e) => e.checked],
    ];
    for (const [id, key, read] of live) $(id).addEventListener('change', (ev) => { Settings.set(key, read(ev.target as HTMLInputElement & HTMLSelectElement)); this.api.settingsChanged?.(); });
    $('set-quality').addEventListener('change', () => { $('set-gfx-note').textContent = 'Quality changes after a reload (save first, or it picks up from the autosave).'; });
    $('set-keys-reset').addEventListener('click', () => { Input.resetBinds(); $('set-keys-note').textContent = 'Back to the defaults.'; this.renderKeys(); });
    $('set-tour').addEventListener('click', () => { this.close('settings'); this.api.startTour?.(); });
  }
  /** every bindable action, its key, and a button to rebind it */
  private renderKeys(): void {
    const wrap = $('set-keys');
    wrap.innerHTML = BINDABLE.map((b) => {
      const k = Input.binds[b.a]?.[0];
      return `<span>${esc(b.label)}</span><button data-bind="${b.a}" class="${k ? '' : 'none'}">${k ? esc(keyName(k)) : 'not set'}</button>`;
    }).join('');
    wrap.querySelectorAll<HTMLButtonElement>('[data-bind]').forEach((btn) => btn.addEventListener('click', () => {
      const a = btn.dataset.bind as Action;
      wrap.querySelectorAll('.wait').forEach((w) => w.classList.remove('wait'));
      btn.classList.add('wait');
      btn.textContent = 'press a key…';
      Input.capture = (code) => {
        if (code === 'Escape') { this.renderKeys(); return; }
        const lost = Input.bind(a, code);
        const label = (x: Action): string => BINDABLE.find((q) => q.a === x)!.label.split(' · ')[0].toLowerCase();
        $('set-keys-note').textContent = lost.length ? `${keyName(code)} was ${lost.map(label).join(' and ')}: give ${lost.length > 1 ? 'them' : 'it'} another key.` : `${BINDABLE.find((q) => q.a === a)!.label.split(' · ')[0]}: ${keyName(code)}.`;
        this.renderKeys();
      };
    }));
  }

  /* ---------- saves ---------- */
  async openSaves(mode: 'save' | 'load'): Promise<void> {
    $('saveui-title').textContent = mode === 'save' ? 'Save village' : 'Load village';
    const keys = mode === 'load' ? [...SLOTS, AUTO] : SLOTS;
    const wrap = $('saveui-slots');
    wrap.innerHTML = '';
    for (const [i, key] of keys.entries()) {
      const meta = metaOf(await get(key).catch(() => null));
      const label = key === AUTO ? 'Autosave' : `Slot ${i + 1}`;
      const desc = meta ? `<b>${esc(meta.name)}</b> · day ${meta.day} · ${meta.pop} villagers${meta.at ? '<br>' + new Date(meta.at).toLocaleString() : ''}` : 'Empty';
      const row = document.createElement('div');
      row.className = 'save-slot' + (meta ? '' : ' empty');
      row.innerHTML = `<span class="slot-name">${label}</span><span class="slot-meta">${desc}</span>`;
      row.addEventListener('click', async () => {
        if (mode === 'save') {
          if (meta && !confirm('Overwrite this slot?')) return;
          try { await put(key, Game.buildSaveString()); this.api.toast('Village saved 💾'); }
          catch (e) { this.api.toast('Save failed: ' + (e as Error).message); return; }
        } else {
          const r = Game.performLoad(await get(key));
          this.api.toast(r.msg);
          if (!r.ok) return;
          this.api.afterLoad();
        }
        this.close('saveui');
      });
      wrap.appendChild(row);
    }
    this.show('saveui');
  }
  private exportSave(): void {
    const blob = new Blob([Game.buildSaveString()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(World.name || 'pixelville').replace(/[^\w-]+/g, '_')}-day${Sim.day}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    this.api.toast('Village exported ⬇️ — keep the file safe!');
  }

  /* ---------- history charts ---------- */
  drawStats(): void {
    const cv = $('stats-canvas') as HTMLCanvasElement;
    const g = cv.getContext('2d')!;
    g.setTransform(2, 0, 0, 2, 0, 0); // drawn at twice the layout size, for sharp lines
    const W = cv.width / 2, HH = cv.height / 2;
    g.clearRect(0, 0, W, HH);
    const H = Sim.history || [];
    const font = getComputedStyle(document.body).fontFamily;
    g.font = `12px ${font}`;
    if (H.length < 2) {
      g.fillStyle = 'rgba(238,241,244,0.5)';
      g.textAlign = 'center';
      g.fillText('The chronicle needs a few days of history first. Come back tomorrow.', W / 2, HH / 2);
      g.textAlign = 'left';
      return;
    }
    const series = [
      { key: 'pop', label: 'Population', color: '#86d9a0', max: Math.max(10, ...H.map((h: any) => h.pop)) },
      { key: 'hap', label: 'Happiness %', color: '#f0c27a', max: 100 },
      { key: 'safe', label: 'Safety %', color: '#7aa6e6', max: 100 },
      { key: 'wealth', label: 'Wealth', color: '#d39be0', max: Math.max(100, ...H.map((h: any) => h.wealth)) },
      { key: 'tre', label: 'Treasury', color: '#ef9a6a', max: Math.max(100, ...H.map((h: any) => h.tre)) },
    ];
    const x0 = 14, y0 = 14, w = W - 28, h = HH - 64;
    g.strokeStyle = 'rgba(255,255,255,0.07)';
    g.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(x0, y0 + (h * i) / 4 + 0.5); g.lineTo(x0 + w, y0 + (h * i) / 4 + 0.5); g.stroke(); }
    g.lineJoin = 'round';
    g.lineCap = 'round';
    for (const s of series) {
      g.strokeStyle = s.color;
      g.lineWidth = 2;
      g.beginPath();
      H.forEach((pt: any, i: number) => {
        const px = x0 + (i / (H.length - 1)) * w, py = y0 + h - (Math.min(pt[s.key], s.max) / s.max) * h;
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      });
      g.stroke();
    }
    let lx = x0;
    for (const s of series) {
      g.fillStyle = s.color;
      g.beginPath();
      g.arc(lx + 4, y0 + h + 22, 4, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(238,241,244,0.75)';
      g.fillText(s.label, lx + 13, y0 + h + 26);
      lx += g.measureText(s.label).width + 34;
    }
    g.fillStyle = 'rgba(238,241,244,0.45)';
    g.fillText(`Day ${H[0].d} to day ${H[H.length - 1].d}`, x0, y0 + h + 48);
  }
}

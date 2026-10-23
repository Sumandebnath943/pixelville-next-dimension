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
import { Settings } from '../sim/settings';
import { Game } from '../sim/game';
import { SLOTS, AUTO, get, put, metaOf } from '../save/store';
import { Snd } from '../audio/sounds';

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface PanelApi {
  toast(msg: string): void;
  focus(px: { x: number; y: number }): void;
  afterLoad(): void;
  isPlanner(): boolean;
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
    $('btn-sound').addEventListener('click', () => { $('btn-sound').textContent = Snd.toggle() ? '🔊' : '🔇'; });
    $('btn-sound').textContent = Snd.enabled ? '🔊' : '🔇';
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

  show(id: string): void { $(id).style.display = 'flex'; document.exitPointerLock?.(); }
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
    let rows = `<div class="info-title">${d.emoji || '🏠'} ${esc(d.name)}${b.level > 1 ? ' ★'.repeat(b.level - 1) : ''}</div>`;
    if (b.type === 'lodge') rows += `<div class="info-row">🛖 The Founder's home base. Your car waits beside it.</div>`;
    if (b.construction > 0) rows += `<div class="info-row">🏗️ Under construction — ${Math.max(1, Math.round(b.construction))} min left</div>`;
    if (b.ruined) rows += `<div class="info-row">💔 In ruins — the neighbours will rebuild, or bulldoze to clear</div>`;
    if (b.fire) rows += `<div class="info-row">🔥 ON FIRE!</div>`;
    if (b.upgrading > 0) rows += `<div class="info-row">🔨 Adding a floor…</div>`;
    if (b.renovating > 0) rows += `<div class="info-row">🎨 Being renovated</div>`;
    rows += `<div class="info-row">${b.connected ? '🛣️ Connected to roads' : '⚠️ No road access!'}</div>`;
    if (b.type === 'trainstation') rows += `<div class="info-row">${Life.stationRailDoor(b) ? '🛤️ Rail track connected' : '⚠️ No rails yet — drag the Railway tool up to this station'}</div>`;
    if (b.type === 'busstop' && World.buildings.filter((q: any) => q.type === 'busstop' && !q.construction && !q.ruined).length < 2)
      rows += `<div class="info-row">💡 Place a second bus stop to start the bus line</div>`;
    if (!b.ruined) rows += `<div class="info-row">📍 ${Gov.districtName(b.x, b.y)} · land value $${Gov.landPrice(b.x, b.y)}/tile</div>`;
    if (d.res && !b.ruined) {
      rows += `<div class="info-row">💰 Savings: $${Math.round(b.funds)}</div>`;
      if (b.ownerId) rows += `<div class="info-row">🔑 Renting from another family</div>`;
    }
    if (d.visit && b.funds > 0) rows += `<div class="info-row">💵 Lifetime earnings: $${Math.round(b.funds)}</div>`;
    if (b.founderId) {
      const f = Sim.people.find((p: any) => p.id === b.founderId);
      if (f) {
        rows += `<div class="info-row">🧑‍💼 Owner: <span class="p-link" data-pid="${f.id}">${esc(Sim.fullName(f))}</span>${f.loan ? ` (loan: $${Math.round(f.loan.balance)} left)` : ''}</div>`;
        if (b.landPrice) rows += `<div class="info-row">🪧 Plot bought from the village for $${b.landPrice}</div>`;
        if (b.badDays >= 4) rows += `<div class="info-row">📉 Struggling — ${b.badDays} slow days</div>`;
      }
    }
    if (b.residents.length) {
      const fams = [...new Set(b.residents.map((r: any) => r.surname))];
      rows += `<div class="info-row">👥 ${b.residents.length} residents (${esc(fams.join(', '))})</div>`;
      const names = b.residents.slice(0, 6).map((r: any) => `<span class="p-link" data-pid="${r.id}">${esc(r.name)}</span> (${r.age})`).join(', ');
      rows += `<div class="info-row">🪪 ${names}${b.residents.length > 6 ? '…' : ''}</div>`;
      const away = b.residents.filter((r: any) => r.at !== b || r.state === 'walk').length;
      rows += `<div class="info-row">🚶 ${away} out right now</div>`;
      const am = b.residents.reduce((s: number, r: any) => s + (r.mood ?? 60), 0) / b.residents.length;
      rows += `<div class="info-row">${am >= 70 ? '😄' : am >= 50 ? '🙂' : am >= 35 ? '😕' : '😠'} Household mood: ${Math.round(am)}%</div>`;
      const story = Mind.householdStory(b);
      if (story) rows += `<div class="info-row">🧠 ${esc(story.who.name)} remembers: ${esc(story.memory.text)} (day ${story.memory.day})</div>`;
    }
    if (b.type === 'townhall' && Gov.leader) {
      rows += `<div class="info-row">🎩 Mayor ${esc(Gov.leader.name)}'s office</div>`;
      if (Gov.leader.promise) rows += `<div class="info-row">🤞 Promised: ${esc(Gov.leader.promise)}</div>`;
      rows += `<div class="info-row">🏦 Treasury: $${Math.round(Gov.treasury)}</div>`;
    }
    if (d.jobs) rows += `<div class="info-row">💼 ${b.workers.length}/${d.jobs} jobs filled</div>`;
    if (d.visit) rows += `<div class="info-row">🧾 ${b.visitors} visitors today · ${b.inside} inside now</div>`;
    if (b.type === 'police') rows += `<div class="info-row">🚔 ${Life.arrests} arrests town-wide</div>`;
    if (b.cars && b.cars.length) rows += `<div class="info-row">🚗 ${b.cars.filter((c: any) => c.free).length}/${b.cars.length} cars parked</div>`;
    if (b.type === 'exchange' && Sim.stocks) {
      rows += `<div class="info-row">📊 PVX index: ${Sim.stockIndex()}</div>`;
      for (const q of Sim.stocks) rows += `<div class="info-row">${q.price >= (q.prev || q.price) ? '▲' : '▼'} ${q.sym} <b>$${q.price.toFixed(1)}</b> — ${esc(q.name)}</div>`;
    }
    const canUpgrade = b.type === 'house' && !b.upgrading && !b.construction && !b.ruined && b.residents.length && b.level < 3 && b.funds >= (b.level === 1 ? 250 : 600);
    if (canUpgrade) rows += `<button id="upgrade-home">🔨 Add a floor ($${b.level === 1 ? 180 : 420})</button>`;
    rows += `<button id="info-go">📍 Go there</button>`;
    if (this.api.isPlanner() && b.type !== 'lodge') rows += `<button id="demolish">🚜 Demolish</button>`;
    rows += `<button id="info-close">Close</button>`;
    el.innerHTML = rows;
    if (canUpgrade) ($('upgrade-home') as HTMLButtonElement).onclick = () => {
      if (b.level === 1) { b.funds -= 180; b.upgrading = 240; } else { b.funds -= 420; b.upgrading = 300; }
      this.api.toast(`🔨 The ${b.residents[0].surname}s are adding a floor — you talked them into it!`);
      this.showInfo(b);
    };
    ($('info-go') as HTMLButtonElement).onclick = () => this.api.focus({ x: (b.x + b.w / 2) * 16, y: (b.y + b.h / 2) * 16 });
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
    const kindEmoji = p.kind === 'kid' ? '🧒' : p.kind === 'woman' ? '👩' : '👨';
    const m = p.mood ?? 60;
    const face = m >= 75 ? '😄' : m >= 52 ? '🙂' : m >= 36 ? '😕' : '😠';
    let rows = `<div class="info-title">${kindEmoji} ${esc(Sim.fullName(p))}</div>`;
    rows += `<div class="info-row">🎂 ${p.age} years old · ${face} mood ${Math.round(m)}%</div>`;
    if (p.heldUntil > Sim.day) rows += `<div class="info-row">⛓️ In custody until day ${p.heldUntil}</div>`;
    rows += `<div class="info-row">🏠 The ${esc(p.surname)} household${p.home && p.home.ownerId ? ' (renting)' : ''}</div>`;
    if (p.work) rows += `<div class="info-row">💼 ${CAT[p.work.type].name} — $${Math.round(((WAGES as Record<string, number>)[p.work.type] || 15) * (p.wageMult || 1))}/day${(p.wageMult || 1) > 1.5 ? ' (senior)' : ''}</div>`;
    else if (p.kind === 'kid') rows += `<div class="info-row">${p.school ? '🎒 Goes to school' : '🧸 Too young for school'}</div>`;
    else if (p.age >= AGE_RETIRE) rows += `<div class="info-row">🪑 Retired after a working life</div>`;
    else rows += `<div class="info-row">🔍 Between jobs${p.lastGig ? ` — lately ${esc(p.lastGig)}` : ''}</div>`;
    rows += `<div class="info-row">🎭 ${esc(p.lifestyle)}${p.ownsBusiness ? ' · owns a business' : ''}${p.loan ? ` · loan $${Math.round(p.loan.balance)}` : ''}</div>`;
    rows += `<div class="info-row">💵 Personal savings: $${Math.round(p.savings || 0)}</div>`;
    const partner = p.partnerId ? Sim.people.find((q: any) => q.id === p.partnerId) : null;
    if (partner) rows += `<div class="info-row">${p.married ? '💍 Married to' : '💕 Sweethearts with'} <span class="p-link" data-pid="${partner.id}">${esc(Sim.fullName(partner))}</span></div>`;
    if (p.mind) {
      const t = p.mind.traits;
      const dom = ([['sociable', t.social], ['cautious', t.caution], ['ambitious', t.ambition], ['frugal', t.thrift], ['curious', t.curiosity]] as [string, number][]).sort((a, b) => b[1] - a[1])[0][0];
      rows += `<div class="info-row">🧠 The ${dom} type · knows ${p.mind.knows.size} places</div>`;
      const pals = Mind.friendsOf(p);
      if (pals.length) {
        const best = pals.reduce((a: any, b: any) => ((p.mind.friends.get(a.id) || 0) >= (p.mind.friends.get(b.id) || 0) ? a : b));
        rows += `<div class="info-row">🤝 ${pals.length} friend${pals.length > 1 ? 's' : ''} — closest: <span class="p-link" data-pid="${best.id}">${esc(Sim.fullName(best))}</span></div>`;
      }
      let favB: any = null, favV = 0;
      for (const [bid, v] of p.mind.favorites) if (v > favV) { favV = v; favB = World.buildings.find((q: any) => q.id === bid); }
      if (favB && favV >= 2) rows += `<div class="info-row">💚 Regular at the ${CAT[favB.type].name}</div>`;
      for (const mm of p.mind.memories.slice(-3).reverse()) rows += `<div class="info-row">${mm.feel > 0 ? '✨' : mm.feel < 0 ? '💭' : '·'} Day ${mm.day}: ${esc(mm.text)}</div>`;
    }
    rows += `<div class="info-row" style="color:#9aa4bc">💬 Talking with villagers arrives in Milestone 3.</div>`;
    rows += `<button id="person-home">🏠 Find home</button> <button id="info-close">Close</button>`;
    el.innerHTML = rows;
    ($('person-home') as HTMLButtonElement).onclick = () => { if (p.home) this.api.focus({ x: (p.home.x + p.home.w / 2) * 16, y: (p.home.y + p.home.h / 2) * 16 }); };
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
    let rows = '';
    if (!Gov.leader && !Gov.campaign) {
      rows += `<div class="info-title">🗳️ Self-governing</div><div class="info-row">No mayor yet — the village holds its first election once six adults live here. Until then, neighbours pool savings for what's needed.</div>`;
    } else if (Gov.campaign) {
      const daysLeft = Math.max(0, Gov.campaign.electionDay - Sim.day);
      rows += `<div class="info-title">🗳️ Election season</div><div class="info-row">${daysLeft === 0 ? 'POLLS ARE OPEN — results tonight!' : `Voting in ${daysLeft} day${daysLeft > 1 ? 's' : ''}`}</div>`;
      for (const c of Gov.campaign.candidates) rows += `<div class="info-row">${c.type.emoji} <b>${esc(c.name)}</b>${c.incumbent ? ' (incumbent)' : ''} — ${esc(c.promise || c.type.label)}</div>`;
    }
    if (Gov.leader && !Gov.campaign) {
      const L = Gov.leader;
      const mp = L.personId ? Sim.people.find((q: any) => q.id === L.personId) : null;
      rows += `<div class="info-title">🎩 Mayor ${esc(L.name)} ${L.type.emoji}</div>`;
      rows += `<div class="info-row">${esc(L.type.label)} · term ${L.term || 1} · elected with ${L.voteShare || 0}%</div>`;
      rows += `<div class="info-row">📊 Approval: ${Math.round(Gov.approval)}% · 🏦 Treasury: $${Math.round(Gov.treasury)}</div>`;
      if (L.promise) rows += `<div class="info-row">🤞 Promised: ${esc(L.promise)}</div>`;
      if ((L.built || []).length) rows += `<div class="info-row">🏗️ Delivered: ${esc(L.built.slice(-4).join(', '))}</div>`;
      if (mp) rows += `<div class="info-row">🪪 <span class="p-link" data-pid="${mp.id}">Meet the mayor in person</span></div>`;
      const needs = Gov.assessNeedsList().slice(0, 3);
      if (needs.length) rows += `<div class="info-row">📋 On the desk: ${needs.map((n: string) => CAT[n].name).join(', ')}</div>`;
      if (Gov.election && Gov.election.candidates) rows += `<div class="info-row">🗳️ Last election: ${Gov.election.candidates.map((c: any) => `${esc(c.name)} ${c.votes}`).join(' · ')}</div>`;
    }
    rows += `<div class="info-row" style="margin-top:8px">💰 <b>Tax policy</b> (yours to set):</div>
      <div class="info-row"><select id="tax-select" style="width:100%">
      <option value="low"${Gov.taxRate === 'low' ? ' selected' : ''}>Low — happy homes, lean treasury</option>
      <option value="normal"${Gov.taxRate === 'normal' ? ' selected' : ''}>Normal — the steady middle</option>
      <option value="high"${Gov.taxRate === 'high' ? ' selected' : ''}>High — big projects, grumbling streets</option></select></div>
      <button id="info-close">Close</button>`;
    el.innerHTML = rows;
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
    this.show('settings');
  }
  private closeSettings(): void {
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

  /* ---------- saves ---------- */
  async openSaves(mode: 'save' | 'load'): Promise<void> {
    $('saveui-title').textContent = mode === 'save' ? '💾 Save village' : '📂 Load village';
    const keys = mode === 'load' ? [...SLOTS, AUTO] : SLOTS;
    const wrap = $('saveui-slots');
    wrap.innerHTML = '';
    for (const [i, key] of keys.entries()) {
      const meta = metaOf(await get(key).catch(() => null));
      const label = key === AUTO ? '🕐 Autosave' : `Slot ${i + 1}`;
      const desc = meta ? `${esc(meta.name)} · day ${meta.day} · 👥 ${meta.pop}${meta.at ? ' · ' + new Date(meta.at).toLocaleString() : ''}` : 'Empty';
      const row = document.createElement('div');
      row.className = 'save-slot' + (meta ? '' : ' empty');
      row.innerHTML = `<span>${label}</span><span class="slot-meta">${desc}</span>`;
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
    g.clearRect(0, 0, cv.width, cv.height);
    const H = Sim.history || [];
    g.font = '12px system-ui, sans-serif';
    if (H.length < 2) {
      g.fillStyle = '#8a93a8';
      g.fillText('The chronicle needs a few days of history first — come back tomorrow.', 70, cv.height / 2);
      return;
    }
    const series = [
      { key: 'pop', label: '👥 Population', color: '#5fae62', max: Math.max(10, ...H.map((h: any) => h.pop)) },
      { key: 'hap', label: '😊 Happiness %', color: '#f2c14f', max: 100 },
      { key: 'safe', label: '🛡️ Safety %', color: '#4f9ed0', max: 100 },
      { key: 'wealth', label: '💰 Wealth', color: '#c05fa8', max: Math.max(100, ...H.map((h: any) => h.wealth)) },
      { key: 'tre', label: '🏦 Treasury', color: '#e08a3c', max: Math.max(100, ...H.map((h: any) => h.tre)) },
    ];
    const x0 = 8, y0 = 8, w = cv.width - 16, h = cv.height - 56;
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(x0, y0 + (h * i) / 4); g.lineTo(x0 + w, y0 + (h * i) / 4); g.stroke(); }
    for (const s of series) {
      g.strokeStyle = s.color;
      g.lineWidth = 1.8;
      g.beginPath();
      H.forEach((pt: any, i: number) => {
        const px = x0 + (i / (H.length - 1)) * w, py = y0 + h - (Math.min(pt[s.key], s.max) / s.max) * h;
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      });
      g.stroke();
    }
    let lx = x0 + 2;
    for (const s of series) {
      g.fillStyle = s.color;
      g.fillRect(lx, y0 + h + 14, 9, 9);
      g.fillStyle = '#c8cede';
      g.fillText(s.label, lx + 13, y0 + h + 23);
      lx += g.measureText(s.label).width + 32;
    }
    g.fillStyle = '#8a93a8';
    g.fillText(`Day ${H[0].d} → ${H[H.length - 1].d}`, x0 + 2, y0 + h + 44);
  }
}

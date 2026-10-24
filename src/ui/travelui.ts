/* ============================================================
   The travel screens (Milestone 5): the journey (a line from
   here to there with the vehicle moving along it, the clock
   racing at home, something that happened on the way), the city
   you're visiting, and what changed while you were away.
   ============================================================ */
import type { TravelView } from '../player/travel';
import type { City, Mode } from '../sim/gateways';

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const HOW: Record<Mode, string> = { road: 'On the road', rail: 'On the Intercity Express', sea: 'At sea', air: 'In the air', heli: 'By air taxi' };

export class TravelUI implements TravelView {
  private mode = '';

  private open(kind: string): HTMLElement {
    const el = $('travel');
    el.className = `on ${kind}`;
    requestAnimationFrame(() => el.classList.add('shown'));
    return $('tv-card');
  }

  journey(o: { from: string; to: string; mode: Mode; icon: string; k: number; clock: string; event: string | null; back: boolean }): void {
    const card = this.open('journey');
    if (this.mode !== 'journey:' + o.to) {
      this.mode = 'journey:' + o.to;
      card.innerHTML = `<div class="tv-over">${esc(HOW[o.mode])}</div>
        <div class="tv-title">${esc(o.back ? 'Home to ' + o.to : o.to)}</div>
        <div class="tv-route"><span>${esc(o.from)}</span><i class="tv-line"><b id="tv-dot">${o.icon}</b><em id="tv-fill"></em></i><span>${esc(o.to)}</span></div>
        <i class="tv-clock" id="tv-clock"></i>
        <p class="tv-event" id="tv-event"></p>`;
    }
    $('tv-dot').style.left = `${Math.round(o.k * 100)}%`;
    $('tv-fill').style.width = `${Math.round(o.k * 100)}%`;
    $('tv-clock').textContent = o.clock;
    const ev = $('tv-event');
    if (o.event && ev.textContent !== o.event) { ev.textContent = o.event; ev.classList.add('in'); }
  }

  city(o: { c: City; clock: string; notes: string[]; actions: { label: string; sub?: string; act: () => void }[] }): void {
    const card = this.open('city');
    this.mode = 'city';
    card.innerHTML = `<div class="tv-over">${esc(o.clock)}</div>
      <div class="tv-title"><span class="emo">${o.c.emoji}</span>${esc(o.c.name)}</div>
      <p class="tv-blurb">${esc(o.c.blurb)}</p>
      ${o.notes.length ? `<div class="tv-notes">${o.notes.map((n) => `<p>${esc(n)}</p>`).join('')}</div>` : ''}
      <div class="tv-actions">${o.actions.map((a, i) => `<button class="${i === o.actions.length - 1 ? 'primary' : ''}" data-tv="${i}"><span>${esc(a.label)}</span>${a.sub ? `<small>${esc(a.sub)}</small>` : ''}</button>`).join('')}</div>`;
    card.querySelectorAll<HTMLElement>('[data-tv]').forEach((el) => el.addEventListener('click', () => o.actions[+el.dataset.tv!].act()));
  }

  summary(o: { title: string; lines: string[]; headlines: string[]; done: () => void }): void {
    const card = this.open('summary');
    this.mode = 'summary';
    card.innerHTML = `<div class="tv-over">While you were away</div>
      <div class="tv-title">${esc(o.title)}</div>
      <div class="tv-notes">${o.lines.map((l) => `<p>${esc(l)}</p>`).join('')}</div>
      ${o.headlines.length ? `<div class="tv-news"><b>The news you missed</b>${o.headlines.map((h) => `<p>${esc(h)}</p>`).join('')}</div>` : ''}
      <div class="tv-actions"><button class="primary" id="tv-ok"><span>Back to the village</span></button></div>`;
    $('tv-ok').addEventListener('click', () => o.done());
  }

  hide(): void {
    this.mode = '';
    const el = $('travel');
    el.classList.remove('shown');
    setTimeout(() => { if (!el.classList.contains('shown')) el.className = ''; }, 500);
  }
}

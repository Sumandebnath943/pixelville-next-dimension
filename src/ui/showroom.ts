/* ============================================================
   The showroom: the models on the floor, each in a choice of
   paint, with what it costs and how it drives; and the part
   exchange desk, which buys back what the Founder owns (from
   the showroom's own till, so a struggling one offers less).
   ============================================================ */
import { CAT } from '../sim/catalog';
import { Model, PAINTS, PAINT_NAMES, SPEC } from '../player/fleet';
import type { Motoring } from '../player/motoring';
import type { Wallet } from '../player/wallet';

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** a side view in the chosen paint */
function art(kind: 'car' | 'moto', color: string): string {
  if (kind === 'moto') {
    return `<svg viewBox="0 0 120 52"><g fill="#121316"><circle cx="27" cy="38" r="11"/><circle cx="93" cy="38" r="11"/></g>
      <g fill="#8a9098"><circle cx="27" cy="38" r="5"/><circle cx="93" cy="38" r="5"/></g>
      <path d="M93 38 L82 14" stroke="#c8ccd2" stroke-width="3" fill="none"/>
      <path d="M40 30 Q44 22 54 20 Q66 15 78 19 L84 22 L80 27 L58 28 L48 34 Z" fill="${color}"/>
      <path d="M30 26 L56 24 L56 27 L32 30 Z" fill="#1d1e22"/><path d="M80 12 L88 10" stroke="#1d1e22" stroke-width="3"/>
      <path d="M44 38 L62 30 L70 38 Z" fill="#2a2c31"/></svg>`;
  }
  return `<svg viewBox="0 0 120 52"><path d="M6 37 L8 29 Q10 25 18 24 L34 22 Q43 12 56 11 L80 11 Q91 12 99 22 L111 24 Q116 25 116 31 L116 37 Z" fill="${color}"/>
    <path d="M40 22 Q47 15 56 14.5 L66 14.5 L66 22 Z M70 14.5 L80 14.5 Q88 15 93 22 L70 22 Z" fill="#1a2028" opacity="0.85"/>
    <g fill="#121316"><circle cx="30" cy="38" r="9"/><circle cx="94" cy="38" r="9"/></g>
    <g fill="#9aa0a8"><circle cx="30" cy="38" r="4.5"/><circle cx="94" cy="38" r="4.5"/></g></svg>`;
}

export class Showroom {
  private b: any = null;
  private paint: Record<string, number> = {};

  constructor(private moto: Motoring, private purse: Wallet, private show: () => void, private close: () => void) {}

  open(b: any): void {
    this.b = b;
    this.render();
    this.show();
  }

  private render(): void {
    const b = this.b;
    if (!b) return;
    const name = CAT[b.type].name;
    $('sr-title').textContent = name;
    $('sr-sub').textContent = `You have $${Math.floor(this.purse.balance)}. New ones are parked outside, fuelled up; whatever you were driving goes home to the Lodge garage.`;
    let h = '';
    for (const m of this.moto.stock(b)) {
      const pi = this.paint[m.id] ?? 0;
      const sp = SPEC[m.kind];
      const short = m.price - this.purse.balance;
      h += `<div class="sr-card">
        <div class="sr-art">${art(m.kind, PAINTS[pi])}</div>
        <div class="sr-name"><b>${esc(m.name)}</b><span>$${m.price}</span></div>
        <p>${esc(m.blurb)}</p>
        <div class="sr-spec"><span>${Math.round(sp.max * 3.6)} km/h</span><span>${sp.range} km a tank</span></div>
        <div class="sr-paints">${PAINTS.map((p, i) => `<button class="sw${i === pi ? ' on' : ''}" style="--c:${p}" data-m="${m.id}" data-p="${i}" title="${PAINT_NAMES[i]}"></button>`).join('')}</div>
        <button class="${short > 0 ? '' : 'primary '}sr-buy" data-buy="${m.id}">${short > 0 ? `Need $${Math.ceil(short)} more` : `Buy in ${PAINT_NAMES[pi].toLowerCase()}`}</button>
      </div>`;
    }
    $('sr-models').innerHTML = h;
    // part exchange
    const items = this.moto.tradeable(b);
    $('sr-trade').innerHTML = items.length
      ? items.map((v) => {
        const offer = this.moto.offer(v, b);
        return `<div class="save-slot"><span class="slot-name">${esc(v.name)}<small>${v.where === 'lodge' ? 'In the Lodge garage' : 'Parked outside'} · condition ${Math.round(100 - v.damage)}%</small></span>
          <button data-sell="${v.id}" ${offer ? '' : 'disabled'}>${offer ? `Sell for $${offer}` : 'No cash in the till'}</button></div>`;
      }).join('')
      : '<p class="note">Nothing to sell here: vehicles in the Lodge garage, or the one you came in, can be part-exchanged.</p>';
    // wiring
    document.querySelectorAll<HTMLElement>('#sr-models .sw').forEach((el) => el.addEventListener('click', () => { this.paint[el.dataset.m!] = +el.dataset.p!; this.render(); }));
    document.querySelectorAll<HTMLElement>('#sr-models [data-buy]').forEach((el) => el.addEventListener('click', () => {
      const m = this.moto.stock(b).find((q: Model) => q.id === el.dataset.buy)!;
      if (this.moto.buy(m, PAINTS[this.paint[m.id] ?? 0], b)) this.close();
      else this.render();
    }));
    document.querySelectorAll<HTMLElement>('#sr-trade [data-sell]').forEach((el) => el.addEventListener('click', () => {
      const v = this.moto.tradeable(b).find((q) => q.id === +el.dataset.sell!);
      if (v) { this.moto.tradeIn(v, b); this.render(); }
    }));
  }
}

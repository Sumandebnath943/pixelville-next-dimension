/* ============================================================
   At the counter, the cash machine or the ticket machine: what's
   for sale and what it costs you (with any discount), what else
   the place can do for you, your balance and recent spending, or
   the tickets on offer. One modal for all three.
   ============================================================ */
import { CAT } from '../sim/catalog';
import { Rep } from '../sim/reputation';
import { TICKETS, WARES, Ware } from '../interiors/plan';
import { buy, listPrice, BagItem, WareUse } from '../player/shopping';
import { Supply } from '../sim/supply';
import type { Wallet } from '../player/wallet';

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface CounterApi {
  purse: Wallet;
  bag: () => BagItem[];
  owed: () => number;
  toast: (m: string) => void;
  show: () => void;
  close: () => void;
  /** the building card's own actions (browse the cars, collect an impounded car…) */
  extra: (b: any) => { label: string; run: () => void }[];
  about: (b: any) => void;
  /** chat with whoever is serving */
  talk: (p: any) => void;
  /** V2: what a purchase does for the Founder (eaten, worn, a treatment, a service, an outing) */
  use?: (u: WareUse, b: any) => void;
}

export class Counter {
  constructor(private api: CounterApi) {}

  open(kind: 'counter' | 'atm' | 'tickets', b: any, server: any | null = null): void {
    const name = CAT[b.type].name;
    let html = '';
    if (kind === 'atm') {
      $('cu-title').textContent = 'Cash machine';
      const w = this.api.purse, day = w.day(), owed = this.api.owed();
      $('cu-sub').textContent = 'Your balance and what went in and out lately.';
      html += `<dl class="facts"><dt>Balance</dt><dd>$${Math.floor(w.balance)}</dd><dt>Today</dt><dd>+$${day.in} · −$${day.out}</dd>${owed ? `<dt>Fines owed</dt><dd>$${owed} (taken as money comes in)</dd>` : ''}${w.owing() ? `<dt>Bills owed</dt><dd>$${Math.round(w.owing())} (${esc(w.bills.map((b) => b.label.toLowerCase()).join(', '))}; paid off as money comes in)</dd>` : ''}</dl>`;
      html += w.ledger.slice(-6).reverse().map((e) => `<div class="save-slot"><span class="slot-name">${esc(e.label)}<small>Day ${e.day}, ${e.time}</small></span><b style="color:var(--${e.amount >= 0 ? 'ok' : 'bad'})">${e.amount >= 0 ? '+' : '−'}$${Math.abs(e.amount)}</b></div>`).join('');
    } else {
      const list: Ware[] = kind === 'tickets' ? TICKETS[b.type] || [] : WARES[b.type] || [];
      const deal = Rep.price(b, 100);
      $('cu-title').textContent = kind === 'tickets' ? 'Ticket machine' : name;
      // V2: what's on the shelves (thin shelves cost more; bare ones sell nothing)
      const shelf = kind === 'counter' ? Supply.shelf(b) : null;
      const stock = shelf ? ` Shelves: ${shelf.label.toLowerCase()}${shelf.mult > 1.04 ? ` (prices up ${Math.round((shelf.mult - 1) * 100)}%)` : ''}.` : '';
      $('cu-sub').textContent = kind === 'tickets' ? 'Keep the ticket in your bag for the journey.'
        : deal.refused ? `${server ? server.name : 'The staff'} won't serve you: they've heard about you.`
          : `${server ? `${server.name} ${server.surname} is serving.` : ''}${deal.note ? ` ${deal.note[0].toUpperCase()}${deal.note.slice(1)}.` : ''}${stock} You have $${Math.floor(this.api.purse.balance)}.`;
      if (!deal.refused || kind === 'tickets') {
        html += list.map((w, i) => {
          const base = listPrice(b, w, kind === 'tickets');
          const p = Rep.price(b, base);
          const price = w.price === 0 ? 'Free' : shelf?.empty ? 'Sold out' : `${p.cost < base ? `<s>$${base}</s> ` : ''}$${p.cost}`;
          return `<div class="save-slot"><span class="slot-name">${esc(w.name)}<small>${price}</small></span><button class="primary" data-buy="${i}">${w.price === 0 ? 'Take one' : 'Buy'}</button></div>`;
        }).join('') || '<p class="note">Nothing for sale here.</p>';
      }
      if (kind === 'counter') {
        const extra = this.api.extra(b);
        if (server) html += `<button class="ph-wide" id="cu-talk">Talk to ${esc(server.name)}</button>`;
        if (extra.length) html += `<h2>Also here</h2>${extra.map((x, i) => `<button class="ph-wide" data-extra="${i}">${esc(x.label)}</button>`).join('')}`;
        html += `<p class="note"><a href="#" id="cu-about">About the ${esc(name)}</a></p>`;
        $('cu-body').innerHTML = html;
        document.getElementById('cu-talk')?.addEventListener('click', () => { this.api.close(); this.api.talk(server); });
        $('cu-body').querySelectorAll<HTMLElement>('[data-extra]').forEach((el) => el.addEventListener('click', () => { this.api.close(); extra[+el.dataset.extra!].run(); }));
        $('cu-about').addEventListener('click', (e) => { e.preventDefault(); this.api.close(); this.api.about(b); });
      } else $('cu-body').innerHTML = html;
      $('cu-body').querySelectorAll<HTMLElement>('[data-buy]').forEach((el) => el.addEventListener('click', () => {
        const r = buy(this.api.purse, this.api.bag(), b, list[+el.dataset.buy!], kind === 'counter' ? server : null, kind === 'tickets');
        this.api.toast(r.msg);
        if (r.ok && r.use) this.api.use?.(r.use, b);
        this.open(kind, b, server);
      }));
      this.api.show();
      return;
    }
    $('cu-body').innerHTML = html;
    this.api.show();
  }
}

/* ============================================================
   The departures board (Milestone 5): F at a bus stop, a station,
   a dock, a taxi rank, the airport or a heliport lists what leaves
   from here: buses and trains in town, the ferry, a cab, the
   sightseeing flight, and the trips off the map.
   ============================================================ */
const $ = (id: string) => document.getElementById(id)!;
const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface Departure { label: string; sub: string; act: () => void }

export class Departures {
  constructor(private show: () => void, private close: () => void) {}

  open(title: string, sub: string, list: Departure[]): void {
    $('dp-title').textContent = title;
    $('dp-sub').textContent = sub;
    $('dp-body').innerHTML = list.length
      ? list.map((d, i) => `<div class="save-slot"><span class="slot-name">${esc(d.label)}<small>${esc(d.sub)}</small></span><button class="primary" data-dep="${i}">Go</button></div>`).join('')
      : '<p class="note">Nothing leaves from here yet.</p>';
    $('dp-body').querySelectorAll<HTMLElement>('[data-dep]').forEach((el) => el.addEventListener('click', () => {
      this.close();
      list[+el.dataset.dep!].act();
    }));
    this.show();
  }
}

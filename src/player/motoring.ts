/* ============================================================
   Owning a vehicle (design §10): the places that serve one and
   the rules that come with one. Showrooms sell and buy back,
   the Lodge garage keeps what isn't out, gas stations fill the
   tank, the auto garage mends the dents, and where there is a
   police station there are wardens: park badly and there's a
   ticket, leave it and it's towed to the impound lot at the
   station. Every dollar goes to a real balance — the business,
   or the village fund for fines and fees.
   ============================================================ */
import { World } from '../sim/world';
import { CAT } from '../sim/catalog';
import { Gov } from '../sim/gov';
import { Game } from '../sim/game';
import { Rep } from '../sim/reputation';
import type { Founder } from './founder';
import type { Gps } from './gps';
import { distLabel } from './gps';
import { MODELS, Model, SPEC, Vehicle, parkingOffence } from './fleet';
import type { Interaction } from './errands';

const TM = 8;
const TICKET_AFTER = 45; // game minutes parked illegally before a warden writes a ticket
const TOW_AFTER = 135; // … and before the tow truck comes
const FINE = 15, TOW_FEE = 35;
export const IMPOUND_FEE = 40;
type Toast = (msg: string, at?: { x: number; y: number }, news?: boolean) => void;

export class Motoring {
  private illegalT = 0;
  private ticketed = false;
  private checkT = 0;
  private reason: string | null = null;
  private warned: Record<string, boolean> = {};
  private owedT = 0;

  /** `clock` is the sim's time of day in minutes */
  constructor(private f: Founder, private gps: Gps, private toast: Toast, private clock: () => number, private openShowroom: (b: any) => void) {}

  isOpen(b: any): boolean {
    if (b.ruined || b.construction) return false;
    const h = CAT[b.type]?.hours;
    const t = this.clock();
    return !h || (t >= h.s && t < h.e);
  }
  private nearest(type: string, x: number, z: number): any | null {
    let best: any = null, bd = Infinity;
    for (const b of World.buildings) {
      if (b.type !== type || b.ruined || b.construction || !b.connected) continue;
      const d = Math.hypot(b.door.x * TM + 4 - x, b.door.y * TM + 4 - z);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
  private pin(b: any): { x: number; y: number } {
    return { x: (b.door.x + 0.5) * 16, y: (b.door.y + 0.5) * 16 };
  }

  /* ---------- every frame ---------- */
  update(dt: number): void {
    const f = this.f, v = f.vehicle;
    // fines left unpaid come out of the wallet as soon as there's money in it
    this.owedT -= dt;
    if (f.fleet.owed > 0 && this.owedT <= 0 && f.wallet >= 1) {
      this.owedT = 5;
      const paid = Math.min(f.fleet.owed, Math.floor(f.wallet));
      f.purse.spend(paid, 'Outstanding fines', 'fine');
      Gov.treasury += paid;
      f.fleet.owed -= paid;
      this.toast(`🧾 Paid $${paid} of your outstanding fines${f.fleet.owed > 0 ? ` — $${Math.round(f.fleet.owed)} still owed` : ''}`);
    }
    if (v) this.warnings(v);
    const own = f.fleet.cur;
    if (!own) { this.illegalT = 0; this.ticketed = false; return; }
    this.wardens(dt, own);
  }

  private warnings(v: Vehicle): void {
    const f = this.f, w = this.warned;
    const here = { x: f.car.x, z: f.car.z };
    if (v.fuel < 0.15 && !w.fuel && f.driving) {
      w.fuel = true;
      const g = this.nearest('gas', here.x, here.z);
      this.toast(`⛽ Fuel's low in the ${v.name}${g ? ' — the nearest gas station is here' : ' — and the village has no gas station yet'}`, g ? this.pin(g) : undefined);
    } else if (v.fuel > 0.3) w.fuel = false;
    if (v.fuel <= 0 && !w.empty && f.driving) { w.empty = true; this.toast(`⛽ The ${v.name} has run dry — it will only crawl now`); }
    else if (v.fuel > 0) w.empty = false;
    if (v.damage >= 50 && !w.dmg && v.damage < 100) {
      w.dmg = true;
      const g = this.nearest('autoshop', here.x, here.z);
      this.toast(`🔧 The ${v.name} is badly knocked about and losing power${g ? ' — the nearest auto garage is here' : ''}`, g ? this.pin(g) : undefined);
    } else if (v.damage < 40) w.dmg = false;
    if (v.damage >= 100 && !w.wreck) { w.wreck = true; this.toast(`💥 The ${v.name} is wrecked — call a tow from the phone's Garage app`); }
    else if (v.damage < 100) w.wreck = false;
  }

  /** wardens (only where there's a police station to send them), on the owned vehicle wherever it stands */
  private wardens(dt: number, v: Vehicle): void {
    const f = this.f;
    const at = f.ownedAt();
    const policed = World.buildings.some((b: any) => b.type === 'police' && b.connected && !b.ruined && !b.construction);
    if (!at || (f.driving && !f.hijacked && !f.work) || !policed) { this.illegalT = 0; this.ticketed = false; return; }
    this.checkT -= dt;
    if (this.checkT <= 0) { this.checkT = 1; this.reason = this.atLodge(at) ? null : parkingOffence(at.x, at.z); }
    if (!this.reason) { this.illegalT = 0; this.ticketed = false; return; }
    this.illegalT += dt * (Game.speed() || 0); // game minutes (one a second at 1×)
    if (!this.ticketed && this.illegalT > TICKET_AFTER) {
      this.ticketed = true;
      const paid = this.fine(FINE, `Parking ticket · ${this.reason}`);
      this.toast(`🎫 Parking ticket for the ${v.name}: $${FINE} — it's ${this.reason}${paid < FINE ? ' (owed until you can pay)' : ''}`, { x: at.x * 2, y: at.z * 2 });
    }
    if (this.ticketed && this.illegalT > TOW_AFTER) {
      const station = this.nearest('police', at.x, at.z);
      if (!station) return;
      f.stow('impound');
      v.impound = { station: station.id, fee: IMPOUND_FEE };
      this.illegalT = 0;
      this.ticketed = false;
      this.toast(`🚚 The ${v.name} was towed to the impound lot at the police station — $${IMPOUND_FEE} to collect it`, this.pin(station), true);
    }
  }

  /** the Founder's own drive is always fine, wherever the road runs */
  private atLodge(at: { x: number; z: number } = this.f.car): boolean {
    const lodge = World.buildings.find((b: any) => b.type === 'lodge');
    return !!lodge && Math.hypot(at.x - (lodge.door.x * TM + 4), at.z - (lodge.door.y * TM + 4)) < 12;
  }

  /** a fine paid as far as the wallet allows; the rest is owed. Returns what was paid now */
  fine(amount: number, label: string): number {
    const f = this.f;
    const paid = Math.min(amount, Math.max(0, Math.floor(f.wallet)));
    if (paid) f.purse.spend(paid, label, 'fine');
    Gov.treasury += paid;
    f.fleet.owed += amount - paid;
    return paid;
  }

  /* ---------- at the wheel: fill up, get it mended ---------- */
  interaction(): Interaction | null {
    const f = this.f, v = f.vehicle;
    // (a work vehicle is fuelled and mended at its depot)
    if (!v || v.work || !f.driving || Math.abs(f.car.speed) > 1) return null;
    const sp = SPEC[v.kind];
    const gas = this.nearest('gas', f.car.x, f.car.z);
    if (gas && v.fuel < 0.97 && this.within(gas, 7)) {
      const p = Rep.price(gas, Math.max(1, Math.ceil((1 - v.fuel) * sp.tank)));
      if (p.refused) return { text: "The staff at the gas station won't serve you", act: () => {} };
      return { text: `<b>E</b> fill up · $${p.cost}${p.note ? ` (${p.note})` : ''}`, act: () => this.fillUp(v, gas, p.cost, p.rate) };
    }
    const shop = this.nearest('autoshop', f.car.x, f.car.z);
    if (shop && (v.damage > 2 || v.flat) && this.within(shop, 8)) {
      if (!this.isOpen(shop)) return { text: 'The auto garage is closed (8:00–18:00)', act: () => {} };
      const p = Rep.price(shop, this.repairCost(v));
      if (p.refused) return { text: "The mechanics won't touch your car", act: () => {} };
      return { text: `<b>E</b> repair the ${v.name} · $${p.cost}${p.note ? ` (${p.note})` : ''}`, act: () => this.repair(v, shop, p.cost, p.rate) };
    }
    return null;
  }
  private repairCost(v: Vehicle): number {
    return Math.max(1, Math.ceil(v.damage * SPEC[v.kind].repair)) + (v.flat ? 20 : 0);
  }
  /** the car is on the building's plot or the road in front of it */
  private within(b: any, pad: number): boolean {
    const c = this.f.car;
    return c.x > b.x * TM - pad && c.x < (b.x + b.w) * TM + pad && c.z > b.y * TM - pad && c.z < (b.y + b.h) * TM + pad;
  }
  /** `rate` is what the staff charge the Founder against the list price (a discount for a favourite customer) */
  private fillUp(v: Vehicle, gas: any, cost: number, rate = 1): void {
    const f = this.f, sp = SPEC[v.kind];
    const pay = Math.min(cost, Math.floor(f.wallet));
    if (pay <= 0) { this.toast('👛 Not enough money for fuel'); return; }
    f.purse.spend(pay, `Fuel for the ${v.name}`, 'purchase', gas);
    v.fuel = pay >= cost ? 1 : Math.min(1, v.fuel + pay / (sp.tank * rate));
    this.toast(pay < cost ? `⛽ $${pay} of fuel — all the wallet would stretch to` : `⛽ Filled up the ${v.name} — $${pay}`);
  }
  private repair(v: Vehicle, shop: any, cost: number, rate = 1): void {
    const f = this.f, sp = SPEC[v.kind];
    const pay = Math.min(cost, Math.floor(f.wallet));
    if (pay <= 0) { this.toast('👛 Not enough money for repairs'); return; }
    f.purse.spend(pay, `Repairs to the ${v.name}`, 'purchase', shop);
    v.damage = pay >= cost ? 0 : Math.max(0, v.damage - pay / (sp.repair * rate));
    v.flat = false;
    this.toast(pay < cost ? `🔧 The mechanics did $${pay} of work — it's better, not perfect` : `🔧 The ${v.name} is as good as new — $${pay}`);
  }

  /* ---------- what a building's card offers ---------- */
  buildingActions(b: any): { label: string; run: () => void }[] {
    const f = this.f, out: { label: string; run: () => void }[] = [];
    const atDoor = Math.hypot(b.door.x * TM + 4 - f.pos.x, b.door.y * TM + 4 - f.pos.z) < 14 && !f.driving;
    if (!atDoor) return out;
    const cur = f.vehicle;
    if ((b.type === 'carshowroom' || b.type === 'motoshowroom') && this.isOpen(b)) {
      out.push({ label: b.type === 'carshowroom' ? 'Browse the cars' : 'Browse the motorcycles', run: () => this.openShowroom(b) });
    }
    if (b.type === 'lodge') {
      const home = cur && Math.hypot(f.car.x - (b.door.x * TM + 4), f.car.z - (b.door.y * TM + 4)) < 40;
      if (cur && home && !cur.work) out.push({ label: `Put the ${cur.name} away`, run: () => { f.stow('lodge'); this.toast(`🏠 The ${cur.name} is in the garage`); } });
      for (const v of f.fleet.list.filter((q) => q.where === 'lodge')) {
        out.push({
          label: `Take out the ${v.name}`,
          run: () => {
            if (cur && !home) { this.toast(`🏠 Bring the ${cur.name} home first — one vehicle out at a time`); return; }
            const s = f.lodgeSpot(b);
            f.useVehicle(v, s.x, s.z, s.yaw);
            this.toast(`🏠 The ${v.name} is out in the drive${cur ? ` — the ${cur.name} went in` : ''}`);
          },
        });
      }
    }
    if (b.type === 'police') {
      for (const v of f.fleet.list.filter((q) => q.where === 'impound' && q.impound?.station === b.id)) {
        out.push({ label: `Collect the ${v.name} · $${v.impound!.fee}`, run: () => this.collect(v, b) });
      }
    }
    if (b.type === 'autoshop' && cur && cur.damage > 2 && Math.hypot(f.car.x - (b.door.x * TM + 4), f.car.z - (b.door.y * TM + 4)) < 30) {
      const p = Rep.price(b, this.repairCost(cur));
      if (this.isOpen(b) && !p.refused) out.push({ label: `Repair the ${cur.name} · $${p.cost}`, run: () => this.repair(cur, b, p.cost, p.rate) });
    }
    return out;
  }

  private collect(v: Vehicle, station: any): void {
    const f = this.f, fee = v.impound?.fee ?? IMPOUND_FEE;
    if (f.wallet < fee) { this.toast(`👛 The impound fee is $${fee} — you have $${Math.floor(f.wallet)}`); return; }
    f.purse.spend(fee, `Impound fee · the ${v.name}`, 'fine');
    Gov.treasury += fee;
    const prev = f.vehicle;
    const s = this.frontage(station);
    f.useVehicle(v, s.x, s.z, s.yaw);
    this.toast(`🚓 The ${v.name} is released — it's parked outside${prev ? ` (the ${prev.name} went back to the Lodge)` : ''}`);
  }

  /** a legal spot at the kerb in front of a building, nose along the traffic */
  frontage(b: any): { x: number; z: number; yaw: number } {
    const tiles: [number, number][] = [];
    for (let r = 0; r <= 4; r++)
      for (let j = -r; j <= r; j++)
        for (let i = -r; i <= r; i++) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
          const x = b.door.x + i, y = b.door.y + j;
          if (World.isRoad(x, y)) tiles.push([x, y]);
        }
    for (const [tx, tz] of tiles) {
      const ew = World.isRoad(tx - 1, tz) || World.isRoad(tx + 1, tz);
      const cand: { x: number; z: number; yaw: number }[] = [];
      if (ew) {
        if (!World.isRoad(tx, tz - 1)) cand.push({ x: tx * TM + 4, z: tz * TM + 1.9, yaw: -Math.PI / 2 }); // north kerb, heading west
        if (!World.isRoad(tx, tz + 1)) cand.push({ x: tx * TM + 4, z: (tz + 1) * TM - 1.9, yaw: Math.PI / 2 });
      } else {
        if (!World.isRoad(tx - 1, tz)) cand.push({ x: tx * TM + 1.9, z: tz * TM + 4, yaw: 0 }); // west kerb, heading south
        if (!World.isRoad(tx + 1, tz)) cand.push({ x: (tx + 1) * TM - 1.9, z: tz * TM + 4, yaw: Math.PI });
      }
      // the kerb nearer the building first
      cand.sort((p, q) => Math.hypot(p.x - (b.door.x * TM + 4), p.z - (b.door.y * TM + 4)) - Math.hypot(q.x - (b.door.x * TM + 4), q.z - (b.door.y * TM + 4)));
      for (const c of cand) if (!parkingOffence(c.x, c.z)) return c;
    }
    return { x: b.door.x * TM + 4, z: b.door.y * TM + 4, yaw: 0 };
  }

  /* ---------- the showroom ---------- */
  buy(m: Model, color: string, showroom: any): boolean {
    const f = this.f, p = Rep.price(showroom, m.price);
    if (p.refused) { this.toast("🙅 The sales staff won't deal with you"); return false; }
    if (!f.purse.spend(p.cost, `Bought a ${m.name}`, 'purchase', showroom)) {
      this.toast(`👛 The ${m.name} is $${p.cost} — you have $${Math.floor(f.wallet)}`);
      return false;
    }
    const prev = f.vehicle;
    const v = f.fleet.add({ model: m.id, name: m.name, kind: m.kind, style: m.style, color, price: m.price });
    const s = this.frontage(showroom);
    f.useVehicle(v, s.x, s.z, s.yaw);
    this.toast(`🔑 The ${m.name} is yours — it's parked outside${prev ? `. The ${prev.name} went home to the Lodge garage` : ''}`);
    return true;
  }
  /** vehicles a showroom would take in part-exchange: in the garage, or the one out if it's here */
  tradeable(showroom: any): Vehicle[] {
    const f = this.f;
    const here = (v: Vehicle): boolean => v.where === 'out' && Math.hypot(f.car.x - (showroom.door.x * TM + 4), f.car.z - (showroom.door.y * TM + 4)) < 40;
    return f.fleet.list.filter((v) => v.where === 'lodge' || here(v));
  }
  offer(v: Vehicle, showroom: any): number {
    return Math.min(this.f.fleet.value(v), Math.max(0, Math.floor(showroom.funds || 0)));
  }
  tradeIn(v: Vehicle, showroom: any): void {
    const f = this.f, amount = this.offer(v, showroom);
    if (amount <= 0) { this.toast('🏷️ The showroom has no cash to buy cars back right now'); return; }
    if (f.vehicle === v) f.stow('lodge');
    f.purse.earn(amount, `Sold the ${v.name}`, 'income', showroom);
    f.fleet.remove(v);
    this.toast(`🏷️ Sold the ${v.name} to the showroom for $${amount}`);
  }

  /* ---------- the phone's Garage app ---------- */
  where(v: Vehicle): string {
    const f = this.f;
    if (v.where === 'lodge') return 'In the Lodge garage';
    if (v.where === 'impound') return `Impounded · $${v.impound?.fee ?? IMPOUND_FEE} to collect`;
    if (f.driving && !f.hijacked) return 'You are driving it';
    const at = f.ownedAt()!;
    if (this.atLodge(at)) return 'In the Lodge drive';
    const reason = parkingOffence(at.x, at.z);
    return `Parked ${distLabel(Math.hypot(at.x - f.pos.x, at.z - f.pos.z))} away${reason ? ` · ${reason}!` : ''}`;
  }
  find(v: Vehicle, lodge: any): void {
    const f = this.f, at = f.ownedAt();
    if (v.where === 'out' && at) this.gps.set(at.x, at.z, `Your ${v.name}`);
    else if (v.where === 'impound') {
      const st = World.buildings.find((b: any) => b.id === v.impound?.station);
      if (st) this.gps.set(st.door.x * TM + 4, st.door.y * TM + 4, 'The impound lot');
    } else if (lodge) this.gps.set(lodge.door.x * TM + 4, lodge.door.y * TM + 4, "The Founder's Lodge");
  }
  /** a tow truck takes the vehicle that's out home (or a wreck to the auto garage, where it can be mended) */
  tow(v: Vehicle): void {
    const f = this.f;
    if (v.where !== 'out' || f.fleet.cur !== v) return;
    const shop = v.damage >= 60 && !f.hijacked ? this.nearest('autoshop', f.car.x, f.car.z) : null;
    const paid = this.fine(TOW_FEE, `Tow truck · the ${v.name}`);
    if (shop) {
      const s = this.frontage(shop);
      f.useVehicle(v, s.x, s.z, s.yaw);
      this.toast(`🚚 Towed the ${v.name} to the auto garage — the mechanics are expecting it${paid < TOW_FEE ? ' ($' + (TOW_FEE - paid) + ' owed)' : ''}`, this.pin(shop));
    } else {
      f.stow('lodge');
      this.toast(`🚚 Towed the ${v.name} home to the Lodge garage${paid < TOW_FEE ? ' ($' + (TOW_FEE - paid) + ' owed)' : ''}`);
    }
  }

  /** the police take the vehicle that's out to the impound lot at `station` (after an arrest) */
  impound(v: Vehicle, station: any): void {
    if (v.where !== 'out' || this.f.fleet.cur !== v) return;
    this.f.stow('impound');
    v.impound = { station: station.id, fee: IMPOUND_FEE };
  }

  /** the models a showroom sells */
  stock(showroom: any): Model[] {
    return MODELS.filter((m) => (showroom.type === 'motoshowroom' ? m.kind === 'moto' : m.kind === 'car'));
  }
}

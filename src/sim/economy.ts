/* ============================================================
   The village's money (V2): every dollar has a payer.
   A place pays its people out of its own till, and the till
   fills from what it sells: to villagers, to visitors, and to
   the world beyond the map (an office's clients, a mill's
   buyers, a shop's passing trade from the villages around; the
   rest it has to earn here). Public services (the school, the
   hospital, the police and the rest of the civic list) are paid
   from the village fund, which the county's grant for every
   resident and the taxes fill. A place that can't pay its
   people says so, and its people feel it; nobody gets a service
   for nothing; a bill nobody can pay becomes a debt, paid off as
   money comes in. Money only enters or leaves the village at the
   edge of the map: exports and imports, visitors, the county.
   ============================================================ */
import type { Building, Person } from './types';
import { CAT } from './catalog';
import { World } from './world';
import { Sim, WAGES } from './agents';
import { Life } from './life';
import { Gov } from './gov';
import { Mind } from './mind';
import { Edu } from './education';
import { Calamity } from './calamity';
import { SELLS, MAKES, GOODS } from './supply';

/** what the county sends the village fund each day for every resident */
export const COUNTY_GRANT = 6;
/** a day's wages (as a share) that a place earns beyond the map for every day its staff put in */
const TRADE_WORK = 1.1, TRADE_MAKER = 0.75, TRADE_SHOP = 0.55, TRADE_TRANSPORT = 0.65;
const TRADE: Record<string, number> = {
  // (a bank lends and keeps accounts for the whole valley; a showroom sells cars across the county; the airport's
  // airlines pay their landing fees; the gas station sells to everyone passing on the highway)
  bank: 0.9, carshowroom: 0.6, motoshowroom: 0.6, airport: 0.9, heliport: 0.8, gas: 0.7, hotel: 0.8, casino: 0.5,
  powerplant: 0.55, warehouse: 0.8, trainstation: 0.85, // (the national railway pays the station's staff their share)
};
/** how long a till can go without paying its staff in full before a villager's own business gives up */
const UNPAID_CLOSE = 6;
/** what the Founder pays for a patch-up at the hospital after being knocked down */
export const FOUNDER_TREATMENT = 90;
/** what a visit to casualty costs, seen and sent home */
export const OUTPATIENT_FEE = 6;
/** what the ambulance adds to the bill */
export const AMBULANCE_FEE = 12;

const active = (b: Building): boolean => !!b && b.connected && !b.construction && !b.ruined;
const byId = (id: number): Building | null => World.buildings.find((b: Building) => b.id === id) || null;

export const Economy = {
  /** paid from the village fund (the civic list) rather than by its own trade */
  isPublic(type: string): boolean {
    return CAT[type]?.cat === 'civic';
  },
  /** the share of a day's wages a place earns beyond the map for each day's work */
  trade(type: string): number {
    if (this.isPublic(type)) return 0;
    if (TRADE[type] !== undefined) return TRADE[type];
    const d = CAT[type];
    if (!d) return 0;
    if (MAKES[type] && !SELLS[type]) return TRADE_MAKER;
    if (d.cat === 'transport') return TRADE_TRANSPORT;
    if (d.visit) return TRADE_SHOP;
    return TRADE_WORK;
  },
  /** a day's wages for `p` at `b` */
  wageOf(p: Person, b: Building): number {
    let wage = (WAGES[b.type] || 15) * (p.wageMult || 1) * Edu.payMult(p, b); // V2: graduate posts pay more
    if (b.type === 'farm' && Calamity.droughtLevel >= 0.6) wage *= 0.5; // parched fields yield half a day's pay
    return wage;
  },
  /** a day's wages for everyone working at `b` */
  payroll(b: Building): number {
    let n = 0;
    for (const w of b.workers || []) n += this.wageOf(w, b);
    return n;
  },
  /** what a seller keeps back to restock its shelves (wages come out of the rest) */
  reserve(b: Building): number {
    const s = SELLS[b.type];
    return s ? s.cap * 0.5 * GOODS[s.g].unit * 0.5 : 0;
  },

  /** payday: `p` came to work at `b`. The day's work earns the place its trade from beyond the map, then the wage is
   *  paid from the till as far as it goes. Returns what was paid */
  payday(p: Person, b: Building, wage: number): number {
    const trade = wage * this.trade(b.type);
    if (trade > 0) { b.funds = (b.funds || 0) + trade; b.tradeToday = (b.tradeToday || 0) + trade; }
    const paid = Math.max(0, Math.min(wage, (b.funds || 0) - this.reserve(b)));
    b.funds -= paid;
    b.wagesToday = (b.wagesToday || 0) + paid;
    const short = wage - paid;
    if (short > 0.5) {
      b.unpaidToday = (b.unpaidToday || 0) + short;
      // the worker feels it (a little, unless it's most of the day's pay)
      p.mood = Math.max(5, (p.mood ?? 60) - (short / wage >= 0.5 ? 4 : 1.5));
      if ((b.unpaidDays || 0) === 1 && Math.random() < 0.5) Mind.remember(p, 'career', `wasn't paid in full at the ${CAT[b.type].name.toLowerCase()}`, -1, b.id);
    }
    return paid;
  },

  /** a household pays `amount` to `to` (a building, or null for the village fund) as far as it can; the rest is owed
   *  and comes out of its funds as money comes in. Returns what was paid now */
  bill(home: Building, to: Building | null, amount: number, keep = 0): number {
    if (!home || amount <= 0) return 0;
    const paid = Math.max(0, Math.min(amount, Math.floor((home.funds || 0) - keep)));
    home.funds -= paid;
    this.credit(to, paid);
    this.owe(home, to, amount - paid);
    return paid;
  },
  /** a household owes `amount` to `to` (null: the village fund) */
  owe(home: Building, to: Building | null, amount: number): void {
    const owed = Math.round(amount * 100) / 100;
    if (!home || owed <= 0.01) return;
    home.debts = home.debts || [];
    const id = to ? to.id : 0;
    const d = home.debts.find((x: any) => x.to === id);
    if (d) d.n += owed; else home.debts.push({ to: id, n: owed });
  },
  /** money into a building's till, or the village fund */
  credit(to: Building | null, amount: number): void {
    if (amount <= 0) return;
    if (to) to.funds = (to.funds || 0) + amount;
    else Gov.treasury += amount;
  },
  /** a neighbouring household pays `p` for an odd job, if one can spare it (false: no work today) */
  neighbourPays(p: Person, amount: number): boolean {
    const homes = World.buildings.filter((h: Building) => h !== p.home && CAT[h.type]?.res && h.residents?.length && !h.ruined && (h.funds || 0) >= 60 + amount);
    if (!homes.length) return false;
    homes[(Math.random() * homes.length) | 0].funds -= amount;
    return true;
  },
  /** what a household owes, all told */
  owed(home: Building): number {
    return (home.debts || []).reduce((s: number, d: any) => s + d.n, 0);
  },

  /** a building site is paid for: the commissioner's money (less the builders' own labour, the rest) buys its materials,
   *  and what's left of it opens the new place's till */
  commission(b: Building, cost: number, share = 0.4): void {
    b.siteFunds = (b.siteFunds || 0) + cost * share;
  },
  /** materials reach a site: paid from its budget as far as it goes (the Founder's sites, and the developers'
   *  houses the village grows on its own, are paid for from beyond the map). Returns what was paid */
  payForMaterials(site: Building, value: number): number {
    if (site.siteFunds === undefined) return value;
    const paid = Math.min(value, Math.max(0, site.siteFunds));
    site.siteFunds -= paid;
    return paid;
  },
  /** a site is finished: what's left of its budget goes to the new place's till (or the family's funds; a public
   *  building's back to the village fund) */
  finished(b: Building): void {
    // a workplace the Founder raised opens with a few days' wages in the till (god mode costs the village nothing)
    if (b.byFounder) { b.funds = (b.funds || 0) + this.openingCapital(b); delete b.byFounder; }
    const left = b.siteFunds;
    delete b.siteFunds;
    if (!left || left <= 0) return;
    if (this.isPublic(b.type) || (!CAT[b.type].jobs && !CAT[b.type].res)) Gov.treasury += left;
    else b.funds = (b.funds || 0) + left;
  },
  /** a workplace the Founder raised (god mode costs the village nothing): a few days' wages to open its doors with */
  openingCapital(b: Building): number {
    const d = CAT[b.type];
    if (!d.jobs || this.isPublic(b.type)) return 0;
    return Math.round((WAGES[b.type] || 15) * d.jobs * 3 + this.reserve(b) * 2);
  },

  /** the public services' budgets for the day ahead, from the village fund as far as it goes */
  budgets(): void {
    for (const b of World.buildings) {
      if (!this.isPublic(b.type) || !active(b) || !b.workers?.length) continue;
      const want = Math.max(0, this.payroll(b) * 1.05 - (b.funds || 0));
      const give = Math.min(want, Math.max(0, Gov.treasury));
      Gov.treasury -= give;
      b.funds = (b.funds || 0) + give;
    }
  },

  /* ---------- once a day ---------- */
  daily(): void {
    const say = (m: string, b?: Building) => Life.say(m, b ? { x: b.door.x * 16 + 8, y: b.door.y * 16 + 8 } : undefined);
    // the county's grant for every resident
    Gov.treasury += COUNTY_GRANT * Sim.people.length;
    Gov.grantToday = COUNTY_GRANT * Sim.people.length;
    // yesterday's pay at every workplace: a place that couldn't pay in full says so, once
    for (const b of World.buildings.slice()) {
      if (!CAT[b.type]?.jobs || b.ruined || b.construction) continue;
      b.unpaidDays = (b.unpaidToday || 0) > 0.5 ? (b.unpaidDays || 0) + 1 : 0;
      b.lastWages = Math.round(b.wagesToday || 0);
      b.lastUnpaid = Math.round(b.unpaidToday || 0);
      b.lastTrade = Math.round(b.tradeToday || 0);
      b.wagesToday = 0; b.unpaidToday = 0; b.tradeToday = 0;
      const name = CAT[b.type].name;
      if (b.unpaidDays === 2) {
        say(this.isPublic(b.type) ? `🏛️ The village fund is short: the ${name} staff weren't paid in full`
          : `💸 The ${name} can't pay its staff in full — trade is too thin`, b);
      }
      // a villager's own business that can't pay its people for a week closes its doors
      if (b.founderId && b.unpaidDays >= UNPAID_CLOSE && (b.funds || 0) <= this.reserve(b) + 1) {
        const owner = Sim.people.find((p: Person) => p.id === b.founderId);
        say(`🚪 ${owner ? `${Sim.fullName(owner)}'s ` : 'The '}${name} closed: it couldn't pay its staff`);
        if (owner) {
          owner.ownsBusiness = false;
          owner.mood = Math.max(5, (owner.mood ?? 60) - 18);
          Mind.remember(owner, 'loss', `had to close the ${name.toLowerCase()}`, -2);
        }
        World.removeBuilding(b);
        Sim.onBuildingRemoved(b);
        World.refreshConnections();
      }
    }
    this.budgets();
    // a villager's own business pays its owners what it can spare (it keeps two days' wages and its stock money)
    for (const b of World.buildings) {
      if (!b.founderId || !b.ownerId || !active(b)) continue;
      const home = byId(b.ownerId);
      if (!home || !home.residents?.length) continue;
      const spare = (b.funds || 0) - this.reserve(b) - this.payroll(b) * 2;
      if (spare > 5) { const draw = spare * 0.4; b.funds -= draw; home.funds += draw; }
    }
    // households pay off what they owe, keeping a little for the day
    for (const b of World.buildings) {
      if (!b.debts?.length) continue;
      if (!b.residents?.length) { b.debts = []; continue; } // (a family that left took its debts with it)
      for (const d of b.debts) {
        const pay = Math.max(0, Math.min(d.n, (b.funds || 0) - 15));
        if (pay <= 0) break;
        b.funds -= pay; d.n -= pay;
        this.credit(d.to ? byId(d.to) : null, pay);
      }
      b.debts = b.debts.filter((d: any) => d.n > 0.01);
    }
  },
};

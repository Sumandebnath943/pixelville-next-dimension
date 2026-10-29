/* ============================================================
   The Founder's wallet (design §4.2): a balance and a ledger of
   everything that went in or out. Money is never conjured or
   destroyed: what the Founder spends in a business is real income
   for it, and a household's thank-you comes out of its savings.
   ============================================================ */
import { Sim } from '../sim/agents';
import { Rep } from '../sim/reputation';
import { World } from '../sim/world';
import { Gov } from '../sim/gov';

export type EntryKind = 'reward' | 'win' | 'income' | 'purchase' | 'fine';
export interface Entry { day: number; time: string; amount: number; label: string; kind: EntryKind }
/** V2: a bill the wallet couldn't cover: owed to a building (its id), or to the village fund (0) */
export interface Bill { to: number; n: number; label: string }

export class Wallet {
  balance = 120;
  ledger: Entry[] = [];
  /** V2: what the Founder owes for services already had (a cab, the hospital), paid off as money comes in */
  bills: Bill[] = [];
  /** called after every change (the HUD flashes the amount) */
  onChange: ((e: Entry) => void) | null = null;

  /** V2: a service already had: paid as far as the wallet goes, the rest owed to `to` (nothing is let off). Returns
   *  what was paid now */
  charge(amount: number, label: string, to?: any): number {
    const a = Math.max(0, Math.round(amount));
    const now = Math.min(a, Math.max(0, Math.floor(this.balance)));
    if (now > 0) this.spend(now, label, 'purchase', to);
    if (a > now) {
      const id = to?.id ?? 0, b = this.bills.find((x) => x.to === id);
      if (b) b.n += a - now; else this.bills.push({ to: id, n: a - now, label });
    }
    return now;
  }
  /** V2: what's owed, all told */
  owing(): number {
    return this.bills.reduce((s, b) => s + b.n, 0);
  }
  /** V2: pay off what's owed from what's in the wallet; returns what was paid */
  settle(): number {
    let paid = 0;
    for (const b of this.bills) {
      const n = Math.min(b.n, Math.floor(this.balance));
      if (n <= 0) break;
      const to = b.to ? World.buildings.find((x: any) => x.id === b.to) : null;
      this.record(-n, `Paid off · ${b.label}`, 'purchase');
      if (to) to.funds = (to.funds || 0) + n;
      else Gov.treasury += n; // (the village fund, or a place that's gone: its debts went to the fund)
      b.n -= n; paid += n;
    }
    this.bills = this.bills.filter((b) => b.n > 0);
    return paid;
  }

  /** money in; `from` (a building) pays it out of its own funds, as far as they go */
  earn(amount: number, label: string, kind: EntryKind = 'reward', from?: any): number {
    let a = Math.max(0, Math.round(amount));
    if (from) {
      a = Math.min(a, Math.max(0, Math.floor(from.funds)));
      from.funds -= a;
    }
    if (a > 0) this.record(a, label, kind);
    return a;
  }

  /** money out, if there is enough; `to` (a building) takes it as income */
  spend(amount: number, label: string, kind: EntryKind = 'purchase', to?: any): boolean {
    const a = Math.round(amount);
    if (a > this.balance) return false;
    if (to) {
      to.funds = (to.funds || 0) + a;
      to.visitors = (to.visitors || 0) + 1;
      if (kind === 'purchase') Rep.patron(to, a); // a good customer is remembered
    }
    this.record(-a, label, kind);
    return true;
  }

  private record(amount: number, label: string, kind: EntryKind): void {
    this.balance += amount;
    const e: Entry = { day: Sim.day, time: Sim.timeStr(), amount, label, kind };
    this.ledger.push(e);
    if (this.ledger.length > 80) this.ledger.shift();
    this.onChange?.(e);
  }

  /** totals for one day, in and out */
  day(d = Sim.day): { in: number; out: number } {
    let i = 0, o = 0;
    for (const e of this.ledger) if (e.day === d) { if (e.amount > 0) i += e.amount; else o -= e.amount; }
    return { in: i, out: o };
  }

  restore(balance: number | undefined, ledger: Entry[] | undefined, bills?: Bill[]): void {
    this.balance = balance ?? 120;
    this.ledger = Array.isArray(ledger) ? ledger.slice(-80) : [];
    this.bills = Array.isArray(bills) ? bills.filter((b) => b && b.n > 0).map((b) => ({ ...b })) : [];
  }
}

/* ============================================================
   The Founder's wallet (design §4.2): a balance and a ledger of
   everything that went in or out. Money is never conjured or
   destroyed: what the Founder spends in a business is real income
   for it, and a household's thank-you comes out of its savings.
   ============================================================ */
import { Sim } from '../sim/agents';
import { Rep } from '../sim/reputation';

export type EntryKind = 'reward' | 'win' | 'income' | 'purchase' | 'fine';
export interface Entry { day: number; time: string; amount: number; label: string; kind: EntryKind }

export class Wallet {
  balance = 120;
  ledger: Entry[] = [];
  /** called after every change (the HUD flashes the amount) */
  onChange: ((e: Entry) => void) | null = null;

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

  restore(balance: number | undefined, ledger: Entry[] | undefined): void {
    this.balance = balance ?? 120;
    this.ledger = Array.isArray(ledger) ? ledger.slice(-80) : [];
  }
}

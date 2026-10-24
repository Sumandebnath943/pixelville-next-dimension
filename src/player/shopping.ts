/* ============================================================
   Buying things over a counter (design §8): the price is the
   business's own, less any discount the staff give a Founder
   they like; it's paid into the business's till; the one who
   served remembers it; and what was bought goes into the
   Founder's bag (eaten later, or kept: a ticket for the
   journey). Free things (a library book) cost nothing.
   ============================================================ */
import { Sim } from '../sim/agents';
import { CAT } from '../sim/catalog';
import { Mind } from '../sim/mind';
import { Rep } from '../sim/reputation';
import type { Ware } from '../interiors/plan';
import type { Wallet } from './wallet';

export interface BagItem { name: string; from: string; day: number; food?: boolean; ticket?: boolean }
/** the bag holds this many things; the oldest goes when it's full */
export const BAG_SIZE = 16;

export function buy(purse: Wallet, bag: BagItem[], b: any, w: Ware, server: any | null, ticket = false): { ok: boolean; msg: string } {
  const place = CAT[b.type]?.name || 'shop';
  const p = Rep.price(b, w.price);
  if (p.refused) return { ok: false, msg: `🙅 ${server ? server.name : 'The staff'} won't serve you` };
  if (p.cost > 0 && w.price > 0 && !purse.spend(p.cost, `${w.name} · ${place}`, 'purchase', b)) {
    return { ok: false, msg: `👛 The ${w.name.toLowerCase()} is $${p.cost} — you have $${Math.floor(purse.balance)}` };
  }
  bag.push({ name: w.name, from: place, day: Sim.day, food: w.food, ticket });
  while (bag.length > BAG_SIZE) bag.shift();
  if (server) Mind.remember(server, 'founder', `served the Founder: ${w.name.toLowerCase()}`, 1);
  const cost = w.price === 0 ? 'free' : `$${p.cost}${p.cost < w.price ? ` (${p.note.split(':')[0]})` : ''}`;
  const who = server ? `${server.name} hands you ${a(w.name)}` : `You get ${a(w.name)}`;
  return { ok: true, msg: `${w.food ? '🍽️' : ticket ? '🎫' : '🛍️'} ${who} — ${cost}` };
}
/** "a croissant", "an apple turnover", "the tokens" */
export function a(name: string): string {
  const n = name.toLowerCase();
  if (/s$/.test(n) && !/ss$/.test(n)) return n;
  return (/^[aeiou]/.test(n) ? 'an ' : 'a ') + n;
}

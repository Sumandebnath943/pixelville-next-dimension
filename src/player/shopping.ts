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
import { Supply } from '../sim/supply';
import type { Ware } from '../interiors/plan';
import type { Wallet } from './wallet';

export interface BagItem { name: string; from: string; day: number; food?: boolean; ticket?: boolean; gift?: number }
/** the bag holds this many things; the oldest goes when it's full */
export const BAG_SIZE = 16;

/**
 * V2: what a purchase does for the Founder. Food and drink are had there and then and pick you up (health back);
 * remedies and treatments mend more; clothes change what the Founder wears; a cut or a shave makes a good first
 * impression for the rest of the day; flowers, toys, jewellery and the like are kept as gifts to give to a villager
 * in conversation; the garage's services see to the car; tickets and days out are a little time well spent.
 */
export interface WareUse { heal?: number; wear?: { part: 'top' | 'coat' | 'legs' | 'shoes' | 'scarf'; colour: string }; groom?: boolean; gift?: number; car?: number; outing?: string }
const WEAR: [RegExp, 'top' | 'coat' | 'legs' | 'shoes' | 'scarf', string[]][] = [
  [/jacket|coat/i, 'coat', ['#2a2a2e', '#4a3a2a', '#2a3a5a', '#5a2a2a']],
  [/shirt|hoodie|jumper|tie/i, 'top', ['#e8e4dc', '#3a5a8a', '#6a2a3a', '#2a4a3a']],
  [/trainers|shoes|boots/i, 'shoes', ['#e8e8e8', '#1a1a1a', '#6a4a2a']],
  [/trousers|jeans/i, 'legs', ['#2a2a3a', '#3a4a6a', '#5a4a3a']],
  [/scarf/i, 'scarf', ['#b8902e', '#2a5aa0', '#a8324a', '#3a6a3a']],
];
const GIFT = /flower|tulip|rose|fern|bouquet|teddy|kite|board game|yo-yo|toy|chocolate|perfume|ring|earring|watch|frame|cushion|vase|teapot|honey|novel|cookbook|candle|gift|bauble|glasses|model car|souvenir|scarf|mug|blanket/i;
const MEDIC: Record<string, number> = { Plasters: 10, 'Cough syrup': 12, Vitamins: 8, 'Check-up': 100, 'Flu jab': 12, 'Spa day': 100, 'Room for the night': 100 };
const OUTING = /ticket|admission|tour|day pass|swim|wristband|observation|evening class|day membership|gallery|visitor centre|audience/i;

export function useOf(w: Ware, type: string): WareUse {
  const n = w.name;
  if (MEDIC[n]) return { heal: MEDIC[n] };
  if (w.food) return { heal: Math.min(25, 3 + Math.round(w.price * 1.2)) };
  if (type === 'barber') return { groom: true };
  if (type === 'autoshop' && /oil|wiper|wash/i.test(n)) return { car: /oil/i.test(n) ? 12 : 3 };
  for (const [re, part, cols] of WEAR) if (re.test(n) && !/lifejacket/i.test(n)) return { wear: { part, colour: cols[(n.length + w.price) % cols.length] } };
  if (OUTING.test(n)) return { outing: n };
  if (GIFT.test(n)) return { gift: Math.max(1, Math.round(Math.sqrt(w.price) * 1.2)) };
  return {};
}

/** V2 (Milestone 4): a ware's list price today — dearer when the shelves are thin */
export function listPrice(b: any, w: Ware, ticket = false): number {
  return w.price > 0 && !ticket ? Math.round(w.price * Supply.priceMult(b)) : w.price;
}

export function buy(purse: Wallet, bag: BagItem[], b: any, w: Ware, server: any | null, ticket = false): { ok: boolean; msg: string; use?: WareUse } {
  const place = CAT[b.type]?.name || 'shop';
  const shelf = ticket ? null : Supply.shelf(b);
  if (shelf?.empty && w.price > 0) return { ok: false, msg: `🫙 Sold out — ${server ? `${server.name} says the delivery hasn't come` : 'the shelves are bare'}` };
  const list = listPrice(b, w, ticket);
  const p = Rep.price(b, list);
  if (p.refused) return { ok: false, msg: `🙅 ${server ? server.name : 'The staff'} won't serve you` };
  if (p.cost > 0 && w.price > 0 && !purse.spend(p.cost, `${w.name} · ${place}`, 'purchase', b)) {
    return { ok: false, msg: `👛 The ${w.name.toLowerCase()} is $${p.cost} — you have $${Math.floor(purse.balance)}` };
  }
  if (shelf && w.price > 0) Supply.sale(b); // off the shelf
  // V2: what it's for. Food, drink, treatments, clothes and outings are had there and then; the rest goes in the bag
  const use = ticket ? {} : useOf(w, b.type);
  const now = use.heal || use.wear || use.groom || use.car || use.outing;
  if (!now || use.gift) {
    bag.push({ name: w.name, from: place, day: Sim.day, food: w.food, ticket, gift: use.gift });
    while (bag.length > BAG_SIZE) bag.shift();
  }
  if (server) Mind.remember(server, 'founder', `served the Founder: ${w.name.toLowerCase()}`, 1);
  const cost = w.price === 0 ? 'free' : `$${p.cost}${p.cost < list ? ` (${p.note.split(':')[0]})` : ''}`;
  const who = server ? `${server.name} hands you ${a(w.name)}` : `You get ${a(w.name)}`;
  const after = use.heal ? (use.heal >= 100 ? ' — you feel completely restored' : w.food ? ' — you feel better for it' : ' — that helps')
    : use.wear ? ' — you put it on' : use.groom ? ' — you look sharp: people will notice today' : use.car ? ' — your car is seen to'
      : use.outing ? ' — time well spent' : use.gift ? ' — a gift for someone (give it when you talk to them)' : '';
  return { ok: true, msg: `${w.food ? '🍽️' : ticket ? '🎫' : use.gift ? '🎁' : '🛍️'} ${who} — ${cost}${after}`, use };
}
/** "a croissant", "an apple turnover", "the tokens" */
export function a(name: string): string {
  const n = name.toLowerCase();
  if (/s$/.test(n) && !/ss$/.test(n)) return n;
  return (/^[aeiou]/.test(n) ? 'an ' : 'a ') + n;
}

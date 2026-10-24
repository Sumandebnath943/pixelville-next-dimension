/* ============================================================
   Tickets (Milestone 5): what the tickets bought at the
   terminals' machines (Milestone 3) are good for. A single is
   used up; a day return or a week rover rides the town's trains
   as often as you like while it lasts; a trip ticket takes you
   to its city and back.
   ============================================================ */
import { Sim } from '../sim/agents';
import type { Mode } from '../sim/gateways';
import type { BagItem } from './shopping';

export interface TicketUse { ride?: 'train' | 'ferry' | 'tour'; pass?: number; trip?: { city: string; mode: Mode } }
/** by the name printed on the ticket */
export const TICKET_USE: Record<string, TicketUse> = {
  'Single to the next town': { ride: 'train' },
  'Day return, anywhere on the line': { ride: 'train', pass: 1 },
  'Week rover': { ride: 'train', pass: 7 },
  'Ferry, foot passenger': { ride: 'ferry' },
  'Island day trip': { trip: { city: 'saltmarsh', mode: 'sea' } },
  'Economy to the capital': { trip: { city: 'avalon', mode: 'air' } },
  'Weekend in the sun': { trip: { city: 'solano', mode: 'air' } },
  'Sightseeing flight': { ride: 'tour' },
  'Air taxi to the city': { trip: { city: 'avalon', mode: 'heli' } },
};

/** a ticket in the bag that covers this ride (a pass that's still good, or a single); null if none */
export function ticketFor(bag: BagItem[], ride: 'train' | 'ferry' | 'tour'): { item: BagItem; pass: boolean } | null {
  let single: BagItem | null = null;
  for (const it of bag) {
    if (!it.ticket) continue;
    const u = TICKET_USE[it.name];
    if (!u || u.ride !== ride) continue;
    if (u.pass) { if (Sim.day - it.day < u.pass) return { item: it, pass: true }; continue; }
    single = single || it;
  }
  return single ? { item: single, pass: false } : null;
}
/** a trip ticket in the bag for this city by this mode */
export function tripTicket(bag: BagItem[], cityId: string, mode: Mode): BagItem | null {
  return bag.find((it) => it.ticket && TICKET_USE[it.name]?.trip?.city === cityId && TICKET_USE[it.name]?.trip?.mode === mode) || null;
}
/** use a ticket up (passes are kept until they run out) */
export function punch(bag: BagItem[], it: BagItem): void {
  if (TICKET_USE[it.name]?.pass) return;
  const i = bag.indexOf(it);
  if (i >= 0) bag.splice(i, 1);
}

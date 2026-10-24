/* ============================================================
   What a conversation may change (design §12.2), checked and
   clamped before it touches the sim: a nudge to the villager's
   view of the Founder, a nudge to their mood, a short memory of
   the moment, and a place they've now heard of. Anything else a
   model proposes is ignored, so chat can never break the village.
   ============================================================ */
import { World } from '../sim/world';
import { CAT } from '../sim/catalog';
import { Mind } from '../sim/mind';

export interface Effects { opinion: number; mood: number; memory: string | null; learn: string | null }
/** in one conversation the view of the Founder can move this far at most */
export const CONVO_RANGE = { down: -2, up: 1.5 };

const num = (v: unknown, lo: number, hi: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0);
const text = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\r\n\t<>{}[\]`*_#|\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  return s.length >= 3 ? s : null;
};

export function validate(raw: unknown): Effects {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return { opinion: num(r.opinion, -1, 1), mood: num(r.mood, -5, 5), memory: text(r.memory, 90), learn: text(r.learn, 40) };
}

/** apply to villager `p`; `soFar` is how far this conversation has already moved their view. Returns the new total */
export function apply(p: any, e: Effects, soFar: number): number {
  const m = Mind.ensure(p);
  const d = Math.max(CONVO_RANGE.down - soFar, Math.min(CONVO_RANGE.up - soFar, e.opinion));
  m.fo = Math.max(-10, Math.min(10, (m.fo || 0) + d));
  if (e.mood) p.mood = Math.max(5, Math.min(98, (p.mood ?? 60) + e.mood));
  if (e.learn) {
    const q = e.learn.toLowerCase();
    const b = World.buildings.find((x: any) => CAT[x.type] && !x.ruined && CAT[x.type].name.toLowerCase() === q.replace(/^the /, ''));
    if (b) Mind.learnPlace(p, b);
  }
  return soFar + d;
}

/* ============================================================
   What the village thinks of the Founder (V2, design §4.5).
   Every villager holds an opinion, from −10 (can't stand them)
   to +10 (would do anything for them), built from what they saw
   or suffered themselves and from what they hear: neighbours who
   stop to chat in the street pass the Founder's latest story on,
   and the listener's view moves toward the teller's (more so
   between friends). PVTV carries the big stories into every
   home. Opinions cool a little each night; the stories stay in
   memory as long as memories do.
   ============================================================ */
import { Mind } from './mind';
import { Sim } from './agents';
import { World } from './world';

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
/** a story is passed on at most this many times (the victim → a friend → a friend's friend) */
const HOPS = 3;

export interface Standing {
  /** the village's average opinion, −10…10 */
  score: number;
  /** the share of villagers who have any opinion of the Founder */
  known: number;
  label: string;
}

export const Rep = {
  /** what `p` thinks of the Founder */
  of(p: any): number {
    return Mind.ensure(p).fo || 0;
  },
  /** that opinion in words, from their side */
  label(v: number): string {
    return v >= 7 ? 'Adores you' : v >= 3.5 ? 'Likes you' : v >= 1 ? 'Warm to you' : v > -1 ? 'No strong view' : v > -3.5 ? 'Wary of you' : v > -7 ? 'Dislikes you' : "Can't stand you";
  },

  /** `p` saw (or suffered) something the Founder did. Their opinion moves by `delta`;
      the memory keeps `text`, and `gist` (read after "the Founder …") is what they pass on */
  feel(p: any, delta: number, text: string, gist?: string): void {
    const m = Mind.ensure(p);
    // the cautious take a bad turn harder
    const k = delta < 0 ? 0.8 + m.traits.caution * 0.4 : 1;
    m.fo = clamp((m.fo || 0) + delta * k, -10, 10);
    Mind.remember(p, 'founder', text, clamp(Math.round(delta / 2), -3, 2) || Math.sign(delta));
    if (gist) Object.assign(m.memories[m.memories.length - 1], { gist, sid: (Math.random() * 2 ** 31) | 0, hops: 0 });
  },

  /** two neighbours chat in the street: the teller's freshest story about the Founder travels */
  hearsay(from: any, to: any): boolean {
    const mf = Mind.ensure(from), mt = Mind.ensure(to);
    let story: any = null;
    for (let i = mf.memories.length - 1; i >= 0 && !story; i--) {
      const mm = mf.memories[i];
      if (mm.kind === 'founder' && mm.gist && Sim.day - mm.day <= 7 && (mm.hops || 0) < HOPS) story = mm;
    }
    if (!story || mt.memories.some((mm: any) => mm.sid === story.sid)) return false;
    // friends are believed; a passing acquaintance less so
    const trust = 0.35 + (mf.friends.get(to.id) || 0) * 0.65;
    const was = mt.fo || 0, sign = Math.sign(story.feel) || -1;
    let shift = ((mf.fo || 0) - was) * 0.3 * trust + story.feel * 0.25 * trust;
    // a bad story can only lower the listener's view, a good one only raise it
    if (Math.sign(shift) !== sign) shift = story.feel * 0.25 * trust;
    mt.fo = clamp(was + shift, -10, 10);
    Mind.remember(to, 'founder', `heard from ${from.name} that the Founder ${story.gist}`, sign);
    Object.assign(mt.memories[mt.memories.length - 1], { gist: story.gist, sid: story.sid, hops: (story.hops || 0) + 1 });
    return true;
  },

  /** a household at dinner: whatever one of them saw or heard about the Founder, the rest hear too */
  household(b: any): void {
    for (const a of b.residents) for (const q of b.residents) if (a !== q) Rep.hearsay(a, q);
  },

  /** PVTV puts it on the news: if the village has a station, every home hears */
  broadcast(delta: number): boolean {
    if (!World.buildings.some((b: any) => b.type === 'tvstation' && b.connected && !b.construction && !b.ruined)) return false;
    for (const p of Sim.people) {
      const m = Mind.ensure(p);
      m.fo = clamp((m.fo || 0) + delta * (0.6 + m.traits.curiosity * 0.6), -10, 10);
    }
    return true;
  },

  /** an opinion pieced together from the Founder stories someone remembers (a save from before opinions were kept) */
  fromMemories(memories: any[]): number {
    return clamp(memories.reduce((s, mm) => s + (mm.kind === 'founder' ? mm.feel * 1.5 : 0), 0), -10, 10);
  },

  /** overnight, a view cools a little toward indifference */
  cool(m: any): void {
    if (!m.fo) return;
    m.fo = Math.abs(m.fo) < 0.05 ? 0 : m.fo * 0.97;
  },

  /** what the village thinks, all told */
  town(): Standing {
    const n = Sim.people.length;
    if (!n) return { score: 0, known: 0, label: 'Nobody here yet' };
    let s = 0, k = 0;
    for (const p of Sim.people) {
      const v = p.mind?.fo || 0;
      s += v;
      if (Math.abs(v) >= 0.5) k++;
    }
    const score = s / n, known = k / n;
    const label = known < 0.12 && Math.abs(score) < 1 ? 'A newcomer'
      : score >= 3 ? 'Beloved' : score >= 1 ? 'Well liked' : score > -1 ? 'Mixed feelings' : score > -3 ? 'Disliked' : 'Notorious';
    return { score, known, label };
  },

  /** what the people who work at a business think of the Founder (the owner, if nobody does); null if nobody */
  staff(b: any): number | null {
    let ws: any[] = b.workers || [];
    if (!ws.length && b.founderId) ws = Sim.people.filter((q: any) => q.id === b.founderId);
    if (!ws.length) return null;
    return ws.reduce((s: number, q: any) => s + (q.mind?.fo || 0), 0) / ws.length;
  },

  /** what a business charges the Founder for something costing `base`: staff who like
      them knock a little off, staff who can't stand them won't serve them at all */
  price(b: any, base: number): { cost: number; rate: number; note: string; refused: boolean } {
    const s = Rep.staff(b);
    if (s !== null && s <= -6) return { cost: base, rate: 1, note: "the staff won't serve you", refused: true };
    const rate = s === null ? 1 : s >= 7 ? 0.8 : s >= 4 ? 0.9 : 1;
    const note = rate === 0.8 ? '20% off: the staff are fans' : rate === 0.9 ? '10% off: the staff like you' : '';
    // a discount is always rounded in the customer's favour
    return { cost: rate < 1 ? Math.max(1, Math.floor(base * rate)) : base, rate, note, refused: false };
  },

  /** the Founder spent money here: the people working warm to a good customer (up to a point) */
  patron(b: any, amount: number): void {
    for (const q of b.workers || []) {
      const m = Mind.ensure(q);
      if ((m.fo || 0) < 4) m.fo = Math.min(4, (m.fo || 0) + Math.min(0.4, amount / 150));
    }
  },
};

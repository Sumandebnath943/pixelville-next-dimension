/* ============================================================
   A conversation, remembered (design §12.2): one memory per
   chat, not per line, so saves stay small; a record of meeting
   the Founder (first and last day, how often, what about) that
   greetings and the phone's Contacts read; and a slightly warmer
   view after a friendly chat, once a day.
   ============================================================ */
import { Sim } from '../sim/agents';
import { Mind } from '../sim/mind';
import { Rep } from '../sim/reputation';
import type { Met } from './context';

/** "my work", from "their work": what they'd call it, for greeting you next time */
export function firstPerson(s: string): string {
  return s.replace(/\btheir\b/g, 'my').replace(/\bthem\b/g, 'me').replace(/\bthey\b/g, 'I');
}
/** "the fire at the house and their work" */
export function joinAbout(abouts: string[]): string {
  const xs = [...new Set(abouts.filter((a) => a && a !== 'how they are' && a !== 'this and that'))].slice(0, 2);
  return xs.length === 2 ? `${xs[0]} and ${xs[1]}` : xs[0] || '';
}

export function rememberChat(p: any, abouts: string[], memory: string | null, phone: boolean): void {
  const m = Mind.ensure(p);
  const about = joinAbout(abouts);
  const prev = m.flags.met as Met | undefined;
  m.flags.met = { f: prev?.f ?? Sim.day, l: Sim.day, n: (prev?.n || 0) + 1, s: about ? firstPerson(about) : prev?.s || '' } as Met;
  const how = phone ? 'talked with the Founder on the phone' : 'talked with the Founder';
  Mind.remember(p, 'chat', memory ? memory : about ? `${how} about ${about}` : how, 1);
  // a friendly chat warms them a little (once a day; not those who can't stand the Founder)
  if ((!prev || prev.l < Sim.day) && Rep.of(p) > -3) m.fo = Math.min(10, (m.fo || 0) + 0.4);
}

/** everyone the Founder has talked to, most recent first (for Contacts) */
export function contacts(people: any[]): any[] {
  return people.filter((p) => p.mind?.flags?.met).sort((a, b) => (b.mind.flags.met as Met).l - (a.mind.flags.met as Met).l);
}

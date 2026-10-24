/* ============================================================
   What a villager knows, for a conversation (design §12.2): who
   they are, their family and work, their temper and mood, what
   they remember (of their own life and of the Founder), what's
   been happening in the village, and where and when you're
   talking. The template dialogue reads it directly; the AI chat
   sends it (compactly) to the proxy, so the two always agree.
   ============================================================ */
import { Sim, AGE_RETIRE } from '../sim/agents';
import { World } from '../sim/world';
import { CAT } from '../sim/catalog';
import { Mind } from '../sim/mind';
import { Rep } from '../sim/reputation';
import { Tasks } from '../sim/tasks';
import { Weather } from '../sim/weather';
import { Gov } from '../sim/gov';
import { jobName } from '../player/indoors';

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface Met { f: number; l: number; n: number; s: string }
export interface NewsItem { ago: number; day: number; text: string; topic: string | null; where: string | null }
export interface ChatContext {
  id: number;
  name: string;
  surname: string;
  age: number;
  kind: string;
  job: string;
  workplace: string | null;
  atWork: boolean;
  home: string;
  partner: string | null;
  children: string[];
  traits: string[];
  mood: number;
  moodWord: string;
  memories: { ago: number; text: string; feel: number; kind: string }[];
  founder: { opinion: number; label: string; memories: { ago: number; text: string }[]; met: Met | null };
  friends: string[];
  favourite: string | null;
  news: NewsItem[];
  village: string;
  mayor: string | null;
  weather: string;
  time: string;
  dayPart: string;
  weekday: string;
  /** today's day number */
  day: number;
  where: string;
  phone: boolean;
}

/** what a news line is about, for "ask about the fire" (and where it happened, if it says) */
export function newsTopic(text: string): { topic: string | null; where: string | null } {
  const t = text.toLowerCase();
  const at = /(?:the|at the) ([a-z][a-z' -]+?)(?:!| put out| —| -|,|\.|$)/i.exec(text);
  const where = at ? at[1].trim() : null;
  // a real fire, not a raise at the Fire Station
  if (/\bfire at\b|on fire|caught fire|catch fire|flames|blaze|burn(ed|ing|t)\b|bucket brigade/.test(t)) return { topic: 'fire', where };
  if (/burglar|robbed|robbery|loot/.test(t)) return { topic: 'burglary', where };
  if (/crash|collision|knocked down/.test(t)) return { topic: 'crash', where };
  if (/flood/.test(t)) return { topic: 'flood', where };
  if (/tornado|storm|quake|earthquake|lightning/.test(t)) return { topic: 'storm', where };
  if (/married|wedding/.test(t)) return { topic: 'wedding', where };
  if (/elected|election|mayor/.test(t)) return { topic: 'election', where };
  if (/completed|opened|opening/.test(t)) return { topic: 'opening', where };
  if (/festival|christmas|diwali|easter|fireworks/.test(t)) return { topic: 'festival', where };
  if (/arrest|police/.test(t)) return { topic: 'police', where };
  return { topic: null, where };
}
/** a news line without its emoji */
export function plain(text: string): string {
  return text.replace(/^[^\p{L}\p{N}"'(]+/u, '').trim();
}

export function moodWord(m: number): string {
  return m >= 80 ? 'delighted' : m >= 62 ? 'cheerful' : m >= 48 ? 'all right' : m >= 34 ? 'low' : 'miserable';
}

/** everything a conversation with `p` can draw on */
export function buildContext(p: any, where: { building?: any; phone?: boolean } = {}): ChatContext {
  const m = Mind.ensure(p);
  const t = m.traits;
  const traits = ([['sociable', t.social], ['cautious', t.caution], ['ambitious', t.ambition], ['frugal', t.thrift], ['curious', t.curiosity]] as [string, number][])
    .sort((a, b) => b[1] - a[1]).slice(0, 2).map((x) => x[0]);
  const partner = p.partnerId ? Sim.people.find((q: any) => q.id === p.partnerId) : null;
  const children = Sim.people.filter((q: any) => q.kind === 'kid' && q.home === p.home && q !== p && q.surname === p.surname).map((q: any) => q.name);
  const friends = Mind.friendsOf(p).slice(0, 3).map((q: any) => `${q.name} ${q.surname}`);
  let favB: any = null, favV = 0;
  for (const [bid, v] of m.favorites) if (v > favV) { favV = v; favB = World.buildings.find((q: any) => q.id === bid); }
  // the last nine days' news: the real events first (a fire, a wedding), then a little of the rest
  const events: NewsItem[] = [], rest: NewsItem[] = [];
  for (const n of [...(Tasks.news || [])].reverse()) {
    const ago = Sim.day - n.day;
    if (ago > 9) break;
    const { topic, where: at } = newsTopic(n.text);
    const item = { ago, day: n.day, text: plain(n.text), topic, where: at };
    if (topic && topic !== 'opening') { if (events.length < 6 && !events.some((e) => e.topic === topic && e.where === at)) events.push(item); }
    else if (rest.length < 4 && !/earned a raise|promotion|regular at/.test(n.text)) rest.push(item);
  }
  const news = [...events, ...rest].sort((a, b) => a.ago - b.ago);
  const mem = m.memories.filter((mm: any) => mm.kind !== 'founder' && mm.kind !== 'chat').slice(-6).reverse()
    .map((mm: any) => ({ ago: Sim.day - mm.day, text: mm.text, feel: mm.feel, kind: mm.kind }));
  const fmem = m.memories.filter((mm: any) => mm.kind === 'founder' || mm.kind === 'chat').slice(-6).reverse()
    .map((mm: any) => ({ ago: Sim.day - mm.day, text: mm.text }));
  const op = Rep.of(p);
  const c = Sim.clock;
  const b = where.building;
  const mayor = Gov.leader ? Gov.leader.name : null;
  return {
    id: p.id,
    name: p.name,
    surname: p.surname,
    age: p.age ?? 30,
    kind: p.kind,
    job: p.work ? jobName(p) : p.kind === 'kid' ? 'pupil' : (p.age ?? 30) >= AGE_RETIRE ? 'retired' : 'between jobs',
    workplace: p.work ? CAT[p.work.type].name : null,
    atWork: !!b && p.work === b,
    home: p.home ? `the ${p.surname} ${CAT[p.home.type]?.name.toLowerCase() || 'home'}` : 'nowhere fixed',
    partner: partner ? partner.name : null,
    children,
    traits,
    mood: Math.round(p.mood ?? 60),
    moodWord: moodWord(p.mood ?? 60),
    memories: mem,
    founder: { opinion: Math.round(op * 10) / 10, label: Rep.label(op), memories: fmem, met: (m.flags.met as Met) || null },
    friends,
    favourite: favB && favV >= 2 ? CAT[favB.type].name : null,
    news,
    village: World.name,
    mayor,
    weather: String(Weather.kind),
    time: Sim.timeStr(),
    dayPart: c < 300 ? 'night' : c < 720 ? 'morning' : c < 1080 ? 'afternoon' : c < 1320 ? 'evening' : 'night',
    weekday: WEEKDAYS[Sim.day % 7],
    day: Sim.day,
    where: where.phone ? 'on the phone' : b ? (b.type === 'lodge' ? "the Founder's Lodge" : `the ${CAT[b.type].name}`) : 'out in the street',
    phone: !!where.phone,
  };
}

/** "yesterday", "on Tuesday", "last week" */
export function when(ago: number, day = Sim.day - ago): string {
  if (ago <= 0) return 'today';
  if (ago === 1) return 'yesterday';
  if (ago < 6) return `on ${WEEKDAYS[((day % 7) + 7) % 7]}`;
  if (ago < 13) return 'last week';
  return 'a while back';
}

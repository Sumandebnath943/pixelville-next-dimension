/* ============================================================
   The chat client (design §12.2): one request in flight, a
   per-session limit, a short history, and a quiet fallback.
   If the proxy says it's offline (no key), the village falls
   back to template dialogue for the rest of the session; if
   it's busy or slow, just this line does.
   ============================================================ */
import type { ChatContext } from './context';
import { validate, Effects } from './effects';

export interface Turn { role: 'user' | 'assistant'; content: string }
export type ChatOutcome = { ok: true; reply: string; effects: Effects } | { ok: false; why: 'offline' | 'busy' | 'limit' | 'error' };

const PER_MINUTE = 8, PER_SESSION = 150;

/** the context as sent: compact, and nothing the villager couldn't know */
export function compact(c: ChatContext): Record<string, unknown> {
  return {
    name: c.name, surname: c.surname, age: c.age, job: c.job, workplace: c.workplace, atWork: c.atWork, home: c.home,
    partner: c.partner, children: c.children, traits: c.traits, mood: c.moodWord,
    memories: c.memories.slice(0, 5).map((m) => `${m.text} (${m.ago}d ago)`),
    founder: { label: c.founder.label, memories: c.founder.memories.slice(0, 5).map((m) => `${m.text} (${m.ago}d ago)`), lastChat: c.founder.met ? { daysAgo: c.day - c.founder.met.l, about: c.founder.met.s, times: c.founder.met.n } : null },
    friends: c.friends, favourite: c.favourite,
    news: c.news.slice(0, 6).map((n) => `${n.text} (${n.ago}d ago)`),
    village: c.village, mayor: c.mayor, weather: c.weather, time: `${c.weekday} ${c.dayPart}, ${c.time}`, where: c.where,
  };
}

export class ChatClient {
  /** false once the proxy has said it has no key: templates from then on */
  available = true;
  busy = false;
  private sent: number[] = [];

  /** ask the proxy whether chat is switched on (no key, or no proxy at all: templates) */
  async probe(): Promise<void> {
    try {
      const r = await fetch('/api/chat', { signal: AbortSignal.timeout(5000) });
      const j = r.ok ? ((await r.json()) as { ready?: boolean }) : null;
      this.available = !!j?.ready;
    } catch {
      this.available = false;
    }
  }

  async say(c: ChatContext, history: Turn[], message: string): Promise<ChatOutcome> {
    if (!this.available) return { ok: false, why: 'offline' };
    if (this.busy) return { ok: false, why: 'busy' };
    const now = Date.now();
    if (this.sent.length >= PER_SESSION || this.sent.filter((t) => now - t < 60_000).length >= PER_MINUTE) return { ok: false, why: 'limit' };
    this.sent.push(now);
    this.busy = true;
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ context: compact(c), history: history.slice(-8), message: message.slice(0, 400) }),
        signal: AbortSignal.timeout(12_000),
      });
      if (res.status === 503 || res.status === 404) { this.available = false; return { ok: false, why: 'offline' }; }
      if (res.status === 429) return { ok: false, why: 'busy' };
      if (!res.ok) return { ok: false, why: 'error' };
      const j = (await res.json()) as { reply?: unknown; effects?: unknown };
      if (typeof j.reply !== 'string' || !j.reply.trim()) return { ok: false, why: 'error' };
      return { ok: true, reply: j.reply.trim().slice(0, 600), effects: validate(j.effects) };
    } catch {
      return { ok: false, why: 'error' };
    } finally {
      this.busy = false;
    }
  }
}

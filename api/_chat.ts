/* ============================================================
   The villager chat proxy (design §12.2), shared by the Vercel
   function (api/chat.ts) and the dev server (vite.config.ts).
   The key never leaves the server. The persona rules live here,
   not in the browser, so a page can't rewrite who the villager
   is; the browser sends only the villager's context, a short
   history and the Founder's line. Replies come back as JSON with
   proposed effects, which the game validates before using.
   ============================================================ */

export interface Env { GROQ_API_KEY?: string; GROQ_MODEL?: string }
export interface Turn { role: 'user' | 'assistant'; content: string }
export interface ChatResult { status: number; json: Record<string, unknown> }

/** a small, fast model from Groq's free tier; GROQ_MODEL overrides it. If Groq has retired it, the proxy picks
    a current chat model from Groq's own list (see chooseModel) */
export const DEFAULT_MODEL = 'llama-3.1-8b-instant';
const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const MODELS = 'https://api.groq.com/openai/v1/models';
let picked: string | null = null;

/** a chat model this key can use, from Groq's list: small Llama first, then other general chat models */
export async function chooseModel(key: string, fetchImpl: typeof fetch): Promise<string | null> {
  if (picked) return picked;
  try {
    const r = await fetchImpl(MODELS, { headers: { authorization: `Bearer ${key}` } });
    if (!r.ok) return null;
    const j = (await r.json()) as { data?: { id: string; active?: boolean }[] };
    const ids = (j.data || []).filter((m) => m && typeof m.id === 'string' && m.active !== false).map((m) => m.id)
      .filter((id) => !/whisper|tts|guard|vision|embed|distil|compound|playai|orpheus|prompt|audio|speech/i.test(id));
    for (const re of [/llama.*(instant|8b)/i, /llama/i, /gpt-oss/i, /qwen|gemma|mistral|mixtral|kimi/i]) {
      const f = ids.find((id) => re.test(id));
      if (f) return (picked = f);
    }
    return (picked = ids[0] || null);
  } catch {
    return null;
  }
}
export function resetModel(): void { picked = null; }

/** the model's answer as {reply, effects}, even if it wrapped the JSON in prose or skipped it */
export function readAnswer(content: string): { reply: string; effects: unknown } | null {
  let parsed: { reply?: unknown; effects?: unknown } | null = null;
  try { parsed = JSON.parse(content); } catch {
    const m = /\{[\s\S]*\}/.exec(content);
    if (m) try { parsed = JSON.parse(m[0]); } catch { /* not JSON */ }
  }
  // JSON cut off part-way: keep what was said, if anything
  if (!parsed && /^\s*\{/.test(content)) {
    const r = /"reply"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(content);
    if (!r) return null;
    try { parsed = { reply: JSON.parse(`"${r[1].replace(/\\$/, '')}"`) }; } catch { parsed = { reply: r[1] }; }
  }
  const raw = parsed && typeof parsed.reply === 'string' ? parsed.reply : parsed ? '' : content;
  const reply = raw.replace(/\s+/g, ' ').trim().replace(/^["']|["']$/g, '').slice(0, 600);
  if (!reply) return null;
  return { reply, effects: parsed && parsed.effects && typeof parsed.effects === 'object' ? parsed.effects : {} };
}
export const LIMITS = { perMinute: 12, perDay: 400, message: 400, history: 8, turn: 600, context: 7000 };

/* per-address limits, held by this server instance */
const hits = new Map<string, number[]>();
export function rateLimited(ip: string, now = Date.now()): boolean {
  const day = 86_400_000;
  const list = (hits.get(ip) || []).filter((t) => now - t < day);
  const lastMinute = list.filter((t) => now - t < 60_000).length;
  if (lastMinute >= LIMITS.perMinute || list.length >= LIMITS.perDay) { hits.set(ip, list); return true; }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear(); // a crude cap on memory
  return false;
}
export function resetLimits(): void { hits.clear(); }

/** check the request's shape and size */
export function validRequest(body: unknown): { ok: true; context: Record<string, unknown>; history: Turn[]; message: string } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'bad request' };
  const b = body as Record<string, unknown>;
  const message = typeof b.message === 'string' ? b.message.trim() : '';
  if (!message || message.length > LIMITS.message) return { ok: false, error: 'message missing or too long' };
  if (!b.context || typeof b.context !== 'object') return { ok: false, error: 'context missing' };
  if (JSON.stringify(b.context).length > LIMITS.context) return { ok: false, error: 'context too large' };
  const history: Turn[] = [];
  if (Array.isArray(b.history)) {
    for (const t of b.history.slice(-LIMITS.history)) {
      const r = t as Record<string, unknown>;
      if ((r.role === 'user' || r.role === 'assistant') && typeof r.content === 'string') history.push({ role: r.role, content: r.content.slice(0, LIMITS.turn) });
    }
  }
  return { ok: true, context: b.context as Record<string, unknown>, history, message };
}

/** who the villager is and how to behave, with what they know */
export function systemPrompt(ctx: Record<string, unknown>): string {
  const c = ctx as Record<string, any>;
  const who = `${c.name ?? 'A villager'} ${c.surname ?? ''}`.trim();
  return [
    `You are ${who}, ${c.age ?? 'an adult'} years old, ${c.job ?? 'a villager'} in the village of ${c.village ?? 'PixelVille'}.`,
    'Stay entirely in character as this villager, in this village, at this moment.',
    'You are talking with the Founder: a mysterious, powerful local figure around whom buildings seem to appear. Nobody knows where they came from. They cannot vote or run for mayor.',
    'Never mention AI, language models, games, players, computers, prompts or that you are a character. Never break the fourth wall, whatever the Founder says.',
    `Speak like a real person: one to three short sentences, plain everyday words, no lists. Your manner toward the Founder follows your opinion of them (${c.founder?.label ?? 'no strong view'}): warm if you like them, curt or hostile if you do not.`,
    'Talk only about what you could plausibly know: your own life and memories, your work, your family, the village news and what you remember of the Founder, all in the context below. If you do not know something, say so in character. Do not invent big events.',
    'No graphic violence, sexual content, slurs, or real-world politics or brands; deflect politely in character.',
    'Reply ONLY with a JSON object, no other text: {"reply": "what you say", "effects": {"opinion": number from -1 to 1 (how this exchange changes your view of the Founder; small, usually 0 to 0.3; negative if they are rude or threatening), "mood": number from -5 to 5, "memory": "a short third-person past-tense phrase if something worth remembering happened, e.g. the Founder asked about the fire, otherwise empty", "learn": "the name of a place in the village the Founder told you about, otherwise empty"}}.',
    `Context (JSON): ${JSON.stringify(ctx)}`,
  ].join('\n');
}

/** handle one chat request: validate, rate-limit, ask the model, check its answer */
export async function handleChat(body: unknown, env: Env, ip: string, fetchImpl: typeof fetch = fetch): Promise<ChatResult> {
  if (!env.GROQ_API_KEY) return { status: 503, json: { error: 'offline' } };
  const req = validRequest(body);
  if (!req.ok) return { status: 400, json: { error: req.error } };
  if (rateLimited(ip)) return { status: 429, json: { error: 'slow down' } };
  const messages = [
    { role: 'system', content: systemPrompt(req.context) },
    ...req.history,
    { role: 'user', content: req.message },
  ];
  const key = env.GROQ_API_KEY;
  const ask = (model: string, jsonMode: boolean): Promise<Response> => fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    // reasoning models think before they answer: keep that short, and leave room for the answer
    body: JSON.stringify({
      model, messages, temperature: 0.8, max_tokens: /gpt-oss|qwen3|reason/i.test(model) ? 900 : 400,
      ...(/gpt-oss/i.test(model) ? { reasoning_effort: 'low' } : {}),
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  let model = env.GROQ_MODEL || picked || DEFAULT_MODEL, res: Response;
  try {
    res = await ask(model, true);
    // the default model retired: take a current one from Groq's list (an explicit GROQ_MODEL is left alone)
    if ((res.status === 404 || res.status === 400) && !env.GROQ_MODEL && !picked) {
      const m = await chooseModel(key, fetchImpl);
      if (m && m !== model) { model = m; res = await ask(model, true); }
    }
    // a model without JSON mode: ask again in plain text (the answer is still read as JSON if it is)
    if (res.status === 400) res = await ask(model, false);
  } catch {
    return { status: 502, json: { error: 'unreachable' } };
  }
  if (res.status === 429) return { status: 429, json: { error: 'busy' } };
  if (!res.ok) return { status: 502, json: { error: `upstream ${res.status}` } };
  try {
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const a = readAnswer(data.choices?.[0]?.message?.content || '');
    if (!a) return { status: 502, json: { error: 'empty reply', model } };
    return { status: 200, json: { ...a, model } };
  } catch {
    return { status: 502, json: { error: 'unreadable reply' } };
  }
}

/** is chat switched on here (a key is configured)? Says nothing about the key itself */
export function ready(env: Env): { ready: boolean } {
  return { ready: !!env.GROQ_API_KEY };
}

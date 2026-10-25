/* The Vercel function for villager chat: POST /api/chat. The key comes from
   the project's environment variables (GROQ_API_KEY, GROQ_MODEL); see
   api/_chat.ts for the rules and checks. */
import { handleChat, ready } from './_chat';

const env = (): Record<string, string | undefined> => (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/** is chat on? (only whether a key is configured) */
export function GET(): Response {
  return json(ready({ GROQ_API_KEY: env().GROQ_API_KEY }));
}

export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null);
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'anon';
  const e = env();
  const r = await handleChat(body, { GROQ_API_KEY: e.GROQ_API_KEY, GROQ_MODEL: e.GROQ_MODEL, CHAT_ORIGINS: e.CHAT_ORIGINS, CHAT_DAILY_CAP: e.CHAT_DAILY_CAP }, ip, fetch,
    { origin: request.headers.get('origin'), host: request.headers.get('x-forwarded-host') || request.headers.get('host') });
  return json(r.json, r.status);
}

/* ============================================================
   Talking to a villager (design §12.1): face to face, or on the
   phone. Topic buttons answer at once from the villager's own
   mind (template dialogue); a typed line goes to the AI chat when
   it's on, and otherwise to the nearest topic. Whatever the AI
   proposes is validated before it changes anything. Saying
   goodbye leaves one memory of the chat, which they'll bring up
   next time.
   ============================================================ */
import { Sim } from '../sim/agents';
import { Rep } from '../sim/reputation';
import { buildContext, ChatContext } from '../ai/context';
import { aboutOf, greeting, reply, shrug, topics, understand } from '../ai/templates';
import { ChatClient, Turn } from '../ai/client';
import { apply } from '../ai/effects';
import { rememberChat } from '../ai/memory';
import { jobName } from '../player/indoors';

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface DialogueApi {
  client: ChatClient;
  showPerson(p: any): void;
  /** the cursor is needed for the panel */
  release(): void;
  onStart?(p: any, phone: boolean): void;
  onEnd?(p: any): void;
  /** V2: gifts the Founder is carrying (bought in the village's shops), and handing one over: their answer */
  gifts?(): { name: string }[];
  give?(p: any, i: number): string;
}

export class Dialogue {
  open = false;
  p: any = null;
  private ctx: ChatContext | null = null;
  private where: { building?: any; phone?: boolean } = {};
  private history: Turn[] = [];
  private abouts: string[] = [];
  private memory: string | null = null;
  private moved = 0;
  private seed = 0;

  constructor(private api: DialogueApi) {
    $('tk-close').addEventListener('click', () => this.close());
    $('tk-about').addEventListener('click', () => { if (this.p) this.api.showPerson(this.p); });
    $('tk-topics').addEventListener('click', (e) => {
      const g = (e.target as HTMLElement).closest<HTMLElement>('[data-gift]');
      if (g) { this.give(+g.dataset.gift!); return; }
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-topic]');
      if (b) this.topic(b.dataset.topic!);
    });
    $('tk-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const el = $('tk-input') as HTMLInputElement;
      const t = el.value.trim();
      el.value = '';
      if (t) void this.send(t);
    });
  }

  start(p: any, where: { building?: any; phone?: boolean } = {}): void {
    if (this.open) this.close();
    this.p = p;
    this.where = where;
    this.history = [];
    this.abouts = [];
    this.memory = null;
    this.moved = 0;
    this.seed = Math.floor(Math.random() * 1000);
    this.ctx = buildContext(p, where);
    this.open = true;
    this.api.release();
    this.api.onStart?.(p, !!where.phone);
    $('tk-log').innerHTML = '';
    $('talk').classList.add('on');
    this.header();
    this.say(greeting(this.ctx, this.seed));
    this.renderTopics();
    $('tk-mode').textContent = this.api.client.available
      ? 'Ask anything, or pick a topic.'
      : 'Pick a topic, or say something: they answer from what they know.';
    // let a typed E or F in the box stay in the box
    setTimeout(() => ($('tk-input') as HTMLInputElement).focus(), 50);
  }

  close(): void {
    if (!this.open) return;
    const p = this.p;
    this.open = false;
    $('talk').classList.remove('on');
    ($('tk-input') as HTMLInputElement).blur();
    if (p && Sim.people.includes(p)) rememberChat(p, this.abouts, this.memory, !!this.where.phone);
    this.api.onEnd?.(p);
    this.p = null;
  }

  private header(): void {
    const p = this.p, op = Rep.of(p);
    $('tk-name').textContent = `${p.name} ${p.surname}`;
    $('tk-sub').textContent = `${this.where.phone ? '📞 On the phone · ' : ''}${jobName(p)}, ${p.age ?? ''}`;
    const pill = $('tk-pill');
    pill.textContent = Rep.label(op);
    pill.className = `pill ${op >= 1 ? 'ok' : op <= -1 ? 'bad' : ''}`;
  }
  private renderTopics(): void {
    // (V2: face to face, the gifts in the bag can be given)
    const gifts = this.where.phone ? [] : (this.api.gifts?.() ?? []).slice(0, 2);
    $('tk-topics').innerHTML = topics(this.ctx!).map((t) => `<button data-topic="${esc(t.id)}">${esc(t.label)}</button>`).join('')
      + gifts.map((g, i) => `<button data-gift="${i}" class="gift">🎁 Give the ${esc(g.name.toLowerCase())}</button>`).join('')
      + '<button data-topic="bye" class="bye">Goodbye</button>';
  }
  /** V2: hand over a gift from the bag */
  give(i: number): void {
    const g = (this.api.gifts?.() ?? [])[i];
    if (!g || !this.api.give) return;
    this.line('me', `I brought you something: the ${g.name.toLowerCase()}.`);
    this.history.push({ role: 'user', content: `(The Founder gives you a gift: ${g.name}.)` });
    this.say(this.api.give(this.p, i));
    this.header();
    this.renderTopics();
  }
  private line(who: 'them' | 'me', text: string): void {
    const log = $('tk-log');
    log.insertAdjacentHTML('beforeend', `<p class="${who}">${who === 'them' ? `<b>${esc(this.p.name)}</b>` : '<b>You</b>'}${esc(text)}</p>`);
    while (log.children.length > 14) log.firstElementChild!.remove();
    log.scrollTop = log.scrollHeight;
  }
  private say(text: string): void {
    this.line('them', text);
    this.history.push({ role: 'assistant', content: text });
  }

  topic(id: string): void {
    if (id === 'bye') {
      this.line('me', 'Goodbye!');
      setTimeout(() => this.close(), 450);
      return;
    }
    const t = topics(this.ctx!).find((q) => q.id === id);
    if (!t) return;
    this.line('me', t.label);
    this.history.push({ role: 'user', content: t.label });
    const r = reply(this.ctx!, id, this.seed++);
    this.abouts.push(r.about);
    this.say(r.text);
  }

  async send(text: string): Promise<void> {
    this.line('me', text);
    const ctx = this.ctx!;
    const guess = understand(ctx, text);
    if (guess) this.abouts.push(aboutOf(ctx, guess));
    if (this.api.client.available) {
      const log = $('tk-log');
      log.insertAdjacentHTML('beforeend', '<p class="them typing"><b>…</b></p>');
      log.scrollTop = log.scrollHeight;
      const r = await this.api.client.say(ctx, this.history, text);
      log.querySelector('.typing')?.remove();
      this.history.push({ role: 'user', content: text });
      if (!this.open) return;
      if (r.ok) {
        this.moved = apply(this.p, r.effects, this.moved);
        if (r.effects.memory && !this.memory) this.memory = r.effects.memory;
        this.say(r.reply);
        this.header();
        return;
      }
      if (r.why === 'offline') $('tk-mode').textContent = 'Pick a topic, or say something: they answer from what they know.';
    } else this.history.push({ role: 'user', content: text });
    // without the AI: the nearest topic, or a polite shrug
    this.say(guess ? reply(ctx, guess, this.seed++).text : shrug(ctx, this.seed++));
  }
}

/* ============================================================
   Template dialogue (design §12.2): what a villager says without
   the AI, from the same context, in their own voice: warmer or
   colder by what they think of the Founder, brighter or flatter
   by their mood, about their own life, their work, their family,
   what's happened in the village and what they remember of you.
   They remember the last chat and bring it up next time.
   ============================================================ */
import type { ChatContext, NewsItem } from './context';
import { when } from './context';

export interface Topic { id: string; label: string; about: string }

const pick = <T,>(seed: number, xs: T[]): T => xs[Math.abs(Math.floor(seed)) % xs.length];
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** what they say when the Founder comes up to them */
export function greeting(c: ChatContext, seed = 0): string {
  const op = c.founder.opinion, met = c.founder.met;
  const hi = c.dayPart === 'morning' ? 'Morning' : c.dayPart === 'evening' ? 'Evening' : 'Hello';
  // what you talked about last time, if it was lately
  const ago = met ? Math.max(0, c.day - met.l) : 99;
  const recall = met && met.s && ago > 0 && ago <= 9 ? pick(seed, [`We were talking about ${met.s} ${when(ago)}`, `You were asking me about ${met.s} ${when(ago)}`]) : '';
  if (c.phone) {
    if (op <= -6) return `…What do you want, Founder?`;
    if (recall) return `Hello? Oh — Founder! ${recall} — I've been thinking about it since.`;
    return pick(seed, [`Hello? Oh — Founder! What can I do for you?`, `${c.name} speaking. Oh, it's you, Founder!`]);
  }
  if (op <= -6) return pick(seed, [`Oh. It's you.`, `What do *you* want?`, `I've got nothing to say to you, Founder.`]);
  if (op <= -2.5) return pick(seed, [`Founder.`, `Can I help you?`, `Hm. What is it?`]);
  // they remember the last time you talked
  if (met) {
    if (ago === 0) return pick(seed, [`Back already? What else?`, `Oh, hello again!`]);
    if (recall) return `${hi}, Founder! ${recall} — I've been thinking about it since.`;
    if (op >= 3.5) return pick(seed, [`Founder! Good to see you.`, `${hi}, Founder! Always a pleasure.`]);
    return `${hi} again, Founder.`;
  }
  if (c.atWork) return pick(seed, [`${hi}! Welcome to ${c.where}. What can I get you?`, `${hi} — you're the Founder, aren't you? Welcome to ${c.where}.`]);
  if (op >= 3.5) return pick(seed, [`Oh! The Founder! People speak very well of you, you know.`, `${hi}, Founder! I've heard good things.`]);
  return pick(seed, [`${hi}. You're… the Founder, aren't you? People talk about you.`, `${hi}! You must be the Founder — buildings go up wherever you walk, they say.`]);
}
/** the topics this villager can talk about right now */
export function topics(c: ChatContext): Topic[] {
  const out: Topic[] = [{ id: 'how', label: 'How are you?', about: 'how they are' }];
  if (c.workplace) out.push({ id: 'work', label: c.atWork ? 'How is work today?' : 'What do you do?', about: 'their work' });
  if (c.partner || c.children.length) out.push({ id: 'family', label: 'How is the family?', about: 'their family' });
  out.push({ id: 'news', label: "What's new in town?", about: 'the village news' });
  // the big things in the news, and in their own life, to ask about
  const seen = new Set<string>();
  for (const n of c.news) {
    if (!n.topic || seen.has(n.topic) || n.topic === 'opening') continue;
    seen.add(n.topic);
    out.push({ id: `event:${n.day}:${n.topic}`, label: `Ask about the ${eventName(n)}`, about: `the ${eventName(n)}` });
    if (seen.size >= 3) break;
  }
  const big = c.memories.find((m) => Math.abs(m.feel) >= 2 && m.ago <= 7);
  if (big) out.push({ id: 'life', label: big.feel > 0 ? 'Congratulate them' : 'Ask what happened', about: big.feel > 0 ? 'their good news' : 'their troubles' });
  out.push({ id: 'me', label: 'What do people say about me?', about: 'what people say about the Founder' });
  if (c.favourite) out.push({ id: 'tip', label: 'Anywhere good to go?', about: 'places to go' });
  return out;
}
function eventName(n: NewsItem): string {
  const at = n.where && n.where.length < 24 ? ` at the ${n.where.toLowerCase().replace(/^the /, '')}` : '';
  return ({ fire: 'fire', burglary: 'burglary', crash: 'crash', flood: 'flood', storm: 'storm', wedding: 'wedding', election: 'election', festival: 'festival', police: 'police business', opening: 'new building', blackout: 'power cut', shortage: 'shortage', flu: 'flu going round' } as Record<string, string>)[n.topic!] + (n.topic === 'fire' || n.topic === 'burglary' ? at : '');
}

/** their answer, and what it was about (for their memory of the conversation) */
export function reply(c: ChatContext, topicId: string, seed = 0): { text: string; about: string } {
  const op = c.founder.opinion, cold = op <= -2.5;
  const about = aboutOf(c, topicId) || 'this and that';
  if (op <= -6 && topicId !== 'me') return { text: pick(seed, [`I don't want to talk to you.`, `Leave me alone, Founder.`, `Ask someone who cares.`]), about };
  switch (topicId.split(':')[0]) {
    case 'how': {
      // V2: the body first: on the ward, hurt, or laid up
      if (c.unwell === 'ward') return { text: pick(seed, ['They\'re looking after me well in here. A few more days, the doctors say.', 'Better than I was. The nurses are angels.']), about };
      if (c.unwell === 'hurt') return { text: `${pick(seed, ['Still sore, to be honest.', 'On the mend, slowly.'])} ${/hurt (.+)\)$/.test(c.health) ? `I was hurt ${/hurt (.+)\)$/.exec(c.health)![1]}.` : ''}`.trim(), about };
      if (c.unwell === 'ill') return { text: pick(seed, ['Laid up, I\'m afraid. Don\'t come too close!', 'Under the weather. Bed and soup for me.']), about };
      if (c.powerCut) return { text: pick(seed, ['We\'re sitting in the dark — the power\'s out on our street.', 'No power at home since the storm. Candles and cold tea.']), about };
      const worry = c.memories.find((m) => m.feel < 0 && m.ago <= 5);
      const joy = c.memories.find((m) => m.feel > 0 && m.ago <= 5);
      if (c.mood >= 62) return { text: `${pick(seed, ['Couldn\'t be better!', 'Really well, thanks.', 'Good, good.'])}${joy ? ` I ${joy.text} ${when(joy.ago)}, you know.` : ''}`, about };
      if (c.mood >= 48) return { text: `${pick(seed, ['Not bad. Keeping busy.', 'Getting by, thanks.', 'Same as ever.'])}${cold ? '' : ` ${c.weather === 'rain' || c.weather === 'heavy' ? 'This rain doesn\'t help.' : 'Can\'t complain.'}`}`, about };
      return { text: `${pick(seed, ['Honestly? Not great.', 'I\'ve had better weeks.', 'Bit of a rough patch.'])}${worry ? ` I ${worry.text} ${when(worry.ago)}.` : ''}`, about };
    }
    case 'work': {
      if (!c.workplace) return { text: c.job === 'retired' ? 'I\'m retired! Gardening, mostly.' : 'Between jobs at the moment. Something will turn up.', about };
      const lines: Record<string, string[]> = {
        baker: ['Up at five for the bread, every day. Wouldn\'t change it.', 'The croissants sell out by ten. Try one!'],
        barista: ['Coffee, coffee and more coffee. The regulars keep me going.'],
        teacher: ['The kids keep me on my toes. Marking tonight, as usual.'],
        nurse: ['Long shifts, but you\'re helping people. That\'s what matters.'],
        'police officer': ['Quiet, mostly. Mostly.'],
        firefighter: ['We drill every morning. When the bell goes, we\'re ready.'],
        librarian: ['Shh! Only joking. It\'s lovely here.'],
      };
      const base = lines[c.job] || [`I'm a ${c.job} at the ${c.workplace}. It pays the bills.`, `The ${c.workplace} keeps me busy — good people there.`];
      return { text: c.atWork ? `${pick(seed, ['Busy today!', 'Steady, today.', 'Not too bad.'])} ${pick(seed + 1, base)}` : pick(seed, base), about };
    }
    case 'family': {
      const bits: string[] = [];
      if (c.partner) bits.push(`${c.partner} is well`);
      if (c.children.length) bits.push(`${c.children.slice(0, 2).join(' and ')} ${c.children.length > 1 ? 'are' : 'is'} growing up fast`);
      return { text: `${cap(bits.join(', and '))}. ${pick(seed, ['Thanks for asking.', 'Can\'t ask for more.', 'They keep me young.'])}`, about };
    }
    case 'news': {
      const items = c.news.filter((n) => n.ago <= 4).slice(0, 2);
      if (!items.length) return { text: 'Quiet week, honestly. Nothing much has happened.', about };
      const first = items[0];
      return { text: `Did you hear? ${first.text.replace(/!$/, '')} — ${when(first.ago)}.${items[1] ? ` And ${lower(items[1].text)}` : ''}`, about };
    }
    case 'event': {
      const [, day, topic] = topicId.split(':');
      const n = c.news.find((q) => String(q.day) === day && q.topic === topic) || c.news.find((q) => q.topic === topic);
      if (!n) return { text: 'I don\'t know much about that, sorry.', about };
      const mine = c.memories.find((m) => m.kind === topic || (topic === 'fire' && m.kind === 'fire'));
      if (mine) return { text: `That was us. I ${mine.text} ${when(mine.ago)}. ${mine.feel < 0 ? 'We\'re still picking up the pieces.' : 'What a day.'}`, about };
      const lines: Record<string, string[]> = {
        fire: ['Awful. You could see the smoke from across town.', 'Terrible thing. The brigade got there in time, thank goodness.', 'I heard the bells and ran to help with the buckets.'],
        burglary: ['Makes you lock your door, doesn\'t it?', 'The police are on it, they say. I hope they catch them.'],
        crash: ['People drive too fast round here.', 'Nobody badly hurt, I heard. Lucky.'],
        flood: ['The water came right up the road.', 'We sandbagged the door all night.'],
        storm: ['I\'ve never seen weather like it.', 'Half the street lost their fences.'],
        wedding: ['Lovely day! Everyone was there.', 'Such a happy couple.'],
        election: ['We\'ll see if they keep their promises.', 'I voted. Did you? Oh — you can\'t, can you.'],
        festival: ['The whole village came out for it.', 'Best night of the year.'],
        police: ['The squad cars were out in force.', 'Never a dull moment.'],
        blackout: ['We sat by candlelight all evening.', 'The traffic lights went out — chaos at the junction.', 'The repair crew was up the pole half the night.'],
        shortage: ['The shelves were bare at the shop.', 'Prices went up overnight, I tell you.'],
        flu: ['Half my street is coughing.', 'Wrap up warm, Founder.'],
      };
      return { text: `The ${eventName(n)} ${when(n.ago)}? ${pick(seed, lines[topic] || ['I heard about that.'])}`, about };
    }
    case 'life': {
      const big = c.memories.find((m) => Math.abs(m.feel) >= 2 && m.ago <= 7);
      if (!big) return { text: 'Oh, nothing worth mentioning.', about };
      return { text: big.feel > 0 ? `Thank you! I ${big.text} ${when(big.ago)}. Still can't quite believe it.` : `I ${big.text} ${when(big.ago)}. It's been hard, to be honest. Thank you for asking.`, about };
    }
    case 'me': {
      const told = c.founder.memories.find((m) => /^heard from|^saw the Founder|the Founder brought|joined the bucket/.test(m.text));
      if (op >= 3.5) return { text: `Only good things! ${told ? `I ${told.text}.` : 'They say the village owes you a lot.'}`, about };
      if (op <= -2.5) return { text: `You really want to know? ${told ? `I ${told.text}.` : 'Nothing good.'} People talk, Founder.`, about };
      return { text: told ? `Well… I ${told.text}. People talk.` : 'You\'re a bit of a mystery, honestly. Nobody knows where you came from.', about };
    }
    case 'tip':
      return { text: c.favourite ? `You should try the ${c.favourite} — I'm a regular.` : 'I mostly stay home, to be honest.', about };
  }
  return { text: 'Hm.', about };
}
const lower = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

/** what a topic is about, in the villager's memory of the chat ("the fire at the bank", "their work") */
export function aboutOf(c: ChatContext, id: string): string {
  const t = topics(c).find((q) => q.id === id);
  if (t) return t.about;
  if (id.startsWith('event:')) {
    const [, day, topic] = id.split(':');
    const n = c.news.find((q) => String(q.day) === day && q.topic === topic);
    if (n) return `the ${eventName(n)}`;
  }
  return '';
}

/** words that point at the big events in the news */
const EVENT_WORDS: [RegExp, string][] = [
  [/\b(fire|burn|smoke|blaze|flames)/, 'fire'], [/\b(burglar|robb|thief|theft|stole)/, 'burglary'], [/\b(crash|accident|collision)/, 'crash'],
  [/\bflood/, 'flood'], [/\b(storm|tornado|quake|lightning)/, 'storm'], [/\b(wedding|married|bride|groom)/, 'wedding'],
  [/\b(election|mayor|vote|voting)/, 'election'], [/\b(festival|christmas|diwali|easter|fireworks)/, 'festival'],
  [/\b(power|blackout|lights out|electric)/, 'blackout'], [/\b(shortage|shelves|sold out|prices)/, 'shortage'], [/\b(flu|cough)/, 'flu'],
];

/** a free-text line, without the AI: the nearest topic by its words, or a polite shrug */
export function understand(c: ChatContext, text: string): string | null {
  const t = text.toLowerCase();
  const ts = topics(c);
  const has = (id: string): string | null => (ts.some((q) => q.id === id) ? id : null);
  // an event in the news, whether or not it has a button
  for (const [re, topic] of EVENT_WORDS) {
    if (!re.test(t)) continue;
    const n = c.news.find((q) => q.topic === topic);
    if (n) return `event:${n.day}:${topic}`;
  }
  if (/\b(how are|how's it|how do you do|you ok|you well)/.test(t)) return 'how';
  if (/\b(work|job|shift|boss|business)/.test(t)) return has('work');
  if (/\b(family|wife|husband|kids|children|son|daughter|partner)/.test(t)) return has('family');
  if (/\b(news|new|happen|going on|gossip)/.test(t)) return 'news';
  if (/\b(me|founder|people say|think of me|reputation)/.test(t)) return 'me';
  if (/\b(go|eat|drink|recommend|favourite|favorite)/.test(t)) return has('tip');
  return null;
}
export function shrug(c: ChatContext, seed = 0): string {
  if (c.founder.opinion <= -2.5) return pick(seed, ['Is that so.', 'Right.', 'If you say so.']);
  return pick(seed, ['Ha! You\'re a strange one, Founder.', 'I\'m not sure I follow, but go on.', 'Is that right? Well, well.', 'Hm, I hadn\'t thought of it like that.']);
}

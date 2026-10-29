/* ============================================================
   Accessibility (Milestone 7): subtitles for what villagers say
   in the street (and, if wanted, captions for the sounds that
   matter: horns, sirens, thunder, bells, a crash), the interface
   size, colour vision (the good/bad colours everywhere come from
   two CSS variables, swapped here), and reduced motion. Camera
   shake and head bob are read where the camera moves.
   ============================================================ */
import { Settings } from '../sim/settings';

const $ = (id: string): HTMLElement => document.getElementById(id)!;
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** V2: the interface comes down a size on its own on a smaller screen (a 1366×768 laptop, a 125% Windows scale, a
 *  tablet), as a browser zoom of 90% would: everything keeps the layout it was drawn for instead of wrapping. Touch
 *  screens keep their buttons big enough for a finger; phones have their own layout and aren't scaled */
export function autoScale(): number {
  const w = innerWidth, h = innerHeight;
  const coarse = matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
  if (coarse && Math.min(w, h) < 520) return 1;
  return Math.max(coarse ? 0.9 : 0.8, Math.min(1, w / 1500, h / 700));
}

/** apply the interface size, colour vision and reduced motion (at boot, and whenever they change) */
export function applyAccess(): void {
  const root = document.documentElement, body = document.body;
  const ui = Number(Settings.get('uiScale')) || 1;
  root.style.setProperty('--ui', String(Math.max(0.6, Math.min(1.5, ui * autoScale()))));
  body.dataset.cv = Settings.get('colorVision') || 'standard';
  body.classList.toggle('calm', !!Settings.get('calm'));
}
addEventListener('resize', () => applyAccess());

/** subtitles and sound captions, at the foot of the screen; at most three lines, each a few seconds */
class Subtitles {
  private last = new Map<string, number>();
  private box(): HTMLElement { return $('subs'); }
  private line(html: string, ms: number, cls = ''): void {
    const box = this.box();
    const p = document.createElement('p');
    p.className = cls;
    p.innerHTML = html;
    box.appendChild(p);
    while (box.children.length > 3) box.removeChild(box.firstChild!);
    setTimeout(() => { p.classList.add('out'); setTimeout(() => p.remove(), 350); }, ms);
  }
  /** a villager's line: their name, then what they said */
  say(who: string, text: string): void {
    if ((Settings.get('subtitles') || 'speech') === 'off') return;
    this.line(`<b>${esc(who)}</b> ${esc(text)}`, 3200 + text.length * 35);
  }
  /** a sound worth knowing about, in brackets (no more than one of a kind every few seconds) */
  sound(kind: string, text: string, every = 6000): void {
    if (Settings.get('subtitles') !== 'all') return;
    const now = performance.now();
    if ((this.last.get(kind) || 0) > now) return;
    this.last.set(kind, now + every);
    this.line(`[${esc(text)}]`, 2600, 'snd');
  }
}
export const Subs = new Subtitles();

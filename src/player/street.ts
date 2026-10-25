/* ============================================================
   How villagers react when the Founder passes (design §4.5):
   people who like them wave and say hello, people who don't
   scowl and hurry by, and while the police are looking, anyone
   who dislikes the Founder enough tells them where they are.
   ============================================================ */
import { Sim } from '../sim/agents';
import { Rep } from '../sim/reputation';
import type { Founder } from './founder';
import type { Wanted } from './wanted';
import { Subs } from '../ui/access';

type Toast = (msg: string, at?: { x: number; y: number }, news?: boolean) => void;
/** how close a villager has to be to notice the Founder (metres) */
const NOTICE = 9;

export class Street {
  private t = 0;
  /** seconds until the next spoken line gets a toast (bubbles show every time) */
  private sayCd = 0;

  constructor(private f: Founder, private wanted: Wanted, private toast: Toast) {}

  update(dt: number): void {
    this.sayCd -= dt;
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.3;
    const f = this.f, now = performance.now();
    const x = f.driving ? f.car.x : f.pos.x, z = f.driving ? f.car.z : f.pos.z;
    // a face is hard to make out behind a windscreen at speed
    const visible = !f.driving || Math.abs(f.car.speed) < 6;
    for (const p of Sim.people) {
      if (p.state !== 'walk' || !p.trip || p.trip.car || p.trip.taxi || p.trip.moto || p.knocked || p.freezeT > 0) continue;
      if (Math.hypot(p.x * 0.5 - x, p.y * 0.5 - z) > NOTICE) continue;
      // while wanted, someone who dislikes the Founder calls the police instead
      if (this.wanted.tipOff(p)) continue;
      if (!visible || (p.greetAt || 0) > now) continue;
      p.greetAt = now + 60000;
      const op = Rep.of(p);
      if (op >= 3) {
        p.bubble = op >= 7 ? '😄' : '👋';
        p.bubbleUntil = now + 2600;
        const hi = this.hello();
        Subs.say(`${p.name} ${p.surname}`, `“${hi}, Founder!”`); // (Milestone 7: every word, for subtitles)
        this.say(`👋 “${hi}, Founder!” — ${p.name} ${p.surname}`);
      } else if (op <= -3) {
        p.bubble = op <= -6 ? '😠' : '😒';
        p.bubbleUntil = now + 2600;
        p.trip.hurryT = 5; // and walks on quickly
        if (op <= -6) Subs.say(`${p.name} ${p.surname}`, '“Hmph.”');
        this.say(op <= -6 ? `😠 ${p.name} ${p.surname} glares at you and hurries past` : `😒 ${p.name} ${p.surname} looks away and walks on quickly`);
      }
    }
  }

  private hello(): string {
    const c = Sim.clock;
    return c < 720 ? 'Morning' : c < 1080 ? 'Afternoon' : 'Evening';
  }
  /** a spoken line now and then, not for every passer-by */
  private say(msg: string): void {
    if (this.sayCd > 0 || Math.random() > 0.35) return;
    this.sayCd = 40;
    this.toast(msg);
  }
}

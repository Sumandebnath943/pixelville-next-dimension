/* ============================================================
   The first day (Milestone 7): a short guide that founds the
   village with a new player, a step at a time, instead of a page
   of controls to read. Each step says one thing, rings the button
   it means, and moves on by itself once the player has done it
   (looked around, risen into the Planner, placed the first house,
   seen the first family arrive, given them work, come back down,
   talked to a neighbour, opened the phone). It names the controls
   of the device in use, can be skipped at any point, and picks up
   where the village is if the page is reloaded.
   ============================================================ */
import { World } from '../sim/world';
import { Sim } from '../sim/agents';
import { CAT } from '../sim/catalog';
import { Settings } from '../sim/settings';
import { Input, keys } from '../input/input';

export interface TourApi {
  planner(): boolean;
  founder(): { x: number; z: number; yaw: number };
  talking(): boolean;
  phoneOpen(): boolean;
  /** show a palette category (homes, work) */
  palette(cat: string): void;
  /** route the GPS to the first family's door */
  findFamily(): void;
  toast(m: string): void;
}
interface Step {
  id: string;
  title: string;
  /** the words, by device */
  text: () => string;
  /** what to ring (a CSS selector), if anything */
  ring?: () => string | null;
  /** done: move on */
  done: () => boolean;
  /** this step is already behind the village (a reload mid-guide) */
  past?: () => boolean;
  /** an extra button on the card */
  button?: { label: string; run: () => void };
  /** a live line under the text */
  status?: () => string;
  enter?: () => void;
}

const $ = (id: string): HTMLElement => document.getElementById(id)!;
const homes = (): number => World.buildings.filter((b: any) => CAT[b.type].res && b.type !== 'lodge').length;
const workplaces = (): number => World.buildings.filter((b: any) => (CAT[b.type].jobs || 0) > 0).length;
const dev = (): 'keys' | 'pad' | 'touch' => Input.device;

export class Tour {
  active = false;
  private i = 0;
  private steps: Step[];
  private t0 = 0;
  private start0 = { x: 0, z: 0, yaw: 0 };
  private talked = false;
  private phoned = false;
  private lastHtml = '';

  constructor(private api: TourApi) {
    const by = (k: string, p: string, t: string): string => (dev() === 'pad' ? p : dev() === 'touch' ? t : k);
    this.steps = [
      {
        id: 'look', title: 'Welcome, Founder',
        text: () => by(
          `This is the land your village will grow on. Look around with the mouse (click the view first) and walk with ${keys('<kbd>{forward}</kbd><kbd>{left}</kbd><kbd>{back}</kbd><kbd>{right}</kbd>')}.`,
          'This is the land your village will grow on. Look around with the right stick and walk with the left.',
          'This is the land your village will grow on. Drag on the right of the screen to look around; the left thumb-stick walks.'),
        enter: () => { const f = this.api.founder(); this.start0 = { ...f }; },
        done: () => {
          const f = this.api.founder();
          return Math.hypot(f.x - this.start0.x, f.z - this.start0.z) > 6 || Math.abs(f.yaw - this.start0.yaw) > 0.9 || this.since() > 25;
        },
        past: () => homes() > 0,
      },
      {
        id: 'rise', title: 'Rise into the sky',
        text: () => by(`Villages are built from above. Press ${keys('<kbd>{planner}</kbd>')} (or the crane at the top) to rise into the Planner.`,
          'Villages are built from above. Press <kbd>Menu</kbd> to rise into the Planner.',
          'Villages are built from above. Tap the crane button to rise into the Planner.'),
        ring: () => (dev() === 'touch' ? '#tbtns [data-a=planner]' : '#btn-planner'),
        done: () => this.api.planner(),
        past: () => homes() > 0 && workplaces() > 0,
      },
      {
        id: 'house', title: 'Found the village',
        text: () => by('Pick the <b>House</b> on the left, then click open ground beside the road to place it. A road joins it by itself.',
          'Press the d-pad to reach the <b>House</b> on the left and <kbd>A</kbd> to pick it, then aim the ring at open ground beside the road and press <kbd>A</kbd>.',
          'Tap the <b>House</b> on the left, then tap open ground beside the road to place it. A road joins it by itself.'),
        enter: () => this.api.palette('res'),
        ring: () => (this.api.planner() ? '.pal-item[data-key="house"]' : dev() === 'touch' ? '#tbtns [data-a=planner]' : '#btn-planner'),
        done: () => homes() > 0,
        past: () => homes() > 0,
      },
      {
        id: 'family', title: 'The first family',
        text: () => 'The builders are at work. Speed time up with the <b>4×</b> or <b>8×</b> button and watch the house go up: the first family will move in.',
        ring: () => (this.api.planner() ? '#speed' : null),
        status: () => {
          const h = World.buildings.find((b: any) => CAT[b.type].res && b.type !== 'lodge');
          if (!h) return '';
          return h.construction > 0 ? `The house is ${Math.round((1 - h.construction / (h.conTotal || h.construction)) * 100)}% built` : 'Finished — the family is on its way';
        },
        done: () => Sim.people.length > 0,
        past: () => Sim.people.length > 0,
      },
      {
        id: 'work', title: 'Give them work',
        text: () => by('A village needs jobs. Open the <b>Work</b> or <b>Shops</b> tab and place a workplace: a Farm, a Shop or a Bakery. More families follow the jobs.',
          'A village needs jobs. <kbd>LB</kbd> turns the palette\'s tabs: find the <b>Work</b> or <b>Shops</b> tab and place a Farm, a Shop or a Bakery. More families follow the jobs.',
          'A village needs jobs. Tap the <b>Work</b> or <b>Shops</b> tab and place a Farm, a Shop or a Bakery. More families follow the jobs.'),
        enter: () => this.api.palette('work'),
        ring: () => (this.api.planner() ? '#pal-tabs button[data-cat="work"]' : dev() === 'touch' ? '#tbtns [data-a=planner]' : '#btn-planner'),
        done: () => workplaces() > 0,
        past: () => workplaces() > 0,
      },
      {
        id: 'down', title: 'Come back down',
        text: () => by(`Now meet them. Press ${keys('<kbd>{planner}</kbd>')} again to come back down to the street.`, 'Now meet them. Press <kbd>Menu</kbd> again to come back down to the street.', 'Now meet them. Tap the crane again to come back down to the street.'),
        ring: () => (dev() === 'touch' ? '#tbtns [data-a=planner]' : '#btn-planner'),
        done: () => !this.api.planner(),
      },
      {
        id: 'talk', title: 'Meet the neighbours',
        text: () => (this.api.planner() ? by(`First come back down (${keys('<kbd>{planner}</kbd>')}). `, 'First come back down (<kbd>Menu</kbd>). ', 'First tap the crane to come back down. ') : '') + by(`Walk up to a villager (or knock at their door) and press ${keys('<kbd>{interact}</kbd>')} to talk. They remember what you say, and what you do.`,
          'Walk up to a villager (or knock at their door) and press <kbd>X</kbd> to talk. They remember what you say, and what you do.',
          'Walk up to a villager (or knock at their door) and tap <b>E</b> to talk. They remember what you say, and what you do.'),
        button: { label: 'Show me where they are', run: () => this.api.findFamily() },
        done: () => this.talked || this.since() > 150,
      },
      {
        id: 'phone', title: 'Your phone',
        text: () => by(`Press ${keys('<kbd>{phone}</kbd>')} for your phone: the map and directions, your wallet, and the Jobs app, where a shift earns you money.`,
          'Press <kbd>View</kbd> for your phone: the map and directions, your wallet, and the Jobs app, where a shift earns you money.',
          'Tap the phone button at the top for the map, your wallet, and the Jobs app, where a shift earns you money.'),
        ring: () => '#btn-phone',
        done: () => this.phoned,
      },
      {
        id: 'end', title: 'The village figures out the rest',
        text: () => `People will find work, fall in love, vote, gossip and remember. Build more from the sky whenever you like. ${dev() === 'keys' ? keys('<kbd>F1</kbd>') + ' shows every control.' : 'Help in the menu shows every control.'}`,
        button: { label: 'Off you go', run: () => this.finish() },
        done: () => this.since() > 30,
      },
    ];
    $('tour-skip').addEventListener('click', () => this.finish(true));
    $('tour-btn').addEventListener('click', () => this.steps[this.i]?.button?.run());
  }

  private since(): number { return (performance.now() - this.t0) / 1000; }

  /** begin (or pick up where the village is) */
  start(): void {
    this.active = true;
    this.talked = this.phoned = false;
    let i = 0;
    while (i < this.steps.length - 1 && this.steps[i].past?.()) i++;
    // a village that's already founded and working starts at "come back down" (or "meet the neighbours" on the street)
    if (i >= 5 && !this.api.planner()) i = 6;
    this.go(i);
    document.body.classList.add('touring');
  }
  private go(i: number): void {
    this.i = i;
    this.t0 = performance.now();
    this.lastHtml = '';
    this.steps[i]?.enter?.();
    this.render();
  }
  /** done with the guide (finished, or skipped) */
  finish(skipped = false): void {
    this.active = false;
    Settings.set('tourDone', true);
    document.body.classList.remove('touring');
    $('tour-ring').style.display = 'none';
    if (skipped) this.api.toast('🧭 Guide skipped — Settings → Village brings it back; F1 shows every control');
  }

  /** tell the guide what just happened */
  saw(what: 'talk' | 'phone'): void {
    if (what === 'talk') this.talked = true;
    if (what === 'phone') this.phoned = true;
  }

  /** a few times a second */
  update(): void {
    if (!this.active) return;
    const s = this.steps[this.i];
    // (done, or something the village has got past another way: built from a card, a reload)
    if (s.done() || s.past?.()) {
      // on to the next step the village hasn't already done
      let n = this.i + 1;
      while (n < this.steps.length - 1 && this.steps[n].past?.()) n++;
      if (n >= this.steps.length) { this.finish(); return; }
      this.go(n);
      return;
    }
    this.render();
  }

  private render(): void {
    const s = this.steps[this.i];
    const status = s.status?.() || '';
    const html = `${s.text()}${status ? `<small>${status}</small>` : ''}`;
    if (html !== this.lastHtml) {
      this.lastHtml = html;
      $('tour-step').textContent = `${this.i + 1} of ${this.steps.length}`;
      $('tour-title').textContent = s.title;
      $('tour-text').innerHTML = html;
      const b = $('tour-btn');
      b.style.display = s.button ? '' : 'none';
      if (s.button) b.textContent = s.button.label;
      $('tour-dots').innerHTML = this.steps.map((_, k) => `<i class="${k < this.i ? 'done' : k === this.i ? 'on' : ''}"></i>`).join('');
    }
    // the ring round whatever the step means
    const ring = $('tour-ring'), sel = s.ring?.(), el = sel ? document.querySelector<HTMLElement>(sel) : null;
    const r = el?.getBoundingClientRect();
    if (!r || !r.width) { ring.style.display = 'none'; return; }
    ring.style.display = 'block';
    ring.style.left = `${r.left - 6}px`;
    ring.style.top = `${r.top - 6}px`;
    ring.style.width = `${r.width + 12}px`;
    ring.style.height = `${r.height + 12}px`;
  }
}

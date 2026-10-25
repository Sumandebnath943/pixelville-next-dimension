/* ============================================================
   Gamepad through the menus (Milestone 7): whenever a menu is open
   (the phone, a card, a conversation, settings, the counter, the
   journey screen, the Planner's palette) the d-pad (or the left
   stick) moves a highlight to the nearest control in that
   direction, A presses it, B backs out (the game's own "cancel"),
   and left/right turn a slider or a list. Nothing here knows the
   menus: it reads what's on screen.
   ============================================================ */
import { Input } from './input';

const FOCUSABLE = 'button:not([disabled]), input:not([type=hidden]):not([disabled]), select:not([disabled]), [data-go], .pal-item, a[href], [tabindex]:not([tabindex="-1"])';
const DIRS: Record<number, [number, number]> = { 12: [0, -1], 13: [0, 1], 14: [-1, 0], 15: [1, 0] };

export class PadNav {
  /** the open menus, topmost first; `modal` ones take the pad as soon as they're up, the rest once the d-pad is pressed */
  constructor(private layers: () => { el: HTMLElement; modal: boolean }[]) {}
  private repeatT = 0;
  private lastDir = '';

  private visible(el: HTMLElement): boolean {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  }
  private items(layer: HTMLElement): HTMLElement[] {
    return [...layer.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => this.visible(e));
  }
  private layer(): { el: HTMLElement; modal: boolean } | null {
    for (const l of this.layers()) if (l.el && this.visible(l.el)) return l;
    return null;
  }
  private current(layer: HTMLElement): HTMLElement | null {
    const a = document.activeElement as HTMLElement | null;
    return a && a !== document.body && layer.contains(a) && this.visible(a) ? a : null;
  }

  /** is any menu on screen */
  any(): boolean { return !!this.layer(); }
  /** should the menu have the pad this frame (set before Input.poll) */
  wants(): boolean {
    if (!Input.pad || Input.device !== 'pad') return false;
    const l = this.layer();
    return !!l && (l.modal || !!this.current(l.el));
  }

  /** after Input.poll: move, press, turn */
  update(dt: number): void {
    document.body.classList.toggle('pad', Input.device === 'pad');
    if (!Input.pad) return;
    const l = this.layer();
    if (!l) return;
    const cur = this.current(l.el);
    // the d-pad, or the left stick held over (repeating)
    let dir: [number, number] | null = null;
    for (const b of Input.padEdges) if (DIRS[b]) dir = DIRS[b];
    const ax = Input.pad.axes[0] || 0, ay = Input.pad.axes[1] || 0;
    if (!dir && (l.modal || cur)) {
      const k = Math.abs(ax) > 0.6 ? `${Math.sign(ax)},0` : Math.abs(ay) > 0.6 ? `0,${Math.sign(ay)}` : '';
      this.repeatT -= dt;
      if (k && (k !== this.lastDir || this.repeatT <= 0)) {
        dir = k.split(',').map(Number) as [number, number];
        this.repeatT = k === this.lastDir ? 0.14 : 0.36;
      }
      this.lastDir = k;
    }
    if (dir) {
      // a slider or a list under the highlight turns with left and right
      if (cur && dir[1] === 0 && this.turn(cur, dir[0])) return;
      if (!cur) { this.focus(this.first(l.el)); return; }
      this.focus(this.nearest(l.el, cur, dir) || cur);
      return;
    }
    if (cur && Input.padEdges.includes(0)) this.press(cur);
  }

  private first(layer: HTMLElement): HTMLElement | null {
    const all = this.items(layer);
    // what's picked, else the main button, else (in the palette) the first thing to build
    return all.find((e) => e.classList.contains('active')) || all.find((e) => e.classList.contains('primary')) || all.find((e) => e.classList.contains('pal-item')) || all[0] || null;
  }
  private focus(el: HTMLElement | null): void {
    if (!el) return;
    document.querySelectorAll('.padfocus').forEach((e) => e.classList.remove('padfocus'));
    if (!el.hasAttribute('tabindex') && !/^(BUTTON|INPUT|SELECT|A)$/.test(el.tagName)) el.tabIndex = -1;
    el.focus({ preventScroll: true });
    el.classList.add('padfocus');
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  /** the nearest control in a direction: along it counts once, across it twice */
  private nearest(layer: HTMLElement, from: HTMLElement, [dx, dy]: [number, number]): HTMLElement | null {
    const a = from.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best: HTMLElement | null = null, bs = Infinity;
    for (const e of this.items(layer)) {
      if (e === from) continue;
      const r = e.getBoundingClientRect();
      // how far past from's edge the other one starts, in the direction asked
      const along = dx ? (dx > 0 ? r.left - a.right : a.left - r.right) : (dy > 0 ? r.top - a.bottom : a.top - r.bottom);
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const centre = dx ? (cx - ax) * dx : (cy - ay) * dy;
      if (centre <= 2 || along < -Math.min(a.width, a.height) * 0.5) continue;
      const across = dx ? Math.max(0, Math.abs(cy - ay) - (a.height + r.height) / 2) : Math.max(0, Math.abs(cx - ax) - (a.width + r.width) / 2);
      // sideways stays on (about) the same row; up and down may travel anywhere along a list
      if (dx && across > Math.max(24, a.height)) continue;
      const s = Math.max(0, along) + across * 2 + (dx ? Math.abs(cy - ay) : Math.abs(cx - ax)) * 0.05;
      if (s < bs) { bs = s; best = e; }
    }
    return best;
  }
  /** left/right on a slider or a list changes it in place */
  private turn(el: HTMLElement, d: number): boolean {
    if (el instanceof HTMLInputElement && el.type === 'range') {
      const step = Number(el.step) || (Number(el.max) - Number(el.min)) / 20;
      el.value = String(Math.max(Number(el.min), Math.min(Number(el.max), Number(el.value) + step * d * (step < 0.2 ? 2 : 1))));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (el instanceof HTMLSelectElement) {
      el.selectedIndex = (el.selectedIndex + d + el.options.length) % el.options.length;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  }
  private press(el: HTMLElement): void {
    if (el instanceof HTMLSelectElement) { this.turn(el, 1); return; }
    // the palette and some cards act on pointerdown
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse', button: 0 }));
    el.click();
  }
  /** let go of the menu (after picking a Planner tool, so A places it) */
  release(): void {
    const a = document.activeElement as HTMLElement | null;
    a?.blur?.();
    document.querySelectorAll('.padfocus').forEach((e) => e.classList.remove('padfocus'));
  }
}

/* ============================================================
   The shift card (Milestone 6): top left on the street while
   you're on a shift. The job and where, what to do now (with a
   progress bar when there's something to fill), time left, pay
   so far and the stars; a "+$12" pops up with every task paid.
   And the marker: a little tag over the fire, the fare, the
   customer, the pole — whatever the job wants next.
   ============================================================ */
import * as THREE from 'three';
import type { Shifts } from '../player/shifts';

const $ = (id: string) => document.getElementById(id)!;

export class ShiftPanel {
  private last = '';
  private v = new THREE.Vector3();
  private markKey = '';

  constructor(private shifts: Shifts, onEnd: () => void) {
    $('sh-end').addEventListener('click', () => onEnd());
    shifts.onEarn = (n) => this.flash(n);
  }

  /** a few times a second */
  sync(): void {
    const p = this.shifts.panel();
    document.body.classList.toggle('shift', !!p);
    if (!p) { this.last = ''; return; }
    const key = [p.emoji, p.title, p.place, p.text, p.sub, p.left, p.earned, p.stars, p.k === null ? '' : Math.round(p.k * 100), p.lock].join('|');
    if (key === this.last) return;
    this.last = key;
    $('sh-ico').textContent = p.emoji;
    $('sh-title').textContent = p.title;
    $('sh-place').textContent = `On shift at ${p.place}`;
    $('sh-obj').textContent = p.text;
    $('sh-sub').textContent = p.sub;
    $('sh-left').textContent = p.left;
    $('sh-earned').textContent = `$${p.earned}`;
    $('sh-stars').innerHTML = `<b>${'★'.repeat(p.starsN)}</b>${'★'.repeat(5 - p.starsN)}`;
    $('sh-stars').title = `How the shift is going: ${p.starsN} of 5`;
    const g = $('sh-gauge');
    g.classList.toggle('off', p.k === null);
    if (p.k !== null) $('sh-bar').style.width = `${Math.round(Math.max(0, Math.min(1, p.k)) * 100)}%`;
    $('sh-end').title = p.lock || 'Clock off — end the shift and get paid';
  }

  private flash(n: number): void {
    if (n < 0.5) return;
    const el = $('sh-flash');
    el.textContent = `+$${Math.round(n)}`;
    el.classList.remove('go');
    void el.offsetWidth; // (restart the animation)
    el.classList.add('go');
  }

  /** the marker over the job's next target, projected with `cam` (hidden when there's none, or it's behind) */
  mark(cam: THREE.Camera, show: boolean): void {
    const el = $('shift-mark');
    const m = show ? this.shifts.marker() : null;
    if (!m) { if (this.markKey) { el.style.display = 'none'; this.markKey = ''; } return; }
    this.v.set(m.x, m.y, m.z).project(cam);
    if (this.v.z > 1 || this.v.z < -1) { if (this.markKey) { el.style.display = 'none'; this.markKey = ''; } return; }
    const W = window.innerWidth, H = window.innerHeight;
    let x = ((this.v.x + 1) / 2) * W, y = ((1 - this.v.y) / 2) * H;
    // off the side of the view: held at the edge, a little faded
    const edge = x < 24 || x > W - 24 || y < 60 || y > H - 24;
    x = Math.max(24, Math.min(W - 24, x));
    y = Math.max(60, Math.min(H - 24, y));
    const key = `${m.icon}|${Math.round(x)}|${Math.round(y)}|${edge}`;
    if (key === this.markKey) return;
    if (el.textContent !== m.icon) el.textContent = m.icon;
    el.style.display = 'block';
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
    el.classList.toggle('edge', edge);
    this.markKey = key;
  }
}

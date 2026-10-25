/* ============================================================
   Touch controls for phones and tablets: a left thumb-stick to
   move (or drive), a right-side look pad, and action buttons.
   Shown automatically the first time the screen is touched.
   ============================================================ */
import { Input, type Action } from '../input/input';

export function initTouch(): void {
  const stick = document.getElementById('stick')!;
  const knob = stick.querySelector('i') as HTMLElement;
  const look = document.getElementById('lookpad')!;
  let stickId = -1, lookId = -1;
  let lookLast = { x: 0, y: 0 };

  // V2 (Milestone 7): a phone or tablet shows its controls from the start; the first tap goes full screen, sideways
  const phone = matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
  if (phone) { document.body.classList.add('touch', 'coarse'); Input.usingTouch = true; Input.device = 'touch'; }
  window.addEventListener('touchstart', () => {
    document.body.classList.add('touch');
    Input.usingTouch = true;
    if (phone) fullScreen();
  }, { once: true, passive: true });
  document.getElementById('btn-full')?.addEventListener('click', () => {
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
    else fullScreen();
  });

  const setStick = (e: PointerEvent) => {
    const r = stick.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = (e.clientX - cx) / (r.width / 2), dy = (e.clientY - cy) / (r.height / 2);
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    Input.touchMove.x = dx;
    Input.touchMove.y = -dy;
    knob.style.transform = `translate(${dx * 40}px, ${dy * 40}px)`;
  };
  stick.addEventListener('pointerdown', (e) => { stickId = e.pointerId; stick.setPointerCapture(e.pointerId); setStick(e); });
  stick.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) setStick(e); });
  const endStick = (e: PointerEvent) => {
    if (e.pointerId !== stickId) return;
    stickId = -1;
    Input.touchMove.x = Input.touchMove.y = 0;
    knob.style.transform = '';
  };
  stick.addEventListener('pointerup', endStick);
  stick.addEventListener('pointercancel', endStick);

  look.addEventListener('pointerdown', (e) => {
    if (document.body.classList.contains('planner')) return;
    lookId = e.pointerId;
    look.setPointerCapture(e.pointerId);
    lookLast = { x: e.clientX, y: e.clientY };
  });
  look.addEventListener('pointermove', (e) => {
    if (e.pointerId !== lookId) return;
    Input.touchLook.dx += e.clientX - lookLast.x;
    Input.touchLook.dy += e.clientY - lookLast.y;
    lookLast = { x: e.clientX, y: e.clientY };
  });
  const endLook = (e: PointerEvent) => { if (e.pointerId === lookId) lookId = -1; };
  look.addEventListener('pointerup', endLook);
  look.addEventListener('pointercancel', endLook);

  document.querySelectorAll<HTMLButtonElement>('#tbtns button').forEach((b) => {
    if (b.dataset.a) b.addEventListener('pointerdown', (e) => { e.preventDefault(); Input.press(b.dataset.a as Action); });
    if (b.dataset.hold) {
      // held buttons: run, and (Milestone 7) the plane's climb and descend
      const hold = b.dataset.hold, set = (on: boolean): void => {
        if (hold === 'run') Input.touchRun = on;
        else Input.touchPitch = on ? (hold === 'climb' ? 1 : -1) : 0;
      };
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); set(true); });
      const up = () => set(false);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
    }
  });
}

/** full screen, and (where the browser allows) held in landscape */
function fullScreen(): void {
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  try {
    const p = el.requestFullscreen?.({ navigationUI: 'hide' }) ?? el.webkitRequestFullscreen?.();
    void Promise.resolve(p).then(() => (screen.orientation as unknown as { lock?: (o: string) => Promise<void> })?.lock?.('landscape')).catch(() => {});
  } catch { /* not offered here (an iPhone browser): the Home Screen app is full screen instead */ }
}

/* ============================================================
   Input: one action map for keyboard + mouse, gamepad and touch
   (design §14). Gameplay code asks for axes and actions, never
   for raw keys, so every device drives the same game.
   ============================================================ */

export type Action =
  | 'jump' | 'interact' | 'vehicle' | 'camera' | 'planner' | 'phone' | 'run'
  | 'rotate' | 'cancel' | 'undo' | 'pause' | 'journal' | 'help';

const KEYMAP: Record<string, Action> = {
  Space: 'jump', KeyE: 'interact', KeyF: 'vehicle', KeyV: 'camera', KeyP: 'planner', Tab: 'phone',
  KeyR: 'rotate', Escape: 'cancel', KeyJ: 'journal', F1: 'help',
};
// standard gamepad layout
const PADMAP: Record<number, Action> = { 0: 'jump', 2: 'interact', 3: 'vehicle', 11: 'camera', 9: 'planner', 8: 'phone', 1: 'cancel', 5: 'rotate' };

class InputState {
  keys = new Set<string>();
  private edge = new Set<Action>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  locked = false;
  /** touch sticks, -1..1 */
  touchMove = { x: 0, y: 0 };
  touchLook = { dx: 0, dy: 0 };
  touchRun = false;
  pad: Gamepad | null = null;
  private padPrev: boolean[] = [];
  usingTouch = false;
  usingPad = false;
  /** street mode lets a held mouse button look around when pointer lock is unavailable */
  dragLook = false;
  private dragging = false;

  attach(canvas: HTMLCanvasElement): void {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select')) return;
      if (e.code === 'Tab' || e.code === 'Space' || e.code === 'F1') e.preventDefault();
      if (!this.keys.has(e.code)) {
        const a = KEYMAP[e.code];
        if (a) this.edge.add(a);
        if (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey)) this.edge.add('undo');
      }
      this.keys.add(e.code);
      this.usingTouch = false;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('mousedown', () => { if (this.dragLook && !this.locked) this.dragging = true; });
    window.addEventListener('mouseup', () => { this.dragging = false; });
    window.addEventListener('mousemove', (e) => {
      if (this.locked || (this.dragging && this.dragLook)) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
    canvas.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; });
    window.addEventListener('gamepadconnected', () => { this.usingPad = true; });
  }

  requestLock(canvas: HTMLCanvasElement): void {
    if (this.locked || this.usingTouch || !canvas.requestPointerLock) return;
    // some embeds refuse pointer lock — drag-to-look keeps working there
    try {
      const p = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      p?.catch?.(() => {});
    } catch {
      /* not allowed here */
    }
  }
  releaseLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** call once per frame before reading */
  poll(): void {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    this.pad = null;
    for (const p of pads) if (p && p.connected) { this.pad = p; break; }
    if (this.pad) {
      this.pad.buttons.forEach((b, i) => {
        const down = b.pressed;
        if (down && !this.padPrev[i]) {
          const a = PADMAP[i];
          if (a) this.edge.add(a);
          this.usingPad = true;
        }
        this.padPrev[i] = down;
      });
    }
  }

  /** consume an edge-triggered action */
  take(a: Action): boolean {
    if (this.edge.has(a)) { this.edge.delete(a); return true; }
    return false;
  }
  press(a: Action): void { this.edge.add(a); }
  /** clear edges at end of frame so stale presses never leak into later frames */
  endFrame(): void {
    this.edge.clear();
    this.mouseDX = this.mouseDY = 0;
    this.touchLook.dx = this.touchLook.dy = 0;
    this.wheel = 0;
  }

  private dz(v: number): number { return Math.abs(v) < 0.15 ? 0 : v; }

  /** movement: x = strafe right, y = forward */
  move(): { x: number; y: number } {
    let x = 0, y = 0;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (this.pad) { x += this.dz(this.pad.axes[0] || 0); y -= this.dz(this.pad.axes[1] || 0); }
    x += this.touchMove.x;
    y += this.touchMove.y;
    const m = Math.hypot(x, y);
    return m > 1 ? { x: x / m, y: y / m } : { x, y };
  }
  /** look delta in radians-ish units */
  look(sens: number, invertY: boolean): { dx: number; dy: number } {
    let dx = this.mouseDX * 0.0025, dy = this.mouseDY * 0.0025;
    if (this.pad) { dx += this.dz(this.pad.axes[2] || 0) * 0.045; dy += this.dz(this.pad.axes[3] || 0) * 0.035; }
    dx += this.touchLook.dx * 0.006;
    dy += this.touchLook.dy * 0.006;
    return { dx: dx * sens, dy: dy * sens * (invertY ? -1 : 1) };
  }
  running(): boolean {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || !!this.pad?.buttons[10]?.pressed || this.touchRun;
  }
  /** car pedals: throttle 0..1, brake 0..1 */
  pedals(): { gas: number; brake: number } {
    const k = this.keys;
    let gas = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0;
    let brake = k.has('KeyS') || k.has('ArrowDown') ? 1 : 0;
    if (this.pad) { gas = Math.max(gas, this.pad.buttons[7]?.value || 0); brake = Math.max(brake, this.pad.buttons[6]?.value || 0); }
    if (this.touchMove.y > 0.2) gas = Math.max(gas, this.touchMove.y);
    if (this.touchMove.y < -0.2) brake = Math.max(brake, -this.touchMove.y);
    return { gas, brake };
  }
  steer(): number {
    const k = this.keys;
    let s = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    if (this.pad) s += this.dz(this.pad.axes[0] || 0);
    s += this.touchMove.x;
    return Math.max(-1, Math.min(1, s));
  }
  handbrake(): boolean {
    return this.keys.has('Space') || !!this.pad?.buttons[0]?.pressed;
  }
}

export const Input = new InputState();

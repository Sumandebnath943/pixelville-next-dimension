/* ============================================================
   Input: one action map for keyboard + mouse, gamepad and touch
   (design §14). Gameplay code asks for axes and actions, never
   for raw keys, so every device drives the same game.
   V2 (Milestone 7): the keys are rebindable (Settings → Controls,
   kept in this browser), and every prompt names the control on the
   device in use: `{interact}` in a string becomes E, X on a pad, or
   the touch button.
   ============================================================ */
import { Settings } from '../sim/settings';

export type Action =
  | 'jump' | 'interact' | 'vehicle' | 'camera' | 'planner' | 'phone' | 'run'
  | 'rotate' | 'cancel' | 'undo' | 'pause' | 'journal' | 'help' | 'photo' | 'hide' | 'shoot'
  | 'forward' | 'back' | 'left' | 'right' | 'climb' | 'descend';

/** the actions a player can rebind, in the order Settings lists them; `group` keeps clashes apart
 *  (the plane's climb can share E with "use", since nobody talks to anyone from the flight deck) */
export const BINDABLE: { a: Action; label: string; group: 'main' | 'fly' }[] = [
  { a: 'forward', label: 'Forward · throttle', group: 'main' },
  { a: 'back', label: 'Back · brake', group: 'main' },
  { a: 'left', label: 'Left · steer left', group: 'main' },
  { a: 'right', label: 'Right · steer right', group: 'main' },
  { a: 'run', label: 'Run', group: 'main' },
  { a: 'jump', label: 'Jump · handbrake', group: 'main' },
  { a: 'interact', label: 'Use · talk · work', group: 'main' },
  { a: 'vehicle', label: 'Vehicle · departures', group: 'main' },
  { a: 'camera', label: 'First / third person', group: 'main' },
  { a: 'phone', label: 'Phone', group: 'main' },
  { a: 'planner', label: 'Planner', group: 'main' },
  { a: 'journal', label: 'Task book', group: 'main' },
  { a: 'photo', label: 'Photo mode', group: 'main' },
  { a: 'rotate', label: 'Turn the door (Planner)', group: 'main' },
  { a: 'help', label: 'Help', group: 'main' },
  { a: 'climb', label: 'Climb · rise (plane, photo, Planner turn)', group: 'fly' },
  { a: 'descend', label: 'Descend · sink (plane, photo, Planner turn)', group: 'fly' },
];
export const DEFAULT_KEYS: Partial<Record<Action, string[]>> = {
  forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'], jump: ['Space'], interact: ['KeyE'], vehicle: ['KeyF'], camera: ['KeyV'],
  phone: ['Tab'], planner: ['KeyP'], journal: ['KeyJ'], photo: ['F2'], rotate: ['KeyR'], help: ['F1'],
  climb: ['KeyE'], descend: ['KeyQ'],
  // fixed: Esc always cancels, H hides the photo panel, Enter takes the photo
  cancel: ['Escape'], hide: ['KeyH'], shoot: ['Enter', 'NumpadEnter'],
};
// standard gamepad layout: A jump, B back, X use, Y vehicle, LB photo, RB turn, Back phone, Start Planner, L3 run, R3 camera,
// d-pad up the task book (d-pad moves through menus whenever one is open)
const PADMAP: Record<number, Action> = { 0: 'jump', 1: 'cancel', 2: 'interact', 3: 'vehicle', 4: 'photo', 5: 'rotate', 8: 'phone', 9: 'planner', 11: 'camera', 12: 'journal' };
const PAD_LABEL: Partial<Record<Action, string>> = {
  jump: 'A', cancel: 'B', interact: 'X', vehicle: 'Y', photo: 'LB', rotate: 'RB', phone: 'View', planner: 'Menu', camera: 'R3', run: 'L3',
  journal: 'D-pad ↑', forward: 'RT', back: 'LT', left: 'L stick', right: 'L stick', climb: 'R stick ↑', descend: 'R stick ↓', help: 'Menu', shoot: 'A',
};
const TOUCH_LABEL: Partial<Record<Action, string>> = {
  interact: 'E', vehicle: 'Car', jump: '⤒', camera: 'Eye', planner: 'Planner', run: 'Run', climb: '▲', descend: '▼',
  forward: 'stick ↑', back: 'stick ↓', left: 'stick', right: 'stick', phone: 'the phone', cancel: 'Back',
};
const NAMES: Record<string, string> = {
  Space: 'Space', Tab: 'Tab', Escape: 'Esc', Enter: 'Enter', NumpadEnter: 'Enter', ShiftLeft: 'Shift', ShiftRight: 'Shift',
  ControlLeft: 'Ctrl', ControlRight: 'Ctrl', AltLeft: 'Alt', AltRight: 'Alt', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Backspace: '⌫', CapsLock: 'Caps', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'",
  Backslash: '\\', Comma: ',', Period: '.', Slash: '/', Insert: 'Ins', Delete: 'Del', Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn',
};
/** the character a key position carries on this keyboard's layout (Z on an AZERTY keyboard for KeyW), when the browser can say */
let layout: Map<string, string> | null = null;
try {
  (navigator as unknown as { keyboard?: { getLayoutMap(): Promise<Map<string, string>> } }).keyboard?.getLayoutMap().then((m) => { layout = m; }).catch(() => {});
} catch { /* not offered here */ }
/** a key code as a person would name it */
export function keyName(code: string): string {
  if (NAMES[code]) return NAMES[code];
  const l = layout?.get(code);
  if (l && l.trim()) return l.toUpperCase();
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

export type Device = 'keys' | 'pad' | 'touch';

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
  /** the plane's climb (+1) or descend (-1) buttons, held */
  touchPitch = 0;
  pad: Gamepad | null = null;
  private padPrev: boolean[] = [];
  /** the d-pad and A, read by the menu navigation instead of the game while a menu is open */
  padEdges: number[] = [];
  /** set while the menu navigation owns the pad's d-pad and A */
  padMenu = false;
  /** set while any menu is on screen: the d-pad is for it, not the task book */
  padLayer = false;
  usingTouch = false;
  usingPad = false;
  /** the device last used: prompts name its controls */
  device: Device = 'keys';
  /** street mode lets a held mouse button look around when pointer lock is unavailable */
  dragLook = false;
  private dragging = false;
  /** while Settings waits for a key to bind, the next key press goes there instead */
  capture: ((code: string) => void) | null = null;
  /** every action's keys: the defaults, with the player's own bindings over them */
  binds: Partial<Record<Action, string[]>> = {};
  private byCode = new Map<string, Action[]>();

  constructor() { this.loadBinds(); }

  /* ---------- bindings ---------- */
  loadBinds(): void {
    const mine = (Settings.get('keys') || {}) as Partial<Record<Action, string[]>>;
    this.binds = {};
    for (const [a, ks] of Object.entries(DEFAULT_KEYS)) this.binds[a as Action] = Array.isArray(mine[a as Action]) ? mine[a as Action]!.slice(0, 2) : ks!.slice();
    this.byCode.clear();
    for (const [a, ks] of Object.entries(this.binds)) for (const k of ks!) { const l = this.byCode.get(k) || []; l.push(a as Action); this.byCode.set(k, l); }
  }
  /** bind `code` as the main key for `a`; whatever else in its group had that key loses it. Returns the actions that lost it */
  bind(a: Action, code: string): Action[] {
    const g = BINDABLE.find((b) => b.a === a)?.group;
    const lost: Action[] = [];
    const mine = { ...((Settings.get('keys') || {}) as Partial<Record<Action, string[]>>) };
    for (const b of BINDABLE) {
      if (b.a === a || b.group !== g) continue;
      const ks = this.binds[b.a] || [];
      if (ks.includes(code)) { mine[b.a] = ks.filter((k) => k !== code); lost.push(b.a); }
    }
    const cur = this.binds[a] || [];
    mine[a] = [code, ...cur.slice(1).filter((k) => k !== code)];
    Settings.set('keys', mine);
    this.loadBinds();
    return lost;
  }
  resetBinds(): void { Settings.set('keys', {}); this.loadBinds(); }
  /** is any key bound to `a` held down? */
  held(a: Action): boolean {
    for (const k of this.binds[a] || []) if (this.keys.has(k)) return true;
    return false;
  }
  /** how to do `a` on the device in use, as a short label (E, X, ▲…) */
  label(a: Action): string {
    if (this.device === 'pad' && PAD_LABEL[a]) return PAD_LABEL[a]!;
    if (this.device === 'touch' && TOUCH_LABEL[a]) return TOUCH_LABEL[a]!;
    const k = this.binds[a]?.[0];
    return k ? keyName(k) : '—';
  }
  /** fill a string's `{action}` tokens with the controls on the device in use */
  keys_(s: string): string {
    return s.indexOf('{') < 0 ? s : s.replace(/\{(\w+)\}/g, (m, a) => (a in DEFAULT_KEYS ? this.label(a as Action) : m));
  }

  attach(canvas: HTMLCanvasElement): void {
    window.addEventListener('keydown', (e) => {
      if (this.capture) {
        e.preventDefault();
        const c = this.capture;
        this.capture = null;
        c(e.code);
        return;
      }
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select')) return;
      if (e.code === 'Tab' || e.code === 'Space' || e.code === 'F1' || e.code === 'F2' || this.byCode.has(e.code) && /^F\d+$/.test(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) {
        for (const a of this.byCode.get(e.code) || []) this.edge.add(a);
        if (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey)) this.edge.add('undo');
      }
      this.keys.add(e.code);
      this.usingTouch = false;
      this.device = 'keys';
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
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2 && this.device === 'pad') this.device = 'keys';
    });
    canvas.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; });
    window.addEventListener('gamepadconnected', () => { this.usingPad = true; });
    window.addEventListener('touchstart', () => { this.device = 'touch'; }, { passive: true });
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
    this.padEdges.length = 0;
    for (const p of pads) if (p && p.connected) { this.pad = p; break; }
    if (this.pad) {
      this.pad.buttons.forEach((b, i) => {
        const down = b.pressed;
        if (down && !this.padPrev[i]) {
          this.padEdges.push(i);
          // while a menu has the pad, the d-pad and A are its own (B still backs out)
          const dpad = i >= 12 && i <= 15;
          const a = (this.padMenu && (i === 0 || dpad)) || (this.padLayer && dpad) ? undefined : PADMAP[i];
          if (a) this.edge.add(a);
          this.usingPad = true;
          this.device = 'pad';
        }
        this.padPrev[i] = down;
      });
      if (this.pad.axes.some((v) => Math.abs(v) > 0.5)) { this.usingPad = true; this.device = 'pad'; }
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
    if (this.held('forward')) y += 1;
    if (this.held('back')) y -= 1;
    if (this.held('right')) x += 1;
    if (this.held('left')) x -= 1;
    if (this.pad && !this.padMenu) { x += this.dz(this.pad.axes[0] || 0); y -= this.dz(this.pad.axes[1] || 0); }
    x += this.touchMove.x;
    y += this.touchMove.y;
    const m = Math.hypot(x, y);
    return m > 1 ? { x: x / m, y: y / m } : { x, y };
  }
  /** look delta in radians-ish units */
  look(sens: number, invertY: boolean): { dx: number; dy: number } {
    let dx = this.mouseDX * 0.0025, dy = this.mouseDY * 0.0025;
    if (this.pad && !this.padMenu) { dx += this.dz(this.pad.axes[2] || 0) * 0.045; dy += this.dz(this.pad.axes[3] || 0) * 0.035; }
    dx += this.touchLook.dx * 0.006;
    dy += this.touchLook.dy * 0.006;
    return { dx: dx * sens, dy: dy * sens * (invertY ? -1 : 1) };
  }
  running(): boolean {
    return this.held('run') || !!this.pad?.buttons[10]?.pressed || this.touchRun;
  }
  /** car pedals: throttle 0..1, brake 0..1 */
  pedals(): { gas: number; brake: number } {
    let gas = this.held('forward') ? 1 : 0;
    let brake = this.held('back') ? 1 : 0;
    if (this.pad) { gas = Math.max(gas, this.pad.buttons[7]?.value || 0); brake = Math.max(brake, this.pad.buttons[6]?.value || 0); }
    if (this.touchMove.y > 0.2) gas = Math.max(gas, this.touchMove.y);
    if (this.touchMove.y < -0.2) brake = Math.max(brake, -this.touchMove.y);
    return { gas, brake };
  }
  steer(): number {
    let s = (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0);
    if (this.pad && !this.padMenu) s += this.dz(this.pad.axes[0] || 0);
    s += this.touchMove.x;
    return Math.max(-1, Math.min(1, s));
  }
  handbrake(): boolean {
    return this.held('jump') || (!this.padMenu && !!this.pad?.buttons[0]?.pressed);
  }
  /** rise / sink: the plane's pitch, photo mode's height (+1 up) */
  rise(): number {
    return (this.held('climb') ? 1 : 0) - (this.held('descend') ? 1 : 0) + this.touchPitch;
  }
}

export const Input = new InputState();
/** a string with its `{action}` tokens filled in for the device in use */
export const keys = (s: string): string => Input.keys_(s);

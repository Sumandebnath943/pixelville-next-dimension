/* ============================================================
   Who the Founder is (Milestone 9): a man or a woman, and one of
   the everyday grown-ups the villagers are made from, each shown
   as a portrait in the Founder's own violet coat. Used when a
   village is founded and from Settings. The portraits are drawn
   once each by a small renderer of their own (then let go), so
   nothing compiles in the game's.
   ============================================================ */
import * as THREE from 'three';
import { Person, randomLook, type Rig } from '../gfx/person';
import { figures } from '../gfx/people';

const SHOWN = 6;
const portraits = new Map<string, string>();

/** a head-and-shoulders picture of each character, in the Founder's colours */
function paint(rigs: Rig[]): void {
  const todo = rigs.filter((r) => !portraits.has(r.id));
  if (!todo.length) return;
  const W = 120, H = 140;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x5a4a3a, 1.6));
  const sun = new THREE.DirectionalLight(0xfff2e0, 2.4);
  sun.position.set(1.2, 2.2, 2.5);
  scene.add(sun);
  const cam = new THREE.PerspectiveCamera(24, W / H, 0.1, 10);
  const coat = new THREE.Color('#4a2a6a'), legs = new THREE.Color('#2a2238');
  for (const r of todo) {
    const p = new Person({ ...randomLook(Math.random), height: r.height, female: r.female }, r, { top: coat, legs });
    p.animate(1 / 60, 'idle', 0, 0);
    scene.add(p.root);
    p.root.updateMatrixWorld(true);
    const head = p.bones.head.getWorldPosition(new THREE.Vector3());
    cam.position.set(0.12, head.y + 0.05, 1.25);
    cam.lookAt(0, head.y - 0.04, 0);
    renderer.render(scene, cam);
    portraits.set(r.id, renderer.domElement.toDataURL('image/png'));
    scene.remove(p.root);
    p.mesh.skeleton.dispose();
  }
  renderer.dispose();
  renderer.forceContextLoss();
}

/** the man/woman switch and the faces, in `faces`; `pick` hears each choice */
export class FigurePicker {
  private female = false;
  constructor(private sex: HTMLElement, private faces: HTMLElement, private pick: (id: string) => void, private current: () => string | null) {
    sex.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => {
      this.female = b.dataset.f === '1';
      this.draw();
      // (switching sides picks that side's first face, so the choice is never left on the other)
      const first = figures(this.female)[0];
      if (first && !figures(this.female).slice(0, SHOWN).some((r) => r.id === this.current())) this.choose(first.id);
    }));
  }
  /** show the choices (the current character's side, its face marked) */
  open(): void {
    const id = this.current();
    const mine = [...figures(false), ...figures(true)].find((r) => r.id === id);
    this.female = mine ? mine.female : false;
    this.draw();
  }
  private choose(id: string): void {
    this.pick(id);
    this.mark();
  }
  private draw(): void {
    this.sex.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', (b.dataset.f === '1') === this.female));
    const list = figures(this.female).slice(0, SHOWN);
    this.faces.innerHTML = '';
    if (!list.length) { this.faces.innerHTML = '<p class="note">The villagers are still on their way — try again in a moment.</p>'; return; }
    paint(list);
    list.forEach((r, i) => {
      const b = document.createElement('button');
      b.className = 'fig-face';
      b.dataset.id = r.id;
      b.title = `${this.female ? 'Woman' : 'Man'} ${i + 1}`;
      b.innerHTML = `<img alt="${b.title}" src="${portraits.get(r.id) ?? ''}" />`;
      b.addEventListener('click', () => this.choose(r.id));
      this.faces.appendChild(b);
    });
    this.mark();
  }
  private mark(): void {
    const id = this.current();
    this.faces.querySelectorAll<HTMLElement>('.fig-face').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
  }
}

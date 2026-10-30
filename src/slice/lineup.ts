/* ============================================================
   Lineup (Milestone 9 test slice): the old figures and the new
   ones side by side on the quay promenade, river behind, for
   judging the look and timing the cost. Left to right: the
   code-built man, woman and child, then the modelled villagers;
   the old hatchback and the new; the old dog and bird, then
   every downloaded animal. Each group stands on its own mark so
   a camera can frame it.
   ============================================================ */
import * as THREE from 'three';
import { Person, randomLook, type Look, type Rig } from '../gfx/person';
import { Car } from '../gfx/car';
import { allModels, ModelCar } from '../gfx/vehicle';
import { Animal, type Beast, type BeastPose } from '../gfx/animals';
import { PROPS } from '../render/models';
import { G } from './street';

export interface Mark { name: string; at: THREE.Vector3; width: number }

const Z = 31;
const FACE = Math.PI; // facing -z, towards a camera on the pavement side
const FLEET_Z = 22;
// (seen from there, +x is to the left: the line runs towards -x so it reads old → new, left to right)

export class Lineup {
  group = new THREE.Group();
  people: Person[] = [];
  marks: Mark[] = [];
  newCar: Car;
  private spin: { obj: THREE.Object3D; k: number }[] = [];
  private x = -22;

  constructor(scene: THREE.Scene, rigs: Rig[], beasts: Beast[] = []) {
    scene.add(this.group);
    // people: the code-built ones, then each modelled villager
    const start = this.x;
    let st = 11;
    const rand = (): number => { st = (Math.imul(st, 1664525) + 1013904223) >>> 0; return st / 4294967296; };
    const old: Partial<Look>[] = [
      { female: false, height: 1.8, longHair: false, skirt: false },
      { female: true, height: 1.66, longHair: true, skirt: false },
      { female: false, height: 1.36, longHair: false, skirt: false },
    ];
    for (const o of old) this.addPerson({ ...randomLook(rand), ...o });
    this.x -= 0.6;
    for (const r of rigs) this.addPerson({ ...randomLook(rand), height: r.height, female: r.female }, r);
    this.mark('people', start, this.x);
    // cars: the old hatchback and the new
    this.x -= 3;
    const c0 = this.x;
    // ('old': no such model, so the code-built car)
    const oldCar = new Car('hatch', new THREE.Color('#2f4f7a'), true, undefined, 'old');
    this.place(oldCar.root, 2.6);
    this.x -= 0.8;
    this.newCar = new Car('hatch', new THREE.Color('#2f4f7a'), true, undefined, 'ace');
    this.place(this.newCar.root, 2.6);
    this.mark('cars', c0, this.x);
    // animals: the old dog and bird (the game's instanced figures), then every downloaded one
    this.x -= 2;
    const a0 = this.x;
    const dog = new THREE.Mesh(PROPS.dog.geo, new THREE.MeshStandardMaterial({ color: '#8a6a42', vertexColors: true, roughness: 0.7 }));
    this.place(dog, 1.2);
    const bird = new THREE.Mesh(PROPS.bird.geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide }));
    this.place(bird, 1.4, 0.6);
    this.x -= 0.8;
    for (const b of beasts) {
      const a = new Animal(b);
      const bird = b.entry.body === 'bird';
      this.place(a.root, Math.max(0.5, b.entry.length * 0.75 + 0.3), b.entry.species === 'butterfly' ? 1.1 : 0);
      this.zoo.push({ a, pose: bird ? (b.entry.species === 'duck' ? 'swim' : b.entry.species === 'butterfly' ? 'fly' : 'peck') : 'walk', speed: Math.min(1.5, 0.6 + b.entry.height * 0.5) });
    }
    this.mark('animals', a0, this.x);
    // the whole downloaded fleet, side on, in a row on the lawn in front
    let fx = -14;
    for (const m of allModels()) {
      const c = new ModelCar(m, new THREE.Color('#8a2a2a'), true);
      fx -= m.dims.L / 2;
      c.root.position.set(fx, G, FLEET_Z);
      c.root.rotation.y = -Math.PI / 2;
      this.group.add(c.root);
      this.fleet.push({ id: m.id, x: fx, L: m.dims.L, H: m.dims.H });
      fx -= m.dims.L / 2 + 1.5;
    }
    this.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }
  fleet: { id: string; x: number; L: number; H: number }[] = [];
  /** the downloaded animals, each in a pose (set from the console to judge another) */
  zoo: { a: Animal; pose: BeastPose; speed: number }[] = [];

  /** add something new to a group (the new car, dog, pigeon), at the end of the line */
  add(group: string, obj: THREE.Object3D, width: number, lift = 0, spin = 0): void {
    const m = this.marks.find((k) => k.name === group);
    if (!m) return;
    const x = m.at.x - m.width / 2 - width / 2 - 0.6;
    obj.position.set(x, G + lift, Z);
    obj.rotation.y = FACE + 0.5;
    this.group.add(obj);
    m.at.x -= (width + 0.6) / 2;
    m.width += width + 0.6;
    if (spin) this.spin.push({ obj, k: spin });
  }

  private addPerson(look: Look, rig?: Rig): void {
    const p = new Person(look, rig);
    p.carriesUmbrella = false;
    this.place(p.root, 0.75);
    p.root.rotation.y = FACE;
    this.people.push(p);
  }
  private place(obj: THREE.Object3D, width: number, lift = 0): void {
    obj.position.set(this.x - width / 2, G + lift, Z);
    obj.rotation.y = FACE + 0.5;
    this.group.add(obj);
    this.x -= width;
  }
  private mark(name: string, x0: number, x1: number): void {
    this.marks.push({ name, at: new THREE.Vector3((x0 + x1) / 2, G + 0.9, Z), width: Math.abs(x1 - x0) });
  }

  update(dt: number, rain: number): void {
    for (const p of this.people) p.animate(dt, 'idle', 0, rain);
    // (the four-legged ones walk on the spot, to show their gaits)
    for (const z of this.zoo) z.a.animate(dt, z.pose, z.speed);
    for (const s of this.spin) s.obj.rotation.y += dt * s.k;
  }
}

/* ============================================================
   Christmas in the square: the village tree as a centrepiece —
   a 24 m spruce on a stone plinth piled with gifts, hundreds of
   twinkling lights spiralling up to a glowing star, garlands of
   light draped from its crown to a ring of flagpoles, a skating
   rink circling it with villagers gliding round, and warm
   floodlights. Built once, shown while the sim says the tree is
   up (rising inside its scaffold while it's being raised).
   ============================================================ */
import * as THREE from 'three';
import { buildTree, Vegetation } from './vegetation';
import { surface } from './surface';
import { GLSL_COMMON, bindEnv } from './env';
import { lightsOn } from './architecture';
import { Person, randomLook } from './person';

const COLORS = ['#ff3a2a', '#ffcf40', '#3aa0ff', '#5aff7a', '#ff6ad0', '#fff2d8', '#fff2d8', '#fff2d8'].map((h) => new THREE.Color(h));

/** twinkling bulbs: instanced spheres, HDR colour so they bloom after dark */
export class Bulbs {
  mesh: THREE.InstancedMesh;
  n = 0;
  private uK = { value: 1 };
  constructor(cap: number, radius = 0.09) {
    const geo = new THREE.SphereGeometry(radius, 8, 6);
    const phase = new Float32Array(cap);
    for (let i = 0; i < cap; i++) phase[i] = Math.random() * 6.28;
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uK: this.uK },
      vertexShader: /* glsl */ `
        ${GLSL_COMMON}
        attribute float aPhase;
        varying vec3 vCol;
        varying float vTw;
        varying vec3 vWPos;
        void main() {
          vCol = instanceColor;
          vTw = 0.55 + 0.45 * sin(uTime * (1.2 + fract(aPhase * 3.7) * 2.5) + aPhase);
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vWPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        ${GLSL_COMMON}
        uniform float uK;
        varying vec3 vCol;
        varying float vTw;
        varying vec3 vWPos;
        void main() {
          vec3 c = vCol * (0.25 + uK * (0.12 + vTw * 0.4));
          gl_FragColor = vec4(pvFog(c, vWPos), 1.0);
        }`,
    });
    bindEnv(mat.uniforms);
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }
  add(p: THREE.Vector3, c: THREE.Color): void {
    if (this.n >= this.mesh.instanceMatrix.count) return;
    this.mesh.setMatrixAt(this.n, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z));
    this.mesh.setColorAt(this.n, c);
    this.n++;
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }
  /** brightness: dim by day, blazing at night */
  set level(k: number) {
    this.uK.value = k;
  }
}

function star(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.42 : 1, a = Math.PI / 2 + (i / 10) * Math.PI * 2;
    if (i) s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.25, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06, bevelSegments: 2 });
  g.translate(0, 0, -0.125);
  return g;
}

export class XmasPlaza {
  group = new THREE.Group();
  private tree = new THREE.Group();
  private bulbs: Bulbs;
  private garland: Bulbs;
  private starMat: THREE.MeshStandardMaterial;
  private lamps: THREE.SpotLight[] = [];
  private skaters: { p: Person; r: number; a: number; v: number }[] = [];
  private flags: THREE.Mesh[] = [];
  private H = 24;
  private built = false;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    this.group.visible = false;
    this.bulbs = new Bulbs(900, 0.1);
    this.garland = new Bulbs(520, 0.085);
    this.starMat = new THREE.MeshStandardMaterial({ color: 0xffd76a, emissive: 0xffc840, emissiveIntensity: 2, roughness: 0.25, metalness: 0.6 });
  }

  private build(): void {
    this.built = true;
    const veg = new Vegetation(new THREE.Scene());
    const mats = veg.materialsFor('spruce');
    const t = buildTree('spruce', 2024);
    const k = this.H / t.height;
    const wood = new THREE.Mesh(t.wood, mats.bark), leaves = new THREE.Mesh(t.leaves, mats.leaves);
    for (const m of [wood, leaves]) { m.scale.setScalar(k); m.castShadow = true; m.receiveShadow = true; this.tree.add(m); }
    this.group.add(this.tree);

    // lights spiralling up the cone, and a star on top
    const crownR = (y: number): number => Math.max(0.3, (1 - y / this.H) * this.H * 0.3 * 0.92);
    for (let i = 0; i < 900; i++) {
      const f = Math.pow(i / 900, 0.85);
      const y = 1.8 + f * (this.H - 2.6);
      const a = i * 0.62 + f * 40;
      const r = crownR(y) * (0.82 + Math.random() * 0.2);
      this.bulbs.add(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r), COLORS[i % COLORS.length]);
    }
    this.tree.add(this.bulbs.mesh);
    const s = new THREE.Mesh(star(), this.starMat);
    s.scale.setScalar(1.1);
    s.position.y = this.H + 0.9;
    this.tree.add(s);
    this.tree.userData.star = s;

    // plinth with gifts
    const stone = surface(new THREE.MeshStandardMaterial({ color: 0xd8d2c6, roughness: 0.6 }), { snow: 1, wet: 0.6 }, 'plinth');
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 3.0, 0.6, 40), stone);
    plinth.position.y = 0.3;
    plinth.receiveShadow = plinth.castShadow = true;
    this.group.add(plinth);
    const giftC = ['#b0202a', '#1d5a3a', '#e8d8b0', '#2a4a8a', '#c9a24a'];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + Math.random() * 0.3, r = 1.6 + Math.random() * 0.9;
      const sz = 0.35 + Math.random() * 0.4;
      const box = new THREE.Mesh(new THREE.BoxGeometry(sz, sz * 0.8, sz), surface(new THREE.MeshStandardMaterial({ color: giftC[i % 5], roughness: 0.45 }), { snow: 1 }, 'gift'));
      box.position.set(Math.cos(a) * r, 0.6 + sz * 0.4, Math.sin(a) * r);
      box.rotation.y = Math.random() * 3;
      const ribbon = new THREE.Mesh(new THREE.BoxGeometry(sz * 1.02, sz * 0.82, 0.06), new THREE.MeshStandardMaterial({ color: 0xffd76a, roughness: 0.3, metalness: 0.5 }));
      box.add(ribbon);
      box.castShadow = true;
      this.group.add(box);
    }

    // the rink: an ice ring round the tree, white boards on both edges
    const ice = surface(new THREE.MeshStandardMaterial({ color: 0xdfe9f2, roughness: 0.04, metalness: 0 }), { snow: 0.1, wet: 0.2, puddles: false }, 'ice');
    const ring = new THREE.Mesh(new THREE.RingGeometry(4.0, 11.0, 64, 1), ice);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    ring.receiveShadow = true;
    this.group.add(ring);
    const boards = surface(new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.5 }), { snow: 1 }, 'boards');
    for (const r of [3.9, 11.1]) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.9, 72, 1, true), boards);
      b.position.y = 0.45;
      b.material.side = THREE.DoubleSide;
      b.castShadow = true;
      this.group.add(b);
    }

    // flagpoles round the square, garlands of light from the crown to each
    const pole = surface(new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.3, metalness: 0.8 }), { snow: 0.5 }, 'pole');
    const flagC = ['#c0392b', '#2a5ad0', '#f2c230', '#2e8a4a', '#ffffff', '#8a3ab0', '#e07a2a', '#1a9ab0'];
    const N = 12, R = 14.5;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const x = Math.cos(a) * R, z = Math.sin(a) * R;
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 9, 10), pole);
      p.position.set(x, 4.5, z);
      p.castShadow = true;
      this.group.add(p);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.1, 8, 1), surface(new THREE.MeshStandardMaterial({ color: flagC[i % flagC.length], roughness: 0.8, side: THREE.DoubleSide }), { snow: 0.3 }, 'flag'));
      flag.geometry.translate(0.9, 0, 0);
      flag.position.set(x, 8.2, z);
      flag.rotation.y = -a;
      this.flags.push(flag);
      this.group.add(flag);
      // a catenary of bulbs from high on the tree out to the pole top
      const top = new THREE.Vector3(Math.cos(a) * 1.2, this.H * 0.72, Math.sin(a) * 1.2);
      const end = new THREE.Vector3(x, 8.9, z);
      for (let j = 1; j < 42; j++) {
        const u = j / 42;
        const p2 = top.clone().lerp(end, u);
        p2.y -= Math.sin(u * Math.PI) * 2.6;
        this.garland.add(p2, COLORS[(i + j) % COLORS.length]);
      }
    }
    this.group.add(this.garland.mesh);

    // floodlights on the tree
    for (const [x, z] of [[9, 9], [-9, -7]]) {
      const l = new THREE.SpotLight(0xffe2b0, 0, 60, 0.6, 0.6, 1.5);
      l.position.set(x, 3, z);
      l.target.position.set(0, this.H * 0.45, 0);
      this.group.add(l, l.target);
      this.lamps.push(l);
    }

    // skaters gliding round
    let seed = 7;
    const rnd = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 7; i++) {
      const p = new Person(randomLook(rnd, true));
      p.carriesUmbrella = false;
      this.group.add(p.root);
      this.skaters.push({ p, r: 5.5 + rnd() * 4.5, a: rnd() * Math.PI * 2, v: 0.25 + rnd() * 0.15 });
    }
  }

  /** place, show and animate; `rise` 0..1 while the tree is being raised */
  update(dt: number, show: boolean, x: number, z: number, rise: number, lit: boolean, night: number, time: number): void {
    this.group.visible = show;
    if (!show) return;
    if (!this.built) this.build();
    this.group.position.set(x, 0, z);
    this.tree.scale.set(1, Math.max(0.05, rise), 1);
    // scene-referred brightness: at night exposure these read as bright points that softly bloom
    const glow = lit ? 0.2 + night * 1.0 + lightsOn.value * 0.15 : 0;
    this.bulbs.level = glow;
    this.garland.level = glow;
    this.bulbs.mesh.visible = this.garland.mesh.visible = lit;
    this.starMat.emissiveIntensity = lit ? 0.6 + night * 1.4 + Math.sin(time * 2) * 0.15 : 0;
    (this.tree.userData.star as THREE.Mesh).rotation.y = time * 0.4;
    for (const l of this.lamps) l.intensity = lit ? 9 * night : 0;
    for (const f of this.flags) {
      const pos = f.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const u = pos.getX(i) / 1.8;
        pos.setZ(i, Math.sin(time * 3 + u * 5) * 0.15 * u);
      }
      pos.needsUpdate = true;
    }
    // skaters only once the tree is lit
    for (const s of this.skaters) {
      s.p.root.visible = lit;
      if (!lit) continue;
      s.a += (s.v * dt * 4) / s.r * 2.5;
      const px = Math.cos(s.a) * s.r, pz = Math.sin(s.a) * s.r;
      s.p.root.position.set(px, 0.06, pz);
      s.p.root.rotation.set(0, -s.a, 0.1, 'YXZ');
      s.p.animate(dt, 'walk', 0.55, 0);
    }
  }
}

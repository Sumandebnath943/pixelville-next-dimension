/* ============================================================
   An interior as a small scene of its own (design §8): the room
   (textured floor, plastered walls, a front wall with the glazed
   doors and windows that glow with the light outside), the
   furniture merged per surface, painted signs, ceiling lamps and
   their light, and a soft room environment for reflections. The
   street keeps simulating outside; only this is drawn.
   ============================================================ */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as TX from '../gfx/textures';
import type { Layout, Mat } from '../interiors/plan';

/** lamps that cast real light (the rest only glow); kept low for integrated GPUs */
const MAX_LAMPS = 4;

/* textures and materials are made once and shared by every interior */
let TEX: { planks: TX.TexSet; plaster: TX.TexSet; paving: TX.TexSet; granite: TX.TexSet; tile: THREE.Texture } | null = null;
function textures(): NonNullable<typeof TEX> {
  if (!TEX) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#e6e6e2';
    g.fillRect(0, 0, 128, 128);
    g.fillRect(128, 128, 128, 128);
    g.strokeStyle = 'rgba(0,0,0,0.18)';
    g.lineWidth = 3;
    for (const v of [0, 128, 256]) { g.beginPath(); g.moveTo(v, 0); g.lineTo(v, 256); g.stroke(); g.beginPath(); g.moveTo(0, v); g.lineTo(256, v); g.stroke(); }
    const tile = new THREE.CanvasTexture(c);
    tile.colorSpace = THREE.SRGBColorSpace;
    tile.wrapS = tile.wrapT = THREE.RepeatWrapping;
    tile.anisotropy = 4;
    TEX = { planks: TX.planks(), plaster: TX.render(), paving: TX.paving(), granite: TX.granite(), tile };
  }
  return TEX;
}
const MATS: Partial<Record<Mat, THREE.Material>> = {};
function mat(m: Mat): THREE.Material {
  if (!MATS[m]) {
    const std = (o: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ vertexColors: true, ...o });
    MATS[m] = {
      wood: () => std({ roughness: 0.55 }),
      darkwood: () => std({ roughness: 0.45 }),
      paint: () => std({ roughness: 0.7 }),
      fabric: () => std({ roughness: 0.95 }),
      leather: () => std({ roughness: 0.5 }),
      metal: () => std({ roughness: 0.4, metalness: 0.6 }),
      chrome: () => std({ roughness: 0.15, metalness: 1 }),
      plastic: () => std({ roughness: 0.45 }),
      stone: () => std({ roughness: 0.35 }),
      ceramic: () => std({ roughness: 0.3 }),
      brick: () => std({ roughness: 0.9 }),
      glass: () => std({ roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.12, depthWrite: false }),
      water: () => std({ roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.85 }),
      screen: () => new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: true }),
      glow: () => std({ roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 0.0 }),
    }[m]!();
    if (m === 'glow') (MATS[m] as THREE.MeshStandardMaterial).onBeforeCompile = (s) => {
      // glow in its own colour
      s.fragmentShader = s.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance = diffuseColor.rgb * 2.5;');
    };
  }
  return MATS[m]!;
}
let ENVMAP: THREE.Texture | null = null;
function roomEnv(renderer: THREE.WebGLRenderer): THREE.Texture {
  if (!ENVMAP) {
    const pm = new THREE.PMREMGenerator(renderer);
    ENVMAP = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
  }
  return ENVMAP;
}

/** a box as geometry with its colour baked in, ready to merge */
function boxGeo(x: number, y: number, z: number, w: number, h: number, d: number, color: THREE.Color, ry = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(Math.max(0.005, w), Math.max(0.005, h), Math.max(0.005, d));
  if (ry) g.rotateY(ry);
  g.translate(x, y + h / 2, z);
  const n = g.attributes.position.count, cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { cols[i * 3] = color.r; cols[i * 3 + 1] = color.g; cols[i * 3 + 2] = color.b; }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return g;
}
/** a plane with UVs in metres / `metres`, so textures keep their real size */
function plane(w: number, h: number, metres: number): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / metres), uv.getY(i) * (h / metres));
  return g;
}

export class InteriorScene {
  scene = new THREE.Scene();
  private outside: THREE.MeshBasicMaterial;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private lamps: THREE.PointLight[] = [];
  private fixtures: THREE.MeshBasicMaterial;
  private disposables: { dispose(): void }[] = [];

  constructor(public L: Layout, renderer: THREE.WebGLRenderer, shadows: boolean) {
    const T = textures(), th = L.theme, S = this.scene;
    S.environment = roomEnv(renderer);
    S.environmentIntensity = 0.45;
    S.background = new THREE.Color('#0c0e12');
    const hw = L.w / 2, hd = L.d / 2;

    // the floor
    const fm = new THREE.MeshStandardMaterial({ color: th.floorTint, roughness: 0.8 });
    let fmetres = 2;
    if (th.floor === 'wood') { fm.map = T.planks.map; fm.normalMap = T.planks.normalMap; fm.roughnessMap = T.planks.roughnessMap; fm.roughness = 1; fmetres = T.planks.metres; }
    else if (th.floor === 'stone') { fm.map = T.paving.map; fm.normalMap = T.paving.normalMap; fmetres = T.paving.metres; fm.roughness = 0.45; }
    else if (th.floor === 'concrete') { fm.map = T.granite.map; fm.normalMap = T.granite.normalMap; fmetres = 2.5; fm.roughness = 0.85; }
    else if (th.floor === 'tile') { fm.map = T.tile; fmetres = 1.2; fm.roughness = 0.25; }
    else fm.roughness = 1; // carpet
    const floor = new THREE.Mesh(plane(L.w, L.d, fmetres), fm);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    S.add(floor);
    // the ceiling
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(L.w, L.d), new THREE.MeshStandardMaterial({ color: '#f2f0ea', roughness: 0.95 }));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = L.h;
    S.add(ceil);

    // walls: plaster in the theme's colour; the front wall has the doors and two windows
    const wm = new THREE.MeshStandardMaterial({ color: th.wall, normalMap: T.plaster.normalMap, normalScale: new THREE.Vector2(0.4, 0.4), roughness: 0.9 });
    const wall = (w: number, h: number, x: number, y: number, z: number, ry: number): void => {
      const m = new THREE.Mesh(plane(w, h, T.plaster.metres), wm);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      m.receiveShadow = true;
      S.add(m);
    };
    wall(L.w, L.h, 0, L.h / 2, -hd, 0);
    // what you see through the glass: the day (or night) outside
    this.outside = new THREE.MeshBasicMaterial({ color: '#cfe0f0' });
    this.disposables.push(this.outside);
    // side walls, with windows if the room has them
    for (const sx of [-1, 1]) {
      wall(L.d, L.h, sx * hw, L.h / 2, 0, -sx * Math.PI / 2);
      if (!L.sideWindows) continue;
      const n = Math.max(1, Math.floor(L.d / 4));
      for (let k = 0; k < n; k++) this.windowAt(sx * hw, -hd + (L.d / n) * (k + 0.5), sx, L.h, th.trim);
    }
    // the front: door 2 m wide, windows either side
    const doorW = 2, sideW = (L.w - doorW) / 2;
    for (const sx of [-1, 1]) {
      const cx = sx * (doorW / 2 + sideW / 2);
      wall(sideW, 0.9, cx, 0.45, hd, Math.PI);
      wall(sideW, L.h - 2.4, cx, 2.4 + (L.h - 2.4) / 2, hd, Math.PI);
      for (const ex of [-1, 1]) wall(0.4, 1.5, cx + ex * (sideW / 2 - 0.2), 1.65, hd, Math.PI);
    }
    wall(doorW, L.h - 2.4, 0, 2.4 + (L.h - 2.4) / 2, hd, Math.PI);
    const glassFront = (w: number, h: number, x: number, y: number): void => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.outside);
      m.position.set(x, y, hd + 0.02);
      m.rotation.y = Math.PI;
      S.add(m);
    };
    glassFront(doorW, 2.4, 0, 1.2);
    for (const sx of [-1, 1]) glassFront(sideW - 0.8, 1.5, sx * (doorW / 2 + sideW / 2), 1.65);

    // trim: skirting all round, the door frame and its mullion, window sills
    const trim: THREE.BufferGeometry[] = [];
    const tc = new THREE.Color(th.trim);
    trim.push(boxGeo(0, 0, -hd + 0.01, L.w, 0.12, 0.03, tc), boxGeo(-hw + 0.01, 0, 0, 0.03, 0.12, L.d, tc), boxGeo(hw - 0.01, 0, 0, 0.03, 0.12, L.d, tc));
    trim.push(boxGeo(-doorW / 2, 0, hd - 0.03, 0.1, 2.45, 0.08, tc), boxGeo(doorW / 2, 0, hd - 0.03, 0.1, 2.45, 0.08, tc), boxGeo(0, 2.4, hd - 0.03, doorW + 0.2, 0.1, 0.08, tc), boxGeo(0, 0, hd - 0.03, 0.05, 2.4, 0.05, tc));
    for (const sx of [-1, 1]) trim.push(boxGeo(sx * (doorW / 2 + sideW / 2), 0.88, hd - 0.08, sideW - 0.7, 0.05, 0.18, tc));
    const tm = new THREE.Mesh(mergeGeometries(trim), mat('paint'));
    S.add(tm);
    trim.forEach((g) => g.dispose());
    this.disposables.push(tm.geometry);

    // the furniture, merged per surface
    const by = new Map<Mat, THREE.BufferGeometry[]>();
    const col = new THREE.Color();
    for (const b of L.boxes) {
      const list = by.get(b.m) || [];
      list.push(boxGeo(b.x, b.y, b.z, b.w, b.h, b.d, col.set(b.c), b.ry || 0));
      by.set(b.m, list);
    }
    for (const [m, geos] of by) {
      const g = mergeGeometries(geos);
      geos.forEach((q) => q.dispose());
      const mesh = new THREE.Mesh(g, mat(m));
      mesh.castShadow = shadows && m !== 'glass' && m !== 'water' && m !== 'screen';
      mesh.receiveShadow = m !== 'screen' && m !== 'glow';
      S.add(mesh);
      this.disposables.push(g);
    }

    // signs
    for (const s of L.signs) {
      const sm = new THREE.MeshBasicMaterial({ map: TX.signTex(s.text, s.bg, s.fg) });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), sm);
      m.position.set(s.x, s.y, s.z);
      m.rotation.y = s.ry;
      S.add(m);
      this.disposables.push(sm, m.geometry);
    }

    // light: the sky through the windows, ceiling lamps (a few cast light, all of them glow)
    this.hemi = new THREE.HemisphereLight('#fff6ea', '#5a4a3a', 0.9);
    S.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff4e0', 1.2);
    this.sun.position.set(-L.w * 0.3, L.h * 1.6, L.d * 1.4);
    this.sun.target.position.set(0, 0, -L.d * 0.2);
    S.add(this.sun.target);
    if (shadows) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(1024, 1024);
      const r = Math.max(L.w, L.d) * 0.75;
      Object.assign(this.sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 0.5, far: L.d * 4 });
      this.sun.shadow.bias = -0.0005;
      this.sun.shadow.normalBias = 0.03;
    }
    S.add(this.sun);
    this.fixtures = new THREE.MeshBasicMaterial({ color: '#fff6e4' });
    this.disposables.push(this.fixtures);
    const fixGeo = new THREE.CylinderGeometry(0.22, 0.26, 0.06, 16);
    this.disposables.push(fixGeo);
    const ranked = [...L.lights].sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
    for (const l of L.lights) {
      if (l.y > L.h - 0.4) {
        const f = new THREE.Mesh(fixGeo, this.fixtures);
        f.position.set(l.x, L.h - 0.03, l.z);
        S.add(f);
      }
    }
    for (const l of ranked.slice(0, MAX_LAMPS)) {
      const p = new THREE.PointLight(l.c, l.i * 16, Math.max(L.w, L.d) * 1.3, 1.5);
      p.position.set(l.x, l.y - 0.1, l.z);
      p.userData.base = l.i * 16;
      S.add(p);
      this.lamps.push(p);
    }
  }

  /** a window on a side wall at (x, z) (`sx`: which side): the outside light in a painted frame, with a sill */
  private windowAt(x: number, z: number, sx: number, h: number, trim: string): void {
    const wh = Math.min(1.6, h - 1.5), y0 = 1.0, inX = x - sx * 0.012;
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(1.3, wh), this.outside);
    pane.position.set(inX, y0 + wh / 2, z);
    pane.rotation.y = -sx * Math.PI / 2;
    this.scene.add(pane);
    const c = new THREE.Color(trim);
    const parts = [
      boxGeo(inX - sx * 0.03, y0 - 0.06, z, 0.16, 0.06, 1.5, c), // sill
      boxGeo(inX, y0 + wh, z, 0.05, 0.07, 1.42, c), // head
      boxGeo(inX, y0 - 0.02, z - 0.68, 0.05, wh + 0.04, 0.07, c),
      boxGeo(inX, y0 - 0.02, z + 0.68, 0.05, wh + 0.04, 0.07, c),
      boxGeo(inX, y0 - 0.02, z, 0.04, wh, 0.04, c), // mullion
    ];
    const f = new THREE.Mesh(mergeGeometries(parts), mat('paint'));
    parts.forEach((g) => g.dispose());
    this.scene.add(f);
    this.disposables.push(pane.geometry, f.geometry);
  }

  /** follow the light outside: `day` 0 (night) … 1 (bright day), `lampsOn` 0 … 1 */
  light(day: number, lampsOn: number): void {
    const sky = new THREE.Color('#0e1626').lerp(new THREE.Color('#d8e8f6'), day);
    this.outside.color.copy(sky).multiplyScalar(0.55 + day * 0.5);
    this.sun.intensity = 0.15 + day * 1.6;
    this.hemi.intensity = 0.5 + day * 0.55;
    const lit = 0.75 + lampsOn * 0.35;
    for (const p of this.lamps) p.intensity = p.userData.base * lit;
    this.fixtures.color.setScalar(0.7 + lit * 0.6);
  }

  dispose(): void {
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !this.disposables.includes(m.geometry)) m.geometry.dispose();
    });
    for (const d of this.disposables) d.dispose();
    this.scene.clear();
  }
}

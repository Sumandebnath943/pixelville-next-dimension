/* ============================================================
   The GPS route drawn on the road: soft amber chevrons a few
   centimetres above the tarmac along the next stretch of the
   route, drifting forward so the way to go reads at a glance,
   fading in at your feet and out in the distance.
   ============================================================ */
import * as THREE from 'three';
import { fogOnly } from '../gfx/surface';
import { LAYER_NO_REFLECT } from '../gfx/pipeline';

const TM = 8;
const MAX = 34;
const SPACING = 4.5;
const REACH = 150;

export class GpsArrows {
  private mesh: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private c = new THREE.Color();
  private up = new THREE.Vector3(0, 1, 0);
  private phase = 0;

  constructor(scene: THREE.Scene) {
    // a chevron pointing along +z, lying flat
    const shape = new THREE.Shape([
      new THREE.Vector2(0, 0.62), new THREE.Vector2(0.95, -0.28), new THREE.Vector2(0.95, -0.72),
      new THREE.Vector2(0, 0.14), new THREE.Vector2(-0.95, -0.72), new THREE.Vector2(-0.95, -0.28),
    ]);
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(Math.PI / 2);
    const mat = fogOnly(new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.88, depthWrite: false, side: THREE.DoubleSide,
    }), 'gpsArrow');
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.count = 0;
    this.mesh.layers.set(LAYER_NO_REFLECT);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    scene.add(this.mesh);
  }

  /**
   * Lay the chevrons from the Founder (px, pz) along `route` (road tiles).
   * `ground` gives the road height. `exposure` is the camera's current
   * exposure: the colour is divided by it so the chevrons read as the same
   * amber in sunshine and after dark; `night` adds a little glow.
   */
  update(dt: number, route: number[][], px: number, pz: number, ground: (x: number, z: number) => number, exposure: number, night: number): void {
    if (route.length < 2) { this.mesh.count = 0; return; }
    this.phase = (this.phase + dt * 3.2) % SPACING;
    // the polyline: from the Founder to the first tile, then tile to tile
    const pts: [number, number][] = [[px, pz]];
    for (const [x, y] of route) pts.push([x * TM + 4, y * TM + 4]);
    let n = 0, walked = 0;
    let next = this.phase + 3; // leave the first few metres clear
    const glow = (0.95 + night * 0.6) / Math.max(0.03, exposure);
    for (let i = 1; i < pts.length && n < MAX; i++) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-3) continue;
      const yaw = Math.atan2(bx - ax, bz - az);
      while (next <= walked + len && n < MAX && next < REACH) {
        const f = (next - walked) / len;
        const x = ax + (bx - ax) * f, z = az + (bz - az) * f;
        this.p.set(x, ground(x, z) + 0.07, z);
        this.q.setFromAxisAngle(this.up, yaw);
        // they grow in at the Founder's feet and shrink away into the distance
        const fade = Math.min(1, (next - 3) / 6) * Math.min(1, (REACH - next) / 50);
        const k = 0.15 + 0.85 * fade;
        this.s.set(k, 1, k);
        this.m.compose(this.p, this.q, this.s);
        this.mesh.setMatrixAt(n, this.m);
        this.c.setRGB(0.94, 0.62, 0.24).multiplyScalar(glow);
        this.mesh.setColorAt(n, this.c);
        n++;
        next += SPACING;
      }
      walked += len;
      if (walked > REACH) break;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  hide(): void {
    this.mesh.count = 0;
  }
}

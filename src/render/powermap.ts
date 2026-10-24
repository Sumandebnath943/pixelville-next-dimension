/* ============================================================
   The power map (V2, Milestone 4): one texel per map tile, read
   by every window, sign and lantern shader (pvPower in env.ts).
   Rewritten whenever the grid's dark districts change, or the
   buildings do (the hospital's own generator keeps it lit).
   ============================================================ */
import * as THREE from 'three';
import { ENV } from '../gfx/env';
import { Power } from '../sim/power';
import { World } from '../sim/world';

let seen = '';

export function syncPowerMap(mapVersion: number): void {
  const key = `${Power.version}:${mapVersion}`;
  if (key === seen) return;
  seen = key;
  const tex = ENV.power.value as THREE.DataTexture;
  const data = tex.image.data as Uint8Array;
  const any = Power.dark.some((v) => v === 1);
  if (!any) data.fill(255);
  else {
    for (let ty = 0; ty < 256; ty++) for (let tx = 0; tx < 256; tx++) data[ty * 256 + tx] = Power.dark[Power.districtOf(tx, ty)] ? 0 : 255;
    for (const b of World.buildings) {
      if (b.type !== 'hospital' || b.ruined) continue;
      for (let j = 0; j < b.h; j++) for (let i = 0; i < b.w; i++) data[(b.y + j) * 256 + b.x + i] = 255;
    }
  }
  tex.needsUpdate = true;
}

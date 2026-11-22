/* ============================================================
   Instanced buffers: only the part in use goes to the graphics
   card. three.js uploads a whole buffer whenever it's flagged,
   and the pools are sized for the busiest moment (thousands of
   places), so most of every upload was empty space.
   ============================================================ */
import * as THREE from 'three';

/** upload the first `n` items of an attribute that is written afresh from 0 each frame (the rest aren't drawn) */
export function markUsed(a: THREE.BufferAttribute, n: number): void {
  if (n <= 0) return;
  a.clearUpdateRanges();
  a.addUpdateRange(0, Math.min(n, a.count) * a.itemSize);
  a.needsUpdate = true;
}

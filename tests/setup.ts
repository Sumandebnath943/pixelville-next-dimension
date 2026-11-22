/* Every test rolls the same dice: Math.random is a seeded generator, restarted before each test, so a test that
   passes passes every time (the sim leans on chance everywhere: who gets ill, how long mending takes, who crashes).
   PV_SEED picks other dice, to look for a test that only passes on lucky ones: PV_SEED=7 npx vitest run */
import { beforeEach, vi } from 'vitest';

const SEED = Number((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.PV_SEED) || 20261122;

/** mulberry32: small, fast and evenly spread */
export function seeded(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** the real clock's start, for a test that measures wall time on purpose */
const realNow = performance.now.bind(performance);

beforeEach(() => {
  Math.random = seeded(SEED);
  // (and the same clock: the traffic lights change on performance.now(), so on the real clock they turned at another
  // point in a test each run, depending on how busy the machine was. Here each reading moves time on a quarter of a
  // millisecond; a test can still mock it for itself)
  if (vi.isMockFunction(performance.now)) return; // (the test file runs its own clock)
  let t = realNow();
  Object.defineProperty(performance, 'now', { configurable: true, writable: true, value: () => (t += 0.25) });
});

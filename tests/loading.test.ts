import { describe, expect, it } from 'vitest';
import { LoadingProgress } from '../src/ui/loading';

function advance(progress: LoadingProgress, from: number, until: number): number {
  for (let now = from + 16; now < until; now += 16) progress.paint(now);
  return progress.paint(until);
}

describe('loading progress', () => {
  it('keeps moving through slow lighting without unlocking the next phase', () => {
    const progress = new LoadingProgress(0);
    progress.enter('lighting', 0);
    const early = advance(progress, 0, 5_000);
    const late = advance(progress, 5_000, 20_000);
    expect(late).toBeGreaterThan(early + 5);
    expect(advance(progress, 20_000, 300_000)).toBeLessThanOrEqual(96);
    progress.enter('frame', 300_000);
    expect(advance(progress, 300_000, 310_000)).toBeLessThanOrEqual(99);
  });

  it('eases to reported building progress and limits the first paint after a stall', () => {
    const progress = new LoadingProgress(0);
    progress.enter('buildings', 0);
    progress.report(160, 160);
    const afterStall = progress.paint(14_000);
    expect(afterStall).toBeGreaterThan(0);
    expect(afterStall).toBeLessThan(2);
    expect(advance(progress, 14_000, 15_200)).toBe(45);
    progress.report(150, 160);
    expect(progress.paint(15_216)).toBe(45);
    progress.enter('textures', 15_216);
    expect(advance(progress, 15_216, 16_000)).toBeGreaterThan(45);
  });

  it('finishes a fast load only after the caller confirms a real frame', () => {
    const progress = new LoadingProgress(0);
    progress.enter('frame', 80);
    const before = progress.paint(96);
    expect(before).toBeLessThan(100);
    progress.complete(100, 300);
    expect(progress.paint(100)).toBe(before);
    const during = advance(progress, 100, 240);
    expect(during).toBeGreaterThan(before);
    expect(during).toBeLessThan(100);
    expect(advance(progress, 240, 400)).toBe(100);
  });

  it('still animates the last stretch after a long stall on a ready frame', () => {
    const progress = new LoadingProgress(0);
    progress.enter('frame', 0);
    const before = advance(progress, 0, 4_000);
    progress.complete(4_000, 300);
    const afterStall = progress.paint(8_000);
    expect(afterStall).toBeGreaterThan(before);
    expect(afterStall - before).toBeLessThan(1);
    expect(advance(progress, 8_000, 8_300)).toBe(100);
  });

  it('can finish without a final animation for reduced motion', () => {
    const progress = new LoadingProgress(0);
    progress.enter('frame', 0);
    expect(progress.paint(16)).toBeLessThan(100);
    progress.complete(20, 0);
    expect(progress.paint(20)).toBe(100);
  });
});

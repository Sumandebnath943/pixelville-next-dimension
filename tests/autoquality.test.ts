/* Auto quality that measures (gfx/autoquality.ts): a preset whose frames run slower than 25 ms steps down one for
   next time; Medium with the graphics card barely working steps up to High, unless High was already found too slow;
   otherwise the preset stays (Medium down to Low only below about 22 fps). And the timing waits for play to settle, ignores pauses, and is recorded. */
import { beforeEach, describe, expect, it } from 'vitest';
import { decide, loadRecord, markLost, QualityProbe, SLOW_MS, SLOW_MS_MEDIUM, SPELL_S, WARM_S } from '../src/gfx/autoquality';

const frames = (ms: number, n = 200): number[] => Array.from({ length: n }, () => ms);

// (a tiny localStorage for the records)
const mem = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, v), removeItem: (k: string) => mem.delete(k) };
beforeEach(() => mem.clear());

describe('auto quality', () => {
  it('steps a preset down one when its frames are too slow', () => {
    expect(decide('high', frames(40), [], { slow: [] })).toEqual({ next: 'medium', verdict: 'slow' });
    // (Medium is kept at a frame rate High wouldn't be: only a game that can't play goes to Low)
    expect(decide('medium', frames(SLOW_MS + 5), [], { slow: [] })).toEqual({ next: 'medium', verdict: 'ok' });
    expect(decide('medium', frames(SLOW_MS_MEDIUM + 5), [], { slow: [] })).toEqual({ next: 'low', verdict: 'slow' });
    expect(decide('low', frames(60), [], { slow: [] }).next).toBe('low');
  });

  it('keeps a preset that runs smoothly, and only steps up with the graphics card timed and idle', () => {
    expect(decide('high', frames(16.7), frames(9), { slow: [] })).toEqual({ next: 'high', verdict: 'ok' });
    expect(decide('medium', frames(16.7), [], { slow: [] })).toEqual({ next: 'medium', verdict: 'ok' }); // (untimed)
    expect(decide('medium', frames(16.7), frames(3), { slow: [] })).toEqual({ next: 'high', verdict: 'room' });
    expect(decide('medium', frames(16.7), frames(3), { slow: ['high'] }).next).toBe('medium'); // (High was too slow)
    expect(decide('medium', frames(16.7), frames(8), { slow: [] }).next).toBe('medium');
  });

  it('times only settled, unbroken play, then records what it found', () => {
    const told: string[] = [];
    const probe = new QualityProbe('card|1920x1080', 'high', (v, next) => told.push(`${v}:${next}`));
    let t = 1000;
    // a minute of 40 ms frames with a long pause in the middle (a dialog): the pause isn't counted
    for (let i = 0; i < 1500 && !probe.done; i++) {
      t += i === 300 ? 5000 : 40;
      probe.frame(t, true, -1);
    }
    expect(probe.done).toBe(true);
    expect(told).toEqual(['slow:medium']);
    const r = loadRecord('card|1920x1080')!;
    expect(r.pick).toBe('medium');
    expect(r.slow).toContain('high');
    expect(r.last!.frame).toBe(40);
    // (it took the warm-up and a whole spell of play: neither the frames before nor the pause end it early)
    expect((WARM_S + SPELL_S) * 1000 / 40).toBeLessThan(1500);
  });

  it('a preset kept on this card and screen is not timed again, but a different screen is', () => {
    const p1 = new QualityProbe('card|1920x1080', 'high', () => {});
    let t = 0;
    while (!p1.done) p1.frame((t += 16.7), true, 6);
    expect(loadRecord('card|1920x1080')!.ok).toContain('high');
    expect(new QualityProbe('card|1920x1080', 'high', () => {}).done).toBe(true);
    expect(new QualityProbe('card|3840x2160', 'high', () => {}).done).toBe(false);
  });

  it('a graphics reset on an auto preset marks it too much, and opens one lighter next time', () => {
    markLost('card|3840x2160', 'high');
    const r = loadRecord('card|3840x2160')!;
    expect(r.pick).toBe('medium');
    expect(r.slow).toEqual(['high']);
  });
});

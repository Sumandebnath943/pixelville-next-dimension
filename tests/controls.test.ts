/* Milestone 7: rebindable keys, prompts that name the controls of the device
   in use, and a young village's building sites that don't wait for imports. */
import { beforeEach, describe, expect, it } from 'vitest';
import { Input, keys, keyName, BINDABLE, DEFAULT_KEYS } from '../src/input/input';
import { Settings } from '../src/sim/settings';
import { Supply } from '../src/sim/supply';
import { Sim } from '../src/sim/agents';
import { town, build, C } from './town';
import { on, midPx } from '../src/sim/core';

describe('controls', () => {
  beforeEach(() => { Settings.data.keys = {}; Input.loadBinds(); Input.device = 'keys'; Input.keys.clear(); });

  it('binds a key, takes it from whatever had it, and resets', () => {
    expect(Input.binds.interact).toEqual(['KeyE']);
    expect(Input.bind('interact', 'KeyK')).toEqual([]); // (V2: G is god view's now)
    expect(Input.binds.interact).toEqual(['KeyK']);
    expect(Settings.data.keys.interact).toEqual(['KeyK']);
    // F belongs to the vehicle: binding it to "use" leaves the vehicle without a key
    expect(Input.bind('interact', 'KeyF')).toEqual(['vehicle']);
    expect(Input.binds.vehicle).toEqual([]);
    // the plane's climb shares E with "use" by default, and a different group never clashes
    Input.resetBinds();
    expect(Input.bind('climb', 'KeyR')).toEqual([]);
    expect(Input.binds.rotate).toEqual(['KeyR']);
    Input.resetBinds();
    expect(Input.binds.vehicle).toEqual(['KeyF']);
    expect(Input.binds.forward).toEqual(['KeyW', 'ArrowUp']);
  });

  it('reads movement, pedals and the plane from the bound keys', () => {
    Input.bind('forward', 'KeyI');
    Input.keys.add('KeyI');
    expect(Input.move().y).toBe(1);
    expect(Input.pedals().gas).toBe(1);
    Input.keys.clear();
    Input.keys.add('ArrowUp'); // the second key stays
    expect(Input.move().y).toBe(1);
    Input.keys.clear();
    Input.keys.add('KeyQ');
    expect(Input.rise()).toBe(-1);
    Input.touchPitch = 1;
    expect(Input.rise()).toBe(0);
    Input.touchPitch = 0;
  });

  it('names the controls for the device in use', () => {
    expect(keys('<b>{interact}</b> talk · {vehicle} · {unknown}')).toBe('<b>E</b> talk · F · {unknown}');
    Input.bind('interact', 'Space');
    expect(keys('{interact}')).toBe('Space');
    Input.device = 'pad';
    expect(keys('{interact} {vehicle} {phone} {forward}')).toBe('X Y View RT');
    Input.device = 'touch';
    expect(keys('{climb}/{descend}')).toBe('▲/▼');
    expect(keyName('ShiftLeft')).toBe('Shift');
    expect(keyName('Digit4')).toBe('4');
    // every bindable action has a default and a label
    for (const b of BINDABLE) { expect(DEFAULT_KEYS[b.a]?.length).toBeGreaterThan(0); expect(b.label).toBeTruthy(); }
  });
});

describe('positional sound', () => {
  it('says where the sim\'s sounds happen: a grand opening dings at the new shop', () => {
    town(5152, 2);
    const heard: { name: string; at?: { x: number; y: number } }[] = [];
    on('sound', (e) => heard.push(e));
    const cafe = build('cafe', C.x + 6, C.y + 10, true);
    const ding = heard.find((e) => e.name === 'ding');
    expect(ding?.at).toEqual(midPx(cafe));
  });
});

describe('balance: a young village builds without waiting (Milestone 7)', () => {
  it('brings most of the first homes\' and the first farm\'s materials with the builders', () => {
    town(5150, 0);
    const h = build('house', C.x, C.y, false), f = build('farm', C.x + 12, C.y + 10, false);
    Supply.initSite(h); Supply.initSite(f);
    expect(h.mats / h.matsNeed).toBeGreaterThanOrEqual(0.75);
    expect(f.mats / f.matsNeed).toBeGreaterThanOrEqual(0.75);
    // a grown village: small homes still bring most, bigger sites the usual share
    town(5151, 12);
    for (let i = 0; Sim.people.length < 30 && i < 12; i++) build('house', C.x + i * 4, C.y - 8); // (family sizes are random)
    expect(Sim.people.length).toBeGreaterThanOrEqual(30);
    const h2 = build('house', C.x - 12, C.y + 8, false), w = build('factory', C.x - 20, C.y + 16, false);
    Supply.initSite(h2); Supply.initSite(w);
    expect(h2.mats / h2.matsNeed).toBeGreaterThanOrEqual(0.65);
    expect(w.mats / w.matsNeed).toBeLessThan(0.5);
    // and the county's daily import allowance grows with the village
    Supply.daily();
    expect(Supply.allow.mats).toBeGreaterThan(40 + 0.5 * 29);
  });
});

/* Vehicles (batch 10): wheels that steer the right way backing up, brake lights that mean braking, and gridlock
   relief that never takes a stuck car away in front of the player. */
import { afterEach, describe, expect, it } from 'vitest';
import '../src/sim/world';
import { Traffic } from '../src/sim/traffic';
import { steerAngle, isBraking } from '../src/gfx/car';

describe('front wheels', () => {
  it('turn with the turn going forwards and against the yaw backing up', () => {
    // turning right (yaw falling) at 5 m/s forwards: the wheels point right (negative)
    expect(steerAngle(-0.4, 2.6, 5, 0.6)).toBeLessThan(0);
    // backing up with the same lock (the car's yaw now rises): the wheels still point right
    expect(steerAngle(0.4, 2.6, -2, 0.6)).toBeLessThan(0);
    // and the same angle for the same lock at the same speed either way
    expect(steerAngle(0.4, 2.6, -2, 0.6)).toBeCloseTo(steerAngle(-0.4, 2.6, 2, 0.6));
  });
  it('stay within the lock and straight when not turning', () => {
    expect(Math.abs(steerAngle(5, 2.6, 0.01, 0.6))).toBeCloseTo(0.6);
    expect(Math.abs(steerAngle(5, 2.6, -0.01, 0.6))).toBeCloseTo(0.6);
    expect(steerAngle(0, 2.6, -3, 0.6)).toBeCloseTo(0);
  });
});

describe('brake lights', () => {
  it('show when stopped or slowing either way, not when gathering speed backwards', () => {
    expect(isBraking(0, 0)).toBe(true);
    expect(isBraking(8, -3)).toBe(true);
    expect(isBraking(8, 1)).toBe(false);
    expect(isBraking(-2, -1.5)).toBe(false); // reversing, getting quicker
    expect(isBraking(-2, 1.5)).toBe(true); // reversing, slowing
  });
});

describe('gridlock relief', () => {
  afterEach(() => { Traffic.seen = null; });
  it('waits while the player can see the car, then gives up out of sight', () => {
    expect(Traffic.reliefDue(50, 100, 0, 0)).toBe(false);
    expect(Traffic.reliefDue(120, 100, 0, 0)).toBe(true); // (headless: no view)
    Traffic.seen = () => true;
    expect(Traffic.reliefDue(120, 100, 0, 0)).toBe(false);
    expect(Traffic.reliefDue(401, 100, 0, 0)).toBe(true); // (stuck four times as long: relief anyway)
    Traffic.seen = () => false;
    expect(Traffic.reliefDue(120, 100, 0, 0)).toBe(true);
  });
});

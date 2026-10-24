/* Photo mode (Milestone 2f): the free camera stays near the Founder and
   above the ground, the lens reads as a real focal length, previews of
   another hour or weather are put back on the way out, and shots get
   sensible file names. */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Sim } from '../src/sim/agents';
import { Weather } from '../src/sim/weather';
import { LOOKS, PhotoMode, RADIUS, focalLength, surfacesFor, tether } from '../src/player/photo';

/** just enough of the stage: photo mode holds it, snaps its weather and dresses its grade */
function fakeStage(): any {
  const u = <T>(v: T) => ({ value: v });
  return {
    snaps: [] as number[][],
    hold: () => () => {},
    snapWeather(wet: number, snow: number) { this.snaps.push([wet, snow]); },
    pipe: { grade: { uniforms: { vignette: u(0.22), grain: u(0.018), lift: u(0), saturation: u(1), contrast: u(1), tint: u(new THREE.Vector3(1, 1, 1)) } }, dofPass: () => null },
    exposureBias: 1,
  };
}
function camAt(x: number, y: number, z: number): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(70, 1.6, 0.25, 4000);
  c.position.set(x, y, z);
  c.lookAt(x, y, z - 10); // looking north (-z)
  return c;
}

describe('photo mode', () => {
  it('reads the lens as a full-frame focal length', () => {
    expect(focalLength(70)).toBeCloseTo(17.1, 1);
    expect(focalLength(12)).toBeCloseTo(114.2, 1);
  });

  it('flies along the view, but never far from the Founder or into the ground', () => {
    const p = new PhotoMode(fakeStage());
    p.enter(camAt(100, 2, 100), new THREE.Vector3(100, 1, 95), () => 0);
    p.fly(1, { x: 0, y: 1 }, 0, { dx: 0, dy: 0 }, false, 0);
    expect(p.pos.z).toBeCloseTo(95, 3); // 5 m/s straight ahead (north)
    for (let i = 0; i < 100; i++) p.fly(1, { x: 0, y: 1 }, 0, { dx: 0, dy: 0 }, true, 0);
    expect(Math.hypot(p.pos.x - 100, p.pos.z - 95)).toBeCloseTo(RADIUS, 3);
    for (let i = 0; i < 10; i++) p.fly(1, { x: 0, y: 0 }, -1, { dx: 0, dy: 0 }, true, 0);
    expect(p.pos.y).toBeCloseTo(0.3, 5); // the ground is the floor
    for (let i = 0; i < 60; i++) p.fly(0.016, { x: 0, y: 0 }, 0, { dx: 0, dy: 0 }, false, 1);
    expect(p.fov).toBe(100);
    const q = new THREE.Vector3(10, 0, 0);
    tether(q, new THREE.Vector3(), 4);
    expect(q.x).toBeCloseTo(4, 5);
  });

  it('previews another hour and other weather, and puts the real ones back', () => {
    const stage = fakeStage();
    const p = new PhotoMode(stage);
    Sim.clock = 600;
    Weather.kind = 'clouds';
    Weather.intensity = 0.3;
    p.enter(camAt(0, 2, 0), new THREE.Vector3(0, 1, -5), () => 0);
    p.setHour(19.5);
    expect(Sim.clock).toBe(1170);
    p.setWeather('heavy');
    expect(Weather.kind).toBe('heavy');
    expect(stage.snaps.at(-1)).toEqual([1, 0]); // streets awash
    p.setWeather('snow');
    expect(stage.snaps.at(-1)).toEqual([0, 0.85]);
    p.setHour(null);
    expect(Sim.clock).toBe(600);
    p.setHour(7);
    p.exit();
    expect(Sim.clock).toBe(600);
    expect(Weather.kind).toBe('clouds');
    expect(Weather.intensity).toBe(0.3);
    expect(surfacesFor(null)).toBeNull();
  });

  it('dresses the shot with the chosen look on top of the weather', () => {
    const stage = fakeStage();
    const p = new PhotoMode(stage);
    p.enter(camAt(0, 2, 0), new THREE.Vector3(0, 1, -5), () => 0);
    const g = stage.pipe.grade.uniforms;
    g.saturation.value = 0.9; // a grey day
    p.look = 'noir';
    p.ev = 1;
    p.dress(new THREE.PerspectiveCamera());
    expect(g.saturation.value).toBe(0);
    expect(g.vignette.value).toBe(LOOKS.noir.vignette);
    expect(stage.exposureBias).toBe(2);
    p.exit();
    expect(g.vignette.value).toBe(LOOKS.natural.vignette);
    expect(g.lift.value).toBe(0);
  });

  it('names the file after the village, the day and the time it shows', () => {
    const p = new PhotoMode(fakeStage());
    Sim.day = 12;
    Sim.clock = 7 * 60 + 5;
    expect(p.fileName('Little Brook')).toBe('Little-Brook-day12-0705.png');
    expect(p.fileName('???')).toBe('PixelVille-day12-0705.png');
  });
});

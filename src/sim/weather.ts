// Ported from PixelVille V1 js/weather.js (see docs/DESIGN.md §3), typed against src/sim/types.ts.
// V2: only the simulation half lives here; rain, snow, leaves, lightning and
// cloud visuals are drawn by src/render/weatherfx.ts from this state.
import type { Person } from './types';
import { G_WATER, GH, GW, World } from './world';
import { MIN_PER_SEC, T, emit } from './core';
import { Sim } from './agents';
/* ============================================================
   PixelVille — seasons & weather.
   Seasons rotate every SEASON_LEN days and recolor the world.
   Weather is a seasonal-weighted state machine.
   ============================================================ */

export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
export const SEASON_EMOJI = ['🌸', '☀️', '🍂', '❄️'];
export const SEASON_LEN = 7; // days per season

export const Weather: any = {
  season: 0,
  kind: 'clear',        // clear | clouds | rain | heavy | snow
  intensity: 0, target: 0,
  nextChange: 120,      // game-minutes until the weather turns
  next: null,
  puddles: [],          // world px: {x, y, r, max, v}
  clouds: [],
  flash: 0,             // lightning
  rainbowT: 0,
  _wasRain: false,

  init() {
    this.clouds = [];
    for (let i = 0; i < 9; i++)
      this.clouds.push({
        x: Math.random() * GW * T, y: Math.random() * GH * T,
        s: 130 + Math.random() * 170, vx: 2.2 + Math.random() * 2.6, vy: 0.5,
      });
    this.puddles = [];
    this.next = null;
    this.season = this.seasonOf(Sim.day);
    this.roll();
    this.intensity = this.target;
  },

  seasonOf(day: number) { return Math.floor(((day - 1) % (SEASON_LEN * 4)) / SEASON_LEN); },
  isRaining() { return (this.kind === 'rain' || this.kind === 'heavy') && this.intensity > 0.25; },
  isSnowing() { return this.kind === 'snow' && this.intensity > 0.2; },
  label() { return `${SEASON_EMOJI[this.season]} ${SEASONS[this.season]}`; },
  weatherLabel() {
    return ({ clear: '☀️ Clear', clouds: '⛅ Cloudy', rain: '🌧️ Rain', heavy: '⛈️ Heavy rain', snow: '🌨️ Snow' } as Record<string, string>)[this.kind];
  },
  /* extra darkness added to daylight by bad weather */
  gloom() {
    if (this.kind === 'heavy') return 0.20 * this.intensity;
    if (this.kind === 'rain') return 0.11 * this.intensity;
    if (this.kind === 'snow') return 0.08 * this.intensity;
    if (this.kind === 'clouds') return 0.05;
    return 0;
  },

  roll() {
    const tables: [string, number][][] = [
      [['clear', 30], ['clouds', 28], ['rain', 30], ['heavy', 12]],   // spring
      [['clear', 56], ['clouds', 24], ['rain', 14], ['heavy', 6]],    // summer
      [['clear', 22], ['clouds', 32], ['rain', 30], ['heavy', 16]],   // autumn
      [['clear', 26], ['clouds', 30], ['snow', 44]],                  // winter
    ];
    const pick = () => {
      const table = tables[this.season];
      let sum = 0; for (const [, w] of table) sum += w;
      let r = Math.random() * sum;
      for (const [k, w] of table) { r -= w; if (r <= 0) return k; }
      return 'clear';
    };
    // the forecast is HONEST: what was promised arrives, and the next spell
    // is rolled ahead of time so the HUD can whisper what's coming
    this.kind = this.next || pick();
    this.next = pick();
    this.target = ({ clear: 0, clouds: 0.15, rain: 0.55, heavy: 1, snow: 0.75 } as Record<string, number>)[this.kind];
    this.nextChange = 100 + Math.random() * 260; // game-minutes
  },
  forecastEmoji() {
    return ({ clear: '☀️', clouds: '⛅', rain: '🌧️', heavy: '⛈️', snow: '🌨️' } as Record<string, string>)[this.next] || '';
  },

  tick(dtSim: number, dtReal: number) {
    const s = this.seasonOf(Sim.day);
    if (s !== this.season) {
      this.season = s;
      World.dirty = true;                        // recolor the whole map
      if (this.kind === 'snow' && s !== 3) this.roll();
      emit('seasonChange', { season: s });
    }
    this.nextChange -= dtSim * MIN_PER_SEC;
    if (this.nextChange <= 0) this.roll();
    if (this.season === 3 && (this.kind === 'rain' || this.kind === 'heavy')) { this.kind = 'snow'; this.target = 0.8; }

    const wasRaining = this._wasRain;
    this._wasRain = this.isRaining();
    if (wasRaining && !this._wasRain && Sim.clock > 380 && Sim.clock < 1080) this.rainbowT = 38; // sun after rain
    if (this.rainbowT > 0) this.rainbowT -= dtReal;

    this.intensity += (this.target - this.intensity) * Math.min(1, dtReal * 0.35);

    // lightning during storms
    if (this.kind === 'heavy' && this.intensity > 0.7 && Math.random() < dtReal * 0.10) this.flash = 0.55;
    this.flash = Math.max(0, this.flash - dtReal * 2.4);

    // drifting clouds (V2: they drift with game time, not the V1 UI speed)
    const cs = this.kind === 'clear' ? 0.5 : 1.5;
    for (const c of this.clouds) {
      c.x += c.vx * dtSim * cs;
      c.y += c.vy * dtSim * cs;
      if (c.x > GW * T + 220) { c.x = -220; c.y = Math.random() * GH * T; }
      if (c.y > GH * T + 220) c.y = -220;
    }

    // puddles: born in heavy rain, evaporate in dry weather
    const raining = this.isRaining();
    if (this.kind === 'heavy' && this.intensity > 0.55 && this.puddles.length < 220 && Math.random() < dtReal * 7) {
      for (let tries = 0; tries < 10; tries++) {
        const x = (Math.random() * GW) | 0, y = (Math.random() * GH) | 0;
        const i = World.idx(x, y);
        if (World.ground[i] !== G_WATER && !World.bmap[i]) {
          this.puddles.push({
            x: x * T + 2 + Math.random() * 7, y: y * T + 3 + Math.random() * 8,
            r: 0.05, max: 0.6 + Math.random() * 0.7, v: (Math.random() * 3) | 0,
          });
          break;
        }
      }
    }
    for (const p of this.puddles) {
      const goal = (this.kind === 'heavy' && this.intensity > 0.5) ? p.max : (raining ? p.r : 0);
      p.r += (goal - p.r) * Math.min(1, dtReal * (raining ? 0.5 : 0.06));
    }
    if (!raining) this.puddles = this.puddles.filter((p: Person) => p.r > 0.06);
  },
};

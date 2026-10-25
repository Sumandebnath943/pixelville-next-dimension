// @ts-nocheck — ported verbatim from PixelVille V1 js/settings.js (see docs/DESIGN.md §3);
// typing pass pending. Behaviour changes for 3D are marked "V2:".
import { Sim } from './agents';
/* ============================================================
   PixelVille — player settings.
   Persisted globally in localStorage (not per save): how fast the
   town grows, whether Christmas locks fast-forward, sound volume,
   and the autosave cadence. The village NAME lives on World and
   travels with each save instead.
   ============================================================ */

export const Settings: any = {
  data: {
    growthPace: 'cozy',   // cozy | normal | bustling
    xmasLock: 'eve',      // eve (lock only Dec 24-25) | season (whole week) | off
    volume: 0.5,          // master loudness 0..1
    autosaveMin: 2,       // minutes between autosaves; 0 = off
    // V2: 3D client settings
    quality: 'auto',      // auto | low | medium | high
    mouseSens: 1,         // look sensitivity multiplier
    invertY: false,
    fov: 70,              // street-level field of view (degrees)
    firstPerson: false,   // start in first-person instead of third
    // V2 (Milestone 7): performance, controls and accessibility (this browser's, not the village's)
    resScale: 'auto',     // auto (dynamic) | 1 | 0.85 | 0.7 | 0.55
    fpsCap: 0,            // 0 = uncapped | 30
    keys: {},             // the player's own key bindings over the defaults (src/input/input.ts)
    uiScale: 1,           // interface size
    subtitles: 'speech',  // off | speech | all (speech and sound captions)
    colorVision: 'standard', // standard | redgreen | blueyellow
    shake: true,          // camera shake
    headBob: true,        // first-person head bob
    calm: false,          // reduce motion
    tourDone: false,      // the first-day guide has been seen (or skipped)
  },

  load() {
    try {
      const raw = localStorage.getItem('pixelville-nd-settings'); // V2: own key, never clashes with V1
      if (raw) Object.assign(this.data, JSON.parse(raw));
    } catch { /* corrupted settings fall back to defaults */ }
  },
  save() {
    try { localStorage.setItem('pixelville-nd-settings', JSON.stringify(this.data)); } catch { /* private mode: settings just won't persist */ }
  },
  get(k) { return this.data[k]; },
  set(k, v) { this.data[k] = v; this.save(); },

  /* how eagerly the town grows: scales move-ins, speculative housing and
     pioneer treks. Cozy is the intended pace — lively while the village is
     small, then ever gentler as it fills out, so a town takes seasons to
     become a city instead of days. */
  growthMult() {
    const pop = Sim.people.length;
    switch (this.data.growthPace) {
      case 'bustling': return 1.4;
      case 'normal': return 1;
      default: return 0.9 * 34 / (34 + pop); // cozy
    }
  },
};

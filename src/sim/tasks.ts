// @ts-nocheck — ported from PixelVille V1 js/tasks.js (see docs/DESIGN.md §3).
// V2: data only; the journal panel lives in src/ui/journal.ts.
import { Sim } from './agents';
/* ============================================================
   PixelVille — the village Task Book (journal).
   Every project, emergency and civic effort becomes a task that
   is crossed off when it completes, and every news line is kept
   in a scrollable log — nothing disappears with a toast anymore.
   ============================================================ */

export const Tasks: any = {
  items: [],   // {id, icon, text, day, done, ok, doneDay}
  news: [],    // {day, time, text}
  open: false,
  unread: 0,
  _dirty: true,

  reset() { this.items = []; this.news = []; this.unread = 0; this._dirty = true; },

  add(id, icon, text) {
    if (id && this.items.some(t => t.id === id && !t.done)) return;
    this.items.push({
      id: id || ('t' + Math.random().toString(36).slice(2)),
      icon: icon || '📌', text,
      day: Sim.day,
      done: false, ok: true, doneDay: 0,
    });
    if (this.items.length > 120) {
      // drop the oldest finished entries first
      const doneIdx = this.items.findIndex(t => t.done);
      this.items.splice(doneIdx >= 0 ? doneIdx : 0, 1);
    }
    if (!this.open) this.unread++;
    this._dirty = true;
  },

  /* mark a task finished; ok=false crosses it off as failed (✗) */
  done(id, ok, note) {
    const t = this.items.find(t => t.id === id && !t.done);
    if (!t) return;
    t.done = true; t.ok = ok !== false;
    t.doneDay = Sim.day;
    if (note) t.text = note;
    this._dirty = true;
  },

  log(text) {
    this.news.push({ day: Sim.day, time: Sim.timeStr(), text });
    if (this.news.length > 250) this.news.shift();
    this._dirty = true;
  },

  activeCount() { return this.items.filter(t => !t.done).length; },
};

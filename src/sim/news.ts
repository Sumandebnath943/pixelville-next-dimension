/* ============================================================
   PixelVille — PVTV, the village news channel (sim side).
   Calamities and big moments cut in as BREAKING; the client's
   TV panel (src/ui/hud.ts) renders the headline, rotates the
   latest task-book stories and crawls the stock ticker.
   ============================================================ */
import { emit } from './core';

export const News = {
  breakingText: '',
  breakingAt: 0,

  breaking(text: string): void {
    this.breakingText = text;
    this.breakingAt = performance.now();
    emit('breaking', { text });
  },

  reset(): void {
    this.breakingText = '';
    this.breakingAt = 0;
  },
};

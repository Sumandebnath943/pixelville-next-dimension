/* ============================================================
   The logo (Milestone 8): "PIXELVILLE" in pixel letters that
   have grown a third dimension: every pixel a block with a
   gold face and a deep violet side, over a gold-lined "NEXT
   DIMENSION". Writes public/logo.svg (the full lockup), and
   public/icon.svg (the app icon: a pixel-block house).
   Run: node scripts/logo.mjs
   ============================================================ */
/* global console, URL */
import { writeFileSync } from 'node:fs';

const FONT = {
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  I: ['111', '010', '010', '010', '010', '010', '111'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  V: ['10001', '10001', '10001', '10001', '01010', '01010', '00100'],
};
const S = 12;           // a pixel
const D = 7;            // how deep the blocks stand (the third dimension)
const word = 'PIXELVILLE';

/** the blocks of a word, left to right: [x, y] in pixels */
function cells(text) {
  const out = [];
  let x = 0;
  for (const ch of text) {
    const g = FONT[ch];
    g.forEach((row, y) => [...row].forEach((c, i) => { if (c === '1') out.push([x + i, y]); }));
    x += g[0].length + 1;
  }
  return { cells: out, width: x - 1 };
}

/** a block: its side (down and right, violet) under its face (gold, a highlight along the top) */
function block(px, py, ox, oy) {
  const x = ox + px * S, y = oy + py * S, w = S - 0.5, r = 1.2;
  const side = `M${x + w},${y + r} L${x + w + D},${y + r + D} L${x + w + D},${y + w + D} L${x + r + D},${y + w + D} L${x + r},${y + w} Z`;
  return `<path d="${side}" fill="url(#side)"/><rect x="${x}" y="${y}" width="${w}" height="${w}" rx="${r}" fill="url(#face)"/><rect x="${x + 1}" y="${y + 1}" width="${w - 2}" height="2.2" rx="1" fill="#fffaf0" opacity="0.55"/>`;
}

const { cells: cs, width } = cells(word);
const W = width * S + D + 40, top = 18, letterH = 7 * S;
const blocks = cs.map(([px, py]) => block(px, py, 20, top)).join('');
const subY = top + letterH + D + 34;
const lockup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${subY + 18}" role="img" aria-label="PixelVille — Next Dimension">
  <defs>
    <linearGradient id="face" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff4da"/><stop offset="0.55" stop-color="#f4cf8c"/><stop offset="1" stop-color="#e2a24e"/></linearGradient>
    <linearGradient id="side" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5a2c86"/><stop offset="1" stop-color="#241036"/></linearGradient>
    <linearGradient id="rule" x1="0" x2="1"><stop offset="0" stop-color="#f0c27a" stop-opacity="0"/><stop offset="0.5" stop-color="#f0c27a"/><stop offset="1" stop-color="#f0c27a" stop-opacity="0"/></linearGradient>
    <filter id="glow" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="6" result="b"/><feColorMatrix in="b" type="matrix" values="1 0 0 0 0.35  0 1 0 0 0.2  0 0 1 0 0  0 0 0 0.45 0"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <g filter="url(#glow)">${blocks}</g>
  <rect x="${W / 2 - 250}" y="${subY - 6}" width="130" height="1.4" fill="url(#rule)"/>
  <rect x="${W / 2 + 120}" y="${subY - 6}" width="130" height="1.4" fill="url(#rule)"/>
  <text x="${W / 2}" y="${subY}" text-anchor="middle" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="17" font-weight="600" letter-spacing="9" fill="#f0c27a">NEXT DIMENSION</text>
</svg>
`;
writeFileSync(new URL('../public/logo.svg', import.meta.url), lockup);

// the app icon: a house of pixel blocks on the night-blue tile, a gold moon
const house = ['00100', '01110', '11111', '10101', '11011', '11011'];
const hb = [];
house.forEach((row, y) => [...row].forEach((c, i) => { if (c === '1') hb.push([i, y]); }));
const IS = 56, ID = 18, ox = 256 - (5 * IS) / 2 - ID / 2, oy = 150;
const iblock = ([px, py]) => {
  const x = ox + px * IS, y = oy + py * IS, w = IS - 5, r = 7;
  const side = `M${x + w},${y + r} L${x + w + ID},${y + r + ID} L${x + w + ID},${y + w + ID} L${x + r + ID},${y + w + ID} L${x + r},${y + w} Z`;
  return `<path d="${side}" fill="url(#iside)"/><rect x="${x}" y="${y}" width="${w}" height="${w}" rx="${r}" fill="url(#iface)"/>`;
};
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b2350"/><stop offset="1" stop-color="#0d1117"/></linearGradient>
    <linearGradient id="iface" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff4da"/><stop offset="1" stop-color="#e6a854"/></linearGradient>
    <linearGradient id="iside" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6a34a0"/><stop offset="1" stop-color="#2a1242"/></linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#sky)"/>
  <circle cx="392" cy="112" r="34" fill="#f0c27a" opacity="0.85"/>
  ${hb.map(iblock).join('')}
</svg>
`;
writeFileSync(new URL('../public/icon.svg', import.meta.url), icon);
console.log('logo.svg', W, 'x', subY + 18, '· icon.svg');

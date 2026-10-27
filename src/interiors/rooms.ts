/* ============================================================
   V2: rooms of their own. The twelve templates (plan.ts) gave
   every shop the same aisles of coloured boxes, so the barber's
   was a supermarket and the jeweller's a corner shop. Here each
   kind of business is laid out as what it is: the barber's
   chairs and mirrors, the florist's buckets of blooms, the
   butcher's chilled counter, the tailor's bolts of cloth and
   mannequins, the factory's own machines. Same rules as the
   templates: the counter first (its clerk takes post 0), the
   doorway at the front kept clear, staff posts, customers'
   places and the lamps.
   ============================================================ */
import type { Plan, Theme } from './plan';

const C = {
  pharma: ['#ffffff', '#e8f0f4', '#2a8a4a', '#c83a3a', '#f4d8a8', '#3a6ab0', '#f2f2f2'],
  bright: ['#d83a3a', '#2a7ac8', '#f2c42a', '#3aa04a', '#e87a2a', '#8a3ab0', '#f07ab0', '#2ab0b0'],
  tools: ['#d07a1a', '#3a3a3a', '#c8c8c8', '#2a5aa0', '#b02a2a', '#e8c02a', '#5a6a3a'],
  tech: ['#1a1c20', '#2a2c30', '#e8e8e8', '#3a5ab0', '#c8c8c8', '#1a1a1a'],
  food: ['#c8402a', '#e8c02a', '#3a9a4a', '#e8e4dc', '#8a3aa8', '#e87a2a', '#2a7ac8', '#a05a2a'],
  drinks: ['#c82a2a', '#2a8ad0', '#f2c42a', '#3ab04a', '#e8e8e8', '#5a2a1a', '#f08a2a'],
  cloth: ['#2a3a5a', '#6a2a2a', '#e8e0d0', '#3a5a3a', '#8a6a4a', '#1a1a1a', '#c8b89a', '#5a4a7a', '#a8324a'],
  blooms: ['#e83a5a', '#f2d23a', '#f0f0f0', '#e87ab0', '#8a3ad0', '#f08a2a', '#d02a2a'],
  meat: ['#a8282a', '#c84a4a', '#8a2a2a', '#d87a6a', '#e8b0a0', '#6a3a2a'],
  bread: ['#d8a050', '#c88a3a', '#e8c890', '#8a5a2a', '#b8783a'],
  gems: ['#d8b04a', '#e0e4e8', '#c83a5a', '#3a6ad8', '#3ac87a', '#f0e0a0'],
};
const pick = (p: Plan, a: string[]): string => a[Math.floor(p.rnd() * a.length)];

/** a bucket of cut flowers on the floor or a stand (at height y) */
function blooms(p: Plan, x: number, z: number, y = 0, c = pick(p, C.blooms)): void {
  p.box(x, z, 0.3, 0.3, 0.32, 'metal', '#8a9098', y);
  p.box(x, z, 0.22, 0.22, 0.3, 'fabric', '#3a6a2a', y + 0.32);
  for (let k = 0; k < 5; k++) p.box(x + (p.rnd() - 0.5) * 0.24, z + (p.rnd() - 0.5) * 0.24, 0.1, 0.1, 0.08, 'fabric', c, y + 0.58 + p.rnd() * 0.08);
}
/** a row of ceiling lamps down the room */
function lamps(p: Plan, n: number, z: number, i = 0.9, c = '#ffe8c8'): void {
  for (let k = 0; k < n; k++) p.light(p.left + (p.w / n) * (k + 0.5), z, i, c);
}
/** a long low cabinet against the back wall with things on it */
function backBar(p: Plan, len: number, body: string, top: string, things: string[], h = 0.95): void {
  p.solid(0, p.back + 0.33, len, 0.6, h, 'wood', body);
  p.box(0, p.back + 0.33, len + 0.04, 0.64, 0.04, 'stone', top, h);
  const n = Math.floor(len / 0.35);
  for (let k = 0; k < n; k++) if (p.rnd() < 0.7) p.box(-len / 2 + 0.2 + k * 0.35, p.back + 0.3, 0.12, 0.12, 0.12 + p.rnd() * 0.18, 'plastic', pick(p, things), h + 0.04);
}

/** themes for the rooms of their own (on top of the template's) */
export const ROOM_THEMES: Record<string, Partial<Theme>> = {
  barber: { wall: '#3c4b52', floor: 'tile', floorTint: '#a8a49c', accent: '#b02a2a', trim: '#e8e4dc', wainscot: '#f0ede6', wainscotH: 1.2, wainscotMat: 'ceramic', ceiling: '#d8d4cc' },
  florist: { wall: '#e4ecdc', floor: 'stone', floorTint: '#c8c0b0', accent: '#5a8a3a', trim: '#f4f2ea', wainscot: '#7a9a6a', wainscotH: 0.9 },
  bookshop: { wall: '#d8cbb4', floor: 'wood', floorTint: '#7a5232', accent: '#5a3a2a', trim: '#4a3020', ceiling: '#e6dfd2' },
  butcher: { wall: '#f2f0ea', floor: 'tile', floorTint: '#c8c2b8', accent: '#a02a2a', trim: '#ffffff', wainscot: '#f6f6f4', wainscotH: 2.1, wainscotMat: 'ceramic' },
  tailor: { wall: '#d8d0c4', floor: 'wood', floorTint: '#9a7452', accent: '#3a4a6a', trim: '#f2ece2', wainscot: '#5a4a3a', wainscotH: 1.0, wainscotMat: 'darkwood' },
  electronics: { wall: '#e2e6ea', floor: 'tile', floorTint: '#b8bcc0', accent: '#2a5aa0', trim: '#f4f6f8', ceiling: '#f0f2f4' },
  toyshop: { wall: '#f6e8b8', floor: 'wood', floorTint: '#c89a62', accent: '#d03a3a', trim: '#ffffff', wainscot: '#4a8ad0', wainscotH: 0.9 },
  jeweler: { wall: '#26262c', floor: 'carpet', floorTint: '#3a3440', accent: '#c9a64a', trim: '#8a7240', ceiling: '#1e1e22' },
  petshop: { wall: '#e2ecd8', floor: 'tile', floorTint: '#bcc4b0', accent: '#5aa04a', trim: '#ffffff', wainscot: '#8ab07a', wainscotH: 1.0 },
  hardware: { wall: '#d2ccc0', floor: 'concrete', floorTint: '#8e8a84', accent: '#e08a2a', trim: '#6a6660', ceiling: '#c8c4bc' },
  furniture: { wall: '#ece4d6', floor: 'wood', floorTint: '#a8865e', accent: '#8a6a4a', trim: '#f6f2ea' },
  fishmarket: { wall: '#e6eef2', floor: 'concrete', floorTint: '#9aa4a8', accent: '#2a6a9a', trim: '#ffffff', wainscot: '#dce8ee', wainscotH: 1.8, wainscotMat: 'ceramic' },
  gas: { wall: '#eef0f2', floor: 'tile', floorTint: '#c8ccd0', accent: '#d03a2a', trim: '#ffffff', ceiling: '#f4f4f4' },
  market: { wall: '#eef0ea', floor: 'tile', floorTint: '#d0d0c8', accent: '#3a9a4a', trim: '#ffffff' },
  shop: { wall: '#ece6d8', floor: 'tile', floorTint: '#c8c4ba', accent: '#3d6b8c', trim: '#ffffff', wainscot: '#3d6b8c', wainscotH: 0.9 },
  mall: { wall: '#e8e6e2', floor: 'stone', floorTint: '#d8d4cc', accent: '#c03a8a', trim: '#f4f4f0', ceiling: '#f0eeea' },
  deptstore: { wall: '#ebe4d8', floor: 'stone', floorTint: '#d6ccbc', accent: '#2a5a9a', trim: '#f6f2ea', ceiling: '#f2eee6' },
  pharmacy: { wall: '#eef3f0', floor: 'tile', floorTint: '#d4dcd8', accent: '#2a8a4a', trim: '#ffffff', wainscot: '#2a8a4a', wainscotH: 0.15 },
  icecream: { wall: '#fbe8ee', floor: 'tile', floorTint: '#f0e4e8', accent: '#e07a9a', trim: '#ffffff', wainscot: '#9ad8d0', wainscotH: 1.0 },
  teastall: { wall: '#e8d4a8', floor: 'concrete', floorTint: '#9a8a6a', accent: '#c0392b', trim: '#6a4a2a', wainscot: '#c0392b', wainscotH: 0.8 },
  restaurant: { wall: '#e6d6bc', floor: 'wood', floorTint: '#7a5232', accent: '#8a2a2a', trim: '#3a2418', wainscot: '#5a3a24', wainscotH: 1.1, wainscotMat: 'darkwood' },
  cafe: { wall: '#e2d2bc', floor: 'wood', floorTint: '#9a7048', accent: '#3f7a52', trim: '#3a2a20', wainscot: '#3f5a46', wainscotH: 1.0 },
  bakery: { wall: '#f3e6d0', floor: 'tile', floorTint: '#d8ccb8', accent: '#b8743a', trim: '#ffffff', wainscot: '#f6f2ea', wainscotH: 1.3, wainscotMat: 'ceramic' },
  gym: { wall: '#3a3e44', floor: 'concrete', floorTint: '#2e3034', accent: '#d03a2a', trim: '#5a5e64', ceiling: '#2a2c30' },
  arcade: { wall: '#16162a', floor: 'carpet', floorTint: '#2a2a50', accent: '#7a3aff', trim: '#3a2a6a', ceiling: '#101020' },
  casino: { wall: '#2a1a24', floor: 'carpet', floorTint: '#5a1a24', accent: '#c9a64a', trim: '#8a6a30', ceiling: '#1a1016' },
  stadium: { wall: '#c8ccd0', floor: 'concrete', floorTint: '#8a8e92', accent: '#2a5aa0', trim: '#6a6e72' },
  boatclub: { wall: '#e4dccc', floor: 'wood', floorTint: '#8a6440', accent: '#2a4a6a', trim: '#f2ece0', wainscot: '#2a4a6a', wainscotH: 1.0 },
  skyscraper: { wall: '#e0e2e4', floor: 'stone', floorTint: '#c8c4bc', accent: '#2a3a5a', trim: '#a8aab0', ceiling: '#f0f0f0' },
  college: { wall: '#e6dcc8', floor: 'wood', floorTint: '#9a7048', accent: '#2e4a6a', trim: '#f2ece0' },
  farm: { wall: '#8a5a3a', floor: 'concrete', floorTint: '#8a7a5a', accent: '#c83a2a', trim: '#5a3a24', ceiling: '#6a4a30' },
  taxistand: { wall: '#e8e4da', floor: 'tile', floorTint: '#c0bcb2', accent: '#f2c230', trim: '#2a2a2a', wainscot: '#2a2a2a', wainscotH: 0.9 },
  steelworks: { wall: '#7a7470', floor: 'concrete', floorTint: '#6a6660', accent: '#e08a2a', trim: '#4a4642', ceiling: '#5a5652' },
  sawmill: { wall: '#9a7a58', floor: 'concrete', floorTint: '#8a7a62', accent: '#d8a020', trim: '#5a4430', ceiling: '#7a6248' },
  brickworks: { wall: '#9a5a44', floor: 'concrete', floorTint: '#8a6a5a', accent: '#d8a020', trim: '#5a3a2a' },
  textilemill: { wall: '#d8d0c0', floor: 'wood', floorTint: '#8a6a4a', accent: '#a8324a', trim: '#6a5a4a' },
  cannery: { wall: '#dce0e2', floor: 'concrete', floorTint: '#9a9ea2', accent: '#2a7ac8', trim: '#ffffff', wainscot: '#ffffff', wainscotH: 1.6, wainscotMat: 'ceramic' },
  glassworks: { wall: '#8a827a', floor: 'concrete', floorTint: '#7a746c', accent: '#3ab0b0', trim: '#4a4440' },
  powerplant: { wall: '#c8ccc8', floor: 'concrete', floorTint: '#8a908a', accent: '#e0b020', trim: '#5a605a' },
  watertower: { wall: '#c8d2d8', floor: 'concrete', floorTint: '#8a949a', accent: '#2a7aa0', trim: '#5a646a' },
  factory: { wall: '#b8b4aa', floor: 'concrete', floorTint: '#8e8a84', accent: '#d8a020', trim: '#6a6a66' },
};
/** rooms taller than their template's */
export const ROOM_HEIGHT: Record<string, number> = { mall: 5.6, deptstore: 4.2, skyscraper: 5.5, college: 5, farm: 6, steelworks: 7, powerplant: 6.5, sawmill: 6, stadium: 4.4 };

/** goods and services, for the places that sold nothing (or should sell more) */
export const MORE_WARES: Record<string, [string, number, boolean?][]> = {
  autoshop: [['Oil change', 25], ['Car wash', 8], ['Set of wiper blades', 12], ['Air freshener', 3]],
  carshowroom: [['Floor mats', 30], ['Valet', 20], ['Model car', 15]],
  motoshowroom: [['Helmet', 60], ['Riding gloves', 25], ['Leather jacket', 120]],
  bank: [['Savings account (open)', 0], ['Traveller’s cheques', 50], ['Safe-deposit box (a month)', 12]],
  exchange: [['Visitor’s gallery tour', 4], ['Coffee from the trading floor', 3, true]],
  postoffice: [['Stamps', 1], ['Parcel postage', 6], ['Postcard', 1], ['Padded envelope', 2]],
  tvstation: [['Studio tour', 6], ['PVTV mug', 8], ['Audience ticket', 0]],
  hotel: [['Lobby coffee', 3, true], ['Afternoon tea', 12, true], ['Room for the night', 65], ['Spa day', 40]],
  skyscraper: [['Observation deck', 10], ['Coffee in the lobby', 3, true]],
  office: [['Coffee from the lobby kiosk', 3, true], ['Photocopying', 1]],
  school: [['School fair raffle ticket', 1], ['Bake sale cake', 2, true]],
  college: [['Evening class', 25], ['College hoodie', 30], ['Library day pass', 2]],
  hospital: [['Check-up', 20], ['Flu jab', 10], ['Get well soon flowers', 8], ['Café sandwich', 4, true]],
  police: [['Lost property claim', 0], ['Bike registration', 2]],
  fire: [['Smoke alarm', 12], ['Fire extinguisher', 30], ['Station open-day badge', 1]],
  townhall: [['Parking permit', 20], ['Marriage licence', 50], ['Village history booklet', 5]],
  courthouse: [['Copy of a judgement', 3], ['Public gallery seat', 0]],
  church: [['Candle', 1], ['Donation', 5], ['Church fete raffle', 1]],
  temple: [['Offering of flowers', 2], ['Incense', 1], ['Prasad', 0, true]],
  factory: [['Seconds from the line', 6], ['Factory tour', 3]],
  steelworks: [['Steel offcuts', 8], ['Cast-iron pan', 22]],
  sawmill: [['Bag of firewood', 6], ['Planed plank', 9], ['Sawdust (for pets)', 2]],
  brickworks: [['Pallet of bricks', 40], ['Garden edging bricks', 8]],
  textilemill: [['Bolt of cloth', 18], ['Wool blanket', 30], ['Scarf', 10]],
  cannery: [['Tinned soup', 2, true], ['Tinned peaches', 2, true], ['Case of tins', 18]],
  glassworks: [['Hand-blown vase', 25], ['Drinking glasses', 12], ['Glass bauble', 4]],
  warehouse: [['Pallet hire', 10], ['Storage for a week', 15]],
  powerplant: [['Visitor centre tour', 4], ['Energy-saving bulb', 3]],
  watertower: [['Bottle of spring water', 1, true], ['Water test kit', 6]],
  farm: [['Box of eggs', 3, true], ['Bottle of milk', 2, true], ['Bag of potatoes', 4, true], ['Jar of honey', 6, true]],
  taxistand: [['Cab to anywhere in the village', 0], ['Coffee from the cab office', 1, true]],
  airport: [['Coffee', 3, true], ['Travel pillow', 12], ['Duty-free perfume', 35], ['Paperback for the flight', 8]],
  stadium: [['Match ticket', 10], ['Pie', 4, true], ['Scarf', 12], ['Programme', 3]],
  amusement: [['Ride wristband', 15], ['Candyfloss', 2, true]],
  zoo: [['Admission', 8], ['Animal feed bag', 2]],
};

/* ---------- the rooms ---------- */
export const ROOMS: Record<string, (p: Plan, type: string) => void> = {
  barber(p) {
    p.counter(p.right - 2.0, p.front - 2.3, 1.8, '#2a2a2a', '#6a1e1e', 'Pay at the desk', { till: true });
    // the stations along the back wall: a mirror, a shelf of lotions, the chair in front of it
    const n = Math.max(2, Math.min(4, Math.floor((p.w - 2.4) / 2.3)));
    for (let k = 0; k < n; k++) {
      const x = p.left + 1.5 + k * ((p.w - 4.2) / Math.max(1, n - 1));
      p.mirror(x, p.back + 0.03, 1.1, 1.25, 1.05, 'x');
      p.solid(x, p.back + 0.25, 1.3, 0.42, 0.88, 'darkwood', '#3a2a20');
      for (let j = 0; j < 4; j++) p.box(x - 0.45 + j * 0.3, p.back + 0.22, 0.08, 0.08, 0.12 + p.rnd() * 0.1, 'plastic', ['#2a6ab0', '#c83a3a', '#e8e4dc', '#1a1a1a'][j], 0.88);
      const cz = p.back + 1.45;
      p.solid(x, cz, 0.62, 0.62, 0.1, 'chrome', '#c8ccd0');
      p.box(x, cz, 0.12, 0.12, 0.32, 'chrome', '#c8ccd0', 0.1);
      p.box(x, cz, 0.6, 0.58, 0.14, 'leather', '#7a1e1e', 0.42);
      p.box(x, cz + 0.29, 0.56, 0.1, 0.72, 'leather', '#7a1e1e', 0.56);
      for (const s of [-1, 1]) p.box(x + s * 0.31, cz, 0.08, 0.5, 0.18, 'leather', '#7a1e1e', 0.56);
      p.box(x, cz - 0.42, 0.4, 0.2, 0.04, 'chrome', '#c8ccd0', 0.18);
      p.places.push({ x, z: cz, face: 0, pose: 'sit' });
      p.posts.push({ x: x + 0.62, z: cz + 0.55, face: 0.4, pose: 'idle' });
      p.pendant(x, cz - 0.3, 2.5, '#1a1a1a', '#fff0d8', 0.45);
    }
    // the wash basin on the right wall
    p.solid(p.right - 0.4, p.back + 3.6, 0.7, 0.8, 0.85, 'ceramic', '#f2f2f0');
    p.box(p.right - 0.4, p.back + 3.6, 0.5, 0.5, 0.08, 'ceramic', '#e0e4e6', 0.85);
    p.box(p.right - 0.12, p.back + 3.6, 0.06, 0.06, 0.3, 'chrome', '#c8ccd0', 0.92);
    // waiting: a bench along the left wall, magazines, a coat stand
    p.bench(p.left + 0.45, p.front - 3.6, 2.6, -Math.PI / 2, '#3a2a20');
    p.solid(p.left + 1.3, p.front - 2.0, 0.5, 0.5, 0.45, 'darkwood', '#3a2a20');
    p.box(p.left + 1.3, p.front - 2.0, 0.34, 0.26, 0.04, 'paint', '#d8c8a8', 0.45);
    p.solid(p.left + 0.4, p.front - 1.0, 0.3, 0.3, 1.8, 'darkwood', '#2a2018');
    // the pole by the door and pictures of the cuts on offer
    for (let k = 0; k < 8; k++) p.box(p.left + 2.6, p.front - 0.3, 0.16, 0.16, 0.2, 'plastic', k % 2 ? '#ffffff' : k % 4 === 0 ? '#c82a2a' : '#2a4ac8', 1.0 + k * 0.2);
    for (let k = 0; k < 3; k++) p.picture(p.left + 0.04, p.back + 3.8 + k * 1.0, 0.7, 0.9, 1.5, 'z', ['#c8a888', '#8a9aa8', '#a8988a'][k], '#1a1a1a');
    p.picture(p.right - 0.04, p.back + 1.6, 1.4, 0.9, 1.4, 'z', '#2a2a2a', '#c8a050');
    lamps(p, 2, p.front - 2.5, 0.7, '#fff0d8');
  },

  florist(p) {
    p.counter(p.right - 2.3, p.back + 2.3, 2.6, '#c8c0b0', '#5a7a3a', 'The flower counter', { till: true });
    // the cold cabinet of roses on the back wall, the bench behind the counter where bouquets are made
    p.fridge(p.left + 2.0, p.back + 0.4, 2.8, 'x', 0, C.blooms);
    p.solid(p.right - 2.3, p.back + 0.45, 3.4, 0.7, 0.9, 'wood', '#8a6a44');
    for (let k = 0; k < 6; k++) p.box(p.right - 3.7 + k * 0.55, p.back + 0.45, 0.4, 0.3, 0.02, 'paint', ['#e8d8f0', '#f0e8c8', '#d8e8f0'][k % 3], 0.9);
    // tiered stands of buckets down the left wall and along the front window
    for (let t = 0; t < 3; t++) {
      p.solid(p.left + 0.45 + t * 0.4, 0.4, 0.4, 4.2, 0.25 + t * 0.3, 'wood', '#7a5a3a');
      for (let k = 0; k < 6; k++) blooms(p, p.left + 0.45 + t * 0.4, -1.4 + k * 0.6, 0.25 + t * 0.3);
    }
    for (let k = 0; k < 6; k++) blooms(p, -3.2 + k * 0.5 + (k > 2 ? 3.0 : 0), p.front - 0.55);
    // a table of potted plants and bouquets in the middle
    p.table(0.6, 0.6, 1.8, 1.0, '#8a6a44');
    for (let k = 0; k < 6; k++) { p.box(-0.1 + (k % 3) * 0.6, 0.35 + Math.floor(k / 3) * 0.5, 0.22, 0.22, 0.22, 'ceramic', ['#c87a5a', '#e8e4dc', '#5a7a9a'][k % 3], 0.76); p.box(-0.1 + (k % 3) * 0.6, 0.35 + Math.floor(k / 3) * 0.5, 0.3, 0.3, 0.25, 'fabric', k % 2 ? '#3a7a3a' : pick(p, C.blooms), 0.98); }
    p.bigPlant(p.right - 0.5, p.front - 0.6);
    p.bigPlant(p.left + 2.2, p.front - 0.6);
    for (let k = 0; k < 3; k++) { p.box(-2 + k * 2, p.back + 4.5, 0.02, 0.02, 0.7, 'metal', '#2a2a2a', p.h - 0.7); p.box(-2 + k * 2, p.back + 4.5, 0.45, 0.45, 0.35, 'fabric', '#4a8a3a', p.h - 1.05); }
    p.stand(1.8, p.front - 2.6, 0); p.stand(-1.4, 0.4, -Math.PI / 2);
    lamps(p, 3, 0, 0.75, '#fff4e4');
  },

  bookshop(p) {
    p.counter(p.right - 2.2, p.front - 2.4, 2.2, '#5a3a24', '#3a2418', 'Pay at the till', { till: true });
    // books on every wall, floor to ceiling
    for (let k = 0; k < Math.floor((p.w - 0.6) / 2.1); k++) p.bookcase(p.left + 1.35 + k * 2.1, p.back + 0.2, 2.0, 'x');
    for (let k = 0; k < Math.floor((p.d - 4.5) / 2.1); k++) {
      p.bookcase(p.left + 0.2, p.back + 1.6 + k * 2.1, 2.0, 'z');
      p.bookcase(p.right - 0.2, p.back + 1.6 + k * 2.1, 2.0, 'z', -1);
    }
    // tables of new books in the middle, stacked
    for (const [tx, tz] of [[-1.2, -0.6], [1.4, -0.2]]) {
      p.table(tx, tz, 1.5, 0.9, '#5a3a24');
      for (let k = 0; k < 8; k++) p.box(tx - 0.55 + (k % 4) * 0.36, tz - 0.2 + Math.floor(k / 4) * 0.4, 0.24, 0.3, 0.06 + p.rnd() * 0.18, 'fabric', pick(p, C.bright), 0.76);
      p.stand(tx, tz + 0.95, 0);
    }
    // a reading corner: armchair, lamp, rug
    p.rug(p.left + 1.8, p.front - 2.4, 2.2, 1.8, '#6a2a2a');
    p.armchair(p.left + 1.4, p.front - 2.6, -Math.PI / 2 + 0.3, '#3a5a3a');
    p.floorLamp(p.left + 0.6, p.front - 1.6);
    p.signs.push({ text: 'BOOKS', x: 0, y: p.h - 0.55, z: p.back + 0.45, w: 1.6, h: 0.4, ry: 0, bg: '#3a2418', fg: '#e8d8b0' });
    for (let k = 0; k < 2; k++) p.pendant(-1.2 + k * 2.6, -0.4, 2.4, '#2a3a2a', '#ffe0b0', 0.6);
    lamps(p, 2, p.front - 2.5, 0.6, '#ffe2b8');
  },

  butcher(p) {
    const len = Math.min(5, p.w - 3.5);
    p.counter(-0.4, p.back + 2.4, len, '#f2f2f2', '#c8c8c8', 'The meat counter', { till: true, glass: true });
    // under the glass: joints, chops, mince, sausages, pies
    for (let k = 0; k < Math.floor(len / 0.32); k++) p.box(-0.4 - len / 2 + 0.25 + k * 0.32, p.back + 2.45, 0.24, 0.3, 0.07 + p.rnd() * 0.05, 'fabric', pick(p, C.meat), 1.06);
    // behind: hooks of hanging meat, the block, the scales, the cold-room door
    p.box(0, p.back + 0.5, p.w - 2, 0.04, 0.04, 'chrome', '#c8ccd0', 2.3);
    for (let k = 0; k < 7; k++) { const x = -2.8 + k * 0.9; p.box(x, p.back + 0.5, 0.02, 0.02, 0.25, 'chrome', '#c8ccd0', 2.05); p.box(x, p.back + 0.5, 0.26, 0.2, 0.6, 'fabric', pick(p, C.meat), 1.45); }
    p.solid(p.right - 1.4, p.back + 1.0, 1.0, 0.8, 0.88, 'wood', '#a07a4a');
    p.box(p.right - 1.4, p.back + 1.0, 0.3, 0.2, 0.05, 'chrome', '#c8ccd0', 0.9);
    p.box(p.left + 1.2, p.back + 0.06, 1.2, 0.06, 2.2, 'metal', '#b8bcc0');
    p.box(p.left + 1.65, p.back + 0.1, 0.06, 0.06, 0.4, 'chrome', '#8a9098', 1.0);
    p.fridge(p.right - 0.4, 0.8, 2.4, 'z', -Math.PI / 2, ['#c84a4a', '#e8d8b0', '#d8a050', '#8a2a2a']);
    p.signs.push({ text: 'FAMILY BUTCHER', x: 0, y: p.h - 0.5, z: p.back + 0.08, w: 2.8, h: 0.42, ry: 0, bg: '#a02a2a', fg: '#ffffff' });
    p.stand(-1.4, p.back + 3.6, 0); p.stand(0.6, p.back + 3.8, 0);
    lamps(p, 3, p.back + 2.2, 0.9, '#f8f8ff');
  },

  tailor(p) {
    p.counter(p.right - 2.3, p.back + 2.6, 2.4, '#3a2a20', '#5a3a2a', 'The cutting counter', { till: true });
    // bolts of cloth on the back wall
    p.shelf(p.left + 2.4, p.back + 0.28, 4.2, 'x', C.cloth, 2.2, -1, '#4a3424');
    // the cutting table with a length of cloth and the shears; the sewing machine
    p.solid(p.right - 2.3, p.back + 1.0, 2.6, 0.9, 0.9, 'wood', '#8a6a44');
    p.box(p.right - 2.3, p.back + 1.0, 1.8, 0.7, 0.01, 'fabric', '#2a3a5a', 0.9);
    p.solid(p.left + 1.0, 0.6, 1.1, 0.6, 0.76, 'wood', '#5a3a24');
    p.box(p.left + 1.0, 0.6, 0.45, 0.2, 0.3, 'metal', '#1a1a1a', 0.76);
    p.chair(p.left + 1.0, 1.2, Math.PI, '#3a2a20', false);
    p.posts.push({ x: p.left + 1.0, z: 1.2, face: 0, pose: 'sit' });
    // mannequins in the window, a mirror and the fitting room
    p.mannequin(-2.6, p.front - 1.2, '#2a3a5a');
    p.mannequin(2.6, p.front - 1.2, '#6a2a2a', true);
    p.mannequin(p.right - 0.8, 0.4, '#3a4a3a');
    p.mirror(p.left + 0.04, p.front - 2.6, 0.8, 1.7, 0.2, 'z');
    p.solid(p.left + 0.7, -0.9, 1.3, 1.3, 0.04, 'wood', '#5a3a24');
    p.box(p.left + 1.35, -0.9, 0.04, 1.3, 2.2, 'fabric', '#6a2a2a', 0.05);
    p.box(p.left + 0.7, -0.9, 1.3, 1.3, 0.04, 'metal', '#2a2a2a', 2.25);
    p.stand(0.4, 0.6, Math.PI / 2);
    for (let k = 0; k < 2; k++) p.pendant(-1 + k * 2.4, 0.2, 2.4, '#1a1a1a', '#ffe6c0', 0.6);
  },

  electronics(p) {
    p.counter(p.right - 2.4, p.front - 2.4, 2.4, '#e8e8e8', '#2a2c30', 'Pay at the till', { till: true });
    // the wall of televisions
    const cols = Math.floor((p.w - 1.5) / 1.35);
    for (let r = 0; r < 2; r++) for (let k = 0; k < cols; k++) {
      const x = p.left + 1.0 + k * 1.35;
      p.box(x, p.back + 0.06, 1.2, 0.06, 0.72, 'plastic', '#101010', 1.0 + r * 0.85);
      p.box(x, p.back + 0.1, 1.12, 0.02, 0.64, 'screen', ['#3a7ad0', '#2aa06a', '#d06a2a', '#7a3ad0', '#d0d0d0'][(k + r * 2) % 5], 1.04 + r * 0.85);
    }
    p.solid(0, p.back + 0.3, p.w - 1.2, 0.5, 0.95, 'plastic', '#2a2c30');
    // display tables of laptops and phones, a gondola of boxed things, headphones
    for (const [tx, tz] of [[-2.0, 0.0], [1.2, 0.0]]) {
      p.solid(tx, tz, 2.0, 0.9, 0.9, 'plastic', '#f0f0f0');
      for (let k = 0; k < 4; k++) {
        p.box(tx - 0.72 + k * 0.48, tz - 0.12, 0.36, 0.24, 0.015, 'plastic', '#2a2a2a', 0.9);
        p.box(tx - 0.72 + k * 0.48, tz - 0.24, 0.36, 0.02, 0.24, 'screen', k % 2 ? '#9ac8ff' : '#c8e8ff', 0.92);
        p.box(tx - 0.72 + k * 0.48, tz + 0.25, 0.09, 0.17, 0.01, 'screen', '#bfe0ff', 0.91);
      }
      p.stand(tx, tz + 0.85, 0);
    }
    p.shelf(p.left + 0.35, p.front - 3.2, 2.6, 'z', C.tech, 1.7, -1, '#e8e8e8');
    for (let k = 0; k < 4; k++) p.box(p.right - 0.2, -1.6 + k * 0.5, 0.2, 0.2, 0.25, 'plastic', k % 2 ? '#1a1a1a' : '#e8e8e8', 1.4);
    p.signs.push({ text: 'SOUND & VISION', x: 0, y: p.h - 0.45, z: p.back + 0.08, w: 3, h: 0.4, ry: 0, bg: '#2a5aa0', fg: '#ffffff' });
    lamps(p, 3, 0, 1.0, '#f4f8ff');
  },

  toyshop(p) {
    p.counter(p.right - 2.2, p.front - 2.4, 2.0, '#f2c42a', '#d03a3a', 'Pay at the till', { till: true });
    p.shelf(0, p.back + 0.28, p.w - 1.2, 'x', C.bright, 2.0, -1, '#ffffff');
    p.shelf(-1.6, -0.2, 3.0, 'z', C.bright, 1.4);
    // the train set on its table, the rocking horse, the giant bear by the door, kites from the ceiling
    p.solid(1.6, -0.4, 2.2, 1.4, 0.75, 'wood', '#3a6a3a');
    p.box(1.6, -0.4, 1.9, 1.1, 0.02, 'paint', '#4a7a3a', 0.75);
    for (const [dx, dz, w, d] of [[0, -0.45, 1.7, 0.06], [0, 0.45, 1.7, 0.06], [-0.85, 0, 0.06, 0.96], [0.85, 0, 0.06, 0.96]]) p.box(1.6 + dx, -0.4 + dz, w, d, 0.02, 'darkwood', '#3a2a1a', 0.77);
    p.box(1.2, -0.85, 0.36, 0.14, 0.14, 'plastic', '#c82a2a', 0.79);
    p.box(1.6, -0.85, 0.3, 0.14, 0.12, 'plastic', '#2a5ac8', 0.79);
    p.stand(1.6, 0.6, 0);
    p.solid(p.left + 1.2, p.front - 2.2, 1.0, 0.36, 0.5, 'wood', '#c88a4a');
    p.box(p.left + 1.2, p.front - 2.2, 0.9, 0.3, 0.3, 'wood', '#e8e4dc', 0.5);
    p.box(p.left + 1.7, p.front - 2.2, 0.2, 0.24, 0.4, 'wood', '#e8e4dc', 0.7);
    p.solid(p.left + 0.6, p.front - 0.8, 0.8, 0.7, 0.7, 'fabric', '#8a5a2a');
    p.box(p.left + 0.6, p.front - 0.8, 0.55, 0.5, 0.5, 'fabric', '#9a6a3a', 0.7);
    for (let k = 0; k < 4; k++) p.box(-2.5 + k * 1.6, 0.6 - (k % 2) * 1.2, 0.7, 0.04, 0.7, 'fabric', pick(p, C.bright), p.h - 1.0, false, 0.6);
    lamps(p, 3, 0, 0.9, '#fff4e0');
  },

  jeweler(p) {
    p.counter(0, p.back + 2.2, Math.min(3.4, p.w - 4), '#c9a64a', '#1a1a20', 'Speak to the jeweller', { till: true, glass: true });
    for (let k = 0; k < 8; k++) p.box(-1.4 + k * 0.4, p.back + 2.25, 0.12, 0.12, 0.05, 'chrome', pick(p, C.gems), 1.06);
    // cases round the room, lit from inside; wall cabinets; a desk to sit and talk at
    p.glassCase(p.left + 0.6, 0.2, 0.8, 3.0, C.gems, '#1a1a20');
    p.glassCase(p.right - 0.6, 0.2, 0.8, 3.0, C.gems, '#1a1a20');
    p.glassCase(0, 1.2, 2.2, 0.8, C.gems, '#1a1a20');
    for (const x of [p.left + 1.6, p.right - 1.6]) {
      p.box(x, p.back + 0.12, 1.4, 0.24, 1.2, 'darkwood', '#1a1a20', 1.0);
      p.box(x, p.back + 0.25, 1.3, 0.02, 1.1, 'glow', '#fff0d0', 1.05);
      for (let k = 0; k < 6; k++) p.box(x - 0.5 + (k % 3) * 0.5, p.back + 0.2, 0.08, 0.08, 0.08, 'chrome', pick(p, C.gems), 1.2 + Math.floor(k / 3) * 0.45);
    }
    p.table(p.left + 1.8, p.front - 2.3, 1.2, 0.8, '#2a2024');
    p.chair(p.left + 1.8, p.front - 1.65, 0, '#5a1a24');
    p.stand(0, 2.3, 0); p.stand(p.right - 1.4, 2.0, -Math.PI / 2);
    for (let k = 0; k < 4; k++) p.light(-2.4 + k * 1.6, 0.4, 0.55, '#fff2d8');
    p.picture(p.left + 0.04, p.back + 1.6, 1.0, 1.2, 1.3, 'z', '#5a4a3a', '#c9a64a');
  },

  petshop(p) {
    p.counter(p.right - 2.3, p.front - 2.4, 2.2, '#e8e4dc', '#4a7a3a', 'Pay at the till', { till: true });
    // tanks of fish down the left wall, lit blue
    for (let r = 0; r < 2; r++) for (let k = 0; k < 3; k++) {
      const z = p.back + 1.2 + k * 1.3, y = 0.7 + r * 0.75;
      if (r === 0) p.solid(p.left + 0.45, z, 0.7, 1.2, 0.7, 'metal', '#2a2c30');
      p.box(p.left + 0.45, z, 0.6, 1.1, 0.6, 'glow', '#3a90c8', y);
      for (let f = 0; f < 4; f++) p.box(p.left + 0.45 + (p.rnd() - 0.5) * 0.3, z + (p.rnd() - 0.5) * 0.8, 0.04, 0.1, 0.05, 'plastic', pick(p, ['#f08a2a', '#f2d23a', '#e83a5a', '#3ad0f0']), y + 0.15 + p.rnd() * 0.3);
      p.box(p.left + 0.45, z, 0.62, 1.12, 0.62, 'glass', '#d8f0ff', y);
    }
    // cages of rabbits and birds on the right wall, sacks of food, a gondola of toys and treats
    for (let k = 0; k < 3; k++) {
      const z = p.back + 1.0 + k * 1.2;
      p.solid(p.right - 0.45, z, 0.7, 1.0, 0.8, 'wood', '#8a6a44');
      p.box(p.right - 0.45, z, 0.3, 0.25, 0.22, 'fabric', k === 1 ? '#f2f2ee' : '#8a6a4a', 0.82);
      for (let b = 0; b < 6; b++) p.box(p.right - 0.8, z - 0.45 + b * 0.18, 0.02, 0.02, 0.6, 'chrome', '#c8ccd0', 0.8);
      p.box(p.right - 0.45, z, 0.7, 1.0, 0.03, 'chrome', '#c8ccd0', 1.4);
    }
    for (let k = 0; k < 5; k++) p.solid(-2 + (k % 3) * 0.7, p.back + 0.4 + Math.floor(k / 3) * 0.6, 0.6, 0.45, 0.5 + (k % 2) * 0.1, 'fabric', ['#c8a050', '#4a7a3a', '#c83a3a'][k % 3]);
    p.shelf(0.2, 0.4, 3.0, 'z', C.bright, 1.5);
    p.solid(-1.6, p.front - 2.0, 1.0, 0.8, 0.2, 'fabric', '#8a3a3a');
    p.stand(-0.7, 0.4, Math.PI / 2); p.stand(p.left + 1.2, p.back + 2.4, Math.PI / 2);
    lamps(p, 3, 0, 0.9, '#fff8ea');
  },

  hardware(p) {
    p.counter(p.right - 2.4, p.front - 2.4, 2.4, '#8a8a8a', '#3a3a3a', 'Trade counter', { till: true });
    p.box(p.right - 1.4, p.front - 2.4, 0.4, 0.3, 0.3, 'metal', '#5a6068', 1.05); // the key-cutting machine
    // a pegboard of tools on the back wall
    p.box(0, p.back + 0.05, p.w - 2, 0.04, 1.6, 'wood', '#a8865e', 0.6);
    for (let k = 0; k < 24; k++) p.box(-p.w / 2 + 1.3 + (k % 12) * ((p.w - 2.6) / 11), p.back + 0.1, 0.12, 0.06, 0.3 + p.rnd() * 0.2, 'metal', pick(p, C.tools), 0.8 + Math.floor(k / 12) * 0.7);
    // racking of paint, screws and hardware; a rack of timber and a ladder
    p.shelf(-1.8, 0.0, 3.6, 'z', C.tools, 2.2);
    p.shelf(1.0, 0.0, 3.6, 'z', ['#e8e4dc', '#c83a3a', '#2a5aa0', '#f2c42a', '#3a9a4a'], 2.2);
    p.solid(p.left + 0.4, 0.2, 0.6, 3.4, 0.08, 'metal', '#3a3a3a');
    for (let k = 0; k < 8; k++) p.box(p.left + 0.25 + (k % 4) * 0.1, 0.2, 0.08, 3.3, 0.08, 'wood', '#c8a878', 0.3 + Math.floor(k / 4) * 0.5);
    p.box(p.right - 0.4, p.back + 1.4, 0.5, 0.06, 2.4, 'metal', '#c8ccd0', 0);
    p.stand(-0.4, 0.2, Math.PI / 2); p.stand(2.0, -0.6, -Math.PI / 2);
    lamps(p, 3, 0, 1.1, '#f4f8ff');
  },

  furniture(p) {
    p.counter(p.right - 2.2, p.front - 2.3, 2.0, '#d8ccb8', '#6a4a30', 'The sales desk', { till: true });
    // a sitting room, a bedroom, a dining room, set out as if lived in
    p.rug(p.left + 2.6, p.back + 2.0, 3.2, 2.2, '#8a5a4a');
    p.sofa(p.left + 2.6, p.back + 2.8, 2.4, Math.PI, '#5a6a7a');
    p.solid(p.left + 2.6, p.back + 1.9, 1.0, 0.55, 0.42, 'wood', '#6a4a30');
    p.floorLamp(p.left + 0.6, p.back + 0.6);
    p.armchair(p.left + 1.0, p.back + 1.7, -Math.PI / 2, '#7a5a4a');
    // the bed, with its headboard on the back wall
    const bx = p.right - 2.0;
    p.solid(bx, p.back + 1.25, 1.6, 2.1, 0.45, 'wood', '#8a6a44');
    p.box(bx, p.back + 1.3, 1.5, 2.0, 0.18, 'fabric', '#f2eee6', 0.45);
    p.box(bx, p.back + 1.7, 1.5, 1.2, 0.06, 'fabric', '#5a7a8a', 0.6);
    p.box(bx, p.back + 0.12, 1.7, 0.1, 1.1, 'fabric', '#4a5a6a', 0.0);
    for (const s of [-1, 1]) { p.box(bx + s * 0.4, p.back + 0.45, 0.5, 0.3, 0.12, 'fabric', '#ffffff', 0.62); p.solid(bx + s * 1.15, p.back + 0.35, 0.5, 0.45, 0.55, 'wood', '#6a4a30'); p.box(bx + s * 1.15, p.back + 0.35, 0.22, 0.22, 0.3, 'glow', '#ffd8a0', 0.55); }
    // the dining table and its chairs
    p.table(-0.2, 0.9, 1.6, 0.9, '#8a6040');
    for (const dx of [-0.45, 0.45]) { p.chair(-0.2 + dx, 0.15, Math.PI, '#6a4a30'); p.chair(-0.2 + dx, 1.65, 0, '#6a4a30'); }
    p.solid(p.right - 0.4, 0.9, 0.6, 1.6, 2.1, 'wood', '#5a3a24');
    p.stand(1.2, 0.0, -Math.PI / 2);
    for (let k = 0; k < 3; k++) p.pendant(-2.6 + k * 2.6, 0.2, 2.5, '#d8c8a8', '#ffe2b8', 0.55);
  },

  fishmarket(p) {
    const len = Math.min(5, p.w - 3);
    p.counter(0, p.back + 2.6, len, '#f0f4f6', '#8a9aa8', 'The fish counter', { till: true });
    // the slab of crushed ice and the day's catch, the lobster tank, crates of ice, the board of prices
    p.box(0, p.back + 2.6, len - 0.2, 0.5, 0.08, 'stone', '#f4f8fa', 1.04);
    for (let k = 0; k < Math.floor(len / 0.35); k++) p.box(-len / 2 + 0.3 + k * 0.35, p.back + 2.6, 0.12, 0.4, 0.06, 'chrome', pick(p, ['#a8b4c0', '#c8d0d8', '#e8a090', '#5a6a7a']), 1.12);
    p.solid(p.left + 0.5, 0.0, 0.8, 2.0, 0.75, 'metal', '#2a2c30');
    p.box(p.left + 0.5, 0.0, 0.7, 1.9, 0.6, 'glow', '#3a80b0', 0.75);
    p.box(p.left + 0.5, 0.0, 0.72, 1.92, 0.62, 'glass', '#d8f0ff', 0.75);
    for (let k = 0; k < 4; k++) p.crate(1.0 + (k % 2) * 0.8, 0.0 + Math.floor(k / 2) * 0.7, 0.7, 0.6, '#e8eef2', 0.5);
    p.box(0, p.back + 0.06, 2.4, 0.04, 1.2, 'paint', '#1e2a24', 1.2);
    p.solid(0, p.back + 0.5, p.w - 2, 0.7, 0.9, 'metal', '#c8ccd0');
    p.stand(-1.2, p.back + 3.9, 0); p.stand(1.0, p.back + 4.0, 0);
    lamps(p, 3, p.back + 2.4, 1.0, '#f4f8ff');
  },

  gas(p) {
    p.counter(p.right - 2.4, p.front - 2.6, 2.6, '#d8d8d8', '#d03a2a', 'Pay at the till', { till: true });
    // behind the till: lottery, sweets and the cigarette cabinet
    p.shelf(p.right - 2.4, p.front - 3.6, 2.4, 'x', C.bright, 1.6, -1, '#2a2a2a');
    // drinks fridges along the back, two gondolas of snacks, the coffee machine
    p.fridge(-0.8, p.back + 0.4, p.w - 3.5, 'x', 0, C.drinks);
    p.shelf(-1.8, -0.4, 2.8, 'z', C.food, 1.5);
    p.shelf(0.6, -0.4, 2.8, 'z', C.food, 1.5);
    p.solid(p.left + 0.4, p.front - 2.6, 0.7, 1.6, 0.92, 'plastic', '#3a3a3a');
    p.box(p.left + 0.4, p.front - 2.9, 0.4, 0.4, 0.55, 'metal', '#1a1a1a', 0.92);
    p.box(p.left + 0.6, p.front - 2.9, 0.02, 0.2, 0.14, 'screen', '#7ad0ff', 1.2);
    p.solid(p.left + 1.0, p.front - 0.6, 0.6, 0.4, 1.0, 'metal', '#c8ccd0');
    for (let k = 0; k < 4; k++) p.box(p.left + 1.0, p.front - 0.58, 0.5, 0.06, 0.02, 'paint', '#e8e4dc', 0.4 + k * 0.18);
    p.stand(-0.6, -0.4, Math.PI / 2); p.stand(p.left + 1.2, p.front - 2.6, Math.PI / 2);
    lamps(p, 3, -0.5, 1.1, '#f4f8ff');
  },

  shop(p) {
    p.counter(p.right - 2.4, p.front - 2.4, 2.4, '#d8d2c6', '#3d6b8c', 'Pay at the counter', { till: true });
    p.shelf(p.right - 2.4, p.front - 3.4, 2.2, 'x', C.bright, 1.4, -1);
    const rows = Math.max(2, Math.floor((p.w - 4) / 2.2));
    for (let r = 0; r < rows; r++) {
      const x = p.left + 1.4 + r * 2.2;
      if (x > p.right - 4.5) break;
      p.shelf(x, p.back + 3.2, 3.6, 'z', C.food, 1.6);
      p.stand(x + 0.95, p.back + 3 + p.rnd() * 1.2, -Math.PI / 2);
    }
    p.fridge(0, p.back + 0.4, p.w - 1.6, 'x', 0, C.drinks);
    // the newspapers and magazines by the door
    p.solid(p.left + 0.6, p.front - 1.2, 0.5, 1.2, 0.9, 'wood', '#6a4a30');
    for (let k = 0; k < 4; k++) p.box(p.left + 0.6, p.front - 1.65 + k * 0.3, 0.4, 0.25, 0.04, 'paint', ['#e8e4dc', '#c82a2a', '#2a5aa0', '#f2c42a'][k], 0.9);
    lamps(p, 3, 0, 1.0, '#f8f4ec');
  },

  market(p) {
    // checkouts by the door
    const lanes = Math.max(2, Math.min(3, Math.floor((p.w - 6) / 2.4)));
    for (let k = 0; k < lanes; k++) {
      const x = 1.6 + k * 2.4;
      p.counter(x, p.front - 3.0, 1.8, '#2a2a2a', '#3a9a4a', 'Pay at the checkout', { till: true });
      p.box(x + 0.2, p.front - 3.0, 1.0, 0.4, 0.02, 'plastic', '#1a1a1a', 1.03);
    }
    p.machine('atm', p.left + 0.6, p.front - 0.5, 'Use the cash machine', -1);
    // fruit and vegetables, aisles, the chillers along the back
    for (let k = 0; k < 6; k++) p.crate(p.left + 0.9 + (k % 2) * 1.0, p.front - 5.2 + Math.floor(k / 2) * 0.9, 0.9, 0.8, ['#d83a2a', '#3aa04a', '#f2c42a', '#e87a2a', '#8a3a7a', '#c8d84a'][k]);
    const aisles = Math.max(2, Math.floor((p.w - 5) / 2.2));
    for (let a = 0; a < aisles; a++) { p.shelf(p.left + 3.4 + a * 2.2, p.back + 3.2, 4.0, 'z', C.food, 1.8); p.stand(p.left + 4.4 + a * 2.2, p.back + 3.0, -Math.PI / 2); }
    p.fridge(0, p.back + 0.4, p.w - 1.4, 'x', 0, ['#e8e8e8', '#f2e8c8', '#c8402a', '#2a7ac8', '#e8d8b0']);
    p.signs.push({ text: 'FRESH FOOD', x: p.left + 1.5, y: 2.6, z: p.front - 4.6, w: 2.0, h: 0.4, ry: 0, bg: '#3a9a4a', fg: '#ffffff' });
    lamps(p, 4, -1, 1.0, '#f8f8f4'); lamps(p, 4, p.front - 3, 0.8, '#f8f8f4');
  },

  mall(p) {
    p.counter(p.right - 4.4, p.front - 2.2, 2.2, '#e8e4dc', '#c03a8a', 'Customer services', { till: true });
    // shop units down both sides: a glass front, a sign, something in the window
    const units = Math.max(2, Math.floor((p.d - 4) / 3.4));
    const signs = ['FASHION', 'SHOES', 'GIFTS', 'PHONES', 'SPORTS', 'BEAUTY'];
    for (const side of [-1, 1]) for (let k = 0; k < units; k++) {
      const z = p.back + 1.9 + k * 3.4, x = side * (p.w / 2 - 1.6);
      p.solid(x, z, 3.0, 3.2, 0.02, 'stone', '#e0dcd4');
      p.box(x - side * 1.5, z, 0.08, 3.0, 2.8, 'glass', '#cfe2ec', 0);
      p.box(x - side * 1.5, z, 0.1, 3.2, 0.5, 'paint', '#2a2a2a', 2.8);
      p.signs.push({ text: signs[(k * 2 + (side > 0 ? 1 : 0)) % signs.length], x: x - side * 1.56, y: 3.05, z, w: 1.8, h: 0.36, ry: side * -Math.PI / 2, bg: '#2a2a2a', fg: '#ffffff' });
      for (const dz of [-1, 0.9]) p.box(x + side * 1.4, z + dz, 0.04, 1.2, 0.04, 'chrome', '#c8ccd0', 1.5);
      p.rail(x, z, 2.2, 'z', C.cloth);
      p.box(x, z, 2.8, 3.0, 0.04, 'glow', '#fff6e8', 3.25);
    }
    // the upper floor's balcony and the escalator up to it
    p.box(0, p.back + 1.2, p.w - 6.6, 2.4, 0.3, 'stone', '#e8e4dc', 3.4);
    p.box(0, p.back + 2.42, p.w - 6.6, 0.05, 1.0, 'glass', '#cfe2ec', 3.7);
    for (let k = 0; k < 8; k++) p.solid(-0.6, p.back + 2.6 + k * 0.42, 1.0, 0.42, 0.42 * (8 - k), 'metal', '#8a9098');
    // the fountain in the middle, benches, plants
    const fz = p.back + p.d * 0.5;
    p.solid(0.8, fz, 2.4, 2.4, 0.45, 'stone', '#d8d0c0');
    p.box(0.8, fz, 2.1, 2.1, 0.05, 'water', '#4a9ac0', 0.35);
    p.box(0.8, fz, 0.2, 0.2, 1.2, 'stone', '#d8d0c0', 0.45);
    p.bench(-2.2, fz, 1.8, -Math.PI / 2, '#5a4a3a'); p.bench(3.6, fz, 1.8, Math.PI / 2, '#5a4a3a');
    p.bigPlant(-2.4, p.front - 1.0); p.bigPlant(2.6, p.front - 1.0);
    p.machine('atm', p.left + 0.6, p.front - 0.5, 'Use the cash machine', -1);
    p.stand(-1.2, 0.0, 0); p.stand(2.2, -0.6, Math.PI);
    for (let k = 0; k < 3; k++) p.light(-3 + k * 3, 0.5, 1.2, '#fff4e4');
  },

  deptstore(p) {
    p.counter(0.6, 0.6, 2.4, '#e8e4dc', '#2a5a9a', 'Pay at the till', { till: true });
    // cosmetics by the door: counters with mirrors
    for (const x of [-3.2, 3.6]) { p.glassCase(x, p.front - 2.6, 1.8, 0.7, ['#e83a6a', '#f2d8c8', '#c8a888', '#2a2a2a', '#e8e4dc'], '#f2eee6', 0.08, 'plastic'); p.mirror(x, p.front - 2.95, 0.6, 0.5, 1.2, 'x'); }
    // fashion: rails and mannequins on the left
    for (let k = 0; k < 3; k++) p.rail(p.left + 1.6, p.back + 1.4 + k * 1.6, 2.2, 'x', C.cloth);
    p.mannequin(p.left + 3.4, p.back + 1.4, '#a8324a', true); p.mannequin(p.left + 3.4, p.back + 3.0, '#2a3a5a');
    // home: shelves of china and linen at the back right; a wall of shoes
    p.shelf(p.right - 2.4, p.back + 0.3, 3.6, 'x', ['#f2f2ee', '#c8d8e8', '#e8d8c8', '#5a7a9a', '#c87a5a'], 1.9, -1, '#d8ccb8');
    p.shelf(p.right - 0.3, 0.2, 3.2, 'z', ['#2a2a2a', '#6a4a30', '#c8a888', '#e8e4dc', '#a8324a'], 1.9, 1, '#d8ccb8');
    p.solid(p.right - 2.4, p.back + 2.4, 1.6, 0.9, 0.75, 'wood', '#8a6a44');
    for (let k = 0; k < 6; k++) p.box(p.right - 3 + (k % 3) * 0.6, p.back + 2.2 + Math.floor(k / 3) * 0.4, 0.3, 0.3, 0.12, 'ceramic', '#f2f2ee', 0.75);
    p.signs.push({ text: 'FASHION', x: p.left + 2.2, y: 3.4, z: p.back + 0.08, w: 1.6, h: 0.36, ry: 0, bg: '#2a5a9a', fg: '#ffffff' });
    p.signs.push({ text: 'HOME', x: p.right - 2.4, y: 3.4, z: p.back + 0.08, w: 1.2, h: 0.36, ry: 0, bg: '#2a5a9a', fg: '#ffffff' });
    p.stand(-1.6, 0.2, 0); p.stand(2.6, 1.6, Math.PI / 2); p.stand(-3.2, p.front - 1.9, 0);
    for (let k = 0; k < 3; k++) for (const z of [-p.d / 4, p.d / 4]) p.light(-p.w / 3 + k * p.w / 3, z, 0.9, '#fff6ea');
  },

  pharmacy(p) {
    p.counter(0, p.back + 2.0, Math.min(3.6, p.w - 4), '#ffffff', '#2a8a4a', 'The pharmacy counter', { till: true });
    // the dispensary behind the counter: drawers and shelves of medicines
    p.shelf(0, p.back + 0.28, p.w - 2.4, 'x', C.pharma, 2.1, -1, '#ffffff');
    // aisles of toiletries and remedies, the consultation room door, the blood pressure chair
    p.shelf(p.left + 1.4, 1.0, 3.0, 'z', C.pharma, 1.5);
    p.shelf(p.left + 3.4, 1.0, 3.0, 'z', ['#f2d8e8', '#e8f0f4', '#3a6ab0', '#f2c42a', '#ffffff'], 1.5);
    p.box(p.right - 0.06, 0.4, 0.06, 1.0, 2.1, 'paint', '#d8e4de');
    p.signs.push({ text: 'CONSULTATION', x: p.right - 0.1, y: 2.3, z: 0.4, w: 1.2, h: 0.22, ry: -Math.PI / 2, bg: '#2a8a4a', fg: '#ffffff' });
    p.chair(p.right - 0.8, p.front - 2.4, Math.PI / 2, '#2a8a4a');
    p.box(p.right - 0.3, p.front - 2.4, 0.3, 0.3, 0.35, 'plastic', '#e8e8e8', 0.9);
    p.box(0, p.back + 0.12, 0.6, 0.12, 0.6, 'glow', '#3ac86a', 2.45);
    p.stand(p.left + 2.4, 0.4, Math.PI / 2); p.stand(-0.4, p.back + 3.2, 0);
    lamps(p, 3, 0, 1.0, '#f4fbff');
  },

  icecream(p) {
    const len = Math.min(4, p.w - 4);
    p.counter(0, p.back + 2.0, len, '#ffffff', '#f08ab0', 'Order at the counter', { till: true });
    // the freezer of tubs under the glass
    p.box(0, p.back + 2.05, len - 0.2, 0.5, 0.12, 'metal', '#c8ccd0', 1.0);
    for (let k = 0; k < Math.floor(len / 0.32); k++) p.box(-len / 2 + 0.3 + k * 0.32, p.back + 2.05, 0.26, 0.4, 0.06, 'plastic', pick(p, ['#f8f0e0', '#8a4a2a', '#f08ab0', '#a8e0a0', '#f2d23a', '#c83a5a']), 1.05);
    p.box(0, p.back + 2.25, len - 0.2, 0.06, 0.35, 'glass', '#e8f4f8', 1.05);
    backBar(p, p.w - 1.6, '#ffffff', '#f6e0ea', ['#f08ab0', '#8a4a2a', '#f2d23a', '#ffffff']);
    for (let k = 0; k < 3; k++) {
      const x = -2.6 + k * 2.6, z = 1.4 + (k % 2) * 1.0;
      p.table(x, z, 0.7, 0.7, '#ffffff');
      p.chair(x - 0.55, z, -Math.PI / 2, '#9ad8d0'); p.chair(x + 0.55, z, Math.PI / 2, '#f0a8c0');
    }
    p.spots.push({ kind: 'seat', x: -2.6 - 0.55, z: 1.4, yaw: -Math.PI / 2, label: 'Sit down' });
    p.signs.push({ text: 'GELATO', x: 0, y: p.h - 0.6, z: p.back + 0.08, w: 1.8, h: 0.5, ry: 0, bg: '#f08ab0', fg: '#ffffff' });
    p.posts.push({ x: p.right - 2.8, z: p.back + 1.0, face: Math.PI, pose: 'idle' });
    lamps(p, 3, 0.6, 0.9, '#fff4f0');
  },

  teastall(p) {
    p.counter(0, p.back + 1.8, Math.min(3.2, p.w - 4), '#c8a878', '#6a4a2a', 'Order at the stall', { till: true });
    // the big kettle on its burner, the jars of snacks, glasses on a tray
    p.box(-0.8, p.back + 1.85, 0.4, 0.4, 0.45, 'chrome', '#c8ccd0', 1.05);
    p.box(-0.8, p.back + 1.85, 0.3, 0.3, 0.04, 'glow', '#4a8aff', 1.02);
    for (let k = 0; k < 4; k++) { p.box(0.1 + k * 0.32, p.back + 1.85, 0.22, 0.22, 0.3, 'glass', '#f2e8d0', 1.05); p.box(0.1 + k * 0.32, p.back + 1.85, 0.18, 0.18, 0.15, 'fabric', ['#d8a050', '#c8782a', '#e8c890', '#a0522d'][k], 1.06); }
    backBar(p, p.w - 2, '#6a4a2a', '#8a6a44', ['#f2e8d0', '#c0392b', '#f4d03f']);
    // low benches and tables, the string of bulbs
    for (let k = 0; k < 3; k++) { p.bench(-2.8 + k * 2.8, 1.6, 1.6, 0, '#8a5a2a'); p.solid(-2.8 + k * 2.8, 0.8, 1.0, 0.5, 0.45, 'wood', '#6a4a2a'); }
    for (let k = 0; k < 10; k++) p.box(-4 + k * 0.9, 0, 0.08, 0.08, 0.08, 'glow', ['#ffd060', '#ff8a4a', '#ffffff'][k % 3], p.h - 0.4 - Math.sin((k / 9) * Math.PI) * 0.3);
    p.picture(p.left + 0.04, -0.6, 1.0, 0.7, 1.6, 'z', '#c0392b', '#6a4a2a');
    lamps(p, 2, 0.6, 0.6, '#ffd8a0');
  },

  gym(p) {
    p.counter(p.right - 2.4, p.front - 2.4, 2.4, '#e8e8e8', '#2a2a2a', 'The front desk', { till: true });
    // treadmills facing the mirror on the back wall
    p.mirror(0, p.back + 0.03, p.w - 2, 1.8, 0.3, 'x');
    for (let k = 0; k < Math.floor((p.w - 2) / 1.3); k++) {
      const x = p.left + 1.4 + k * 1.3;
      p.solid(x, p.back + 1.4, 0.75, 1.8, 0.2, 'plastic', '#2a2a2a');
      p.box(x, p.back + 1.4, 0.55, 1.5, 0.02, 'fabric', '#1a1a1a', 0.2);
      for (const s of [-1, 1]) p.box(x + s * 0.34, p.back + 0.65, 0.05, 0.05, 1.1, 'metal', '#8a9098', 0.2);
      p.box(x, p.back + 0.6, 0.7, 0.25, 0.2, 'plastic', '#2a2a2a', 1.25);
      p.box(x, p.back + 0.5, 0.4, 0.02, 0.14, 'screen', '#5ac8ff', 1.32);
      p.places.push({ x, z: p.back + 1.6, face: 0, pose: 'idle' });
    }
    // the weights: a rack of dumbbells, benches, mats
    p.solid(p.left + 0.45, 0.8, 0.6, 2.6, 0.75, 'metal', '#3a3a3a');
    for (let k = 0; k < 10; k++) p.box(p.left + 0.45, -0.35 + k * 0.25, 0.4, 0.14, 0.14, 'metal', '#1a1a1a', 0.75 - (k % 2) * 0.35);
    for (let k = 0; k < 2; k++) { p.solid(-0.6 + k * 2.4, 0.9, 0.45, 1.3, 0.45, 'leather', '#1a1a1a'); p.box(-0.6 + k * 2.4, 0.4, 1.6, 0.04, 0.04, 'chrome', '#c8ccd0', 1.1); }
    p.rug(1.8, p.front - 3.2, 2.4, 1.6, '#2a5aa0');
    p.picture(p.left + 0.04, p.front - 3.0, 1.6, 1.0, 1.5, 'z', '#d03a2a', '#1a1a1a');
    lamps(p, 3, 0, 1.1, '#f4f8ff');
  },

  arcade(p) {
    p.counter(p.right - 2.4, p.front - 2.4, 2.4, '#2a2a3a', '#7a3aff', 'Tokens and prizes', { till: true });
    p.shelf(p.right - 2.4, p.front - 3.4, 2.2, 'x', C.bright, 1.4, -1, '#2a2a3a');
    for (let k = 0; k < Math.floor((p.w - 2) / 1.2); k++) {
      const x = p.left + 1.0 + k * 1.2, c = ['#7a3aff', '#ff3a7a', '#3affd0', '#ffd03a'][k % 4];
      p.solid(x, p.back + 0.5, 0.8, 0.8, 1.8, 'plastic', '#1a1a2a');
      p.box(x, p.back + 0.92, 0.62, 0.02, 0.48, 'screen', ['#c8f0ff', '#ffc8e8', '#c8ffd8'][k % 3], 1.1);
      p.box(x, p.back + 0.5, 0.82, 0.82, 0.1, 'glow', c, 1.8);
      p.places.push({ x, z: p.back + 1.4, face: 0, pose: 'idle' });
    }
    // air hockey, the claw machine, glowing floor strips
    p.solid(-1.0, 0.8, 1.2, 2.0, 0.8, 'plastic', '#1a1a2a');
    p.box(-1.0, 0.8, 1.1, 1.9, 0.01, 'glow', '#3ac8ff', 0.8);
    p.solid(p.left + 0.6, p.front - 2.2, 0.9, 0.9, 1.9, 'glass', '#c8e8ff');
    p.box(p.left + 0.6, p.front - 2.2, 0.8, 0.8, 0.4, 'fabric', '#f07ab0', 0.4);
    p.box(p.left + 0.6, p.front - 2.2, 0.9, 0.9, 0.1, 'glow', '#ff3a7a', 1.9);
    for (const x of [-p.w / 4, p.w / 4]) p.box(x, 0, 0.06, p.d - 2, 0.01, 'glow', '#7a3aff', 0.005);
    p.stand(-1.0, 2.1, 0);
    lamps(p, 3, 0, 0.45, '#c8b8ff');
  },

  casino(p) {
    p.counter(p.right - 2.6, p.front - 2.4, 2.8, '#c9a64a', '#3a1a24', 'The bar', { till: true });
    for (let k = 0; k < 3; k++) p.stool(p.right - 3.6 + k * 0.7, p.front - 1.6, '#5a1a24', 0);
    for (let k = 0; k < Math.floor((p.w - 2) / 1.0); k++) {
      const x = p.left + 0.9 + k * 1.0;
      p.solid(x, p.back + 0.45, 0.7, 0.7, 1.6, 'metal', '#c9a64a');
      p.box(x, p.back + 0.81, 0.5, 0.02, 0.4, 'screen', '#ffe08a', 1.0);
      p.box(x, p.back + 0.45, 0.72, 0.72, 0.08, 'glow', k % 2 ? '#ff3a3a' : '#ffd03a', 1.6);
      p.stool(x, p.back + 1.25, '#5a1a24', 0);
    }
    // the roulette wheel and a card table
    p.solid(-1.2, 0.4, 2.4, 1.3, 0.78, 'fabric', '#1a5a2a');
    p.box(-1.9, 0.4, 0.7, 0.7, 0.08, 'darkwood', '#3a2010', 0.78);
    p.box(-1.9, 0.4, 0.5, 0.5, 0.02, 'chrome', '#c9a64a', 0.86);
    p.posts.push({ x: -1.2, z: -0.45, face: Math.PI, pose: 'idle' });
    for (const dx of [-0.8, 0, 0.8]) p.chair(-1.2 + dx, 1.35, 0, '#5a1a24');
    p.solid(2.0, 0.6, 1.8, 1.0, 0.78, 'fabric', '#1a5a2a');
    p.chair(2.0, 1.4, 0, '#5a1a24');
    for (let k = 0; k < 3; k++) p.pendant(-2.4 + k * 2.6, 0.4, 2.6, '#c9a64a', '#fff0c8', 0.55);
  },

  stadium(p) {
    p.counter(0, p.back + 2.0, Math.min(4, p.w - 4), '#e8e8e8', '#2a5aa0', 'Food and drink kiosk', { till: true });
    backBar(p, p.w - 2, '#2a5aa0', '#c8ccd0', C.drinks);
    // the turnstiles by the door, the club shop's rail, the posters of the team
    for (let k = 0; k < 3; k++) p.solid(-1.6 + k * 1.6, p.front - 2.6, 0.3, 0.8, 1.0, 'metal', '#8a9098');
    p.rail(p.left + 1.4, 0.6, 2.4, 'z', ['#2a5aa0', '#ffffff', '#2a5aa0', '#c83a3a']);
    p.rail(p.right - 1.4, 0.6, 2.4, 'z', ['#2a5aa0', '#ffffff', '#c83a3a']);
    for (let k = 0; k < 3; k++) p.picture(-3 + k * 3, p.back + 0.04, 1.4, 0.9, 2.5, 'x', ['#2a5aa0', '#c83a3a', '#3a9a4a'][k], '#1a1a1a');
    p.stand(-0.6, p.back + 3.2, 0); p.stand(0.8, p.back + 3.4, 0);
    lamps(p, 3, 0, 1.0, '#f4f8ff');
  },

  boatclub(p) {
    p.counter(p.right - 2.6, p.front - 2.4, 2.8, '#c8a878', '#2a4a6a', 'The bar', { till: true });
    p.shelf(p.right - 2.6, p.front - 3.4, 2.4, 'x', C.drinks, 1.4, -1, '#5a3a24');
    for (let k = 0; k < 3; k++) p.stool(p.right - 3.6 + k * 0.7, p.front - 1.6, '#2a4a6a', 0);
    // canoes racked on the back wall, oars crossed, the trophy cabinet, a lounge
    for (let k = 0; k < 3; k++) {
      p.box(-1, p.back + 0.3, 5.0, 0.4, 0.3, 'wood', ['#c84a2a', '#e8c02a', '#2a7ac8'][k], 0.7 + k * 0.6);
      for (const dx of [-2, 0, 2]) p.box(-1 + dx, p.back + 0.15, 0.06, 0.3, 0.06, 'metal', '#3a3a3a', 0.66 + k * 0.6);
    }
    for (const r of [0.6, -0.6]) p.box(p.left + 0.05, 0.4, 0.04, 0.12, 2.2, 'wood', '#c8a878', 0.8, false, r);
    p.glassCase(p.left + 0.6, p.front - 2.6, 0.8, 1.6, ['#d8b04a', '#e0e4e8'], '#3a2418', 0.18, 'chrome');
    p.sofa(-0.8, 1.6, 2.2, 0, '#2a4a6a');
    p.solid(-0.8, 0.6, 1.0, 0.6, 0.42, 'wood', '#5a3a24');
    p.armchair(-2.6, 0.6, -Math.PI / 2, '#8a5a3a');
    for (let k = 0; k < 2; k++) p.picture(p.left + 0.04, -1.6 + k * 1.6, 1.0, 0.7, 1.5, 'z', ['#4a7aa0', '#7a9ab0'][k], '#5a3a24');
    lamps(p, 3, 0, 0.8, '#ffe8c8');
  },

  skyscraper(p) {
    p.counter(p.right - 3.0, 0.4, 3.0, '#2a2a2a', '#5a5e64', 'Security desk', { till: true });
    p.box(p.right - 2.4, 0.38, 0.4, 0.04, 0.26, 'screen', '#7ad0ff', 1.2);
    // the lifts on the back wall: steel doors, lit floor numbers
    for (let k = 0; k < 3; k++) {
      const x = -3 + k * 2.4;
      p.box(x, p.back + 0.06, 1.3, 0.06, 2.4, 'chrome', '#b8bcc0');
      p.box(x, p.back + 0.08, 0.02, 0.02, 2.4, 'metal', '#3a3a3a');
      p.box(x, p.back + 0.08, 0.6, 0.03, 0.18, 'screen', '#ff8a3a', 2.6);
      p.box(x + 0.85, p.back + 0.08, 0.1, 0.03, 0.2, 'glow', '#ffffff', 1.1);
    }
    for (let k = 0; k < 4; k++) p.stand(-3.6 + k * 1.8, p.back + 1.5, 0);
    // a waiting area, tall plants, a screen of the day's news
    p.sofa(-2.4, p.front - 2.6, 2.4, Math.PI, '#3a3a3a');
    p.solid(-2.4, p.front - 3.5, 1.0, 0.6, 0.4, 'stone', '#2a2a2a');
    p.bigPlant(p.left + 0.6, p.back + 0.6); p.bigPlant(p.right - 0.6, p.back + 0.6);
    p.box(p.left + 0.06, 0.2, 0.06, 2.4, 1.4, 'screen', '#2a4a6a', 1.4);
    p.signs.push({ text: 'LIFTS', x: -0.6, y: 3.6, z: p.back + 0.1, w: 1.2, h: 0.3, ry: 0, bg: '#2a2a2a', fg: '#ffffff' });
    for (let k = 0; k < 3; k++) for (const z of [-p.d / 4, p.d / 4]) p.light(-p.w / 3 + k * p.w / 3, z, 0.9, '#f8f6f0');
  },

  college(p) {
    p.counter(p.right - 2.4, p.front - 2.2, 2.2, '#e8dcc8', '#2e4a6a', 'Student services', { till: true });
    // a lecture theatre: the screen, the lectern, rows of benches rising to the back
    p.box(0, p.back + 0.06, p.w - 4, 0.05, 2.0, 'screen', '#e8eef4', 1.3);
    p.solid(2.4, p.back + 1.2, 0.7, 0.6, 1.1, 'darkwood', '#4a2a1a');
    p.posts.push({ x: 2.4, z: p.back + 0.6, face: Math.PI, pose: 'idle' });
    const rows = Math.max(3, Math.floor((p.d - 6) / 1.1));
    for (let r = 0; r < rows; r++) {
      const z = p.back + 3.0 + r * 1.1, y = r * 0.18;
      p.solid(-0.8, z, p.w - 5, 1.1, y + 0.02, 'wood', '#8a6a44');
      p.box(-0.8, z - 0.25, p.w - 5.2, 0.35, 0.04, 'wood', '#c8a878', y + 0.72);
      for (let k = 0; k < Math.floor((p.w - 5.4) / 0.8); k++) p.places.push({ x: -0.8 - (p.w - 5.4) / 2 + 0.4 + k * 0.8, z: z + 0.2, face: 0, pose: 'sit' });
    }
    for (let k = 0; k < 3; k++) p.light(-3 + k * 3, 0, 1.1, '#f4f6ff');
  },

  farm(p) {
    p.counter(p.right - 2.4, p.front - 2.2, 2.4, '#a07a4a', '#6a4a2a', 'The farm shop', { till: true });
    for (let k = 0; k < 6; k++) p.box(p.right - 3.4 + k * 0.4, p.front - 2.2, 0.3, 0.3, 0.12, 'fabric', ['#f2e8d0', '#e8d8b0', '#c8a050'][k % 3], 1.05);
    // the barn: bales stacked high, the tractor, sacks of feed, tools on the wall
    for (let k = 0; k < 9; k++) p.solid(p.left + 1.0 + (k % 3) * 1.2, p.back + 0.8 + Math.floor(k / 3) * 0.0, 1.1, 0.7, 0.55, 'fabric', '#d8b860', Math.floor(k / 3) * 0.55);
    const tx = 1.4, tz = p.back + 2.4;
    p.solid(tx, tz, 1.8, 3.0, 0.9, 'metal', '#c83a2a', 0.7);
    p.box(tx, tz - 0.6, 1.4, 1.2, 0.9, 'glass', '#1a2028', 1.6);
    for (const [sx, sz, r] of [[-1, 1.0, 0.75], [1, 1.0, 0.75], [-1, -1.0, 0.45], [1, -1.0, 0.45]]) p.box(tx + sx * 0.95, tz + sz, 0.4, r * 2, r * 2, 'plastic', '#1a1a1a', 0);
    for (let k = 0; k < 5; k++) p.solid(p.left + 0.6 + k * 0.6, p.front - 3.4, 0.55, 0.4, 0.6, 'fabric', '#c8b89a');
    p.box(p.left + 0.05, 0.2, 0.04, 3.0, 1.4, 'wood', '#6a4a30', 0.8);
    for (let k = 0; k < 5; k++) p.box(p.left + 0.1, -1.0 + k * 0.6, 0.06, 0.08, 1.2, 'metal', '#5a5a5a', 0.9);
    p.posts.push({ x: tx + 1.4, z: tz, face: -Math.PI / 2, pose: 'idle' }, { x: p.left + 2.2, z: p.back + 1.8, face: 0, pose: 'idle' });
    lamps(p, 2, 0, 1.0, '#ffe2b0');
  },

  taxistand(p) {
    p.counter(0, p.back + 2.0, 2.6, '#2a2a2a', '#f2c230', 'Book a cab', { till: true });
    // the dispatcher's radio and the map of the village, the drivers' bench, a coffee machine
    p.box(0.6, p.back + 1.9, 0.4, 0.3, 0.2, 'metal', '#1a1a1a', 1.05);
    p.box(0.6, p.back + 1.78, 0.25, 0.02, 0.1, 'screen', '#7affa0', 1.12);
    p.picture(0, p.back + 0.04, 2.4, 1.4, 1.2, 'x', '#c8d8b8', '#2a2a2a');
    p.bench(p.left + 0.5, 0.4, 2.6, -Math.PI / 2, '#2a2a2a');
    p.solid(p.right - 0.5, p.front - 2.4, 0.6, 0.6, 1.6, 'metal', '#3a3a3a');
    p.box(p.right - 0.8, p.front - 2.4, 0.02, 0.3, 0.2, 'screen', '#ffd27a', 1.1);
    p.signs.push({ text: 'TAXI', x: 0, y: p.h - 0.5, z: p.back + 0.08, w: 1.2, h: 0.4, ry: 0, bg: '#f2c230', fg: '#1a1a1a' });
    lamps(p, 2, 0, 0.8, '#fff4e4');
  },
};

/* the works: each its own machines (and a counter where it sells what it makes) */
function works(p: Plan, body: (p: Plan) => void, sale: string): void {
  p.counter(p.right - 2.4, p.front - 2.2, 2.2, '#c8c8c8', '#3a3e44', sale, { till: true });
  body(p);
  for (let x = -p.w / 3; x <= p.w / 3 + 0.01; x += p.w / 3) p.light(x, 0, 1.3, '#f2f6ff');
}
const furnace = (p: Plan, x: number, z: number, w: number, glow: string): void => {
  p.solid(x, z, w, 1.8, 3.0, 'brick', '#5a4a44');
  p.box(x, z + 0.91, w * 0.5, 0.02, 0.9, 'glow', glow, 0.6);
  p.light(x, z + 1.6, 1.4, glow, 1.2);
  p.box(x, z, 0.6, 0.6, p.h - 3.0, 'metal', '#3a3a3a', 3.0);
};
Object.assign(ROOMS, {
  steelworks: (p: Plan) => works(p, (q) => {
    furnace(q, -2.0, q.back + 1.2, 3.0, '#ff7a1a');
    q.solid(1.6, q.back + 1.6, 1.4, 1.4, 1.2, 'metal', '#3a3a3a');
    q.box(1.6, q.back + 1.6, 1.1, 1.1, 0.05, 'glow', '#ffb030', 1.2);
    for (let k = 0; k < 6; k++) q.solid(-1.0 + (k % 3) * 0.9, 1.4 + Math.floor(k / 3) * 0.4, 0.3, 3.0, 0.3, 'metal', '#5a5e64', Math.floor(k / 3) * 0.3);
    q.box(0, q.back + 2.6, q.w - 2, 0.2, 0.3, 'metal', '#d8a020', q.h - 1.0);
    q.posts.push({ x: -2.0, z: q.back + 2.8, face: 0, pose: 'idle' }, { x: 1.6, z: q.back + 2.8, face: 0, pose: 'idle' });
  }, 'Steel sales'),
  sawmill: (p: Plan) => works(p, (q) => {
    q.solid(-1.0, q.back + 2.0, 1.2, 4.0, 0.8, 'metal', '#5a5e64');
    q.box(-1.0, q.back + 2.0, 0.04, 1.4, 1.4, 'chrome', '#c8ccd0', 0.2);
    for (let k = 0; k < 3; k++) q.box(-1.0, q.back + 0.6 + k * 1.2, 0.5, 0.9, 0.5, 'wood', '#8a6a44', 0.8);
    for (let k = 0; k < 9; k++) q.solid(q.left + 1.0 + (k % 3) * 0.55, q.back + 2.0, 0.5, 3.2, 0.5, 'wood', '#a0784a', Math.floor(k / 3) * 0.5);
    for (let k = 0; k < 6; k++) q.solid(2.0, 0.6 + k * 0.0, 2.4, 1.2, 0.08, 'wood', '#d8b080', k * 0.1);
    q.posts.push({ x: 0.0, z: q.back + 2.0, face: Math.PI / 2, pose: 'idle' }, { x: 2.0, z: 1.6, face: 0, pose: 'idle' });
  }, 'Timber yard'),
  brickworks: (p: Plan) => works(p, (q) => {
    furnace(q, -1.6, q.back + 1.2, 4.0, '#ff8a3a');
    for (let k = 0; k < 6; k++) { const x = 1.2 + (k % 3) * 1.1, z = 0.6 + Math.floor(k / 3) * 1.4; q.solid(x, z, 1.0, 1.0, 0.12, 'wood', '#8a6a44'); q.box(x, z, 0.9, 0.9, 0.7, 'brick', '#a85a44', 0.12); }
    q.solid(-1.0, 1.6, 3.6, 0.6, 0.8, 'metal', '#3a3a3a');
    q.posts.push({ x: -1.6, z: q.back + 2.8, face: 0, pose: 'idle' }, { x: -1.0, z: 2.3, face: 0, pose: 'idle' });
  }, 'Brick sales'),
  textilemill: (p: Plan) => works(p, (q) => {
    for (let k = 0; k < Math.floor((q.w - 3) / 2.0); k++) {
      const x = q.left + 1.6 + k * 2.0;
      q.solid(x, q.back + 2.0, 1.4, 1.8, 0.2, 'metal', '#3a3a3a');
      for (const s of [-1, 1]) q.box(x + s * 0.65, q.back + 2.0, 0.08, 1.8, 1.4, 'wood', '#6a4a30', 0.2);
      q.box(x, q.back + 2.0, 1.2, 1.6, 0.04, 'fabric', pick(q, C.cloth), 0.9);
      for (let t = 0; t < 10; t++) q.box(x - 0.55 + t * 0.12, q.back + 1.2, 0.02, 0.02, 0.6, 'fabric', '#e8e0d0', 0.9);
      q.posts.push({ x, z: q.back + 3.2, face: 0, pose: 'idle' });
    }
    q.shelf(q.left + 2.0, q.front - 3.4, 3.2, 'x', C.cloth, 1.8);
  }, 'Mill shop'),
  cannery: (p: Plan) => works(p, (q) => {
    q.solid(0, q.back + 2.2, q.w - 3, 0.8, 0.9, 'metal', '#8a9098');
    q.box(0, q.back + 2.2, q.w - 3.2, 0.6, 0.02, 'plastic', '#2a2a2a', 0.9);
    for (let k = 0; k < Math.floor((q.w - 3.5) / 0.35); k++) q.box(-(q.w - 3.5) / 2 + k * 0.35, q.back + 2.2, 0.14, 0.14, 0.2, 'chrome', '#c8ccd0', 0.92);
    for (const x of [-2.6, 2.6]) { q.solid(x, q.back + 0.7, 1.4, 1.4, 2.6, 'metal', '#b8bcc0'); q.box(x, q.back + 0.7, 0.3, 0.3, 0.6, 'metal', '#5a5e64', 2.6); }
    for (let k = 0; k < 6; k++) q.solid(-2 + (k % 3) * 1.0, 1.4 + Math.floor(k / 3) * 0.9, 0.8, 0.8, 0.7, 'wood', '#a07a4a');
    q.posts.push({ x: -1.4, z: q.back + 3.0, face: 0, pose: 'idle' }, { x: 1.4, z: q.back + 3.0, face: 0, pose: 'idle' });
  }, 'Factory shop'),
  glassworks: (p: Plan) => works(p, (q) => {
    furnace(q, 0, q.back + 1.0, 2.4, '#ffa040');
    for (const x of [-2.6, 2.6]) { q.solid(x, q.back + 2.6, 1.6, 0.7, 0.85, 'wood', '#6a4a30'); q.box(x, q.back + 2.6, 1.2, 0.04, 0.04, 'metal', '#3a3a3a', 0.9); q.posts.push({ x, z: q.back + 3.2, face: 0, pose: 'idle' }); }
    q.shelf(q.left + 0.35, 0.6, 3.0, 'z', ['#3ab0b0', '#e8f4f8', '#3a7ac8', '#f2c42a', '#3ac87a'], 1.8, -1, '#4a3a2a');
  }, 'Gallery shop'),
  powerplant: (p: Plan) => works(p, (q) => {
    for (const x of [-2.4, 1.6]) {
      q.solid(x, q.back + 2.0, 2.4, 3.2, 1.6, 'metal', '#e0b020');
      q.box(x, q.back + 2.0, 1.4, 2.4, 0.8, 'metal', '#8a9098', 1.6);
      q.box(x + 1.25, q.back + 2.0, 0.1, 1.2, 1.2, 'metal', '#3a3a3a', 0.4);
    }
    q.solid(q.left + 0.5, q.front - 3.0, 0.8, 3.0, 1.2, 'metal', '#3a3e44');
    for (let k = 0; k < 5; k++) q.box(q.left + 0.92, q.front - 4.2 + k * 0.6, 0.02, 0.4, 0.3, 'screen', ['#7affa0', '#ffd27a', '#7ad0ff'][k % 3], 1.3);
    q.posts.push({ x: q.left + 1.3, z: q.front - 3.0, face: -Math.PI / 2, pose: 'sit' }, { x: -0.4, z: q.back + 2.0, face: Math.PI / 2, pose: 'idle' });
  }, 'Visitor centre'),
  watertower: (p: Plan) => works(p, (q) => {
    for (const x of [-2.2, 0, 2.2]) { q.solid(x, q.back + 1.4, 1.2, 1.2, 1.1, 'metal', '#2a7aa0'); q.box(x, q.back + 0.6, 0.3, 0.6, 0.3, 'metal', '#5a646a', 0.6); q.box(x, q.back + 0.3, 0.4, 0.4, q.h - 1.2, 'metal', '#8a949a', 1.0); }
    q.box(0, q.back + 0.4, q.w - 2, 0.3, 0.3, 'metal', '#8a949a', 2.4);
    q.solid(q.left + 0.6, 1.2, 0.8, 1.6, 1.2, 'metal', '#3a3e44');
    q.box(q.left + 1.02, 1.2, 0.02, 1.0, 0.4, 'screen', '#7ad0ff', 1.3);
    q.posts.push({ x: q.left + 1.4, z: 1.2, face: -Math.PI / 2, pose: 'idle' });
  }, 'Water board counter'),
  factory: (p: Plan) => works(p, (q) => {
    q.solid(0, q.back + 2.0, q.w - 3, 0.8, 0.9, 'metal', '#3a3c40');
    for (let k = 0; k < Math.floor((q.w - 3.5) / 0.6); k++) q.box(-(q.w - 3.5) / 2 + k * 0.6, q.back + 2.0, 0.4, 0.4, 0.3, 'wood', '#a07a4a', 0.9);
    for (const x of [-2.6, 0, 2.6]) { q.solid(x, q.back + 0.7, 1.6, 1.2, 1.7, 'metal', '#5a7a6a'); q.box(x, q.back + 1.31, 0.6, 0.02, 0.4, 'screen', '#7affa0', 1.0); q.posts.push({ x, z: q.back + 2.9, face: 0, pose: 'idle' }); }
    for (let k = 0; k < 4; k++) q.solid(q.left + 1.0 + k * 1.0, q.front - 3.4, 0.9, 0.9, 0.8, 'wood', '#8a6a3a');
  }, 'Factory shop'),
});

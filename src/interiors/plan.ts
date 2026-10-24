/* ============================================================
   Interiors (design §8): twelve room templates, re-themed per
   building type, laid out from the building's own seed so the
   bakery is the same bakery every visit. A layout is plain data:
   furniture as boxes, what you can't walk through, where staff
   stand, where customers sit, the counters and machines you can
   use, and the lights. src/render/interior.ts turns it into a
   scene; src/player/indoors.ts walks you round it.
   Room coordinates: x across, z from the back wall (−D/2) to the
   front wall with the door (+D/2), y up from the floor.
   ============================================================ */
import { mulberry32 } from '../sim/core';

export type Template = 'home' | 'shop' | 'food' | 'office' | 'workshop' | 'classroom' | 'hospital' | 'police' | 'fire' | 'terminal' | 'venue' | 'civic';

/** which room each building type opens into (types not listed are outdoor, or not a building) */
export const INTERIOR: Record<string, Template> = {
  house: 'home', house2: 'home', house3: 'home', cottage: 'home', apartment: 'home', rowhouse: 'home', mansion: 'home', lodge: 'home',
  shop: 'shop', market: 'shop', mall: 'shop', deptstore: 'shop', barber: 'shop', florist: 'shop', bookshop: 'shop', butcher: 'shop', tailor: 'shop',
  electronics: 'shop', toyshop: 'shop', jeweler: 'shop', petshop: 'shop', hardware: 'shop', furniture: 'shop', carshowroom: 'shop', motoshowroom: 'shop',
  fishmarket: 'shop', gas: 'shop',
  restaurant: 'food', cafe: 'food', bakery: 'food', icecream: 'food', pizzeria: 'food', burgerpalace: 'food', goldenarches: 'food', crispycluck: 'food',
  tacobelle: 'food', pizzapalace: 'food', teastall: 'food',
  office: 'office', skyscraper: 'office', bank: 'office', exchange: 'office', postoffice: 'office', tvstation: 'office', hotel: 'office',
  factory: 'workshop', steelworks: 'workshop', sawmill: 'workshop', brickworks: 'workshop', textilemill: 'workshop', cannery: 'workshop',
  glassworks: 'workshop', warehouse: 'workshop', powerplant: 'workshop', autoshop: 'workshop', laundry: 'workshop', watertower: 'workshop',
  school: 'classroom', college: 'classroom', library: 'classroom',
  hospital: 'hospital', pharmacy: 'hospital',
  police: 'police',
  fire: 'fire',
  trainstation: 'terminal', airport: 'terminal', dock: 'terminal', heliport: 'terminal',
  cinema: 'venue', theater: 'venue', museum: 'venue', casino: 'venue', arcade: 'venue', gym: 'venue', pool: 'venue', stadium: 'venue', boatclub: 'venue',
  townhall: 'civic', courthouse: 'civic', church: 'civic', temple: 'civic',
};

/** surfaces the renderer knows */
export type Mat = 'wood' | 'darkwood' | 'paint' | 'fabric' | 'leather' | 'metal' | 'chrome' | 'plastic' | 'stone' | 'ceramic' | 'glass' | 'screen' | 'glow' | 'water' | 'brick';
export interface Box { x: number; y: number; z: number; w: number; h: number; d: number; m: Mat; c: string; ry?: number }
export type SpotKind = 'exit' | 'counter' | 'seat' | 'atm' | 'tickets' | 'desk' | 'service';
export interface Spot { kind: SpotKind; x: number; z: number; yaw: number; label: string; post?: number }
/** where someone stands or sits: `face` is the direction they look (radians, 0 = toward the back wall) */
export interface Place { x: number; z: number; face: number; pose: 'idle' | 'sit' }
export interface Light { x: number; y: number; z: number; i: number; c: string }
export interface Rect { x0: number; z0: number; x1: number; z1: number }
export interface Theme { wall: string; floor: 'wood' | 'tile' | 'stone' | 'carpet' | 'concrete'; floorTint: string; accent: string; trim: string }
export interface Sign { text: string; x: number; y: number; z: number; w: number; h: number; ry: number; bg: string; fg: string }
export interface Layout {
  template: Template;
  w: number; d: number; h: number;
  theme: Theme;
  boxes: Box[];
  solids: Rect[];
  spots: Spot[];
  /** staff positions (the first is the counter) */
  posts: Place[];
  /** customers, visitors, family */
  places: Place[];
  lights: Light[];
  signs: Sign[];
  /** windows in the side walls (the front always has two beside the door) */
  sideWindows: boolean;
}

const THEMES: Record<Template, Theme> = {
  home: { wall: '#e9e1d2', floor: 'wood', floorTint: '#c8a27a', accent: '#6a7f5a', trim: '#f4f0e6' },
  shop: { wall: '#f1efe9', floor: 'tile', floorTint: '#d9d6cf', accent: '#3d6b8c', trim: '#ffffff' },
  food: { wall: '#efe2cc', floor: 'wood', floorTint: '#a8784e', accent: '#9a3a2a', trim: '#3a2a20' },
  office: { wall: '#e6e8ea', floor: 'carpet', floorTint: '#5a6470', accent: '#2f4f6f', trim: '#f2f2f2' },
  workshop: { wall: '#b8b4aa', floor: 'concrete', floorTint: '#9c9890', accent: '#d8a020', trim: '#6a6a66' },
  classroom: { wall: '#efe7d4', floor: 'wood', floorTint: '#b98d5e', accent: '#2e5a3a', trim: '#f6f2e8' },
  hospital: { wall: '#eef3f2', floor: 'tile', floorTint: '#dfe8e6', accent: '#3a8a8a', trim: '#ffffff' },
  police: { wall: '#d8dde2', floor: 'tile', floorTint: '#b8bec4', accent: '#1e3a6a', trim: '#e8ecf0' },
  fire: { wall: '#c9c4ba', floor: 'concrete', floorTint: '#8e8a84', accent: '#b22222', trim: '#e0dcd4' },
  terminal: { wall: '#e4e2dc', floor: 'stone', floorTint: '#cfcac0', accent: '#2a5aa0', trim: '#f4f4f0' },
  venue: { wall: '#3a2e3a', floor: 'carpet', floorTint: '#6a2a34', accent: '#c9a24a', trim: '#2a2028' },
  civic: { wall: '#ece4d4', floor: 'stone', floorTint: '#c9bfae', accent: '#7a2a2a', trim: '#f2ede2' },
};
/** per-type touches on top of the template's theme */
const TINTS: Record<string, Partial<Theme>> = {
  bakery: { wall: '#f3e6d0', accent: '#b8743a' }, cafe: { wall: '#e8dcc8', accent: '#5a3a28' }, icecream: { wall: '#fbe8ee', accent: '#e07a9a', floor: 'tile', floorTint: '#f4f0ea' },
  burgerpalace: { wall: '#f4e4c8', accent: '#d03a2a', floor: 'tile', floorTint: '#e8e2d8' }, goldenarches: { wall: '#f6e8c0', accent: '#d8a018', floor: 'tile', floorTint: '#e8e2d8' },
  crispycluck: { wall: '#f2dcc8', accent: '#c8401a', floor: 'tile', floorTint: '#e8e2d8' }, tacobelle: { wall: '#f0dcc0', accent: '#6a3a8a' },
  pizzeria: { wall: '#efe0c8', accent: '#3a7a3a' }, pizzapalace: { wall: '#efe0c8', accent: '#b02a2a' }, teastall: { wall: '#e8d8b8', accent: '#8a5a2a' },
  pharmacy: { accent: '#2a8a4a' }, bank: { floor: 'stone', floorTint: '#d8d0c0', accent: '#8a6a2a', wall: '#ece6da' }, exchange: { accent: '#1a6a3a' },
  tvstation: { wall: '#2e3440', accent: '#c03030' }, hotel: { floor: 'stone', floorTint: '#d2c6b4', accent: '#7a5a2a', wall: '#efe6d6' },
  jeweler: { wall: '#2a2a30', accent: '#c9a64a', floor: 'carpet', floorTint: '#3a3a44' }, florist: { wall: '#eef2e6', accent: '#5a8a3a', floor: 'wood' },
  butcher: { wall: '#f4f4f2', accent: '#a02a2a' }, bookshop: { wall: '#e6dccb', floor: 'wood', floorTint: '#8a6040', accent: '#5a3a2a' },
  carshowroom: { floor: 'stone', floorTint: '#e4e4e4' }, motoshowroom: { floor: 'concrete', floorTint: '#7a7a7a', wall: '#3a3c40' },
  church: { wall: '#e8e0d0', accent: '#6a2a3a' }, temple: { wall: '#f0dcb8', accent: '#c8701a', floor: 'carpet', floorTint: '#8a2a2a' },
  courthouse: { wall: '#e4dccb', accent: '#3a2a1e' }, casino: { wall: '#2a1a24', accent: '#c9a64a', floorTint: '#5a1a24' },
  arcade: { wall: '#1a1a2e', accent: '#7a3aff', floorTint: '#2a2a4a' }, gym: { wall: '#e0e0e0', floor: 'concrete', floorTint: '#4a4a4e', accent: '#d03a2a' },
  pool: { wall: '#e8f2f4', floor: 'tile', floorTint: '#d8e8ec', accent: '#2a7aa0' }, museum: { wall: '#f2f0ea', floor: 'wood', floorTint: '#b08a62', accent: '#3a3a3a' },
  library: { wall: '#e8dcc6', accent: '#5a3a28' }, lodge: { wall: '#d8c8a8', floorTint: '#8a6440', accent: '#4a6a3a' }, mansion: { wall: '#ece4d4', floorTint: '#7a5236', accent: '#6a2a3a' },
  laundry: { wall: '#eef0f2', floor: 'tile', floorTint: '#d8dce0', accent: '#2a6aa0' }, autoshop: { accent: '#d03a1a' }, powerplant: { accent: '#e0b020' },
};

/** goods and services over the counter, by building type: name, price ($), and whether it's eaten or drunk */
export interface Ware { name: string; price: number; food?: boolean }
const W = (name: string, price: number, food = false): Ware => ({ name, price, food });
export const WARES: Record<string, Ware[]> = {
  bakery: [W('Croissant', 3, true), W('Cinnamon bun', 3, true), W('Sourdough loaf', 5, true), W('Apple turnover', 4, true), W('Coffee', 2, true)],
  cafe: [W('Flat white', 3, true), W('Pot of tea', 2, true), W('Slice of cake', 4, true), W('Toasted sandwich', 6, true)],
  restaurant: [W('Soup of the day', 6, true), W('Roast dinner', 14, true), W('Pasta', 11, true), W('Sticky toffee pudding', 6, true)],
  pizzeria: [W('Slice of margherita', 3, true), W('Whole pizza', 10, true), W('Garlic bread', 4, true), W('Lemonade', 2, true)],
  pizzapalace: [W('Palace pepperoni', 11, true), W('Slice', 3, true), W('Dough balls', 4, true), W('Cola', 2, true)],
  icecream: [W('Two scoops', 3, true), W('Sundae', 6, true), W('Milkshake', 4, true)],
  burgerpalace: [W('King burger', 7, true), W('Fries', 3, true), W('Shake', 3, true)],
  goldenarches: [W('Big Ronny', 6, true), W('Fries', 2, true), W('Nuggets', 4, true), W('Cola', 2, true)],
  crispycluck: [W('Bucket of chicken', 12, true), W('Wings', 6, true), W('Coleslaw', 2, true)],
  tacobelle: [W('Taco trio', 7, true), W('Burrito', 8, true), W('Nachos', 5, true)],
  teastall: [W('Masala chai', 1, true), W('Samosa', 2, true), W('Lemon tea', 1, true)],
  shop: [W('Newspaper', 1), W('Chocolate bar', 1, true), W('Bottle of water', 1, true), W('Milk', 2, true)],
  gas: [W('Coffee to go', 2, true), W('Sandwich', 4, true), W('Road map', 3), W('Screen wash', 4)],
  market: [W('Bag of groceries', 14), W('Fruit basket', 6, true), W('Fresh bread', 3, true), W('Flowers', 5)],
  mall: [W('Jacket', 45), W('Trainers', 40), W('Sunglasses', 18), W('Gift card', 20)],
  deptstore: [W('Wool scarf', 15), W('Leather gloves', 22), W('Perfume', 35), W('Teapot', 18)],
  pharmacy: [W('Plasters', 3), W('Cough syrup', 6), W('Sun cream', 7), W('Vitamins', 9)],
  barber: [W('Haircut', 12), W('Beard trim', 6), W('Hot towel shave', 10)],
  florist: [W('Bunch of tulips', 8), W('Rose', 3), W('Potted fern', 12)],
  bookshop: [W('Paperback novel', 8), W('Map of the village', 4), W('Cookbook', 15)],
  butcher: [W('Sausages', 6), W('Pork pie', 4, true), W('Lamb chops', 9)],
  tailor: [W('Alterations', 15), W('Made-to-measure shirt', 55), W('Tie', 18)],
  electronics: [W('Phone charger', 9), W('Headphones', 45), W('Batteries', 4), W('Radio', 30)],
  toyshop: [W('Teddy bear', 10), W('Kite', 14), W('Board game', 20), W('Yo-yo', 3)],
  jeweler: [W('Silver ring', 120), W('Pocket watch', 160), W('Earrings', 75)],
  petshop: [W('Dog treats', 4), W('Bird seed', 3), W('Squeaky toy', 5)],
  hardware: [W('Torch', 8), W('Toolbox', 35), W('Paint tin', 12), W('Rope', 6)],
  furniture: [W('Table lamp', 40), W('Cushion', 15), W('Picture frame', 12)],
  fishmarket: [W('Fresh fish', 7), W('Prawns', 9), W('Smoked salmon', 12)],
  postoffice: [W('Stamps', 1), W('Parcel postage', 6), W('Postcard', 1)],
  hotel: [W('Lobby coffee', 3, true), W('Afternoon tea', 12, true)],
  library: [W('Borrowed book', 0)],
  laundry: [W('Service wash', 4), W('Dry cleaning', 9)],
  cinema: [W('Film ticket', 8), W('Popcorn', 4, true), W('Fizzy drink', 2, true)],
  theater: [W('Theatre ticket', 14), W('Programme', 3), W('Interval ice cream', 3, true)],
  museum: [W('Admission', 5), W('Guidebook', 6), W('Postcard', 1)],
  arcade: [W('Tokens', 5), W('Prize ticket roll', 2)],
  casino: [W('Drink at the bar', 5, true), W('Club sandwich', 9, true)],
  gym: [W('Day pass', 6), W('Protein shake', 4, true)],
  pool: [W('Swim', 4), W('Towel hire', 2)],
  stadium: [W('Match ticket', 10), W('Pie', 4, true), W('Scarf', 12)],
  boatclub: [W('Drink at the bar', 4, true), W('Day membership', 15)],
  trainstation: [W('Coffee', 2, true), W('Newspaper', 1)],
  airport: [W('Coffee', 3, true), W('Travel pillow', 12)],
  dock: [W('Tea', 1, true), W('Fish and chips', 7, true)],
  heliport: [W('Coffee', 3, true)],
};
/** tickets from the machines at a terminal (kept in the bag for the journey) */
export const TICKETS: Record<string, Ware[]> = {
  trainstation: [W('Single to the next town', 6), W('Day return, anywhere on the line', 11), W('Week rover', 35)],
  airport: [W('Economy to the capital', 120), W('Weekend in the sun', 210)],
  dock: [W('Ferry, foot passenger', 5), W('Island day trip', 12)],
  heliport: [W('Sightseeing flight', 60), W('Air taxi to the city', 140)],
};

/* ---------- building blocks ---------- */
class Plan {
  boxes: Box[] = [];
  solids: Rect[] = [];
  spots: Spot[] = [];
  posts: Place[] = [];
  places: Place[] = [];
  lights: Light[] = [];
  signs: Sign[] = [];
  constructor(public w: number, public d: number, public h: number, public rnd: () => number) {}
  get back(): number { return -this.d / 2; }
  get front(): number { return this.d / 2; }
  get left(): number { return -this.w / 2; }
  get right(): number { return this.w / 2; }
  box(x: number, z: number, w: number, d: number, h: number, m: Mat, c: string, y = 0, solid = false, ry = 0): void {
    this.boxes.push({ x, y, z, w, h, d, m, c, ry });
    if (solid) {
      const [hw, hd] = ry % Math.PI ? [d / 2, w / 2] : [w / 2, d / 2];
      this.solids.push({ x0: x - hw, z0: z - hd, x1: x + hw, z1: z + hd });
    }
  }
  /** a free-standing block you can't walk through */
  solid(x: number, z: number, w: number, d: number, h: number, m: Mat, c: string, y = 0, ry = 0): void {
    this.box(x, z, w, d, h, m, c, y, true, ry);
  }
  light(x: number, z: number, i = 1, c = '#fff1dc', y = this.h - 0.15): void {
    this.lights.push({ x, y, z, i, c });
  }
  /* furniture */
  table(x: number, z: number, w: number, d: number, top: string, h = 0.76): void {
    this.solid(x, z, w, d, 0.05, 'wood', top, h - 0.05);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) this.box(x + sx * (w / 2 - 0.06), z + sz * (d / 2 - 0.06), 0.06, 0.06, h - 0.05, 'darkwood', '#4a3424');
  }
  /** a chair facing `face` (0 = toward the back wall); its place is someone's seat */
  chair(x: number, z: number, face: number, c = '#5a3a28', seat = true): void {
    this.box(x, z, 0.44, 0.44, 0.06, 'wood', c, 0.42);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) this.box(x + sx * 0.19, z + sz * 0.19, 0.04, 0.04, 0.42, 'darkwood', '#3a2a1e');
    // the back, behind whoever sits there
    const bx = x + Math.sin(face) * 0.2, bz = z + Math.cos(face) * 0.2;
    this.box(bx, bz, Math.abs(Math.cos(face)) > 0.5 ? 0.44 : 0.05, Math.abs(Math.cos(face)) > 0.5 ? 0.05 : 0.44, 0.48, 'wood', c, 0.48);
    if (seat) this.places.push({ x, z, face, pose: 'sit' });
  }
  /** a counter running across x at depth z; the clerk stands behind (toward the back), customers in front */
  counter(x: number, z: number, len: number, top: string, body: string, label: string, opts: { till?: boolean; glass?: boolean } = {}): void {
    this.solid(x, z, len, 0.6, 1.0, 'wood', body);
    this.box(x, z, len + 0.06, 0.66, 0.05, 'stone', top, 1.0);
    if (opts.till) {
      this.box(x + len / 2 - 0.4, z, 0.36, 0.3, 0.12, 'plastic', '#2a2c30', 1.05);
      this.box(x + len / 2 - 0.4, z - 0.05, 0.28, 0.04, 0.2, 'screen', '#7ad0ff', 1.17);
    }
    if (opts.glass) this.box(x, z + 0.05, len - 0.2, 0.5, 0.42, 'glass', '#dfe8ee', 1.05);
    this.posts.push({ x: x - len / 4, z: z - 0.75, face: Math.PI, pose: 'idle' });
    this.spots.push({ kind: 'counter', x: x - len / 4, z: z + 0.95, yaw: 0, label, post: this.posts.length - 1 });
  }
  shelf(x: number, z: number, len: number, along: 'x' | 'z', wares: string[], h = 1.8): void {
    const [w, d] = along === 'x' ? [len, 0.5] : [0.5, len];
    this.solid(x, z, w, d, 0.06, 'wood', '#e8e4dc');
    this.box(x, z, w, d, h, 'paint', '#f4f2ee', 0, false);
    // goods on each level, in their colours
    for (let lv = 0; lv < 4; lv++) {
      const y = 0.25 + lv * ((h - 0.35) / 4);
      this.box(x, z, w - 0.04, d - 0.04, 0.03, 'wood', '#d8d2c6', y);
      const n = Math.max(2, Math.round(len / 0.35));
      for (let k = 0; k < n; k++) {
        if (this.rnd() < 0.15) continue;
        const t = (k + 0.5) / n - 0.5;
        const c = wares[Math.floor(this.rnd() * wares.length)];
        const gh = 0.14 + this.rnd() * 0.16;
        if (along === 'x') this.box(x + t * len, z, len / n - 0.05, 0.3, gh, 'plastic', c, y + 0.03);
        else this.box(x, z + t * len, 0.3, len / n - 0.05, gh, 'plastic', c, y + 0.03);
      }
    }
  }
  plant(x: number, z: number, big = false): void {
    this.solid(x, z, 0.4, 0.4, 0.4, 'ceramic', '#c8b8a0');
    this.box(x, z, big ? 0.7 : 0.45, big ? 0.7 : 0.45, big ? 1.1 : 0.5, 'fabric', '#3f6a34', 0.4);
  }
  rug(x: number, z: number, w: number, d: number, c: string): void {
    this.box(x, z, w, d, 0.015, 'fabric', c, 0.005);
  }
  sofa(x: number, z: number, len: number, face: number, c: string): void {
    const across = Math.abs(Math.cos(face)) > 0.5;
    const [w, d] = across ? [len, 0.9] : [0.9, len];
    this.solid(x, z, w, d, 0.42, 'fabric', c);
    const bx = x + Math.sin(face) * 0.35, bz = z + Math.cos(face) * 0.35;
    this.box(bx, bz, across ? len : 0.2, across ? 0.2 : len, 0.45, 'fabric', c, 0.42);
    const n = Math.max(1, Math.floor(len / 0.75));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n - 0.5;
      this.places.push({ x: across ? x + t * len : x - Math.sin(face) * 0.05, z: across ? z - Math.cos(face) * 0.05 : z + t * len, face, pose: 'sit' });
    }
  }
  bookcase(x: number, z: number, len: number, along: 'x' | 'z'): void {
    const spines = ['#7a2a2a', '#2a4a6a', '#3a5a2a', '#8a6a2a', '#4a2a4a', '#2a2a2a', '#a07a4a'];
    const [w, d] = along === 'x' ? [len, 0.35] : [0.35, len];
    this.solid(x, z, w, d, 2.1, 'darkwood', '#5a3a24');
    for (let lv = 0; lv < 5; lv++) {
      const y = 0.15 + lv * 0.4;
      const n = Math.round(len / 0.06);
      let k = 0;
      while (k < n) {
        const run = 2 + Math.floor(this.rnd() * 6);
        const c = spines[Math.floor(this.rnd() * spines.length)];
        const t0 = k / n - 0.5, t1 = Math.min(n, k + run) / n - 0.5;
        const mid = (t0 + t1) / 2 * len, span = (t1 - t0) * len - 0.01;
        const bh = 0.24 + this.rnd() * 0.08;
        if (along === 'x') this.box(x + mid, z + 0.19, span, 0.04, bh, 'fabric', c, y);
        else this.box(x + 0.19, z + mid, 0.04, span, bh, 'fabric', c, y);
        k += run + (this.rnd() < 0.2 ? 1 : 0);
      }
    }
  }
  desk(x: number, z: number, face: number, monitor = true): void {
    this.solid(x, z, 1.4, 0.7, 0.04, 'wood', '#c8b496', 0.72);
    this.box(x - 0.62, z, 0.06, 0.66, 0.72, 'metal', '#5a5e64');
    this.box(x + 0.62, z, 0.06, 0.66, 0.72, 'metal', '#5a5e64');
    if (monitor) {
      const mz = z - Math.cos(face) * 0.18;
      this.box(x, mz, 0.56, 0.04, 0.34, 'plastic', '#1e2024', 0.86);
      this.box(x, mz + Math.cos(face) * 0.025, 0.5, 0.01, 0.28, 'screen', '#9ac8ff', 0.89);
      this.box(x, mz, 0.08, 0.08, 0.14, 'plastic', '#1e2024', 0.76);
    }
    const cz = z + Math.cos(face) * 0.65;
    this.box(x, cz, 0.5, 0.5, 0.08, 'fabric', '#2a2e36', 0.45);
    this.box(x, cz + Math.cos(face) * 0.22, 0.5, 0.06, 0.55, 'fabric', '#2a2e36', 0.5);
    this.box(x, cz, 0.06, 0.06, 0.45, 'metal', '#3a3e44');
    this.posts.push({ x, z: cz, face, pose: 'sit' });
  }
  bench(x: number, z: number, len: number, face: number, c = '#7a5a3a'): void {
    const across = Math.abs(Math.cos(face)) > 0.5;
    this.solid(x, z, across ? len : 0.45, across ? 0.45 : len, 0.06, 'wood', c, 0.42);
    this.box(x + Math.sin(face) * 0.2, z + Math.cos(face) * 0.2, across ? len : 0.05, across ? 0.05 : len, 0.45, 'wood', c, 0.45);
    this.box(x, z, across ? len - 0.1 : 0.35, across ? 0.35 : len - 0.1, 0.42, 'metal', '#3a3c40');
    const n = Math.max(1, Math.floor(len / 0.7));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n - 0.5;
      this.places.push({ x: across ? x + t * len : x, z: across ? z : z + t * len, face, pose: 'sit' });
    }
  }
  /** a cash or ticket machine; `toward` +1 if its screen faces the front of the room, −1 the back */
  machine(kind: 'atm' | 'tickets', x: number, z: number, label: string, toward = 1): void {
    this.solid(x, z, 0.7, 0.55, 1.75, 'metal', kind === 'atm' ? '#3a4048' : '#2a5aa0');
    this.box(x, z + 0.28 * toward, 0.46, 0.02, 0.34, 'screen', kind === 'atm' ? '#7affc8' : '#ffd27a', 1.1);
    this.box(x, z + 0.3 * toward, 0.5, 0.12, 0.08, 'metal', '#1a1c20', 0.9);
    this.spots.push({ kind, x, z: z + 0.85 * toward, yaw: toward > 0 ? 0 : Math.PI, label });
  }
  /** a place to stand and browse (customers) */
  stand(x: number, z: number, face: number): void {
    this.places.push({ x, z, face, pose: 'idle' });
  }
}

/** lay out the room for building `b` (deterministic: the same building gives the same room) */
export function layoutFor(b: { id: number; type: string; w: number; h: number }): Layout | null {
  const template = INTERIOR[b.type];
  if (!template) return null;
  const rnd = mulberry32((b.id + 1) * 7919 + b.type.length * 104729);
  const big = template === 'terminal' || template === 'civic' || template === 'workshop' || template === 'fire' || template === 'venue';
  const W = clamp(Math.round(b.w * 8 * (big ? 0.85 : 0.7)), template === 'home' ? 9 : 10, big ? 24 : 18);
  const D = clamp(Math.round(b.h * 8 * (big ? 0.85 : 0.7)), template === 'home' ? 8 : 9, big ? 20 : 15);
  const H = template === 'terminal' || template === 'civic' ? 6.5 : template === 'workshop' || template === 'fire' ? 5.5 : template === 'venue' ? 5 : template === 'home' ? 2.8 : 3.2;
  const p = new Plan(W, D, H, rnd);
  BUILD[template](p, b.type);
  // the way out: just inside the door
  p.spots.push({ kind: 'exit', x: 0, z: D / 2 - 0.7, yaw: Math.PI, label: 'Go outside' });
  // keep the doorway clear
  p.solids = p.solids.filter((r) => !(r.x0 < 1.1 && r.x1 > -1.1 && r.z1 > D / 2 - 1.6));
  return {
    template, w: W, d: D, h: H,
    theme: { ...THEMES[template], ...(TINTS[b.type] || {}) },
    boxes: p.boxes, solids: p.solids, spots: p.spots, posts: p.posts, places: p.places, lights: p.lights, signs: p.signs,
    // (a church has stained glass of its own)
    sideWindows: template !== 'workshop' && template !== 'fire' && template !== 'venue' && template !== 'police' && b.type !== 'church',
  };
}
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const GOODS = ['#c8402a', '#2a7ac8', '#e8c02a', '#3a9a4a', '#e8e4dc', '#8a3aa8', '#e87a2a', '#2a2a2a', '#d8a8c8'];

/* ---------- the twelve templates ---------- */
const BUILD: Record<Template, (p: Plan, type: string) => void> = {
  home(p, type) {
    const own = type === 'lodge';
    const k = p.back + 0.35;
    // kitchen along the back wall: a fridge, units, a hob
    p.solid(p.left + 2.6, k, 3.6, 0.6, 0.9, 'paint', own ? '#4a5a44' : '#e8e4da');
    p.box(p.left + 2.6, k, 3.66, 0.64, 0.04, 'stone', '#3a3a3c', 0.9);
    p.box(p.left + 2.6, k - 0.05, 3.6, 0.35, 0.7, 'paint', own ? '#4a5a44' : '#ece8de', 1.5);
    p.solid(p.left + 0.45, k, 0.7, 0.66, 1.8, 'metal', '#dcdcd8');
    p.box(p.left + 3.8, k + 0.02, 0.56, 0.56, 0.02, 'metal', '#1a1a1a', 0.92);
    p.posts.push({ x: p.left + 2.4, z: k + 0.7, face: 0, pose: 'idle' });
    // dining table and chairs
    const tx = p.left + 2.4, tz = p.back + 2.6;
    p.table(tx, tz, 1.4, 0.9, own ? '#5a3a24' : '#8a6040');
    p.chair(tx - 0.4, tz - 0.75, Math.PI);
    p.chair(tx + 0.4, tz - 0.75, Math.PI);
    p.chair(tx - 0.4, tz + 0.75, 0);
    p.chair(tx + 0.4, tz + 0.75, 0);
    p.spots.push({ kind: 'seat', x: tx + 0.4, z: tz + 0.75, yaw: 0, label: 'Sit at the table' });
    // living room: rug, sofa facing the fireplace or television
    const lx = p.right - 2.6, lz = p.back + 2.8;
    p.rug(lx, lz, 3, 2.2, own ? '#6a3a2a' : ['#7a4a3a', '#3a5a6a', '#6a6a4a'][Math.floor(p.rnd() * 3)]);
    p.sofa(lx, lz + 1.1, 2.2, 0, own ? '#3a4a3a' : ['#5a6a7a', '#7a5a4a', '#4a5a4a'][Math.floor(p.rnd() * 3)]);
    p.solid(lx, lz - 0.1, 1.0, 0.55, 0.42, 'wood', '#6a4a30');
    if (own || p.rnd() < 0.5) { // a fireplace
      p.solid(lx, p.back + 0.25, 1.6, 0.5, 1.2, 'brick', '#8a5a44');
      p.box(lx, p.back + 0.48, 0.8, 0.04, 0.6, 'glow', '#ff8a3a', 0.15);
      p.light(lx, p.back + 0.9, 0.5, '#ff9a4a', 0.5);
    } else {
      p.solid(lx, p.back + 0.3, 1.6, 0.45, 0.5, 'wood', '#3a2a20');
      p.box(lx, p.back + 0.32, 1.2, 0.05, 0.7, 'screen', '#2a3a4a', 0.55);
    }
    p.bookcase(p.right - 0.25, lz + 1.2, 1.8, 'z');
    p.plant(p.right - 0.5, p.front - 0.6, true);
    if (own) { // the Founder's study: a map table and the garage key hook
      p.table(p.left + 1.6, p.front - 2.2, 1.6, 1.0, '#4a3020');
      p.box(p.left + 1.6, p.front - 2.2, 1.4, 0.8, 0.01, 'paint', '#d8c89a', 0.77);
      p.solid(p.left + 0.2, p.front - 1.0, 0.3, 1.2, 1.6, 'darkwood', '#3a2618');
      p.spots.push({ kind: 'desk', x: p.left + 0.9, z: p.front - 1.0, yaw: -Math.PI / 2, label: 'The garage keys' });
    }
    p.light(tx, tz, 0.9);
    p.light(lx, lz, 0.9);
  },

  shop(p, type) {
    const show = type === 'carshowroom' || type === 'motoshowroom';
    p.counter(p.right - 2.6, p.front - 2.4, 2.8, '#d8d2c6', '#5a6a7a', show ? 'Speak to the sales desk' : 'Buy at the counter', { till: true });
    if (show) {
      // the cars on the floor, on turntables
      for (const [x, c] of [[p.left + 3, '#b0201c'], [p.left + 7.2, '#2a4a6a']] as const) {
        p.box(x, p.back + 3, 4.2, 4.2, 0.12, 'stone', '#d8d8d8');
        if (type === 'carshowroom') {
          p.solid(x, p.back + 3, 1.8, 4.2, 0.75, 'metal', c, 0.3);
          p.box(x, p.back + 3.2, 1.6, 2.2, 0.55, 'glass', '#1a2028', 1.05);
          for (const [sx, sz] of [[-1, -1.3], [1, -1.3], [-1, 1.3], [1, 1.3]]) p.box(x + sx * 0.85, p.back + 3 + sz, 0.25, 0.66, 0.66, 'plastic', '#141414', 0.12);
        } else {
          p.solid(x, p.back + 3, 0.5, 2.0, 0.6, 'metal', c, 0.4);
          for (const sz of [-0.7, 0.7]) p.box(x, p.back + 3 + sz, 0.14, 0.62, 0.62, 'plastic', '#141414', 0.12);
        }
        p.stand(x + 1.8, p.back + 4.6, Math.PI / 2);
      }
      p.posts.push({ x: p.left + 5, z: p.back + 5.5, face: Math.PI, pose: 'idle' });
    } else {
      // aisles of shelves with goods, fridges along the back
      const rows = Math.max(2, Math.floor((p.w - 4) / 2.4));
      for (let r = 0; r < rows; r++) {
        const x = p.left + 1.6 + r * 2.4;
        if (x > p.right - 4.5) break;
        p.shelf(x, p.back + 3.4, 4.2, 'z', GOODS);
        p.stand(x + 0.85, p.back + 3 + p.rnd() * 1.4, -Math.PI / 2);
      }
      p.solid(0, p.back + 0.4, p.w - 1.4, 0.7, 2.0, 'metal', '#e8e8e8');
      p.box(0, p.back + 0.76, p.w - 1.6, 0.03, 1.5, 'glass', '#cfe6f4', 0.3);
      p.light(0, p.back + 0.8, 0.5, '#e8f4ff', 1.9);
      p.posts.push({ x: p.left + 2.8, z: p.back + 5.8, face: 0, pose: 'idle' });
    }
    if (type === 'market' || type === 'mall' || type === 'deptstore') p.machine('atm', p.left + 0.6, p.front - 0.5, 'Use the cash machine', -1);
    p.plant(p.left + 0.5, p.front - 0.5);
    for (let x = -p.w / 4; x <= p.w / 4; x += p.w / 4) p.light(x, 0, 1.1, '#f4f8ff');
  },

  food(p, type) {
    const fast = ['burgerpalace', 'goldenarches', 'crispycluck', 'tacobelle'].includes(type);
    const cz = p.back + 2.0;
    p.counter(0, cz, Math.min(5, p.w - 4), '#e8e0d0', fast ? '#c8c8c8' : '#6a4a30', 'Order at the counter', { till: true, glass: type === 'bakery' || type === 'icecream' || type === 'cafe' });
    if (type === 'bakery' || type === 'cafe') {
      // pastries and cakes behind the glass
      const cols = ['#d8a050', '#c88a3a', '#e8c890', '#8a5a2a', '#f0d8a8'];
      for (let k = 0; k < 9; k++) p.box(-1.6 + k * 0.4, cz + 0.08, 0.26, 0.2, 0.08 + p.rnd() * 0.06, 'fabric', cols[k % cols.length], 1.07);
    }
    // behind the counter: the back bar, a coffee machine or an oven
    p.solid(0, p.back + 0.35, p.w - 1.2, 0.6, 0.95, 'wood', fast ? '#b8b8b8' : '#5a3a28');
    if (type === 'pizzeria' || type === 'pizzapalace' || type === 'bakery') {
      p.solid(p.right - 1.8, p.back + 0.6, 1.8, 1.1, 1.9, 'brick', '#8a4a34');
      p.box(p.right - 1.8, p.back + 1.16, 0.7, 0.04, 0.45, 'glow', '#ff7a2a', 0.8);
      p.light(p.right - 1.8, p.back + 1.4, 0.6, '#ff8a3a', 1.1);
    } else {
      p.box(-1.2, p.back + 0.35, 0.6, 0.45, 0.45, 'chrome', '#c8ccd0', 0.95);
    }
    p.posts.push({ x: p.right - 3.3, z: p.back + 1.0, face: Math.PI, pose: 'idle' }, { x: p.left + 1.6, z: p.back + 1.0, face: Math.PI, pose: 'idle' });
    // a menu board over the counter
    const name = type === 'goldenarches' ? "MacRonny's" : type === 'burgerpalace' ? 'Burger Kingdom' : type === 'crispycluck' ? 'Crispy Cluck' : type === 'tacobelle' ? 'Taco Belle' : type === 'pizzapalace' ? 'Pizza Palace' : 'MENU';
    p.signs.push({ text: name, x: 0, y: p.h - 0.75, z: p.back + 0.08, w: 2.6, h: 0.6, ry: 0, bg: fast ? '#1a1a1a' : '#2a2420', fg: fast ? '#ffd040' : '#f0e6d0' });
    // tables for two and four
    const rows = Math.max(1, Math.floor((p.d - 5.2) / 2.0));
    const cols = Math.max(2, Math.floor((p.w - 1.5) / 2.3));
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const x = p.left + 1.5 + c * ((p.w - 3) / Math.max(1, cols - 1));
        const z = cz + 2.2 + r * 2.0;
        if (Math.abs(x) < 1.2 && z > p.front - 2) continue;
        p.table(x, z, 0.8, 0.8, fast ? '#d8d8d8' : '#8a6040');
        p.chair(x, z - 0.6, Math.PI, fast ? '#c83a2a' : '#4a3020');
        p.chair(x, z + 0.6, 0, fast ? '#c83a2a' : '#4a3020');
        if (r === 0 && c === cols - 1) p.spots.push({ kind: 'seat', x, z: z + 0.6, yaw: 0, label: 'Sit down' });
      }
    p.plant(p.left + 0.5, p.front - 0.5);
    for (let x = -p.w / 3; x <= p.w / 3 + 0.01; x += p.w / 3) p.light(x, cz + 2.5, 0.9, fast ? '#f4f8ff' : '#ffe2b8');
  },

  office(p, type) {
    // the front desk
    const rx = p.right - 2.8;
    if (type === 'bank' || type === 'postoffice') {
      p.counter(0, p.back + 2.2, Math.min(6, p.w - 3), '#e8e0d0', type === 'bank' ? '#5a3a24' : '#c83a2a', type === 'bank' ? 'Speak to a teller' : 'Post office counter', { till: true, glass: type === 'bank' });
      p.machine('atm', p.left + 0.6, p.front - 0.5, 'Use the cash machine', -1);
      p.bench(p.left + 2.6, p.front - 1.4, 2.4, 0);
      for (let k = 0; k < 3; k++) p.stand(-0.4 + k * 0.7, p.back + 4 + k * 0.6, 0);
    } else {
      p.counter(rx, p.front - 2.6, 2.6, '#ece6da', type === 'hotel' ? '#5a3a24' : '#3a4048', type === 'hotel' ? 'The reception desk' : 'Ask at reception', { till: true });
      if (type === 'tvstation') {
        // the news set: desk, screen wall, cameras
        p.solid(-1.5, p.back + 2.2, 3.2, 0.9, 0.78, 'plastic', '#c03030');
        p.box(-1.5, p.back + 0.15, 4.4, 0.1, 2.2, 'screen', '#2a6aa0', 0.6);
        p.signs.push({ text: 'PVTV NEWS', x: -1.5, y: 2.2, z: p.back + 0.22, w: 2.4, h: 0.5, ry: 0, bg: '#c03030', fg: '#ffffff' });
        for (const cx of [-2.5, -0.5]) { p.solid(cx, p.back + 4.6, 0.5, 0.5, 1.4, 'metal', '#2a2a2a'); p.box(cx, p.back + 4.5, 0.4, 0.6, 0.35, 'plastic', '#1a1a1a', 1.4); }
        p.posts.push({ x: -1.5, z: p.back + 1.6, face: Math.PI, pose: 'sit' });
        p.light(-1.5, p.back + 2.5, 1.6, '#ffffff');
      } else if (type === 'hotel') {
        p.rug(-1.5, 0, 4, 3, '#6a2a2a');
        p.sofa(-1.5, -1.2, 2.4, Math.PI, '#4a3a2a');
        p.sofa(-1.5, 1.4, 2.4, 0, '#4a3a2a');
        p.solid(-1.5, 0.1, 1.2, 0.6, 0.4, 'darkwood', '#3a2618');
        p.plant(p.left + 0.6, p.back + 0.6, true);
        p.plant(p.right - 0.6, p.back + 0.6, true);
      } else {
        // open-plan desks
        const cols = Math.max(2, Math.floor((p.w - 3) / 2.2));
        const rows = Math.max(1, Math.floor((p.d - 5) / 2.4));
        for (let r = 0; r < rows; r++)
          for (let c = 0; c < cols; c++) {
            const x = p.left + 1.8 + c * 2.2;
            if (x > rx - 2) continue;
            p.desk(x, p.back + 1.4 + r * 2.4, Math.PI);
          }
        if (type === 'exchange') {
          p.box(0, p.back + 0.12, p.w - 2, 0.06, 1.2, 'screen', '#1a3a2a', 1.9);
          p.signs.push({ text: 'PVX  ▲ 1.2%', x: 0, y: 2.5, z: p.back + 0.18, w: 3.2, h: 0.55, ry: 0, bg: '#0a1a10', fg: '#4aff8a' });
        }
        p.solid(p.right - 0.4, p.back + 0.4, 0.4, 0.4, 1.2, 'plastic', '#d8e8f0');
        p.plant(p.right - 0.6, 0, true);
      }
      p.bench(p.left + 1.8, p.front - 1.2, 2.2, 0, '#3a3e44');
    }
    for (let x = -p.w / 3; x <= p.w / 3 + 0.01; x += p.w / 3) for (const z of [-p.d / 4, p.d / 4]) p.light(x, z, 0.7, '#f4f8ff');
  },

  workshop(p, type) {
    if (type === 'autoshop') {
      // a car up on the lift, tool boards, the service desk
      p.solid(-1.5, p.back + 3.2, 2.4, 4.6, 0.1, 'metal', '#d8a020');
      for (const sx of [-1.3, 1.3]) p.solid(-1.5 + sx, p.back + 3.2, 0.25, 0.25, 2.4, 'metal', '#3a3c40');
      p.box(-1.5, p.back + 3.2, 1.8, 4.2, 0.8, 'metal', '#2a4a8a', 1.4);
      p.box(-1.5, p.back + 3.4, 1.6, 2.2, 0.5, 'glass', '#1a2028', 2.2);
      p.box(3, p.back + 0.08, 3, 0.06, 1.4, 'paint', '#5a6068', 0.9);
      p.solid(3, p.back + 0.5, 2.8, 0.7, 0.92, 'metal', '#b02a2a');
      p.counter(p.right - 2.4, p.front - 2.4, 2.4, '#c8c8c8', '#3a3e44', 'The service desk', { till: true });
      p.posts.push({ x: -0.2, z: p.back + 3.2, face: -Math.PI / 2, pose: 'idle' });
    } else if (type === 'laundry') {
      for (let k = 0; k < Math.floor((p.w - 2) / 0.9); k++) {
        const x = p.left + 1 + k * 0.9;
        p.solid(x, p.back + 0.45, 0.8, 0.75, 0.9, 'metal', '#f2f2f2');
        p.box(x, p.back + 0.84, 0.46, 0.04, 0.46, 'glass', '#a8c8d8', 0.25);
      }
      p.solid(0, 0, 2.4, 0.9, 0.9, 'stone', '#d8d8d8');
      p.bench(p.left + 2, p.front - 1.4, 2.4, 0, '#3a5a7a');
      p.counter(p.right - 2.4, p.front - 2.2, 2.2, '#e8e8e8', '#2a6aa0', 'The service counter', { till: true });
    } else {
      // racks of crates and machines with lit panels
      const rack = (x: number, z: number): void => {
        for (const sx of [-1.4, 1.4]) p.solid(x + sx, z, 0.1, 1.1, 3.6, 'metal', '#d07a1a');
        for (let lv = 0; lv < 3; lv++) {
          p.box(x, z, 2.9, 1.1, 0.08, 'metal', '#3a6aa0', 0.2 + lv * 1.2);
          for (let k = 0; k < 3; k++) if (p.rnd() < 0.8) p.box(x - 0.95 + k * 0.95, z, 0.85, 0.9, 0.6 + p.rnd() * 0.3, 'wood', ['#a07a4a', '#8a6a3a', '#5a6a7a'][k % 3], 0.28 + lv * 1.2);
        }
        p.solids.push({ x0: x - 1.45, z0: z - 0.55, x1: x + 1.45, z1: z + 0.55 });
      };
      rack(p.left + 2.2, p.back + 1.0);
      rack(p.left + 5.4, p.back + 1.0);
      const mx = p.right - 3;
      p.solid(mx, -0.5, 2.2, 1.6, 1.6, 'metal', type === 'powerplant' ? '#e0b020' : '#5a7a6a');
      p.box(mx, 0.31, 0.8, 0.02, 0.5, 'screen', '#7affa0', 0.9);
      p.solid(0, 1.2, 6, 0.8, 0.85, 'metal', '#3a3c40');
      for (let k = 0; k < 6; k++) p.box(-2.5 + k, 1.2, 0.5, 0.5, 0.3, 'wood', '#a07a4a', 0.85);
      p.solid(p.left + 1.2, p.front - 2.4, 1.8, 0.8, 0.9, 'wood', '#8a6a4a');
      p.posts.push({ x: mx - 1.4, z: -0.5, face: Math.PI / 2, pose: 'idle' }, { x: 0, z: 0.4, face: Math.PI, pose: 'idle' }, { x: p.left + 1.2, z: p.front - 3.1, face: Math.PI, pose: 'idle' });
    }
    for (let x = -p.w / 3; x <= p.w / 3 + 0.01; x += p.w / 3) p.light(x, 0, 1.4, '#f2f6ff');
  },

  classroom(p, type) {
    if (type === 'library') {
      for (let r = 0; r < 3; r++) p.bookcase(p.left + 0.25, p.back + 1.5 + r * 2.2, 2, 'z');
      for (let c = 0; c < Math.floor((p.w - 6) / 2.2); c++) p.bookcase(p.left + 2.6 + c * 2.2, p.back + 0.25, 2, 'x');
      p.table(0.8, 0.3, 2.4, 1.1, '#7a5a3a');
      for (const dx of [-0.6, 0.6]) { p.chair(0.8 + dx, -0.45, Math.PI); p.chair(0.8 + dx, 1.05, 0); }
      p.counter(p.right - 2.4, p.front - 2.4, 2.2, '#d8c8a8', '#5a3a28', 'The issue desk', { till: true });
      p.light(0.8, 0.3, 0.9, '#ffe6c0');
    } else {
      // a blackboard, the teacher's desk, rows of pupils' desks
      p.box(0, p.back + 0.06, 4, 0.05, 1.3, 'paint', '#1e3a2a', 1.0);
      p.box(0, p.back + 0.1, 4.1, 0.08, 0.05, 'wood', '#8a6a4a', 0.98);
      p.solid(-2.6, p.back + 1.4, 1.4, 0.7, 0.76, 'wood', '#8a6040');
      p.posts.push({ x: 0.8, z: p.back + 1.2, face: Math.PI, pose: 'idle' });
      const cols = Math.max(2, Math.floor((p.w - 2) / 1.6)), rows = Math.max(2, Math.floor((p.d - 5) / 1.4));
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const x = p.left + 1.4 + c * ((p.w - 2.8) / Math.max(1, cols - 1)), z = p.back + 3 + r * 1.4;
          p.solid(x, z, 1.0, 0.55, 0.04, 'wood', '#c8a878', 0.7);
          p.box(x, z, 0.9, 0.5, 0.7, 'metal', '#5a6068');
          p.chair(x, z + 0.55, Math.PI, '#3a6aa0');
        }
      p.bookcase(p.right - 0.25, p.back + 1.5, 1.8, 'z');
    }
    for (let x = -p.w / 4; x <= p.w / 4 + 0.01; x += p.w / 4) p.light(x, 0, 1.0, '#f4f6ff');
  },

  hospital(p, type) {
    if (type === 'pharmacy') {
      p.counter(0, p.back + 1.8, 3.6, '#ffffff', '#2a8a4a', 'The pharmacy counter', { till: true });
      for (const x of [p.left + 1.6, p.right - 1.6]) p.shelf(x, p.back + 0.3, 2.6, 'x', ['#ffffff', '#e8f0f4', '#2a8a4a', '#c83a3a', '#f4d8a8']);
      p.shelf(p.left + 1.2, 0.8, 3, 'z', ['#ffffff', '#e8f0f4', '#2a8a4a', '#f4d8a8']);
      p.stand(p.left + 2.1, 0.8, -Math.PI / 2);
    } else {
      p.counter(p.right - 2.6, p.front - 2.6, 2.6, '#ffffff', '#3a8a8a', 'The reception desk', { till: true });
      for (let k = 0; k < 2; k++) p.bench(p.left + 1.8 + k * 2.6, p.front - 1.4, 2.2, 0, '#3a7a8a');
      // the ward: beds, curtains, a nurse
      const beds = Math.max(2, Math.floor((p.w - 2) / 2.4));
      for (let k = 0; k < beds; k++) {
        const x = p.left + 1.3 + k * 2.4;
        p.solid(x, p.back + 1.2, 0.95, 2.0, 0.55, 'metal', '#e8ecee');
        p.box(x, p.back + 1.2, 0.9, 1.9, 0.12, 'fabric', '#f8f8f8', 0.55);
        p.box(x, p.back + 0.4, 0.6, 0.35, 0.1, 'fabric', '#ffffff', 0.67);
        p.box(x + 1.15, p.back + 1.2, 0.03, 2.2, 2.0, 'fabric', '#9ad0c8', 0.15);
        if (k % 2 === 0) p.places.push({ x, z: p.back + 1.5, face: Math.PI, pose: 'sit' });
      }
      p.posts.push({ x: 0, z: p.back + 3.0, face: 0, pose: 'idle' });
    }
    for (let x = -p.w / 3; x <= p.w / 3 + 0.01; x += p.w / 3) p.light(x, 0, 1.1, '#f0f8ff');
  },

  police(p) {
    p.counter(p.right - 2.8, p.front - 2.6, 3, '#d8dde2', '#1e3a6a', 'The front desk', { till: true });
    p.bench(p.left + 1.8, p.front - 1.3, 2.2, 0, '#3a3e44');
    // desks, and the cells along the back
    p.desk(p.left + 2, -0.2, Math.PI);
    p.desk(p.left + 4.4, -0.2, Math.PI);
    p.box(p.left + 0.12, 0, 0.04, 1.4, 1, 'paint', '#c8b890', 1.2);
    for (let c = 0; c < 2; c++) {
      const x0 = p.right - 2.4 - c * 2.6;
      p.box(x0, p.back + 1.2, 2.4, 0.05, 2.6, 'paint', '#a8aeb4');
      for (let k = 0; k < 9; k++) p.box(x0 - 1.1 + k * 0.27, p.back + 2.4, 0.05, 0.05, 2.6, 'chrome', '#8a9098');
      p.solids.push({ x0: x0 - 1.25, z0: p.back, x1: x0 + 1.25, z1: p.back + 2.45 });
      p.box(x0, p.back + 0.5, 1.8, 0.6, 0.45, 'metal', '#5a6068');
    }
    for (const x of [-p.w / 4, p.w / 4]) p.light(x, 0, 1.0, '#eef4ff');
  },

  fire(p) {
    // the engine in its bay (shorter in a small station, clear of the door)
    const ex = -1.8, len = Math.min(7.2, p.d - 4.4), ez = p.back + 1.4 + len / 2, k = len / 7.2;
    p.solid(ex, ez, 2.5, len, 1.9, 'metal', '#b81e1e', 0.55);
    p.box(ex, ez - len / 2 + 0.9, 2.3, 1.8 * k, 0.9, 'glass', '#1a2028', 1.45);
    p.box(ex, ez + 0.8 * k, 0.5, 5.4 * k, 0.12, 'chrome', '#c8ccd0', 2.5);
    p.box(ex, ez + 0.8 * k, 0.5, 5.4 * k, 0.06, 'chrome', '#c8ccd0', 2.75);
    for (const sz of [-2.6, -0.2, 2.4]) for (const sx of [-1.15, 1.15]) p.box(ex + sx, ez + sz * k, 0.32, 1.0, 1.0, 'plastic', '#141414', 0.05);
    p.box(ex, ez + len / 2 + 0.02, 2.3, 0.04, 0.3, 'glow', '#ffb000', 1.9);
    // the bay door behind it, kit on the wall
    p.box(ex, p.back + 0.08, 3.6, 0.06, 4.2, 'metal', '#c83a2a');
    for (let k = 0; k < 5; k++) {
      const x = p.right - 0.4;
      p.solid(x, p.back + 1 + k * 0.9, 0.5, 0.7, 1.9, 'metal', '#8a9098');
      p.box(x - 0.27, p.back + 1 + k * 0.9, 0.02, 0.5, 0.7, 'fabric', '#e0b020', 0.9);
    }
    p.solid(p.right - 3, p.front - 2.6, 1.8, 0.8, 0.9, 'wood', '#8a6a4a');
    p.posts.push({ x: ex + 1.9, z: ez - 1.5, face: -Math.PI / 2, pose: 'idle' }, { x: p.right - 1.2, z: p.back + 2, face: Math.PI / 2, pose: 'idle' }, { x: p.right - 3, z: p.front - 3.3, face: 0, pose: 'idle' });
    for (const z of [-p.d / 4, p.d / 4]) p.light(ex, z, 1.5, '#f6f8ff');
  },

  terminal(p, type) {
    const name = type === 'airport' ? 'DEPARTURES' : type === 'dock' ? 'FERRY SAILINGS' : type === 'heliport' ? 'FLIGHTS' : 'TRAIN TIMES';
    p.box(0, p.back + 0.1, 5, 0.1, 1.5, 'screen', '#0a1220', 3.4);
    p.signs.push({ text: name, x: 0, y: 4.55, z: p.back + 0.17, w: 3.6, h: 0.5, ry: 0, bg: '#0a1220', fg: '#ffd040' });
    p.counter(p.right - 3, p.back + 2.2, 3.4, '#e4e2dc', '#2a5aa0', 'The ticket office', { till: true, glass: true });
    for (let k = 0; k < 2; k++) p.machine('tickets', p.left + 1.2 + k * 1.2, p.back + 0.5, 'Use the ticket machine');
    // rows of benches, clear of the gates by the door
    for (let z = -0.5; z < p.front - 4.2; z += 2.2)
      for (const x of [-3.2, 0.2]) p.bench(x, z, 2.8, 0, '#3a5a8a');
    for (let k = 0; k < 4; k++) p.solid(-1.8 + k * 1.2, p.front - 3.2, 0.25, 0.9, 1.0, 'chrome', '#9aa0a8');
    p.solid(p.left + 1, p.front - 2.4, 0.35, 0.35, 2.4, 'metal', '#2a5aa0');
    for (let k = 0; k < 3; k++) p.stand(-2 + k * 1.6, p.back + 3.4, 0);
    for (let x = -p.w / 3; x <= p.w / 3 + 0.01; x += p.w / 3) for (const z of [-p.d / 4, p.d / 4]) p.light(x, z, 1.4, '#f6f4ee');
  },

  venue(p, type) {
    if (type === 'cinema' || type === 'theater') {
      // the screen or stage, rows of seats, the kiosk at the back
      if (type === 'cinema') p.box(0, p.back + 0.12, p.w - 2.5, 0.06, 2.6, 'screen', '#c8d8f0', 1.2);
      else {
        p.solid(0, p.back + 1.4, p.w - 2, 2.6, 0.9, 'darkwood', '#3a2418');
        p.box(0, p.back + 0.1, p.w - 2, 0.1, 4, 'fabric', '#8a1a24', 0.9);
        p.light(0, p.back + 1.6, 1.4, '#ffd8a0', 3.4);
      }
      const rows = Math.max(3, Math.floor((p.d - 7) / 1.1));
      for (let r = 0; r < rows; r++)
        for (const side of [-1, 1]) {
          const x0 = side * (p.w / 4 + 0.4);
          p.solid(x0, p.back + 3.8 + r * 1.1, p.w / 2 - 1.6, 0.55, 0.45, 'fabric', '#7a1a24');
          for (let k = 0; k < Math.floor((p.w / 2 - 1.6) / 0.6); k++) p.places.push({ x: x0 - (p.w / 2 - 1.6) / 2 + 0.3 + k * 0.6, z: p.back + 3.8 + r * 1.1, face: 0, pose: 'sit' });
        }
      p.counter(p.right - 2.6, p.front - 2.2, 2.6, '#e8d8a8', '#3a2418', 'The box office', { till: true });
    } else if (type === 'museum') {
      for (let k = 0; k < 4; k++) {
        const x = p.left + 2 + k * ((p.w - 4) / 3);
        p.solid(x, -0.5, 0.9, 0.9, 1.0, 'stone', '#f2f0ea');
        p.box(x, -0.5, 0.5, 0.5, 0.6, ['metal', 'stone', 'ceramic', 'darkwood'][k] as Mat, ['#b88a3a', '#8a8a8a', '#3a6a8a', '#4a2a1a'][k], 1.0);
        p.box(x, p.back + 0.06, 1.4, 0.04, 1.0, 'screen', ['#c8a070', '#7a9aba', '#a0b878', '#c87a6a'][k], 1.4);
        p.stand(x, 0.6, 0);
      }
      p.bench(0, 1.6, 2.4, 0);
      p.counter(p.right - 2.4, p.front - 2.2, 2.4, '#f2f0ea', '#3a3a3a', 'The ticket desk', { till: true });
    } else if (type === 'pool') {
      p.counter(p.right - 2.4, p.front - 2.2, 2.2, '#e8f2f4', '#2a7aa0', 'The front desk', { till: true });
      p.box(-1, -1, p.w - 5, p.d - 7, 0.05, 'water', '#2a8ab0', 0.02);
      p.solids.push({ x0: -1 - (p.w - 5) / 2, z0: -1 - (p.d - 7) / 2, x1: -1 + (p.w - 5) / 2, z1: -1 + (p.d - 7) / 2 });
      for (let k = 0; k < 3; k++) p.solid(p.right - 1.2, p.back + 1.5 + k * 1.6, 0.7, 1.6, 0.35, 'plastic', '#f2f2f2');
      p.solid(p.right - 1.4, 1.5, 0.6, 0.6, 1.8, 'paint', '#e8e8e8');
      p.posts.push({ x: p.right - 1.4, z: 2.2, face: Math.PI / 2, pose: 'idle' });
    } else {
      // gym, arcade, casino, stadium concourse, the boat club: a counter or a bar, things to use
      p.counter(p.right - 2.6, p.front - 2.4, 2.8, '#e8d8a8', '#3a2418', type === 'casino' || type === 'boatclub' ? 'The bar' : 'The front counter', { till: true });
      for (let k = 0; k < Math.floor((p.w - 4) / 1.6); k++) {
        const x = p.left + 1.4 + k * 1.6;
        if (type === 'arcade') { p.solid(x, p.back + 0.5, 0.8, 0.8, 1.8, 'plastic', ['#7a3aff', '#ff3a7a', '#3affd0'][k % 3]); p.box(x, p.back + 0.92, 0.6, 0.02, 0.45, 'screen', '#c8f0ff', 1.1); p.stand(x, p.back + 1.5, 0); }
        else if (type === 'casino') { p.solid(x, p.back + 0.5, 0.7, 0.7, 1.6, 'metal', '#c9a64a'); p.box(x, p.back + 0.87, 0.5, 0.02, 0.4, 'screen', '#ffe08a', 1.0); p.stand(x, p.back + 1.4, 0); }
        else if (type === 'gym') { p.solid(x, p.back + 1.0, 0.8, 1.8, 0.25, 'plastic', '#2a2a2a'); p.box(x, p.back + 0.3, 0.7, 0.1, 1.2, 'metal', '#6a6e74', 0.25); p.places.push({ x, z: p.back + 1.0, face: 0, pose: 'idle' }); }
        else { p.solid(x, p.back + 0.5, 1.2, 0.8, 1.0, 'wood', '#6a4a30'); p.stand(x, p.back + 1.3, 0); }
      }
      if (type === 'casino') { p.table(-1, 1, 2.4, 1.3, '#1a5a2a'); for (const dx of [-0.8, 0, 0.8]) p.chair(-1 + dx, 1.85, 0, '#5a1a24'); p.posts.push({ x: -1, z: 0.1, face: Math.PI, pose: 'idle' }); }
    }
    for (let x = -p.w / 3; x <= p.w / 3 + 0.01; x += p.w / 3) p.light(x, 0, type === 'cinema' ? 0.5 : 1.1, '#ffe6c0');
  },

  civic(p, type) {
    if (type === 'church' || type === 'temple') {
      const altarZ = p.back + 1.4;
      p.solid(0, altarZ, 3, 1.2, 0.3, 'stone', '#d8d0c0');
      p.solid(0, altarZ, 1.8, 0.7, type === 'church' ? 1.0 : 0.6, type === 'church' ? 'stone' : 'darkwood', type === 'church' ? '#e8e0d0' : '#8a3a1a', 0.3);
      for (const dx of [-0.6, 0.6]) { p.box(dx, altarZ, 0.08, 0.08, 0.35, 'metal', '#c8a050', 1.3); p.box(dx, altarZ, 0.04, 0.04, 0.12, 'glow', '#ffd080', 1.65); }
      p.light(0, altarZ + 0.6, 0.8, '#ffc880', 2.4);
      p.posts.push({ x: 0, z: altarZ - 0.9, face: 0, pose: 'idle' });
      if (type === 'church') {
        const rows = Math.max(3, Math.floor((p.d - 6) / 1.2));
        for (let r = 0; r < rows; r++) for (const side of [-1, 1]) p.bench(side * (p.w / 4 + 0.3), altarZ + 2.4 + r * 1.2, p.w / 2 - 1.8, 0, '#5a3a24');
        // stained glass down both sides
        for (let k = 0; k < 3; k++) for (const sx of [-1, 1]) p.box(sx * (p.w / 2 - 0.05), altarZ + 2 + k * 2.4, 0.04, 1.0, 2.4, 'screen', ['#c84a3a', '#3a6ac8', '#e8b83a'][k], 1.8);
      } else {
        p.rug(0, 1, p.w - 3, p.d - 5, '#8a2a2a');
        for (let k = 0; k < 6; k++) p.places.push({ x: -2 + (k % 3) * 2, z: 1 + Math.floor(k / 3) * 1.6, face: 0, pose: 'sit' });
        for (const sx of [-1, 1]) p.box(sx * 1.6, altarZ, 0.12, 0.12, 0.2, 'glow', '#ffb040', 0.9);
      }
    } else {
      // town hall chamber or courtroom: a reception desk by the door, the bench at the back, seats facing it
      p.counter(p.right - 2.6, p.front - 2.2, 2.4, '#ece4d4', '#5a3a24', 'The front desk', { till: true });
      p.solid(0, p.back + 1.3, 4.4, 1.1, 1.1, 'darkwood', '#4a2a1a');
      p.box(0, p.back + 1.3, 4.6, 1.2, 0.06, 'darkwood', '#3a2010', 1.1);
      for (const dx of [-1.2, 0, 1.2]) p.posts.push({ x: dx, z: p.back + 0.5, face: 0, pose: 'sit' });
      p.box(0, p.back + 0.06, 1.6, 0.04, 1.0, 'fabric', type === 'courthouse' ? '#2a3a5a' : '#7a2a2a', 2.4);
      p.signs.push({ text: type === 'courthouse' ? 'COURT IN SESSION' : 'COUNCIL CHAMBER', x: 0, y: 3.6, z: p.back + 0.08, w: 3, h: 0.45, ry: 0, bg: '#3a2010', fg: '#e0c070' });
      const rows = Math.max(2, Math.floor((p.d - 7) / 1.3));
      for (let r = 0; r < rows; r++) for (const side of [-1, 1]) p.bench(side * (p.w / 4 + 0.3), p.back + 3.6 + r * 1.3, p.w / 2 - 2, 0, '#5a3a24');
    }
    for (let x = -p.w / 3; x <= p.w / 3 + 0.01; x += p.w / 3) for (const z of [-p.d / 4, p.d / 4]) p.light(x, z, 1.0, '#ffe8c8');
  },
};

/** is (x, z) inside the room and clear of the furniture, for a body of radius `r`? */
export function walkable(L: Layout, x: number, z: number, r = 0.28): boolean {
  if (x < -L.w / 2 + r || x > L.w / 2 - r || z < -L.d / 2 + r || z > L.d / 2 - r) return false;
  for (const s of L.solids) if (x > s.x0 - r && x < s.x1 + r && z > s.z0 - r && z < s.z1 + r) return false;
  return true;
}

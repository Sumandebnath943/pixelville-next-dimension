/* ============================================================
   Credits: the one list of every model the game ships, who made
   it, where it lives and under what licence, written out as
   public/models/credits.json (read by the in-game Credits
   screen) and public/models/CREDITS.md (for anyone reading the
   files). Names are as each creator's listing shows them; where
   a file named its author differently when it was downloaded,
   that name is given too. Each Sketchfab model is CC BY 4.0,
   which asks for the title, the creator, a link, the licence,
   and a note of what was changed; a model built on someone
   else's carries their credit as well.
   Usage: node scripts/credits.mjs
   ============================================================ */
/* global console */
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../public/models');
const ISSUES = 'https://github.com/Sumandebnath943/pixelville-next-dimension/issues';
const CCBY = { license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/' };
const SF = (slug) => `https://sketchfab.com/3d-models/${slug}`;
const ME = (user) => `https://sketchfab.com/${user}`;

const VEH = 'Converted for the game: fewer triangles in three levels of detail, textures resized and packed into one, the body paint made recolourable.';
const ANI = "Converted for the game: re-rigged onto the game's own skeleton and animated by the game, fewer triangles in three levels of detail, textures resized and packed into one.";
const zhab = (title, slug, use) => ({ use, title, author: 'Daniel Zhabotinsky', user: 'DanielZhabotinsky', url: SF(slug), ...CCBY, changes: VEH });

const vehicles = [
  zhab("Ace '11 - Low Poly model", 'ace-11-low-poly-model-055ff8a21b8d4d279debca089e2fafcd', 'Hatchback'),
  zhab("Sigil '07 - Low poly model", 'sigil-07-low-poly-model-22abe5284d4c4b55920b8462eb24a8c1', 'Hatchback'),
  zhab("Compact '07 - Low poly model", 'compact-07-low-poly-model-25c6874d173a4f6ca63e150bbd505686', 'City car'),
  zhab("Kiri '10 - Low poly model", 'kiri-10-low-poly-model-7fd6e15785fa4aa9bfd6e31eb7c97ba6', 'Saloon'),
  zhab("Trinity '03 - Low Poly model", 'trinity-03-low-poly-model-32ac065960334899afc8ff6fbb2d79ee', 'Saloon'),
  zhab("Carter '98 - Low Poly Model", 'carter-98-low-poly-model-3af773617c7f481da2ba5d307412ce35', 'Older saloon'),
  zhab("Milano '95 - Low poly model", 'milano-95-low-poly-model-122a22d210234596ad23623588d0d166', 'Older hatchback'),
  zhab("Urban '10 - Low poly model", 'urban-10-low-poly-model-2866efdfa943484391ef8313768e074d', 'Small SUV'),
  zhab("Fairheaven SW '84 - Low poly model", 'fairheaven-sw-84-low-poly-model-aa0becb6e854422596cac6b21bf79787', 'Estate'),
  zhab("Conquer '89 Pickup - Low poly model", 'conquer-89-pickup-low-poly-model-6c48c94be8974dc7a5932f697c0ba68f', 'Pickup'),
  zhab("Urban '10 Cop Enforcer - Low poly model", 'urban-10-cop-enforcer-low-poly-model-745830362bb342128ef6509345606ffe', 'Police car'),
  zhab("Illinois '90 Taxi #1 - Low poly model", 'illinois-90-taxi-1-low-poly-model-72d91f4bce814818b3cd1f2de60f8ef2', 'Taxi'),
  zhab("Shvan '92 Ambulance - Low Poly model", 'shvan-92-ambulance-low-poly-model-2856dd3c61f940909dced9a5c0379484', 'Ambulance'),
  zhab("Shvan '92 - Low poly model", 'shvan-92-low-poly-model-09d718c9cf72401b8534d265a06a803f', 'Van'),
  zhab("Lightbody '90 MD Utility - Low poly model", 'lightbody-90-md-utility-low-poly-model-d3aca50a8f2b4917bb9f4ce2bf1ccfe5', 'Works van'),
  zhab("Lightbody '90 MD Tow Truck - Low poly model", 'lightbody-90-md-tow-truck-low-poly-model-5cba208001c64e8ea164f89e4dde91e7', 'Tow truck'),
  zhab("LCT 3000 '07- Low poly model", 'lct-3000-07-low-poly-model-3be03b6a43aa41898c9ca806b8787052', 'Delivery truck'),
  { use: 'Bus', title: 'City Bus - rigged | РоАЗ-5236', author: 'Yo.Ri', user: 'grox777', url: SF('city-bus-rigged-5236-36646fcf41da498ca24a02f4b6fb1d95'), ...CCBY, changes: `${VEH} Its shadow plane left out.` },
  { use: 'Fire engine', title: 'Firetruck', author: 'OzerGokmen', user: 'OzerGokmen', url: SF('firetruck-27a6b95f768d415282e2f5de48ba6d99'), ...CCBY, changes: VEH },
  { use: 'Tractor', title: 'Tractor sgw3', author: 'Ford mondeo', user: 'tnikita', was: 'mamont nikita (sketchfab.com/mamontnikita62)', url: SF('tractor-sgw3-38625f3e0fd0465bb7cc99de89590071'), ...CCBY, changes: VEH },
  { use: 'Moped', title: 'Piaggio SI Scooter', author: 'Tomaso', user: 'Tomasoo', url: SF('piaggio-si-scooter-fe75689a108744b7acf5003d677d4c8e'), ...CCBY, changes: VEH },
  { use: 'Bicycle', title: 'Classic Bicycle | LowPoly | Game ready', author: 'by__Rx', user: 'by__Rx', url: SF('classic-bicycle-lowpoly-game-ready-da6507928c0c4a5c8776008cdb9f747e'), ...CCBY, changes: VEH },
  { use: 'Locomotive', title: 'Metrolink EMD F59PH Diesel Locomotive', author: 'Trashbulldogproductions', user: 'Trashbulldogproductions', url: SF('metrolink-emd-f59ph-diesel-locomotive-be80b30df3294bd2acee4f219b36d378'), ...CCBY, changes: `${VEH} Repainted plain (blurred and greyed), so the railway's livery and name no longer show; its front logo left out.` },
  { use: 'Passenger railcar', title: 'Simple Italian Train 3D model', author: 'maryssoul24', user: 'maryssoul24', was: 'pasticcia (sketchfab.com/pasticciona)', url: SF('simple-italian-train-3d-model-2ce6f009744b4807a25ef5f7b4e36b8b'), ...CCBY, changes: VEH },
  { use: 'Freight wagon', title: 'Railway Boxcar Freight Wagon | Detailed 3D Model', author: 'saadthedesigner314', user: 'saadthedesigner314', url: SF('railway-boxcar-freight-wagon-detailed-3d-model-6cede42e50cc4042addfbedac1311551'), ...CCBY, changes: VEH },
  { use: 'Airliner', title: 'A320', author: 'manilov.ap', user: 'manilov.ap', url: SF('a320-ec28bdee6c944688a19bef31ea33437f'), ...CCBY, changes: `${VEH} Repainted plain (blurred and greyed), so the airline's livery and registration no longer show.` },
  { use: 'Helicopter', title: 'Cedric-EC135- Waving-190 Rotor', author: 'PatrickBiani', user: 'PatrickBiani', url: SF('cedric-ec135-waving-190-rotor-09fbae3edc0a44bea7dbb7ed7644df6b'), ...CCBY, changes: `${VEH} The rotor spun by the game; the figure in the cabin left out.` },
  { use: 'Rowing boat', title: 'Victorian Row Boat', author: 'Ashley Aslett', user: 'AshleyAslett', url: SF('victorian-row-boat-3e9093b6f0ce474da4d8cfea7e01f420'), ...CCBY, changes: VEH },
  { use: 'Motorboat', title: 'Small Motorboat', author: 'Tijmen Matthys', user: 'tijmenmatthys', was: 'Timon Matthews (sketchfab.com/timonmatthews)', url: SF('small-motorboat-b488d632a4804cd783e9ef009976bcd4'), ...CCBY, changes: VEH },
  {
    use: 'Yacht (the ferry)', title: 'Free Low Poly Yacth', author: 'GameAssetsFin', user: 'MarkoJantti', was: 'MarkoJantti', url: SF('free-low-poly-yacth-fafb7f55aeae460a8dbac92968a9a141'), ...CCBY, changes: VEH,
    note: 'Its creator describes it as their version of a free yacht model by SDC PERFORMANCE™️ (https://sketchfab.com/Lambo_SC04).',
  },
];

const by = (title, link, author) => ({ title, url: link, author, ...CCBY });
const animals = [
  { use: 'Dog: Labrador', title: 'Labrador Dog', author: 'kenchoo', user: 'kenchoo', url: SF('labrador-dog-1f56cfbab07e4fe49b5d9e521c82073a'), ...CCBY, changes: ANI, original: by('Dog', 'https://skfb.ly/oHLVz', 'all of life') },
  { use: 'Dog: golden retriever', title: 'Golden Retriever Dog', author: 'TriSams', user: 'trisams_', url: SF('golden-retriever-dog-996d7f56b3e64a4cbeca0434b5811632'), ...CCBY, changes: ANI },
  { use: 'Dog: chihuahua', title: 'Chihuahua', author: 'kenchoo', user: 'kenchoo', url: SF('chihuahua-63d89ce1b00f445b926668d19f559a76'), ...CCBY, changes: ANI, original: by('Dog', 'https://skfb.ly/oHVIu', 'Stephengury') },
  { use: 'Dog: bulldog puppy', title: 'Bullpuppy', author: 'kenchoo', user: 'kenchoo', url: SF('bullpuppy-50d66326f5d9458cbda747071dd61233'), ...CCBY, changes: ANI, original: by('Bulldog Mum & Puppy', 'https://skfb.ly/oQYDq', 'MightyGangsta13') },
  { use: 'Cat', title: 'Bicolor Cat', author: 'kenchoo', user: 'kenchoo', url: SF('bicolor-cat-e623a618ca344a8393d7ba4d63ec23cf'), ...CCBY, changes: ANI, original: by('3d modelling my cat: Fripouille', 'https://skfb.ly/6TKqH', 'guillaume bolis') },
  { use: 'Cow', title: 'Cow frame test', author: 'Nyilonelycompany', user: 'Nyilonelycompany', url: SF('cow-frame-test-c5782e43dcf442718a25b49bed00f582'), ...CCBY, changes: ANI },
  { use: 'Sheep', title: 'Sheep', author: 'kenchoo', user: 'kenchoo', url: SF('sheep-08b05ae799d947f1a68c49b2d661eb53'), ...CCBY, changes: ANI, original: by('Nz Inbred Sheep', 'https://skfb.ly/oMADr', 'MightyGangsta13') },
  { use: 'Horse', title: 'Horse Rigged(Game Ready)', author: 'abhayexe', user: 'abhayexe', url: SF('horse-riggedgame-ready-bc64f4ff7966474ca9bacd42fa73a754'), ...CCBY, changes: ANI },
  { use: 'Donkey', title: 'Realistic Animated Donkey 3D Model', author: 'WildMesh 3D', user: 'WildMesh_3D', url: SF('realistic-animated-donkey-3d-model-2b4086035df94d9e88fd0f18d34b3872'), ...CCBY, changes: `${ANI} Its saddle left off.` },
  { use: 'Deer', title: 'Realistic Animated Doe 3D Model', author: 'WildMesh 3D', user: 'WildMesh_3D', url: SF('realistic-animated-doe-3d-model-b6172618aa304473a4cf7b9246c0a218'), ...CCBY, changes: ANI },
  { use: 'Hare', title: 'Hare (animated)', author: 'bluekiwi.dog', user: 'bluekiwi.dog', url: SF('hare-animated-948938cd237d49a9868662213fa05543'), ...CCBY, changes: ANI },
  { use: 'Lion', title: 'realistic Lion 3d model', author: 'Tarun.Teja', user: 'Tarun.Teja', url: SF('realistic-lion-3d-model-6da45f5d5a9f4733b195c6f03c92d33c'), ...CCBY, changes: ANI },
  { use: 'Elephant', title: 'African Elephant', author: 'jimmyho905', user: 'jimmyho905', url: SF('african-elephant-b960467b14f34cfc84feeb3361a21f54'), ...CCBY, changes: ANI },
  { use: 'Zebra', title: 'Zebra - Rigged', author: 'Noa Seller', user: 'NoaSeller', url: SF('zebra-rigged-5d6ff2749afc438b9989f91ecb242574'), ...CCBY, changes: ANI },
  { use: 'Pigeon', title: 'Pigeon', author: 'kenchoo', user: 'kenchoo', url: SF('pigeon-ddd5ef4a94eb4159937a9de25c45697c'), ...CCBY, changes: ANI, original: by('Pigeon #1', 'https://skfb.ly/oQsJv', '₦₥₵ ฿₵') },
  { use: 'Duck', title: 'Mallard Duck (Male)', author: 'ucdavisterc', user: 'ucdavisterc', url: SF('mallard-duck-male-16c14682b3414f34b26bf4d558d40a0f'), ...CCBY, changes: ANI },
  { use: 'Penguin', title: 'African penguin (Spheniscus demersus) Low poly', author: 'Major', user: 'majorgalah', url: SF('african-penguin-spheniscus-demersus-low-poly-9e59070815fe451d93398e2ebdb9bb92'), ...CCBY, changes: ANI },
  { use: 'Butterfly', title: 'Animated Flying Fluttering Butterfly Loop', author: 'LasquetiSpice', user: 'LasquetiSpice', url: SF('animated-flying-fluttering-butterfly-loop-80f8d9a6dadc411e89ca366cb0cfb0d9'), ...CCBY, changes: ANI },
];

const people = [{
  use: 'The villagers and the Founder (45 characters)', title: 'Microsoft Rocketbox Avatar Library', author: 'Microsoft', url: 'https://github.com/microsoft/Microsoft-Rocketbox',
  license: 'MIT', licenseUrl: 'people/LICENSE-Rocketbox.md',
  changes: "Converted for the game: re-rigged onto the game's own skeleton, fewer triangles in three levels of detail, textures resized, clothes made recolourable; weapons left out.",
}];

const contact = `Missed a credit, or got one wrong? Made one of these models and want it changed or taken out? Please open an issue at ${ISSUES} and we'll put it right.`;
const data = { contact, issues: ISSUES, groups: [{ name: 'People', items: people }, { name: 'Vehicles', items: vehicles }, { name: 'Animals', items: animals }] };
for (const g of data.groups) for (const it of g.items) if (it.user) it.profile = ME(it.user);
writeFileSync(join(OUT, 'credits.json'), JSON.stringify(data, null, 1) + '\n');

/* the same, to read */
const md = [
  '# Credits for the models',
  '',
  "PixelVille's people, vehicles and animals are built from models their creators shared for anyone to use. Thank you to every one of them.",
  '',
  `> ${contact}`,
  '',
  'Every Sketchfab model below is licensed under the [Creative Commons Attribution 4.0 International licence](https://creativecommons.org/licenses/by/4.0/) (CC BY 4.0). All of them were changed to fit the game, as each entry says; none of their creators endorses PixelVille. The Microsoft Rocketbox characters are under the MIT licence, whose full text is in [people/LICENSE-Rocketbox.md](people/LICENSE-Rocketbox.md).',
  '',
];
for (const g of data.groups) {
  md.push(`## ${g.name}`, '');
  for (const it of g.items) {
    const who = it.profile ? `[${it.author}](${it.profile})` : it.author;
    md.push(`- **${it.use}**: "[${it.title}](${it.url})" by ${who}, licensed under [${it.license}](${it.licenseUrl}).${it.was ? ` (The downloaded file names its author ${it.was}.)` : ''}`);
    if (it.original) md.push(`  - Built on "[${it.original.title}](${it.original.url})" by ${it.original.author}, licensed under [${it.original.license}](${it.original.licenseUrl}).`);
    if (it.note) md.push(`  - ${it.note}`);
    md.push(`  - ${it.changes}`);
  }
  md.push('');
}
writeFileSync(join(OUT, 'CREDITS.md'), md.join('\n'));
console.log(`credits: ${data.groups.map((g) => `${g.items.length} ${g.name.toLowerCase()}`).join(', ')}`);

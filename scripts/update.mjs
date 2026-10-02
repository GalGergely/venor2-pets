// Lekéri a wiki item-listáját, kiszűri a petket, és pets.json-ba menti.
// Csak akkor ír, ha tényleg változott a lista.
import { readFile, writeFile } from 'node:fs/promises';

const API_URL = process.env.API_URL || 'https://wiki.venor2.hu/api/items?locale=hu';
const OUT = 'pets.json';

const res = await fetch(API_URL, {
  headers: {
    Accept: 'application/json',
    'User-Agent': 'Mozilla/5.0 (compatible; venor2-pet-tracker)',
  },
});
if (!res.ok) {
  console.error(`A wiki API hibát adott: HTTP ${res.status}`);
  process.exit(1);
}

const body = await res.json();
// Lehet sima tömb, vagy egy objektumba csomagolt tömb is.
const items = Array.isArray(body) ? body : Object.values(body).find(Array.isArray);
if (!items) {
  console.error('A válaszban nem találtam item-tömböt.');
  process.exit(1);
}

const pets = items
  .filter((i) => i.type === 'ITEM_COSTUME' && i.sub_type === 'COSTUME_PET')
  .map((i) => ({
    vnum: i.vnum,
    name: i.name,
    localeName: i.locale_name || i.name,
  }))
  .sort((a, b) => a.vnum - b.vnum);

if (pets.length === 0) {
  // Ne írjuk felül a meglévő listát üressel – inkább álljunk meg és mutassuk meg, mit találtunk.
  const combos = new Map();
  for (const i of items) {
    if (String(i.type).includes('COSTUME') || String(i.sub_type).includes('PET')) {
      const k = `${i.type} / ${i.sub_type}`;
      combos.set(k, (combos.get(k) || 0) + 1);
    }
  }
  console.error('Nem találtam petet (type=ITEM_COSTUME, sub_type=COSTUME_PET).');
  console.error('Hasonló típusok a válaszban:', Object.fromEntries(combos));
  process.exit(1);
}

let previous = [];
try {
  previous = JSON.parse(await readFile(OUT, 'utf8')).pets ?? [];
} catch {}

if (JSON.stringify(previous) === JSON.stringify(pets)) {
  console.log(`Nincs változás (${pets.length} pet).`);
  process.exit(0);
}

const before = new Set(previous.map((p) => p.vnum));
const added = pets.filter((p) => !before.has(p.vnum));
await writeFile(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), pets }, null, 2) + '\n');
console.log(`Mentve: ${pets.length} pet.` + (added.length ? ` Új: ${added.map((p) => p.localeName).join(', ')}` : ''));

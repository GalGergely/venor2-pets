# Venor2 petgyűjtemény

Csempés oldal a wiki petjeiről. Kattintásra kipipálható, melyiket szerezted meg (a pipák a böngésződben mentődnek).

## Üzembe helyezés
1. Hozz létre egy GitHub repót, és töltsd fel ide az `index.html`-t.
2. Settings → Pages → Source: "Deploy from a branch", branch `main`, mappa `/ (root)`.
3. Az oldal címe: `https://<felhasználónév>.github.io/<repó-név>/`

## Adatok (a wiki a GitHub szervereinek nem válaszol, ezért kézzel töltöd fel)
1. Nyisd meg böngészőben, és mentsd el (Ctrl+S) mindkettőt:
   - https://wiki.venor2.hu/api/items?locale=hu  → mentsd **`items.json`** néven
   - https://wiki.venor2.hu/api/icon-manifest    → mentsd **`icon-manifest.json`** néven
2. Töltsd fel a két fájlt a repó főmappájába (az `index.html` mellé).
3. Az oldal innentől automatikusan betölti őket, és eltűnik a kézi betöltő gomb.

Ha új pet jelenik meg a játékban, töltsd fel újra az `items.json`-t (és az `icon-manifest.json`-t), és felülírod a régit.

## Beállítások
Az `index.html` tetején, a `<script>` elején: `WIKI_ITEM_URL` (a pet wiki-oldalának címe), `ITEMS_FILES` / `MANIFEST_FILES` (a fájlnevek).

# Venor2 petgyűjtemény

Csempés oldal a wiki petjeiről. Kattintásra kipipálható, melyiket szerezted meg (a pipák a böngésződben mentődnek).
A lista frissítését maga az oldal végzi: megnyitáskor, legfeljebb óránként egyszer lekéri a wiki API-t a böngészőből (a wiki a GitHub szervereiről nem érhető el).

## Üzembe helyezés
1. Hozz létre egy új GitHub repót, és töltsd fel ide a fájlokat (a `.github` mappával együtt).
2. Repo → Settings → Pages → Source: "Deploy from a branch", branch: `main`, mappa: `/ (root)`.
3. Az oldal címe: `https://<felhasználónév>.github.io/<repó-név>/`

Ha a böngészős lekérés nem megy (a wiki nem engedi), töltsd be egyszer kézzel: mentsd el fájlba mindkét API-választ (https://wiki.venor2.hu/api/items?locale=hu és https://wiki.venor2.hu/api/icon-manifest, Ctrl+S), majd az oldalon a „Betöltés mentett wiki-fájlokból” gombbal válaszd ki mindkét fájlt egyszerre. A képeket a böngésződ közvetlenül a wikiről tölti be.
Az Actions workflow (`update.yml`) nem kötelező, a wiki a GitHub szervereinek nem válaszol, nyugodtan törölheted a `.github` mappát.

## Beállítások
Az `index.html` tetején a `<script>` elején: `WIKI_ITEM_URL` (a pet wiki-oldalának címe), `MANIFEST_URL` és `ICON_BASE` (a képek forrása).

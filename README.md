# Venor2 petgyűjtemény

Csempés oldal a wiki petjeiről. Kattintásra kipipálható, melyiket szerezted meg (a pipák a böngésződben mentődnek).
Óránként egy GitHub Actions workflow frissíti a `pets.json`-t a wiki API-ból.

## Üzembe helyezés
1. Hozz létre egy új GitHub repót, és töltsd fel ide a fájlokat (a `.github` mappával együtt).
2. Repo → Settings → Pages → Source: "Deploy from a branch", branch: `main`, mappa: `/ (root)`.
3. Repo → Actions → "Update pets" → "Run workflow" (egyszer kézzel, hogy megjelenjen az első lista).
4. Az oldal címe: `https://<felhasználónév>.github.io/<repó-név>/`

## Beállítások
Az `index.html` tetején a `<script>` elején: `WIKI_ITEM_URL` (a pet wiki-oldalának címe), `ICON_URL` (képek, ha van forrásuk).

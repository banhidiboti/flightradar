# FlightWatch

Tisztán kliensoldali, teljes képernyős repülő-radar. Élőben mutatja a
Magyarország felett tartózkodó gépeket egy sötét Leaflet térképen (OpenSky
Network adatokkal), és böngésző-értesítést (`window.Notification`) küld,
amikor egy gép belép egy általad kijelölt figyelő zónába (kör a térképen) a
megadott magassági korlát alatt. Nincs saját backend-szerver, nincs service
worker — a statikus fájlok GitHub Pages-ről (vagy bármilyen statikus
hostingról) futnak.

## Miért van mégis egy "worker" mappa, ha ez pure frontend?

Az OpenSky `states/all` végpontja **nem küld CORS fejlécet** más domainek
felé — kizárólag a saját `opensky-network.org` oldaláról engedi a böngészős
`fetch()` hívásokat. Ha a GitHub Pages oldal közvetlenül hívná, a böngésző
CORS hibával blokkolná a választ, függetlenül attól, mennyire jó a kód.

A megoldás egy pár soros, ingyenes **Cloudflare Worker**, ami:
- továbbítja a kérést az OpenSky felé,
- hozzáadja a hiányzó CORS fejlécet,
- opcionálisan becsatolja az OAuth2 bearer tokent a magasabb napi kvótához.

A GitHub Pages rész így is 100%-ban statikus marad (HTML/CSS/JS, build nélkül),
csak az adatlekérés egy vékony proxyn megy át.

## Miért OpenStreetMap csempe "sötét" szűrővel, nem CartoDB Dark Matter?

A klasszikus ingyenes CartoDB Dark Matter raster végpont (`basemaps.cartocdn.com`)
mára API kulcsot igényel — kulcs nélkül egy "API KEY REQUIRED" vízjeles
placeholder csempét ad vissza (HTTP 200-cal, tehát csendben, hibaüzenet
nélkül bukik el). Hogy az app kulcs/regisztráció nélkül is azonnal működjön
GitHub Pages-en, helyette szabvány OpenStreetMap csempéket tölt be, és egy
CSS `filter: invert(...)` trükkel (`css/style.css`, `.leaflet-tile-pane`)
alakítja sötét témára. Ha mégis valódi CARTO Dark Matter csempét akarsz:
kérj ingyenes API kulcsot a [carto.com](https://carto.com/)-on, és cseréld
ki a `DARK_TILE_URL`-t a [js/mapView.js](js/mapView.js) elején (a komment ott
tartalmazza a pontos URL-mintát), majd vedd ki a CSS filtert.

## Projektstruktúra

```
index.html              # teljes képernyős térkép + overlay panelek
css/style.css           # stílus (sötét térkép-filter, overlay panelek, gép-ikonok)
js/
  config.js             # localStorage-ban tárolt beállítások, Magyarország bbox, validáció
  geo.js                 # haversine távolság, bounding box számítás
  openskyClient.js       # proxy hívása, timeout/hibakezelés, state vector parse
  zoneTracker.js         # zóna-állapot (Map), edge-trigger (csak belépéskor riaszt)
  notifications.js       # Notification API wrapper
  mapView.js              # Leaflet térkép: gép-markerek, forgatás, lágy animáció, geofence kör, útvonalvonal
  flightLookup.js        # adsbdb.com lekérdezés: géptípus + honnan/hová (csak kattintásra)
  ui.js                  # overlay DOM renderelés (vezérlőpanel, státuszsor, oldalsáv)
  main.js                # összekötés: poll ciklus, zóna-áthelyezés, gombok, állapot
worker/
  worker.js              # Cloudflare Worker: CORS proxy + opcionális OAuth2
  wrangler.toml          # Wrangler CLI konfig (dashboard-ból is telepíthető)
```

## 1. lépés — Cloudflare Worker telepítése (adatlekérő proxy)

Ez adja a `proxyUrl`-t, amit a vezérlőpanelen be kell majd írni.

**Dashboardon keresztül (legegyszerűbb, kód nélkül):**
1. Regisztrálj / lépj be a [Cloudflare dashboardra](https://dash.cloudflare.com/) — ingyenes.
2. *Workers & Pages → Create → Create Worker*.
3. Adj neki egy nevet (pl. `flightwatch-proxy`), majd *Deploy*.
4. *Edit code*, és másold be a [worker/worker.js](worker/worker.js) teljes tartalmát a sablon helyére.
5. *Deploy*. A Worker URL-je valami ilyen lesz: `https://flightwatch-proxy.<account>.workers.dev`.

**Wrangler CLI-vel (opcionális, verziókövetéshez):**
```bash
cd worker
npm install -g wrangler
wrangler login
wrangler deploy
```

### Opcionális, de ajánlott: magasabb napi kvóta (OpenSky OAuth2)

Az app 10–15 másodpercenként kér le adatot egész Magyarország területére.
Anonim OpenSky hozzáféréssel a napi kvóta szűk (kb. 400 credit/nap — 12
másodperces alapértelmezett pollozással ez kb. **80 percnyi** folyamatos
működést fedez, utána a lekérések elkezdenek hibázni, amíg újra nem nyílik a
kvóta). Ha regisztrált OpenSky fiókkal akarsz egész napos lefedettséget:

1. Hozz létre fiókot az [opensky-network.org](https://opensky-network.org) oldalon.
2. A fiók beállításaiban (*Account → API Client*) generálj egy API klienst — ez ad egy `client_id` és `client_secret` párt (2025 márciusa óta OpenSky OAuth2 client-credentials flow-t használ, a régi felhasználónév/jelszavas auth megszűnt).
3. A Cloudflare dashboardon: *Worker → Settings → Variables and Secrets*:
   - `OPENSKY_CLIENT_ID` — sima változóként,
   - `OPENSKY_CLIENT_SECRET` — **Secret** típusként.
4. Opcionálisan állítsd be `ALLOWED_ORIGIN`-t a saját GitHub Pages URL-edre
   (pl. `https://felhasznalonev.github.io`), hogy ne engedj CORS-t más
   domainekről. Alapértelmezetten `*`.
5. Mentés után a Worker automatikusan bearer tokent kér és azt küld tovább az
   OpenSky felé.

## 2. lépés — Az app használata

**Helyi teszteléshez:** nyisd meg az `index.html`-t egy statikus szerveren
(ES modulokat a böngésző nem tölt be `file://`-ról, kell egy egyszerű local
szerver):
```bash
npx serve .
# vagy: python -m http.server 8080
```

**A felületen:**
- A térkép alapértelmezetten Magyarországra fókuszál.
- Jobb felül a **vezérlőpanelen** (fogaskerék ikonnal nyitható/csukható):
  - *Proxy URL* — illeszd be a Worker URL-jét (ez nyitja meg a figyelést engedélyező gombot).
  - *Zóna lat/lon* — a figyelő zóna középpontja (alapértelmezett: Pomáz környéke). Ezt kézzel is beírhatod, vagy **kattints a térképre** — a zóna oda ugrik, a kör azonnal frissül, és azonnal mentésre is kerül.
  - *Hatósugár (km)*, *Magassági korlát (m)*, *Frissítés (mp, min. 10)*.
  - *Böngésző-értesítések* kapcsoló — rákattintva kéri a böngésző engedélyét.
  - *Mentés* — localStorage-ba ír, *Figyelés indítása* — elindítja a poll ciklust.
- Felül középen egy **státuszsor** mutatja az aktív gépek számát Magyarország felett, az utolsó frissítés idejét, a következő frissítésig hátralévő időt és az esetleges hibát.
- Minden Magyarország felett látott gép **sárga repülő-ikonként** jelenik meg, a haladási iránynak (heading) megfelelően elforgatva; fölé húzva a hívójel jelenik meg.
- Amikor egy gép a **zónán belülre ÉS a magassági korlát alá** kerül, az ikonja **pirosra vált és pulzál**, és — csak a belépés pillanatában, edge-trigger logikával — böngésző-értesítést kapsz (hívójel, ICAO24, magasság, sebesség, távolság).
- Egy gépre kattintva bal felül kinyílik a **részletek panel** (hívójel, légitársaság, géptípus, ICAO24, magasság m/ft, sebesség km/h, emelkedés/süllyedés m/s, irány fok, távolság a zónától, induló/célrepülőtér), és egy gombbal átugorhatsz a géphez a Flightradar24-en.
- A géptípust és az induló/célrepülőteret a kattintás pillanatában, külön kérésre a [adsbdb.com](https://api.adsbdb.com) ingyenes, kulcs nélküli adatbázisából kérdezi le (nem a proxyn/OpenSkyn keresztül, és nem minden pollozási ciklusban — csak a kijelölt gépre). Sok géphez (magán-, katonai, azonosítatlan járat) nincs találat, ilyenkor "ismeretlen" jelenik meg.
- Ha talál útvonalat, a térképen egy **egyenes vonallal közelített útvonal** jelenik meg: folytonos kék vonal az induló repülőtértől a gép jelenlegi pozíciójáig, szaggatott zöld vonal onnan a célrepülőtérig. Ez *nem* a ténylegesen repült útvonal (ahhoz OpenSky megbízható, hitelesített hozzáférés nélkül nem ad historikus track adatot), hanem egy egyszerűsített, egyenes közelítés — de a kijelölt gép mozgásával együtt frissül.

## 3. lépés — Telepítés GitHub Pages-re

1. Hozz létre egy GitHub repót, és töltsd fel ezt a mappát (a `worker/`
   mappa is mehet bele, az csak dokumentáció/forrás, GitHub Pages nem futtatja).
2. Repo *Settings → Pages → Build and deployment → Source: Deploy from a
   branch*, válaszd a `main` branch-et és a gyökér (`/`) mappát.
3. Néhány percen belül elérhető lesz: `https://felhasznalonev.github.io/repo-nev/`.
4. Nyisd meg, állítsd be a Worker URL-t és a zónát, engedélyezd az
   értesítéseket, indítsd el a figyelést.

## Korlátok, amikről tudni kell

- **Nincs service worker** — a specifikáció szerint szándékosan sima
  `Notification` API-t használunk. Ez azt jelenti, hogy az értesítések csak
  addig működnek, amíg a lap (tab) nyitva van a böngészőben; ha bezárod a
  tabot, a figyelés is leáll.
- **API kvóta** — anonim OpenSky hozzáféréssel egész Magyarországot lefedő,
  12 mp-es pollozással kb. 80 percnyi folyamatos működésre elég egy nap
  alatt. OAuth2 klienssel (fentebb leírva) ez jelentősen nagyobb — egész
  napos folyamatos figyeléshez ez ajánlott.
- **`geo_altitude` hiányozhat** — ha egy adott gépnél `null`, a kód a
  `baro_altitude`-ra esik vissza; ha mindkettő `null`, vagy a gép a földön
  van (`on_ground`), a gépet kihagyjuk a térképi megjelenítésből is (nem
  tudjuk megállapítani a magasságát).
- **HTTPS szükséges** — a `Notification.requestPermission()` csak HTTPS
  (vagy `localhost`) felől működik; GitHub Pages ezt alapból biztosítja.
- **Sötét térkép = CSS filter, nem valódi sötét csempekészlet** — lásd
  fentebb; ingyenes és kulcs nélküli, de egy valódi dark-mode tile szettnél
  (pl. fizetős/regisztrált CARTO) kontrasztosabb/részletesebb eredményt kapnál.

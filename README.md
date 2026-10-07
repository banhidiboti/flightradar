# FlightWatch

Tisztán kliensoldali, teljes képernyős repülő-radar. Élőben mutatja a
Magyarország felett tartózkodó gépeket egy sötét Leaflet térképen (adsb.lol
élő ADS-B adataival), és böngésző-értesítést (`window.Notification`) küld,
amikor egy gép belép egy általad kijelölt figyelő zónába (kör a térképen) a
megadott magassági korlát alatt. Nincs saját backend-szerver, nincs service
worker — a statikus fájlok GitHub Pages-ről (vagy bármilyen statikus
hostingról) futnak.

## Miért van mégis egy "worker" mappa, ha ez pure frontend?

Egyetlen ingyenes ADS-B API sem küld CORS fejlécet akárhonnan hívható
böngészős `fetch()`-hez (sem az OpenSky, sem az adsb.lol, sem a többi
tesztelt alternatíva) — mindegyik közvetlen böngészős hívása CORS hibával
elbukna, függetlenül attól, mennyire jó a frontend kód.

A megoldás egy pár soros, ingyenes **Cloudflare Worker**, ami:
- továbbítja a kérést az adsb.lol felé,
- hozzáadja a hiányzó CORS fejlécet,
- röviden (8 mp) gyorsítótárazza a választ Cloudflare edge-en, hogy ha a
  megosztott Worker URL-t többen egyszerre használják, ne szorozódjon az
  upstream kérések száma a látogatók számával.

A GitHub Pages rész így is 100%-ban statikus marad (HTML/CSS/JS, build nélkül),
csak az adatlekérés egy vékony proxyn megy át.

### Miért adsb.lol, nem OpenSky Network?

Eredetileg OpenSky-t használta a proxy, de kiderült, hogy az OpenSky
szervere ~20 másodpercig lógva hagyja, majd némán eldobja a Cloudflare
Workerek hálózatából érkező valódi adatlekérést — miközben egy sima
szerverről/gépről azonnal, hibátlanul válaszol ugyanarra a lekérdezésre.
(Nagy valószínűséggel szándékosan szűri a nagy felhő-/CDN-szolgáltatók IP-
tartományait.) Emiatt a proxy adsb.lol-t hívja helyette: ez kifejezetten
ilyen beágyazott/proxyzott használatra szánt, ingyenes, regisztráció és API
kulcs nélküli szolgáltatás, és bónuszként a géptípust is közvetlenül adja
(nem kell hozzá külön lekérdezés).

Egy dolog, amire figyelni kell: adsb.lol **elutasítja a túl általános/hiányzó
User-Agent fejlécű kéréseket** ("too generic; include valid contact info").
A Cloudflare Worker `fetch()`-e alapból nem küld User-Agentet, ezért a
worker.js explicit beállít egyet (`FlightWatch/1.0 (+https://...)`) — ha
forkolod a projektet, érdemes ezt lecserélni a saját repód/kontaktod URL-jére.

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
  adsbClient.js          # proxy hívása, timeout/hibakezelés, adsb.lol válasz parse
  zoneTracker.js         # zóna-állapot (Map), edge-trigger (csak belépéskor riaszt)
  notifications.js       # Notification API wrapper
  mapView.js              # Leaflet térkép: gép-markerek, forgatás, lágy animáció, geofence kör, útvonalvonal
  flightLookup.js        # adsbdb.com lekérdezés: honnan/hová (csak kattintásra)
  ui.js                  # overlay DOM renderelés (vezérlőpanel, státuszsor, oldalsáv)
  main.js                # összekötés: poll ciklus, zóna-áthelyezés, gombok, állapot
worker/
  worker.js              # Cloudflare Worker: adsb.lol CORS proxy + 8mp edge-cache
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

### Opcionális: saját domainre szűkített CORS

Nem kötelező, de ha a Worker URL-edet csak a saját GitHub Pages oldalad
használja (nem osztod meg másokkal), érdemes beállítani:
- A Cloudflare dashboardon: *Worker → Settings → Variables and Secrets* →
  `ALLOWED_ORIGIN` = `https://felhasznalonev.github.io` (alapértelmezetten
  `*`, azaz bárhonnan hívható).

Nincs szükség API kulcsra vagy fiókra sem adsb.lol, sem az útvonal-
lekérdezéshez használt adsbdb.com oldalán — mindkettő szabadon, regisztráció
nélkül hívható.

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
- Egy gépre kattintva bal felül kinyílik a **részletek panel** (hívójel, géptípus + lajstromjel, ICAO24, magasság m/ft, sebesség km/h, emelkedés/süllyedés m/s, irány fok, távolság a zónától, légitársaság, induló/célrepülőtér), és egy gombbal átugorhatsz a géphez a Flightradar24-en.
- A géptípus azonnal, a már letöltött élő adatból jelenik meg. Az induló/célrepülőteret a kattintás pillanatában, külön kérésre a [adsbdb.com](https://api.adsbdb.com) ingyenes, kulcs nélküli adatbázisából kérdezi le (nem a proxyn keresztül, és nem minden pollozási ciklusban — csak a kijelölt gépre). Sok géphez (magán-, katonai, azonosítatlan járat) nincs találat, ilyenkor "ismeretlen" jelenik meg.
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
- **Megosztott rate limit** — ha a Worker URL-edet mindenki ugyanazon az
  oldalon használja (ez az alapértelmezett összeállítás), mindenki ugyanazt
  az adsb.lol kvótát osztja. A Worker 8 mp-es edge-cache-e ez ellen sokat
  segít (egyszerre érkező kérések egy közös upstream hívást osztanak meg),
  de nagyon sok egyidejű látogatónál elvileg még mindig előfordulhat átmeneti
  429-es hiba — ez magától helyreáll, a következő pollozási ciklusban.
- **Magasság hiányozhat** — ha egy adott gépnél sem `alt_geom`, sem
  `alt_baro` nem szám (pl. adatkiesés), vagy a gép a földön van, a gépet
  kihagyjuk a térképi megjelenítésből is (nem tudjuk megállapítani a
  magasságát).
- **HTTPS szükséges** — a `Notification.requestPermission()` csak HTTPS
  (vagy `localhost`) felől működik; GitHub Pages ezt alapból biztosítja.
- **Sötét térkép = CSS filter, nem valódi sötét csempekészlet** — lásd
  fentebb; ingyenes és kulcs nélküli, de egy valódi dark-mode tile szettnél
  (pl. fizetős/regisztrált CARTO) kontrasztosabb/részletesebb eredményt kapnál.

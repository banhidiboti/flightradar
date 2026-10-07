/**
 * Cloudflare Worker CORS proxy for free, keyless community ADS-B APIs.
 *
 * Why this exists: a static GitHub Pages frontend can't call these APIs
 * directly - none of them send CORS headers, so the browser would block
 * a direct fetch() regardless of how the frontend code is written. This
 * worker sits in between, forwards the query, and adds the CORS header
 * the frontend needs.
 *
 * This used to proxy OpenSky Network instead. Switched away from it
 * because OpenSky silently stalls (~20s, then nothing) any real data
 * request that originates from Cloudflare's network specifically - it
 * answers the same query instantly from an ordinary residential/dev IP,
 * so it's very likely filtering well-known cloud/CDN egress ranges.
 *
 * It then briefly used only adsb.lol, until that *also* turned out to
 * rate-limit Cloudflare's shared egress IPs for an extended period (not
 * just a quick rolling window) during testing - again fine from a normal
 * IP, blocked from Cloudflare's network. So this now tries a short list
 * of providers in order and uses whichever answers first; if one has a
 * bad day, the app keeps working through another.
 *
 * Deploy: paste this file into a new Worker in the Cloudflare dashboard
 * (Workers & Pages -> Create -> "Start with Hello World!" -> replace the
 * code), or deploy with Wrangler using the wrangler.toml next to this
 * file.
 *
 * Optional environment variable (Settings -> Variables and Secrets):
 *   ALLOWED_ORIGIN - restrict CORS to your GitHub Pages origin, e.g.
 *                    https://yourusername.github.io (defaults to "*")
 */

const MAX_RADIUS_NM = 250; // observed working cap for these point/radius endpoints

// Tried in order; first one that returns a usable response wins. Each
// provider's raw response uses a different wrapper key for the aircraft
// array (adsb.lol: "ac", adsb.fi: "aircraft") even though the per-aircraft
// fields themselves are the same readsb/tar1090 schema - normalized to
// `{ ac: [...] }` before it goes back to the frontend either way.
const PROVIDERS = [
  {
    name: "adsb.lol",
    buildUrl: (lat, lon, radiusNm) => `https://api.adsb.lol/v2/point/${lat}/${lon}/${radiusNm}`,
    acKey: "ac",
  },
  {
    name: "adsb.fi",
    buildUrl: (lat, lon, radiusNm) => `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${radiusNm}`,
    acKey: "aircraft",
  },
];

// Several of these providers reject requests with no/generic User-Agent
// ("too generic; include valid contact info") - Cloudflare Workers' fetch()
// sends no User-Agent by default, so this has to be set explicitly. Swap
// the URL for your own GitHub Pages/repo if you forked this.
const USER_AGENT = "FlightWatch/1.0 (+https://github.com/banhidiboti/flightradar)";

// Edge-cached for this long, deduplicating identical queries. This matters
// a lot if this same Worker URL is shared as the app's default proxy for
// every visitor (see js/config.js): without it, N simultaneous visitors
// polling every ~12s means N upstream requests every ~12s; with it, all of
// them within this window share a single upstream request per Cloudflare
// edge location.
const CACHE_SECONDS = 8;

function buildCorsHeaders(env) {
  const origin = env.ALLOWED_ORIGIN || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/** Haversine distance in km between two lat/lon points. */
function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(Math.min(1, a)));
}

/**
 * These APIs take a center + radius (nm), not a bounding box, so the
 * incoming lamin/lomin/lamax/lomax is converted into a covering circle:
 * the bbox center, with a radius reaching its farthest corner (plus a
 * small margin), capped at the providers' working limit.
 */
function bboxToPointQuery(lamin, lomin, lamax, lomax) {
  const centerLat = (lamin + lamax) / 2;
  const centerLon = (lomin + lomax) / 2;
  const cornerDistanceKm = haversineKm(centerLat, centerLon, lamax, lomax);
  const radiusNm = Math.min(MAX_RADIUS_NM, Math.ceil((cornerDistanceKm * 1.05) / 1.852));
  return { centerLat, centerLon, radiusNm };
}

/** Tries each provider in order, returns the first usable `{ ac: [...] }`. */
async function fetchFromProviders(centerLat, centerLon, radiusNm) {
  const lat = centerLat.toFixed(2);
  const lon = centerLon.toFixed(2);
  const attempts = [];

  for (const provider of PROVIDERS) {
    try {
      const response = await fetch(provider.buildUrl(lat, lon, radiusNm), {
        headers: { "User-Agent": USER_AGENT },
      });
      if (!response.ok) {
        attempts.push(`${provider.name}: HTTP ${response.status}`);
        continue;
      }
      const data = await response.json();
      return { ac: data[provider.acKey] || [], provider: provider.name };
    } catch (err) {
      attempts.push(`${provider.name}: ${err?.message || err}`);
    }
  }

  throw new Error(`All providers failed - ${attempts.join("; ")}`);
}

export default {
  async fetch(request, env, ctx) {
    const cors = buildCorsHeaders(env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== "GET") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const requestUrl = new URL(request.url);
    const lamin = Number(requestUrl.searchParams.get("lamin"));
    const lomin = Number(requestUrl.searchParams.get("lomin"));
    const lamax = Number(requestUrl.searchParams.get("lamax"));
    const lomax = Number(requestUrl.searchParams.get("lomax"));

    if (![lamin, lomin, lamax, lomax].every(Number.isFinite)) {
      return new Response(
        JSON.stringify({ error: "Missing/invalid bounding box query params (lamin/lomin/lamax/lomax)" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const { centerLat, centerLon, radiusNm } = bboxToPointQuery(lamin, lomin, lamax, lomax);
    const cacheKey = new Request(
      `https://flightwatch-cache.internal/?lat=${centerLat.toFixed(2)}&lon=${centerLon.toFixed(2)}&r=${radiusNm}`,
      { method: "GET" },
    );

    const cache = caches.default;
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      const cachedBody = await cachedResponse.text();
      return new Response(cachedBody, {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json", "X-Cache": "HIT" },
      });
    }

    try {
      const { ac, provider } = await fetchFromProviders(centerLat, centerLon, radiusNm);
      const bodyText = JSON.stringify({ ac });

      const cacheable = new Response(bodyText, {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${CACHE_SECONDS}` },
      });
      ctx.waitUntil(cache.put(cacheKey, cacheable));

      return new Response(bodyText, {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json", "X-Cache": "MISS", "X-Provider": provider },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: "All upstream ADS-B providers failed", detail: String(err?.message || err) }),
        { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }
  },
};

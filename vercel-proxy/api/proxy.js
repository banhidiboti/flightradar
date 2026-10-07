/**
 * Vercel Edge Function CORS proxy for free, keyless community ADS-B APIs.
 *
 * This is the Vercel port of /worker/worker.js (originally a Cloudflare
 * Worker). It moved here because both adsb.lol and adsb.fi were
 * consistently rejecting (429 / 403) requests that originated from
 * Cloudflare Workers' shared egress IP range specifically - fine from an
 * ordinary machine, fine from Cloudflare's own dashboard test tools, but
 * blocked in production. Very likely these free, volunteer-run APIs have
 * blocklisted well-known "Cloudflare Worker CORS proxy" traffic after
 * abuse from that exact pattern. Vercel's Edge Network uses a different
 * IP range, so this is a bet that it isn't (yet) similarly blocklisted.
 *
 * Same logic as the Cloudflare version: bbox -> point+radius conversion,
 * try adsb.lol then adsb.fi, normalize both to `{ ac: [...] }`, add CORS,
 * and let Vercel's edge cache (via the Cache-Control response header)
 * deduplicate near-simultaneous requests instead of managing a cache API
 * by hand.
 *
 * Deploy (from this vercel-proxy/ folder):
 *   npx vercel        # first deploy: prompts for login + project setup
 *   npx vercel --prod # promote to the stable production URL
 *
 * Optional environment variable (Vercel dashboard -> Project -> Settings
 * -> Environment Variables):
 *   ALLOWED_ORIGIN - restrict CORS to your GitHub Pages origin, e.g.
 *                    https://yourusername.github.io (defaults to "*")
 */

export const config = { runtime: "edge" };

const MAX_RADIUS_NM = 250;
const CACHE_SECONDS = 8;
const USER_AGENT = "FlightWatch/1.0 (+https://github.com/banhidiboti/flightradar)";

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

function corsHeaders() {
  const origin = process.env.ALLOWED_ORIGIN || "*";
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

function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(Math.min(1, a)));
}

function bboxToPointQuery(lamin, lomin, lamax, lomax) {
  const centerLat = (lamin + lamax) / 2;
  const centerLon = (lomin + lomax) / 2;
  const cornerDistanceKm = haversineKm(centerLat, centerLon, lamax, lomax);
  const radiusNm = Math.min(MAX_RADIUS_NM, Math.ceil((cornerDistanceKm * 1.05) / 1.852));
  return { centerLat, centerLon, radiusNm };
}

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

export default async function handler(request) {
  const cors = corsHeaders();

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

  try {
    const { ac, provider } = await fetchFromProviders(centerLat, centerLon, radiusNm);

    return new Response(JSON.stringify({ ac }), {
      status: 200,
      headers: {
        ...cors,
        "Content-Type": "application/json",
        // Vercel's edge network dedupes/caches GET responses off this
        // header - no manual Cache API needed, unlike the Workers version.
        "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS}`,
        "X-Provider": provider,
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "All upstream ADS-B providers failed", detail: String(err?.message || err) }),
      { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
}

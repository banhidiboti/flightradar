/**
 * Cloudflare Worker CORS proxy for the OpenSky Network REST API.
 *
 * Why this exists: opensky-network.org only sends an
 * Access-Control-Allow-Origin header for its own domain, so a static
 * GitHub Pages frontend cannot call /api/states/all directly from the
 * browser. This worker sits in between, forwards the bbox query to
 * OpenSky, optionally attaches an OAuth2 bearer token for a higher rate
 * limit, and adds the CORS headers the frontend needs.
 *
 * Deploy: paste this file into a new Worker in the Cloudflare dashboard
 * (Workers & Pages -> Create -> "Hello World" template -> replace code),
 * or deploy with Wrangler using the wrangler.toml next to this file.
 *
 * Optional environment variables (Settings -> Variables and Secrets):
 *   OPENSKY_CLIENT_ID     - OAuth2 client id from an OpenSky API client
 *   OPENSKY_CLIENT_SECRET - OAuth2 client secret (mark as "Secret")
 *   ALLOWED_ORIGIN        - restrict CORS to your GitHub Pages origin,
 *                           e.g. https://yourusername.github.io
 *                           (defaults to "*" if not set)
 *
 * Without the client id/secret the worker still works using OpenSky's
 * anonymous access, just with a much smaller daily credit quota.
 */

const TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
const STATES_URL = "https://opensky-network.org/api/states/all";

// Cached across requests handled by the same Worker isolate. Not guaranteed
// to persist (isolates can be recycled), but it saves a token request on
// most calls since tokens are valid for ~30 minutes.
let cachedToken = null;

async function getAccessToken(env) {
  if (!env.OPENSKY_CLIENT_ID || !env.OPENSKY_CLIENT_SECRET) {
    return null;
  }

  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 5000) {
    return cachedToken.value;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: env.OPENSKY_CLIENT_ID,
    client_secret: env.OPENSKY_CLIENT_SECRET,
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`OpenSky OAuth token request failed with HTTP ${response.status}`);
  }

  const data = await response.json();
  cachedToken = {
    value: data.access_token,
    expiresAt: now + (data.expires_in ? data.expires_in * 1000 : 25 * 60 * 1000),
  };
  return cachedToken.value;
}

function buildCorsHeaders(env) {
  const origin = env.ALLOWED_ORIGIN || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

export default {
  async fetch(request, env) {
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
    const forwardParams = new URLSearchParams();
    for (const key of ["lamin", "lomin", "lamax", "lomax", "icao24", "time"]) {
      const value = requestUrl.searchParams.get(key);
      if (value !== null) forwardParams.set(key, value);
    }

    if (!forwardParams.has("lamin") || !forwardParams.has("lamax")) {
      return new Response(
        JSON.stringify({ error: "Missing bounding box query params (lamin/lomin/lamax/lomax)" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    try {
      const token = await getAccessToken(env);
      const upstreamHeaders = {};
      if (token) upstreamHeaders.Authorization = `Bearer ${token}`;

      const upstreamResponse = await fetch(`${STATES_URL}?${forwardParams.toString()}`, {
        headers: upstreamHeaders,
      });

      const bodyText = await upstreamResponse.text();
      const rateLimitRemaining = upstreamResponse.headers.get("X-Rate-Limit-Remaining");

      return new Response(bodyText, {
        status: upstreamResponse.status,
        headers: {
          ...cors,
          "Content-Type": "application/json",
          ...(rateLimitRemaining ? { "X-Rate-Limit-Remaining": rateLimitRemaining } : {}),
        },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: "Upstream OpenSky request failed", detail: String(err && err.message || err) }),
        { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }
  },
};

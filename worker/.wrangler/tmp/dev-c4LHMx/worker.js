var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var MAX_RADIUS_NM = 250;
var PROVIDERS = [
  {
    name: "adsb.lol",
    buildUrl: /* @__PURE__ */ __name((lat, lon, radiusNm) => `https://api.adsb.lol/v2/point/${lat}/${lon}/${radiusNm}`, "buildUrl"),
    acKey: "ac"
  },
  {
    name: "adsb.fi",
    buildUrl: /* @__PURE__ */ __name((lat, lon, radiusNm) => `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${radiusNm}`, "buildUrl"),
    acKey: "aircraft"
  }
];
var USER_AGENT = "FlightWatch/1.0 (+https://github.com/banhidiboti/flightradar)";
var CACHE_SECONDS = 8;
function buildCorsHeaders(env) {
  const origin = env.ALLOWED_ORIGIN || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };
}
__name(buildCorsHeaders, "buildCorsHeaders");
function toRad(deg) {
  return deg * Math.PI / 180;
}
__name(toRad, "toRad");
function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(Math.min(1, a)));
}
__name(haversineKm, "haversineKm");
function bboxToPointQuery(lamin, lomin, lamax, lomax) {
  const centerLat = (lamin + lamax) / 2;
  const centerLon = (lomin + lomax) / 2;
  const cornerDistanceKm = haversineKm(centerLat, centerLon, lamax, lomax);
  const radiusNm = Math.min(MAX_RADIUS_NM, Math.ceil(cornerDistanceKm * 1.05 / 1.852));
  return { centerLat, centerLon, radiusNm };
}
__name(bboxToPointQuery, "bboxToPointQuery");
async function fetchFromProviders(centerLat, centerLon, radiusNm) {
  const lat = centerLat.toFixed(2);
  const lon = centerLon.toFixed(2);
  const attempts = [];
  for (const provider of PROVIDERS) {
    try {
      const response = await fetch(provider.buildUrl(lat, lon, radiusNm), {
        headers: { "User-Agent": USER_AGENT }
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
__name(fetchFromProviders, "fetchFromProviders");
var worker_default = {
  async fetch(request, env, ctx) {
    const cors = buildCorsHeaders(env);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "GET") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...cors, "Content-Type": "application/json" }
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
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }
    const { centerLat, centerLon, radiusNm } = bboxToPointQuery(lamin, lomin, lamax, lomax);
    const cacheKey = new Request(
      `https://flightwatch-cache.internal/?lat=${centerLat.toFixed(2)}&lon=${centerLon.toFixed(2)}&r=${radiusNm}`,
      { method: "GET" }
    );
    const cache = caches.default;
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      const cachedBody = await cachedResponse.text();
      return new Response(cachedBody, {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json", "X-Cache": "HIT" }
      });
    }
    try {
      const { ac, provider } = await fetchFromProviders(centerLat, centerLon, radiusNm);
      const bodyText = JSON.stringify({ ac });
      const cacheable = new Response(bodyText, {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${CACHE_SECONDS}` }
      });
      ctx.waitUntil(cache.put(cacheKey, cacheable));
      return new Response(bodyText, {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json", "X-Cache": "MISS", "X-Provider": provider }
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: "All upstream ADS-B providers failed", detail: String(err?.message || err) }),
        { status: 502, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }
  }
};

// ../../../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-sxpzTo/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../../../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-sxpzTo/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map

export class AdsbError extends Error {}

const KNOTS_TO_MS = 0.514444;
const FEET_TO_M = 0.3048;
const FPM_TO_MS = FEET_TO_M / 60;

/**
 * Fetches current aircraft inside a bounding box through the Cloudflare
 * Worker proxy (see /worker/worker.js). The worker forwards to adsb.lol's
 * point+radius API and passes its response straight through, so the
 * parsing below matches adsb.lol's / readsb's "aircraft.json"-style
 * schema: `{ ac: [ { hex, flight, lat, lon, alt_baro, gs, track, ... } ] }`.
 */
export async function fetchStatesInBox(proxyUrl, bbox, { timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  const params = new URLSearchParams({
    lamin: bbox.lamin.toFixed(6),
    lomin: bbox.lomin.toFixed(6),
    lamax: bbox.lamax.toFixed(6),
    lomax: bbox.lomax.toFixed(6),
  });

  try {
    const response = await fetch(`${proxyUrl}?${params.toString()}`, {
      signal: controller.signal,
    });

    if (response.status === 429) {
      throw new AdsbError("Túl sok kérés (rate limit) - a következő ciklusban újra próbálkozunk.");
    }
    if (!response.ok) {
      throw new AdsbError(`A proxy/adsb.lol HTTP ${response.status} választ adott.`);
    }

    const data = await response.json();
    return (data.ac || []).map(parseAircraft).filter((plane) => plane !== null);
  } catch (err) {
    if (err instanceof AdsbError) throw err;
    if (err && err.name === "AbortError") {
      throw new AdsbError("A kérés túllépte az időkorlátot (timeout).");
    }
    throw new AdsbError(`Hálózati hiba: ${err && err.message ? err.message : "ismeretlen hiba"}`);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function parseAircraft(ac) {
  if (!ac || typeof ac.lat !== "number" || typeof ac.lon !== "number") return null;

  const onGround = ac.alt_baro === "ground";
  const altitudeFt = typeof ac.alt_geom === "number" ? ac.alt_geom : ac.alt_baro;
  const altitudeM = typeof altitudeFt === "number" ? altitudeFt * FEET_TO_M : null;

  const icao24 = ac.hex;
  const callsign = (ac.flight || "").trim() || icao24.toUpperCase();

  return {
    icao24,
    callsign,
    latitude: ac.lat,
    longitude: ac.lon,
    altitudeM,
    onGround,
    velocityMs: typeof ac.gs === "number" ? ac.gs * KNOTS_TO_MS : null,
    headingDeg: typeof ac.track === "number" ? ac.track : 0,
    verticalRateMs:
      typeof ac.baro_rate === "number" ? ac.baro_rate * FPM_TO_MS : typeof ac.geom_rate === "number" ? ac.geom_rate * FPM_TO_MS : null,
    aircraftType: ac.t || null,
    registration: ac.r || null,
    lastContact: ac.seen,
  };
}

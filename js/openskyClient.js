export class OpenSkyError extends Error {}

/**
 * Fetches current state vectors inside a bounding box through the
 * Cloudflare Worker proxy (see /worker/worker.js for why a proxy is
 * needed instead of calling OpenSky directly from the browser).
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
      throw new OpenSkyError("Túl sok kérés (rate limit) - a következő ciklusban újra próbálkozunk.");
    }
    if (!response.ok) {
      throw new OpenSkyError(`A proxy/OpenSky HTTP ${response.status} választ adott.`);
    }

    const data = await response.json();
    return (data.states || []).map(parseStateVector).filter((plane) => plane !== null);
  } catch (err) {
    if (err instanceof OpenSkyError) throw err;
    if (err && err.name === "AbortError") {
      throw new OpenSkyError("A kérés túllépte az időkorlátot (timeout).");
    }
    throw new OpenSkyError(`Hálózati hiba: ${err && err.message ? err.message : "ismeretlen hiba"}`);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function parseStateVector(state) {
  if (!Array.isArray(state) || state.length < 17) return null;

  const [
    icao24,
    callsignRaw,
    , // originCountry
    , // timePosition
    lastContact,
    longitude,
    latitude,
    baroAltitude,
    onGround,
    velocity,
    trueTrack,
    verticalRate,
    , // sensors
    geoAltitude,
  ] = state;

  if (typeof latitude !== "number" || typeof longitude !== "number") return null;

  const callsign = (callsignRaw || "").trim() || icao24.toUpperCase();
  const altitudeM = typeof geoAltitude === "number" ? geoAltitude : baroAltitude;

  return {
    icao24,
    callsign,
    latitude,
    longitude,
    altitudeM: typeof altitudeM === "number" ? altitudeM : null,
    onGround: Boolean(onGround),
    velocityMs: typeof velocity === "number" ? velocity : null,
    headingDeg: typeof trueTrack === "number" ? trueTrack : 0,
    verticalRateMs: typeof verticalRate === "number" ? verticalRate : null,
    lastContact,
  };
}

/**
 * On-demand, click-triggered lookups against adsbdb.com - a free, keyless
 * aircraft/route database with CORS enabled for any origin (no proxy
 * needed, unlike the OpenSky state vectors). Used only for the side panel
 * when a plane is selected, never on every poll cycle, to keep request
 * volume minimal.
 *
 * Both lookups are best-effort: a lot of state vectors have no matching
 * route (private/general aviation, charter, military, data gaps), so any
 * failure or 404 resolves to `null` instead of throwing.
 */

const BASE_URL = "https://api.adsbdb.com/v0";

async function safeFetchJson(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export async function fetchAircraftType(icao24) {
  const data = await safeFetchJson(`${BASE_URL}/aircraft/${encodeURIComponent(icao24.toLowerCase())}`);
  const aircraft = data && data.response && data.response.aircraft;
  if (!aircraft) return null;

  return {
    type: aircraft.type || null,
    icaoType: aircraft.icao_type || null,
    manufacturer: aircraft.manufacturer || null,
    registration: aircraft.registration || null,
  };
}

export async function fetchFlightRoute(callsign) {
  const trimmed = (callsign || "").trim();
  if (!trimmed) return null;

  const data = await safeFetchJson(`${BASE_URL}/callsign/${encodeURIComponent(trimmed)}`);
  const route = data && data.response && data.response.flightroute;
  if (!route || !route.origin || !route.destination) return null;

  const toAirport = (a) => ({
    icao: a.icao_code || null,
    iata: a.iata_code || null,
    name: a.name || null,
    lat: a.latitude,
    lon: a.longitude,
  });

  return {
    airlineName: route.airline ? route.airline.name : null,
    origin: toAirport(route.origin),
    destination: toAirport(route.destination),
  };
}

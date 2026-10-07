const STORAGE_KEY = "flightwatch.config.v2";

// Fixed data-fetch region: all of Hungary. This is intentionally not
// user-configurable - the map always shows Hungarian airspace traffic,
// the zone (geofence) below is a separate, movable sub-area used only
// for the alerting feature.
export const HUNGARY_BBOX = { lamin: 45.7, lomin: 16.1, lamax: 48.6, lomax: 22.9 };

export const MAP_INITIAL_VIEW = { lat: 47.16, lon: 19.5, zoom: 7 };

// Pre-filled so the app works the instant someone opens the page, with
// zero setup - this is the author's own deployed proxy (see
// vercel-proxy/), shared by every visitor. Still fully overridable in the
// control panel (e.g. to point at your own proxy instead).
const DEFAULT_PROXY_URL = "https://flightradar-ln91fu8q5-flightwatch.vercel.app/api/proxy";

export const DEFAULT_CONFIG = {
  proxyUrl: DEFAULT_PROXY_URL,
  zoneLat: 47.64, // Pomáz
  zoneLon: 19.0333,
  radiusKm: 10,
  altitudeLimitM: 3000,
  refreshIntervalSec: 12,
};

export const MIN_REFRESH_INTERVAL_SEC = 10;

export function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // localStorage unavailable (private mode, quota, etc.) - config just
    // won't survive a reload, but the app keeps working for this session.
  }
}

export function validateConfig(config) {
  const errors = [];

  if (!config.proxyUrl || !/^https?:\/\//i.test(config.proxyUrl)) {
    errors.push("A proxy URL hiányzik vagy érvénytelen (http(s):// szükséges).");
  }
  if (!Number.isFinite(config.zoneLat) || config.zoneLat < -90 || config.zoneLat > 90) {
    errors.push("A zóna szélessége (latitude) -90 és 90 között kell legyen.");
  }
  if (!Number.isFinite(config.zoneLon) || config.zoneLon < -180 || config.zoneLon > 180) {
    errors.push("A zóna hosszúsága (longitude) -180 és 180 között kell legyen.");
  }
  if (!Number.isFinite(config.radiusKm) || config.radiusKm <= 0 || config.radiusKm > 300) {
    errors.push("A hatósugár 0 és 300 km között kell legyen.");
  }
  if (!Number.isFinite(config.altitudeLimitM) || config.altitudeLimitM <= 0) {
    errors.push("A magassági korlátnak pozitív számnak kell lennie (méterben).");
  }
  if (!Number.isFinite(config.refreshIntervalSec) || config.refreshIntervalSec < MIN_REFRESH_INTERVAL_SEC) {
    errors.push(`A frissítési gyakoriság legalább ${MIN_REFRESH_INTERVAL_SEC} másodperc lehet (API kvóta védelme).`);
  }

  return errors;
}

const EARTH_RADIUS_KM = 6371;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

export function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, a)));
}

/**
 * Bounding box that comfortably contains a circle of `radiusKm` around
 * (lat, lon). Used only to narrow the OpenSky query; the precise
 * in-zone check still uses haversineDistanceKm.
 */
export function boundingBoxFromCenter(lat, lon, radiusKm) {
  const latDelta = radiusKm / 111.32;
  const cosLat = Math.cos(toRad(lat));
  const lonDelta = radiusKm / (111.32 * (Math.abs(cosLat) > 1e-6 ? cosLat : 1e-6));

  return {
    lamin: Math.max(-90, lat - latDelta),
    lamax: Math.min(90, lat + latDelta),
    lomin: Math.max(-180, lon - lonDelta),
    lomax: Math.min(180, lon + lonDelta),
  };
}

export function metersToFeet(meters) {
  return meters * 3.28084;
}

export function msToKmh(ms) {
  return ms * 3.6;
}

export function msToKnots(ms) {
  return ms * 1.94384;
}

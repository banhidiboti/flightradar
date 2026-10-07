// Standard OpenStreetMap raster tiles, no API key required. The dark look
// is achieved with a CSS filter on the tile pane (see css/style.css,
// .leaflet-tile-pane) rather than a dedicated dark tile set, because the
// classic "free" CartoDB Dark Matter raster endpoint now requires a CARTO
// API key (it returns an HTTP 200 watermark placeholder without one). If
// you'd rather use real CARTO Dark Matter tiles, get a free key at
// https://carto.com/ and swap this URL for
// `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?api_key=YOUR_KEY`
// (and remove the .leaflet-tile-pane filter in the CSS).
const DARK_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const DARK_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const ANIMATION_DURATION_MS = 1000;

// Classic top-down airplane silhouette (the well-known Material Design
// "flight" glyph), nose pointing north (0deg / up) in a 24x24 viewBox, so
// a CSS rotate(headingDeg) aligns it with true_track. Reads cleanly even
// at the small size this renders at on the map, unlike a more detailed
// silhouette would. fill="currentColor" is required - without it SVG
// defaults to solid black, ignoring the CSS `color` set on the wrapping
// div entirely.
const PLANE_SVG = `
<svg viewBox="0 0 24 24" width="22" height="22" xmlns="http://www.w3.org/2000/svg">
  <path fill="currentColor" d="M21,16V14L13,9V3.5C13,2.67 12.33,2 11.5,2C10.67,2 10,2.67 10,3.5V9L2,14V16L10,13.5V19L7.5,20.5V22L11.5,21L15.5,22V20.5L13,19V13.5L21,16Z" />
</svg>`;

const AIRPORT_SVG = `
<svg viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg">
  <circle cx="12" cy="12" r="9" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="2" />
  <path fill="currentColor" d="M12 6 L13 11 L18 13 L18 14.2 L13 13 L13 17 L15 18.3 L15 19.3 L12 18.6 L9 19.3 L9 18.3 L11 17 L11 13 L6 14.2 L6 13 L11 11 Z" />
</svg>`;

/** `category`: "alert" (red, pulsing) | "domestic" (orange) | undefined/"transit" (yellow). */
function buildPlaneIcon(headingDeg, category) {
  const extraClass = category === "alert" ? " alert" : category === "domestic" ? " domestic" : "";
  return L.divIcon({
    className: "plane-marker",
    html: `
      <div class="plane-marker-rotate${extraClass}" style="transform: rotate(${headingDeg}deg);">
        ${PLANE_SVG}
      </div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

export function createMapView({ onPlaneClick, onZoneRelocate, onAirportClick }) {
  let map = null;
  let zoneCircle = null;
  let routeLayerGroup = null;
  /** @type {Map<string, { marker: L.Marker, latlng: L.LatLng, animFrom: L.LatLng|null, animStart: number }>} */
  const planeMarkers = new Map();
  let animationHandle = null;

  function init(container, initialView) {
    map = L.map(container, { zoomControl: true, attributionControl: true }).setView(
      [initialView.lat, initialView.lon],
      initialView.zoom,
    );

    L.tileLayer(DARK_TILE_URL, {
      attribution: DARK_TILE_ATTRIBUTION,
      maxZoom: 19,
    }).addTo(map);

    map.on("click", (e) => {
      if (onZoneRelocate) onZoneRelocate(e.latlng.lat, e.latlng.lng);
    });

    return map;
  }

  function addAirportMarker(airport) {
    const icon = L.divIcon({
      className: "airport-marker",
      html: `<div class="airport-marker-icon">${AIRPORT_SVG}</div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
    const marker = L.marker([airport.lat, airport.lon], { icon, riseOnHover: true }).addTo(map);
    marker.bindTooltip(`${airport.name} (${airport.iata})`, { direction: "top", offset: [0, -8] });
    marker.on("click", (e) => {
      L.DomEvent.stopPropagation(e);
      if (onAirportClick) onAirportClick(airport);
    });
    return marker;
  }

  function setZoneCircle(lat, lon, radiusKm) {
    const radiusM = radiusKm * 1000;
    if (!zoneCircle) {
      zoneCircle = L.circle([lat, lon], {
        radius: radiusM,
        className: "geofence-circle",
        color: "#38bdf8",
        weight: 2,
        fillColor: "#38bdf8",
        fillOpacity: 0.08,
        interactive: false,
      }).addTo(map);
    } else {
      zoneCircle.setLatLng([lat, lon]);
      zoneCircle.setRadius(radiusM);
    }
  }

  /** @param {"alert"|"domestic"|"transit"} category */
  function upsertPlane(plane, category) {
    const latlng = L.latLng(plane.latitude, plane.longitude);
    const existing = planeMarkers.get(plane.icao24);

    if (!existing) {
      const marker = L.marker(latlng, {
        icon: buildPlaneIcon(plane.headingDeg, category),
        riseOnHover: true,
      }).addTo(map);

      marker.bindTooltip(plane.callsign, { direction: "top", offset: [0, -10] });
      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        if (onPlaneClick) onPlaneClick(plane);
      });

      planeMarkers.set(plane.icao24, { marker, latlng, animFrom: null, animStart: 0, plane, category });
      return;
    }

    existing.marker.setIcon(buildPlaneIcon(plane.headingDeg, category));
    existing.marker.setTooltipContent(plane.callsign);
    existing.animFrom = existing.latlng;
    existing.latlng = latlng;
    existing.animStart = performance.now();
    existing.plane = plane;
    existing.category = category;
    ensureAnimationLoop();
  }

  function removeStalePlanes(currentIcao24s) {
    for (const [icao24, entry] of Array.from(planeMarkers.entries())) {
      if (!currentIcao24s.has(icao24)) {
        map.removeLayer(entry.marker);
        planeMarkers.delete(icao24);
      }
    }
  }

  function ensureAnimationLoop() {
    if (animationHandle != null) return;
    const tick = (now) => {
      let stillAnimating = false;
      for (const entry of planeMarkers.values()) {
        if (!entry.animFrom) continue;
        const elapsed = now - entry.animStart;
        const t = Math.min(1, elapsed / ANIMATION_DURATION_MS);
        const lat = entry.animFrom.lat + (entry.latlng.lat - entry.animFrom.lat) * t;
        const lng = entry.animFrom.lng + (entry.latlng.lng - entry.animFrom.lng) * t;
        entry.marker.setLatLng([lat, lng]);
        if (t >= 1) {
          entry.animFrom = null;
        } else {
          stillAnimating = true;
        }
      }
      animationHandle = stillAnimating ? requestAnimationFrame(tick) : null;
    };
    animationHandle = requestAnimationFrame(tick);
  }

  function planeCount() {
    return planeMarkers.size;
  }

  function panTo(lat, lon) {
    map.panTo([lat, lon]);
  }

  /**
   * Draws a simplified route: a solid line from the origin airport to the
   * plane's current position (the "flown" leg) and a dashed line from the
   * current position to the destination airport (the "remaining" leg).
   * This is a straight-line approximation, not the actual flown track -
   * OpenSky's real track history endpoint isn't reliably available
   * without a trusted/authenticated account, so this is the honest
   * free/keyless equivalent. origin/destination may be null individually
   * if adsbdb only resolved one side.
   */
  function showRoute(origin, destination, current) {
    clearRoute();
    routeLayerGroup = L.layerGroup().addTo(map);

    if (origin && Number.isFinite(origin.lat) && Number.isFinite(origin.lon)) {
      L.circleMarker([origin.lat, origin.lon], {
        radius: 5,
        color: "#38bdf8",
        fillColor: "#38bdf8",
        fillOpacity: 1,
        interactive: false,
      })
        .bindTooltip(`${origin.name || origin.icao || "Indulás"}${origin.iata ? ` (${origin.iata})` : ""}`)
        .addTo(routeLayerGroup);

      L.polyline(
        [
          [origin.lat, origin.lon],
          [current.lat, current.lon],
        ],
        { color: "#38bdf8", weight: 2, opacity: 0.85, interactive: false },
      ).addTo(routeLayerGroup);
    }

    if (destination && Number.isFinite(destination.lat) && Number.isFinite(destination.lon)) {
      L.circleMarker([destination.lat, destination.lon], {
        radius: 5,
        color: "#4ade80",
        fillColor: "#4ade80",
        fillOpacity: 1,
        interactive: false,
      })
        .bindTooltip(`${destination.name || destination.icao || "Érkezés"}${destination.iata ? ` (${destination.iata})` : ""}`)
        .addTo(routeLayerGroup);

      L.polyline(
        [
          [current.lat, current.lon],
          [destination.lat, destination.lon],
        ],
        { color: "#4ade80", weight: 2, opacity: 0.85, dashArray: "6 6", interactive: false },
      ).addTo(routeLayerGroup);
    }
  }

  function clearRoute() {
    if (routeLayerGroup) {
      map.removeLayer(routeLayerGroup);
      routeLayerGroup = null;
    }
  }

  return {
    init,
    setZoneCircle,
    upsertPlane,
    removeStalePlanes,
    planeCount,
    panTo,
    showRoute,
    clearRoute,
    addAirportMarker,
  };
}

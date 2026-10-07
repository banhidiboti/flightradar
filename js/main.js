import { loadConfig, saveConfig, validateConfig, HUNGARY_BBOX, MAP_INITIAL_VIEW } from "./config.js";
import { haversineDistanceKm } from "./geo.js";
import { fetchStatesInBox, AdsbError } from "./adsbClient.js";
import { ZoneTracker } from "./zoneTracker.js";
import { getCurrentPermission, requestNotificationPermission, notifyPlaneEntered, isNotificationSupported } from "./notifications.js";
import { createMapView } from "./mapView.js";
import { fetchFlightRoute } from "./flightLookup.js";
import {
  fillConfigForm,
  readConfigForm,
  showConfigErrors,
  setMonitoringButtonState,
  setNotifToggleState,
  setStatusCount,
  setStatusUpdated,
  setStatusNext,
  setStatusError,
  openSidePanel,
  closeSidePanel,
  toggleControlPanel,
  setSidePanelLoadingRoute,
  setSidePanelRoute,
} from "./ui.js";

const zoneTracker = new ZoneTracker();
let currentConfig = loadConfig();
let pollTimer = null;
let countdownTimer = null;
let secondsUntilNextPoll = 0;
let isPolling = false;
let lastSelectedIcao24 = null;
let lastSelectedRoute = null;

const mapView = createMapView({
  onPlaneClick: handlePlaneClick,
  onZoneRelocate: handleZoneRelocate,
});

function init() {
  mapView.init("map", MAP_INITIAL_VIEW);
  mapView.setZoneCircle(currentConfig.zoneLat, currentConfig.zoneLon, currentConfig.radiusKm);

  fillConfigForm(currentConfig);
  setMonitoringButtonState(false, Boolean(currentConfig.proxyUrl));
  setNotifToggleState(getCurrentPermission() === "granted", !isNotificationSupported());

  document.getElementById("config-form").addEventListener("submit", onSaveConfig);
  document.getElementById("toggle-monitoring").addEventListener("click", onToggleMonitoring);
  document.getElementById("notif-toggle").addEventListener("change", onNotifToggle);
  document.getElementById("control-toggle").addEventListener("click", toggleControlPanel);
  document.getElementById("side-panel-close").addEventListener("click", () => {
    deselectPlane();
  });
}

function deselectPlane() {
  lastSelectedIcao24 = null;
  lastSelectedRoute = null;
  closeSidePanel();
  mapView.clearRoute();
}

function onSaveConfig(event) {
  event.preventDefault();
  const candidate = readConfigForm();
  const errors = validateConfig(candidate);
  showConfigErrors(errors);
  if (errors.length > 0) return;

  currentConfig = candidate;
  saveConfig(currentConfig);
  mapView.setZoneCircle(currentConfig.zoneLat, currentConfig.zoneLon, currentConfig.radiusKm);
  setMonitoringButtonState(isPolling, true);
}

function handleZoneRelocate(lat, lon) {
  currentConfig = { ...currentConfig, zoneLat: lat, zoneLon: lon };
  saveConfig(currentConfig);
  mapView.setZoneCircle(lat, lon, currentConfig.radiusKm);
  document.getElementById("zoneLat").value = lat.toFixed(4);
  document.getElementById("zoneLon").value = lon.toFixed(4);
}

function handlePlaneClick(plane) {
  lastSelectedIcao24 = plane.icao24;
  lastSelectedRoute = null;
  const distanceKm = haversineDistanceKm(currentConfig.zoneLat, currentConfig.zoneLon, plane.latitude, plane.longitude);
  openSidePanel(plane, distanceKm);
  setSidePanelLoadingRoute();
  mapView.clearRoute();

  fetchFlightRoute(plane.callsign).then((route) => {
    if (lastSelectedIcao24 !== plane.icao24) return;
    setSidePanelRoute(route);
    lastSelectedRoute = route;
    if (route) {
      mapView.showRoute(route.origin, route.destination, { lat: plane.latitude, lon: plane.longitude });
    }
  });
}

function onToggleMonitoring() {
  if (isPolling) {
    stopMonitoring();
  } else {
    startMonitoring();
  }
}

async function onNotifToggle(event) {
  if (!event.target.checked) return;
  try {
    const result = await requestNotificationPermission();
    event.target.checked = result === "granted";
    if (result !== "granted") {
      setStatusError("Az értesítések engedélye nincs megadva a böngészőben.");
    }
  } catch (err) {
    event.target.checked = false;
    setStatusError(err.message || String(err));
  }
}

function startMonitoring() {
  isPolling = true;
  setMonitoringButtonState(true, true);
  runPollCycle();
}

function stopMonitoring() {
  isPolling = false;
  setMonitoringButtonState(false, true);
  if (pollTimer) clearTimeout(pollTimer);
  if (countdownTimer) clearInterval(countdownTimer);
  pollTimer = null;
  countdownTimer = null;
  setStatusNext(null);
}

async function runPollCycle() {
  if (!isPolling) return;

  try {
    const states = await fetchStatesInBox(currentConfig.proxyUrl, HUNGARY_BBOX);
    const airborne = states.filter((plane) => plane.altitudeM != null && !plane.onGround);

    const withDistance = airborne.map((plane) => ({
      ...plane,
      distanceKm: haversineDistanceKm(currentConfig.zoneLat, currentConfig.zoneLon, plane.latitude, plane.longitude),
    }));

    const planesInZone = withDistance.filter(
      (plane) => plane.distanceKm <= currentConfig.radiusKm && plane.altitudeM <= currentConfig.altitudeLimitM,
    );

    const { entered } = zoneTracker.update(planesInZone);
    for (const plane of entered) {
      notifyPlaneEntered(plane, plane.distanceKm);
    }

    const inZoneIds = new Set(planesInZone.map((p) => p.icao24));
    const currentIds = new Set();
    for (const plane of withDistance) {
      currentIds.add(plane.icao24);
      mapView.upsertPlane(plane, inZoneIds.has(plane.icao24));
    }
    mapView.removeStalePlanes(currentIds);

    if (lastSelectedIcao24 && currentIds.has(lastSelectedIcao24)) {
      const selected = withDistance.find((p) => p.icao24 === lastSelectedIcao24);
      if (selected) {
        openSidePanel(selected, selected.distanceKm);
        if (lastSelectedRoute) {
          mapView.showRoute(lastSelectedRoute.origin, lastSelectedRoute.destination, {
            lat: selected.latitude,
            lon: selected.longitude,
          });
        }
      }
    } else if (lastSelectedIcao24) {
      deselectPlane();
    }

    setStatusCount(mapView.planeCount());
    setStatusUpdated(new Date());
    setStatusError(null);
  } catch (err) {
    const message = err instanceof AdsbError ? err.message : `Váratlan hiba: ${err.message || err}`;
    setStatusError(message);
  }

  scheduleNextPoll();
}

function scheduleNextPoll() {
  if (!isPolling) return;

  secondsUntilNextPoll = currentConfig.refreshIntervalSec;
  setStatusNext(secondsUntilNextPoll);

  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    secondsUntilNextPoll -= 1;
    setStatusNext(Math.max(secondsUntilNextPoll, 0));
  }, 1000);

  pollTimer = setTimeout(runPollCycle, currentConfig.refreshIntervalSec * 1000);
}

init();

const el = (id) => document.getElementById(id);

export function fillConfigForm(config) {
  el("proxyUrl").value = config.proxyUrl;
  el("zoneLat").value = config.zoneLat;
  el("zoneLon").value = config.zoneLon;
  el("radiusKm").value = config.radiusKm;
  el("altitudeLimitM").value = config.altitudeLimitM;
  el("refreshIntervalSec").value = config.refreshIntervalSec;
}

export function setZoneLatLonInputs(lat, lon) {
  el("zoneLat").value = lat.toFixed(4);
  el("zoneLon").value = lon.toFixed(4);
}

export function readConfigForm() {
  return {
    proxyUrl: el("proxyUrl").value.trim(),
    zoneLat: Number(el("zoneLat").value),
    zoneLon: Number(el("zoneLon").value),
    radiusKm: Number(el("radiusKm").value),
    altitudeLimitM: Number(el("altitudeLimitM").value),
    refreshIntervalSec: Number(el("refreshIntervalSec").value),
  };
}

export function showConfigErrors(errors) {
  const list = el("config-errors");
  list.innerHTML = "";
  if (errors.length === 0) {
    list.hidden = true;
    return;
  }
  list.hidden = false;
  for (const message of errors) {
    const li = document.createElement("li");
    li.textContent = message;
    list.appendChild(li);
  }
}

export function setMonitoringButtonState(isRunning, enabled) {
  const button = el("toggle-monitoring");
  button.disabled = !enabled;
  button.textContent = isRunning ? "Figyelés leállítása" : "Figyelés indítása";
  button.classList.toggle("running", isRunning);
}

export function setNotifToggleState(checked, disabled) {
  const toggle = el("notif-toggle");
  toggle.checked = checked;
  toggle.disabled = Boolean(disabled);
}

export function setStatusCount(count) {
  el("status-count").textContent = `Aktív gépek: ${count}`;
}

export function setStatusUpdated(date) {
  el("status-updated").textContent = date ? `Frissítve: ${date.toLocaleTimeString("hu-HU")}` : "Frissítve: —";
}

export function setStatusNext(seconds) {
  el("status-next").textContent = seconds != null ? `Köv.: ${seconds} mp` : "Köv.: —";
}

export function setStatusError(message) {
  const node = el("status-error");
  node.textContent = message || "";
  node.hidden = !message;
}

export function openSidePanel(plane, distanceKm) {
  el("sp-plane-view").hidden = false;
  el("sp-airport-view").hidden = true;

  el("sp-callsign").textContent = plane.callsign;
  el("sp-type").textContent = plane.aircraftType
    ? `${plane.aircraftType}${plane.registration ? ` (${plane.registration})` : ""}`
    : "ismeretlen";
  el("sp-icao24").textContent = plane.icao24;
  el("sp-altitude").textContent =
    plane.altitudeM != null ? `${Math.round(plane.altitudeM)} m / ${Math.round(plane.altitudeM * 3.28084)} ft` : "n/a";
  el("sp-speed").textContent = plane.velocityMs != null ? `${Math.round(plane.velocityMs * 3.6)} km/h` : "n/a";
  el("sp-vrate").textContent =
    plane.verticalRateMs != null
      ? `${plane.verticalRateMs > 0 ? "▲" : plane.verticalRateMs < 0 ? "▼" : "―"} ${Math.abs(
          Math.round(plane.verticalRateMs),
        )} m/s`
      : "n/a";
  el("sp-heading").textContent = `${Math.round(plane.headingDeg)}°`;
  el("sp-distance").textContent = distanceKm != null ? `${distanceKm.toFixed(1)} km` : "n/a";

  const link = el("sp-fr24-link");
  link.href = `https://www.flightradar24.com/${encodeURIComponent(plane.callsign.trim())}`;

  el("side-panel").hidden = false;
}

export function closeSidePanel() {
  el("side-panel").hidden = true;
}

export function setSidePanelLoadingRoute() {
  el("sp-origin").textContent = "…";
  el("sp-destination").textContent = "…";
  el("sp-airline").hidden = true;
}

export function setSidePanelRoute(route) {
  const originEl = el("sp-origin");
  const destEl = el("sp-destination");
  const airlineEl = el("sp-airline");

  if (!route) {
    originEl.textContent = "ismeretlen";
    destEl.textContent = "ismeretlen";
    airlineEl.hidden = true;
    return;
  }

  const formatAirport = (airport) =>
    airport ? `${airport.name || airport.icao || "?"}${airport.iata ? ` (${airport.iata})` : ""}` : "ismeretlen";

  originEl.textContent = formatAirport(route.origin);
  destEl.textContent = formatAirport(route.destination);

  if (route.airlineName) {
    airlineEl.textContent = route.airlineName;
    airlineEl.hidden = false;
  } else {
    airlineEl.hidden = true;
  }
}

export function showAirportPanel(airport, planes, onSelect) {
  el("sp-plane-view").hidden = true;
  el("sp-airport-view").hidden = false;
  el("airport-name").textContent = airport.name;

  const list = el("airport-flight-list");
  const empty = el("airport-flight-empty");
  list.innerHTML = "";

  if (!planes || planes.length === 0) {
    empty.hidden = false;
  } else {
    empty.hidden = true;
    for (const plane of planes) {
      const climbing = plane.verticalRateMs != null && plane.verticalRateMs > 1;
      const descending = plane.verticalRateMs != null && plane.verticalRateMs < -1;
      const arrow = climbing ? "▲" : descending ? "▼" : "―";
      const label = climbing ? "felszáll" : descending ? "leszáll" : "szinten";

      const li = document.createElement("li");
      li.innerHTML = `
        <span class="fl-callsign"><span class="fl-direction">${arrow}</span> ${escapeHtml(plane.callsign)}</span>
        <span class="fl-meta">${label} · ${Math.round(plane.altitudeM)} m</span>
      `;
      li.addEventListener("click", () => onSelect(plane.icao24));
      list.appendChild(li);
    }
  }

  el("side-panel").hidden = false;
}

export function toggleControlPanel() {
  el("control-panel").classList.toggle("collapsed");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

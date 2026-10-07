const PERMISSION_CHOICE_KEY = "flightwatch.notifPermissionChoice";

export function isNotificationSupported() {
  return "Notification" in window;
}

export function getStoredPermissionChoice() {
  try {
    return localStorage.getItem(PERMISSION_CHOICE_KEY);
  } catch {
    return null;
  }
}

export function getCurrentPermission() {
  return isNotificationSupported() ? Notification.permission : "unsupported";
}

export async function requestNotificationPermission() {
  if (!isNotificationSupported()) {
    throw new Error("Ez a böngésző nem támogatja a Notification API-t.");
  }
  const result = await Notification.requestPermission();
  try {
    localStorage.setItem(PERMISSION_CHOICE_KEY, result);
  } catch {
    // ignore storage failures, permission still applies for this session
  }
  return result;
}

export function notifyPlaneEntered(plane, distanceKm) {
  if (!isNotificationSupported() || Notification.permission !== "granted") return;

  const altitudeFt = plane.altitudeM != null ? Math.round(plane.altitudeM * 3.28084) : null;
  const speedKmh = plane.velocityMs != null ? Math.round(plane.velocityMs * 3.6) : null;

  const bodyLines = [
    `ICAO24: ${plane.icao24}`,
    plane.altitudeM != null
      ? `Magasság: ${Math.round(plane.altitudeM)} m / ${altitudeFt} ft`
      : "Magasság: ismeretlen",
    speedKmh != null ? `Sebesség: ${speedKmh} km/h` : "Sebesség: ismeretlen",
    `Távolság: ${distanceKm.toFixed(1)} km`,
  ];

  const notification = new Notification(`Repülő a zónában: ${plane.callsign}`, {
    body: bodyLines.join("\n"),
    tag: plane.icao24,
  });

  notification.onclick = () => {
    window.open(`https://www.flightradar24.com/${plane.callsign.trim()}`, "_blank");
  };
}

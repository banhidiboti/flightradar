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

export function registerNotificationServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("sw.js").catch(() => {
    // Notifications just fall back to the direct Notification constructor
    // below (fine on desktop, silently unavailable on mobile Chrome - no
    // worse off than before this existed).
  });
}

export async function notifyPlaneEntered(plane, distanceKm) {
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

  const title = `Repülő a zónában: ${plane.callsign}`;
  const options = {
    body: bodyLines.join("\n"),
    tag: plane.icao24,
    data: { callsign: plane.callsign },
  };

  // Android Chrome (and most other mobile browsers) refuse `new
  // Notification(...)` outright - it only works through a service worker
  // registration there. Desktop supports both; routing through the SW
  // when available keeps the behavior consistent everywhere, with the
  // plain constructor as a fallback for browsers with Notification
  // support but no service worker.
  if ("serviceWorker" in navigator) {
    try {
      // `ready` can hang forever if registration never actually
      // activates (e.g. sw.js failed to load) - race it against a
      // timeout so a broken SW can't block notifications entirely.
      const registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) => setTimeout(() => reject(new Error("service worker not ready")), 3000)),
      ]);
      await registration.showNotification(title, options);
      return;
    } catch {
      // fall through to the direct constructor below
    }
  }

  const notification = new Notification(title, options);
  notification.onclick = () => {
    window.open(`https://www.flightradar24.com/${plane.callsign.trim()}`, "_blank");
  };
}

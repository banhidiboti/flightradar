/**
 * Minimal service worker, with exactly one job: let the page call
 * `registration.showNotification()` instead of `new Notification()`.
 *
 * Why this exists despite the original "no service worker" requirement:
 * Android Chrome (and most other mobile browsers) flatly refuse the plain
 * `new Notification(...)` constructor from page script - it throws
 * "Illegal constructor" there, even with permission already granted.
 * Only a service-worker-registered notification works on mobile. This
 * worker does NOT do caching, offline support, or background push - it
 * has no fetch handler and the app never works offline. It only exists
 * so notifications can actually display on a phone; the underlying
 * limitation this project already accepted is unchanged: notifications
 * still only fire while the tab is open and the poll loop is running, no
 * real background wake-up.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const callsign = event.notification.data && event.notification.data.callsign;
  if (callsign) {
    event.waitUntil(clients.openWindow(`https://www.flightradar24.com/${callsign.trim()}`));
  }
});

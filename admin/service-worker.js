// ════════════════════════════════════════════════════════════════════════
// MémoTruck — Panel Admin : service worker (notifications push uniquement,
// pas de mise en cache d'assets ici — ce n'est pas une PWA offline-first).
// ════════════════════════════════════════════════════════════════════════

self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(self.clients.claim()); });

self.addEventListener("push", (e) => {
  if (!e.data) return;
  let data;
  try { data = e.data.json(); } catch { data = { title: "MémoTruck", body: e.data.text() }; }
  e.waitUntil(
    self.registration.showNotification(data.title || "🔧 MémoTruck", {
      body:     data.body || "",
      tag:      data.tag  || "memotruck-atelier",
      renotify: true,
      data:     data
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      if (list.length > 0) { list[0].focus(); return; }
      return clients.openWindow("/admin/");
    })
  );
});

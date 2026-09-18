// Numéro de version du cache — LE seul numéro à bumper pour publier une MAJ.
// Ne peut pas être importé d'un autre fichier (js/changelog.js par ex.) :
// le navigateur ne détecte une mise à jour du service worker qu'en comparant
// les octets de CE fichier avec la version installée, jamais ceux d'un
// fichier importé. Si ce numéro ne change pas, rien d'autre ne se passera
// (pas de popup, pas de purge de cache), quels que soient les autres
// fichiers modifiés. Penser aussi à ajouter une entrée dans js/changelog.js.
const APP_VERSION = "v1.4.8.16";
const CACHE_NAME = "atil-cache-" + APP_VERSION;
// Racine de l'appli sur memotruck.fr — l'appli est servie depuis ce sous-dossier,
// pas depuis la racine du domaine. Tous les chemins absolus ci-dessous en dépendent.
const BASE = "/app";
const ASSETS_TO_CACHE = [
  `${BASE}/`, `${BASE}/index.html`, `${BASE}/css/style.css`, `${BASE}/manifest.json`,
  `${BASE}/icons/icon-192.png`, `${BASE}/icons/icon-512.png`, `${BASE}/icons/splash-truck.png`,
  `${BASE}/js/app.js`, `${BASE}/js/auth.js`, `${BASE}/js/utils.js`, `${BASE}/js/theme.js`,
  `${BASE}/js/ui-helpers.js`, `${BASE}/js/supabase-client.js`, `${BASE}/js/dashboard-cards.js`,
  `${BASE}/js/consommation.js`, `${BASE}/js/cartes-perso.js`, `${BASE}/js/notifications.js`,
  `${BASE}/js/photo-docs.js`, `${BASE}/js/intervention-historique.js`,
  `${BASE}/js/settings-aide.js`, `${BASE}/js/offline.js`, `${BASE}/js/update-manager.js`,
  `${BASE}/js/changelog.js`, `${BASE}/js/error-monitor.js`
];

self.addEventListener("install", (e) => {
  // Ne PAS appeler self.skipWaiting() ici : le nouveau service worker doit
  // rester "waiting" tant que l'utilisateur n'a pas validé la popup de mise
  // à jour (js/update-manager.js), qui envoie le message SKIP_WAITING.
  //
  // cache: "reload" (au lieu de caches.addAll direct) : contourne le cache
  // HTTP du navigateur pour forcer une vraie requête réseau sur chaque
  // fichier. Sans ça, si le serveur n'envoie pas d'en-tête Cache-Control
  // strict, le navigateur peut resservir une ancienne version d'un fichier
  // depuis son propre cache HTTP au moment de le précacher — la MAJ serait
  // bien détectée, mais son contenu resterait périmé.
  e.waitUntil(
    caches.open(CACHE_NAME).then((c) =>
      Promise.all(ASSETS_TO_CACHE.map((url) =>
        fetch(url, { cache: "reload" }).then((res) => c.put(url, res))
      ))
    )
  );
});

self.addEventListener("activate", (e) => {
  // Supprime tous les anciens caches d'assets (ancienne version de l'appli)
  // — c'est ce qui évite d'avoir à désinstaller/réinstaller à chaque MAJ.
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
  ));
  self.clients.claim();
});

// Déclenché par update-manager.js quand l'utilisateur confirme la mise à jour.
self.addEventListener("message", (e) => {
  if (e.data === "SKIP_WAITING" || e.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  // Supabase : toujours réseau (pas de cache)
  if (u.hostname.includes("supabase.co")) return;
  // Assets : cache-first, fallback réseau
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((response) => {
        // Mettre en cache les nouveaux assets
        if (response && response.status === 200 && e.request.method === "GET") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, clone)).catch(() => {});
        }
        return response;
      }).catch(() => {
        // Fallback hors-ligne : uniquement pour la navigation (page HTML),
        // pas pour les images/scripts/styles qui doivent échouer normalement.
        if (e.request.mode === "navigate") return caches.match(`${BASE}/index.html`);
        return Response.error();
      });
    })
  );
});

// ─── Réception push en arrière-plan ──────────────────────────────────────
self.addEventListener("push", (e) => {
  if (!e.data) return;
  let data;
  try { data = e.data.json(); } catch { data = { title: "MémoTruck", body: e.data.text() }; }
  e.waitUntil(
    self.registration.showNotification(data.title || "🚛 MémoTruck", {
      body:     data.body  || "",
      icon:     `${BASE}/icons/icon-192.png`,
      badge:    `${BASE}/icons/icon-192.png`,
      tag:      data.tag   || "memotruck",
      renotify: true,
      data:     data
    })
  );
});

// ─── Clic sur une notification ────────────────────────────────────────────
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      if (list.length > 0) { list[0].focus(); return; }
      return clients.openWindow(`${BASE}/`);
    })
  );
});

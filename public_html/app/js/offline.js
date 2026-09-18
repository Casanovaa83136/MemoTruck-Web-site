// ════════════════════════════════════════════════════════════════════════
// MémoTruck — Gestion offline
// - Cache des données chauffeur dans IndexedDB
// - File d'attente des saisies en attente de sync
// - Détection réseau + bandeau + sync automatique
// ════════════════════════════════════════════════════════════════════════

const DB_NAME    = "memotruck-offline";
const DB_VERSION = 1;
const STORE_CACHE  = "cache";      // données chauffeur (lecture)
const STORE_QUEUE  = "sync-queue"; // saisies en attente (écriture)

let _db = null;

// ─── Ouverture IndexedDB ──────────────────────────────────────────────────

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_CACHE))
        db.createObjectStore(STORE_CACHE, { keyPath: "key" });
      if (!db.objectStoreNames.contains(STORE_QUEUE))
        db.createObjectStore(STORE_QUEUE, { keyPath: "id", autoIncrement: true });
    };
    req.onsuccess  = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror    = ()  => reject(req.error);
  });
}

function txGet(store, key) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result?.value ?? null);
    req.onerror   = () => reject(req.error);
  }));
}

function txSet(store, key, value) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const req = db.transaction(store, "readwrite").objectStore(store).put({ key, value });
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  }));
}

function txGetAll(store) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror   = () => reject(req.error);
  }));
}

function txDelete(store, key) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const req = db.transaction(store, "readwrite").objectStore(store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  }));
}

function txAdd(store, value) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const req = db.transaction(store, "readwrite").objectStore(store).add(value);
    req.onsuccess = () => resolve(req.result); // retourne l'id auto-incrémenté
    req.onerror   = () => reject(req.error);
  }));
}

// ─── Cache données chauffeur ──────────────────────────────────────────────

// Sauvegarde tout l'état chauffeur après chaque mise à jour réussie
export async function cacheAppState(appState) {
  try {
    await txSet(STORE_CACHE, "appState", {
      plaqueT:        appState.plaqueT,
      plaqueR:        appState.plaqueR,
      profilMoteur:   appState.profilMoteur,
      profilRemorque: appState.profilRemorque,
      prenom:         appState.prenom,
      chauffeurId:    appState.chauffeurId,
      chauffeur:      appState.chauffeur,
      tracteurData:   appState.tracteurData,
      remorqueData:   appState.remorqueData,
      cachedAt:       new Date().toISOString()
    });
  } catch (_) {}
}

export async function getAppStateCache() {
  try { return await txGet(STORE_CACHE, "appState"); } catch (_) { return null; }
}

// ─── File d'attente sync ──────────────────────────────────────────────────

export async function enqueueSync(type, payload) {
  try {
    const id = await txAdd(STORE_QUEUE, { type, payload, createdAt: new Date().toISOString() });
    updateQueueBadge();
    return id;
  } catch (_) { return null; }
}

export async function getQueue() {
  try { return await txGetAll(STORE_QUEUE); } catch (_) { return []; }
}

export async function removeFromQueue(id) {
  try { await txDelete(STORE_QUEUE, id); updateQueueBadge(); } catch (_) {}
}

// ─── Badge file d'attente ─────────────────────────────────────────────────

export async function updateQueueBadge() {
  const items = await getQueue();
  const badge = document.getElementById("offline-queue-badge");
  if (!badge) return;
  if (items.length > 0) {
    badge.textContent = items.length;
    badge.style.display = "flex";
  } else {
    badge.style.display = "none";
  }
}

// ─── Bandeau offline ──────────────────────────────────────────────────────

let _bandeauEl = null;

function getBandeau() {
  if (_bandeauEl) return _bandeauEl;
  _bandeauEl = document.createElement("div");
  _bandeauEl.id = "offline-bandeau";
  _bandeauEl.className = "offline-bandeau";
  _bandeauEl.style.display = "none";
  document.body.appendChild(_bandeauEl);
  return _bandeauEl;
}

export function showOfflineBandeau(cachedAt = null) {
  const b = getBandeau();
  const heure = cachedAt ? new Date(cachedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : null;
  b.innerHTML = `
    <span style="font-size:14px;">📡</span>
    <span>Hors-ligne${heure ? ` · données du ${new Date(cachedAt).toLocaleDateString("fr-FR")} à ${heure}` : ""}</span>
  `;
  b.style.display = "flex";
}

export function hideOfflineBandeau() {
  const b = getBandeau();
  b.style.display = "none";
}

// ─── Détection réseau + sync automatique ─────────────────────────────────

let _syncCallback = null;
let _cachedAt     = null;

let _offlineInitialized = false;

export function initOfflineManager({ onSync, cachedAt }) {
  _syncCallback = onSync;
  _cachedAt     = cachedAt;

  if (!navigator.onLine) showOfflineBandeau(_cachedAt);

  // Guard anti-doublon si enterDashboard appelé plusieurs fois
  if (_offlineInitialized) return;
  _offlineInitialized = true;

  window.addEventListener("online", async () => {
    hideOfflineBandeau();
    if (_syncCallback) await _syncCallback();
  });

  window.addEventListener("offline", () => {
    showOfflineBandeau(_cachedAt);
  });

  // L'appli revient au premier plan (ex: retour d'un switch d'appli après
  // avoir retrouvé du réseau) : autre moment où "online" a pu être manqué.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && navigator.onLine) {
      hideOfflineBandeau();
      if (_syncCallback) _syncCallback();
    }
  });

  // Filet de sécurité : les évènements online/offline du navigateur sont
  // notoirement peu fiables sur mobile (surtout iOS Safari, qui peut ne
  // jamais les déclencher). Cette vérification périodique garantit une
  // synchro "en direct" au retour du réseau sans dépendre uniquement de ces
  // évènements ni exiger de recharger l'appli.
  setInterval(() => {
    if (navigator.onLine && _syncCallback) _syncCallback();
  }, 15000);
}

export function isOnline() {
  return navigator.onLine;
}

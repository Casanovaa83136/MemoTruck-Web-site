// ════════════════════════════════════════════════════════════════════════
// MémoTruck — Notifications
// Push natif via VAPID + service worker
// Seuils : 30j, 15j, 7j, 1j, 0j
// Anti-doublon : une notif par label+seuil par jour max
// ════════════════════════════════════════════════════════════════════════

import { toDate, CHAMPS_ENGIN } from "./utils.js";
import { dbUpsert } from "./supabase-client.js";

const VAPID_PUBLIC_KEY = "BP32UYy722SWjKRnQ-4qZM48tvogUPJ4THJ3uSKvIvitcSyJD1YjmEA4M8a77vWCkKe3PgtQ9Dvbzu_5ck5FPlM";

const SEUILS = [30, 15, 7, 1, 0]; // jours avant expiration

const ALERTES = [
  { label: "CT Véhicule Moteur",   champ: "date_ct_tracteur" },
  { label: "CT Remorque",          champ: "date_ct_remorque" },
  { label: "Limiteur de Vitesse",  champ: "date_limiteur_vitesse" },
  { label: "Chronotachygraphe",    champ: "date_chronotachygraphe" },
  { label: "Carte Conducteur",     champ: "date_carte_conducteur" },
  { label: "Visite médicale",      champ: "date_visite_medicale" },
  { label: "FCO",                  champ: "date_fco" },
  { label: "ADR",                  champ: "date_adr" },
  { label: "Carte d'identité",     champ: "date_carte_identite" },
  { label: "Carte AS24",           champ: "date_carte_as24" },
  { label: "Carte TOTAL",          champ: "date_carte_total" }
];

// ─── Clé anti-doublon en localStorage ────────────────────────────────────

function _dejaEnvoye(label, joursRestants) {
  const key   = `notif_sent_${label}_${joursRestants}`;
  const today = new Date().toISOString().substring(0, 10);
  return localStorage.getItem(key) === today;
}

function _marquerEnvoye(label, joursRestants) {
  const key   = `notif_sent_${label}_${joursRestants}`;
  const today = new Date().toISOString().substring(0, 10);
  localStorage.setItem(key, today);
}

// ─── Envoi d'une notification via service worker ─────────────────────────

async function _sendNotif(label, diff) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (!("serviceWorker" in navigator)) return;

  // Trouver le seuil correspondant
  const seuil = SEUILS.find(s => diff <= s);
  if (seuil === undefined) return; // plus de 30j → pas de notif
  if (_dejaEnvoye(label, seuil)) return; // déjà envoyée aujourd'hui pour ce seuil

  let body;
  if (diff < 0)       body = `⛔ ${label} est EXPIRÉ depuis ${-diff} jour(s) !`;
  else if (diff === 0) body = `🚨 ${label} expire AUJOURD'HUI !`;
  else if (diff === 1) body = `⚠️ ${label} expire DEMAIN !`;
  else                 body = `⏰ ${label} expire dans ${diff} jour(s)`;

  try {
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification("🚛 MémoTruck", {
      body,
      icon:   "/icons/icon-192.png",
      badge:  "/icons/icon-192.png",
      tag:    `memotruck-${label}-${seuil}`,
      renotify: true,
      data:   { label, diff }
    });
    _marquerEnvoye(label, seuil);
  } catch (e) {
    console.warn("[notif] Échec envoi :", e);
  }
}

// ─── Vérification d'une date ──────────────────────────────────────────────

async function _checkDate(label, dateVal) {
  if (!dateVal) return;
  const date = toDate(dateVal);
  if (!date) return;
  const diff = Math.floor((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (diff > 30) return; // pas encore dans la fenêtre d'alerte
  await _sendNotif(label, diff);
}

// ─── Référence appState injectée depuis app.js ───────────────────────────
let _appState = null;
export function setAppStateNotifications(state) { _appState = state; }

export async function requestNotificationPermission() {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return false;
  if (Notification.permission === "denied") return false;
  if (Notification.permission === "granted") {
    await _subscribePush();
    return true;
  }
  const result = await Notification.requestPermission();
  if (result === "granted") await _subscribePush();
  return result === "granted";
}

export async function checkAllNotifications(vehiculeData, cartesPerso = [], enginActif = null) {
  if (!vehiculeData) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  // Alertes véhicules standard
  for (const { label, champ } of ALERTES) {
    await _checkDate(label, vehiculeData[champ]);
  }

  // Alertes cartes perso
  for (const carte of cartesPerso) {
    if (!carte.aDate || !carte.dateValeur) continue;
    await _checkDate(carte.label, carte.dateValeur);
  }

  // Alerte engin BTP — uniquement celui actuellement affecté au chauffeur,
  // jamais tous les engins de l'entreprise (sinon un chauffeur sur tracteur
  // recevrait les échéances d'engins qu'il n'utilise pas).
  if (enginActif) {
    const nom = enginActif.numero_parc || enginActif.numero_serie || "Engin";
    for (const { key, label } of CHAMPS_ENGIN) {
      if (!enginActif[key]) continue;
      await _checkDate(`${nom} — ${label}`, enginActif[key]);
    }
  }
}

// ─── Abonnement push (VAPID) ──────────────────────────────────────────────

function _urlB64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw     = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function _subscribePush() {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    const sub = existing || await registration.pushManager.subscribe({
      userVisibleOnly:      true,
      applicationServerKey: _urlB64ToUint8Array(VAPID_PUBLIC_KEY)
    });

    const json         = sub.toJSON();
    const chauffeurId  = _appState?.chauffeurId;
    const entrepriseId = _appState?.chauffeur?.entreprise_id;
    if (!chauffeurId) { console.warn("[push] chauffeurId manquant"); return; }
    if (!entrepriseId) { console.warn("[push] entrepriseId manquant"); return; }

    await dbUpsert("push_subscriptions", {
      chauffeur_id:  chauffeurId,
      entreprise_id: String(entrepriseId),
      endpoint:      json.endpoint,
      p256dh:        json.keys.p256dh,
      auth:          json.keys.auth
    }, { onConflict: "endpoint" });
  } catch (e) {
    console.error("[push] ❌ Erreur:", e.message || e);
  }
}

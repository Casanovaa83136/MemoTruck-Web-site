// ════════════════════════════════════════════════════════════════════════
// MémoTruck — Application principale (PWA)
// Supabase — login email seul / signup email+prénom+nom+code entreprise
// ════════════════════════════════════════════════════════════════════════

import { dbSelect, dbInsert, dbInsertMinimal, dbUpdate, dbUpsert, realtimeListen, realtimeListenChangesOnly, dateToISO, callEdgeFunctionAuth } from "./supabase-client.js";
import { initErrorMonitor } from "./error-monitor.js";
import * as Utils from "./utils.js";
import { loadSavedTheme, saveTheme, applyTheme, getCurrentTheme, THEMES } from "./theme.js";
import { showToast, showModal, navigateTo, goBack, setupEdgeSwipeBack, escapeHtml } from "./ui-helpers.js";
import { tryAutoLogin, login, signup, getSession } from "./auth.js";
import { checkAllNotifications, requestNotificationPermission, setAppStateNotifications } from "./notifications.js";
import {
  cacheAppState, getAppStateCache,
  enqueueSync, getQueue, removeFromQueue,
  initOfflineManager, isOnline,
  showOfflineBandeau, updateQueueBadge
} from "./offline.js";

import {
  setAppState as setAppStateCards,
  renderCarteGazole,
  renderCartePneus,
  renderCarteCiterne,
  renderCarteConsoMois,
  renderCarteEngins,
  getConsoEntriesForPneus,
  getConsoEntriesForPneusRemorque,
  invalidateConsoMoisCache,
  invalidateConsoEntriesForPneus
} from "./dashboard-cards.js";

import {
  setAppStateIntervention,
  setupInterventionScreenLogic,
  setupHistoriqueScreenLogic,
  openInterventionScreen,
  openHistoriqueScreen,
  startInterventionsRealtime
} from "./intervention-historique.js";

import {
  setAppStateConso,
  setupConsommationScreenLogic,
  openConsommationScreen,
  openConsoModalPourDate,
  enregistrerJourSansSaisie
} from "./consommation.js";

import {
  setAppStateSettings,
  setupSettingsScreenLogic,
  openParametresScreen,
  openAideScreen
} from "./settings-aide.js";

import {
  setAppStateCartesPerso,
  ensureCartesPersoListener,
  fetchCartesPerso,
  getCartesPerso,
  getCartesPersoForGroupe,
  renderCartePersoItemHTML,
  attachCartePersoListeners,
  renderCustomGroupsSection,
  openCreerCarteModal
} from "./cartes-perso.js";

import {
  listenDocPhotos,
  fetchDocPhotos,
  getCachedDocPhotos,
  uploadDocPhoto,
  deleteDocPhoto,
  uploadInterventionPhoto,
  enregistrerHistoriqueEntretien,
  fetchHistoriqueEntretiens
} from "./photo-docs.js";

// Champs dont l'édition doit passer par la modale combinée date+photo+trace
// (historique_entretiens) plutôt que la simple modale date — la preuve
// papier (photo) est ce qui permet de répondre à un client qui conteste
// un entretien plusieurs mois après.
const TYPES_HISTORIQUE = {
  "date_entretien_frigo":            "frigo",
  "date_entretien_frigo_remorque":   "frigo",
  "date_nettoyage_interieur":        "nettoyage",
  "date_nettoyage_interieur_remorque":"nettoyage",
  "date_graissage":                  "graissage"
};

initErrorMonitor();

// ─── État global ──────────────────────────────────────────────────────────
const appState = {
  plaqueT:        "",
  plaqueR:        "",
  profilMoteur:   null,
  profilRemorque: null,
  prenom:         "",
  chauffeurId:    "",
  chauffeur:      null,
  tracteurData:   null,
  remorqueData:   null,
  vehiculeData:   null,
  enginActif:          null,
  typeVehiculeActif:   "tracteur",
  enginsData:          [],
  panelMecanoActif:    false,
  entrepriseNom:       "",
  unsubTracteur:       null,
  unsubRemorque:       null,
  unsubChauffeur:      null,
  unsubEngin:          null,
  unsubAdmin:          null,
  unsubDocPhotos:      null,
  unsubProfils:        null,

  render:         renderDashboard
};

setAppStateCards(appState);
setAppStateIntervention(appState);
setAppStateConso(appState);
setAppStateSettings(appState);
setAppStateCartesPerso(appState);
setAppStateNotifications(appState);

// ════════════════════════════════════════════════════════════════════════
// FUSION TRACTEUR + REMORQUE + CHAUFFEUR → vehiculeData
// ════════════════════════════════════════════════════════════════════════

function buildVehiculeData() {
  const t = appState.tracteurData || {};
  const r = appState.remorqueData || {};
  const c = appState.chauffeur    || {};

  return {
    // Tracteur — noms exacts attendus par calculerSanteFlotte
    date_ct:                 t.date_ct,
    date_ct_tracteur:        t.date_ct,
    date_assurance_tracteur: t.date_assurance,
    date_limiteur_vitesse:   t.date_limiteur_vitesse,
    date_chronotachygraphe:  t.date_chronotachygraphe,
    km_pneus_avant:         t.km_pneus_avant   || 0,
    date_pose_avant:        t.date_pose_avant,
    km_pneus_arriere:       t.km_pneus_arriere || 0,
    date_pose_arriere:      t.date_pose_arriere,
    // Porteur frigo — champs non préfixés, comme date_ct côté moteur
    date_entretien_frigo:      t.date_entretien_frigo,
    date_nettoyage_interieur:  t.date_nettoyage_interieur,
    date_hayon:                t.date_hayon,
    a_hayon:                   t.a_hayon,
    // Remorque
    date_ct_remorque:        r.date_ct,
    date_assurance_remorque: r.date_assurance,
    km_pneus_remorque_e1:   r.km_pneus_e1 || 0,
    date_pose_e1:           r.date_pose_e1,
    km_pneus_remorque_e2:   r.km_pneus_e2 || 0,
    date_pose_e2:           r.date_pose_e2,
    km_pneus_remorque_e3:   r.km_pneus_e3 || 0,
    date_pose_e3:           r.date_pose_e3,
    date_entretien_frigo_remorque:      r.date_entretien_frigo,
    date_nettoyage_interieur_remorque:  r.date_nettoyage_interieur,
    date_graissage:                     r.date_graissage,
    date_hayon_remorque:                r.date_hayon,
    a_hayon_remorque:                   r.a_hayon,
    bi_temperature:                     r.bi_temperature,
    // Chauffeur
    date_carte_conducteur:  c.date_carte_conducteur,
    date_visite_medicale:   c.date_visite_medicale,
    date_fco:               c.date_fco,
    date_adr:               c.date_adr,
    date_carte_identite:    c.date_carte_identite,
    date_carte_as24:        c.date_carte_as24,
    code_carte_as24:        c.code_carte_as24  || "",
    date_carte_total:       c.date_carte_total,
    code_carte_total:       c.code_carte_total || "",
  };
}

// ════════════════════════════════════════════════════════════════════════
// INITIALISATION
// ════════════════════════════════════════════════════════════════════════

async function init() {
  loadSavedTheme();
  setupLoginScreen();
  setupDashboardActions();
  setupBackButtons();
  setupSettingsScreenLogic();
  setupInterventionScreenLogic();
  setupHistoriqueScreenLogic();
  setupConsommationScreenLogic();
  setupCamionPhotoPicker();

  const splashPromise = new Promise((resolve) => setTimeout(resolve, 2000));

  const session = getSession();
  appState.prenom = session.prenom;

  const autoLoginResult = await tryAutoLogin();

  await splashPromise;

  const splash = document.getElementById("splash-screen");
  splash.classList.add("fade-out");
  setTimeout(() => splash.remove(), 950);

  if (autoLoginResult.success) {
    enterDashboard(autoLoginResult);
  } else if (!navigator.onLine) {
    // Pas de réseau → tenter de restaurer depuis le cache
    const cached = await getAppStateCache();
    if (cached) {
      showOfflineBandeau(cached.cachedAt);
      enterDashboard(cached);
    } else {
      navigateTo("screen-login");
    }
  } else {
    navigateTo("screen-login");
  }
}

// ─── Sync file d'attente ──────────────────────────────────────────────────
let _syncInProgress = false;
async function _syncQueue() {
  // Ré-entrance possible : évènement "online", retour au premier plan et
  // vérification périodique peuvent se déclencher à quelques secondes
  // d'intervalle — évite un double-envoi de la même saisie en attente.
  if (_syncInProgress) return;
  _syncInProgress = true;
  try {
    await _doSyncQueue();
  } finally {
    _syncInProgress = false;
  }
}

async function _doSyncQueue() {
  const items = await getQueue();
  if (items.length === 0) return;
  let synced = 0;
  let failed = 0;
  for (const item of items) {
    try {
      if (item.type === "consommation_insert") {
        await dbInsert("consommations", item.payload);
      } else if (item.type === "consommation_update") {
        await dbUpdate("consommations", item.payload.data, [{ col: "id", op: "eq", val: item.payload.id }]);
      } else if (item.type === "intervention_insert") {
        const { photos, ...interventionData } = item.payload;
        await dbInsertMinimal("interventions", interventionData);
        if (interventionData.statut === "a_faire") {
          callEdgeFunctionAuth("workshop-notify", { action: "notify_a_faire", intervention_id: interventionData.id })
            .catch((e) => console.warn("[workshop-notify]", e.message));
        }
        for (const file of photos || []) {
          uploadInterventionPhoto(interventionData.entreprise_id, interventionData.id, file)
            .catch((e) => console.warn("[photo]", e.message));
        }
      }
      await removeFromQueue(item.id);
      synced++;
    } catch (e) {
      // 4xx = le serveur a rejeté la saisie elle-même (données invalides) —
      // la retenter en boucle toutes les 15s ne changera rien. On l'abandonne
      // pour ne pas bloquer indéfiniment le reste de la file, en prévenant
      // l'utilisateur. Sans statut (coupure réseau) ou 5xx (souci serveur
      // temporaire) : on garde l'item, le prochain passage réessaiera.
      if (e.status >= 400 && e.status < 500) {
        await removeFromQueue(item.id);
        failed++;
      }
    }
  }
  if (synced > 0) {
    showToast(`✅ ${synced} saisie(s) synchronisée(s)`);
    invalidateConsoMoisCache();
    invalidateConsoEntriesForPneus();
    if (appState.render) appState.render();
  }
  if (failed > 0) {
    showToast(`⚠️ ${failed} saisie(s) refusée(s) par le serveur — vérifie et ressaisis si besoin`);
  }
}

// ════════════════════════════════════════════════════════════════════════
// LOGIN SCREEN — deux panels : connexion / inscription
// ════════════════════════════════════════════════════════════════════════

function setupLoginScreen() {
  // ── Basculement entre les deux panels ──
  document.getElementById("btn-switch-to-signup").addEventListener("click", () => {
    document.getElementById("login-panel-connexion").classList.add("hidden");
    document.getElementById("login-panel-inscription").classList.remove("hidden");
    document.getElementById("input-signup-email").value =
      document.getElementById("input-email").value;   // pré-remplit l'email
  });

  document.getElementById("btn-switch-to-login").addEventListener("click", () => {
    document.getElementById("login-panel-inscription").classList.add("hidden");
    document.getElementById("login-panel-connexion").classList.remove("hidden");
  });

  document.getElementById("btn-attente-retour-connexion").addEventListener("click", () => {
    document.getElementById("login-panel-attente").classList.add("hidden");
    document.getElementById("login-panel-connexion").classList.remove("hidden");
  });

  // ── Connexion ──
  document.getElementById("btn-login").addEventListener("click", handleLoginClick);
  document.getElementById("input-email").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleLoginClick();
  });
  document.getElementById("input-password").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleLoginClick();
  });

  // ── Inscription ──
  document.getElementById("btn-signup").addEventListener("click", handleSignupClick);
}

async function handleLoginClick() {
  const btn      = document.getElementById("btn-login");
  const btnText  = document.getElementById("login-btn-text");
  const email    = document.getElementById("input-email").value.trim();
  const password = document.getElementById("input-password").value;

  btn.disabled = true;
  btnText.innerHTML = '<span class="spinner"></span>';

  const result = await login({ email, password });

  btn.disabled = false;
  btnText.textContent = "SE CONNECTER";

  if (result.success) {
    enterDashboard(result);
  } else {
    showToast(result.message);
  }
}

async function handleSignupClick() {
  const btn     = document.getElementById("btn-signup");
  const btnText = document.getElementById("signup-btn-text");
  const email           = document.getElementById("input-signup-email").value.trim();
  const prenom          = document.getElementById("input-signup-prenom").value.trim();
  const nom             = document.getElementById("input-signup-nom").value.trim();
  const codeEntreprise  = document.getElementById("input-signup-code").value.trim();
  const password        = document.getElementById("input-signup-password").value;

  btn.disabled = true;
  btnText.innerHTML = '<span class="spinner"></span>';

  const result = await signup({ email, prenom, nom, codeEntreprise, password });

  btn.disabled = false;
  btnText.textContent = "S'INSCRIRE";

  // Inscription envoyée : panel d'attente dédié plutôt qu'un toast de 3s
  // qui disparaît pendant que l'écran change — un nouveau chauffeur qui ne
  // connaît pas encore l'appli doit pouvoir lire tranquillement qu'il faut
  // attendre la validation de son exploitant.
  if (result.isSignup) {
    document.getElementById("login-panel-inscription").classList.add("hidden");
    document.getElementById("login-panel-attente").classList.remove("hidden");
    document.getElementById("input-email").value = email;
    // Vide le formulaire d'inscription
    document.getElementById("input-signup-email").value    = "";
    document.getElementById("input-signup-prenom").value   = "";
    document.getElementById("input-signup-nom").value      = "";
    document.getElementById("input-signup-code").value     = "";
    document.getElementById("input-signup-password").value = "";
  } else {
    showToast(result.message);
  }
}

// ════════════════════════════════════════════════════════════════════════
// ENTRÉE DASHBOARD
// ════════════════════════════════════════════════════════════════════════

async function enterDashboard({ prenom, chauffeurId, chauffeur, plaqueT, plaqueR, profilMoteur, profilRemorque, tracteurData, remorqueData, enginActif, typeVehiculeActif }) {
  appState.chauffeurId       = chauffeurId       || "";
  appState.chauffeur         = chauffeur         || null;

  // Thème du compte (prioritaire sur le dernier thème utilisé sur cet appareil)
  const themePrefere = chauffeur?.theme_prefere;
  if (themePrefere && Object.values(THEMES).includes(themePrefere) && themePrefere !== getCurrentTheme()) {
    saveTheme(themePrefere);
  }

  appState.plaqueT           = plaqueT           || "";
  appState.plaqueR           = plaqueR           || "";
  appState.profilMoteur      = profilMoteur      || null;
  appState.profilRemorque    = profilRemorque    || null;
  appState.tracteurData      = tracteurData      || null;
  appState.remorqueData      = remorqueData      || null;
  appState.enginActif        = enginActif        || null;
  appState.typeVehiculeActif = typeVehiculeActif || (enginActif ? "engin" : "tracteur");
  if (prenom !== undefined) appState.prenom = prenom;

  // Charge le catalogue de profils véhicules (globaux + perso entreprise)
  // AVANT buildVehiculeData() : le calcul du score santé et le nombre de
  // pneus/compartiments affichés en dépendent. En cas d'échec (hors-ligne),
  // les profils codés en dur dans utils.js servent de secours.
  await Utils.chargerProfilsDepuisDB();

  appState.vehiculeData = buildVehiculeData();

  // Charger les engins de l'entreprise (pour notifications push)
  try {
    const engins = await dbSelect("engins", {
      filters: [{ col: "entreprise_id", op: "eq", val: appState.chauffeur?.entreprise_id || "" }]
    });
    appState.enginsData = engins || [];
  } catch (_) {
    appState.enginsData = [];
  }

  // Option "panel atelier" de l'entreprise (affiche le bouton "à faire" sur
  // les interventions si active — rien ne change sinon)
  try {
    const entreprises = await dbSelect("entreprises", {
      select: "nom,panel_mecano_actif",
      filters: [{ col: "id", op: "eq", val: appState.chauffeur?.entreprise_id || "" }]
    });
    appState.panelMecanoActif = !!entreprises?.[0]?.panel_mecano_actif;
    appState.entrepriseNom    = entreprises?.[0]?.nom || "";
    const entrepriseEl = document.getElementById("dh9-entreprise");
    if (entrepriseEl) entrepriseEl.textContent = appState.entrepriseNom;
  } catch (_) {
    appState.panelMecanoActif = false;
  }

  // Sauvegarder l'état en cache offline
  await cacheAppState(appState);

  // Init gestionnaire offline — sync automatique au retour réseau
  initOfflineManager({
    cachedAt: new Date().toISOString(),
    onSync: async () => {
      await _syncQueue();
    }
  });
  updateQueueBadge(); // reflète immédiatement une file d'attente déjà existante

  // Filet de sécurité : si l'appli est (ré)ouverte alors que le réseau est
  // déjà revenu, l'évènement "online" ne se déclenche jamais (ce n'est pas
  // une transition) et une saisie mise en attente resterait bloquée jusqu'au
  // prochain vrai cycle offline→online. On tente donc aussi une synchro ici.
  if (isOnline()) _syncQueue();

  navigateTo("screen-dashboard");

  // Charge les cartes perso AVANT le premier render
  await fetchCartesPerso();

  // Si pas de tracteur affecté → popup prise de service obligatoire
  if (!appState.plaqueT) {
    await openPriseDeServiceModal({ obligatoire: true });
  } else {
    renderDashboard();
    checkAllNotifications(appState.vehiculeData, getCartesPerso());
    listenToChanges();
    _initForegroundRefresh();
    listenAdminChanges();
    listenProfilsChanges();
    if (appState.panelMecanoActif) startInterventionsRealtime();
    ensureCartesPersoListener();
    // JWT déjà injecté avant enterDashboard → listener photos démarré après
    _startDocPhotosListener();
    maybePromptNotificationPermission();
  }

  _checkSaisiesConsoManquantes();
}

// ════════════════════════════════════════════════════════════════════════
// ÉCOUTE TEMPS RÉEL
// ════════════════════════════════════════════════════════════════════════

// ─── Listener admin → PWA ────────────────────────────────────────────────
// Utilise realtimeListenChangesOnly (pas de fetch initial) pour éviter
// d'écraser les données au démarrage. Ne réagit qu'aux vrais changements.
function listenAdminChanges() {
  if (appState.unsubAdmin) { appState.unsubAdmin(); appState.unsubAdmin = null; }
  if (!appState.chauffeurId) return;

  appState.unsubAdmin = realtimeListenChangesOnly(
    "sessions_actives",
    { chauffeur_id: appState.chauffeurId },
    async (rows) => {
      if (!rows || rows.length === 0) return;
      const s          = rows[0];
      const newPlaqueT = (s.plaque_tracteur || "").toUpperCase().trim();
      const newPlaqueR = (s.plaque_remorque || "").toUpperCase().trim();

      // Rien n'a changé
      if (newPlaqueT === appState.plaqueT && newPlaqueR === appState.plaqueR) return;

      // Mise à jour
      appState.plaqueT = newPlaqueT;
      appState.plaqueR = newPlaqueR;

      try {
        const [tRows, rRows] = await Promise.all([
          newPlaqueT ? dbSelect("tracteurs", { filters: [{ col: "plaque", op: "eq", val: newPlaqueT }] }) : Promise.resolve([]),
          newPlaqueR ? dbSelect("remorques",  { filters: [{ col: "plaque", op: "eq", val: newPlaqueR }] }) : Promise.resolve([])
        ]);
        appState.tracteurData = tRows && tRows.length > 0 ? tRows[0] : null;
        appState.remorqueData = rRows && rRows.length > 0 ? rRows[0] : null;
      } catch (_) {}

      invalidateConsoMoisCache();
      appState.vehiculeData = buildVehiculeData();
      // Recharge les cartes perso pour le nouveau véhicule
      await fetchCartesPerso();
      renderDashboard();
      checkAllNotifications(appState.vehiculeData, getCartesPerso());
      showToast(`🚚 Véhicule mis à jour : ${newPlaqueT || "Solo"}`);
    }
  );
}

// ─── Listener catalogue de profils véhicules (superadmin / exploitant) ────
// Un profil ajouté/modifié (nouveau type de remorque, nouvelle carte
// activée...) recharge le catalogue et re-render sans que le chauffeur
// ait besoin de relancer l'appli.
function listenProfilsChanges() {
  if (appState.unsubProfils) { appState.unsubProfils(); appState.unsubProfils = null; }
  appState.unsubProfils = Utils.ecouterProfilsVehicules(() => {
    appState.vehiculeData = buildVehiculeData();
    renderDashboard();
    checkAllNotifications(appState.vehiculeData, getCartesPerso());
  });
}

function listenToChanges() {
  if (appState.unsubTracteur)  appState.unsubTracteur();
  if (appState.unsubRemorque)  appState.unsubRemorque();
  if (appState.unsubChauffeur) appState.unsubChauffeur();
  if (appState.unsubEngin)     appState.unsubEngin();
  invalidateConsoMoisCache();

  // Engin BTP actif
  if (appState.typeVehiculeActif === "engin" && appState.enginActif?.id) {
    appState.unsubEngin = realtimeListen(
      "engins",
      { id: appState.enginActif.id },
      (rows) => {
        if (!rows || rows.length === 0) return;
        appState.enginActif   = rows[0];
        appState.vehiculeData = buildVehiculeData();
        renderDashboard();
        checkAllNotifications(appState.vehiculeData, getCartesPerso(), appState.typeVehiculeActif === "engin" ? appState.enginActif : null);
      }
    );
  }

  // Tracteur
  if (appState.plaqueT) {
    appState.unsubTracteur = realtimeListen(
      "tracteurs",
      { plaque: appState.plaqueT },
      (rows) => {
        appState.tracteurData = rows && rows.length > 0 ? rows[0] : appState.tracteurData;
        appState.profilMoteur = appState.tracteurData?.profil || null;
        appState.vehiculeData = buildVehiculeData();
        renderDashboard();
        checkAllNotifications(appState.vehiculeData, getCartesPerso(), appState.typeVehiculeActif === "engin" ? appState.enginActif : null);
      }
    );
  }

  // Remorque
  if (appState.plaqueR) {
    appState.unsubRemorque = realtimeListen(
      "remorques",
      { plaque: appState.plaqueR },
      (rows) => {
        appState.remorqueData  = rows && rows.length > 0 ? rows[0] : appState.remorqueData;
        appState.profilRemorque = appState.remorqueData?.profil || null;
        appState.vehiculeData = buildVehiculeData();
        renderDashboard();
        checkAllNotifications(appState.vehiculeData, getCartesPerso(), appState.typeVehiculeActif === "engin" ? appState.enginActif : null);
      }
    );
  }

  // Chauffeur — docs perso et cartes gazole uniquement
  if (appState.chauffeurId) {
    appState.unsubChauffeur = realtimeListen(
      "chauffeurs",
      { id: appState.chauffeurId },
      (rows) => {
        if (!rows || rows.length === 0) return;
        appState.chauffeur    = rows[0];
        appState.vehiculeData = buildVehiculeData();
        renderDashboard();
        checkAllNotifications(appState.vehiculeData, getCartesPerso(), appState.typeVehiculeActif === "engin" ? appState.enginActif : null);
      }
    );
  }
}

// ─── Rafraîchissement au retour au premier plan ──────────────────────────
// Le WebSocket Realtime peut se déconnecter silencieusement quand l'appli
// est mise en arrière-plan (fréquent sur mobile) sans que le SDK ne le
// signale : une modification faite côté admin pendant ce temps-là (ex: une
// date d'entretien) ne remonte alors jamais tant qu'on ne recharge pas la
// page à la main. Filet de sécurité : au retour au premier plan / à la
// reconnexion réseau, on force un ré-abonnement + refetch complet (au lieu
// de compter uniquement sur le WebSocket).
let _foregroundRefreshInitialized = false;
function _initForegroundRefresh() {
  if (_foregroundRefreshInitialized) return;
  _foregroundRefreshInitialized = true;

  const refresh = () => {
    if (!appState.chauffeurId) return;
    listenToChanges();
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refresh();
  });
  window.addEventListener("online", refresh);
}

async function maybePromptNotificationPermission() {
  if (!("Notification" in window)) return;
  // Déjà accordée → re-enregistrer la subscription silencieusement
  if (Notification.permission === "granted") {
    await requestNotificationPermission();
    return;
  }
  // Refusée → ne rien faire
  if (Notification.permission === "denied") return;
  // Pas encore demandée → afficher la popup
  showModal({
    title: "🔔 Activer les alertes",
    bodyHTML: `<div class="modal-text">Reçois une alerte uniquement quand une date approche de son échéance (CT, carte, assurance…). Si tout est à jour, aucune notification — pas de spam au quotidien, juste l'essentiel au bon moment.</div>`,
    confirmLabel: "Activer",
    cancelLabel: "Plus tard",
    onConfirm: async () => {
      await requestNotificationPermission();
      checkAllNotifications(appState.vehiculeData, getCartesPerso());
    }
  });
}

// ════════════════════════════════════════════════════════════════════════
// DASHBOARD — RENDU PRINCIPAL
// ════════════════════════════════════════════════════════════════════════

function renderDashboard() {
  const prenomEl = document.getElementById("welcome-prenom");
  if (prenomEl) prenomEl.textContent = appState.prenom || "chauffeur";

  const estEngin = appState.typeVehiculeActif === "engin";

  // Badge principal : plaque tracteur OU nom de l'engin
  if (estEngin) {
    const engin = appState.enginActif;
    const label = engin ? (engin.numero_parc || engin.numero_serie || "Engin") : "—";
    const profilEngin = engin ? Utils.getProfilEngin(engin.profil) : null;
    _renderBadgeVehicule("badge-plaqueT", label, "tracteur", profilEngin?.label);
    // Masquer badge remorque pour les engins
    const wrapR = document.getElementById("badge-plaqueR-wrap");
    if (wrapR) wrapR.style.display = "none";
  } else {
    const profilMoteur = Utils.getProfilMoteur(appState.profilMoteur);
    _renderBadgeVehicule("badge-plaqueT", appState.plaqueT || "—", "tracteur", profilMoteur?.label);
    const wrapR = document.getElementById("badge-plaqueR-wrap");
    if (wrapR) wrapR.style.display = "";
    const profilRemorque = appState.plaqueR ? Utils.getProfilRemorque(appState.profilRemorque) : null;
    _renderBadgeVehicule("badge-plaqueR", appState.plaqueR || "Solo", "remorque", profilRemorque?.label);
  }

  renderCamionPhoto();
  renderCarteVehicules();
  renderCarteDonneesPerso();

  if (!estEngin) {
    // Cartes uniquement pour véhicules routiers
    renderCarteGazole();
    renderCarteConsoMois(() => openConsommationScreen());
    renderCartePneus();
    renderCarteCiterne();
    // Réafficher les sections si elles étaient cachées
    const secConso = document.getElementById("carte-conso-mois")?.closest(".section-block.gap-24");
    if (secConso) secConso.style.display = "";
    const secPneus = document.getElementById("carte-pneus-tracteur")?.closest(".section-block");
    if (secPneus) secPneus.style.display = "";
  } else {
    // Vider et cacher les cartes inutiles pour les engins
    const cConsoMois = document.getElementById("carte-conso-mois");
    if (cConsoMois) cConsoMois.innerHTML = "";
    const secConso = cConsoMois?.closest(".section-block.gap-24");
    if (secConso) secConso.style.display = "none";

    const cPneusT = document.getElementById("carte-pneus-tracteur");
    if (cPneusT) cPneusT.innerHTML = "";
    const cPneusR = document.getElementById("carte-pneus-remorque");
    if (cPneusR) cPneusR.innerHTML = "";
    const secPneus = cPneusT?.closest(".section-block");
    if (secPneus) secPneus.style.display = "none";

    const cGazole = document.getElementById("carte-gazole");
    if (cGazole) cGazole.innerHTML = "";

    const cCiterne = document.getElementById("carte-citerne");
    if (cCiterne) cCiterne.innerHTML = "";
    const secCiterne = document.getElementById("section-citerne");
    if (secCiterne) secCiterne.style.display = "none";
  }

  renderCustomGroupsSection();
  renderSanteGauge();

  // Réinjecte les orbes après le render (seulement si pas déjà présents)
  requestAnimationFrame(() => {
    if (!document.querySelector(".theme-deco-layer")) {
      applyTheme(getCurrentTheme());
    }
  });

  document.getElementById("footer-dashboard").textContent = `© 2026 · ${Utils.ATIL_VERSION} · MémoTruck`;
}

// ─── Jauge santé (cadran conducteur) ────────────────────────────────────────
const MAX_PASTILLES_ALERTE = 5;

function renderSanteGauge() {
  // Jauge = véhicule actif uniquement
  const enginsPourSante = appState.typeVehiculeActif === "engin" && appState.enginActif
    ? [appState.enginActif]
    : [];

  const sante = Utils.calculerSanteFlotte(
    appState.vehiculeData,
    getConsoEntriesForPneus(),
    getCartesPerso(),
    getConsoEntriesForPneusRemorque(),
    appState.profilMoteur,
    appState.profilRemorque,
    enginsPourSante
  );
  const needle     = document.getElementById("sante-gauge-needle");
  const needleLine = document.getElementById("sante-gauge-needle-line");
  const pivot      = document.getElementById("sante-gauge-pivot");
  const percent    = document.getElementById("sante-percent");
  if (!needle || !needleLine || !pivot || !percent) return;

  const pct = Math.max(0, Math.min(100, sante.pourcentage || 0));
  const angle = -90 + (pct / 100) * 180;
  needle.setAttribute("transform", `rotate(${angle} 50 54)`);

  const couleur = pct >= 80 ? "var(--color-success)"
                : pct >= 50 ? "var(--color-warning)"
                : "var(--color-danger)";
  needleLine.style.stroke = couleur;
  pivot.style.fill = couleur;

  percent.textContent = `${pct}%`;

  // Watermark concept 9
  const watermark = document.getElementById("sante-percent-watermark");
  if (watermark) watermark.textContent = `${pct}%`;
  percent.style.color = couleur;

  const alertesRow = document.getElementById("sante-alertes-row");
  const visibles   = sante.alertes.slice(0, MAX_PASTILLES_ALERTE);
  const reste      = sante.alertes.length - visibles.length;

  if (sante.alertes.length === 0) {
    alertesRow.classList.add("hidden");
    alertesRow.innerHTML = "";
  } else {
    alertesRow.classList.remove("hidden");
    alertesRow.innerHTML = visibles.map((a) => {
      const c = a.rang >= 3 ? "var(--color-danger)" : "var(--color-warning)";
      return `<div class="alerte-pill" style="background:color-mix(in srgb, ${c} 18%, transparent); color:${c};">⚠ ${escapeHtml(a.label)}</div>`;
    }).join("") + (reste > 0
      ? `<div class="alerte-pill" style="background:var(--color-surface); color:var(--color-text-secondary);">+${reste} autre(s)</div>`
      : "");
  }
}

// ─── Historique attelages ─────────────────────────────────────────────────

async function _enregistrerAttelage(plaqueT, plaqueR, profilMoteur, profilRemorque) {
  if (!plaqueT || !appState.chauffeurId) return;
  try {
    const today = new Date().toISOString().substring(0, 10);
    const entrepriseId = appState.chauffeur?.entreprise_id || "";

    // Clôturer l'attelage précédent du jour s'il existe
    const existants = await dbSelect("historique_attelages", {
      filters: [
        { col: "chauffeur_id", op: "eq", val: appState.chauffeurId },
        { col: "date_debut",   op: "eq", val: today },
        { col: "date_fin",     op: "is", val: "null" }
      ]
    });
    if (existants && existants.length > 0) {
      // Calculer les km parcourus depuis la prise de service
      const kmJour = await _kmDuJour(appState.plaqueT, today);
      for (const att of existants) {
        await dbUpdate("historique_attelages",
          { date_fin: today, km_parcourus: kmJour },
          [{ col: "id", op: "eq", val: att.id }]
        );
      }
    }

    // Créer le nouvel attelage
    await dbInsert("historique_attelages", {
      entreprise_id:   entrepriseId,
      chauffeur_id:    appState.chauffeurId,
      plaque_tracteur: plaqueT,
      plaque_remorque: plaqueR || null,
      profil_moteur:   profilMoteur || null,
      profil_remorque: profilRemorque || null,
      date_debut:      today
    });
  } catch (e) {
    console.warn("[historique] Erreur enregistrement attelage:", e);
  }
}

async function _kmDuJour(plaqueT, date) {
  if (!plaqueT) return 0;
  try {
    const rows = await dbSelect("consommations", {
      select: "kilometres",
      filters: [
        { col: "plaque_tracteur", op: "eq",  val: plaqueT },
        { col: "date",            op: "eq",  val: date }
      ]
    });
    return (rows || []).reduce((s, r) => s + Number(r.kilometres || 0), 0);
  } catch (_) { return 0; }
}

// ─── Vérification saisie conso manquante à la prise de service ───────────
// Fenêtre glissante de 7 jours (dimanches exclus, jamais roulés/relancés) :
// une seule requête groupée pour repérer tous les jours sans trace, puis une
// seule popup qui les liste tous. Contrairement à l'ancienne version qui ne
// vérifiait que la veille (ou 3 jours le lundi), un jour non traité ne
// disparaît plus jamais de la relance tant qu'il n'a pas reçu une vraie
// saisie, un "pas roulé" ou un "oubli" — chacun laisse désormais une trace
// en base (voir enregistrerJourSansSaisie dans consommation.js), donc plus
// besoin du flag localStorage d'avant qui ne survivait ni à un changement
// d'appareil ni à une réinstallation.
const _FENETRE_RELANCE_JOURS = 7;

async function _checkSaisiesConsoManquantes() {
  if (!appState.plaqueT) return;

  const aujourdhui = new Date();
  if (aujourdhui.getDay() === 0) return; // pas de relance le dimanche

  const debut = _joursAvant(aujourdhui, _FENETRE_RELANCE_JOURS);
  let rows;
  try {
    rows = await dbSelect("consommations", {
      select: "date",
      filters: [
        { col: "plaque_tracteur", op: "eq", val: appState.plaqueT },
        { col: "date",            op: "gte", val: dateToISO(debut) }
      ]
    });
  } catch (_) {
    return; // erreur réseau → ne pas relancer le chauffeur
  }
  const datesExistantes = new Set((rows || []).map((r) => r.date));

  const manquants = [];
  for (let n = _FENETRE_RELANCE_JOURS; n >= 1; n--) {
    const date = _joursAvant(aujourdhui, n);
    if (date.getDay() === 0) continue; // jamais de relance sur un dimanche
    const dateISO = dateToISO(date);
    if (!datesExistantes.has(dateISO)) manquants.push({ date, dateISO });
  }

  if (manquants.length > 0) await _demanderSaisiesManquantes(manquants);
}

function _joursAvant(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() - n);
  return d;
}

function _demanderSaisiesManquantes(manquants) {
  return new Promise((resolve) => {
    const joursLabel = manquants.map((m) => Utils.formatDateLongFR(m.date)).join(", ");
    const pluriel     = manquants.length > 1;

    showModal({
      title: "⚠️ Saisie manquante",
      bodyHTML: `<div class="modal-text">Aucune consommation saisie pour ${escapeHtml(joursLabel)}. Le camion n'a pas roulé ${pluriel ? "ces jours-là" : "ce jour-là"} ?</div>`,
      stackedPrimary: true,
      confirmLabel: "✏️ Je saisis maintenant",
      confirmClass: "saisie",
      cancelLabel: "🚫 Pas roulé",
      cancelClass: "pasroule",
      tertiaryLabel: "🕓 Plus tard",
      tertiaryClass: "oubli",
      onConfirm: () => {
        _saisirJoursManquants(manquants.slice(), resolve);
        return true;
      },
      onCancel: async () => {
        await _marquerJoursSansSaisie(manquants, "pas_roule");
        resolve();
      },
      onTertiary: async () => {
        await _marquerJoursSansSaisie(manquants, "oubli");
        resolve();
      }
    });
  });
}

async function _marquerJoursSansSaisie(manquants, statut) {
  for (const m of manquants) {
    try { await enregistrerJourSansSaisie(m.dateISO, statut, null); } catch (_) {
      // Un jour en échec (réseau) n'empêche pas de traiter les suivants —
      // il redeviendra "manquant" et sera reproposé à la prochaine relance,
      // c'est le comportement voulu (pas de perte silencieuse).
    }
  }
}

// Enchaîne les formulaires de saisie conso, un par jour manquant (chaque
// jour a son propre km/consommation, impossible à fusionner en une saisie).
function _saisirJoursManquants(restants, resolveFinal) {
  if (restants.length === 0) { resolveFinal(); return; }
  const [prochain, ...suite] = restants;
  openConsoModalPourDate(prochain.date, () => _saisirJoursManquants(suite, resolveFinal));
}
function renderCamionPhoto() {
  const box = document.getElementById("camion-photo-box");
  if (!box) return;
  const key        = `atil_photo_${appState.chauffeurId}`;
  const dbPhoto    = appState.typeVehiculeActif === "engin"
    ? appState.enginActif?.photo_vehicule
    : appState.tracteurData?.photo_vehicule;
  const savedPhoto = dbPhoto || localStorage.getItem(key);
  box.innerHTML = savedPhoto
    ? `<img src="${savedPhoto}" alt="Photo du camion" />
       <div class="camion-photo-overlay"></div>
       <div class="camion-photo-caption">📷 Changer la photo</div>`
    : `<div class="camion-photo-placeholder">
         <span class="icon">📷</span>
         <div class="main-text">Ajouter une photo du véhicule</div>
         <div class="sub-text">Appuyez pour sélectionner</div>
       </div>`;
}

function setupCamionPhotoPicker() {
  const box   = document.getElementById("camion-photo-box");
  const input = document.getElementById("camion-photo-input");
  if (!box || !input) return;
  box.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    const file = input.files[0];
    if (!file) return;
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = async () => {
      URL.revokeObjectURL(url);
      const MAX = 800;
      let w = img.naturalWidth, h = img.naturalHeight;
      if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
      if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      const data = canvas.toDataURL("image/jpeg", 0.7);
      // Fallback offline
      try { localStorage.setItem(`atil_photo_${appState.chauffeurId}`, data); } catch (_) {}
      // Sauvegarde Supabase
      try {
        if (appState.typeVehiculeActif === "engin" && appState.enginActif?.id) {
          await dbUpdate("engins", { photo_vehicule: data }, [
            { col: "id", op: "eq", val: appState.enginActif.id }
          ]);
          if (appState.enginActif) appState.enginActif.photo_vehicule = data;
        } else if (appState.plaqueT) {
          await dbUpdate("tracteurs", { photo_vehicule: data }, [
            { col: "plaque", op: "eq", val: appState.plaqueT }
          ]);
          if (appState.tracteurData) appState.tracteurData.photo_vehicule = data;
        }
      } catch (e) {
        console.warn("[photo vehicule]", e.message);
      }
      renderCamionPhoto();
    };
    img.src = url;
  });
}

// ════════════════════════════════════════════════════════════════════════
// CARTES GROUPÉES — VÉHICULES + DONNÉES PERSO
// ════════════════════════════════════════════════════════════════════════

const openGroupCards = {};

function renderGroupCard(containerId, { titre, emoji, items, textItems = [], cartesPerso = [] }) {
  const container = document.getElementById(containerId);
  const isOpen    = !!openGroupCards[containerId];

  let pireCouleur = "var(--color-text-secondary)";
  let pireRang    = -2;
  items.forEach(({ val }) => {
    const rang = Utils.rangStatut(val);
    if (rang > pireRang) { pireRang = rang; pireCouleur = Utils.getStatusColorStatic(val); }
  });
  cartesPerso.forEach((c) => {
    if (!c.aDate) return;
    const rang = Utils.rangStatut(c.dateValeur);
    if (rang > pireRang) { pireRang = rang; pireCouleur = Utils.getStatusColorStatic(c.dateValeur); }
  });

  const subItemsHTML = textItems.map((item) => renderTextCardHTML(item)).join("")
    + items.map((item) => renderDateCardHTML(item)).join("")
    + cartesPerso.map((c) => renderCartePersoItemHTML(c)).join("");

  const theme = document.documentElement.getAttribute("data-theme") || "nuit";
  const isAurora   = theme === "aurora";
  const isObsidian = theme === "obsidian";
  const isPremium  = isAurora || isObsidian;

  // Ligne lumineuse en haut pour les thèmes premium
  const glowLine = isPremium ? `
    <div style="position:absolute;top:0;left:10%;right:10%;height:1px;
      background:linear-gradient(90deg,transparent,${isAurora ? "rgba(168,216,255,0.9),rgba(127,255,207,0.7)" : "rgba(41,121,255,0.9),rgba(6,182,212,0.7)"},transparent);
      pointer-events:none;border-radius:1px;z-index:2;"></div>` : "";

  // Barre gauche : dégradé sur les thèmes premium
  const barStyle = isPremium
    ? `background:linear-gradient(to bottom,${isAurora ? "#a8d8ff,#7fffcf" : "#2979ff,#06b6d4"});box-shadow:2px 0 10px ${isAurora ? "rgba(168,216,255,0.6)" : "rgba(41,121,255,0.5)"};`
    : `background:${pireCouleur};`;

  container.innerHTML = `
    <div class="group-card ${isOpen ? "is-open" : ""}" style="border-color:${isOpen ? "var(--color-accent)" : pireCouleur + "99"};position:relative;overflow:hidden;">
      ${glowLine}
      <div class="group-card-bar" style="${barStyle}"></div>
      <div class="group-card-body">
        <div class="group-card-header" data-toggle="${containerId}">
          <div class="group-card-header-left">
            <span class="emoji">${emoji}</span>
            <div>
              <div class="group-card-title">${titre}</div>
              <div class="group-card-subtitle">${items.length + cartesPerso.length} échéance(s) suivie(s)</div>
            </div>
          </div>
          <div class="group-card-header-right">
            <div class="status-dot" style="background:${pireCouleur};${isPremium ? `box-shadow:0 0 10px ${pireCouleur},0 0 20px ${pireCouleur}40;` : ""}"></div>
            <span class="chevron ${isOpen ? "rotated" : ""}">⌄</span>
          </div>
        </div>
        <div class="group-card-content ${isOpen ? "expanded" : ""}">
          <div class="group-card-divider"></div>
          ${subItemsHTML}
        </div>
      </div>
    </div>
  `;

  container.querySelector(`[data-toggle="${containerId}"]`).addEventListener("click", () => {
    openGroupCards[containerId] = !openGroupCards[containerId];
    renderDashboard();
  });

  items.forEach((item) => {
    // Clic zone droite → édition date
    const el = container.querySelector(`[data-field="${item.fieldName}"]`);
    if (el) el.addEventListener("click", () => {
      const typeHist = TYPES_HISTORIQUE[item.fieldName];
      if (typeHist) {
        openEditDateWithHistoriqueModal(item.titre, item.fieldName, item.source, item.val, typeHist);
      } else {
        openEditDateModal(item.titre, item.fieldName, item.source, item.val);
      }
    });

    // Clic zone gauche → photo (recto)
    const photoZone = container.querySelector(`[data-doc-photo="${item.fieldName}"]`);
    if (photoZone) {
      photoZone.addEventListener("click", (e) => {
        e.stopPropagation();
        const ownerId   = _photoOwnerIdForSource(item.source);
        const photoData = getCachedDocPhotos(ownerId)[item.fieldName] || null;
        if (photoData?.url) {
          _ouvrirVisionneuse(item.fieldName, item.titre, item.source, photoData);
        } else {
          _ouvrirDocPhotoPicker(item.fieldName, item.titre, item.source);
        }
      });
    }

    // Clic zone verso (documents recto/verso : visite médicale…)
    if (item.aVerso) {
      const versoSlug = `${item.fieldName}-verso`;
      const versoZone = container.querySelector(`[data-doc-photo-verso="${item.fieldName}"]`);
      if (versoZone) {
        versoZone.addEventListener("click", (e) => {
          e.stopPropagation();
          const ownerId   = _photoOwnerIdForSource(item.source);
          const photoData = getCachedDocPhotos(ownerId)[versoSlug] || null;
          const label     = `${item.titre} (verso)`;
          if (photoData?.url) {
            _ouvrirVisionneuse(versoSlug, label, item.source, photoData);
          } else {
            _ouvrirDocPhotoPicker(versoSlug, label, item.source);
          }
        });
      }
    }
  });

  textItems.forEach((item) => {
    const el = container.querySelector(`[data-text-field="${item.fieldName}"]`);
    if (el) el.addEventListener("click", () => openEditTexteModal(item.titre, item.fieldName, item.val));
  });

  attachCartePersoListeners(container, cartesPerso);

  // Effet tilt 3D sur la carte
  const card = container.querySelector(".group-card");
  if (card) _applyTilt3D(card);
}

// ─── Effet tilt 3D sur les group-cards ───────────────────────────────────
function _applyTilt3D(card) {
  // Ajoute le div shine si pas encore présent
  if (!card.querySelector(".group-card-shine")) {
    const shine = document.createElement("div");
    shine.className = "group-card-shine";
    card.insertBefore(shine, card.firstChild);
  }

  const handleMove = (clientX, clientY) => {
    if (card.classList.contains("is-open")) return;
    const rect = card.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const rotX = ((y - cy) / cy) * -5;
    const rotY = ((x - cx) / cx) * 5;
    const shine = card.querySelector(".group-card-shine");
    card.style.transform = `perspective(800px) rotateX(${rotX}deg) rotateY(${rotY}deg) scale(1.01)`;
    card.style.transition = "none";
    card.classList.add("tilting");
    if (shine) shine.style.backgroundImage =
      `radial-gradient(circle at ${(x/rect.width)*100}% ${(y/rect.height)*100}%, rgba(255,255,255,0.08) 0%, transparent 65%)`;
  };

  const reset = () => {
    card.style.transform = "";
    card.style.transition = "";
    card.classList.remove("tilting");
  };

  card.addEventListener("mousemove", (e) => handleMove(e.clientX, e.clientY));
  card.addEventListener("mouseleave", reset);
  card.addEventListener("touchmove", (e) => handleMove(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  card.addEventListener("touchend", reset);
}

function renderDateCardHTML(item) {
  const statusColor = Utils.getStatusColor(item.val);
  const statusLabel = Utils.getStatusLabel(item.val);
  const dateStr     = Utils.formatDateFR(item.val) || "Non défini";

  const ownerId   = _photoOwnerIdForSource(item.source);
  const photos    = getCachedDocPhotos(ownerId);
  const photoData = photos[item.fieldName] || null;
  const photoUrl  = photoData?.url || null;

  const theme      = document.documentElement.getAttribute("data-theme") || "nuit";
  const isPremium  = theme === "aurora" || theme === "obsidian";
  const statusDotStyle = isPremium
    ? `background:${statusColor};box-shadow:0 0 8px ${statusColor},0 0 16px ${statusColor}40;`
    : `background:${statusColor};`;

  function zoneHTML(url, attr, faceLabel) {
    return url
      ? `<div class="doc-photo-zone doc-photo-zone--has-photo" ${attr}>
           <img src="${url}" class="doc-photo-thumb" alt="Document" />
           <div class="doc-photo-badge">📷</div>
           ${faceLabel ? `<div class="doc-photo-face-label">${faceLabel}</div>` : ""}
         </div>`
      : `<div class="doc-photo-zone" ${attr}>
           <span class="doc-photo-icon">📷</span>
           ${faceLabel ? `<div class="doc-photo-face-label">${faceLabel}</div>` : ""}
         </div>`;
  }

  let photoZoneHTML;
  if (item.aVerso) {
    const versoUrl = (photos[`${item.fieldName}-verso`] || null)?.url || null;
    photoZoneHTML = `
      <div class="doc-photo-zone-stack">
        ${zoneHTML(photoUrl, `data-doc-photo="${item.fieldName}" data-doc-label="${item.titre}"`, "Recto")}
        ${zoneHTML(versoUrl, `data-doc-photo-verso="${item.fieldName}" data-doc-label="${item.titre} (verso)"`, "Verso")}
      </div>
    `;
  } else {
    photoZoneHTML = zoneHTML(photoUrl, `data-doc-photo="${item.fieldName}" data-doc-label="${item.titre}"`, null);
  }

  return `
    <div class="date-card date-card--split">
      ${photoZoneHTML}
      <div class="date-card-split-right" data-field="${item.fieldName}">
        <div class="date-card-inner">
          <div class="date-card-left">
            <div class="date-card-title">${item.titre}</div>
            <div class="date-card-status" style="color:${statusColor};">${statusLabel}</div>
          </div>
          <div class="date-card-sep"></div>
          <div class="date-card-right">
            <div class="status-dot" style="${statusDotStyle}"></div>
            <div class="date-card-value" style="color:${statusColor};">${dateStr}</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ─── Carte champ texte simple (téléphone, adresse…) — pas de statut/photo,
// juste un libellé + valeur cliquable pour éditer. Visible et modifiable
// aussi bien depuis l'appli chauffeur que depuis le panel bureau (même
// colonne chauffeurs) — la dernière modification faite l'emporte.
function renderTextCardHTML(item) {
  const value = item.val ? escapeHtml(item.val) : "Non renseigné";
  return `
    <div class="date-card">
      <div class="date-card-inner" data-text-field="${item.fieldName}">
        <div class="date-card-left">
          <div class="date-card-title">${item.titre}</div>
        </div>
        <div class="date-card-sep"></div>
        <div class="date-card-right">
          <div class="date-card-value" style="color:var(--color-text-primary);font-weight:600;max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${value}</div>
          <span style="color:var(--color-text-secondary);font-size:14px;">✏️</span>
        </div>
      </div>
    </div>
  `;
}

async function openEditDateModal(titre, fieldName, source, currentVal) {
  showModal({
    title: `Modifier — ${titre}`,
    bodyHTML: `
      <div class="modal-field">
        <label>Date</label>
        <input type="date" id="modal-date-input" value="${currentVal || ""}" />
        <div class="hint">Laisse vide pour réinitialiser</div>
      </div>
    `,
    confirmLabel: "Enregistrer",
    onConfirm: async (bodyEl) => {
      const input = bodyEl.querySelector("#modal-date-input").value;
      let dateISO = null;
      if (input) {
        const { valeur, erreur } = Utils.validerDateISO(input, Utils.maxAnneesFuturPourChamp(fieldName));
        if (erreur) { showToast("⚠️ " + erreur); return false; }
        dateISO = valeur;
      }

      try {
        if (source === "tracteur") {
          await dbUpdate("tracteurs", { [fieldName]: dateISO }, [
            { col: "plaque", op: "eq", val: appState.plaqueT }
          ]);
          // Mise à jour locale immédiate : ne pas attendre le round-trip du
          // temps réel pour que le dashboard reflète le changement.
          if (appState.tracteurData) appState.tracteurData[fieldName] = dateISO;
        } else if (source === "remorque") {
          // Mappe les noms de champs fusion → colonnes réelles de la table remorques
          const colMap = {
            "date_ct_remorque": "date_ct", "date_assurance_remorque": "date_assurance",
            "date_entretien_frigo_remorque": "date_entretien_frigo",
            "date_nettoyage_interieur_remorque": "date_nettoyage_interieur",
            "date_hayon_remorque": "date_hayon"
          };
          const col = colMap[fieldName] || fieldName;
          if (appState.plaqueR) {
            await dbUpdate("remorques", { [col]: dateISO }, [
              { col: "plaque", op: "eq", val: appState.plaqueR }
            ]);
            if (appState.remorqueData) appState.remorqueData[col] = dateISO;
          }
        } else if (source === "engin") {
          // Mise à jour de l'engin actif
          if (appState.enginActif?.id) {
            await dbUpdate("engins", { [fieldName]: dateISO }, [
              { col: "id", op: "eq", val: appState.enginActif.id }
            ]);
            // Mettre à jour localement pour que le dashboard se rafraîchisse
            if (appState.enginActif) appState.enginActif[fieldName] = dateISO;
          }
        } else {
          // chauffeur
          await dbUpdate("chauffeurs", { [fieldName]: dateISO }, [
            { col: "id", op: "eq", val: appState.chauffeurId }
          ]);
          if (appState.chauffeur) appState.chauffeur[fieldName] = dateISO;
        }
        appState.vehiculeData = buildVehiculeData();
        renderDashboard();
        return true;
      } catch (e) {
        showToast(Utils.messageErreurSupabase(e));
        return false;
      }
    }
  });
}

// ─── Édition d'un champ texte du chauffeur (téléphone, adresse…) ─────────
async function openEditTexteModal(titre, fieldName, currentVal) {
  const isTel = fieldName === "telephone";
  showModal({
    title: `Modifier — ${titre}`,
    bodyHTML: `
      <div class="modal-field">
        <label>${titre}</label>
        <input type="${isTel ? "tel" : "text"}" id="modal-texte-input" value="${escapeHtml(currentVal || "")}" placeholder="${isTel ? "Ex : 06 12 34 56 78" : "Ex : 12 rue des Transports, 69000 Lyon"}" />
        <div class="hint">Laisse vide pour réinitialiser</div>
      </div>
    `,
    confirmLabel: "Enregistrer",
    onConfirm: async (bodyEl) => {
      const valeur = bodyEl.querySelector("#modal-texte-input").value.trim() || null;
      try {
        await dbUpdate("chauffeurs", { [fieldName]: valeur }, [
          { col: "id", op: "eq", val: appState.chauffeurId }
        ]);
        if (appState.chauffeur) appState.chauffeur[fieldName] = valeur;
        renderDashboard();
        return true;
      } catch (e) {
        showToast(Utils.messageErreurSupabase(e));
        return false;
      }
    }
  });
}

// ════════════════════════════════════════════════════════════════════════
// HISTORIQUE ENTRETIENS — modale combinée date + photo + commentaire
// (frigo / nettoyage intérieur / graissage), + trace permanente non
// modifiable dans historique_entretiens. Voir aussi photo-docs.js.
// ════════════════════════════════════════════════════════════════════════

async function openEditDateWithHistoriqueModal(titre, fieldName, source, currentVal, typeEntretien) {
  let selectedFile = null;

  const entiteType   = source === "remorque" ? "remorque" : "tracteur";
  const entitePlaque = source === "remorque" ? appState.plaqueR : appState.plaqueT;

  showModal({
    title: `Modifier — ${titre}`,
    bodyHTML: `
      <div class="modal-field">
        <label>Date</label>
        <input type="date" id="modal-date-input" value="${currentVal || ""}" />
      </div>
      <div class="modal-field">
        <label>Photo du papier d'entretien (optionnel, mais conseillé)</label>
        <div style="display:flex;gap:8px;align-items:center;">
          <div class="hist-photo-picker" id="hist-photo-picker" style="flex:1;">
            <span id="hist-photo-picker-label">📷 Ajouter une photo (preuve conservée)</span>
          </div>
          <button type="button" id="hist-photo-clear" title="Retirer la photo" class="hist-photo-clear-btn">✕</button>
        </div>
      </div>
      <div class="modal-field">
        <label>Commentaire (optionnel)</label>
        <textarea id="modal-commentaire-input" rows="2" placeholder="Ex : voyage, remarque…"></textarea>
      </div>
      <div class="modal-field">
        <button type="button" class="modal-link-btn" id="hist-voir-historique">🕐 Voir l'historique</button>
      </div>
    `,
    confirmLabel: "Enregistrer",
    onMount: (bodyEl) => {
      const picker   = bodyEl.querySelector("#hist-photo-picker");
      const label    = bodyEl.querySelector("#hist-photo-picker-label");
      const clearBtn = bodyEl.querySelector("#hist-photo-clear");
      picker.addEventListener("click", () => {
        _choisirPhotoHistorique((file) => {
          selectedFile = file;
          label.textContent = "✅ Photo prête — " + file.name;
          clearBtn.classList.add("is-visible");
        });
      });
      clearBtn.addEventListener("click", () => {
        selectedFile = null;
        label.textContent = "📷 Ajouter une photo (preuve conservée)";
        clearBtn.classList.remove("is-visible");
      });
      bodyEl.querySelector("#hist-voir-historique").addEventListener("click", () => {
        _ouvrirHistoriqueViewer(entiteType, entitePlaque, typeEntretien, titre);
      });
    },
    onConfirm: async (bodyEl) => {
      const input       = bodyEl.querySelector("#modal-date-input").value;
      const commentaire = bodyEl.querySelector("#modal-commentaire-input").value.trim() || null;

      if (!input) { showToast("⚠️ La date est obligatoire"); return false; }
      const { valeur, erreur } = Utils.validerDateISO(input);
      if (erreur) { showToast("⚠️ " + erreur); return false; }
      const dateISO = valeur;

      if (!entitePlaque) { showToast("⚠️ Véhicule invalide"); return false; }
      if (!selectedFile) {
        const continuer = window.confirm(
          "⚠️ Aucun document enregistré.\n\nSans photo du papier d'entretien, cette date seule ne fera pas foi en cas de litige avec un client.\n\nEnregistrer quand même ?"
        );
        if (!continuer) return false;
      }

      try {
        // 1. Champ courant du véhicule (affichage carte Véhicules)
        if (source === "tracteur") {
          await dbUpdate("tracteurs", { [fieldName]: dateISO }, [
            { col: "plaque", op: "eq", val: appState.plaqueT }
          ]);
          if (appState.tracteurData) appState.tracteurData[fieldName] = dateISO;
        } else {
          const colMap = {
            "date_entretien_frigo_remorque":     "date_entretien_frigo",
            "date_nettoyage_interieur_remorque": "date_nettoyage_interieur"
          };
          const col = colMap[fieldName] || fieldName;
          await dbUpdate("remorques", { [col]: dateISO }, [
            { col: "plaque", op: "eq", val: appState.plaqueR }
          ]);
          if (appState.remorqueData) appState.remorqueData[col] = dateISO;
        }

        // 2. Trace permanente (append-only, ne remplace jamais l'existant)
        const entrepriseId = appState.chauffeur?.entreprise_id || "";
        const chauffeurNom = appState.chauffeur
          ? `${appState.chauffeur.prenom || ""} ${appState.chauffeur.nom || ""}`.trim()
          : null;
        await enregistrerHistoriqueEntretien({
          entrepriseId, entiteType, entitePlaque, typeEntretien,
          dateEntretien: dateISO, file: selectedFile, commentaire,
          chauffeurId: appState.chauffeurId || null, chauffeurNom
        });

        appState.vehiculeData = buildVehiculeData();
        renderDashboard();
        showToast("✅ Enregistré — trace conservée");
        return true;
      } catch (e) {
        showToast("❌ " + (e.message || Utils.messageErreurSupabase(e)));
        return false;
      }
    }
  });
}

// Sélecteur caméra/galerie générique, dédié à l'historique (inputs séparés
// de ceux des documents pour ne pas interférer avec _ouvrirDocPhotoPicker).
function _choisirPhotoHistorique(callback) {
  let inputCamera  = document.getElementById("hist-input-camera");
  let inputGallery = document.getElementById("hist-input-gallery");

  if (!inputCamera) {
    inputCamera = document.createElement("input");
    inputCamera.type = "file"; inputCamera.accept = "image/*"; inputCamera.capture = "environment";
    inputCamera.id = "hist-input-camera"; inputCamera.style.display = "none";
    document.body.appendChild(inputCamera);
    inputCamera.addEventListener("change", () => {
      const file = inputCamera.files[0];
      inputCamera.value = "";
      if (file && inputCamera._cb) inputCamera._cb(file);
    });
  }
  if (!inputGallery) {
    inputGallery = document.createElement("input");
    inputGallery.type = "file"; inputGallery.accept = "image/*";
    inputGallery.id = "hist-input-gallery"; inputGallery.style.display = "none";
    document.body.appendChild(inputGallery);
    inputGallery.addEventListener("change", () => {
      const file = inputGallery.files[0];
      inputGallery.value = "";
      if (file && inputGallery._cb) inputGallery._cb(file);
    });
  }

  inputCamera._cb  = callback;
  inputGallery._cb = callback;

  let sheet = document.getElementById("hist-source-sheet");
  if (!sheet) {
    sheet = document.createElement("div");
    sheet.id = "hist-source-sheet";
    sheet.className = "scanner-source-sheet";
    sheet.innerHTML = `
      <div class="scanner-source-backdrop"></div>
      <div class="scanner-source-box">
        <div class="scanner-source-handle"></div>
        <div class="scanner-source-title">Photo du papier d'entretien</div>
        <button class="scanner-source-btn" id="hist-btn-camera">
          <span class="scanner-source-icon">📷</span>
          <div>
            <div class="scanner-source-label">Prendre une photo</div>
            <div class="scanner-source-sub">Ouvrir la caméra</div>
          </div>
        </button>
        <button class="scanner-source-btn" id="hist-btn-gallery">
          <span class="scanner-source-icon">🖼️</span>
          <div>
            <div class="scanner-source-label">Choisir dans la galerie</div>
            <div class="scanner-source-sub">Depuis vos photos existantes</div>
          </div>
        </button>
        <button class="scanner-source-btn scanner-source-btn--cancel" id="hist-btn-cancel">Annuler</button>
      </div>
    `;
    document.body.appendChild(sheet);
    sheet.querySelector(".scanner-source-backdrop").addEventListener("click", closeSheet);
    document.getElementById("hist-btn-cancel").addEventListener("click", closeSheet);
    document.getElementById("hist-btn-camera").addEventListener("click",  () => inputCamera.click());
    document.getElementById("hist-btn-gallery").addEventListener("click", () => inputGallery.click());
  }

  function closeSheet() { sheet.classList.remove("is-open"); }
  sheet.classList.add("is-open");
}

// Visionneuse lecture-seule de l'historique (preuves photo + dates) d'un
// type d'entretien pour un véhicule donné — c'est ce qu'on ressort à un
// client qui conteste un entretien plusieurs mois après.
async function _ouvrirHistoriqueViewer(entiteType, entitePlaque, typeEntretien, titre) {
  showModal({
    title: `🕐 Historique — ${titre}`,
    bodyHTML: `<div id="hist-viewer-list" class="hist-viewer-list"><div class="hint">Chargement…</div></div>`,
    confirmLabel: "Fermer",
    cancelLabel: null,
    onMount: async (bodyEl) => {
      const listEl = bodyEl.querySelector("#hist-viewer-list");
      try {
        const rows = await fetchHistoriqueEntretiens(entiteType, entitePlaque, typeEntretien);
        if (!rows.length) {
          listEl.innerHTML = `<div class="hint">Aucun historique enregistré pour l'instant.</div>`;
          return;
        }
        listEl.innerHTML = rows.map(r => `
          <div class="hist-viewer-item">
            <div class="hist-viewer-item-date">${Utils.formatDateFR(r.date_entretien) || r.date_entretien}</div>
            ${r.photo_url
              ? `<img src="${r.photo_url}" class="hist-viewer-item-photo" alt="Papier entretien" />`
              : `<div class="hint">Pas de photo</div>`}
            ${r.commentaire ? `<div class="hist-viewer-item-comment">${r.commentaire}</div>` : ""}
            <div class="hist-viewer-item-meta">${r.chauffeur_nom || r.admin_nom || ""}</div>
          </div>
        `).join("");
      } catch (e) {
        listEl.innerHTML = `<div class="hint">Erreur de chargement.</div>`;
      }
    }
  });
}

// ════════════════════════════════════════════════════════════════════════
// PHOTOS DOCUMENTS — items fixes (Véhicules + Données perso)
// ════════════════════════════════════════════════════════════════════════

// Démarre le listener Realtime photos — APRÈS setJWT (garanti par enterDashboard)
function _startDocPhotosListener() {
  if (appState.unsubDocPhotos) { appState.unsubDocPhotos(); appState.unsubDocPhotos = null; }
  if (!appState.chauffeurId) return;
  appState.unsubDocPhotos = listenDocPhotos(appState.chauffeurId, () => renderDashboard());
}

// Refresh cache immédiat (après upload/suppression, sans attendre Realtime)
async function _refreshDocPhotosCache() {
  if (!appState.chauffeurId) return;
  await fetchDocPhotos(appState.chauffeurId).catch(() => {});
}

// Retourne l'entity_id selon la source de l'item
function _photoOwnerIdForSource(source) {
  if (source === "tracteur") return appState.plaqueT || "";
  if (source === "remorque") return appState.plaqueR || "";
  return appState.chauffeurId || "";
}

// Retourne entity_type + entity_id selon la source
function _photoStorageOwner(source) {
  if (source === "tracteur") return { entityType: "tracteur", entityId: appState.plaqueT || "" };
  if (source === "remorque") return { entityType: "remorque", entityId: appState.plaqueR || "" };
  return { entityType: "chauffeur", entityId: appState.chauffeurId || "" };
}

// Ouvre le sélecteur source (caméra / galerie) puis upload direct
// ─── Sélecteur source document (caméra / galerie) ────────────────────────

function _ouvrirDocPhotoPicker(slug, label, source) {

  // Inputs file persistants — créés une seule fois (Android/Chrome : pas de cloneNode)
  let inputCamera = document.getElementById("doc-input-camera");
  let inputGallery = document.getElementById("doc-input-gallery");

  if (!inputCamera) {
    inputCamera = document.createElement("input");
    inputCamera.type    = "file";
    inputCamera.accept  = "image/*";
    inputCamera.capture = "environment";
    inputCamera.id      = "doc-input-camera";
    inputCamera.style.display = "none";
    document.body.appendChild(inputCamera);
    inputCamera.addEventListener("change", async () => {
      const file = inputCamera.files[0];
      inputCamera.value = "";
      if (file && inputCamera._cb) await inputCamera._cb(file);
    });
  }

  if (!inputGallery) {
    inputGallery = document.createElement("input");
    inputGallery.type   = "file";
    inputGallery.accept = "image/*";
    inputGallery.id     = "doc-input-gallery";
    inputGallery.style.display = "none";
    document.body.appendChild(inputGallery);
    inputGallery.addEventListener("change", async () => {
      const file = inputGallery.files[0];
      inputGallery.value = "";
      if (file && inputGallery._cb) await inputGallery._cb(file);
    });
  }

  // Callback d'upload partagé
  const handleFile = async (file) => {
    closeSheet();
    const entrepriseId             = appState.chauffeur?.entreprise_id || "";
    const { entityType, entityId } = _photoStorageOwner(source);
    const chauffeurId              = appState.chauffeurId || "";
    if (!entrepriseId || !entityId) { showToast("⚠️ Session invalide"); return; }
    try {
      showToast("📤 Upload en cours…");
      await uploadDocPhoto(entrepriseId, entityId, slug, label, file, entityType, chauffeurId);
      showToast("✅ Photo enregistrée !");
      await _refreshDocPhotosCache();
      renderDashboard();
    } catch (err) {
      showToast("❌ " + (err.message || "Erreur upload"));
    }
  };

  inputCamera._cb  = handleFile;
  inputGallery._cb = handleFile;

  // Bottom sheet
  let sheet = document.getElementById("doc-source-sheet");
  if (!sheet) {
    sheet = document.createElement("div");
    sheet.id = "doc-source-sheet";
    sheet.className = "scanner-source-sheet";
    sheet.innerHTML = `
      <div class="scanner-source-backdrop"></div>
      <div class="scanner-source-box">
        <div class="scanner-source-handle"></div>
        <div class="scanner-source-title">Ajouter un document</div>
        <button class="scanner-source-btn" id="doc-btn-camera">
          <span class="scanner-source-icon">📷</span>
          <div>
            <div class="scanner-source-label">Prendre une photo</div>
            <div class="scanner-source-sub">Ouvrir la caméra</div>
          </div>
        </button>
        <button class="scanner-source-btn" id="doc-btn-gallery">
          <span class="scanner-source-icon">🖼️</span>
          <div>
            <div class="scanner-source-label">Choisir dans la galerie</div>
            <div class="scanner-source-sub">Depuis vos photos existantes</div>
          </div>
        </button>
        <button class="scanner-source-btn scanner-source-btn--cancel" id="doc-btn-cancel">
          Annuler
        </button>
      </div>
    `;
    document.body.appendChild(sheet);
    sheet.querySelector(".scanner-source-backdrop").addEventListener("click", closeSheet);
    document.getElementById("doc-btn-cancel").addEventListener("click", closeSheet);
    document.getElementById("doc-btn-camera").addEventListener("click",  () => inputCamera.click());
    document.getElementById("doc-btn-gallery").addEventListener("click", () => inputGallery.click());
  }

  function closeSheet() { sheet.classList.remove("is-open"); }

  sheet.classList.add("is-open");
}

// Visionneuse plein écran avec Changer / Supprimer
function _ouvrirVisionneuse(slug, label, source, photoData) {
  let overlay = document.getElementById("doc-photo-viewer-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "doc-photo-viewer-overlay";
    overlay.className = "doc-photo-viewer-overlay";
    overlay.innerHTML = `
      <div class="doc-photo-viewer-box">
        <div class="doc-photo-viewer-header">
          <span class="doc-photo-viewer-title" id="doc-photo-viewer-title"></span>
          <button class="doc-photo-viewer-close" id="doc-photo-viewer-close">✕</button>
        </div>
        <div class="doc-photo-viewer-img-wrap">
          <img class="doc-photo-viewer-img" id="doc-photo-viewer-img" src="" alt="" />
        </div>
        <div class="doc-photo-viewer-actions">
          <button class="doc-photo-viewer-btn doc-photo-viewer-btn--change" id="doc-photo-viewer-change">📷 Changer</button>
          <button class="doc-photo-viewer-btn doc-photo-viewer-btn--delete" id="doc-photo-viewer-delete">🗑️ Supprimer</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById("doc-photo-viewer-close").addEventListener("click", () => overlay.classList.remove("is-open"));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.classList.remove("is-open"); });
  }

  document.getElementById("doc-photo-viewer-title").textContent = label;
  document.getElementById("doc-photo-viewer-img").src           = photoData.url;

  const btnChange = document.getElementById("doc-photo-viewer-change");
  const freshChange = btnChange.cloneNode(true);
  btnChange.parentNode.replaceChild(freshChange, btnChange);
  freshChange.addEventListener("click", () => { overlay.classList.remove("is-open"); _ouvrirDocPhotoPicker(slug, label, source); });

  const btnDelete = document.getElementById("doc-photo-viewer-delete");
  const freshDelete = btnDelete.cloneNode(true);
  btnDelete.parentNode.replaceChild(freshDelete, btnDelete);
  freshDelete.addEventListener("click", async () => {
    try {
      freshDelete.disabled = true; freshDelete.textContent = "…";
      const entrepriseId             = appState.chauffeur?.entreprise_id || "";
      const { entityType, entityId } = _photoStorageOwner(source);
      await deleteDocPhoto(entrepriseId, entityId, slug, entityType);
      overlay.classList.remove("is-open");
      showToast("🗑️ Photo supprimée");
      await _refreshDocPhotosCache();
      renderDashboard();
    } catch (err) {
      showToast("❌ " + (err.message || "Erreur suppression"));
      freshDelete.disabled = false; freshDelete.textContent = "🗑️ Supprimer";
    }
  });

  overlay.classList.add("is-open");
}

function renderCarteVehicules() {
  // ── CAS ENGIN BTP ────────────────────────────────────────────────────
  if (appState.typeVehiculeActif === "engin" && appState.enginActif) {
    const e = appState.enginActif;
    const items = [];
    if (e.date_assurance) items.push({ titre: "Assurance",          val: e.date_assurance, fieldName: "date_assurance", source: "engin" });
    if (e.date_vgp)       items.push({ titre: "VGP",                val: e.date_vgp,       fieldName: "date_vgp",       source: "engin" });
    if (e.date_entretien) items.push({ titre: "Entretien périodique",val: e.date_entretien, fieldName: "date_entretien", source: "engin" });
    renderGroupCard("carte-vehicules", {
      titre:      "Véhicules",
      emoji:      "🏗️",
      items,
      cartesPerso: getCartesPersoForGroupe("Véhicules")
    });
    return;
  }

  // ── CAS TRACTEUR / PORTEUR ───────────────────────────────────────────
  const t = appState.tracteurData || {};
  const r = appState.remorqueData || {};
  const pm = Utils.getProfilMoteur(appState.profilMoteur);
  const pr = Utils.getProfilRemorque(appState.profilRemorque);

  const items = [];

  // Docs du véhicule moteur selon profil
  const docsMoteur = pm ? pm.docs : ["ct","assurance","limiteur","chrono"];
  if (docsMoteur.includes("ct"))       items.push({ titre: "CT Véhicule Moteur",     val: t.date_ct,                fieldName: "date_ct",                source: "tracteur" });
  if (docsMoteur.includes("assurance"))items.push({ titre: "Assurance Moteur",        val: t.date_assurance,         fieldName: "date_assurance",         source: "tracteur" });
  if (docsMoteur.includes("limiteur")) items.push({ titre: "Limiteur de Vitesse",     val: t.date_limiteur_vitesse,  fieldName: "date_limiteur_vitesse",  source: "tracteur" });
  if (docsMoteur.includes("chrono"))   items.push({ titre: "Chronotachygraphe",       val: t.date_chronotachygraphe, fieldName: "date_chronotachygraphe", source: "tracteur" });
  if (docsMoteur.includes("frigo"))    items.push({ titre: "Entretien Groupe Frigo",  val: t.date_entretien_frigo,   fieldName: "date_entretien_frigo",   source: "tracteur" });
  if (docsMoteur.includes("nettoyage"))items.push({ titre: "Nettoyage Intérieur",     val: t.date_nettoyage_interieur, fieldName: "date_nettoyage_interieur", source: "tracteur" });
  // Hayon porteur : option cochée sur le véhicule lui-même, indépendante du profil.
  if (t.a_hayon) items.push({ titre: "Hayon", val: t.date_hayon, fieldName: "date_hayon", source: "tracteur" });

  // Docs remorque uniquement si une remorque est attelée
  if (appState.plaqueR && pr) {
    const docsRemorque = pr.docs;
    if (docsRemorque.includes("ct"))       items.push({ titre: "CT Remorque",        val: r.date_ct,       fieldName: "date_ct_remorque",        source: "remorque" });
    if (docsRemorque.includes("assurance"))items.push({ titre: "Assurance Remorque", val: r.date_assurance, fieldName: "date_assurance_remorque",  source: "remorque" });
    if (docsRemorque.includes("frigo"))    items.push({ titre: r.bi_temperature ? "Entretien Groupe Frigo Remorque (Bi-température)" : "Entretien Groupe Frigo Remorque", val: r.date_entretien_frigo,     fieldName: "date_entretien_frigo_remorque",     source: "remorque" });
    if (docsRemorque.includes("nettoyage"))items.push({ titre: "Nettoyage Intérieur Remorque",    val: r.date_nettoyage_interieur, fieldName: "date_nettoyage_interieur_remorque", source: "remorque" });
    if (docsRemorque.includes("graissage"))items.push({ titre: "Graissage Articulations",val: r.date_graissage,           fieldName: "date_graissage",           source: "remorque" });
  } else if (appState.plaqueR && !pr) {
    items.push({ titre: "CT Remorque",        val: r.date_ct,       fieldName: "date_ct_remorque",        source: "remorque" });
    items.push({ titre: "Assurance Remorque", val: r.date_assurance, fieldName: "date_assurance_remorque", source: "remorque" });
  }
  // Hayon remorque : option cochée sur le véhicule lui-même, indépendante du profil.
  if (appState.plaqueR && r.a_hayon) {
    items.push({ titre: "Hayon Remorque", val: r.date_hayon, fieldName: "date_hayon_remorque", source: "remorque" });
  }

  renderGroupCard("carte-vehicules", {
    titre:      "Véhicules",
    emoji:      "🚛",
    items,
    cartesPerso: getCartesPersoForGroupe("Véhicules")
  });
}

function renderCarteDonneesPerso() {
  const c = appState.chauffeur || {};
  renderGroupCard("carte-donnees-perso", {
    titre: "Données personnelles",
    emoji: "👤",
    textItems: [
      { titre: "Téléphone", val: c.telephone, fieldName: "telephone" },
      { titre: "Adresse",   val: c.adresse,   fieldName: "adresse"   }
    ],
    items: [
      { titre: "Carte Conducteur",       val: c.date_carte_conducteur, fieldName: "date_carte_conducteur", source: "chauffeur" },
      { titre: "Visite médicale permis", val: c.date_visite_medicale,  fieldName: "date_visite_medicale",  source: "chauffeur", aVerso: true },
      { titre: "FCO",                    val: c.date_fco,              fieldName: "date_fco",              source: "chauffeur" },
      { titre: "ADR",                    val: c.date_adr,              fieldName: "date_adr",              source: "chauffeur" },
      { titre: "Carte d'identité",       val: c.date_carte_identite,   fieldName: "date_carte_identite",   source: "chauffeur", aVerso: true }
    ],
    cartesPerso: getCartesPersoForGroupe("Données personnelles")
  });
}

// ════════════════════════════════════════════════════════════════════════
// BADGES VÉHICULE CLIQUABLES
// ════════════════════════════════════════════════════════════════════════

function _renderBadgeVehicule(id, label, type, sousLabel) {
  // Met à jour la valeur affichée
  const valEl = document.getElementById(id);
  if (valEl) valEl.textContent = label || (type === "remorque" ? "Solo" : "—");

  // Type de profil (ex: "Citerne alimentaire 3 compartiments") sous la plaque
  const typeEl = document.getElementById(id + "-type");
  if (typeEl) typeEl.textContent = sousLabel || "";

  // Masquer le badge remorque si le profil moteur ne peut pas tracter
  if (type === "remorque") {
    const wrapId = id + "-wrap";
    const wrap   = document.getElementById(wrapId);
    if (wrap) {
      const peutTracter = Utils.peutTracterRemorque
        ? Utils.peutTracterRemorque(appState.profilMoteur)
        : true;
      wrap.style.display = peutTracter ? "" : "none";
    }
    if (!Utils.peutTracterRemorque || !Utils.peutTracterRemorque(appState.profilMoteur)) return;
  }

  // Attache le listener sur le wrapper (évite de dupliquer)
  const wrapId = id + "-wrap";
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  const clone = wrap.cloneNode(true);
  wrap.parentNode.replaceChild(clone, wrap);
  // Restaurer la référence de la value après cloneNode
  const newVal = clone.querySelector(".value");
  if (newVal) newVal.id = id;
  const newType = clone.querySelector(".type");
  if (newType) newType.id = id + "-type";
  clone.addEventListener("click", () => openChangerVehiculeModal(type));
}

// Libellé d'une remorque dans un <select> : plaque + type de profil
// (frigo, citerne, porte-char…) pour que le chauffeur sache à quoi
// correspond chaque immatriculation avant de la sélectionner.
function _labelRemorqueOption(v) {
  const profil = Utils.getProfilRemorque(v.profil);
  return profil ? `${v.plaque} — ${profil.label}` : v.plaque;
}

// Ouvre le dropdown pour changer tracteur ou remorque
async function openChangerVehiculeModal(type) {
  if (type === "remorque") {
    const peutTracter = Utils.peutTracterRemorque
      ? Utils.peutTracterRemorque(appState.profilMoteur)
      : true;
    if (!peutTracter) {
      showToast("\u{1F6AB} Ce type de v\u00e9hicule ne peut pas tracter de remorque");
      return;
    }
  }

  const entrepriseId = appState.chauffeur?.entreprise_id || "";

  if (type === "tracteur") {
    let tracteurs = [], engins = [];
    try {
      [tracteurs, engins] = await Promise.all([
        dbSelect("tracteurs", {
          select: "plaque",
          filters: [{ col: "entreprise_id", op: "eq", val: entrepriseId }],
          order:   { col: "plaque", asc: true }
        }),
        dbSelect("engins", {
          select: "id,profil,numero_parc,numero_serie",
          filters: [{ col: "entreprise_id", op: "eq", val: entrepriseId }],
          order:   { col: "numero_parc", asc: true }
        })
      ]);
    } catch (e) {
      showToast("\ud83d\udce1 Impossible de charger les v\u00e9hicules");
      return;
    }

    const trOptions = (tracteurs || []).map((v) =>
      `<option value="${v.plaque}" ${v.plaque === appState.plaqueT ? "selected" : ""}>${v.plaque}</option>`
    ).join("");

    const enginOptions = (engins || []).map((e) => {
      const nom   = e.numero_parc || e.numero_serie || e.id.substring(0, 8);
      const label = Utils.PROFILS_ENGINS ? (Utils.PROFILS_ENGINS[e.profil]?.label || e.profil) : e.profil;
      const isSelected = appState.typeVehiculeActif === "engin" && appState.enginActif?.id === e.id;
      return `<option value="engin::${e.id}" ${isSelected ? "selected" : ""}>${label} (${nom})</option>`;
    }).join("");

    const vehiculeOptions = `
      ${tracteurs.length > 0 ? `<optgroup label="\ud83d\ude9a Tracteurs / Porteurs">${trOptions}</optgroup>` : ""}
      ${engins.length > 0   ? `<optgroup label="\ud83c\udfd7\ufe0f Engins BTP">${enginOptions}</optgroup>` : ""}
    `;

    showModal({
      title: "\ud83d\ude9a Changer de v\u00e9hicule",
      bodyHTML: `
        <div class="modal-text">S\u00e9lectionne ton v\u00e9hicule.</div>
        <div class="modal-field">
          <select id="modal-vehicule-select" style="width:100%;height:50px;background:var(--color-surface);border:1.5px solid var(--color-divider);border-radius:12px;padding:0 14px;color:var(--color-text-primary);font-size:16px;font-weight:700;">
            ${vehiculeOptions}
          </select>
        </div>
      `,
      confirmLabel: "Confirmer",
      onConfirm: async (bodyEl) => {
        const val = bodyEl.querySelector("#modal-vehicule-select").value;
        if (val.startsWith("engin::")) {
          await _changerVehicule("engin", val.replace("engin::", ""), engins);
        } else {
          await _changerVehicule("tracteur", val);
        }
        return true;
      }
    });
    return;
  }

  // Remorque
  let vehicules = [];
  try {
    vehicules = await dbSelect("remorques", {
      select: "plaque,profil",
      filters: [{ col: "entreprise_id", op: "eq", val: entrepriseId }],
      order:   { col: "plaque", asc: true }
    });
  } catch (e) {
    showToast("\ud83d\udce1 Impossible de charger les remorques");
    return;
  }

  const optionsHTML = (vehicules || []).map((v) =>
    `<option value="${v.plaque}" ${v.plaque === appState.plaqueR ? "selected" : ""}>${_labelRemorqueOption(v)}</option>`
  ).join("");

  showModal({
    title: "\ud83d\ude9b Changer de remorque",
    bodyHTML: `
      <div class="modal-text">S\u00e9lectionne la remorque.</div>
      <div class="modal-field">
        <select id="modal-vehicule-select" style="width:100%;height:50px;background:var(--color-surface);border:1.5px solid var(--color-divider);border-radius:12px;padding:0 14px;color:var(--color-text-primary);font-size:16px;font-weight:700;">
          <option value="" ${!appState.plaqueR ? "selected" : ""}>\u2014 Solo (sans remorque) \u2014</option>
          ${optionsHTML}
        </select>
      </div>
    `,
    confirmLabel: "Confirmer",
    onConfirm: async (bodyEl) => {
      const plaque = bodyEl.querySelector("#modal-vehicule-select").value;
      await _changerVehicule("remorque", plaque);
      return true;
    }
  });
}
async function _changerVehicule(type, plaque, enginsList = []) {
  const entrepriseId = appState.chauffeur?.entreprise_id || "";

  // Stoppe TOUS les listeners avant de changer quoi que ce soit
  if (appState.unsubTracteur)  { appState.unsubTracteur();  appState.unsubTracteur  = null; }
  if (appState.unsubRemorque)  { appState.unsubRemorque();  appState.unsubRemorque  = null; }
  if (appState.unsubChauffeur) { appState.unsubChauffeur(); appState.unsubChauffeur = null; }
  if (appState.unsubEngin)     { appState.unsubEngin();     appState.unsubEngin     = null; }

  // ── CAS ENGIN BTP ──────────────────────────────────────────────────
  if (type === "engin") {
    let enginData = (enginsList || []).find(e => e.id === plaque) || null;
    if (!enginData) {
      try {
        const rows = await dbSelect("engins", { filters: [{ col: "id", op: "eq", val: plaque }] });
        enginData = rows && rows.length > 0 ? rows[0] : null;
      } catch (_) {}
    }
    appState.plaqueT           = "";
    appState.plaqueR           = "";
    appState.profilMoteur      = null;
    appState.profilRemorque    = null;
    appState.tracteurData      = null;
    appState.remorqueData      = null;
    appState.enginActif        = enginData;
    appState.typeVehiculeActif = "engin";
    appState.vehiculeData      = buildVehiculeData();

    try {
      await dbUpsert("sessions_actives", {
        chauffeur_id:    appState.chauffeurId,
        entreprise_id:   entrepriseId,
        plaque_tracteur: "",
        plaque_remorque: "",
        engin_id:        plaque,
        profil_moteur:   null,
        profil_remorque: null
      }, { onConflict: "chauffeur_id" });
    } catch (_) {
      // L'UI a déjà basculé sur le nouvel engin (rendu ci-dessous) mais la
      // sauvegarde en base a échoué — le prévenir plutôt qu'un état local
      // silencieusement désynchronisé de la base.
      showToast("⚠️ Changement non synchronisé — vérifie ta connexion");
    }

    renderDashboard();
    await fetchCartesPerso();
    renderDashboard();
    listenToChanges();
    checkAllNotifications(appState.vehiculeData, getCartesPerso(), appState.typeVehiculeActif === "engin" ? appState.enginActif : null);
    return;
  }

  // Charge les données du véhicule sélectionné
  if (type === "tracteur") {
    appState.plaqueT           = plaque;
    appState.tracteurData      = null;
    appState.profilMoteur      = null;
    appState.enginActif        = null;
    appState.typeVehiculeActif = "tracteur";
    if (plaque) {
      try {
        const rows = await dbSelect("tracteurs", {
          filters: [
            { col: "plaque",        op: "eq", val: plaque },
            { col: "entreprise_id", op: "eq", val: appState.chauffeur?.entreprise_id || "" }
          ]
        });
        appState.tracteurData = rows && rows.length > 0 ? rows[0] : null;
        appState.profilMoteur = appState.tracteurData?.profil || null;
      } catch (e) { console.error("[changement tracteur] fetch error:", e); }
    }
  } else {
    appState.plaqueR       = plaque;
    appState.remorqueData  = null;
    appState.profilRemorque = null;
    if (plaque) {
      try {
        const rows = await dbSelect("remorques", {
          filters: [
            { col: "plaque",        op: "eq", val: plaque },
            { col: "entreprise_id", op: "eq", val: appState.chauffeur?.entreprise_id || "" }
          ]
        });
        appState.remorqueData  = rows && rows.length > 0 ? rows[0] : null;
        appState.profilRemorque = appState.remorqueData?.profil || null;
      } catch (e) { console.error("[changement remorque] fetch error:", e); }
    }
  }

  // Sauvegarde en base avec les profils mis à jour
  try {
    await dbUpsert("sessions_actives", {
      chauffeur_id:    appState.chauffeurId,
      entreprise_id:   entrepriseId,
      plaque_tracteur: appState.plaqueT,
      plaque_remorque: appState.plaqueR,
      engin_id:        null,
      profil_moteur:   appState.profilMoteur   || null,
      profil_remorque: appState.profilRemorque || null
    }, { onConflict: "chauffeur_id" });
    await _enregistrerAttelage(
      appState.plaqueT, appState.plaqueR,
      appState.profilMoteur, appState.profilRemorque
    );
  } catch (_) {
    // L'UI a déjà basculé sur le nouveau véhicule (rendu ci-dessous) mais la
    // sauvegarde en base a échoué — le prévenir plutôt qu'un état local
    // silencieusement désynchronisé de la base.
    showToast("⚠️ Changement non synchronisé — vérifie ta connexion");
  }

  // Invalide le cache conso si on change de tracteur
  if (type === "tracteur") {
    invalidateConsoMoisCache();
  }

  // Rebuild + render + nouveaux listeners
  appState.vehiculeData = buildVehiculeData();
  // Recharge les cartes perso pour le nouveau véhicule
  await fetchCartesPerso();
  renderDashboard();
  checkAllNotifications(appState.vehiculeData, getCartesPerso());
  listenToChanges();
  showToast(`✅ ${type === "tracteur" ? "Tracteur" : "Remorque"} : ${plaque || "Solo"}`);
}

// ════════════════════════════════════════════════════════════════════════
// POPUP PRISE DE SERVICE
// S'affiche au premier login si aucun tracteur n'est affecté,
// ou manuellement via les badges.
// ════════════════════════════════════════════════════════════════════════

async function openPriseDeServiceModal({ obligatoire = false } = {}) {
  const entrepriseId = appState.chauffeur?.entreprise_id || "";

  let tracteurs = [], remorques = [], engins = [];
  try {
    [tracteurs, remorques, engins] = await Promise.all([
      dbSelect("tracteurs", {
        select: "plaque",
        filters: [{ col: "entreprise_id", op: "eq", val: entrepriseId }],
        order:   { col: "plaque", asc: true }
      }),
      dbSelect("remorques", {
        select: "plaque,profil",
        filters: [{ col: "entreprise_id", op: "eq", val: entrepriseId }],
        order:   { col: "plaque", asc: true }
      }),
      dbSelect("engins", {
        select: "id,profil,numero_parc,numero_serie",
        filters: [{ col: "entreprise_id", op: "eq", val: entrepriseId }],
        order:   { col: "numero_parc", asc: true }
      })
    ]);
  } catch (e) {
    showToast("📡 Impossible de charger les véhicules");
    if (!obligatoire) return;
    // Modale obligatoire (aucun véhicule affecté) mais le réseau a lâché :
    // pas question d'ouvrir un formulaire de sélection vide et sans
    // échappatoire — on propose plutôt un nouvel essai.
    showModal({
      title: "📡 Connexion impossible",
      bodyHTML: `<div class="modal-text">Impossible de charger la liste des véhicules. Vérifie ta connexion et réessaie.</div>`,
      confirmLabel: "Réessayer",
      cancelLabel: null,
      onConfirm: () => openPriseDeServiceModal({ obligatoire: true })
    });
    return;
  }

  // Construire les options — tracteurs + engins dans un select groupé
  const trOptions = tracteurs.map((v) =>
    `<option value="${v.plaque}" ${v.plaque === appState.plaqueT ? "selected" : ""}>${v.plaque}</option>`
  ).join("");

  const enginOptions = engins.map((e) => {
    const nom   = e.numero_parc || e.numero_serie || e.id.substring(0, 8);
    const label = Utils.PROFILS_ENGINS ? (Utils.PROFILS_ENGINS[e.profil]?.label || e.profil) : e.profil;
    const isSelected = appState.typeVehiculeActif === "engin" && appState.enginActif?.id === e.id;
    return `<option value="engin::${e.id}" ${isSelected ? "selected" : ""}>${label} (${nom})</option>`;
  }).join("");

  const vehiculeOptions = `
    <option value="">— Sélectionner —</option>
    ${tracteurs.length > 0 ? `<optgroup label="🚚 Tracteurs / Porteurs">${trOptions}</optgroup>` : ""}
    ${engins.length > 0 ? `<optgroup label="🏗️ Engins BTP">${enginOptions}</optgroup>` : ""}
  `;

  const rmOptions = `<option value="">— Solo (sans remorque) —</option>` +
    remorques.map((v) =>
      `<option value="${v.plaque}" ${v.plaque === appState.plaqueR ? "selected" : ""}>${_labelRemorqueOption(v)}</option>`
    ).join("");

  const selectStyle = "width:100%;height:50px;background:var(--color-surface);border:1.5px solid var(--color-divider);border-radius:12px;padding:0 14px;color:var(--color-text-primary);font-size:15px;font-weight:600;";

  showModal({
    title: "🚛 Prise de service",
    bodyHTML: `
      <div class="modal-text">Sélectionne tes véhicules pour aujourd'hui.</div>
      <div class="modal-field">
        <label>Véhicule moteur <span style="color:var(--color-danger);">*</span></label>
        <select id="modal-ps-tracteur" style="${selectStyle}">
          ${vehiculeOptions}
        </select>
      </div>
      <div class="modal-field" id="modal-ps-remorque-wrap">
        <label>Remorque <span style="color:var(--color-text-secondary);font-size:12px;">(optionnel)</span></label>
        <select id="modal-ps-remorque" style="${selectStyle}font-weight:400;">
          ${rmOptions}
        </select>
      </div>
    `,
    confirmLabel: "Commencer la journée",
    cancelLabel: obligatoire ? null : "Annuler",
    onMount: (bodyEl) => {
      const selectVehicule  = bodyEl.querySelector("#modal-ps-tracteur");
      const remorqueWrap    = bodyEl.querySelector("#modal-ps-remorque-wrap");
      const toggleRemorque  = () => {
        const isEngin = selectVehicule.value.startsWith("engin::");
        if (remorqueWrap) remorqueWrap.style.display = isEngin ? "none" : "";
      };
      selectVehicule.addEventListener("change", toggleRemorque);
      toggleRemorque();
    },
    onConfirm: async (bodyEl) => {
      const valeurSelectionnee = bodyEl.querySelector("#modal-ps-tracteur").value;
      const plaqueR = bodyEl.querySelector("#modal-ps-remorque")?.value || "";

      if (!valeurSelectionnee) {
        showToast("⚠️ Sélectionne un véhicule moteur pour continuer");
        return false;
      }

      // Détecter si c'est un engin BTP
      const estEnginSelectionne = valeurSelectionnee.startsWith("engin::");
      const enginId  = estEnginSelectionne ? valeurSelectionnee.replace("engin::", "") : null;
      const plaqueT  = estEnginSelectionne ? "" : valeurSelectionnee;

      if (estEnginSelectionne) {
        // Chargement de l'engin
        let enginData = null;
        try {
          const rows = await dbSelect("engins", { filters: [{ col: "id", op: "eq", val: enginId }] });
          enginData = rows && rows.length > 0 ? rows[0] : null;
        } catch (_) {}

        if (appState.unsubTracteur)  { appState.unsubTracteur();  appState.unsubTracteur  = null; }
        if (appState.unsubRemorque)  { appState.unsubRemorque();  appState.unsubRemorque  = null; }
        if (appState.unsubChauffeur) { appState.unsubChauffeur(); appState.unsubChauffeur = null; }
        if (appState.unsubEngin)     { appState.unsubEngin();     appState.unsubEngin     = null; }

        appState.plaqueT           = "";
        appState.plaqueR           = "";
        appState.profilMoteur      = null;
        appState.profilRemorque    = null;
        appState.tracteurData      = null;
        appState.remorqueData      = null;
        appState.enginActif        = enginData;
        appState.typeVehiculeActif = "engin";
        appState.vehiculeData      = buildVehiculeData();

        try {
          await dbUpsert("sessions_actives", {
            chauffeur_id:    appState.chauffeurId,
            entreprise_id:   entrepriseId,
            plaque_tracteur: "",
            plaque_remorque: "",
            engin_id:        enginId,
            profil_moteur:   null,
            profil_remorque: null
          }, { onConflict: "chauffeur_id" });
        } catch (_) {
          showToast("⚠️ Changement non synchronisé — vérifie ta connexion");
        }

        renderDashboard();
        listenToChanges();
        checkAllNotifications(appState.vehiculeData, getCartesPerso(), appState.typeVehiculeActif === "engin" ? appState.enginActif : null);
        // Premier lancement sans véhicule affecté (modale obligatoire) : ces
        // listeners n'ont jamais été démarrés dans enterDashboard — sans ça,
        // aucun changement admin/atelier/cartes/photos n'apparaît en direct
        // avant la prochaine reconnexion. Idempotent si déjà actifs.
        listenAdminChanges();
        if (appState.panelMecanoActif) startInterventionsRealtime();
        ensureCartesPersoListener();
        _startDocPhotosListener();
        return true;
      }

      // Charge les données + profils depuis la BDD
      const [tracteurRows, remorqueRows] = await Promise.all([
        dbSelect("tracteurs", { filters: [{ col: "plaque", op: "eq", val: plaqueT }] }),
        plaqueR ? dbSelect("remorques", { filters: [{ col: "plaque", op: "eq", val: plaqueR }] }) : Promise.resolve([])
      ]);

      const tracteurData = tracteurRows && tracteurRows.length > 0 ? tracteurRows[0] : null;
      const remorqueData = remorqueRows && remorqueRows.length > 0 ? remorqueRows[0] : null;

      const profilMoteur   = tracteurData?.profil || null;
      const profilRemorque = remorqueData?.profil || null;

      if (appState.unsubTracteur)  { appState.unsubTracteur();  appState.unsubTracteur  = null; }
      if (appState.unsubRemorque)  { appState.unsubRemorque();  appState.unsubRemorque  = null; }
      if (appState.unsubChauffeur) { appState.unsubChauffeur(); appState.unsubChauffeur = null; }
      if (appState.unsubEngin)     { appState.unsubEngin();     appState.unsubEngin     = null; }

      appState.plaqueT           = plaqueT;
      appState.plaqueR           = plaqueR;
      appState.profilMoteur      = profilMoteur;
      appState.profilRemorque    = profilRemorque || null;
      appState.tracteurData      = tracteurData;
      appState.remorqueData      = remorqueData;
      appState.enginActif        = null;
      appState.typeVehiculeActif = "tracteur";
      appState.vehiculeData      = buildVehiculeData();

      // Sauvegarde en base
      try {
        await dbUpsert("sessions_actives", {
          chauffeur_id:    appState.chauffeurId,
          entreprise_id:   entrepriseId,
          plaque_tracteur: plaqueT,
          plaque_remorque: plaqueR,
          engin_id:        null,
          profil_moteur:   profilMoteur,
          profil_remorque: profilRemorque || null
        }, { onConflict: "chauffeur_id" });
        await _enregistrerAttelage(plaqueT, plaqueR, profilMoteur, profilRemorque);
      } catch (_) {
        showToast("⚠️ Changement non synchronisé — vérifie ta connexion");
      }

      invalidateConsoMoisCache();
      await fetchCartesPerso();
      renderDashboard();
      checkAllNotifications(appState.vehiculeData, getCartesPerso());
      listenToChanges();
      // Premier lancement sans véhicule affecté (modale obligatoire) : ces
      // listeners n'ont jamais été démarrés dans enterDashboard — sans ça,
      // aucun changement admin/atelier/cartes/photos n'apparaît en direct
      // avant la prochaine reconnexion. Idempotent si déjà actifs.
      listenAdminChanges();
      if (appState.panelMecanoActif) startInterventionsRealtime();
      ensureCartesPersoListener();
      _startDocPhotosListener();
      maybePromptNotificationPermission();
      const profilLabel = Utils.getProfilMoteur(profilMoteur)?.label || profilMoteur;
      showToast(`✅ ${profilLabel} — ${plaqueT}${plaqueR ? " + " + plaqueR : " (Solo)"}`);
      return true;
    }
  });
}

// ════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ════════════════════════════════════════════════════════════════════════

function setupDashboardActions() {
  _setupAnimatedBtn("btn-go-intervention", "icon-intervention", "bounce", openInterventionScreen);
  _setupAnimatedBtn("btn-go-aide",          "icon-aide",          "spin",   openAideScreen);
  _setupAnimatedBtn("btn-go-parametres",    "icon-parametres",    "shake",  openParametresScreen);
  document.getElementById("btn-go-historique").addEventListener("click", openHistoriqueScreen);
  document.getElementById("btn-creer-carte").addEventListener("click", openCreerCarteModal);
}

// ─── Bouton animé : ripple + animation icône ──────────────────────────────
function _setupAnimatedBtn(btnId, iconId, animClass, callback) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.addEventListener("click", (e) => {
    // Ripple
    const rect = btn.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const ripple = document.createElement("div");
    ripple.className = "ripple";
    const color = btn.style.color || "#ffffff";
    ripple.style.background = color.replace(")", ", 0.4)").replace("rgb", "rgba");
    ripple.style.left = (x - 4) + "px";
    ripple.style.top  = (y - 4) + "px";
    btn.appendChild(ripple);
    setTimeout(() => ripple.remove(), 650);

    // Animation icône
    const icon = document.getElementById(iconId);
    if (icon) {
      icon.classList.remove("icon-bounce", "icon-spin", "icon-shake");
      void icon.offsetWidth; // force reflow
      icon.classList.add(`icon-${animClass}`);
      setTimeout(() => icon.classList.remove(`icon-${animClass}`), 600);
    }

    // Délai pour laisser l'animation se jouer avant de changer de page
    if (callback) setTimeout(callback, 380);
  });
}

function setupBackButtons() {
  document.querySelectorAll("[data-back]").forEach((btn) => {
    // data-back reste un filet de sécurité (écran racine si pas d'historique),
    // mais goBack() revient d'abord vers l'écran réellement visité avant.
    btn.addEventListener("click", () => goBack("screen-" + btn.dataset.back));
  });
  setupEdgeSwipeBack();
}

// ════════════════════════════════════════════════════════════════════════
// DÉMARRAGE
// ════════════════════════════════════════════════════════════════════════

init();

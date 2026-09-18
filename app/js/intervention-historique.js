// ════════════════════════════════════════════════════════════════════════
// MémoTruck — Intervention & Historique
// Rewired Supabase — plus aucune référence Firebase
// ════════════════════════════════════════════════════════════════════════

import { dbSelect, dbInsert, dbInsertMinimal, dbUpdate, dbDelete, dateToISO, callEdgeFunctionAuth, realtimeListenChangesOnly } from "./supabase-client.js";
import * as Utils from "./utils.js";
import { showToast, showConfirmDialog, showModal, navigateTo, escapeHtml } from "./ui-helpers.js";
import { uploadInterventionPhoto, fetchInterventionPhotosBulk } from "./photo-docs.js";
import { enqueueSync, isOnline } from "./offline.js";

let appState = null;
export function setAppStateIntervention(state) { appState = state; }

// ════════════════════════════════════════════════════════════════════════
// TEMPS RÉEL — statut atelier (option "panel mécanicien")
// Reflète en direct côté chauffeur la prise en charge / clôture d'une
// intervention par un mécanicien, sans avoir à quitter puis revenir sur
// l'écran historique. Abonnement démarré une fois par session (voir
// app.js), aucun effet pour les entreprises sans l'option.
// ════════════════════════════════════════════════════════════════════════
let _unsubInterventionsRealtime = null;

export function startInterventionsRealtime() {
  if (_unsubInterventionsRealtime) { _unsubInterventionsRealtime(); _unsubInterventionsRealtime = null; }
  const entrepriseId = appState?.chauffeur?.entreprise_id;
  if (!entrepriseId) return;

  _unsubInterventionsRealtime = realtimeListenChangesOnly(
    "interventions",
    { entreprise_id: entrepriseId },
    () => {
      // Ne recharge que si l'écran historique est actuellement affiché —
      // évite un rafraîchissement inutile en arrière-plan.
      const screen = document.getElementById("screen-historique");
      if (screen && !screen.classList.contains("hidden")) loadHistorique(true);
    }
  );
}

export function stopInterventionsRealtime() {
  if (_unsubInterventionsRealtime) { _unsubInterventionsRealtime(); _unsubInterventionsRealtime = null; }
}

// ════════════════════════════════════════════════════════════════════════
// INTERVENTION SCREEN
// ════════════════════════════════════════════════════════════════════════

let selectedType       = "Entretien";
let _localisationAuto   = null;
let _localisationAutoCoords = null; // { lat, lon } — toujours conservées même si l'adresse n'a pas pu être résolue
let _urgenceSelectionnee = "routine";
let _selectedPhotos     = []; // File[] en attente d'envoi
const MAX_PHOTOS = 3;

// ─── Localisation automatique (géolocalisation) ──────────────────────────
// Uniquement pour les types autres que Crevaison (qui utilise déjà le champ
// localisation pour la position du pneu). Best-effort : si la permission
// est refusée ou indisponible, l'intervention s'enregistre quand même sans
// localisation, exactement comme avant cette fonctionnalité.
function _updateLocalisationAutoVisibility() {
  const champ = document.getElementById("intervention-localisation-auto-field");
  const show  = selectedType !== "Crevaison";
  champ.classList.toggle("hidden", !show);
  if (show && !_localisationAuto) _captureLocalisationAuto();
}

// Un "Entretien" (vidange, filtres, embrayage…) n'est pas une panne — il n'y
// a rien à signaler à l'atelier ni à faire "prendre en charge" par un
// mécanicien : c'est juste un historique personnel du véhicule. Le champ
// reste donc masqué pour ce type, même si le panel mécanicien est actif.
function _updateAtelierFieldVisibility() {
  const champ = document.getElementById("intervention-atelier-field");
  const show  = appState.panelMecanoActif && selectedType !== "Entretien";
  champ.classList.toggle("hidden", !show);
  if (!show) {
    document.getElementById("intervention-signaler-atelier").checked = false;
    document.getElementById("atelier-toggle-card").classList.remove("checked");
    document.getElementById("intervention-urgence-row").classList.add("hidden");
  }
}

// Reverse-géocodage best-effort (Nominatim/OpenStreetMap, pas de clé requise).
// En cas d'échec (réseau, quota…) on garde simplement les coordonnées brutes
// comme texte de localisation — jamais bloquant pour l'enregistrement.
async function _reverseGeocode(lat, lon) {
  const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`);
  if (!res.ok) throw new Error("reverse geocode failed");
  const data = await res.json();
  if (data?.display_name) return data.display_name;
  throw new Error("no address");
}

function _captureLocalisationAuto() {
  const badge = document.getElementById("intervention-localisation-auto");
  if (!("geolocation" in navigator)) {
    badge.textContent = "📍 Géolocalisation indisponible sur cet appareil";
    return;
  }
  if (!window.isSecureContext) {
    // L'API navigator.geolocation échoue silencieusement (ou n'existe même
    // pas) hors HTTPS/localhost — cas rencontré en test sur une URL http.
    badge.textContent = "📍 Position indisponible (connexion non sécurisée)";
    return;
  }
  badge.textContent = "📍 Capture de la position…";
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      _localisationAutoCoords = { lat, lon };
      const coordsTxt = `📍 ${lat.toFixed(4)}, ${lon.toFixed(4)}`;
      _localisationAuto = coordsTxt;
      badge.textContent = coordsTxt + " — recherche de l'adresse…";
      badge.onclick = null;
      badge.classList.remove("loc-auto-retry");
      try {
        const adresse = await _reverseGeocode(lat, lon);
        _localisationAuto = `📍 ${adresse}`;
        badge.textContent = _localisationAuto;
      } catch {
        // Adresse indisponible : on garde les coordonnées, déjà affichées.
        badge.textContent = coordsTxt;
      }
    },
    (err) => {
      _localisationAuto = null;
      _localisationAutoCoords = null;
      // Un fix GPS à froid (ex. premier signalement en intérieur) peut
      // prendre plus de temps qu'un timeout court : on distingue le vrai
      // refus de permission d'un simple signal lent, et on permet de
      // relancer la capture d'un tap sans quitter l'écran.
      const messages = {
        1: "📍 Géolocalisation refusée — vérifie les autorisations de l'appli",
        2: "📍 Position introuvable (signal absent) — tape pour réessayer",
        3: "📍 Recherche du signal trop longue — tape pour réessayer",
      };
      badge.textContent = messages[err.code] || "📍 Position non disponible — tape pour réessayer";
      if (err.code !== 1) {
        badge.classList.add("loc-auto-retry");
        badge.onclick = () => _captureLocalisationAuto();
      }
    },
    { timeout: 20000, maximumAge: 60000, enableHighAccuracy: false }
  );
}

// ─── Sélecteur de photos ──────────────────────────────────────────────────
function _renderPhotoThumbs() {
  const row = document.getElementById("intervention-photo-row");
  const addBtn = document.getElementById("btn-add-photo-intervention");
  row.querySelectorAll(".photo-picker-thumb").forEach((el) => el.remove());

  _selectedPhotos.forEach((file, idx) => {
    const thumb = document.createElement("div");
    thumb.className = "photo-picker-thumb";
    const img = document.createElement("img");
    img.src = URL.createObjectURL(file);
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "photo-picker-remove";
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", () => {
      _selectedPhotos.splice(idx, 1);
      _renderPhotoThumbs();
    });
    thumb.appendChild(img);
    thumb.appendChild(removeBtn);
    row.insertBefore(thumb, addBtn);
  });

  addBtn.style.display = _selectedPhotos.length >= MAX_PHOTOS ? "none" : "flex";
}

// Bottom sheet caméra/galerie — même mécanisme et mêmes classes CSS
// (.scanner-source-*) que le sélecteur de photo des documents (app.js,
// _ouvrirDocPhotoPicker) : sur Android/Chrome, un input file seul avec
// accept="image/*" ouvre directement le sélecteur système (galerie), sans
// jamais proposer l'appareil photo — il faut un input dédié avec
// capture="environment" pour forcer la caméra.
function _ouvrirPhotoInterventionPicker() {
  const inputCamera  = document.getElementById("intervention-photo-input-camera");
  const inputGallery = document.getElementById("intervention-photo-input-galerie");

  const handleFile = (file) => {
    closeSheet();
    if (!file) return;
    const place = MAX_PHOTOS - _selectedPhotos.length;
    if (place > 0) _selectedPhotos.push(file);
    _renderPhotoThumbs();
  };
  inputCamera.onchange  = () => { const f = inputCamera.files[0];  inputCamera.value = "";  handleFile(f); };
  inputGallery.onchange = () => { const f = inputGallery.files[0]; inputGallery.value = ""; handleFile(f); };

  let sheet = document.getElementById("intervention-photo-source-sheet");
  if (!sheet) {
    sheet = document.createElement("div");
    sheet.id = "intervention-photo-source-sheet";
    sheet.className = "scanner-source-sheet";
    sheet.innerHTML = `
      <div class="scanner-source-backdrop"></div>
      <div class="scanner-source-box">
        <div class="scanner-source-handle"></div>
        <div class="scanner-source-title">Ajouter une photo</div>
        <button class="scanner-source-btn" id="inter-photo-btn-camera">
          <span class="scanner-source-icon">📷</span>
          <div>
            <div class="scanner-source-label">Prendre une photo</div>
            <div class="scanner-source-sub">Ouvrir la caméra</div>
          </div>
        </button>
        <button class="scanner-source-btn" id="inter-photo-btn-gallery">
          <span class="scanner-source-icon">🖼️</span>
          <div>
            <div class="scanner-source-label">Choisir dans la galerie</div>
            <div class="scanner-source-sub">Depuis vos photos existantes</div>
          </div>
        </button>
        <button class="scanner-source-btn scanner-source-btn--cancel" id="inter-photo-btn-cancel">
          Annuler
        </button>
      </div>
    `;
    document.body.appendChild(sheet);
    sheet.querySelector(".scanner-source-backdrop").addEventListener("click", closeSheet);
    document.getElementById("inter-photo-btn-cancel").addEventListener("click", closeSheet);
    document.getElementById("inter-photo-btn-camera").addEventListener("click",  () => inputCamera.click());
    document.getElementById("inter-photo-btn-gallery").addEventListener("click", () => inputGallery.click());
  }

  function closeSheet() { sheet.classList.remove("is-open"); }
  sheet.classList.add("is-open");
}

export function setupInterventionScreenLogic() {
  document.querySelectorAll("#intervention-type-chips .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll("#intervention-type-chips .chip").forEach((c) => c.classList.remove("selected"));
      chip.classList.add("selected");
      selectedType = chip.dataset.type;
      document.getElementById("intervention-pneu-field").classList.toggle("hidden", selectedType !== "Crevaison");
      _updateLocalisationAutoVisibility();
      _updateAtelierFieldVisibility();
    });
  });

  document.getElementById("btn-save-intervention").addEventListener("click", saveIntervention);

  document.getElementById("atelier-toggle-card").addEventListener("click", () => {
    const checkbox = document.getElementById("intervention-signaler-atelier");
    checkbox.checked = !checkbox.checked;
    document.getElementById("atelier-toggle-card").classList.toggle("checked", checkbox.checked);
    document.getElementById("intervention-urgence-row").classList.toggle("hidden", !checkbox.checked);
  });

  document.querySelectorAll("#intervention-urgence-row .urgence-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll("#intervention-urgence-row .urgence-chip").forEach((c) => c.classList.remove("selected"));
      chip.classList.add("selected");
      _urgenceSelectionnee = chip.dataset.urgence;
    });
  });

  document.getElementById("btn-add-photo-intervention").addEventListener("click", _ouvrirPhotoInterventionPicker);
}

export function openInterventionScreen() {
  document.getElementById("intervention-date").value   = dateToISO(new Date());
  document.getElementById("intervention-details").value = "";
  selectedType = "Entretien";
  document.querySelectorAll("#intervention-type-chips .chip").forEach((c) => c.classList.remove("selected"));
  document.querySelector('#intervention-type-chips .chip[data-type="Entretien"]').classList.add("selected");
  document.getElementById("intervention-pneu-field").classList.add("hidden");

  document.getElementById("intervention-signaler-atelier").checked = false;
  document.getElementById("atelier-toggle-card").classList.remove("checked");
  document.getElementById("intervention-urgence-row").classList.add("hidden");
  _updateAtelierFieldVisibility();
  _urgenceSelectionnee = "routine";
  document.querySelectorAll("#intervention-urgence-row .urgence-chip").forEach((c) => c.classList.remove("selected"));
  document.querySelector('#intervention-urgence-row .urgence-chip[data-urgence="routine"]').classList.add("selected");

  _localisationAuto = null;
  _localisationAutoCoords = null;
  _updateLocalisationAutoVisibility();

  _selectedPhotos = [];
  _renderPhotoThumbs();

  // Populate le select véhicule avec tracteur + remorque + engin
  const select = document.getElementById("intervention-vehicule");
  select.innerHTML = "";

  if (appState.typeVehiculeActif === "engin" && appState.enginActif) {
    const engin = appState.enginActif;
    const optE = document.createElement("option");
    optE.value = engin.id;
    const nom = engin.numero_parc || engin.numero_serie || "Engin";
    const profil = Utils.getProfilEngin ? Utils.getProfilEngin(engin.profil)?.label || engin.profil : engin.profil;
    optE.textContent = `${profil} (${nom})`;
    optE.dataset.type = "engin";
    select.appendChild(optE);
  } else {
    const optT = document.createElement("option");
    optT.value = appState.plaqueT;
    optT.textContent = `Tracteur (${appState.plaqueT})`;
    optT.dataset.type = "tracteur";
    select.appendChild(optT);

    if (appState.plaqueR) {
      const optR = document.createElement("option");
      optR.value = appState.plaqueR;
      optR.textContent = `Remorque (${appState.plaqueR})`;
      optR.dataset.type = "remorque";
      select.appendChild(optR);
    }
  }

  navigateTo("screen-intervention");
}

async function saveIntervention() {
  const dateInput        = document.getElementById("intervention-date").value;
  const details          = document.getElementById("intervention-details").value;
  const select           = document.getElementById("intervention-vehicule");
  const pneuSelection    = document.getElementById("intervention-pneu").value;
  const selectedOption   = select.options[select.selectedIndex];
  const entitePlaque     = selectedOption ? selectedOption.value : appState.plaqueT;
  const entiteType       = selectedOption?.dataset.type === "remorque" ? "remorque"
                         : selectedOption?.dataset.type === "engin"    ? "engin"
                         : "tracteur";

  const { valeur: dateISO, erreur: erreurDate } = Utils.validerDateISO(dateInput);
  if (erreurDate) { showToast("⚠️ " + erreurDate); return; }
  if (!details.trim()) { showToast("⚠️ Ajoute quelques détails sur l'intervention"); return; }

  const btn = document.getElementById("btn-save-intervention");
  btn.disabled = true;

  const signalerAtelier = appState.panelMecanoActif && selectedType !== "Entretien" && document.getElementById("intervention-signaler-atelier").checked;
  // Généré côté client : permet d'appeler workshop-notify juste après, sans
  // dépendre d'un SELECT de retour (dbInsertMinimal ne renvoie rien).
  const interventionId = crypto.randomUUID();
  const entrepriseId   = appState.chauffeur?.entreprise_id || "";
  const photosAEnvoyer = [..._selectedPhotos];

  const payload = {
    id:               interventionId,
    entreprise_id:    entrepriseId,
    chauffeur_id:     appState.chauffeurId || null,
    chauffeur_prenom: appState.prenom || null,
    chauffeur_nom:    appState.chauffeur?.nom || null,
    entite_type:      entiteType,
    entite_plaque:    entitePlaque,
    type:             selectedType,
    details:          details.trim(),
    date:             dateISO,
    localisation:     selectedType === "Crevaison" ? pneuSelection : (_localisationAuto || "N/A"),
    latitude:         selectedType !== "Crevaison" ? (_localisationAutoCoords?.lat ?? null) : null,
    longitude:        selectedType !== "Crevaison" ? (_localisationAutoCoords?.lon ?? null) : null,
    statut:           signalerAtelier ? "a_faire" : null,
    urgence:          signalerAtelier ? _urgenceSelectionnee : null
  };

  // Hors-ligne : on met en file d'attente (même mécanisme que la
  // consommation) plutôt que d'échouer — l'intervention elle-même n'est
  // jamais perdue. Les photos (File[]) sont stockées telles quelles dans la
  // file (IndexedDB supporte nativement Blob/File) et envoyées après coup,
  // une fois l'intervention créée en base.
  if (!isOnline()) {
    await enqueueSync("intervention_insert", { ...payload, photos: photosAEnvoyer });
    showToast("📡 Hors-ligne — l'intervention sera envoyée dès que possible");
    navigateTo("screen-dashboard");
    btn.disabled = false;
    return;
  }

  try {
    await dbInsertMinimal("interventions", payload);
    showToast(signalerAtelier ? "✅ Intervention enregistrée et signalée à l'atelier !" : "✅ Intervention enregistrée !");
    if (signalerAtelier) {
      callEdgeFunctionAuth("workshop-notify", { action: "notify_a_faire", intervention_id: interventionId })
        .catch((e) => console.warn("[workshop-notify]", e.message));
    }
    for (const file of photosAEnvoyer) {
      uploadInterventionPhoto(entrepriseId, interventionId, file).catch((e) => console.warn("[photo]", e.message));
    }
    navigateTo("screen-dashboard");
  } catch (e) {
    // Échec réseau (pas une erreur applicative) : on tente quand même la
    // file d'attente plutôt que de faire perdre la saisie au chauffeur.
    if (!e.message || /fetch|network|failed/i.test(e.message)) {
      await enqueueSync("intervention_insert", { ...payload, photos: photosAEnvoyer });
      showToast("📡 Connexion instable — l'intervention sera envoyée dès que possible");
      navigateTo("screen-dashboard");
    } else {
      showToast(Utils.messageErreurSupabase(e));
    }
  } finally {
    btn.disabled = false;
  }
}

// ════════════════════════════════════════════════════════════════════════
// HISTORIQUE SCREEN
// ════════════════════════════════════════════════════════════════════════

// ─── Recherche & filtres ──────────────────────────────────────────────────
// Le fetch reste inchangé (toutes les interventions du véhicule) ; la
// recherche/filtre s'applique côté client sur le résultat déjà en mémoire,
// sans requête réseau supplémentaire.
let _historiqueItemsCache      = [];
let _historiqueMecaniciensMap  = {};
let _historiquePhotosMap       = {};
let _historiqueSearchTerm      = "";
let _historiqueFiltre          = "tous";

export function setupHistoriqueScreenLogic() {
  const search = document.getElementById("historique-search");
  search.addEventListener("input", () => {
    _historiqueSearchTerm = search.value.trim().toLowerCase();
    _appliquerFiltresEtRendre();
  });

  document.querySelectorAll("#historique-filter-chips .historique-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll("#historique-filter-chips .historique-chip").forEach((c) => c.classList.remove("selected"));
      chip.classList.add("selected");
      _historiqueFiltre = chip.dataset.filtre;
      _appliquerFiltresEtRendre();
    });
  });
}

function _appliquerFiltresEtRendre() {
  let items = _historiqueItemsCache;

  if (_historiqueFiltre === "ce_mois") {
    const cle = Utils.moisCleDeDate(new Date());
    items = items.filter((it) => Utils.moisCleDeDate(it.date) === cle);
  } else if (_historiqueFiltre !== "tous") {
    items = items.filter((it) => it.type === _historiqueFiltre);
  }

  if (_historiqueSearchTerm) {
    items = items.filter((it) => {
      const hay = [it.details, it.entite_plaque, it.type, it.localisation].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(_historiqueSearchTerm);
    });
  }

  renderHistoriqueList(items, _historiqueMecaniciensMap, _historiquePhotosMap);
}

export function openHistoriqueScreen() {
  navigateTo("screen-historique");
  document.getElementById("historique-search").value = "";
  _historiqueSearchTerm = "";
  _historiqueFiltre = "tous";
  document.querySelectorAll("#historique-filter-chips .historique-chip").forEach((c) => c.classList.remove("selected"));
  document.querySelector('#historique-filter-chips .historique-chip[data-filtre="tous"]').classList.add("selected");
  loadHistorique();
}

async function loadHistorique(silent = false) {
  const container = document.getElementById("historique-list");
  if (!silent) {
    container.innerHTML = `<div class="empty-state"><span class="icon">📋</span><div class="main-text">Chargement…</div></div>`;
  }

  try {
    const SELECT_COLS = "id,entite_type,entite_plaque,date,type,details,localisation,chauffeur_id,chauffeur_prenom,chauffeur_nom,statut,mecanicien_id,urgence,commentaire_mecanicien";

    let rows = [];

    if (appState.typeVehiculeActif === "engin" && appState.enginActif?.id) {
      rows = await dbSelect("interventions", {
        select: SELECT_COLS,
        filters: [
          { col: "entite_plaque", op: "eq", val: appState.enginActif.id },
          { col: "entreprise_id", op: "eq", val: appState.chauffeur?.entreprise_id || "" }
        ],
        order: { col: "date", asc: false }
      });
    } else {
      rows = await dbSelect("interventions", {
        select: SELECT_COLS,
        filters: [
          { col: "entite_plaque", op: "eq", val: appState.plaqueT },
          { col: "entreprise_id", op: "eq", val: appState.chauffeur?.entreprise_id || "" }
        ],
        order: { col: "date", asc: false }
      });

      if (appState.plaqueR) {
        const rowsR = await dbSelect("interventions", {
          select: SELECT_COLS,
          filters: [
            { col: "entite_plaque", op: "eq", val: appState.plaqueR },
            { col: "entreprise_id", op: "eq", val: appState.chauffeur?.entreprise_id || "" }
          ],
          order: { col: "date", asc: false }
        });
        rows = [...(rows || []), ...(rowsR || [])];
        rows.sort((a, b) => {
          const da = Utils.toDate(a.date); const db_ = Utils.toDate(b.date);
          return (db_ || 0) - (da || 0);
        });
      }
    }

    // Noms des mécaniciens (option panel atelier) — uniquement si au moins
    // une intervention a un mécanicien assigné, pour ne pas faire de requête
    // inutile pour les entreprises sans l'option.
    let mecaniciensMap = {};
    const mecanicienIds = [...new Set((rows || []).map(r => r.mecanicien_id).filter(Boolean))];
    if (mecanicienIds.length > 0) {
      const mecs = await dbSelect("admins", {
        select: "id,prenom,nom",
        filters: [{ col: "entreprise_id", op: "eq", val: appState.chauffeur?.entreprise_id || "" }, { col: "role", op: "eq", val: "mecanicien" }]
      }).catch(() => []);
      (mecs || []).forEach(m => { mecaniciensMap[m.id] = `${m.prenom || ""} ${m.nom || ""}`.trim() || "—"; });
    }

    const photosMap = await fetchInterventionPhotosBulk((rows || []).map(r => r.id)).catch(() => ({}));

    _historiqueItemsCache     = rows || [];
    _historiqueMecaniciensMap = mecaniciensMap;
    _historiquePhotosMap      = photosMap;
    _appliquerFiltresEtRendre();
  } catch (e) {
    showToast("📡 Impossible de charger l'historique");
    document.getElementById("historique-list").innerHTML = `
      <div class="empty-state"><span class="icon">📡</span><div class="main-text">Erreur de chargement</div></div>
    `;
  }
}

function renderHistoriqueList(items, mecaniciensMap = {}, photosMap = {}) {
  const container = document.getElementById("historique-list");

  if (items.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="icon">📋</span>
        <div class="main-text">Aucune intervention enregistrée</div>
      </div>
    `;
    return;
  }

  const typeColors = { Crevaison: "var(--color-danger)", Panne: "var(--color-warning)", Accident: "var(--color-danger)" };
  const moisActuelCle = Utils.moisCleDeDate(new Date());

  // ── Groupement par mois ──────────────────────────────────────────────
  const grouped = {};
  items.forEach(item => {
    const cle = Utils.moisCleDeDate(item.date);
    if (!grouped[cle]) grouped[cle] = [];
    grouped[cle].push(item);
  });
  const sortedKeys = Object.keys(grouped).sort().reverse();

  // ── Rendu ────────────────────────────────────────────────────────────
  function renderCard(item) {
    const color   = typeColors[item.type] || "var(--color-success)";
    const dateStr = Utils.formatDateFR(item.date) || "—";

    // Libellé véhicule
    let vehiculeLabel;
    if (item.entite_type === "remorque") {
      vehiculeLabel = `Remorque (${item.entite_plaque})`;
    } else if (item.entite_type === "engin") {
      const engin  = appState.enginActif;
      const nom    = engin?.numero_parc || engin?.numero_serie || item.entite_plaque.substring(0, 8);
      const profil = engin?.profil ? (Utils.getProfilEngin ? Utils.getProfilEngin(engin.profil)?.label || engin.profil : engin.profil) : "Engin";
      vehiculeLabel = `${profil} (${nom})`;
    } else {
      vehiculeLabel = `Tracteur (${item.entite_plaque})`;
    }

    // Libellé chauffeur
    const chauffeurLabel = [item.chauffeur_prenom, item.chauffeur_nom].filter(Boolean).join(" ") || null;

    // Boutons modifier/supprimer — uniquement si c'est le chauffeur qui a créé
    const isOwner = !item.chauffeur_id || item.chauffeur_id === appState.chauffeurId;

    // Statut atelier (option "panel mécanicien") — rien ne s'affiche si
    // l'entreprise n'a pas l'option ou si l'intervention n'a pas de statut.
    const STATUT_INFO = {
      a_faire:        { label: "🔧 À faire",        color: "var(--color-warning)" },
      pris_en_charge: { label: "🔧 Pris en charge", color: "var(--color-accent)" },
      termine:        { label: "✅ Terminé",        color: "var(--color-success)" }
    };
    const statutInfo = item.statut ? STATUT_INFO[item.statut] : null;
    const mecanicienLabel = item.mecanicien_id ? mecaniciensMap[item.mecanicien_id] : null;
    const showBoutonAFaire = appState.panelMecanoActif && isOwner && !item.statut;
    const urgenceBadge = item.urgence === "urgent"
      ? `<span class="item-card-urgence urgent">🔴 Urgent</span>`
      : item.urgence === "routine" ? `<span class="item-card-urgence routine">🟢 Routine</span>` : "";
    const photos = photosMap[item.id] || [];

    return `
      <div class="item-card">
        <div class="item-card-top">
          <div class="item-card-type" style="color:${color};">
            <span class="status-dot" style="background:${color};"></span>
            ${escapeHtml((item.type || "Autre").toUpperCase())}
            ${urgenceBadge}
          </div>
          <div class="item-card-date-row">
            <span class="item-card-date">${dateStr}</span>
            ${isOwner && (!item.statut || item.statut === "a_faire") ? `
              <button class="icon-btn-small" data-edit-intervention="${item.id}">✏️</button>
            ` : ""}
            ${isOwner ? `
              <button class="icon-btn-small" data-delete-intervention="${item.id}" style="color:var(--color-danger);">🗑️</button>
            ` : ""}
          </div>
        </div>
        <div class="item-card-divider"></div>
        <div class="info-line"><span class="label">Véhicule : </span><span class="value">${escapeHtml(vehiculeLabel)}</span></div>
        ${chauffeurLabel ? `<div class="info-line"><span class="label">Chauffeur : </span><span class="value">👤 ${escapeHtml(chauffeurLabel)}</span></div>` : ""}
        ${item.localisation && item.localisation !== "N/A"
          ? `<div class="info-line"><span class="label">Localisation : </span><span class="value">${escapeHtml(item.localisation)}</span></div>`
          : ""}
        <div class="info-line"><span class="label">Détails : </span><span class="value">${escapeHtml(item.details || "")}</span></div>
        ${photos.length > 0 ? `<div class="item-card-photos">${photos.map(p => p.url ? `<img src="${p.url}" alt="Photo intervention" data-photo-zoom="${p.url}" />` : "").join("")}</div>` : ""}
        ${statutInfo ? `<div class="item-card-statut" style="color:${statutInfo.color};">${statutInfo.label}${mecanicienLabel && item.statut !== "a_faire" ? ` — ${item.statut === "termine" ? "réparé" : "pris en charge"} par ${escapeHtml(mecanicienLabel)}` : ""}</div>` : ""}
        ${item.commentaire_mecanicien ? `<div class="info-line"><span class="label">Commentaire mécanicien : </span><span class="value">${escapeHtml(item.commentaire_mecanicien)}</span></div>` : ""}
        ${showBoutonAFaire ? `<button class="item-card-btn-atelier" data-a-faire="${item.id}"><span class="icon">🔧</span> Signaler à l'atelier</button>` : ""}
      </div>
    `;
  }

  let html = "";
  sortedKeys.forEach((cle, idx) => {
    const entries = grouped[cle];
    const isMoisActuel = cle === moisActuelCle;
    const isOpen = isMoisActuel || idx === 0;
    const label  = Utils.moisLabelDeCle(cle);

    if (isMoisActuel) {
      // Mois courant — affiché directement sans accordéon. Le libellé évite
      // "(en cours)" : ça laissait croire qu'une intervention (notamment un
      // entretien) attendait une validation, alors que tout ce qui est listé
      // ici est déjà pleinement enregistré dès sa création — pas d'étape
      // d'approbation atelier, "en cours" ne qualifiait que le mois civil.
      html += `<div style="font-size:12px;font-weight:900;color:var(--color-accent);letter-spacing:1px;margin:6px 0 10px;">
        ${label.toUpperCase()} (ce mois-ci) — ${entries.length} intervention(s)
      </div>`;
      html += entries.map(renderCard).join("");
    } else {
      // Mois passés — accordéon
      html += `
        <div class="mois-group-card ${isOpen ? "is-open" : ""}" data-mois-toggle="${cle}" style="position:relative;overflow:hidden;margin-bottom:10px;">
          <div class="mois-group-header">
            <div style="display:flex;align-items:center;gap:12px;">
              <div class="mois-group-icon-box">📋</div>
              <div class="mois-group-info">
                <div class="mois-group-title">${label}</div>
                <div class="mois-group-sub">${entries.length} intervention(s)</div>
              </div>
            </div>
            <div class="mois-group-chevron">▾</div>
          </div>
          <div class="mois-group-content ${isOpen ? "expanded" : ""}">
            <div style="padding:8px 0;">
              ${entries.map(renderCard).join("")}
            </div>
          </div>
        </div>
      `;
    }
  });

  container.innerHTML = html;

  // ── Listeners accordéon ──────────────────────────────────────────────
  container.querySelectorAll("[data-mois-toggle]").forEach((el) => {
    el.querySelector(".mois-group-header").addEventListener("click", () => {
      const isOpen = el.classList.toggle("is-open");
      el.querySelector(".mois-group-content").classList.toggle("expanded", isOpen);
    });
  });

  // ── Listeners modification ───────────────────────────────────────────
  container.querySelectorAll("[data-edit-intervention]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.editIntervention;
      const item = items.find(i => i.id === id);
      if (item) openEditIntervention(item);
    });
  });

  // ── Listeners suppression ────────────────────────────────────────────
  container.querySelectorAll("[data-delete-intervention]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.deleteIntervention;
      showConfirmDialog({
        title: "Supprimer cette intervention ?",
        text: "Cette action est définitive et ne peut pas être annulée.",
        confirmLabel: "Supprimer",
        onConfirm: async () => {
          try {
            await dbDelete("interventions", [{ col: "id", op: "eq", val: id }]);
            showToast("🗑️ Supprimé");
            loadHistorique();
          } catch (err) {
            showToast(Utils.messageErreurSupabase(err));
          }
        }
      });
    });
  });

  // ── Listeners "signaler à l'atelier" ─────────────────────────────────
  container.querySelectorAll("[data-a-faire]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      marquerAFaire(btn.dataset.aFaire, btn);
    });
  });

  // ── Zoom photo (plein écran, nouvel onglet) ──────────────────────────
  container.querySelectorAll("[data-photo-zoom]").forEach((img) => {
    img.addEventListener("click", (e) => {
      e.stopPropagation();
      window.open(img.dataset.photoZoom, "_blank");
    });
  });
}

// Signale une intervention à l'atelier (option "panel mécanicien"). Aucune
// course possible ici : seul le propriétaire de l'intervention agit, avant
// toute prise en charge par un mécanicien.
async function marquerAFaire(id, btn) {
  btn.disabled = true;
  btn.textContent = "…";
  try {
    await dbUpdate("interventions", { statut: "a_faire" }, [{ col: "id", op: "eq", val: id }]);
    showToast("🔧 Signalé à l'atelier");
    loadHistorique();
    callEdgeFunctionAuth("workshop-notify", { action: "notify_a_faire", intervention_id: id })
      .catch((e) => console.warn("[workshop-notify]", e.message));
  } catch (e) {
    showToast(Utils.messageErreurSupabase(e));
    btn.disabled = false;
    btn.textContent = "🔧 Signaler à l'atelier";
  }
}

// ════════════════════════════════════════════════════════════════════════
// MODIFICATION INTERVENTION
// ════════════════════════════════════════════════════════════════════════

function openEditIntervention(item) {
  const typeOptions = ["Entretien", "Réparation", "Crevaison", "Panne", "Accident", "Contrôle technique", "Autre"];

  showModal({
    title: "✏️ Modifier l'intervention",
    bodyHTML: `
      <div style="display:flex;flex-direction:column;gap:14px;">
        <div>
          <label style="font-size:12px;font-weight:700;color:var(--color-text-secondary);letter-spacing:0.5px;">TYPE</label>
          <select id="edit-interv-type" style="width:100%;margin-top:6px;padding:10px 14px;background:var(--color-surface-input);border:1.5px solid var(--color-divider);border-radius:10px;color:var(--color-text-primary);font-size:14px;">
            ${typeOptions.map(t => `<option value="${t}" ${t === item.type ? "selected" : ""}>${t}</option>`).join("")}
          </select>
        </div>
        <div>
          <label style="font-size:12px;font-weight:700;color:var(--color-text-secondary);letter-spacing:0.5px;">DATE</label>
          <input type="date" id="edit-interv-date" value="${item.date || ""}"
            style="width:100%;margin-top:6px;padding:10px 14px;background:var(--color-surface-input);border:1.5px solid var(--color-divider);border-radius:10px;color:var(--color-text-primary);font-size:14px;box-sizing:border-box;" />
        </div>
        <div>
          <label style="font-size:12px;font-weight:700;color:var(--color-text-secondary);letter-spacing:0.5px;">DÉTAILS</label>
          <textarea id="edit-interv-details" rows="4"
            style="width:100%;margin-top:6px;padding:10px 14px;background:var(--color-surface-input);border:1.5px solid var(--color-divider);border-radius:10px;color:var(--color-text-primary);font-size:14px;resize:vertical;box-sizing:border-box;"
          >${escapeHtml(item.details || "")}</textarea>
        </div>
      </div>
    `,
    confirmLabel: "✅ Enregistrer",
    cancelLabel:  "Annuler",
    onConfirm: async (_, close) => {
      const type    = document.getElementById("edit-interv-type").value;
      const dateStr = document.getElementById("edit-interv-date").value;
      const details = document.getElementById("edit-interv-details").value.trim();

      const { valeur: dateISO, erreur } = Utils.validerDateISO(dateStr);
      if (erreur)        { showToast("⚠️ " + erreur); return false; }
      if (!details)      { showToast("⚠️ Ajoute quelques détails"); return false; }

      try {
        await dbUpdate("interventions", { type, details, date: dateISO }, [
          { col: "id", op: "eq", val: item.id }
        ]);
        showToast("✅ Intervention modifiée !");
        close();
        loadHistorique();
      } catch (e) {
        showToast(Utils.messageErreurSupabase(e));
        return false;
      }
    }
  });
}

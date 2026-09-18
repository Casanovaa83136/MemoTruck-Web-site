// ════════════════════════════════════════════════════════════════════════
// MémoTruck — Cartes personnalisées
// Rewired Supabase — plus aucune référence Firebase
// Cartes libres (date et/ou code) rattachées au chauffeur courant.
// ════════════════════════════════════════════════════════════════════════

import { dbSelect, dbInsert, dbInsertMinimal, dbUpdate, dbDelete, realtimeListenChangesOnly } from "./supabase-client.js";
import * as Utils from "./utils.js";
import { showToast, showModal, showConfirmDialog, escapeHtml } from "./ui-helpers.js";
import { uploadDocPhoto, deleteDocPhoto, fetchDocPhotos, getCachedDocPhotos } from "./photo-docs.js";

const GROUPES_FIXES = ["Véhicules", "Données personnelles", "Cartes Gazole"];
const NOUVEAU_GROUPE = "__nouveau__";

let appState = null;
export function setAppStateCartesPerso(state) { appState = state; }

let cartesPerso               = [];
let cartesPersoUnsubscribe    = null;
let cartesPersoListenerChauffeur = null;
const codeVisibility  = {};
const openGroupsPerso = {};

// ─── Accès aux données ────────────────────────────────────────────────────
export function getCartesPerso()              { return cartesPerso; }
export function getCartesPersoForGroupe(g) {
  return cartesPerso.filter((c) => c.groupe === g);
}

// ─── Écoute temps réel (Supabase Realtime) ───────────────────────────────
// On écoute la table cartes_perso filtrée sur chauffeur_id.
export function ensureCartesPersoListener() {
  if (!appState || !appState.chauffeurId) return;
  if (cartesPersoListenerChauffeur === appState.chauffeurId) return;
  cartesPersoListenerChauffeur = appState.chauffeurId;

  if (cartesPersoUnsubscribe) cartesPersoUnsubscribe();

  // Fetch initial direct
  _refetchAndRender();

  // Un seul listener sur toutes les cartes de l'entreprise
  // Le filtre côté client (fetchCartesPerso) fait le tri par chauffeur/véhicule
  const entrepriseId = appState.chauffeur?.entreprise_id || "";
  if (entrepriseId) {
    cartesPersoUnsubscribe = realtimeListenChangesOnly(
      "cartes_perso",
      { entreprise_id: entrepriseId },
      async () => {
        await fetchCartesPerso();
        if (appState.render) appState.render();
      }
    );
  }
}

export function stopCartesPersoListener() {
  if (cartesPersoUnsubscribe)   cartesPersoUnsubscribe();

  cartesPersoUnsubscribe       = null;
  cartesPersoListenerChauffeur = null;
  cartesPerso                  = [];
}

// Fetch seul (sans render) — appelé au démarrage depuis app.js
export async function fetchCartesPerso() {
  if (!appState || !appState.chauffeurId) return;
  try {
    // Une seule requête — toutes les cartes du chauffeur
    const rows = await dbSelect("cartes_perso", {
      filters: [{ col: "chauffeur_id", op: "eq", val: appState.chauffeurId }],
      order:   { col: "ordre", asc: true }
    });

    // Cartes perso (sans entite_type) → toujours visibles
    const cartesChauf = (rows || []).filter(r => !r.entite_type);

    // Cartes véhicule → filtrées selon le véhicule actif
    let cartesVehicules = [];
    if (appState.typeVehiculeActif === "engin" && appState.enginActif?.id) {
      cartesVehicules = (rows || []).filter(r =>
        r.entite_type === "engin" && r.entite_plaque === appState.enginActif.id
      );
    } else {
      cartesVehicules = (rows || []).filter(r =>
        (r.entite_type === "tracteur" && r.entite_plaque === appState.plaqueT) ||
        (r.entite_type === "remorque" && r.entite_plaque === appState.plaqueR)
      );
    }

    cartesPerso = [
      ...cartesChauf.map(_rowToCartePerso),
      ...cartesVehicules.map(r => _rowToCartePerso({ ...r, groupe: "Véhicules" }))
    ];
  } catch(e) {
    console.error("[cartes-perso] fetch error:", e);
  }
}

// Refetch immédiat depuis Supabase + re-render dashboard
async function _refetchAndRender() {
  await fetchCartesPerso();
  if (appState.render) appState.render();
}

function _rowToCartePerso(row) {
  return {
    id:         row.id,
    groupe:     row.groupe     || "Autres",
    label:      row.label      || "Sans nom",
    aDate:      !!row.a_date,
    dateValeur: row.date_valeur || null,   // ISO string ou null
    aCode:      !!row.a_code,
    codeValeur: row.code_valeur || null,
    aVerso:     !!row.a_verso
  };
}

// ─── Rendu d'une carte perso (réutilisé dans tous les groupes) ───────────
export function renderCartePersoItemHTML(carte) {
  const hasDate     = !!carte.aDate;
  const statusColor = hasDate ? Utils.getStatusColor(carte.dateValeur) : "var(--color-text-secondary)";
  const statusLabel = hasDate ? Utils.getStatusLabel(carte.dateValeur) : "Sans échéance";
  const dateStr     = hasDate ? (Utils.formatDateFR(carte.dateValeur) || "—") : null;
  const isVisible   = !!codeVisibility[carte.id];

  // Photo depuis le cache
  const photos    = getCachedDocPhotos(appState?.chauffeurId || "");
  const photoData = photos[carte.id] || null;
  const photoUrl  = photoData?.url   || null;

  function _zoneHTML(url, attr, faceLabel) {
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
  if (carte.aVerso) {
    const versoData = photos[`${carte.id}-verso`] || null;
    photoZoneHTML = `
      <div class="doc-photo-zone-stack">
        ${_zoneHTML(photoUrl, `data-perso-photo="${escapeHtml(carte.id)}"`, "Recto")}
        ${_zoneHTML(versoData?.url || null, `data-perso-photo-verso="${escapeHtml(carte.id)}"`, "Verso")}
      </div>
    `;
  } else {
    photoZoneHTML = _zoneHTML(photoUrl, `data-perso-photo="${escapeHtml(carte.id)}"`, null);
  }

  let codeRowHTML = "";
  if (carte.aCode && carte.codeValeur) {
    const displayCode = isVisible ? escapeHtml(carte.codeValeur) : "•".repeat(Math.max(4, carte.codeValeur.length));
    codeRowHTML = `
      <div class="gazole-code-row">
        <div class="gazole-code-left">
          🔒 <span style="letter-spacing:${isVisible ? "1px" : "3px"};">${displayCode}</span>
        </div>
        <button class="gazole-code-toggle" data-perso-code-toggle="${carte.id}">${isVisible ? "🙈" : "👁️"}</button>
      </div>
    `;
  }

  const theme     = document.documentElement.getAttribute("data-theme") || "nuit";
  const isPremium = theme === "aurora" || theme === "obsidian";
  const isAurora  = theme === "aurora";

  const glowLine = isPremium ? `
    <div style="position:absolute;top:0;left:10%;right:10%;height:1px;
      background:linear-gradient(90deg,transparent,${isAurora ? "rgba(139,92,246,0.7),rgba(59,130,246,0.5)" : "rgba(41,121,255,0.8),rgba(6,182,212,0.6)"},transparent);
      pointer-events:none;z-index:2;border-radius:1px;"></div>` : "";

  const statusDotStyle = isPremium && hasDate
    ? `background:${statusColor};box-shadow:0 0 8px ${statusColor},0 0 16px ${statusColor}40;`
    : `background:${statusColor};`;

  return `
    <div class="gazole-item-card gazole-item-card--split" style="position:relative;overflow:hidden;">
      ${glowLine}
      ${photoZoneHTML}
      <div class="gazole-item-split-right" data-perso-edit="${carte.id}">
        <div class="gazole-item-row">
          <div class="gazole-item-left">
            <div class="nom">${escapeHtml(carte.label)}</div>
            <div class="status" style="color:${statusColor};">${statusLabel}</div>
          </div>
          <div class="gazole-item-right">
            ${hasDate ? `
              <div class="status-dot" style="${statusDotStyle}"></div>
              <div style="font-weight:800; font-size:13px; color:${statusColor};">${dateStr}</div>
            ` : ""}
            <span style="color:var(--color-text-secondary); font-size:14px;">✏️</span>
          </div>
        </div>
        ${codeRowHTML}
      </div>
    </div>
  `;
}

// ─── Listeners (édition + toggle code) ───────────────────────────────────
export function attachCartePersoListeners(container, cartesDuGroupe) {
  // Zone photo gauche (recto)
  container.querySelectorAll("[data-perso-photo]").forEach((zone) => {
    zone.addEventListener("click", (e) => {
      e.stopPropagation();
      const carte = cartesDuGroupe.find((c) => c.id === zone.dataset.persoPhoto);
      if (!carte) return;
      const photos    = getCachedDocPhotos(appState?.chauffeurId || "");
      const photoData = photos[carte.id] || null;
      if (photoData?.url) {
        _ouvrirVisionneureCartePerso(carte, photoData, "recto");
      } else {
        _ouvrirPhotoPickerCartePerso(carte, "recto");
      }
    });
  });

  // Zone photo verso (cartes recto/verso : CNI, permis…)
  container.querySelectorAll("[data-perso-photo-verso]").forEach((zone) => {
    zone.addEventListener("click", (e) => {
      e.stopPropagation();
      const carte = cartesDuGroupe.find((c) => c.id === zone.dataset.persoPhotoVerso);
      if (!carte) return;
      const photos    = getCachedDocPhotos(appState?.chauffeurId || "");
      const photoData = photos[`${carte.id}-verso`] || null;
      if (photoData?.url) {
        _ouvrirVisionneureCartePerso(carte, photoData, "verso");
      } else {
        _ouvrirPhotoPickerCartePerso(carte, "verso");
      }
    });
  });

  // Zone droite → édition
  container.querySelectorAll("[data-perso-edit]").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-perso-code-toggle]")) return;
      const carte = cartesDuGroupe.find((c) => c.id === el.dataset.persoEdit);
      if (carte) openCartePersoEditModal(carte);
    });
  });

  // Toggle code
  container.querySelectorAll("[data-perso-code-toggle]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      codeVisibility[btn.dataset.persoCodeToggle] = !codeVisibility[btn.dataset.persoCodeToggle];
      appState.render();
    });
  });
}

// ─── Sélecteur photo cartes perso (caméra / galerie) ─────────────────────
function _ouvrirPhotoPickerCartePerso(carte, face = "recto") {
  const slug  = face === "verso" ? `${carte.id}-verso` : carte.id;
  const label = face === "verso" ? `${carte.label} (verso)` : carte.label;

  // Inputs persistants — jamais clonés (Android/Chrome)
  let inputCamera = document.getElementById("perso-input-camera");
  let inputGallery = document.getElementById("perso-input-gallery");

  if (!inputCamera) {
    inputCamera = document.createElement("input");
    inputCamera.type    = "file";
    inputCamera.accept  = "image/*";
    inputCamera.capture = "environment";
    inputCamera.id      = "perso-input-camera";
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
    inputGallery.id     = "perso-input-gallery";
    inputGallery.style.display = "none";
    document.body.appendChild(inputGallery);
    inputGallery.addEventListener("change", async () => {
      const file = inputGallery.files[0];
      inputGallery.value = "";
      if (file && inputGallery._cb) await inputGallery._cb(file);
    });
  }

  const handleFile = async (file) => {
    closeSheet();
    const entrepriseId = appState.chauffeur?.entreprise_id || "";
    const chauffeurId  = appState.chauffeurId || "";
    if (!entrepriseId || !chauffeurId) { showToast("⚠️ Session invalide"); return; }
    try {
      showToast("📤 Upload en cours…");
      await uploadDocPhoto(entrepriseId, chauffeurId, slug, label, file, "chauffeur", chauffeurId);
      showToast("✅ Photo enregistrée !");
      await fetchDocPhotos(chauffeurId).catch(() => {});
      if (appState.render) appState.render();
    } catch (err) {
      showToast("❌ " + (err.message || "Erreur upload"));
    }
  };

  inputCamera._cb  = handleFile;
  inputGallery._cb = handleFile;

  // Bottom sheet
  let sheet = document.getElementById("perso-source-sheet");
  if (!sheet) {
    sheet = document.createElement("div");
    sheet.id = "perso-source-sheet";
    sheet.className = "scanner-source-sheet";
    sheet.innerHTML = `
      <div class="scanner-source-backdrop"></div>
      <div class="scanner-source-box">
        <div class="scanner-source-handle"></div>
        <div class="scanner-source-title">Ajouter une photo</div>
        <button class="scanner-source-btn" id="perso-btn-camera">
          <span class="scanner-source-icon">📷</span>
          <div>
            <div class="scanner-source-label">Prendre une photo</div>
            <div class="scanner-source-sub">Ouvrir la caméra</div>
          </div>
        </button>
        <button class="scanner-source-btn" id="perso-btn-gallery">
          <span class="scanner-source-icon">🖼️</span>
          <div>
            <div class="scanner-source-label">Choisir dans la galerie</div>
            <div class="scanner-source-sub">Depuis vos photos existantes</div>
          </div>
        </button>
        <button class="scanner-source-btn scanner-source-btn--cancel" id="perso-btn-cancel">Annuler</button>
      </div>
    `;
    document.body.appendChild(sheet);
    sheet.querySelector(".scanner-source-backdrop").addEventListener("click", closeSheet);
    document.getElementById("perso-btn-cancel").addEventListener("click",  closeSheet);
    document.getElementById("perso-btn-camera").addEventListener("click",  () => inputCamera.click());
    document.getElementById("perso-btn-gallery").addEventListener("click", () => inputGallery.click());
  }

  function closeSheet() { sheet.classList.remove("is-open"); }
  sheet.classList.add("is-open");
}

function _ouvrirVisionneureCartePerso(carte, photoData, face = "recto") {
  const slug = face === "verso" ? `${carte.id}-verso` : carte.id;
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

  document.getElementById("doc-photo-viewer-title").textContent = face === "verso" ? `${carte.label} (verso)` : carte.label;
  document.getElementById("doc-photo-viewer-img").src           = photoData.url;

  const btnChange = document.getElementById("doc-photo-viewer-change");
  const freshChange = btnChange.cloneNode(true);
  btnChange.parentNode.replaceChild(freshChange, btnChange);
  freshChange.addEventListener("click", () => { overlay.classList.remove("is-open"); _ouvrirPhotoPickerCartePerso(carte, face); });

  const btnDelete = document.getElementById("doc-photo-viewer-delete");
  const freshDelete = btnDelete.cloneNode(true);
  btnDelete.parentNode.replaceChild(freshDelete, btnDelete);
  freshDelete.addEventListener("click", async () => {
    try {
      freshDelete.disabled = true; freshDelete.textContent = "…";
      const entrepriseId = appState.chauffeur?.entreprise_id || "";
      const chauffeurId  = appState.chauffeurId || "";
      await deleteDocPhoto(entrepriseId, chauffeurId, slug, "chauffeur");
      overlay.classList.remove("is-open");
      showToast("🗑️ Photo supprimée");
      await fetchDocPhotos(chauffeurId).catch(() => {});
      if (appState.render) appState.render();
    } catch (err) {
      showToast("❌ " + (err.message || "Erreur suppression"));
      freshDelete.disabled = false; freshDelete.textContent = "🗑️ Supprimer";
    }
  });

  overlay.classList.add("is-open");
}

// ─── Modale édition ──────────────────────────────────────────────────────
function openCartePersoEditModal(carte) {
  showModal({
    title: `Modifier — ${escapeHtml(carte.label)}`,
    bodyHTML: `
      <div class="modal-field">
        <label>Nom de la carte</label>
        <input type="text" id="modal-perso-label" value="${escapeHtml(carte.label)}" />
      </div>
      <label style="display:flex; align-items:center; gap:8px; margin:0 0 12px 0; cursor:pointer;">
        <input type="checkbox" id="modal-perso-adate" ${carte.aDate ? "checked" : ""} />
        <span style="font-size:13px; color:var(--color-text-primary);">Comporte une date limite</span>
      </label>
      <div class="modal-field ${carte.aDate ? "" : "hidden"}" id="modal-perso-date-field">
        <label>Date</label>
        <input type="date" id="modal-perso-date" value="${carte.dateValeur || ""}" />
        <div class="hint">Laisse vide pour réinitialiser</div>
      </div>
      <label style="display:flex; align-items:center; gap:8px; margin:0 0 12px 0; cursor:pointer;">
        <input type="checkbox" id="modal-perso-acode" ${carte.aCode ? "checked" : ""} />
        <span style="font-size:13px; color:var(--color-text-primary);">Comporte un code secret</span>
      </label>
      <div class="modal-field ${carte.aCode ? "" : "hidden"}" id="modal-perso-code-field">
        <label>Code</label>
        <input type="text" id="modal-perso-code" value="${escapeHtml(carte.codeValeur || "")}" />
      </div>
      <label style="display:flex; align-items:center; gap:8px; margin:0 0 12px 0; cursor:pointer;">
        <input type="checkbox" id="modal-perso-averso" ${carte.aVerso ? "checked" : ""} />
        <span style="font-size:13px; color:var(--color-text-primary);">Photo recto/verso (carte d'identité, permis…)</span>
      </label>
      <button type="button" id="modal-perso-delete" class="modal-inline-danger-btn">
        🗑️ Supprimer cette carte
      </button>
    `,
    confirmLabel: "Enregistrer",
    onMount: (bodyEl, closeModal) => {
      const adateCheck = bodyEl.querySelector("#modal-perso-adate");
      const dateField  = bodyEl.querySelector("#modal-perso-date-field");
      adateCheck.addEventListener("change", () => dateField.classList.toggle("hidden", !adateCheck.checked));

      const acodeCheck = bodyEl.querySelector("#modal-perso-acode");
      const codeField  = bodyEl.querySelector("#modal-perso-code-field");
      acodeCheck.addEventListener("change", () => codeField.classList.toggle("hidden", !acodeCheck.checked));

      bodyEl.querySelector("#modal-perso-delete").addEventListener("click", () => {
        showConfirmDialog({
          title: "Supprimer cette carte ?",
          text: "Cette action est définitive et ne peut pas être annulée.",
          confirmLabel: "Supprimer",
          onConfirm: async () => {
            try {
              await dbDelete("cartes_perso", [{ col: "id", op: "eq", val: carte.id }]);
              await _refetchAndRender();
              showToast("🗑️ Supprimé");
              closeModal();
            } catch (e) {
              showToast(Utils.messageErreurSupabase(e));
            }
          }
        });
      });
    },
    onConfirm: async (bodyEl) => {
      const label     = bodyEl.querySelector("#modal-perso-label").value.trim();
      const aDate     = bodyEl.querySelector("#modal-perso-adate").checked;
      const dateInput = bodyEl.querySelector("#modal-perso-date").value;
      const aCode     = bodyEl.querySelector("#modal-perso-acode").checked;
      const codeInput = bodyEl.querySelector("#modal-perso-code").value;
      const aVerso    = bodyEl.querySelector("#modal-perso-averso").checked;

      if (!label) { showToast("⚠️ Le nom de la carte ne peut pas être vide"); return false; }

      let dateISO    = null;
      let aDateFinal = aDate;
      if (aDate) {
        if (!dateInput) {
          aDateFinal = false;
        } else {
          const { valeur, erreur } = Utils.validerDateISO(dateInput);
          if (erreur) { showToast("⚠️ " + erreur); return false; }
          dateISO = valeur;
        }
      }
      if (aCode && !codeInput.trim()) { showToast("⚠️ Renseigne un code ou décoche la case"); return false; }

      try {
        await dbUpdate("cartes_perso", {
          groupe:      carte.groupe,
          label,
          a_date:      aDateFinal,
          date_valeur: aDateFinal ? dateISO : null,
          a_code:      aCode,
          code_valeur: aCode ? codeInput.trim() : null,
          a_verso:     aVerso
        }, [{ col: "id", op: "eq", val: carte.id }]);
        await _refetchAndRender();
        return true;
      } catch (e) {
        showToast(Utils.messageErreurSupabase(e));
        return false;
      }
    }
  });
}

// ─── Modale création ─────────────────────────────────────────────────────
export function openCreerCarteModal() {
  const groupesExistants = Array.from(new Set([...GROUPES_FIXES, ...cartesPerso.map((c) => c.groupe)]));
  const optionsHTML = groupesExistants.map((g) =>
    `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`
  ).join("") + `<option value="${NOUVEAU_GROUPE}">+ Nouveau groupe</option>`;

  showModal({
    title: "Nouvelle carte",
    bodyHTML: `
      <div class="modal-field">
        <label>Groupe</label>
        <select class="field-select" id="modal-creer-groupe" style="width:100%;height:50px;background:var(--color-surface);border:1.5px solid var(--color-divider);border-radius:12px;padding:0 14px;color:var(--color-text-primary);font-size:14px;">
          ${optionsHTML}
        </select>
      </div>
      <div class="modal-field hidden" id="modal-creer-nouveau-groupe-field">
        <label>Nom du nouveau groupe</label>
        <input type="text" id="modal-creer-nouveau-groupe" placeholder="Ex: Remorque frigo" />
      </div>
      <div class="modal-field">
        <label>Nom de la carte</label>
        <input type="text" id="modal-creer-label" placeholder="Ex: Extincteur" />
      </div>
      <label style="display:flex; align-items:center; gap:8px; margin:0 0 12px 0; cursor:pointer;">
        <input type="checkbox" id="modal-creer-adate" />
        <span style="font-size:13px; color:var(--color-text-primary);">Comporte une date limite</span>
      </label>
      <div class="modal-field hidden" id="modal-creer-date-field">
        <label>Date</label>
        <input type="date" id="modal-creer-date" />
      </div>
      <label style="display:flex; align-items:center; gap:8px; margin:0 0 12px 0; cursor:pointer;">
        <input type="checkbox" id="modal-creer-acode" />
        <span style="font-size:13px; color:var(--color-text-primary);">Comporte un code secret</span>
      </label>
      <div class="modal-field hidden" id="modal-creer-code-field">
        <label>Code</label>
        <input type="text" id="modal-creer-code" />
      </div>
      <label style="display:flex; align-items:center; gap:8px; margin:0 0 12px 0; cursor:pointer;">
        <input type="checkbox" id="modal-creer-averso" />
        <span style="font-size:13px; color:var(--color-text-primary);">Photo recto/verso (carte d'identité, permis…)</span>
      </label>
    `,
    confirmLabel: "Créer",
    onMount: (bodyEl) => {
      const groupeSelect = bodyEl.querySelector("#modal-creer-groupe");
      const nouveauField = bodyEl.querySelector("#modal-creer-nouveau-groupe-field");
      groupeSelect.addEventListener("change", () => {
        nouveauField.classList.toggle("hidden", groupeSelect.value !== NOUVEAU_GROUPE);
      });
      const adateCheck = bodyEl.querySelector("#modal-creer-adate");
      const dateField  = bodyEl.querySelector("#modal-creer-date-field");
      adateCheck.addEventListener("change", () => dateField.classList.toggle("hidden", !adateCheck.checked));
      const acodeCheck = bodyEl.querySelector("#modal-creer-acode");
      const codeField  = bodyEl.querySelector("#modal-creer-code-field");
      acodeCheck.addEventListener("change", () => codeField.classList.toggle("hidden", !acodeCheck.checked));
    },
    onConfirm: async (bodyEl) => {
      const groupeSelectValue = bodyEl.querySelector("#modal-creer-groupe").value;
      const nouveauGroupe     = bodyEl.querySelector("#modal-creer-nouveau-groupe").value.trim();
      const groupeFinal       = groupeSelectValue === NOUVEAU_GROUPE ? nouveauGroupe : groupeSelectValue;
      const label             = bodyEl.querySelector("#modal-creer-label").value.trim();
      const aDate             = bodyEl.querySelector("#modal-creer-adate").checked;
      const dateInput         = bodyEl.querySelector("#modal-creer-date").value;
      const aCode             = bodyEl.querySelector("#modal-creer-acode").checked;
      const codeInput         = bodyEl.querySelector("#modal-creer-code").value;
      const aVerso            = bodyEl.querySelector("#modal-creer-averso").checked;

      if (!groupeFinal) { showToast("⚠️ Renseigne un nom de groupe"); return false; }
      if (!label)       { showToast("⚠️ Renseigne un nom de carte");  return false; }

      let dateISO    = null;
      let aDateFinal = aDate;
      if (aDate) {
        if (!dateInput) {
          aDateFinal = false;
        } else {
          const { valeur, erreur } = Utils.validerDateISO(dateInput);
          if (erreur) { showToast("⚠️ " + erreur); return false; }
          dateISO = valeur;
        }
      }
      if (aCode && !codeInput.trim()) { showToast("⚠️ Renseigne un code ou décoche la case"); return false; }

      // Si groupe "Véhicules" → lier au véhicule actif du chauffeur
      let entiteType  = null;
      let entitePlaque = null;
      if (groupeFinal === "Véhicules") {
        if (appState.typeVehiculeActif === "engin" && appState.enginActif?.id) {
          entiteType   = "engin";
          entitePlaque = appState.enginActif.id;
        } else if (appState.plaqueT) {
          entiteType   = "tracteur";
          entitePlaque = appState.plaqueT;
        }
      }

      try {
        await dbInsertMinimal("cartes_perso", {
          entreprise_id: appState.chauffeur?.entreprise_id || "",
          chauffeur_id:  appState.chauffeurId,
          groupe:        groupeFinal,
          label,
          a_date:        aDateFinal,
          date_valeur:   aDateFinal ? dateISO : null,
          a_code:        aCode,
          code_valeur:   aCode ? codeInput.trim() : null,
          a_verso:       aVerso,
          entite_type:   entiteType   || null,
          entite_plaque: entitePlaque || null
        });
        await _refetchAndRender();
        showToast("✅ Carte créée !");
        return true;
      } catch (e) {
        showToast(Utils.messageErreurSupabase(e));
        return false;
      }
    }
  });
}

// ─── Groupes dynamiques (hors groupes fixes) ─────────────────────────────
export function renderCustomGroupsSection() {
  const container = document.getElementById("cartes-perso-groupes");
  if (!container) return;

  const groupesFixesSet = new Set(GROUPES_FIXES);
  const groupes = {};
  cartesPerso.forEach((c) => {
    if (groupesFixesSet.has(c.groupe)) return;
    if (!groupes[c.groupe]) groupes[c.groupe] = [];
    groupes[c.groupe].push(c);
  });

  const groupeNames = Object.keys(groupes);
  if (groupeNames.length === 0) { container.innerHTML = ""; return; }

  container.innerHTML = groupeNames
    .map((groupe) => renderCustomGroupHTML(groupe, groupes[groupe]))
    .join('<div style="height:16px"></div>');

  container.querySelectorAll("[data-perso-groupe]").forEach((groupEl) => {
    const groupe = groupEl.dataset.persoGroupe;
    const cartes = groupes[groupe] || [];

    groupEl.querySelector("[data-perso-groupe-toggle]").addEventListener("click", () => {
      openGroupsPerso[groupe] = !openGroupsPerso[groupe];
      appState.render();
    });

    attachCartePersoListeners(groupEl, cartes);

    const deleteBtn = groupEl.querySelector("[data-perso-groupe-delete]");
    if (deleteBtn) {
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        showConfirmDialog({
          title: `Supprimer le groupe "${groupe}" ?`,
          text: `Toutes les cartes de ce groupe (${cartes.length}) seront supprimées définitivement.`,
          confirmLabel: "Supprimer",
          onConfirm: async () => {
            try {
              await Promise.all(cartes.map((c) =>
                dbDelete("cartes_perso", [{ col: "id", op: "eq", val: c.id }])
              ));
              await _refetchAndRender();
              showToast("🗑️ Groupe supprimé");
            } catch (err) {
              showToast(Utils.messageErreurSupabase(err));
            }
          }
        });
      });
    }
  });
}

function renderCustomGroupHTML(groupe, cartes) {
  const isOpen = !!openGroupsPerso[groupe];

  let pireCouleur = "var(--color-text-secondary)";
  let pireRang    = -2;
  cartes.forEach((c) => {
    if (!c.aDate) return;
    const rang = Utils.rangStatut(c.dateValeur);
    if (rang > pireRang) { pireRang = rang; pireCouleur = Utils.getStatusColorStatic(c.dateValeur); }
  });

  return `
    <div class="group-card ${isOpen ? "is-open" : ""}" data-perso-groupe="${escapeHtml(groupe)}" style="border-color:${isOpen ? "var(--color-accent)" : pireCouleur + "99"};">
      <div class="group-card-bar" style="background:${pireCouleur};"></div>
      <div class="group-card-body">
        <div class="group-card-header" data-perso-groupe-toggle="1">
          <div class="group-card-header-left">
            <span class="emoji">📁</span>
            <div>
              <div class="group-card-title">${escapeHtml(groupe)}</div>
              <div class="group-card-subtitle">${cartes.length} carte(s) perso</div>
            </div>
          </div>
          <div class="group-card-header-right">
            <div class="status-dot" style="background:${pireCouleur};"></div>
            <span class="chevron ${isOpen ? "rotated" : ""}">⌄</span>
          </div>
        </div>
        <div class="group-card-content ${isOpen ? "expanded" : ""}">
          <div class="group-card-divider"></div>
          ${cartes.map((c) => renderCartePersoItemHTML(c)).join("")}
          <button type="button" data-perso-groupe-delete="1" class="modal-inline-danger-btn" style="margin-top:4px;">
            🗑️ Supprimer ce groupe
          </button>
        </div>
      </div>
    </div>
  `;
}

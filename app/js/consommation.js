// ════════════════════════════════════════════════════════════════════════
// MémoTruck — Suivi Consommation
// Rewired Supabase — plus aucune référence Firebase
// ════════════════════════════════════════════════════════════════════════

import { dbSelect, dbInsert, dbUpdate, dbDelete, dateToISO } from "./supabase-client.js";
import { invalidateConsoMoisCache, invalidateConsoEntriesForPneus } from "./dashboard-cards.js";
import * as Utils from "./utils.js";
import { showToast, showModal, showConfirmDialog, navigateTo, escapeHtml } from "./ui-helpers.js";
import { enqueueSync, isOnline } from "./offline.js";

let appState = null;
export function setAppStateConso(state) { appState = state; }

let allEntries   = [];
let editingId    = null;  // UUID de la ligne en cours d'édition
const openMonths = {};

export function setupConsommationScreenLogic() {
  document.getElementById("btn-fab-conso").addEventListener("click", () => openConsoModal(null));
  document.getElementById("btn-fab-pas-roule").addEventListener("click", () => openSansSaisieModal());
}

// Ouvre le formulaire de saisie conso avec une date pré-remplie (ex: relance
// "j'ai oublié" à la prise de service). onClose est appelé une fois la
// modale refermée, saisie enregistrée ou non.
export function openConsoModalPourDate(date, onClose) {
  openConsoModal(null, { presetDate: date, onClose });
}

export function openConsommationScreen() {
  navigateTo("screen-consommation");
  loadConsommation();
}

// ─── Chargement REST (pas de realtime ici, rechargé à chaque ouverture) ─
async function loadConsommation() {
  const container = document.getElementById("consommation-list");
  container.innerHTML = `<div class="empty-state"><span class="icon">⛽</span><div class="main-text">Chargement…</div></div>`;

  try {
    const rows = await dbSelect("consommations", {
      select: "id,date,kilometres,litres,valeur,chauffeur_id,plaque_remorque,statut,note",
      filters: [
        { col: "plaque_tracteur", op: "eq", val: appState.plaqueT }
      ],
      order:   { col: "date", asc: false }
    });

    // Récupère les noms des chauffeurs pour les afficher sur les cartes
    const chauffeurIds = [...new Set((rows||[]).map(r => r.chauffeur_id).filter(Boolean))];
    let chauffeursMap = {};
    if (chauffeurIds.length > 0) {
      const chRows = await dbSelect("chauffeurs", {
        select: "id,prenom,nom",
        filters: [{ col: "entreprise_id", op: "eq", val: appState.chauffeur?.entreprise_id || "" }]
      });
      (chRows||[]).forEach(c => { chauffeursMap[c.id] = `${c.prenom || ""} ${c.nom || ""}`.trim(); });
    }

    allEntries = (rows || []).map((r) => ({
      docId:        r.id,
      date:         r.date,
      litres:       r.litres     || 0,
      km:           r.kilometres || 0,
      valeur:       r.valeur     || 0,
      chauffeurId:  r.chauffeur_id || null,
      chauffeurNom: r.chauffeur_id && chauffeursMap[r.chauffeur_id] ? chauffeursMap[r.chauffeur_id] : null,
      plaqueRemorque: r.plaque_remorque || null,
      statut:       r.statut || null,   // null = saisie normale · "pas_roule" · "oubli"
      note:         r.note   || null
    }));

    renderConsommationList();
  } catch (e) {
    showToast("📡 Impossible de charger la consommation");
  }
}

function renderConsommationList() {
  const container = document.getElementById("consommation-list");

  if (allEntries.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="icon">⛽</span>
        <div class="main-text">Aucune saisie pour le moment</div>
        <div class="sub-text">Appuie sur + pour ajouter ta conso du jour</div>
      </div>
    `;
    return;
  }

  const moisActuelCle = Utils.moisCleDeDate(new Date());

  // Groupement par mois
  const grouped = {};
  allEntries.forEach((entry) => {
    const cle = Utils.moisCleDeDate(entry.date);
    if (!grouped[cle]) grouped[cle] = [];
    grouped[cle].push(entry);
  });

  const sortedKeys = Object.keys(grouped).sort().reverse();

  let html = "";
  sortedKeys.forEach((cle) => {
    const entries = grouped[cle];
    if (cle === moisActuelCle) {
      html += `<div style="font-size:12px; font-weight:900; color:var(--color-accent); letter-spacing:1px; margin:6px 0;">${Utils.moisLabelDeCle(cle)} (en cours)</div>`;
      entries.forEach((entry) => { html += renderConsoDetailCardHTML(entry); });
    } else {
      html += renderMoisGroupeCardHTML(cle, entries);
    }
  });

  container.innerHTML = html;
  attachConsoListeners(container);
}

// Libellés d'affichage pour les jours sans vraie saisie.
const _STATUT_LABELS = {
  pas_roule: { icone: "🚫", texte: "Camion pas sorti" },
  oubli:     { icone: "🕓", texte: "Oubli signalé — pas de saisie" }
};

// Bandeau couleur + badge — vert/bleu accent/rouge du thème actif, cohérent
// avec le code couleur déjà utilisé ailleurs dans l'appli (jauge pneus).
const _STATUT_META = {
  "":         { classe: "statut-saisie",   badge: "Saisie" },
  pas_roule:  { classe: "statut-pasroule", badge: "Pas roulé" },
  oubli:      { classe: "statut-oubli",    badge: "Oubli" }
};
function _statutMeta(statut) { return _STATUT_META[statut || ""]; }

function renderConsoDetailCardHTML(entry) {
  const statutInfo = entry.statut ? _STATUT_LABELS[entry.statut] : null;
  const meta       = _statutMeta(entry.statut);
  const iconeBox = `<div style="width:40px; height:40px; border-radius:10px; background:${statutInfo ? "rgba(120,144,156,0.15)" : "rgba(255,167,38,0.15)"}; display:flex; align-items:center; justify-content:center; font-size:18px; flex-shrink:0;">${statutInfo ? statutInfo.icone : "⛽"}</div>`;
  // Le badge (PAS ROULÉ / OUBLI) porte déjà l'information de statut — pas
  // besoin de la répéter en texte ; seul le motif facultatif apporte une
  // vraie info supplémentaire.
  const detailLine = statutInfo
    ? (entry.note ? `<div style="font-size:11px; color:var(--color-text-secondary); margin-top:2px; font-style:italic;">"${escapeHtml(entry.note)}"</div>` : "")
    : `<div style="font-size:12px; color:var(--color-text-secondary);">${Utils.formatDecimal(entry.valeur)} L/100 · ${Utils.formatMilliers(entry.km)} km · ${Utils.formatDecimal(entry.litres)} L</div>`;

  return `
    <div class="item-card ${meta.classe}" data-conso-card="${entry.docId}">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div style="display:flex; align-items:center; gap:12px; flex:1; min-width:0;">
          ${iconeBox}
          <div style="min-width:0;">
            <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
              <div style="font-weight:600; font-size:13px; color:var(--color-text-primary);">${escapeHtml(Utils.formatDateLongFR(entry.date))}</div>
              <span class="conso-statut-badge ${meta.classe}">${meta.badge}</span>
            </div>
            ${detailLine}
            ${entry.chauffeurNom ? `<div style="font-size:11px; color:var(--color-text-secondary); margin-top:2px;">👤 ${escapeHtml(entry.chauffeurNom)}</div>` : ""}
            ${entry.plaqueRemorque ? `<div style="font-size:11px; color:var(--color-text-secondary); margin-top:1px;">🚛 ${escapeHtml(entry.plaqueRemorque)}</div>` : ""}
          </div>
        </div>
        <div style="display:flex; gap:4px;">
          ${(!entry.chauffeurId || entry.chauffeurId === appState.chauffeurId) ? `
          <button class="icon-btn-small" data-conso-edit="${entry.docId}">✏️</button>
          <button class="icon-btn-small" data-conso-delete="${entry.docId}" style="color:var(--color-danger);">🗑️</button>
          ` : ""}
        </div>
      </div>
    </div>
  `;
}

function renderMoisGroupeCardHTML(cle, entries) {
  const isOpen  = !!openMonths[cle];
  // Les jours "pas roulé"/"oubli" n'ont pas de vraie donnée de conso (0 par
  // construction) : ils ne doivent pas fausser la moyenne L/100 ni les
  // totaux, mais restent comptés/affichés dans la liste du mois.
  const entriesSaisies = entries.filter((e) => !e.statut);
  const nbSansSaisie    = entries.length - entriesSaisies.length;
  const moyenne    = entriesSaisies.length ? entriesSaisies.reduce((a, e) => a + e.valeur, 0) / entriesSaisies.length : 0;
  const totalKm    = entriesSaisies.reduce((a, e) => a + e.km,     0);
  const totalLitres = entriesSaisies.reduce((a, e) => a + e.litres, 0);

  const detailRows = isOpen
    ? entries.slice().sort((a, b) => {
        const da = Utils.toDate(a.date); const db_ = Utils.toDate(b.date);
        return (db_ || 0) - (da || 0);
      }).map((entry) => {
        const statutInfo = entry.statut ? _STATUT_LABELS[entry.statut] : null;
        const meta       = _statutMeta(entry.statut);
        // Le badge porte déjà l'info de statut — seul le motif facultatif
        // apporte une vraie info supplémentaire pour un jour sans saisie.
        const detailTxt = statutInfo
          ? (entry.note ? `${statutInfo.icone} "${escapeHtml(entry.note)}"` : "")
          : `${Utils.formatDecimal(entry.valeur)} L/100 · ${Utils.formatMilliers(entry.km)} km · ${Utils.formatDecimal(entry.litres)} L`;
        return `
        <div class="mois-entry-row ${meta.classe}">
          <div>
            <div style="display:flex; align-items:center; gap:6px;">
              <div class="mois-entry-date">${escapeHtml(Utils.formatDateLongFR(entry.date))}</div>
              <span class="conso-statut-badge ${meta.classe}">${meta.badge}</span>
            </div>
            ${detailTxt ? `<div class="mois-entry-detail" style="margin-top:2px;">${detailTxt}</div>` : ""}
            ${entry.chauffeurNom ? `<div style="font-size:11px; color:var(--color-text-secondary); margin-top:2px;">👤 ${escapeHtml(entry.chauffeurNom)}</div>` : ""}
            ${entry.plaqueRemorque ? `<div style="font-size:11px; color:var(--color-text-secondary); margin-top:1px;">🚛 ${escapeHtml(entry.plaqueRemorque)}</div>` : ""}
          </div>
          <div style="display:flex; gap:4px;">
            ${(!entry.chauffeurId || entry.chauffeurId === appState.chauffeurId) ? `
            <button class="icon-btn-small" data-conso-edit="${entry.docId}" style="width:30px;height:30px;">✏️</button>
            <button class="icon-btn-small" data-conso-delete="${entry.docId}" style="width:30px;height:30px; color:var(--color-danger);">🗑️</button>
            ` : ""}
          </div>
        </div>
      `;
      }).join("")
    : "";

  const theme     = document.documentElement.getAttribute("data-theme") || "nuit";
  const isPremium = theme === "aurora" || theme === "obsidian";
  const isAurora  = theme === "aurora";
  const glowLine  = isPremium ? `
    <div style="position:absolute;top:0;left:8%;right:8%;height:1px;
      background:linear-gradient(90deg,transparent,${isAurora ? "rgba(168,216,255,0.9),rgba(127,255,207,0.7)" : "rgba(41,121,255,0.9),rgba(6,182,212,0.7)"},transparent);
      pointer-events:none;z-index:2;"></div>` : "";

  return `
    <div class="mois-group-card ${isOpen ? "is-open" : ""}" data-mois-toggle="${cle}" style="position:relative;overflow:hidden;">
      ${glowLine}
      <div class="mois-group-header">
        <div style="display:flex; align-items:center; flex:1; min-width:0;">
          <div class="mois-group-icon-box">📅</div>
          <div class="mois-group-info">
            <div class="mois-group-title">${Utils.moisLabelDeCle(cle)}</div>
            <div class="mois-group-sub">${Utils.formatDecimal(moyenne)} L/100 moy. · ${entriesSaisies.length} jour(s) saisis · ${Utils.formatMilliers(totalKm)} km${nbSansSaisie ? ` · ${nbSansSaisie} sans sortie/oubli` : ""}</div>
          </div>
        </div>
        <span class="chevron ${isOpen ? "rotated" : ""}">⌄</span>
      </div>
      <div class="mois-group-content ${isOpen ? "expanded" : ""}">
        <div class="group-card-divider"></div>
        <div style="font-size:12px; font-weight:600; color:var(--color-text-primary); margin-bottom:8px;">
          Total : ${Utils.formatDecimal(totalLitres)} L consommés sur ${Utils.formatMilliers(totalKm)} km
        </div>
        ${detailRows}
      </div>
    </div>
  `;
}

function attachConsoListeners(container) {
  container.querySelectorAll("[data-mois-toggle]").forEach((el) => {
    el.querySelector(".mois-group-header").addEventListener("click", () => {
      const cle = el.dataset.moisToggle;
      openMonths[cle] = !openMonths[cle];
      renderConsommationList();
    });
  });

  container.querySelectorAll("[data-conso-edit]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const entry = allEntries.find((en) => en.docId === btn.dataset.consoEdit);
      // Quel que soit le type de jour (saisie normale, pas roulé, oubli),
      // la carte reste modifiable dans tous les sens via un seul et même
      // formulaire — y compris pour requalifier un jour d'un type à l'autre.
      if (entry) openConsoModal(entry);
    });
  });

  container.querySelectorAll("[data-conso-delete]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.consoDelete;
      showConfirmDialog({
        title: "Supprimer cette saisie ?",
        text: "Cette action est définitive et ne peut pas être annulée.",
        confirmLabel: "Supprimer",
        onConfirm: async () => {
          try {
            await dbDelete("consommations", [{ col: "id", op: "eq", val: id }]);
            allEntries = allEntries.filter((e) => e.docId !== id);
            invalidateConsoMoisCache();
            invalidateConsoEntriesForPneus();
            renderConsommationList();
            if (appState.render) appState.render();
            showToast("🗑️ Supprimé");
          } catch (err) {
            showToast(Utils.messageErreurSupabase(err));
          }
        }
      });
    });
  });
}

// ─── Jour sans vraie saisie : "pas roulé" (déclaré) ou "oubli" (relance
// zappée) ───────────────────────────────────────────────────────────────
// Garde une trace en base plutôt qu'un simple flag local, pour que l'export
// explique toujours pourquoi un jour donné n'a pas de conso. Utilisé par le
// bouton manuel de cet écran ET par la relance de prise de service (app.js).
export async function enregistrerJourSansSaisie(dateISO, statut, note = null) {
  const payload = {
    date:            dateISO,
    kilometres:      0,
    litres:          0,
    valeur:          0,
    statut,
    note:            note || null,
    plaque_tracteur: appState.plaqueT,
    plaque_remorque: appState.plaqueR || null,
    entreprise_id:   appState.chauffeur?.entreprise_id || "",
    chauffeur_id:    appState.chauffeurId || null
  };

  let docId;
  if (isOnline()) {
    const inserted = await dbInsert("consommations", payload);
    docId = inserted && inserted[0] && inserted[0].id;
  } else {
    await enqueueSync("consommation_insert", payload);
    docId = `offline_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  allEntries.push({
    docId, date: dateISO, litres: 0, km: 0, valeur: 0,
    chauffeurId: appState.chauffeurId || null, chauffeurNom: null,
    plaqueRemorque: payload.plaque_remorque || null,
    statut, note: payload.note
  });
  allEntries.sort((a, b) => (Utils.toDate(b.date) || 0) - (Utils.toDate(a.date) || 0));
  invalidateConsoMoisCache();
  invalidateConsoEntriesForPneus();
}

// Création uniquement (bouton "Pas roulé" de l'écran) — l'édition d'un jour
// déjà enregistré, quel que soit son type, passe par openConsoModal ci-
// dessous, qui permet aussi de le requalifier en saisie normale.
function openSansSaisieModal() {
  const todayISO = dateToISO(new Date());

  showModal({
    title: "Camion pas sorti",
    bodyHTML: `
      <div class="modal-text">Enregistre ce jour comme un jour sans sortie, pour que l'export explique l'absence de conso (congés, repos, camion en révision…).</div>
      <div class="modal-field">
        <label>Date</label>
        <input type="date" id="modal-sr-date" value="${todayISO}" max="${todayISO}" />
      </div>
      <div class="modal-field">
        <label>Motif (facultatif)</label>
        <input type="text" id="modal-sr-note" value="" placeholder="ex : congés, en entretien…" maxlength="120" />
      </div>
    `,
    confirmLabel: "Confirmer",
    onConfirm: async (bodyEl) => {
      const note = bodyEl.querySelector("#modal-sr-note").value.trim() || null;
      try {
        const dateInput = bodyEl.querySelector("#modal-sr-date").value;
        const { valeur: dateISO, erreur } = Utils.validerDateISO(dateInput);
        if (erreur) { showToast("⚠️ " + erreur); return false; }
        if (allEntries.some((e) => e.date === dateISO)) {
          showToast("⚠️ Une saisie existe déjà ce jour-là — modifie-la depuis la liste.");
          return false;
        }
        await enregistrerJourSansSaisie(dateISO, "pas_roule", note);
        renderConsommationList();
        showToast("✅ Enregistré");
        return true;
      } catch (e) {
        showToast(Utils.messageErreurSupabase(e));
        return false;
      }
    }
  });
}

const _STATUT_TOGGLE_OPTIONS = [
  { val: "",          label: "⛽ Saisie" },
  { val: "pas_roule", label: "🚫 Pas roulé" },
  { val: "oubli",     label: "🕓 Oubli" }
];

function openConsoModal(entry, options = {}) {
  editingId       = entry ? entry.docId : null;
  const isEdition = !!entry;
  const presetDate = options.presetDate || null;
  // En édition, la carte reste requalifiable dans les deux sens : une
  // saisie normale peut être repassée en "pas roulé"/"oubli" et
  // inversement. En création, seul le formulaire de saisie normale passe
  // par cette modale (le bouton "Pas roulé" a son propre flux dédié).
  let statutCourant = isEdition ? (entry.statut || "") : "";

  showModal({
    title: isEdition ? "Modifier ce jour" : "Conso du jour",
    onClose: options.onClose,
    bodyHTML: `
      ${isEdition ? `
      <div class="modal-field">
        <label>Type de jour</label>
        <div class="statut-toggle-group" id="modal-conso-statut-group">
          ${_STATUT_TOGGLE_OPTIONS.map((o) => `<button type="button" class="statut-toggle-btn ${statutCourant === o.val ? "active" : ""}" data-statut-val="${o.val}">${o.label}</button>`).join("")}
        </div>
      </div>` : `<div class="modal-text">Saisis les chiffres affichés sur l'écran de bord</div>`}
      <div class="modal-field">
        <label>Date</label>
        <input type="date" id="modal-conso-date" value="${isEdition ? entry.date : dateToISO(presetDate || new Date())}" />
      </div>
      <div id="modal-conso-champs-saisie" class="${statutCourant !== "" ? "hidden" : ""}">
        <div class="modal-field">
          <label>Kilomètres du jour</label>
          <input type="text" id="modal-conso-km" value="${isEdition && !entry.statut ? entry.km : ""}" inputmode="decimal" />
        </div>
        <div class="modal-field">
          <label>Moyenne L/100km (ex: 36.8)</label>
          <input type="text" id="modal-conso-valeur" value="${isEdition && !entry.statut ? entry.valeur : ""}" inputmode="decimal" />
        </div>
        <div class="modal-preview hidden" id="modal-conso-preview"></div>
      </div>
      <div class="modal-field ${statutCourant === "" ? "hidden" : ""}" id="modal-conso-note-field">
        <label>Motif (facultatif)</label>
        <input type="text" id="modal-conso-note" value="${isEdition ? escapeHtml(entry.note || "") : ""}" placeholder="ex : congés, en entretien…" maxlength="120" />
      </div>
    `,
    confirmLabel: "Enregistrer",
    onMount: (bodyEl) => {
      const kmInput      = bodyEl.querySelector("#modal-conso-km");
      const valeurInput  = bodyEl.querySelector("#modal-conso-valeur");
      const preview      = bodyEl.querySelector("#modal-conso-preview");
      const champsSaisie = bodyEl.querySelector("#modal-conso-champs-saisie");
      const champNote    = bodyEl.querySelector("#modal-conso-note-field");

      function updatePreview() {
        const km     = parseFloat(kmInput.value.replace(",", "."));
        const valeur = parseFloat(valeurInput.value.replace(",", "."));
        if (km > 0 && valeur > 0) {
          const litres = (km * valeur) / 100;
          preview.textContent = `⛽ ≈ ${Utils.formatDecimal(litres)} L consommés (calculé automatiquement)`;
          preview.classList.remove("hidden");
        } else {
          preview.classList.add("hidden");
        }
      }
      kmInput.addEventListener("input", updatePreview);
      valeurInput.addEventListener("input", updatePreview);
      updatePreview();

      const groupeStatut = bodyEl.querySelector("#modal-conso-statut-group");
      if (groupeStatut) {
        groupeStatut.querySelectorAll("[data-statut-val]").forEach((btn) => {
          btn.addEventListener("click", () => {
            statutCourant = btn.dataset.statutVal;
            groupeStatut.querySelectorAll("[data-statut-val]").forEach((b) => b.classList.toggle("active", b === btn));
            const estSaisie = statutCourant === "";
            champsSaisie.classList.toggle("hidden", !estSaisie);
            champNote.classList.toggle("hidden", estSaisie);
          });
        });
      }
    },
    onConfirm: async (bodyEl) => {
      const dateInput = bodyEl.querySelector("#modal-conso-date").value;
      const { valeur: dateISO, erreur: erreurDate } = Utils.validerDateISO(dateInput);
      if (erreurDate) { showToast("⚠️ " + erreurDate); return false; }

      let km, valeur, litres, note = null;
      if (statutCourant === "") {
        const kmInput     = bodyEl.querySelector("#modal-conso-km").value;
        const valeurInput = bodyEl.querySelector("#modal-conso-valeur").value;
        const { valeur: kmVal,     erreur: erreurKm }     = Utils.validerKilometres(kmInput);
        const { valeur: valeurVal, erreur: erreurValeur } = Utils.validerMoyenneConso(valeurInput);
        const erreur = erreurKm || erreurValeur;
        if (erreur) { showToast("⚠️ " + erreur); return false; }
        km = kmVal; valeur = valeurVal; litres = (km * valeur) / 100;
      } else {
        km = 0; valeur = 0; litres = 0;
        note = bodyEl.querySelector("#modal-conso-note").value.trim() || null;
      }

      const payload = {
        date:           dateISO,
        litres,
        kilometres:     km,
        valeur,
        statut:         statutCourant || null,
        note,
        plaque_tracteur: appState.plaqueT,
        plaque_remorque: appState.plaqueR || null,
        entreprise_id:  appState.chauffeur?.entreprise_id || "",
        chauffeur_id:   appState.chauffeurId || null
      };

      try {
        if (isEdition) {
          if (isOnline()) {
            await dbUpdate("consommations", payload, [{ col: "id", op: "eq", val: editingId }]);
            showToast("✅ Modifié !");
          } else {
            await enqueueSync("consommation_update", { id: editingId, data: payload });
            showToast("📵 Modifié localement — sync au retour réseau");
          }
          const idx = allEntries.findIndex((e) => e.docId === editingId);
          if (idx >= 0) allEntries[idx] = {
            docId:          editingId,
            date:           payload.date,
            litres,
            km,
            valeur,
            statut:         payload.statut,
            note:           payload.note,
            chauffeurId:    allEntries[idx].chauffeurId,
            chauffeurNom:   allEntries[idx].chauffeurNom,
            plaqueRemorque: payload.plaque_remorque || allEntries[idx].plaqueRemorque || null
          };
          allEntries.sort((a, b) => (Utils.toDate(b.date) || 0) - (Utils.toDate(a.date) || 0));
        } else {
          if (isOnline()) {
            const inserted = await dbInsert("consommations", payload);
            const newRow   = inserted && inserted[0];
            if (newRow) {
              allEntries.push({
                docId:          newRow.id,
                date:           newRow.date,
                litres,
                km,
                valeur,
                statut:         payload.statut,
                note:           payload.note,
                chauffeurId:    appState.chauffeurId || null,
                chauffeurNom:   null,
                plaqueRemorque: payload.plaque_remorque || null
              });
              allEntries.sort((a, b) => (Utils.toDate(b.date) || 0) - (Utils.toDate(a.date) || 0));
            }
            showToast("✅ Conso enregistrée !");
          } else {
            await enqueueSync("consommation_insert", payload);
            allEntries.push({
              docId:          `offline_${Date.now()}`,
              date:           payload.date,
              litres,
              km,
              valeur,
              statut:         payload.statut,
              note:           payload.note,
              chauffeurId:    appState.chauffeurId || null,
              chauffeurNom:   null,
              plaqueRemorque: payload.plaque_remorque || null
            });
            allEntries.sort((a, b) => (Utils.toDate(b.date) || 0) - (Utils.toDate(a.date) || 0));
            showToast("📵 Saisie enregistrée localement — sync au retour réseau");
          }
        }
        invalidateConsoMoisCache();
        invalidateConsoEntriesForPneus();
        renderConsommationList();
        if (appState.render) appState.render();
        return true;
      } catch (e) {
        // isOnline() a pu répondre "en ligne" alors que la requête elle-même
        // échoue pour une raison réseau (coupure en cours de vol, timeout) :
        // on met quand même en file plutôt que de perdre la saisie, comme
        // pour la création d'intervention.
        if (!e.message || /fetch|network|failed/i.test(e.message)) {
          try {
            await enqueueSync(isEdition ? "consommation_update" : "consommation_insert", isEdition ? { id: editingId, data: payload } : payload);
            showToast("📵 Connexion instable — saisie enregistrée localement, sync au retour réseau");
            invalidateConsoMoisCache();
            invalidateConsoEntriesForPneus();
            renderConsommationList();
            if (appState.render) appState.render();
            return true;
          } catch (_) {}
        }
        showToast(Utils.messageErreurSupabase(e));
        return false;
      }
    }
  });
}

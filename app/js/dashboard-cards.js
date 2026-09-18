// ════════════════════════════════════════════════════════════════════════
// MémoTruck — Cartes spécifiques du dashboard
// Gazole / Pneus / Moyenne mensuelle conso
// Rewired Supabase — plus aucune référence Firebase
// ════════════════════════════════════════════════════════════════════════

import { dbSelect, dbUpdate, dateToISO } from "./supabase-client.js";
import * as Utils from "./utils.js";
import { showToast, showModal, showConfirmDialog, escapeHtml } from "./ui-helpers.js";
import { getCartesPersoForGroupe, renderCartePersoItemHTML, attachCartePersoListeners } from "./cartes-perso.js";

let appState = null;
const codeVisibility = {};
const openGroupCards  = {};

export function setAppState(state) { appState = state; }

// ─── Entrées conso pour calcul pneus ─────────────────────────────────────
let pneusListenerPlaque  = null;
let consoEntriesForPneus        = [];
let consoEntriesForPneusRemorque = []; // alias vers consoEntriesForPneus

export function getConsoEntriesForPneus() { return consoEntriesForPneus; }
export function getConsoEntriesForPneusRemorque() { return consoEntriesForPneusRemorque; }

// Force le rechargement des entrées conso utilisées par la jauge pneus au
// prochain renderCartePneus() — à appeler après l'ajout/modif/suppression
// d'une saisie de consommation, sinon le km affiché reste celui d'avant
// (rechargé seulement lors d'un changement de véhicule).
export function invalidateConsoEntriesForPneus() {
  pneusListenerPlaque = null;
}

// Cache du widget conso mensuel — évite le scintillement à chaque re-render
let _consoMoisCache    = null;  // { moyenne, nbSaisies, totalKm, totalLitres, moisLabel }
let _consoMoisMois     = null;  // mois en cours au moment du dernier fetch
let _consoMoisCallback = null;  // callback click mémorisé

export function invalidateConsoMoisCache() {
  _consoMoisCache = null;
}

// ════════════════════════════════════════════════════════════════════════
// CARTE GAZOLE
// ════════════════════════════════════════════════════════════════════════

export function renderCarteGazole() {
  const d         = appState.vehiculeData || {};
  const containerId = "carte-gazole";
  const container = document.getElementById(containerId);
  const isOpen    = !!openGroupCards[containerId];
  const cartesPersoGazole = getCartesPersoForGroupe("Cartes Gazole");

  let pireCouleur = "var(--color-text-secondary)";
  let pireRang    = -2;
  Utils.CARTES_GAZOLE.forEach((info) => {
    const rang = Utils.rangStatut(d[info.champDate]);
    if (rang > pireRang) { pireRang = rang; pireCouleur = Utils.getStatusColorStatic(d[info.champDate]); }
  });
  cartesPersoGazole.forEach((c) => {
    if (!c.aDate) return;
    const rang = Utils.rangStatut(c.dateValeur);
    if (rang > pireRang) { pireRang = rang; pireCouleur = Utils.getStatusColorStatic(c.dateValeur); }
  });

  const itemsHTML = Utils.CARTES_GAZOLE.map((info) => renderGazoleItemHTML(info, d)).join("")
    + cartesPersoGazole.map((c) => renderCartePersoItemHTML(c)).join("");

  container.innerHTML = `
    <div class="group-card ${isOpen ? "is-open" : ""}" style="border-color:${isOpen ? "var(--color-accent)" : pireCouleur + "99"};">
      <div class="group-card-bar" style="background:${pireCouleur};"></div>
      <div class="group-card-body">
        <div class="group-card-header" data-toggle-gazole="1">
          <div class="group-card-header-left">
            <span class="emoji">⛽</span>
            <div>
              <div class="group-card-title">Cartes Gazole</div>
              <div class="group-card-subtitle">${Utils.CARTES_GAZOLE.length + cartesPersoGazole.length} carte(s) suivie(s)</div>
            </div>
          </div>
          <div class="group-card-header-right">
            <div class="status-dot" style="background:${pireCouleur};"></div>
            <span class="chevron ${isOpen ? "rotated" : ""}">⌄</span>
          </div>
        </div>
        <div class="group-card-content ${isOpen ? "expanded" : ""}">
          <div class="group-card-divider"></div>
          ${itemsHTML}
        </div>
      </div>
    </div>
  `;

  container.querySelector("[data-toggle-gazole]").addEventListener("click", () => {
    openGroupCards[containerId] = !openGroupCards[containerId];
    appState.render();
  });

  Utils.CARTES_GAZOLE.forEach((info) => {
    const el = container.querySelector(`[data-gazole-edit="${info.champDate}"]`);
    if (el) el.addEventListener("click", () => openEditGazoleModal(info, d));

    const toggleEl = container.querySelector(`[data-gazole-toggle="${info.champDate}"]`);
    if (toggleEl) {
      toggleEl.addEventListener("click", (e) => {
        e.stopPropagation();
        codeVisibility[info.champDate] = !codeVisibility[info.champDate];
        appState.render();
      });
    }
  });

  attachCartePersoListeners(container, cartesPersoGazole);
}

function renderGazoleItemHTML(info, data) {
  const val       = data[info.champDate];
  const code      = data[info.champCode] || "";
  const statusColor = Utils.getStatusColor(val);
  const statusLabel = Utils.getStatusLabel(val);
  const dateStr   = Utils.formatDateFR(val) || "Non défini";
  const isVisible = !!codeVisibility[info.champDate];

  let codeRowHTML = "";
  if (code) {
    const displayCode = isVisible ? escapeHtml(code) : "•".repeat(Math.max(4, code.length));
    codeRowHTML = `
      <div class="gazole-code-row">
        <div class="gazole-code-left">
          🔒 <span style="letter-spacing:${isVisible ? "1px" : "3px"};">${displayCode}</span>
        </div>
        <button class="gazole-code-toggle" data-gazole-toggle="${info.champDate}">${isVisible ? "🙈" : "👁️"}</button>
      </div>
    `;
  }

  return `
    <div class="gazole-item-card">
      <div class="gazole-item-row" data-gazole-edit="${info.champDate}">
        <div class="gazole-item-left">
          <div class="nom">${info.nom}</div>
          <div class="status" style="color:${statusColor};">${statusLabel}</div>
        </div>
        <div class="gazole-item-right">
          <div class="status-dot" style="background:${statusColor};"></div>
          <div style="font-weight:800; font-size:13px; color:${statusColor};">${dateStr}</div>
          <span style="color:var(--color-text-secondary); font-size:14px;">✏️</span>
        </div>
      </div>
      ${codeRowHTML}
    </div>
  `;
}

function openEditGazoleModal(info, data) {
  const currentCode = data[info.champCode] || "";
  showModal({
    title: `Modifier — Carte ${info.nom}`,
    bodyHTML: `
      <div class="modal-field">
        <label>Date d'expiration</label>
        <input type="date" id="modal-gazole-date" value="${data[info.champDate] || ""}" />
        <div class="hint">Laisse vide pour réinitialiser (carte non utilisée)</div>
      </div>
      <div class="modal-field">
        <label>Code de la carte (mémo)</label>
        <input type="text" id="modal-gazole-code" value="${escapeHtml(currentCode)}" />
      </div>
      <div class="hint">Le code sera masqué par défaut sur le tableau de bord</div>
    `,
    confirmLabel: "Enregistrer",
    onConfirm: async (bodyEl) => {
      const dateInput = bodyEl.querySelector("#modal-gazole-date").value;
      const codeInput = bodyEl.querySelector("#modal-gazole-code").value;

      let dateISO = null;
      if (dateInput) {
        const { valeur, erreur } = Utils.validerDateISO(dateInput);
        if (erreur) { showToast("⚠️ " + erreur); return false; }
        dateISO = valeur;
      }

      // Les cartes gazole sont sur le chauffeur
      try {
        await dbUpdate("chauffeurs",
          { [info.champDate]: dateISO, [info.champCode]: codeInput.trim() },
          [{ col: "id", op: "eq", val: appState.chauffeurId }]
        );
        // Mise à jour locale immédiate (chauffeur + vehiculeData fusionné,
        // mêmes noms de champs pour les cartes gazole) : ne pas attendre le
        // round-trip du temps réel pour rafraîchir le dashboard.
        if (appState.chauffeur) {
          appState.chauffeur[info.champDate] = dateISO;
          appState.chauffeur[info.champCode] = codeInput.trim();
        }
        if (appState.vehiculeData) {
          appState.vehiculeData[info.champDate] = dateISO;
          appState.vehiculeData[info.champCode] = codeInput.trim();
        }
        appState.render();
        return true;
      } catch (e) {
        showToast(Utils.messageErreurSupabase(e));
        return false;
      }
    }
  });
}

// ════════════════════════════════════════════════════════════════════════
// CARTES PNEUS
// ════════════════════════════════════════════════════════════════════════

export function renderCartePneus() {
  if (pneusListenerPlaque !== appState.plaqueT) {
    pneusListenerPlaque = appState.plaqueT;
    consoEntriesForPneus = [];
    _loadConsoForPneus();
  }
  // Les km remorque = km tracteur (la remorque roule avec le tracteur)
  consoEntriesForPneusRemorque = consoEntriesForPneus;

  const t  = appState.tracteurData || {};
  const r  = appState.remorqueData || {};
  const pm = Utils.getProfilMoteur(appState.profilMoteur);
  const pr = Utils.getProfilRemorque(appState.profilRemorque);

  // ── Pneus véhicule moteur ──────────────────────────────────────────────
  const nbAvant   = pm ? pm.essieux_avant   : 1;
  const nbArriere = pm ? pm.essieux_arriere : 1;

  const itemsMoteur = [];
  for (let i = 0; i < nbAvant; i++) {
    const suffix   = nbAvant > 1 ? ` ${i + 1}` : "";
    const fieldKm  = i === 0 ? "km_pneus_avant"  : "km_pneus_avant2";
    const fieldDate= i === 0 ? "date_pose_avant"  : "date_pose_avant2";
    itemsMoteur.push({
      titre:    `Essieu Avant${suffix}`,
      kmPose:   t[fieldKm]   || 0,
      datePose: t[fieldDate],
      seuilKm:  Utils.SEUIL_PNEU_AVANT,
      fieldKm,
      fieldDate,
      source:   "tracteur"
    });
  }
  for (let i = 0; i < nbArriere; i++) {
    const suffix = nbArriere > 1 ? ` ${i + 1}` : "";
    itemsMoteur.push({
      titre:    `Essieu Arrière${suffix}`,
      kmPose:   t.km_pneus_arriere || 0,
      datePose: t.date_pose_arriere,
      seuilKm:  Utils.SEUIL_PNEU_ARRIERE,
      fieldKm:  "km_pneus_arriere",
      fieldDate:"date_pose_arriere",
      source:   "tracteur"
    });
  }

  renderPneuGroupCard("carte-pneus-tracteur", "Pneus Moteur", "🚚", itemsMoteur, consoEntriesForPneus);

  // ── Pneus remorque (uniquement si remorque attelée) ───────────────────
  const containerR = document.getElementById("carte-pneus-remorque");
  if (!appState.plaqueR) {
    if (containerR) containerR.innerHTML = "";
    return;
  }

  const nbEssieux = pr ? pr.nb_essieux : 3;
  const LABELS    = ["1er", "2ème", "3ème", "4ème", "5ème", "6ème"];
  const FIELDS_KM   = ["km_pneus_e1","km_pneus_e2","km_pneus_e3","km_pneus_e4","km_pneus_e5","km_pneus_e6"];
  const FIELDS_DATE = ["date_pose_e1","date_pose_e2","date_pose_e3","date_pose_e4","date_pose_e5","date_pose_e6"];

  const itemsRemorque = [];
  for (let i = 0; i < nbEssieux; i++) {
    itemsRemorque.push({
      titre:    `${LABELS[i] || (i+1)+"ème"} Essieu`,
      kmPose:   r[FIELDS_KM[i]]   || 0,
      datePose: r[FIELDS_DATE[i]],
      seuilKm:  Utils.SEUIL_PNEU_REMORQUE,
      fieldKm:  FIELDS_KM[i],
      fieldDate:FIELDS_DATE[i],
      source:   "remorque"
    });
  }

  renderPneuGroupCard("carte-pneus-remorque", "Pneus Remorque", "📦", itemsRemorque, consoEntriesForPneusRemorque);
}

async function _loadConsoForPneus() {
  if (!appState.plaqueT) return;
  try {
    const rows = await dbSelect("consommations", {
      select: "date,kilometres,plaque_remorque",
      filters: [{ col: "plaque_tracteur", op: "eq", val: appState.plaqueT }],
      order: { col: "date", asc: true }
    });
    const all = rows || [];
    // Km moteur = toutes les saisies du tracteur
    consoEntriesForPneus = all.map((r) => ({ date: r.date, km: r.kilometres || 0 }));
    // Km remorque = saisies où cette remorque était attelée (plaque_remorque renseignée)
    if (appState.plaqueR) {
      const avecRemorque = all.filter(r => r.plaque_remorque === appState.plaqueR);
      consoEntriesForPneusRemorque = avecRemorque.length > 0
        ? avecRemorque.map(r => ({ date: r.date, km: r.kilometres || 0 }))
        : consoEntriesForPneus; // fallback : toutes les saisies si pas encore de plaque_remorque
    } else {
      consoEntriesForPneusRemorque = [];
    }
    if (appState.render) appState.render();
  } catch (_) {}
}

function renderPneuGroupCard(containerId, titre, emoji, items, entries) {
  const container = document.getElementById(containerId);
  const isOpen    = !!openGroupCards[containerId];

  const theme      = document.documentElement.getAttribute("data-theme") || "nuit";
  const isPremium  = theme === "aurora" || theme === "obsidian";
  const isAurora   = theme === "aurora";

  let pireCouleur = "var(--color-text-secondary)";
  let pireRang    = -2;
  items.forEach((item) => {
    const rang = Utils.rangStatutPneu(item.datePose, entries, item.seuilKm);
    if (rang > pireRang) { pireRang = rang; pireCouleur = Utils.couleurStatutPneu(item.datePose, entries, item.seuilKm); }
  });

  const glowLine = isPremium ? `
    <div style="position:absolute;top:0;left:10%;right:10%;height:1px;
      background:linear-gradient(90deg,transparent,${isAurora ? "rgba(168,216,255,0.9),rgba(127,255,207,0.7)" : "rgba(41,121,255,0.9),rgba(6,182,212,0.7)"},transparent);
      pointer-events:none;z-index:2;border-radius:1px;"></div>` : "";

  const barStyle = isPremium
    ? `background:linear-gradient(to bottom,${isAurora ? "#a8d8ff,#7fffcf" : "#2979ff,#06b6d4"});box-shadow:2px 0 10px ${isAurora ? "rgba(168,216,255,0.6)" : "rgba(41,121,255,0.5)"};`
    : `background:${pireCouleur};`;

  const statusDotStyle = isPremium
    ? `background:${pireCouleur};box-shadow:0 0 10px ${pireCouleur},0 0 20px ${pireCouleur}40;`
    : `background:${pireCouleur};`;

  container.innerHTML = `
    <div class="group-card ${isOpen ? "is-open" : ""}" style="border-color:${isOpen ? "var(--color-accent)" : pireCouleur + "99"};position:relative;overflow:hidden;">
      ${glowLine}
      <div class="group-card-bar" style="${barStyle}"></div>
      <div class="group-card-body">
        <div class="group-card-header" data-toggle-pneu="${containerId}">
          <div class="group-card-header-left">
            <span class="emoji">${emoji}</span>
            <div>
              <div class="group-card-title">${titre}</div>
              <div class="group-card-subtitle">${items.length} pneu(s) suivi(s)</div>
            </div>
          </div>
          <div class="group-card-header-right">
            <div class="status-dot" style="${statusDotStyle}"></div>
            <span class="chevron ${isOpen ? "rotated" : ""}">⌄</span>
          </div>
        </div>
        <div class="group-card-content ${isOpen ? "expanded" : ""}">
          <div class="group-card-divider"></div>
          ${items.map((item) => renderTireCardHTML(item, entries)).join("")}
        </div>
      </div>
    </div>
  `;

  container.querySelector(`[data-toggle-pneu="${containerId}"]`).addEventListener("click", () => {
    openGroupCards[containerId] = !openGroupCards[containerId];
    appState.render();
  });

  items.forEach((item) => {
    const el = container.querySelector(`[data-tire-edit="${item.fieldKm}"]`);
    if (el) el.addEventListener("click", () => openEditTireModal(item));
  });
}

function renderTireCardHTML(item, entries) {
  const hasData     = item.datePose != null;
  const ratio       = Utils.ratioUsurePneu(item.datePose, entries, item.seuilKm);
  const kmParcourus = Utils.kmParcourusDepuisPose(item.datePose, entries);
  const color       = Utils.couleurStatutPneu(item.datePose, entries, item.seuilKm);
  const label       = Utils.labelStatutPneu(item.datePose, entries, item.seuilKm);
  const pct         = hasData ? Math.round((ratio || 0) * 100) : 0;

  const theme      = document.documentElement.getAttribute("data-theme") || "nuit";
  const isPremium  = theme === "aurora" || theme === "obsidian";
  const isAurora   = theme === "aurora";

  // Jauge avec glow sur thèmes premium
  const gaugeGlow = isPremium && hasData
    ? `box-shadow:0 0 10px ${color}80, 0 0 20px ${color}30;`
    : "";

  const infoLine = (item.kmPose > 0 || item.datePose)
    ? `<div class="tire-card-info-line">
        ${item.kmPose > 0 ? `<span>Posés à ${Utils.formatMilliers(item.kmPose)} km</span>` : ""}
        ${item.datePose    ? `<span>le ${Utils.formatDateFR(item.datePose)}</span>`          : ""}
       </div>`
    : "";

  return `
    <div class="tire-card" data-tire-edit="${item.fieldKm}">
      <div class="tire-card-top">
        <div class="tire-card-title">${escapeHtml(item.titre)}</div>
        <div class="tire-card-km" style="color:${hasData ? color : "var(--color-text-secondary)"};">
          ${hasData ? "~" + Utils.formatMilliers(kmParcourus) + " km" : "— km"}
          <span style="color:var(--color-text-secondary); font-size:13px;">✏️</span>
        </div>
      </div>
      <div class="tire-gauge-track">
        <div class="tire-gauge-fill" style="width:${pct}%; background:linear-gradient(to right, var(--color-success), ${color});${gaugeGlow}"></div>
        <div class="tire-gauge-marker"></div>
      </div>
      <div class="tire-card-bottom">
        <span style="color:${color}; font-weight:600;">${label}</span>
        <span style="color:var(--color-text-secondary);">Objectif : ${Utils.formatMilliers(item.seuilKm)} km</span>
      </div>
      ${infoLine}
    </div>
  `;
}

function openEditTireModal(item) {
  showModal({
    title: `Modifier — ${item.titre}`,
    bodyHTML: `
      <div class="modal-field">
        <label>Km au compteur lors du changement</label>
        <input type="text" id="modal-tire-km" value="${item.kmPose || ""}" inputmode="numeric" />
        <div class="hint">Informatif uniquement</div>
      </div>
      <div class="modal-field">
        <label>Date de pose</label>
        <input type="date" id="modal-tire-date" value="${item.datePose || ""}" />
        <div class="hint" style="color:var(--color-accent);">Utilisée pour estimer l'usure</div>
      </div>
    `,
    confirmLabel: "Confirmer",
    onConfirm: async (bodyEl) => {
      const kmInput   = bodyEl.querySelector("#modal-tire-km").value;
      const dateInput = bodyEl.querySelector("#modal-tire-date").value;
      const { valeur: dateISO,    erreur: erreurDate } = Utils.validerDateISO(dateInput);
      const { valeur: kmCompteur, erreur: erreurKm }   = Utils.validerKmCompteur(kmInput);
      const erreur = erreurDate || erreurKm;
      if (erreur) { showToast("⚠️ " + erreur); return false; }

      const table   = item.source === "remorque" ? "remorques" : "tracteurs";
      const plaque  = item.source === "remorque" ? appState.plaqueR : appState.plaqueT;

      try {
        await dbUpdate(table,
          { [item.fieldKm]: kmCompteur || 0, [item.fieldDate]: dateISO },
          [{ col: "plaque", op: "eq", val: plaque }]
        );
        // Mise à jour locale immédiate : ne pas attendre le round-trip du
        // temps réel pour que la jauge pneu reflète le changement.
        const vehiculeData = item.source === "remorque" ? appState.remorqueData : appState.tracteurData;
        if (vehiculeData) {
          vehiculeData[item.fieldKm]   = kmCompteur || 0;
          vehiculeData[item.fieldDate] = dateISO;
        }
        appState.render();
        return true;
      } catch (e) {
        showToast(Utils.messageErreurSupabase(e));
        return false;
      }
    }
  });
}

// ════════════════════════════════════════════════════════════════════════
// CARTE CITERNE — Compartiments
// Mémo "quoi + combien" par compartiment (citernes alimentaires) :
// évite de compter sur l'ardoise craie sur la cuve (illisible l'hiver).
// Réinitialisé manuellement par le chauffeur à la vidange (pas d'historique).
// ════════════════════════════════════════════════════════════════════════

export function renderCarteCiterne() {
  const container = document.getElementById("carte-citerne");
  const section   = document.getElementById("section-citerne");
  if (!container || !section) return;

  const pr = Utils.getProfilRemorque(appState.profilRemorque);
  const nbCompartiments = pr ? (pr.nb_compartiments || 0) : 0;

  if (!appState.plaqueR || !nbCompartiments) {
    container.innerHTML = "";
    section.style.display = "none";
    return;
  }
  section.style.display = "";

  const r = appState.remorqueData || {};
  const stored = Array.isArray(r.compartiments) ? r.compartiments : [];
  const compartiments = Array.from({ length: nbCompartiments }, (_, i) => stored[i] || {});

  const containerId = "carte-citerne";
  const isOpen = !!openGroupCards[containerId];
  const nbRemplis = compartiments.filter((c) => c.produit || c.volume_hl != null).length;

  const theme     = document.documentElement.getAttribute("data-theme") || "nuit";
  const isAurora  = theme === "aurora";
  const isPremium = isAurora || theme === "obsidian";

  const barStyle = isPremium
    ? `background:linear-gradient(to bottom,${isAurora ? "#a8d8ff,#7fffcf" : "#2979ff,#06b6d4"});box-shadow:2px 0 10px ${isAurora ? "rgba(168,216,255,0.6)" : "rgba(41,121,255,0.5)"};`
    : `background:var(--color-accent);`;

  container.innerHTML = `
    <div class="group-card ${isOpen ? "is-open" : ""}" style="border-color:${isOpen ? "var(--color-accent)" : "var(--color-divider)"};position:relative;overflow:hidden;">
      <div class="group-card-bar" style="${barStyle}"></div>
      <div class="group-card-body">
        <div class="group-card-header" data-toggle-citerne="1">
          <div class="group-card-header-left">
            <span class="emoji">🛢️</span>
            <div>
              <div class="group-card-title">Citerne — Compartiments</div>
              <div class="group-card-subtitle">${nbRemplis}/${nbCompartiments} compartiment(s) rempli(s)</div>
            </div>
          </div>
          <div class="group-card-header-right">
            <span class="chevron ${isOpen ? "rotated" : ""}">⌄</span>
          </div>
        </div>
        <div class="group-card-content ${isOpen ? "expanded" : ""}">
          <div class="group-card-divider"></div>
          ${compartiments.map((c, i) => renderCompartimentItemHTML(c, i)).join("")}
        </div>
      </div>
    </div>
  `;

  container.querySelector("[data-toggle-citerne]").addEventListener("click", () => {
    openGroupCards[containerId] = !openGroupCards[containerId];
    appState.render();
  });

  compartiments.forEach((c, i) => {
    const el = container.querySelector(`[data-citerne-edit="${i}"]`);
    if (el) el.addEventListener("click", () => openEditCompartimentModal(i, c, nbCompartiments));
  });
}

function renderCompartimentItemHTML(c, i) {
  const rempli  = !!(c.produit || c.volume_hl != null);
  const produit = c.produit ? escapeHtml(c.produit) : "Vide";
  const volume  = c.volume_hl != null ? `${String(c.volume_hl).replace(".", ",")} hL` : "—";

  return `
    <div class="gazole-item-card" data-citerne-edit="${i}">
      <div class="gazole-item-row">
        <div class="gazole-item-left">
          <div class="nom">Compartiment ${i + 1}</div>
          <div class="status" style="color:${rempli ? "var(--color-success)" : "var(--color-text-secondary)"};">${produit}</div>
        </div>
        <div class="gazole-item-right">
          <div style="font-weight:800; font-size:13px; color:${rempli ? "var(--color-accent)" : "var(--color-text-secondary)"};">${volume}</div>
          <span style="color:var(--color-text-secondary); font-size:14px;">✏️</span>
        </div>
      </div>
    </div>
  `;
}

function openEditCompartimentModal(index, compartiment, nbCompartiments) {
  showModal({
    title: `Compartiment ${index + 1}`,
    bodyHTML: `
      <div class="modal-field">
        <label>Produit</label>
        <input type="text" id="modal-citerne-produit" value="${escapeHtml(compartiment.produit || "")}" placeholder="ex : Rosé cuvée 2023 — Vignoble Durand" />
      </div>
      <div class="modal-field">
        <label>Volume (hectolitres)</label>
        <input type="text" id="modal-citerne-volume" value="${compartiment.volume_hl != null ? String(compartiment.volume_hl).replace(".", ",") : ""}" inputmode="decimal" placeholder="ex : 20" />
      </div>
      <button type="button" id="modal-citerne-vider" class="modal-inline-danger-btn">
        🗑️ Vider ce compartiment
      </button>
    `,
    confirmLabel: "Enregistrer",
    onMount: (bodyEl, closeModal) => {
      bodyEl.querySelector("#modal-citerne-vider").addEventListener("click", () => {
        showConfirmDialog({
          title: "Vider ce compartiment ?",
          text: "Le produit et le volume enregistrés seront effacés.",
          confirmLabel: "Vider",
          onConfirm: async () => {
            try {
              await _saveCompartiment(index, nbCompartiments, { produit: null, volume_hl: null });
              closeModal();
            } catch (e) {
              showToast(Utils.messageErreurSupabase(e));
            }
          }
        });
      });
    },
    onConfirm: async (bodyEl) => {
      const produitInput = bodyEl.querySelector("#modal-citerne-produit").value.trim();
      const volumeInput  = bodyEl.querySelector("#modal-citerne-volume").value.trim();

      let volume_hl = null;
      if (volumeInput) {
        const v = parseFloat(volumeInput.replace(",", "."));
        if (isNaN(v) || v < 0) { showToast("⚠️ Volume invalide"); return false; }
        if (v > 1000)          { showToast("⚠️ Volume anormalement élevé (max 1000 hL)"); return false; }
        volume_hl = v;
      }

      try {
        await _saveCompartiment(index, nbCompartiments, { produit: produitInput || null, volume_hl });
        return true;
      } catch (e) {
        showToast(Utils.messageErreurSupabase(e));
        return false;
      }
    }
  });
}

async function _saveCompartiment(index, nbCompartiments, valeur) {
  const r = appState.remorqueData || {};
  const stored = Array.isArray(r.compartiments) ? r.compartiments : [];
  const compartiments = Array.from({ length: nbCompartiments }, (_, i) => stored[i] || { produit: null, volume_hl: null });
  compartiments[index] = valeur;

  await dbUpdate("remorques", { compartiments }, [
    { col: "plaque", op: "eq", val: appState.plaqueR }
  ]);

  // Mise à jour locale immédiate : ne pas attendre le round-trip du temps
  // réel avant de permettre l'édition d'un autre compartiment, sinon la
  // sauvegarde suivante reconstruit le tableau à partir d'un état encore
  // périmé et écrase ce qui vient d'être enregistré.
  appState.remorqueData = { ...r, compartiments };
  if (appState.render) appState.render();
}

// ════════════════════════════════════════════════════════════════════════
// CARTE ENGINS BTP / SPÉCIAUX
// Affiche les alertes assurance / VGP / entretien de tous les engins
// de l'entreprise visibles par le chauffeur.
// ════════════════════════════════════════════════════════════════════════

export function renderCarteEngins() {
  const container = document.getElementById("carte-engins");
  if (!container) return;

  const engins = (appState.enginsData || []);
  if (engins.length === 0) {
    container.innerHTML = "";
    return;
  }

  const containerId = "carte-engins";
  const isOpen = !!openGroupCards[containerId];

  // Calculer le pire statut sur tous les engins / tous les champs dates
  let pireCouleur = "var(--color-text-secondary)";
  let pireRang    = -2;

  engins.forEach(engin => {
    Utils.CHAMPS_ENGIN.forEach(({ key }) => {
      const rang = Utils.rangStatut(engin[key]);
      if (rang > pireRang) {
        pireRang    = rang;
        pireCouleur = Utils.getStatusColorStatic(engin[key]);
      }
    });
  });

  const theme      = document.documentElement.getAttribute("data-theme") || "nuit";
  const isAurora   = theme === "aurora";
  const isObsidian = theme === "obsidian";
  const isPremium  = isAurora || isObsidian;

  const barStyle = isPremium
    ? `background:linear-gradient(to bottom,${isAurora ? "#a8d8ff,#7fffcf" : "#2979ff,#06b6d4"});box-shadow:2px 0 10px ${isAurora ? "rgba(168,216,255,0.6)" : "rgba(41,121,255,0.5)"};`
    : `background:${pireCouleur};`;

  const glowLine = isPremium ? `
    <div style="position:absolute;top:0;left:10%;right:10%;height:1px;
      background:linear-gradient(90deg,transparent,${isAurora ? "rgba(168,216,255,0.9),rgba(127,255,207,0.7)" : "rgba(41,121,255,0.9),rgba(6,182,212,0.7)"},transparent);
      pointer-events:none;border-radius:1px;z-index:2;"></div>` : "";

  // Générer les items par engin
  const enginsHTML = engins.map(engin => {
    const profil  = Utils.getProfilEngin(engin.profil) || { label: engin.profil, emoji: "🔧" };
    const nom     = engin.numero_parc || engin.numero_serie || "—";

    const champsHTML = Utils.CHAMPS_ENGIN.map(({ key, label: champTitre }) => {
      const val   = engin[key];
      if (!val) return "";
      const color = Utils.getStatusColor(val);
      const label = Utils.getStatusLabel(val);
      const date  = Utils.formatDateFR(val) || "—";
      return `
        <div class="date-card-item" style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--color-divider);">
          <div>
            <div style="font-size:13px;font-weight:600;color:var(--color-text-primary);">${champTitre}</div>
            <div style="font-size:11px;color:${color};margin-top:2px;">${label}</div>
          </div>
          <div style="font-size:13px;font-weight:700;color:${color};">${date}</div>
        </div>`;
    }).filter(Boolean).join("");

    if (!champsHTML) return "";

    return `
      <div style="margin-bottom:12px;padding:12px;background:var(--color-surface);border-radius:12px;border:1px solid var(--color-divider);">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <span style="font-size:18px;">${profil.emoji}</span>
          <div>
            <div style="font-size:14px;font-weight:700;color:var(--color-text-primary);">${nom}</div>
            <div style="font-size:11px;color:var(--color-text-secondary);">${profil.label}</div>
          </div>
        </div>
        ${champsHTML}
      </div>`;
  }).filter(Boolean).join("");

  container.innerHTML = `
    <div class="group-card ${isOpen ? "is-open" : ""}" style="border-color:${isOpen ? "var(--color-accent)" : pireCouleur + "99"};position:relative;overflow:hidden;">
      ${glowLine}
      <div class="group-card-bar" style="${barStyle}"></div>
      <div class="group-card-body">
        <div class="group-card-header" data-toggle-engins="1">
          <div class="group-card-header-left">
            <span class="emoji">🏗️</span>
            <div>
              <div class="group-card-title">Engins BTP</div>
              <div class="group-card-subtitle">${engins.length} engin(s) suivi(s)</div>
            </div>
          </div>
          <div class="group-card-header-right">
            <div class="status-dot" style="background:${pireCouleur};"></div>
            <span class="chevron ${isOpen ? "rotated" : ""}">⌄</span>
          </div>
        </div>
        <div class="group-card-content ${isOpen ? "expanded" : ""}">
          <div class="group-card-divider"></div>
          ${enginsHTML || '<div style="color:var(--color-text-secondary);font-size:13px;padding:8px 0;">Aucune échéance à surveiller</div>'}
        </div>
      </div>
    </div>
  `;

  container.querySelector("[data-toggle-engins]").addEventListener("click", () => {
    openGroupCards[containerId] = !openGroupCards[containerId];
    appState.render();
  });
}

// ════════════════════════════════════════════════════════════════════════
// CARTE MOYENNE CONSOMMATION DU MOIS
// Utilise une requête REST simple (pas de Realtime ici — l'écran conso
// a son propre listener, et le dashboard se re-render quand on revient).
// ════════════════════════════════════════════════════════════════════════

export async function renderCarteConsoMois(onClickCallback) {
  const container = document.getElementById("carte-conso-mois");
  const now       = new Date();
  const moisLabel = Utils.formatMoisAnneeFR(now);
  const moisActuel = `${now.getFullYear()}-${now.getMonth()}`;

  // Mémorise le callback pour le réutiliser depuis le cache
  if (onClickCallback) _consoMoisCallback = onClickCallback;

  // Si le cache est valide pour ce mois, on re-render sans fetcher
  if (_consoMoisCache && _consoMoisMois === moisActuel) {
    _renderConsoWidget(container, _consoMoisCache, _consoMoisCallback);
    return;
  }

  // Sinon fetch Supabase (affiche le contenu précédent pendant le chargement)
  if (!_consoMoisCache) {
    container.innerHTML = `<div class="conso-card-loading" style="padding:16px; text-align:center; color:var(--color-text-secondary);">Chargement…</div>`;
  }

  try {
    const debutMois = dateToISO(new Date(now.getFullYear(), now.getMonth(), 1));
    const rows = await dbSelect("consommations", {
      select: "valeur,kilometres,litres,statut",
      filters: [
        { col: "plaque_tracteur", op: "eq",  val: appState.plaqueT },
        { col: "date",            op: "gte", val: debutMois }
      ]
    });

    let moyenne = null, nbSaisies = 0, totalKm = 0, totalLitres = 0;
    if (rows && rows.length > 0) {
      // Les jours "pas roulé"/"oubli" (statut renseigné, valeur=0) ne sont
      // pas de vraies saisies — les inclure fausserait la moyenne L/100
      // affichée sur le tableau de bord.
      const saisies = rows.filter((r) => !r.statut);
      const valeurs = saisies.map((r) => r.valeur).filter((v) => v != null);
      nbSaisies   = valeurs.length;
      totalKm     = saisies.reduce((a, r) => a + (r.kilometres || 0), 0);
      totalLitres = saisies.reduce((a, r) => a + (r.litres    || 0), 0);
      moyenne     = valeurs.length ? valeurs.reduce((a, b) => a + b, 0) / valeurs.length : null;
    }

    _consoMoisCache = { moyenne, nbSaisies, totalKm, totalLitres, moisLabel };
    _consoMoisMois  = moisActuel;
    _renderConsoWidget(container, _consoMoisCache, _consoMoisCallback);

  } catch (_) {
    if (!_consoMoisCache) {
      container.innerHTML = `<div style="padding:16px; color:var(--color-text-secondary);">📡 Impossible de charger la consommation</div>`;
    }
  }
}

function _renderConsoWidget(container, data, onClickCallback) {
  const { moyenne, nbSaisies, totalKm, totalLitres, moisLabel } = data;
  const theme     = document.documentElement.getAttribute("data-theme") || "nuit";
  const isPremium = theme === "aurora" || theme === "obsidian";
  const isAurora  = theme === "aurora";

  const barStyle = isPremium
    ? `background:linear-gradient(to bottom,${isAurora ? "#a8d8ff,#7fffcf" : "#2979ff,#06b6d4"});box-shadow:2px 0 12px ${isAurora ? "rgba(168,216,255,0.6)" : "rgba(41,121,255,0.5)"};`
    : "";

  const valueStyle = isPremium
    ? `background:linear-gradient(135deg,${isAurora ? "#a8d8ff,#7fffcf" : "#7c3aed,#06b6d4"});-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;`
    : "";

  const glowLine = isPremium ? `
    <div style="position:absolute;top:0;left:8%;right:8%;height:1px;
      background:linear-gradient(90deg,transparent,${isAurora ? "rgba(168,216,255,0.9),rgba(127,255,207,0.7)" : "rgba(41,121,255,0.8),rgba(6,182,212,0.6)"},transparent);
      pointer-events:none;z-index:2;"></div>` : "";

    container.innerHTML = `
      <div class="conso-card" id="conso-card-click" style="position:relative;overflow:hidden;">
        ${glowLine}
        <div class="conso-card-bar" ${barStyle ? `style="${barStyle}"` : ""}></div>
        <div class="conso-card-body">
          <div class="conso-card-top">
            <div class="conso-card-month">${moisLabel} <span style="color:var(--color-text-secondary); font-size:14px;">›</span></div>
            <div class="conso-card-value" ${valueStyle ? `style="${valueStyle}"` : ""}>${moyenne !== null ? Utils.formatDecimal(moyenne) : "—"}</div>
          </div>
          <div class="conso-card-unit">L/100km</div>
          <div class="conso-card-divider"></div>
          ${nbSaisies > 0
            ? `<div class="conso-card-detail">Basé sur ${nbSaisies} saisie(s) et ${Utils.formatMilliers(totalKm)} kms</div>
               <div class="conso-card-total">⛽ ${Utils.formatDecimal(totalLitres)} L consommés</div>`
            : `<div class="conso-card-detail">Aucune saisie ce mois-ci</div>`}
        </div>
      </div>
    `;
    document.getElementById("conso-card-click").addEventListener("click", () => {
      if (onClickCallback) onClickCallback();
    });
}

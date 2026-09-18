// ════════════════════════════════════════════════════════════════════════
// MémoTruck — Panel Admin (Exploitation / Mécanicien)
// ════════════════════════════════════════════════════════════════════════

const SUPABASE_URL  = "https://ztlxxrywxxflqvigwncb.supabase.co";
const SUPABASE_ANON = "sb_publishable_TpyGDizV1HVN3h8twaXlOA_N02y26cJ";
const JWT_KEY       = "atil_admin_jwt";
const SESSION_KEY   = "atil_admin_session";

// ─── Client Supabase SDK pour Realtime ───────────────────────────────────
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import {
  exportConsommationsPDF,
  exportChauffeursPDF,
  exportVehiculesPDF,
  exportInterventionsPDF,
  exportAttelagesPDF,
  exportPneumatiquesPDF,
  exportDossierPDF
} from "./pdf-export.js";
import { initErrorMonitor } from "./error-monitor.js";
initErrorMonitor();

let _supabase = null;
function getSupabase() {
  if (_supabase) return _supabase;
  _supabase = createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: false } });
  return _supabase;
}

// Sessions actives en mémoire (mise à jour par Realtime)
let sessionsActives = {};  // { chauffeur_id: { plaque_tracteur, plaque_remorque } }
let unsubSessions   = null;
let unsubInterventions = null;

// Caches photos
let docPhotosCache     = {};  // { chauffeur_id: { carte_slug: { label, storage_path, url } } }
let vehiclePhotosCache = {};  // { plaque: { carte_slug: { label, storage_path, url } } }
let unsubDocPhotos     = null;

function startSessionsRealtime() {
  if (unsubSessions) return;
  const supabase = getSupabase();
  // Injecte le JWT admin pour que le RLS laisse passer
  const jwt = localStorage.getItem(JWT_KEY);
  if (jwt) supabase.realtime.setAuth(jwt);

  const channel = supabase
    .channel("admin-sessions")
    .on("postgres_changes",
      { event: "*", schema: "public", table: "sessions_actives" },
      async () => {
        // Recharge toutes les sessions de l'entreprise
        await loadSessionsActives();
        // Re-render la section courante si c'est Chauffeurs
        if (currentSection === "chauffeurs") renderChauffeurs();
      }
    )
    .subscribe();

  unsubSessions = () => supabase.removeChannel(channel);
}

function startInterventionsRealtime() {
  if (unsubInterventions) return;
  const supabase = getSupabase();
  const jwt = localStorage.getItem(JWT_KEY);
  if (jwt) supabase.realtime.setAuth(jwt);

  const channel = supabase
    .channel("admin-interventions")
    .on("postgres_changes",
      { event: "*", schema: "public", table: "interventions" },
      () => {
        if (adminSession?.role === "mecanicien") {
          // Panel atelier : les tickets EUX-MÊMES sont affichés, on recharge le
          // tableau de bord — seulement si le mécano regarde bien cette section
          // (sinon ça écraserait par ex. l'écran Historique entretiens frigo).
          if (currentAtelierSection === "interventions") renderAtelier();
        } else if (currentSection === "interventions") {
          // Bureau/exploitation : lecture seule, on rafraîchit juste le tableau si affiché
          loadInterventionsTable(
            document.getElementById("filter-inter-vehicule")?.value || "",
            document.getElementById("filter-inter-type")?.value || ""
          );
        }
      }
    )
    .subscribe();

  unsubInterventions = () => supabase.removeChannel(channel);
}

// Catalogue de profils véhicules (table profils_vehicules) : profils globaux
// gérés par le superadmin + profils perso créés par cette entreprise. La RLS
// restreint déjà les lignes reçues, pas de filtre entreprise_id côté client.
let profilsVehiculesCache = [];
let unsubProfilsVehicules = null;

async function loadProfilsVehicules() {
  try {
    const rows = await dbSelect("profils_vehicules", {
      filters: [{ col: "actif", op: "eq", val: true }],
      order: { col: "ordre", asc: true }
    });
    profilsVehiculesCache = rows || [];
  } catch (_) {
    profilsVehiculesCache = [];
  }
}

function getProfilVehicule(id) {
  return profilsVehiculesCache.find((p) => p.id === id) || null;
}

function getProfilsParCategorie(categorie) {
  return profilsVehiculesCache.filter((p) => p.categorie === categorie);
}

// Hayon possible seulement sur les véhicules avec une caisse ouvrable à
// l'arrière : remorques bâchées ou frigo (pas citerne, benne, porte-char,
// dolly — aucune caisse classique) ; côté moteur, tout porteur avec sa
// propre caisse (bâché ou frigo), mais pas un tracteur routier (qui tire une
// semi-remorque, sans caisse à lui) ni un véhicule léger.
function _peutAvoirHayon(p) {
  if (!p) return false;
  if (p.categorie === "remorque") return p.famille === "Bâchée" || p.famille === "Frigo";
  if (p.categorie === "moteur")   return p.famille !== "Tracteur" && p.famille !== "Véhicule léger";
  return false;
}

// Regroupe une liste de profils par famille (Bâchée, Frigo, Citerne
// alimentaire...), triée par ordre alphabétique de famille — sinon tout se
// mélange dès qu'il y a beaucoup de profils dans une même catégorie.
function grouperParFamille(profils, categorieFallback) {
  const groupes = {};
  profils.forEach((p) => {
    const cle = p.famille || categorieFallback || "Autres";
    if (!groupes[cle]) groupes[cle] = [];
    groupes[cle].push(p);
  });
  return Object.keys(groupes)
    .sort((a, b) => a.localeCompare(b, "fr"))
    .map((famille) => ({ famille, items: groupes[famille] }));
}

// Construit les <optgroup> HTML pour un <select> à partir d'une liste de
// profils {id,label,perso}. optionHTML(p) permet de personnaliser le texte
// de chaque <option> (ex: suffixe "(perso)").
function optgroupsHTML(profils, optionHTML) {
  return grouperParFamille(profils, "Autres")
    .map((g) => `<optgroup label="${esc(g.famille)}">${g.items.map(optionHTML).join("")}</optgroup>`)
    .join("");
}

function startProfilsVehiculesRealtime() {
  if (unsubProfilsVehicules) return;
  const supabase = getSupabase();
  const jwt = localStorage.getItem(JWT_KEY);
  if (jwt) supabase.realtime.setAuth(jwt);

  const channel = supabase
    .channel("admin-profils-vehicules")
    .on("postgres_changes", { event: "*", schema: "public", table: "profils_vehicules" }, async () => {
      await loadProfilsVehicules();
      if (currentSection === "parc") renderParc();
    })
    .subscribe();

  unsubProfilsVehicules = () => supabase.removeChannel(channel);
}

let unsubEntreprise = null;
// Écoute la fiche entreprise elle-même (profils_autorises en particulier) :
// quand le superadmin décoche des packs, le panel bureau doit perdre l'accès
// en direct — sans ça, un admin déjà connecté garde tout le catalogue tant
// qu'il n'a pas rechargé la page à la main.
function startEntrepriseRealtime() {
  if (unsubEntreprise || !adminSession?.entreprise_id) return;
  const supabase = getSupabase();
  const jwt = localStorage.getItem(JWT_KEY);
  if (jwt) supabase.realtime.setAuth(jwt);

  const channel = supabase
    .channel(`admin-entreprise-${adminSession.entreprise_id}`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "entreprises", filter: `id=eq.${adminSession.entreprise_id}` },
      () => { if (currentSection === "parc") renderParc(); }
    )
    .subscribe();

  unsubEntreprise = () => supabase.removeChannel(channel);
}

let unsubVehicules = null;
function startVehiculesRealtime() {
  if (unsubVehicules) return;
  const supabase = getSupabase();
  const jwt = localStorage.getItem(JWT_KEY);
  if (jwt) supabase.realtime.setAuth(jwt);

  const channel = supabase
    .channel("admin-vehicules")
    .on("postgres_changes", { event: "*", schema: "public", table: "tracteurs" }, () => {
      if (currentSection === "parc") renderParc();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "remorques" }, () => {
      if (currentSection === "parc") renderParc();
    })
    .subscribe();

  unsubVehicules = () => supabase.removeChannel(channel);
}

async function loadSessionsActives() {
  try {
    const rows = await dbSelect("sessions_actives", { select: "chauffeur_id,plaque_tracteur,plaque_remorque" });
    sessionsActives = {};
    (rows || []).forEach((r) => { sessionsActives[r.chauffeur_id] = r; });
  } catch (_) {}
}

// ─── État ────────────────────────────────────────────────────────────────
let adminSession = null;  // { jwt, admin_id, role, entreprise_id, prenom }
let currentSection = "inscriptions";

// ─── Helpers HTTP ─────────────────────────────────────────────────────────
function authHeaders() {
  const jwt = localStorage.getItem(JWT_KEY);
  return {
    "apikey": SUPABASE_ANON,
    "Authorization": jwt ? `Bearer ${jwt}` : `Bearer ${SUPABASE_ANON}`,
    "Content-Type": "application/json"
  };
}

// Storage (Fastify) refuse une requête sans corps annoncée en
// "Content-Type: application/json" (FST_ERR_CTP_EMPTY_JSON_BODY → 400) —
// contrairement à PostgREST, qui tolère très bien ce header sur un DELETE
// sans body. À utiliser pour tout DELETE vers /storage/v1/object/...
function authHeadersNoBody() {
  const { "Content-Type": _ct, ...rest } = authHeaders();
  return rest;
}

async function dbSelect(table, { select = "*", filters = [], order = null, limit = null } = {}) {
  let url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}`;
  filters.forEach(({ col, op, val }) => {
    url += `&${encodeURIComponent(col)}=${op}.${encodeURIComponent(val)}`;
  });
  if (order) url += `&order=${encodeURIComponent(order.col)}${order.asc === false ? ".desc" : ""}`;
  if (limit) url += `&limit=${limit}`;
  const res = await fetch(url, { method: "GET", headers: { ...authHeaders(), "Prefer": "return=representation" } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.message || `GET ${table} failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function dbUpdate(table, data, filters = []) {
  let url = `${SUPABASE_URL}/rest/v1/${table}`;
  const qs = filters.map(({ col, op, val }) => `${encodeURIComponent(col)}=${op}.${encodeURIComponent(val)}`).join("&");
  if (qs) url += "?" + qs;
  const res = await fetch(url, { method: "PATCH", headers: { ...authHeaders(), "Prefer": "return=representation" }, body: JSON.stringify(data) });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.message || `UPDATE ${table} failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function dbInsert(table, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST", headers: { ...authHeaders(), "Prefer": "return=representation" }, body: JSON.stringify(data)
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.message || `INSERT ${table} failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Journal d'activité du bureau — best-effort, ne bloque jamais l'action
// principale si l'écriture du log échoue.
async function logActiviteEntreprise(action, details = null) {
  try {
    const nomComplet = `${adminSession.prenom || ""} ${adminSession.nom || ""}`.trim() || adminSession.email || "—";
    await dbInsert("entreprise_activity_log", {
      entreprise_id: adminSession.entreprise_id,
      admin_id:      adminSession.admin_id,
      admin_nom:     nomComplet,
      action,
      details
    });
  } catch (_) {}
}

async function dbUpsert(table, data, onConflict) {
  let url = `${SUPABASE_URL}/rest/v1/${table}`;
  if (onConflict) url += `?on_conflict=${encodeURIComponent(onConflict)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...authHeaders(), "Prefer": "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.message || `UPSERT ${table} failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function dbDelete(table, filters = []) {
  let url = `${SUPABASE_URL}/rest/v1/${table}`;
  const qs = filters.map(({ col, op, val }) => `${encodeURIComponent(col)}=${op}.${encodeURIComponent(val)}`).join("&");
  if (qs) url += "?" + qs;
  const res = await fetch(url, { method: "DELETE", headers: authHeaders() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.message || `DELETE ${table} failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return true;
}

// ════════════════════════════════════════════════════════════════════════
// HISTORIQUE ENTRETIENS — trace permanente et non-écrasable (frigo,
// nettoyage intérieur, graissage), même bucket que les documents mais
// chemin unique par photo (jamais écrasé, pas de policy update/delete côté
// DB : append-only par design). Voir memotruck-app-test/js/photo-docs.js
// pour le même mécanisme côté PWA.
// ════════════════════════════════════════════════════════════════════════

function compressImage(file, maxSize = 1280, quality = 0.80) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width: w, height: h } = img;
        if (w > maxSize || h > maxSize) {
          if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
          else       { w = Math.round(w * maxSize / h); h = maxSize; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          blob => blob ? resolve(blob) : reject(new Error("Compression échouée")),
          "image/jpeg", quality
        );
      };
      img.onerror = () => reject(new Error("Image illisible"));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function uploadHistoriquePhoto(entrepriseId, entiteType, entitePlaque, typeEntretien, file) {
  const blob       = await compressImage(file);
  const uniqueId   = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const storagePath = `${entrepriseId}/historique/${entiteType}/${entitePlaque}/${typeEntretien}/${uniqueId}.jpg`;

  const uploadRes = await fetch(
    `${SUPABASE_URL}/storage/v1/object/documents-chauffeurs/${storagePath}`,
    { method: "POST", headers: { ...authHeaders(), "Content-Type": "image/jpeg" }, body: blob }
  );
  if (!uploadRes.ok) {
    const err = await uploadRes.json().catch(() => ({}));
    throw new Error(err.error || err.message || `Upload échoué (${uploadRes.status})`);
  }
  return storagePath;
}

async function enregistrerHistoriqueEntretien({
  entrepriseId, entiteType, entitePlaque, typeEntretien, dateEntretien,
  file = null, commentaire = null
}) {
  let storagePath = null;
  if (file) {
    storagePath = await uploadHistoriquePhoto(entrepriseId, entiteType, entitePlaque, typeEntretien, file);
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/historique_entretiens`, {
    method:  "POST",
    headers: { ...authHeaders(), "Prefer": "return=representation" },
    body: JSON.stringify({
      entreprise_id:  entrepriseId,
      entite_type:    entiteType,
      entite_plaque:  entitePlaque,
      type_entretien: typeEntretien,
      date_entretien: dateEntretien,
      storage_path:   storagePath,
      commentaire,
      admin_id:  adminSession?.admin_id || null,
      admin_nom: `${adminSession?.prenom || ""} ${adminSession?.nom || ""}`.trim() || null
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Enregistrement historique échoué (${res.status})`);
  }
  const rows = await res.json();
  return rows[0];
}

async function fetchHistoriqueEntretiens(entiteType, entitePlaque, typeEntretien = null) {
  let url = `${SUPABASE_URL}/rest/v1/historique_entretiens?select=*&entite_type=eq.${entiteType}` +
    `&entite_plaque=eq.${encodeURIComponent(entitePlaque)}&order=date_entretien.desc,created_at.desc`;
  if (typeEntretien) url += `&type_entretien=eq.${typeEntretien}`;

  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) return [];
  const rows = await res.json();

  await Promise.all(rows.map(async (row) => {
    row.photo_url = row.storage_path ? await _getSignedUrl(row.storage_path).catch(() => null) : null;
  }));

  return rows;
}

async function callEdge(name, body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `${name} failed`);
  return json;
}

// Comme callEdge, mais avec le JWT admin en Authorization (requis par workshop-notify
// pour identifier l'appelant).
async function callEdgeAuth(name, body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `${name} failed`);
  return json;
}

// ─── Toast ────────────────────────────────────────────────────────────────
function showToast(msg) {
  const c = document.getElementById("admin-toast-container");
  const t = document.createElement("div");
  t.className = "admin-toast";
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3100);
}

// ─── Modal ────────────────────────────────────────────────────────────────
function showModal({ title, bodyHTML, confirmLabel = "Confirmer", onConfirm, onMount, danger = false, cancelLabel = "Annuler" }) {
  const options = { onMount };
  const overlay = document.createElement("div");
  overlay.className = "admin-modal-overlay";
  overlay.innerHTML = `
    <div class="admin-modal-box">
      <div class="admin-modal-title">${title}</div>
      <div id="admin-modal-body">${bodyHTML}</div>
      <div class="admin-modal-actions">
        <button class="admin-modal-cancel" id="admin-modal-cancel">${cancelLabel}</button>
        ${confirmLabel !== null ? `<button class="admin-modal-confirm" id="admin-modal-confirm"
          style="${danger ? "background:var(--color-danger);color:white;" : ""}"
        >${confirmLabel}</button>` : ""}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector("#admin-modal-cancel").onclick = close;
  const confirmBtn = overlay.querySelector("#admin-modal-confirm");
  if (confirmBtn) {
    confirmBtn.onclick = async () => {
      confirmBtn.disabled = true;
      const body = overlay.querySelector("#admin-modal-body");
      try {
        const result = await Promise.resolve(onConfirm(body, close));
        if (result !== false) close();
      } catch (e) {
        showToast("⚠️ " + e.message);
        confirmBtn.disabled = false;
      }
    };
  }
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  // Support onMount (callbacks custom dans le body)
  if (options && options.onMount) {
    const body = overlay.querySelector("#admin-modal-body");
    options.onMount(body, close);
  }
}

// ─── Escape HTML ──────────────────────────────────────────────────────────
function esc(str) {
  return String(str || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ─── Formatage date ───────────────────────────────────────────────────────
function formatDate(iso) {
  if (!iso) return "—";
  // Accepte "YYYY-MM-DD" et "YYYY-MM-DDTHH:mm:ss..."
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
}

// ════════════════════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════════════════════

async function handleLogin() {
  const email    = document.getElementById("admin-input-email").value.trim();
  const password = document.getElementById("admin-input-password").value;
  const btn      = document.getElementById("admin-btn-login");
  const errEl    = document.getElementById("admin-login-error");
  const btnText  = document.getElementById("admin-login-btn-text");

  errEl.classList.add("hidden");
  btn.disabled = true;
  btnText.textContent = "Connexion…";

  try {
    const result = await callEdge("admin-login", { email, password });

    // Vérifie que ce n'est pas un compte super admin (réservé au panel Super Admin)
    if (result.role === "super_admin") {
      errEl.textContent = "⛔ Utilise le panel Super Admin pour ce compte.";
      errEl.classList.remove("hidden");
      btn.disabled = false;
      btnText.textContent = "SE CONNECTER";
      return;
    }

    localStorage.setItem(JWT_KEY, result.jwt);
    localStorage.setItem(SESSION_KEY, JSON.stringify(result));
    adminSession = result;
    enterAdminScreen();
  } catch (e) {
    errEl.textContent = "❌ " + (e.message || "Email ou mot de passe incorrect");
    errEl.classList.remove("hidden");
    btn.disabled = false;
    btnText.textContent = "SE CONNECTER";
  }
}

function handleLogout() {
  if (unsubSessions) { unsubSessions(); unsubSessions = null; }
  if (unsubInterventions) { unsubInterventions(); unsubInterventions = null; }
  sessionsActives = {};
  localStorage.removeItem(JWT_KEY);
  localStorage.removeItem(SESSION_KEY);
  adminSession = null;
  document.getElementById("admin-screen-dashboard").classList.add("hidden");
  document.getElementById("admin-screen-atelier").classList.add("hidden");
  document.getElementById("admin-screen-login").classList.remove("hidden");
  document.getElementById("admin-input-email").value = "";
  document.getElementById("admin-input-password").value = "";
}

// Point d'entrée unique après connexion (login ou auto-login) : le compte
// mécanicien a un écran totalement différent du dashboard exploitation.
function enterAdminScreen() {
  if (adminSession.role === "mecanicien") enterAtelier();
  else enterDashboard();
}

function tryAutoLogin() {
  const stored = localStorage.getItem(SESSION_KEY);
  const jwt    = localStorage.getItem(JWT_KEY);
  if (!stored || !jwt) return false;
  try {
    adminSession = JSON.parse(stored);
    return true;
  } catch (_) { return false; }
}

// ════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════════════════════════════════

function enterDashboard() {
  document.getElementById("admin-screen-login").classList.add("hidden");
  document.getElementById("admin-screen-dashboard").classList.remove("hidden");

  // Infos utilisateur
  document.getElementById("admin-user-name").textContent =
    `${adminSession.prenom || ""} ${adminSession.nom || ""}`.trim() || adminSession.email || "Admin";
  document.getElementById("admin-user-role").textContent = "EXPLOITATION";

  // Badge entreprise (on charge le nom)
  loadEntrepriseName("admin-entreprise-badge");

  // Charge les sessions actives + le catalogue de profils + démarre les Realtimes
  Promise.all([loadSessionsActives(), loadProfilsVehicules()]).then(() => {
    startSessionsRealtime();
    startDocPhotosRealtime();
    startInterventionsRealtime();
    startVehiculesRealtime();
    startProfilsVehiculesRealtime();
    startEntrepriseRealtime();
    chargerAlertes(); // charge les alertes initiales et met à jour les badges nav
    navigateTo("dashboard");
  });
}

async function loadEntrepriseName(targetElId) {
  if (!adminSession.entreprise_id) return;
  try {
    const rows = await dbSelect("entreprises", {
      select: "nom",
      filters: [{ col: "id", op: "eq", val: adminSession.entreprise_id }]
    });
    if (rows && rows[0]) {
      document.getElementById(targetElId).textContent = rows[0].nom;
    }
  } catch (_) {}
}

// ─── Navigation ───────────────────────────────────────────────────────────
function navigateTo(section) {
  currentSection = section;

  document.querySelectorAll(".admin-nav-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.section === section);
  });

  const titles = {
    dashboard:            "Tableau de bord",
    alertes:              "Alertes & Échéances",
    inscriptions:         "Inscriptions en attente",
    chauffeurs:           "Gestion des chauffeurs",
    parc:                 "Parc véhicules",
    engins:               "Engins BTP / Spéciaux",
    consommations:        "Suivi consommations",
    interventions:        "Historique interventions",
    pneumatiques:         "Suivi pneumatiques",
    "historique-attelages": "Historique des attelages",
    "historique-entretiens": "Historique entretiens frigo",
    exports:               "Exports",
    journal:              "Journal d'activité",
    parametres:            "Paramètres"
  };
  document.getElementById("admin-section-title").textContent = titles[section] || section;

  const content = document.getElementById("admin-content");
  content.innerHTML = `<div class="admin-loading">Chargement…</div>`;

  switch (section) {
    case "dashboard":            renderDashboardAdmin();     break;
    case "alertes":              renderAlertes();            break;
    case "inscriptions":         renderInscriptions();       break;
    case "chauffeurs":           renderChauffeurs();         break;
    case "parc":                 renderParc();               break;
    case "engins":               renderEngins();             break;
    case "consommations":        renderConsommations();      break;
    case "interventions":        renderInterventions();      break;
    case "pneumatiques":         renderPneumatiques();       break;
    case "historique-attelages": renderHistoriqueAttelages(); break;
    case "historique-entretiens": renderHistoriqueEntretiens(); break;
    case "exports":               renderExports();            break;
    case "journal":               renderJournalActivite();    break;
    case "parametres":            renderParametres("admin-content"); break;
  }
}

// ════════════════════════════════════════════════════════════════════════
// SECTION — TABLEAU DE BORD
// ════════════════════════════════════════════════════════════════════════

async function renderDashboardAdmin() {
  const content = document.getElementById("admin-content");
  try {
    const now         = new Date();
    const todayStr    = now.toISOString().substring(0,10);
    const in7         = new Date(now.getTime() + 7*86400000).toISOString().substring(0,10);
    const in30        = new Date(now.getTime() + 30*86400000).toISOString().substring(0,10);
    const moisCourant = todayStr.substring(0,7);
    const moisPrec    = new Date(now.getFullYear(), now.getMonth()-1, 1);
    const moisPrecStr = `${moisPrec.getFullYear()}-${String(moisPrec.getMonth()+1).padStart(2,"0")}`;
    const moisLabels  = ["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"];

    // ── Chargement données ───────────────────────────────────────────────
    const eid = adminSession.entreprise_id;
    const [chauffeurs, tracteurs, remorques, consos, interventions, inscriptions, sessions, cartesPerso, enginsDash] = await Promise.all([
      dbSelect("chauffeurs",   { filters:[{ col:"entreprise_id", op:"eq", val:eid }] }).catch(()=>[]),
      dbSelect("tracteurs",    { filters:[{ col:"entreprise_id", op:"eq", val:eid }] }).catch(()=>[]),
      dbSelect("remorques",    { filters:[{ col:"entreprise_id", op:"eq", val:eid }] }).catch(()=>[]),
      dbSelect("consommations",{ select:"date,kilometres,litres,valeur,chauffeur_id", filters:[{ col:"entreprise_id", op:"eq", val:eid }], order:{ col:"date", asc:false }, limit:400 }).catch(()=>[]),
      dbSelect("interventions",{ select:"id,date,type,entite_plaque", filters:[{ col:"entreprise_id", op:"eq", val:eid }], order:{ col:"date", asc:false }, limit:50 }).catch(()=>[]),
      dbSelect("chauffeurs",   { filters:[{ col:"entreprise_id", op:"eq", val:eid },{ col:"est_valide", op:"eq", val:false }] }).catch(()=>[]),
      dbSelect("sessions_actives",{ select:"chauffeur_id,plaque_tracteur,plaque_remorque", filters:[{ col:"entreprise_id", op:"eq", val:String(eid) }] }).catch(()=>[]),
      dbSelect("cartes_perso",{ select:"label,date_valeur,a_date,entite_type,entite_plaque,chauffeur_id", filters:[{ col:"entreprise_id", op:"eq", val:eid },{ col:"a_date", op:"eq", val:true }] }).catch(()=>[]),
      dbSelect("engins",      { select:"id,profil,numero_parc,numero_serie,date_assurance,date_vgp,date_entretien", filters:[{ col:"entreprise_id", op:"eq", val:eid }] }).catch(()=>[])
    ]);

    // ── KPIs consommation ────────────────────────────────────────────────
    const consoMois  = (consos||[]).filter(c => c.date?.substring(0,7) === moisCourant);
    const consoPrec  = (consos||[]).filter(c => c.date?.substring(0,7) === moisPrecStr);
    const kmMois     = consoMois.reduce((a,c) => a+Number(c.kilometres||0), 0);
    const litresMois = consoMois.reduce((a,c) => a+Number(c.litres||0), 0);
    const moyMois    = consoMois.length ? consoMois.reduce((a,c) => a+Number(c.valeur||0),0)/consoMois.length : 0;
    const kmPrec     = consoPrec.reduce((a,c) => a+Number(c.kilometres||0), 0);
    const litresPrec = consoPrec.reduce((a,c) => a+Number(c.litres||0), 0);
    const tendKm     = kmPrec     > 0 ? ((kmMois-kmPrec)/kmPrec*100)         : 0;
    const tendLitres = litresPrec > 0 ? ((litresMois-litresPrec)/litresPrec*100) : 0;

    // ── Graphique 6 derniers mois ────────────────────────────────────────
    const parMois = {};
    (consos||[]).forEach(c => {
      if (!c.date || !c.valeur) return;
      const m = c.date.substring(0,7);
      if (!parMois[m]) parMois[m] = { vals:[], km:0 };
      parMois[m].vals.push(Number(c.valeur));
      parMois[m].km += Number(c.kilometres||0);
    });
    const moisPts = Object.entries(parMois).sort().slice(-6).map(([m,d]) => ({
      label: moisLabels[parseInt(m.substring(5))-1],
      moy:   d.vals.reduce((a,b)=>a+b,0)/d.vals.length,
      km:    d.km
    }));

    // ── Alertes ──────────────────────────────────────────────────────────
    const champsTracteur  = ["date_ct","date_assurance","date_limiteur_vitesse","date_chronotachygraphe"];
    const champsRemorque  = ["date_ct","date_assurance"];
    const champsChauffeur = ["date_carte_conducteur","date_visite_medicale","date_fco","date_adr","date_carte_as24","date_carte_total"];
    const labelChamp = {
      date_ct:"Contrôle technique", date_assurance:"Assurance",
      date_limiteur_vitesse:"Limiteur de vitesse", date_chronotachygraphe:"Chronotachy.",
      date_carte_conducteur:"Carte conducteur", date_visite_medicale:"Visite médicale",
      date_fco:"FCO", date_adr:"ADR",
      date_carte_as24:"Carte AS24", date_carte_total:"Carte TOTAL"
    };

    const alertes = [];
    (tracteurs||[]).forEach(t => champsTracteur.forEach(c => {
      if (!t[c] || t[c] > in30) return;
      alertes.push({ type:"tracteur",  label:labelChamp[c], nom:t.plaque,              diff:Math.ceil((new Date(t[c])-now)/86400000) });
    }));
    (remorques||[]).forEach(r => champsRemorque.forEach(c => {
      if (!r[c] || r[c] > in30) return;
      alertes.push({ type:"remorque",  label:labelChamp[c], nom:r.plaque,              diff:Math.ceil((new Date(r[c])-now)/86400000) });
    }));
    (chauffeurs||[]).forEach(ch => champsChauffeur.forEach(c => {
      if (!ch[c] || ch[c] > in30) return;
      alertes.push({ type:"chauffeur", label:labelChamp[c], nom:`${ch.prenom} ${ch.nom}`, diff:Math.ceil((new Date(ch[c])-now)/86400000) });
    }));
    // Alertes engins BTP
    const champsEnginDash  = ["date_assurance","date_vgp","date_entretien"];
    const labelEnginDash   = { date_assurance:"Assurance", date_vgp:"VGP", date_entretien:"Entretien" };
    (enginsDash||[]).forEach(e => champsEnginDash.forEach(c => {
      if (!e[c] || e[c] > in30) return;
      const nom = e.numero_parc || e.numero_serie || "Engin";
      alertes.push({ type:"engin", label:labelEnginDash[c], nom, diff:Math.ceil((new Date(e[c])-now)/86400000) });
    }));
    alertes.sort((a,b) => a.diff-b.diff);
    const alertesUrgentes = alertes.filter(a => a.diff <= 7).length;

    // ── Widget calendrier échéances (mois en cours) ─────────────────────
    const moisNomsLongs = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
    const anneeCal = now.getFullYear();
    const moisCal  = now.getMonth();
    const nbJoursMois = new Date(anneeCal, moisCal + 1, 0).getDate();
    const decalageCal = (new Date(anneeCal, moisCal, 1).getDay() + 6) % 7; // lundi = colonne 0
    const graviteParJour = {};
    alertes.forEach(a => {
      const d = new Date(now.getTime() + a.diff * 86400000);
      if (d.getFullYear() === anneeCal && d.getMonth() === moisCal) {
        const j = d.getDate();
        const niveau = a.diff <= 7 ? "danger" : "warning";
        if (!graviteParJour[j] || niveau === "danger") graviteParJour[j] = niveau;
      }
    });
    let calCellsHTML = "";
    for (let i = 0; i < decalageCal; i++) calCellsHTML += `<div class="db-cal-day empty"></div>`;
    for (let j = 1; j <= nbJoursMois; j++) {
      const niveau = graviteParJour[j];
      const couleur = niveau === "danger" ? "var(--color-danger)" : "var(--color-warning)";
      calCellsHTML += `<div class="db-cal-day${j === now.getDate() ? " today" : ""}">${j}${niveau ? `<span class="db-cal-dot" style="background:${couleur};"></span>` : ""}</div>`;
    }

    // ── Échéances par type ───────────────────────────────────────────────
    const echeancesMap = {};
    const iconeType = { "date_ct":"🔧", "date_assurance":"📋", "date_limiteur_vitesse":"⏱️", "date_chronotachygraphe":"🕐" };
    (tracteurs||[]).forEach(t => champsTracteur.forEach(c => {
      if (!t[c] || t[c] > in30) return;
      if (!echeancesMap[c]) echeancesMap[c] = { label:labelChamp[c], icone:iconeType[c]||"📌", nb:0, next:null };
      echeancesMap[c].nb++;
      if (!echeancesMap[c].next || t[c] < echeancesMap[c].next) echeancesMap[c].next = t[c];
    }));
    const echeances = Object.values(echeancesMap).sort((a,b)=>a.next?.localeCompare(b.next));
    const maxEch = Math.max(...echeances.map(e=>e.nb), 1);

    // ── Cartes perso avec date dans les alertes ──────────────────────────
    const in30str = in30;
    (cartesPerso||[]).filter(c => c.date_valeur).forEach(c => {
      const diff = Math.ceil((new Date(c.date_valeur)-now)/86400000);
      if (diff > 30) return;
      const nom = c.entite_plaque || (c.chauffeur_id
        ? ((chauffeurs||[]).find(ch=>ch.id===c.chauffeur_id)||{prenom:"",nom:""}).prenom + " " +
          ((chauffeurs||[]).find(ch=>ch.id===c.chauffeur_id)||{prenom:"",nom:""}).nom
        : "—");
      alertes.push({ type:"perso", label:c.label, nom:nom.trim()||"—", diff });
    });
    alertes.sort((a,b) => a.diff-b.diff);

    // ── Donut flotte + chauffeurs + cartes perso ──────────────────────────
    const nbVehicules   = (tracteurs||[]).length + (remorques||[]).length;
    const nbEngins      = (enginsDash||[]).length;
    const nbChauffeurs  = (chauffeurs||[]).length;
    const nbCartesPerso = (cartesPerso||[]).filter(c=>c.date_valeur).length;
    const totalDocs     = nbVehicules + nbEngins + nbChauffeurs + nbCartesPerso;

    // Alertes par type
    const alertesVeh  = alertes.filter(a => a.type === "tracteur" || a.type === "remorque");
    const alertesCh   = alertes.filter(a => a.type === "chauffeur");
    const alertesPers = alertes.filter(a => a.type === "perso");

    const nbErreur = alertes.filter(a=>a.diff<=0).length;
    const nbWarn   = alertes.filter(a=>a.diff>0).length;
    const nbOk     = Math.max(0, totalDocs - nbErreur - nbWarn);
    const circ        = 2*Math.PI*46;
    const dOk         = totalDocs > 0 ? (nbOk/totalDocs)*circ : 0;
    const dWarn       = totalDocs > 0 ? (nbWarn/totalDocs)*circ : 0;
    const dErr        = totalDocs > 0 ? (nbErreur/totalDocs)*circ : 0;

    // ── Helpers graphiques ───────────────────────────────────────────────
    function sparkline(vals, color) {
      if (!vals || vals.length < 2) return "";
      const W=80, H=28, max=Math.max(...vals)*1.1||1, min=Math.max(0,Math.min(...vals)*0.9);
      const range=max-min||1;
      const xs=vals.map((_,i)=>i/(vals.length-1)*W);
      const ys=vals.map(v=>H-(v-min)/range*H);
      return `<svg viewBox="0 0 ${W} ${H}" width="80" height="28">
        <polyline points="${xs.map((x,i)=>x+','+ys[i]).join(' ')}"
          fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
      </svg>`;
    }

    function bigChart(pts) {
      if (!pts || pts.length === 0) return `<div style="color:var(--color-text-secondary);text-align:center;padding:30px;font-size:12px">Pas encore de données de consommation</div>`;
      if (pts.length === 1) return `<div style="text-align:center;padding:20px;font-size:24px;font-weight:900;color:var(--color-accent)">${pts[0].moy.toFixed(1)} L/100 · ${pts[0].label}</div>`;
      const W=500,H=130,PL=36,PR=12,PT=10,PB=28;
      const vals=pts.map(p=>p.moy);
      const maxV=Math.max(...vals)*1.15, minV=Math.max(0,Math.min(...vals)*0.85), range=maxV-minV||1;
      const xs=pts.map((_,i)=>PL+(i/(pts.length-1))*(W-PL-PR));
      const ys=pts.map(p=>PT+(1-(p.moy-minV)/range)*(H-PT-PB));
      const poly=xs.map((x,i)=>x+','+ys[i]).join(' ');
      const area=`${xs[0]},${H-PB} ${poly} ${xs[xs.length-1]},${H-PB}`;
      const grid=[0,0.5,1].map(t=>{
        const y=PT+t*(H-PT-PB), v=maxV-t*range;
        return `<line x1="${PL}" y1="${y}" x2="${W-PR}" y2="${y}" stroke="var(--color-divider)" stroke-width="1"/>
                <text x="${PL-4}" y="${y+3}" text-anchor="end" font-size="9" fill="var(--color-text-secondary)">${v.toFixed(1)}</text>`;
      });
      return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:${H}px;display:block">
        <defs><linearGradient id="dbg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--color-accent)" stop-opacity="0.25"/>
          <stop offset="100%" stop-color="var(--color-accent)" stop-opacity="0"/>
        </linearGradient></defs>
        ${grid.join('')}
        <polygon points="${area}" fill="url(#dbg)"/>
        <polyline points="${poly}" fill="none" stroke="var(--color-accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        ${xs.map((x,i)=>`<circle cx="${x}" cy="${ys[i]}" r="3.5" fill="var(--color-bg)" stroke="var(--color-accent)" stroke-width="2"/>
          <text x="${x}" y="${H-6}" text-anchor="middle" font-size="9" fill="var(--color-text-secondary)">${pts[i].label}</text>`).join('')}
      </svg>`;
    }


    // ── RENDU HTML ───────────────────────────────────────────────────────
    content.innerHTML = `

    <!-- HERO -->
    <div class="db-hero">
      <div class="db-hero-left">
        <div class="db-hero-eyebrow">VOTRE FLOTTE, SOUS CONTRÔLE</div>
        <div class="db-hero-greeting">${adminSession.prenom ? `Bonjour ${esc(adminSession.prenom)} 👋` : "Bonjour 👋"}</div>
        <div class="db-hero-sub">Voici un aperçu de votre flotte aujourd'hui.</div>
        <div class="db-hero-tagline">Gestion simplifiée.<br><span>Performance optimisée.</span></div>
        <div class="db-hero-desc">Suivez, gérez et anticipez tous vos documents et entretiens en toute sérénité.</div>
        <button class="db-hero-btn" data-nav="${alertesUrgentes > 0 ? 'alertes' : 'parc'}">
          ${alertesUrgentes > 0 ? 'Voir les alertes' : 'Voir le parc'}
          ${alertesUrgentes > 0 ? `<span class="db-hero-badge">${alertesUrgentes}</span>` : ''}
          <span>›</span>
        </button>
      </div>
      <div class="db-hero-truck">🚛</div>
    </div>

    <!-- KPI ROW -->
    <div class="db-kpis">
      <div class="db-kpi" data-nav="parc">
        <div class="db-kpi-ico" style="background:rgba(0,194,255,0.12)">🚛</div>
        <div class="db-kpi-body">
          <div class="db-kpi-lbl">VÉHICULES</div>
          <div class="db-kpi-val">${totalDocs}</div>
          <div class="db-kpi-sub">${(tracteurs||[]).length} tracteurs · ${(remorques||[]).length} remorques</div>
        </div>
      </div>
      <div class="db-kpi" data-nav="consommations">
        <div class="db-kpi-ico" style="background:rgba(34,197,94,0.12)">⛽</div>
        <div class="db-kpi-body">
          <div class="db-kpi-lbl">CONSOMMATION</div>
          <div class="db-kpi-val">${litresMois > 0 ? Math.round(litresMois).toLocaleString('fr-FR')+' L' : '—'}</div>
          <div class="db-kpi-sub">${consoMois.length} saisies ce mois</div>
        </div>
        <div class="db-kpi-spark">${sparkline(moisPts.map(p=>p.moy),'var(--color-success)')}</div>
      </div>
      <div class="db-kpi" data-nav="consommations">
        <div class="db-kpi-ico" style="background:rgba(245,158,11,0.12)">🛣️</div>
        <div class="db-kpi-body">
          <div class="db-kpi-lbl">KM CE MOIS</div>
          <div class="db-kpi-val">${kmMois > 0 ? Math.round(kmMois).toLocaleString('fr-FR') : '—'}</div>
          <div class="db-kpi-sub">${consoMois.length} saisies</div>
        </div>
        <div class="db-kpi-spark">${sparkline(moisPts.map(p=>p.km/1000),'var(--color-warning)')}</div>
      </div>
      <div class="db-kpi ${alertesUrgentes > 0 ? 'db-kpi-danger' : ''}" data-nav="alertes">
        <div class="db-kpi-ico" style="background:rgba(239,68,68,0.12)">⚠️</div>
        <div class="db-kpi-body">
          <div class="db-kpi-lbl">ALERTES URGENTES</div>
          <div class="db-kpi-val" style="${alertesUrgentes > 0 ? 'color:var(--color-danger)' : ''}">${alertesUrgentes}</div>
          <div class="db-kpi-sub">Délai &lt; 7 jours</div>
        </div>
      </div>
    </div>

    <!-- GRILLE PRINCIPALE -->
    <div class="db-widgets-grid">

      <!-- 5 dernières interventions -->
      <div class="db-card db-draggable" data-widget-id="interventions">
        <div class="db-card-hd"><span class="db-card-title">DERNIÈRES INTERVENTIONS</span><span class="db-pin" title="Déplacer">📌</span></div>
        <div class="db-card-body">
          ${(interventions||[]).length === 0
            ? `<div class="db-empty">Aucune intervention enregistrée</div>`
            : (interventions||[]).slice(0,5).map(iv => `
              <div class="db-ech-row">
                <span class="db-ech-ico">🔧</span>
                <div class="db-ech-info">
                  <div class="db-ech-lbl">${esc(iv.type||'—')}</div>
                  <div class="db-ech-nb">${esc(iv.entite_plaque||'—')}</div>
                </div>
                <span class="db-ech-date" style="color:var(--color-text-secondary)">${formatDate(iv.date)}</span>
              </div>`).join('')
          }
          <button class="db-see-more" data-nav="interventions">Voir toutes les interventions</button>
        </div>
      </div>

      <!-- Graphique stats -->
      <div class="db-card db-draggable" data-widget-id="consommation">
        <div class="db-card-hd">
          <span class="db-card-title">CONSOMMATION — ÉVOLUTION MENSUELLE</span>
          <div style="display:flex;align-items:center;gap:6px"><span class="db-card-badge">${moisPts.length} mois</span><span class="db-pin" title="Déplacer">📌</span></div>
        </div>
        <div class="db-card-body">
          <div style="padding:4px 0 8px">${bigChart(moisPts)}</div>
          <div class="db-stat-row2">
            <div class="db-stat-box">
              <div class="db-stat-box-lbl">Km parcourus</div>
              <div class="db-stat-box-val">
                ${Math.round(kmMois).toLocaleString('fr-FR')} km
                ${tendKm !== 0 ? `<span class="${tendKm<0?'db-trend-down':'db-trend-up'}">${tendKm<0?'▼':'▲'} ${Math.abs(tendKm).toFixed(1)}%</span>` : ''}
              </div>
              <div class="db-stat-box-sub">vs mois précédent</div>
            </div>
            <div class="db-stat-box">
              <div class="db-stat-box-lbl">Consommation (L)</div>
              <div class="db-stat-box-val">
                ${litresMois > 0 ? Math.round(litresMois).toLocaleString('fr-FR')+' L' : '—'}
                ${tendLitres !== 0 ? `<span class="${tendLitres<0?'db-trend-down':'db-trend-up'}">${tendLitres<0?'▼':'▲'} ${Math.abs(tendLitres).toFixed(1)}%</span>` : ''}
              </div>
              <div class="db-stat-box-sub">vs mois précédent</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Donut flotte -->
      <div class="db-card db-draggable" data-widget-id="documents">
        <div class="db-card-hd"><span class="db-card-title">DOCUMENTS FLOTTE / CHAUFFEURS</span><span class="db-pin" title="Déplacer">📌</span></div>
        <div class="db-card-body">
          <div class="db-donut-wrap">
            <svg viewBox="0 0 120 120" width="110" height="110" style="display:block;margin:0 auto">
              ${totalDocs > 0 ? `
              <circle cx="60" cy="60" r="46" fill="none" stroke="var(--color-success)" stroke-width="14"
                stroke-dasharray="${dOk.toFixed(1)} ${circ.toFixed(1)}"
                stroke-dashoffset="0" transform="rotate(-90 60 60)"/>
              <circle cx="60" cy="60" r="46" fill="none" stroke="var(--color-warning)" stroke-width="14"
                stroke-dasharray="${dWarn.toFixed(1)} ${circ.toFixed(1)}"
                stroke-dashoffset="${(-dOk).toFixed(1)}" transform="rotate(-90 60 60)"/>
              <circle cx="60" cy="60" r="46" fill="none" stroke="var(--color-danger)" stroke-width="14"
                stroke-dasharray="${dErr.toFixed(1)} ${circ.toFixed(1)}"
                stroke-dashoffset="${(-(dOk+dWarn)).toFixed(1)}" transform="rotate(-90 60 60)"/>
              ` : `<circle cx="60" cy="60" r="46" fill="none" stroke="var(--color-divider)" stroke-width="14"/>`}
              <text x="60" y="50" text-anchor="middle" font-size="18" font-weight="900" fill="var(--color-text-primary)">${totalDocs}</text>
              <text x="60" y="63" text-anchor="middle" font-size="8" fill="var(--color-text-secondary)">docs suivis</text>
            </svg>
          </div>
          <div class="db-legend">
            <div class="db-legend-item"><div class="db-legend-dot" style="background:var(--color-success)"></div><span>À jour</span><strong>${nbOk}</strong></div>
            <div class="db-legend-item"><div class="db-legend-dot" style="background:var(--color-warning)"></div><span>Bientôt (30j)</span><strong>${nbWarn}</strong></div>
            <div class="db-legend-item"><div class="db-legend-dot" style="background:var(--color-danger)"></div><span>En retard</span><strong>${nbErreur}</strong></div>
          </div>
          <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--color-divider);font-size:10px;color:var(--color-text-secondary);display:flex;flex-direction:column;gap:3px;">
            <div style="display:flex;justify-content:space-between;"><span>🚛 Véhicules</span><span>${nbVehicules}</span></div>
            <div style="display:flex;justify-content:space-between;"><span>🏗️ Engins BTP</span><span>${nbEngins}</span></div>
            <div style="display:flex;justify-content:space-between;"><span>🧑‍✈️ Chauffeurs</span><span>${nbChauffeurs}</span></div>
            <div style="display:flex;justify-content:space-between;"><span>📋 Cartes perso</span><span>${nbCartesPerso}</span></div>
          </div>
          <button class="db-see-more" data-nav="alertes">Voir toutes les alertes</button>
        </div>
      </div>



      <!-- Calendrier échéances -->
      <div class="db-card db-draggable" data-widget-id="calendrier">
        <div class="db-card-hd"><span class="db-card-title">📅 ÉCHÉANCES — ${moisNomsLongs[moisCal].toUpperCase()}</span><span class="db-pin" title="Déplacer">📌</span></div>
        <div class="db-card-body">
          <div class="db-cal-weekdays"><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span><span>D</span></div>
          <div class="db-cal-grid">${calCellsHTML}</div>
          <div class="db-cal-legend">
            <span><span class="db-cal-dot" style="background:var(--color-danger);"></span> ≤ 7 jours</span>
            <span><span class="db-cal-dot" style="background:var(--color-warning);"></span> ≤ 30 jours</span>
          </div>
          <button class="db-see-more" data-nav="alertes">Voir toutes les alertes</button>
        </div>
      </div>

      <!-- Top 5 chauffeurs conso -->
      <div class="db-card db-draggable" data-widget-id="top-chauffeurs">
        <div class="db-card-hd">
          <span class="db-card-title">🏆 TOP CHAUFFEURS — L/100 CE MOIS</span>
          <div style="display:flex;align-items:center;gap:6px"><span class="db-card-badge">${moisPts.length > 0 ? moisPts[moisPts.length-1].label : '—'}</span><span class="db-pin" title="Déplacer">📌</span></div>
        </div>
        <div class="db-card-body" id="db-top-chauffeurs-body">
          <div class="admin-loading" style="padding:20px 0"></div>
        </div>
      </div>

      <!-- Attelages du jour -->
      <div class="db-card db-draggable" data-widget-id="attelages">
        <div class="db-card-hd">
          <span class="db-card-title">ATTELAGES DU JOUR</span>
          <div style="display:flex;align-items:center;gap:6px"><span class="db-card-badge">${(sessions||[]).filter(s=>s.plaque_tracteur).length} actif(s)</span><span class="db-pin" title="Déplacer">📌</span></div>
        </div>
        <div class="db-card-body">
          ${(sessions||[]).filter(s=>s.plaque_tracteur).length === 0
            ? `<div class="db-empty">Aucun attelage actif aujourd'hui</div>`
            : (() => {
                const chMap = {};
                (chauffeurs||[]).forEach(c => { chMap[c.id] = c.prenom+' '+c.nom; });
                return (sessions||[]).filter(s=>s.plaque_tracteur).map(s => `
                  <div class="db-att-row">
                    <div class="db-att-driver">
                      <span class="db-att-ico">🧑‍✈️</span>
                      <span class="db-att-name">${esc(chMap[s.chauffeur_id]||'—')}</span>
                    </div>
                    <div class="db-att-vehicles">
                      <span class="db-att-truck">🚛 ${esc(s.plaque_tracteur)}</span>
                      ${s.plaque_remorque ? `<span class="db-att-rem">+ ${esc(s.plaque_remorque)}</span>` : '<span class="db-att-solo">Solo</span>'}
                    </div>
                  </div>`).join('');
              })()
          }
          <button class="db-see-more" data-nav="historique-attelages">Voir l'historique →</button>
        </div>
      </div>

    </div>`;

    // Widget top chauffeurs — calculé séparément pour éviter les template literals imbriqués
    const topBody = document.getElementById("db-top-chauffeurs-body");
    if (topBody) {
      const chMap2 = {};
      (chauffeurs||[]).forEach(c => { chMap2[c.id] = c.prenom + " " + c.nom; });
      const parCh = {};
      consoMois.filter(c => c.chauffeur_id && Number(c.valeur) > 0).forEach(c => {
        if (!parCh[c.chauffeur_id]) parCh[c.chauffeur_id] = { vals:[], km:0 };
        parCh[c.chauffeur_id].vals.push(Number(c.valeur));
        parCh[c.chauffeur_id].km += Number(c.kilometres||0);
      });
      const classement = Object.entries(parCh)
        .map(([id, d]) => ({
          nom: chMap2[id] || "—",
          moy: d.vals.reduce((a,b)=>a+b,0)/d.vals.length,
          nb:  d.vals.length,
          km:  d.km
        }))
        .filter(c => c.moy > 0)
        .sort((a,b) => a.moy - b.moy)
        .slice(0, 5);

      if (classement.length === 0) {
        topBody.innerHTML = '<div class="db-empty">Pas encore de saisies ce mois</div>';
      } else {
        const medals = ["🥇","🥈","🥉","4️⃣","5️⃣"];
        const maxMoy = Math.max(...classement.map(c=>c.moy));
        topBody.innerHTML = classement.map((c, i) => {
          const barPct = Math.round((c.moy / maxMoy) * 100);
          const color  = i===0 ? "var(--color-success)" : i===1 ? "var(--color-accent)" : i===2 ? "var(--color-warning)" : "var(--color-text-secondary)";
          return "<div class='db-top-row'>" +
            "<span class='db-top-medal'>" + medals[i] + "</span>" +
            "<div class='db-top-info'>" +
              "<div class='db-top-name'>" + esc(c.nom) + "</div>" +
              "<div class='db-ech-bar-wrap' style='width:100%;margin-top:4px'>" +
                "<div class='db-ech-bar' style='width:" + barPct + "%;background:" + color + "'></div>" +
              "</div>" +
            "</div>" +
            "<div class='db-top-stats'>" +
              "<span class='db-top-val' style='color:" + color + "'>" + c.moy.toFixed(1) + " L/100</span>" +
              "<span class='db-top-sub'>" + c.nb + " saisie" + (c.nb>1?"s":"") + " · " + Math.round(c.km).toLocaleString("fr-FR") + " km</span>" +
            "</div>" +
          "</div>";
        }).join("");
      }
    }

    // Listeners — ES modules ne supportent pas onclick inline
    content.querySelectorAll("[data-nav]").forEach(el => {
      el.style.cursor = "pointer";
      el.addEventListener("click", () => navigateTo(el.dataset.nav));
    });


    // ── DISPOSITION PERSONNALISABLE — boutons ↑ ↓ ──────────────────────
    const DB_LAYOUT_KEY = "memotruck_dashboard_layout_" + adminSession.entreprise_id;

    function saveLayout() {
      const grid = content.querySelector(".db-widgets-grid");
      if (!grid) return;
      const widgets = [];
      grid.querySelectorAll(":scope > .db-draggable").forEach(function(w) { widgets.push(w.dataset.widgetId); });
      localStorage.setItem(DB_LAYOUT_KEY, JSON.stringify(widgets));
    }

    function applyLayout() {
      try {
        const saved = localStorage.getItem(DB_LAYOUT_KEY);
        if (!saved) return;
        const grid    = content.querySelector(".db-widgets-grid");
        if (!grid) return;
        const widgets = JSON.parse(saved);
        widgets.forEach(function(id) {
          const w = grid.querySelector('[data-widget-id="' + id + '"]');
          if (w) grid.appendChild(w);
        });
      } catch(_) {}
    }

    function moveWidget(card, direction) {
      const parent   = card.parentNode;
      const siblings = Array.from(parent.querySelectorAll(":scope > .db-draggable"));
      const idx      = siblings.indexOf(card);
      if (direction === "up" && idx > 0) {
        parent.insertBefore(card, siblings[idx - 1]);
      } else if (direction === "down" && idx < siblings.length - 1) {
        parent.insertBefore(siblings[idx + 1], card);
      } else {
        return; // Pas de mouvement possible
      }
      saveLayout();
      card.style.transition = "box-shadow 0.3s";
      card.style.boxShadow  = "0 0 0 2px var(--color-accent)";
      setTimeout(function() { card.style.boxShadow = ""; card.style.transition = ""; }, 400);
    }

    applyLayout();

    // Injecter les boutons ↑↓ dans chaque punaise
    content.querySelectorAll(".db-draggable").forEach(function(card) {
      const pin = card.querySelector(".db-pin");
      if (!pin) return;

      const btnUp   = document.createElement("button");
      const btnDown = document.createElement("button");
      btnUp.textContent   = "↑";
      btnDown.textContent = "↓";
      btnUp.className   = "db-move-btn";
      btnDown.className = "db-move-btn";
      btnUp.title   = "Monter ce widget";
      btnDown.title = "Descendre ce widget";

      btnUp.addEventListener("click",   function(e) { e.stopPropagation(); moveWidget(card, "up");   });
      btnDown.addEventListener("click", function(e) { e.stopPropagation(); moveWidget(card, "down"); });

      // Créer un wrapper groupé pour les 2 boutons
      const btnWrap = document.createElement("div");
      btnWrap.style.cssText = "display:flex;align-items:center;gap:3px;flex-shrink:0;";
      btnWrap.appendChild(btnUp);
      btnWrap.appendChild(btnDown);

      // Remplacer la punaise par le wrapper
      pin.replaceWith(btnWrap);
    });

    const resetBtn = document.createElement("button");
    resetBtn.textContent = "\u21BA R\u00e9initialiser la disposition";
    resetBtn.className = "db-reset-layout";
    resetBtn.addEventListener("click", function() {
      localStorage.removeItem(DB_LAYOUT_KEY);
      navigateTo("dashboard");
    });
    content.appendChild(resetBtn);

  } catch(e) {
    content.innerHTML = '<div class="admin-empty"><div class="icon">\u26A0\uFE0F</div><div class="text">Erreur : ' + e.message + '</div></div>';
    console.error("[dashboard]", e);
  }
}

// ════════════════════════════════════════════════════════════════════════
// SECTION — ALERTES & ÉCHÉANCES
// ════════════════════════════════════════════════════════════════════════

async function renderAlertes() {
  const content = document.getElementById("admin-content");
  try {
    const now    = new Date();
    const in30   = new Date(now.getTime()+30*86400000).toISOString().substring(0,10);
    const todayS = now.toISOString().substring(0,10);

    const [chauffeurs, tracteurs, remorques, engins] = await Promise.all([
      dbSelect("chauffeurs", { filters:[{ col:"entreprise_id", op:"eq", val:adminSession.entreprise_id }] }),
      dbSelect("tracteurs",  { filters:[{ col:"entreprise_id", op:"eq", val:adminSession.entreprise_id }] }),
      dbSelect("remorques",  { filters:[{ col:"entreprise_id", op:"eq", val:adminSession.entreprise_id }] }),
      dbSelect("engins",     { select:"numero_parc,numero_serie,date_assurance,date_vgp,date_entretien",
                               filters:[{ col:"entreprise_id", op:"eq", val:adminSession.entreprise_id }] }).catch(()=>[])
    ]);

    // ── Collecter toutes les alertes ─────────────────────────────────────
    const alertes = [];

    const champsCH = [
      { c:"date_carte_conducteur", l:"Carte conducteur" },
      { c:"date_visite_medicale",  l:"Visite médicale" },
      { c:"date_fco",              l:"FCO" },
      { c:"date_adr",              l:"ADR" },
      { c:"date_carte_as24",       l:"Carte AS24" },
      { c:"date_carte_total",      l:"Carte TOTAL" }
    ];
    const champsT = [
      { c:"date_ct",                  l:"Contrôle technique" },
      { c:"date_assurance",           l:"Assurance" },
      { c:"date_limiteur_vitesse",    l:"Limiteur de vitesse" },
      { c:"date_chronotachygraphe",   l:"Chronotachygraphe" }
    ];
    const champsR = [
      { c:"date_ct",       l:"Contrôle technique" },
      { c:"date_assurance",l:"Assurance" }
    ];

    (chauffeurs||[]).forEach(ch => champsCH.forEach(({ c, l }) => {
      if (!ch[c] || ch[c] > in30) return;
      const diff = Math.ceil((new Date(ch[c])-now)/86400000);
      alertes.push({ type:"chauffeur", label:l, nom:`${ch.prenom} ${ch.nom}`, date:ch[c], diff });
    }));
    (tracteurs||[]).forEach(t => champsT.forEach(({ c, l }) => {
      if (!t[c] || t[c] > in30) return;
      const diff = Math.ceil((new Date(t[c])-now)/86400000);
      alertes.push({ type:"tracteur", label:l, nom:t.plaque, date:t[c], diff });
    }));
    (remorques||[]).forEach(r => champsR.forEach(({ c, l }) => {
      if (!r[c] || r[c] > in30) return;
      const diff = Math.ceil((new Date(r[c])-now)/86400000);
      alertes.push({ type:"remorque", label:l, nom:r.plaque, date:r[c], diff });
    }));
    // Alertes engins BTP dans renderAlertes
    const champsEngin = [
      { c:"date_assurance", l:"Assurance"  },
      { c:"date_vgp",       l:"VGP"        },
      { c:"date_entretien", l:"Entretien périodique" }
    ];
    (engins||[]).forEach(e => champsEngin.forEach(({ c, l }) => {
      if (!e[c] || e[c] > in30) return;
      const diff = Math.ceil((new Date(e[c])-now)/86400000);
      const nom  = e.numero_parc || e.numero_serie || "Engin";
      alertes.push({ type:"engin", label:l, nom, date:e[c], diff });
    }));

    alertes.sort((a,b) => a.diff-b.diff);

    const urgentes  = alertes.filter(a => a.diff <= 0);
    const critiques = alertes.filter(a => a.diff > 0 && a.diff <= 7);
    const attention = alertes.filter(a => a.diff > 7 && a.diff <= 15);
    const bientot   = alertes.filter(a => a.diff > 15);

    function typeIcon(type) {
      return type==="chauffeur" ? "🧑‍✈️" : type==="tracteur" ? "🚛" : type==="engin" ? "🏗️" : "🔗";
    }

    function alerteRow(a) {
      const color = a.diff<=0 ? "var(--color-danger)" : a.diff<=7 ? "var(--color-danger)" : a.diff<=15 ? "var(--color-warning)" : "var(--color-text-secondary)";
      const delai = a.diff<=0 ? `Expiré il y a ${-a.diff}j` : a.diff===1 ? "Demain" : `Dans ${a.diff}j`;
      return `<div class="al-row">
        <div class="al-row-icon">${typeIcon(a.type)}</div>
        <div class="al-row-info">
          <div class="al-row-label">${esc(a.label)}</div>
          <div class="al-row-nom">${esc(a.nom)}</div>
        </div>
        <div class="al-row-date">${formatDate(a.date)}</div>
        <div class="al-row-delai" style="color:${color}">${delai}</div>
      </div>`;
    }

    function alerteGroup(title, list, color, icon) {
      if (!list.length) return "";
      return `<div class="al-group">
        <div class="al-group-header" style="color:${color}">
          <span>${icon}</span>
          <span>${title}</span>
          <span class="al-group-count">${list.length}</span>
        </div>
        <div class="al-group-body">${list.map(alerteRow).join("")}</div>
      </div>`;
    }

    content.innerHTML = `
      <!-- Stats alertes -->
      <div class="admin-stats-row" style="margin-bottom:24px">
        <div class="admin-stat-card" style="--stat-color:var(--color-danger)">
          <div class="admin-stat-value">${urgentes.length}</div>
          <div class="admin-stat-label">Expirés</div>
        </div>
        <div class="admin-stat-card" style="--stat-color:var(--color-danger)">
          <div class="admin-stat-value">${critiques.length}</div>
          <div class="admin-stat-label">Critiques (≤7j)</div>
        </div>
        <div class="admin-stat-card" style="--stat-color:var(--color-warning)">
          <div class="admin-stat-value">${attention.length}</div>
          <div class="admin-stat-label">À surveiller (≤15j)</div>
        </div>
        <div class="admin-stat-card" style="--stat-color:var(--color-success)">
          <div class="admin-stat-value">${bientot.length}</div>
          <div class="admin-stat-label">Bientôt (≤30j)</div>
        </div>
      </div>

      ${alertes.length === 0
        ? `<div class="admin-empty" style="padding:80px 0">
            <div class="icon">✅</div>
            <div class="text" style="font-size:16px;font-weight:700;color:var(--color-text-primary)">Aucune alerte dans les 30 prochains jours</div>
            <div class="text" style="margin-top:6px">Tous vos documents et échéances sont à jour.</div>
          </div>`
        : `<div class="al-wrap">
            ${alerteGroup("Documents expirés", urgentes, "var(--color-danger)", "🚨")}
            ${alerteGroup("Critiques — moins de 7 jours", critiques, "var(--color-danger)", "⚠️")}
            ${alerteGroup("À surveiller — moins de 15 jours", attention, "var(--color-warning)", "🔔")}
            ${alerteGroup("Bientôt — moins de 30 jours", bientot, "var(--color-text-secondary)", "📅")}
          </div>`
      }
    `;

  } catch(e) {
    content.innerHTML = `<div class="admin-empty"><div class="icon">⚠️</div><div class="text">Erreur : ${e.message}</div></div>`;
    console.error("[alertes]", e);
  }
}

// ════════════════════════════════════════════════════════════════════════
// SECTION — INSCRIPTIONS EN ATTENTE
// ════════════════════════════════════════════════════════════════════════

async function renderInscriptions() {
  const content = document.getElementById("admin-content");
  try {
    const rows = await dbSelect("chauffeurs", {
      select: "id,prenom,nom,email,plaque_tracteur,plaque_remorque,created_at,est_valide",
      filters: [
        { col: "entreprise_id", op: "eq", val: adminSession.entreprise_id },
        { col: "est_valide",    op: "eq", val: "false" }
      ],
      order: { col: "created_at", asc: false }
    });

    // Badge nav
    const badge = document.getElementById("nav-badge-inscriptions");
    if (rows.length > 0) {
      badge.textContent = rows.length;
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }

    if (rows.length === 0) {
      content.innerHTML = `
        <div class="admin-empty">
          <div class="icon">✅</div>
          <div class="text">Aucune inscription en attente</div>
        </div>`;
      return;
    }

    content.innerHTML = `
      <div class="admin-table-wrap">
        <div class="admin-table-title">
          <span>${rows.length} inscription(s) en attente</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>NOM</th>
              <th>EMAIL</th>
              <th>TRACTEUR</th>
              <th>REMORQUE</th>
              <th>DATE</th>
              <th>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r) => `
              <tr>
                <td><strong>${esc(r.prenom)} ${esc(r.nom)}</strong></td>
                <td>${esc(r.email)}</td>
                <td>${esc(r.plaque_tracteur) || "—"}</td>
                <td>${esc(r.plaque_remorque) || "—"}</td>
                <td>${formatDate(r.created_at)}</td>
                <td>
                  <button class="btn-valider" data-id="${r.id}" data-email="${esc(r.email)}">✅ Valider</button>
                  <button class="btn-rejeter" data-id="${r.id}" data-email="${esc(r.email)}">❌ Rejeter</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;

    // Listeners
    content.querySelectorAll(".btn-valider").forEach((btn) => {
      btn.addEventListener("click", () => validerChauffeur(btn.dataset.id, btn.dataset.email));
    });
    content.querySelectorAll(".btn-rejeter").forEach((btn) => {
      btn.addEventListener("click", () => rejeterChauffeur(btn.dataset.id, btn.dataset.email));
    });

  } catch (e) {
    content.innerHTML = `<div class="admin-empty"><div class="text">📡 Erreur de chargement</div></div>`;
  }
}

async function validerChauffeur(id, email) {
  showModal({
    title: "Valider ce chauffeur ?",
    bodyHTML: `<p style="color:var(--color-text-secondary);font-size:14px;">
      Le chauffeur <strong style="color:var(--color-text-primary);">${esc(email)}</strong>
      pourra se connecter à l'application dès validation.
    </p>`,
    confirmLabel: "✅ Valider",
    onConfirm: async () => {
      await dbUpdate("chauffeurs", { est_valide: true }, [{ col: "id", op: "eq", val: id }]);
      showToast("✅ Chauffeur validé !");
      logActiviteEntreprise("valider_chauffeur", `Chauffeur ${email} validé`);
      renderInscriptions();
    }
  });
}

async function rejeterChauffeur(id, email) {
  showModal({
    title: "Rejeter cette inscription ?",
    bodyHTML: `<p style="color:var(--color-text-secondary);font-size:14px;">
      Le compte de <strong style="color:var(--color-text-primary);">${esc(email)}</strong>
      sera supprimé définitivement.
    </p>`,
    confirmLabel: "❌ Supprimer",
    danger: true,
    onConfirm: async () => {
      await dbDelete("chauffeurs", [{ col: "id", op: "eq", val: id }]);
      showToast("🗑️ Inscription supprimée");
      logActiviteEntreprise("rejeter_chauffeur", `Inscription de ${email} rejetée`);
      renderInscriptions();
    }
  });
}

// ════════════════════════════════════════════════════════════════════════
// SECTION — CHAUFFEURS
// ════════════════════════════════════════════════════════════════════════

async function renderChauffeurs() {
  const content = document.getElementById("admin-content");
  try {
    const [chauffeurs, tracteurs, remorques] = await Promise.all([
      dbSelect("chauffeurs", {
        select: "id,prenom,nom,email,adresse,telephone,plaque_tracteur,plaque_remorque,est_valide,date_carte_conducteur,date_visite_medicale,date_fco,date_adr,date_carte_identite,date_carte_as24,date_carte_total",
        filters: [{ col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }],
        order: { col: "nom", asc: true }
      }),
      dbSelect("tracteurs", {
        select: "plaque",
        filters: [{ col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }],
        order: { col: "plaque", asc: true }
      }),
      dbSelect("remorques", {
        select: "plaque",
        filters: [{ col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }],
        order: { col: "plaque", asc: true }
      })
    ]);

    const valides = chauffeurs.filter((c) => c.est_valide);
    const attente = chauffeurs.filter((c) => !c.est_valide);

    // Alertes chauffeurs
    const alertesC = collecterAlertesChaufferus(valides);
    _alertesCache.chauffeurs = alertesC;
    mettreAJourBadgesNav(alertesC, _alertesCache.vehicules, _alertesCache.engins);

    const tableHTML = `
      <div class="admin-stats-row">
        <div class="admin-stat-card" style="--stat-color:var(--color-success);">
          <div class="admin-stat-value">${valides.length}</div>
          <div class="admin-stat-label">Chauffeurs actifs</div>
        </div>
        <div class="admin-stat-card" style="--stat-color:var(--color-warning);">
          <div class="admin-stat-value">${attente.length}</div>
          <div class="admin-stat-label">En attente</div>
        </div>
        <div class="admin-stat-card" style="--stat-color:var(--color-danger);">
          <div class="admin-stat-value">${alertesC.filter(a => a.rang >= 3).length}</div>
          <div class="admin-stat-label">Docs expirés</div>
        </div>
        <div class="admin-stat-card" style="--stat-color:var(--color-warning);">
          <div class="admin-stat-value">${alertesC.filter(a => a.rang === 2).length}</div>
          <div class="admin-stat-label">Urgents (&lt;15j)</div>
        </div>
      </div>
      <div class="admin-table-wrap">
        <div class="admin-table-title">
          <span>Tous les chauffeurs</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>NOM</th><th>EMAIL</th><th>TRACTEUR</th><th>REMORQUE</th>
              <th>🟢 EN SERVICE</th><th>STATUT DOCS</th><th>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            ${chauffeurs.map((c) => {
              const session     = sessionsActives[c.id];
              const sessPlaqueT = session ? (session.plaque_tracteur || "—") : "—";
              const sessPlaqueR = session ? (session.plaque_remorque || "") : "";
              const alerteT     = session && session.plaque_tracteur && c.plaque_tracteur
                && session.plaque_tracteur !== c.plaque_tracteur
                ? `<span title="En service sur ${session.plaque_tracteur}" style="color:var(--color-warning);margin-left:4px;">⚠️</span>`
                : "";
              const enServiceStr = session
                ? `<span style="color:var(--color-success);font-weight:700;">🚚 ${esc(sessPlaqueT)}</span>${sessPlaqueR ? `<br><span style="color:var(--color-success);font-weight:700;">🚛 ${esc(sessPlaqueR)}</span>` : `<br><span style="color:var(--color-text-secondary);font-size:12px;">Solo</span>`}`
                : `<span style="color:var(--color-text-secondary);">—</span>`;
              const DOCS_KEYS = ["date_carte_conducteur","date_visite_medicale","date_fco","date_adr","date_carte_as24","date_carte_total"];
              let pireRang = 0;
              DOCS_KEYS.forEach(k => { const st = alerteStatut(c[k]); if (st && st.rang > pireRang) pireRang = st.rang; });
              const statut = alerteStatutLabel(pireRang);
              return `
              <tr>
                <td><span class="chauffeur-nom-link" data-chauffeur-id="${c.id}" style="font-weight:700;color:var(--color-accent);cursor:pointer;text-decoration:underline;text-underline-offset:2px;">${esc(c.prenom)} ${esc(c.nom)}</span></td>
                <td>${esc(c.email)}</td>
                <td>${esc(c.plaque_tracteur) || "—"}${alerteT}</td>
                <td>${esc(c.plaque_remorque) || "—"}</td>
                <td>${enServiceStr}</td>
                <td><span class="alert-icon ${statut.classe}">${statut.txt}</span></td>
                <td><button class="btn-edit" data-id="${c.id}" data-tracteur="${esc(c.plaque_tracteur)}" data-remorque="${esc(c.plaque_remorque)}" data-nom="${esc(c.prenom)} ${esc(c.nom)}">✏️ Affecter</button></td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>`;

    content.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:16px;">
        <div style="display:flex;gap:20px;align-items:flex-start;">
          <div style="flex:1;min-width:0;">${tableHTML}</div>
          <div id="detail-panel" style="width:300px;flex-shrink:0;display:none;"></div>
        </div>
      </div>`;

    content.querySelectorAll(".btn-edit").forEach((btn) => {
      btn.addEventListener("click", () => {
        ouvrirModalAffectation(btn.dataset.id, btn.dataset.nom, btn.dataset.tracteur, btn.dataset.remorque, tracteurs, remorques);
      });
    });

    content.querySelectorAll(".chauffeur-nom-link").forEach((el) => {
      el.addEventListener("click", () => ouvrirDetailChauffeur(el.dataset.chauffeurId, chauffeurs));
    });

    attachAlerteBandeauListeners(chauffeurs);

  } catch (e) {
    content.innerHTML = `<div class="admin-empty"><div class="text">📡 Erreur de chargement</div></div>`;
  }
}


function ouvrirModalAffectation(chauffeurId, nom, tracteurActuel, remorqueActuelle, tracteurs, remorques) {
  const tracteurOptions = tracteurs.map((t) =>
    `<option value="${t.plaque}" ${t.plaque === tracteurActuel ? "selected" : ""}>${t.plaque}</option>`
  ).join("");

  const remorqueOptions = `<option value="" ${!remorqueActuelle ? "selected" : ""}>— Aucune (Solo) —</option>` +
    remorques.map((r) =>
      `<option value="${r.plaque}" ${r.plaque === remorqueActuelle ? "selected" : ""}>${r.plaque}</option>`
    ).join("");

  showModal({
    title: `Affecter un véhicule — ${esc(nom)}`,
    bodyHTML: `
      <div style="margin-bottom:16px;">
        <label style="display:block;font-size:12px;font-weight:700;color:var(--color-text-secondary);letter-spacing:1px;margin-bottom:8px;">TRACTEUR</label>
        <select id="modal-tracteur" class="admin-select" style="width:100%;">
          <option value="">— Aucun —</option>
          ${tracteurOptions}
        </select>
      </div>
      <div>
        <label style="display:block;font-size:12px;font-weight:700;color:var(--color-text-secondary);letter-spacing:1px;margin-bottom:8px;">REMORQUE</label>
        <select id="modal-remorque" class="admin-select" style="width:100%;">
          ${remorqueOptions}
        </select>
      </div>
    `,
    confirmLabel: "Enregistrer",
    onConfirm: async (body) => {
      const plaqueT = body.querySelector("#modal-tracteur").value;
      const plaqueR = body.querySelector("#modal-remorque").value;

      // Met à jour le profil chauffeur
      await dbUpdate("chauffeurs",
        { plaque_tracteur: plaqueT, plaque_remorque: plaqueR },
        [{ col: "id", op: "eq", val: chauffeurId }]
      );

      // Met à jour sessions_actives → déclenche le Realtime dans la PWA
      try {
        await dbUpsert("sessions_actives", {
          chauffeur_id:    chauffeurId,
          entreprise_id:   adminSession.entreprise_id,
          plaque_tracteur: plaqueT,
          plaque_remorque: plaqueR
        }, "chauffeur_id");
        showToast("✅ Véhicule affecté ! (session: " + plaqueT + ")");
      } catch(e) {
        console.error("[admin] sessions_actives upsert FAIL:", e);
        showToast("⚠️ Affectation OK mais session non mise à jour: " + e.message);
      }
      renderChauffeurs();
    }
  });
}

// ════════════════════════════════════════════════════════════════════════
// SECTION — PARC VÉHICULES
// ════════════════════════════════════════════════════════════════════════

function formatProfil(profil) {
  if (!profil) return "—";
  const p = getProfilVehicule(profil);
  if (p) return p.label + (p.entreprise_id ? " (perso)" : "");

  // Secours si le cache profils_vehicules n'est pas encore chargé (ou si le
  // profil a été désactivé/supprimé depuis) — anciens libellés codés en dur.
  const labels = {
    "tracteur_4x2":    "Tracteur 4×2",
    "tracteur_6x2":    "Tracteur 6×2",
    "tracteur_6x4":    "Tracteur 6×4",
    "porteur_19t":     "Porteur 19t",
    "porteur_26t":     "Porteur 26t",
    "porteur_32t":     "Porteur 32t",
    "porteur_32t_8x4": "Porteur 32t 8×4",
    "remorque_1e":     "Remorque 1 essieu",
    "remorque_2e":     "Remorque 2 essieux",
    "remorque_3e":     "Remorque 3 essieux",
    "porte_char_4e":   "Porte-char 4 essieux",
    "porte_char_5e":   "Porte-char 5 essieux",
    "porte_char_6e":   "Porte-char 6 essieux",
    "citerne_alim_2c": "Citerne alimentaire 2 compartiments",
    "citerne_alim_3c": "Citerne alimentaire 3 compartiments",
    "citerne_alim_4c": "Citerne alimentaire 4 compartiments",
    "citerne_alim_5c": "Citerne alimentaire 5 compartiments",
    "citerne_alim_6c": "Citerne alimentaire 6 compartiments",
    "remorque_frigo_2e": "Remorque frigorifique 2 essieux",
    "remorque_frigo_3e": "Remorque frigorifique 3 essieux"
  };
  return labels[profil] || (profil ? profil.replace(/_/g," ").replace(/\b\w/g, c => c.toUpperCase()) : "—");
}

async function renderParc() {
  const content = document.getElementById("admin-content");
  try {
    const [tracteurs, remorques, cartesVehicules, entrepriseRows] = await Promise.all([
      dbSelect("tracteurs", {
        select: "plaque,marque,modele,profil,date_ct,date_assurance,date_limiteur_vitesse,date_chronotachygraphe,date_entretien_frigo,date_nettoyage_interieur,date_hayon,a_hayon",
        filters: [{ col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }],
        order: { col: "plaque", asc: true }
      }),
      dbSelect("remorques", {
        select: "plaque,marque,modele,profil,date_ct,date_assurance,date_entretien_frigo,date_nettoyage_interieur,date_graissage,date_hayon,a_hayon",
        filters: [{ col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }],
        order: { col: "plaque", asc: true }
      }),
      dbSelect("cartes_perso", {
        select: "entite_type,entite_plaque,label,date_valeur,a_date",
        filters: [{ col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }],
        order: { col: "ordre", asc: true }
      }).catch(() => []),
      dbSelect("entreprises", {
        select: "profils_autorises",
        filters: [{ col: "id", op: "eq", val: adminSession.entreprise_id }]
      }).catch(() => [])
    ]);
    const profilsAutorises = (entrepriseRows && entrepriseRows[0]?.profils_autorises) || [];

    // Alertes véhicules
    const alertesV = collecterAlertesVehicules(tracteurs || [], remorques || []);
    _alertesCache.vehicules = alertesV;
    mettreAJourBadgesNav(_alertesCache.chauffeurs, alertesV, _alertesCache.engins);

    // Groupe les cartes perso par plaque véhicule
    const cartesParPlaque = {};
    (cartesVehicules || []).forEach(c => {
      if (!c.entite_plaque) return;
      if (!cartesParPlaque[c.entite_plaque]) cartesParPlaque[c.entite_plaque] = [];
      cartesParPlaque[c.entite_plaque].push(c);
    });

    function dateCell(iso) {
      if (!iso) return `<span style="color:var(--color-text-secondary);">—</span>`;
      const diff = Math.floor((new Date(iso) - Date.now()) / 86400000);
      const color = diff < 0 ? "var(--color-danger)" : diff < 15 ? "var(--color-warning)" : diff < 60 ? "var(--color-warning-soft)" : "var(--color-success)";
      return `<span style="color:${color};font-weight:600;">${formatDate(iso)}</span>`;
    }

    content.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:16px;">
        <div style="display:flex;gap:20px;align-items:flex-start;">
        <div style="flex:1;min-width:0;">
      <div class="admin-stats-row">
        <div class="admin-stat-card" style="--stat-color:var(--color-accent);">
          <div class="admin-stat-value">${tracteurs.length}</div>
          <div class="admin-stat-label">Tracteurs</div>
        </div>
        <div class="admin-stat-card" style="--stat-color:var(--color-purple);">
          <div class="admin-stat-value">${remorques.length}</div>
          <div class="admin-stat-label">Remorques</div>
        </div>
      </div>

      <div style="display:flex;justify-content:flex-end;margin-bottom:4px;">
        <button class="btn-ajouter" id="btn-profils-perso" style="background:transparent;border:1.5px solid var(--color-divider);color:var(--color-text-primary);">⚙️ Mes profils perso</button>
      </div>

      <!-- Tracteurs -->
      <div class="admin-table-wrap" style="margin-bottom:24px;">
        <div class="admin-table-title">
          <span>🚚 Tracteurs</span>
          <div style="display:flex;gap:8px;">
            <button class="btn-ajouter" id="btn-ajouter-tracteur">+ Ajouter</button>
          </div>
        </div>
        <table>
          <thead>
            <tr><th>PLAQUE</th><th>PROFIL</th><th>MARQUE / MODÈLE</th><th>CONTRÔLE TECHNIQUE</th><th>ASSURANCE</th><th>LIMITEUR</th><th>CHRONO</th><th>ENTRETIEN FRIGO / NETTOYAGE INTÉRIEUR</th><th>HAYON</th><th>CARTES PERSO</th><th>DOCUMENTS</th><th>MODIFIER/SUPPRIMER</th></tr>
          </thead>
          <tbody>
            ${tracteurs.length === 0
              ? `<tr><td colspan="12" style="text-align:center;color:var(--color-text-secondary);padding:24px;">Aucun tracteur</td></tr>`
              : tracteurs.map((t) => {
                const cartes = (cartesParPlaque[t.plaque] || []).filter(c => c.a_date);
                const cartesHTML = cartes.length
                  ? cartes.map(c => `<div style="font-size:11px;">${esc(c.label)} : ${dateCell(c.date_valeur)}</div>`).join("")
                  : `<span style="color:var(--color-text-secondary);font-size:11px;">—</span>`;
                const docsT = getProfilVehicule(t.profil)?.docs || [];
                const cellVideT = `<span style="color:var(--color-text-secondary);">—</span>`;
                const frigoNettoyageCellT = docsT.includes("frigo")
                  ? `<td style="padding:4px 8px;">
                       <div style="cursor:pointer;margin-bottom:4px;" data-edit-vehicule="tracteur" data-plaque="${esc(t.plaque)}" data-champ="date_entretien_frigo" data-val="${t.date_entretien_frigo||""}" data-label="Entretien Groupe Frigo">
                         🧊 ${dateCell(t.date_entretien_frigo)} <span style="font-size:10px;color:var(--color-accent);">✏️</span>
                       </div>
                       <div style="cursor:pointer;" data-edit-vehicule="tracteur" data-plaque="${esc(t.plaque)}" data-champ="date_nettoyage_interieur" data-val="${t.date_nettoyage_interieur||""}" data-label="Nettoyage Intérieur">
                         🧽 ${dateCell(t.date_nettoyage_interieur)} <span style="font-size:10px;color:var(--color-accent);">✏️</span>
                       </div>
                     </td>`
                  : `<td>${cellVideT}</td>`;
                const hayonCellT = t.a_hayon
                  ? `<td style="cursor:pointer;" data-edit-vehicule="tracteur" data-plaque="${esc(t.plaque)}" data-champ="date_hayon" data-val="${t.date_hayon||""}" data-label="Hayon">${dateCell(t.date_hayon)} <span style="font-size:10px;color:var(--color-accent);">✏️</span></td>`
                  : `<td>${cellVideT}</td>`;
                return `
                <tr>
                  <td><strong>${esc(t.plaque)}</strong></td>
                  <td style="font-size:12px;color:var(--color-accent);font-weight:600;cursor:pointer;" data-edit-profil="tracteur" data-plaque="${esc(t.plaque)}" data-profil="${esc(t.profil)}">
                    ${t.profil ? `${esc(formatProfil(t.profil))} <span style="font-size:10px;">✏️</span>` : `<span style="color:var(--color-text-secondary);font-size:12px;">— ✏️</span>`}
                  </td>
                  <td style="cursor:pointer;" data-edit-marque="tracteur" data-plaque="${esc(t.plaque)}" data-marque="${esc(t.marque)}" data-modele="${esc(t.modele)}">
                    ${t.marque ? `<span style="font-weight:600;">${esc(t.marque)}</span><br><span style="font-size:11px;color:var(--color-text-secondary);">${esc(t.modele)}</span>` : `<span style="color:var(--color-text-secondary);font-size:12px;">— ✏️</span>`}
                  </td>
                  <td style="cursor:pointer;" data-edit-vehicule="tracteur" data-plaque="${esc(t.plaque)}" data-champ="date_ct" data-val="${t.date_ct||""}">${dateCell(t.date_ct)} <span style="font-size:10px;color:var(--color-accent);">✏️</span></td>
                  <td style="cursor:pointer;" data-edit-vehicule="tracteur" data-plaque="${esc(t.plaque)}" data-champ="date_assurance" data-val="${t.date_assurance||""}">${dateCell(t.date_assurance)} <span style="font-size:10px;color:var(--color-accent);">✏️</span></td>
                  <td style="cursor:pointer;" data-edit-vehicule="tracteur" data-plaque="${esc(t.plaque)}" data-champ="date_limiteur_vitesse" data-val="${t.date_limiteur_vitesse||""}">${dateCell(t.date_limiteur_vitesse)} <span style="font-size:10px;color:var(--color-accent);">✏️</span></td>
                  <td style="cursor:pointer;" data-edit-vehicule="tracteur" data-plaque="${esc(t.plaque)}" data-champ="date_chronotachygraphe" data-val="${t.date_chronotachygraphe||""}">${dateCell(t.date_chronotachygraphe)} <span style="font-size:10px;color:var(--color-accent);">✏️</span></td>
                  ${frigoNettoyageCellT}
                  ${hayonCellT}
                  <td>${cartesHTML}</td>
                  <td>
                    <button class="btn-vehicle-photos" data-plaque="${esc(t.plaque)}" data-vtype="tracteur"
                      style="background:color-mix(in srgb,var(--color-accent) 15%,transparent);border:1px solid color-mix(in srgb,var(--color-accent) 40%,transparent);color:var(--color-accent);border-radius:8px;padding:4px 8px;cursor:pointer;font-size:13px;">📷</button>
                  </td>
                  <td>
                    <button class="btn-edit" data-vehicule-plaque="${esc(t.plaque)}" data-vehicule-type="tracteur">📋</button>
                    <button class="btn-supprimer" data-plaque="${esc(t.plaque)}" data-type="tracteur">🗑️</button>
                  </td>
                </tr>`;
              }).join("")}
          </tbody>
        </table>
      </div>

      <!-- Remorques -->
      <div class="admin-table-wrap">
        <div class="admin-table-title">
          <span>🚛 Remorques</span>
          <button class="btn-ajouter" id="btn-ajouter-remorque">+ Ajouter</button>
        </div>
        <table>
          <thead>
            <tr><th>PLAQUE</th><th>PROFIL</th><th>MARQUE / MODÈLE</th><th>CONTRÔLE TECHNIQUE</th><th>ASSURANCE</th><th>ENTRETIEN FRIGO / NETTOYAGE INTÉRIEUR</th><th>GRAISSAGE</th><th>HAYON</th><th>CARTES PERSO</th><th>DOCUMENTS</th><th>MODIFIER/SUPPRIMER</th></tr>
          </thead>
          <tbody>
            ${remorques.length === 0
              ? `<tr><td colspan="11" style="text-align:center;color:var(--color-text-secondary);padding:24px;">Aucune remorque</td></tr>`
              : remorques.map((r) => {
                const cartes = (cartesParPlaque[r.plaque] || []).filter(c => c.a_date);
                const cartesHTML = cartes.length
                  ? cartes.map(c => `<div style="font-size:11px;">${esc(c.label)} : ${dateCell(c.date_valeur)}</div>`).join("")
                  : `<span style="color:var(--color-text-secondary);font-size:11px;">—</span>`;
                const docs = getProfilVehicule(r.profil)?.docs || [];
                const cellVide = `<span style="color:var(--color-text-secondary);">—</span>`;
                const cellDate = (champ, val, label) => `
                  <td style="cursor:pointer;" data-edit-vehicule="remorque" data-plaque="${esc(r.plaque)}" data-champ="${champ}" data-val="${val||""}" data-label="${esc(label)}">
                    ${dateCell(val)} <span style="font-size:10px;color:var(--color-accent);">✏️</span>
                  </td>`;
                const frigoNettoyageCell = docs.includes("frigo")
                  ? `<td style="padding:4px 8px;">
                       <div style="cursor:pointer;margin-bottom:4px;" data-edit-vehicule="remorque" data-plaque="${esc(r.plaque)}" data-champ="date_entretien_frigo" data-val="${r.date_entretien_frigo||""}" data-label="Entretien Groupe Frigo">
                         🧊 ${dateCell(r.date_entretien_frigo)} <span style="font-size:10px;color:var(--color-accent);">✏️</span>
                       </div>
                       <div style="cursor:pointer;" data-edit-vehicule="remorque" data-plaque="${esc(r.plaque)}" data-champ="date_nettoyage_interieur" data-val="${r.date_nettoyage_interieur||""}" data-label="Nettoyage Intérieur">
                         🧽 ${dateCell(r.date_nettoyage_interieur)} <span style="font-size:10px;color:var(--color-accent);">✏️</span>
                       </div>
                     </td>`
                  : `<td>${cellVide}</td>`;
                const graissageCell = docs.includes("graissage")
                  ? cellDate("date_graissage", r.date_graissage, "Graissage Articulations")
                  : `<td>${cellVide}</td>`;
                const hayonCell = r.a_hayon
                  ? cellDate("date_hayon", r.date_hayon, "Hayon")
                  : `<td>${cellVide}</td>`;
                return `
                <tr>
                  <td><strong>${esc(r.plaque)}</strong></td>
                  <td style="font-size:12px;color:var(--color-accent);font-weight:600;cursor:pointer;" data-edit-profil="remorque" data-plaque="${esc(r.plaque)}" data-profil="${esc(r.profil)}">
                    ${r.profil ? `${esc(formatProfil(r.profil))} <span style="font-size:10px;">✏️</span>` : `<span style="color:var(--color-text-secondary);font-size:12px;">— ✏️</span>`}
                  </td>
                  <td style="cursor:pointer;" data-edit-marque="remorque" data-plaque="${esc(r.plaque)}" data-marque="${esc(r.marque)}" data-modele="${esc(r.modele)}">
                    ${r.marque ? `<span style="font-weight:600;">${esc(r.marque)}</span><br><span style="font-size:11px;color:var(--color-text-secondary);">${esc(r.modele)}</span>` : `<span style="color:var(--color-text-secondary);font-size:12px;">— ✏️</span>`}
                  </td>
                  <td style="cursor:pointer;" data-edit-vehicule="remorque" data-plaque="${esc(r.plaque)}" data-champ="date_ct" data-val="${r.date_ct||""}">${dateCell(r.date_ct)} <span style="font-size:10px;color:var(--color-accent);">✏️</span></td>
                  <td style="cursor:pointer;" data-edit-vehicule="remorque" data-plaque="${esc(r.plaque)}" data-champ="date_assurance" data-val="${r.date_assurance||""}">${dateCell(r.date_assurance)} <span style="font-size:10px;color:var(--color-accent);">✏️</span></td>
                  ${frigoNettoyageCell}
                  ${graissageCell}
                  ${hayonCell}
                  <td>${cartesHTML}</td>
                  <td>
                    <button class="btn-vehicle-photos" data-plaque="${esc(r.plaque)}" data-vtype="remorque"
                      style="background:color-mix(in srgb,var(--color-accent) 15%,transparent);border:1px solid color-mix(in srgb,var(--color-accent) 40%,transparent);color:var(--color-accent);border-radius:8px;padding:4px 8px;cursor:pointer;font-size:13px;">📷</button>
                  </td>
                  <td>
                    <button class="btn-edit" data-vehicule-plaque="${esc(r.plaque)}" data-vehicule-type="remorque">📋</button>
                    <button class="btn-supprimer" data-plaque="${esc(r.plaque)}" data-type="remorque">🗑️</button>
                  </td>
                </tr>`;
              }).join("")}
          </tbody>
        </table>
      </div>
      </div>
      <!-- Panneau latéral photos véhicule -->
      <div id="vehicle-photo-panel" style="width:300px;flex-shrink:0;display:none;"></div>
      </div>
      </div>
      </div>
    `;

    document.getElementById("btn-ajouter-tracteur").addEventListener("click", async () => {
      if (await verifierLimiteVehicules()) ajouterVehicule("tracteur", profilsAutorises);
    });
    document.getElementById("btn-ajouter-remorque").addEventListener("click", () => ajouterVehicule("remorque", profilsAutorises));
    document.getElementById("btn-profils-perso").addEventListener("click", () => ouvrirGestionProfilsPerso());

    content.querySelectorAll(".btn-vehicle-photos").forEach(btn => {
      btn.addEventListener("click", () => ouvrirVehiclePhotoPanel(btn.dataset.plaque, btn.dataset.vtype));
    });

    attachAlerteBandeauListeners([]);

    content.querySelectorAll(".btn-supprimer").forEach((btn) => {
      btn.addEventListener("click", () => supprimerVehicule(btn.dataset.plaque, btn.dataset.type));
    });

    content.querySelectorAll("[data-vehicule-plaque]").forEach((btn) => {
      btn.addEventListener("click", () => ouvrirGestionCartesVehicule(btn.dataset.vehiculePlaque, btn.dataset.vehiculeType));
    });

    // Marque/modèle cliquable
    content.querySelectorAll("[data-edit-marque]").forEach(el => {
      el.addEventListener("click", () => {
        const type   = el.dataset.editMarque;
        const plaque = el.dataset.plaque;
        showModal({
          title: `Marque / Modèle — ${plaque}`,
          bodyHTML: `
            <div class="admin-field">
              <label>Marque</label>
              <input type="text" id="edit-marque" value="${esc(el.dataset.marque)}" placeholder="ex: Volvo"
                style="width:100%;height:50px;background:var(--color-surface-card);border:1.5px solid var(--color-divider);border-radius:12px;padding:0 16px;color:var(--color-text-primary);font-size:15px;outline:none;" />
            </div>
            <div class="admin-field">
              <label>Modèle</label>
              <input type="text" id="edit-modele" value="${esc(el.dataset.modele)}" placeholder="ex: FH 500"
                style="width:100%;height:50px;background:var(--color-surface-card);border:1.5px solid var(--color-divider);border-radius:12px;padding:0 16px;color:var(--color-text-primary);font-size:15px;outline:none;" />
            </div>
          `,
          confirmLabel: "Enregistrer",
          onConfirm: async (body) => {
            const marque = body.querySelector("#edit-marque").value.trim();
            const modele = body.querySelector("#edit-modele").value.trim();
            const table  = type === "tracteur" ? "tracteurs" : "remorques";
            await dbUpdate(table, { marque, modele }, [
              { col: "plaque",        op: "eq", val: plaque },
              { col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }
            ]);
            showToast("✅ Marque / Modèle mis à jour !");
            renderParc();
            return true;
          }
        });
      });
    });

    // Profil véhicule cliquable
    content.querySelectorAll("[data-edit-profil]").forEach(el => {
      el.addEventListener("click", () => {
        const type   = el.dataset.editProfil;
        const plaque = el.dataset.plaque;
        const isTracteur = type === "tracteur";
        const categorie  = isTracteur ? "moteur" : "remorque";

        const profils = getProfilsParCategorie(categorie)
          .map((p) => ({ id: p.id, label: p.label + (p.entreprise_id ? " (perso)" : ""), famille: p.famille }));

        const options = `<option value="">— Sélectionner —</option>` +
          optgroupsHTML(profils, (p) => `<option value="${p.id}" ${p.id === el.dataset.profil ? "selected" : ""}>${p.label}</option>`);

        showModal({
          title: `Profil véhicule — ${plaque}`,
          bodyHTML: `
            <div class="admin-field">
              <label>Profil</label>
              <select id="edit-profil-select" style="width:100%;height:50px;background:var(--color-surface-card);border:1.5px solid var(--color-divider);border-radius:12px;padding:0 16px;color:var(--color-text-primary);font-size:15px;font-weight:600;outline:none;">
                ${options}
              </select>
            </div>
          `,
          confirmLabel: "Enregistrer",
          onConfirm: async (body) => {
            const profil = body.querySelector("#edit-profil-select").value;
            if (!profil) { showToast("⚠️ Sélectionne un profil"); return false; }
            const table = isTracteur ? "tracteurs" : "remorques";
            await dbUpdate(table, { profil }, [
              { col: "plaque",        op: "eq", val: plaque },
              { col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }
            ]);
            showToast("✅ Profil mis à jour !");
            renderParc();
            return true;
          }
        });
      });
    });

    // Dates véhicules cliquables
    content.querySelectorAll("[data-edit-vehicule]").forEach(el => {
      el.addEventListener("click", () => {
        const type   = el.dataset.editVehicule;
        const plaque = el.dataset.plaque;
        const champ  = el.dataset.champ;
        const val    = el.dataset.val || null;
        const labels = {
          date_ct:                "Contrôle Technique",
          date_assurance:         "Assurance",
          date_limiteur_vitesse:  "Limiteur de Vitesse",
          date_chronotachygraphe: "Chronotachygraphe"
        };
        ouvrirEditDate(
          `${el.dataset.label || labels[champ] || champ} — ${plaque}`,
          type === "tracteur" ? "tracteurs" : "remorques",
          champ,
          [
            { col: "plaque",        op: "eq", val: plaque },
            { col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }
          ],
          val,
          () => renderParc()
        );
      });
    });

  } catch (e) {
    content.innerHTML = `<div class="admin-empty"><div class="text">📡 Erreur de chargement</div></div>`;
  }
}

function ajouterVehicule(type, profilsAutorises = []) {
  const isTracteur = type === "tracteur";
  const categorie  = isTracteur ? "moteur" : "remorque";

  // Secours si le catalogue Supabase (profils_vehicules) n'est pas encore
  // chargé (hors-ligne, erreur réseau) — ne bloque jamais l'ajout d'un véhicule.
  const FALLBACK_MOTEUR = [
    { id: "porteur_19t",       label: "Porteur 19t"          },
    { id: "porteur_26t",       label: "Porteur 26t"          },
    { id: "porteur_32t",       label: "Porteur 32t"          },
    { id: "porteur_32t_8x4",   label: "Porteur 32t 8x4"     },
    { id: "tracteur_4x2",      label: "Tracteur 4x2"         },
    { id: "tracteur_6x2",      label: "Tracteur 6x2"         },
    { id: "tracteur_6x4",      label: "Tracteur 6x4"         },
    { id: "tracteur_agricole", label: "Tracteur agricole"    },
    { id: "voiture_societe",   label: "Voiture de société"   },
    { id: "utilitaire",        label: "Utilitaire / Fourgon" },
  ];
  const FALLBACK_REMORQUE = [
    { id: "remorque_1e",   label: "Remorque 1 essieu (city)" },
    { id: "remorque_2e",   label: "Remorque 2 essieux"       },
    { id: "remorque_3e",   label: "Remorque 3 essieux"       },
    { id: "porte_char_4e", label: "Porte-char 4 essieux"     },
    { id: "porte_char_5e", label: "Porte-char 5 essieux"     },
    { id: "porte_char_6e", label: "Porte-char 6 essieux"     },
    { id: "citerne_alim_2c", label: "Citerne alimentaire 2 compartiments" },
    { id: "citerne_alim_3c", label: "Citerne alimentaire 3 compartiments" },
    { id: "citerne_alim_4c", label: "Citerne alimentaire 4 compartiments" },
    { id: "citerne_alim_5c", label: "Citerne alimentaire 5 compartiments" },
    { id: "citerne_alim_6c", label: "Citerne alimentaire 6 compartiments" },
    { id: "remorque_frigo_2e", label: "Remorque frigorifique 2 essieux" },
    { id: "remorque_frigo_3e", label: "Remorque frigorifique 3 essieux" },
  ];

  const depuisCache = getProfilsParCategorie(categorie)
    .map((p) => ({ id: p.id, label: p.label, famille: p.famille, categorie: p.categorie, docs: p.docs, perso: !!p.entreprise_id }));
  const tousProfils = depuisCache.length > 0
    ? depuisCache
    : (isTracteur ? FALLBACK_MOTEUR : FALLBACK_REMORQUE);

  // Les profils perso (créés par cette entreprise) restent toujours
  // disponibles quel que soit le pack — seuls les profils globaux sont
  // filtrés par la liste blanche profils_autorises.
  const filtrer = (liste) => profilsAutorises.length > 0
    ? liste.filter(p => p.perso || profilsAutorises.includes(p.id))
    : liste;

  const profils = filtrer(tousProfils);
  const profilOptions = `<option value="">— Sélectionner —</option>` +
    optgroupsHTML(profils, (p) => `<option value="${p.id}">${p.label}${p.perso ? " (perso)" : ""}</option>`);

  const inputStyle = "width:100%;height:50px;background:var(--color-surface-card);border:1.5px solid var(--color-divider);border-radius:12px;padding:0 16px;color:var(--color-text-primary);font-size:15px;outline:none;";

  showModal({
    title: `Ajouter un ${type}`,
    bodyHTML: `
      <div class="admin-field">
        <label>Plaque d'immatriculation <span style="color:var(--color-danger);">*</span></label>
        <input type="text" id="modal-plaque-input" placeholder="ex: AA123BB"
          style="${inputStyle}font-size:16px;font-weight:700;letter-spacing:2px;text-transform:uppercase;" />
      </div>
      <div class="admin-field">
        <label>Profil véhicule <span style="color:var(--color-danger);">*</span></label>
        <select id="modal-profil-input" style="${inputStyle}font-weight:600;">
          ${profilOptions}
        </select>
      </div>
      <div class="admin-field">
        <label>Marque</label>
        <input type="text" id="modal-marque-input" placeholder="ex: Volvo" style="${inputStyle}" />
      </div>
      <div class="admin-field">
        <label>Modèle</label>
        <input type="text" id="modal-modele-input" placeholder="ex: FH 500" style="${inputStyle}" />
      </div>
      <label id="modal-hayon-row" style="display:none;align-items:center;gap:8px;margin-top:6px;font-size:14px;color:var(--color-text-primary);">
        <input type="checkbox" id="modal-hayon-input" />
        Équipée d'un hayon
      </label>
      ${isTracteur ? "" : `
      <label id="modal-bitemp-row" style="display:none;align-items:center;gap:8px;margin-top:6px;font-size:14px;color:var(--color-text-primary);">
        <input type="checkbox" id="modal-bitemp-input" />
        Bi-température (surgelé + frais dans le même groupe frigo)
      </label>`}
    `,
    confirmLabel: "Ajouter",
    onMount: (body) => {
      // Hayon : uniquement sur bâchée/frigo (remorque) ou porteur avec
      // caisse propre bâché/frigo (moteur) — voir _peutAvoirHayon()
      const hayonRow  = body.querySelector("#modal-hayon-row");
      const bitempRow = body.querySelector("#modal-bitemp-row");
      const toggleOptions = () => {
        const p = profils.find((x) => x.id === body.querySelector("#modal-profil-input").value);
        const estFrigo = !!p?.docs?.includes("frigo");
        hayonRow.style.display = _peutAvoirHayon(p) ? "flex" : "none";
        if (bitempRow) bitempRow.style.display = estFrigo ? "flex" : "none";
      };
      body.querySelector("#modal-profil-input").addEventListener("change", toggleOptions);
      toggleOptions();
    },
    onConfirm: async (body) => {
      const plaque  = body.querySelector("#modal-plaque-input").value.toUpperCase().replace(/\s/g,"").replace(/-/g,"");
      const profil  = body.querySelector("#modal-profil-input").value;
      const marque  = body.querySelector("#modal-marque-input").value.trim();
      const modele  = body.querySelector("#modal-modele-input").value.trim();
      if (!plaque) { showToast("⚠️ Renseigne une plaque"); return false; }
      if (!profil) { showToast("⚠️ Sélectionne un profil véhicule"); return false; }
      const table = isTracteur ? "tracteurs" : "remorques";
      const payload = { plaque, profil, marque, modele, entreprise_id: adminSession.entreprise_id };
      payload.a_hayon = body.querySelector("#modal-hayon-input").checked;
      if (!isTracteur) payload.bi_temperature = body.querySelector("#modal-bitemp-input")?.checked || false;
      await dbInsert(table, payload);
      showToast(`✅ ${type} ${plaque} ajouté !`);
      renderParc();
    }
  });
}

// ════════════════════════════════════════════════════════════════════════
// PROFILS VÉHICULES PERSO (par entreprise)
// Vocabulaire fixe des types de cartes — chaque entrée a une logique de
// rendu dédiée dans la PWA/le panel, ce ne sont PAS des cases libres.
// ════════════════════════════════════════════════════════════════════════
const DOCS_DISPONIBLES = {
  moteur:   [ { id: "ct", label: "Contrôle technique" }, { id: "assurance", label: "Assurance" }, { id: "limiteur", label: "Limiteur de vitesse" }, { id: "chrono", label: "Chronotachygraphe" }, { id: "frigo", label: "Entretien groupe frigo" }, { id: "nettoyage", label: "Nettoyage intérieur" } ],
  // Le hayon n'est plus un doc de profil : c'est une option cochée
  // directement sur le véhicule (voir "Équipée d'un hayon" dans le
  // formulaire d'ajout et la gestion des cartes du véhicule).
  remorque: [ { id: "ct", label: "Contrôle technique" }, { id: "assurance", label: "Assurance" }, { id: "frigo", label: "Entretien groupe frigo" }, { id: "nettoyage", label: "Nettoyage intérieur" }, { id: "graissage", label: "Graissage articulations" } ]
};

async function ouvrirGestionProfilsPerso() {
  const rows = await dbSelect("profils_vehicules", {
    filters: [{ col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }],
    order: { col: "categorie", asc: true }
  }).catch(() => []);

  function ligneHTML(p) {
    const detail = p.categorie === "moteur"
      ? `${p.essieux_avant ?? "?"} essieu(x) avant / ${p.essieux_arriere ?? "?"} arrière`
      : `${p.nb_essieux ?? "?"} essieu(x)${p.nb_compartiments ? ` · ${p.nb_compartiments} compartiments` : ""}`;
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:0.5px solid var(--color-divider);${p.actif ? "" : "opacity:0.5;"}">
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--color-text-primary);">${esc(p.label)} ${p.actif ? "" : "(désactivé)"}</div>
          <div style="font-size:11px;color:var(--color-text-secondary);">${esc(p.famille || (p.categorie === "moteur" ? "Tracteur/porteur" : "Remorque"))} — ${esc(detail)}</div>
          <div style="font-size:11px;color:var(--color-text-secondary);">${(p.docs || []).join(", ")}</div>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="btn-edit" data-profil-toggle="${p.id}" data-actif="${p.actif}" style="padding:4px 8px;font-size:12px;">${p.actif ? "⏸️" : "▶️"}</button>
          <button class="btn-supprimer" data-profil-delete="${p.id}" style="padding:4px 8px;font-size:12px;">🗑️</button>
        </div>
      </div>`;
  }

  const listeHTML = rows.length === 0
    ? `<div style="color:var(--color-text-secondary);font-size:13px;padding:8px 0;">Aucun profil perso créé pour l'instant.</div>`
    : rows.map(ligneHTML).join("");

  showModal({
    title: "⚙️ Mes profils véhicules perso",
    bodyHTML: `
      <div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:12px;">
        Ces profils ne sont visibles que par ton entreprise, en plus du catalogue global. Utile pour une config de véhicule spécifique à ta flotte.
      </div>
      <div id="profils-perso-list">${listeHTML}</div>
      <button class="btn-ajouter" id="btn-add-profil-perso" style="margin-top:14px;width:100%;height:44px;">+ Ajouter un profil perso</button>
    `,
    confirmLabel: "Fermer",
    onMount: (bodyEl) => {
      bodyEl.querySelectorAll("[data-profil-toggle]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id    = btn.dataset.profilToggle;
          const actif = btn.dataset.actif === "true";
          await dbUpdate("profils_vehicules", { actif: !actif }, [{ col: "id", op: "eq", val: id }]);
          showToast(actif ? "⏸️ Profil désactivé" : "▶️ Profil réactivé");
          await loadProfilsVehicules();
          ouvrirGestionProfilsPerso();
        });
      });
      bodyEl.querySelectorAll("[data-profil-delete]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          await dbDelete("profils_vehicules", [{ col: "id", op: "eq", val: btn.dataset.profilDelete }]);
          showToast("🗑️ Profil supprimé");
          await loadProfilsVehicules();
          ouvrirGestionProfilsPerso();
        });
      });
      bodyEl.querySelector("#btn-add-profil-perso").addEventListener("click", () => _ouvrirFormProfilPerso());
    },
    onConfirm: () => true
  });
}

function _ouvrirFormProfilPerso() {
  const inputStyle = "width:100%;height:46px;background:var(--color-surface-card);border:1.5px solid var(--color-divider);border-radius:10px;padding:0 14px;color:var(--color-text-primary);font-size:14px;outline:none;";

  function docsChecksHTML(categorie) {
    return DOCS_DISPONIBLES[categorie].map((d) => `
      <label style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:13px;">
        <input type="checkbox" class="profil-doc-check" value="${d.id}" />
        ${esc(d.label)}
      </label>`).join("");
  }

  showModal({
    title: "+ Nouveau profil perso",
    bodyHTML: `
      <div class="admin-field">
        <label>Catégorie</label>
        <select id="pf-categorie" style="${inputStyle}">
          <option value="moteur">Tracteur / Porteur</option>
          <option value="remorque">Remorque</option>
        </select>
      </div>
      <div class="admin-field">
        <label>Nom du profil <span style="color:var(--color-danger);">*</span></label>
        <input type="text" id="pf-label" placeholder="ex: Benne céréalière 2 essieux" style="${inputStyle}" />
      </div>
      <div class="admin-field">
        <label>Famille <span style="color:var(--color-danger);">*</span></label>
        <input type="text" id="pf-famille" list="pf-famille-suggestions" placeholder="ex: Benne, Frigo, Citerne alimentaire..." style="${inputStyle}" />
        <datalist id="pf-famille-suggestions">
          ${[...new Set(profilsVehiculesCache.map((p) => p.famille).filter(Boolean))].sort((a,b) => a.localeCompare(b,"fr")).map((f) => `<option value="${esc(f)}"></option>`).join("")}
        </datalist>
        <div style="font-size:11px;color:var(--color-text-secondary);margin-top:4px;">Sert à regrouper les profils dans les listes (ex: tous les "Frigo" ensemble).</div>
      </div>
      <div id="pf-champs-moteur" style="display:flex;gap:10px;">
        <div class="admin-field" style="flex:1;">
          <label>Essieux avant</label>
          <input type="number" id="pf-essieux-avant" min="1" value="1" style="${inputStyle}" />
        </div>
        <div class="admin-field" style="flex:1;">
          <label>Essieux arrière</label>
          <input type="number" id="pf-essieux-arriere" min="1" value="1" style="${inputStyle}" />
        </div>
      </div>
      <div id="pf-champs-remorque" style="display:none;gap:10px;">
        <div class="admin-field" style="flex:1;">
          <label>Nombre d'essieux</label>
          <input type="number" id="pf-nb-essieux" min="1" value="2" style="${inputStyle}" />
        </div>
        <div class="admin-field" style="flex:1;">
          <label>Compartiments (citerne — optionnel)</label>
          <input type="number" id="pf-nb-compartiments" min="0" placeholder="—" style="${inputStyle}" />
        </div>
      </div>
      <div class="admin-field">
        <label>Cartes à afficher</label>
        <div id="pf-docs-moteur">${docsChecksHTML("moteur")}</div>
        <div id="pf-docs-remorque" style="display:none;">${docsChecksHTML("remorque")}</div>
      </div>
    `,
    confirmLabel: "Créer",
    onMount: (bodyEl) => {
      const selectCat = bodyEl.querySelector("#pf-categorie");
      const toggle = () => {
        const isMoteur = selectCat.value === "moteur";
        bodyEl.querySelector("#pf-champs-moteur").style.display   = isMoteur ? "flex" : "none";
        bodyEl.querySelector("#pf-champs-remorque").style.display = isMoteur ? "none" : "flex";
        bodyEl.querySelector("#pf-docs-moteur").style.display     = isMoteur ? "block" : "none";
        bodyEl.querySelector("#pf-docs-remorque").style.display   = isMoteur ? "none" : "block";
      };
      selectCat.addEventListener("change", toggle);
      toggle();
    },
    onConfirm: async (body) => {
      const categorie = body.querySelector("#pf-categorie").value;
      const label     = body.querySelector("#pf-label").value.trim();
      const famille   = body.querySelector("#pf-famille").value.trim();
      if (!label) { showToast("⚠️ Renseigne un nom de profil"); return false; }
      if (!famille) { showToast("⚠️ Renseigne une famille (pour bien ranger le profil dans les listes)"); return false; }

      const docsContainer = categorie === "moteur"
        ? body.querySelector("#pf-docs-moteur")
        : body.querySelector("#pf-docs-remorque");
      const docs = [...docsContainer.querySelectorAll(".profil-doc-check:checked")].map((c) => c.value);

      const payload = {
        entreprise_id: adminSession.entreprise_id,
        categorie,
        label,
        famille,
        docs,
        actif: true
      };
      if (categorie === "moteur") {
        payload.essieux_avant   = Number(body.querySelector("#pf-essieux-avant").value)   || 1;
        payload.essieux_arriere = Number(body.querySelector("#pf-essieux-arriere").value) || 1;
        payload.peut_tracter_remorque = true;
      } else {
        payload.nb_essieux = Number(body.querySelector("#pf-nb-essieux").value) || 1;
        const compartiments = body.querySelector("#pf-nb-compartiments").value;
        if (compartiments) payload.nb_compartiments = Number(compartiments);
      }

      try {
        await dbInsert("profils_vehicules", payload);
      } catch (e) {
        showToast("⚠️ Erreur : " + e.message);
        return false;
      }
      showToast(`✅ Profil "${label}" créé !`);
      await loadProfilsVehicules();
      ouvrirGestionProfilsPerso();
      return true;
    }
  });
}

function supprimerVehicule(plaque, type) {
  showModal({
    title: `Supprimer ${esc(plaque)} ?`,
    bodyHTML: `<p style="color:var(--color-text-secondary);font-size:14px;">
      Cette action est définitive. Toutes les données liées à ce véhicule seront supprimées.
    </p>`,
    confirmLabel: "Supprimer",
    danger: true,
    onConfirm: async () => {
      const table = type === "tracteur" ? "tracteurs" : "remorques";
      await dbDelete(table, [
        { col: "plaque",        op: "eq", val: plaque },
        { col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }
      ]);
      showToast(`🗑️ ${plaque} supprimé`);
      renderParc();
    }
  });
}

// ════════════════════════════════════════════════════════════════════════
// SECTION — CONSOMMATIONS
// ════════════════════════════════════════════════════════════════════════

async function renderConsommations() {
  const content = document.getElementById("admin-content");
  try {
    const [chauffeurs, tracteurs] = await Promise.all([
      dbSelect("chauffeurs", {
        select: "id,prenom,nom",
        filters: [
          { col: "entreprise_id", op: "eq", val: adminSession.entreprise_id },
          { col: "est_valide",    op: "eq", val: "true" }
        ],
        order: { col: "nom", asc: true }
      }),
      dbSelect("tracteurs", {
        select: "plaque",
        filters: [{ col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }],
        order: { col: "plaque", asc: true }
      })
    ]);

    // Filters UI
    content.innerHTML = `
      <div class="admin-filters">
        <select id="filter-tracteur" class="admin-select">
          <option value="">Tous les tracteurs</option>
          ${tracteurs.map((t) => `<option value="${t.plaque}">${t.plaque}</option>`).join("")}
        </select>
        <select id="filter-chauffeur" class="admin-select">
          <option value="">Tous les chauffeurs</option>
          ${chauffeurs.map((c) => `<option value="${c.id}">${c.prenom} ${c.nom}</option>`).join("")}
        </select>
        <input type="month" id="filter-mois" class="admin-filter-input" />
        <button class="btn-ajouter" id="btn-filtrer">🔍 Filtrer</button>
      </div>
      <div id="conso-table-wrap"><div class="admin-loading">Sélectionne des filtres et appuie sur Filtrer</div></div>
    `;

    // Mois par défaut = mois en cours
    const now = new Date();
    document.getElementById("filter-mois").value =
      `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;

    document.getElementById("btn-filtrer").addEventListener("click", () => {
      loadConsoTable(
        document.getElementById("filter-tracteur").value,
        document.getElementById("filter-chauffeur").value,
        document.getElementById("filter-mois").value
      );
    });

    // Charge automatiquement le mois en cours
    loadConsoTable("", "", document.getElementById("filter-mois").value);

  } catch (e) {
    content.innerHTML = `<div class="admin-empty"><div class="text">📡 Erreur de chargement</div></div>`;
  }
}

// ════════════════════════════════════════════════════════════════════════
// GRAPHIQUE COMPARATIF 3 MOIS GLISSANTS (SVG pur, 0 dépendance)
// ════════════════════════════════════════════════════════════════════════

function buildChart3Mois(rows) {
  const now = new Date();
  const moisLabels = ["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"];
  const mois3 = [];
  for (let i = 2; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    mois3.push({
      key:   `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`,
      label: moisLabels[d.getMonth()]
    });
  }

  const data = mois3.map(m => {
    const subset = (rows||[]).filter(r => r.date && r.date.substring(0,7) === m.key);
    const km     = subset.reduce((s,r) => s + Number(r.kilometres||0), 0);
    const litres = subset.reduce((s,r) => s + Number(r.litres||0), 0);
    const vals   = subset.filter(r => Number(r.valeur) > 0).map(r => Number(r.valeur));
    const moy    = vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : 0;
    return { label: m.label, km, litres, moy, nb: subset.length };
  });

  if (data.every(d => d.nb === 0)) return "";

  const W=520, H=160, PL=44, PR=16, PT=22, PB=32;
  const chartW = W - PL - PR;
  const chartH = H - PT - PB;
  const groupW = chartW / 3;
  const barW   = Math.min(22, groupW / 3 - 4);
  const gap    = 4;

  const maxKm     = Math.max(...data.map(d=>d.km),     1);
  const maxLitres = Math.max(...data.map(d=>d.litres),  1);
  const maxMoy    = Math.max(...data.map(d=>d.moy),     1);

  const C_KM     = "var(--color-warning)";
  const C_LITRES = "var(--color-accent)";
  const C_MOY    = "var(--color-success)";

  const gridLines = [0, 0.5, 1].map(t => {
    const y = PT + (1 - t) * chartH;
    return `<line x1="${PL}" y1="${y}" x2="${W-PR}" y2="${y}" stroke="var(--color-divider)" stroke-width="1"/>`;
  }).join("");

  const barsSVG = data.map((d, i) => {
    const cx = PL + i * groupW + groupW / 2;
    const x0 = cx - (3*barW + 2*gap) / 2;

    const hKm     = d.km     > 0 ? Math.max(3, (d.km     / maxKm)     * chartH) : 0;
    const hLitres = d.litres > 0 ? Math.max(3, (d.litres / maxLitres) * chartH) : 0;
    const hMoy    = d.moy    > 0 ? Math.max(3, (d.moy    / maxMoy)    * chartH) : 0;

    const yKm     = PT + chartH - hKm;
    const yLitres = PT + chartH - hLitres;
    const yMoy    = PT + chartH - hMoy;

    return `
      <rect x="${x0}"               y="${yKm}"     width="${barW}" height="${hKm}"     fill="${C_KM}"     rx="3" opacity="0.9">
        <title>${d.label} · Km : ${Math.round(d.km).toLocaleString("fr-FR")} km</title>
      </rect>
      <rect x="${x0+barW+gap}"     y="${yLitres}" width="${barW}" height="${hLitres}" fill="${C_LITRES}" rx="3" opacity="0.9">
        <title>${d.label} · Litres : ${Math.round(d.litres)} L</title>
      </rect>
      <rect x="${x0+2*(barW+gap)}" y="${yMoy}"    width="${barW}" height="${hMoy}"    fill="${C_MOY}"    rx="3" opacity="0.9">
        <title>${d.label} · L/100 : ${d.moy.toFixed(1)}</title>
      </rect>
      ${d.km     > 0 ? `<text x="${x0+barW/2}"               y="${yKm-3}"     text-anchor="middle" font-size="8" fill="${C_KM}">${Math.round(d.km/1000)}k</text>` : ""}
      ${d.litres > 0 ? `<text x="${x0+barW+gap+barW/2}"     y="${yLitres-3}" text-anchor="middle" font-size="8" fill="${C_LITRES}">${Math.round(d.litres)}</text>` : ""}
      ${d.moy    > 0 ? `<text x="${x0+2*(barW+gap)+barW/2}" y="${yMoy-3}"    text-anchor="middle" font-size="8" fill="${C_MOY}">${d.moy.toFixed(1)}</text>` : ""}
      <text x="${cx}" y="${H-8}"  text-anchor="middle" font-size="10" font-weight="700" fill="var(--color-text-secondary)">${d.label}</text>
      ${d.nb > 0 ? `<text x="${cx}" y="${H-18}" text-anchor="middle" font-size="8" fill="var(--color-text-secondary)">${d.nb} saisie${d.nb>1?"s":""}</text>` : ""}
    `;
  }).join("");

  const legendeSVG = `
    <text x="${PL}"      y="${PT-6}" font-size="8" fill="${C_KM}">■ Km (×1000)</text>
    <text x="${PL+90}"   y="${PT-6}" font-size="8" fill="${C_LITRES}">■ Litres</text>
    <text x="${PL+155}"  y="${PT-6}" font-size="8" fill="${C_MOY}">■ L/100 km</text>
  `;

  return `
    <div style="margin:16px 0;padding:14px 12px;background:rgba(0,194,255,0.04);border:1px solid rgba(0,194,255,0.12);border-radius:12px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;color:var(--color-text-secondary);margin-bottom:8px;">
        📊 COMPARATIF — 3 MOIS GLISSANTS
      </div>
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;height:auto;display:block;overflow:visible;">
        ${gridLines}
        ${barsSVG}
        ${legendeSVG}
        <line x1="${PL}" y1="${PT+chartH}" x2="${W-PR}" y2="${PT+chartH}" stroke="var(--color-divider)" stroke-width="1"/>
      </svg>
    </div>
  `;
}

async function loadConsoTable(plaqueT, chauffeurId, mois) {
  const wrap = document.getElementById("conso-table-wrap");
  wrap.innerHTML = `<div class="admin-loading">Chargement…</div>`;

  try {
    const filters = [
      { col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }
    ];
    if (plaqueT)     filters.push({ col: "plaque_tracteur", op: "eq", val: plaqueT });
    if (chauffeurId) filters.push({ col: "chauffeur_id",    op: "eq", val: chauffeurId });
    if (mois) {
      const [annee, moisNum] = mois.split("-");
      const debut = `${annee}-${moisNum}-01`;
      const finMois = new Date(parseInt(annee), parseInt(moisNum), 0);
      const fin   = `${annee}-${moisNum}-${String(finMois.getDate()).padStart(2,"0")}`;
      filters.push({ col: "date", op: "gte", val: debut });
      filters.push({ col: "date", op: "lte", val: fin });
    }

    const rows = await dbSelect("consommations", {
      select: "id,date,plaque_tracteur,plaque_remorque,kilometres,litres,valeur,chauffeur_id",
      filters,
      order: { col: "date", asc: false }
    });

    // ── Données 3 mois glissants (indépendant du filtre de mois) ────────
    const now3m   = new Date();
    const debut3m = new Date(now3m.getFullYear(), now3m.getMonth() - 2, 1).toISOString().substring(0,10);
    const filters3m = [
      { col: "entreprise_id", op: "eq", val: adminSession.entreprise_id },
      { col: "date",          op: "gte", val: debut3m }
    ];
    if (plaqueT)     filters3m.push({ col: "plaque_tracteur", op: "eq", val: plaqueT });
    if (chauffeurId) filters3m.push({ col: "chauffeur_id",    op: "eq", val: chauffeurId });
    const rows3m = await dbSelect("consommations", {
      select: "date,kilometres,litres,valeur",
      filters: filters3m,
      order: { col: "date", asc: true }
    }).catch(() => []);

    // Récupère les noms des chauffeurs concernés
    const chauffeurIds = [...new Set(rows.map(r => r.chauffeur_id).filter(Boolean))];
    let chauffeursMap = {};
    if (chauffeurIds.length > 0) {
      const chRows = await dbSelect("chauffeurs", {
        select: "id,prenom,nom",
        filters: [{ col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }]
      });
      (chRows || []).forEach(c => { chauffeursMap[c.id] = `${c.prenom || ""} ${c.nom || ""}`.trim(); });
    }

    if (rows.length === 0) {
      const graphHTML = (rows3m||[]).length > 0 ? buildChart3Mois(rows3m) : "";
      wrap.innerHTML = graphHTML + `<div class="admin-empty"><div class="icon">⛽</div><div class="text">Aucune saisie pour ces filtres</div></div>`;
      return;
    }

    const totalKm     = rows.reduce((a, r) => a + Number(r.kilometres || 0), 0);
    const totalLitres = rows.reduce((a, r) => a + Number(r.litres || 0), 0);
    const moyenne     = rows.reduce((a, r) => a + Number(r.valeur || 0), 0) / rows.length;

    // Moyenne du mois en cours (si filtre chauffeur actif)
    const moisEnCours = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,"0")}`;
    const rowsMoisEnCours = chauffeurId
      ? rows.filter(r => r.date && r.date.substring(0,7) === moisEnCours && Number(r.valeur) > 0)
      : [];
    const moyenneMoisChauffeur = rowsMoisEnCours.length > 0
      ? rowsMoisEnCours.reduce((a, r) => a + Number(r.valeur), 0) / rowsMoisEnCours.length
      : null;

    // Titre de la période affichée
    let titrePeriode = "Toutes périodes";
    if (mois) {
      const [annee, moisNum] = mois.split("-");
      const noms = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
      titrePeriode = `${noms[parseInt(moisNum)-1]} ${annee}`;
    }

    wrap.innerHTML = `
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;color:var(--color-text-secondary);margin-bottom:10px;padding:0 2px;">
        RÉSUMÉ — ${esc(titrePeriode).toUpperCase()}${chauffeurId && chauffeursMap[chauffeurId] ? ` · ${esc(chauffeursMap[chauffeurId]).toUpperCase()}` : ""}
      </div>
      <div class="admin-stats-row" style="margin-bottom:${moyenneMoisChauffeur !== null ? "12px" : "20px"};">
        <div class="admin-stat-card" style="--stat-color:var(--color-accent);">
          <div class="admin-stat-value">${rows.length}</div>
          <div class="admin-stat-label">Nb de saisies</div>
        </div>
        <div class="admin-stat-card" style="--stat-color:var(--color-success);">
          <div class="admin-stat-value">${Math.round(totalKm).toLocaleString("fr-FR")}</div>
          <div class="admin-stat-label">Km parcourus</div>
        </div>
        <div class="admin-stat-card" style="--stat-color:var(--color-warning);">
          <div class="admin-stat-value">${totalLitres.toFixed(0)} L</div>
          <div class="admin-stat-label">Litres consommés</div>
        </div>
        <div class="admin-stat-card" style="--stat-color:var(--color-purple);">
          <div class="admin-stat-value">${moyenne.toFixed(1)}</div>
          <div class="admin-stat-label">Moy. L/100 km</div>
        </div>
      </div>

      ${moyenneMoisChauffeur !== null ? `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;background:rgba(0,194,255,0.07);border:1px solid rgba(0,194,255,0.2);border-radius:12px;padding:12px 16px;">
        <span style="font-size:20px;">📅</span>
        <div>
          <div style="font-size:11px;font-weight:700;color:var(--color-text-secondary);letter-spacing:1px;">MOIS EN COURS — ${esc(chauffeursMap[chauffeurId] || "")}</div>
          <div style="font-size:15px;font-weight:900;color:var(--color-accent);margin-top:2px;">
            Moyenne : ${moyenneMoisChauffeur.toFixed(1)} L/100 km
            <span style="font-size:12px;font-weight:500;color:var(--color-text-secondary);margin-left:8px;">sur ${rowsMoisEnCours.length} saisie(s)</span>
          </div>
        </div>
      </div>
      ` : ""}

      ${buildChart3Mois(rows3m)}

      <div class="admin-table-wrap">
        <div class="admin-table-title">
          <span>${rows.length} saisie(s) — ${esc(titrePeriode)}</span>
        </div>
        <table>
          <thead>
            <tr><th>DATE</th><th>TRACTEUR</th><th>REMORQUE</th><th>CHAUFFEUR</th><th>KM</th><th>LITRES</th><th>L/100</th></tr>
          </thead>
          <tbody>
            ${rows.map((r) => `
              <tr>
                <td>${formatDate(r.date)}</td>
                <td>${esc(r.plaque_tracteur)}</td>
                <td style="font-weight:700;">${r.plaque_remorque ? esc(r.plaque_remorque) : "<span style='color:var(--color-divider);font-weight:400;'>Solo</span>"}</td>
                <td style="color:var(--color-text-primary);font-weight:600;">${r.chauffeur_id && chauffeursMap[r.chauffeur_id] ? esc(chauffeursMap[r.chauffeur_id]) : "<span style='color:var(--color-text-secondary);'>—</span>"}</td>
                <td>${Math.round(r.kilometres || 0).toLocaleString("fr-FR")} km</td>
                <td>${(r.litres || 0).toFixed(1)} L</td>
                <td style="font-weight:700;color:var(--color-accent);">${(r.valeur || 0).toFixed(1)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  } catch (e) {
    wrap.innerHTML = `<div class="admin-empty"><div class="text">📡 Erreur de chargement</div></div>`;
  }
}

// ════════════════════════════════════════════════════════════════════════
// SECTION — INTERVENTIONS
// ════════════════════════════════════════════════════════════════════════

async function renderInterventions() {
  const content = document.getElementById("admin-content");
  try {
    const [tracteurs, remorques] = await Promise.all([
      dbSelect("tracteurs", {
        select: "plaque",
        filters: [{ col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }],
        order: { col: "plaque", asc: true }
      }),
      dbSelect("remorques", {
        select: "plaque",
        filters: [{ col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }],
        order: { col: "plaque", asc: true }
      })
    ]);

    const allPlaques = [
      ...tracteurs.map(t => ({ plaque: t.plaque, type: "tracteur" })),
      ...remorques.map(r => ({ plaque: r.plaque, type: "remorque" }))
    ];

    content.innerHTML = `
      <div class="admin-filters">
        <select id="filter-inter-vehicule" class="admin-select">
          <option value="">Tous les véhicules</option>
          <optgroup label="Tracteurs">
            ${tracteurs.map(t => `<option value="${t.plaque}">${t.plaque}</option>`).join("")}
          </optgroup>
          <optgroup label="Remorques">
            ${remorques.map(r => `<option value="${r.plaque}">${r.plaque}</option>`).join("")}
          </optgroup>
        </select>
        <select id="filter-inter-type" class="admin-select">
          <option value="">Tous les types</option>
          <option value="Entretien">Entretien</option>
          <option value="Panne">Panne</option>
          <option value="Crevaison">Crevaison</option>
          <option value="Accident">Accident</option>
          <option value="Autre">Autre</option>
        </select>
        <button class="btn-ajouter" id="btn-filtrer-inter">🔍 Filtrer</button>
        <button class="btn-pdf" id="btn-csv-inter">📊 CSV</button>
      </div>
      <div id="inter-table-wrap"><div class="admin-loading">Chargement…</div></div>
    `;

    document.getElementById("btn-filtrer-inter").addEventListener("click", () => {
      loadInterventionsTable(
        document.getElementById("filter-inter-vehicule").value,
        document.getElementById("filter-inter-type").value
      );
    });

    document.getElementById("btn-csv-inter").addEventListener("click", async () => {
      try {
        const { rows, chMap, enginsMap } = await _fetchInterventionsExport();
        exportInterventionsCSV(rows, chMap, enginsMap);
      } catch (e) {
        showToast("📡 Export impossible — vérifie ta connexion");
      }
    });

    loadInterventionsTable("", "");

  } catch (e) {
    content.innerHTML = `<div class="admin-empty"><div class="text">📡 Erreur de chargement</div></div>`;
  }
}

// Données pour les exports PDF/CSV — respecte les filtres actuellement
// sélectionnés à l'écran (mêmes filtres que le tableau affiché).
async function _fetchInterventionsExport() {
  const plaque = document.getElementById("filter-inter-vehicule").value;
  const type   = document.getElementById("filter-inter-type").value;
  const filters = [{ col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }];
  if (plaque) filters.push({ col: "entite_plaque", op: "eq", val: plaque });
  if (type)   filters.push({ col: "type",          op: "eq", val: type });

  const [rows, chRows, enginRows] = await Promise.all([
    dbSelect("interventions", { select: "*", filters, order: { col: "date", asc: false } }),
    dbSelect("chauffeurs", { select: "id,prenom,nom", filters: [{ col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }] }),
    dbSelect("engins", { select: "id,numero_parc,numero_serie", filters: [{ col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }] }).catch(() => [])
  ]);
  const chMap = {};
  (chRows || []).forEach(c => { chMap[c.id] = `${c.prenom} ${c.nom}`; });
  const enginsMap = {};
  (enginRows || []).forEach(e => { enginsMap[e.id] = e.numero_parc || e.numero_serie || e.id.substring(0, 8); });
  return { rows: rows || [], chMap, enginsMap };
}

const STATUT_LABEL_CSV = { a_faire: "À faire", pris_en_charge: "Pris en charge", termine: "Terminé" };

function exportInterventionsCSV(rows, chauffeursMap, enginsMap) {
  const hasAtelierStatuts = rows.some(r => !!r.statut);
  const head = ["Date", "Véhicule", "Chauffeur", "Type", "Localisation", "Détails"];
  if (hasAtelierStatuts) head.push("Statut atelier", "Commentaire mécanicien");

  const csvEscape = (val) => {
    const s = String(val ?? "");
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = [head.map(csvEscape).join(";")];
  rows.forEach((r) => {
    const vehicule = r.entite_type === "engin" ? (enginsMap[r.entite_plaque] || r.entite_plaque) : r.entite_plaque;
    const row = [
      r.date ? new Date(r.date).toLocaleDateString("fr-FR") : "",
      vehicule || "",
      chauffeursMap[r.chauffeur_id] || "",
      r.type || "",
      r.localisation && r.localisation !== "N/A" ? r.localisation : "",
      r.details || ""
    ];
    if (hasAtelierStatuts) {
      row.push(r.statut ? (STATUT_LABEL_CSV[r.statut] || r.statut) : "");
      row.push(r.commentaire_mecanicien || "");
    }
    lines.push(row.map(csvEscape).join(";"));
  });

  // ﻿ (BOM) : force Excel à reconnaître l'UTF-8 (accents) à l'ouverture.
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = `interventions_${new Date().toISOString().substring(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function loadInterventionsTable(plaque, type) {
  const wrap = document.getElementById("inter-table-wrap");
  wrap.innerHTML = `<div class="admin-loading">Chargement…</div>`;

  try {
    const filters = [
      { col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }
    ];
    if (plaque) filters.push({ col: "entite_plaque", op: "eq", val: plaque });
    if (type)   filters.push({ col: "type",          op: "eq", val: type });

    const rows = await dbSelect("interventions", {
      select: "id,entite_type,entite_plaque,date,type,details,localisation,chauffeur_id,statut,mecanicien_id,commentaire_mecanicien,created_at,termine_at",
      filters,
      order: { col: "date", asc: false }
    });

    if (rows.length === 0) {
      wrap.innerHTML = `<div class="admin-empty"><div class="icon">🔧</div><div class="text">Aucune intervention trouvée</div></div>`;
      return;
    }

    // Récupère les noms des chauffeurs concernés
    const chauffeurIds = [...new Set(rows.map(r => r.chauffeur_id).filter(Boolean))];
    let chauffeursMap = {};
    if (chauffeurIds.length > 0) {
      const chRows = await dbSelect("chauffeurs", {
        select: "id,prenom,nom",
        filters: [{ col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }]
      });
      (chRows || []).forEach(c => { chauffeursMap[c.id] = `${c.prenom || ""} ${c.nom || ""}`.trim(); });
    }

    // Récupère les noms des mécaniciens concernés (option panel atelier)
    let mecaniciensMap = {};
    if (rows.some(r => r.mecanicien_id)) {
      const mecRows = await dbSelect("admins", {
        select: "id,prenom,nom",
        filters: [{ col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }, { col: "role", op: "eq", val: "mecanicien" }]
      }).catch(() => []);
      (mecRows || []).forEach(m => { mecaniciensMap[m.id] = `${m.prenom || ""} ${m.nom || ""}`.trim(); });
    }

    // Récupère les engins pour afficher numéro de parc au lieu de l'UUID
    let enginsMap = {};
    const enginRows = await dbSelect("engins", {
      select: "id,numero_parc,numero_serie",
      filters: [{ col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }]
    }).catch(() => []);
    (enginRows || []).forEach(e => {
      enginsMap[e.id] = e.numero_parc || e.numero_serie || e.id.substring(0, 8);
    });

    const typeColors = {
      Entretien: "var(--color-success)",
      Panne:     "var(--color-warning)",
      Crevaison: "var(--color-danger)",
      Accident:  "var(--color-danger)",
      Autre:     "var(--color-text-secondary)"
    };

    // Statut atelier (option mécanicien) : lecture seule ici, aucune action.
    // rien n'est affiché si l'entreprise n'a pas l'option (statut reste NULL partout).
    const statutBadge = (statut, mecanicienId) => {
      if (!statut) return "—";
      const map = {
        a_faire:        { label: "À faire",         color: "var(--color-warning)" },
        pris_en_charge: { label: "Pris en charge",  color: "var(--color-accent)" },
        termine:        { label: "Terminé",         color: "var(--color-success)" }
      };
      const s = map[statut];
      if (!s) return "—";
      const mecanicienLabel = mecanicienId && mecaniciensMap[mecanicienId];
      const suffix = mecanicienLabel && statut !== "a_faire" ? ` — ${esc(mecanicienLabel)}` : "";
      return `<span style="color:${s.color};font-weight:700;">● ${s.label}</span>${suffix}`;
    };
    const hasAtelierStatuts = rows.some(r => !!r.statut);

    // Durée d'immobilisation — du signalement (created_at) à la clôture
    // (termine_at) si terminé, sinon depuis le signalement si toujours en
    // cours. Uniquement le temps, jamais de coût (décision explicite).
    const formatDuree = (ms) => {
      const h = ms / 3600000;
      if (h < 1)  return `${Math.round(ms / 60000)} min`;
      if (h < 24) return `${h.toFixed(1)} h`;
      return `${Math.floor(h / 24)} j ${Math.round(h % 24)} h`;
    };
    const dureeImmobilisation = (r) => {
      if (!r.created_at) return "—";
      const debut = new Date(r.created_at).getTime();
      if (r.statut === "termine" && r.termine_at) {
        return formatDuree(new Date(r.termine_at).getTime() - debut);
      }
      if (r.statut === "a_faire" || r.statut === "pris_en_charge") {
        return `${formatDuree(Date.now() - debut)} (en cours)`;
      }
      return "—";
    };

    // Stats
    const parType = {};
    rows.forEach(r => { parType[r.type] = (parType[r.type] || 0) + 1; });

    wrap.innerHTML = `
      <div class="admin-stats-row" style="margin-bottom:20px;">
        <div class="admin-stat-card" style="--stat-color:var(--color-accent);">
          <div class="admin-stat-value">${rows.length}</div>
          <div class="admin-stat-label">Total interventions</div>
        </div>
        ${Object.entries(parType).map(([t, n]) => `
          <div class="admin-stat-card" style="--stat-color:${typeColors[t] || "var(--color-accent)"};">
            <div class="admin-stat-value">${n}</div>
            <div class="admin-stat-label">${t}</div>
          </div>
        `).join("")}
      </div>

      <div class="admin-table-wrap">
        <div class="admin-table-title"><span>${rows.length} intervention(s)</span></div>
        <table>
          <thead>
            <tr>
              <th>DATE</th>
              <th>VÉHICULE</th>
              <th>CHAUFFEUR</th>
              <th>TYPE</th>
              <th>LOCALISATION</th>
              <th>DÉTAILS</th>
              ${hasAtelierStatuts ? "<th>STATUT ATELIER</th><th>IMMOBILISATION</th><th>COMMENTAIRE MÉCANO</th>" : ""}
              <th>ACTION</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td>${formatDate(r.date)}</td>
                <td>
                  <span class="atelier-ticket-plaque" data-vehicule-historique="${r.entite_type}|${r.entite_plaque}" title="Voir l'historique de ce véhicule" style="font-weight:700;">${r.entite_type === "engin" ? esc(enginsMap[r.entite_plaque] || r.entite_plaque) : esc(r.entite_plaque)}</span>
                  <span style="color:var(--color-text-secondary);font-size:12px;"> ${r.entite_type === "engin" ? "🏗️" : r.entite_type === "remorque" ? "🚛" : "🚚"}</span>
                </td>
                <td style="color:var(--color-text-primary);font-weight:600;">${r.chauffeur_id && chauffeursMap[r.chauffeur_id] ? esc(chauffeursMap[r.chauffeur_id]) : "<span style='color:var(--color-text-secondary);'>—</span>"}</td>
                <td><span style="color:${typeColors[r.type] || "inherit"};font-weight:700;">${esc(r.type)}</span></td>
                <td>${r.localisation && r.localisation !== "N/A" ? esc(r.localisation) : "—"}</td>
                <td style="max-width:300px;">${esc(r.details)}</td>
                ${hasAtelierStatuts ? `
                  <td>${statutBadge(r.statut, r.mecanicien_id)}</td>
                  <td style="white-space:nowrap;">${dureeImmobilisation(r)}</td>
                  <td style="max-width:220px;">${r.commentaire_mecanicien ? esc(r.commentaire_mecanicien) : "—"}</td>
                ` : ""}
                <td><button class="btn-supprimer" data-inter-id="${r.id}" data-inter-plaque="${esc(r.entite_type === "engin" ? (enginsMap[r.entite_plaque] || r.entite_plaque) : r.entite_plaque)}" data-inter-type="${esc(r.type)}">🗑️</button></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;

    // Listeners suppression
    wrap.querySelectorAll("[data-inter-id]").forEach(btn => {
      btn.addEventListener("click", () => supprimerIntervention(btn.dataset.interId, btn.dataset.interPlaque, btn.dataset.interType));
    });

    // Historique véhicule (même comportement que dans le panel atelier)
    wrap.querySelectorAll("[data-vehicule-historique]").forEach(el => {
      el.addEventListener("click", () => {
        const [entiteType, entitePlaque] = el.dataset.vehiculeHistorique.split("|");
        const label = entiteType === "engin" ? (enginsMap[entitePlaque] || entitePlaque) : entitePlaque;
        const icon  = entiteType === "engin" ? "🏗️" : entiteType === "remorque" ? "🚛" : "🚚";
        ouvrirHistoriqueVehicule(entiteType, entitePlaque, label, icon);
      });
    });

  } catch (e) {
    wrap.innerHTML = `<div class="admin-empty"><div class="text">📡 Erreur de chargement</div></div>`;
  }
}

async function supprimerIntervention(id, currentPlaque, currentType) {
  showModal({
    title: "Supprimer cette intervention ?",
    bodyHTML: `<p style="color:var(--color-text-secondary);font-size:14px;">Cette action est définitive et ne peut pas être annulée.</p>`,
    confirmLabel: "Supprimer",
    danger: true,
    onConfirm: async () => {
      await dbDelete("interventions", [{ col: "id", op: "eq", val: id }]);
      showToast("🗑️ Intervention supprimée");
      logActiviteEntreprise("supprimer_intervention", `Intervention ${currentType || ""} sur ${currentPlaque || "—"} supprimée`);
      loadInterventionsTable(
        document.getElementById("filter-inter-vehicule")?.value || "",
        document.getElementById("filter-inter-type")?.value || ""
      );
    }
  });
}

// ════════════════════════════════════════════════════════════════════════
// JOURNAL D'ACTIVITÉ — qui a fait quoi, quand (bureau + atelier).
// Couvre pour l'instant : validation/rejet d'inscription chauffeur,
// suppression d'intervention, prise en charge/clôture atelier. Peut être
// étendu à d'autres actions plus tard via logActiviteEntreprise().
// ════════════════════════════════════════════════════════════════════════
const JOURNAL_ACTION_ICONS = {
  valider_chauffeur:            "✅",
  rejeter_chauffeur:            "❌",
  supprimer_intervention:       "🗑️",
  prise_en_charge_intervention: "🔧",
  terminer_intervention:        "✅"
};

async function renderJournalActivite() {
  const content = document.getElementById("admin-content");
  try {
    const rows = await dbSelect("entreprise_activity_log", {
      select: "id,admin_nom,action,details,created_at",
      filters: [{ col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }],
      order: { col: "created_at", asc: false },
      limit: 150
    });

    if (!rows || rows.length === 0) {
      content.innerHTML = `<div class="admin-empty"><div class="icon">🕒</div><div class="text">Aucune activité enregistrée pour l'instant</div></div>`;
      return;
    }

    content.innerHTML = `
      <div class="admin-table-wrap">
        <div class="admin-table-title"><span>${rows.length} évènement(s)</span></div>
        <div class="journal-list">
          ${rows.map(r => `
            <div class="journal-row">
              <div class="journal-row-icon">${JOURNAL_ACTION_ICONS[r.action] || "•"}</div>
              <div class="journal-row-body">
                <div class="journal-row-text"><strong>${esc(r.admin_nom)}</strong> — ${esc(r.details || r.action)}</div>
                <div class="journal-row-time">${new Date(r.created_at).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}</div>
              </div>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  } catch (e) {
    content.innerHTML = `<div class="admin-empty"><div class="text">📡 Erreur de chargement</div></div>`;
  }
}

// ════════════════════════════════════════════════════════════════════════
// PANEL ATELIER (MÉCANICIEN) — écran dédié, complètement différent du
// dashboard exploitation. Workflow : à faire → pris en charge → terminé.
// ════════════════════════════════════════════════════════════════════════

function enterAtelier() {
  document.getElementById("admin-screen-login").classList.add("hidden");
  document.getElementById("admin-screen-atelier").classList.remove("hidden");

  document.getElementById("atelier-user-name").textContent =
    `${adminSession.prenom || ""} ${adminSession.nom || ""}`.trim() || adminSession.email || "Mécanicien";

  loadEntrepriseName("atelier-entreprise-badge");
  navigateAtelier("interventions");
  startInterventionsRealtime();
  requestAdminNotificationPermission();
}

// ─── Navigation panel atelier (sidebar propre, indépendante du bureau) ────
let currentAtelierSection = "interventions";
function navigateAtelier(section) {
  currentAtelierSection = section;

  document.querySelectorAll("[data-atelier-section]").forEach((el) => {
    el.classList.toggle("active", el.dataset.atelierSection === section);
  });

  const titles = {
    interventions:           "Interventions",
    "entretiens-vehicules":  "Entretiens véhicules",
    "historique-entretiens": "Historique entretiens frigo",
    parametres:              "Paramètres"
  };
  document.getElementById("atelier-section-title").textContent = titles[section] || section;

  const content = document.getElementById("atelier-content");
  content.innerHTML = `<div class="admin-loading">Chargement…</div>`;

  switch (section) {
    case "interventions":           renderAtelier();                              break;
    case "entretiens-vehicules":    renderEntretiensVehicules("atelier-content"); break;
    case "historique-entretiens":   renderHistoriqueEntretiens("atelier-content"); break;
    case "parametres":              renderParametres("atelier-content");           break;
  }
}

function toggleAtelierSidebar() {
  const sidebar = document.getElementById("atelier-sidebar");
  const overlay = document.getElementById("atelier-overlay");
  const isOpen  = sidebar.classList.contains("open");
  sidebar.classList.toggle("open", !isOpen);
  overlay.classList.toggle("hidden", isOpen);
}

function closeAtelierSidebar() {
  document.getElementById("atelier-sidebar").classList.remove("open");
  document.getElementById("atelier-overlay").classList.add("hidden");
}

// Réparations terminées de l'année, par mois, ventilées tracteur/remorque/engin.
function buildChartReparationsAnnee(rows) {
  const moisLabels = ["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"];
  const data = moisLabels.map((label, i) => {
    const subset = (rows || []).filter(r => r.termine_at && new Date(r.termine_at).getMonth() === i);
    return {
      label,
      tracteur: subset.filter(r => r.entite_type === "tracteur").length,
      remorque: subset.filter(r => r.entite_type === "remorque").length,
      engin:    subset.filter(r => r.entite_type === "engin").length
    };
  });

  const totalTracteur = data.reduce((s,d) => s + d.tracteur, 0);
  const totalRemorque = data.reduce((s,d) => s + d.remorque, 0);
  const totalEngin    = data.reduce((s,d) => s + d.engin, 0);
  const totalAnnee    = totalTracteur + totalRemorque + totalEngin;

  if (totalAnnee === 0) {
    return `<div class="admin-empty" style="padding:24px 8px;"><div class="text">Aucune réparation terminée cette année</div></div>`;
  }

  const C_TRACTEUR = "var(--color-accent)";
  const C_REMORQUE = "var(--color-warning)";
  const C_ENGIN    = "var(--color-purple)";

  // Comparatif chiffré — totaux de l'année, pour comparer d'un coup d'œil
  // sans avoir à additionner les barres du graphique.
  const statsHTML = `
    <div class="admin-stats-row" style="margin-bottom:18px;">
      <div class="admin-stat-card" style="--stat-color:${C_TRACTEUR};">
        <div class="admin-stat-value">${totalTracteur}</div>
        <div class="admin-stat-label">🚚 Tracteur</div>
      </div>
      <div class="admin-stat-card" style="--stat-color:${C_REMORQUE};">
        <div class="admin-stat-value">${totalRemorque}</div>
        <div class="admin-stat-label">🚛 Remorque</div>
      </div>
      <div class="admin-stat-card" style="--stat-color:${C_ENGIN};">
        <div class="admin-stat-value">${totalEngin}</div>
        <div class="admin-stat-label">🏗️ Engin</div>
      </div>
      <div class="admin-stat-card" style="--stat-color:var(--color-success);">
        <div class="admin-stat-value">${totalAnnee}</div>
        <div class="admin-stat-label">Total année</div>
      </div>
    </div>
  `;

  const W = 900, H = 300, PL = 34, PR = 16, PT = 30, PB = 40;
  const chartW = W - PL - PR;
  const chartH = H - PT - PB;
  const groupW = chartW / 12;
  const barW   = Math.min(20, groupW / 3 - 4);
  const gap    = 5;

  const maxVal = Math.max(...data.map(d => Math.max(d.tracteur, d.remorque, d.engin)), 1);

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(t => {
    const y = PT + (1 - t) * chartH;
    return `<line x1="${PL}" y1="${y}" x2="${W-PR}" y2="${y}" stroke="var(--color-divider)" stroke-width="1"/>`;
  }).join("");

  const barsSVG = data.map((d, i) => {
    const cx = PL + i * groupW + groupW / 2;
    const x0 = cx - (3*barW + 2*gap) / 2;

    const hT = d.tracteur > 0 ? Math.max(3, (d.tracteur / maxVal) * chartH) : 0;
    const hR = d.remorque > 0 ? Math.max(3, (d.remorque / maxVal) * chartH) : 0;
    const hE = d.engin    > 0 ? Math.max(3, (d.engin    / maxVal) * chartH) : 0;

    const yT = PT + chartH - hT;
    const yR = PT + chartH - hR;
    const yE = PT + chartH - hE;

    return `
      <rect x="${x0}"               y="${yT}" width="${barW}" height="${hT}" fill="${C_TRACTEUR}" rx="3" opacity="0.9">
        <title>${d.label} · Tracteur : ${d.tracteur}</title>
      </rect>
      <rect x="${x0+barW+gap}"     y="${yR}" width="${barW}" height="${hR}" fill="${C_REMORQUE}" rx="3" opacity="0.9">
        <title>${d.label} · Remorque : ${d.remorque}</title>
      </rect>
      <rect x="${x0+2*(barW+gap)}" y="${yE}" width="${barW}" height="${hE}" fill="${C_ENGIN}" rx="3" opacity="0.9">
        <title>${d.label} · Engin : ${d.engin}</title>
      </rect>
      ${d.tracteur > 0 ? `<text x="${x0+barW/2}"               y="${yT-5}" text-anchor="middle" font-size="11" font-weight="800" fill="${C_TRACTEUR}">${d.tracteur}</text>` : ""}
      ${d.remorque > 0 ? `<text x="${x0+barW+gap+barW/2}"     y="${yR-5}" text-anchor="middle" font-size="11" font-weight="800" fill="${C_REMORQUE}">${d.remorque}</text>` : ""}
      ${d.engin    > 0 ? `<text x="${x0+2*(barW+gap)+barW/2}" y="${yE-5}" text-anchor="middle" font-size="11" font-weight="800" fill="${C_ENGIN}">${d.engin}</text>` : ""}
      <text x="${cx}" y="${H-12}" text-anchor="middle" font-size="12" font-weight="700" fill="var(--color-text-secondary)">${d.label}</text>
    `;
  }).join("");

  const legendeSVG = `
    <text x="${PL}"     y="${PT-12}" font-size="11" font-weight="700" fill="${C_TRACTEUR}">■ Tracteur</text>
    <text x="${PL+90}"  y="${PT-12}" font-size="11" font-weight="700" fill="${C_REMORQUE}">■ Remorque</text>
    <text x="${PL+190}" y="${PT-12}" font-size="11" font-weight="700" fill="${C_ENGIN}">■ Engin</text>
  `;

  return `
    ${statsHTML}
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;height:auto;display:block;overflow:visible;">
      ${gridLines}
      ${barsSVG}
      ${legendeSVG}
      <line x1="${PL}" y1="${PT+chartH}" x2="${W-PR}" y2="${PT+chartH}" stroke="var(--color-divider)" stroke-width="1"/>
    </svg>
  `;
}

async function renderAtelier() {
  // Ne fait rien si on n'est plus sur l'écran atelier (ex: après déconnexion,
  // un évènement Realtime en vol pourrait sinon écrire dans un DOM disparu).
  const content = document.getElementById("atelier-content");
  if (!content || document.getElementById("admin-screen-atelier").classList.contains("hidden")) return;

  try {
    const eid = adminSession.entreprise_id;
    const anneeCourante = new Date().getFullYear();
    const [aFaireRows, enCoursRows, termineRows, chauffeurs, mecaniciens, reparationsAnnee, engins, historiqueRows, tracteurs, remorques] = await Promise.all([
      dbSelect("interventions", {
        select: "id,entite_type,entite_plaque,date,type,details,localisation,latitude,longitude,chauffeur_id,urgence",
        filters: [{ col: "entreprise_id", op: "eq", val: eid }, { col: "statut", op: "eq", val: "a_faire" }],
        order: { col: "date", asc: false }
      }),
      dbSelect("interventions", {
        select: "id,entite_type,entite_plaque,date,type,details,localisation,latitude,longitude,chauffeur_id,mecanicien_id,pris_en_charge_at,urgence",
        filters: [{ col: "entreprise_id", op: "eq", val: eid }, { col: "statut", op: "eq", val: "pris_en_charge" }],
        order: { col: "pris_en_charge_at", asc: false }
      }),
      dbSelect("interventions", {
        select: "id,entite_type,entite_plaque,date,type,localisation,latitude,longitude,chauffeur_id,mecanicien_id,termine_at,commentaire_mecanicien",
        filters: [{ col: "entreprise_id", op: "eq", val: eid }, { col: "statut", op: "eq", val: "termine" }],
        order: { col: "termine_at", asc: false },
        limit: 30
      }),
      dbSelect("chauffeurs", { select: "id,prenom,nom", filters: [{ col: "entreprise_id", op: "eq", val: eid }] }).catch(() => []),
      dbSelect("admins", { select: "id,prenom,nom", filters: [{ col: "entreprise_id", op: "eq", val: eid }, { col: "role", op: "eq", val: "mecanicien" }] }).catch(() => []),
      dbSelect("interventions", {
        select: "entite_type,termine_at",
        filters: [
          { col: "entreprise_id", op: "eq", val: eid }, { col: "statut", op: "eq", val: "termine" },
          { col: "termine_at", op: "gte", val: `${anneeCourante}-01-01` },
          { col: "termine_at", op: "lt",  val: `${anneeCourante + 1}-01-01` }
        ]
      }).catch(() => []),
      dbSelect("engins", { select: "id,numero_parc,numero_serie", filters: [{ col: "entreprise_id", op: "eq", val: eid }] }).catch(() => []),
      dbSelect("interventions", {
        select: "id,entite_type,entite_plaque,date,type,details,statut,mecanicien_id,commentaire_mecanicien,termine_at",
        filters: [{ col: "entreprise_id", op: "eq", val: eid }, { col: "statut", op: "not.is", val: "null" }],
        order: { col: "date", asc: false },
        limit: 150
      }).catch(() => []),
      dbSelect("tracteurs", { select: "plaque", filters: [{ col: "entreprise_id", op: "eq", val: eid }], order: { col: "plaque", asc: true } }).catch(() => []),
      dbSelect("remorques", { select: "plaque", filters: [{ col: "entreprise_id", op: "eq", val: eid }], order: { col: "plaque", asc: true } }).catch(() => [])
    ]);

    const chMap    = {}; (chauffeurs   || []).forEach(c => { chMap[c.id]  = `${c.prenom || ""} ${c.nom || ""}`.trim() || "—"; });
    const mecMap   = {}; (mecaniciens  || []).forEach(m => { mecMap[m.id] = `${m.prenom || ""} ${m.nom || ""}`.trim() || "—"; });
    const enginsMap = {}; (engins || []).forEach(e => { enginsMap[e.id] = e.numero_parc || e.numero_serie || e.id.substring(0, 8); });

    const iconFor = (r) => r.entite_type === "engin" ? "🏗️" : r.entite_type === "remorque" ? "🚛" : "🚚";
    const labelFor = (r) => r.entite_type === "engin" ? esc(enginsMap[r.entite_plaque] || r.entite_plaque) : esc(r.entite_plaque);

    // Photos jointes par le chauffeur au signalement — même bucket que les
    // documents (documents-chauffeurs), sous-chemin dédié intervention/.
    const allIds = [...aFaireRows, ...enCoursRows, ...termineRows].map(r => r.id);
    const photosMap = await _fetchInterventionPhotosMap(allIds);

    const localisationHTML = (r) => (r.latitude != null && r.longitude != null)
      ? `<a href="https://www.google.com/maps?q=${r.latitude},${r.longitude}" target="_blank" rel="noopener" class="atelier-ticket-maplink" title="Ouvrir dans Google Maps">${esc(r.localisation)}</a>`
      : esc(r.localisation);

    const urgenceBadge = (r) => r.urgence === "urgent"
      ? `<span class="atelier-urgence urgent">🔴 Urgent</span>`
      : r.urgence === "routine" ? `<span class="atelier-urgence routine">🟢 Routine</span>` : "";

    const ticketCard = (r, extraHTML) => `
      <div class="atelier-ticket">
        <div class="atelier-ticket-head">
          <span class="atelier-ticket-plaque" data-vehicule-historique="${r.entite_type}|${r.entite_plaque}" title="Voir l'historique de ce véhicule">${iconFor(r)} ${labelFor(r)}</span>
          <span class="atelier-ticket-type">${esc(r.type)}</span>
        </div>
        ${urgenceBadge(r)}
        ${r.details ? `<div class="atelier-ticket-details">${esc(r.details)}</div>` : ""}
        <div class="atelier-ticket-meta">${formatDate(r.date)} · ${r.chauffeur_id && chMap[r.chauffeur_id] ? esc(chMap[r.chauffeur_id]) : "—"}${r.localisation && r.localisation !== "N/A" ? " · " + localisationHTML(r) : ""}</div>
        ${photosMap[r.id]?.length ? `<div class="atelier-ticket-photos">${photosMap[r.id].map(p => p.url ? `<img src="${p.url}" data-photo-zoom="${p.url}" />` : "").join("")}</div>` : ""}
        ${r.commentaire_mecanicien ? `<div class="atelier-ticket-comment">💬 ${esc(r.commentaire_mecanicien)}</div>` : ""}
        ${extraHTML}
      </div>
    `;

    const emptyCol = (label) => `<div class="admin-empty" style="padding:24px 8px;"><div class="text">${label}</div></div>`;

    content.innerHTML = `
      <div class="atelier-section-title">SUIVI DES INTERVENTIONS</div>
      <div class="atelier-board">
        <div class="atelier-column">
          <div class="atelier-column-head" style="--col-color:var(--color-warning);"><span>À FAIRE</span><span class="atelier-count">${aFaireRows.length}</span></div>
          <div class="atelier-column-body">
            ${aFaireRows.length
              ? aFaireRows.map(r => ticketCard(r, `<button class="btn-ajouter atelier-btn-claim" data-claim="${r.id}">🔧 Prendre en charge</button>`)).join("")
              : emptyCol("Rien à faire")}
          </div>
        </div>
        <div class="atelier-column">
          <div class="atelier-column-head" style="--col-color:var(--color-accent);"><span>EN COURS</span><span class="atelier-count">${enCoursRows.length}</span></div>
          <div class="atelier-column-body">
            ${enCoursRows.length
              ? enCoursRows.map(r => ticketCard(r, `
                  <div class="atelier-ticket-owner">Pris en charge par ${esc(mecMap[r.mecanicien_id] || "—")}</div>
                  ${r.mecanicien_id === adminSession.admin_id ? `<button class="btn-valider atelier-btn-finish" data-finish="${r.id}">✅ Travaux finis</button>` : ""}
                `)).join("")
              : emptyCol("Rien en cours")}
          </div>
        </div>
        <div class="atelier-column">
          <div class="atelier-column-head" style="--col-color:var(--color-success);"><span>TERMINÉ</span><span class="atelier-count">${termineRows.length}</span></div>
          <div class="atelier-column-body">
            ${termineRows.length
              ? termineRows.map(r => ticketCard(r, `<div class="atelier-ticket-owner">Par ${esc(mecMap[r.mecanicien_id] || "—")}</div>`)).join("")
              : emptyCol("Aucun historique")}
          </div>
        </div>
      </div>

      <div class="atelier-section-title" style="margin-top:28px;">🚚 PARC — HISTORIQUE PAR VÉHICULE</div>
      <div class="atelier-parc-grid">
        ${(tracteurs || []).map(t => `<span class="atelier-parc-chip" data-vehicule-historique="tracteur|${esc(t.plaque)}">🚚 ${esc(t.plaque)}</span>`).join("")}
        ${(remorques || []).map(r => `<span class="atelier-parc-chip" data-vehicule-historique="remorque|${esc(r.plaque)}">🚛 ${esc(r.plaque)}</span>`).join("")}
        ${(engins || []).map(e => `<span class="atelier-parc-chip" data-vehicule-historique="engin|${esc(e.id)}">🏗️ ${esc(enginsMap[e.id])}</span>`).join("")}
        ${(!tracteurs?.length && !remorques?.length && !engins?.length) ? `<div class="admin-empty" style="padding:16px 8px;"><div class="text">Aucun véhicule enregistré</div></div>` : ""}
      </div>

      <div class="atelier-section-title" style="margin-top:28px;">📜 HISTORIQUE DES RÉPARATIONS</div>
      <div class="admin-filters">
        <input type="text" id="atelier-histo-search" class="admin-select" style="flex:1;min-width:160px;" placeholder="🔍 Véhicule, détails…" />
        <select id="atelier-histo-type" class="admin-select">
          <option value="">Tous les types</option>
          <option value="Entretien">Entretien</option>
          <option value="Panne">Panne</option>
          <option value="Crevaison">Crevaison</option>
          <option value="Accident">Accident</option>
          <option value="Autre">Autre</option>
        </select>
      </div>
      <div id="atelier-histo-list" class="atelier-histo-list"></div>

      <div class="atelier-section-title" style="margin-top:28px;">📊 RÉPARATIONS PAR MOIS — ${anneeCourante}</div>
      <div class="atelier-chart-wrap">
        ${buildChartReparationsAnnee(reparationsAnnee)}
      </div>
    `;

    const STATUT_LABEL_HISTO = { a_faire: "À faire", pris_en_charge: "Pris en charge", termine: "Terminé" };
    const renderHistoriqueWidget = () => {
      const search = document.getElementById("atelier-histo-search").value.trim().toLowerCase();
      const type   = document.getElementById("atelier-histo-type").value;
      const filtered = (historiqueRows || []).filter(r => {
        if (type && r.type !== type) return false;
        if (!search) return true;
        const label = labelFor(r).toLowerCase();
        return label.includes(search) || (r.details || "").toLowerCase().includes(search);
      });
      const list = document.getElementById("atelier-histo-list");
      if (!list) return;
      list.innerHTML = filtered.length ? filtered.map(r => `
        <div class="vh-row">
          <div class="vh-row-top">
            <span class="vh-row-type">${iconFor(r)} ${labelFor(r)} — ${esc(r.type)}</span>
            <span class="vh-row-date">${formatDate(r.date)}</span>
          </div>
          ${r.details ? `<div class="vh-row-details">${esc(r.details)}</div>` : ""}
          <div class="vh-row-statut">${esc(STATUT_LABEL_HISTO[r.statut] || r.statut)}${r.mecanicien_id && mecMap[r.mecanicien_id] ? ` — ${esc(mecMap[r.mecanicien_id])}` : ""}</div>
          ${r.commentaire_mecanicien ? `<div class="atelier-ticket-comment">💬 ${esc(r.commentaire_mecanicien)}</div>` : ""}
        </div>
      `).join("") : `<div class="admin-empty" style="padding:24px 8px;"><div class="text">Aucune réparation trouvée</div></div>`;
    };
    renderHistoriqueWidget();
    document.getElementById("atelier-histo-search").addEventListener("input", renderHistoriqueWidget);
    document.getElementById("atelier-histo-type").addEventListener("change", renderHistoriqueWidget);

    content.querySelectorAll("[data-claim]").forEach(btn => {
      btn.addEventListener("click", () => claimIntervention(btn.dataset.claim));
    });
    content.querySelectorAll("[data-finish]").forEach(btn => {
      btn.addEventListener("click", () => ouvrirModalFinishIntervention(btn.dataset.finish));
    });
    content.querySelectorAll("[data-vehicule-historique]").forEach(el => {
      el.addEventListener("click", () => {
        const [entiteType, entitePlaque] = el.dataset.vehiculeHistorique.split("|");
        ouvrirHistoriqueVehicule(entiteType, entitePlaque, labelFor({ entite_type: entiteType, entite_plaque: entitePlaque }), iconFor({ entite_type: entiteType }));
      });
    });
    content.querySelectorAll("[data-photo-zoom]").forEach(img => {
      img.addEventListener("click", () => window.open(img.dataset.photoZoom, "_blank"));
    });

  } catch (e) {
    content.innerHTML = `<div class="admin-empty"><div class="text">📡 Erreur de chargement</div></div>`;
  }
}

// Photos jointes aux interventions (chauffeur, à la création) — bucket
// documents-chauffeurs, même mécanisme que les documents chauffeur/véhicule.
async function _fetchInterventionPhotosMap(interventionIds) {
  if (!interventionIds || interventionIds.length === 0) return {};
  try {
    const list = interventionIds.map(id => `"${id}"`).join(",");
    const rows = await dbSelect("intervention_photos", {
      select: "id,intervention_id,storage_path",
      filters: [{ col: "intervention_id", op: "in", val: `(${list})` }]
    });
    const map = {};
    await Promise.all((rows || []).map(async (r) => {
      const url = await _getSignedUrl(r.storage_path).catch(() => null);
      if (!map[r.intervention_id]) map[r.intervention_id] = [];
      map[r.intervention_id].push({ id: r.id, url });
    }));
    return map;
  } catch (_) { return {}; }
}

// Historique complet (tous statuts) d'un véhicule, en lecture seule.
async function ouvrirHistoriqueVehicule(entiteType, entitePlaque, label, icon) {
  showModal({
    title: `${icon} Historique — ${label}`,
    bodyHTML: `<div id="vehicule-historique-body"><div class="admin-loading">Chargement…</div></div>`,
    confirmLabel: null,
    cancelLabel: "Fermer"
  });
  try {
    const rows = await dbSelect("interventions", {
      select: "id,date,type,details,statut,termine_at",
      filters: [
        { col: "entreprise_id", op: "eq", val: adminSession.entreprise_id },
        { col: "entite_type", op: "eq", val: entiteType },
        { col: "entite_plaque", op: "eq", val: entitePlaque }
      ],
      order: { col: "date", asc: false }
    });
    const body = document.getElementById("vehicule-historique-body");
    if (!body) return; // modale déjà fermée
    if (!rows || rows.length === 0) {
      body.innerHTML = `<div class="admin-empty"><div class="text">Aucune intervention enregistrée</div></div>`;
      return;
    }
    const STATUT_LABEL = { a_faire: "À faire", pris_en_charge: "Pris en charge", termine: "Terminé" };
    body.innerHTML = rows.map(r => `
      <div class="vh-row">
        <div class="vh-row-top">
          <span class="vh-row-type">${esc(r.type)}</span>
          <span class="vh-row-date">${formatDate(r.date)}</span>
        </div>
        ${r.details ? `<div class="vh-row-details">${esc(r.details)}</div>` : ""}
        ${r.statut ? `<div class="vh-row-statut">${esc(STATUT_LABEL[r.statut] || r.statut)}</div>` : ""}
      </div>
    `).join("");
  } catch (e) {
    const body = document.getElementById("vehicule-historique-body");
    if (body) body.innerHTML = `<div class="admin-empty"><div class="text">📡 Erreur de chargement</div></div>`;
  }
}

// "Travaux finis" — propose un commentaire optionnel avant clôture.
function ouvrirModalFinishIntervention(id) {
  showModal({
    title: "✅ Terminer l'intervention",
    bodyHTML: `
      <div class="admin-field">
        <label>Commentaire (optionnel)</label>
        <textarea id="finish-commentaire" rows="3" placeholder="Ex : plaquettes changées, à recontrôler dans 10 000 km…"></textarea>
      </div>
    `,
    confirmLabel: "✅ Terminer",
    onConfirm: async (body) => {
      const commentaire = body.querySelector("#finish-commentaire").value.trim();
      await finishIntervention(id, commentaire || null);
    }
  });
}

// Prise en charge atomique : le PATCH ne matche que si statut est encore
// 'a_faire' (course entre mécaniciens gérée par PostgREST, pas de fonction
// serveur nécessaire). Un tableau vide en retour = un collègue a été plus rapide.
// Un PATCH qui matche 0 ligne peut venir soit d'une vraie course perdue (le
// ticket a changé de statut), soit d'une session périmée/incohérente (JWT
// d'un autre compte écrasé dans le localStorage partagé par un autre onglet
// connecté à un autre compte — cas déjà vu en test). On distingue les deux en
// relisant l'état réel du ticket pour donner un message exact.
async function diagnoseClaimEchec(id) {
  try {
    const rows = await dbSelect("interventions", { select: "statut,mecanicien_id", filters: [{ col: "id", op: "eq", val: id }] });
    const row = rows?.[0];
    if (!row) return "❌ Cette intervention n'existe plus.";
    const estMoi = row.mecanicien_id === adminSession.admin_id;
    // Double-clic sur "Prendre en charge"/"Terminer" par le même mécanicien :
    // le 2e clic ne matche plus la ligne (déjà passée à l'état suivant) — ce
    // n'est pas une session invalide, juste une action déjà faite par lui.
    if (row.statut === "termine") {
      return estMoi ? "ℹ️ Déjà marquée terminée." : "⚠️ Déjà terminée par un collègue.";
    }
    if (row.statut === "pris_en_charge") {
      return estMoi ? "ℹ️ Déjà pris en charge par toi." : "⚠️ Déjà pris en charge par un collègue.";
    }
    return "❌ Action refusée — ta session semble invalide. Déconnecte-toi puis reconnecte-toi et réessaie.";
  } catch (_) {
    return "⚠️ Impossible de vérifier l'état de l'intervention — réessaie.";
  }
}

// Un rejet 403 (contrairement à une simple 0-ligne) vient toujours d'une
// incohérence entre le JWT réellement envoyé et l'identité utilisée dans la
// requête — typiquement 2 comptes connectés dans 2 fenêtres du MÊME
// navigateur/profil (localStorage partagé, la connexion la plus récente
// écrase le JWT des autres fenêtres). Message actionnable plutôt que
// l'erreur technique brute.
function messageErreurAction(e) {
  if (e?.status === 403) {
    return "❌ Action refusée par le serveur. Si un autre compte est connecté dans une autre fenêtre du même navigateur, utilise plutôt une fenêtre de navigation privée ou un autre navigateur pour chaque compte, puis reconnecte-toi.";
  }
  return "❌ " + (e?.message || "Erreur inconnue");
}

// Libellé lisible "Type sur Plaque" pour le journal d'activité — jamais
// l'UUID brut de l'intervention. Pour un engin, entite_plaque est son id
// interne (pas un numéro lisible), d'où le petit aller-retour en base.
async function _libelleVehiculeIntervention(row) {
  let plaque = row.entite_plaque;
  if (row.entite_type === "engin") {
    try {
      const [engin] = await dbSelect("engins", {
        select: "numero_parc,numero_serie",
        filters: [{ col: "id", op: "eq", val: row.entite_plaque }]
      });
      plaque = engin?.numero_parc || engin?.numero_serie || row.entite_plaque;
    } catch (_) {}
  }
  return `${row.type || "Intervention"} sur ${plaque}`;
}

async function claimIntervention(id) {
  try {
    const result = await dbUpdate("interventions", {
      statut: "pris_en_charge",
      mecanicien_id: adminSession.admin_id,
      pris_en_charge_at: new Date().toISOString()
    }, [
      { col: "id", op: "eq", val: id },
      { col: "statut", op: "eq", val: "a_faire" }
    ]);
    if (!result.length) {
      showToast(await diagnoseClaimEchec(id));
      renderAtelier();
      return;
    }
    showToast("🔧 Intervention prise en charge");
    _libelleVehiculeIntervention(result[0]).then(libelle =>
      logActiviteEntreprise("prise_en_charge_intervention", `${libelle} prise en charge`)
    );
    renderAtelier();
    callEdgeAuth("workshop-notify", { action: "notify_pris_en_charge", intervention_id: id })
      .catch(e => console.warn("[workshop-notify]", e.message));
  } catch (e) {
    showToast(messageErreurAction(e));
  }
}

async function finishIntervention(id, commentaire = null) {
  try {
    const result = await dbUpdate("interventions", {
      statut: "termine",
      termine_at: new Date().toISOString(),
      commentaire_mecanicien: commentaire
    }, [
      { col: "id", op: "eq", val: id },
      { col: "statut", op: "eq", val: "pris_en_charge" },
      { col: "mecanicien_id", op: "eq", val: adminSession.admin_id }
    ]);
    if (!result.length) {
      showToast(await diagnoseClaimEchec(id));
      renderAtelier();
      return;
    }
    showToast("✅ Travaux terminés");
    _libelleVehiculeIntervention(result[0]).then(libelle =>
      logActiviteEntreprise("terminer_intervention", `${libelle} terminée`)
    );
    renderAtelier();
    callEdgeAuth("workshop-notify", { action: "notify_termine", intervention_id: id })
      .catch(e => console.warn("[workshop-notify]", e.message));
  } catch (e) {
    showToast(messageErreurAction(e));
  }
}

// ─── Notifications push (abonnement mécanicien) ──────────────────────────
const VAPID_PUBLIC_KEY_ADMIN = "BP32UYy722SWjKRnQ-4qZM48tvogUPJ4THJ3uSKvIvitcSyJD1YjmEA4M8a77vWCkKe3PgtQ9Dvbzu_5ck5FPlM";

function _urlB64ToUint8ArrayAdmin(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw     = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function requestAdminNotificationPermission() {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/admin/service-worker.js");
  } catch (e) {
    console.warn("[push admin] échec enregistrement service worker:", e.message);
    return;
  }
  if (Notification.permission === "denied") return;
  if (Notification.permission === "granted") { await _subscribeAdminPush(); return; }
  const result = await Notification.requestPermission();
  if (result === "granted") await _subscribeAdminPush();
}

async function _subscribeAdminPush() {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    const sub = existing || await registration.pushManager.subscribe({
      userVisibleOnly:      true,
      applicationServerKey: _urlB64ToUint8ArrayAdmin(VAPID_PUBLIC_KEY_ADMIN)
    });

    const json = sub.toJSON();
    if (!adminSession?.admin_id || !adminSession?.entreprise_id) return;

    await dbUpsert("push_subscriptions_admins", {
      admin_id:      adminSession.admin_id,
      entreprise_id: String(adminSession.entreprise_id),
      endpoint:      json.endpoint,
      p256dh:        json.keys.p256dh,
      auth:          json.keys.auth
    }, "endpoint");
  } catch (e) {
    console.warn("[push admin] échec abonnement:", e.message);
  }
}

// ════════════════════════════════════════════════════════════════════════
// GESTION CARTES PAR VÉHICULE (tracteur ou remorque)
// ════════════════════════════════════════════════════════════════════════

// Cartes techniques pilotées par le profil du véhicule (frigo, nettoyage
// intérieur — tracteur ET remorque ; graissage — remorque seulement) — pas
// de colonne dédiée dans le tableau du Parc, éditables ici selon les cases
// cochées sur le profil. Le hayon n'en fait PAS partie : c'est une option
// cochée directement sur le véhicule (a_hayon), indépendante du profil.
const CARTES_TECHNIQUES_FRIGO = [
  { doc: "frigo",      champ: "date_entretien_frigo",     titre: "Entretien Groupe Frigo" },
  { doc: "nettoyage",  champ: "date_nettoyage_interieur", titre: "Nettoyage Intérieur"    },
];
const CARTES_TECHNIQUES_REMORQUE = [
  ...CARTES_TECHNIQUES_FRIGO,
  { doc: "graissage",  champ: "date_graissage",           titre: "Graissage Articulations"},
];

async function ouvrirGestionCartesVehicule(plaque, type) {
  const table = type === "remorque" ? "remorques" : "tracteurs";

  // Charge les cartes existantes pour ce véhicule
  const rows = await dbSelect("cartes_perso", {
    select: "id,label,a_date,date_valeur,ordre",
    filters: [
      { col: "entite_type",   op: "eq", val: type },
      { col: "entite_plaque", op: "eq", val: plaque }
    ],
    order: { col: "ordre", asc: true }
  }).catch(() => []);

  // Cartes techniques du profil (frigo/nettoyage sur tracteur ET remorque —
  // porteurs frigo compris ; graissage uniquement sur remorque)
  const champsTechniques = type === "remorque" ? CARTES_TECHNIQUES_REMORQUE : CARTES_TECHNIQUES_FRIGO;
  const selectCols = type === "remorque"
    ? "profil,date_entretien_frigo,date_nettoyage_interieur,date_graissage,date_hayon,a_hayon,bi_temperature"
    : "profil,date_entretien_frigo,date_nettoyage_interieur,date_hayon,a_hayon";
  const vRows = await dbSelect(table, {
    select: selectCols,
    filters: [{ col: "plaque", op: "eq", val: plaque }]
  }).catch(() => []);
  const vehiculeData = vRows && vRows[0];
  const profil = vehiculeData && getProfilVehicule(vehiculeData.profil);
  const docs = profil?.docs || [];
  const estFrigo = docs.includes("frigo");
  let cartesTechniques = champsTechniques
    .filter((c) => docs.includes(c.doc))
    .map((c) => ({
      ...c,
      titre: (c.doc === "frigo" && vehiculeData?.bi_temperature) ? `${c.titre} (Bi-température)` : c.titre,
      val: vehiculeData ? vehiculeData[c.champ] : null
    }));
  if (vehiculeData?.a_hayon) {
    cartesTechniques.push({ doc: "hayon", champ: "date_hayon", titre: "Hayon", val: vehiculeData.date_hayon });
  }

  function carteItemHTML(label, dateValeur, id) {
    const dateStr = dateValeur ? formatDate(dateValeur) : "Sans date";
    const color   = dateValeur ? dateColor(dateValeur) : "var(--color-text-secondary)";
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:0.5px solid var(--color-divider);">
        <div>
          <div style="font-size:13px;color:var(--color-text-primary);font-weight:600;">${esc(label)}</div>
          <div style="font-size:11px;color:${color};margin-top:2px;">${dateStr}</div>
        </div>
        <button class="btn-supprimer" data-carte-id="${id}" style="padding:4px 8px;font-size:12px;">🗑️</button>
      </div>`;
  }

  function dateColor(iso) {
    if (!iso) return "var(--color-text-secondary)";
    const diff = Math.floor((new Date(iso) - Date.now()) / 86400000);
    if (diff < 0)  return "var(--color-danger)";
    if (diff < 15) return "var(--color-warning)";
    if (diff < 60) return "var(--color-warning-soft)";
    return "var(--color-success)";
  }

  const cartesHTML = rows.length === 0
    ? `<div style="color:var(--color-text-secondary);font-size:13px;padding:8px 0;">Aucune carte configurée</div>`
    : rows.map(c => carteItemHTML(c.label, c.date_valeur, c.id)).join("");

  const cartesTechniquesHTML = cartesTechniques.length === 0 ? "" : `
      <div style="margin-bottom:16px;border-top:1px solid var(--color-divider);padding-top:16px;">
        <div style="font-size:11px;font-weight:700;color:var(--color-text-secondary);letter-spacing:1px;margin-bottom:10px;">CARTES DU PROFIL</div>
        ${cartesTechniques.map((c) => {
          const dateStr = c.val ? formatDate(c.val) : "Sans date";
          const color   = c.val ? dateColor(c.val) : "var(--color-text-secondary)";
          const isHistorique = ["frigo","nettoyage","graissage"].includes(c.doc);
          return `
          <div data-edit-technique="${c.champ}" data-titre="${esc(c.titre)}" data-val="${c.val || ""}" ${isHistorique ? `data-type-hist="${c.doc}"` : ""}
            style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:0.5px solid var(--color-divider);cursor:pointer;">
            <div style="font-size:13px;color:var(--color-text-primary);font-weight:600;">${esc(c.titre)}</div>
            <div style="font-size:11px;color:${color};display:flex;align-items:center;gap:8px;">
              ${dateStr}
              ${isHistorique ? `<span data-hist-btn="${c.champ}" title="Voir l'historique">🕐</span>` : ""}
              <span style="color:var(--color-accent);">✏️</span>
            </div>
          </div>`;
        }).join("")}
      </div>`;

  // Hayon : uniquement sur bâchée/frigo (remorque) ou porteur avec caisse
  // propre bâché/frigo (moteur) — voir _peutAvoirHayon()
  const hayonToggleHTML = _peutAvoirHayon(profil) ? `
      <label style="display:flex;align-items:center;gap:8px;margin-bottom:16px;font-size:14px;color:var(--color-text-primary);">
        <input type="checkbox" id="toggle-a-hayon" ${vehiculeData?.a_hayon ? "checked" : ""} />
        Équipée d'un hayon
      </label>` : "";

  const bitempToggleHTML = (type === "remorque" && estFrigo) ? `
      <label style="display:flex;align-items:center;gap:8px;margin-bottom:16px;font-size:14px;color:var(--color-text-primary);">
        <input type="checkbox" id="toggle-bitemp" ${vehiculeData?.bi_temperature ? "checked" : ""} />
        Bi-température (surgelé + frais dans le même groupe frigo)
      </label>` : "";

  showModal({
    title: `📋 Cartes — ${type === "remorque" ? "🚛" : "🚚"} ${esc(plaque)}`,
    bodyHTML: `
      <div style="margin-bottom:16px;">
        <div style="font-size:11px;font-weight:700;color:var(--color-text-secondary);letter-spacing:1px;margin-bottom:10px;">CARTES CONFIGURÉES</div>
        <div id="cartes-vehicule-list">${cartesHTML}</div>
      </div>
      ${hayonToggleHTML}
      ${bitempToggleHTML}
      ${cartesTechniquesHTML}
      <div style="border-top:1px solid var(--color-divider);padding-top:16px;">
        <div style="font-size:11px;font-weight:700;color:var(--color-text-secondary);letter-spacing:1px;margin-bottom:10px;">AJOUTER UNE CARTE</div>
        <div class="admin-field" style="margin-bottom:10px;">
          <label>Nom de la carte</label>
          <input type="text" id="new-carte-label" placeholder="ex: Extincteurs" style="width:100%;height:44px;background:var(--color-surface-card);border:1.5px solid var(--color-divider);border-radius:10px;padding:0 12px;color:var(--color-text-primary);font-size:14px;outline:none;" />
        </div>
        <div class="admin-field">
          <label>Date limite — optionnel</label>
          <input type="date" id="new-carte-date" style="width:100%;height:44px;background:var(--color-surface-card);border:1.5px solid var(--color-divider);border-radius:10px;padding:0 12px;color:var(--color-text-primary);font-size:14px;outline:none;" />
        </div>
        <button class="btn-ajouter" id="btn-add-carte-vehicule" style="margin-top:8px;width:100%;height:44px;">+ Ajouter</button>
      </div>
    `,
    confirmLabel: "Fermer",
    onMount: async (bodyEl, closeModal) => {
      // Option hayon (indépendante du profil, propre au véhicule)
      const hayonToggle = bodyEl.querySelector("#toggle-a-hayon");
      if (hayonToggle) {
        hayonToggle.addEventListener("change", async () => {
          const a_hayon = hayonToggle.checked;
          try {
            await dbUpdate(table, { a_hayon }, [{ col: "plaque", op: "eq", val: plaque }]);
            showToast(a_hayon ? "✅ Hayon activé" : "✅ Hayon retiré");
            renderParc();
            closeModal();
            ouvrirGestionCartesVehicule(plaque, type);
          } catch (e) {
            showToast("⚠️ Erreur : " + e.message);
            hayonToggle.checked = !a_hayon;
          }
        });
      }

      // Bi-température (info uniquement, même carte/date d'entretien frigo)
      const bitempToggle = bodyEl.querySelector("#toggle-bitemp");
      if (bitempToggle) {
        bitempToggle.addEventListener("change", async () => {
          const bi_temperature = bitempToggle.checked;
          try {
            await dbUpdate("remorques", { bi_temperature }, [{ col: "plaque", op: "eq", val: plaque }]);
            showToast(bi_temperature ? "✅ Bi-température activé" : "✅ Bi-température retiré");
            renderParc();
            closeModal();
            ouvrirGestionCartesVehicule(plaque, type);
          } catch (e) {
            showToast("⚠️ Erreur : " + e.message);
            bitempToggle.checked = !bi_temperature;
          }
        });
      }

      // Cartes techniques du profil (frigo, nettoyage, graissage → modale
      // avec photo + trace historique ; les autres restent sur l'édition simple)
      bodyEl.querySelectorAll("[data-edit-technique]").forEach((el) => {
        el.addEventListener("click", () => {
          const champ    = el.dataset.editTechnique;
          const typeHist = el.dataset.typeHist;
          const onSuccess = () => {
            renderParc();
            // La fenêtre "Cartes" reste ouverte par-dessus celle d'édition
            // de date : sans la rouvrir, elle continue d'afficher l'ancienne
            // valeur tant qu'on ne la ferme/rouvre pas soi-même.
            closeModal();
            ouvrirGestionCartesVehicule(plaque, type);
          };
          if (typeHist) {
            ouvrirEditDateAvecHistorique(
              el.dataset.titre, table, type, plaque, champ, typeHist,
              [{ col: "plaque", op: "eq", val: plaque }],
              el.dataset.val, onSuccess
            );
          } else {
            ouvrirEditDate(
              el.dataset.titre, table, champ,
              [{ col: "plaque", op: "eq", val: plaque }],
              el.dataset.val, onSuccess
            );
          }
        });
      });

      // Bouton "🕐" dédié — ouvre l'historique en lecture seule sans passer
      // par l'édition (stopPropagation pour ne pas déclencher le clic parent)
      bodyEl.querySelectorAll("[data-hist-btn]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const parent   = btn.closest("[data-edit-technique]");
          const typeHist = parent?.dataset.typeHist;
          if (typeHist) ouvrirHistoriqueViewer(type, plaque, typeHist, parent.dataset.titre);
        });
      });

      // Suppression d'une carte
      bodyEl.querySelectorAll("[data-carte-id]").forEach(btn => {
        btn.addEventListener("click", async () => {
          await dbDelete("cartes_perso", [{ col: "id", op: "eq", val: btn.dataset.carteId }]);
          showToast("🗑️ Carte supprimée");
          btn.closest("div").remove();
          renderParc();
        });
      });

      // Ajout d'une carte
      bodyEl.querySelector("#btn-add-carte-vehicule").addEventListener("click", async () => {
        const label     = bodyEl.querySelector("#new-carte-label").value.trim();
        const dateInput = bodyEl.querySelector("#new-carte-date").value;
        if (!label) { showToast("⚠️ Renseigne un nom"); return; }

        let dateISO = null;
        let aDate   = false;
        if (dateInput) {
          dateISO = dateInput;
          aDate   = true;
        }

        let inserted;
        try {
          inserted = await dbInsert("cartes_perso", {
            entreprise_id:  adminSession.entreprise_id,
            chauffeur_id:   null,
            entite_type:    type,
            entite_plaque:  plaque,
            groupe:         "Véhicules",
            label,
            a_date:         aDate,
            date_valeur:    dateISO,
            a_code:         false,
            ordre:          0
          });
        } catch(e) {
          console.error("[cartes-vehicule] insert FAIL:", e);
          showToast("⚠️ Erreur : " + e.message);
          return;
        }

        showToast(`✅ Carte "${label}" ajoutée !`);
        bodyEl.querySelector("#new-carte-label").value = "";
        bodyEl.querySelector("#new-carte-date").value  = "";
        // Rafraîchit le tableau parc en arrière-plan
        renderParc();

        // Ajoute la ligne dans la liste sans recharger
        const list = bodyEl.querySelector("#cartes-vehicule-list");
        const newId = inserted && inserted[0] ? inserted[0].id : "";
        const div = document.createElement("div");
        div.innerHTML = carteItemHTML(label, dateISO, newId);
        const innerDiv = div.firstElementChild;
        innerDiv.querySelector("[data-carte-id]").addEventListener("click", async () => {
          await dbDelete("cartes_perso", [{ col: "id", op: "eq", val: newId }]);
          showToast("🗑️ Carte supprimée");
          innerDiv.remove();
        });
        list.appendChild(innerDiv);
      });
    },
    onConfirm: () => true
  });
}

// ════════════════════════════════════════════════════════════════════════
// ÉDITION DE DATE (générique)
// ════════════════════════════════════════════════════════════════════════

function ouvrirEditDate(titre, table, colonne, filtres, valeurActuelle, onSuccess) {
  showModal({
    title: `Modifier — ${titre}`,
    bodyHTML: `
      <div class="admin-field">
        <label>Date</label>
        <input type="date" id="edit-date-input" value="${valeurActuelle || ""}"
          style="width:100%;height:50px;background:var(--color-surface-card);border:1.5px solid var(--color-divider);border-radius:12px;padding:0 16px;color:var(--color-text-primary);font-size:16px;outline:none;" />
        <div style="font-size:11px;color:var(--color-text-secondary);margin-top:6px;">Laisse vide pour réinitialiser</div>
      </div>
    `,
    confirmLabel: "Enregistrer",
    onConfirm: async (body) => {
      const dateISO = body.querySelector("#edit-date-input").value || null;
      await dbUpdate(table, { [colonne]: dateISO }, filtres);
      showToast("✅ Date mise à jour !");
      if (onSuccess) onSuccess(dateISO);
      return true;
    }
  });
}

// ─── Édition d'un champ texte simple (adresse, téléphone…) ────────────────
function ouvrirEditTexte(titre, table, colonne, filtres, valeurActuelle, onSuccess, placeholder = "") {
  showModal({
    title: `Modifier — ${titre}`,
    bodyHTML: `
      <div class="admin-field">
        <label>${esc(titre)}</label>
        <input type="text" id="edit-texte-input" value="${esc(valeurActuelle || "")}" placeholder="${esc(placeholder)}"
          style="width:100%;height:50px;background:var(--color-surface-card);border:1.5px solid var(--color-divider);border-radius:12px;padding:0 16px;color:var(--color-text-primary);font-size:16px;outline:none;" />
        <div style="font-size:11px;color:var(--color-text-secondary);margin-top:6px;">Laisse vide pour réinitialiser</div>
      </div>
    `,
    confirmLabel: "Enregistrer",
    onConfirm: async (body) => {
      const valeur = body.querySelector("#edit-texte-input").value.trim() || null;
      await dbUpdate(table, { [colonne]: valeur }, filtres);
      showToast("✅ Mis à jour !");
      if (onSuccess) onSuccess(valeur);
      return true;
    }
  });
}

// ════════════════════════════════════════════════════════════════════════
// ÉDITION DATE + HISTORIQUE (frigo / nettoyage / graissage) — la photo du
// papier d'entretien est obligatoire et conservée de façon permanente dans
// historique_entretiens, pour pouvoir répondre à un client qui conteste un
// entretien plusieurs mois après. Les autres champs (CT, assurance, carte
// conducteur…) restent sur la simple ouvrirEditDate ci-dessus.
// ════════════════════════════════════════════════════════════════════════

function _choisirPhotoHistorique(callback) {
  let input = document.getElementById("hist-input-photo");
  if (!input) {
    input = document.createElement("input");
    input.type = "file"; input.accept = "image/*";
    input.id = "hist-input-photo"; input.style.display = "none";
    document.body.appendChild(input);
  }
  input.onchange = () => {
    const file = input.files[0];
    input.value = "";
    if (file) callback(file);
  };
  input.click();
}

function ouvrirEditDateAvecHistorique(titre, table, entiteType, entitePlaque, colonne, typeEntretien, filtres, valeurActuelle, onSuccess) {
  let selectedFile = null;

  showModal({
    title: `Modifier — ${titre}`,
    bodyHTML: `
      <div class="admin-field">
        <label>Date</label>
        <input type="date" id="edit-date-input" value="${valeurActuelle || ""}"
          style="width:100%;height:50px;background:var(--color-surface-card);border:1.5px solid var(--color-divider);border-radius:12px;padding:0 16px;color:var(--color-text-primary);font-size:16px;outline:none;" />
      </div>
      <div class="admin-field" style="margin-top:10px;">
        <label>Photo du papier d'entretien (optionnel, mais conseillé)</label>
        <div style="display:flex;gap:8px;align-items:center;">
          <div id="hist-photo-picker" style="flex:1;min-height:44px;background:var(--color-surface-card);border:1.5px dashed var(--color-divider);border-radius:12px;display:flex;align-items:center;justify-content:center;padding:10px 14px;cursor:pointer;font-size:13px;color:var(--color-text-secondary);text-align:center;">
            <span id="hist-photo-picker-label">📷 Ajouter une photo (preuve conservée)</span>
          </div>
          <button type="button" id="hist-photo-clear" title="Retirer la photo" style="display:none;flex-shrink:0;width:36px;height:36px;background:none;border:1.5px solid var(--color-divider);border-radius:10px;cursor:pointer;color:var(--color-danger);font-size:14px;">✕</button>
        </div>
      </div>
      <div class="admin-field" style="margin-top:10px;">
        <label>Commentaire — optionnel</label>
        <textarea id="hist-commentaire-input" rows="2" style="width:100%;background:var(--color-surface-card);border:1.5px solid var(--color-divider);border-radius:12px;padding:10px 14px;color:var(--color-text-primary);font-size:14px;outline:none;resize:vertical;font-family:inherit;" placeholder="Ex : voyage, remarque…"></textarea>
      </div>
      <div class="admin-field" style="margin-top:10px;">
        <button type="button" id="hist-voir-historique" style="width:100%;background:transparent;border:none;color:var(--color-accent);font-size:13px;font-weight:600;padding:6px 0;cursor:pointer;">🕐 Voir l'historique</button>
      </div>
    `,
    confirmLabel: "Enregistrer",
    onMount: (bodyEl) => {
      const picker    = bodyEl.querySelector("#hist-photo-picker");
      const label     = bodyEl.querySelector("#hist-photo-picker-label");
      const clearBtn  = bodyEl.querySelector("#hist-photo-clear");
      picker.addEventListener("click", () => {
        _choisirPhotoHistorique((file) => {
          selectedFile = file;
          label.textContent = "✅ Photo prête — " + file.name;
          clearBtn.style.display = "block";
        });
      });
      clearBtn.addEventListener("click", () => {
        selectedFile = null;
        label.textContent = "📷 Ajouter une photo (preuve conservée)";
        clearBtn.style.display = "none";
      });
      bodyEl.querySelector("#hist-voir-historique").addEventListener("click", () => {
        ouvrirHistoriqueViewer(entiteType, entitePlaque, typeEntretien, titre);
      });
    },
    onConfirm: async (body) => {
      const dateISO     = body.querySelector("#edit-date-input").value || null;
      const commentaire = body.querySelector("#hist-commentaire-input").value.trim() || null;

      if (!dateISO) { showToast("⚠️ La date est obligatoire"); return false; }
      if (!selectedFile) {
        const continuer = window.confirm(
          "⚠️ Aucun document enregistré.\n\nSans photo du papier d'entretien, cette date seule ne fera pas foi en cas de litige avec un client.\n\nEnregistrer quand même ?"
        );
        if (!continuer) return false;
      }

      await dbUpdate(table, { [colonne]: dateISO }, filtres);
      await enregistrerHistoriqueEntretien({
        entrepriseId: adminSession.entreprise_id,
        entiteType, entitePlaque, typeEntretien,
        dateEntretien: dateISO, file: selectedFile, commentaire
      });
      showToast("✅ Enregistré — trace conservée");
      if (onSuccess) onSuccess(dateISO);
      return true;
    }
  });
}

// Visionneuse lecture-seule de l'historique (preuves photo + dates) — c'est
// ce qu'on ressort à un client qui conteste un entretien plusieurs mois après.
// Suppression possible sur les 3 types (frigo compris) : arbitrage volontaire
// du client en faveur de la maîtrise du volume BDD/Storage plutôt que d'une
// immutabilité stricte — objectif : purger les vieilles photos qui coûtent
// de la place sans avoir besoin d'être conservées indéfiniment.
const HISTORIQUE_TYPES_SUPPRIMABLES = ["frigo", "nettoyage", "graissage"];

async function _supprimerHistoriqueEntretien(row) {
  if (row.storage_path) {
    const resStorage = await fetch(`${SUPABASE_URL}/storage/v1/object/documents-chauffeurs/${row.storage_path}`, { method: "DELETE", headers: authHeadersNoBody() });
    if (!resStorage.ok) throw new Error(`Suppression de la photo échouée (${resStorage.status})`);
  }
  await dbDelete("historique_entretiens", [{ col: "id", op: "eq", val: row.id }]);
}

async function ouvrirHistoriqueViewer(entiteType, entitePlaque, typeEntretien, titre) {
  showModal({
    title: `🕐 Historique — ${esc(titre)}`,
    bodyHTML: `<div id="hist-viewer-list" style="display:flex;flex-direction:column;gap:10px;max-height:55vh;overflow-y:auto;"><div class="admin-loading">Chargement…</div></div>`,
    confirmLabel: null,
    cancelLabel: "Fermer",
    onMount: async (bodyEl) => {
      const listEl = bodyEl.querySelector("#hist-viewer-list");

      const renderList = (rows) => {
        if (!rows.length) {
          listEl.innerHTML = `<div style="font-size:13px;color:var(--color-text-secondary);">Aucun historique enregistré pour l'instant.</div>`;
          return;
        }
        listEl.innerHTML = rows.map(r => `
          <div style="background:var(--color-surface-card);border:1px solid var(--color-divider);border-radius:12px;padding:10px 12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <div style="font-size:13px;font-weight:700;color:var(--color-text-primary);">${formatDate(r.date_entretien)}</div>
              ${HISTORIQUE_TYPES_SUPPRIMABLES.includes(r.type_entretien)
                ? `<button data-hist-del="${r.id}" title="Supprimer cette entrée" style="background:none;border:none;cursor:pointer;font-size:14px;color:var(--color-danger);padding:2px 4px;">🗑️</button>`
                : ""}
            </div>
            ${r.photo_url
              ? `<img src="${r.photo_url}" style="width:100%;max-height:220px;object-fit:cover;border-radius:8px;margin-bottom:6px;cursor:pointer;" data-hist-photo="${esc(r.photo_url)}" />`
              : `<div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:4px;">Pas de photo</div>`}
            ${r.commentaire ? `<div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:4px;">${esc(r.commentaire)}</div>` : ""}
            <div style="font-size:11px;color:var(--color-text-secondary);">${esc(r.chauffeur_nom || r.admin_nom || "")}</div>
          </div>`).join("");

        listEl.querySelectorAll("[data-hist-photo]").forEach(img => {
          img.addEventListener("click", () => _ouvrirVisionneureAdmin(titre, img.dataset.histPhoto));
        });

        listEl.querySelectorAll("[data-hist-del]").forEach(btn => {
          btn.addEventListener("click", async () => {
            const id  = btn.dataset.histDel;
            const row = rows.find(r => String(r.id) === id);
            if (!row) return;
            if (!window.confirm("Supprimer définitivement cette entrée d'historique (et sa photo) ? Cette action est irréversible.")) return;
            try {
              btn.disabled = true; btn.textContent = "…";
              await _supprimerHistoriqueEntretien(row);
              rows = rows.filter(r => r.id !== row.id);
              renderList(rows);
              showToast("🗑️ Entrée supprimée");
            } catch (e) {
              showToast("❌ " + e.message);
              btn.disabled = false; btn.textContent = "🗑️";
            }
          });
        });
      };

      try {
        const rows = await fetchHistoriqueEntretiens(entiteType, entitePlaque, typeEntretien);
        renderList(rows);
      } catch (e) {
        listEl.innerHTML = `<div style="font-size:13px;color:var(--color-text-secondary);">Erreur de chargement.</div>`;
      }
    }
  });
}

// ════════════════════════════════════════════════════════════════════════
// PANNEAU DÉTAIL CHAUFFEUR
// ════════════════════════════════════════════════════════════════════════

async function ouvrirDetailChauffeur(chauffeurId, chauffeurs) {
  const panel = document.getElementById("detail-panel");
  if (!panel) return;

  // Si on reclique sur le même chauffeur → ferme
  if (panel.dataset.open === chauffeurId) {
    panel.style.display = "none";
    panel.dataset.open = "";
    return;
  }
  panel.dataset.open = chauffeurId;
  panel.style.display = "block";
  panel.innerHTML = `<div class="admin-loading">Chargement…</div>`;

  try {
    const chauffeur = chauffeurs.find(c => c.id === chauffeurId);
    if (!chauffeur) return;

    // Charge les cartes perso
    const cartesPerso = await dbSelect("cartes_perso", {
      select: "id,label,a_date,date_valeur,groupe",
      filters: [{ col: "chauffeur_id", op: "eq", val: chauffeurId }],
      order: { col: "groupe", asc: true }
    });

    const initiales = ((chauffeur.prenom || "?")[0] + (chauffeur.nom || "?")[0]).toUpperCase();

    const docs = [
      { label: "Carte conducteur",  val: chauffeur.date_carte_conducteur, champ: "date_carte_conducteur" },
      { label: "Visite médicale",   val: chauffeur.date_visite_medicale,  champ: "date_visite_medicale"  },
      { label: "FCO",               val: chauffeur.date_fco,              champ: "date_fco"              },
      { label: "ADR",               val: chauffeur.date_adr,              champ: "date_adr"              },
      { label: "Carte d'identité",  val: chauffeur.date_carte_identite,   champ: "date_carte_identite"   },
    ];

    const infos = [
      { label: "Adresse",   val: chauffeur.adresse,   champ: "adresse",   placeholder: "12 rue Exemple, 75000 Paris" },
      { label: "Téléphone", val: chauffeur.telephone, champ: "telephone", placeholder: "06 12 34 56 78" },
    ];

    const cartes = [
      { label: "Carte AS24",   val: chauffeur.date_carte_as24 },
      { label: "Carte TOTAL",  val: chauffeur.date_carte_total },
          ].filter(c => c.val);

    function dateColor(iso) {
      if (!iso) return "var(--color-text-secondary)";
      const diff = Math.floor((new Date(iso) - Date.now()) / 86400000);
      if (diff < 0)  return "var(--color-danger)";
      if (diff < 15) return "var(--color-warning)";
      if (diff < 60) return "var(--color-warning-soft)";
      return "var(--color-success)";
    }

    const docsHTML = docs.map(d => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:0.5px solid var(--color-divider);cursor:pointer;"
        data-edit-doc="${d.champ}" data-edit-val="${d.val || ""}">
        <span style="font-size:12px;color:var(--color-text-secondary);">${esc(d.label)}</span>
        <span style="font-size:12px;font-weight:700;color:${dateColor(d.val)};">
          ${d.val ? formatDate(d.val) : "—"} <span style="font-size:10px;color:var(--color-accent);">✏️</span>
        </span>
      </div>
    `).join("");

    const infosHTML = infos.map(d => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:0.5px solid var(--color-divider);cursor:pointer;gap:10px;"
        data-edit-info="${d.champ}">
        <span style="font-size:12px;color:var(--color-text-secondary);white-space:nowrap;">${esc(d.label)}</span>
        <span style="font-size:12px;font-weight:700;color:var(--color-text-primary);text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          ${d.val ? esc(d.val) : "—"} <span style="font-size:10px;color:var(--color-accent);">✏️</span>
        </span>
      </div>
    `).join("");

    const cartesGazoleHTML = cartes.length ? cartes.map(c => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:0.5px solid var(--color-divider);">
        <span style="font-size:12px;color:var(--color-text-secondary);">${esc(c.label)}</span>
        <span style="font-size:12px;font-weight:700;color:${dateColor(c.val)};">${formatDate(c.val)}</span>
      </div>
    `).join("") : `<div style="font-size:12px;color:var(--color-text-secondary);">Aucune</div>`;

    const cartesPersoAvecDate = cartesPerso.filter(c => c.a_date && c.date_valeur);
    const cartesPersoHTML = cartesPersoAvecDate.length ? cartesPersoAvecDate.map(c => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;background:var(--color-surface-card);border-radius:8px;margin-bottom:4px;gap:8px;">
        <span style="font-size:12px;color:var(--color-text-primary);">${esc(c.label)}</span>
        <span style="font-size:12px;font-weight:700;color:${dateColor(c.date_valeur)};white-space:nowrap;">${formatDate(c.date_valeur)}</span>
      </div>
    `).join("") : `<div style="font-size:12px;color:var(--color-text-secondary);">Aucune</div>`;

    panel.innerHTML = `
      <div style="background:var(--color-surface);border:1px solid var(--color-accent);border-radius:16px;overflow:hidden;">
        <!-- Header -->
        <div style="padding:14px 16px;border-bottom:1px solid var(--color-divider);display:flex;align-items:center;justify-content:space-between;">
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="width:38px;height:38px;border-radius:50%;background:rgba(0,194,255,0.15);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:var(--color-accent);">${initiales}</div>
            <div>
              <div style="font-size:14px;font-weight:800;color:var(--color-text-primary);">${esc(chauffeur.prenom)} ${esc(chauffeur.nom)}</div>
              <div style="font-size:11px;color:var(--color-text-secondary);">${esc(chauffeur.email)}</div>
            </div>
          </div>
          <button id="btn-close-detail" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--color-text-secondary);">✕</button>
        </div>

        <!-- Coordonnées -->
        <div style="padding:12px 16px;border-bottom:1px solid var(--color-divider);">
          <div style="font-size:10px;font-weight:700;color:var(--color-text-secondary);letter-spacing:1px;margin-bottom:8px;">COORDONNÉES</div>
          ${infosHTML}
        </div>

        <!-- Docs perso -->
        <div style="padding:12px 16px;border-bottom:1px solid var(--color-divider);">
          <div style="font-size:10px;font-weight:700;color:var(--color-text-secondary);letter-spacing:1px;margin-bottom:8px;">DOCUMENTS PERSONNELS</div>
          ${docsHTML}
        </div>

        <!-- Cartes gazole -->
        <div style="padding:12px 16px;border-bottom:1px solid var(--color-divider);">
          <div style="font-size:10px;font-weight:700;color:var(--color-text-secondary);letter-spacing:1px;margin-bottom:8px;">CARTES GAZOLE</div>
          ${cartesGazoleHTML}
        </div>

        <!-- Cartes perso -->
        <div style="padding:12px 16px;border-bottom:1px solid var(--color-divider);">
          <div style="font-size:10px;font-weight:700;color:var(--color-text-secondary);letter-spacing:1px;margin-bottom:8px;">CARTES PERSONNALISÉES</div>
          ${cartesPersoHTML}
        </div>

        <!-- Photos documents chauffeur -->
        <div style="padding:12px 16px;" id="admin-detail-photos">
          <div style="font-size:10px;font-weight:700;color:var(--color-text-secondary);letter-spacing:1px;margin-bottom:8px;">PHOTOS DOCUMENTS</div>
          <div class="admin-loading" style="font-size:12px;">Chargement…</div>
        </div>
      </div>
    `;

    document.getElementById("btn-close-detail").addEventListener("click", () => {
      panel.style.display = "none";
      panel.dataset.open = "";
    });

    // Charge les photos chauffeur en arrière-plan
    _reloadPhotosForChauffeur(chauffeurId).then(() => _refreshDetailPhotoSection(chauffeurId));

    // Coordonnées cliquables
    panel.querySelectorAll("[data-edit-info]").forEach(el => {
      el.addEventListener("click", () => {
        const champ = el.dataset.editInfo;
        const info  = infos.find(d => d.champ === champ);
        ouvrirEditTexte(
          info ? info.label : champ,
          "chauffeurs",
          champ,
          [{ col: "id", op: "eq", val: chauffeurId }],
          info ? info.val : null,
          (newVal) => {
            chauffeur[champ] = newVal;
            ouvrirDetailChauffeur(chauffeurId, chauffeurs);
          },
          info ? info.placeholder : ""
        );
      });
    });

    // Dates docs perso cliquables
    panel.querySelectorAll("[data-edit-doc]").forEach(el => {
      el.addEventListener("click", () => {
        const champ = el.dataset.editDoc;
        const doc   = docs.find(d => d.champ === champ);
        ouvrirEditDate(
          doc ? doc.label : champ,
          "chauffeurs",
          champ,
          [{ col: "id", op: "eq", val: chauffeurId }],
          doc ? doc.val : null,
          (newDate) => {
            // Met à jour localement et rafraîchit le panneau
            chauffeur[champ] = newDate;
            ouvrirDetailChauffeur(chauffeurId, chauffeurs);
          }
        );
      });
    });

  } catch (e) {
    panel.innerHTML = `<div style="color:var(--color-danger);padding:16px;">Erreur de chargement</div>`;
  }
}

// ════════════════════════════════════════════════════════════════════════
// SYSTÈME D'ALERTES — calcul + affichage
// ════════════════════════════════════════════════════════════════════════

// ─── Calcul du statut d'une date ─────────────────────────────────────────
function alerteStatut(iso) {
  if (!iso) return null;
  const diff = Math.floor((new Date(iso) - Date.now()) / 86400000);
  if (diff < 0)   return { rang: 3, label: `Expiré depuis ${Math.abs(diff)}j`, classe: "red",    badge: "🔴" };
  if (diff < 15)  return { rang: 2, label: `Dans ${diff} jour${diff > 1 ? "s" : ""}`,  classe: "orange", badge: "🟠" };
  if (diff < 60)  return { rang: 1, label: `Dans ${diff} jours`, classe: "yellow", badge: "🟡" };
  return null; // OK, pas d'alerte
}

function alerteStatutLabel(rang) {
  if (rang >= 3) return { txt: "🔴 Critique", classe: "red" };
  if (rang >= 2) return { txt: "🟠 Urgent",   classe: "orange" };
  if (rang >= 1) return { txt: "🟡 Attention", classe: "yellow" };
  return           { txt: "✅ OK",          classe: "ok" };
}

// ─── Collecte toutes les alertes chauffeurs ───────────────────────────────
function collecterAlertesChaufferus(chauffeurs) {
  const alertes = [];
  const DOCS = [
    { key: "date_carte_conducteur", label: "Carte conducteur" },
    { key: "date_visite_medicale",  label: "Visite médicale"  },
    { key: "date_fco",              label: "FCO"               },
    { key: "date_adr",              label: "ADR"               },
    { key: "date_carte_identite",   label: "Carte d'identité"  },
    { key: "date_carte_as24",       label: "Carte AS24"        },
    { key: "date_carte_total",      label: "Carte TOTAL"       },
    ];
  for (const c of chauffeurs) {
    for (const doc of DOCS) {
      const st = alerteStatut(c[doc.key]);
      if (st) alertes.push({ nom: `${c.prenom} ${c.nom}`, doc: doc.label, chauffeurId: c.id, ...st });
    }
  }
  return alertes.sort((a, b) => b.rang - a.rang);
}

// ─── Collecte toutes les alertes véhicules ───────────────────────────────
function collecterAlertesVehicules(tracteurs, remorques) {
  const alertes = [];
  const DOCS_T = [
    { key: "date_ct",                label: "Contrôle Technique" },
    { key: "date_assurance",         label: "Assurance"          },
    { key: "date_limiteur_vitesse",  label: "Limiteur vitesse"   },
    { key: "date_chronotachygraphe", label: "Chronotachygraphe"  },
  ];
  const DOCS_R = [
    { key: "date_ct",       label: "Contrôle Technique" },
    { key: "date_assurance", label: "Assurance"         },
  ];
  for (const t of tracteurs) {
    for (const doc of DOCS_T) {
      const st = alerteStatut(t[doc.key]);
      if (st) alertes.push({ nom: `🚚 ${t.plaque}`, doc: doc.label, section: "parc", ...st });
    }
  }
  for (const r of remorques) {
    for (const doc of DOCS_R) {
      const st = alerteStatut(r[doc.key]);
      if (st) alertes.push({ nom: `🚛 ${r.plaque}`, doc: doc.label, section: "parc", ...st });
    }
  }
  return alertes.sort((a, b) => b.rang - a.rang);
}

// ─── Mise à jour des badges nav ───────────────────────────────────────────
function mettreAJourBadgesNav(alertesC, alertesV, alertesE = []) {
  const badgeC = document.getElementById("nav-badge-chauffeurs");
  const badgeP = document.getElementById("nav-badge-parc");
  const badgeE = document.getElementById("nav-badge-engins");
  const badgeA = document.getElementById("nav-badge-alertes");

  if (badgeC) {
    const n = alertesC.length;
    badgeC.textContent = n;
    badgeC.className   = n > 0 ? `nav-badge${alertesC[0].rang >= 3 ? "" : " warn"}` : "nav-badge hidden";
  }
  if (badgeP) {
    const n = alertesV.length;
    badgeP.textContent = n;
    badgeP.className   = n > 0 ? `nav-badge${alertesV[0].rang >= 3 ? "" : " warn"}` : "nav-badge hidden";
  }
  if (badgeE) {
    const n = alertesE.length;
    badgeE.textContent = n;
    badgeE.className   = n > 0 ? `nav-badge${alertesE[0].rang >= 3 ? "" : " warn"}` : "nav-badge hidden";
  }
  if (badgeA) {
    const total = alertesC.length + alertesV.length + alertesE.length;
    badgeA.textContent = total;
    const topRang = [...alertesC, ...alertesV, ...alertesE].reduce((m,a) => Math.max(m, a.rang ?? 0), 0);
    badgeA.className   = total > 0 ? `nav-badge${topRang >= 3 ? "" : " warn"}` : "nav-badge hidden";
  }
}

// ─── Bandeau alertes ─────────────────────────────────────────────────────
function renderAlerteBandeau(alertesC, alertesV) {
  const toutes = [...alertesC, ...alertesV].sort((a, b) => b.rang - a.rang);
  if (toutes.length === 0) return "";

  const nbRed    = toutes.filter(a => a.rang >= 3).length;
  const nbOrange = toutes.filter(a => a.rang === 2).length;
  const nbYellow = toutes.filter(a => a.rang === 1).length;

  const chips = [
    nbRed    ? `<div class="alert-chip chip-red"><div class="chip-dot"></div>${nbRed} expiré${nbRed > 1 ? "s" : ""}</div>` : "",
    nbOrange ? `<div class="alert-chip chip-orange"><div class="chip-dot"></div>${nbOrange} urgent${nbOrange > 1 ? "s" : ""}</div>` : "",
    nbYellow ? `<div class="alert-chip chip-yellow"><div class="chip-dot"></div>${nbYellow} bientôt</div>` : "",
  ].join("");

  const rowsC = alertesC.map(a => `
    <div class="alert-row" data-goto-chauffeur="${a.chauffeurId || ""}">
      <div class="alert-dot ${a.classe}"></div>
      <div class="alert-row-label"><strong>${esc(a.nom)}</strong> — ${esc(a.doc)}</div>
      <div class="alert-row-date ${a.classe}">${esc(a.label)}</div>
    </div>`).join("");

  const rowsV = alertesV.map(a => `
    <div class="alert-row" data-goto="parc">
      <div class="alert-dot ${a.classe}"></div>
      <div class="alert-row-label"><strong>${esc(a.nom)}</strong> — ${esc(a.doc)}</div>
      <div class="alert-row-date ${a.classe}">${esc(a.label)}</div>
    </div>`).join("");

  const sectionsHTML = [
    alertesC.length ? `<div class="alert-section-title">CHAUFFEURS</div>${rowsC}` : "",
    alertesV.length ? `<div class="alert-section-title">VÉHICULES</div>${rowsV}` : "",
  ].join("");

  return `
    <div class="alert-banner" id="alert-banner">
      <div class="alert-banner-header" id="alert-banner-header">
        <div class="alert-banner-header-left">
          <span style="font-size:20px;">🔔</span>
          <div>
            <div class="alert-banner-title">Alertes documents</div>
            <div class="alert-banner-subtitle">${toutes.length} document${toutes.length > 1 ? "s" : ""} nécessite${toutes.length === 1 ? "" : "nt"} votre attention</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <div class="alert-chips">${chips}</div>
          <div class="alert-banner-toggle" id="alert-toggle">⌄</div>
        </div>
      </div>
      <div class="alert-list" id="alert-list" style="display:none;">
        ${sectionsHTML}
      </div>
    </div>
  `;
}

// ─── Attache les listeners du bandeau ────────────────────────────────────
function attachAlerteBandeauListeners(chauffeurs) {
  const header = document.getElementById("alert-banner-header");
  const list   = document.getElementById("alert-list");
  const toggle = document.getElementById("alert-toggle");
  if (!header) return;

  header.addEventListener("click", () => {
    const open = list.style.display !== "none";
    list.style.display = open ? "none" : "block";
    toggle.style.transform = open ? "" : "rotate(180deg)";
  });

  // Clic sur une ligne chauffeur → ouvre le détail
  document.querySelectorAll("[data-goto-chauffeur]").forEach(row => {
    const id = row.dataset.gotochauffeur || row.dataset.gotoChauffeur;
    if (!id) return;
    row.addEventListener("click", () => {
      if (currentSection !== "chauffeurs") navigateTo("chauffeurs");
      setTimeout(() => ouvrirDetailChauffeur(id, chauffeurs), 300);
    });
  });

  // Clic sur une ligne véhicule → va dans Parc
  document.querySelectorAll("[data-goto='parc']").forEach(row => {
    row.addEventListener("click", () => navigateTo("parc"));
  });
}

// ─── Badge coloré sur une date dans un tableau ────────────────────────────
function dateBadge(iso) {
  if (!iso) return `<span style="color:var(--color-text-secondary);">—</span>`;
  const diff  = Math.floor((new Date(iso) - Date.now()) / 86400000);
  const color = diff < 0 ? "var(--color-danger)" : diff < 15 ? "var(--color-warning)" : diff < 60 ? "var(--color-warning-soft)" : "var(--color-success)";
  const label = diff < 0   ? `⚠️ Expiré`
              : diff < 15  ? `⚡ ${diff}j`
              : diff < 60  ? `⏳ ${formatDate(iso)}`
              : `✓ ${formatDate(iso)}`;
  return `<span style="color:${color};font-weight:600;font-size:11px;">${label}</span>`;
}

// ─── Charge les alertes globales (appelé au login + Realtime) ────────────
let _alertesCache = { chauffeurs: [], vehicules: [], engins: [] };

function collecterAlertesEngins(engins) {
  const now  = Date.now();
  const in30 = new Date(now + 30 * 86400000).toISOString().slice(0, 10);
  const alertes = [];
  const CHAMPS = [
    { c: "date_assurance", l: "Assurance"  },
    { c: "date_vgp",       l: "VGP"        },
    { c: "date_entretien", l: "Entretien"  },
  ];
  (engins || []).forEach(e => {
    CHAMPS.forEach(({ c, l }) => {
      if (!e[c] || e[c] > in30) return;
      const diff = Math.ceil((new Date(e[c]) - now) / 86400000);
      const rang = diff < 0 ? 3 : diff < 15 ? 3 : 2;
      const nom  = e.numero_parc || e.numero_serie || "Engin";
      alertes.push({ type: "engin", label: l, nom, date: e[c], diff, rang });
    });
  });
  return alertes.sort((a, b) => a.diff - b.diff);
}

async function chargerAlertes() {
  try {
    const [chauffeurs, tracteurs, remorques, engins] = await Promise.all([
      dbSelect("chauffeurs", {
        select: "id,prenom,nom,date_carte_conducteur,date_visite_medicale,date_fco,date_adr,date_carte_as24,date_carte_total",
        filters: [
          { col: "entreprise_id", op: "eq", val: adminSession.entreprise_id },
          { col: "est_valide",    op: "eq", val: "true" }
        ]
      }),
      dbSelect("tracteurs", {
        select: "plaque,date_ct,date_assurance,date_limiteur_vitesse,date_chronotachygraphe",
        filters: [{ col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }]
      }),
      dbSelect("remorques", {
        select: "plaque,date_ct,date_assurance",
        filters: [{ col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }]
      }),
      dbSelect("engins", {
        select: "numero_parc,numero_serie,date_assurance,date_vgp,date_entretien",
        filters: [{ col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }]
      }).catch(() => [])
    ]);
    _alertesCache.chauffeurs = collecterAlertesChaufferus(chauffeurs || []);
    _alertesCache.vehicules  = collecterAlertesVehicules(tracteurs || [], remorques || []);
    _alertesCache.engins     = collecterAlertesEngins(engins || []);
    mettreAJourBadgesNav(_alertesCache.chauffeurs, _alertesCache.vehicules, _alertesCache.engins);
  } catch (_) {}
}

// ════════════════════════════════════════════════════════════════════════
// PHOTOS DOCUMENTS — admin
// ════════════════════════════════════════════════════════════════════════

// ─── Realtime photos ─────────────────────────────────────────────────────
function startDocPhotosRealtime() {
  if (unsubDocPhotos) return;
  const supabase = getSupabase();
  const channel  = supabase
    .channel("admin-doc-photos")
    .on("postgres_changes",
      { event: "*", schema: "public", table: "documents_photos" },
      async (payload) => {
        // Sur DELETE, payload.old contient les données (grâce à REPLICA IDENTITY FULL)
        // Sur INSERT/UPDATE, payload.new contient les données
        const row         = payload.new || payload.old || {};
        const chauffeurId = row.chauffeur_id;
        const entityType  = row.entity_type;
        const storagePath = row.storage_path || "";

        // Si on n'a pas de chauffeurId (ne devrait plus arriver avec REPLICA IDENTITY FULL)
        // on rafraîchit quand même le panneau ouvert
        if (!chauffeurId) {
          const panel = document.getElementById("detail-panel");
          if (panel && panel.dataset.open) {
            await _reloadPhotosForChauffeur(panel.dataset.open);
            _refreshDetailPhotoSection(panel.dataset.open);
          }
          const vp = document.getElementById("vehicle-photo-panel");
          if (vp && vp.dataset.plaque) {
            await _reloadPhotosForVehicule(vp.dataset.plaque, vp.dataset.vtype || "tracteur");
            _refreshVehiclePhotoPanel(vp.dataset.plaque, vp.dataset.vtype || "tracteur");
          }
          return;
        }

        if (!entityType || entityType === "chauffeur") {
          await _reloadPhotosForChauffeur(chauffeurId);
          const panel = document.getElementById("detail-panel");
          if (panel && panel.dataset.open === chauffeurId) _refreshDetailPhotoSection(chauffeurId);
        } else {
          const parts = storagePath.split("/");
          const plaque = parts[2] || "";
          if (plaque) {
            await _reloadPhotosForVehicule(plaque, entityType);
            const vp = document.getElementById("vehicle-photo-panel");
            if (vp && vp.dataset.plaque === plaque) _refreshVehiclePhotoPanel(plaque, entityType);
          }
        }
      }
    )
    .subscribe();
  unsubDocPhotos = () => supabase.removeChannel(channel);
}

// ─── Signed URL ───────────────────────────────────────────────────────────
async function _getSignedUrl(storagePath) {
  if (!storagePath) return null;
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/sign/documents-chauffeurs/${storagePath}`,
    { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 3600 }) }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.signedURL ? `${SUPABASE_URL}/storage/v1${data.signedURL}` : null;
}

// ─── Reload photos chauffeur (entity_type = chauffeur uniquement) ─────────
async function _reloadPhotosForChauffeur(chauffeurId) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/documents_photos?select=carte_slug,carte_label,storage_path&chauffeur_id=eq.${chauffeurId}&entity_type=eq.chauffeur`,
      { headers: authHeaders() }
    );
    const rows   = res.ok ? await res.json() : [];
    const result = {};
    await Promise.all((rows || []).map(async (row) => {
      const url = await _getSignedUrl(row.storage_path).catch(() => null);
      result[row.carte_slug] = { label: row.carte_label, storage_path: row.storage_path, url };
    }));
    docPhotosCache[chauffeurId] = result;
  } catch (_) {}
}

// Popup de sélection avant export — l'utilisateur choisit au clic ce qui
// entre dans le PDF (une carte perso "Télépéage" n'intéresse pas un client,
// mais mieux vaut lui laisser le choix à chaque export plutôt que deviner).
// items : { label, date, statut, defaultChecked }[] pour les dates,
//         { label, base64, width, height }[] pour les photos (toujours
//         cochées par défaut, l'utilisateur peut les décocher au cas par cas).
// Regroupe une liste d'items par leur champ "groupe" en conservant leur
// index d'origine (nécessaire pour retrouver la bonne case à cocher dans le
// DOM). S'il n'y a qu'un seul groupe (export simple, une seule entité), pas
// de sous-titre affiché — le regroupement ne sert que pour l'export combiné.
function _grouperPourAffichage(items) {
  const noms = [...new Set(items.map((it) => it.groupe).filter(Boolean))];
  if (noms.length <= 1) return [{ nom: null, entries: items.map((it, i) => ({ it, i })) }];
  const groupes = noms.map((nom) => ({
    nom,
    entries: items.map((it, i) => ({ it, i })).filter((e) => e.it.groupe === nom)
  }));
  const sansGroupe = items.map((it, i) => ({ it, i })).filter((e) => !e.it.groupe);
  if (sansGroupe.length) groupes.push({ nom: null, entries: sansGroupe });
  return groupes;
}

function _ouvrirSelectionDossierPDF(entite, dateItems, photos, infos = []) {
  if (dateItems.length === 0 && photos.length === 0 && infos.length === 0) {
    showToast("⚠️ Aucun document disponible pour cette sélection");
    return;
  }

  const infoGroupesHTML = _grouperPourAffichage(infos).map((g) => `
    ${g.nom ? `<div style="font-size:11px;font-weight:800;color:var(--color-accent);margin:12px 0 4px;">${esc(g.nom)}</div>` : ""}
    ${g.entries.map(({ it: d, i }) => `
      <label style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:0.5px solid var(--color-divider);cursor:pointer;">
        <input type="checkbox" data-sel-info="${i}" ${d.defaultChecked ? "checked" : ""} />
        <span style="flex:1;font-size:13px;color:var(--color-text-primary);">${esc(d.label)}</span>
        <span style="font-size:11px;color:var(--color-text-secondary);white-space:nowrap;">${esc(d.valeur)}</span>
      </label>
    `).join("")}
  `).join("");

  const dateGroupesHTML = _grouperPourAffichage(dateItems).map((g) => `
    ${g.nom ? `<div style="font-size:11px;font-weight:800;color:var(--color-accent);margin:12px 0 4px;">${esc(g.nom)}</div>` : ""}
    ${g.entries.map(({ it: d, i }) => `
      <label style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:0.5px solid var(--color-divider);cursor:pointer;">
        <input type="checkbox" data-sel-date="${i}" ${d.defaultChecked !== false ? "checked" : ""} />
        <span style="flex:1;font-size:13px;color:var(--color-text-primary);">${esc(d.label)}</span>
        <span style="font-size:11px;color:var(--color-text-secondary);white-space:nowrap;">${d.date ? new Date(d.date).toLocaleDateString("fr-FR") : "—"}</span>
      </label>
    `).join("")}
  `).join("");

  const photoGroupesHTML = _grouperPourAffichage(photos).map((g) => `
    ${g.nom ? `<div style="font-size:11px;font-weight:800;color:var(--color-accent);margin:12px 0 4px;">${esc(g.nom)}</div>` : ""}
    ${g.entries.map(({ it: p, i }) => `
      <label style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:0.5px solid var(--color-divider);cursor:pointer;">
        <input type="checkbox" data-sel-photo="${i}" checked />
        <span style="width:36px;height:28px;border-radius:5px;overflow:hidden;flex-shrink:0;background:var(--color-surface-card);">
          <img src="${p.base64}" style="width:100%;height:100%;object-fit:cover;" />
        </span>
        <span style="flex:1;font-size:13px;color:var(--color-text-primary);">${esc(p.label)}</span>
      </label>
    `).join("")}
  `).join("");

  showModal({
    title: "Choisir les documents à exporter",
    bodyHTML: `
      ${infos.length ? `<div style="font-size:10px;font-weight:700;color:var(--color-text-secondary);letter-spacing:1px;margin:2px 0 4px;">COORDONNÉES</div>${infoGroupesHTML}` : ""}
      ${dateItems.length ? `<div style="font-size:10px;font-weight:700;color:var(--color-text-secondary);letter-spacing:1px;margin:14px 0 4px;">DATES / DOCUMENTS</div>${dateGroupesHTML}` : ""}
      ${photos.length ? `<div style="font-size:10px;font-weight:700;color:var(--color-text-secondary);letter-spacing:1px;margin:14px 0 4px;">PHOTOS</div>${photoGroupesHTML}` : ""}
    `,
    confirmLabel: "📄 Générer le PDF",
    onConfirm: (body) => {
      const selInfos  = infos.filter((_, i) => body.querySelector(`[data-sel-info="${i}"]`)?.checked);
      const selDates  = dateItems.filter((_, i) => body.querySelector(`[data-sel-date="${i}"]`)?.checked);
      const selPhotos = photos.filter((_, i) => body.querySelector(`[data-sel-photo="${i}"]`)?.checked);
      if (selDates.length === 0 && selPhotos.length === 0 && selInfos.length === 0) { showToast("⚠️ Sélectionne au moins un document"); return false; }
      exportDossierPDF(entite, selDates, selPhotos, selInfos);
      showToast("✅ PDF généré");
      return true;
    }
  });
}

// Uniquement les documents de conformité réglementaire — les cartes
// carburant (AS24, TOTAL) sont un outil interne, aucun intérêt pour un
// client qui demande une preuve de conformité, donc volontairement absentes
// d'ici (elles restent visibles ailleurs dans le panel, juste pas dans l'export).
const CHAMPS_DOCS_CHAUFFEUR = [
  { label: "Carte conducteur", champ: "date_carte_conducteur" },
  { label: "Visite médicale",  champ: "date_visite_medicale"  },
  { label: "FCO",              champ: "date_fco"              },
  { label: "ADR",              champ: "date_adr"              },
  { label: "Carte d'identité", champ: "date_carte_identite"   }
];

// Coordonnées du chauffeur — pas des dates de conformité, mais des données
// personnelles que certains clients demandent (adresse, téléphone). Décochées
// par défaut dans la popup d'export, comme les cartes perso.
const CHAMPS_INFOS_CHAUFFEUR = [
  { label: "Adresse",   champ: "adresse"   },
  { label: "Téléphone", champ: "telephone" }
];

// Rassemble les dates + photos d'UN chauffeur, sans ouvrir de popup — pure
// collecte de données, réutilisée par l'export combiné (écran "Exports").
async function _collecterDonneesChauffeur(chauffeurId) {
  const rows = await dbSelect("chauffeurs", {
    select: "id,prenom,nom,adresse,telephone,date_carte_conducteur,date_visite_medicale,date_fco,date_adr,date_carte_identite",
    filters: [{ col: "id", op: "eq", val: chauffeurId }]
  });
  const chauffeur = rows && rows[0];
  if (!chauffeur) throw new Error("Chauffeur introuvable");

  const infos = CHAMPS_INFOS_CHAUFFEUR
    .filter((c) => chauffeur[c.champ])
    .map((c) => ({ label: c.label, valeur: chauffeur[c.champ], defaultChecked: false }));

  // Cartes perso : texte libre créé par le chauffeur (télépéage, badge site
  // client...) — potentiellement sans rapport ou même sensible pour un
  // client externe (accès à d'autres entreprises...). Toutes proposées dans
  // la popup de sélection, décochées par défaut — l'admin coche au cas par
  // cas à chaque export, plus besoin de pré-configurer sur la fiche.
  const cartesPerso = await dbSelect("cartes_perso", {
    select: "label,a_date,date_valeur",
    filters: [{ col: "chauffeur_id", op: "eq", val: chauffeurId }]
  }).catch(() => []);

  const dateItems = CHAMPS_DOCS_CHAUFFEUR
    .filter((c) => chauffeur[c.champ])
    .map((c) => ({ label: c.label, date: chauffeur[c.champ], statut: _statutTexte(chauffeur[c.champ]), defaultChecked: true }));

  (cartesPerso || [])
    .filter((c) => c.a_date && c.date_valeur)
    .forEach((c) => dateItems.push({ label: c.label, date: c.date_valeur, statut: _statutTexte(c.date_valeur), defaultChecked: false }));

  // Photos actuelles (documents_photos) — réutilise le cache du panneau
  // détail s'il est déjà chargé, sinon le charge à la volée.
  if (!docPhotosCache[chauffeurId]) await _reloadPhotosForChauffeur(chauffeurId);
  const photosCache = docPhotosCache[chauffeurId] || {};
  const photos = [];
  for (const slug of Object.keys(photosCache)) {
    const p = photosCache[slug];
    if (!p.url) continue;
    try {
      const { base64, width, height } = await _toBase64WithDims(p.url);
      photos.push({ label: p.label, base64, width, height });
    } catch (_) {
      // Une photo illisible ne doit pas bloquer tout le dossier.
    }
  }

  const nomComplet = `${chauffeur.prenom || ""} ${chauffeur.nom || ""}`.trim() || chauffeurId;
  return { entite: { identifiant: nomComplet, sousTitre: "Dossier chauffeur" }, dateItems, photos, infos };
}

// ─── Reload photos véhicule ───────────────────────────────────────────────
async function _reloadPhotosForVehicule(plaque, entityType) {
  try {
    const entrepriseId = adminSession.entreprise_id;
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/documents_photos?select=carte_slug,carte_label,storage_path&storage_path=like.${encodeURIComponent(entrepriseId + "/" + entityType + "/" + plaque + "/%")}`,
      { headers: authHeaders() }
    );
    const rows   = res.ok ? await res.json() : [];
    const result = {};
    await Promise.all((rows || []).map(async (row) => {
      const url = await _getSignedUrl(row.storage_path).catch(() => null);
      result[row.carte_slug] = { label: row.carte_label, storage_path: row.storage_path, url };
    }));
    vehiclePhotosCache[plaque] = result;
  } catch (_) {}
}

// ─── Export PDF "dossier de conformité" d'un véhicule ─────────────────────
// Récupère chaque photo via son URL signée, la convertit en base64 (jsPDF ne
// sait pas charger une image par URL cross-origin) et lit ses dimensions
// réelles pour que le PDF garde le bon ratio plutôt que d'écraser l'image.
function _toBase64WithDims(url) {
  return fetch(url)
    .then((r) => r.blob())
    .then((blob) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload  = () => resolve({ base64: reader.result, width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => reject(new Error("Image illisible"));
        img.src = reader.result;
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    }));
}

// Texte simple, sans emoji — la police standard de jsPDF (helvetica) ne
// sait pas rendre les emoji dans le PDF exporté (caractères transformés en
// symboles illisibles), donc cette fonction reste uniquement du texte.
function _statutTexte(iso) {
  if (!iso) return "Non renseigné";
  const st = alerteStatut(iso);
  return st ? st.label : "Valide";
}

const CHAMP_DATE_DOC = {
  ct: "date_ct", assurance: "date_assurance", limiteur: "date_limiteur_vitesse",
  chrono: "date_chronotachygraphe", frigo: "date_entretien_frigo",
  nettoyage: "date_nettoyage_interieur", graissage: "date_graissage"
};

// Rassemble les dates + photos d'UN véhicule (tracteur/porteur ou remorque),
// sans ouvrir de popup — pure collecte de données, réutilisée par l'export
// combiné (écran "Exports").
async function _collecterDonneesVehicule(plaque, type) {
  const table = type === "remorque" ? "remorques" : "tracteurs";
  const rows = await dbSelect(table, { select: "*", filters: [{ col: "plaque", op: "eq", val: plaque }] });
  const vehicule = rows && rows[0];
  if (!vehicule) throw new Error("Véhicule introuvable");

  const profil    = getProfilVehicule(vehicule.profil);
  const docsDispo = DOCS_DISPONIBLES[type === "remorque" ? "remorque" : "moteur"] || [];
  const docsProfil = profil?.docs || [];

  const dateItems = docsDispo
    .filter((d) => docsProfil.includes(d.id))
    .map((d) => {
      const iso = vehicule[CHAMP_DATE_DOC[d.id]];
      return { label: d.label, date: iso, statut: _statutTexte(iso), defaultChecked: true };
    });

  if (vehicule.a_hayon) {
    dateItems.push({ label: "Hayon", date: vehicule.date_hayon, statut: _statutTexte(vehicule.date_hayon), defaultChecked: true });
  }

  // Photos actuelles (documents_photos) — réutilise le cache du panneau
  // photos s'il est déjà chargé, sinon le charge à la volée.
  if (!vehiclePhotosCache[plaque]) await _reloadPhotosForVehicule(plaque, type);
  const photosCache = vehiclePhotosCache[plaque] || {};
  const photos = [];
  for (const slug of Object.keys(photosCache)) {
    const p = photosCache[slug];
    if (!p.url) continue;
    try {
      const { base64, width, height } = await _toBase64WithDims(p.url);
      photos.push({ label: p.label, base64, width, height });
    } catch (_) {
      // Une photo illisible ne doit pas bloquer tout le dossier.
    }
  }

  const sousTitre = `${profil?.label || vehicule.profil || "Profil inconnu"}${vehicule.marque || vehicule.modele ? " · " + [vehicule.marque, vehicule.modele].filter(Boolean).join(" ") : ""}`;
  return { entite: { identifiant: vehicule.plaque, sousTitre }, dateItems, photos };
}

// Point d'entrée unique de l'écran "Exports" — un, deux ou les trois
// sélecteurs (chauffeur / tracteur-porteur / remorque) peuvent être
// renseignés ; chaque entité choisie alimente une section groupée dans la
// popup de sélection, permettant par ex. "juste le chauffeur", "le camion
// complet (tracteur + remorque)" ou "porteur seul" (tracteur sans remorque).
async function lancerExportCombine(chauffeurId, plaqueT, plaqueR) {
  if (!chauffeurId && !plaqueT && !plaqueR) { showToast("⚠️ Choisis au moins un chauffeur ou un véhicule"); return; }
  try {
    showToast("📄 Préparation du dossier…");
    const dateItems = [];
    const photos    = [];
    const infos     = [];
    const noms      = [];

    if (chauffeurId) {
      const { entite, dateItems: di, photos: ph, infos: inf } = await _collecterDonneesChauffeur(chauffeurId);
      const groupe = `Chauffeur — ${entite.identifiant}`;
      di.forEach((d) => { d.groupe = groupe; });
      ph.forEach((p) => { p.groupe = groupe; });
      inf.forEach((x) => { x.groupe = groupe; });
      dateItems.push(...di); photos.push(...ph); infos.push(...inf); noms.push(entite.identifiant);
    }
    if (plaqueT) {
      const { entite, dateItems: di, photos: ph } = await _collecterDonneesVehicule(plaqueT, "tracteur");
      const groupe = `Tracteur / Porteur — ${entite.identifiant}`;
      di.forEach((d) => { d.groupe = groupe; });
      ph.forEach((p) => { p.groupe = groupe; });
      dateItems.push(...di); photos.push(...ph); noms.push(entite.identifiant);
    }
    if (plaqueR) {
      const { entite, dateItems: di, photos: ph } = await _collecterDonneesVehicule(plaqueR, "remorque");
      const groupe = `Remorque — ${entite.identifiant}`;
      di.forEach((d) => { d.groupe = groupe; });
      ph.forEach((p) => { p.groupe = groupe; });
      dateItems.push(...di); photos.push(...ph); noms.push(entite.identifiant);
    }

    _ouvrirSelectionDossierPDF(
      { identifiant: noms.join(" + "), sousTitre: noms.length > 1 ? "Dossier combiné" : "" },
      dateItems,
      photos,
      infos
    );
  } catch (e) {
    showToast("❌ Erreur : " + e.message);
  }
}

// ════════════════════════════════════════════════════════════════════════
// SECTION — EXPORTS (point d'entrée unique de tous les exports du panel)
// ════════════════════════════════════════════════════════════════════════

// Chaque carte précise noir sur blanc ce qu'elle exporte — pour que "tout au
// même endroit" ne veuille pas dire "on ne sait plus ce que chaque bouton fait".
const EXPORTS_LISTES = [
  {
    id: "parc", icone: "🚚", titre: "Parc véhicules",
    desc: "Tous les tracteurs/porteurs et remorques de la flotte — plaque, profil, marque/modèle, CT, assurance, limiteur, chrono."
  },
  {
    id: "chauffeurs", icone: "🧑‍✈️", titre: "Chauffeurs",
    desc: "Tous les chauffeurs de l'entreprise — carte conducteur, visite médicale, FCO, ADR."
  },
  {
    id: "consommations", icone: "⛽", titre: "Consommations",
    desc: "Historique complet du carburant — dates, kilomètres, litres, consommation aux 100km."
  },
  {
    id: "interventions", icone: "🔧", titre: "Interventions",
    desc: "Historique complet atelier — pannes, entretiens, accidents, crevaisons, tous véhicules confondus."
  },
  {
    id: "attelages", icone: "🔗", titre: "Attelages",
    desc: "Historique complet des associations tracteur/remorque — dates, kilomètres parcourus, chauffeur."
  },
  {
    id: "pneumatiques", icone: "🛞", titre: "Pneumatiques",
    desc: "Suivi des pneus de la flotte — kilomètres parcourus et dates de pose, tracteurs et remorques."
  }
];

async function renderExports() {
  const content = document.getElementById("admin-content");
  try {
    const [chauffeurs, tracteurs, remorques] = await Promise.all([
      dbSelect("chauffeurs", {
        select: "id,prenom,nom",
        filters: [{ col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }],
        order: { col: "nom", asc: true }
      }),
      dbSelect("tracteurs", {
        select: "plaque",
        filters: [{ col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }],
        order: { col: "plaque", asc: true }
      }),
      dbSelect("remorques", {
        select: "plaque",
        filters: [{ col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }],
        order: { col: "plaque", asc: true }
      })
    ]);

    content.innerHTML = `
      <div style="background:var(--color-surface);border:1px solid var(--color-divider);border-radius:16px;padding:18px 20px;margin-bottom:24px;">
        <div style="font-size:15px;font-weight:800;color:var(--color-text-primary);margin-bottom:4px;">📄 Dossier combiné — chauffeur et/ou véhicule</div>
        <div style="font-size:12.5px;color:var(--color-text-secondary);margin-bottom:14px;">
          Choisis un chauffeur, un véhicule, ou plusieurs à la fois (ex : le camion complet = tracteur + remorque). Un popup te laissera ensuite sélectionner précisément quels documents inclure.
        </div>
        <div class="admin-filters">
          <select id="export-combine-chauffeur" class="admin-select">
            <option value="">— Aucun chauffeur —</option>
            ${chauffeurs.map((c) => `<option value="${c.id}">${esc(c.prenom)} ${esc(c.nom)}</option>`).join("")}
          </select>
          <select id="export-combine-tracteur" class="admin-select">
            <option value="">— Aucun tracteur/porteur —</option>
            ${tracteurs.map((t) => `<option value="${esc(t.plaque)}">${esc(t.plaque)}</option>`).join("")}
          </select>
          <select id="export-combine-remorque" class="admin-select">
            <option value="">— Aucune remorque —</option>
            ${remorques.map((r) => `<option value="${esc(r.plaque)}">${esc(r.plaque)}</option>`).join("")}
          </select>
          <button class="btn-pdf" id="btn-export-combine">📄 Choisir les documents…</button>
        </div>
      </div>

      <div style="font-size:11px;font-weight:700;color:var(--color-text-secondary);letter-spacing:1px;margin-bottom:10px;">EXPORTS DE LISTES COMPLÈTES</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;">
        ${EXPORTS_LISTES.map((e) => `
          <div style="background:var(--color-surface);border:1px solid var(--color-divider);border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:10px;">
            <div style="display:flex;align-items:center;gap:10px;">
              <div style="font-size:22px;">${e.icone}</div>
              <div style="font-size:14px;font-weight:800;color:var(--color-text-primary);">${esc(e.titre)}</div>
            </div>
            <div style="font-size:12px;color:var(--color-text-secondary);flex:1;line-height:1.5;">${esc(e.desc)}</div>
            <button class="btn-pdf" data-export-liste="${e.id}" style="width:100%;">📄 Exporter</button>
          </div>
        `).join("")}
      </div>
    `;

    document.getElementById("btn-export-combine").addEventListener("click", () => {
      const chauffeurId = document.getElementById("export-combine-chauffeur").value;
      const plaqueT     = document.getElementById("export-combine-tracteur").value;
      const plaqueR     = document.getElementById("export-combine-remorque").value;
      lancerExportCombine(chauffeurId, plaqueT, plaqueR);
    });

    content.querySelectorAll("[data-export-liste]").forEach((btn) => {
      btn.addEventListener("click", () => _lancerExportListe(btn.dataset.exportListe, btn));
    });
  } catch (e) {
    content.innerHTML = `<div class="admin-empty"><div class="text">📡 Erreur de chargement</div></div>`;
  }
}

async function _lancerExportListe(id, btn) {
  btn.disabled = true;
  try {
    const eid = adminSession.entreprise_id;
    if (id === "parc") {
      const [tracteurs, remorques] = await Promise.all([
        dbSelect("tracteurs", {
          select: "plaque,profil,marque,modele,date_ct,date_assurance,date_limiteur_vitesse,date_chronotachygraphe",
          filters: [{ col: "entreprise_id", op: "eq", val: eid }], order: { col: "plaque", asc: true }
        }),
        dbSelect("remorques", {
          select: "plaque,profil,marque,modele,date_ct,date_assurance",
          filters: [{ col: "entreprise_id", op: "eq", val: eid }], order: { col: "plaque", asc: true }
        })
      ]);
      exportVehiculesPDF(tracteurs || [], remorques || []);
    } else if (id === "chauffeurs") {
      const rows = await dbSelect("chauffeurs", {
        select: "nom,prenom,email,date_carte_conducteur,date_visite_medicale,date_fco,date_adr",
        filters: [{ col: "entreprise_id", op: "eq", val: eid }], order: { col: "nom", asc: true }
      });
      exportChauffeursPDF(rows || []);
    } else if (id === "consommations") {
      const [rows, chRows] = await Promise.all([
        dbSelect("consommations", {
          select: "id,date,plaque_tracteur,plaque_remorque,kilometres,litres,valeur,chauffeur_id",
          filters: [{ col: "entreprise_id", op: "eq", val: eid }], order: { col: "date", asc: false }
        }),
        dbSelect("chauffeurs", { select: "id,prenom,nom", filters: [{ col: "entreprise_id", op: "eq", val: eid }] })
      ]);
      const chMap = {};
      (chRows || []).forEach((c) => { chMap[c.id] = `${c.prenom} ${c.nom}`; });
      exportConsommationsPDF(rows || [], chMap, "Consommations");
    } else if (id === "interventions") {
      const [rows, chRows, enginRows] = await Promise.all([
        dbSelect("interventions", { select: "*", filters: [{ col: "entreprise_id", op: "eq", val: eid }], order: { col: "date", asc: false } }),
        dbSelect("chauffeurs", { select: "id,prenom,nom", filters: [{ col: "entreprise_id", op: "eq", val: eid }] }),
        dbSelect("engins", { select: "id,numero_parc,numero_serie", filters: [{ col: "entreprise_id", op: "eq", val: eid }] }).catch(() => [])
      ]);
      const chMap = {};
      (chRows || []).forEach((c) => { chMap[c.id] = `${c.prenom} ${c.nom}`; });
      const enginsMap = {};
      (enginRows || []).forEach((e) => { enginsMap[e.id] = e.numero_parc || e.numero_serie || e.id.substring(0, 8); });
      exportInterventionsPDF(rows || [], chMap, "Historique interventions", enginsMap);
    } else if (id === "attelages") {
      const [rows, chRows] = await Promise.all([
        dbSelect("historique_attelages", { select: "*", filters: [{ col: "entreprise_id", op: "eq", val: eid }], order: { col: "date_debut", asc: false } }),
        dbSelect("chauffeurs", { select: "id,prenom,nom", filters: [{ col: "entreprise_id", op: "eq", val: eid }] })
      ]);
      const chMap = {};
      (chRows || []).forEach((c) => { chMap[c.id] = `${c.prenom} ${c.nom}`; });
      exportAttelagesPDF(rows || [], chMap);
    } else if (id === "pneumatiques") {
      const [tracteurs, remorques] = await Promise.all([
        dbSelect("tracteurs", {
          select: "plaque,marque,modele,km_pneus_avant,km_pneus_arriere,date_pose_avant,date_pose_arriere",
          filters: [{ col: "entreprise_id", op: "eq", val: eid }], order: { col: "plaque", asc: true }
        }),
        dbSelect("remorques", {
          select: "plaque,marque,modele,profil,km_pneus_e1,km_pneus_e2,km_pneus_e3,km_pneus_e4,km_pneus_e5,km_pneus_e6,date_pose_e1,date_pose_e2,date_pose_e3,date_pose_e4,date_pose_e5,date_pose_e6",
          filters: [{ col: "entreprise_id", op: "eq", val: eid }], order: { col: "plaque", asc: true }
        })
      ]);
      exportPneumatiquesPDF(tracteurs || [], remorques || []);
    }
  } catch (e) {
    showToast("📡 Export impossible — vérifie ta connexion");
  } finally {
    btn.disabled = false;
  }
}

// ════════════════════════════════════════════════════════════════════════
// SECTION — PARAMÈTRES (thème, contact, qui sommes-nous, nouveautés)
// Un seul écran, accessible depuis le bureau ET l'atelier (même contenu),
// appelé avec l'id du conteneur cible : renderParametres("admin-content")
// ou renderParametres("atelier-content").
// ════════════════════════════════════════════════════════════════════════

const THEME_STORAGE_KEY = "memotruck_admin_theme";

function themeActuel() {
  return localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark";
}

function appliquerTheme(theme) {
  if (theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
    localStorage.setItem(THEME_STORAGE_KEY, "light");
  } else {
    document.documentElement.removeAttribute("data-theme");
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
  }
}

// Nouveautés côté bureau/atelier — volontairement courtes et tournées
// métier (le changelog détaillé, plus technique, c'est celui de l'appli
// chauffeur). Ajoute une entrée en tête à chaque évolution notable du panel.
const NOUVEAUTES_ADMIN = [
  {
    date: "18/08/2026",
    titre: "Thème clair et écran Paramètres",
    texte: "Nouvel écran Paramètres, accessible depuis le bureau et l'atelier : choix du thème (sombre ou clair), contact, qui sommes-nous, et cette liste de nouveautés."
  },
  {
    date: "18/08/2026",
    titre: "Carte d'identité et coordonnées chauffeur",
    texte: "La fiche chauffeur affiche désormais l'adresse, le téléphone et la carte d'identité (recto/verso, avec date d'expiration) — synchronisés en direct avec l'appli chauffeur."
  },
  {
    date: "18/08/2026",
    titre: "Menu Exports centralisé",
    texte: "Tous les exports PDF (dossier chauffeur/véhicule combinable, et les 6 exports de listes complètes) sont regroupés dans un seul écran « Exports », avec sélection précise des documents à chaque export."
  }
];

async function renderParametres(containerId) {
  const content = document.getElementById(containerId);
  content.innerHTML = `<div class="admin-loading">Chargement…</div>`;

  const abonnementHTML = await _renderAbonnementCard();

  const tabs = [
    { id: "theme",      label: "Thème" },
    { id: "contact",    label: "Contact" },
    { id: "apropos",    label: "Qui sommes-nous" },
    { id: "nouveautes", label: "Nouveautés" }
  ];
  let ongletActif = "theme";

  function render() {
    content.innerHTML = `
      ${abonnementHTML}
      <div class="param-tabs">
        ${tabs.map((t) => `<button class="param-tab ${t.id === ongletActif ? "active" : ""}" data-param-tab="${t.id}">${esc(t.label)}</button>`).join("")}
      </div>
      <div class="param-panel">
        ${ongletActif === "theme" ? _renderOngletTheme()
          : ongletActif === "contact" ? _renderOngletContact()
          : ongletActif === "apropos" ? _renderOngletApropos()
          : _renderOngletNouveautes()}
      </div>
    `;

    content.querySelectorAll("[data-param-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        ongletActif = btn.dataset.paramTab;
        render();
      });
    });

    if (ongletActif === "theme") {
      content.querySelectorAll("[data-theme-choice]").forEach((card) => {
        card.addEventListener("click", () => {
          appliquerTheme(card.dataset.themeChoice);
          render();
        });
      });
    }
  }

  render();
}

// Bandeau "Mon abonnement" — toujours visible en haut de Paramètres, pas
// seulement quand la limite est atteinte (voir _showLimiteAtteinte) : le
// but est que l'admin voie venir la limite avant de s'y cogner. Masqué pour
// le rôle mécanicien (pas concerné par la gestion de l'abonnement).
async function _renderAbonnementCard() {
  if (adminSession.role === "mecanicien") return "";
  try {
    const [entrepriseRows, tracteurs, engins] = await Promise.all([
      dbSelect("entreprises", { select: "pack", filters: [{ col: "id", op: "eq", val: adminSession.entreprise_id }] }),
      dbSelect("tracteurs",   { select: "plaque", filters: [{ col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }] }),
      dbSelect("engins",      { select: "id",     filters: [{ col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }] })
    ]);
    const pack        = entrepriseRows?.[0]?.pack || "starter";
    const limite       = PACKS_LIMITES[pack] ?? 5;
    const nbVehicules  = (tracteurs?.length || 0) + (engins?.length || 0);
    const illimite     = limite === Infinity;
    const pourcentage  = illimite ? 0 : Math.min(100, Math.round((nbVehicules / limite) * 100));
    const proche       = !illimite && nbVehicules >= limite * 0.8;

    return `
      <div class="abonnement-card ${proche ? "abonnement-card--proche" : ""}">
        <div class="abonnement-top">
          <div>
            <div class="abonnement-pack">Pack ${esc(PACK_LABELS[pack] || pack)}</div>
            <div class="abonnement-sub">${illimite ? "Véhicules moteurs illimités" : `${nbVehicules} / ${limite} véhicules moteurs utilisés`}</div>
          </div>
          <a class="abonnement-changer" href="${esc(MEMOTRUCK_CONTACT.whatsapp)}" target="_blank" rel="noopener">Changer de forfait</a>
        </div>
        ${illimite ? "" : `
          <div class="abonnement-bar-track">
            <div class="abonnement-bar-fill" style="width:${pourcentage}%;"></div>
          </div>
        `}
      </div>
    `;
  } catch (e) {
    return "";
  }
}

function _renderOngletTheme() {
  const actuel = themeActuel();
  return `
    <div class="param-section-title">Apparence</div>
    <div class="param-section-desc">Le changement s'applique immédiatement, sur cet appareil.</div>
    <div class="theme-choices">
      <div class="theme-choice-card ${actuel === "dark" ? "active" : ""}" data-theme-choice="dark">
        <div class="theme-swatch theme-swatch--dark"><span></span><span></span><span></span></div>
        <div class="theme-choice-name">Sombre</div>
        <div class="theme-choice-sub">Thème actuel</div>
      </div>
      <div class="theme-choice-card ${actuel === "light" ? "active" : ""}" data-theme-choice="light">
        <div class="theme-swatch theme-swatch--light"><span></span><span></span><span></span></div>
        <div class="theme-choice-name">Clair</div>
        <div class="theme-choice-sub">Blanc / bleu cyan</div>
      </div>
    </div>
  `;
}

function _renderOngletContact() {
  return `
    <div class="param-section-title">Contact</div>
    <div class="param-section-desc">Une question, un bug, une demande de forfait — on répond vite.</div>
    <div class="contact-cards">
      <a class="contact-card contact-card--whatsapp" href="${esc(MEMOTRUCK_CONTACT.whatsapp)}" target="_blank" rel="noopener">
        <span class="contact-card-icon">💬</span>
        <div>
          <div class="contact-card-title">WhatsApp</div>
          <div class="contact-card-sub">Réponse la plus rapide</div>
        </div>
      </a>
      <a class="contact-card" href="mailto:${esc(MEMOTRUCK_CONTACT.email)}">
        <span class="contact-card-icon">✉️</span>
        <div>
          <div class="contact-card-title">Email</div>
          <div class="contact-card-sub">${esc(MEMOTRUCK_CONTACT.email)}</div>
        </div>
      </a>
    </div>
  `;
}

function _renderOngletApropos() {
  return `
    <div class="param-section-title">Qui sommes-nous</div>
    <div class="apropos-card">
      <div class="apropos-logo">🚛</div>
      <div class="apropos-name">MémoDev Service</div>
      <p class="apropos-text">MémoTruck est développé et maintenu par <strong>MémoDev Service</strong>, au contact direct des transporteurs qui l'utilisent au quotidien — chaque fonctionnalité part d'un besoin de terrain, pas d'un cahier des charges figé.</p>
      <p class="apropos-text">Pas de service client anonyme : une question, une idée d'amélioration, un souci technique — ça part directement à la personne qui développe l'appli, via l'onglet Contact.</p>
    </div>
  `;
}

function _renderOngletNouveautes() {
  return `
    <div class="param-section-title">Nouveautés</div>
    <div class="param-section-desc">Les derniers ajouts au panel bureau et atelier.</div>
    <div class="nouveaute-list">
      ${NOUVEAUTES_ADMIN.map((n) => `
        <div class="nouveaute-item">
          <div class="nouveaute-date">${esc(n.date)}</div>
          <div class="nouveaute-titre">${esc(n.titre)}</div>
          <div class="nouveaute-texte">${esc(n.texte)}</div>
        </div>
      `).join("")}
    </div>
  `;
}

// ─── Render section photos dans panneau chauffeur ─────────────────────────
function _renderChauffeurPhotosHTML(chauffeurId) {
  const photos = docPhotosCache[chauffeurId] || {};
  const slugs  = Object.keys(photos);
  if (slugs.length === 0) {
    return `<div style="font-size:12px;color:var(--color-text-secondary);">Aucune photo uploadée</div>`;
  }
  return slugs.map(slug => {
    const p = photos[slug];
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:0.5px solid var(--color-divider);">
        <div style="width:48px;height:36px;border-radius:6px;overflow:hidden;flex-shrink:0;background:var(--color-surface-card);cursor:pointer;"
          data-admin-photo-view="${slug}">
          ${p.url ? `<img src="${p.url}" style="width:100%;height:100%;object-fit:cover;" />` : `<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:16px;">📷</div>`}
        </div>
        <div style="flex:1;min-width:0;font-size:12px;font-weight:600;color:var(--color-text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(p.label)}</div>
        <button class="admin-photo-delete" data-slug="${slug}" data-owner="${chauffeurId}" data-owner-type="chauffeur"
          style="background:none;border:none;cursor:pointer;font-size:14px;color:var(--color-danger);padding:4px;">🗑️</button>
      </div>`;
  }).join("");
}

function _refreshDetailPhotoSection(chauffeurId) {
  const section = document.getElementById("admin-detail-photos");
  if (!section) return;
  section.innerHTML = _renderChauffeurPhotosHTML(chauffeurId);
  _attachChauffeurPhotoListeners(chauffeurId);
}

function _attachChauffeurPhotoListeners(chauffeurId) {
  const panel = document.getElementById("detail-panel");
  if (!panel) return;
  panel.querySelectorAll("[data-admin-photo-view]").forEach(el => {
    el.addEventListener("click", () => {
      const p = (docPhotosCache[chauffeurId] || {})[el.dataset.adminPhotoView];
      if (p?.url) _ouvrirVisionneureAdmin(p.label, p.url);
    });
  });
  panel.querySelectorAll(".admin-photo-delete").forEach(btn => {
    btn.addEventListener("click", async () => {
      const slug = btn.dataset.slug;
      try {
        btn.disabled = true; btn.textContent = "…";
        const p = (docPhotosCache[chauffeurId] || {})[slug];
        if (!p) return;
        const resStorage = await fetch(`${SUPABASE_URL}/storage/v1/object/documents-chauffeurs/${p.storage_path}`, { method: "DELETE", headers: authHeadersNoBody() });
        if (!resStorage.ok) throw new Error(`Suppression fichier échouée (${resStorage.status})`);
        const resRow = await fetch(`${SUPABASE_URL}/rest/v1/documents_photos?storage_path=eq.${encodeURIComponent(p.storage_path)}`, { method: "DELETE", headers: authHeaders() });
        if (!resRow.ok) throw new Error(`Suppression fiche échouée (${resRow.status})`);
        await _reloadPhotosForChauffeur(chauffeurId);
        _refreshDetailPhotoSection(chauffeurId);
        showToast("🗑️ Photo supprimée");
      } catch (e) { showToast("❌ " + e.message); btn.disabled = false; btn.textContent = "🗑️"; }
    });
  });
}

// ─── Panneau photos véhicule ──────────────────────────────────────────────
async function ouvrirVehiclePhotoPanel(plaque, entityType) {
  const panel = document.getElementById("vehicle-photo-panel");
  if (!panel) return;
  if (panel.dataset.plaque === plaque && panel.style.display !== "none") {
    panel.style.display = "none"; panel.dataset.plaque = ""; return;
  }
  panel.dataset.plaque = plaque;
  panel.dataset.vtype  = entityType;
  panel.style.display  = "block";
  panel.innerHTML      = `<div class="admin-loading">Chargement…</div>`;
  await _reloadPhotosForVehicule(plaque, entityType);
  _refreshVehiclePhotoPanel(plaque, entityType);
}

function _refreshVehiclePhotoPanel(plaque, entityType) {
  const panel = document.getElementById("vehicle-photo-panel");
  if (!panel) return;
  const photos = vehiclePhotosCache[plaque] || {};
  const slugs  = Object.keys(photos);
  const emoji  = entityType === "tracteur" ? "🚚" : "🚛";

  panel.innerHTML = `
    <div style="background:var(--color-surface);border:1px solid var(--color-accent);border-radius:16px;overflow:hidden;">
      <div style="padding:14px 16px;border-bottom:1px solid var(--color-divider);display:flex;align-items:center;justify-content:space-between;">
        <div style="font-size:14px;font-weight:800;color:var(--color-text-primary);">${emoji} ${esc(plaque)}</div>
        <button id="btn-close-vehicle-panel" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--color-text-secondary);">✕</button>
      </div>
      <div style="padding:12px 16px;" id="vehicle-photo-panel-content">
        <div style="font-size:10px;font-weight:700;color:var(--color-text-secondary);letter-spacing:1px;margin-bottom:8px;">PHOTOS (${slugs.length})</div>
        ${slugs.length === 0
          ? `<div style="font-size:12px;color:var(--color-text-secondary);">Aucune photo</div>`
          : slugs.map(slug => {
              const p = photos[slug];
              return `
                <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:0.5px solid var(--color-divider);">
                  <div style="width:56px;height:42px;border-radius:6px;overflow:hidden;flex-shrink:0;background:var(--color-surface-card);cursor:pointer;"
                    data-vehicle-photo-view="${slug}">
                    ${p.url ? `<img src="${p.url}" style="width:100%;height:100%;object-fit:cover;" />` : `<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:18px;">📷</div>`}
                  </div>
                  <div style="flex:1;min-width:0;font-size:12px;font-weight:600;color:var(--color-text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(p.label)}</div>
                  <button class="admin-vehicle-photo-delete" data-slug="${slug}"
                    style="background:none;border:none;cursor:pointer;font-size:14px;color:var(--color-danger);padding:4px;">🗑️</button>
                </div>`;
            }).join("")}
      </div>
    </div>
  `;

  document.getElementById("btn-close-vehicle-panel").addEventListener("click", () => {
    panel.style.display = "none"; panel.dataset.plaque = "";
  });

  panel.querySelectorAll("[data-vehicle-photo-view]").forEach(el => {
    el.addEventListener("click", () => {
      const p = photos[el.dataset.vehiclePhotoView];
      if (p?.url) _ouvrirVisionneureAdmin(p.label, p.url);
    });
  });

  panel.querySelectorAll(".admin-vehicle-photo-delete").forEach(btn => {
    btn.addEventListener("click", async () => {
      const slug = btn.dataset.slug;
      try {
        btn.disabled = true; btn.textContent = "…";
        const p = photos[slug];
        if (!p) return;
        const resStorage = await fetch(`${SUPABASE_URL}/storage/v1/object/documents-chauffeurs/${p.storage_path}`, { method: "DELETE", headers: authHeadersNoBody() });
        if (!resStorage.ok) throw new Error(`Suppression fichier échouée (${resStorage.status})`);
        const resRow = await fetch(`${SUPABASE_URL}/rest/v1/documents_photos?storage_path=eq.${encodeURIComponent(p.storage_path)}`, { method: "DELETE", headers: authHeaders() });
        if (!resRow.ok) throw new Error(`Suppression fiche échouée (${resRow.status})`);
        await _reloadPhotosForVehicule(plaque, entityType);
        _refreshVehiclePhotoPanel(plaque, entityType);
        showToast("🗑️ Photo supprimée");
      } catch (e) { showToast("❌ " + e.message); btn.disabled = false; btn.textContent = "🗑️"; }
    });
  });
}

// ─── Visionneuse plein écran admin ────────────────────────────────────────
function _ouvrirVisionneureAdmin(label, url) {
  let overlay = document.getElementById("admin-photo-viewer-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "admin-photo-viewer-overlay";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:9999;display:none;flex-direction:column;align-items:center;justify-content:center;gap:16px;";
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.style.display = "none"; });
  }
  overlay.innerHTML = `
    <div style="color:white;font-size:14px;font-weight:700;padding:0 20px;text-align:center;">${esc(label)}</div>
    <img src="${url}" style="max-width:90vw;max-height:70vh;object-fit:contain;border-radius:12px;" />
    <button onclick="this.closest('#admin-photo-viewer-overlay').style.display='none'"
      style="background:rgba(255,255,255,0.15);border:none;color:white;padding:10px 28px;border-radius:24px;font-size:14px;cursor:pointer;">✕ Fermer</button>
  `;
  overlay.style.display = "flex";
}

// ════════════════════════════════════════════════════════════════════════
// SECTION — PNEUMATIQUES
// ════════════════════════════════════════════════════════════════════════

async function renderHistoriqueAttelages() {
  const content = document.getElementById("admin-content");
  try {
    const [chauffeurs, tracteurs] = await Promise.all([
      dbSelect("chauffeurs", {
        select: "id,prenom,nom",
        filters: [{ col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }],
        order: { col: "nom", asc: true }
      }),
      dbSelect("tracteurs", {
        select: "plaque",
        filters: [{ col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }],
        order: { col: "plaque", asc: true }
      })
    ]);

    content.innerHTML = `
      <div class="admin-filters">
        <select id="filter-att-chauffeur" class="admin-select">
          <option value="">Tous les chauffeurs</option>
          ${chauffeurs.map(c => `<option value="${c.id}">${c.prenom} ${c.nom}</option>`).join("")}
        </select>
        <select id="filter-att-tracteur" class="admin-select">
          <option value="">Tous les tracteurs</option>
          ${tracteurs.map(t => `<option value="${t.plaque}">${t.plaque}</option>`).join("")}
        </select>
        <input type="month" id="filter-att-mois" class="admin-filter-input" />
        <button class="btn-ajouter" id="btn-filtrer-att">🔍 Filtrer</button>
      </div>
      <div id="att-table-wrap"><div class="admin-loading">Sélectionne des filtres et appuie sur Filtrer</div></div>
    `;

    const now = new Date();
    document.getElementById("filter-att-mois").value =
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const load = () => loadHistoriqueTable(
      document.getElementById("filter-att-chauffeur").value,
      document.getElementById("filter-att-tracteur").value,
      document.getElementById("filter-att-mois").value
    );

    document.getElementById("btn-filtrer-att").addEventListener("click", load);

    load();
  } catch (e) {
    content.innerHTML = `<div class="admin-empty"><div class="text">📡 Erreur de chargement</div></div>`;
  }
}

async function loadHistoriqueTable(chauffeurId, plaqueT, mois) {
  const wrap = document.getElementById("att-table-wrap");
  wrap.innerHTML = `<div class="admin-loading">Chargement…</div>`;

  try {
    const filters = [{ col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }];
    if (chauffeurId) filters.push({ col: "chauffeur_id",    op: "eq",  val: chauffeurId });
    if (plaqueT)     filters.push({ col: "plaque_tracteur", op: "eq",  val: plaqueT });
    if (mois) {
      const [annee, moisNum] = mois.split("-");
      filters.push({ col: "date_debut", op: "gte", val: `${annee}-${moisNum}-01` });
      const finMois = new Date(parseInt(annee), parseInt(moisNum), 0).getDate();
      filters.push({ col: "date_debut", op: "lte", val: `${annee}-${moisNum}-${String(finMois).padStart(2,"0")}` });
    }

    const rows = await dbSelect("historique_attelages", {
      select: "id,chauffeur_id,plaque_tracteur,plaque_remorque,profil_moteur,profil_remorque,date_debut,date_fin,km_parcourus",
      filters,
      order: { col: "date_debut", asc: false }
    });

    // Map chauffeurs
    const chRows = await dbSelect("chauffeurs", {
      select: "id,prenom,nom",
      filters: [{ col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }]
    });
    const chMap = {};
    (chRows || []).forEach(c => { chMap[c.id] = `${c.prenom} ${c.nom}`; });

    if (!rows || rows.length === 0) {
      wrap.innerHTML = `<div class="admin-empty"><div class="icon">🔗</div><div class="text">Aucun attelage pour ces filtres</div></div>`;
      return;
    }

    const totalKm = rows.reduce((s, r) => s + Number(r.km_parcourus || 0), 0);

    wrap.innerHTML = `
      <div class="admin-stats-row" style="margin-bottom:20px;">
        <div class="admin-stat-card" style="--stat-color:var(--color-accent);">
          <div class="admin-stat-value">${rows.length}</div>
          <div class="admin-stat-label">Attelages</div>
        </div>
        <div class="admin-stat-card" style="--stat-color:var(--color-success);">
          <div class="admin-stat-value">${Math.round(totalKm).toLocaleString("fr-FR")}</div>
          <div class="admin-stat-label">Km totaux</div>
        </div>
      </div>
      <div class="admin-table-wrap">
        <table>
          <thead>
            <tr>
              <th>DATE</th>
              <th>CHAUFFEUR</th>
              <th>TRACTEUR</th>
              <th>REMORQUE</th>
              <th>PROFIL</th>
              <th>KM</th>
              <th>FIN</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td>${formatDate(r.date_debut)}</td>
                <td style="font-weight:600;">${esc(chMap[r.chauffeur_id] || "—")}</td>
                <td><strong>${esc(r.plaque_tracteur || "—")}</strong></td>
                <td style="color:var(--color-text-secondary);">${esc(r.plaque_remorque || "Solo")}</td>
                <td style="font-size:12px;color:var(--color-accent);">${esc(r.profil_moteur || "—")}</td>
                <td style="font-weight:700;">${r.km_parcourus > 0 ? Math.round(r.km_parcourus).toLocaleString("fr-FR") + " km" : "—"}</td>
                <td style="color:var(--color-text-secondary);font-size:12px;">${r.date_fin ? formatDate(r.date_fin) : "<span style='color:var(--color-success);'>En cours</span>"}</td>
                <td><button class="btn-danger-small" data-delete-att="${r.id}" title="Supprimer">🗑️</button></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
    // Listeners suppression
    wrap.querySelectorAll("[data-delete-att]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.deleteAtt;
        showModal({
          title: "Supprimer cet attelage ?",
          bodyHTML: `<p style="color:var(--color-text-secondary);font-size:14px;">Cette action est définitive.</p>`,
          confirmLabel: "Supprimer", danger: true,
          onConfirm: async () => {
            try {
              await dbDelete("historique_attelages", [{ col: "id", op: "eq", val: id }]);
              showToast("🗑️ Attelage supprimé");
              loadHistoriqueTable(chauffeurId, plaqueT, mois);
            } catch (e) {
              showToast("❌ Erreur suppression");
            }
          }
        });
      });
    });
  } catch (e) {
    wrap.innerHTML = `<div class="admin-empty"><div class="text">📡 Erreur de chargement</div></div>`;
  }
}

// ════════════════════════════════════════════════════════════════════════
// SECTION — HISTORIQUE ENTRETIENS (frigo / nettoyage / graissage)
// Vue centralisée de historique_entretiens, triée par véhicule puis date —
// pensée pour ressortir vite la preuve (date + photo) demandée par un client
// qui conteste un entretien, sans passer par Parc > Modifier > 🕐 à chaque fois.
// ════════════════════════════════════════════════════════════════════════

async function renderHistoriqueEntretiens(containerId = "admin-content") {
  const content = document.getElementById(containerId);
  try {
    const [tracteurs, remorques] = await Promise.all([
      dbSelect("tracteurs", {
        select: "plaque,profil",
        filters: [{ col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }],
        order: { col: "plaque", asc: true }
      }),
      dbSelect("remorques", {
        select: "plaque,profil",
        filters: [{ col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }],
        order: { col: "plaque", asc: true }
      })
    ]);
    const vehicules = [
      ...(tracteurs || []).map((t) => ({ plaque: t.plaque, type: "tracteur", profil: t.profil })),
      ...(remorques || []).map((r) => ({ plaque: r.plaque, type: "remorque", profil: r.profil }))
    ];
    // Profil réel par véhicule (ex. "tracteur_4x2", "porteur_19t"…) — un
    // tracteur n'est pas forcément un porteur, il ne faut pas déduire le
    // libellé du seul entite_type "tracteur" (colonne technique qui couvre
    // en fait tracteurs ET porteurs).
    const profilMap = {};
    vehicules.forEach((v) => { profilMap[`${v.type}|${v.plaque}`] = v.profil; });

    content.innerHTML = `
      <div class="admin-filters">
        <select id="filter-he-type" class="admin-select">
          <option value="">Tous les types</option>
          <option value="frigo">🧊 Entretien Groupe Frigo</option>
          <option value="nettoyage">🧽 Nettoyage Intérieur</option>
        </select>
        <select id="filter-he-plaque" class="admin-select">
          <option value="">Tous les véhicules</option>
          ${vehicules.map((v) => `<option value="${esc(v.plaque)}|${v.type}">${v.type === "tracteur" ? "🚚" : "🚛"} ${esc(v.plaque)}${v.profil ? ` — ${esc(formatProfil(v.profil))}` : ""}</option>`).join("")}
        </select>
        <input type="month" id="filter-he-mois" class="admin-filter-input" />
        <button class="btn-ajouter" id="btn-filtrer-he">🔍 Filtrer</button>
      </div>
      <div id="he-table-wrap"><div class="admin-loading">Chargement…</div></div>
    `;

    const load = () => loadHistoriqueEntretiensTable(
      document.getElementById("filter-he-type").value,
      document.getElementById("filter-he-plaque").value,
      document.getElementById("filter-he-mois").value,
      profilMap
    );
    document.getElementById("btn-filtrer-he").addEventListener("click", load);
    load();
  } catch (e) {
    content.innerHTML = `<div class="admin-empty"><div class="text">📡 Erreur de chargement</div></div>`;
  }
}

const HISTORIQUE_ENTRETIENS_LABELS = {
  frigo:     "🧊 Entretien Groupe Frigo",
  nettoyage: "🧽 Nettoyage Intérieur"
};

async function loadHistoriqueEntretiensTable(typeEntretien, plaqueFilter, mois, profilMap = {}) {
  const wrap = document.getElementById("he-table-wrap");
  wrap.innerHTML = `<div class="admin-loading">Chargement…</div>`;

  try {
    const filters = [{ col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }];
    if (typeEntretien) filters.push({ col: "type_entretien", op: "eq", val: typeEntretien });
    if (plaqueFilter) {
      const [plaque, type] = plaqueFilter.split("|");
      filters.push({ col: "entite_plaque", op: "eq", val: plaque });
      filters.push({ col: "entite_type", op: "eq", val: type });
    }
    if (mois) {
      const [annee, moisNum] = mois.split("-");
      filters.push({ col: "date_entretien", op: "gte", val: `${annee}-${moisNum}-01` });
      const finMois = new Date(parseInt(annee), parseInt(moisNum), 0).getDate();
      filters.push({ col: "date_entretien", op: "lte", val: `${annee}-${moisNum}-${String(finMois).padStart(2, "0")}` });
    }

    let rows = await dbSelect("historique_entretiens", { select: "*", filters, order: { col: "entite_plaque", asc: true } });
    // Le graissage est suivi côté panel atelier (interventions mécano), pas
    // ici — cette vue reste dédiée au frigo/nettoyage même si le filtre
    // "Tous les types" n'exclut rien explicitement.
    rows = (rows || []).filter((r) => r.type_entretien !== "graissage");

    if (rows.length === 0) {
      wrap.innerHTML = `<div class="admin-empty"><div class="icon">🕐</div><div class="text">Aucun historique pour ces filtres</div></div>`;
      return;
    }

    // dbSelect ne trie que sur une colonne — tri secondaire par date
    // décroissante à l'intérieur de chaque plaque, fait côté client.
    rows.sort((a, b) => {
      const p = (a.entite_plaque || "").localeCompare(b.entite_plaque || "");
      if (p !== 0) return p;
      return (b.date_entretien || "").localeCompare(a.date_entretien || "");
    });

    const avecPhoto = rows.filter((r) => r.storage_path);
    const urlMap = {};
    await Promise.all(avecPhoto.map(async (r) => { urlMap[r.id] = await _getSignedUrl(r.storage_path).catch(() => null); }));

    wrap.innerHTML = `
      <div class="admin-stats-row" style="margin-bottom:20px;">
        <div class="admin-stat-card" style="--stat-color:var(--color-accent);">
          <div class="admin-stat-value">${rows.length}</div>
          <div class="admin-stat-label">Entrées</div>
        </div>
      </div>
      <div class="admin-table-wrap">
        <table>
          <thead>
            <tr>
              <th>VÉHICULE</th>
              <th>TYPE</th>
              <th>DATE</th>
              <th>DOCUMENT</th>
              <th>COMMENTAIRE</th>
              <th>ENREGISTRÉ PAR</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r) => `
              <tr>
                <td><strong>${esc(r.entite_plaque)}</strong> <span style="color:var(--color-text-secondary);font-size:11px;">${(() => {
                  const icone = r.entite_type === "tracteur" ? "🚚" : "🚛";
                  const profil = profilMap[`${r.entite_type}|${r.entite_plaque}`];
                  const libelle = profil ? formatProfil(profil) : (r.entite_type === "tracteur" ? "Tracteur / Porteur" : "Remorque");
                  return `${icone} ${esc(libelle)}`;
                })()}</span></td>
                <td style="font-size:12px;">${HISTORIQUE_ENTRETIENS_LABELS[r.type_entretien] || esc(r.type_entretien)}</td>
                <td>${formatDate(r.date_entretien)}</td>
                <td>${urlMap[r.id]
                  ? `<div style="width:44px;height:34px;border-radius:6px;overflow:hidden;cursor:pointer;background:var(--color-surface-card);" data-he-photo="${esc(urlMap[r.id])}" data-he-label="${esc(r.entite_plaque)} — ${esc(HISTORIQUE_ENTRETIENS_LABELS[r.type_entretien] || r.type_entretien)}"><img src="${esc(urlMap[r.id])}" style="width:100%;height:100%;object-fit:cover;" /></div>`
                  : `<span style="color:var(--color-text-secondary);font-size:11px;">Pas de photo</span>`}</td>
                <td style="font-size:12px;color:var(--color-text-secondary);max-width:200px;">${esc(r.commentaire || "—")}</td>
                <td style="font-size:12px;color:var(--color-text-secondary);">${esc(r.chauffeur_nom || r.admin_nom || "—")}</td>
                <td><button class="btn-danger-small" data-delete-he="${r.id}" title="Supprimer">🗑️</button></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;

    wrap.querySelectorAll("[data-he-photo]").forEach((el) => {
      el.addEventListener("click", () => _ouvrirVisionneureAdmin(el.dataset.heLabel, el.dataset.hePhoto));
    });

    wrap.querySelectorAll("[data-delete-he]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id  = btn.dataset.deleteHe;
        const row = rows.find((r) => String(r.id) === id);
        if (!row) return;
        showModal({
          title: "Supprimer cette entrée d'historique ?",
          bodyHTML: `<p style="color:var(--color-text-secondary);font-size:14px;">La photo associée sera aussi supprimée. Cette action est définitive.</p>`,
          confirmLabel: "Supprimer", danger: true,
          onConfirm: async () => {
            try {
              await _supprimerHistoriqueEntretien(row);
              showToast("🗑️ Entrée supprimée");
              loadHistoriqueEntretiensTable(typeEntretien, plaqueFilter, mois, profilMap);
            } catch (e) {
              showToast("❌ " + e.message);
            }
          }
        });
      });
    });
  } catch (e) {
    wrap.innerHTML = `<div class="admin-empty"><div class="text">📡 Erreur de chargement</div></div>`;
  }
}

// ─── Entretiens véhicules (interventions type="Entretien") ────────────────
// Historique de maintenance courante (vidange, filtres, embrayage…) — pas
// des pannes, donc jamais de statut atelier ni de prise en charge. Visible
// et modifiable des deux côtés : le chauffeur les crée depuis la PWA (onglet
// Entretien), et l'atelier peut aussi en créer directement ici par plaque —
// utile pour un véhicule sans chauffeur titré.
async function renderEntretiensVehicules(containerId = "atelier-content") {
  const content = document.getElementById(containerId);
  try {
    const eid = adminSession.entreprise_id;
    const [tracteurs, remorques, engins] = await Promise.all([
      dbSelect("tracteurs", { select: "plaque,profil", filters: [{ col: "entreprise_id", op: "eq", val: eid }], order: { col: "plaque", asc: true } }).catch(() => []),
      dbSelect("remorques", { select: "plaque,profil", filters: [{ col: "entreprise_id", op: "eq", val: eid }], order: { col: "plaque", asc: true } }).catch(() => []),
      dbSelect("engins", { select: "id,numero_parc,numero_serie", filters: [{ col: "entreprise_id", op: "eq", val: eid }] }).catch(() => [])
    ]);
    const enginsMap = {}; (engins || []).forEach((e) => { enginsMap[e.id] = e.numero_parc || e.numero_serie || e.id.substring(0, 8); });
    // Profil réel par véhicule (ex. "tracteur_4x2", "porteur_19t"…) — un
    // tracteur n'est pas forcément un porteur, il ne faut pas déduire le
    // libellé du seul entite_type "tracteur" (colonne technique qui couvre
    // en fait tracteurs ET porteurs).
    const profilMap = {};
    (tracteurs || []).forEach((t) => { profilMap[`tracteur|${t.plaque}`] = t.profil; });
    (remorques || []).forEach((r) => { profilMap[`remorque|${r.plaque}`] = r.profil; });
    const vehicules = [
      ...(tracteurs || []).map((t) => ({ value: t.plaque, type: "tracteur", label: `🚚 ${t.plaque}${t.profil ? ` — ${formatProfil(t.profil)}` : ""}` })),
      ...(remorques || []).map((r) => ({ value: r.plaque, type: "remorque", label: `🚛 ${r.plaque}${r.profil ? ` — ${formatProfil(r.profil)}` : ""}` })),
      ...(engins || []).map((e) => ({ value: e.id, type: "engin", label: `🏗️ ${enginsMap[e.id]}` }))
    ];

    if (vehicules.length === 0) {
      content.innerHTML = `<div class="admin-empty"><div class="icon">🚛</div><div class="text">Aucun véhicule enregistré pour l'instant</div></div>`;
      return;
    }

    content.innerHTML = `
      <div class="admin-filters">
        <select id="filter-ev-plaque" class="admin-select">
          <option value="">Tous les véhicules</option>
          ${vehicules.map((v) => `<option value="${esc(v.value)}|${v.type}">${v.label}</option>`).join("")}
        </select>
        <button class="btn-ajouter" id="btn-ajouter-entretien-vehicule">➕ Ajouter un entretien</button>
      </div>
      <div id="ev-table-wrap"><div class="admin-loading">Chargement…</div></div>
    `;

    const load = () => loadEntretiensVehiculesTable(document.getElementById("filter-ev-plaque").value, enginsMap, profilMap);
    document.getElementById("filter-ev-plaque").addEventListener("change", load);
    document.getElementById("btn-ajouter-entretien-vehicule").addEventListener("click", () => _ouvrirCreationEntretienVehicule(vehicules, load));
    load();
  } catch (e) {
    content.innerHTML = `<div class="admin-empty"><div class="text">📡 Erreur de chargement</div></div>`;
  }
}

async function loadEntretiensVehiculesTable(plaqueFilter, enginsMap, profilMap) {
  const wrap = document.getElementById("ev-table-wrap");
  wrap.innerHTML = `<div class="admin-loading">Chargement…</div>`;

  try {
    const eid = adminSession.entreprise_id;
    const filters = [{ col: "entreprise_id", op: "eq", val: eid }, { col: "type", op: "eq", val: "Entretien" }];
    if (plaqueFilter) {
      const [val, type] = plaqueFilter.split("|");
      filters.push({ col: "entite_plaque", op: "eq", val });
      filters.push({ col: "entite_type", op: "eq", val: type });
    }

    const rows = await dbSelect("interventions", {
      select: "id,entite_type,entite_plaque,date,details,chauffeur_id,mecanicien_id",
      filters, order: { col: "date", asc: false }, limit: 150
    });

    if (!rows || rows.length === 0) {
      wrap.innerHTML = `<div class="admin-empty"><div class="icon">🔧</div><div class="text">Aucun entretien enregistré pour ces filtres</div></div>`;
      return;
    }

    const chIds  = [...new Set(rows.filter((r) => r.chauffeur_id).map((r) => r.chauffeur_id))];
    const mecIds = [...new Set(rows.filter((r) => r.mecanicien_id).map((r) => r.mecanicien_id))];
    const [chauffeurs, mecaniciens] = await Promise.all([
      chIds.length  ? dbSelect("chauffeurs", { select: "id,prenom,nom", filters: [{ col: "id", op: "in", val: `(${chIds.join(",")})` }] }).catch(() => []) : [],
      mecIds.length ? dbSelect("admins",     { select: "id,prenom,nom", filters: [{ col: "id", op: "in", val: `(${mecIds.join(",")})` }] }).catch(() => []) : []
    ]);
    const chMap  = {}; (chauffeurs  || []).forEach((c) => { chMap[c.id]  = `${c.prenom || ""} ${c.nom || ""}`.trim() || "—"; });
    const mecMap = {}; (mecaniciens || []).forEach((m) => { mecMap[m.id] = `${m.prenom || ""} ${m.nom || ""}`.trim() || "—"; });

    const vehiculeLabel = (r) => r.entite_type === "engin" ? esc(enginsMap[r.entite_plaque] || r.entite_plaque) : esc(r.entite_plaque);
    const vehiculeType  = (r) => {
      const icone = r.entite_type === "tracteur" ? "🚚" : r.entite_type === "remorque" ? "🚛" : "🏗️";
      const profil = r.entite_type !== "engin" ? profilMap[`${r.entite_type}|${r.entite_plaque}`] : null;
      const libelle = profil ? formatProfil(profil) : (r.entite_type === "tracteur" ? "Tracteur / Porteur" : r.entite_type === "remorque" ? "Remorque" : "Engin");
      return `${icone} ${esc(libelle)}`;
    };
    const auteur = (r) => r.chauffeur_id ? `${esc(chMap[r.chauffeur_id] || "—")} (chauffeur)`
      : r.mecanicien_id ? `${esc(mecMap[r.mecanicien_id] || "—")} (atelier)` : "—";

    wrap.innerHTML = `
      <div class="admin-stats-row" style="margin-bottom:20px;">
        <div class="admin-stat-card" style="--stat-color:var(--color-accent);">
          <div class="admin-stat-value">${rows.length}</div>
          <div class="admin-stat-label">Entrées</div>
        </div>
      </div>
      <div class="admin-table-wrap">
        <table>
          <thead>
            <tr><th>VÉHICULE</th><th>DATE</th><th>DÉTAILS</th><th>ENREGISTRÉ PAR</th></tr>
          </thead>
          <tbody>
            ${rows.map((r) => `
              <tr>
                <td><strong>${vehiculeLabel(r)}</strong> <span style="color:var(--color-text-secondary);font-size:11px;">${vehiculeType(r)}</span></td>
                <td>${formatDate(r.date)}</td>
                <td style="font-size:12px;color:var(--color-text-secondary);max-width:320px;">${esc(r.details || "—")}</td>
                <td style="font-size:12px;color:var(--color-text-secondary);">${auteur(r)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  } catch (e) {
    wrap.innerHTML = `<div class="admin-empty"><div class="text">📡 Erreur de chargement</div></div>`;
  }
}

function _ouvrirCreationEntretienVehicule(vehicules, onSuccess) {
  showModal({
    title: "➕ Ajouter un entretien",
    bodyHTML: `
      <div class="admin-field">
        <label>Véhicule</label>
        <select id="ev-create-plaque" class="admin-select" style="width:100%;height:50px;">
          ${vehicules.map((v) => `<option value="${esc(v.value)}|${v.type}">${v.label}</option>`).join("")}
        </select>
      </div>
      <div class="admin-field" style="margin-top:10px;">
        <label>Date</label>
        <input type="date" id="ev-create-date" value="${new Date().toISOString().substring(0, 10)}"
          style="width:100%;height:50px;background:var(--color-surface-card);border:1.5px solid var(--color-divider);border-radius:12px;padding:0 16px;color:var(--color-text-primary);font-size:16px;outline:none;box-sizing:border-box;" />
      </div>
      <div class="admin-field" style="margin-top:10px;">
        <label>Détails</label>
        <textarea id="ev-create-details" rows="3" placeholder="Ex : vidange huile moteur, changement des filtres, embrayage…"
          style="width:100%;background:var(--color-surface-card);border:1.5px solid var(--color-divider);border-radius:12px;padding:10px 14px;color:var(--color-text-primary);font-size:14px;outline:none;resize:vertical;font-family:inherit;box-sizing:border-box;"></textarea>
      </div>
    `,
    confirmLabel: "Enregistrer",
    onConfirm: async (body) => {
      const [plaqueVal, type] = body.querySelector("#ev-create-plaque").value.split("|");
      const dateISO = body.querySelector("#ev-create-date").value;
      const details = body.querySelector("#ev-create-details").value.trim();

      if (!dateISO) { showToast("⚠️ La date est obligatoire"); return false; }
      if (!details) { showToast("⚠️ Ajoute quelques détails"); return false; }

      try {
        await dbInsert("interventions", {
          id: crypto.randomUUID(),
          entreprise_id: adminSession.entreprise_id,
          chauffeur_id:  null,
          mecanicien_id: adminSession.id,
          entite_type:   type,
          entite_plaque: plaqueVal,
          type:          "Entretien",
          details,
          date:          dateISO,
          statut:        null
        });
        showToast("✅ Entretien enregistré !");
        logActiviteEntreprise("ajouter_entretien_vehicule", `Entretien ajouté sur ${plaqueVal}`);
        if (onSuccess) onSuccess();
        return true;
      } catch (e) {
        showToast("❌ " + e.message);
        return false;
      }
    }
  });
}

async function renderPneumatiques() {
  const content = document.getElementById("admin-content");
  try {
    const [tracteurs, remorques, consommations] = await Promise.all([
      dbSelect("tracteurs", {
        select: "plaque,marque,modele,km_pneus_avant,km_pneus_arriere,date_pose_avant,date_pose_arriere",
        filters: [{ col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }],
        order:   { col: "plaque", asc: true }
      }),
      dbSelect("remorques", {
        select: "plaque,marque,modele,profil,km_pneus_e1,km_pneus_e2,km_pneus_e3,km_pneus_e4,km_pneus_e5,km_pneus_e6,date_pose_e1,date_pose_e2,date_pose_e3,date_pose_e4,date_pose_e5,date_pose_e6",
        filters: [{ col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }],
        order:   { col: "plaque", asc: true }
      }),
      dbSelect("consommations", {
        select: "plaque_tracteur,plaque_remorque,date,kilometres",
        filters: [{ col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }],
        order:   { col: "date", asc: true }
      })
    ]);

    // Filtre actif
    let filtreActuel = "tous";

    function kmDepuisPose(plaque, datePoseISO) {
      if (!datePoseISO) return 0;
      // Somme des km saisis dans consommations depuis la date de pose
      const kmReels = (consommations || [])
        .filter(c => c.plaque_tracteur === plaque && c.date >= datePoseISO && Number(c.kilometres) > 0)
        .reduce((s, c) => s + Number(c.kilometres), 0);

      if (kmReels > 0) return kmReels;

      // Fallback 300 km/jour si aucune saisie depuis la pose
      const joursDepuisPose = Math.max(0, Math.floor((Date.now() - new Date(datePoseISO)) / 86400000));
      return joursDepuisPose * 300;
    }

    function graphiqueKm(plaque, datePoseISO) {
      if (!datePoseISO) return [];
      const entreesDepuisPose = (consommations || [])
        .filter(c => c.plaque_tracteur === plaque && c.date >= datePoseISO && Number(c.kilometres) > 0)
        .sort((a, b) => a.date.localeCompare(b.date));

      const points = [];
      let kmCumul = 0;

      if (entreesDepuisPose.length > 0) {
        // Grouper par mois
        const parMois = {};
        entreesDepuisPose.forEach(c => {
          const mois = c.date.substring(0, 7);
          if (!parMois[mois]) parMois[mois] = 0;
          parMois[mois] += Number(c.kilometres);
        });
        Object.entries(parMois).sort().forEach(([mois, km]) => {
          kmCumul += km;
          points.push({ label: mois, km: kmCumul });
        });
      } else {
        // Fallback : un point par mois depuis la pose
        const now = new Date();
        let cursor = new Date(datePoseISO);
        cursor = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
        while (cursor <= now) {
          const label = cursor.toISOString().substring(0, 7);
          const joursInMois = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
          kmCumul += joursInMois * 300;
          points.push({ label, km: kmCumul });
          cursor.setMonth(cursor.getMonth() + 1);
        }
      }
      return points.slice(-12);
    }

    function svgGraphique(points, couleur = "var(--color-accent)") {
      if (!points || points.length === 0) {
        return `<div style="font-size:12px;color:var(--color-text-secondary);text-align:center;padding:20px;">Pas de données</div>`;
      }
      const W = 320, H = 100, PL = 40, PR = 10, PT = 10, PB = 24;
      const maxKm = Math.max(...points.map(p => p.km), 1);
      const xs = points.map((_, i) => PL + (i / Math.max(points.length - 1, 1)) * (W - PL - PR));
      const ys = points.map(p => PT + (1 - p.km / maxKm) * (H - PT - PB));

      const polyline = xs.map((x, i) => `${x},${ys[i]}`).join(" ");
      const area = `${xs[0]},${H - PB} ${polyline} ${xs[xs.length-1]},${H - PB}`;

      const labels = points.length <= 6
        ? points.map((p, i) => `<text x="${xs[i]}" y="${H - 4}" text-anchor="middle" font-size="9" fill="var(--color-text-secondary)">${p.label.substring(5)}</text>`)
        : [0, Math.floor(points.length / 2), points.length - 1].map(i =>
            `<text x="${xs[i]}" y="${H - 4}" text-anchor="middle" font-size="9" fill="var(--color-text-secondary)">${points[i].label.substring(5)}</text>`);

      const maxLabel = `<text x="${PL - 4}" y="${PT + 4}" text-anchor="end" font-size="9" fill="var(--color-text-secondary)">${Math.round(maxKm / 1000)}k</text>`;

      return `
        <svg width="${W}" height="${H}" style="max-width:100%;">
          <defs>
            <linearGradient id="grad-${couleur.replace(/[^a-zA-Z0-9]/g, '')}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="${couleur}" stop-opacity="0.3"/>
              <stop offset="100%" stop-color="${couleur}" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <!-- Ligne de base -->
          <line x1="${PL}" y1="${H - PB}" x2="${W - PR}" y2="${H - PB}" stroke="var(--color-divider)" stroke-width="1"/>
          <!-- Aire -->
          <polygon points="${area}" fill="url(#grad-${couleur.replace(/[^a-zA-Z0-9]/g, '')})" />
          <!-- Courbe -->
          <polyline points="${polyline}" fill="none" stroke="${couleur}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
          <!-- Points -->
          ${xs.map((x, i) => `<circle cx="${x}" cy="${ys[i]}" r="3" fill="${couleur}"/>`).join("")}
          <!-- Labels -->
          ${labels.join("")}
          ${maxLabel}
        </svg>
      `;
    }

    function cardTracteur(t) {
      const kmAv = kmDepuisPose(t.plaque, t.date_pose_avant);
      const kmAr = kmDepuisPose(t.plaque, t.date_pose_arriere);
      const ptAv = graphiqueKm(t.plaque, t.date_pose_avant);
      const ptAr = graphiqueKm(t.plaque, t.date_pose_arriere);
      const hasData = !!(t.date_pose_avant || t.date_pose_arriere);

      return `
        <div class="pneu-card" data-vehicule="${esc(t.plaque)}" data-has-data="${hasData}">
          <div class="pneu-card-header">
            <span class="pneu-card-icon">🚚</span>
            <div>
              <div class="pneu-card-title">${esc(t.plaque)}</div>
              ${t.marque ? `<div class="pneu-card-sub">${esc(t.marque)} ${esc(t.modele || "")}</div>` : ""}
            </div>
          </div>
          <div class="pneu-axes">

            <div class="pneu-axe">
              <div class="pneu-axe-title">🔘 Essieu avant</div>
              <div class="pneu-axe-info">
                <div class="pneu-stat">
                  <span class="pneu-stat-val">${Math.round(kmAv).toLocaleString("fr-FR")} km</span>
                  <span class="pneu-stat-lbl">Parcourus depuis la pose</span>
                </div>
                <div class="pneu-stat">
                  <span class="pneu-stat-val">${t.date_pose_avant ? formatDate(t.date_pose_avant) : "—"}</span>
                  <span class="pneu-stat-lbl">Date de pose</span>
                </div>
              </div>
              <div class="pneu-graph">${svgGraphique(ptAv, "var(--color-accent)")}</div>
            </div>

            <div class="pneu-axe">
              <div class="pneu-axe-title">🔘 Essieu arrière</div>
              <div class="pneu-axe-info">
                <div class="pneu-stat">
                  <span class="pneu-stat-val">${Math.round(kmAr).toLocaleString("fr-FR")} km</span>
                  <span class="pneu-stat-lbl">Parcourus depuis la pose</span>
                </div>
                <div class="pneu-stat">
                  <span class="pneu-stat-val">${t.date_pose_arriere ? formatDate(t.date_pose_arriere) : "—"}</span>
                  <span class="pneu-stat-lbl">Date de pose</span>
                </div>
              </div>
              <div class="pneu-graph">${svgGraphique(ptAr, "var(--color-accent)")}</div>
            </div>

          </div>
        </div>
      `;
    }

    // Remorques : pas de plaque_remorque dans consommations (une remorque peut
    // changer de tracteur), donc on retrouve le(s) tracteur(s) actuellement
    // attelé(s) à chaque remorque via sessions_actives, et on réutilise leurs
    // km réels saisis — comme pour un tracteur. Fallback 300km/jour uniquement
    // si aucune donnée réelle n'est trouvée (remorque jamais attelée / pas de saisie).
    const tracteursParRemorque = {}; // { plaque_remorque: Set(plaque_tracteur) }
    Object.values(sessionsActives || {}).forEach((s) => {
      if (!s.plaque_remorque || !s.plaque_tracteur) return;
      if (!tracteursParRemorque[s.plaque_remorque]) tracteursParRemorque[s.plaque_remorque] = new Set();
      tracteursParRemorque[s.plaque_remorque].add(s.plaque_tracteur);
    });

    function kmDepuisPoseRemorque(plaqueRemorque, datePoseISO) {
      if (!datePoseISO) return 0;
      // Priorité : saisies où plaque_remorque = cette remorque (exact)
      const kmAvecPlaque = (consommations || [])
        .filter(c => c.plaque_remorque === plaqueRemorque && c.date >= datePoseISO && Number(c.kilometres) > 0)
        .reduce((s, c) => s + Number(c.kilometres), 0);
      if (kmAvecPlaque > 0) return kmAvecPlaque;

      // Fallback : tracteur actuellement attelé (saisies avant la migration plaque_remorque)
      const tracteursListes = tracteursParRemorque[plaqueRemorque];
      if (tracteursListes && tracteursListes.size > 0) {
        const kmViaTracteur = (consommations || [])
          .filter(c => !c.plaque_remorque && tracteursListes.has(c.plaque_tracteur) && c.date >= datePoseISO && Number(c.kilometres) > 0)
          .reduce((s, c) => s + Number(c.kilometres), 0);
        if (kmViaTracteur > 0) return kmViaTracteur;
      }

      // Dernier fallback : estimation 300km/jour
      const jours = Math.max(0, Math.floor((Date.now() - new Date(datePoseISO)) / 86400000));
      return jours * 300;
    }

    function graphiqueKmRemorque(plaqueRemorque, datePoseISO) {
      if (!datePoseISO) return [];
      // Même logique : priorité plaque_remorque, fallback tracteur attelé
      let entries = (consommations || [])
        .filter(c => c.plaque_remorque === plaqueRemorque && c.date >= datePoseISO && Number(c.kilometres) > 0);

      if (entries.length === 0) {
        const tracteursListes = tracteursParRemorque[plaqueRemorque];
        if (tracteursListes && tracteursListes.size > 0) {
          entries = (consommations || [])
            .filter(c => !c.plaque_remorque && tracteursListes.has(c.plaque_tracteur) && c.date >= datePoseISO && Number(c.kilometres) > 0);
        }
      }

      entries = entries.sort((a, b) => a.date.localeCompare(b.date));
      const points = [];
      let kmCumul = 0;

      if (entries.length > 0) {
        const parMois = {};
        entries.forEach(c => {
          const mois = c.date.substring(0, 7);
          if (!parMois[mois]) parMois[mois] = 0;
          parMois[mois] += Number(c.kilometres);
        });
        Object.entries(parMois).sort().forEach(([mois, km]) => {
          kmCumul += km;
          points.push({ label: mois, km: kmCumul });
        });
      } else {
        const now = new Date();
        let cursor = new Date(datePoseISO);
        cursor = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
        while (cursor <= now) {
          const label = cursor.toISOString().substring(0, 7);
          const joursInMois = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
          kmCumul += joursInMois * 300;
          points.push({ label, km: kmCumul });
          cursor.setMonth(cursor.getMonth() + 1);
        }
      }
      return points.slice(-12);
    }

    // Secours si le catalogue profils_vehicules n'est pas encore chargé.
    const FALLBACK_ESSIEUX_REMORQUE = {
      remorque_1e:   1, remorque_2e: 2, remorque_3e: 3,
      porte_char_4e: 4, porte_char_5e: 5, porte_char_6e: 6,
      citerne_alim_2c: 3, citerne_alim_3c: 3, citerne_alim_4c: 3, citerne_alim_5c: 3, citerne_alim_6c: 3,
      remorque_frigo_2e: 2, remorque_frigo_3e: 3
    };
    function nbEssieuxRemorque(profil) {
      const p = getProfilVehicule(profil);
      if (p && p.nb_essieux != null) return p.nb_essieux;
      return FALLBACK_ESSIEUX_REMORQUE[profil] || 3;
    }
    const LABELS_ESSIEUX = ["1er essieu","2e essieu","3e essieu","4e essieu","5e essieu","6e essieu"];
    const FIELDS_KM_R    = ["km_pneus_e1","km_pneus_e2","km_pneus_e3","km_pneus_e4","km_pneus_e5","km_pneus_e6"];
    const FIELDS_DATE_R  = ["date_pose_e1","date_pose_e2","date_pose_e3","date_pose_e4","date_pose_e5","date_pose_e6"];

    function cardRemorque(r) {
      const nbEssieux = nbEssieuxRemorque(r.profil);

      const essieux = [];
      for (let i = 0; i < nbEssieux; i++) {
        essieux.push({
          label: LABELS_ESSIEUX[i],
          km:    r[FIELDS_KM_R[i]],
          date:  r[FIELDS_DATE_R[i]]
        });
      }

      const axesHTML = essieux.map(e => {
        const kmTotal = kmDepuisPoseRemorque(r.plaque, e.date);
        const points  = graphiqueKmRemorque(r.plaque, e.date);
        return `
          <div class="pneu-axe">
            <div class="pneu-axe-title">🔘 ${esc(e.label)}</div>
            <div class="pneu-axe-info">
              <div class="pneu-stat">
                <span class="pneu-stat-val">${Math.round(kmTotal).toLocaleString("fr-FR")} km</span>
                <span class="pneu-stat-lbl">Parcourus depuis la pose</span>
              </div>
              <div class="pneu-stat">
                <span class="pneu-stat-val">${e.date ? formatDate(e.date) : "—"}</span>
                <span class="pneu-stat-lbl">Date de pose</span>
              </div>
            </div>
            <div class="pneu-graph">${svgGraphique(points, "var(--color-purple)")}</div>
          </div>
        `;
      }).join("");

      const hasData = essieux.some(e => e.date);
      return `
        <div class="pneu-card" data-vehicule="${esc(r.plaque)}" data-has-data="${hasData}">
          <div class="pneu-card-header">
            <span class="pneu-card-icon">🚛</span>
            <div>
              <div class="pneu-card-title">${esc(r.plaque)}</div>
              ${r.marque ? `<div class="pneu-card-sub">${esc(r.marque)} ${esc(r.modele || "")}</div>` : ""}
            </div>
          </div>
          <div class="pneu-axes">${axesHTML}</div>
        </div>
      `;
    }

    // Options filtre
    const optionsTracteurs = tracteurs.map(t =>
      `<option value="${esc(t.plaque)}">🚚 ${esc(t.plaque)}</option>`).join("");
    const optionsRemorques = remorques.map(r =>
      `<option value="${esc(r.plaque)}">🚛 ${esc(r.plaque)}</option>`).join("");

    content.innerHTML = `
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:20px;flex-wrap:wrap;">
        <select id="pneu-filtre" style="background:var(--color-surface-card);border:1px solid var(--color-divider);border-radius:10px;padding:8px 14px;color:var(--color-text-primary);font-size:13px;font-weight:600;outline:none;cursor:pointer;">
          <option value="tous">Tous les véhicules</option>
          <optgroup label="Tracteurs">${optionsTracteurs}</optgroup>
          <optgroup label="Remorques">${optionsRemorques}</optgroup>
        </select>
        <label style="display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--color-text-secondary);cursor:pointer;">
          <input type="checkbox" id="pneu-masquer-vides" />
          Masquer les véhicules sans données
        </label>
        <div style="font-size:12px;color:var(--color-text-secondary);margin-left:auto;">
          ${tracteurs.length} tracteur(s) · ${remorques.length} remorque(s)
        </div>
      </div>

      <div id="pneu-grid">
        ${tracteurs.map(t => cardTracteur(t)).join("")}
        ${remorques.map(r => cardRemorque(r)).join("")}
      </div>
    `;

    // Filtre plaque + masquage des véhicules sans données pose — combinés :
    // une carte n'est visible que si les deux conditions sont remplies.
    function appliquerFiltresPneu() {
      const val = document.getElementById("pneu-filtre").value;
      const masquerVides = document.getElementById("pneu-masquer-vides").checked;
      document.querySelectorAll(".pneu-card").forEach(card => {
        const matchPlaque = val === "tous" || card.dataset.vehicule === val;
        const matchDonnees = !masquerVides || card.dataset.hasData === "true";
        card.style.display = (matchPlaque && matchDonnees) ? "block" : "none";
      });
    }
    document.getElementById("pneu-filtre").addEventListener("change", appliquerFiltresPneu);
    document.getElementById("pneu-masquer-vides").addEventListener("change", appliquerFiltresPneu);

  } catch (e) {
    content.innerHTML = `<div class="admin-empty"><div class="text">📡 Erreur de chargement</div></div>`;
    console.error("[pneumatiques]", e);
  }
}


// ════════════════════════════════════════════════════════════════════════
// LIMITATION VÉHICULES PAR PACK
// ════════════════════════════════════════════════════════════════════════

const PACKS_LIMITES = {
  starter:    5,
  pme:        15,
  pro:        35,
  entreprise: Infinity
};

const PACK_LABELS = {
  starter:    "Starter",
  pme:        "PME",
  pro:        "Pro",
  entreprise: "Entreprise"
};

const MEMOTRUCK_CONTACT = {
  email:    "contact@memotruck.fr",
  whatsapp: "https://wa.me/33650716507"
};

// Vérifie si la limite de véhicules moteurs est atteinte
// Véhicules moteurs = tracteurs + engins (les remorques ne comptent pas)
async function verifierLimiteVehicules() {
  try {
    // Pas de .catch() par requête : un échec partiel (ex. la requête
    // "tracteurs" seule qui échoue) ne doit jamais se traduire par un
    // comptage silencieusement sous-évalué qui laisserait dépasser la
    // limite du pack sans avertissement — on préfère que tout l'appel
    // échoue et tombe dans le catch global ci-dessous (qui, lui, laisse
    // volontairement passer plutôt que de bloquer l'admin).
    const [entrepriseRows, tracteurs, engins] = await Promise.all([
      dbSelect("entreprises", {
        select: "pack",
        filters: [{ col: "id", op: "eq", val: adminSession.entreprise_id }]
      }),
      dbSelect("tracteurs", {
        select: "plaque",
        filters: [{ col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }]
      }),
      dbSelect("engins", {
        select: "id",
        filters: [{ col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }]
      })
    ]);

    const pack        = entrepriseRows?.[0]?.pack || "starter";
    const limite      = PACKS_LIMITES[pack] ?? 5;
    const nbVehicules = (tracteurs?.length || 0) + (engins?.length || 0);

    if (nbVehicules >= limite) {
      _showLimiteAtteinte(pack, nbVehicules, limite);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[limite véhicules]", e);
    return true; // En cas d'erreur, on laisse passer pour ne pas bloquer
  }
}

function _showLimiteAtteinte(pack, nbActuels, limite) {
  const packLabel = (PACK_LABELS[pack] || pack) + (limite === Infinity ? "" : ` (${limite} véhicules)`);

  showModal({
    title: "🚫 Limite atteinte",
    bodyHTML: `
      <div style="text-align:center;padding:8px 0;">
        <div style="font-size:48px;margin-bottom:16px;">🚛</div>
        <p style="color:var(--color-text-primary);font-size:15px;font-weight:600;margin-bottom:8px;">
          Vous avez atteint la limite de votre abonnement
        </p>
        <p style="color:var(--color-text-secondary);font-size:13px;margin-bottom:20px;">
          Pack <strong>${packLabel}</strong> — ${nbActuels} véhicule(s) sur ${limite === Infinity ? "illimité" : limite} utilisé(s)
        </p>
        <p style="color:var(--color-text-secondary);font-size:13px;margin-bottom:24px;">
          Pour ajouter d'autres véhicules, contactez MémoTruck pour changer de forfait.
        </p>
        <div style="display:flex;flex-direction:column;gap:12px;">
          <a href="${MEMOTRUCK_CONTACT.whatsapp}" target="_blank"
             style="display:flex;align-items:center;justify-content:center;gap:10px;padding:14px;background:#25D366;color:#fff;border-radius:12px;text-decoration:none;font-weight:700;font-size:15px;">
            <span style="font-size:20px;">💬</span> Contacter via WhatsApp
          </a>
          <a href="mailto:${MEMOTRUCK_CONTACT.email}?subject=Changement de forfait MémoTruck&body=Bonjour, je souhaite upgrader mon abonnement MémoTruck (actuellement Pack ${packLabel}). Merci de me contacter."
             style="display:flex;align-items:center;justify-content:center;gap:10px;padding:14px;background:var(--color-surface-card);color:var(--color-text-primary);border:1.5px solid var(--color-divider);border-radius:12px;text-decoration:none;font-weight:600;font-size:14px;">
            <span style="font-size:18px;">✉️</span> Envoyer un email
          </a>
        </div>
      </div>
    `,
    confirmLabel: null,
    cancelLabel: "Fermer"
  });
}

// ════════════════════════════════════════════════════════════════════════
// SECTION — ENGINS BTP / SPÉCIAUX
// ════════════════════════════════════════════════════════════════════════

const PROFILS_ENGINS_ADMIN = [
  { id: "pelle_hydraulique",   label: "Pelle hydraulique",     emoji: "🦾", vgp: "annuelle"     },
  { id: "rouleau_compacteur",  label: "Rouleau compacteur",    emoji: "🔄", vgp: "annuelle"     },
  { id: "bulldozer_chargeuse", label: "Bulldozer / Chargeuse", emoji: "🚜", vgp: "annuelle"     },
  { id: "grue_nacelle",        label: "Grue / Nacelle",        emoji: "🏗️", vgp: "semestrielle" },
  { id: "finisseur",           label: "Finisseur",             emoji: "🛣️", vgp: "annuelle"     },
  { id: "alimentateur",        label: "Alimentateur",          emoji: "📦", vgp: "annuelle"     },
  { id: "raboteuse",           label: "Raboteuse",             emoji: "⚙️", vgp: "annuelle",
    note: "Transportée sur porte-char" },
];

function getProfilEnginAdmin(id) {
  return PROFILS_ENGINS_ADMIN.find(p => p.id === id)
    || { id, label: id, emoji: "🔧", vgp: "annuelle" };
}

async function renderEngins() {
  const content = document.getElementById("admin-content");
  if (!content) return;
  content.innerHTML = `<div class="admin-loading"><div class="spinner"></div><div class="text">Chargement des engins…</div></div>`;
  try {
    const engins = await dbSelect("engins", {
      select: "id,profil,numero_serie,numero_parc,marque,modele,date_assurance,date_vgp,date_entretien",
      filters: [{ col: "entreprise_id", op: "eq", val: adminSession.entreprise_id }],
      order: { col: "numero_parc", asc: true }
    });

    function dateCell(iso) {
      if (!iso) return `<span style="color:var(--color-text-secondary);">—</span>`;
      const diff  = Math.floor((new Date(iso) - Date.now()) / 86400000);
      const color = diff < 0 ? "var(--color-danger)" : diff < 15 ? "var(--color-warning)" : diff < 60 ? "var(--color-warning-soft)" : "var(--color-success)";
      return `<span style="color:${color};font-weight:600;">${formatDate(iso)}</span>`;
    }

    const parProfil = {};
    (engins || []).forEach(e => { parProfil[e.profil] = (parProfil[e.profil] || 0) + 1; });

    content.innerHTML = `
      <div class="admin-stats-row">
        <div class="admin-stat-card" style="--stat-color:var(--color-accent);">
          <div class="admin-stat-value">${(engins || []).length}</div>
          <div class="admin-stat-label">Engins au total</div>
        </div>
        ${Object.entries(parProfil).map(([profil, nb]) => {
          const p = getProfilEnginAdmin(profil);
          return `<div class="admin-stat-card" style="--stat-color:var(--color-warning);">
            <div class="admin-stat-value">${nb}</div>
            <div class="admin-stat-label">${p.emoji} ${p.label}</div>
          </div>`;
        }).join("")}
      </div>
      <div class="admin-table-wrap">
        <div class="admin-table-title">
          <span>Tous les engins</span>
          <button class="btn-ajouter" id="btn-ajouter-engin">+ Ajouter un engin</button>
        </div>
        <table>
          <thead>
            <tr>
              <th>N° PARC</th><th>PROFIL</th><th>MARQUE / MODÈLE</th>
              <th>N° SÉRIE</th><th>ASSURANCE</th><th>VGP</th><th>ENTRETIEN</th><th>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            ${(engins || []).length === 0
              ? `<tr><td colspan="8" style="text-align:center;color:var(--color-text-secondary);padding:32px;">Aucun engin enregistré</td></tr>`
              : (engins || []).map(e => {
                  const p = getProfilEnginAdmin(e.profil);
                  return `<tr>
                    <td><strong style="color:var(--color-accent);">${esc(e.numero_parc)}</strong></td>
                    <td>${p.emoji} ${p.label}${p.note ? `<div style="font-size:11px;color:var(--color-text-secondary);">${p.note}</div>` : ""}</td>
                    <td>${e.marque ? `<strong>${esc(e.marque)}</strong>${e.modele ? ` <span style="font-size:11px;color:var(--color-text-secondary);">${esc(e.modele)}</span>` : ""}` : "—"}</td>
                    <td style="font-size:12px;color:var(--color-text-secondary);">${esc(e.numero_serie)}</td>
                    <td>${dateCell(e.date_assurance)}</td>
                    <td>${dateCell(e.date_vgp)}<div style="font-size:10px;color:var(--color-text-secondary);">${p.vgp}</div></td>
                    <td>${dateCell(e.date_entretien)}</td>
                    <td>
                      <button class="btn-edit engin-edit" data-engin-id="${e.id}">✏️ Modifier</button>
                      <button class="btn-supprimer engin-del" data-engin-id="${e.id}" data-engin-parc="${esc(e.numero_parc)}">🗑️</button>
                    </td>
                  </tr>`;
                }).join("")}
          </tbody>
        </table>
      </div>`;

    document.getElementById("btn-ajouter-engin").addEventListener("click", async () => {
      if (await verifierLimiteVehicules()) ouvrirModalEngin(null);
    });
    content.querySelectorAll(".engin-edit").forEach(btn => {
      btn.addEventListener("click", () => {
        const engin = (engins || []).find(e => e.id === btn.dataset.enginId);
        if (engin) ouvrirModalEngin(engin);
      });
    });
    content.querySelectorAll(".engin-del").forEach(btn => {
      btn.addEventListener("click", () => supprimerEngin(btn.dataset.enginId, btn.dataset.enginParc));
    });
  } catch (err) {
    content.innerHTML = `<div class="admin-empty"><div class="text">📡 Erreur de chargement des engins</div></div>`;
    console.error("[renderEngins]", err);
  }
}

function ouvrirModalEngin(engin) {
  const isEdit = !!engin;
  const inp = "width:100%;height:50px;background:var(--color-surface-card);border:1.5px solid var(--color-divider);border-radius:12px;padding:0 16px;color:var(--color-text-primary);font-size:15px;outline:none;";
  const profilOptions = `<option value="">— Sélectionner un type d'engin —</option>` +
    PROFILS_ENGINS_ADMIN.map(p => `<option value="${p.id}" ${engin?.profil === p.id ? "selected" : ""}>${p.emoji} ${p.label}</option>`).join("");
  showModal({
    title: isEdit ? `Modifier — ${esc(engin.numero_parc)}` : "Ajouter un engin",
    bodyHTML: `
      <div class="admin-field"><label>TYPE D'ENGIN *</label><select id="engin-profil" style="${inp}font-weight:600;">${profilOptions}</select></div>
      <div class="admin-field"><label>N° DE PARC *</label><input type="text" id="engin-parc" value="${esc(engin?.numero_parc||"")}" placeholder="PELLE N450" style="${inp}"/></div>
      <div class="admin-field"><label>N° DE SÉRIE *</label><input type="text" id="engin-serie" value="${esc(engin?.numero_serie||"")}" placeholder="CAT320-SN-12345" style="${inp}"/></div>
      <div class="admin-field"><label>MARQUE</label><input type="text" id="engin-marque" value="${esc(engin?.marque||"")}" placeholder="ex: Caterpillar" style="${inp}"/></div>
      <div class="admin-field"><label>MODÈLE</label><input type="text" id="engin-modele" value="${esc(engin?.modele||"")}" placeholder="ex: 320" style="${inp}"/></div>
      <div class="admin-field"><label>ASSURANCE</label><input type="date" id="engin-assurance" value="${engin?.date_assurance||""}" style="${inp}"/></div>
      <div class="admin-field"><label>VGP</label><input type="date" id="engin-vgp" value="${engin?.date_vgp||""}" style="${inp}"/></div>
      <div class="admin-field"><label>ENTRETIEN PÉRIODIQUE</label><input type="date" id="engin-entretien" value="${engin?.date_entretien||""}" style="${inp}"/></div>`,
    confirmLabel: isEdit ? "Enregistrer" : "Ajouter",
    onConfirm: async (body) => {
      const profil = body.querySelector("#engin-profil").value;
      const parc   = body.querySelector("#engin-parc").value.trim().toUpperCase();
      const serie  = body.querySelector("#engin-serie").value.trim();
      if (!profil) { showToast("⚠️ Sélectionne un type d'engin"); return false; }
      if (!parc)   { showToast("⚠️ Renseigne le n° de parc");    return false; }
      if (!serie)  { showToast("⚠️ Renseigne le n° de série");   return false; }

      const dateAssurance = body.querySelector("#engin-assurance").value || null;
      const dateVgp       = body.querySelector("#engin-vgp").value || null;
      const dateEntretien = body.querySelector("#engin-entretien").value || null;

      const data = {
        profil, numero_parc: parc, numero_serie: serie,
        marque: body.querySelector("#engin-marque").value.trim() || null,
        modele: body.querySelector("#engin-modele").value.trim() || null,
        date_assurance: dateAssurance,
        date_vgp:       dateVgp,
        date_entretien: dateEntretien,
        entreprise_id: adminSession.entreprise_id
      };
      if (isEdit) {
        await dbUpdate("engins", data, [{ col: "id", op: "eq", val: engin.id }]);
        showToast(`✅ Engin ${parc} mis à jour`);
      } else {
        await dbInsert("engins", data);
        showToast(`✅ Engin ${parc} ajouté`);
      }
      renderEngins();
    }
  });
}

function supprimerEngin(id, parc) {
  showModal({
    title: `Supprimer ${esc(parc)} ?`,
    bodyHTML: `<p style="color:var(--color-text-secondary);font-size:14px;">Cette action est définitive.</p>`,
    confirmLabel: "Supprimer", danger: true,
    onConfirm: async () => {
      await dbDelete("engins", [{ col: "id", op: "eq", val: id }]);
      showToast(`🗑️ Engin ${parc} supprimé`);
      renderEngins();
    }
  });
}
// ════════════════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════════════════

function init() {
  // Login
  document.getElementById("admin-btn-login").addEventListener("click", handleLogin);
  document.getElementById("admin-input-password").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleLogin();
  });

  // Logout
  document.getElementById("admin-btn-logout").addEventListener("click", handleLogout);
  document.getElementById("atelier-btn-logout").addEventListener("click", handleLogout);

  // Navigation
  document.querySelectorAll(".admin-nav-item").forEach((el) => {
    el.addEventListener("click", () => {
      if (el.dataset.atelierSection) {
        closeAtelierSidebar();
        navigateAtelier(el.dataset.atelierSection);
      } else {
        closeSidebar();
        navigateTo(el.dataset.section);
      }
    });
  });

  // Burger mobile
  document.getElementById("admin-burger").addEventListener("click", toggleSidebar);
  document.getElementById("admin-overlay").addEventListener("click", closeSidebar);
  document.getElementById("atelier-burger").addEventListener("click", toggleAtelierSidebar);
  document.getElementById("atelier-overlay").addEventListener("click", closeAtelierSidebar);

  // Auto-login
  if (tryAutoLogin()) {
    enterAdminScreen();
  }
}

function toggleSidebar() {
  const sidebar  = document.getElementById("admin-sidebar");
  const overlay  = document.getElementById("admin-overlay");
  const isOpen   = sidebar.classList.contains("open");
  sidebar.classList.toggle("open", !isOpen);
  overlay.classList.toggle("hidden", isOpen);
}

function closeSidebar() {
  document.getElementById("admin-sidebar").classList.remove("open");
  document.getElementById("admin-overlay").classList.add("hidden");
}

init();

// ════════════════════════════════════════════════════════════════════════
// MémoTruck — Client Supabase
// Utilise le SDK officiel @supabase/supabase-js pour le Realtime.
// ════════════════════════════════════════════════════════════════════════

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

export const SUPABASE_URL  = "https://ztlxxrywxxflqvigwncb.supabase.co";
export const SUPABASE_ANON = "sb_publishable_TpyGDizV1HVN3h8twaXlOA_N02y26cJ";

const JWT_KEY = "atil_jwt";

// ─── Client Supabase (singleton) ─────────────────────────────────────────
let _client = null;

export function getClient() {
  if (_client) return _client;
  _client = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { persistSession: false },
    realtime: {
      params: { eventsPerSecond: 10 }
    }
  });
  // Injecte le JWT existant dès la création du client
  const existingJwt = localStorage.getItem(JWT_KEY);
  if (existingJwt) {
    // Délai minimal pour que le client soit prêt
    setTimeout(() => {
      if (_client) _client.realtime.setAuth(existingJwt);
    }, 100);
  }
  return _client;
}

// ─── JWT ─────────────────────────────────────────────────────────────────
export function getJWT() {
  return localStorage.getItem(JWT_KEY) || null;
}

export function setJWT(token) {
  if (token) localStorage.setItem(JWT_KEY, token);
  else localStorage.removeItem(JWT_KEY);
  // Injecte le JWT dans le client Supabase pour le RLS
  if (token) {
    getClient().realtime.setAuth(token);
  }
}

// ─── En-têtes avec JWT ────────────────────────────────────────────────────
function authHeaders() {
  const jwt = getJWT();
  return {
    "apikey": SUPABASE_ANON,
    "Authorization": jwt ? `Bearer ${jwt}` : `Bearer ${SUPABASE_ANON}`
  };
}

// ════════════════════════════════════════════════════════════════════════
// REST API — helpers génériques (fetch direct, plus rapide que le SDK)
// ════════════════════════════════════════════════════════════════════════

export async function dbSelect(table, { select = "*", filters = [], order = null, limit = null } = {}) {
  let url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}`;
  filters.forEach(({ col, op, val }) => {
    url += `&${encodeURIComponent(col)}=${op}.${encodeURIComponent(val)}`;
  });
  if (order) url += `&order=${encodeURIComponent(order.col)}${order.asc === false ? ".desc" : ""}`;
  if (limit) url += `&limit=${limit}`;

  const res = await fetch(url, {
    method: "GET",
    headers: { ...authHeaders(), "Content-Type": "application/json", "Prefer": "return=representation" }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GET ${table} failed (${res.status})`);
  }
  return res.json();
}

export async function dbInsert(table, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json", "Prefer": "return=representation" },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const e = new Error(err.message || `INSERT ${table} failed (${res.status})`);
    e.status = res.status;
    throw e;
  }
  return res.json();
}

// Variante sans SELECT de retour — utile quand la RLS bloque le SELECT post-INSERT
export async function dbInsertMinimal(table, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json", "Prefer": "return=minimal" },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const e = new Error(err.message || `INSERT ${table} failed (${res.status})`);
    e.status = res.status;
    throw e;
  }
  return true;
}

export async function dbUpdate(table, data, filters = []) {
  let url = `${SUPABASE_URL}/rest/v1/${table}`;
  const qs = filters.map(({ col, op, val }) =>
    `${encodeURIComponent(col)}=${op}.${encodeURIComponent(val)}`
  ).join("&");
  if (qs) url += "?" + qs;

  const res = await fetch(url, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json", "Prefer": "return=representation" },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const e = new Error(err.message || `UPDATE ${table} failed (${res.status})`);
    e.status = res.status;
    throw e;
  }
  return res.json();
}

export async function dbUpsert(table, data, { onConflict = null } = {}) {
  let url = `${SUPABASE_URL}/rest/v1/${table}`;
  if (onConflict) url += `?on_conflict=${encodeURIComponent(onConflict)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const e = new Error(err.message || `UPSERT ${table} failed (${res.status})`);
    e.status = res.status;
    throw e;
  }
  return res.json();
}

export async function dbDelete(table, filters = []) {
  let url = `${SUPABASE_URL}/rest/v1/${table}`;
  const qs = filters.map(({ col, op, val }) =>
    `${encodeURIComponent(col)}=${op}.${encodeURIComponent(val)}`
  ).join("&");
  if (qs) url += "?" + qs;
  const res = await fetch(url, {
    method: "DELETE",
    headers: authHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `DELETE ${table} failed (${res.status})`);
  }
  return true;
}

// ════════════════════════════════════════════════════════════════════════
// EDGE FUNCTIONS
// ════════════════════════════════════════════════════════════════════════

export async function callEdgeFunction(name, body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || json.message || `Edge Function ${name} failed (${res.status})`);
  return json;
}

// Comme callEdgeFunction, mais avec le JWT chauffeur en Authorization
// (requis par workshop-notify pour identifier l'appelant).
export async function callEdgeFunctionAuth(name, body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || json.message || `Edge Function ${name} failed (${res.status})`);
  return json;
}

// ════════════════════════════════════════════════════════════════════════
// REALTIME — via SDK officiel Supabase
// Remplace notre WebSocket custom. Fonctionne exactement comme onSnapshot.
//
// Usage :
//   const unsub = realtimeListen("cartes_perso", { chauffeur_id: id }, (rows) => { ... });
//   unsub(); // désabonnement
// ════════════════════════════════════════════════════════════════════════

export function realtimeListen(table, filterEq, callback, fetchOpts = {}) {
  const supabase   = getClient();
  const filterKey  = Object.keys(filterEq)[0];
  const filterVal  = filterEq[filterKey];
  const channelName = `${table}-${filterKey}-${filterVal}`;

  // Fetch initial
  dbSelect(table, { ...fetchOpts, filters: [{ col: filterKey, op: "eq", val: filterVal }] })
    .then(callback)
    .catch(() => {});

  // Abonnement Realtime via SDK officiel
  const channel = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table, filter: `${filterKey}=eq.${filterVal}` },
      async () => {
        // À chaque changement, on refetch pour avoir les données complètes
        try {
          const rows = await dbSelect(table, {
            ...fetchOpts,
            filters: [{ col: filterKey, op: "eq", val: filterVal }]
          });
          callback(rows);
        } catch (_) {}
      }
    )
    .subscribe();

  // Retourne la fonction de désabonnement
  return () => {
    supabase.removeChannel(channel);
  };
}

// ════════════════════════════════════════════════════════════════════════
// UTILITAIRES DATE
// ════════════════════════════════════════════════════════════════════════

export function dateToISO(date) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, "0");
  const dd   = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ════════════════════════════════════════════════════════════════════════
// REALTIME SANS FETCH INITIAL
// Comme realtimeListen mais sans le fetch initial —
// n'appelle le callback QUE sur les vrais changements Postgres.
// Utilisé pour détecter les changements admin sans déclencher au démarrage.
// ════════════════════════════════════════════════════════════════════════

export function realtimeListenChangesOnly(table, filterEq, callback) {
  const supabase    = getClient();
  const filterKey   = Object.keys(filterEq)[0];
  const filterVal   = filterEq[filterKey];
  const channelName = `changes-only-${table}-${filterKey}-${filterVal}`;

  const channel = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table, filter: `${filterKey}=eq.${filterVal}` },
      async () => {
        try {
          const rows = await dbSelect(table, {
            filters: [{ col: filterKey, op: "eq", val: filterVal }]
          });
          callback(rows);
        } catch (_) {}
      }
    )
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}
